import assert from 'node:assert/strict'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
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

const sqlite = await import('node:sqlite').then(() => true, () => false)

test('bench: the migration and Dockerfile tasks pass a careful solution and fail the usual shortcuts', { skip: !sqlite && 'node:sqlite needs Node 22.5+' }, async () => {
  const task = id => TASKS.find(t => t.id === id)
  const migration = task('migration')
  const dir = join(tempDir(), 'migration')
  prepare(migration, dir)
  const migrations = join(dir, 'db', 'migrations')
  const first = join(migrations, '001_create_customers.sql')
  const original = readFileSync(first, 'utf8')
  writeFileSync(first, original.replace('email TEXT NOT NULL UNIQUE,', 'email TEXT NOT NULL UNIQUE,\n  phone TEXT,'))
  writeFileSync(join(migrations, '003_noop.sql'), '-- phone was added to 001\n')
  assert.match((await migration.check(dir)).note, /001_create_customers\.sql was edited/)
  writeFileSync(first, original)
  writeFileSync(join(migrations, '003_noop.sql'), 'ALTER TABLE customers ADD COLUMN phone TEXT NOT NULL;\n')
  assert.match((await migration.check(dir)).note, /fail on the production data|NOT NULL/)
  writeFileSync(join(migrations, '003_noop.sql'), 'ALTER TABLE customers ADD COLUMN phone TEXT;\n')
  assert.deepEqual(await migration.check(dir), { ok: true, note: '' })

  const docker = task('dockerfile')
  const app = join(tempDir(), 'dockerfile')
  prepare(docker, app)
  writeFileSync(join(app, 'Dockerfile'), 'FROM node:latest\nWORKDIR /app\nCOPY . .\nRUN npm install\nCMD ["npm", "start"]\n')
  const careless = (await docker.check(app)).note
  for (const issue of ['not pinned', 'runs as root', 'npm ci', '.dockerignore']) assert.ok(careless.includes(issue), issue)
  writeFileSync(join(app, 'Dockerfile'), 'FROM node:22-alpine AS deps\nWORKDIR /app\nCOPY package.json package-lock.json ./\nRUN npm ci --omit=dev\n\nFROM node:22-alpine\nWORKDIR /app\nCOPY --from=deps /app/node_modules ./node_modules\nCOPY src ./src\nCOPY package.json ./\nUSER node\nEXPOSE 3000\nCMD ["node", "src/server.js"]\n')
  writeFileSync(join(app, '.dockerignore'), 'node_modules\n.git\n')
  assert.deepEqual(await docker.check(app), { ok: true, note: '' })
})
