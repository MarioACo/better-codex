import { join } from 'node:path'
import { dataDir } from './paths.js'
import { readJson, writeJson } from './util.js'

// Actions you always allow in one repo (`bcx allow "rm -rf generated/"`), keyed by the repo's real path.
// Kept here, outside every repo, on purpose: a repo you clone or a pull request can't grant itself one,
// and Codex in its sandbox can't write it. The guard also stops Codex from running `bcx allow` itself.

export const allowFile = () => join(dataDir(), 'allow.json')
const read = () => readJson(allowFile(), {}) || {}

export const allowedFor = repo => read()[repo] || []

export function saveAllowed(repo, rules) {
  const all = read()
  if (rules.length) all[repo] = rules
  else delete all[repo]
  writeJson(allowFile(), all)
}
