import { join } from 'node:path'
import { dataDir } from './paths.js'
import { readJson, writeJson } from './util.js'

export const DEFAULTS = Object.freeze({
  lang: 'auto', // 'auto' | 'es' | 'en': messages shown to you, not to the model
  guard: true, // PreToolUse: destructive or hard-to-undo actions wait for your explicit yes
  strict: false, // PreToolUse: only known read-only commands, tests and builds run without asking; the rest asks
  undo: true, // PreToolUse: a copy of what an action you approved can destroy, before it runs (bcx undo)
  relay: true, // Stop/SessionStart: past ctxCritical, a note of where the work stands for the next session
  brief: true, // SessionStart: a compact map of the repo, so Codex skips the first exploration
  boost: true, // UserPromptSubmit: prompt modes (+, quick:, ask:, plan:) and task playbooks
  hints: true, // UserPromptSubmit: files that match the names in the prompt
  fix: true, // PreToolUse: npm → npm.cmd on Windows, quieter npm install, and fixes learned here, before the command runs
  diet: true, // PreToolUse: block full reads of lockfiles, build output, binaries and huge files
  dietMaxKB: 200,
  bigOutputKB: 48, // PostToolUse: tell the model when one output was this big
  review: true, // Stop: what the change left behind (debugger, .only, conflict markers, new TODOs) sends Codex back once
  verifyGate: true, // Stop: code changed and nothing checked it? one more step to verify
  meter: 'warn', // Stop: 'warn' (thresholds only) | 'always' | 'off'
  ctxWarn: 60,
  ctxCritical: 80,
  rateWarn: 75,
  rateCritical: 90,
  // Saves the last payload of each event to ~/.codex/better-codex/debug/ (local only, overwritten each time).
  debug: false
})

const CHOICES = { lang: ['auto', 'es', 'en'], meter: ['warn', 'always', 'off'] }

export const configPath = () => join(dataDir(), 'config.json')

export function loadConfig() {
  return { ...DEFAULTS, ...readJson(configPath(), {}) }
}

export function saveConfig(patch) {
  writeJson(configPath(), { ...readJson(configPath(), {}), ...patch })
}

export function resetConfig() {
  const { installedAt } = readJson(configPath(), {})
  writeJson(configPath(), installedAt ? { installedAt } : {})
}

// Parses a value typed on the command line into the type of its default.
export function parseValue(key, raw) {
  if (!(key in DEFAULTS)) throw new Error(`unknown key "${key}" (${Object.keys(DEFAULTS).join(', ')})`)
  const def = DEFAULTS[key]
  const value = String(raw).trim()
  if (typeof def === 'boolean') {
    if (/^(true|on|yes|y|si|sí|1)$/i.test(value)) return true
    if (/^(false|off|no|n|0)$/i.test(value)) return false
    throw new Error(`"${key}" takes on/off`)
  }
  if (typeof def === 'number') {
    const n = Number(value)
    if (!Number.isFinite(n) || n < 0) throw new Error(`"${key}" takes a positive number`)
    return n
  }
  if (CHOICES[key] && !CHOICES[key].includes(value)) throw new Error(`"${key}" takes ${CHOICES[key].join(' | ')}`)
  return value
}
