import assert from 'node:assert/strict'
import { utimesSync } from 'node:fs'
import { join } from 'node:path'
import { test } from 'node:test'
import { expand, shellAliases, snapshotFile } from '../src/aliases.js'
import { inspect } from '../src/guard.js'
import { isolate, repo, tempDir, write } from './helpers.js'

const codexHome = isolate() // Codex's shell snapshots live in this test's own CODEX_HOME

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

// What Codex writes to CODEX_HOME/shell_snapshots/<session>.<nonce>.sh once zsh has loaded .zshrc and
// oh-my-zsh (codex-rs/shell-command/src/shell_snapshot_capture.rs: `functions`, `setopt`, `alias -L`).
const ZSH_SNAPSHOT = [
  '# Snapshot file',
  '# Unset all aliases to avoid conflicts with functions',
  'unalias -a 2>/dev/null || true',
  '# Functions',
  'ggf () {',
  '\t[[ "$#" != 1 ]] && local b="$(git_current_branch)"',
  '\tgit push --force origin "${b:=$1}"',
  '}',
  'git_current_branch () {',
  '\tlocal ref',
  '\tref=$(__git_prompt_git symbolic-ref --quiet HEAD 2> /dev/null)',
  '\techo ${ref#refs/heads/}',
  '}',
  '',
  '# setopts 2',
  'setopt alwaystoend',
  'setopt autocd',
  '',
  '# aliases 6',
  "alias -- -='cd -'",
  "alias -g G='| grep'",
  "alias 'gc!'='git commit --verbose --amend'",
  "alias grhh='git reset --hard'",
  "alias gpf='git push --force-with-lease --force-if-includes'",
  "alias hi='echo '\\''hi'\\'''",
  '',
  '# exports (native declarations)',
  "export PAGER='less'"
].join('\n')

// bash: `declare -f` puts the brace on its own line, `alias -p` prints alias name='value'.
const BASH_SNAPSHOT = "# Snapshot file\n# Unset all aliases to avoid conflicts with functions\nunalias -a 2>/dev/null || true\nshopt -s checkwinsize\n# Functions\nnukeall () \n{ \n    rm -rf \"$@\"\n}\n\n# setopts 1\nset -o braceexpand\n\n# aliases 1\nalias ll='ls -alF'\n"

test('aliases: Codex\'s shell snapshot has what plugins add, and it wins over the profile files', () => {
  const dir = join(codexHome, 'shell_snapshots')
  write(dir, { 'S1.100.sh': ZSH_SNAPSHOT, 'S2.200.sh': BASH_SNAPSHOT, 'S3.tmp-300': BASH_SNAPSHOT })
  utimesSync(join(dir, 'S1.100.sh'), new Date(2026, 0, 1), new Date(2026, 0, 1)) // older than S2
  assert.equal(snapshotFile('S1'), join(dir, 'S1.100.sh')) // this session's, even if older
  assert.equal(snapshotFile('nope'), join(dir, 'S2.200.sh')) // else the newest, never a half-written .tmp-
  assert.equal(snapshotFile('S1', join(codexHome, 'missing')), null)

  const home = tempDir('bcx-home-')
  write(home, { '.zshrc': "alias grhh='git status'\n" })
  const defs = shellAliases({ home, files: [join(home, '.zshrc')], snapshot: snapshotFile('S1') })
  assert.equal(defs.grhh.body, 'git reset --hard') // the shell as it really starts
  assert.equal(defs['gc!'].body, 'git commit --verbose --amend')
  assert.equal(defs.hi.body, "echo 'hi'")
  assert.equal(defs['-'].body, 'cd -')
  assert.equal(defs.g, undefined)
  assert.match(defs.ggf.body, /git push --force origin "\$\{b:=\$1\}"$/)
  assert.equal(shellAliases({ home, files: [], snapshot: snapshotFile('S2') }).nukeall.body, 'rm -rf "$@"')

  // In a hook, the guard reads the snapshot of the session it runs in.
  const root = repo()
  write(root, { 'src/app.js': 'changed, not committed\n' })
  const found = command => inspect({ toolName: 'Bash', toolInput: { command }, cwd: root, session: 'S1' })
  assert.equal(found('grhh')?.rule, 'git-discard')
  assert.match(found('grhh').detail, /^grhh \(alias in .*S1\.100\.sh\) → git reset --hard/)
  assert.equal(found('ggf')?.rule, 'git-history')
  assert.equal(found('gc!'), null)
  assert.equal(inspect({ toolName: 'Bash', toolInput: { command: 'nukeall src' }, cwd: root, session: 'S2' })?.rule, 'delete')
})
