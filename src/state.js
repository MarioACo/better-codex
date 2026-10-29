import { readdirSync, statSync, unlinkSync } from 'node:fs'
import { join } from 'node:path'
import { dataDir } from './paths.js'
import { readJson, writeJson } from './util.js'

const dir = () => join(dataDir(), 'state')
export const stateFile = id => join(dir(), `${String(id || 'default').replace(/[^\w-]/g, '_')}.json`)
const file = stateFile

// Per-turn fields are reset by UserPromptSubmit; the rest lasts the whole session.
export const freshState = () => ({
  turn: null,
  seq: 0,
  lastEdit: 0,
  lastVerify: 0,
  // The line that shows the last check failed, or null.
  verifyFailed: null,
  edited: [],
  // Infra files edited this turn and their checks, per kind (src/infra.js).
  infra: {},
  gateFired: false,
  bigOutputWarned: false,
  prompt: '',
  verifyCmd: null,
  playbooks: [],
  touched: [],
  created: [],
  userDirty: [],
  meter: {},
  // Codex's last message, so a "yes" can be tied to the question it answers.
  lastAnswer: '',
  // cwd → git root, so later hooks don't spawn git again.
  roots: {},
  // tool_use_id → when PreToolUse let it run, to time it in PostToolUse.
  started: {},
  // Slow commands Codex was already told about this session.
  slowWarned: [],
  // saved: "turn|rule|detail" of approved actions already copied for bcx undo.
  guard: { pending: [], approved: [], approvedTurn: null, asked: '', saved: [] }
})

export function loadState(id) {
  const saved = readJson(file(id), {})
  const fresh = freshState()
  return { ...fresh, ...saved, guard: { ...fresh.guard, ...saved.guard } }
}

export const saveState = (id, state) => writeJson(file(id), state)

export function pruneStates(maxAgeDays = 7) {
  const cutoff = Date.now() - maxAgeDays * 24 * 60 * 60 * 1000
  let names = []
  try {
    names = readdirSync(dir())
  } catch {
    return
  }
  for (const name of names) {
    try {
      const path = join(dir(), name)
      if (statSync(path).mtimeMs < cutoff) unlinkSync(path)
    } catch {}
  }
}
