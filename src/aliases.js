import { existsSync, readFileSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, isAbsolute, join, resolve } from 'node:path'
import { dataDir } from './paths.js'
import { enclosed, tokenize, verbOf } from './shell.js'
import { readJson, run, toPosix, writeJson } from './util.js'

// Your aliases and functions, so the guard checks what `nuke tmp` runs when your profile says
// nuke = rm -rf. Codex runs PowerShell with your profile loaded (no -NoProfile), and bash and zsh
// setups carry theirs. Read as text: nothing in your profile runs. Aliases that plugins create
// while the shell starts (oh-my-zsh, PowerShell modules) are not seen.

const MAX_BYTES = 256 * 1024
const MAX_FILES = 20
const WEEK = 7 * 24 * 60 * 60 * 1000

// Windows keeps Documents wherever you or OneDrive moved it; the registry knows. Asked once a week.
function documents() {
  const file = join(dataDir(), 'shell.json')
  const saved = readJson(file, {}) || {}
  if (saved.documents && (existsSync(saved.documents) || Date.now() - saved.at < WEEK)) return saved.documents
  const out = run('reg', ['query', 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\User Shell Folders', '/v', 'Personal']) || ''
  const raw = /Personal\s+REG_\w+\s+(.+)/.exec(out)?.[1]?.trim()
  const dir = raw ? raw.replace(/%([^%]+)%/g, (m, name) => process.env[name] ?? m) : join(homedir(), 'Documents')
  writeJson(file, { ...saved, documents: dir, at: Date.now() })
  return dir
}

// Where bash, zsh and PowerShell (Windows PowerShell, pwsh) read your aliases from.
export function profileFiles(home = homedir(), docs = process.platform === 'win32' ? documents() : null) {
  const zdot = process.env.ZDOTDIR || home
  const ps = docs
    ? [join(docs, 'WindowsPowerShell'), join(docs, 'PowerShell'), join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0')]
    : [join(home, '.config', 'powershell')]
  return [
    ...['.bashrc', '.bash_profile', '.bash_login', '.bash_aliases', '.profile', '.aliases'].map(f => join(home, f)),
    ...['.zshenv', '.zprofile', '.zshrc', '.zlogin'].map(f => join(zdot, f)),
    ...ps.flatMap(dir => ['profile.ps1', 'Microsoft.PowerShell_profile.ps1'].map(f => join(dir, f)))
  ]
}

const functions = (text, re) =>
  [...text.matchAll(re)].flatMap(m => {
    const body = enclosed(text, m.index + m[0].length - 1)
    return body == null ? [] : [{ name: m[1] ?? m[2], kind: 'function', body: body.trim() }]
  })

// alias ll='ls -la' · alias yolo="git push --force" · nuke() { rm -rf "$1"; } · function wipe { … }
// zsh global (-g) and suffix (-s) aliases are skipped: they are not the command word.
function shDefinitions(text) {
  const out = []
  for (const m of text.matchAll(/^[ \t]*alias[ \t]+(.+)$/gm)) {
    if (/^-\w*[gs]/.test(m[1])) continue
    const rest = m[1].replace(/^(-\S*\s+)+/, '')
    for (const d of rest.matchAll(/([^\s=]+)=(?:'([^']*)'|"((?:[^"\\]|\\.)*)"|(\S+))/g)) {
      out.push({ name: d[1], kind: 'alias', body: d[2] ?? d[3] ?? d[4] })
    }
  }
  return [...out, ...functions(text, /^[ \t]*(?:function[ \t]+([\w.:-]+)[ \t]*(?:\(\))?|([\w.:-]+)[ \t]*\(\))\s*\{/gm)]
}

// Set-Alias nuke Remove-Item · New-Alias -Name np -Value notepad · sal x y · function Clear-Build { … }
function psDefinitions(text) {
  const out = []
  for (const m of text.matchAll(/^[ \t]*(?:Set-Alias|New-Alias|sal|nal)[ \t]+(.+)$/gim)) {
    const named = {}
    const plain = []
    const argv = tokenize(m[1])
    for (let i = 0; i < argv.length; i++) {
      const flag = /^-(name|value|scope|option|description)$/i.exec(argv[i])?.[1]?.toLowerCase()
      if (flag) named[flag] = argv[++i]
      else if (!argv[i].startsWith('-')) plain.push(argv[i])
    }
    const name = named.name ?? plain.shift()
    const body = named.value ?? plain.shift()
    if (name && body) out.push({ name, kind: 'alias', body })
  }
  return [...out, ...functions(text, /^[ \t]*function[ \t]+(?:global:|script:)?([\w.-]+)[ \t]*(?:\([^)]*\))?\s*\{/gim)]
}

// . ~/.aliases · source "$HOME/.bash_aliases" · . $PSScriptRoot\aliases.ps1 — files in your home only.
function sourced(text, file, home) {
  const out = []
  for (const m of text.matchAll(/(?:^|[;&|]|\bthen)[ \t]*(?:source|\.)[ \t]+("[^"]+"|'[^']+'|[^\s;&|]+)/gm)) {
    const raw = m[1]
      .replace(/^["']|["']$/g, '')
      .replace(/^~(?=[\\/])/, () => home)
      .replace(/\$\{?HOME\}?|\$env:(USERPROFILE|HOME)\b/gi, () => home)
      .replace(/\$PSScriptRoot\b/gi, () => dirname(file))
    if (raw.includes('$')) continue
    const path = isAbsolute(raw) ? raw : resolve(home, raw)
    if (toPosix(path).toLowerCase().startsWith(`${toPosix(home).toLowerCase()}/`)) out.push(path)
  }
  return out
}

// name (as Codex would type it, lowercased) → { name, kind: 'alias' | 'function', body, file }.
// The last definition wins, as in the shell.
export function shellAliases({ home = homedir(), files = profileFiles(home) } = {}) {
  const found = Object.create(null)
  const queue = [...files]
  const seen = new Set()
  let read = 0
  while (queue.length && read < MAX_FILES) {
    const file = queue.shift()
    if (seen.has(file)) continue
    seen.add(file)
    let text
    try {
      if (statSync(file).size > MAX_BYTES) continue
      text = readFileSync(file, 'utf8')
    } catch {
      continue
    }
    read++
    for (const def of /\.ps1$/i.test(file) ? psDefinitions(text) : shDefinitions(text)) found[verbOf(def.name)] = { ...def, file }
    queue.push(...sourced(text, file, home))
  }
  return found
}

// What runs when Codex types `name args`: an alias puts its text before the arguments; a function body
// gets them in $1…$9, $@ and $* (bash, zsh) or $args (PowerShell). Named parameters stay variables.
export function expand(def, args) {
  if (def.kind === 'alias') return [def.body, ...args].join(' ')
  const quoted = args.map(a => (/\s/.test(a) ? `"${a}"` : a))
  return def.body
    .replace(/"?\$\{?[@*]\}?"?/g, quoted.join(' '))
    .replace(/\$\{?([1-9])\}?/g, (m, n) => quoted[n - 1] ?? m)
    .replace(/\$args\[(\d+)\]/gi, (m, n) => quoted[n] ?? m)
    .replace(/\$args\b/gi, quoted.join(' '))
}

// ~/.zshrc instead of /Users/you/.zshrc, for messages.
export const tilde = (file, home = homedir()) => (toPosix(file).startsWith(`${toPosix(home)}/`) ? `~${toPosix(file).slice(toPosix(home).length)}` : toPosix(file))
