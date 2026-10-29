import { join } from 'node:path'
import { dataDir } from './paths.js'
import { readJson, writeJson } from './util.js'

// Actions you always allow in one repo (`bcx allow "rm -rf generated/"`), keyed by the repo's real path.
// Kept here, outside every repo, on purpose: a repo you clone or a pull request can't grant itself one,
// and Codex in its sandbox can't write it. The guard also stops Codex from running `bcx allow` itself.

export const allowFile = () => join(dataDir(), 'allow.json')
const read = () => readJson(allowFile(), {}) || {}

export const allowedFor = repo => read()[repo] || []

// How many times this action was approved in this repo (counting this one), for the hint to `bcx allow` it.
// "(would lose: …)" is left out: the files change, the action doesn't.
export function countApproval(root, found) {
  if (!root) return 0
  const file = join(dataDir(), 'approvals.json')
  const key = `${root}|${found.rule}|${String(found.detail).replace(/ \(would lose: [^)]*\)$/, '')}`
  const all = readJson(file, {}) || {}
  const count = (all[key] || 0) + 1
  const kept = Object.fromEntries([...Object.entries(all).filter(([k]) => k !== key).slice(-199), [key, count]])
  writeJson(file, kept)
  return count
}

export function saveAllowed(repo, rules) {
  const all = read()
  if (rules.length) all[repo] = rules
  else delete all[repo]
  writeJson(allowFile(), all)
}
