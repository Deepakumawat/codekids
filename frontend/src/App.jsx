import { useContext, useMemo, useState } from 'react'
import { ThemeContext } from './context/ThemeContext'
import Landing from './Landing'

const LANGUAGES = [
  {
    id: 'python',
    label: 'Python',
    file: 'main.py',
    starter: 'def greet(name):\n    return f"Hello, {name}"\n\nprint(greet("CodeKids"))',
  },
  {
    id: 'javascript',
    label: 'JavaScript',
    file: 'app.js',
    starter: 'function greet(name) {\n  return `Hello, ${name}`;\n}\n\nconsole.log(greet("CodeKids"));',
  },
  {
    id: 'java',
    label: 'Java',
    file: 'Main.java',
    starter: 'public class Main {\n  public static void main(String[] args) {\n    System.out.println("Hello, CodeKids");\n  }\n}',
  },
  {
    id: 'cpp',
    label: 'C++',
    file: 'main.cpp',
    starter: '#include <iostream>\nusing namespace std;\n\nint main() {\n  cout << "Hello, CodeKids" << endl;\n  return 0;\n}',
  },
  {
    id: 'go',
    label: 'Go',
    file: 'main.go',
    starter: 'package main\n\nimport "fmt"\n\nfunc main() {\n  fmt.Println("Hello, CodeKids")\n}',
  },
]

const MODULES = [
  {
    id: 'code',
    key: 'LAB',
    label: 'Code Lab',
    title: 'Coding Workspace',
    agent: 'Code Mentor',
    description: 'Run code, explain logic, improve structure, and review bugs.',
    primaryAction: 'Run Code',
    secondaryAction: 'Review Code',
    promptLabel: 'Focus',
    promptPlaceholder: 'Ask for a review focus, concept, or expected behavior.',
  },
  {
    id: 'debugger',
    key: 'DBG',
    label: 'Debugger',
    title: 'Guided Debugging',
    agent: 'Debug Coach',
    description: 'Find likely failures, explain root causes, and suggest next steps.',
    primaryAction: 'Debug',
    secondaryAction: 'Explain Error',
    promptLabel: 'Error or symptom',
    promptPlaceholder: 'Paste the error message or describe what is going wrong.',
  },
  {
    id: 'tutor',
    key: 'TUT',
    label: 'Tutor',
    title: 'AI Tutor',
    agent: 'Tutor Agent',
    description: 'Teach concepts with grade-aware explanations and practice steps.',
    primaryAction: 'Teach Concept',
    secondaryAction: 'Generate Practice',
    promptLabel: 'Topic',
    promptPlaceholder: 'Example: loops, functions, arrays, recursion, HTML forms.',
  },
  {
    id: 'summarizer',
    key: 'SUM',
    label: 'Summarizer',
    title: 'Reading Assistant',
    agent: 'Summary Agent',
    description: 'Turn notes, articles, or pasted passages into clean study summaries.',
    primaryAction: 'Summarize',
    secondaryAction: 'Make Study Notes',
    promptLabel: 'Text to summarize',
    promptPlaceholder: 'Paste text, notes, or a rough draft here.',
  },
  {
    id: 'classroom',
    key: 'CLS',
    label: 'Classroom',
    title: 'Teacher Studio',
    agent: 'Lesson Planner',
    description: 'Generate lessons, worksheets, rubrics, assessments, and teaching plans.',
    primaryAction: 'Create Lesson',
    secondaryAction: 'Create Worksheet',
    promptLabel: 'Lesson request',
    promptPlaceholder: 'Example: Grade 6 fractions lesson with warmup, activity, and exit ticket.',
  },
  {
    id: 'quiz',
    key: 'QZ',
    label: 'Quiz',
    title: 'Assessment Builder',
    agent: 'Quiz Agent',
    description: 'Create quizzes, MCQs, short-answer checks, and answer keys.',
    primaryAction: 'Generate Quiz',
    secondaryAction: 'Generate Rubric',
    promptLabel: 'Assessment topic',
    promptPlaceholder: 'Example: 10 MCQs for Python loops, grade 7, medium difficulty.',
  },
]

const AGENT_ACTIONS = [
  { id: 'explain', label: 'Explain', endpoint: '/api/explain' },
  { id: 'debug', label: 'Debug', endpoint: '/api/debug' },
  { id: 'improve', label: 'Improve', endpoint: '/api/improve' },
  { id: 'hint', label: 'Hint', endpoint: '/api/hint' },
]

const SAMPLE_ACTIVITY = [
  'workspace booted',
  'agent router ready',
  'local compiler bridge attached',
  'project modules indexed',
]

