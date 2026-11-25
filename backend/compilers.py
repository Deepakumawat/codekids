"""
Code Execution - supports Python, Java, JavaScript, C++, Go

Student code is untrusted. On the server (Linux, running as root in Docker)
every student program runs:
  - as the unprivileged `runner` user, so it cannot read the server's files,
    the database, or /proc/<pid>/environ of the server (where the API keys live)
  - with a minimal environment that contains no secrets
  - in its own temp directory, with no stdin
  - with CPU, memory, file-size and process-count limits
  - in its own process group, which is killed as a whole on timeout
Compilers (javac, g++, go build) run as the server user with the same clean
environment; they don't execute student code.
"""

import os
import shutil
import signal
import subprocess
import tempfile

IS_POSIX = os.name == "posix"
if IS_POSIX:
    import pwd
    import resource  # imported here: importing after fork in a threaded server can deadlock
RUNNER_USER = os.getenv("CODE_RUNNER_USER", "runner")
MAX_OUTPUT_BYTES = 64 * 1024          # what we send back to the browser
MAX_FILE_BYTES = 10 * 1024 * 1024     # hard cap on anything a program writes
MAX_PROCS = 256                       # per runner user (Java needs threads)

GO_CACHE = "/root/.cache/go-build"    # pre-warmed in the Dockerfile


def _safe_env(extra=None) -> dict:
    """A minimal environment: never pass the server's env (it holds API keys)."""
    env = {
        "PATH": os.environ.get("PATH", "/usr/local/bin:/usr/bin:/bin"),
        "LANG": "C.UTF-8",
        "HOME": tempfile.gettempdir(),
        "PYTHONIOENCODING": "utf-8",
    }
    if not IS_POSIX:
        # Windows (local development) needs these for programs to start at all.
        for key in ("SYSTEMROOT", "WINDIR", "TEMP", "TMP", "COMSPEC", "PATHEXT"):
            if key in os.environ:
                env[key] = os.environ[key]
    if extra:
        env.update(extra)
    return env


def _runner_ids():
    """(uid, gid) of the sandbox user when we are root on Linux, else None."""
    if not IS_POSIX or os.geteuid() != 0:
        return None
    try:
        pw = pwd.getpwnam(RUNNER_USER)
    except KeyError:
        return None
    return pw.pw_uid, pw.pw_gid


def _sandbox_missing() -> bool:
    """Running as root without a runner user: refuse rather than run unsandboxed."""
    return IS_POSIX and os.geteuid() == 0 and _runner_ids() is None


def _give_to_runner(path: str, ids) -> None:
    if not ids:
        return
    uid, gid = ids
    os.chown(path, uid, gid)
    for root, dirs, files in os.walk(path):
        for name in dirs + files:
            os.chown(os.path.join(root, name), uid, gid)


def _make_preexec(ids, cpu_seconds: int, mem_mb):
    def preexec():
        os.setsid()  # own process group, so a timeout kills every child too
        resource.setrlimit(resource.RLIMIT_CPU, (cpu_seconds, cpu_seconds))
        resource.setrlimit(resource.RLIMIT_FSIZE, (MAX_FILE_BYTES, MAX_FILE_BYTES))
        resource.setrlimit(resource.RLIMIT_CORE, (0, 0))
        if mem_mb:
            limit = mem_mb * 1024 * 1024
            resource.setrlimit(resource.RLIMIT_AS, (limit, limit))
        if ids:
            uid, gid = ids
            resource.setrlimit(resource.RLIMIT_NPROC, (MAX_PROCS, MAX_PROCS))
            os.setgroups([])
            os.setgid(gid)
            os.setuid(uid)
    return preexec


def _read_capped(f) -> str:
    f.seek(0)
    data = f.read(MAX_OUTPUT_BYTES + 1)
    text = data[:MAX_OUTPUT_BYTES].decode("utf-8", errors="replace")
    if len(data) > MAX_OUTPUT_BYTES:
        text += "\n... (output truncated)"
    return text


