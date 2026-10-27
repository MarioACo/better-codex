import { resolve } from 'node:path'
import { norm } from './guard.js'
import { patchFiles, shellWrites, toolCommands } from './shell.js'

export const CODE_EXT = /\.(c|cc|cpp|h|hpp|cs|fs|go|java|kt|kts|scala|swift|m|mm|rs|py|rb|php|js|jsx|mjs|cjs|ts|tsx|mts|cts|vue|svelte|astro|dart|lua|ex|exs|sql|sh|ps1|gradle|html)$/i

// Commands that check code: tests, type checks, linters, builds.
export const VERIFY = /\b(npm|pnpm|yarn|bun)\s+(run\s+)?(test|check|lint|typecheck|type-check|build|verify|ci)\b|\b(vitest|jest|mocha|ava|tsc|eslint|biome|playwright|cypress|karma)\b|\bng\s+(test|build|lint)\b|\bnode\s+--test\b|\bpytest\b|\bpython3?\s+-m\s+(pytest|unittest)\b|\bcargo\s+(test|check|build|clippy)\b|\bgo\s+(test|vet|build)\b|\bmvnw?(\.cmd)?\b[\s\S]*\b(test|verify|package|compile)\b|\bgradlew?(\.bat)?\b[\s\S]*\b(test|build|check|assemble\w*|lint)\b|\bdotnet\s+(test|build)\b|\bphpunit\b|\bartisan\s+test\b|\brspec\b|\brake\s+test\b|\b(flutter|dart)\s+(test|analyze)\b|\bdeno\s+(test|check|lint)\b|\bruff\b|\bmypy\b|\bmake\s+(test|check)\b/i

const union = (list, items, max) => [...new Set([...list, ...items])].slice(-max)

// PostToolUse: remembers what the turn edited and whether a check ran after the last edit.
export function trackTool(state, { toolName, toolInput, cwd, verifyCmd }) {
  const commands = toolCommands(toolName, toolInput)
  const patch = patchFiles(toolInput)
  const written = commands.flatMap(shellWrites)
  const edits = [...patch.map(f => f.path), ...written]
  const created = [...patch.filter(f => f.op === 'add').map(f => f.path), ...written]
  const verified = commands.some(c => VERIFY.test(c) || (verifyCmd && c.includes(verifyCmd)))
  const abs = p => norm(resolve(cwd, p))

  if (edits.length) {
    state.seq += 1
    state.lastEdit = state.seq
    state.edited = union(state.edited, edits, 50)
    state.touched = union(state.touched, edits.map(abs), 500)
  }
  if (created.length) state.created = union(state.created, created.map(abs), 500)
  if (verified) {
    state.seq += 1
    state.lastVerify = state.seq
  }
  return { edits: edits.length, verified }
}

// Stop: the reason that sends Codex back to verify, or null.
export function gateReason(state, project) {
  if (!project?.verify || state.gateFired || !(state.lastEdit > state.lastVerify)) return null
  const code = state.edited.filter(f => CODE_EXT.test(f))
  if (!code.length) return null
  const files = `${code.slice(0, 5).join(', ')}${code.length > 5 ? ', …' : ''}`
  return `[better-codex verify-gate] You changed code (${files}) but ran no check after the last edit. Run \`${project.verify}\` or a narrower, faster check that covers the change, fix what fails, then give your final answer with the result. If it cannot run here, say why in one line instead.`
}
