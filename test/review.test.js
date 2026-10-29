import assert from 'node:assert/strict'
import { test } from 'node:test'
import { DEFAULTS } from '../src/config.js'
import { handle } from '../src/hooks.js'
import { focusedTests, reviewChanges } from '../src/review.js'
import { isolate, repo, write } from './helpers.js'

isolate()

const shop = () =>
  repo({
    'package.json': JSON.stringify({ type: 'module', scripts: { test: 'node --test' } }),
    'src/cart.js': 'export const total = items => items.length // TODO: taxes\n',
    'test/cart.test.js': "import { test } from 'node:test'\ntest('total', () => {})\n",
    'README.md': '# shop\n'
  })

test('review: what a change left behind, counting only what it added', () => {
  const root = shop()
  write(root, {
    'src/cart.js': 'export const total = items => {\n  debugger\n  return items.length // TODO: taxes, now with VAT\n}\n// FIXME: refunds\n',
    'test/cart.test.js': "import { test } from 'node:test'\ntest.only('total', () => {})\n",
    'src/new.js': "console.log('here', 1)\nexport const x = 1\n",
    'README.md': '# shop\n\nTODO: write docs\n'
  })
  const found = reviewChanges(root, ['src/cart.js', 'test/cart.test.js', 'src/new.js', 'README.md']).map(r => `${r.file}:${r.line} ${r.issue}`)
  assert.deepEqual(found.sort(), ['src/cart.js:2 debugger statement', 'src/cart.js:5 new TODO', 'src/new.js:1 debug print', 'test/cart.test.js:2 focused test (only)'])
  // the TODO that was already there and got edited isn't new; a TODO in the README isn't code
})

test('review: the tests for the files that changed, with the command that runs only them', () => {
  const root = shop()
  assert.equal(focusedTests(root, ['src/cart.js'], 'npm test'), 'node --test test/cart.test.js')
  assert.equal(focusedTests(root, ['README.md'], 'npm test'), null)
  assert.equal(focusedTests(root, ['src/cart.js'], null), null)
})

test('review: the verify gate asks for the focused tests first and for what was left behind', () => {
  const root = shop()
  const cfg = { ...DEFAULTS, lang: 'es' }
  const sid = 'review-gate'
  handle('SessionStart', { session_id: sid, cwd: root, source: 'startup' }, cfg)
  handle('UserPromptSubmit', { session_id: sid, turn_id: 't1', cwd: root, prompt: 'agrega impuestos al total del carrito' }, cfg)
  write(root, { 'src/cart.js': 'export const total = items => {\n  debugger\n  return items.length\n}\n' })
  handle('PostToolUse', { session_id: sid, turn_id: 't1', cwd: root, tool_name: 'apply_patch', tool_input: { command: '*** Begin Patch\n*** Update File: src/cart.js\n*** End Patch' }, tool_response: 'ok' }, cfg)
  const stop = handle('Stop', { session_id: sid, turn_id: 't1', cwd: root, stop_hook_active: false, last_assistant_message: 'Listo.' }, cfg)
  assert.equal(stop.decision, 'block')
  assert.match(stop.reason, /Run `node --test test\/cart\.test\.js` \(the tests for the files you changed\), then `npm test`/)
  assert.match(stop.reason, /left this behind: src\/cart\.js:2 debugger statement/)
  assert.match(stop.systemMessage, /revisar lo que dejó su cambio \(src\/cart\.js:2\)/)
})
