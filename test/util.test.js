import assert from 'node:assert/strict'
import { existsSync, utimesSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { test } from 'node:test'
import { samplePayload } from '../src/doctor.js'
import { EVENTS, missingFields } from '../src/hooks.js'
import { readSeen, markSeen } from '../src/seen.js'
import { withLock } from '../src/util.js'
import { isolate, tempDir } from './helpers.js'

test('withLock: runs, releases, and never leaves Codex waiting forever', () => {
  const file = join(tempDir(), 'state.json')
  assert.equal(withLock(file, () => 42), 42)
  assert.ok(!existsSync(`${file}.lock`))

  // held by someone else: gives up after waitMs and still runs
  writeFileSync(`${file}.lock`, '')
  const started = Date.now()
  assert.equal(withLock(file, () => 'ran', { waitMs: 100 }), 'ran')
  assert.ok(Date.now() - started < 2000)

  // a leftover from a crashed hook is taken over
  const old = (Date.now() - 60_000) / 1000
  utimesSync(`${file}.lock`, old, old)
  assert.equal(withLock(file, () => 'took over', { waitMs: 100 }), 'took over')
  assert.ok(!existsSync(`${file}.lock`))

  // released even when fn throws
  assert.throws(() => withLock(file, () => { throw new Error('boom') }), /boom/)
  assert.ok(!existsSync(`${file}.lock`))
})

test('markSeen: counts events and tool names Codex really sent', () => {
  isolate()
  markSeen('PreToolUse', 'exec')
  markSeen('PreToolUse', 'exec')
  markSeen('PreToolUse', 'apply_patch')
  markSeen('Stop')
  const seen = readSeen()
  assert.equal(seen.PreToolUse.count, 3)
  assert.deepEqual(seen.PreToolUse.tools, { exec: 2, apply_patch: 1 })
  assert.equal(seen.Stop.count, 1)
})

test('markSeen: remembers the expected fields Codex stopped sending', () => {
  isolate()
  const input = { session_id: 's', cwd: '/repo', turn_id: 't', tool_name: 'Bash', tool_input: { command: 'ls' } }
  markSeen('PreToolUse', 'Bash', missingFields('PreToolUse', input))
  markSeen('PreToolUse', 'Bash', missingFields('PreToolUse', { ...input, tool_use_id: 'u' }))
  const seen = readSeen()
  assert.deepEqual(seen.PreToolUse.missing, { tool_use_id: 1 })
  assert.ok(seen.PreToolUse.missingLast > 0)
  // The payloads doctor sends carry every field, so they never look like a format change.
  for (const event of EVENTS) assert.deepEqual(missingFields(event, samplePayload(event)), [], event)
})
