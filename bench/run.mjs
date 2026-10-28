#!/usr/bin/env node
// Runs the same tasks with plain Codex ("off") and with better-codex ("on"), on your machine and
// with your Codex login, and compares tokens, requests and whether each task was done right.
//
//   node bench/run.mjs                      # every task, 3 runs per mode
//   node bench/run.mjs --runs 1 --tasks bugfix
//   node bench/run.mjs --report bench/results/<file>.json [--lang es]
//
// "off" hides everything better-codex adds, only for that run: hooks (--disable hooks), the bcx
// skills (-c skills.config=…) and the AGENTS.md block (a temporary AGENTS.override.md without it,
// removed when the run ends: Codex reads AGENTS.md after the session starts and follows changes to
// it). Sessions that start elsewhere during an "off" run don't see the block either, so don't use
// Codex while the benchmark runs. Each run is checked afterwards: an "off" run that still saw
// better-codex, or an "on" run that didn't, is marked invalid and left out of the report.
import { spawn, spawnSync } from 'node:child_process'
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { parseArgs } from 'node:util'
import { agentsPath, blockOf, findCodex, hookTrust, withoutBlock } from '../src/install.js'
import { codexHome } from '../src/paths.js'
import { parseSession } from '../src/stats.js'
import { readText } from '../src/util.js'
import { bundle, FIXTURE_TESTS, lockfile, TASKS } from './tasks.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const FIXTURE = join(HERE, 'fixture')
const SCRATCH = join(tmpdir(), 'bcx-bench')
const MARK = '<!-- better-codex bench: temporary file, removed when the run ends -->'
const VERIFY = /node(\.exe)?["']?\s+--test|npm(\.cmd)?\s+(run\s+)?test/

const { values: opt, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    runs: { type: 'string', default: '3' },
    tasks: { type: 'string' },
    modes: { type: 'string', default: 'off,on' },
    model: { type: 'string' },
    effort: { type: 'string' },
    timeout: { type: 'string', default: '12' },
    out: { type: 'string' },
    resume: { type: 'boolean', default: false },
    report: { type: 'string' },
    lang: { type: 'string', default: 'en' },
    check: { type: 'string' },
    setup: { type: 'string' },
    help: { type: 'boolean', short: 'h' }
  }
})

const log = text => process.stderr.write(`${text}\n`)
const fail = text => {
  log(`bench: ${text}`)
  process.exit(1)
}

// --- the repo each run starts from --------------------------------------------------------------

export function prepare(task, dir) {
  rmSync(dir, { recursive: true, force: true })
  copyDir(FIXTURE, dir)
  for (const [file, text] of Object.entries(FIXTURE_TESTS)) {
    mkdirSync(dirname(join(dir, file)), { recursive: true })
    writeFileSync(join(dir, file), text)
  }
  writeFileSync(join(dir, 'package-lock.json'), lockfile())
  mkdirSync(join(dir, 'public', 'vendor'), { recursive: true })
  writeFileSync(join(dir, 'public', 'vendor', 'checkout-sdk.min.js'), bundle())
  writeFileSync(join(dir, '.gitignore'), 'node_modules/\n')
  const git = (...args) => {
    const r = spawnSync('git', args, { cwd: dir, encoding: 'utf8' })
    if (r.status !== 0) throw new Error(`git ${args.join(' ')}: ${r.stderr}`)
  }
  git('init', '-q')
  git('add', '-A')
  // The identity and settings are for this throwaway repo only.
  git('-c', 'user.name=bench', '-c', 'user.email=bench@example.invalid', '-c', 'commit.gpgsign=false', 'commit', '-qm', 'corner-shop 2.3.0')
  task.untracked?.(dir)
}

function copyDir(from, to) {
  mkdirSync(to, { recursive: true })
  for (const entry of readdirSync(from)) {
    const src = join(from, entry)
    if (statSync(src).isDirectory()) copyDir(src, join(to, entry))
    else copyFileSync(src, join(to, entry))
  }
}

// --- hiding better-codex for an "off" run -------------------------------------------------------

const overridePath = () => join(codexHome(), 'AGENTS.override.md')

function hideBlock() {
  const rest = withoutBlock(readText(agentsPath(), '')).trim()
  writeFileSync(overridePath(), `${rest ? `${rest}\n\n` : ''}${MARK}\n`)
}

function showBlock() {
  if (readText(overridePath(), '')?.includes(MARK)) rmSync(overridePath(), { force: true })
}

