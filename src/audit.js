import { readFileSync } from 'node:fs'
import { dietCheck } from './diet.js'
import { inspect } from './guard.js'
import { sessionFiles } from './stats.js'

const HEAD = /^\{"timestamp":"[^"]+",(?:"\w+":(?:-?\d+|"[^"]*"|true|false|null),)*"type":"(session_meta|response_item)"/

const parse = text => {
  try {
    return JSON.parse(text)
  } catch {
    return null
  }
}

// The tool calls of one rollout, in the shape PreToolUse receives them.
export function toolCalls(text) {
  const calls = []
  let cwd = null
  for (const line of text.split('\n')) {
    const m = HEAD.exec(line)
    if (!m) continue
    const item = parse(line)?.payload
    if (!item) continue
    if (m[1] === 'session_meta') {
      cwd = item.cwd ?? cwd
      continue
    }
    if (item.type === 'custom_tool_call') {
      if (item.name === 'exec') calls.push({ cwd, toolName: 'exec', toolInput: String(item.input ?? '') })
      else if (item.name === 'apply_patch') calls.push({ cwd, toolName: 'apply_patch', toolInput: { command: String(item.input ?? '') } })
    } else if (item.type === 'function_call' && /^(exec_command|shell_command|shell)$/.test(item.name)) {
      const args = parse(item.arguments) || {}
      const command = args.cmd ?? args.command
      if (command) calls.push({ cwd: args.workdir || cwd, toolName: 'Bash', toolInput: { command, workdir: args.workdir } })
    }
  }
  return calls
}

// Replays past tool calls through the guard and the diet. Nothing is executed; git checks see today's repos.
// strict: replays with strict mode on, to see how often it would ask.
export function audit(days = 30, { limit = 5000, strict = false } = {}) {
  // strict: which commands strict mode would ask about, by command and subcommand (git commit, node -e).
  const report = { sessions: 0, calls: 0, guard: {}, diet: {}, savedTokens: 0, strict: {} }
  const add = (bucket, key, example) => {
    const entry = (bucket[key] ??= { count: 0, examples: [] })
    entry.count++
    if (entry.examples.length < 3 && !entry.examples.includes(example)) entry.examples.push(example)
  }
  for (const { file } of sessionFiles(days)) {
    report.sessions++
    for (const call of toolCalls(readFileSync(file, 'utf8'))) {
      if (report.calls >= limit) return report
      report.calls++
      const cwd = call.cwd || process.cwd()
      const found = inspect({ ...call, cwd, strict })
      if (found) {
        add(report.guard, found.rule, found.command.slice(0, 140))
        if (found.rule === 'strict') add(report.strict, /`([^`]+)`/.exec(found.detail)?.[1] ?? found.command, found.command.slice(0, 140))
        continue
      }
      const diet = dietCheck({ ...call, cwd })
      if (diet) {
        add(report.diet, diet.rule, diet.path)
        report.savedTokens += diet.savedTokens || 0
      }
    }
  }
  return report
}
