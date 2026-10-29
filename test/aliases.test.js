import assert from 'node:assert/strict'
import { join } from 'node:path'
import { test } from 'node:test'
import { expand, shellAliases } from '../src/aliases.js'
import { inspect } from '../src/guard.js'
import { repo, tempDir, write } from './helpers.js'

// A home with the usual places people keep aliases: .bashrc, .zshrc (sourcing another file) and a PowerShell profile.
function profiles() {
  const home = tempDir('bcx-home-')
  write(home, {
    '.bashrc': [
      '# ~/.bashrc',
      "alias ll='ls -la'",
      "alias nuke='rm -rf'",
      'alias rm="rm -i"',
      'wipe() { rm -rf "$1"; }',
      'function gclean {',
      '  # remove everything git does not track',
      '  git clean -fdx',
      '}',
      '[ -f ~/.my-aliases ] && . ~/.my-aliases'
    ].join('\n'),
    '.my-aliases': 'alias yolo="git push --force"\n',
    '.zshrc': "alias -g G='| grep'\nsource $HOME/.zsh-extra\n",
    '.zsh-extra': 'mkcd() {\n  mkdir -p "$1" && cd "$1"\n}\n',
    'Documents/WindowsPowerShell/Microsoft.PowerShell_profile.ps1': [
      'Set-Alias -Name zap -Value Remove-Item',
      'sal np notepad',
      'function Clear-Build {',
      "  Remove-Item -Recurse -Force src, 'docs' # not only build output",
      '}',
      'function global:Reset-Repo($ref) { git reset --hard $args[0] }'
    ].join('\n')
  })
  const files = ['.bashrc', '.zshrc', 'Documents/WindowsPowerShell/Microsoft.PowerShell_profile.ps1'].map(f => join(home, f))
  return shellAliases({ home, files })
}

test('aliases: read from bash, zsh and PowerShell profiles, and the files they source', () => {
  const defs = profiles()
  assert.deepEqual(
    Object.keys(defs).sort(),
    ['clear-build', 'gclean', 'll', 'mkcd', 'np', 'nuke', 'reset-repo', 'rm', 'wipe', 'yolo', 'zap']
  )
  assert.equal(defs.nuke.body, 'rm -rf')
  assert.equal(defs.yolo.body, 'git push --force') // from ~/.my-aliases
  assert.equal(defs.zap.body, 'Remove-Item')
  assert.match(defs.gclean.body, /^# remove everything git does not track\s+git clean -fdx$/)
  assert.match(defs['clear-build'].body, /Remove-Item -Recurse -Force src, 'docs'/)
  assert.equal(defs.g, undefined) // a zsh global alias is not a command
})

test('aliases: an alias goes before the arguments, a function gets them as $1, $@ or $args', () => {
  assert.equal(expand({ kind: 'alias', body: 'rm -rf' }, ['tmp']), 'rm -rf tmp')
  assert.equal(expand({ kind: 'function', body: 'rm -rf "$1"' }, ['tmp']), 'rm -rf "tmp"')
  assert.equal(expand({ kind: 'function', body: 'rm -rf "$@"' }, ['a', 'b c']), 'rm -rf a "b c"')
  assert.equal(expand({ kind: 'function', body: 'git reset --hard $args[0]' }, ['HEAD~1']), 'git reset --hard HEAD~1')
  assert.equal(expand({ kind: 'function', body: 'rm -rf $2' }, ['x']), 'rm -rf $2') // missing: stays a variable
})

test('guard: what an alias or function from your profile runs is what gets checked', () => {
  const aliases = profiles()
  const root = repo({ 'README.md': '# demo\n', 'src/app.js': 'export const app = 1\n', '.gitignore': 'dist/\n' })
  write(root, { 'tmp/meeting-notes.md': 'mine\n', 'dist/app.js': 'built\n' })
  const found = command => inspect({ toolName: 'Bash', toolInput: { command }, cwd: root, aliases })
  assert.equal(found('nuke tmp')?.rule, 'delete')
  assert.match(found('nuke tmp').detail, /^nuke \(alias in .*\.bashrc\) → deletes tmp/)
  assert.equal(found('nuke tmp').command, 'nuke tmp') // what Codex typed, the one to approve
  assert.equal(found('wipe src')?.rule, 'delete')
  assert.equal(found('wipe dist'), null) // ignored build output, as with rm -rf dist
  assert.equal(found('gclean')?.rule, 'git-discard')
  assert.equal(found('yolo origin main')?.rule, 'git-history')
  assert.equal(found('zap -Recurse src')?.rule, 'delete')
  assert.equal(found('Clear-Build')?.rule, 'delete')
  assert.equal(found('Reset-Repo HEAD~1')?.rule, 'git-history') // drops a commit
  assert.equal(found('powershell -Command "Clear-Build"')?.rule, 'delete')
  // harmless ones, and an alias that names itself, don't loop or ask
  for (const command of ['ll', 'np README.md', 'mkcd build', 'rm -rf node_modules', 'git status']) assert.equal(found(command), null, command)
  assert.equal(found('rm -rf src')?.rule, 'delete')
  // without your profile the same words mean nothing
  assert.equal(inspect({ toolName: 'Bash', toolInput: { command: 'nuke tmp' }, cwd: root, aliases: {} }), null)
})
