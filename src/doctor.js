import { spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { EVENTS } from './hooks.js'
import { agentsBlock, agentsPath, appDir, blockOf, findCodex, hasOurHooks, hookCommand, hooksPath, installedCommand, marketplaceRoot, runCodex } from './install.js'
import { readEvents } from './metrics.js'
import { ROOT } from './paths.js'
import { readSeen } from './seen.js'
import { readJson, readText } from './util.js'

// What Codex sends on stdin for each event (documented fields only), aimed at this repository.
export function samplePayload(event) {
  const base = { session_id: 'bcx-doctor', transcript_path: null, cwd: ROOT, hook_event_name: event, model: 'doctor', permission_mode: 'default' }
  switch (event) {
    case 'SessionStart':
      return { ...base, source: 'startup' }
    case 'UserPromptSubmit':
      return { ...base, turn_id: 't1', prompt: 'ask: how does src/hooks.js route the events?' }
    case 'PreToolUse':
      return { ...base, turn_id: 't1', tool_name: 'Bash', tool_use_id: 'u1', tool_input: { command: 'git push --force origin main' } }
    case 'PostToolUse':
      return { ...base, turn_id: 't1', tool_name: 'Bash', tool_use_id: 'u2', tool_input: { command: 'npm test' }, tool_response: 'ok' }
    case 'Stop':
      return { ...base, turn_id: 't1', stop_hook_active: false, last_assistant_message: 'done' }
    default:
      return base
  }
}

// What a healthy hook answers to the sample above.
const EXPECT = {
  SessionStart: out => !!out?.hookSpecificOutput?.additionalContext,
  UserPromptSubmit: out => /Mode ASK/.test(out?.hookSpecificOutput?.additionalContext || ''),
  PreToolUse: out => out?.hookSpecificOutput?.permissionDecision === 'deny',
  PostToolUse: out => out === null,
  Stop: out => /better-codex/.test(out?.systemMessage || '')
}

// The line Codex runs: the installed one, or this checkout's before installing.
export const commandFor = event => installedCommand(event) ?? hookCommand(event, join(ROOT, 'bin', 'bcx.js'))

// Runs each hook through a real shell, with the exact command line Codex runs, in a throwaway data folder.
export function smokeTest({ command = commandFor, shells = process.platform === 'win32' ? ['cmd', 'powershell'] : ['sh'] } = {}) {
  const results = []
  for (const shell of shells) {
    const dataDir = mkdtempSync(join(tmpdir(), 'bcx-doctor-'))
    try {
      for (const event of EVENTS) {
        const line = command(event)
        const started = Date.now()
        const options = { input: JSON.stringify(samplePayload(event)), encoding: 'utf8', timeout: 20000, windowsHide: true, env: { ...process.env, BCX_DATA_DIR: dataDir, BCX_NO_METRICS: '1' } }
        const res =
          shell === 'powershell'
            ? spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', line], options)
            : spawnSync(line, { ...options, shell: true })
        const ms = Date.now() - started
        let out
        try {
          out = res.stdout.trim() ? JSON.parse(res.stdout) : null
        } catch {
          out = undefined
        }
        const ok = res.status === 0 && out !== undefined && EXPECT[event](out)
        results.push({ shell, event, ok, ms, error: ok ? null : (res.stderr || res.stdout || String(res.error || '')).trim().slice(0, 300) })
      }
    } finally {
      rmSync(dataDir, { recursive: true, force: true })
    }
  }
  return results
}

// Proof from Codex itself: which events it actually sent, and with which tool names.
export function liveStatus(now = Date.now()) {
  const seen = readSeen()
  return EVENTS.map(event => {
    const entry = seen[event]
    return entry ? { event, count: entry.count, ago: now - entry.last, tools: Object.entries(entry.tools || {}).sort((a, b) => b[1] - a[1]) } : { event, count: 0 }
  })
}

export function doctor({ offline = false } = {}) {
  const checks = []
  const add = (status, label, detail = '') => checks.push({ status, label, detail })

  const major = Number(process.versions.node.split('.')[0])
  add(major >= 20 ? 'ok' : 'fail', 'Node', `${process.version}${major >= 20 ? '' : ' (needs 20+)'}`)

  if (!offline) {
    const codex = findCodex()
    add(codex ? 'ok' : 'warn', 'Codex', codex ? codex.version : 'not found on PATH nor in ~/.codex/.sandbox-bin')
    if (codex) {
      const features = runCodex(codex, ['features', 'list']) || ''
      const hooksFlag = /^hooks\s+.*?\b(true|false)\s*$/m.exec(features)?.[1]
      add(hooksFlag === 'true' ? 'ok' : hooksFlag ? 'fail' : 'warn', 'features.hooks', hooksFlag ?? 'unknown')
      const root = marketplaceRoot(codex)
      add(root ? 'ok' : 'warn', 'marketplace', root ?? 'not registered (skills $bcx:commit, $bcx:refine, $bcx:handoff, $bcx:debug)')
    }
  }

  // Not installed yet is a to-do, not a failure: failures are things that are broken.
  const installed = existsSync(join(appDir(), 'bin', 'bcx.js'))
  const appVersion = readJson(join(appDir(), 'package.json'), {})?.version
  const thisVersion = readJson(join(ROOT, 'package.json'), {})?.version
  add(!installed ? 'warn' : appVersion === thisVersion ? 'ok' : 'warn', 'app', !installed ? `${appDir()} (run: bcx install)` : appVersion === thisVersion ? `${appDir()} (${appVersion})` : `installed ${appVersion}, this is ${thisVersion} (run: bcx install)`)

  const hooks = readJson(hooksPath(), null)
  add(hasOurHooks(hooks || {}) ? 'ok' : 'warn', 'hooks.json', hasOurHooks(hooks || {}) ? hooksPath() : `${hooksPath()} (run: bcx install)`)

  const block = blockOf(readText(agentsPath(), ''))
  add(block === agentsBlock() ? 'ok' : 'warn', 'AGENTS.md', !block ? 'missing (run: bcx install)' : block === agentsBlock() ? agentsPath() : 'outdated (run: bcx install)')

  const errors = readEvents(Date.now() - 7 * 24 * 60 * 60 * 1000).filter(e => e.kind === 'error')
  if (errors.length) add('warn', 'errors (7 d)', `${errors.length}, last: ${String(errors[errors.length - 1].message).split('\n')[0].slice(0, 160)}`)

  return { checks, smoke: smokeTest(), live: liveStatus() }
}
