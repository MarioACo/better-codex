import { copyFileSync, cpSync, existsSync, mkdirSync, renameSync, rmSync, unlinkSync } from 'node:fs'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'
import { loadConfig, saveConfig } from './config.js'
import { norm } from './guard.js'
import { EVENTS } from './hooks.js'
import { codexHome, dataDir, ROOT } from './paths.js'
import { readJson, readText, run, toPosix, writeJson, writeText } from './util.js'

export const MARKETPLACE = 'better-codex'
export const PLUGINS = ['bcx']
export const BLOCK_START = '<!-- better-codex:start -->'
export const BLOCK_END = '<!-- better-codex:end -->'
// Tool names that run shell commands or patches. Codex maps shell tools to "Bash"; the rest are here in case it doesn't.
const TOOL_MATCHER = '^(Bash|exec|exec_command|shell|shell_command|apply_patch)$'

export const hooksPath = () => join(codexHome(), 'hooks.json')
export const agentsPath = () => join(codexHome(), 'AGENTS.md')

// The installed copy the hooks run from: independent of where the repo is, of npx caches and of nvm switches.
export const appDir = () => join(dataDir(), 'app')
const APP_FILES = ['bin', 'src', 'templates', 'plugins', '.agents', 'package.json', 'LICENSE', 'README.md']

// Absolute paths and no shell syntax, so the same line runs under cmd, PowerShell, bash and zsh.
// A path with spaces is quoted, which every shell accepts as long as the line does not start with it.
export function hookCommand(event, script = join(appDir(), 'bin', 'bcx.js')) {
  const node = toPosix(process.execPath)
  const quote = s => (/\s/.test(s) ? `"${s}"` : s)
  return `${/\s/.test(node) ? 'node' : node} ${quote(toPosix(script))} hook ${event}`
}

// The command Codex will run for an event: the one in hooks.json once installed.
export function installedCommand(event) {
  const groups = readJson(hooksPath(), {})?.hooks?.[event] || []
  return groups.flatMap(group => group.hooks || []).find(isOurs)?.command ?? null
}

export function copyApp({ dryRun = false } = {}) {
  const target = appDir()
  if (norm(resolve(ROOT)) === norm(resolve(target))) return { changed: false, path: target } // running from the copy itself
  if (dryRun) return { changed: true, path: target }
  const staging = `${target}.new-${process.pid}`
  const old = `${target}.old-${process.pid}`
  rmSync(staging, { recursive: true, force: true })
  for (const name of APP_FILES) {
    if (existsSync(join(ROOT, name))) cpSync(join(ROOT, name), join(staging, name), { recursive: true })
  }
  try {
    if (existsSync(target)) renameSync(target, old)
    renameSync(staging, target)
  } catch {
    // A hook running from the old copy can keep it busy on Windows: copy over it instead.
    cpSync(staging, target, { recursive: true, force: true })
  }
  for (const leftover of [staging, old]) rmSync(leftover, { recursive: true, force: true })
  return { changed: true, path: target }
}

export function ourHooks() {
  const handler = (event, timeout = 15) => ({ type: 'command', command: hookCommand(event), timeout })
  return {
    SessionStart: [{ matcher: '^(startup|clear|compact)$', hooks: [handler('SessionStart')] }],
    UserPromptSubmit: [{ hooks: [handler('UserPromptSubmit')] }],
    PreToolUse: [{ matcher: TOOL_MATCHER, hooks: [handler('PreToolUse', 10)] }],
    PostToolUse: [{ matcher: TOOL_MATCHER, hooks: [handler('PostToolUse', 10)] }],
    Stop: [{ hooks: [handler('Stop')] }]
  }
}

const isOurs = handler => typeof handler?.command === 'string' && /bcx\.js"?\s+hook\s/.test(handler.command)

// Your other hooks stay exactly as they are; only better-codex's handlers are replaced.
export function removeHooks(config = {}) {
  const hooks = {}
  for (const [event, groups] of Object.entries(config.hooks || {})) {
    const kept = (Array.isArray(groups) ? groups : [])
      .map(group => ({ ...group, hooks: (group.hooks || []).filter(h => !isOurs(h)) }))
      .filter(group => group.hooks.length)
    if (kept.length) hooks[event] = kept
  }
  return { ...config, hooks }
}

