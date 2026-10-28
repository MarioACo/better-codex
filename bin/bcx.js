#!/usr/bin/env node
import { readFileSync } from 'node:fs'
import module from 'node:module'
import { join, resolve } from 'node:path'

// Hooks start a fresh Node on every prompt and tool call: reuse compiled modules across runs (Node 22.1+).
module.enableCompileCache?.()

const [command = 'help', ...args] = process.argv.slice(2)

// Hooks first, with the fewest imports: they run on every prompt and tool call.
if (command === 'hook') {
  let input = {}
  try {
    input = JSON.parse(readFileSync(0, 'utf8') || '{}')
  } catch {}
  const event = args[0] || input.hook_event_name
  try {
    const [{ handle }, { stateFile }, { withLock }, { markSeen }] = await Promise.all([
      import('../src/hooks.js'),
      import('../src/state.js'),
      import('../src/util.js'),
      import('../src/seen.js')
    ])
    // One hook at a time per session: parallel tool calls would otherwise overwrite each other's state.
    const out = withLock(stateFile(input.session_id), () => handle(event, input))
    markSeen(event, input.tool_name)
    // Exit only once stdout is flushed: pipes can be asynchronous (macOS).
    if (out) await new Promise(done => process.stdout.write(JSON.stringify(out), done))
  } catch (error) {
    try {
      const { record } = await import('../src/metrics.js')
      record('error', { event, message: String(error?.stack || error).slice(0, 500) })
    } catch {}
  }
  process.exit(0)
}

const { loadConfig, saveConfig, resetConfig, parseValue, DEFAULTS, configPath } = await import('../src/config.js')
const { humanNumber, pick, resolveLang, whenLabel, windowLabel } = await import('../src/i18n.js')
const { ROOT } = await import('../src/paths.js')

const cfg = loadConfig()
const lang = resolveLang(cfg.lang)
const L = (es, en) => pick(lang, es, en)
const color = process.stdout.isTTY && !process.env.NO_COLOR
const paint = code => text => (color ? `\x1b[${code}m${text}\x1b[0m` : String(text))
const [bold, dim, green, yellow, red, cyan] = [paint(1), paint(2), paint(32), paint(33), paint(31), paint(36)]
const flag = name => args.includes(`--${name}`)
const option = (name, fallback) => {
  const i = args.indexOf(`--${name}`)
  return i !== -1 && args[i + 1] ? args[i + 1] : fallback
}
const positional = () => args.filter((a, i) => !a.startsWith('--') && !(i > 0 && /^--(days|cwd)$/.test(args[i - 1])))
const mark = status => (status === 'ok' ? green('✓') : status === 'warn' ? yellow('!') : red('✗'))
const bar = (pct, width = 20) => {
  const filled = Math.round((Math.min(100, Math.max(0, pct)) / 100) * width)
  const paintBar = pct >= cfg.rateCritical ? red : pct >= cfg.rateWarn ? yellow : green
  return paintBar('█'.repeat(filled)) + dim('░'.repeat(width - filled))
}
const version = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')).version

