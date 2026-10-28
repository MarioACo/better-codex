import assert from 'node:assert/strict'
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { test } from 'node:test'
import { DEFAULTS } from '../src/config.js'
import { handle } from '../src/hooks.js'
import { loadState, saveState } from '../src/state.js'
import { readEvents } from '../src/metrics.js'
import { isolate, repo, tempDir, write } from './helpers.js'
import { ROLLOUT } from './fixtures.js'

isolate()
const cfg = { ...DEFAULTS, lang: 'es' }
let n = 0
const session = () => `s${++n}`
const contextOf = out => out?.hookSpecificOutput?.additionalContext ?? ''

test('SessionStart: a brief on startup and after compaction, nothing on resume', () => {
  const root = repo({ 'package.json': JSON.stringify({ type: 'module', scripts: { test: 'node --test' }, devDependencies: { typescript: '5' } }), 'src/a.ts': '' })
  const out = handle('SessionStart', { session_id: session(), cwd: root, source: 'startup' }, cfg)
  assert.match(contextOf(out), /Repo brief[\s\S]*TypeScript[\s\S]*test `npm test`[\s\S]*src\/ \(1\)/)
  assert.ok(handle('SessionStart', { session_id: session(), cwd: root, source: 'compact' }, cfg))
  assert.equal(handle('SessionStart', { session_id: session(), cwd: root, source: 'resume' }, cfg), null)
  assert.equal(handle('SessionStart', { session_id: session(), cwd: tempDir(), source: 'startup' }, cfg), null)
})

test('UserPromptSubmit: mode, playbook and file hints; follow-ups add nothing', () => {
  const root = repo({ 'src/auth/login.ts': 'x', 'README.md': '' })
  const sid = session()
  const out = handle('UserPromptSubmit', { session_id: sid, turn_id: 't1', cwd: root, prompt: '+el login truena al guardar' }, cfg)
  assert.match(contextOf(out), /Mode DEEP[\s\S]*Bug fix[\s\S]*src\/auth\/login\.ts/)
  assert.equal(handle('UserPromptSubmit', { session_id: sid, turn_id: 't2', cwd: root, prompt: 'dale' }, cfg), null)
})

test('guard: stop → explain → yes → allowed once → asks again next turn', () => {
  const root = repo()
  const sid = session()
  const pre = turn => handle('PreToolUse', { session_id: sid, turn_id: turn, cwd: root, tool_name: 'Bash', tool_input: { command: 'git push --force origin main' } }, cfg)

  handle('UserPromptSubmit', { session_id: sid, turn_id: 't1', cwd: root, prompt: 'sube los cambios aunque haya conflicto' }, cfg)
  const blocked = pre('t1')
  assert.equal(blocked.hookSpecificOutput.permissionDecision, 'deny')
  assert.match(blocked.hookSpecificOutput.permissionDecisionReason, /why their request needs it/)

  const stop = handle('Stop', { session_id: sid, turn_id: 't1', cwd: root, stop_hook_active: false }, cfg)
  assert.match(stop.systemMessage, /better-codex detuvo: Reescribir o borrar historial de git[\s\S]*Responde «sí»/)
  assert.equal(stop.decision, undefined) // no verify gate while waiting for you

  const approval = handle('UserPromptSubmit', { session_id: sid, turn_id: 't2', cwd: root, prompt: 'sí, hazlo' }, cfg)
  assert.match(contextOf(approval), /The user approved, for this turn only/)
  assert.equal(pre('t2'), null)
  assert.equal(pre('t2'), null) // a retry in the same turn

  handle('UserPromptSubmit', { session_id: sid, turn_id: 't3', cwd: root, prompt: 'ahora otra cosa' }, cfg)
  assert.equal(pre('t3').hookSpecificOutput.permissionDecision, 'deny')
  const kinds = readEvents().map(e => e.kind)
  assert.ok(kinds.includes('guard-blocked') && kinds.includes('guard-approved') && kinds.includes('guard-allowed'))
})

