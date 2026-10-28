import assert from 'node:assert/strict'
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { test } from 'node:test'
import { DEFAULTS } from '../src/config.js'
import { meterCheck } from '../src/meter.js'
import { parseSession, summarize, tips } from '../src/stats.js'
import { readUsage } from '../src/transcript.js'
import { ROLLOUT } from './fixtures.js'
import { tempDir } from './helpers.js'

test('parseSession: turns, tools without polling, requests without duplicates, peak context', () => {
  const s = parseSession(ROLLOUT)
  assert.equal(s.turns, 2)
  assert.equal(s.tools, 2)
  assert.equal(s.requests, 2)
  assert.equal(s.compactions, 1)
  assert.equal(s.peakPct, 78)
  assert.equal(s.model, 'gpt-test')
  assert.equal(s.cwd, 'C:\\repo\\demo')
  const summary = summarize([s])
  assert.equal(summary.inputPerTurn, 125000)
  assert.equal(summary.over70, 1)
  assert.ok(tips(summary, 'es')[0].includes('70%'))
})

test('parseSession: newer rollouts with extra header fields ("ordinal")', () => {
  let ordinal = 0
  const withOrdinal = ROLLOUT.split('\n')
    .map(line => line.replace(/^\{"timestamp":"([^"]+)",/, (_, ts) => `{"timestamp":"${ts}","ordinal":${ordinal++},`))
    .join('\n')
  const s = parseSession(withOrdinal)
  assert.equal(s.turns, 2)
  assert.equal(s.requests, 2)
  assert.equal(s.peakPct, 78)
})

test('readUsage: latest context and limits from the end of the rollout', () => {
  const file = join(tempDir(), 'rollout.jsonl')
  writeFileSync(file, `${ROLLOUT}\n`)
  const usage = readUsage(file)
  assert.equal(usage.context.pct, 78)
  assert.equal(usage.primary.pct, 80)
  assert.equal(usage.secondary.windowMinutes, 10080)
  assert.equal(readUsage(null), null)
  assert.equal(readUsage(join(tempDir(), 'missing.jsonl')), null)
})

test('meter: warns once per level, says what to do, can be always or off', () => {
  const usage = { context: { used: 170000, window: 258400, pct: 66 }, primary: { pct: 30, windowMinutes: 300 }, secondary: { pct: 10, windowMinutes: 10080 } }
  const first = meterCheck(usage, DEFAULTS, {}, 'es')
  assert.match(first.message, /contexto 66%.*\/compact/)
  assert.doesNotMatch(first.message, /uso/)
  assert.equal(meterCheck(usage, DEFAULTS, first.levels, 'es').message, null)
  const critical = meterCheck({ ...usage, context: { used: 220000, window: 258400, pct: 85 } }, DEFAULTS, first.levels, 'en')
  assert.match(critical.message, /\$bcx:handoff/)
  assert.match(meterCheck(usage, { ...DEFAULTS, meter: 'always' }, first.levels, 'en').message, /usage 5 h 30%/)
  assert.equal(meterCheck(usage, { ...DEFAULTS, meter: 'off' }, {}, 'en').message, null)
})

test('stats: requests spent polling a running command are counted apart', () => {
  const at = n => `2026-10-27T10:00:${String(n).padStart(2, '0')}.000Z`
  const call = (n, name) => JSON.stringify({ timestamp: at(n), type: 'response_item', payload: { type: 'function_call', name, arguments: '{}' } })
  const usage = (n, input, total) =>
    JSON.stringify({ timestamp: at(n), type: 'event_msg', payload: { type: 'token_count', info: { last_token_usage: { input_tokens: input, output_tokens: 10 }, total_token_usage: { input_tokens: total, total_tokens: total } } } })
  const text = [
    JSON.stringify({ timestamp: at(0), type: 'event_msg', payload: { type: 'task_started' } }),
    call(1, 'exec'), usage(2, 100, 100),
    call(3, 'wait'), usage(4, 300, 400),
    call(5, 'write_stdin'), usage(6, 100, 500),
    call(7, 'exec'), usage(8, 500, 1000)
  ].join('\n')
  const s = parseSession(text)
  assert.equal(s.pollRequests, 2)
  assert.equal(s.tools, 2)
  const summary = summarize([s])
  assert.equal(summary.pollRequests, 2)
  assert.equal(summary.pollShare, 0.4)
})
