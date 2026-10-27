import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { codexHome } from './paths.js'
import { readUsage } from './transcript.js'

// Cheap header match: most lines are tool output and never need JSON.parse.
// Newer Codex versions add scalar fields such as "ordinal":12 before "type".
const HEAD = /^\{"timestamp":"([^"]+)",(?:"\w+":(?:-?\d+|"[^"]*"|true|false|null),)*"type":"([a-z_]+)"(?:,"payload":\{"type":"([a-z_]+)")?/
const POLLING = /"name":"(wait|write_stdin)"/

const parse = line => {
  try {
    return JSON.parse(line)
  } catch {
    return null
  }
}

// One rollout file → what the session cost and how it behaved.
export function parseSession(text) {
  const s = {
    start: null,
    end: null,
    cwd: null,
    source: null,
    model: null,
    effort: null,
    turns: 0,
    aborted: 0,
    tools: 0,
    compactions: 0,
    requests: 0,
    sumContext: 0,
    peakContext: 0,
    peakPct: 0,
    window: null,
    total: null
  }
  let lastTotal = null
  for (const line of text.split('\n')) {
    const m = HEAD.exec(line)
    if (!m) continue
    const [, ts, type, sub] = m
    s.start ??= ts
    s.end = ts
    if (type === 'event_msg') {
      if (sub === 'task_started') s.turns++
      else if (sub === 'turn_aborted') s.aborted++
      else if (sub === 'token_count') {
        const info = parse(line)?.payload?.info
        const last = info?.last_token_usage
        if (!last || info.total_token_usage?.total_tokens === lastTotal) continue
        lastTotal = info.total_token_usage?.total_tokens
        s.total = info.total_token_usage
        s.window = info.model_context_window || s.window
        const context = (last.input_tokens || 0) + (last.output_tokens || 0)
        s.requests++
        s.sumContext += context
        s.peakContext = Math.max(s.peakContext, context)
        if (s.window) s.peakPct = Math.max(s.peakPct, Math.round((context / s.window) * 100))
      }
    } else if (type === 'response_item') {
      if ((sub === 'function_call' || sub === 'custom_tool_call') && !POLLING.test(line.slice(0, 400))) s.tools++
    } else if (type === 'compacted') {
      s.compactions++
    } else if (type === 'session_meta') {
      const p = parse(line)?.payload
      s.cwd = p?.cwd ?? null
      s.source = p?.source || p?.originator || null
    } else if (type === 'turn_context') {
      const p = parse(line)?.payload
      s.model = p?.model ?? s.model
      s.effort = p?.effort ?? s.effort
    }
  }
  return s
}

function walk(dir) {
  let entries = []
  try {
    entries = readdirSync(dir, { withFileTypes: true })
  } catch {
    return []
  }
  return entries.flatMap(e => (e.isDirectory() ? walk(join(dir, e.name)) : e.name.endsWith('.jsonl') ? [join(dir, e.name)] : []))
}

export function sessionFiles(days) {
  const since = Date.now() - days * 24 * 60 * 60 * 1000
  return walk(join(codexHome(), 'sessions'))
    .map(file => ({ file, mtime: statSync(file).mtimeMs }))
    .filter(f => f.mtime >= since)
    .sort((a, b) => b.mtime - a.mtime)
}

export function collectSessions(days = 30) {
  return sessionFiles(days)
    .map(({ file }) => ({ file, ...parseSession(readFileSync(file, 'utf8')) }))
    .filter(s => s.turns > 0 && s.total)
}

export function summarize(sessions) {
  const sum = key => sessions.reduce((n, s) => n + (s[key] || 0), 0)
  const total = key => sessions.reduce((n, s) => n + (s.total?.[key] || 0), 0)
  const turns = sum('turns')
  const requests = sum('requests')
  const input = total('input_tokens')
  return {
    sessions: sessions.length,
    turns,
    tools: sum('tools'),
    requests,
    compactions: sum('compactions'),
    input,
    cached: total('cached_input_tokens'),
    output: total('output_tokens'),
    reasoning: total('reasoning_output_tokens'),
    inputPerTurn: turns ? input / turns : 0,
    toolsPerTurn: turns ? sum('tools') / turns : 0,
    avgContext: requests ? sum('sumContext') / requests : 0,
    avgPeakPct: sessions.length ? sessions.reduce((n, s) => n + s.peakPct, 0) / sessions.length : 0,
    over70: sessions.filter(s => s.peakPct >= 70).length
  }
}

// Data-backed advice, at most three lines. `sessions` lets it say how much the long ones cost.
export function tips(summary, lang, sessions = []) {
  const es = lang === 'es'
  const out = []
  const long = sessions.filter(s => s.peakPct >= 70)
  const longShare = summary.input ? long.reduce((n, s) => n + (s.total?.input_tokens || 0), 0) / summary.input : 0
  if (long.length && longShare >= 0.3) {
    const pct = Math.round(longShare * 100)
    out.push(
      es
        ? `${long.length} de ${summary.sessions} sesiones pasaron del 70% de contexto y se llevaron el ${pct}% de toda la entrada: cada turno reenvía todo. Al ver el aviso amarillo, usa $bcx:handoff y abre una sesión nueva.`
        : `${long.length} of ${summary.sessions} sessions went past 70% context and took ${pct}% of all input: every turn resends all of it. At the yellow warning, use $bcx:handoff and start a fresh session.`
    )
  } else if (summary.sessions && (summary.over70 / summary.sessions >= 0.25 || summary.avgPeakPct >= 60)) {
    out.push(
      es
        ? `${summary.over70} de ${summary.sessions} sesiones pasaron del 70% de contexto: cada turno reenvía todo. Usa $bcx:handoff y una sesión nueva al ver el aviso amarillo.`
        : `${summary.over70} of ${summary.sessions} sessions went past 70% context: every turn resends all of it. Use $bcx:handoff and a fresh session at the yellow warning.`
    )
  }
  if (summary.toolsPerTurn >= 12) {
    out.push(
      es
        ? `${summary.toolsPerTurn.toFixed(1)} llamadas a herramientas por turno: Codex explora mucho. Nombra archivos o funciones en el prompt, o usa $bcx:refine para tareas grandes.`
        : `${summary.toolsPerTurn.toFixed(1)} tool calls per turn: Codex explores a lot. Name files or functions in the prompt, or use $bcx:refine for big tasks.`
    )
  }
  if (summary.input && summary.cached / summary.input < 0.8) {
    out.push(
      es
        ? `Solo ${Math.round((summary.cached / summary.input) * 100)}% de la entrada vino de caché: sesiones cortas y enfocadas la aprovechan mejor que cambiar de tema en la misma.`
        : `Only ${Math.round((summary.cached / summary.input) * 100)}% of input came from cache: short, focused sessions use it better than switching topics in one.`
    )
  }
  return out.slice(0, 3)
}

// Rate limits from the newest sessions: the same numbers Codex shows in /status.
export function latestUsage() {
  for (const { file } of sessionFiles(8).slice(0, 6)) {
    const usage = readUsage(file)
    if (usage?.primary || usage?.secondary) return { ...usage, file }
  }
  return null
}