export function mergeHooks(config = {}, ours = ourHooks()) {
  const next = removeHooks(config)
  for (const [event, groups] of Object.entries(ours)) next.hooks[event] = [...(next.hooks[event] || []), ...groups]
  return next
}

export const hasOurHooks = (config = {}) =>
  EVENTS.every(event => (config.hooks?.[event] || []).some(group => (group.hooks || []).some(isOurs)))

const escape = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
const BLOCK_RE = new RegExp(`\\n*${escape(BLOCK_START)}[\\s\\S]*?${escape(BLOCK_END)}\\n?`, 'g')

export const withoutBlock = text => String(text || '').replace(BLOCK_RE, '\n').replace(/^\n+/, '').replace(/\n{3,}$/, '\n\n')

export function withBlock(text, block) {
  const rest = withoutBlock(text).trimEnd()
  return `${rest ? `${rest}\n\n` : ''}${BLOCK_START}\n${block.trim()}\n${BLOCK_END}\n`
}

export const blockOf = text => {
  const m = new RegExp(`${escape(BLOCK_START)}([\\s\\S]*?)${escape(BLOCK_END)}`).exec(String(text || ''))
  return m ? m[1].trim() : null
}

export const agentsBlock = () => readText(join(ROOT, 'templates', 'AGENTS.block.md'), '').trim()

function backup(file) {
  if (!existsSync(file)) return null
  const dir = join(dataDir(), 'backups')
  mkdirSync(dir, { recursive: true })
  const target = join(dir, `${file.replace(/^.*[\\/]/, '')}.${new Date().toISOString().replace(/[:.]/g, '-')}.bak`)
  copyFileSync(file, target)
  return target
}

// Codex as a CLI on PATH (npm: codex.cmd on Windows), or the binary the desktop app keeps in ~/.codex.
export function findCodex() {
  const windows = process.platform === 'win32'
  const candidates = [
    process.env.BCX_CODEX && { bin: process.env.BCX_CODEX },
    { bin: 'codex' },
    windows && { bin: 'cmd.exe', prefix: ['/d', '/s', '/c', 'codex'] },
    ...[...new Set([codexHome(), join(homedir(), '.codex')])].map(home => ({ bin: join(home, '.sandbox-bin', windows ? 'codex.exe' : 'codex') }))
  ].filter(Boolean)
  for (const candidate of candidates) {
    const version = run(candidate.bin, [...(candidate.prefix || []), '--version'], { timeout: 20000 })
    if (version && /codex/i.test(version)) return { ...candidate, version: version.replace(/^codex-cli\s*/i, '').trim() }
  }
  return null
}

export const runCodex = (codex, args, timeout = 60000) => run(codex.bin, [...(codex.prefix || []), ...args], { timeout })

// What the user types to open the Codex TUI (where /hooks lives). The CLI bundled with the
// desktop app refuses to start without its background server unless given --no-daemon.
export function tuiCommand(codex) {
  if (!codex || !/[\\/]\.sandbox-bin[\\/]/.test(codex.bin)) return 'codex'
  return process.platform === 'win32' ? `& "${codex.bin}" --no-daemon` : `"${codex.bin}" --no-daemon`
}

// Where Codex reads the better-codex marketplace from, or null when it is not registered.
export function marketplaceRoot(codex) {
  const out = codex && runCodex(codex, ['plugin', 'marketplace', 'list'])
  const m = out && new RegExp(`^${MARKETPLACE}\\s+(.+)$`, 'm').exec(out)
  return m ? m[1].trim().replace(/^\\\\\?\\/, '') : null
}

export const marketplaceRegistered = codex => marketplaceRoot(codex) !== null

