import { createHash } from 'node:crypto'
import { join, relative } from 'node:path'
import { gitBranch, gitChanges, gitRoot } from './git.js'
import { canon } from './guard.js'
import { dataDir } from './paths.js'
import { clip, readJson, toPosix, writeJson } from './util.js'

// The relay: when a session passes the critical context level, better-codex writes down where the work
// stands (the requests, the files touched, the last check, Codex's last answer) without asking the model,
// and the next session in that repo gets it once, in its brief. In the author's sessions, the few that
// ran past 70% of the context took 79% of all input tokens: starting fresh is the biggest saving there is.

const MAX_AGE = 3 * 24 * 60 * 60 * 1000
const fileOf = base => join(dataDir(), 'relay', `${createHash('sha1').update(canon(base)).digest('hex').slice(0, 16)}.json`)

export function writeRelay({ cwd, state, session, pct }) {
  const root = gitRoot(cwd)
  const base = root || cwd
  const inside = abs => {
    const rel = toPosix(relative(canon(base), abs))
    return rel && !rel.startsWith('..') && !/^[a-z]:/i.test(rel) ? rel : null
  }
  const relay = {
    at: Date.now(),
    session,
    pct,
    branch: root ? gitBranch(root) : null,
    prompts: (state.prompts || []).slice(-6),
    files: [...new Set((state.touched || []).map(inside).filter(Boolean))].slice(-15),
    uncommitted: root ? gitChanges(root).slice(0, 15) : [],
    check: state.lastCheck || null,
    answer: clip(String(state.lastAnswer || ''), 700)
  }
  writeJson(fileOf(base), relay)
  return relay
}

// The relay a new session in this repo should get, once: null if there is none, it is old, or it was given.
export function takeRelay(cwd, session) {
  const base = gitRoot(cwd) || cwd
  const file = fileOf(base)
  const relay = readJson(file, null)
  if (!relay || relay.session === session || relay.givenTo || Date.now() - relay.at > MAX_AGE) return null
  writeJson(file, { ...relay, givenTo: session })
  return relay
}

export function relayText(relay) {
  const when = new Date(relay.at).toISOString().slice(0, 16).replace('T', ' ')
  const lines = [`- relay from the previous session (it ended at ${relay.pct}% of its context, ${when} UTC). Continue from here if the user's request is the same work; verify before trusting it:`]
  if (relay.prompts.length) lines.push(`  - requests: ${relay.prompts.map(p => `"${clip(p.replace(/\s+/g, ' '), 160)}"`).join(' → ')}`)
  if (relay.files.length) lines.push(`  - files changed${relay.branch ? ` on ${relay.branch}` : ''}: ${relay.files.join(', ')}`)
  if (relay.uncommitted.length) lines.push(`  - uncommitted then: ${relay.uncommitted.join(', ')}`)
  if (relay.check) lines.push(`  - last check: \`${clip(relay.check.command, 80)}\` ${relay.check.failed ? `failed ("${relay.check.failed}")` : 'passed'}`)
  if (relay.answer) lines.push(`  - Codex's last answer: ${clip(relay.answer.replace(/\s+/g, ' '), 500)}`)
  return clip(lines.join('\n'), 1500)
}
