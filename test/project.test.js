import assert from 'node:assert/strict'
import { test } from 'node:test'
import { layoutOf, onPath, shellLine } from '../src/brief.js'
import { parseValue } from '../src/config.js'
import { infraLines } from '../src/infra.js'
import { detectProject, testCommand } from '../src/project.js'
import { isolate, tempDir, write } from './helpers.js'
import { duration, rememberSlow, slowCommands } from '../src/slow.js'

const project = files => {
  const root = tempDir()
  write(root, files)
  return detectProject(root)
}

test('test scripts the agent can run once', () => {
  assert.equal(testCommand('echo "Error: no test specified" && exit 1', 'npm test'), null)
  assert.equal(testCommand('vitest', 'npm test'), 'npm test -- --run')
  assert.equal(testCommand('vitest run', 'npm test'), 'npm test')
  assert.equal(testCommand('ng test', 'npm test'), 'npm test -- --watch=false --browsers=ChromeHeadless')
  assert.equal(testCommand('jest --watch', 'npm test'), null)
  assert.equal(testCommand('jest --watchAll=false', 'npm test'), 'npm test')
  assert.equal(testCommand('node --test', 'npm test'), 'npm test')
})

test('Node: package manager, frameworks and the best verify command', () => {
  const ionic = project({
    'package.json': JSON.stringify({ scripts: { test: 'ng test', lint: 'ng lint', build: 'ng build' }, dependencies: { '@angular/core': '17', '@ionic/angular': '7', '@capacitor/core': '5' } }),
    'android/build.gradle': ''
  })
  assert.match(ionic.stack[0], /Node\/npm, Angular, Ionic, Capacitor/)
  assert.ok(ionic.stack.includes('android/ (native, Gradle)'))
  assert.equal(ionic.verify, 'npm test -- --watch=false --browsers=ChromeHeadless')

  const pnpm = project({ 'package.json': JSON.stringify({ scripts: { check: 'tsc && vitest run', test: 'vitest' } }), 'pnpm-lock.yaml': '' })
  assert.equal(pnpm.verify, 'pnpm run check')
  assert.equal(pnpm.commands.test, 'pnpm run test -- --run')

  assert.equal(project({ 'package.json': JSON.stringify({ scripts: { build: 'vite build' } }) }).verify, 'npm run build')
})

test('other ecosystems', () => {
  assert.equal(project({ 'pyproject.toml': '[tool.pytest]\n', 'uv.lock': '' }).verify, 'uv run pytest -q')
  assert.equal(project({ 'Cargo.toml': '' }).verify, 'cargo test')
  assert.equal(project({ 'go.mod': '' }).verify, 'go test ./...')
  assert.equal(project({ 'App.sln': '' }).verify, 'dotnet test')
  assert.equal(project({ 'pubspec.yaml': 'dependencies:\n  flutter:\n    sdk: flutter\n' }).verify, 'flutter test')
  assert.equal(project({ 'notes.txt': '' }).verify, null)
})

test('layout: biggest folders first', () => {
  assert.equal(layoutOf(['src/a.js', 'src/b.js', 'test/a.js', 'README.md']), '4 files · src/ (2) · test/ (1) · 1 at root')
  assert.equal(layoutOf([]), '')
})

test('config values typed on the command line', () => {
  assert.equal(parseValue('guard', 'off'), false)
  assert.equal(parseValue('verifyGate', 'sí'), true)
  assert.equal(parseValue('dietMaxKB', '500'), 500)
  assert.equal(parseValue('meter', 'always'), 'always')
  assert.throws(() => parseValue('meter', 'loud'), /warn \| always \| off/)
  assert.throws(() => parseValue('nope', '1'), /unknown key/)
})

test('brief: shell notes for the first calls that failed live (npm.ps1 blocked, rg missing)', () => {
  assert.equal(
    shellLine({ root: '/r', commands: 'npm test npm run build', platform: 'win32', hasRg: false }),
    '- shell: in PowerShell call `npm.cmd` (the .ps1 wrapper may be blocked); `rg` is not installed: search with `git grep -n`'
  )
  assert.match(shellLine({ root: null, commands: 'pnpm test', platform: 'win32', hasRg: true }), /`pnpm\.cmd`/)
  assert.equal(shellLine({ root: '/r', commands: 'npm test', platform: 'linux', hasRg: true }), '')
  assert.equal(shellLine({ root: '/r', commands: 'cargo test', platform: 'win32', hasRg: true }), '')
  assert.equal(onPath('definitely-not-a-real-tool-bcx'), false)
  assert.equal(onPath('node'), true)
})

test('slow commands: remembered per repo, slowest first, a few at most', () => {
  isolate()
  rememberSlow('/r', 'npm   test', 75)
  rememberSlow('/r', './gradlew assembleDebug', 260)
  rememberSlow('/other', 'make', 40)
  assert.deepEqual(slowCommands('/r'), [{ command: './gradlew assembleDebug', seconds: 260 }, { command: 'npm test', seconds: 75 }])
  assert.equal(duration(260), '~4 min')
  assert.equal(duration(75), '~75 s')
  assert.deepEqual(slowCommands('/nowhere'), [])
})

test('brief: infrastructure and database, with the checks of the tools installed here', () => {
  const root = tempDir()
  write(root, { 'docker-compose.yml': 'services:\n  db:\n    image: postgres:16\n  cache:\n    image: "redis:7-alpine"\n  api:\n    build: .\n', 'charts/api/Chart.yaml': 'name: api\n' })
  const files = ['Dockerfile', 'docker-compose.yml', 'infra/main.tf', 'infra/vars.tf', 'k8s/deploy.yaml', 'charts/api/Chart.yaml', 'charts/api/templates/svc.yaml', '.github/workflows/ci.yml', 'prisma/schema.prisma', 'prisma/migrations/20240101000000_init/migration.sql', 'src/app.ts']
  const bin = tempDir('bcx-bin-')
  write(bin, { docker: '', terraform: '' })
  const saved = process.env.PATH
  process.env.PATH = bin
  try {
    const [infra, db, checks] = infraLines(root, files)
    assert.equal(infra, '- infra: Dockerfile · Compose (postgres, redis) · Terraform (infra/) · Kubernetes (k8s/) · Helm (charts/api) · GitHub Actions')
    assert.match(db, /^- db: Prisma \(1 migration in prisma\/migrations\)\. Add a new migration/)
    assert.match(checks, /`docker build --check -f Dockerfile \.` · `docker compose -f docker-compose\.yml config -q` · `terraform fmt -check -recursive && terraform -chdir=infra validate` · `npx prisma validate`\. Never apply/)
    assert.doesNotMatch(checks, /helm lint|actionlint|kubeconform/) // not installed here
  } finally {
    process.env.PATH = saved
  }
  assert.deepEqual(infraLines(root, ['src/app.ts', 'README.md']), [])
})
