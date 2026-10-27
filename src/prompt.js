import { clip } from './util.js'

// Builds a case-insensitive, Unicode-aware "whole word" regex. A trailing * means "any word ending".
const words = list => {
  const alts = list.map(w => w.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\\?\*$/, '\\p{L}*').replace(/ /g, '\\s+'))
  return new RegExp(`(?<![\\p{L}\\p{N}_])(?:${alts.join('|')})(?![\\p{L}\\p{N}_])`, 'iu')
}

// Prefixes you type at the start of a prompt. The text goes to the model; it is short on purpose,
// since every injected line stays in the conversation for the rest of the session.
export const MODES = {
  deep: {
    prefixes: ['+', 'deep:', 'profundo:', 'a fondo:'],
    text: 'Mode DEEP (the leading marker is not part of the request): investigate before editing — read the relevant code paths, state key assumptions, consider edge cases and failure modes; then implement, verify with the strongest available check and note trade-offs briefly.'
  },
  quick: {
    prefixes: ['quick:', 'rapido:', 'rápido:'],
    text: 'Mode QUICK: smallest correct change; open only the files you need; no refactors or extras; answer in at most 5 lines. Still run a fast check if one exists.'
  },
  ask: {
    prefixes: ['ask:', 'pregunta:'],
    text: 'Mode ASK: answer or explain only. Do not edit files or run commands that change state. Back claims about the code with file:line. Be concise.'
  },
  plan: {
    prefixes: ['plan:'],
    text: 'Mode PLAN: do not edit files. Reply with a numbered plan — files to touch and the change in each, risks, how to verify — in at most 15 lines, then wait for approval.'
  }
}

export function parseMode(prompt) {
  const text = String(prompt ?? '').trimStart()
  const lower = text.toLowerCase()
  for (const [mode, { prefixes }] of Object.entries(MODES)) {
    for (const prefix of prefixes) {
      if (!lower.startsWith(prefix)) continue
      // "+1", "++" or a lone "+" are not the deep marker.
      if (prefix === '+' && !/^\+[^\d+\s]|^\+\s+\S/.test(text)) continue
      return { mode, rest: text.slice(prefix.length).trim() }
    }
  }
  return { mode: null, rest: text.trim() }
}

const STRONG_BUG = words(['fix', 'fixes', 'bug', 'bugs', 'crash*', 'broken', 'traceback', 'regression', 'arregl*', 'corrig*', 'corrije', 'no funciona', 'no jala', 'no sirve', 'no carga', 'no compila', 'truena', 'tronó', 'se rompe', 'se rompió', 'se cae', 'roto', 'rota', 'debug*', 'depur*'])
const WEAK_BUG = words(['error*', 'exception', 'fail*', 'falla*', 'fallo', 'falló', 'issue', 'problema'])
const PERF = words(['slow*', 'performance', 'perf', 'optimi*', 'latency', 'memory leak', 'lento', 'lenta', 'rendimiento', 'tarda*', 'pesad*'])
const REFACTOR = words(['refactor*', 'clean up', 'cleanup', 'simplif*', 'reorgani*', 'rename*', 'renombr*', 'limpi*', 'desacopl*', 'extrae', 'extract'])
const TEST = words(['test', 'tests', 'testing', 'unit test*', 'coverage', 'prueba*', 'cobertura', 'testea*'])
const REVIEW = words(['review*', 'audit*', 'revis*', 'audita*'])
const FEATURE = words(['add', 'implement*', 'create', 'build', 'support', 'agreg*', 'añad*', 'crea', 'crear', 'construy*', 'haz que', 'nueva funcionalidad', 'nuevo endpoint', 'feature', 'integra*'])
const DOCS = words(['readme', 'docs', 'documentation', 'document*', 'documenta*', 'changelog'])
// Only words that open a question; "do", "que" or "es" also open requests ("que el botón guarde…").
const QUESTION = words(['what', 'how', 'why', 'where', 'which', 'when', 'who', 'should', 'explain*', 'qué', 'cómo', 'como', 'por qué', 'porqué', 'cuál', 'cual', 'dónde', 'donde', 'cuándo', 'quién', 'explica*', 'se puede', 'debería'])
const EDIT = words(['fix', 'add', 'implement', 'create', 'change', 'update', 'make', 'write', 'remove', 'delete', 'refactor', 'rename', 'move', 'arregl*', 'agreg*', 'añad*', 'implement*', 'crea', 'cambia*', 'actualiz*', 'haz', 'hazlo', 'escrib*', 'quit*', 'elimin*', 'borr*', 'corrig*', 'mejor*', 'mueve', 'renombr*'])

export const PLAYBOOKS = {
  bugfix: 'Bug fix: locate or reproduce the failure first, find the root cause (not the symptom), make the minimal fix, add or update a regression test when the project has tests, report cause → fix → evidence.',
  perf: 'Performance: measure before and after (numbers, not guesses), fix the dominant cost first, keep behavior identical.',
  refactor: 'Refactor: preserve behavior exactly, change in small steps, run the existing tests before and after.',
  test: 'Tests: follow the existing framework and style, test behavior rather than implementation, include edge cases, run them.',
  review: 'Review: concrete issues ordered by severity with file:line and a suggested fix; skip style nits unless asked; do not edit unless asked.',
  feature: 'Feature: find the closest existing pattern and follow it, keep scope to what was asked, handle errors and empty states, verify end to end.',
  docs: 'Docs: accurate to the code, short, with runnable examples.',
  question: 'Question: answer directly first, then the evidence (file:line). Do not modify files unless asked.'
}