def _kill(proc) -> None:
    try:
        if IS_POSIX:
            os.killpg(proc.pid, signal.SIGKILL)
        else:
            proc.kill()
    except (ProcessLookupError, PermissionError, OSError):
        pass


def _run(cmd, timeout=10, cwd=None, env=None, sandbox=False, mem_mb=None):
    """Run a command with a clean env and limits. sandbox=True drops to the runner user."""
    kwargs = {}
    if IS_POSIX:
        ids = _runner_ids() if sandbox else None
        kwargs["preexec_fn"] = _make_preexec(ids, cpu_seconds=timeout + 1, mem_mb=mem_mb)

    # Output goes to temp files (capped by RLIMIT_FSIZE) rather than pipes, so a
    # program printing forever can't fill the server's memory.
    with tempfile.TemporaryFile() as out, tempfile.TemporaryFile() as err:
        try:
            proc = subprocess.Popen(
                cmd, stdin=subprocess.DEVNULL, stdout=out, stderr=err,
                cwd=cwd, env=env or _safe_env(), **kwargs
            )
        except FileNotFoundError as e:
            return {"stdout": "", "stderr": f"Compiler not found: {e}", "exit_code": 1}
        except Exception as e:
            return {"stdout": "", "stderr": str(e), "exit_code": 1}

        try:
            exit_code = proc.wait(timeout=timeout)
        except subprocess.TimeoutExpired:
            _kill(proc)
            proc.wait()
            return {"stdout": _read_capped(out),
                    "stderr": f"Execution timed out ({timeout}s limit).", "exit_code": 1}

        stdout, stderr = _read_capped(out), _read_capped(err)
        if IS_POSIX and exit_code == -signal.SIGXCPU:
            stderr = "Program stopped: it used too much CPU time."
        elif IS_POSIX and exit_code == -signal.SIGXFSZ:
            stderr = "Program stopped: it printed or wrote too much output."
        return {"stdout": stdout, "stderr": stderr, "exit_code": exit_code}


INPUT_NOT_SUPPORTED = (
    "This program asks for keyboard input, which isn't supported here yet.\n"
    "Tip: replace the input with a fixed value to test your logic."
)

SANDBOX_MISSING = {
    "stdout": "",
    "stderr": "Code runner is not configured safely on this server (missing sandbox user).",
    "exit_code": 1,
}


def execute_python(code: str) -> dict:
    python = shutil.which("python3") or shutil.which("python")
    if not python:
        return {"stdout": "", "stderr": "Python not found.", "exit_code": 1}

    with tempfile.TemporaryDirectory() as tmpdir:
        src = os.path.join(tmpdir, "main.py")
        with open(src, "w", encoding="utf-8") as f:
            f.write(code)
        _give_to_runner(tmpdir, _runner_ids())
        result = _run([python, "-I", src], cwd=tmpdir, sandbox=True, mem_mb=512)

    if "EOFError" in result["stderr"]:
        result["stderr"] = INPUT_NOT_SUPPORTED + "\n\n" + result["stderr"]
    return result


def execute_javascript(code: str) -> dict:
    node = shutil.which("node") or shutil.which("nodejs")
    if not node:
        return {"stdout": "", "stderr": "JavaScript (Node.js) is not available in the cloud version. Try Python instead!", "exit_code": 1}

    with tempfile.TemporaryDirectory() as tmpdir:
        src = os.path.join(tmpdir, "main.js")
        with open(src, "w", encoding="utf-8") as f:
            f.write(code)
        _give_to_runner(tmpdir, _runner_ids())
        # No RLIMIT_AS for Node: V8 reserves large virtual memory up front.
        return _run([node, "--max-old-space-size=256", src], cwd=tmpdir, sandbox=True)


