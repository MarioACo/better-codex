import { join } from 'node:path'
import { dataDir } from './paths.js'
import { readJson, writeJson } from './util.js'
import { verbOf } from './shell.js'

// Commands corrected before they run (PreToolUse updatedInput), so a call that would fail or flood the
// context doesn't cost a request: npm.ps1 that PowerShell blocks, the audit and funding notices of
// npm install, and what this machine taught it (python missing, py works). Only the text changes: the
// guard has already looked at the command, and the hook grants no permission.

const fixesFile = () => join(dataDir(), 'fixes.json')
export const learnedFixes = () => readJson(fixesFile(), {})?.verbs || {}

// Where a command word starts: the beginning, or after ; && || | ( {
const AT_START = String.raw`(^|[;&|({]\s*|\n\s*)`
// Programs a missing one can be swapped for word for word on the same machine (python x.py → py x.py).
const VARIANTS = { python: ['py', 'python3'], python3: ['python', 'py'], pip: ['pip3'], pip3: ['pip'], node: ['nodejs'], nodejs: ['node'] }

export function fixCommand(command, { platform = process.platform, learned = learnedFixes() } = {}) {
  let text = String(command)
  const notes = []
  const swap = (from, to, note) => {
    const re = new RegExp(`${AT_START}${from.replace(/[.+*?^${}()|[\]\\]/g, '\\$&')}(?=\\s|$)`, 'g')
    const next = text.replace(re, `$1${to}`)
    if (next !== text) notes.push(note)
    text = next
  }
  // PowerShell blocks npm.ps1 on many machines; npm.cmd is always there and does the same.
  if (platform === 'win32') for (const tool of ['npm', 'npx', 'pnpm', 'yarn']) swap(tool, `${tool}.cmd`, `${tool} → ${tool}.cmd`)
  for (const [from, to] of Object.entries(learned)) swap(from, to, `${from} → ${to} (learned here)`)
  // npm install prints audit and funding notices nobody reads in an agent session.
  const quiet = text.replace(/(\bnpm(?:\.cmd)?\s+(?:install|i|ci|add)\b[^|;&\n]*?)(\s*(?=[|;&\n]|$))/g, (m, cmd, rest) => (/--no-audit|--loglevel|--silent|-s\b/.test(cmd) ? m : `${cmd.trimEnd()} --no-audit --no-fund${rest}`))
  if (quiet !== text) notes.push('npm install --no-audit --no-fund')
  text = quiet
  return text === command ? null : { command: text, notes }
}

// "python : The term 'python' is not recognized…", "python: command not found", "'python' is not recognized as…"
const NOT_FOUND = /The term '([\w.-]+)' is not recognized|^'([\w.-]+)' is not recognized as an internal or external command|^(?:\w+: )?([\w.-]+): command not found|command not found: ([\w.-]+)/m

// PostToolUse: a program that was missing, and the variant that worked right after, are remembered.
export function learnFix(state, command, output) {
  const text = typeof output === 'string' ? output : JSON.stringify(output ?? '')
  const verb = verbOf(String(command).trim().split(/\s+/)[0])
  const m = NOT_FOUND.exec(text)
  if (m) {
    const missing = (m[1] || m[2] || m[3] || m[4]).toLowerCase()
    if (VARIANTS[missing]) state.missing = { verb: missing, at: Date.now() }
    return null
  }
  const missing = state.missing
  if (!missing || Date.now() - missing.at > 10 * 60 * 1000 || !VARIANTS[missing.verb]?.includes(verb)) return null
  state.missing = null
  const saved = readJson(fixesFile(), {}) || {}
  writeJson(fixesFile(), { ...saved, verbs: { ...(saved.verbs || {}), [missing.verb]: verb } })
  return { from: missing.verb, to: verb }
}
