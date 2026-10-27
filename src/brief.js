import { statSync } from 'node:fs'
import { join } from 'node:path'
import { gitBranch, gitChanges, gitFiles, gitRoot } from './git.js'
import { detectProject } from './project.js'
import { clip } from './util.js'

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
  if (root) {
    const layout = layoutOf(gitFiles(root))
    if (layout) lines.push(`- layout: ${layout}`)
  }
  const handoff = handoffLine(base)
  if (handoff) lines.push(handoff)
  return clip(lines.join('\n'), 1400)
}