async function postJson(endpoint, payload) {
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })

  const data = await response.json().catch(() => ({}))
  if (!response.ok) {
    throw new Error(data.detail || data.error || `Request failed: ${response.status}`)
  }
  return data
}

function toDisplayText(data) {
  if (!data) return ''
  if (typeof data === 'string') return data
  if (data.stdout || data.stderr) {
    return [
      data.stdout ? `STDOUT\n${data.stdout}` : '',
      data.stderr ? `STDERR\n${data.stderr}` : '',
      typeof data.exit_code !== 'undefined' ? `EXIT CODE\n${data.exit_code}` : '',
    ].filter(Boolean).join('\n\n')
  }
  if (data.response) return data.response
  if (data.explanation) return data.explanation
  if (data.message) return data.message
  if (data.problem) return formatProblem(data.problem)
  if (data.problem_identified || data.hint || data.next_step) {
    return [
      data.problem_identified ? `Problem\n${data.problem_identified}` : '',
      data.guiding_questions?.length ? `Guiding questions\n${data.guiding_questions.map((q) => `- ${q}`).join('\n')}` : '',
      data.hint ? `Hint\n${data.hint}` : '',
      data.next_step ? `Next step\n${data.next_step}` : '',
    ].filter(Boolean).join('\n\n')
  }
  if (data.results) {
    return data.results.map((item) => `${item.topic}\n${item.definition}`).join('\n\n')
  }
  return JSON.stringify(data, null, 2)
}

function formatProblem(problem) {
  return [
    problem.title ? `Title\n${problem.title}` : '',
    problem.description ? `Description\n${problem.description}` : '',
    problem.learning_objective ? `Learning objective\n${problem.learning_objective}` : '',
    problem.hints?.length ? `Hints\n${problem.hints.map((hint) => `- ${hint}`).join('\n')}` : '',
    problem.expected_output ? `Expected output\n${problem.expected_output}` : '',
    problem.starter_code ? `Starter code\n${problem.starter_code}` : '',
  ].filter(Boolean).join('\n\n')
}

function splitLines(text) {
  return text.split('\n')
}

function StatusPill({ tone = 'neutral', children }) {
  return <span className={`status-pill status-pill-${tone}`}>{children}</span>
}

function ModuleButton({ module, active, onClick }) {
  return (
    <button className={`module-button ${active ? 'active' : ''}`} onClick={onClick} type="button">
      <span className="module-key">{module.key}</span>
      <span className="module-copy">
        <span>{module.label}</span>
        <small>{module.agent}</small>
      </span>
    </button>
  )
}