test('guard: a yes approves that action, not every action of its kind', () => {
  const root = repo({ 'src/app.js': 'x', 'docs/a.md': 'y' })
  const sid = session()
  const pre = (turn, command) => handle('PreToolUse', { session_id: sid, turn_id: turn, cwd: root, tool_name: 'Bash', tool_input: { command } }, cfg)
  handle('UserPromptSubmit', { session_id: sid, turn_id: 't1', cwd: root, prompt: 'borra la carpeta src vieja' }, cfg)
  pre('t1', 'rm -rf src')
  handle('UserPromptSubmit', { session_id: sid, turn_id: 't2', cwd: root, prompt: 'sí' }, cfg)
  assert.equal(pre('t2', 'Remove-Item -Recurse -Force src'), null) // same action, other syntax
  assert.equal(pre('t2', 'rm -rf docs').hookSpecificOutput.permissionDecision, 'deny')
})

test('guard: anything but a clear yes leaves it blocked', () => {
  const root = repo()
  const sid = session()
  handle('UserPromptSubmit', { session_id: sid, turn_id: 't1', cwd: root, prompt: 'limpia el repo' }, cfg)
  handle('PreToolUse', { session_id: sid, turn_id: 't1', cwd: root, tool_name: 'Bash', tool_input: { command: 'rm -rf src' } }, cfg)
  const reply = handle('UserPromptSubmit', { session_id: sid, turn_id: 't2', cwd: root, prompt: 'sí, pero primero haz un respaldo' }, cfg)
  assert.match(contextOf(reply), /did not clearly approve/)
  const again = handle('PreToolUse', { session_id: sid, turn_id: 't2', cwd: root, tool_name: 'Bash', tool_input: { command: 'rm -rf src' } }, cfg)
  assert.equal(again.hookSpecificOutput.permissionDecision, 'deny')
})

test('guard: your uncommitted changes are protected, Codex reverting its own are not', () => {
  const root = repo()
  writeFileSync(join(root, 'README.md'), 'my edit\n') // yours, before the session
  const sid = session()
  handle('UserPromptSubmit', { session_id: sid, turn_id: 't1', cwd: root, prompt: 'cambia src/app.js' }, cfg)
  handle('PostToolUse', { session_id: sid, turn_id: 't1', cwd: root, tool_name: 'apply_patch', tool_input: { command: '*** Begin Patch\n*** Update File: src/app.js\n*** End Patch' } }, cfg)
  writeFileSync(join(root, 'src/app.js'), 'export const app = 2\n')
  const pre = command => handle('PreToolUse', { session_id: sid, turn_id: 't1', cwd: root, tool_name: 'Bash', tool_input: { command } }, cfg)
  assert.equal(pre('git checkout -- src/app.js'), null)
  assert.equal(pre('git checkout -- README.md').hookSpecificOutput.permissionDecision, 'deny')
})

test('verify gate: sends Codex back once, then lets it finish', () => {
  const root = repo({ 'package.json': JSON.stringify({ scripts: { test: 'node --test' } }), 'src/a.js': '' })
  const sid = session()
  handle('UserPromptSubmit', { session_id: sid, turn_id: 't1', cwd: root, prompt: 'agrega la función suma en src/a.js' }, cfg)
  handle('PostToolUse', { session_id: sid, turn_id: 't1', cwd: root, tool_name: 'apply_patch', tool_input: { command: '*** Begin Patch\n*** Update File: src/a.js\n*** End Patch' } }, cfg)
  const stop = handle('Stop', { session_id: sid, turn_id: 't1', cwd: root, stop_hook_active: false }, cfg)
  assert.equal(stop.decision, 'block')
  assert.match(stop.reason, /npm test/)
  assert.match(stop.systemMessage, /verificar con `npm test`/)
  const second = handle('Stop', { session_id: sid, turn_id: 't1', cwd: root, stop_hook_active: true }, cfg)
  assert.equal(second?.decision, undefined)
})

