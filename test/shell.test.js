import assert from 'node:assert/strict'
import { test } from 'node:test'
import { extractCommands, extractWorkdir, patchFiles, segments, shellWrites, toolCommands } from '../src/shell.js'

const CODE = 'const r = await tools.exec_command({cmd:"Get-ChildItem -Force; rg --files | Select-Object -First 250","workdir":"C:\\\\Users\\\\me\\\\repo","yield_time_ms":10000}); text(r.output)'

test('extractCommands: shell string, argv array and code-mode scripts', () => {
  assert.deepEqual(extractCommands({ command: 'npm test' }), ['npm test'])
  assert.deepEqual(extractCommands({ command: ['powershell', '-Command', 'git status'] }), ['powershell -Command git status'])
  assert.deepEqual(extractCommands(CODE), ['Get-ChildItem -Force; rg --files | Select-Object -First 250'])
  assert.deepEqual(extractCommands({ input: CODE }), ['Get-ChildItem -Force; rg --files | Select-Object -First 250'])
  assert.equal(extractWorkdir(CODE, 'x'), 'C:\\Users\\me\\repo')
  assert.equal(extractWorkdir({ command: 'ls', workdir: '/repo' }, 'x'), '/repo')
})

test('toolCommands: a patch is not a command', () => {
  assert.deepEqual(toolCommands('apply_patch', { command: '*** Begin Patch\n*** Delete File: a.js\n*** End Patch' }), [])
})

test('segments: separators, pipes, prefixes and shell wrappers', () => {
  const segs = segments('cat package-lock.json | rg lodash; sudo rm -rf dist && echo ok')
  assert.deepEqual(segs.map(s => [s.verb, s.piped]), [['cat', true], ['rg', false], ['rm', false], ['echo', false]])
  assert.deepEqual(segments('powershell -NoProfile -Command "Remove-Item -Recurse src"').map(s => s.verb), ['remove-item'])
  assert.deepEqual(segments('bash -c \'git reset --hard\'').map(s => s.text), ['git reset --hard'])
  assert.equal(segments('& "C:\\Program Files\\Git\\cmd\\git.exe" status')[0].verb, 'git')
})

test('patchFiles: raw patches and patches inside code-mode strings', () => {
  const raw = '*** Begin Patch\n*** Add File: src/new.js\n+x\n*** Update File: src/a.js\n*** Delete File: old.js\n*** End Patch'
  assert.deepEqual(patchFiles({ command: raw }), [
    { op: 'add', path: 'src/new.js' },
    { op: 'update', path: 'src/a.js' },
    { op: 'delete', path: 'old.js' }
  ])
  const escaped = 'await tools.apply_patch("*** Begin Patch\\n*** Delete File: C:\\\\repo\\\\notes.txt\\n*** End Patch")'
  assert.deepEqual(patchFiles(escaped), [{ op: 'delete', path: 'C:\\repo\\notes.txt' }])
})

test('shellWrites: PowerShell writes, redirects, sed -i and tee', () => {
  assert.deepEqual(shellWrites('Set-Content -Path src/a.ts -Value x'), ['src/a.ts'])
  assert.deepEqual(shellWrites('echo hi > out.txt'), ['out.txt'])
  assert.deepEqual(shellWrites('npm test 2> err.log'), [])
  assert.deepEqual(shellWrites("sed -i 's/a/b/' src/x.py"), ['src/x.py'])
  assert.deepEqual(shellWrites('node build.js | tee dist/log.txt'), ['dist/log.txt'])
  assert.deepEqual(shellWrites('cmd > $null'), [])
})