// Each step reports { id, file?, changed, note? }. dryRun computes everything and writes nothing.
export function install({ dryRun = false, hooks = true, agents = true, plugins = true } = {}) {
  const steps = []

  const app = copyApp({ dryRun })
  steps.push({ id: 'app', file: app.path, changed: app.changed })

  if (hooks) {
    const exists = existsSync(hooksPath())
    const current = exists ? readJson(hooksPath(), null) : {}
    if (current === null) throw new Error(`${hooksPath()} is not valid JSON: fix it or move it away, then run install again`)
    const next = mergeHooks(current)
    const changed = JSON.stringify(current) !== JSON.stringify(next)
    let saved = null
    if (changed && !dryRun) {
      saved = backup(hooksPath())
      writeJson(hooksPath(), next)
    }
    const inline = /^\s*\[\[?hooks[.\]]/m.test(readText(join(codexHome(), 'config.toml'), ''))
    steps.push({ id: 'hooks', file: hooksPath(), changed, backup: saved, note: inline ? 'config.toml also has inline [hooks]: Codex merges both and warns at startup' : null })
  }

  if (agents) {
    const before = readText(agentsPath(), '')
    const after = withBlock(before, agentsBlock())
    const changed = before !== after
    let saved = null
    if (changed && !dryRun) {
      saved = backup(agentsPath())
      writeText(agentsPath(), after)
    }
    const override = existsSync(join(codexHome(), 'AGENTS.override.md'))
    steps.push({ id: 'agents', file: agentsPath(), changed, backup: saved, note: override ? 'AGENTS.override.md exists and takes precedence over AGENTS.md' : null })
  }

  if (plugins) {
    const codex = findCodex()
    if (!codex) {
      steps.push({ id: 'plugins', changed: false, failed: true, note: 'codex not found: run `codex plugin marketplace add <this folder>` yourself' })
    } else {
      const root = marketplaceRoot(codex)
      const current = root !== null && norm(resolve(root)) === norm(resolve(appDir()))
      if (dryRun) {
        steps.push({ id: 'plugins', changed: !current, note: `${MARKETPLACE}: ${PLUGINS.join(', ')}` })
      } else {
        // An older install may point the marketplace at a repo checkout: move it to the installed copy.
        if (root !== null && !current) runCodex(codex, ['plugin', 'marketplace', 'remove', MARKETPLACE])
        if (!current) runCodex(codex, ['plugin', 'marketplace', 'add', appDir()])
        const added = PLUGINS.filter(name => runCodex(codex, ['plugin', 'add', `${name}@${MARKETPLACE}`]) !== null)
        const ok = marketplaceRegistered(codex)
        steps.push({
          id: 'plugins',
          changed: !current && ok,
          failed: !ok,
          note: ok ? `${MARKETPLACE}: ${added.length ? added.join(', ') : 'install bcx from /plugins'}` : 'could not register the marketplace'
        })
      }
    }
  }

  if (!dryRun && !loadConfig().installedAt) saveConfig({ installedAt: new Date().toISOString() })
  return steps
}

export function uninstall({ dryRun = false } = {}) {
  const steps = []
  if (existsSync(hooksPath())) {
    const current = readJson(hooksPath(), null)
    if (current) {
      const next = removeHooks(current)
      const changed = JSON.stringify(current) !== JSON.stringify(next)
      if (changed && !dryRun) {
        backup(hooksPath())
        // Nothing of yours was in it: leave no empty file behind.
        const empty = Object.keys(next).length === 1 && Object.keys(next.hooks).length === 0
        if (empty) unlinkSync(hooksPath())
        else writeJson(hooksPath(), next)
      }
      steps.push({ id: 'hooks', file: hooksPath(), changed })
    }
  }
  const before = readText(agentsPath(), null)
  if (before !== null) {
    const after = withoutBlock(before)
    const changed = before !== after
    if (changed && !dryRun) {
      backup(agentsPath())
      writeText(agentsPath(), after)
    }
    steps.push({ id: 'agents', file: agentsPath(), changed })
  }
  const codex = findCodex()
  if (codex && marketplaceRegistered(codex)) {
    if (!dryRun) {
      for (const name of PLUGINS) runCodex(codex, ['plugin', 'remove', `${name}@${MARKETPLACE}`])
      runCodex(codex, ['plugin', 'marketplace', 'remove', MARKETPLACE])
    }
    steps.push({ id: 'plugins', changed: true })
  }
  if (existsSync(appDir())) {
    let removed = true
    if (!dryRun) {
      try {
        rmSync(appDir(), { recursive: true, force: true, maxRetries: 3 })
      } catch {
        removed = false
      }
    }
    steps.push({ id: 'app', file: appDir(), changed: removed, failed: !removed })
  }
  return steps
}
