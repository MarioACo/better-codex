import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { test } from 'node:test'
import { inspect } from '../src/guard.js'
import { backup, canBackup, LIMITS, listUndo, restore } from '../src/undo.js'
import { isolate, repo, write } from './helpers.js'

isolate()
const found = (command, cwd) => inspect({ toolName: 'Bash', toolInput: { command }, cwd })
const git = (cwd, ...args) => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim()
const read = (root, path) => readFileSync(join(root, path), 'utf8')

test('undo: an approved delete is copied first, without generated folders, and comes back without replacing your files', () => {
  const root = repo()
  write(root, { 'tmp/notes.md': 'mine\n', 'tmp/sub/a.txt': 'a\n', 'tmp/node_modules/x/index.js': 'x\n' })
  const hit = found('rm -rf tmp', root)
  assert.equal(hit.rule, 'delete')
  assert.ok(canBackup(hit))
  const entry = backup(hit)
  assert.equal(entry.files.count, 2) // node_modules left out
  assert.equal(listUndo()[0].id, entry.id)

  rmSync(join(root, 'tmp'), { recursive: true })
  write(root, { 'tmp/notes.md': 'new since then\n' })
  const report = restore(entry)
  assert.equal(read(root, 'tmp/sub/a.txt'), 'a\n')
  assert.equal(read(root, 'tmp/notes.md'), 'new since then\n') // exists again: left as it is
  assert.equal(report.kept.length, 1)

  const forced = restore(entry, { overwrite: true })
  assert.equal(read(root, 'tmp/notes.md'), 'mine\n')
  assert.equal(forced.saved.length, 1) // the version it replaced is a copy of its own
  assert.equal(restore(listUndo()[0], { overwrite: true }).restored.length, 1)
  assert.equal(read(root, 'tmp/notes.md'), 'new since then\n')
})

test('undo: a git snapshot brings back uncommitted work, untracked files, a reset branch, a deleted branch and a dropped stash', () => {
  const root = repo()
  git(root, 'branch', 'feature')
  write(root, { 'src/app.js': 'export const app = 2\n' })
  git(root, 'commit', '-qam', 'two')
  const two = git(root, 'rev-parse', 'HEAD')
  write(root, { 'README.md': 'stashed\n' })
  git(root, 'stash', 'push', '-q')
  write(root, { 'README.md': '# demo, edited\n', 'notes.md': 'untracked\n' })
  git(root, 'add', 'README.md') // staged, so the index has something to lose too
  const status = git(root, 'status', '--porcelain')

  const hit = found('git reset --hard HEAD~1', root)
  assert.equal(hit.rule, 'git-history')
  const entry = backup(hit)
  assert.equal(git(root, 'status', '--porcelain'), status) // your index and files are untouched
  assert.equal(entry.git.changed, 2)
  assert.match(git(root, 'log', '-1', '--format=%an', entry.git.ref), /better-codex/)

  git(root, 'reset', '-q', '--hard', 'HEAD~1')
  git(root, 'clean', '-qfd')
  git(root, 'branch', '-qD', 'feature')
  git(root, 'stash', 'drop', '-q')
  assert.ok(!existsSync(join(root, 'notes.md')))

  const report = restore(entry)
  assert.equal(git(root, 'rev-parse', 'HEAD'), two)
  assert.equal(read(root, 'README.md'), '# demo, edited\n')
  assert.equal(read(root, 'notes.md'), 'untracked\n')
  assert.equal(read(root, 'src/app.js').replace(/\r/g, ''), 'export const app = 2\n') // committed: checked out as git does (autocrlf)
  assert.ok(git(root, 'branch', '--list', 'feature'))
  assert.equal(git(root, 'stash', 'list').split('\n').length, 1)
  assert.equal(report.saved.length, 1) // the state before undoing, in case undo was the mistake
})

test('undo: git clean -fdx copies the ignored files it would delete, such as .env', () => {
  const root = repo({ '.gitignore': '.env\nnode_modules/\n', 'README.md': '# demo\n' })
  write(root, { '.env': 'TOKEN=secret\n', 'node_modules/x/index.js': 'x\n', 'scratch.txt': 'draft\n' })
  const entry = backup(found('git clean -fdx', root))
  assert.deepEqual(entry.files.paths.map(p => p.path.replace(/\\/g, '/').split('/').pop()).sort(), ['.env', 'scratch.txt'])
  git(root, 'clean', '-qfdx')
  restore(entry)
  assert.equal(read(root, '.env'), 'TOKEN=secret\n')
})

test('undo: past the limits nothing is copied, and old copies go with their git refs', () => {
  const root = repo()
  write(root, { 'big/a.bin': 'x'.repeat(100) })
  assert.deepEqual(Object.keys(backup(found('rm -rf big', root), { limits: { ...LIMITS, bytes: 10 } })), ['skipped'])
  assert.equal(backup(found('rm -rf missing-folder', root)), null) // nothing there to save

  const limits = { ...LIMITS, keep: 2 }
  const first = backup(found('git reset --hard HEAD', root), { limits })
  backup(found('git branch -D feature', root), { limits })
  backup(found('git push --force origin main', root), { limits })
  assert.equal(listUndo().length, 2)
  assert.ok(!listUndo().some(e => e.id === first.id))
  assert.equal(git(root, 'for-each-ref', 'refs/bcx/undo').split('\n').length, 2)
})