// Your [[skills.config]] entries plus ours turned off: -c replaces the whole list for that run.
function skillsWithoutOurs() {
  const toml = readText(join(codexHome(), 'config.toml'), '')
  const entries = [...toml.matchAll(/\[\[skills\.config\]\]\s*\n\s*name\s*=\s*"([^"]+)"\s*\n\s*enabled\s*=\s*(true|false)/g)]
    .map(m => ({ name: m[1], enabled: m[2] }))
    .filter(e => !e.name.startsWith('bcx:'))
  for (const skill of ['commit', 'refine', 'handoff', 'debug']) entries.push({ name: `bcx:${skill}`, enabled: 'false' })
  return `[${entries.map(e => `{name="${e.name}",enabled=${e.enabled}}`).join(',')}]`
}

// --- one run ------------------------------------------------------------------------------------

function findRollout(thread) {
  const walk = dir => {
    let entries = []
    try {
      entries = readdirSync(dir, { withFileTypes: true })
    } catch {
      return null
    }
    for (const e of entries.sort((a, b) => b.name.localeCompare(a.name))) {
      const path = join(dir, e.name)
      if (e.isDirectory()) {
        const found = walk(path)
        if (found) return found
      } else if (e.name.includes(thread) && e.name.endsWith('.jsonl')) return path
    }
    return null
  }
  return thread ? walk(join(codexHome(), 'sessions')) : null
}