function CommandPalette({ modules, query, onQuery, onSelect, onClose }) {
  const filtered = modules.filter((module) => {
    const haystack = `${module.label} ${module.agent} ${module.description}`.toLowerCase()
    return haystack.includes(query.toLowerCase())
  })

  return (
    <div className="command-backdrop" onMouseDown={onClose}>
      <div className="command-palette" onMouseDown={(event) => event.stopPropagation()}>
        <div className="command-input-row">
          <span>cmd</span>
          <input
            autoFocus
            value={query}
            onChange={(event) => onQuery(event.target.value)}
            placeholder="Search modules, agents, and workflows"
          />
          <button type="button" onClick={onClose}>Esc</button>
        </div>
        <div className="command-list">
          {filtered.map((module) => (
            <button key={module.id} type="button" onClick={() => onSelect(module.id)}>
              <span className="module-key">{module.key}</span>
              <span>
                <strong>{module.label}</strong>
                <small>{module.description}</small>
              </span>
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}

export default function App() {
  const { theme, toggleTheme } = useContext(ThemeContext)
  const [entered, setEntered] = useState(() => !!localStorage.getItem('codekids_seen_landing'))
  const [activeModule, setActiveModule] = useState('code')
  const [languageId, setLanguageId] = useState('python')
  const [grade, setGrade] = useState('6')
  const [code, setCode] = useState(LANGUAGES[0].starter)
  const [prompt, setPrompt] = useState('')
  const [result, setResult] = useState('Ready. Select a module, write or paste content, then run an action.')
  const [isBusy, setIsBusy] = useState(false)
  const [activeOutput, setActiveOutput] = useState('result')
  const [commandOpen, setCommandOpen] = useState(false)
  const [commandQuery, setCommandQuery] = useState('')
  const [activity, setActivity] = useState(SAMPLE_ACTIVITY)

  const language = useMemo(
    () => LANGUAGES.find((item) => item.id === languageId) || LANGUAGES[0],
    [languageId],
  )

  const module = useMemo(
    () => MODULES.find((item) => item.id === activeModule) || MODULES[0],
    [activeModule],
  )

  const lineNumbers = useMemo(
    () => splitLines(code).map((_, index) => index + 1).join('\n'),
    [code],
  )

  const addActivity = (message) => {
    const stamp = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    setActivity((items) => [`${stamp} ${message}`, ...items].slice(0, 12))
  }

  const changeLanguage = (nextLanguageId) => {
    const next = LANGUAGES.find((item) => item.id === nextLanguageId)
    setLanguageId(nextLanguageId)
    if (next) setCode(next.starter)
    addActivity(`language switched to ${next?.label || nextLanguageId}`)
  }

  const selectModule = (moduleId) => {
    setActiveModule(moduleId)
    setCommandOpen(false)
    setCommandQuery('')
    addActivity(`module opened: ${MODULES.find((item) => item.id === moduleId)?.label || moduleId}`)
  }

  const runCode = async () => {
    setIsBusy(true)
    setActiveOutput('result')
    setResult('Running code...')
    addActivity('run started')
    try {
      const data = await postJson('/api/run', { code, language: language.id })
      setResult(toDisplayText(data))
      addActivity(data.exit_code === 0 ? 'run completed' : 'run returned diagnostics')
    } catch (error) {
      setResult(`Error\n${error.message}`)
      addActivity('run failed')
    } finally {
      setIsBusy(false)
    }
  }

  const runAgent = async (action) => {
    setIsBusy(true)
    setActiveOutput('result')
    setResult(`${module.agent} is working...`)
    addActivity(`${module.agent.toLowerCase()} action: ${action}`)

    try {
      let endpoint = '/api/workspace/agent'
      let payload = {
        module: module.id,
        action,
        prompt,
        code,
        language: language.label,
        grade_level: grade,
      }

      if (module.id === 'code' && AGENT_ACTIONS.some((item) => item.id === action)) {
        endpoint = AGENT_ACTIONS.find((item) => item.id === action).endpoint
        payload = {
          code,
          language: language.label,
          grade_level: grade,
          question: prompt,
          error: prompt,
        }
      }

      const data = await postJson(endpoint, payload)
      setResult(toDisplayText(data))
      addActivity(`${module.agent.toLowerCase()} completed`)
    } catch (error) {
      setResult(`Error\n${error.message}`)
      addActivity(`${module.agent.toLowerCase()} failed`)
    } finally {
      setIsBusy(false)
    }
  }

  const primaryAction = () => {
    if (module.id === 'code') return runCode()
    if (module.id === 'debugger') return runAgent('debug')
    if (module.id === 'tutor') return runAgent('teach')
    if (module.id === 'summarizer') return runAgent('summarize')
    if (module.id === 'classroom') return runAgent('lesson')
    if (module.id === 'quiz') return runAgent('quiz')
    return runAgent('assist')
  }

  const secondaryAction = () => {
    if (module.id === 'code') return runAgent('improve')
    if (module.id === 'debugger') return runAgent('explain-error')
    if (module.id === 'tutor') return runAgent('practice')
    if (module.id === 'summarizer') return runAgent('notes')
    if (module.id === 'classroom') return runAgent('worksheet')
    if (module.id === 'quiz') return runAgent('rubric')
    return runAgent('review')
  }

  if (!entered) {
    return <Landing onEnter={() => { localStorage.setItem('codekids_seen_landing', '1'); setEntered(true) }} />
  }

  return (
    <div className="workspace-shell">
      <aside className="product-rail">
        <div className="brand-mark">
          <span>CK</span>
        </div>
        <nav className="rail-nav" aria-label="Workspace modules">
          {MODULES.map((item) => (
            <button
              key={item.id}
              type="button"
              className={item.id === activeModule ? 'active' : ''}
              onClick={() => selectModule(item.id)}
              title={item.label}
            >
              {item.key}
            </button>
          ))}
        </nav>
        <button className="rail-theme" type="button" onClick={toggleTheme}>
          {theme === 'dark' ? 'LT' : 'DK'}
        </button>
      </aside>

      <aside className="module-sidebar">
        <div className="sidebar-header">
          <strong>CodeKids OS</strong>
          <StatusPill tone="live">AI Hub</StatusPill>
        </div>

        <button className="command-trigger" type="button" onClick={() => setCommandOpen(true)}>
          <span>Search workspace</span>
          <kbd>Ctrl K</kbd>
        </button>

        <div className="module-list">
          {MODULES.map((item) => (
            <ModuleButton
              key={item.id}
              module={item}
              active={item.id === activeModule}
              onClick={() => selectModule(item.id)}
            />
          ))}
        </div>

        <div className="sidebar-section">
          <div className="section-title">Runtime</div>
          <div className="runtime-card">
            <div>
              <small>Language</small>
              <select value={languageId} onChange={(event) => changeLanguage(event.target.value)}>
                {LANGUAGES.map((item) => (
                  <option key={item.id} value={item.id}>{item.label}</option>
                ))}
              </select>
            </div>
            <div>
              <small>Grade</small>
              <select value={grade} onChange={(event) => setGrade(event.target.value)}>
                {['K', '1', '2', '3', '4', '5', '6', '7', '8', '9', '10', '11', '12'].map((item) => (
                  <option key={item} value={item}>{item}</option>
                ))}
              </select>
            </div>
          </div>
        </div>
      </aside>

      <main className="workspace-main">
        <header className="topbar">
          <div>
            <div className="eyebrow">{module.agent}</div>
            <h1>{module.title}</h1>
          </div>
          <div className="topbar-actions">
            <StatusPill tone="neutral">{language.file}</StatusPill>
            <StatusPill tone={isBusy ? 'busy' : 'live'}>{isBusy ? 'Working' : 'Ready'}</StatusPill>
          </div>
        </header>

        <section className="workspace-grid">
          <div className="editor-pane">
            <div className="pane-header">
              <div>
                <strong>{language.file}</strong>
                <small>{module.description}</small>
              </div>
              <div className="pane-actions">
                <button type="button" className="ghost-button" onClick={() => setCode(language.starter)}>Reset</button>
                <button type="button" onClick={runCode} disabled={isBusy}>Run</button>
              </div>
            </div>
            <div className="code-editor">
              <pre className="line-numbers">{lineNumbers}</pre>
              <textarea
                spellCheck="false"
                value={code}
                onChange={(event) => setCode(event.target.value)}
                aria-label="Code editor"
              />
            </div>
          </div>

          <aside className="agent-pane">
            <div className="agent-card">
              <div className="agent-card-header">
                <span className="module-key large">{module.key}</span>
                <div>
                  <strong>{module.agent}</strong>
                  <small>{module.description}</small>
                </div>
              </div>

              <label className="field-label" htmlFor="agent-prompt">{module.promptLabel}</label>
              <textarea
                id="agent-prompt"
                className="prompt-box"
                value={prompt}
                onChange={(event) => setPrompt(event.target.value)}
                placeholder={module.promptPlaceholder}
              />

              <div className="agent-actions">
                <button type="button" onClick={primaryAction} disabled={isBusy}>{module.primaryAction}</button>
                <button type="button" className="secondary-button" onClick={secondaryAction} disabled={isBusy}>
                  {module.secondaryAction}
                </button>
              </div>

              <div className="quick-actions">
                {AGENT_ACTIONS.map((item) => (
                  <button key={item.id} type="button" onClick={() => runAgent(item.id)} disabled={isBusy}>
                    {item.label}
                  </button>
                ))}
              </div>
            </div>

            <div className="agent-card compact">
              <div className="section-title">Project Map</div>
              <div className="project-map">
                <div><span>ai-summarizer</span><StatusPill>module</StatusPill></div>
                <div><span>ai-tutor</span><StatusPill>module</StatusPill></div>
                <div><span>ClassroomAI</span><StatusPill>module</StatusPill></div>
                <div><span>Code Debugger</span><StatusPill>module</StatusPill></div>
                <div><span>CodeKids</span><StatusPill tone="live">base</StatusPill></div>
              </div>
            </div>
          </aside>
        </section>

        <section className="bottom-panel">
          <div className="bottom-tabs">
            <button type="button" className={activeOutput === 'result' ? 'active' : ''} onClick={() => setActiveOutput('result')}>
              Result
            </button>
            <button type="button" className={activeOutput === 'activity' ? 'active' : ''} onClick={() => setActiveOutput('activity')}>
              Activity
            </button>
          </div>
          <div className="output-surface">
            {activeOutput === 'result' ? (
              <pre>{result}</pre>
            ) : (
              <div className="activity-feed">
                {activity.map((item, index) => (
                  <div key={`${item}-${index}`}>
                    <span>{String(index + 1).padStart(2, '0')}</span>
                    <code>{item}</code>
                  </div>
                ))}
              </div>
            )}
          </div>
        </section>
      </main>

      {commandOpen && (
        <CommandPalette
          modules={MODULES}
          query={commandQuery}
          onQuery={setCommandQuery}
          onSelect={selectModule}
          onClose={() => setCommandOpen(false)}
        />
      )}
    </div>
  )
}
