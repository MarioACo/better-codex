import assert from 'node:assert/strict'
import { test } from 'node:test'
import { DEFAULTS } from '../src/config.js'
import { fixCommand, learnedFixes, learnFix } from '../src/fix.js'
import { handle } from '../src/hooks.js'
import { isolate, repo } from './helpers.js'

isolate()
const win = (command, learned = {}) => fixCommand(command, { platform: 'win32', learned })?.command ?? null

test('fix: npm.cmd on Windows, quieter npm install, nothing else touched', () => {
  assert.equal(win('npm test'), 'npm.cmd test')
  assert.equal(win('cd web && npm install'), 'cd web && npm.cmd install --no-audit --no-fund')
  assert.equal(win('npx tsc --noEmit; npm run build'), 'npx.cmd tsc --noEmit; npm.cmd run build')
  assert.equal(win('& npm ci'), '& npm.cmd ci --no-audit --no-fund')
  for (const command of ['npm.cmd test', 'git status', 'node -e "require(\'npm\')"', 'echo npm']) assert.equal(win(command), null, command)
  assert.equal(fixCommand('npm test', { platform: 'linux', learned: {} }), null)
  assert.equal(fixCommand('npm install', { platform: 'linux', learned: {} }).command, 'npm install --no-audit --no-fund')
})

test('fix: a missing program and the variant that worked right after are remembered', () => {
  const state = {}
  assert.equal(learnFix(state, 'python app.py', "python : The term 'python' is not recognized as the name of a cmdlet"), null)
  assert.equal(learnFix(state, 'git status', 'On branch main'), null) // unrelated: keeps waiting
  assert.deepEqual(learnFix(state, 'py app.py', 'ok'), { from: 'python', to: 'py' })
  assert.deepEqual(learnedFixes(), { python: 'py' })
  assert.equal(fixCommand('python -m pytest', { platform: 'linux' }).command, 'py -m pytest')
  // only known variants: a missing program followed by anything else teaches nothing
  const other = {}
  learnFix(other, 'foo x', 'foo: command not found')
  assert.equal(learnFix(other, 'bar x', 'ok'), null)
})

test('fix: PreToolUse rewrites the command it already checked (allow only carries the new input in Codex)', () => {
  const root = repo()
  const out = handle('PreToolUse', { session_id: 'fix', turn_id: 't1', cwd: root, tool_name: 'Bash', tool_input: { command: 'npm install' } }, DEFAULTS)
  assert.equal(out.hookSpecificOutput.permissionDecision, 'allow') // Codex applies updatedInput only with it
  assert.match(out.hookSpecificOutput.updatedInput.command, /npm(\.cmd)? install --no-audit --no-fund/)
  assert.equal(handle('PreToolUse', { session_id: 'fix', turn_id: 't1', cwd: root, tool_name: 'Bash', tool_input: { command: 'npm install' } }, { ...DEFAULTS, fix: false }), null)
  // a risky command is still stopped, not rewritten
  assert.equal(handle('PreToolUse', { session_id: 'fix', turn_id: 't1', cwd: root, tool_name: 'Bash', tool_input: { command: 'npm publish' } }, DEFAULTS).hookSpecificOutput.permissionDecision, 'deny')
})
