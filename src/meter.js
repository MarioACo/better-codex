import { humanNumber, pick, whenLabel, windowLabel } from './i18n.js'

const levelOf = (pct, warn, critical) => (pct >= critical ? 2 : pct >= warn ? 1 : 0)

// The line shown under Codex's answer. In 'warn' mode only when a metric climbs to a new level in this session.
// relayed: the relay for the next session is written (src/relay.js), so starting fresh loses nothing.
export function meterCheck(usage, cfg, previous = {}, lang = 'en', { relayed = false } = {}) {
  if (!usage || cfg.meter === 'off') return { message: null, levels: previous }
  const levels = {
    ctx: usage.context ? levelOf(usage.context.pct, cfg.ctxWarn, cfg.ctxCritical) : 0,
    primary: usage.primary ? levelOf(usage.primary.pct, cfg.rateWarn, cfg.rateCritical) : 0,
    secondary: usage.secondary ? levelOf(usage.secondary.pct, cfg.rateWarn, cfg.rateCritical) : 0
  }
  const rising = Object.keys(levels).some(key => levels[key] > (previous[key] || 0))
  if (cfg.meter === 'warn' && !rising) return { message: null, levels }

  const show = key => cfg.meter === 'always' || levels[key] > 0
  const parts = []
  if (usage.context && show('ctx')) {
    const { pct, used, window } = usage.context
    const base = pick(lang, `contexto ${pct}% (${humanNumber(used)} de ${humanNumber(window)})`, `context ${pct}% (${humanNumber(used)} of ${humanNumber(window)})`)
    const advice =
      levels.ctx === 2 && relayed
        ? pick(lang, 'cada turno reenvía todo eso: abre una sesión nueva en este repo, ya le dejé un relevo con lo que iba', 'every turn resends all of it: start a new session in this repo, a relay with where things stand is ready for it')
        : levels.ctx === 2
        ? pick(lang, 'cada turno reenvía todo eso y las respuestas empeoran: usa $bcx:handoff y abre una sesión nueva', 'every turn resends all of it and answers get worse: use $bcx:handoff and start a new session')
        : levels.ctx === 1
          ? pick(lang, 'buen momento para /compact', 'a good time to /compact')
          : ''
    parts.push(advice ? `${base}: ${advice}` : base)
  }
  for (const key of ['primary', 'secondary']) {
    const limit = usage[key]
    if (!limit || !show(key)) continue
    const reset = limit.resetsAt && limit.resetsAt > Date.now() ? pick(lang, ` (se reinicia ${whenLabel(limit.resetsAt, lang)})`, ` (resets ${whenLabel(limit.resetsAt, lang)})`) : ''
    parts.push(`${pick(lang, 'uso', 'usage')} ${windowLabel(limit.windowMinutes, lang)} ${limit.pct}%${reset}`)
  }
  return { message: parts.length ? `better-codex · ${parts.join(' · ')}` : null, levels }
}