// "on" saw all of better-codex (rules, skills, hooks); "off" saw none of it.
export function validFor(mode, rollout) {
  const rules = /## better-codex/.test(rollout)
  const skills = /bcx:commit/.test(rollout)
  const hooks = /\[better-codex/.test(rollout)
  return mode === 'on' ? rules && skills && hooks : !rules && !skills && !hooks
}

function kill(child) {
  if (process.platform === 'win32') spawnSync('taskkill', ['/pid', String(child.pid), '/T', '/F'])
  else child.kill('SIGTERM')
}

async function runOnce(codex, task, mode, rep) {
  const dir = join(SCRATCH, 'work', task.id)
  prepare(task, dir)
  const data = join(SCRATCH, 'data', `${task.id}-${mode}-${rep}`)
  rmSync(data, { recursive: true, force: true })
  mkdirSync(data, { recursive: true })

  const args = ['exec', '-C', dir, '--json', '-s', 'workspace-write']
  if (opt.model) args.push('-m', opt.model)
  if (opt.effort) args.push('-c', `model_reasoning_effort="${opt.effort}"`)
  if (mode === 'off') {
    args.push('--disable', 'hooks', '-c', `skills.config=${skillsWithoutOurs()}`)
    hideBlock()
  }
  args.push(task.prompt)

  const started = Date.now()
  const child = spawn(codex.bin, [...(codex.prefix || []), ...args], {
    env: { ...process.env, BCX_DATA_DIR: data },
    stdio: ['ignore', 'pipe', 'pipe']
  })
  const timer = setTimeout(() => kill(child), Number(opt.timeout) * 60 * 1000)
  let thread = null
  let usage = null
  let answer = ''
  const commands = []
  let buffer = ''
  let errors = ''
  child.stderr.on('data', chunk => (errors = (errors + chunk).slice(-2000)))
  child.stdout.on('data', chunk => {
    buffer += chunk
    let nl
    while ((nl = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, nl)
      buffer = buffer.slice(nl + 1)
      let e
      try {
        e = JSON.parse(line)
      } catch {
        continue
      }
      if (e.type === 'thread.started') thread = e.thread_id
      else if (e.type === 'turn.completed') usage = e.usage
      else if (e.type === 'item.completed' && e.item?.type === 'agent_message') answer = e.item.text || ''
      else if (e.type === 'item.completed' && e.item?.type === 'command_execution') commands.push(e.item.command || '')
    }
  })
  const code = await new Promise(resolve => {
    child.on('close', resolve)
    child.on('error', error => {
      errors += error.message
      resolve(-1)
    })
  })
  clearTimeout(timer)
  showBlock()
  const seconds = Math.round((Date.now() - started) / 1000)

  const rollout = findRollout(thread)
  const text = rollout ? readFileSync(rollout, 'utf8') : ''
  const session = text ? parseSession(text) : null
  const valid = !!session && validFor(mode, text)

  writeFileSync(join(data, 'answer.txt'), answer)
  const graded = spawnSync(process.execPath, [fileURLToPath(import.meta.url), '--check', task.id, dir, join(data, 'answer.txt')], { encoding: 'utf8', timeout: 120000 })
  let check = { ok: false, note: `check crashed: ${(graded.stderr || '').slice(0, 300)}` }
  try {
    check = JSON.parse(graded.stdout)
  } catch {}

  const total = session?.total || usage || {}
  return {
    task: task.id,
    mode,
    rep,
    thread,
    ok: check.ok,
    note: check.note,
    valid,
    exit: code,
    seconds,
    input: total.input_tokens ?? null,
    cached: total.cached_input_tokens ?? null,
    output: total.output_tokens ?? null,
    requests: session?.requests ?? null,
    pollRequests: session?.pollRequests ?? null,
    tools: session?.tools ?? null,
    commands: commands.length,
    verified: commands.some(c => VERIFY.test(c)),
    asked: /\?\s*$|\?\s*\n|¿/.test(answer),
    error: code === 0 ? null : errors.trim().split('\n').slice(-3).join(' ').slice(0, 300)
  }
}

// --- report -------------------------------------------------------------------------------------

const median = list => {
  const xs = list.filter(x => typeof x === 'number').sort((a, b) => a - b)
  if (!xs.length) return null
  const mid = Math.floor(xs.length / 2)
  return xs.length % 2 ? xs[mid] : Math.round((xs[mid - 1] + xs[mid]) / 2)
}
const sum = list => list.reduce((a, b) => a + (b || 0), 0)
const k = n => (n == null ? '–' : n >= 10000 ? `${Math.round(n / 1000)}K` : n >= 1000 ? `${(n / 1000).toFixed(1)}K` : String(n))
const change = (a, b) => (a && b != null ? `${b <= a ? '−' : '+'}${Math.abs(Math.round(((b - a) / a) * 100))}%` : '')
const pair = (a, b, fmt = k) => `${fmt(a)} → ${fmt(b)}${change(a, b) ? ` (${change(a, b)})` : ''}`

export function report(results, lang = 'en') {
  const es = lang === 'es'
  const runs = results.runs.filter(r => r.valid)
  const of = (task, mode) => runs.filter(r => r.task === task && r.mode === mode)
  const lines = []
  lines.push(
    es
      ? '| Tarea | Bien hecha (sin → con) | Tokens de entrada (mediana) | Peticiones (mediana) | Tiempo (mediana) |'
      : '| Task | Done right (without → with) | Input tokens (median) | Requests (median) | Time (median) |',
    '| --- | --- | --- | --- | --- |'
  )
  for (const task of TASKS) {
    const off = of(task.id, 'off')
    const on = of(task.id, 'on')
    if (!off.length && !on.length) continue
    const done = list => `${list.filter(r => r.ok).length}/${list.length}`
    lines.push(
      `| ${task.title[lang] || task.title.en} (${task.goal[lang] || task.goal.en}) | ${done(off)} → ${done(on)} | ${pair(median(off.map(r => r.input)), median(on.map(r => r.input)))} | ${pair(median(off.map(r => r.requests)), median(on.map(r => r.requests)), String)} | ${pair(median(off.map(r => r.seconds)), median(on.map(r => r.seconds)), s => (s == null ? '–' : `${s} s`))} |`
    )
  }
  const off = runs.filter(r => r.mode === 'off')
  const on = runs.filter(r => r.mode === 'on')
  const fresh = list => sum(list.map(r => (r.input || 0) - (r.cached || 0)))
  const per = list => (list.length ? 1 / list.length : 0)
  // Totals per run, so a missing run on one side doesn't skew the comparison.
  const avg = (list, f) => Math.round(sum(list.map(f)) * per(list))
  lines.push(
    '',
    es
      ? `Promedio por corrida: tokens de entrada ${pair(avg(off, r => r.input), avg(on, r => r.input))}, sin caché ${pair(Math.round(fresh(off) * per(off)), Math.round(fresh(on) * per(on)))}, peticiones ${pair(avg(off, r => r.requests), avg(on, r => r.requests), String)}. Bien hechas: ${off.filter(r => r.ok).length}/${off.length} → ${on.filter(r => r.ok).length}/${on.length}.`
      : `Average per run: input tokens ${pair(avg(off, r => r.input), avg(on, r => r.input))}, uncached ${pair(Math.round(fresh(off) * per(off)), Math.round(fresh(on) * per(on)))}, requests ${pair(avg(off, r => r.requests), avg(on, r => r.requests), String)}. Done right: ${off.filter(r => r.ok).length}/${off.length} → ${on.filter(r => r.ok).length}/${on.length}.`
  )
  const m = results.meta
  const dropped = results.runs.length - runs.length
  lines.push(
    '',
    es
      ? `Codex ${m.codex}, modelo ${m.model || 'por defecto'}${m.effort ? ` (${m.effort})` : ''}, ${m.os}, ${m.date}. ${m.runs} corridas por tarea y modo${dropped ? `; ${dropped} inválidas, fuera del cálculo` : ''}.`
      : `Codex ${m.codex}, model ${m.model || 'default'}${m.effort ? ` (${m.effort})` : ''}, ${m.os}, ${m.date}. ${m.runs} runs per task and mode${dropped ? `; ${dropped} invalid, left out` : ''}.`
  )
  return lines.join('\n')
}

// --- main ---------------------------------------------------------------------------------------

function modelFromConfig() {
  const toml = readText(join(codexHome(), 'config.toml'), '')
  const top = toml.split(/^\[/m)[0]
  return {
    model: /^model\s*=\s*"([^"]+)"/m.exec(top)?.[1],
    effort: /^model_reasoning_effort\s*=\s*"([^"]+)"/m.exec(top)?.[1]
  }
}

