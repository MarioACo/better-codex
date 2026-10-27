// Turns what a tool call carries (a shell string, an argv array, a code-mode script, a patch)
// into commands and segments the hooks can reason about. Heuristic on purpose: fast, no shell.

const unquote = literal => {
  if (literal[0] === '"') {
    try {
      return JSON.parse(literal)
    } catch {}
  }
  return literal.slice(1, -1).replace(/\\(.)/g, (_, c) => ({ n: '\n', t: '\t', r: '\r' })[c] ?? c)
}

// Code mode runs JS like `tools.exec_command({cmd:"rg -n foo", workdir:"C:\\repo"})`.
function fromCode(code) {
  const out = []
  for (const m of code.matchAll(/(?<![\w$])["']?(?:cmd|command)["']?\s*:\s*("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|`(?:[^`\\]|\\.)*`)/g)) {
    out.push(unquote(m[1]))
  }
  return out
}

const looksLikeCode = text => /\btools\.\w+\s*\(/.test(text)

export function extractCommands(toolInput) {
  if (toolInput == null) return []
  if (typeof toolInput === 'string') return looksLikeCode(toolInput) ? fromCode(toolInput) : [toolInput]
  const command = toolInput.command ?? toolInput.cmd
  if (Array.isArray(command)) return [command.join(' ')]
  if (typeof command === 'string') return looksLikeCode(command) ? fromCode(command) : [command]
  const code = toolInput.input ?? toolInput.code ?? toolInput.script
  return typeof code === 'string' ? fromCode(code) : []
}

// Shell commands of a tool call. An apply_patch input is a patch, not a command.
export const toolCommands = (toolName, toolInput) => (/^(apply_patch|edit|write)$/i.test(toolName || '') ? [] : extractCommands(toolInput))

export function extractWorkdir(toolInput, fallback) {
  if (toolInput && typeof toolInput === 'object' && typeof toolInput.workdir === 'string') return toolInput.workdir
  const text = typeof toolInput === 'string' ? toolInput : String(toolInput?.input ?? toolInput?.code ?? '')
  const m = /(?<![\w$])["']?workdir["']?\s*:\s*("(?:[^"\\]|\\.)*")/.exec(text)
  return m ? unquote(m[1]) : fallback
}

export function tokenize(text) {
  return [...text.matchAll(/"([^"]*)"|'([^']*)'|(\S+)/g)].map(m => m[1] ?? m[2] ?? m[3])
}

// Prefixes that do not change what runs.
const PREFIX = /^(?:sudo|call|&|\.|time|nohup|exec|env)$/i
const WRAPPERS = /^(?:powershell|pwsh|bash|sh|zsh|cmd)$/i

export const verbOf = word => (word || '').replace(/^.*[\\/]/, '').replace(/\.(exe|cmd|bat|ps1)$/i, '').toLowerCase()

// Splits outside quotes on ; && || | newlines and PowerShell/bash blocks { }, so `rg "a|b"` stays one command
// and `if ($x) { Remove-Item … }` exposes the Remove-Item.
function splitTopLevel(command) {
  const parts = []
  let current = ''
  let quote = null
  for (let i = 0; i < command.length; i++) {
    const c = command[i]
    if (quote) {
      current += c
      if (c === quote && (quote === "'" || !/[\\`]/.test(command[i - 1] || ''))) quote = null
      continue
    }
    if (c === '"' || c === "'") {
      quote = c
      current += c
      continue
    }
    const two = command.slice(i, i + 2)
    if (two === '&&' || two === '||') {
      parts.push({ text: current, sep: two })
      current = ''
      i++
    } else if ('|;\n{}'.includes(c)) {
      parts.push({ text: current, sep: c })
      current = ''
    } else if (c !== '\r') {
      current += c
    }
  }
  parts.push({ text: current, sep: null })
  return parts
}

// `piped`: its output feeds the next command. `fed`: it reads the previous command's output
// (Get-ChildItem *.tmp | Remove-Item), and `source` is that previous command.
export function segments(command) {
  const out = []
  let previousSep = null
  for (const { text: raw, sep } of splitTopLevel(String(command))) {
    const fed = previousSep === '|'
    previousSep = sep
    const text = raw.trim()
    if (!text) continue
    let argv = tokenize(text)
    while (argv.length > 1 && PREFIX.test(argv[0])) argv = argv.slice(1)
    const verb = verbOf(argv[0])
    // powershell -Command "…", bash -c '…', cmd /c …: look inside.
    if (WRAPPERS.test(verb)) {
      const flag = argv.findIndex(a => /^(-c|-command|\/c|\/k)$/i.test(a))
      if (flag !== -1 && argv[flag + 1]) {
        out.push(...segments(argv.slice(flag + 1).join(' ')))
        continue
      }
    }
    out.push({ text: argv.join(' '), argv, verb, piped: sep === '|', fed, source: fed ? out[out.length - 1] ?? null : null })
  }
  return out
}

// PowerShell parameters whose value is never a path.
const VALUE_FLAGS = /^-(ErrorAction|ea|WarningAction|wa|InformationAction|Encoding|Delimiter|ReadCount|Depth|Value)$/i

// Arguments that are not flags (nor values of flags like -ErrorAction), without stray punctuation.
export function pathArgs(argv) {
  const out = []
  for (let i = 1; i < argv.length; i++) {
    const a = argv[i].replace(/[;)}]+$/, '')
    if (VALUE_FLAGS.test(a)) {
      i++
      continue
    }
    if (!a || /^-/.test(a) || /^\/[a-z]$/i.test(a) || /^\d+$/.test(a) || /^[{}()[\],;|&]+$/.test(a)) continue
    out.push(a)
  }
  return out
}

// Files named by an apply_patch envelope, raw or inside a code-mode string literal.
export function patchFiles(value) {
  const strings = []
  const collect = v => {
    if (typeof v === 'string') strings.push(v)
    else if (v && typeof v === 'object') for (const x of Object.values(v)) collect(x)
  }
  collect(value)
  const files = []
  for (const s of strings) {
    if (!s.includes('*** ')) continue
    const escaped = !s.includes('\n')
    const lines = escaped ? s.split(/(?<!\\)\\n/) : s.split(/\r?\n/)
    for (const line of lines) {
      const m = /^\s*\*\*\* (Add|Update|Delete) File: (.+?)\s*$|^\s*\*\*\* Move to: (.+?)\s*$/.exec(line)
      if (!m) continue
      // Inside a JS string literal a Windows backslash is written twice.
      const path = escaped ? (m[2] || m[3]).replace(/\\\\/g, '\\') : m[2] || m[3]
      files.push({ op: m[1] ? m[1].toLowerCase() : 'add', path })
    }
  }
  return files
}

// Files a shell command writes: Set-Content/Out-File/Add-Content, > and >> redirects, sed -i, tee.
export function shellWrites(command) {
  const targets = []
  const add = p => p && !/^(\$null|nul|\/dev\/null|&\d)$/i.test(p) && targets.push(p)
  for (const m of command.matchAll(/\b(?:Set-Content|Add-Content|Out-File|New-Item)\b(?:\s+-(?:Path|LiteralPath|FilePath))?\s+["']?([^\s"'|;,]+)/gi)) add(m[1])
  for (const m of command.matchAll(/(?:^|[^<>&\d-])>{1,2}\s*["']?([^\s"'|;&<>]+)/g)) add(m[1])
  for (const m of command.matchAll(/\bsed\s+-i(?:\.\w+)?\s+(?:'[^']*'|"[^"]*"|\S+)\s+["']?([^\s"'|;]+)/g)) add(m[1])
  for (const m of command.matchAll(/\btee\s+(?:-a\s+)?["']?([^\s"'|;]+)/g)) add(m[1])
  return targets
}
