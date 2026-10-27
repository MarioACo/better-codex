import { repoBrief } from './brief.js'
import { loadConfig } from './config.js'
import { dietCheck } from './diet.js'
import { gitFiles, gitRoot } from './git.js'
import { denyReason, gitStatusMap, inspect, isApproval, norm, RULES, sameAction } from './guard.js'
import { pick, resolveLang } from './i18n.js'
import { meterCheck } from './meter.js'
import { record } from './metrics.js'
import { detectProject } from './project.js'
import { boostPrompt } from './prompt.js'
import { extractWorkdir } from './shell.js'
import { loadState, pruneStates, saveState } from './state.js'
import { readUsage } from './transcript.js'
import { clip, estimateTokens } from './util.js'
import { gateReason, trackTool } from './verify.js'

export const EVENTS = ['SessionStart', 'UserPromptSubmit', 'PreToolUse', 'PostToolUse', 'Stop']

const addContext = (event, text) => ({ hookSpecificOutput: { hookEventName: event, additionalContext: text } })
const deny = reason => ({ hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: reason } })

// Each feature is isolated: one that throws never stops the others, nor Codex.
function safely(fn, fallback = null) {
  try {
    return fn()
  } catch (error) {
    record('error', { message: String(error?.stack || error).slice(0, 500) })
    return fallback
  }
}

function onSessionStart(input, cfg, cwd) {
  safely(() => pruneStates())
  if (!cfg.brief || !/^(startup|clear|compact)$/.test(input.source || 'startup')) return null
  const text = safely(() => repoBrief(cwd), '')
  if (!text) return null
  record('brief', { tokens: estimateTokens(text) })
  return addContext('SessionStart', text)
}

function onUserPromptSubmit(input, cfg, cwd) {
  const state = loadState(input.session_id)
  const prompt = String(input.prompt ?? '')
  const parts = []

  if (cfg.guard) {
    safely(() => {
      const guard = state.guard
      if (guard.pending.length) {
        const names = guard.pending.map(p => `${RULES[p.rule].title.en} (\`${p.command}\`)`).join('; ')
        if (isApproval(prompt)) {
          guard.approved = guard.pending.map(({ rule, detail }) => ({ rule, detail }))
          guard.approvedTurn = input.turn_id ?? '*'
          parts.push(`[better-codex guard] The user approved, for this turn only: ${names}. Run exactly that; anything else risky still needs approval.`)
          record('guard-approved', { rules: guard.approved.map(a => a.rule), command: guard.pending[0].command.slice(0, 160) })
        } else {
          guard.approved = []
          guard.approvedTurn = null
          parts.push(`[better-codex guard] The user did not clearly approve: ${names}. Do not run it; follow their new message. It needs an explicit yes.`)
        }
        guard.pending = []
      } else {
        guard.approved = []
        guard.approvedTurn = null
      }
    })
  }

  const root = safely(() => gitRoot(cwd))
  if (cfg.guard && root) {
    // Changes Codex did not make in this session are yours: the guard protects them.
    safely(() => {
      const touched = new Set(state.touched)
      const userDirty = new Set(state.userDirty)
      for (const path of gitStatusMap(root).keys()) {
        const abs = norm(`${root}/${path}`)
        if (!touched.has(abs)) userDirty.add(abs)
      }
      state.userDirty = [...userDirty].slice(-1000)
    })
  }

  Object.assign(state, {
    turn: input.turn_id ?? null,
    seq: 0,
    lastEdit: 0,
    lastVerify: 0,
    edited: [],
    gateFired: false,
    bigOutputWarned: false,
    prompt: clip(prompt, 4000),
    verifyCmd: safely(() => detectProject(root || cwd).verify)
  })

  if (cfg.boost) {
    safely(() => {
      const files = cfg.hints && root && prompt.length >= 8 ? gitFiles(root) : []
      const result = boostPrompt(prompt, { files, seen: state.playbooks, hints: cfg.hints })
      if (result.task && !state.playbooks.includes(result.task)) state.playbooks.push(result.task)
      if (result.text) {
        parts.push(result.text)
        record('boost', { mode: result.mode, task: result.task, hints: result.hints.length, tokens: estimateTokens(result.text) })
      }
    })
  }

  saveState(input.session_id, state)
  return parts.length ? addContext('UserPromptSubmit', parts.join('\n')) : null
}

