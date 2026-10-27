import { existsSync, readdirSync } from 'node:fs'
import { basename, join } from 'node:path'
import { readJson, readText } from './util.js'

const WINDOWS = process.platform === 'win32'

// Dependency → label, in the order they are shown.
const FRAMEWORKS = [
  ['next', 'Next.js'],
  ['nuxt', 'Nuxt'],
  ['@angular/core', 'Angular'],
  ['@ionic/angular', 'Ionic'],
  ['@ionic/react', 'Ionic'],
  ['@ionic/vue', 'Ionic'],
  ['@capacitor/core', 'Capacitor'],
  ['react-native', 'React Native'],
  ['expo', 'Expo'],
  ['react', 'React'],
  ['vue', 'Vue'],
  ['svelte', 'Svelte'],
  ['astro', 'Astro'],
  ['electron', 'Electron'],
  ['@nestjs/core', 'NestJS'],
  ['express', 'Express'],
  ['fastify', 'Fastify'],
  ['vite', 'Vite'],
  ['typescript', 'TypeScript'],
  ['tailwindcss', 'Tailwind']
]

// A test script the agent can run once and get an answer from: not a watcher, not the npm placeholder.
export function testCommand(raw, cmd) {
  if (!raw || /no test specified/i.test(raw)) return null
  if (/\b(ng test|karma)\b/.test(raw) && !/--watch[= ]false|--no-watch/.test(raw)) {
    return `${cmd} -- --watch=false --browsers=ChromeHeadless`
  }
  if (/\bvitest\b/.test(raw) && !/\bvitest run\b|--run\b/.test(raw)) return `${cmd} -- --run`
  if (/--watch(?![=-]?false)\b|--watchAll(?!=false)/.test(raw)) return null
  return cmd
}

export function detectProject(root) {
  const has = name => existsSync(join(root, name))
  const read = name => readText(join(root, name), '')
  const stack = []
  const commands = {}
  const set = (key, cmd) => {
    if (cmd && !commands[key]) commands[key] = cmd
  }

  const pkg = has('package.json') ? readJson(join(root, 'package.json'), {}) : null
  if (pkg) {
    const pm = has('pnpm-lock.yaml') ? 'pnpm' : has('yarn.lock') ? 'yarn' : has('bun.lockb') || has('bun.lock') ? 'bun' : 'npm'
    const script = name =>
      pm === 'npm' ? (name === 'test' ? 'npm test' : `npm run ${name}`) : pm === 'yarn' ? `yarn ${name}` : `${pm} run ${name}`
    const deps = { ...pkg.dependencies, ...pkg.devDependencies }
    const frameworks = [...new Set(FRAMEWORKS.filter(([dep]) => dep in deps).map(([, label]) => label))]
    stack.push([`Node/${pm}${pkg.type === 'module' ? ' (ESM)' : ''}`, ...frameworks.slice(0, 6)].join(', '))
    const scripts = pkg.scripts || {}
    if (scripts.check) set('check', script('check'))
    if (scripts.test) set('test', testCommand(scripts.test, script('test')))
    for (const name of ['typecheck', 'type-check', 'tsc']) if (scripts[name]) set('typecheck', script(name))
    if (scripts.lint) set('lint', script('lint'))
    if (scripts.build) set('build', script('build'))
    for (const name of ['dev', 'start', 'serve']) if (scripts[name]) set('dev', script(name))
  }

  const pyproject = read('pyproject.toml')
  if (pyproject || has('requirements.txt') || has('setup.py')) {
    const runner = has('uv.lock') ? 'uv run ' : has('poetry.lock') ? 'poetry run ' : ''
    const deps = `${pyproject}\n${read('requirements.txt')}`
    const frameworks = ['django', 'flask', 'fastapi'].filter(name => new RegExp(`\\b${name}\\b`, 'i').test(deps))
    stack.push([`Python${runner ? ` (${runner.trim().split(' ')[0]})` : ''}`, ...frameworks].join(', '))
    if (/pytest/.test(deps) || has('pytest.ini') || has('conftest.py') || has('tests')) set('test', `${runner}pytest -q`)
    if (/\bruff\b/.test(deps) || has('ruff.toml')) set('lint', `${runner}ruff check .`)
    if (/\bmypy\b/.test(deps)) set('typecheck', `${runner}mypy .`)
  }

  if (has('Cargo.toml')) {
    stack.push('Rust/Cargo')
    set('test', 'cargo test')
    set('typecheck', 'cargo check')
    set('lint', 'cargo clippy')
    set('build', 'cargo build')
  }

  if (has('go.mod')) {
    stack.push('Go')
    set('test', 'go test ./...')
    set('lint', 'go vet ./...')
    set('build', 'go build ./...')
  }

  if (has('pom.xml')) {
    const mvn = has('mvnw') ? (WINDOWS ? 'mvnw.cmd' : './mvnw') : 'mvn'
    stack.push('Java/Maven')
    set('test', `${mvn} -q test`)
    set('build', `${mvn} -q package -DskipTests`)
  }

  if (has('build.gradle') || has('build.gradle.kts')) {
    const gradle = has('gradlew') ? (WINDOWS ? 'gradlew.bat' : './gradlew') : 'gradle'
    const android = has('app/src/main/AndroidManifest.xml')
    stack.push(android ? 'Android/Gradle' : 'Gradle')
    set('test', `${gradle} test`)
    set('build', `${gradle} ${android ? 'assembleDebug' : 'build'}`)
  }
  if (has('android/build.gradle') || has('android/gradlew')) stack.push('android/ (native, Gradle)')
  if (has('ios/App') || has('ios/Podfile')) stack.push('ios/ (native, Xcode)')

  let entries = []
  try {
    entries = readdirSync(root)
  } catch {}
  if (entries.some(name => /\.(sln|slnx|csproj|fsproj)$/i.test(name))) {
    stack.push('.NET')
    set('test', 'dotnet test')
    set('build', 'dotnet build')
  }

  if (has('composer.json')) {
    const composer = readJson(join(root, 'composer.json'), {})
    stack.push(has('artisan') ? 'PHP/Laravel' : 'PHP/Composer')
    set('test', composer.scripts?.test ? 'composer test' : has('artisan') ? 'php artisan test' : has('vendor/bin/phpunit') ? 'vendor/bin/phpunit' : null)
  }

  if (has('Gemfile')) {
    stack.push(has('config/application.rb') ? 'Ruby/Rails' : 'Ruby')
    set('test', has('spec') ? 'bundle exec rspec' : 'bundle exec rake test')
  }

  if (has('pubspec.yaml')) {
    const flutter = /^\s*flutter:/m.test(read('pubspec.yaml'))
    stack.push(flutter ? 'Flutter' : 'Dart')
    set('test', flutter ? 'flutter test' : 'dart test')
    set('lint', flutter ? 'flutter analyze' : 'dart analyze')
  }

  if (has('deno.json') || has('deno.jsonc')) {
    stack.push('Deno')
    set('test', 'deno test')
    set('lint', 'deno lint')
  }

  if (has('Makefile')) {
    const make = read('Makefile')
    if (/^check:/m.test(make)) set('check', 'make check')
    if (/^test:/m.test(make)) set('test', 'make test')
  }

  const verify = commands.check || commands.test || commands.typecheck || commands.lint || commands.build || null
  return { root, name: basename(root), stack, commands, verify }
}
