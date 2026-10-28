#!/usr/bin/env node
// Checks better-codex against a real Codex binary, with no login and no model calls: installs into a
// throwaway Codex home, asks Codex what it loads (the prompt it would send, and hooks/list), and runs
// each hook through the real shells with the command Codex reports. CI runs it on Linux, macOS and
// Windows, with the Codex version in package.json (codexTested) and with the latest one.
//
//   node scripts/codex-compat.mjs        # uses the codex on PATH, or BCX_CODEX
import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const root = mkdtempSync(join(tmpdir(), 'bcx-compat-'))
process.env.CODEX_HOME = join(root, '.codex')
process.env.BCX_DATA_DIR = join(root, '.codex', 'better-codex')
mkdirSync(process.env.CODEX_HOME, { recursive: true })
const repo = join(root, 'repo')
mkdirSync(repo)
writeFileSync(join(repo, 'README.md'), '# compat\n')
spawnSync('git', ['init', '-q'], { cwd: repo })

const { findCodex, install, installedCommand, runCodex } = await import('../src/install.js')
const { codexHooks } = await import('../src/codex-hooks.js')
const { smokeTest } = await import('../src/doctor.js')
const { EVENTS } = await import('../src/hooks.js')

const results = []
const check = (ok, label, detail = '') => results.push({ ok: !!ok, label, detail })

try {
  const codex = findCodex()
  if (!codex) throw new Error('Codex not found: install @openai/codex or set BCX_CODEX')
  check(true, 'Codex', codex.version)
  check(/^hooks\s+.*\btrue\s*$/m.test(runCodex(codex, ['features', 'list']) || ''), 'hooks feature on')

  install({})

  // What the model would see in a new session.
  const prompt = spawnSync(codex.bin, [...(codex.prefix || []), 'debug', 'prompt-input', 'hello'], { cwd: repo, encoding: 'utf8', timeout: 60000, maxBuffer: 32 * 1024 * 1024, windowsHide: true })
  check(/## better-codex/.test(prompt.stdout), 'AGENTS.md rules reach the prompt', prompt.status ? prompt.stderr.trim().slice(-300) : '')
  const skills = ['commit', 'refine', 'handoff', 'debug'].filter(s => !prompt.stdout.includes(`bcx:${s}`))
  check(!skills.length, 'bcx skills reach the prompt', skills.length ? `missing: ${skills.join(', ')}` : '')

  // What Codex loads, the same list /hooks shows.
  const listed = codexHooks(codex, repo)
  const ours = listed?.hooks.filter(h => /bcx\.js"? hook /.test(h.command || '')) || []
  const problems = listed ? [...listed.errors.map(e => e.message), ...listed.warnings].join('; ') : 'hooks/list did not answer'
  check(ours.length === EVENTS.length, 'Codex loads every hook', `${ours.length}/${EVENTS.length}${problems ? ` · ${problems}` : ''}`)
  check(ours.length && ours.every(h => h.trustStatus === 'untrusted'), 'and asks you to trust them', ours.map(h => `${h.eventName}:${h.trustStatus}`).join(' '))
  const command = Object.fromEntries(ours.map(h => [h.eventName[0].toUpperCase() + h.eventName.slice(1), h.command]))
  const differs = EVENTS.filter(e => command[e] !== installedCommand(e))
  check(!differs.length, 'Codex runs the command install wrote', differs.map(e => `${e}: ${command[e]}`).join('; '))

  // Each hook through the real shells, with the line Codex reports.
  for (const r of smokeTest({ command: e => command[e] ?? installedCommand(e) })) check(r.ok, `${r.shell} ${r.event}`, r.error || `${r.ms} ms`)
} catch (error) {
  check(false, 'compat', String(error?.message || error))
} finally {
  rmSync(root, { recursive: true, force: true })
}

for (const r of results) console.log(`${r.ok ? '✓' : '✗'} ${r.label}${r.detail ? `  ${r.detail}` : ''}`)
process.exitCode = results.every(r => r.ok) ? 0 : 1