test('diet and big outputs', () => {
  const root = repo({ 'package-lock.json': `{"x":"${'y'.repeat(40 * 1024)}"}` })
  const sid = session()
  handle('UserPromptSubmit', { session_id: sid, turn_id: 't1', cwd: root, prompt: 'actualiza dependencias' }, cfg)
  const read = handle('PreToolUse', { session_id: sid, turn_id: 't1', cwd: root, tool_name: 'Bash', tool_input: { command: 'cat package-lock.json' } }, cfg)
  assert.match(read.hookSpecificOutput.permissionDecisionReason, /token-diet/)
  const big = handle('PostToolUse', { session_id: sid, turn_id: 't1', cwd: root, tool_name: 'Bash', tool_input: { command: 'rg x' }, tool_response: 'y'.repeat(60 * 1024) }, cfg)
  assert.match(contextOf(big), /about 15K tokens/)
  assert.equal(handle('PostToolUse', { session_id: sid, turn_id: 't1', cwd: root, tool_name: 'Bash', tool_input: { command: 'rg x' }, tool_response: 'y'.repeat(60 * 1024) }, cfg), null)
})

test('meter: reads the transcript Codex passes to Stop', () => {
  const dir = tempDir()
  write(dir, { 'rollout.jsonl': `${ROLLOUT}\n` })
  const out = handle('Stop', { session_id: session(), turn_id: 't1', cwd: dir, stop_hook_active: false, transcript_path: join(dir, 'rollout.jsonl') }, cfg)
  assert.match(out.systemMessage, /contexto 78%[\s\S]*uso 5 h 80%/)
})

test('every feature can be turned off', () => {
  const root = repo()
  const off = { ...cfg, guard: false, brief: false, boost: false, diet: false, verifyGate: false, meter: 'off' }
  const sid = session()
  assert.equal(handle('SessionStart', { session_id: sid, cwd: root, source: 'startup' }, off), null)
  assert.equal(handle('UserPromptSubmit', { session_id: sid, turn_id: 't1', cwd: root, prompt: '+arregla todo el login' }, off), null)
  assert.equal(handle('PreToolUse', { session_id: sid, turn_id: 't1', cwd: root, tool_name: 'Bash', tool_input: { command: 'rm -rf src' } }, off), null)
  assert.equal(handle('Stop', { session_id: sid, turn_id: 't1', cwd: root, stop_hook_active: false }, off), null)
})

test('guard: a yes to the question Codex asked first does not need a second yes', () => {
  const root = repo({ 'src/app.js': 'x', 'data/clientes.csv': 'a' })
  write(root, { 'data/ventas.csv': 'sin commit' })
  const sid = session()
  const pre = (turn, command) => handle('PreToolUse', { session_id: sid, turn_id: turn, cwd: root, tool_name: 'Bash', tool_input: { command } }, cfg)
  const ask = '`data/` tiene `ventas.csv` sin commit. Ejecutaría `Remove-Item -LiteralPath .\data -Recurse -Force`; alternativa: moverla a un respaldo. ¿Confirmas?'

  handle('UserPromptSubmit', { session_id: sid, turn_id: 't1', cwd: root, prompt: 'borra la carpeta data' }, cfg)
  handle('Stop', { session_id: sid, turn_id: 't1', cwd: root, stop_hook_active: false, last_assistant_message: ask }, cfg)
  const yes = handle('UserPromptSubmit', { session_id: sid, turn_id: 't2', cwd: root, prompt: 'sí' }, cfg)
  assert.match(contextOf(yes), /run exactly the command you showed/)
  assert.equal(pre('t2', 'Remove-Item -LiteralPath .\data -Recurse -Force'), null)
  assert.equal(pre('t2', 'rm -rf src').hookSpecificOutput.permissionDecision, 'deny') // not what was asked
  assert.equal(pre('t2', 'Remove-Item -LiteralPath $target -Recurse -Force').hookSpecificOutput.permissionDecision, 'deny')
  assert.equal(readEvents().filter(e => e.kind === 'guard-allowed').at(-1).via, 'question')

  // The next turn starts from zero, and a yes after an answer that asked nothing approves nothing.
  handle('Stop', { session_id: sid, turn_id: 't2', cwd: root, stop_hook_active: false, last_assistant_message: 'Listo, borré data/.' }, cfg)
  handle('UserPromptSubmit', { session_id: sid, turn_id: 't3', cwd: root, prompt: 'sí' }, cfg)
  write(root, { 'data/ventas.csv': 'otra vez' })
  assert.equal(pre('t3', 'Remove-Item -LiteralPath .\data -Recurse -Force').hookSpecificOutput.permissionDecision, 'deny')
})

