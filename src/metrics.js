import { appendFileSync, mkdirSync, renameSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { dataDir } from './paths.js'
import { readText } from './util.js'

const file = () => join(dataDir(), 'events.jsonl')
const MAX_BYTES = 2 * 1024 * 1024

// One line per thing better-codex did (a brief, a blocked read, a guard stop…), so `bcx stats` can show its effect.
export function record(kind, data = {}) {
  if (process.env.BCX_NO_METRICS) return
  try {
    mkdirSync(dataDir(), { recursive: true })
    try {
      if (statSync(file()).size > MAX_BYTES) renameSync(file(), join(dataDir(), 'events.1.jsonl'))
    } catch {}
    appendFileSync(file(), `${JSON.stringify({ t: Date.now(), kind, ...data })}\n`)
  } catch {}
}

export function readEvents(sinceMs = 0) {
  const events = []
  for (const name of ['events.1.jsonl', 'events.jsonl']) {
    for (const line of (readText(join(dataDir(), name), '') || '').split('\n')) {
      if (!line) continue
      try {
        const event = JSON.parse(line)
        if (event.t >= sinceMs) events.push(event)
      } catch {}
    }
  }
  return events
}
