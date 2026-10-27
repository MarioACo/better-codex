import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { after } from 'node:test'

const made = []
after(() => {
  for (const dir of made) rmSync(dir, { recursive: true, force: true })
})

export function tempDir(prefix = 'bcx-test-') {
  const dir = mkdtempSync(join(tmpdir(), prefix))
  made.push(dir)
  return dir
}

// Each test file gets its own Codex home and data folder: nothing touches ~/.codex.
export function isolate() {
  const home = tempDir('bcx-home-')
  process.env.CODEX_HOME = home
  process.env.BCX_DATA_DIR = join(home, 'better-codex')
  return home
}

export function write(root, files) {
  for (const [path, content] of Object.entries(files)) {
    mkdirSync(dirname(join(root, path)), { recursive: true })
    writeFileSync(join(root, path), content)
  }
}

const git = (cwd, ...args) => execFileSync('git', args, { cwd, stdio: ['ignore', 'pipe', 'ignore'], encoding: 'utf8' })

// A repository with one commit; the identity is local to this temporary repo.
export function repo(files = { 'README.md': '# demo\n', 'src/app.js': 'export const app = 1\n' }) {
  const root = tempDir('bcx-repo-')
  write(root, files)
  git(root, 'init', '-q')
  git(root, 'config', 'user.email', 'test@example.com')
  git(root, 'config', 'user.name', 'test')
  git(root, 'config', 'commit.gpgsign', 'false')
  git(root, 'add', '-A')
  git(root, 'commit', '-q', '-m', 'init')
  return root
}