function onPreToolUse(input, cfg, cwd) {
  const state = loadState(input.session_id)
  const toolName = input.tool_name
  const toolInput = input.tool_input
  const workdir = extractWorkdir(toolInput, cwd)

  if (cfg.guard) {
    const found = safely(() => inspect({ toolName, toolInput, cwd: workdir, created: state.created, touched: state.touched, userDirty: state.userDirty }))
    if (found) {
      const guard = state.guard
      const approved = (guard.approvedTurn === '*' || guard.approvedTurn === input.turn_id) && guard.approved.some(a => sameAction(a, found))
      if (approved) {
        record('guard-allowed', { rule: found.rule, command: found.command.slice(0, 160) })
        return null
      }
      guard.pending = [
        ...guard.pending.filter(p => !sameAction(p, found)),
        { rule: found.rule, severity: found.severity, command: found.command, detail: found.detail }
      ].slice(-5)
      saveState(input.session_id, state)
      record('guard-blocked', { rule: found.rule, severity: found.severity, command: found.command.slice(0, 160) })
      return deny(denyReason(found))
    }
  }

  if (cfg.diet) {
    const found = safely(() => dietCheck({ toolName, toolInput, cwd: workdir, prompt: state.prompt, maxKB: cfg.dietMaxKB }))
    if (found) {
      record('diet', { rule: found.rule, savedTokens: found.savedTokens || 0, path: String(found.path).slice(0, 160) })
      return deny(found.reason)
    }
  }
  return null
}

function onPostToolUse(input, cfg, cwd) {
  const state = loadState(input.session_id)
  const toolInput = input.tool_input
  safely(() => trackTool(state, { toolName: input.tool_name, toolInput, cwd: extractWorkdir(toolInput, cwd), verifyCmd: state.verifyCmd }))

  let out = null
  if (cfg.bigOutputKB > 0 && !state.bigOutputWarned) {
    const size = safely(() => JSON.stringify(input.tool_response ?? '').length, 0)
    if (size > cfg.bigOutputKB * 1024) {
      state.bigOutputWarned = true
      record('big-output', { tokens: Math.round(size / 4) })
      out = addContext(
        'PostToolUse',
        `[better-codex] That call returned about ${Math.round(size / 4000)}K tokens of output, which stays in the context for the rest of the session. Keep follow-up calls narrow: target paths and globs, rg -l or -c first, cap with -m N or Select-Object -First N.`
      )
    }
  }
  saveState(input.session_id, state)
  return out
}

function onStop(input, cfg, lang) {
  const state = loadState(input.session_id)
  const out = {}
  const messages = []

  if (cfg.guard) {
    for (const p of state.guard.pending) {
      const rule = RULES[p.rule]
      messages.push(
        pick(
          lang,
          `🛡 better-codex detuvo: ${rule.title.es} — \`${p.command}\`. Riesgo: ${rule.risk.es}. Responde «sí» para permitirlo una vez.`,
          `🛡 better-codex stopped: ${rule.title.en} — \`${p.command}\`. Risk: ${rule.risk.en}. Reply "yes" to allow it once.`
        )
      )
    }
  }

  // Not while Codex waits for your approval, and only once per turn.
  if (cfg.verifyGate && !input.stop_hook_active && !state.guard.pending.length) {
    const reason = safely(() => gateReason(state, { verify: state.verifyCmd }))
    if (reason) {
      state.gateFired = true
      out.decision = 'block'
      out.reason = reason
      record('verify-gate', {})
      messages.push(pick(lang, `better-codex: le pedí a Codex verificar con \`${state.verifyCmd}\` antes de terminar.`, `better-codex: asked Codex to verify with \`${state.verifyCmd}\` before finishing.`))
    }
  }

  if (cfg.meter !== 'off') {
    safely(() => {
      const usage = readUsage(input.transcript_path)
      const { message, levels } = meterCheck(usage, cfg, state.meter, lang)
      state.meter = levels
      if (message) {
        messages.push(message)
        record('meter', { ctx: usage?.context?.pct ?? null, primary: usage?.primary?.pct ?? null })
      }
    })
  }

  saveState(input.session_id, state)
  if (messages.length) out.systemMessage = messages.join('\n')
  return Object.keys(out).length ? out : null
}

// Entry point for `bcx hook <Event>`: the JSON Codex expects on stdout, or null for "nothing to add".
export function handle(event, input, cfg = loadConfig()) {
  const cwd = input.cwd || process.cwd()
  switch (event) {
    case 'SessionStart':
      return onSessionStart(input, cfg, cwd)
    case 'UserPromptSubmit':
      return onUserPromptSubmit(input, cfg, cwd)
    case 'PreToolUse':
      return onPreToolUse(input, cfg, cwd)
    case 'PostToolUse':
      return onPostToolUse(input, cfg, cwd)
    case 'Stop':
      return onStop(input, cfg, resolveLang(cfg.lang))
    default:
      return null
  }
}