async function main() {
  if (opt.help) {
    console.log(readFileSync(fileURLToPath(import.meta.url), 'utf8').split('\n').slice(1, 14).map(l => l.replace(/^\/\/ ?/, '')).join('\n'))
    return
  }
  if (opt.check) {
    const task = TASKS.find(t => t.id === opt.check)
    const [dir, answerFile] = positionals
    console.log(JSON.stringify(await task.check(dir, readText(answerFile, '') || '')))
    return
  }
  if (opt.setup) {
    const dir = positionals[0] || join(SCRATCH, 'work', opt.setup)
    prepare(TASKS.find(t => t.id === opt.setup), dir)
    console.log(dir)
    return
  }
  if (opt.report) {
    console.log(report(JSON.parse(readFileSync(opt.report, 'utf8')), opt.lang))
    return
  }

  const codex = findCodex()
  if (!codex) fail('Codex not found. Set BCX_CODEX to the codex binary.')
  const trust = hookTrust()
  if (!trust.total || trust.missing.length) fail(`better-codex is not installed and trusted in ${codexHome()} (${trust.trusted}/${trust.total} hooks trusted). Run bcx install and trust them in /hooks.`)
  if (!blockOf(readText(agentsPath(), '') || '')) fail(`no better-codex block in ${agentsPath()}. Run bcx install.`)
  showBlock() // a leftover from an interrupted run
  if (existsSync(overridePath())) fail(`${overridePath()} exists: "off" runs need to put a temporary one there. Move it away for the benchmark.`)
  process.on('SIGINT', () => {
    showBlock()
    process.exit(130)
  })

  const tasks = opt.tasks ? TASKS.filter(t => opt.tasks.split(',').includes(t.id)) : TASKS
  const modes = opt.modes.split(',')
  const runs = Number(opt.runs)
  const defaults = modelFromConfig()
  const model = opt.model || defaults.model
  const effort = opt.effort || defaults.effort
  opt.model = model
  opt.effort = effort
  const date = new Date().toISOString().slice(0, 10)
  const out = opt.out || join(HERE, 'results', `${date}-codex-${codex.version.replace(/[^\w.-]/g, '')}.json`)
  const results =
    opt.resume && existsSync(out)
      ? JSON.parse(readFileSync(out, 'utf8'))
      : { meta: { date, codex: codex.version, model, effort, os: `${process.platform} ${process.arch}`, node: process.version, runs, tasks: tasks.map(t => t.id) }, runs: [] }
  mkdirSync(dirname(out), { recursive: true })

  log(`bench: Codex ${codex.version}, ${model || 'default model'}${effort ? ` (${effort})` : ''}, ${tasks.length} tasks × ${modes.length} modes × ${runs} runs → ${out}`)
  for (let rep = 1; rep <= runs; rep++) {
    for (const task of tasks) {
      // Alternate the order so neither mode always runs first.
      for (const mode of rep % 2 ? modes : [...modes].reverse()) {
        if (results.runs.some(r => r.task === task.id && r.mode === mode && r.rep === rep)) continue
        const r = await runOnce(codex, task, mode, rep)
        results.runs.push(r)
        writeFileSync(out, `${JSON.stringify(results, null, 2)}\n`)
        log(`  ${task.id} ${mode} #${rep}: ${r.ok ? 'ok' : `not ok (${r.note || r.error || ''})`}${r.valid ? '' : ' [INVALID]'} · ${k(r.input)} input · ${r.requests ?? '–'} requests · ${r.seconds} s`)
      }
    }
  }
  console.log(report(results, opt.lang))
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) await main()
