import { existsSync, realpathSync, statSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { basename, dirname, isAbsolute, join, relative, resolve } from 'node:path'
import { expand, shellAliases, snapshotFile, tilde } from './aliases.js'
import { allowedFor, allowFile } from './allow.js'
import { configPath } from './config.js'
import { gitRoot } from './git.js'
import { KINDS } from './infra.js'
import { codexHome } from './paths.js'
import { enclosed, pathArgs, patchFiles, segments, shellWrites, toolCommands, verbOf } from './shell.js'
import { clip, readJson, readText, run, toPosix } from './util.js'
import { VERIFY, withoutExt } from './verify.js'

// What each rule protects, in the words shown to you (es/en) and to the model (en).
export const RULES = {
  delete: {
    title: { es: 'Borrar archivos o carpetas', en: 'Delete files or folders' },
    risk: {
      es: 'lo que se borra fuera de git (sin commit, sin seguimiento o fuera del repo) no se puede recuperar',
      en: 'anything deleted outside git (uncommitted, untracked or outside the repo) cannot be recovered'
    },
    safer: 'move it to a backup folder or commit first, and delete only the exact paths needed'
  },
  'git-discard': {
    title: { es: 'Descartar cambios sin commit', en: 'Discard uncommitted changes' },
    risk: {
      es: 'los cambios que no están en un commit se pierden para siempre, también los tuyos y no solo los de Codex',
      en: 'changes that are not committed are lost for good, including the user’s own work'
    },
    safer: 'run `git stash push -u -m "backup"` first, or commit to a temporary branch'
  },
  'git-history': {
    title: { es: 'Reescribir o borrar historial de git', en: 'Rewrite or delete git history' },
    risk: {
      es: 'puede borrar commits (también de otras personas en el remoto) y no siempre se puede deshacer',
      en: 'it can drop commits, including other people’s on the remote, and may not be undoable'
    },
    safer: 'use `--force-with-lease` on a personal branch (never on main), or create a backup branch first'
  },
  'git-secrets': {
    title: { es: 'Agregar secretos a git', en: 'Add secrets to git' },
    risk: {
      es: 'un .env o una llave en un commit queda en el historial aunque luego se borre; si se sube, hay que rotar credenciales',
      en: 'a .env or key in a commit stays in history even if deleted later; once pushed, credentials must be rotated'
    },
    safer: 'add the file to .gitignore and stage only the files that belong in the commit'
  },
  'secrets-read': {
    title: { es: 'Leer secretos (.env, llaves, credenciales)', en: 'Read secrets (.env, keys, credentials)' },
    risk: {
      es: 'su contenido entra en la conversación y se envía al modelo',
      en: 'their contents enter the conversation and are sent to the model'
    },
    safer: 'read only the variable names (not values) or ask the user for the one value needed'
  },
  'secrets-write': {
    title: { es: 'Sobrescribir secretos o credenciales', en: 'Overwrite secrets or credentials' },
    risk: {
      es: 'llaves y configuración local que no están en git se pierden',
      en: 'keys and local configuration that are not in git get lost'
    },
    safer: 'back up the file first and change only the specific entry'
  },
  database: {
    title: { es: 'Operación destructiva en una base de datos', en: 'Destructive database operation' },
    risk: {
      es: 'borra o modifica datos de forma masiva; sin respaldo no hay vuelta atrás, y en producción afecta a usuarios reales',
      en: 'it deletes or rewrites data in bulk; without a backup there is no undo, and in production it hits real users'
    },
    safer: 'confirm it targets a local/dev database, take a dump first, and use a WHERE clause inside a transaction'
  },
  infra: {
    title: { es: 'Deploy, destruir infraestructura o publicar', en: 'Deploy, destroy infrastructure or publish' },
    risk: {
      es: 'afecta servicios reales o publica algo que no se puede despublicar',
      en: 'it affects live services or publishes something that cannot be unpublished'
    },
    safer: 'do a dry run / plan first and let the user run the final step'
  },
  system: {
    title: { es: 'Cambio peligroso en el sistema', en: 'Dangerous system change' },
    risk: {
      es: 'puede dañar el equipo, los permisos o datos fuera del proyecto',
      en: 'it can damage the machine, permissions or data outside the project'
    },
    safer: 'explain the manual step and let the user run it'
  },
  'remote-exec': {
    title: { es: 'Ejecutar un script descargado de internet', en: 'Run a script downloaded from the internet' },
    risk: {
      es: 'corre código que nadie revisó, con tus permisos',
      en: 'it runs unreviewed code with the user’s permissions'
    },
    safer: 'download it to a file, show what it does, and run it only after review'
  },
  hidden: {
    title: { es: 'Ejecutar un comando escondido o que se arma al correr', en: 'Run a command that is hidden or built at runtime' },
    risk: {
      es: 'no se ve qué hace hasta que corre: puede borrar o cambiar cualquier cosa',
      en: 'what it does cannot be seen until it runs, so it could delete or change anything'
    },
    safer: 'run the final command itself, written out in full, so it can be checked'
  },
  kill: {
    title: { es: 'Cerrar programas por nombre', en: 'Kill processes by name' },
    risk: {
      es: 'cierra todas las instancias de ese programa, también las tuyas (navegador, editor, servidores), y se pierde lo que no estaba guardado',
      en: 'it ends every instance of that program, the user’s own included (browser, editor, servers), losing unsaved work'
    },
    safer: 'stop only the process you started, by its PID'
  },
  'global-config': {
    title: { es: 'Cambiar tu configuración global', en: 'Change global configuration' },
    risk: {
      es: 'afecta a todos tus proyectos y herramientas, no solo a este (por ejemplo tu identidad de git o tu registro de npm)',
      en: 'it affects every project and tool of the user, not just this one (e.g. their git identity or npm registry)'
    },
    safer: 'apply it to this repository only (git config without --global, a project .npmrc)'
  },
  'bcx-settings': {
    title: { es: 'Cambiar los permisos de better-codex', en: 'Change better-codex’s own settings' },
    risk: {
      es: 'Codex podría darse permiso a sí mismo o apagar la protección',
      en: 'Codex could grant itself permission or switch the protection off'
    },
    safer: 'give the user the exact bcx command and let them run it'
  },
  strict: {
    title: { es: 'Comando fuera de la lista segura (modo estricto)', en: 'Command outside the safe list (strict mode)' },
    risk: {
      es: 'en modo estricto solo pasan sin preguntar los comandos de solo lectura, las pruebas y los builds conocidos',
      en: 'in strict mode only known read-only commands, tests and builds run without asking'
    },
    safer: 'use a read-only command or a known check if that is enough; otherwise ask'
  }
}

const SECRET = /(^|[\\/])(\.env(\.(?!example\b|sample\b|template\b|dist\b|defaults?\b)[\w.-]+)?|\.npmrc|\.pypirc|\.netrc|\.git-credentials|id_(rsa|dsa|ecdsa|ed25519)|[\w.-]*\.(pem|key|p12|pfx|keystore|jks|ppk)|credentials(\.(json|ya?ml|toml|xml|csv))?|[\w.-]*service[-_]?account[\w.-]*\.json|auth\.json|secrets?\.(json|ya?ml|toml)|[\w.-]*\.tfstate(\.backup)?|[\w.-]*\.tfvars(\.json)?|\.kube[\\/]config|kubeconfig(\.ya?ml)?|[\w.-]*\.kubeconfig|\.pgpass|\.my\.cnf|\.vault-token|\.docker[\\/]config\.json)$/i
export const isSecretPath = path => SECRET.test(String(path).replace(/["']/g, ''))

// Folders and files that only an install, a build or a tool writes: deleting them loses nothing.
// .git/refs/codex/ holds Codex's own turn-diff snapshots.
const GENERATED = /(^|[\\/])(node_modules|coverage|\.next|\.nuxt|\.svelte-kit|\.angular|\.turbo|\.cache|\.parcel-cache|__pycache__|\.pytest_cache|\.mypy_cache|\.ruff_cache|\.gradle|\.expo|DerivedData|[^\\/]*\.(log|tmp|pyc|tsbuildinfo)|\.DS_Store)[\\/]?$|(^|[\\/])\.git[\\/]refs[\\/]codex([\\/]|$)/i
export const isGenerated = path => GENERATED.test(path)
// Usual names for build output and scratch space, which people also use for their own files
// (tmp/meeting-notes.md): fine to delete only when git shows nothing of yours inside (ctx.disposable).
const SCRATCH =/(^|[\\/])(dist|build|out|target|obj|tmp|temp|\.tmp)[\\/]?$/i
const EVERYTHING = /^(\/|[a-z]:[\\/]?|~[\\/]?|\$home[\\/]?|\$env:userprofile[\\/]?|%userprofile%[\\/]?|\*|\.[\\/]?\*?|\.\.[\\/]?\*?|\.git[\\/]?)$/i

const DELETE_VERBS = new Set(['rm', 'del', 'erase', 'rd', 'rmdir', 'remove-item', 'ri', 'unlink', 'shred', 'rimraf', 'trash'])
const READ_VERBS = new Set(['cat', 'type', 'bat', 'less', 'more', 'head', 'tail', 'nl', 'get-content', 'gc', 'rg', 'grep', 'select-string', 'sls', 'findstr', 'awk', 'sed', 'strings', 'base64', 'certutil', 'jq', 'yq'])
const COPY_VERBS = new Set(['cp', 'copy', 'copy-item', 'cpi', 'mv', 'move', 'move-item', 'mi', 'ren', 'rename-item'])
const DB_CLIENT = /^(psql|mysql|mariadb|sqlite3|sqlcmd|invoke-sqlcmd|mongosh|mongo|redis-cli|cqlsh|clickhouse-client|duckdb|supabase|prisma|rails|rake|bin\/rails|php|python3?|py|sequelize|typeorm|knex|drizzle-kit|dropdb|flyway|liquibase|alembic|npx|pnpm|yarn|bunx|bun|dotnet)$/
const DESTRUCTIVE_SQL = [
  /\bdrop\s+(table|database|schema|view|collection|keyspace)\b/i,
  /\btruncate\s+(table\s+)?[\w"`[]/i,
  /\bdelete\s+from\s+[^\s;]+\s*(;|$|["'`])/i,
  /\bupdate\s+[^\s;]+\s+set\b(?![\s\S]*\bwhere\b)/i,
  /\balter\s+table\b[\s\S]*\bdrop\b/i,
  /dropDatabase|\.drop\(\s*\)|deleteMany\(\s*\{\s*\}\s*\)|\bflushall\b|\bflushdb\b/i
]
// Recursive deletes from code: what a script or `node -e` would use instead of rm -rf.
const DANGEROUS_CODE = /\bshutil\.rmtree\s*\(|\.rm(?:Sync)?\s*\([^)]*recursive|\.rmdir(?:Sync)?\s*\([^)]*recursive|\brimraf(?:\.sync)?\s*\(|\b(?:fse|fsExtra|fs)\.(?:remove|removeSync|emptyDir|emptyDirSync)\s*\(|\[(?:System\.)?IO\.Directory\]::Delete\s*\([^)]*\$true|\bDirectory\.Delete\s*\([^,)]+,\s*true|\bFileUtils\.rm_r|\bremove_dir_all\b|\bos\.RemoveAll\b|\bRemove-Item\b[^\n]*-Recurse/i
const CODE_TARGET = /(?:rmtree|rmSync|\.rm|rmdirSync|\.rmdir|remove|removeSync|emptyDir|emptyDirSync|rimraf(?:\.sync)?|Delete|rm_rf?|RemoveAll|remove_dir_all)\s*\(\s*r?["'`]([^"'`]+)["'`]/g
const ENV_WRITE = /\[(?:System\.)?Environment\]::SetEnvironmentVariable\s*\([^)]*\b(User|Machine)\b/i
const DESTRUCTIVE_DB = [
  ...DESTRUCTIVE_SQL,
  /\bprisma\s+(migrate\s+reset|db\s+push\b[\s\S]*(--force-reset|--accept-data-loss))/i,
  /\b(db:drop|db:reset|db:schema:load|db:wipe|migrate:fresh|migrate:reset|migrate:refresh|schema:drop|db:seed:undo:all|migrate:undo:all)\b/i,
  /manage\.py\s+(flush|reset_db|sqlflush)\b/i,
  /^dropdb\b/i,
  /\balembic\s+downgrade\s+base\b/i,
  /\bflyway\s+clean\b/i,
  /\bsupabase\s+db\s+reset\b/i,
  /\bdotnet\s+ef\s+database\s+drop\b/i
]
const INFRA = [
  /^(npx\s+)?terraform\s+(destroy|apply\b[\s\S]*-auto-approve)/i,
  /^(npx\s+)?terraform\s+(state\s+(rm|mv|push|replace-provider)|force-unlock|taint|workspace\s+delete)\b/i,
  /^kubectl\s+(delete|drain)\b/i,
  /^docker\s+(image\s+)?push\b|^docker\s+buildx\s+build\b[\s\S]*\s--push\b/i,
  /^helm\s+(uninstall|delete|rollback)\b/i,
  /^docker\s+(system\s+prune|volume\s+(rm|prune)|image\s+prune\s+-a|container\s+prune)\b/i,
  /^docker(-compose|\s+compose)\b[\s\S]*\bdown\b[\s\S]*(\s-v\b|--volumes)/i,
  /^aws\s+s3\s+(rm|rb)\b|^aws\s+\S+\s+(delete|terminate)-/i,
  /^(gcloud|az)\b[\s\S]*\s(delete|destroy)\b/i,
  /^(npx\s+)?firebase\s+(deploy|hosting:disable|firestore:delete|database:remove)\b/i,
  /^(npx\s+)?(vercel|netlify)\b[\s\S]*--prod\b/i,
  /^(npm|pnpm|yarn)\s+publish\b|^cargo\s+publish\b|^twine\s+upload\b|^gem\s+push\b|^dotnet\s+nuget\s+push\b/i,
  /^gh\s+(repo\s+delete|release\s+delete)\b|^gh\s+repo\s+edit\b[\s\S]*--visibility\s+public/i,
  /^heroku\s+(apps:destroy|pg:reset)\b/i,
  /^(npx\s+)?eas\s+submit\b|^fastlane\s+\S*\s*(deliver|supply|release)\b/i
]
const SYSTEM = [
  /^format(\.com)?\s+[a-z]:/i,
  /^diskpart\b|^mkfs|^bcdedit\b|^cipher\s+\/w/i,
  /^(format-volume|clear-disk|remove-partition|initialize-disk|set-partition)\b/i,
  /^vssadmin\s+delete\b|^wevtutil\s+cl\b|^disable-computerrestore\b/i,
  /^set-mppreference\b[\s\S]*-disable\w*\s+\$?true|^netsh\s+advfirewall\s+set\b[\s\S]*\bstate\s+off\b/i,
  /^(set-itemproperty|new-itemproperty|remove-itemproperty|sp)\b[\s\S]*\b(hklm|hkcu):/i,
  /^dd\b[\s\S]*\bof=\/dev\//i,
  /^(chmod|chown)\s+-R\b[\s\S]*\s(777|\/)(\s|$)/i,
  /^reg\s+(delete|add)\b/i,
  /^(shutdown|stop-computer|restart-computer)\b/i,
  /^set-executionpolicy\b[\s\S]*\b(unrestricted|bypass)\b/i,
  /^takeown\b|^icacls\b[\s\S]*\/grant\s+(everyone|todos)/i
]
// Commands whose output is secret values: Kubernetes secrets, Terraform state and outputs, cloud secret stores.
const PRINTS_SECRETS = [
  /^(kubectl|oc)\s+get\s+secrets?\b[\s\S]*(-o|--output)[=\s]*["']?(ya?ml|json|jsonpath|go-template)/i,
  /^(npx\s+)?terraform\s+(state\s+pull|show\b[\s\S]*-json|output\b[\s\S]*(-json|-raw))/i,
  /^aws\s+secretsmanager\s+get-secret-value\b|^aws\s+ssm\s+get-parameters?(-by-path)?\b[\s\S]*--with-decryption/i,
  /^gcloud\s+secrets\s+versions\s+access\b|^az\s+keyvault\s+secret\s+show\b|^vault\s+(kv\s+get|read)\b/i,
  /^op\s+(read|item\s+get)\b|^doppler\s+secrets\b|^heroku\s+config(:get)?\b|^railway\s+variables\b|^(npx\s+)?netlify\s+env:(get|list)\b/i
]
// Kubernetes and Helm commands that change a cluster; in production they are critical (checkCluster).
const KUBE_WRITE = /^(kubectl|oc)\s+(apply|create|replace|patch|delete|scale|edit|drain|cordon|taint|label|annotate|set|autoscale|expose|rollout\s+(restart|undo))\b/i
const HELM_WRITE = /^helm\s+(install|upgrade|rollback|uninstall|delete)\b/i
const PROD = /(^|[^a-z])(prod|production|prd|live)([^a-z]|$)/i
const REMOTE_EXEC = /\b(curl|wget|iwr|invoke-webrequest|irm|invoke-restmethod)\b[^|;]*\|\s*(sudo\s+)?(sh|bash|zsh|iex|invoke-expression|python3?|node|pwsh|powershell)\b|\biex\s*\(\s*(new-object\s+net\.webclient|iwr|irm|invoke-webrequest|invoke-restmethod)/i

export const norm = path => {
  const p = toPosix(path)
  return process.platform === 'win32' ? p.toLowerCase() : p
}

// Uncommitted changes that are git porcelain lines: "XY path".
export function gitStatusMap(root) {
  const status = new Map()
  const out = root ? run('git', ['-c', 'core.quotepath=off', 'status', '--porcelain'], { cwd: root }) : null
  for (const line of (out || '').split('\n').filter(Boolean)) status.set(line.slice(3).replace(/^.* -> /, '').replace(/^"|"$/g, ''), line.slice(0, 2))
  return status
}

// Lazily computed facts about the repo, shared by the rules of one tool call.
// created: files Codex created this session. touched: files Codex changed this session.
// userDirty: files that had uncommitted changes Codex did not make (yours) when a turn started.
// aliases: your shell aliases and functions (src/aliases.js), read from your profiles if not given.
// allow: the repo's `bcx allow` rules (src/allow.js), read when a finding needs them if not given.
// session: picks Codex's shell snapshot for this session among the aliases.
function context({ cwd, created = [], touched = [], userDirty = [], aliases, allow, session }) {
  // Asking git where the repo is spawns a process (~100 ms on Windows) and most commands
  // (rg, cat, git status…) never need it: only the rules that do pay for it.
  let repo = null
  const root = () => (repo ??= { root: gitRoot(cwd) }).root
  const realRoot = () => (repo.real ??= real(repo.root))
  let status = null
  let kube = null
  // Same spelling on both sides of every comparison; built only when a rule asks.
  let sets = null
  const set = name => (sets ??= { created: new Set(created.map(canon)), touched: new Set(touched.map(canon)), userDirty: new Set(userDirty.map(canon)) })[name]
  // A profile that can't be read means no aliases, never a guard that stops checking.
  let defs = aliases
  const loadDefs = () => {
    try {
      return shellAliases({ snapshot: snapshotFile(session) })
    } catch {
      return {}
    }
  }
  const ctx = {
    cwd,
    get aliases() {
      return (defs ??= loadDefs())
    },
    alias: verb => (Object.hasOwn(ctx.aliases, verb) ? ctx.aliases[verb] : null),
    // Aliases being expanded: like the shell, `alias rm='rm -i'` does not expand rm again.
    expanding: new Set(),
    // Scripts, package.json scripts and profile definitions being read: your code, not what Codex typed.
    reading: 0,
    // kubectl's current context, asked only when a command would change a cluster.
    kubeContext: () => (kube ??= { name: run('kubectl', ['config', 'current-context']) }).name,
    // You allowed this kind of action in this repo with `bcx allow`: generated/ covers generated/x.
    allowed(found) {
      allow ??= root() ? allowedFor(canon(root())) : []
      return allow.some(rule => {
        if (rule.rule !== found.rule) return false
        if (!rule.paths) return rule.detail === baseDetail(found.detail)
        const paths = found.save?.paths
        if (!paths?.length || found.save.git) return false
        return paths.every(p => {
          const rel = ctx.inside(p) ? norm(ctx.rel(p)) : null
          return rel && rule.paths.some(a => rel === a || rel.startsWith(a + '/'))
        })
      })
    },
    get root() {
      return root()
    },
    lists: { created, touched, userDirty },
    abs: p => toPosix(resolve(cwd, String(p).replace(/^["']|["']$/g, ''))),
    isTouched: abs => set('touched').has(canon(abs)) || set('created').has(canon(abs)),
    status: () => (status ??= gitStatusMap(root())),
    // git answers with real paths; the shell may be under a symlink (macOS /var → /private/var).
    rel: abs => (root() ? toPosix(relative(realRoot(), real(abs))) : null),
    inside: abs => !!root() && !ctx.rel(abs).startsWith('..') && !isAbsolute(ctx.rel(abs)),
    // Git can give it back: tracked and without uncommitted changes.
    recoverable(abs) {
      if (!ctx.inside(abs)) return false
      const rel = ctx.rel(abs)
      if ([...ctx.status().keys()].some(p => p === rel || p.startsWith(`${rel}/`))) return false
      return run('git', ['ls-files', '--error-unmatch', '--', rel], { cwd: root() }) !== null
    },
    isCreated: abs => set('created').has(canon(abs)),
    // Deleting it loses nothing: generated, or a scratch folder in this repo where git shows no
    // uncommitted work that Codex did not make. Without git there is no telling what is yours.
    disposable(target) {
      if (GENERATED.test(target)) return true
      return SCRATCH.test(target) && ctx.inside(ctx.abs(target)) && !ctx.protectedChanges([target]).length
    },
    // find . -name tmp -exec rm -rf {} +: every folder with that name under start.
    disposableName(name, start) {
      if (GENERATED.test(name)) return true
      if (!SCRATCH.test(name) || !ctx.inside(ctx.abs(start))) return false
      const base = `${canon(root())}/`
      return !ctx.protectedChanges([start]).some(abs => abs.slice(base.length).split('/').includes(norm(name)))
    },
    // Uncommitted work Codex would destroy that is not only its own: yours, or from before this session.
    protectedChanges(paths = [], { untrackedOnly = false } = {}) {
      const scope = paths.filter(p => p !== '.' && p !== '*').map(p => ctx.rel(ctx.abs(p)))
      return [...ctx.status()]
        .filter(([path, code]) => !untrackedOnly || code === '??')
        .filter(([path]) => !scope.length || scope.some(s => path === s || path.startsWith(`${s}/`) || s.startsWith(`${path}`)))
        .map(([path]) => canon(`${root()}/${path}`))
        .filter(abs => set('userDirty').has(abs) || !(set('touched').has(abs) || [...set('created')].some(c => c === abs || c.startsWith(abs))))
    }
  }
  return ctx
}

// The real path of p, or of its nearest existing parent plus the rest (p may not exist yet).
function real(p) {
  try {
    return toPosix(realpathSync.native(p))
  } catch {
    const parent = dirname(p)
    return parent === p ? toPosix(p) : `${real(parent).replace(/\/$/, '')}/${basename(p)}`
  }
}

const inTemp = abs => canon(abs).startsWith(canon(tmpdir()))

// One spelling per file: symlinks (macOS /var → /private/var) and Windows short names
// (C:\Users\RUNNER~1) resolved, so Codex's own files are recognized as its own.
export const canon = p => norm(real(p))

const describe = target => (/^[$%]/.test(target) ? `${target} (a variable: the path is only known when it runs)` : target)

// find . -name "*.log" -delete, find dist -exec rm -rf {} +
function checkFind(seg, ctx) {
  const a = seg.argv
  const exec = a.findIndex(x => /^-(exec|execdir|ok)$/.test(x))
  if (!a.includes('-delete') && !(exec !== -1 && DELETE_VERBS.has(verbOf(a[exec + 1])))) return null
  const start = pathArgs(a).find(x => !x.startsWith('(')) || '.'
  const nameFlag = a.findIndex(x => /^-i?name$/.test(x))
  const name = nameFlag === -1 ? null : a[nameFlag + 1]
  if (ctx.disposable(start) || (name && ctx.disposableName(name, start)) || ctx.isCreated(ctx.abs(start))) return null
  return { rule: 'delete', severity: 'high', detail: `find deletes${name ? ` every ${name}` : ' everything it matches'} under ${start}`, save: { paths: [ctx.abs(start)] } }
}

function checkDelete(seg, ctx) {
  if (seg.verb === 'find') return checkFind(seg, ctx)
  // ls | xargs rm -rf: the command after xargs gets its arguments from the pipe.
  if (seg.verb === 'xargs') {
    const i = seg.argv.findIndex((a, n) => n > 0 && DELETE_VERBS.has(verbOf(a)))
    if (i === -1) return null
    const argv = seg.argv.slice(i)
    seg = { ...seg, argv, verb: verbOf(argv[0]), text: argv.join(' '), fed: true }
  }
  const npxRimraf = (seg.verb === 'npx' || seg.verb === 'pnpm' || seg.verb === 'bunx') && /rimraf|del-cli/.test(seg.text)
  if (!DELETE_VERBS.has(seg.verb) && !npxRimraf) return null
  const args = seg.argv.slice(1)
  const recursive =
    npxRimraf ||
    ['rimraf', 'rd', 'rmdir'].includes(seg.verb) ||
    args.some(a => /^-[a-zA-Z]{1,3}$/.test(a) && /r/i.test(a)) ||
    args.some(a => /^(-recurse|--recursive|\/s)$/i.test(a))
  const targets = pathArgs(seg.argv)
    .flatMap(a => a.split(','))
    .filter(a => a && !/^(rimraf|del-cli|exec|dlx|\{\})$/i.test(a))

  // Get-ChildItem *.tmp | Remove-Item: what gets deleted is whatever the previous command listed.
  if (!targets.length && seg.fed) {
    const listed = seg.source ? pathArgs(seg.source.argv).filter(a => !/^(ls-files|status|diff)$/.test(a)) : []
    if (listed.length && listed.every(t => ctx.disposable(t) || ctx.isCreated(ctx.abs(t)) || (!ctx.inside(ctx.abs(t)) && inTemp(ctx.abs(t))))) return null
    const from = seg.source ? `\`${seg.source.text.slice(0, 120)}\`` : 'the previous command'
    return { rule: 'delete', severity: 'high', detail: `deletes whatever ${from} lists${recursive ? ', recursively' : ''}`, save: { git: ctx.cwd } }
  }

  const risky = []
  let critical = false
  for (const target of targets) {
    const abs = ctx.abs(target)
    if (EVERYTHING.test(target) || (ctx.root && ctx.rel(abs) === '')) {
      critical = true
      risky.push(target)
      continue
    }
    if (ctx.disposable(target) || ctx.isCreated(abs)) continue
    const inside = ctx.root && ctx.inside(abs)
    // Scratch files in the system temp folder are fine to delete, unless they belong to the repo.
    if (!inside && inTemp(abs)) continue
    if (ctx.root && !inside) {
      critical = true
      risky.push(target)
      continue
    }
    if (!recursive && !/[*?]/.test(target) && ctx.recoverable(abs)) continue
    risky.push(target)
  }
  if (!risky.length) return null
  // What to copy first if you approve: the literal paths; a variable or wildcard leaves only git to save.
  const literal = risky.filter(t => !/[$%*?]/.test(t))
  const save = { paths: literal.map(ctx.abs), ...(literal.length < risky.length && { git: ctx.cwd }) }
  return { rule: 'delete', severity: critical ? 'critical' : 'high', detail: `deletes ${risky.map(describe).join(', ')}${recursive ? ' recursively' : ''}`, save }
}

function gitArgs(argv) {
  const args = argv.slice(1)
  let i = 0
  while (i < args.length && /^-/.test(args[i])) i += /^-(C|c)$/.test(args[i]) ? 2 : 1
  return { sub: (args[i] || '').toLowerCase(), rest: args.slice(i + 1) }
}

function checkGit(seg, ctx) {
  if (seg.verb !== 'git') return null
  const { sub, rest } = gitArgs(seg.argv)
  const flags = rest.filter(a => a.startsWith('-'))
  const has = re => flags.some(f => re.test(f))
  // If you approve, the repo is saved first (uncommitted work and every branch tip) so bcx undo can bring it back.
  const hit = (rule, detail, severity = 'high', save = { git: ctx.cwd }) => ({ rule, severity, detail, save })
  // Reverting only what Codex itself changed this session is fine; your uncommitted work is not.
  const lost = (paths, options) => {
    const files = ctx.protectedChanges(paths, options)
    return files.length ? ` (would lose: ${files.slice(0, 5).map(f => ctx.rel(f)).join(', ')}${files.length > 5 ? ', …' : ''})` : ''
  }

  if (sub === 'reset' && has(/^--(hard|merge|keep)$/)) {
    const ref = rest.find(a => !a.startsWith('-'))
    if (ref && !/^head$/i.test(ref)) return hit('git-history', `git reset --hard ${ref} moves the branch, dropping the commits after it and every uncommitted change`, 'critical')
    const files = lost([])
    if (files) return hit('git-discard', `git reset --hard throws away uncommitted changes${files}`)
  }
  if (sub === 'checkout' && !has(/^-[bB]$|^--orphan$/) && (rest.includes('--') || rest.includes('.') || has(/^(-f|--force)$/))) {
    const dash = rest.indexOf('--')
    const paths = dash === -1 ? rest.filter(a => !a.startsWith('-')) : rest.slice(dash + 1)
    const files = lost(rest.includes('.') || has(/^(-f|--force)$/) ? [] : paths)
    if (files) return hit('git-discard', `${seg.text} overwrites uncommitted changes${files}`)
  }
  if (sub === 'restore' && !(has(/^(-S|--staged)$/) && !has(/^(-W|--worktree)$/))) {
    const files = lost(rest.filter(a => !a.startsWith('-')))
    if (files) return hit('git-discard', `${seg.text} overwrites uncommitted changes${files}`)
  }
  if (sub === 'switch' && has(/^(-f|--force|--discard-changes)$/)) {
    const files = lost([])
    if (files) return hit('git-discard', `${seg.text} discards uncommitted changes${files}`)
  }
  if (sub === 'clean' && has(/^-[a-z]*f|^--force$/) && !has(/^-[a-z]*n|^--dry-run$/)) {
    const clean = { clean: { cwd: ctx.cwd, argv: seg.argv } }
    if (has(/^-[a-z]*x|^-X$/)) return hit('git-discard', `${seg.text} also deletes ignored files such as .env and local config`, 'critical', clean)
    const files = lost(rest.filter(a => !a.startsWith('-')), { untrackedOnly: true })
    if (files) return hit('git-discard', `${seg.text} deletes untracked files, which git cannot restore${files}`, 'high', clean)
  }
  if (sub === 'stash' && /^(drop|clear)$/i.test(rest[0] || '')) return hit('git-discard', `git stash ${rest[0]} deletes stashed work`)
  if (sub === 'worktree' && rest[0] === 'remove' && has(/^(-f|--force)$/)) {
    const path = rest.slice(1).find(a => !a.startsWith('-'))
    return hit('git-discard', `${seg.text} deletes a worktree with its uncommitted changes`, 'high', path ? { paths: [ctx.abs(path)] } : undefined)
  }
  if (sub === 'push') {
    const target = rest.filter(a => !a.startsWith('-')).join(' ')
    if (has(/^--(mirror|prune)$/)) return hit('git-history', `${seg.text} deletes remote branches that do not exist locally`, 'critical')
    if (has(/^(-f|--force)$/) || rest.some(a => /^\+/.test(a))) {
      const main = /\b(main|master|develop|production|prod|release)\b/i.test(target) || !target
      return hit('git-history', `git push --force ${target}`.trim() + ' rewrites the remote history', main ? 'critical' : 'high')
    }
    if (has(/^--force-with-lease/)) return hit('git-history', `git push --force-with-lease ${target}`.trim() + ' rewrites the remote history (safer than --force, still destructive)')
    if (has(/^(-d|--delete)$/) || rest.some(a => /^:[^\s]/.test(a))) return hit('git-history', `deletes a remote branch or tag (${target})`)
  }
  if (sub === 'branch' && (has(/^-D$/) || (has(/^(-d|--delete)$/) && has(/^(-f|--force)$/)))) {
    return hit('git-history', `${seg.text} deletes a branch even if it is not merged`)
  }
  const codexRef = rest.some(a => /^refs\/codex\//.test(a)) // Codex's own turn-diff refs
  if (/^(filter-branch|filter-repo)$/.test(sub) || (sub === 'reflog' && rest[0] === 'expire') || (sub === 'gc' && has(/^--prune/)) || (sub === 'update-ref' && has(/^-d$/) && !codexRef)) {
    return hit('git-history', `${seg.text} rewrites history or prunes unreachable commits`, 'critical')
  }
  if (sub === 'add') {
    const named = rest.filter(a => !a.startsWith('-'))
    if (named.some(isSecretPath)) return hit('git-secrets', `stages ${named.filter(isSecretPath).join(', ')}`, 'high', null)
    if (named.includes('.') || named.includes('*') || has(/^(-A|--all|-u)$/) || !named.length) {
      const secrets = [...ctx.status()].filter(([path, code]) => code === '??' && isSecretPath(path)).map(([path]) => path)
      if (secrets.length) return hit('git-secrets', `would stage ${secrets.join(', ')} (not in .gitignore)`, 'high', null)
    }
  }
  if (sub === 'commit' && has(/^(-a|--all|-am)$/)) {
    const secrets = [...ctx.status()].filter(([path, code]) => code !== '??' && isSecretPath(path)).map(([path]) => path)
    if (secrets.length) return hit('git-secrets', `commits changes to ${secrets.join(', ')}`, 'high', null)
  }
  return null
}

function checkSecrets(seg, ctx) {
  if (READ_VERBS.has(seg.verb)) {
    const secrets = pathArgs(seg.argv).filter(isSecretPath)
    if (secrets.length) return { rule: 'secrets-read', severity: 'high', detail: `${seg.verb} ${secrets.join(', ')}` }
  }
  if (COPY_VERBS.has(seg.verb)) {
    // cp .env.example .env is fine on a fresh clone; over an existing .env it wipes your keys.
    const args = pathArgs(seg.argv)
    const dest = args[args.length - 1]
    if (args.length >= 2 && isSecretPath(dest) && existsSync(ctx.abs(dest))) {
      return { rule: 'secrets-write', severity: 'high', detail: `${seg.verb} over the existing ${dest}`, save: { paths: [ctx.abs(dest)] } }
    }
  }
  if (PRINTS_SECRETS.some(re => re.test(seg.text))) return { rule: 'secrets-read', severity: 'high', detail: `${seg.text.slice(0, 120)} prints secret values` }
  if ((/^(printenv|env)$/.test(seg.verb) && seg.argv.length === 1) || /^(get-childitem|gci|dir|ls)\s+env:\\?\s*$/i.test(seg.text) || (seg.verb === 'set' && seg.argv.length === 1)) {
    return { rule: 'secrets-read', severity: 'high', detail: `${seg.text} prints every environment variable, tokens included` }
  }
  const written = shellWrites(seg.text).filter(isSecretPath)
  if (written.length) return { rule: 'secrets-write', severity: 'high', detail: `writes ${written.join(', ')}`, save: { paths: written.map(ctx.abs) } }
  return null
}

// kubectl apply / helm upgrade aimed at production: from --context, --kube-context or the namespace, else the
// current context (asked once, only for these commands). A dry run changes nothing.
function checkCluster(seg, ctx) {
  if ((!KUBE_WRITE.test(seg.text) && !HELM_WRITE.test(seg.text)) || /--dry-run(?!=none)/.test(seg.text)) return null
  const flag = name => {
    const i = seg.argv.findIndex(a => a === name || a.startsWith(`${name}=`))
    return i === -1 ? null : seg.argv[i].includes('=') ? seg.argv[i].split('=').slice(1).join('=') : seg.argv[i + 1]
  }
  const context = flag('--context') ?? flag('--kube-context') ?? ctx.kubeContext()
  const namespace = flag('-n') ?? flag('--namespace')
  const target = [context, namespace].find(v => v && PROD.test(v))
  return target ? { rule: 'infra', severity: 'critical', detail: `${seg.text.slice(0, 120)} changes the production cluster (${target})` } : null
}

function checkPatterns(seg) {
  if (DB_CLIENT.test(seg.verb) && DESTRUCTIVE_DB.some(re => re.test(seg.text))) {
    return { rule: 'database', severity: 'critical', detail: seg.text }
  }
  if (INFRA.some(re => re.test(seg.text))) return { rule: 'infra', severity: 'high', detail: seg.text }
  if (SYSTEM.some(re => re.test(seg.text))) return { rule: 'system', severity: 'critical', detail: seg.text }
  return null
}

function checkPatch(toolInput, ctx) {
  const files = patchFiles(toolInput)
  const settings = files.find(f => isSettings(f.path, ctx))
  if (settings) return { rule: 'bcx-settings', severity: 'critical', detail: `edits ${settings.path}` }
  const deleted = files.filter(f => f.op === 'delete')
  const secrets = files.filter(f => f.op !== 'add' && isSecretPath(f.path))
  if (secrets.length) return { rule: 'secrets-write', severity: 'high', detail: `edits ${secrets.map(f => f.path).join(', ')}`, save: { paths: secrets.map(f => ctx.abs(f.path)) } }
  const lost = deleted.filter(f => {
    const abs = ctx.abs(f.path)
    return !ctx.disposable(f.path) && !ctx.isCreated(abs) && !ctx.recoverable(abs)
  })
  if (lost.length) return { rule: 'delete', severity: 'high', detail: `deletes ${lost.map(f => f.path).join(', ')} (uncommitted or untracked: git cannot restore it)`, save: { paths: lost.map(f => ctx.abs(f.path)) } }
  if (deleted.length >= 10) return { rule: 'delete', severity: 'high', detail: `deletes ${deleted.length} files in one patch`, save: { paths: deleted.map(f => ctx.abs(f.path)) } }
  return null
}

// taskkill /IM chrome.exe, Stop-Process -Name node, pkill java, Get-Process code | Stop-Process. By PID is fine.
function checkKill(seg) {
  const args = seg.argv.slice(1)
  const after = re => {
    const i = args.findIndex(a => re.test(a))
    return i === -1 ? null : args[i + 1]
  }
  let name = null
  if (seg.verb === 'taskkill') name = after(/^\/im$/i)
  else if (['stop-process', 'spps', 'kill'].includes(seg.verb)) {
    name = after(/^-(name|processname)$/i)
    if (!name && seg.fed && /^(get-process|gps|ps)$/.test(seg.source?.verb || '') && !seg.source.argv.some(a => /^-id$/i.test(a))) {
      name = pathArgs(seg.source.argv)[0] || 'every listed'
    }
  } else if (['pkill', 'killall'].includes(seg.verb)) name = pathArgs(seg.argv)[0]
  return name ? { rule: 'kill', severity: 'high', detail: `${seg.text} ends every ${name} process` } : null
}

// git config --global user.email x, npm config set registry …, setx PATH …
function checkGlobalConfig(seg) {
  const hit = { rule: 'global-config', severity: 'high', detail: seg.text }
  if (seg.verb === 'git') {
    const { sub, rest } = gitArgs(seg.argv)
    if (sub !== 'config' || !rest.some(a => /^--(global|system)$/.test(a))) return null
    if (rest.some(a => /^--(get|get-all|get-regexp|list)$|^-l$/.test(a))) return null
    const writes = rest.some(a => /^--(unset|unset-all|add|replace-all|edit|remove-section|rename-section)$|^-e$/.test(a)) || rest.filter(a => !a.startsWith('-')).length >= 2
    return writes ? hit : null
  }
  if (/^(npm|pnpm|yarn)$/.test(seg.verb)) {
    const [first, second] = seg.argv.slice(1)
    const write = first === 'set' || (first === 'config' && /^(set|delete|rm|edit)$/.test(second || ''))
    return write && !/--location[= ]project/.test(seg.text) ? hit : null
  }
  return seg.verb === 'setx' ? hit : null
}

// Codex giving itself permission or switching protection off: bcx allow "…", bcx config set guard off,
// bcx uninstall, or writing better-codex's settings, its allow list or ~/.codex/hooks.json itself.
const SETTINGS = () => [allowFile(), configPath(), join(codexHome(), 'hooks.json')].map(canon)
const atHome = p => String(p).replace(/^["']|["']$/g, '').replace(/^(~|\$HOME|\$\{HOME\}|\$env:USERPROFILE|%USERPROFILE%)(?=[\\/])/i, () => homedir())
const isSettings = (path, ctx) => SETTINGS().includes(canon(ctx.abs(atHome(path))))
const SETTINGS_FILE = /better-codex[\\/](allow|config)\.json|\.codex[\\/]hooks\.json/i
const WRITE_CALL = /\b(writeFile\w*|appendFile\w*|WriteAll\w*|Set-Content|Add-Content|Out-File|json\.dump|unlink\w*|copyFile\w*|rename\w*)\b|open\([^)]*["'][wa]/i

function bcxArgs(seg) {
  const a = seg.argv
  if (/^(bcx|better-codex)$/.test(seg.verb)) return a.slice(1)
  const script = a.findIndex((x, i) => i > 0 && /(^|[\\/])bcx\.js$/i.test(x))
  if (seg.verb === 'node' && script !== -1) return a.slice(script + 1)
  const pkg = /^(npx|pnpx|bunx|pnpm|yarn)$/.test(seg.verb) ? a.findIndex(x => /(^|\/)better-codex(@[\w.-]+)?$/.test(x)) : -1
  return pkg === -1 ? null : a.slice(pkg + 1)
}

function checkSettings(seg, ctx) {
  const args = bcxArgs(seg)
  const off = /^(false|off|no|n|0)$/i
  const changes = args && ((args[0] === 'allow' && args.length > 1) || (args[0] === 'config' && args[1] === 'set' && /^(guard|undo|strict)$/.test(args[2]) && off.test(args[3] ?? '')) || (args[0] === 'uninstall' && !args.includes('--dry-run')))
  if (changes) return { rule: 'bcx-settings', severity: 'critical', detail: `${seg.text} changes what better-codex lets Codex do` }
  const written = [...shellWrites(seg.text), ...(COPY_VERBS.has(seg.verb) ? pathArgs(seg.argv).slice(-1) : []), ...(DELETE_VERBS.has(seg.verb) ? pathArgs(seg.argv) : [])]
  const file = written.find(p => isSettings(p, ctx))
  if (file || (SETTINGS_FILE.test(seg.text) && WRITE_CALL.test(seg.text))) return { rule: 'bcx-settings', severity: 'critical', detail: `${seg.verb} writes ${file ?? 'better-codex settings or hooks.json'}` }
  return null
}

// "(would lose: a.js, b.js)" changes from one time to the next; the action doesn't.
const baseDetail = detail => String(detail).replace(/ \(would lose: [^)]*\)$/, '')

// What `bcx allow` stores for a finding in this repo: the paths it touches, or the action itself.
export function allowRule(found, cwd) {
  const ctx = context({ cwd })
  if (!ctx.root) return { error: 'not-a-repo' }
  if (found.rule === 'bcx-settings') return { error: 'settings' }
  const repo = canon(ctx.root)
  const paths = found.save?.paths
  if (!paths?.length || found.save.git) return { repo, rule: { rule: found.rule, detail: baseDetail(found.detail) } }
  const rel = paths.map(p => (ctx.inside(p) ? norm(ctx.rel(p)) : null))
  if (rel.some(p => !p)) return { error: 'outside' } // outside the repo, or the repo itself
  return { repo, rule: { rule: found.rule, paths: rel } }
}

const INLINE_FLAG = { node: /^(-e|--eval|-p|--print)$/, bun: /^(-e|--eval)$/, deno: /^eval$/, python: /^-c$/, python3: /^-c$/, py: /^-c$/, ruby: /^-e$/, perl: /^-e$/, php: /^-r$/ }

// Code that deletes folders or runs destructive SQL. Literal targets that are build output are fine.
function codeRisk(code, what, ctx) {
  if (DANGEROUS_CODE.test(code)) {
    const targets = [...code.matchAll(CODE_TARGET)].map(m => m[1])
    if (!targets.length || !targets.every(t => ctx.disposable(t))) {
      return { rule: 'delete', severity: 'high', detail: `${what} deletes folders from code${targets.length ? ` (${targets.slice(0, 3).join(', ')})` : ''}` }
    }
  }
  const sql = DESTRUCTIVE_SQL.find(re => re.test(code))
  return sql ? { rule: 'database', severity: 'critical', detail: `${what} runs destructive SQL (${sql.exec(code)[0].slice(0, 60)})` } : null
}

// node -e "fs.rmSync('src', {recursive: true})", python -c "import shutil; shutil.rmtree('data')"
function checkInline(seg, ctx) {
  const flag = INLINE_FLAG[seg.verb]
  const i = flag ? seg.argv.findIndex((a, n) => n > 0 && flag.test(a)) : -1
  return i === -1 ? null : codeRisk(seg.argv.slice(i + 1).join(' '), `${seg.verb} ${seg.argv[i]}`, ctx)
}

const SHELL_SCRIPT = /\.(ps1|sh|bash|zsh|bat|cmd)$/i
const CODE_SCRIPT = /\.(m?[jt]s|cjs|py|rb|php|pl)$/i
const TEST_FILE = /(^|[\\/])(test|tests|__tests__|spec)[\\/]|\.(test|spec)\.[cm]?[jt]sx?$|(^|[\\/])test_[^\\/]+\.py$/i
const RUNNERS = new Set(['node', 'deno', 'bun', 'tsx', 'ts-node', 'python', 'python3', 'py', 'ruby', 'php', 'perl', 'bash', 'sh', 'zsh', 'powershell', 'pwsh', 'cmd', 'source'])

function scriptOf(seg) {
  if (SHELL_SCRIPT.test(seg.argv[0]) || CODE_SCRIPT.test(seg.argv[0])) return seg.argv[0]
  if (!RUNNERS.has(seg.verb)) return null
  const file = seg.argv.findIndex(a => /^-(file|f)$/i.test(a))
  if (file !== -1) return seg.argv[file + 1]
  return seg.argv.slice(1).find(a => !a.startsWith('-') && (SHELL_SCRIPT.test(a) || CODE_SCRIPT.test(a)))
}

// A script is what it runs: Codex could write cleanup.ps1 and then run it.
// Shell scripts are always read; code files only when Codex wrote them in this session (your own code is yours).
function checkScript(seg, ctx, depth) {
  const file = scriptOf(seg)
  if (!file) return null
  const abs = ctx.abs(file)
  try {
    if (statSync(abs).size > 256 * 1024) return null
  } catch {
    return null
  }
  const text = readText(abs, '')
  if (SHELL_SCRIPT.test(file)) {
    const body = text
      .split(/\r?\n/)
      .filter(line => !/^\s*(#|rem\b|::)/i.test(line))
      .join('\n')
    const found = ownCode(ctx, () => inspectCommand(body, ctx, depth + 1))
    return found && { ...found, detail: `${file} → ${found.detail}` }
  }
  if (!TEST_FILE.test(file) && ctx.isTouched(abs)) return codeRisk(text, file, ctx)
  return null
}

function findPackageJson(dir) {
  for (let d = resolve(dir), i = 0; i < 6; d = dirname(d), i++) {
    if (existsSync(join(d, 'package.json'))) return { dir: d, pkg: readJson(join(d, 'package.json'), {}) }
    if (dirname(d) === d) break
  }
  return null
}

// npm run reset-db is whatever package.json says it is (with its pre/post scripts).
function checkNpmScript(seg, ctx, depth) {
  if (!/^(npm|pnpm|yarn|bun)$/.test(seg.verb)) return null
  const args = seg.argv.slice(1).filter(a => !a.startsWith('-'))
  let name = null
  if (/^(run|run-script|rum|urn)$/.test(args[0] || '')) name = args[1]
  else if (seg.verb === 'npm' && /^(test|t|start|stop|restart)$/.test(args[0] || '')) name = args[0] === 't' ? 'test' : args[0]
  else if (seg.verb !== 'npm') name = args[0]
  const found = name && findPackageJson(ctx.cwd)
  const scripts = found?.pkg?.scripts || {}
  if (!name || !scripts[name]) return null
  const child = found.dir === ctx.cwd ? ctx : context({ cwd: found.dir, ...ctx.lists, aliases: ctx.aliases })
  for (const script of [scripts[`pre${name}`], scripts[name], scripts[`post${name}`]].filter(Boolean)) {
    const inner = ownCode(child, () => inspectCommand(script, child, depth + 1))
    if (inner) return { ...inner, detail: `${seg.verb} ${name} → ${inner.detail}` }
  }
  return null
}

// nuke tmp, where your profile says nuke = rm -rf: the shell runs the alias or function, not the word.
function checkAlias(seg, ctx, depth) {
  const def = ctx.alias(seg.verb)
  if (!def || ctx.expanding.has(seg.verb)) return null
  ctx.expanding.add(seg.verb)
  try {
    const found = ownCode(ctx, () => inspectCommand(expand(def, seg.argv.slice(1)), ctx, depth + 1))
    return found && { ...found, detail: `${seg.argv[0]} (${def.kind} in ${tilde(def.file)}) → ${found.detail}` }
  } finally {
    ctx.expanding.delete(seg.verb)
  }
}

// Text that only becomes a command when it runs: base64 (powershell -EncodedCommand, base64 -d, b64decode,
// atob), eval or iex of a variable, output piped into a shell. What can be known is checked as if Codex
// had typed it; what can't be known asks, but only when Codex typed it: in your scripts, package.json
// and profile, `iex $cmd` is your code's own logic.
const DECODES = /base64|b64decode|\batob\b|(?:^|\s)[-/]e(?:c|n[a-z]*)?\s+["']?[A-Za-z0-9+/]{12}/i
const BLOB = /(?<![\w+/=.-])[A-Za-z0-9+/]{12,}={0,2}(?![\w+/=.-])/g
const EVAL = /^(eval|iex|invoke-expression)$/
const SHELLS = /^(sh|bash|zsh|dash|ksh|fish|pwsh|powershell|iex|invoke-expression)$/
const CODE_STDIN = /^(python3?|py|node|deno|bun|ruby|perl|php)$/
const STDIN_ARGS = /^(-|--|-s|-i|-l|-u|-x|-e|-noprofile|-nop|-nologo|-noninteractive|-noni|-command|-c|-executionpolicy|-ep|bypass|unrestricted)$/i
// Tools whose output is meant to be run: eval "$(ssh-agent -s)", eval "$(fnm env)", conda shell.powershell hook | Out-String | iex.
const SETUP = /^(ssh-agent|keychain|gpg-agent|dircolors|fnm|nvm|volta|pyenv|rbenv|nodenv|goenv|jenv|direnv|asdf|mise|rtx|conda|mamba|micromamba|brew|zoxide|starship|oh-my-posh|opam|thefuck|atuin|uv|poetry|pdm|pixi)$/
const FETCH = /^(curl|wget|iwr|invoke-webrequest|irm|invoke-restmethod)$/
// sh -c "$(…)", eval "$(…)", iex $(…), source <(…), bash <(…); and sh -c "$CMD".
const RUNS_OUTPUT = /(?:\b(?:eval|iex|invoke-expression)|\b(?:sh|bash|zsh|dash|ksh)(?:\.exe)?(?:\s+-\w+)*\s+-c)\s+["']?\$(?=\()|(?:^|[\s;&|(])(?:source|\.|sh|bash|zsh)\s+<(?=\()/gi
const RUNS_VARIABLE = /\b(?:sh|bash|zsh|dash|ksh)(?:\.exe)?(?:\s+-\w+)*\s+-c\s+["']?\$\{?\w+\}?["']?(?:\s|$)/i
const show = text => clip(String(text).replace(/\s+/g, ' ').trim(), 80)
const hidden = (ctx, detail) => (ctx.reading ? null : { rule: 'hidden', severity: 'high', detail, save: { git: ctx.cwd } })
const ownCode = (ctx, fn) => {
  ctx.reading++
  try {
    return fn()
  } finally {
    ctx.reading--
  }
}

// The text inside a base64 literal (UTF-8, or UTF-16LE as -EncodedCommand uses), or null if it isn't text.
export function decodeBase64(blob) {
  const bare = String(blob).trim().replace(/=+$/, '')
  if (!/^[A-Za-z0-9+/]+$/.test(bare) || bare.length % 4 === 1) return null
  const padded = bare.padEnd(Math.ceil(bare.length / 4) * 4, '=')
  const bytes = Buffer.from(padded, 'base64')
  if (bytes.toString('base64') !== padded) return null
  for (const encoding of bytes.length % 2 ? ['utf8'] : ['utf8', 'utf16le']) {
    const text = bytes.toString(encoding)
    if (/\S/.test(text) && text.replace(/[^\t\n\r\x20-\x7e]/g, '').length >= text.length * 0.9) return text
  }
  return null
}

// powershell -EncodedCommand UgBlAG0A…, echo cm0g… | base64 -d | sh, python -c "exec(b64decode('…'))".
function checkDecoded(command, ctx, depth) {
  if (!DECODES.test(command)) return null
  for (const [blob] of command.matchAll(BLOB)) {
    const text = decodeBase64(blob)
    const found = text && (inspectCommand(text, ctx, depth + 1) || codeRisk(text, 'it', ctx))
    if (found) return { ...found, detail: `base64 ${clip(blob, 13)} decodes to "${show(text)}" → ${found.detail}`, command: command.slice(0, 300) }
  }
  return null
}

// What a pipeline prints, when that is known without running it: echo 'text' (maybe through base64 -d), cat file.
function printed(segs, ctx) {
  const [first, ...rest] = segs
  let text = null
  const args = first.argv.slice(1).filter(a => !/^-(n|e|E|raw)$/i.test(a))
  if (/^(echo|printf|write-output)$/.test(first.verb)) text = args.join(' ')
  else if (/^(cat|type|get-content|gc)$/.test(first.verb) && args.length === 1) {
    try {
      if (statSync(ctx.abs(args[0])).size <= 256 * 1024) text = readText(ctx.abs(args[0]), null)
    } catch {}
  }
  for (const seg of rest) {
    if (text == null) break
    if (seg.verb === 'base64' && seg.argv.some(a => /^(-d|-D|--decode)$/.test(a))) text = decodeBase64(text)
    else if (!/^(out-string|oss)$/.test(seg.verb)) text = null
  }
  return text
}

// `how` (a shell) runs whatever `segs` print: checked when that is known, asked when it isn't.
function runsOutput(segs, how, ctx, depth) {
  if (!segs.length) return null
  const from = show(segs.map(s => s.text).join(' | '))
  const origin = verbOf(segs[0].argv.find(a => !/^[(&]+$/.test(a))?.replace(/^[(&]+/, ''))
  if (FETCH.test(origin)) return { rule: 'remote-exec', severity: 'high', detail: `${how} runs what ${from} downloads` }
  if (SETUP.test(origin) || segs[0].argv.includes('completion')) return null
  const text = printed(segs, ctx)
  if (text == null) return hidden(ctx, `${how} runs the output of ${from}, only known when it runs`)
  const found = inspectCommand(text, ctx, depth + 1)
  return found && { ...found, detail: `${how} runs "${show(text)}" → ${found.detail}` }
}

function checkRunsOutput(command, ctx, depth) {
  for (const m of command.matchAll(RUNS_OUTPUT)) {
    const inner = enclosed(command, m.index + m[0].length)
    const how = m[0].replace(/^[\s;&|(]+|["'$<]+$/g, '').trim()
    const found = inner == null ? hidden(ctx, `${how} runs text only known when it runs`) : runsOutput(segments(inner), how, ctx, depth)
    if (found) return { ...found, command: command.slice(0, 300), targets: found.targets ?? [] }
  }
  const variable = RUNS_VARIABLE.exec(command)
  const found = variable && hidden(ctx, `${show(variable[0])} runs a variable, only known when it runs`)
  return found && { ...found, command: command.slice(0, 300) }
}

// eval "rm -rf src" runs its text; eval "$CMD" and iex $script run text only known when they run;
// … | bash runs what comes down the pipe; powershell -EncodedCommand runs base64 (decoded in checkDecoded).
function checkRunsText(seg, ctx, depth) {
  const args = seg.argv.slice(1)
  if (EVAL.test(seg.verb) && args.length) {
    const code = args.filter(a => !/^-command$/i.test(a)).join(' ')
    if (code.startsWith('$(')) return null // the whole command was checked (checkRunsOutput)
    if (/[$`(]/.test(code)) return hidden(ctx, `${seg.verb} runs ${show(code)}, text only known when it runs`)
    const found = inspectCommand(code, ctx, depth + 1)
    return found && { ...found, detail: `${seg.verb} runs "${show(code)}" → ${found.detail}` }
  }
  if (/^(powershell|pwsh)$/.test(seg.verb)) {
    const i = args.findIndex(a => /^[-/]ec$/i.test(a) || (/^[-/]e/i.test(a) && 'encodedcommand'.startsWith(a.slice(1).toLowerCase())))
    if (i !== -1 && !decodeBase64(args[i + 1] || '')) return hidden(ctx, `${seg.verb} ${args[i]} runs base64 that is not readable text`)
  }
  if (!seg.fed || !seg.source || !args.every(a => STDIN_ARGS.test(a))) return null
  const chain = []
  for (let s = seg; s.fed && s.source; s = s.source) chain.unshift(s.source)
  if (SHELLS.test(seg.verb)) return runsOutput(chain, seg.verb, ctx, depth)
  // Code piped into python or node is checked when it is known (echo, cat); a here-string isn't seen here.
  const text = CODE_STDIN.test(seg.verb) && printed(chain, ctx)
  return text ? codeRisk(text, `${seg.verb} from the pipe`, ctx) : null
}

function inspectCommand(command, ctx, depth) {
  if (depth > 3) return null
  const whole =
    (REMOTE_EXEC.test(command) && { rule: 'remote-exec', severity: 'high', detail: command.slice(0, 200), command: command.slice(0, 300) }) ||
    (ENV_WRITE.test(command) && { rule: 'global-config', severity: 'high', detail: 'sets a user or machine environment variable', command: command.slice(0, 300) }) ||
    checkDecoded(command, ctx, depth) ||
    checkRunsOutput(command, ctx, depth)
  if (whole && !ctx.allowed(whole)) return whole
  const segs = segments(command)
  for (const seg of segs) {
    const found =
      checkDelete(seg, ctx) ||
      checkGit(seg, ctx) ||
      checkSecrets(seg, ctx) ||
      checkCluster(seg, ctx) ||
      checkPatterns(seg) ||
      checkKill(seg) ||
      checkGlobalConfig(seg) ||
      checkSettings(seg, ctx) ||
      checkInline(seg, ctx) ||
      checkScript(seg, ctx, depth) ||
      checkNpmScript(seg, ctx, depth) ||
      checkRunsText(seg, ctx, depth) ||
      checkAlias(seg, ctx, depth)
    // What Codex ran is the outer command; the detail tells what it leads to.
    if (found && !ctx.allowed(found)) return { ...found, command: seg.text.slice(0, 300), targets: pathArgs(seg.argv) }
  }
  // Strict mode last: a real risk anywhere in the command says more than "not on the list".
  // Functions the command itself defines are as safe as their bodies, which are checked here too.
  const defined = new Set(segs.map(seg => /^(?:function|filter)\s+([\w-]+)/i.exec(seg.raw ?? '')?.[1]?.toLowerCase()).filter(Boolean))
  for (const seg of segs) {
    if (defined.has(seg.verb)) continue
    const found = checkStrict(seg, ctx, depth)
    if (found && !ctx.allowed(found)) return { ...found, command: seg.text.slice(0, 300), targets: pathArgs(seg.argv) }
  }
  return null
}

// Strict mode (bcx config set strict on): instead of looking for what is dangerous, only what is known
// to be safe runs without asking. Read-only commands, git and gh queries, tests, builds, linters and infra
// checks; anything else, including what this list doesn't recognize, asks. Only what Codex typed: your own
// scripts and package.json scripts are judged by the usual rules.
const SAFE_VERBS = new Set([
  ...'ls dir gci get-childitem tree cat type gc get-content head tail less more bat rg grep egrep fgrep select-string sls findstr fd wc sort uniq cut tr diff cmp comm file stat du df which where where.exe get-command gcm get-item gi get-itemproperty test-path resolve-path split-path join-path convert-path pwd get-location gl cd set-location sl pushd popd echo printf write-output write-host write-verbose write-error out-null out-string out-host select-object select where-object ? foreach-object % sort-object group-object measure-object format-table ft format-list fl convertfrom-json convertto-json get-date date whoami hostname uname get-process ps get-service sleep start-sleep true exit jq yq sed find basename dirname realpath readlink nl column tac rev od hexdump strings md5sum sha256sum get-filehash get-ciminstance get-wmiobject mkdir md'.split(' '),
  // PowerShell's own words, so a script's structure is not a command
  ...'if elseif else foreach for while do try catch finally switch return break continue param begin process end throw function filter'.split(' ')
])
// Read-only git, by subcommand; branch, tag, remote, stash and config only when they list or read.
const SAFE_GIT = /^(status|log|diff|show|blame|ls-files|ls-tree|rev-parse|rev-list|describe|grep|shortlog|cat-file|merge-base|name-rev|whatchanged|fetch|version|help|count-objects|for-each-ref|show-ref|check-ignore)$/
function gitReads(argv) {
  const { sub, rest } = gitArgs(argv)
  const named = rest.filter(a => !a.startsWith('-'))
  if (SAFE_GIT.test(sub)) return true
  if (sub === 'branch') return (!named.length || rest.some(a => /^(-l|--list)$/.test(a))) && !rest.some(a => /^-[dDmMcCf]$|^--(delete|move|copy|force|set-upstream|unset-upstream|edit-description)/.test(a))
  if (sub === 'tag') return !named.length || rest.some(a => /^(-l|--list)$/.test(a))
  if (sub === 'remote') return !named.length || /^(show|get-url)$/.test(named[0])
  if (sub === 'stash') return /^(list|show)$/.test(named[0] || '')
  if (sub === 'config') return rest.some(a => /^(--get|--get-all|--get-regexp|--list|-l)$/.test(a))
  if (/^(worktree|submodule|reflog)$/.test(sub)) return !named.length || /^(list|status|show)$/.test(named[0])
  return false
}
// gh that only reads: list, view, status, checks, diff, and api calls that are plain GETs.
function ghReads(argv) {
  const [group, action] = argv.slice(1).filter(a => !a.startsWith('-'))
  if (group === 'api') return !argv.some((a, i) => (/^(-X|--method)$/.test(a) && !/^GET$/i.test(argv[i + 1] || '')) || /^(-f|-F|--field|--raw-field|--input)$/.test(a))
  if (/^(auth|search|status)$/.test(group)) return group !== 'auth' || action === 'status'
  return /^(issue|pr|run|release|repo|workflow|gist|label|cache|secret|variable)$/.test(group) && /^(list|view|status|checks|diff|ls)$/.test(action || '') && group !== 'secret'
}
const VERSION_OR_HELP = /^\S+\s+(--version|-v|-V|version|--help|-h|help)\s*$/i
const PACKAGE_READS = /^(npm|pnpm|yarn|bun)(\.cmd)?\s+(ls|list|view|info|outdated|why|explain|run|config\s+get|help)(\s+--?[\w-]+)*\s*$|^(npm|pnpm|yarn)(\.cmd)?\s+audit(?![\s\S]*\bfix\b)|^pip3?\s+(list|show|freeze)\b|^npx\s+prettier\b[\s\S]*--check\b|^nvm\s+(list|ls|current|version)\b|^winget\s+(list|show|search)\b/i
// Syntax checks and builds the shared VERIFY list doesn't name.
const CHECKS = /^(node|deno|bun)\s+--check\s|^\.?[\\/]?gradlew?(\.bat)?\s+\S*(compile|build|assemble|test|lint|check)\w*/i
// What an expression does: printing a value is fine; calling something that changes things is not.
const CHANGES = /\.(Delete|Write\w*|Remove\w*|Move\w*|Copy\w*|Create\w*|Kill|Stop|Start|Invoke\w*|Save\w*|Append\w*|Clear|Set\w*|Execute\w*|Send\w*|Upload\w*|Download\w*)\s*\(/i
// [Type]::Member reads: [IO.Path]::GetFileName, [IO.File]::ReadAllText, [System.Drawing.Image]::FromFile…
const STATIC_READ = /^\[[\w.]+\]::(Get\w*|Read\w*|Exists|Parse|TryParse|From\w*|To\w*|Is\w*|Combine|Join|Format|Equals|Compare|Max|Min|Abs|Round|Floor|Ceiling|Sqrt|Pow|Now|UtcNow|Today|NewLine|Empty|Escape|Unescape|NetworkToHostOrder|HostToNetworkOrder|Matches|Match|IsMatch|Split|DirectorySeparatorChar|PathSeparator)\b/i
const KEYWORD_CALL = /^(if|elseif|foreach|for|while|switch|catch|function|filter)\s*\(/i

// Does this expression only compute and print? Quotes, variables, numbers, arrays, casts, format strings.
const expressionReads = raw => /^([$"'@(\d-]|\[[\w.]+\]\s*[@$("'\d])/.test(raw) && !CHANGES.test(raw) && !/\[[\w.]+\]::(?!\w+\b)/.test(raw) && ![...raw.matchAll(/\[[\w.]+\]::\w+/g)].some(m => !STATIC_READ.test(m[0]))

function strictSafe(seg, ctx, depth = 0) {
  if (depth > 3) return false
  const raw = (seg.raw ?? seg.text).trim()
  if (!raw || /^[)}\]]+$/.test(raw)) return true
  // A line of flags only continues the command before it (Sort-Object Length ⏎ -Descending).
  if (seg.argv.every(a => /^-[A-Za-z][\w-]*$/.test(a))) return true
  if (/^new-item\b/i.test(raw) && /-ItemType\s+["']?Directory/i.test(raw)) return true
  if (shellWrites(raw).some(p => !/^(\$null|nul|\/dev\/null|&\d)$/i.test(p))) return false
  // $x = …: what is assigned decides. A string, number or expression only computes; a command must be safe.
  const assign = /^\$[\w:]+(\.\w+)*\s*[+-]?=\s*([\s\S]*)$/.exec(raw)
  if (assign) return !assign[2] || expressionReads(assign[2]) || segments(assign[2]).every(s => strictSafe(s, ctx, depth + 1))
  if (KEYWORD_CALL.test(raw)) return !CHANGES.test(raw)
  if (/^\[[\w.]+\]::/.test(raw)) return STATIC_READ.test(raw) && !CHANGES.test(raw)
  if (/^([$"'@(\d]|\[[\w.]+\]\s*[@$("'\d])/.test(raw)) return expressionReads(raw)
  const verb = seg.verb
  if (verb === 'git') return gitReads(seg.argv)
  if (verb === 'gh') return ghReads(seg.argv)
  if (verb === 'add-type') return seg.argv.some(a => /^-AssemblyName$/i.test(a)) && !seg.argv.some(a => /^-(TypeDefinition|MemberDefinition|Path|LiteralPath)$/i.test(a))
  if (SAFE_VERBS.has(verb)) {
    if (verb === 'sed' || verb === 'yq') return !seg.argv.some(a => /^-[a-z]*i/.test(a))
    if (verb === 'find') return !seg.argv.some(a => /^-(delete|exec|execdir|ok|fprint\w*|fls)$/.test(a))
    if (verb === 'sort') return !seg.argv.some(a => /^-o$|^--output/.test(a))
    return !CHANGES.test(raw)
  }
  const plain = withoutExt(seg.text)
  if (VERSION_OR_HELP.test(plain) || PACKAGE_READS.test(plain) || CHECKS.test(plain) || VERIFY.test(plain) || KINDS.some(k => k.ran.test(plain))) return true
  // An alias is as safe as what it expands to (ll = ls -la).
  const def = ctx.alias(verb)
  if (def && !ctx.expanding.has(verb)) {
    ctx.expanding.add(verb)
    try {
      return segments(expand(def, seg.argv.slice(1))).every(s => strictSafe(s, ctx, depth + 1))
    } finally {
      ctx.expanding.delete(verb)
    }
  }
  return false
}

// git commit, npm install, node script.js: the command and its subcommand, so a yes or `bcx allow`
// covers that kind of command, whatever its arguments.
const MULTIPLEXERS = /^(git|npm|pnpm|yarn|bun|npx|pnpx|bunx|docker|kubectl|helm|gh|cargo|go|dotnet|terraform|tofu|aws|az|gcloud|pip|pip3|python|python3|py|node|deno|make|mvn|gradle|gradlew)$/
const commandKey = seg => {
  const verb = seg.argv[0]
  if (!MULTIPLEXERS.test(seg.verb)) return verb
  const sub = seg.verb === 'git' ? gitArgs(seg.argv).sub : seg.argv[1]
  return sub ? `${verb} ${sub}` : verb
}

function checkStrict(seg, ctx, depth) {
  if (!ctx.strict || depth > 0 || ctx.reading || strictSafe(seg, ctx)) return null
  return { rule: 'strict', severity: 'high', detail: `\`${commandKey(seg)}\` isn't on the strict-mode list (read-only commands, tests, builds)`, save: { git: ctx.cwd } }
}

// The first risky thing a tool call would do, or null. strict: only known-safe commands go through.
export function inspect({ toolName, toolInput, cwd, created = [], touched = [], userDirty = [], aliases, allow, session, strict = false }) {
  const ctx = context({ cwd, created, touched, userDirty, aliases, allow, session })
  ctx.strict = strict
  if (/apply_patch|edit|write/i.test(toolName || '') || patchFiles(toolInput).length) {
    const found = checkPatch(toolInput, ctx)
    if (found && !ctx.allowed(found)) return { ...found, command: 'apply_patch', targets: patchFiles(toolInput).map(f => f.path) }
  }
  for (const command of toolCommands(toolName, toolInput)) {
    const found = inspectCommand(command, ctx, 0)
    if (found) return found
  }
  return null
}

// Same risk, same target: Codex may retry with other flags or syntax (rm -rf x / Remove-Item -Recurse x).
export const sameAction = (a, b) => a.rule === b.rule && a.detail === b.detail

// undo: better-codex will save a copy first if the user approves (src/undo.js), so the question can say so.
export function denyReason(found, { undo = false } = {}) {
  const rule = RULES[found.rule]
  return [
    `[better-codex guard] BLOCKED (${found.severity}): ${rule.title.en} — ${found.detail}.`,
    `Risk: ${rule.risk.en}.`,
    'Do not run it and do not work around this block with an equivalent command. First ask the user, in their language and briefly:',
    `1) the exact command and what it will do, 2) why their request needs it, 3) what could be lost or affected, 4) a safer alternative (${rule.safer}).`,
    ...(undo ? ['If they approve, better-codex saves a copy of what it can destroy first, and `bcx undo` puts it back: tell them.'] : []),
    'Show the command with literal paths (no variables). Then end your turn and wait. If the user approves in their next message, that exact command is allowed once.'
  ].join('\n')
}

// How a question about each risk sounds, in Spanish or English.
const ASKS = {
  delete: /borr|elimin|delet|remov|\brm\b|rmdir|rimraf|limpi|clean|purg|wipe|vac[ií]/iu,
  'git-discard': /descart|discard|reset|restor|checkout|switch|revert|stash|clean|perd|lose|deshac|undo/iu,
  'git-history': /push|force|histor|rebase|reflog|rama|branch|filter|amend|reescrib|rewrit|prune/iu,
  'git-secrets': /git add|commit|stage|agreg|añad|\badd\b/iu,
  'secrets-read': /lee|leer|mostr|muestr|abr|read|show|print|imprim|\bcat\b|get-content|\btype\b|conten/iu,
  'secrets-write': /escrib|edit|modific|cambi|actualiz|sobrescrib|reemplaz|copi|write|overwrit|replac|chang|updat|\bcopy\b/iu,
  database: /drop|truncat|delete|borr|elimin|reset|migra|flush|wipe|base de datos|database|tabla|table/iu,
  infra: /deploy|despl|publi|destro|destru|apply|delete|elimin|borr|prod|release|lanz|submit/iu,
  system: /regist|disk|disco|format|apag|reinic|shutdown|restart|permis|firewall|defender|antivirus|pol[ií]tica|policy|restaur|restore/iu,
  'remote-exec': /descarg|download|instal|script|ejecut|\brun\b|curl|iwr|irm|iex/iu,
  hidden: /escond|ocult|codific|base64|eval|iex|invoke-expression|ejecut|corr|\brun\b|hidden|encod|decod/iu,
  kill: /cerr|termin|\bmat|kill|stop|deten|proces|taskkill/iu,
  'global-config': /global|config|identidad|identity|registr|variable|entorno|environment|setx|npmrc/iu,
  'bcx-settings': /bcx|better-codex|permis|allow|config|guard|hooks/iu,
  strict: /ejecut|corr|comando|permit|instal|run|command|allow|install/iu
}

const words = text =>
  String(text ?? '')
    .toLowerCase()
    .replace(/\\/g, '/')
    .split(/[\s"'`´«»“”‘’,;()[\]{}¿?¡!*]+/)
    .map(w => w.replace(/[.:]+$/, '').replace(/^\.\//, '').replace(/(.)\/+$/, '$1'))
    .filter(Boolean)

// The user said yes right after Codex asked something. That yes covers this action only if the
// question showed the exact command, or said what it does and named every path it touches.
export function askedFor(found, question, cwd) {
  if (!found || !question) return false
  const said = words(question)
  const command = words(found.command)
  if (found.command !== 'apply_patch' && command.length >= 2) {
    for (let i = 0; i + command.length <= said.length; i++) {
      if (command.every((w, j) => said[i + j] === w)) return true
    }
  }
  const targets = found.targets || []
  if (!ASKS[found.rule]?.test(question) || !targets.length || targets.some(t => /[$%]/.test(t))) return false
  const at = path => toPosix(resolve(cwd, path)).toLowerCase()
  const named = new Set(said)
  const resolved = new Set(said.map(at))
  return targets.every(t => {
    const path = String(t).replace(/^["']|["']$/g, '')
    const key = path.toLowerCase().replace(/\\/g, '/').replace(/^\.\//, '').replace(/(.)\/+$/, '$1')
    return named.has(key) || resolved.has(at(path))
  })
}

const YES = /^\s*(s[ií]+|sip|sim[oó]n|dale|adelante|ok(ay|ey)?|va|vale|claro|hazlo|h[aá]gale|h[aá]gal[oa]|procede|contin[uú]a|autoriz\p{L}*|apruebo|aprobad[oa]|confirm\p{L}*|de acuerdo|yes|yep|yeah|go(\s+ahead)?|do\s+it|proceed|approved?|sure|👍)(?![\p{L}])/iu
const NO = /(?<![\p{L}])(no|nel|nop|espera|wait|cancel\p{L}*|det[eé]n\p{L}*|stop|mejor\s+no|don'?t|a[uú]n\s+no|todav[ií]a\s+no|pero|but)(?![\p{L}])/iu

// An approval is a short, clear yes. "sí, pero…" is not: Codex has to confirm again.
export const isApproval = prompt => YES.test(prompt) && !NO.test(prompt)
