import { copyFileSync, existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { basename, dirname, join, resolve } from 'node:path'
import { gitRoot } from './git.js'
import { isGenerated } from './guard.js'
import { pick } from './i18n.js'
import { dataDir } from './paths.js'
import { readJson, run, writeJson } from './util.js'

// Before an action you approved runs, a copy of what it can destroy, so `bcx undo` can bring it back:
// the files it deletes or overwrites, or, for git commands, the repo's uncommitted work (untracked
// files included) and every branch, stash and remote tip, kept as one commit under refs/bcx/undo/.
// Generated folders (node_modules, caches) are left out; past the limits nothing is copied, and you're told.

export const LIMITS = { bytes: 100 * 1024 * 1024, files: 10000, keep: 20, days: 14 }
const DAY = 24 * 60 * 60 * 1000
// Snapshot commits are better-codex's own objects, like `git stash create`: never your identity, never signed.
const IDENTITY = { GIT_AUTHOR_NAME: 'better-codex', GIT_AUTHOR_EMAIL: 'undo@better-codex.invalid', GIT_COMMITTER_NAME: 'better-codex', GIT_COMMITTER_EMAIL: 'undo@better-codex.invalid' }

export const undoDir = () => join(dataDir(), 'undo')
const git = (root, args, options = {}) => run('git', ['-c', 'core.quotepath=off', ...args], { cwd: root, timeout: 8000, ...options })
const lines = text => (text || '').split('\n').filter(Boolean)
// Milliseconds, always after the last copy, so names sort in the order the copies were made.
function newId() {
  let last = 0
  try {
    last = Math.max(0, ...readdirSync(undoDir()).map(name => Number(name.split('-')[0]) || 0))
  } catch {}
  return `${Math.max(Date.now(), last + 1)}-${Math.random().toString(36).slice(2, 6)}`
}

export function humanBytes(n) {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`
  return `${(n / 1024 / 1024).toFixed(n < 10 * 1024 * 1024 ? 1 : 0)} MB`
}

// The files under `paths`, generated folders left out, or `over` when they pass the limits.
function collect(paths, limits) {
  const files = []
  let bytes = 0
  const walk = (abs, target, rel) => {
    if (files.length > limits.files || bytes > limits.bytes) return
    let stat
    try {
      stat = lstatSync(abs)
    } catch {
      return
    }
    if (stat.isDirectory()) {
      let names = []
      try {
        names = readdirSync(abs)
      } catch {}
      for (const name of names) if (!isGenerated(name)) walk(join(abs, name), target, rel ? `${rel}/${name}` : name)
    } else if (stat.isFile()) {
      files.push({ abs, target, rel })
      bytes += stat.size
    }
  }
  paths.forEach((path, target) => walk(path, target, ''))
  return files.length > limits.files || bytes > limits.bytes ? { over: true } : { files, bytes }
}

// git clean -fdx removes what git clean -ndx lists.
function cleanTargets({ cwd, argv }) {
  const args = argv
    .slice(1)
    .filter(a => !/^(-q|--quiet)$/.test(a))
    .map(a => (a === '--force' ? '--dry-run' : /^-[a-zA-Z]+$/.test(a) && /[fq]/.test(a) ? `${a.replace(/[fq]/g, '')}n` : a))
  return lines(run('git', args, { cwd, timeout: 8000 }))
    .map(line => /^Would remove (.+)$/.exec(line)?.[1])
    .filter(Boolean)
    .map(path => resolve(cwd, path.replace(/[\\/]$/, '')))
}

const wanted = (save, limits) => [...new Set([...(save.paths || []), ...(save.clean ? cleanTargets(save.clean) : [])])].filter(p => existsSync(p) && !isGenerated(p))

function copyFiles(paths, dir, limits) {
  const found = collect(paths, limits)
  if (found.over) return { skipped: `over ${humanBytes(limits.bytes)} or ${limits.files} files` }
  for (const file of found.files) {
    const to = join(dir, 'files', String(file.target), file.rel)
    mkdirSync(dirname(to), { recursive: true })
    copyFileSync(file.abs, to)
  }
  return { paths: paths.map(path => ({ path, dir: lstatSync(path).isDirectory() })), count: found.files.length, bytes: found.bytes }
}

function refsOf(root) {
  const refs = {}
  for (const line of lines(git(root, ['for-each-ref', '--format=%(objectname) %(refname)', 'refs/heads', 'refs/remotes', 'refs/stash']))) {
    const [sha, name] = line.split(' ')
    refs[name] = sha
  }
  return refs
}
const stashOf = root => lines(git(root, ['log', '-g', '--format=%H', 'refs/stash']))

// [status, path] of each file that differs from tree `a` (or nothing, without commits) to tree `b`.
function treeChanges(root, a, b) {
  if (!a) return lines(git(root, ['ls-tree', '-r', '--name-only', b])).map(path => ['A', path])
  const parts = (git(root, ['diff-tree', '-r', '--no-renames', '-z', '--name-status', a, b]) || '').split('\0')
  const out = []
  for (let i = 0; i + 1 < parts.length; i += 2) out.push([parts[i], parts[i + 1]])
  return out
}

// The working tree as git would commit it, read through a copy of the index: yours is never touched
// (no index.lock while Codex runs its own git commands).
function gitSnapshot(cwd, dir, id, message, limits) {
  const root = gitRoot(cwd)
  if (!root) return null
  const index = join(dir, 'index')
  const real = git(root, ['rev-parse', '--git-path', 'index'])
  if (real && existsSync(resolve(root, real))) copyFileSync(resolve(root, real), index)
  const env = { GIT_INDEX_FILE: index, ...IDENTITY }
  try {
    const staged = git(root, ['write-tree'], { env })
    const tree = git(root, ['add', '-A'], { env }) === null ? null : git(root, ['write-tree'], { env })
    if (!tree) return { skipped: 'git could not read the working tree in time' }
    const head = git(root, ['rev-parse', '--verify', '-q', 'HEAD'])
    const refs = refsOf(root)
    const stash = stashOf(root)
    const commit = (of, parents, text) => git(root, ['commit-tree', '--no-gpg-sign', of, ...parents.flatMap(p => ['-p', p]), '-m', text], { env })
    const indexCommit = staged && commit(staged, head ? [head] : [], 'index')
    const parents = [...new Set([head, indexCommit, ...Object.values(refs), ...stash].filter(Boolean))].slice(0, 100)
    const snap = commit(tree, parents, message)
    const ref = `refs/bcx/undo/${id}`
    if (!snap || git(root, ['update-ref', ref, snap]) === null) return { skipped: 'git could not save the snapshot' }
    // Your uncommitted files byte for byte too: through git they would come back with autocrlf and filters applied.
    const changes = treeChanges(root, head, tree)
    const present = changes.filter(([status]) => status !== 'D').map(([, path]) => path)
    for (const file of collect(present.map(path => join(root, path)), limits).files || []) {
      const to = join(dir, 'worktree', present[file.target])
      mkdirSync(dirname(to), { recursive: true })
      copyFileSync(file.abs, to)
    }
    return { root, ref, commit: snap, tree, head, branch: git(root, ['branch', '--show-current']) || null, refs, stash, changed: changes.length }
  } finally {
    rmSync(index, { force: true })
  }
}

// Whether `backup` would save something: said to Codex when it asks, so you know there is a way back.
export function canBackup(found, limits = LIMITS) {
  const save = found?.save
  if (!save) return false
  if (save.git && gitRoot(save.git)) return true
  const paths = wanted(save, limits)
  return paths.length > 0 && !collect(paths, limits).over
}

// protect: a copy being restored, which pruning must not take away.
export function backup(found, { session = null, limits = LIMITS, protect = null } = {}) {
  const save = found?.save
  if (!save) return null
  const id = newId()
  const dir = join(undoDir(), id)
  const entry = { id, at: Date.now(), session, rule: found.rule, command: String(found.command ?? '').slice(0, 300), detail: found.detail }
  try {
    mkdirSync(dir, { recursive: true })
    const paths = wanted(save, limits)
    if (paths.length) entry.files = copyFiles(paths, dir, limits)
    if (save.git) entry.git = gitSnapshot(save.git, dir, id, `better-codex undo ${id}: ${entry.command}`, limits)
    if (save.config) entry.config = configSnapshot(save.config)
    // A database file or ~/.npmrc is meant to be replaced on undo: it exists again, changed, by design.
    if (save.replace && entry.files?.paths) entry.files.replace = true
  } catch (error) {
    rmSync(dir, { recursive: true, force: true })
    throw error
  }
  if (!entry.files?.paths && !entry.git?.ref && !entry.config) {
    rmSync(dir, { recursive: true, force: true })
    const skipped = entry.files?.skipped || entry.git?.skipped
    return skipped ? { skipped } : null
  }
  writeJson(join(dir, 'undo.json'), entry)
  prune(limits, protect)
  return entry
}

// Newest first.
export function listUndo() {
  let names = []
  try {
    names = readdirSync(undoDir())
  } catch {}
  return names
    .sort()
    .reverse()
    .map(name => readJson(join(undoDir(), name, 'undo.json'), null))
    .filter(Boolean)
}

// The last 20 copies of the last 14 days; older ones go, with their git refs.
function prune(limits, protect) {
  const cutoff = Date.now() - limits.days * DAY
  listUndo().forEach((entry, i) => {
    if ((i < limits.keep && entry.at >= cutoff) || entry.id === protect) return
    if (entry.git?.root && existsSync(entry.git.root)) git(entry.git.root, ['update-ref', '-d', entry.git.ref])
    rmSync(join(undoDir(), entry.id), { recursive: true, force: true })
  })
}

export function summary(entry, lang) {
  const parts = []
  if (entry.files?.paths) {
    const names = entry.files.paths.map(p => basename(p.path)).slice(0, 3).join(', ') + (entry.files.paths.length > 3 ? ', …' : '')
    parts.push(`${names} (${entry.files.count} ${pick(lang, entry.files.count === 1 ? 'archivo' : 'archivos', entry.files.count === 1 ? 'file' : 'files')}, ${humanBytes(entry.files.bytes)})`)
  }
  if (entry.git?.ref) {
    const n = entry.git.changed
    if (!n) parts.push(pick(lang, 'las ramas y el stash del repo', 'the repo’s branches and stash'))
    else parts.push(pick(lang, `el repo (${n} ${n === 1 ? 'archivo' : 'archivos'} sin commit, ramas y stash)`, `the repo (${n} uncommitted ${n === 1 ? 'file' : 'files'}, branches and stash)`))
  }
  if (entry.config) parts.push(`${entry.config.tool === 'git' ? `git config ${entry.config.scope.join(' ')} ${entry.config.key}` : `${entry.config.name} (${pick(lang, 'variable de usuario', 'user variable')})`} ${pick(lang, 'antes', 'was')}: ${entry.config.old?.length ? entry.config.old.join(', ') : pick(lang, 'sin valor', 'unset')}`)
  return parts.join(' + ')
}

const same = (a, b) => {
  try {
    return readFileSync(a).equals(readFileSync(b))
  } catch {
    return false
  }
}

// Saved files go back where they were. One that exists again is left as it is, unless `overwrite`:
// then the current versions are saved first, as a new copy.
function restoreFiles(entry, report, overwrite) {
  const base = join(undoDir(), entry.id, 'files')
  const pairs = []
  const walk = (from, to) => {
    if (!existsSync(from)) return
    if (!lstatSync(from).isDirectory()) return pairs.push([from, to])
    for (const name of readdirSync(from)) walk(join(from, name), join(to, name))
  }
  entry.files.paths.forEach(({ path }, i) => walk(join(base, String(i)), path))
  const conflicts = pairs.filter(([from, to]) => existsSync(to) && !same(from, to))
  overwrite ||= !!entry.files.replace
  if (overwrite && conflicts.length) {
    const before = backup({ rule: 'undo', command: `bcx undo ${entry.id} --overwrite`, detail: 'files before undo', save: { paths: conflicts.map(([, to]) => to) } }, { protect: entry.id })
    if (!before?.id) throw new Error('could not save your current files first, so nothing was changed')
    report.saved.push(before.id)
  }
  for (const [from, to] of pairs) {
    if (existsSync(to) && (same(from, to) || !overwrite)) {
      if (!same(from, to)) report.kept.push({ path: to, copy: from })
      continue
    }
    mkdirSync(dirname(to), { recursive: true })
    copyFileSync(from, to)
    report.restored.push(to)
  }
  for (const { path, dir } of entry.files.paths) if (dir) mkdirSync(path, { recursive: true })
}

function restoreGit(entry, report) {
  const { root } = entry.git
  if (!existsSync(root) || !gitRoot(root)) return report.hints.push(`${root}: the repo is gone, and its snapshot with it`)
  // Undo can be undone: the state right now is saved first.
  const before = backup({ rule: 'undo', command: `bcx undo ${entry.id}`, detail: 'state before undo', save: { git: root } }, { protect: entry.id })
  if (!before?.git?.tree) throw new Error('could not save the current state first, so nothing was changed')
  report.saved.push(before.id)
  const head = git(root, ['rev-parse', '--verify', '-q', 'HEAD'])
  const branch = git(root, ['branch', '--show-current'])
  // reset --hard HEAD~3 moved the branch back: put it where it was (index only, the files come next).
  if (entry.git.head && head && head !== entry.git.head && branch && branch === entry.git.branch) {
    if (git(root, ['merge-base', '--is-ancestor', head, entry.git.head]) !== null && git(root, ['reset', '-q', entry.git.head]) !== null) report.created.push(`${branch} → ${entry.git.head.slice(0, 7)}`)
    else report.hints.push(`git reset ${entry.git.head}   # ${branch} was here`)
  }
  // Files that differ or are missing come back, byte for byte when they were uncommitted; files new since then stay.
  const paths = treeChanges(root, before.git.tree, entry.git.tree)
    .filter(([status]) => status !== 'D')
    .map(([, path]) => path)
  const exact = join(undoDir(), entry.id, 'worktree')
  const fromGit = paths.filter(path => {
    if (!existsSync(join(exact, path))) return true
    mkdirSync(dirname(join(root, path)), { recursive: true })
    copyFileSync(join(exact, path), join(root, path))
    return false
  })
  if (fromGit.length) {
    const list = join(undoDir(), entry.id, 'restore.txt')
    writeFileSync(list, fromGit.join('\0'))
    const done = git(root, ['restore', `--source=${entry.git.commit}`, '--worktree', `--pathspec-from-file=${list}`, '--pathspec-file-nul'], { timeout: 60000 })
    rmSync(list, { force: true })
    if (done === null) throw new Error(`git restore failed; the state before undo is saved (bcx undo ${before.id})`)
  }
  report.restored.push(...paths.map(p => join(root, p)))
  // Deleted branches and dropped stashes come back; branches that moved and remotes are only suggested.
  const now = refsOf(root)
  for (const [ref, sha] of Object.entries(entry.git.refs)) {
    if (now[ref] === sha || ref === `refs/heads/${branch}` || ref.endsWith('/HEAD')) continue
    const name = ref.replace(/^refs\/(heads|remotes)\//, '')
    if (ref.startsWith('refs/heads/') && !now[ref]) {
      if (git(root, ['branch', name, sha]) !== null) report.created.push(`branch ${name}`)
    } else if (ref.startsWith('refs/heads/')) report.hints.push(`git branch -f ${name} ${sha}   # where ${name} was`)
    else if (ref.startsWith('refs/remotes/') && /\bpush\b/.test(entry.command)) {
      const [remote, ...rest] = name.split('/')
      report.hints.push(`git push --force-with-lease ${remote} ${sha}:${rest.join('/')}   # where ${name} was`)
    }
  }
  const stashed = new Set(stashOf(root))
  for (const sha of [...entry.git.stash].reverse()) {
    if (!stashed.has(sha) && git(root, ['stash', 'store', '-m', 'restored by bcx undo', sha]) !== null) report.created.push(`stash ${sha.slice(0, 7)}`)
  }
}

export function restore(entry, { overwrite = false } = {}) {
  const report = { restored: [], kept: [], created: [], hints: [], saved: [] }
  if (entry.files?.paths) restoreFiles(entry, report, overwrite)
  if (entry.git?.ref) restoreGit(entry, report)
  if (entry.config) restoreConfig(entry, report)
  return report
}

// The value a git key or a Windows user variable had before an approved change: [] or null when unset.
function configSnapshot(config) {
  if (config.tool === 'git') return { ...config, old: lines(run('git', ['config', ...config.scope, '--get-all', config.key], { timeout: 4000 })) }
  if (config.tool === 'setx' && process.platform === 'win32') {
    const out = run('reg', ['query', 'HKCU\\Environment', '/v', config.name], { timeout: 4000 })
    const value = out && new RegExp(`^\\s*${config.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s+REG_\\w+\\s*(.*)$`, 'im').exec(out)?.[1]
    return { ...config, old: value == null ? [] : [value.trim()] }
  }
  return null
}

function restoreConfig(entry, report) {
  const { tool, scope, key, name, old } = entry.config
  // Undo can be undone: the value right now is saved first.
  const before = backup({ rule: 'undo', command: `bcx undo ${entry.id}`, detail: 'value before undo', save: { config: entry.config } }, { protect: entry.id })
  if (before?.id) report.saved.push(before.id)
  if (tool === 'git') {
    run('git', ['config', ...scope, '--unset-all', key], { timeout: 4000 })
    for (const value of old) if (run('git', ['config', ...scope, '--add', key, value], { timeout: 4000 }) === null) throw new Error(`git config ${scope.join(' ')} --add ${key} failed`)
    report.restored.push(`git config ${scope.join(' ')} ${key}`)
  } else if (tool === 'setx') {
    const done = old.length ? run('setx', [name, old[0]], { timeout: 8000 }) : run('reg', ['delete', 'HKCU\\Environment', '/v', name, '/f'], { timeout: 8000 })
    if (done === null) throw new Error(`could not set ${name} back`)
    report.restored.push(`${name} (${old.length ? old[0] : 'unset'})`)
  }
}
