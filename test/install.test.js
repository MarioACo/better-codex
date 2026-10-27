import assert from 'node:assert/strict'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { test } from 'node:test'
import { smokeTest } from '../src/doctor.js'
import { agentsPath, appDir, blockOf, hasOurHooks, hookCommand, hooksPath, install, installedCommand, mergeHooks, removeHooks, tuiCommand, uninstall, withBlock, withoutBlock } from '../src/install.js'
import { toPosix } from '../src/util.js'
import { isolate, tempDir } from './helpers.js'

const USER_HOOKS = {
  hooks: {
    PreToolUse: [{ matcher: 'Bash', hooks: [{ type: 'command', command: 'python3 ~/policy.py', timeout: 5 }] }],
    Stop: [{ hooks: [{ type: 'command', command: 'notify-send done' }] }]
  }
}

test('hook command: absolute, unquoted when possible, one per event', () => {
  const cmd = hookCommand('Stop')
  assert.match(cmd, /bcx\.js"? hook Stop$/)
  assert.doesNotMatch(cmd, /\\/)
})

test('mergeHooks: keeps your hooks, adds ours once, removes only ours', () => {
  const merged = mergeHooks(USER_HOOKS)
  assert.ok(hasOurHooks(merged))
  assert.equal(merged.hooks.PreToolUse.length, 2)
  assert.equal(merged.hooks.PreToolUse[0].hooks[0].command, 'python3 ~/policy.py')
  assert.deepEqual(mergeHooks(merged), merged) // idempotent
  assert.deepEqual(removeHooks(merged), USER_HOOKS)
})

test('AGENTS.md block: added at the end, replaced in place, removed cleanly', () => {
  assert.equal(withoutBlock(withBlock('', 'rules v1')), '')
  const mine = '# My rules\n\nBe brief.\n'
  const once = withBlock(mine, 'rules v1')
  assert.ok(once.startsWith(mine.trimEnd()))
  assert.equal(blockOf(once), 'rules v1')
  const twice = withBlock(once, 'rules v2')
  assert.equal(blockOf(twice), 'rules v2')
  assert.equal(twice.match(/better-codex:start/g).length, 1)
  assert.equal(withoutBlock(twice), mine)
})

test('install and uninstall in an isolated Codex home, with backups', () => {
  isolate()
  writeFileSync(hooksPath(), JSON.stringify(USER_HOOKS))
  writeFileSync(agentsPath(), '# Mine\n')

  const dry = install({ dryRun: true, plugins: false })
  assert.ok(dry.every(step => step.changed))
  assert.deepEqual(JSON.parse(readFileSync(hooksPath(), 'utf8')), USER_HOOKS) // dry run writes nothing
  assert.ok(!existsSync(appDir()))

  const steps = install({ plugins: false })
  assert.ok(steps.filter(step => step.id !== 'app').every(step => step.backup))
  assert.ok(existsSync(join(appDir(), 'bin', 'bcx.js')) && existsSync(join(appDir(), 'plugins', 'bcx', '.codex-plugin', 'plugin.json')))
  assert.ok(!existsSync(join(appDir(), 'test')))
  assert.ok(hasOurHooks(JSON.parse(readFileSync(hooksPath(), 'utf8'))))
  assert.ok(installedCommand('Stop').includes(toPosix(appDir())), 'hooks run the installed copy, not the checkout')
  assert.match(readFileSync(agentsPath(), 'utf8'), /^# Mine\n\n<!-- better-codex:start -->/)
  assert.ok(install({ plugins: false }).filter(step => step.id !== 'app').every(step => !step.changed)) // second run: nothing to do

  uninstall()
  assert.deepEqual(JSON.parse(readFileSync(hooksPath(), 'utf8')), USER_HOOKS)
  assert.equal(readFileSync(agentsPath(), 'utf8'), '# Mine\n')
  assert.ok(!existsSync(appDir()))
})

test('a home folder with spaces: every hook runs through the real shells', () => {
  const parent = tempDir('bcx space-')
  const home = join(parent, 'Juan Pérez', '.codex')
  mkdirSync(home, { recursive: true })
  process.env.CODEX_HOME = home
  process.env.BCX_DATA_DIR = join(home, 'better-codex')
  install({ plugins: false, agents: false })
  assert.match(installedCommand('Stop'), /"[^"]*Juan Pérez[^"]*bcx\.js" hook Stop$/)
  const results = smokeTest({ command: installedCommand })
  assert.deepEqual(results.filter(r => !r.ok), [])
})

test('install refuses to overwrite a hooks.json it cannot parse', () => {
  const home = isolate()
  writeFileSync(join(home, 'hooks.json'), '{ broken')
  assert.throws(() => install({ plugins: false, agents: false }), /not valid JSON/)
  assert.equal(readFileSync(join(home, 'hooks.json'), 'utf8'), '{ broken')
})

test('the TUI command adds --no-daemon only for the CLI bundled with the desktop app', () => {
  assert.equal(tuiCommand({ bin: 'codex' }), 'codex')
  assert.equal(tuiCommand(null), 'codex')
  const bundled = tuiCommand({ bin: join('C:', 'Users', 'Juan Pérez', '.codex', '.sandbox-bin', 'codex.exe') })
  assert.match(bundled, /"[^"]*Juan Pérez[^"]*codex\.exe" --no-daemon$/)
})
