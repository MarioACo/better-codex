import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { allowFile, allowedFor, saveAllowed } from '../src/allow.js'
import { DEFAULTS, saveConfig } from '../src/config.js'
import { allowRule, canon, inspect } from '../src/guard.js'
import { handle } from '../src/hooks.js'
import { ROOT } from '../src/paths.js'
import { isolate, repo, write } from './helpers.js'

const home = isolate()
const rule = (command, cwd) => inspect({ toolName: 'Bash', toolInput: { command }, cwd })?.rule ?? null
const allow = (command, cwd) => {
  const made = allowRule(inspect({ toolName: 'Bash', toolInput: { command }, cwd, allow: [] }), cwd)
  saveAllowed(made.repo, [...allowedFor(made.repo), { ...made.rule, command }])
  return made
}
const bcx = (args, cwd) => spawnSync(process.execPath, [join(ROOT, 'bin', 'bcx.js'), ...args], { cwd, encoding: 'utf8' })

test('allow: a folder you allow covers what is inside it, in that repo only, and nothing else', () => {
  const root = repo()
  write(root, { 'generated/api.ts': 'x', 'generated/sub/b.ts': 'y' })
  assert.equal(rule('rm -rf generated', root), 'delete')
  assert.deepEqual(allow('rm -rf generated/', root).rule, { rule: 'delete', paths: ['generated'] })
  for (const command of ['rm -rf generated', 'Remove-Item -Recurse -Force .\\generated', 'rm -rf generated/sub']) assert.equal(rule(command, root), null, command)
  assert.equal(rule('rm -rf src', root), 'delete')
  assert.equal(rule('rm -rf generated src', root), 'delete') // src isn't covered
  assert.equal(rule('rm -rf generated && rm -rf src', root), 'delete') // the allowed part doesn't hide the rest
  assert.equal(rule('rm -rf $dir', root), 'delete') // a variable could be anything

  const other = repo()
  write(other, { 'generated/api.ts': 'x' })
  assert.equal(rule('rm -rf generated', other), 'delete')
})

test('allow: other actions are allowed as they are, without the files they would lose at the time', () => {
  const root = repo()
  allow('git push --force origin feat/x', root)
  assert.equal(rule('git push --force origin feat/x', root), null)
  assert.equal(rule('git push --force origin main', root), 'git-history')
  write(root, { 'README.md': 'edited\n' })
  allow('git checkout -- .', root)
  write(root, { 'src/app.js': 'also edited\n' })
  assert.equal(rule('git checkout -- .', root), null) // "(would lose: …)" changed, the action didn't
  assert.equal(allowRule(inspect({ toolName: 'Bash', toolInput: { command: `rm -rf ${join(homedir(), 'bcx-elsewhere')}` }, cwd: root }), root).error, 'outside')
})

test('allow: Codex cannot grant itself permission or switch the guard off', () => {
  const root = repo()
  for (const command of [
    'bcx allow "rm -rf src"',
    'node bin/bcx.js allow --remove 1',
    'npx @marioaco/better-codex allow "rm -rf src"',
    'bcx config set guard off',
    'bcx config set undo false',
    'bcx uninstall',
    `echo {} > ${join(home, 'better-codex', 'allow.json')}`,
    `Copy-Item x.json ${join(home, 'hooks.json')}`,
    "Set-Content ~/.codex/better-codex/config.json '{}'",
    `node -e "require('fs').writeFileSync(require('os').homedir() + '/.codex/better-codex/allow.json', '{}')"`
  ]) {
    assert.equal(rule(command, root), 'bcx-settings', command)
  }
  const patch = `*** Begin Patch\n*** Update File: ${allowFile()}\n@@\n-{}\n+{"x":[]}\n*** End Patch`
  assert.equal(inspect({ toolName: 'apply_patch', toolInput: { input: patch }, cwd: root }).rule, 'bcx-settings')
  // looking is fine
  for (const command of ['bcx allow', 'bcx config', 'bcx config set lang es', 'bcx undo', 'cat ~/.codex/hooks.json', 'bcx guard "rm -rf src"']) assert.equal(rule(command, root), null, command)
  assert.equal(allowRule({ rule: 'bcx-settings', detail: 'x' }, root).error, 'settings')
})

test('allow: the stop message offers it, and bcx allow lists, adds and removes', () => {
  const root = repo()
  write(root, { 'out/report.txt': 'mine\n' })
  const sid = 'allow-stop'
  handle('UserPromptSubmit', { session_id: sid, turn_id: 't1', cwd: root, prompt: 'limpia out' }, DEFAULTS)
  handle('PreToolUse', { session_id: sid, turn_id: 't1', cwd: root, tool_name: 'Bash', tool_input: { command: 'rm -rf out' } }, DEFAULTS)
  const stop = handle('Stop', { session_id: sid, turn_id: 't1', cwd: root, stop_hook_active: false }, { ...DEFAULTS, lang: 'en' })
  assert.match(stop.systemMessage, /If it is always fine in this repo: bcx allow "rm -rf out"/)

  saveConfig({ lang: 'en' }) // the CLI reads the same isolated data folder
  assert.match(bcx(['allow'], root).stdout, /Nothing allowed in/)
  assert.match(bcx(['allow', 'rm -rf out'], root).stdout, /allowed in .*: Delete files or folders: out\/…/)
  assert.match(bcx(['guard', 'rm -rf out'], root).stdout, /you allowed it in this repo/)
  assert.match(bcx(['allow'], root).stdout, /1 {2}Delete files or folders: out\/…/)
  assert.match(bcx(['allow', 'git push --force origin main'], root).stderr, /critical/)
  assert.match(bcx(['allow', 'rm -rf node_modules'], root).stdout, /already lets it through/)
  assert.match(bcx(['allow', '--remove', '1'], root).stdout, /removed/)
  assert.deepEqual(allowedFor(canon(root)), [])
})
