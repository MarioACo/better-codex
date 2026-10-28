import assert from 'node:assert/strict'
import { test } from 'node:test'
import { dietCheck } from '../src/diet.js'
import { freshState } from '../src/state.js'
import { failureOf, gateReason, trackTool } from '../src/verify.js'
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

test('verify gate: npm.cmd test inside a PowerShell wrapper counts (seen live on Windows)', () => {
  const state = freshState()
  const project = { verify: 'npm test' }
  trackTool(state, { toolName: 'apply_patch', toolInput: { command: '*** Begin Patch\n*** Update File: src/cart.js\n*** End Patch' }, cwd: '/r' })
  trackTool(state, {
    toolName: 'Bash',
    toolInput: { command: `"C:\WINDOWS\System32\WindowsPowerShell\v1.0\powershell.exe" -Command 'npm.cmd test; git diff -- src/cart.js; git status --short'` },
    cwd: '/r',
    verifyCmd: 'npm test'
  })
  assert.equal(gateReason(state, project), null)
  for (const command of ['pnpm.cmd run lint', 'node.exe --test', 'npx.cmd vitest run']) {
    const s = freshState()
    trackTool(s, { toolName: 'apply_patch', toolInput: { command: '*** Begin Patch\n*** Update File: a.ts\n*** End Patch' }, cwd: '/r' })
    trackTool(s, { toolName: 'Bash', toolInput: { command }, cwd: '/r' })
    assert.equal(gateReason(s, project), null, command)
  }
})

test('failureOf: the line that shows a check failed, for each common tool', () => {
  const failing = {
    'node --test (seen live)': '✔ total (2.4ms)\n✖ applyDiscount usa porcentaje entero (2.0ms)\nℹ tests 2\nℹ pass 1\nℹ fail 1\n',
    jest: 'FAIL src/a.test.ts\nTests:       1 failed, 2 passed, 3 total\n',
    vitest: ' Test Files  1 failed | 3 passed (4)\n',
    mocha: '  3 passing (12ms)\n  1 failing\n',
    pytest: '==== 1 failed, 2 passed in 0.12s ====\n',
    go: '--- FAIL: TestSum (0.00s)\nFAIL\tdemo\t0.002s\n',
    cargo: 'test result: FAILED. 1 passed; 1 failed\n',
    tsc: "src/a.ts(3,7): error TS2322: Type 'string' is not assignable to type 'number'.\n",
    eslint: '✖ 2 problems (1 error, 1 warning)\n',
    gradle: 'BUILD FAILED in 12s\n',
    karma: 'Executed 10 of 10 (2 FAILED) (0.4 secs)\n',
    angular: '✘ [ERROR] TS2304: Cannot find name \'x\'.\nApplication bundle generation failed. [3.1 seconds]\n',
    npm: 'npm error Lifecycle script `test` failed with error:\n'
  }
  for (const [tool, output] of Object.entries(failing)) assert.ok(failureOf(output), tool)
  assert.equal(failureOf(failing['node --test (seen live)']), 'ℹ fail 1')

  const passing = [
    'ℹ tests 3\nℹ pass 3\nℹ fail 0\n',
    'Tests:       3 passed, 3 total\n',
    ' Test Files  4 passed (4)\n',
    '==== 3 passed in 0.10s ====\n',
    'Found 0 errors. Watching for file changes.\n',
    'BUILD SUCCESSFUL in 9s\n',
    'Executed 10 of 10 SUCCESS (0.4 secs)\n',
    '3 examples, 0 failures\n',
    'Application bundle generation complete. [2.9 seconds]\n',
    'Script running with cell ID 3',
    ''
  ]
  for (const output of passing) assert.equal(failureOf(output), null, output)
})

test('verify gate: a check that ran but failed sends Codex back once to fix or explain it', () => {
  const state = freshState()
  const project = { verify: 'npm test' }
  trackTool(state, { toolName: 'apply_patch', toolInput: { command: '*** Begin Patch\n*** Update File: src/cart.js\n*** End Patch' }, cwd: '/r' })
  trackTool(state, { toolName: 'Bash', toolInput: { command: 'npm.cmd test' }, cwd: '/r', output: 'ℹ pass 1\nℹ fail 1\n' })
  assert.match(gateReason(state, project), /last check after your changes failed: "ℹ fail 1"[\s\S]*unrelated/)
  // Codex already said it still fails: no extra request
  state.lastAnswer = 'Cambié applyDiscount, pero el test de total sigue fallando porque importa el nombre anterior.'
  assert.equal(gateReason(state, project), null)
  state.lastAnswer = 'Listo, todo funciona.'
  assert.match(gateReason(state, project), /failed/)
  // fixed and green: nothing to say
  trackTool(state, { toolName: 'Bash', toolInput: { command: 'npm test' }, cwd: '/r', output: 'ℹ pass 2\nℹ fail 0\n' })
  assert.equal(gateReason(state, project), null)
  // only ran the tests, edited nothing: not the gate's business
  const look = freshState()
  trackTool(look, { toolName: 'Bash', toolInput: { command: 'npm test' }, cwd: '/r', output: 'ℹ fail 1\n' })
  assert.equal(gateReason(look, project), null)
})
