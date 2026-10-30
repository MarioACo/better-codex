import assert from 'node:assert/strict'
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { test } from 'node:test'
import { smokeTest } from '../src/doctor.js'
import { agentsPath, appDir, blockOf, hasOurHooks, hookCommand, extensionCodex, hooksPath, hookTrust, install, installedCommand, mergeHooks, removeHooks, tuiCommand, uninstall, withBlock, withoutBlock } from '../src/install.js'
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
  // If this ever fails again, show what is on disk: non-ASCII characters as code points reveal a mangled "é".
  const names = dir => (existsSync(dir) ? readdirSync(dir).map(n => n.replace(/[^\x20-\x7e]/g, c => `\\u${c.charCodeAt(0).toString(16)}`)).join(', ') : 'missing')
  const seen = `script exists: ${existsSync(join(appDir(), 'bin', 'bcx.js'))} · ${parent}: [${names(parent)}] · data: [${names(join(home, 'better-codex'))}] · command: ${installedCommand('Stop')}`
  assert.deepEqual(results.filter(r => !r.ok), [], seen)
})

test('install refuses to overwrite a hooks.json it cannot parse', () => {
  const home = isolate()
  writeFileSync(join(home, 'hooks.json'), '{ broken')
  assert.throws(() => install({ plugins: false, agents: false }), /not valid JSON/)
  assert.equal(readFileSync(join(home, 'hooks.json'), 'utf8'), '{ broken')
})

test('the TUI command adds --no-daemon for the CLIs bundled with the desktop app and the editor extensions', () => {
  assert.equal(tuiCommand({ bin: 'codex' }), 'codex')
  assert.equal(tuiCommand(null), 'codex')
  const bundled = tuiCommand({ bin: join('C:', 'Users', 'Juan Pérez', '.codex', '.sandbox-bin', 'codex.exe') })
  assert.match(bundled, /"[^"]*Juan Pérez[^"]*codex\.exe" --no-daemon$/)
  // seen live with the VS Code extension 26.1021: "this CLI has no complete local package" without it
  const extension = join('C:', 'Users', 'x', '.vscode', 'extensions', 'openai.chatgpt-26.1021.22027-win32-x64', 'bin', 'windows-x86_64', 'codex.exe')
  assert.match(tuiCommand({ bin: extension }), /codex\.exe" --no-daemon$/)
  assert.equal(tuiCommand({ bin: join('C:', 'tools', 'codex', 'codex.exe') }).endsWith('--no-daemon'), false)
})

test('trusting hooks writes [hooks.state] to config.toml: that is not a second set of hooks', () => {
  const home = isolate()
  writeFileSync(join(home, 'config.toml'), "[hooks.state]\n[hooks.state.'x:pre_tool_use:0:0']\ntrusted_hash = \"abc\"\n")
  assert.equal(install({ plugins: false, agents: false }).find(s => s.id === 'hooks').note, null)
  writeFileSync(join(home, 'config.toml'), '[[hooks.PreToolUse]]\nmatcher = "Bash"\n')
  assert.match(install({ plugins: false, agents: false }).find(s => s.id === 'hooks').note, /inline \[hooks\]/)
})

test('install knows when you already trusted the hooks, and when a change needs trusting again', () => {
  const home = isolate()
  writeFileSync(join(home, 'hooks.json'), JSON.stringify(USER_HOOKS)) // yours come first: ours are group 1 in PreToolUse
  const first = install({ plugins: false, agents: false }).find(s => s.id === 'hooks')
  assert.equal(first.trusted, false)
  assert.equal(first.retrust, false)
  assert.equal(hookTrust().trusted, 0)

  // What Codex writes when you trust them in /hooks (Windows paths in single quotes, as seen live).
  const config = readJsonFile(hooksPath())
  const records = []
  for (const [event, groups] of Object.entries(config.hooks)) {
    groups.forEach((group, g) => group.hooks.forEach((h, i) => {
      if (/bcx\.js/.test(h.command)) records.push(`[hooks.state.'${hooksPath()}:${event.replace(/([a-z])([A-Z])/g, '$1_$2').toLowerCase()}:${g}:${i}']\ntrusted_hash = "sha256:abc"`)
    }))
  }
  assert.ok(records.some(r => r.includes(':pre_tool_use:1:0')))
  writeFileSync(join(home, 'config.toml'), `model = "x"\n[hooks.state]\n${records.join('\n')}\n[features]\nhooks = true\n`)
  assert.deepEqual(hookTrust(), { total: 5, trusted: 5, missing: [] })
  assert.equal(install({ plugins: false, agents: false }).find(s => s.id === 'hooks').trusted, true)

  // One record missing: not trusted.
  writeFileSync(join(home, 'config.toml'), records.slice(1).join('\n'))
  assert.equal(hookTrust().trusted, 4)
  assert.equal(install({ plugins: false, agents: false }).find(s => s.id === 'hooks').trusted, false)

  // Trusted, then our definition changes (e.g. another node path): Codex will ask again.
  writeFileSync(join(home, 'config.toml'), records.join('\n'))
  const edited = readJsonFile(hooksPath())
  edited.hooks.Stop.find(g => /bcx\.js/.test(g.hooks[0].command)).hooks[0].timeout = 99
  writeFileSync(hooksPath(), JSON.stringify(edited))
  const after = install({ plugins: false, agents: false }).find(s => s.id === 'hooks')
  assert.equal(after.trusted, false)
  assert.equal(after.retrust, true)
})

const readJsonFile = path => JSON.parse(readFileSync(path, 'utf8'))

test('finds the Codex CLI inside the VS Code, Cursor or Windsurf extension, newest first', () => {
  const home = tempDir()
  const exe = process.platform === 'win32' ? 'codex.exe' : 'codex'
  const fake = path => {
    mkdirSync(join(home, path), { recursive: true })
    writeFileSync(join(home, path, exe), '')
    return join(home, path, exe)
  }
  const old = fake('.vscode/extensions/openai.chatgpt-26.900.1-win32-x64/bin/windows-x86_64')
  const newest = fake('.vscode/extensions/openai.chatgpt-26.1021.22027-win32-x64/bin/windows-x86_64')
  const cursor = fake('.cursor/extensions/openai.chatgpt-26.1000.5-darwin-arm64/bin/macos-aarch64')
  mkdirSync(join(home, '.windsurf/extensions/someone.else-1.0.0/bin/x'), { recursive: true })
  assert.deepEqual(extensionCodex(home), [newest, cursor, old])
  assert.deepEqual(extensionCodex(tempDir()), [])
  // since 26.10 the extension's CLI opens /hooks only with --no-daemon, like the desktop app's
  assert.match(tuiCommand({ bin: newest }), /codex(\.exe)?" --no-daemon$/)
  assert.equal(tuiCommand({ bin: 'cmd.exe', prefix: ['/d', '/s', '/c', 'codex'] }), 'codex')
})
