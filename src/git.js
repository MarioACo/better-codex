import { run } from './util.js'

const git = (cwd, ...args) => run('git', ['-c', 'core.quotepath=off', ...args], { cwd })

// The root never changes while a process lives, and a hook may ask several times.
const roots = new Map()
export const lookups = { root: 0 }
export function gitRoot(cwd) {
  if (!roots.has(cwd)) {
    lookups.root++
    roots.set(cwd, git(cwd, 'rev-parse', '--show-toplevel'))
  }
  return roots.get(cwd)
}

// Each hook is a new process: the session state carries the roots earlier hooks already found.
export const knownRoots = () => Object.fromEntries([...roots].slice(-20))
export function rememberRoots(saved = {}) {
  for (const [cwd, root] of Object.entries(saved || {})) if (!roots.has(cwd)) roots.set(cwd, root)
}

export const gitBranch = cwd => git(cwd, 'branch', '--show-current') || git(cwd, 'rev-parse', '--short', 'HEAD')

// Paths with uncommitted changes, staged or not, untracked included.
export function gitChanges(cwd) {
  const out = git(cwd, 'status', '--porcelain')
  return out ? out.split('\n').filter(Boolean).map(line => line.slice(3).replace(/^.* -> /, '')) : []
}

// Tracked plus untracked-but-not-ignored files, relative to cwd, with forward slashes.
export function gitFiles(cwd) {
  const out = git(cwd, 'ls-files', '-z', '--cached', '--others', '--exclude-standard')
  return out ? [...new Set(out.split('\0').filter(Boolean))] : []
}