def execute_java(code: str) -> dict:
    javac = shutil.which("javac")
    java = shutil.which("java")
    if not javac or not java:
        return {"stdout": "", "stderr": "Java compiler not found on this server. Try Python instead!", "exit_code": 1}

    with tempfile.TemporaryDirectory() as tmpdir:
        # Rename class to Main
        lines = []
        for line in code.split("\n"):
            if "public class" in line and "{" in line:
                before = line[:line.find("public class")]
                after = line[line.find("{"):]
                line = before + "public class Main " + after
            lines.append(line)
        fixed = "\n".join(lines)

        java_file = os.path.join(tmpdir, "Main.java")
        with open(java_file, "w", encoding="utf-8") as f:
            f.write(fixed)

        compile_res = _run([javac, "-J-Xmx256m", java_file], cwd=tmpdir, timeout=15)
        if compile_res["exit_code"] != 0:
            return compile_res

        _give_to_runner(tmpdir, _runner_ids())
        # No RLIMIT_AS for the JVM: it reserves large virtual memory up front.
        result = _run([java, "-Xmx256m", "-XX:-UsePerfData", "-cp", tmpdir, "Main"],
                      cwd=tmpdir, timeout=10, sandbox=True)

        # Detect interactive input (Scanner) — not supported in cloud execution
        if "NoSuchElementException" in result["stderr"] or "NoSuchElementException" in result["stdout"]:
            result["stderr"] = (
                "This program uses Scanner for user input, which is not supported "
                "in the cloud runner.\n"
                "Tip: Remove Scanner and hardcode values to test your logic.\n\n"
                "Example: instead of 'int num = scanner.nextInt();'\n"
                "use: 'int num = 10;'"
            )
            result["exit_code"] = 1

        return result


def execute_cpp(code: str) -> dict:
    gpp = shutil.which("g++")
    if not gpp:
        return {"stdout": "", "stderr": "C++ compiler not found on this server. Try Python instead!", "exit_code": 1}

    with tempfile.TemporaryDirectory() as tmpdir:
        src = os.path.join(tmpdir, "code.cpp")
        exe = os.path.join(tmpdir, "code")
        with open(src, "w", encoding="utf-8") as f:
            f.write(code)
        compile_res = _run([gpp, src, "-o", exe, "-std=c++17"], cwd=tmpdir, timeout=15)
        if compile_res["exit_code"] != 0:
            return compile_res
        _give_to_runner(tmpdir, _runner_ids())
        return _run([exe], cwd=tmpdir, timeout=10, sandbox=True, mem_mb=512)


def execute_go(code: str) -> dict:
    go = shutil.which("go")
    if not go:
        return {"stdout": "", "stderr": "Go compiler not found on this server. Try Python instead!", "exit_code": 1}

    with tempfile.TemporaryDirectory() as tmpdir:
        go_file = os.path.join(tmpdir, "main.go")
        exe_file = os.path.join(tmpdir, "main")

        with open(go_file, "w", encoding="utf-8") as f:
            f.write(code)

        cache = GO_CACHE if IS_POSIX else os.path.join(tmpdir, "gocache")
        env = _safe_env({
            "GOCACHE": cache,
            "GOPATH": os.path.join(tmpdir, "gopath"),
        })

        # Build first, then run (faster than go run on slow CPUs)
        build_res = _run([go, "build", "-o", exe_file, go_file], cwd=tmpdir, env=env, timeout=60)
        if build_res["exit_code"] != 0:
            return build_res

        _give_to_runner(tmpdir, _runner_ids())
        # No RLIMIT_AS for Go: its runtime reserves virtual memory up front.
        return _run([exe_file], cwd=tmpdir, timeout=15, sandbox=True)


def execute_code_local(code: str, language: str) -> dict:
    if _sandbox_missing():
        return SANDBOX_MISSING
    lang = language.lower().strip()
    if lang == "python":
        return execute_python(code)
    elif lang == "javascript":
        return execute_javascript(code)
    elif lang == "java":
        return execute_java(code)
    elif lang in ("c++", "cpp"):
        return execute_cpp(code)
    elif lang == "go":
        return execute_go(code)
    else:
        return {
            "stdout": "",
            "stderr": f"Language '{language}' is not supported for execution.",
            "exit_code": 1
        }


def verify_bundled_compilers() -> dict:
    compilers = ["python3", "python", "javac", "java", "node", "g++", "go"]
    return {c: shutil.which(c) or "not found" for c in compilers}
