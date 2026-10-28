import { join } from 'node:path'
import { dataDir } from './paths.js'
import { readJson, writeJson } from './util.js'

// Commands that ran longer than this hand control back to the model mid-run on Windows,
// and every poll after that is a full request.
export const SLOW_SECONDS = 30

const file = () => join(dataDir(), 'slow.json')
const key = command => String(command).trim().replace(/\s+/g, ' ').slice(0, 120)

// Remembers how long a command took in a repo, so the next session knows before running it.
export function rememberSlow(root, command, seconds) {
  if (!root || !command) return
  const all = readJson(file(), {}) || {}
  const repo = { ...(all[root] || {}), [key(command)]: { seconds: Math.round(seconds), at: Date.now() } }
  const kept = Object.entries(repo).sort((a, b) => b[1].at - a[1].at).slice(0, 10)
  const repos = Object.entries({ ...all, [root]: Object.fromEntries(kept) }).slice(-50)
  writeJson(file(), Object.fromEntries(repos))
}

// The slowest commands seen in a repo, slowest first.
export function slowCommands(root, max = 4) {
  const repo = (readJson(file(), {}) || {})[root] || {}
  return Object.entries(repo)
    .map(([command, { seconds }]) => ({ command, seconds }))
    .sort((a, b) => b.seconds - a.seconds)
    .slice(0, max)
}

export const duration = seconds => (seconds >= 90 ? `~${Math.round(seconds / 60)} min` : `~${Math.round(seconds)} s`)
