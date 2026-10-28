import assert from 'node:assert/strict'
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { test } from 'node:test'
import { codexCheck, compareVersions, doctor, trustFromCodex } from '../src/doctor.js'
import { install } from '../src/install.js'
import { markSeen } from '../src/seen.js'
import { isolate } from './helpers.js'

test('Codex versions: newer releases are pointed out, alpha builds of the tested release are not', () => {
  assert.equal(compareVersions('0.165.0', '0.164.0-alpha.11.1'), 1)
  assert.equal(compareVersions('0.164.0', '0.164.0-alpha.11.1'), 0)
  assert.equal(compareVersions('0.163.2', '0.164.0'), -1)
  assert.equal(compareVersions('1.0.0', '0.999.9'), 1)
  assert.equal(codexCheck('0.164.0-alpha.12.1', '0.164.0-alpha.11.1').status, 'ok')
  assert.equal(codexCheck('0.163.0', '0.164.0').status, 'ok')
  const newer = codexCheck('0.165.0', '0.164.0-alpha.11.1')
  assert.equal(newer.status, 'info')
  assert.match(newer.detail, /newer than the last one better-codex was tested with \(0\.164\.0-alpha\.11\.1\)/)
})

test('doctor: warns about an AGENTS.override.md and about hook fields Codex stopped sending', () => {
  const home = isolate()
  install({ plugins: false })
  const warned = () => doctor({ offline: true }).checks.filter(c => c.status === 'warn').map(c => c.label)
  assert.ok(!warned().includes('AGENTS.override'))
  assert.ok(!warned().includes('hook format'))

  const check = label => doctor({ offline: true }).checks.find(c => c.label === label)?.detail
  writeFileSync(join(home, 'AGENTS.override.md'), 'mine\n')
  assert.match(check('AGENTS.override'), /never reads the better-codex rules/)
  writeFileSync(join(home, 'AGENTS.override.md'), '<!-- better-codex bench: temporary file, removed when the run ends -->\n')
  assert.match(check('AGENTS.override'), /interrupted benchmark/)

  markSeen('PostToolUse', 'Bash', ['tool_use_id'])
  assert.match(check('hook format'), /PostToolUse\.tool_use_id/)
})

test('doctor asks Codex itself whether the hooks are loaded and trusted', () => {
  const hook = (eventName, trustStatus = 'trusted') => ({ eventName, trustStatus, command: `node /home/me/.codex/better-codex/app/bin/bcx.js hook ${eventName}` })
  const events = ['preToolUse', 'postToolUse', 'sessionStart', 'userPromptSubmit', 'stop']
  const listed = (hooks, errors = [], warnings = []) => ({ hooks: [{ eventName: 'stop', trustStatus: 'untrusted', command: 'notify-send done' }, ...hooks], errors, warnings })
  assert.equal(trustFromCodex(null), null)
  assert.deepEqual(trustFromCodex(listed(events.map(e => hook(e)))), { status: 'ok', label: 'trusted', detail: '5/5 in /hooks (asked Codex)' })
  const changed = trustFromCodex(listed(events.map((e, i) => hook(e, i ? 'trusted' : 'modified'))))
  assert.equal(changed.status, 'warn')
  assert.match(changed.detail, /^4\/5, 1 changed since you trusted them/)
  const lost = trustFromCodex(listed(events.slice(1).map(e => hook(e)), [{ path: 'hooks.json', message: 'unknown field `matcher`' }]))
  assert.equal(lost.status, 'fail')
  assert.match(lost.detail, /Codex loads 4 of the 5 better-codex hooks: unknown field `matcher`/)
})
