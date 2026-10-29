import { kindOf } from './infra.js'
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

// The area of a task, on top of its kind: the same bug fix needs different care in a migration or a Helm chart.
// Given once per session, like the playbooks.
export const DOMAINS = {
  db: {
    words: words(['database', 'databases', 'base de datos', 'bases de datos', 'bd', 'sql', 'query', 'queries', 'consulta sql', 'migration*', 'migraci*', 'schema', 'esquema', 'postgres*', 'mysql', 'mariadb', 'sqlite', 'mongo*', 'redis', 'prisma', 'drizzle', 'typeorm', 'sequelize', 'sqlalchemy', 'alembic', 'knex', 'orm', 'indexes', 'índices', 'transaction*', 'transacci*', 'deadlock*']),
    text: 'Database: read the current schema and the existing migrations first. Schema changes go in a new migration made with the project’s tool (never edit one that may have run), reversible and safe on existing data: add nullable or defaulted first, backfill, then constrain; say so before anything that rewrites or locks a big table. New queries: parameterized, an index for what they filter or join on, no N+1. Run against the local or dev database only.'
  },
  infra: {
    words: words(['terraform', 'tofu', 'opentofu', 'pulumi', 'cdk', 'cloudformation', 'bicep', 'ansible', 'aws', 'gcp', 'azure', 'iam', 'vpc', 's3', 'lambda', 'ec2', 'rds', 'cloud run', 'infra', 'infraestructura', 'infrastructure', 'iac']),
    text: 'Infrastructure as code: follow the existing modules, naming and variables; no hard-coded secrets, account ids or regions; least-privilege IAM. Run fmt and validate, then plan if credentials allow, and summarize what it creates, changes or destroys. Never apply, destroy, import or edit state yourself: give the user the command.'
  },
  containers: {
    words: words(['docker*', 'dockerfile', 'compose', 'contenedor*', 'container*', 'kubernetes', 'k8s', 'kubectl', 'helm', 'pod', 'pods', 'ingress', 'kustomize']),
    text: 'Containers and Kubernetes: pin image versions (no :latest), multi-stage builds, install from the lockfile (npm ci, pip install -r with pinned versions), run as non-root, copy only what is needed (.dockerignore). Manifests: resource requests and limits, readiness and liveness probes, config through ConfigMaps and Secrets. Validate (docker build --check, docker compose config, kubectl kustomize, helm lint) and never apply to a shared cluster yourself.'
  },
  cicd: {
    words: words(['ci', 'ci/cd', 'cicd', 'pipeline*', 'github actions', 'workflow', 'workflows', 'gitlab ci', 'gitlab-ci', 'jenkins', 'circleci', 'deploy*', 'despleg*', 'despliegue*']),
    text: 'CI/CD: read the failing log first (`gh run view --log-failed`) and change the smallest step that fixes it. Pin actions to a version or SHA, minimal `permissions:`, cache dependencies, never print secrets. Deploys stay behind the existing approvals: do not trigger one yourself.'
  },
  security: {
    words: words(['security', 'seguridad', 'vulnerab*', 'xss', 'csrf', 'ssrf', 'sql injection', 'inyección sql', 'injection', 'inyección', 'cve', 'owasp', 'jwt', 'oauth', 'auth', 'autenticaci*', 'authentication', 'authorization', 'autorizaci*', 'permis*', 'permission*', 'encrypt*', 'cifra*', 'secret', 'secrets', 'secreto*', 'credencial*']),
    text: 'Security: validate and encode at trust boundaries, parameterized queries, authorization checked on every endpoint (not only authentication), no secrets in code or logs, safe defaults. Say which threat each change closes, and add a test for the attack case when the project has tests.'
  },
  frontend: {
    words: words(['ui', 'ux', 'css', 'tailwind', 'frontend', 'front-end', 'component*', 'componente*', 'layout', 'responsive', 'accesib*', 'accessib*', 'a11y', 'pantalla*', 'botón', 'button', 'modal', 'formulario*', 'estilos', 'styles', 'dark mode', 'modo oscuro']),
    text: 'UI: reuse the existing components, tokens and styles; handle loading, empty and error states; keyboard and screen-reader accessible (labels, focus, contrast); check narrow and wide screens. Verify by building or running it, not only by reading the code.'
  }
}
// Files named in the prompt say the area too: infra/main.tf is infrastructure even if the prompt never says so.
const FILE_DOMAIN = { terraform: 'infra', docker: 'containers', compose: 'containers', helm: 'containers', kubernetes: 'containers', actions: 'cicd', prisma: 'db' }

