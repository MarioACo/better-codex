import assert from 'node:assert/strict'
import { test } from 'node:test'
import { dietCheck } from '../src/diet.js'
import { freshState } from '../src/state.js'
import { gateReason, trackTool } from '../src/verify.js'
import { tempDir, write } from './helpers.js'

const diet = (command, cwd, extra = {}) => dietCheck({ toolName: 'Bash', toolInput: { command }, cwd, ...extra })?.rule ?? null

test('diet: big lockfiles and build output, binaries and huge files', () => {
  const cwd = tempDir()
  const big = 'x'.repeat(40 * 1024)
  write(cwd, { 'package-lock.json': big, 'dist/main.js': big, 'app.min.js': big, 'big.log': 'x'.repeat(300 * 1024), 'small.js': 'x' })
  assert.equal(diet('cat package-lock.json', cwd), 'generated')
  assert.equal(diet('Get-Content dist/main.js', cwd), 'generated')
  assert.equal(diet('type app.min.js', cwd), 'generated')
  assert.equal(diet('cat logo.png', cwd), 'binary')
  assert.equal(diet('cat big.log', cwd), 'huge')
  assert.equal(diet('cat small.js', cwd), null)
})

test('diet: small generated files and your pasted text are fine (found replaying real sessions)', () => {
  const cwd = tempDir()
  write(cwd, { 'android/app/build/outputs/apk/debug/output-metadata.json': '{"elements":[]}', 'attachments/.codex/attachments/a/Pasted text.txt': 'x'.repeat(300 * 1024) })
  assert.equal(diet('Get-Content android\\app\\build\\outputs\\apk\\debug\\output-metadata.json', cwd), null)
  assert.equal(diet('Get-Content "attachments/.codex/attachments/a/Pasted text.txt"', cwd), null)
})

test('diet: ranged or filtered reads, and files the user named, are fine', () => {
  const cwd = tempDir()
  write(cwd, { 'big.log': 'x'.repeat(300 * 1024) })
  assert.equal(diet('cat package-lock.json | rg lodash', cwd), null)
  assert.equal(diet('Get-Content big.log -TotalCount 50', cwd), null)
  assert.equal(diet('head -n 50 big.log', cwd), null)
  assert.equal(diet('cat yarn.lock', cwd, { prompt: 'revisa el yarn.lock por favor' }), null)
})

test('diet: recursive listings that would walk node_modules', () => {
  const cwd = tempDir()
  write(cwd, { 'node_modules/a/index.js': '', 'src/a.js': '' })
  assert.equal(diet('Get-ChildItem -Recurse', cwd), 'listing')
  assert.equal(diet('ls -R', cwd), 'listing')
  assert.equal(diet('find . -name "*.js"', cwd), 'listing')
  assert.equal(diet('Get-ChildItem -Recurse src', cwd), null)
  assert.equal(diet('find . -name "*.js" -not -path "*/node_modules/*"', cwd), null)
  assert.equal(diet('rg --files', cwd), null)
})

test('verify gate: code edited and never checked → one reminder', () => {
  const state = freshState()
  const project = { verify: 'npm test' }
  trackTool(state, { toolName: 'apply_patch', toolInput: { command: '*** Begin Patch\n*** Update File: src/a.ts\n*** End Patch' }, cwd: '/r' })
  assert.match(gateReason(state, project), /npm test/)
  trackTool(state, { toolName: 'Bash', toolInput: { command: 'npm test' }, cwd: '/r' })
  assert.equal(gateReason(state, project), null)
  // editing again after the check needs a new check
  trackTool(state, { toolName: 'Bash', toolInput: { command: 'Set-Content -Path src/b.ts -Value x' }, cwd: '/r' })
  assert.match(gateReason(state, project), /src\/b\.ts/)
  state.gateFired = true
  assert.equal(gateReason(state, project), null)
})

test('verify gate: docs-only changes, no verify command, or a custom check', () => {
  const docs = freshState()
  trackTool(docs, { toolName: 'apply_patch', toolInput: { command: '*** Begin Patch\n*** Update File: README.md\n*** End Patch' }, cwd: '/r' })
  assert.equal(gateReason(docs, { verify: 'npm test' }), null)

  const code = freshState()
  trackTool(code, { toolName: 'apply_patch', toolInput: { command: '*** Begin Patch\n*** Update File: a.py\n*** End Patch' }, cwd: '/r' })
  assert.equal(gateReason(code, { verify: null }), null)
  trackTool(code, { toolName: 'Bash', toolInput: { command: 'make verify-all' }, cwd: '/r', verifyCmd: 'make verify-all' })
  assert.equal(gateReason(code, { verify: 'make verify-all' }), null)
})
