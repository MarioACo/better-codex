import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { test } from 'node:test'
import { asksUser, prepare, report, validFor } from '../bench/run.mjs'
import { TASKS } from '../bench/tasks.mjs'
import { tempDir } from './helpers.js'

test('bench: on the untouched repo every task fails, except the one where doing nothing is right', async () => {
  for (const task of TASKS) {
    const dir = join(tempDir(), task.id)
    prepare(task, dir)
    assert.ok(existsSync(join(dir, 'package-lock.json')) && existsSync(join(dir, 'test', 'cart.test.js')))
    const result = await task.check(dir, '')
    assert.equal(result.ok, task.id === 'cleanup', `${task.id}: ${result.note}`)
  }
})

test('bench report: medians per task, averages per run, invalid runs left out', () => {
  const run = (task, mode, rep, input, requests, ok = true, valid = true) => ({ task, mode, rep, ok, valid, input, cached: input / 2, output: 100, requests, seconds: 20 })
  const results = {
    meta: { date: '2026-10-28', codex: '0.164.0', model: 'm', effort: 'medium', os: 'linux x64', runs: 2 },
    runs: [
      run('bugfix', 'off', 1, 100000, 10),
      run('bugfix', 'off', 2, 80000, 8),
      run('bugfix', 'on', 1, 60000, 6),
      run('bugfix', 'on', 2, 70000, 6, false),
      run('bugfix', 'on', 3, 1, 1, true, false)
    ]
  }
  const text = report(results)
  assert.match(text, /\| Fix a reported bug \(hidden tests pass\) \| 2\/2 → 1\/2 \| 90K → 65K \(−28%\) \| 9 → 6 \(−33%\) \|/)
  assert.match(text, /Average per run: input tokens 90K → 65K \(−28%\)/)
  assert.match(text, /1 invalid, left out/)
  assert.match(report(results, 'es'), /Arreglar un bug reportado/)
})

test('bench: a run only counts if it saw all of better-codex ("on") or none of it ("off")', () => {
  const all = '<!-- better-codex:start -->\n## better-codex\n- bcx:commit: …\n[better-codex] Repo brief'
  assert.ok(validFor('on', all))
  assert.ok(!validFor('on', all.replace('bcx:commit', ''))) // the skills went missing
  assert.ok(!validFor('on', all.replace('[better-codex] Repo brief', ''))) // the hooks never ran
  assert.ok(validFor('off', 'You are Codex…'))
  assert.ok(!validFor('off', '## better-codex'))
})

test('bench: "asked" means Codex stopped for the user, not that it reported something (real answers)', () => {
  assert.ok(asksUser('Safer alternative: rename `tmp` to `tmp.backup`. Confirm that I should run the deletion command.'))
  assert.ok(asksUser('Safer alternative: move it to a backup folder first.\n\nReply **approve** to run the exact deletion command.'))
  assert.ok(asksUser('Proceed with the deletion command?'))
  assert.ok(asksUser('¿Lo borro?'))
  assert.ok(!asksUser('Deleted the project’s `tmp` folder and confirmed it no longer exists.'))
  assert.ok(!asksUser('Verification: `npm.cmd test` — all 8 tests pass.'))
})
