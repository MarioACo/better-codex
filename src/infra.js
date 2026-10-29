import { existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { onPath, readText, toPosix } from './util.js'

// Infrastructure and database tooling, found from file names: the repo brief tells Codex what is there
// and how to check it, and the verify gate asks for that check when Codex changed one of these files.
// A check is only offered when its tool is installed: one Codex cannot run would just cost a request.

const dirOf = file => toPosix(dirname(file))
const first = list => list[0]
// The folder holding a Helm chart (Chart.yaml) for a file inside it, up to four levels up.
function chartOf(file, root) {
  for (let dir = dirOf(file), i = 0; i < 5; dir = dirOf(dir), i++) {
    if (existsSync(join(root, dir, 'Chart.yaml'))) return dir
    if (dir === '.' || dir === '/' || !dir) break
  }
  return null
}

// id · what the brief calls it · files that belong to it · the check for the changed ones (null: not
// installed) · commands that count as that check · how the check says it failed.
export const KINDS = [
  {
    id: 'docker',
    label: 'Dockerfile',
    match: /(^|\/)(Dockerfile|Containerfile)(\.[\w.-]+)?$|\.dockerfile$/i,
    check: files => (onPath('hadolint') ? `hadolint ${first(files)}` : onPath('docker') ? `docker build --check -f ${first(files)} .` : null),
    ran: /\bhadolint\b|\bdocker\s+(buildx\s+)?build\b/i,
    failed: /^ERROR: |^\s*=> ERROR|\bDL\d{4} error\b|^Check complete, [1-9]\d* warnings? have been found/m
  },
  {
    id: 'compose',
    label: 'Compose',
    match: /(^|\/)(docker-)?compose(\.[\w-]+)?\.ya?ml$/i,
    check: files => (onPath('docker') ? `docker compose -f ${first(files)} config -q` : null),
    ran: /\bdocker(-compose|\s+compose)\b[\s\S]*\bconfig\b/i,
    failed: /^(error|validating|service ".+" (refers|depends)) |yaml: line \d+|is invalid:/im
  },
  {
    id: 'terraform',
    label: 'Terraform',
    match: /\.tf$/i,
    check: files => {
      const tf = onPath('terraform') ? 'terraform' : onPath('tofu') ? 'tofu' : null
      const dir = dirOf(first(files))
      return tf && `${tf} fmt -check -recursive && ${tf}${dir === '.' ? '' : ` -chdir=${dir}`} validate`
    },
    ran: /\b(terraform|tofu)\b[\s\S]*\b(validate|plan)\b/i,
    failed: /^\s*│?\s*Error: /m
  },
  {
    id: 'helm',
    label: 'Helm',
    match: /(^|\/)(Chart\.ya?ml|values[\w.-]*\.ya?ml|templates\/[^/]+\.(ya?ml|tpl))$/i,
    inChart: true,
    check: (files, root) => {
      const chart = files.map(f => chartOf(f, root)).find(Boolean)
      return chart && onPath('helm') ? `helm lint ${chart}` : null
    },
    ran: /\bhelm\s+(lint|template)\b/i,
    failed: /\[ERROR\]|^Error: /m
  },
  {
    id: 'kubernetes',
    label: 'Kubernetes',
    match: /(^|\/)(k8s|kubernetes|manifests|kustomize|overlays)\/.*\.ya?ml$|(^|\/)kustomization\.ya?ml$/i,
    check: (files, root) => {
      const dir = dirOf(first(files))
      if (existsSync(join(root, dir, 'kustomization.yaml')) || existsSync(join(root, dir, 'kustomization.yml'))) return onPath('kubectl') ? `kubectl kustomize ${dir}` : null
      return onPath('kubeconform') ? `kubeconform -summary ${dir}` : null
    },
    ran: /\bkubeconform\b|\bkubeval\b|\bkubectl\s+(kustomize|diff|apply\b[\s\S]*--dry-run)\b|\bkustomize\s+build\b/i,
    failed: /^error: |\bis invalid\b|\bfailed validation\b|^\S+ - \S+ is invalid/mi
  },
  {
    id: 'actions',
    label: 'GitHub Actions',
    match: /^\.github\/workflows\/[^/]+\.ya?ml$/i,
    check: () => (onPath('actionlint') ? 'actionlint' : null),
    ran: /\bactionlint\b/i,
    failed: /^\S+\.ya?ml:\d+:\d+: /m
  },
  {
    id: 'prisma',
    label: 'Prisma',
    match: /(^|\/)[\w.-]*\.prisma$/i,
    check: files => `npx prisma validate${first(files) === 'prisma/schema.prisma' ? '' : ` --schema ${first(files)}`}`,
    ran: /\bprisma\s+(validate|format|migrate|generate|db)\b/i,
    failed: /^Error: |error: |Prisma schema validation/m
  }
]

export const kindOf = (file, root) => KINDS.find(k => k.match.test(toPosix(file)) && (!k.inChart || chartOf(toPosix(file), root)))

// Migrations: where they live, by tool. Shown in the brief so Codex creates new ones instead of editing applied ones.
const MIGRATIONS = [
  ['Prisma', /(^|\/)prisma\/migrations\/[^/]+\/migration\.sql$/],
  ['Drizzle', /(^|\/)drizzle\/(\d{4}_[^/]+\.sql|meta\/_journal\.json)$/],
  ['Alembic', /(^|\/)(alembic|migrations)\/versions\/[^/]+\.py$/],
  ['Django', /(^|\/)migrations\/\d{4}_[^/]+\.py$/],
  ['Rails', /(^|\/)db\/migrate\/\d+_[^/]+\.rb$/],
  ['Laravel', /(^|\/)database\/migrations\/[^/]+\.php$/],
  ['Flyway', /(^|\/)V\d+(_\d+)*__[^/]+\.sql$/],
  ['Supabase', /(^|\/)supabase\/migrations\/[^/]+\.sql$/],
  ['EF Core', /(^|\/)Migrations\/\d{14}_[^/]+\.cs$/],
  ['Knex/TypeORM/Sequelize', /(^|\/)(migrations?|db\/migrations?)\/\d{3,}[-_][^/]+\.(js|ts|cjs|mjs)$/],
  ['SQL', /(^|\/)(migrations?|db\/migrations?)\/[^/]+\.sql$/]
]
// Services a compose file starts that Codex may need to know about (local databases, queues, storage).
const SERVICES = /^(postgres|postgis\/postgis|mysql|mariadb|mongo|redis|valkey\/valkey|elasticsearch|opensearchproject\/opensearch|rabbitmq|confluentinc\/cp-kafka|bitnami\/kafka|minio\/minio|localstack\/localstack|mcr\.microsoft\.com\/mssql\/server|clickhouse\/clickhouse-server)$/

const dirsOf = files => [...new Set(files.map(dirOf))]
const shown = list => `${list.slice(0, 2).join(', ')}${list.length > 2 ? ', …' : ''}`

// The brief's infra and db lines, and the checks Codex can run here: [] when the repo has none of it.
export function infraLines(root, files) {
  const by = new Map()
  for (const file of files) {
    const kind = KINDS.find(k => k.match.test(file) && (!k.inChart || /(^|\/)Chart\.ya?ml$/i.test(file)))
    if (kind) by.set(kind, [...(by.get(kind) || []), file])
  }
  const parts = []
  const checks = []
  for (const [kind, list] of by) {
    if (kind.id === 'compose') {
      const images = [...readText(join(root, list[0]), '').matchAll(/^\s+image:\s*["']?([\w./-]+?)(?::[\w.-]+)?["']?\s*$/gm)].map(m => m[1].replace(/^docker\.io\/(library\/)?/, ''))
      const services = [...new Set(images.filter(i => SERVICES.test(i)).map(i => i.split('/').pop()))]
      parts.push(`Compose${services.length ? ` (${services.join(', ')})` : ''}`)
    } else if (kind.id === 'terraform' || kind.id === 'kubernetes') parts.push(`${kind.label} (${shown(dirsOf(list).map(d => (d === '.' ? 'root' : `${d}/`)))})`)
    else if (kind.id === 'helm') parts.push(`Helm (${shown(dirsOf(list))})`)
    else if (kind.id === 'prisma') continue
    else parts.push(list.length > 1 ? `${kind.label} (${list.length})` : kind.label)
    const check = kind.check(list, root)
    if (check) checks.push(check)
  }
  const db = []
  const prisma = by.get(KINDS.find(k => k.id === 'prisma'))
  if (prisma) {
    db.push('Prisma')
    checks.push(KINDS.find(k => k.id === 'prisma').check(prisma, root))
  }
  for (const [label, re] of MIGRATIONS) {
    const found = files.filter(f => re.test(f))
    if (!found.length) continue
    const where = shown(dirsOf(found).map(d => d.replace(/\/[^/]*\d{8,}[^/]*$/, '')).filter((d, i, all) => all.indexOf(d) === i))
    if (label === 'Prisma') db[db.indexOf('Prisma')] = `Prisma (${found.length} migration${found.length === 1 ? '' : 's'} in ${where})`
    else db.push(`${label} migrations (${found.length} in ${where})`)
    break
  }
  const lines = []
  if (parts.length) lines.push(`- infra: ${parts.join(' · ')}`)
  if (db.length) lines.push(`- db: ${db.join(' · ')}. Add a new migration for schema changes; never edit one that may have run.`)
  if (checks.length) lines.push(`- infra checks: ${[...new Set(checks)].map(c => `\`${c}\``).join(' · ')}. Never apply, deploy or migrate a real environment without asking.`)
  return lines
}
