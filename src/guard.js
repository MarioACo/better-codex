import { existsSync, realpathSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, dirname, isAbsolute, join, relative, resolve } from 'node:path'
import { gitRoot } from './git.js'
import { pathArgs, patchFiles, segments, shellWrites, toolCommands, verbOf } from './shell.js'
import { readJson, readText, run, toPosix } from './util.js'

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
  }
}

const SECRET = /(^|[\\/])(\.env(\.(?!example\b|sample\b|template\b|dist\b|defaults?\b)[\w.-]+)?|\.npmrc|\.pypirc|\.netrc|\.git-credentials|id_(rsa|dsa|ecdsa|ed25519)|[\w.-]*\.(pem|key|p12|pfx|keystore|jks|ppk)|credentials(\.(json|ya?ml|toml|xml|csv))?|[\w.-]*service[-_]?account[\w.-]*\.json|auth\.json|secrets?\.(json|ya?ml|toml))$/i
export const isSecretPath = path => SECRET.test(String(path).replace(/["']/g, ''))

// Folders and files that are regenerated by a build or install: deleting them loses nothing.
// .git/refs/codex/ holds Codex's own turn-diff snapshots.
const SAFE_DELETE = /(^|[\\/])(node_modules|dist|build|out|coverage|\.next|\.nuxt|\.svelte-kit|\.angular|\.turbo|\.cache|\.parcel-cache|target|tmp|temp|\.tmp|__pycache__|\.pytest_cache|\.mypy_cache|\.ruff_cache|\.gradle|obj|\.expo|DerivedData|[^\\/]*\.(log|tmp|pyc|tsbuildinfo)|\.DS_Store)[\\/]?$|(^|[\\/])\.git[\\/]refs[\\/]codex([\\/]|$)/i
const EVERYTHING = /^(\/|[a-z]:[\\/]?|~[\\/]?|\$home[\\/]?|\$env:userprofile[\\/]?|%userprofile%[\\/]?|\*|\.[\\/]?\*?|\.\.[\\/]?\*?|\.git[\\/]?)$/i

const DELETE_VERBS = new Set(['rm', 'del', 'erase', 'rd', 'rmdir', 'remove-item', 'ri', 'unlink', 'shred', 'rimraf', 'trash'])
const READ_VERBS = new Set(['cat', 'type', 'bat', 'less', 'more', 'head', 'tail', 'nl', 'get-content', 'gc', 'rg', 'grep', 'select-string', 'sls', 'findstr', 'awk', 'sed', 'strings', 'base64', 'certutil'])
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
  /^kubectl\s+(delete|drain)\b/i,
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
function context({ cwd, created = [], touched = [], userDirty = [] }) {
  const root = gitRoot(cwd)
  const realRoot = root && real(root)
  let status = null
  const createdSet = new Set(created)
  const touchedSet = new Set(touched)
  const userDirtySet = new Set(userDirty)
  const ctx = {
    cwd,
    root,
    lists: { created, touched, userDirty },
    abs: p => toPosix(resolve(cwd, String(p).replace(/^["']|["']$/g, ''))),
    isTouched: abs => touchedSet.has(norm(abs)) || createdSet.has(norm(abs)),
    status: () => (status ??= gitStatusMap(root)),
    // git answers with real paths; the shell may be under a symlink (macOS /var → /private/var).
    rel: abs => (root ? toPosix(relative(realRoot, real(abs))) : null),
    inside: abs => !!root && !ctx.rel(abs).startsWith('..') && !isAbsolute(ctx.rel(abs)),
    // Git can give it back: tracked and without uncommitted changes.
    recoverable(abs) {
      if (!ctx.inside(abs)) return false
      const rel = ctx.rel(abs)
      if ([...ctx.status().keys()].some(p => p === rel || p.startsWith(`${rel}/`))) return false
      return run('git', ['ls-files', '--error-unmatch', '--', rel], { cwd: root }) !== null
    },
    isCreated: abs => createdSet.has(norm(abs)),
    // Uncommitted work Codex would destroy that is not only its own: yours, or from before this session.
    protectedChanges(paths = [], { untrackedOnly = false } = {}) {
      const scope = paths.filter(p => p !== '.' && p !== '*').map(p => ctx.rel(ctx.abs(p)))
      return [...ctx.status()]
        .filter(([path, code]) => !untrackedOnly || code === '??')
        .filter(([path]) => !scope.length || scope.some(s => path === s || path.startsWith(`${s}/`) || s.startsWith(`${path}`)))
        .map(([path]) => norm(`${root}/${path}`))
        .filter(abs => userDirtySet.has(abs) || !(touchedSet.has(abs) || [...createdSet].some(c => c === abs || c.startsWith(abs))))
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

const inTemp = abs => norm(real(abs)).startsWith(norm(real(tmpdir())))

const describe = target => (/^[$%]/.test(target) ? `${target} (a variable: the path is only known when it runs)` : target)

// find . -name "*.log" -delete, find dist -exec rm -rf {} +
function checkFind(seg, ctx) {
  const a = seg.argv
  const exec = a.findIndex(x => /^-(exec|execdir|ok)$/.test(x))
  if (!a.includes('-delete') && !(exec !== -1 && DELETE_VERBS.has(verbOf(a[exec + 1])))) return null
  const start = pathArgs(a).find(x => !x.startsWith('(')) || '.'
  const nameFlag = a.findIndex(x => /^-i?name$/.test(x))
  const name = nameFlag === -1 ? null : a[nameFlag + 1]
  if (SAFE_DELETE.test(start) || (name && SAFE_DELETE.test(name)) || ctx.isCreated(ctx.abs(start))) return null
  return { rule: 'delete', severity: 'high', detail: `find deletes${name ? ` every ${name}` : ' everything it matches'} under ${start}` }
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
    if (listed.length && listed.every(t => SAFE_DELETE.test(t) || ctx.isCreated(ctx.abs(t)) || (!ctx.inside(ctx.abs(t)) && inTemp(ctx.abs(t))))) return null
    const from = seg.source ? `\`${seg.source.text.slice(0, 120)}\`` : 'the previous command'
    return { rule: 'delete', severity: 'high', detail: `deletes whatever ${from} lists${recursive ? ', recursively' : ''}` }
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
    if (SAFE_DELETE.test(target) || ctx.isCreated(abs)) continue
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
  return { rule: 'delete', severity: critical ? 'critical' : 'high', detail: `deletes ${risky.map(describe).join(', ')}${recursive ? ' recursively' : ''}` }
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
  const hit = (rule, detail, severity = 'high') => ({ rule, severity, detail })
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
    if (has(/^-[a-z]*x|^-X$/)) return hit('git-discard', `${seg.text} also deletes ignored files such as .env and local config`, 'critical')
    const files = lost(rest.filter(a => !a.startsWith('-')), { untrackedOnly: true })
    if (files) return hit('git-discard', `${seg.text} deletes untracked files, which git cannot restore${files}`)
  }
  if (sub === 'stash' && /^(drop|clear)$/i.test(rest[0] || '')) return hit('git-discard', `git stash ${rest[0]} deletes stashed work`)
  if (sub === 'worktree' && rest[0] === 'remove' && has(/^(-f|--force)$/)) {
    return hit('git-discard', `${seg.text} deletes a worktree with its uncommitted changes`)
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
    if (named.some(isSecretPath)) return hit('git-secrets', `stages ${named.filter(isSecretPath).join(', ')}`)
    if (named.includes('.') || named.includes('*') || has(/^(-A|--all|-u)$/) || !named.length) {
      const secrets = [...ctx.status()].filter(([path, code]) => code === '??' && isSecretPath(path)).map(([path]) => path)
      if (secrets.length) return hit('git-secrets', `would stage ${secrets.join(', ')} (not in .gitignore)`)
    }
  }
  if (sub === 'commit' && has(/^(-a|--all|-am)$/)) {
    const secrets = [...ctx.status()].filter(([path, code]) => code !== '??' && isSecretPath(path)).map(([path]) => path)
    if (secrets.length) return hit('git-secrets', `commits changes to ${secrets.join(', ')}`)
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
      return { rule: 'secrets-write', severity: 'high', detail: `${seg.verb} over the existing ${dest}` }
    }
  }
  if ((/^(printenv|env)$/.test(seg.verb) && seg.argv.length === 1) || /^(get-childitem|gci|dir|ls)\s+env:\\?\s*$/i.test(seg.text) || (seg.verb === 'set' && seg.argv.length === 1)) {
    return { rule: 'secrets-read', severity: 'high', detail: `${seg.text} prints every environment variable, tokens included` }
  }
  const written = shellWrites(seg.text).filter(isSecretPath)
  if (written.length) return { rule: 'secrets-write', severity: 'high', detail: `writes ${written.join(', ')}` }
  return null
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
  const deleted = files.filter(f => f.op === 'delete')
  const secrets = files.filter(f => f.op !== 'add' && isSecretPath(f.path))
  if (secrets.length) return { rule: 'secrets-write', severity: 'high', detail: `edits ${secrets.map(f => f.path).join(', ')}` }
  const lost = deleted.filter(f => {
    const abs = ctx.abs(f.path)
    return !SAFE_DELETE.test(f.path) && !ctx.isCreated(abs) && !ctx.recoverable(abs)
  })
  if (lost.length) return { rule: 'delete', severity: 'high', detail: `deletes ${lost.map(f => f.path).join(', ')} (uncommitted or untracked: git cannot restore it)` }
  if (deleted.length >= 10) return { rule: 'delete', severity: 'high', detail: `deletes ${deleted.length} files in one patch` }
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

const INLINE_FLAG = { node: /^(-e|--eval|-p|--print)$/, bun: /^(-e|--eval)$/, deno: /^eval$/, python: /^-c$/, python3: /^-c$/, py: /^-c$/, ruby: /^-e$/, perl: /^-e$/, php: /^-r$/ }

// Code that deletes folders or runs destructive SQL. Literal targets that are build output are fine.
function codeRisk(code, what) {
  if (DANGEROUS_CODE.test(code)) {
    const targets = [...code.matchAll(CODE_TARGET)].map(m => m[1])
    if (!targets.length || !targets.every(t => SAFE_DELETE.test(t))) {
      return { rule: 'delete', severity: 'high', detail: `${what} deletes folders from code${targets.length ? ` (${targets.slice(0, 3).join(', ')})` : ''}` }
    }
  }
  const sql = DESTRUCTIVE_SQL.find(re => re.test(code))
  return sql ? { rule: 'database', severity: 'critical', detail: `${what} runs destructive SQL (${sql.exec(code)[0].slice(0, 60)})` } : null
}

// node -e "fs.rmSync('src', {recursive: true})", python -c "import shutil; shutil.rmtree('data')"
function checkInline(seg) {
  const flag = INLINE_FLAG[seg.verb]
  const i = flag ? seg.argv.findIndex((a, n) => n > 0 && flag.test(a)) : -1
  return i === -1 ? null : codeRisk(seg.argv.slice(i + 1).join(' '), `${seg.verb} ${seg.argv[i]}`)
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
    const found = inspectCommand(body, ctx, depth + 1)
    return found && { ...found, detail: `${file} → ${found.detail}` }
  }
  if (!TEST_FILE.test(file) && ctx.isTouched(abs)) return codeRisk(text, file)
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
  const child = found.dir === ctx.cwd ? ctx : context({ cwd: found.dir, ...ctx.lists })
  for (const script of [scripts[`pre${name}`], scripts[name], scripts[`post${name}`]].filter(Boolean)) {
    const inner = inspectCommand(script, child, depth + 1)
    if (inner) return { ...inner, detail: `${seg.verb} ${name} → ${inner.detail}` }
  }
  return null
}

function inspectCommand(command, ctx, depth) {
  if (depth > 3) return null
  if (REMOTE_EXEC.test(command)) return { rule: 'remote-exec', severity: 'high', detail: command.slice(0, 200), command: command.slice(0, 300) }
  if (ENV_WRITE.test(command)) return { rule: 'global-config', severity: 'high', detail: 'sets a user or machine environment variable', command: command.slice(0, 300) }
  for (const seg of segments(command)) {
    const found =
      checkDelete(seg, ctx) ||
      checkGit(seg, ctx) ||
      checkSecrets(seg, ctx) ||
      checkPatterns(seg) ||
      checkKill(seg) ||
      checkGlobalConfig(seg) ||
      checkInline(seg) ||
      checkScript(seg, ctx, depth) ||
      checkNpmScript(seg, ctx, depth)
    // What Codex ran is the outer command; the detail tells what it leads to.
    if (found) return { ...found, command: seg.text.slice(0, 300), targets: pathArgs(seg.argv) }
  }
  return null
}

// The first risky thing a tool call would do, or null.
export function inspect({ toolName, toolInput, cwd, created = [], touched = [], userDirty = [] }) {
  const ctx = context({ cwd, created, touched, userDirty })
  if (/apply_patch|edit|write/i.test(toolName || '') || patchFiles(toolInput).length) {
    const found = checkPatch(toolInput, ctx)
    if (found) return { ...found, command: 'apply_patch', targets: patchFiles(toolInput).map(f => f.path) }
  }
  for (const command of toolCommands(toolName, toolInput)) {
    const found = inspectCommand(command, ctx, 0)
    if (found) return found
  }
  return null
}

// Same risk, same target: Codex may retry with other flags or syntax (rm -rf x / Remove-Item -Recurse x).
export const sameAction = (a, b) => a.rule === b.rule && a.detail === b.detail

export function denyReason(found) {
  const rule = RULES[found.rule]
  return [
    `[better-codex guard] BLOCKED (${found.severity}): ${rule.title.en} — ${found.detail}.`,
    `Risk: ${rule.risk.en}.`,
    'Do not run it and do not work around this block with an equivalent command. First ask the user, in their language and briefly:',
    `1) the exact command and what it will do, 2) why their request needs it, 3) what could be lost or affected, 4) a safer alternative (${rule.safer}).`,
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
  kill: /cerr|termin|\bmat|kill|stop|deten|proces|taskkill/iu,
  'global-config': /global|config|identidad|identity|registr|variable|entorno|environment|setx|npmrc/iu
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
