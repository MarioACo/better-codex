import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, isAbsolute, join, resolve } from 'node:path'
import { codexHome, dataDir } from './paths.js'
import { enclosed, tokenize, verbOf } from './shell.js'
import { readJson, run, toPosix, writeJson } from './util.js'

// Your aliases and functions, so the guard checks what `nuke tmp` runs when your profile says
// nuke = rm -rf. Codex runs PowerShell with your profile loaded (no -NoProfile), and bash and zsh
// setups carry theirs. Read as text: nothing in your profile runs. On bash and zsh, Codex's shell
// snapshot also has what plugins create at startup (oh-my-zsh); PowerShell modules' aliases are not seen.

const MAX_BYTES = 256 * 1024
// A snapshot holds every function oh-my-zsh and its plugins define.
const MAX_SNAPSHOT_BYTES = 8 * 1024 * 1024
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

// A shell word without its quoting: 'it'\''s' → it's, "a \"b\"" → a "b".
const unquote = word => word.replace(/'([^']*)'|"((?:[^"\\]|\\.)*)"|\\(.)/g, (m, single, double, escaped) => single ?? (double != null ? double.replace(/\\(.)/g, '$1') : escaped))
const WORD = String.raw`(?:'[^']*'|"(?:[^"\\]|\\.)*"|\\.|[^\s'"\\=])+`

// alias ll='ls -la' · alias yolo="git push --force" · nuke() { rm -rf "$1"; } · function wipe { … }
// As zsh's alias -L prints them too: alias 'gc!'='git commit --amend', alias x='it'\''s'.
// zsh global (-g) and suffix (-s) aliases are skipped: they are not the command word.
function shDefinitions(text) {
  const out = []
  for (const m of text.matchAll(/^[ \t]*alias[ \t]+(.+)$/gm)) {
    if (/^-\w*[gs]/.test(m[1])) continue
    // Options before the definitions, up to `--`: alias -- -='cd -' defines `-`.
    const rest = m[1].replace(/^(?:-[^\s=-][^\s=]*\s+)*(?:--\s+)?/, '')
    for (const d of rest.matchAll(new RegExp(`(${WORD})=((?:${WORD}|=)*)`, 'g'))) {
      out.push({ name: unquote(d[1]), kind: 'alias', body: unquote(d[2]) })
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

// Codex's own copy of your shell once it started, with what plugins added (oh-my-zsh included):
// <CODEX_HOME>/shell_snapshots/<session>.<nonce>.sh, bash and zsh only, deleted when the session ends.
// This session's when there is one, else the newest.
export function snapshotFile(session = null, dir = join(codexHome(), 'shell_snapshots')) {
  let names
  try {
    names = readdirSync(dir).filter(name => name.endsWith('.sh') && !name.includes('.tmp-'))
  } catch {
    return null
  }
  const own = session ? names.filter(name => name.startsWith(`${session}.`)) : []
  const dated = (own.length ? own : names).map(name => {
    try {
      return [statSync(join(dir, name)).mtimeMs, join(dir, name)]
    } catch {
      return [0, join(dir, name)]
    }
  })
  return dated.sort((a, b) => b[0] - a[0])[0]?.[1] ?? null
}

// name (as Codex would type it, lowercased) → { name, kind: 'alias' | 'function', body, file }.
// The last definition wins, as in the shell, and Codex's snapshot comes last: it is the shell as it really starts.
export function shellAliases({ home = homedir(), files = profileFiles(home), snapshot = snapshotFile() } = {}) {
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
  try {
    if (snapshot && statSync(snapshot).size <= MAX_SNAPSHOT_BYTES) {
      for (const def of shDefinitions(readFileSync(snapshot, 'utf8'))) found[verbOf(def.name)] = { ...def, file: snapshot }
    }
  } catch {}
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