test('guard: after a block, a yes also covers the literal command Codex then proposed', () => {
  const root = repo({ 'data/clientes.csv': 'a' })
  write(root, { 'data/ventas.csv': 'sin commit' })
  const sid = session()
  const pre = (turn, command) => handle('PreToolUse', { session_id: sid, turn_id: turn, cwd: root, tool_name: 'Bash', tool_input: { command } }, cfg)
  handle('UserPromptSubmit', { session_id: sid, turn_id: 't1', cwd: root, prompt: 'borra data' }, cfg)
  assert.equal(pre('t1', '$target = Resolve-Path .\data; Remove-Item -LiteralPath $target -Recurse -Force').hookSpecificOutput.permissionDecision, 'deny')
  const literal = join(root, 'data')
  handle('Stop', { session_id: sid, turn_id: 't1', cwd: root, stop_hook_active: false, last_assistant_message: `Necesito ejecutar exactamente:\n\n\`Remove-Item -LiteralPath '${literal}' -Recurse -Force\`\n\n¿Confirmas este comando exacto?` }, cfg)
  handle('UserPromptSubmit', { session_id: sid, turn_id: 't2', cwd: root, prompt: 'sí' }, cfg)
  assert.equal(pre('t2', `Remove-Item -LiteralPath '${literal}' -Recurse -Force`), null)
})

test('a command that ran over 30 s is pointed out once, and the next session brief remembers it', () => {
  const root = repo({ 'package.json': JSON.stringify({ name: 'demo', scripts: { test: 'node --test' } }) })
  const sid = session()
  const call = { session_id: sid, turn_id: 't1', cwd: root, tool_name: 'Bash', tool_use_id: 'u1', tool_input: { command: 'npm.cmd test' } }
  handle('UserPromptSubmit', { session_id: sid, turn_id: 't1', cwd: root, prompt: 'corre los tests' }, cfg)
  assert.equal(handle('PreToolUse', call, cfg), null)
  // pretend it started 75 s ago
  const state = loadState(sid)
  state.started.u1 = Date.now() - 75_000
  saveState(sid, state)
  const post = handle('PostToolUse', { ...call, tool_response: 'ℹ fail 0' }, cfg)
  assert.match(contextOf(post), /`npm\.cmd test` took ~75 s[\s\S]*one exec/)

  // a quick command says nothing, and the same slow one is not pointed out twice
  handle('PreToolUse', { ...call, tool_use_id: 'u2', tool_input: { command: 'git status' } }, cfg)
  assert.equal(handle('PostToolUse', { ...call, tool_use_id: 'u2', tool_input: { command: 'git status' }, tool_response: '' }, cfg), null)
  handle('PreToolUse', { ...call, tool_use_id: 'u3' }, cfg)
  const again = loadState(sid)
  again.started.u3 = Date.now() - 80_000
  saveState(sid, again)
  assert.equal(handle('PostToolUse', { ...call, tool_use_id: 'u3', tool_response: 'ok' }, cfg), null)

  const brief = handle('SessionStart', { session_id: session(), cwd: root, source: 'startup' }, cfg)
  assert.match(contextOf(brief), /slow here last time: `npm\.cmd test` ~80 s/)
})
