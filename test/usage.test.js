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
