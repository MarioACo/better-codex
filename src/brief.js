import { statSync } from 'node:fs'
import { join } from 'node:path'
import { gitBranch, gitChanges, gitFiles, gitRoot } from './git.js'
import { infraLines } from './infra.js'
import { detectProject } from './project.js'
import { duration, slowCommands } from './slow.js'
import { clip, onPath } from './util.js'

export const HANDOFF = '.codex/handoff.md'
const HANDOFF_MAX_AGE_MS = 3 * 24 * 60 * 60 * 1000

// "1234 files · src/ (800) · test/ (120) · …": where the code is, without listing it.
export function layoutOf(files) {
  if (!files.length) return ''
  const dirs = new Map()
  let atRoot = 0
  for (const file of files) {
    const slash = file.indexOf('/')
    if (slash === -1) atRoot++
    else dirs.set(file.slice(0, slash), (dirs.get(file.slice(0, slash)) || 0) + 1)
  }
  const top = [...dirs]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8)
    .map(([dir, n]) => `${dir}/ (${n})`)
  return [`${files.length} files`, ...top, atRoot ? `${atRoot} at root` : ''].filter(Boolean).join(' · ')
}

function handoffLine(root) {
  try {
    const { mtimeMs } = statSync(join(root, HANDOFF))
    if (Date.now() - mtimeMs > HANDOFF_MAX_AGE_MS) return ''
    const when = new Date(mtimeMs).toISOString().slice(0, 16).replace('T', ' ')
    return `- handoff from a previous session: ${HANDOFF} (${when} UTC). Read it first if this task continues that work.`
  } catch {
    return ''
  }
}

export { onPath }

// First calls that failed in real sessions, every time: rg not installed, and npm.ps1 blocked by
// PowerShell's execution policy. Saying so up front saves the failed call and its output.
export function shellLine({ root, commands, platform = process.platform, hasRg = onPath('rg') }) {
  const notes = []
  const node = platform === 'win32' && /\b(npm|pnpm|yarn)\b/.exec(commands)?.[1]
  if (node) notes.push(`in PowerShell call \`${node}.cmd\` (the .ps1 wrapper may be blocked)`)
  if (!hasRg) notes.push(`\`rg\` is not installed: search with ${root ? '`git grep -n`' : platform === 'win32' ? '`Select-String`' : '`grep -rn`'}`)
  return notes.length ? `- shell: ${notes.join('; ')}` : ''
}

// The facts Codex usually spends its first tool calls on (status, stack, commands, layout), in ~150-300 tokens.
export function repoBrief(cwd) {
  const root = gitRoot(cwd)
  const base = root || cwd
  const project = detectProject(base)
  if (!root && project.stack.length === 0) return ''

  const lines = ['[better-codex] Repo brief, generated at session start (the files win if they disagree):']
  if (root) {
    const changes = gitChanges(root)
    const dirty = changes.length
      ? `${changes.length} uncommitted: ${changes.slice(0, 5).join(', ')}${changes.length > 5 ? ', …' : ''}`
      : 'clean'
    lines.push(`- repo ${project.name} · branch ${gitBranch(root) || '?'} · ${dirty}`)
  } else {
    lines.push(`- folder ${project.name} (not a git repository)`)
  }
  if (project.stack.length) lines.push(`- stack: ${project.stack.join(' · ')}`)
  const commands = Object.entries(project.commands).map(([name, cmd]) => `${name} \`${cmd}\``)
  if (commands.length) lines.push(`- commands: ${commands.join(' · ')}`)
  if (project.verify) lines.push(`- after code changes verify with \`${project.verify}\` (or a narrower check)`)
  const files = root ? gitFiles(root) : []
  lines.push(...infraLines(base, files))
  const shell = shellLine({ root, commands: Object.values(project.commands).join(' ') })
  if (shell) lines.push(shell)
  const slow = slowCommands(base)
  if (slow.length) {
    lines.push(`- slow here last time: ${slow.map(s => `\`${clip(s.command, 60)}\` ${duration(s.seconds)}`).join(' · ')}. Run these with the one-exec polling loop.`)
  }
  if (root) {
    const layout = layoutOf(files)
    if (layout) lines.push(`- layout: ${layout}`)
  }
  const handoff = handoffLine(base)
  if (handoff) lines.push(handoff)
  // Room for the infra and db lines: a repo with Terraform or migrations needs them more than most.
  return clip(lines.join('\n'), 1800)
}