export function domainOf(text, files = []) {
  for (const file of files) {
    const kind = kindOf(file, '.')
    if (kind && FILE_DOMAIN[kind.id]) return FILE_DOMAIN[kind.id]
    if (/(^|\/)(migrations?|db\/migrate)\/|\.sql$/i.test(file)) return 'db'
  }
  // The area the prompt talks about most; on a tie, the riskier one ("permisos… inyección sql" is security).
  const score = id => (text.match(new RegExp(DOMAINS[id].words.source, 'giu')) || []).length
  const best = TIE_ORDER.map(id => [id, score(id)]).reduce((a, b) => (b[1] > a[1] ? b : a), [null, 0])
  return best[0]
}
const TIE_ORDER = ['security', 'infra', 'containers', 'db', 'cicd', 'frontend']

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
// Code names in a prompt: `quoted`, camelCase, PascalCase and snake_case words, the ones a definition can have.
export function symbolsIn(prompt, max = 4) {
  const names = new Set()
  for (const m of prompt.matchAll(/`([A-Za-z_$][\w$]{2,60})`/g)) names.add(m[1])
  for (const m of prompt.matchAll(/\b[a-z][a-z0-9]*[A-Z][A-Za-z0-9]*\b|\b[A-Z][a-z0-9]+[A-Z][A-Za-z0-9]*\b|\b[a-z][a-z0-9]*_[a-z0-9_]+\b/g)) names.add(m[0])
  return [...names].filter(n => n.length >= 4 && !STOPWORDS.has(n.toLowerCase())).slice(0, max)
}

// Where the names in the prompt are defined (function, class, def, const…), found with one git grep:
// "calcularTotal → src/tax.js:12" spares Codex the search it would start with. Empty when git can't say.
export function symbolHints(prompt, root, { run: exec } = {}) {
  const names = symbolsIn(prompt)
  if (!root || !names.length) return []
  const alt = names.map(n => n.replace(/\$/g, '\\$')).join('|')
  const pattern = `(function|class|def|func|fn|interface|type|enum|struct|trait|module|const|let|var|val)[[:space:]]+(${alt})([^[:alnum:]_]|$)|^[[:space:]]*(export[[:space:]]+)?(async[[:space:]]+)?(${alt})[[:space:]]*[:=][[:space:]]*(async[[:space:]]*)?(function|\\()`
  const out = exec(['grep', '-n', '-I', '--untracked', '-E', '-e', pattern, '--', '.', ':!*node_modules*', ':!*dist/*', ':!*build/*', ':!*.min.js', ':!*.lock'], root) || ''
  const found = []
  for (const line of out.split(/\r?\n/)) {
    const m = /^([^:]+):(\d+):(.*)$/.exec(line)
    if (!m) continue
    const name = names.find(n => new RegExp(`(^|[^\\w$])${n.replace(/\$/g, '\\$')}([^\\w$]|$)`).test(m[3]))
    if (name && found.filter(f => f.name === name).length < 2) found.push({ name, at: `${m[1]}:${m[2]}` })
  }
  return found.slice(0, 6)
}

export function boostPrompt(prompt, { files = [], seen = [], hints = true, symbols = [] } = {}) {
  const { mode, rest } = parseMode(prompt)
  const parts = []
  if (mode) parts.push(MODES[mode].text)
  const task = mode === 'ask' || mode === 'plan' ? null : classify(rest)
  if (task && !seen.includes(task)) parts.push(PLAYBOOKS[task])
  const found = hints ? fileHints(rest, files) : []
  // Questions get answers, not the care a change needs.
  const domain = task && task !== 'question' ? domainOf(rest, found) : null
  if (domain && !seen.includes(domain)) parts.push(DOMAINS[domain].text)
  if (found.length) parts.push(`Likely relevant paths (matched from the prompt, confirm before use): ${found.join(', ')}`)
  if (symbols.length) parts.push(`Defined at (from git grep, confirm before use): ${symbols.map(s => `${s.name} → ${s.at}`).join(' · ')}`)
  const text = parts.length ? clip(`[better-codex] ${parts.join('\n')}`, 1600) : ''
  return { mode, task, domain, hints: found, symbols, text }
}
