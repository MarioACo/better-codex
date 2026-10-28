import { join } from 'node:path'
import { dataDir } from './paths.js'
import { readJson, withLock, writeJson } from './util.js'

const file = () => join(dataDir(), 'seen.json')

// Which events Codex really sent, how often, when last, with which tools, and which expected fields
// were missing: proof that the hooks are live and that Codex still sends what they read.
export function markSeen(event, toolName, missing = []) {
  if (process.env.BCX_NO_METRICS || !event) return
  try {
    withLock(
      file(),
      () => {
        const seen = readJson(file(), {})
        const entry = (seen[event] ??= { count: 0, last: 0, tools: {} })
        entry.count += 1
        entry.last = Date.now()
        if (toolName) entry.tools[toolName] = (entry.tools[toolName] || 0) + 1
        if (missing.length) {
          entry.missing ??= {}
          for (const field of missing) entry.missing[field] = (entry.missing[field] || 0) + 1
          entry.missingLast = entry.last
        }
        writeJson(file(), seen)
      },
      { waitMs: 300 }
    )
  } catch {}
}

export const readSeen = () => readJson(file(), {})