const commands = {
  async install() {
    const { appDir, findCodex, install, tuiCommand } = await import('../src/install.js')
    const dryRun = flag('dry-run')
    const steps = install({ dryRun, hooks: !flag('no-hooks'), agents: !flag('no-agents'), plugins: !flag('no-plugins') })
    const label = { app: 'app', hooks: 'hooks.json', agents: 'AGENTS.md', plugins: 'plugins' }
    console.log(bold(`better-codex ${version} · ${dryRun ? L('simulación, no se escribe nada', 'dry run, nothing is written') : L('instalación', 'install')}`))
    for (const step of steps) {
      const state = step.failed ? red(L('falló', 'failed')) : step.changed ? green(dryRun ? L('se actualizaría', 'would update') : L('actualizado', 'updated')) : dim(L('sin cambios', 'unchanged'))
      console.log(`  ${mark(step.failed ? 'fail' : 'ok')} ${label[step.id].padEnd(11)} ${state}${step.file ? dim(`  ${step.file}`) : ''}`)
      if (step.backup) console.log(dim(`      ${L('respaldo', 'backup')}: ${step.backup}`))
      if (step.note) console.log(yellow(`      ${step.note}`))
    }
    const hooksStep = steps.find(s => s.id === 'hooks')
    if (!dryRun && hooksStep?.trusted) {
      console.log(`\n${green('✓')} ${L('Ya aprobaste estos hooks en Codex: no tienes que hacer nada más.', 'You already trusted these hooks in Codex: nothing else to do.')}`)
    } else if (!dryRun && hooksStep) {
      const open = tuiCommand(findCodex())
      console.log(`\n${bold(L('Falta un paso tuyo', 'One step left, yours'))}`)
      if (hooksStep.retrust) console.log(yellow(L('  Los hooks cambiaron desde que los aprobaste, así que Codex te los vuelve a pedir.', 'The hooks changed since you trusted them, so Codex asks again.')))
      console.log(L(
        `  1. Abre Codex en una terminal:  ${open}\n  2. Escribe /hooks y confía en los 5 de better-codex.\n  Codex no ejecuta hooks que no hayas aprobado (ni avisa en la app ni en \`codex exec\`); si cambian, te los vuelve a pedir.`,
        `  1. Open Codex in a terminal:  ${open}\n  2. Type /hooks and trust the 5 from better-codex.\n  Codex never runs hooks you have not approved (and says nothing in the app or in \`codex exec\`); it asks again if they change.`
      ))
      const cli = `node "${join(appDir(), 'bin', 'bcx.js')}"`
      console.log(dim(L(`  Luego: ${cli} doctor   (o \`npm link\` en el repo para tener \`bcx\`)`, `  Then: ${cli} doctor   (or \`npm link\` in the repo to get \`bcx\`)`)))
    }
  },

  async log() {
    const { readEvents } = await import('../src/metrics.js')
    const { RULES } = await import('../src/guard.js')
    const n = Number(option('n', 20))
    const shown = readEvents().filter(e => e.kind !== 'meter' && e.kind !== 'brief').slice(-n)
    if (!shown.length) return console.log(dim(L('Nada todavía: better-codex no ha intervenido.', 'Nothing yet: better-codex has not stepped in.')))
    const time = t => new Date(t).toLocaleString(lang === 'es' ? 'es-MX' : 'en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
    for (const e of shown) {
      const what = {
        'guard-blocked': () => `${red('⛔')} ${RULES[e.rule]?.title[lang] ?? e.rule}  ${dim(e.command || '')}`,
        'guard-approved': () => `${green('✓')} ${L('aprobado por ti', 'approved by you')}  ${dim(e.command || '')}`,
        'guard-allowed': () =>
          `${green('▶')} ${e.via === 'question' ? L('permitido: dijiste «sí» a la pregunta de Codex', 'allowed: you said yes to Codex’s question') : L('permitido con tu aprobación', 'allowed with your approval')}  ${dim(e.command || '')}`,
        diet: () => `${cyan('✂')} ${L('lectura evitada', 'read skipped')} (${e.rule})  ${dim(e.path || '')}${e.savedTokens ? dim(`  ≈${humanNumber(e.savedTokens)} tokens`) : ''}`,
        'verify-gate': () => `${yellow('↻')} ${L('le pedí verificar antes de terminar', 'asked to verify before finishing')}`,
        'big-output': () => `${yellow('!')} ${L('salida enorme', 'huge output')} ≈${humanNumber(e.tokens)} tokens`,
        boost: () => `${dim('+')} ${[e.mode && `${L('modo', 'mode')} ${e.mode}`, e.task, e.hints && `${e.hints} ${L('archivos', 'files')}`].filter(Boolean).join(' · ')}`,
        error: () => `${red('✗')} ${L('error interno', 'internal error')} ${e.event || ''}  ${dim(String(e.message).split('\n')[0].slice(0, 120))}`
      }[e.kind]
      if (what) console.log(`${dim(time(e.t).padEnd(16))} ${what()}`)
    }
  },

  async uninstall() {
    const { uninstall } = await import('../src/install.js')
    const dryRun = flag('dry-run')
    for (const step of uninstall({ dryRun })) {
      console.log(`  ${mark('ok')} ${step.id.padEnd(8)} ${step.changed ? (dryRun ? L('se quitaría', 'would remove') : L('quitado', 'removed')) : dim(L('nada que quitar', 'nothing to remove'))}`)
    }
    console.log(dim(L(`  Tus ajustes y métricas siguen en ${configPath().replace(/config\.json$/, '')}`, `  Your settings and metrics stay in ${configPath().replace(/config\.json$/, '')}`)))
  },

  async doctor() {
    const { doctor } = await import('../src/doctor.js')
    const { checks, smoke, live } = doctor({ offline: flag('offline') })
    console.log(bold(`better-codex ${version} · doctor`))
    for (const c of checks) console.log(`  ${mark(c.status)} ${c.label.padEnd(15)} ${dim(c.detail)}`)
    console.log(bold(`\n${L('Hooks ejecutados como lo hará Codex', 'Hooks run the way Codex will')}`))
    for (const r of smoke) console.log(`  ${mark(r.ok ? 'ok' : 'fail')} ${r.shell.padEnd(11)} ${r.event.padEnd(17)} ${dim(`${r.ms} ms`)}${r.error ? red(`  ${r.error}`) : ''}`)
    console.log(bold(`\n${L('Lo que Codex ha enviado de verdad', 'What Codex has actually sent')}`))
    const ago = ms => (ms < 60000 ? L('hace instantes', 'just now') : ms < 3600000 ? L(`hace ${Math.round(ms / 60000)} min`, `${Math.round(ms / 60000)} min ago`) : ms < 86400000 ? L(`hace ${Math.round(ms / 3600000)} h`, `${Math.round(ms / 3600000)} h ago`) : L(`hace ${Math.round(ms / 86400000)} d`, `${Math.round(ms / 86400000)} d ago`))
    if (live.every(l => !l.count)) {
      console.log(yellow(L('  Nada todavía. Abre Codex, aprueba los hooks en /hooks y escribe un prompt.', '  Nothing yet. Open Codex, trust the hooks in /hooks and send a prompt.')))
    } else {
      for (const l of live) {
        const tools = l.tools?.length ? dim(`  ${l.tools.slice(0, 4).map(([name, n]) => `${name}×${n}`).join(' ')}`) : ''
        console.log(`  ${mark(l.count ? 'ok' : 'warn')} ${l.event.padEnd(17)} ${l.count ? `${l.count}× · ${ago(l.ago)}` : dim(L('nunca', 'never'))}${tools}`)
      }
    }
    const failed = checks.some(c => c.status === 'fail') || smoke.some(r => !r.ok)
    const warned = checks.some(c => c.status === 'warn')
    const neverRan = live.every(l => !l.count)
    if (failed) console.log(red(`\n${L('Hay problemas: revisa las ✗', 'There are problems: see the ✗')}`))
    else if (warned) console.log(yellow(`\n${L('Los hooks funcionan. Pendiente: lo marcado con !', 'The hooks work. To do: the items marked !')}`))
    else if (neverRan) console.log(yellow(`\n${L(
      'Los hooks funcionan, pero Codex aún no los ejecuta: abre Codex, apruébalos en /hooks y escribe un prompt.',
      'The hooks work, but Codex has not run them yet: open Codex, trust them in /hooks and send a prompt.')}`))
    else console.log(green(`\n${L('Todo listo: Codex está ejecutando better-codex.', 'All good: Codex is running better-codex.')}`))
    process.exitCode = failed ? 1 : 0
  },

  async stats() {
    const { collectSessions, summarize, tips } = await import('../src/stats.js')
    const { readEvents } = await import('../src/metrics.js')
    const days = Number(option('days', 30))
    const sessions = collectSessions(days)
    const summary = summarize(sessions)
    const events = readEvents(Date.now() - days * 86400000)
    if (flag('json')) return console.log(JSON.stringify({ days, summary, sessions, events: countEvents(events) }, null, 2))

    console.log(bold(L(`Codex · últimos ${days} días`, `Codex · last ${days} days`)))
    if (!sessions.length) return console.log(dim(L('  Sin sesiones en ese periodo.', '  No sessions in that period.')))
    const cacheShare = summary.input ? Math.round((summary.cached / summary.input) * 100) : 0
    console.log(`  ${L('sesiones', 'sessions')} ${bold(summary.sessions)} · ${L('turnos', 'turns')} ${bold(summary.turns)} · ${L('herramientas', 'tool calls')} ${bold(summary.tools)} · ${L('compactaciones', 'compactions')} ${bold(summary.compactions)}`)
    console.log(`  ${L('entrada', 'input')} ${bold(humanNumber(summary.input))} (${cacheShare}% ${L('de caché', 'cached')}) · ${L('salida', 'output')} ${bold(humanNumber(summary.output))} · ${L('razonamiento', 'reasoning')} ${humanNumber(summary.reasoning)}`)
    console.log(`  ${L('por turno', 'per turn')}: ${bold(humanNumber(summary.inputPerTurn))} ${L('de entrada', 'input')}, ${summary.toolsPerTurn.toFixed(1)} ${L('herramientas', 'tool calls')} · ${L('contexto medio por petición', 'average context per request')} ${bold(humanNumber(summary.avgContext))} · ${L('pico medio', 'average peak')} ${Math.round(summary.avgPeakPct)}%`)

    if (cfg.installedAt) {
      const at = Date.parse(cfg.installedAt)
      const before = summarize(sessions.filter(s => Date.parse(s.start) < at))
      const after = summarize(sessions.filter(s => Date.parse(s.start) >= at))
      if (before.sessions && after.sessions) {
        const delta = (a, b) => {
          if (!a) return ''
          const pct = Math.round(((b - a) / a) * 100)
          return (pct <= 0 ? green : red)(` ${pct > 0 ? '+' : ''}${pct}%`)
        }
        console.log(bold(`\n${L('Antes y después de better-codex', 'Before and after better-codex')}`) + dim(` (${cfg.installedAt.slice(0, 10)})`))
        console.log(`  ${L('entrada por turno', 'input per turn')}     ${humanNumber(before.inputPerTurn).padStart(6)} → ${humanNumber(after.inputPerTurn).padStart(6)}${delta(before.inputPerTurn, after.inputPerTurn)}`)
        console.log(`  ${L('herramientas por turno', 'tool calls per turn')}  ${before.toolsPerTurn.toFixed(1).padStart(6)} → ${after.toolsPerTurn.toFixed(1).padStart(6)}${delta(before.toolsPerTurn, after.toolsPerTurn)}`)
        console.log(`  ${L('contexto medio', 'average context')}        ${humanNumber(before.avgContext).padStart(6)} → ${humanNumber(after.avgContext).padStart(6)}${delta(before.avgContext, after.avgContext)}`)
        console.log(dim(`  ${before.sessions} ${L('sesiones antes', 'sessions before')}, ${after.sessions} ${L('después', 'after')}`))
      }
    }

    console.log(bold(`\n${L('Sesiones más pesadas', 'Heaviest sessions')}`))
    console.log(dim(`  ${L('fecha', 'date').padEnd(11)}${L('carpeta', 'folder').padEnd(20)}${L('turnos', 'turns').padStart(7)}${L('entrada', 'input').padStart(9)}${L('pico', 'peak').padStart(7)}  ${L('modelo', 'model')}`))
    for (const s of [...sessions].sort((a, b) => (b.total?.input_tokens || 0) - (a.total?.input_tokens || 0)).slice(0, 5)) {
      const folder = (s.cwd || '').replace(/^.*[\\/]/, '').slice(0, 18)
      const peak = `${s.peakPct}%`
      const paintPeak = s.peakPct >= cfg.ctxCritical ? red : s.peakPct >= cfg.ctxWarn ? yellow : String
      console.log(`  ${(s.start || '').slice(0, 10).padEnd(11)}${folder.padEnd(20)}${String(s.turns).padStart(7)}${humanNumber(s.total?.input_tokens).padStart(9)}${paintPeak(peak.padStart(7))}  ${dim(`${s.model || '?'} ${s.effort || ''}`)}`)
    }

    const counts = countEvents(events)
    if (Object.keys(counts).length) {
      console.log(bold(`\n${L('Lo que hizo better-codex', 'What better-codex did')}`))
      const line = (key, es, en) => counts[key] && console.log(`  ${String(counts[key]).padStart(5)}  ${L(es, en)}`)
      line('brief', 'resúmenes del repo al iniciar sesión', 'repo briefs at session start')
      line('boost', 'prompts con modo, guía o archivos sugeridos', 'prompts given a mode, playbook or file hints')
      line('diet', 'lecturas inútiles evitadas', 'wasteful reads skipped')
      line('big-output', 'avisos de salida enorme', 'huge-output warnings')
      line('guard-blocked', 'acciones riesgosas detenidas para preguntarte', 'risky actions stopped to ask you')
      line('guard-approved', 'aprobadas por ti', 'approved by you')
      line('verify-gate', 'veces que se pidió verificar antes de terminar', 'times verification was requested before finishing')
      if (counts.savedTokens) console.log(`  ${humanNumber(counts.savedTokens).padStart(5)}  ${L('tokens ahorrados por la dieta (estimado)', 'tokens saved by the diet (estimate)')}`)
      if (counts.error) console.log(yellow(`  ${String(counts.error).padStart(5)}  ${L('errores internos (no afectan a Codex)', 'internal errors (Codex unaffected)')}`))
    }

    const advice = tips(summary, lang, sessions)
    if (advice.length) {
      console.log(bold(`\n${L('Consejos', 'Tips')}`))
      for (const tip of advice) console.log(`  • ${tip}`)
    }
  },

  async usage() {
    const { latestUsage } = await import('../src/stats.js')
    const usage = latestUsage()
    if (!usage) return console.log(dim(L('Sin datos de límites todavía: usa Codex un turno y vuelve a intentar.', 'No rate-limit data yet: use Codex for one turn and try again.')))
    console.log(bold(`Codex · ${L('uso del plan', 'plan usage')}${usage.plan ? ` (${usage.plan})` : ''}`))
    for (const key of ['primary', 'secondary']) {
      const limit = usage[key]
      if (!limit) continue
      const expired = limit.resetsAt && limit.resetsAt < Date.now()
      const pct = expired ? 0 : limit.pct
      const reset = expired ? L('ya se reinició', 'already reset') : limit.resetsAt ? `${L('se reinicia', 'resets')} ${whenLabel(limit.resetsAt, lang)}` : ''
      console.log(`  ${windowLabel(limit.windowMinutes, lang).padEnd(7)} ${bar(pct)} ${String(pct).padStart(3)}%  ${dim(reset)}`)
    }
    if (usage.context) console.log(dim(`  ${L('última sesión', 'last session')}: ${L('contexto', 'context')} ${usage.context.pct}% (${humanNumber(usage.context.used)} / ${humanNumber(usage.context.window)})`))
  },

  async audit() {
    const { audit } = await import('../src/audit.js')
    const { RULES } = await import('../src/guard.js')
    const days = Number(option('days', 30))
    console.log(dim(L('Repasando tus sesiones (no se ejecuta nada)…', 'Replaying your sessions (nothing is executed)…')))
    const report = audit(days)
    console.log(bold(L(`Auditoría · ${report.calls} llamadas en ${report.sessions} sesiones (${days} días)`, `Audit · ${report.calls} calls in ${report.sessions} sessions (${days} days)`)))
    const guardTotal = Object.values(report.guard).reduce((n, e) => n + e.count, 0)
    console.log(`\n${bold(L('El guard te habría preguntado', 'The guard would have asked you'))} ${guardTotal}× ${dim(`(${report.calls ? ((guardTotal / report.calls) * 100).toFixed(1) : 0}%)`)}`)
    for (const [rule, entry] of Object.entries(report.guard).sort((a, b) => b[1].count - a[1].count)) {
      console.log(`  ${String(entry.count).padStart(4)}  ${RULES[rule].title[lang]}`)
      for (const example of entry.examples) console.log(dim(`        ${example}`))
    }
    const dietTotal = Object.values(report.diet).reduce((n, e) => n + e.count, 0)
    console.log(`\n${bold(L('La dieta habría evitado', 'The diet would have skipped'))} ${dietTotal} ${L('lecturas', 'reads')}${report.savedTokens ? dim(` (≈ ${humanNumber(report.savedTokens)} tokens)`) : ''}`)
    for (const [rule, entry] of Object.entries(report.diet).sort((a, b) => b[1].count - a[1].count)) {
      console.log(`  ${String(entry.count).padStart(4)}  ${rule}${dim(`  ${entry.examples.join(', ')}`)}`)
    }
    console.log(dim(L('\n  Las reglas de git miran el estado actual de cada repo, no el de aquel momento.', "\n  Git rules look at each repo's current state, not the state back then.")))
  },

  async brief() {
    const { repoBrief } = await import('../src/brief.js')
    const { estimateTokens } = await import('../src/util.js')
    const text = repoBrief(resolve(positional()[0] || '.'))
    console.log(text || dim(L('(nada que resumir aquí: ni repo git ni proyecto reconocido)', '(nothing to brief here: neither a git repo nor a known project)')))
    if (text) console.log(dim(`\n≈ ${estimateTokens(text)} tokens`))
  },

  async try() {
    const { boostPrompt } = await import('../src/prompt.js')
    const { gitFiles, gitRoot } = await import('../src/git.js')
    const { estimateTokens } = await import('../src/util.js')
    const prompt = positional().join(' ')
    if (!prompt) return console.log(L('Uso: bcx try "+arregla el login que truena"', 'Usage: bcx try "+fix the crashing login"'))
    const root = gitRoot(resolve(option('cwd', '.')))
    const result = boostPrompt(prompt, { files: root ? gitFiles(root) : [], hints: cfg.hints })
    console.log(`${dim(L('modo', 'mode'))}  ${result.mode || '—'}   ${dim(L('tarea', 'task'))}  ${result.task || '—'}   ${dim(L('archivos', 'files'))}  ${result.hints.join(', ') || '—'}`)
    console.log(result.text ? `\n${cyan(result.text)}\n${dim(`≈ ${estimateTokens(result.text)} tokens`)}` : dim(L('\n(nada que agregar: el prompt ya es claro o es un seguimiento)', '\n(nothing to add: the prompt is clear or a follow-up)')))
  },

  async guard() {
    const { inspect, RULES, denyReason } = await import('../src/guard.js')
    const cmd = positional().join(' ')
    if (!cmd) return console.log(L('Uso: bcx guard "git push --force origin main"', 'Usage: bcx guard "git push --force origin main"'))
    const found = inspect({ toolName: 'Bash', toolInput: { command: cmd }, cwd: resolve(option('cwd', '.')) })
    if (!found) return console.log(green(L('✓ permitido: no es destructivo aquí', '✓ allowed: not destructive here')))
    const rule = RULES[found.rule]
    console.log(red(`⛔ ${L('se detiene para preguntarte', 'stops to ask you')} (${found.severity}): ${rule.title[lang]}`))
    console.log(`  ${L('qué hace', 'what it does')}: ${found.detail}`)
    console.log(`  ${L('riesgo', 'risk')}: ${rule.risk[lang]}`)
    console.log(dim(`\n${L('Lo que recibe Codex', 'What Codex receives')}:\n${denyReason(found)}`))
  },

  async config() {
    const [sub, key, value] = positional()
    if (sub === 'set') {
      try {
        saveConfig({ [key]: parseValue(key, value) })
        console.log(green(`✓ ${key} = ${JSON.stringify(parseValue(key, value))}`))
      } catch (error) {
        console.error(red(`✗ ${error.message}`))
        process.exitCode = 1
      }
      return
    }
    if (sub === 'reset') {
      resetConfig()
      return console.log(green(L('✓ valores por defecto', '✓ defaults restored')))
    }
    console.log(bold('better-codex · config') + dim(`  ${configPath()}`))
    for (const k of Object.keys(DEFAULTS)) {
      const changed = cfg[k] !== DEFAULTS[k]
      console.log(`  ${k.padEnd(13)} ${changed ? cyan(JSON.stringify(cfg[k])) : JSON.stringify(cfg[k])}${changed ? dim(`  (${L('por defecto', 'default')} ${JSON.stringify(DEFAULTS[k])})`) : ''}`)
    }
    console.log(dim(L('\n  Cambiar: bcx config set verifyGate off', '\n  Change: bcx config set verifyGate off')))
  },

  help() {
    console.log(`${bold(`better-codex ${version}`)} — ${L('Codex más eficiente, más seguro y medible', 'Codex, more efficient, safer and measurable')}

  bcx install [--dry-run]      ${L('hooks + AGENTS.md + plugins (con respaldo)', 'hooks + AGENTS.md + plugins (with backups)')}
  bcx doctor                   ${L('revisa todo y ejecuta los hooks de prueba', 'checks everything and test-runs the hooks')}
  bcx stats [--days 30]        ${L('tokens, contexto y herramientas por sesión; antes/después', 'tokens, context and tool calls per session; before/after')}
  bcx usage                    ${L('límites de 5 h y semanal', '5-hour and weekly limits')}
  bcx audit [--days 30]        ${L('qué habrían detenido guard y dieta en tus sesiones', 'what guard and diet would have stopped in your sessions')}
  bcx log [--n 20]             ${L('lo último que hizo better-codex (bloqueos, aprobaciones, ahorros)', 'what better-codex did lately (blocks, approvals, savings)')}
  bcx brief [carpeta]          ${L('el resumen del repo que recibe Codex', 'the repo brief Codex receives')}
  bcx try "<prompt>"           ${L('lo que se agregaría a ese prompt', 'what would be added to that prompt')}
  bcx guard "<comando>"        ${L('si el guard lo detendría y por qué', 'whether the guard would stop it, and why')}
  bcx config [set k v|reset]   ${L('ajustes', 'settings')}
  bcx uninstall                ${L('quita todo lo instalado', 'removes everything installed')}

${dim(L('En Codex: +prompt (a fondo) · quick: · ask: · plan: · $bcx:commit · $bcx:refine · $bcx:handoff · $bcx:debug', 'In Codex: +prompt (deep) · quick: · ask: · plan: · $bcx:commit · $bcx:refine · $bcx:handoff · $bcx:debug'))}`)
  }
}

function countEvents(events) {
  const counts = {}
  for (const e of events) {
    counts[e.kind] = (counts[e.kind] || 0) + 1
    if (e.kind === 'diet') counts.savedTokens = (counts.savedTokens || 0) + (e.savedTokens || 0)
  }
  return counts
}

if (command === '--version' || command === '-v') console.log(version)
else if (commands[command]) await commands[command]()
else {
  commands.help()
  if (!['help', '--help', '-h'].includes(command)) process.exitCode = 1
}