export function classify(text) {
  if (text.length < 15) return null // "sí", "dale", "continúa": a follow-up, the context already says what to do
  const head = text.slice(0, 24)
  if ((/[?¿]/.test(text) || QUESTION.test(head) && QUESTION.exec(head).index === 0) && !EDIT.test(text)) return 'question'
  if (STRONG_BUG.test(text)) return 'bugfix'
  if (PERF.test(text)) return 'perf'
  if (REFACTOR.test(text)) return 'refactor'
  if (TEST.test(text)) return 'test'
  if (REVIEW.test(text)) return 'review'
  if (FEATURE.test(text)) return 'feature'
  if (WEAK_BUG.test(text)) return 'bugfix'
  if (DOCS.test(text)) return 'docs'
  return null
}

const GENERATED = /(^|\/)(node_modules|dist|build|out|coverage|vendor|target|\.next|\.nuxt|\.angular|\.turbo|\.cache|obj)\//i
const STOPWORDS = new Set(
  'this that with from have what when where which there their them then than into only also just like make sure please should would could about after before every other some more most file files code line lines para como esta este estos estas todo toda todos hacer cuando donde porque pero sobre entre desde hasta tiene tienen puedes puede quiero necesito ahora mismo bien algo cada solo cual archivo archivos codigo código linea línea pantalla funcion función favor error errores'.split(' ')
)

const stemOf = path => path.slice(path.lastIndexOf('/') + 1).replace(/\..*$/, '')
const keyOf = text => text.toLowerCase().replace(/[-_.\s]/g, '')

// Files the prompt names or points at: paths, stack frames, `identifiers`, CamelCase, snake_case and plain words
// that equal a file or folder name. Saves the agent the search it would otherwise start with.
export function fileHints(prompt, files, { max = 6 } = {}) {
  if (!files.length || !prompt) return []
  const lowerPrompt = prompt.toLowerCase()
  const usable = files.filter(f => !GENERATED.test(f))
  const scores = new Map()
  const bump = (path, score) => scores.set(path, Math.max(scores.get(path) || 0, score))

  // 1. Paths and stack frames: src/app/login.ts, login.ts:42, at foo (webpack:///src/x.js:10:5)
  const pathRe = /(?:[\w.@-]+[\\/])*[\w.@-]+\.(?:[cm]?[jt]sx?|vue|svelte|astro|py|go|rs|java|kt|kts|cs|php|rb|swift|dart|css|scss|less|html|json|ya?ml|toml|md|sql|sh|ps1|xml|gradle|c|cc|cpp|h|hpp)\b/gi
  for (const m of prompt.matchAll(pathRe)) {
    const want = m[0].replace(/\\/g, '/').toLowerCase().replace(/^\.?\//, '')
    for (const file of usable) {
      const lower = file.toLowerCase()
      if (lower === want || lower.endsWith(`/${want}`) || (want.includes('/') && want.endsWith(`/${lower}`))) bump(file, 3)
    }
  }

  // 2. Names: `quoted`, CamelCase, snake/kebab-case and plain words of 4+ letters.
  const terms = new Map()
  for (const m of prompt.matchAll(/`([^`\s]{3,60})`/g)) terms.set(m[1], 'id')
  for (const m of prompt.matchAll(/\b[A-Za-z][a-z0-9]+(?:[A-Z][a-z0-9]*)+\b|\b[a-zA-Z0-9]+(?:[_-][a-zA-Z0-9]+)+\b/g)) terms.set(m[0], 'id')
  for (const m of prompt.matchAll(/\b[a-zA-Z][a-zA-Z0-9]{3,}\b/g)) if (!terms.has(m[0])) terms.set(m[0], 'word')

  const dirs = new Set()
  for (const file of usable) {
    const parts = file.split('/')
    for (let i = 1; i < parts.length; i++) dirs.add(parts.slice(0, i).join('/'))
  }

  for (const [term, kind] of terms) {
    if (STOPWORDS.has(term.toLowerCase())) continue
    const key = keyOf(term.replace(/\.\w+$/, ''))
    if (key.length < 4) continue
    const exact = usable.filter(f => keyOf(stemOf(f)) === key)
    const partial = kind === 'id' && key.length >= 5 ? usable.filter(f => keyOf(stemOf(f)).includes(key) && !exact.includes(f)) : []
    const folders = [...dirs].filter(d => keyOf(d.slice(d.lastIndexOf('/') + 1)) === key)
    if (exact.length && exact.length <= 6) exact.forEach(f => bump(f, 2))
    if (partial.length && partial.length <= 4) partial.forEach(f => bump(f, 1))
    if (folders.length && folders.length <= 3) folders.forEach(d => bump(`${d}/`, 1.5))
  }

  return [...scores]
    .filter(([path]) => !lowerPrompt.includes(path.toLowerCase()))
    .sort((a, b) => b[1] - a[1] || a[0].length - b[0].length)
    .slice(0, max)
    .map(([path]) => path)
}

// What UserPromptSubmit adds for one prompt. `seen` are playbooks already given in this session.
export function boostPrompt(prompt, { files = [], seen = [], hints = true } = {}) {
  const { mode, rest } = parseMode(prompt)
  const parts = []
  if (mode) parts.push(MODES[mode].text)
  const task = mode === 'ask' || mode === 'plan' ? null : classify(rest)
  if (task && !seen.includes(task)) parts.push(PLAYBOOKS[task])
  const found = hints ? fileHints(rest, files) : []
  if (found.length) parts.push(`Likely relevant paths (matched from the prompt, confirm before use): ${found.join(', ')}`)
  const text = parts.length ? clip(`[better-codex] ${parts.join('\n')}`, 1200) : ''
  return { mode, task, hints: found, text }
}
