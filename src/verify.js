import { resolve } from 'node:path'
import { norm } from './guard.js'
import { patchFiles, shellWrites, toolCommands } from './shell.js'

export const CODE_EXT = /\.(c|cc|cpp|h|hpp|cs|fs|go|java|kt|kts|scala|swift|m|mm|rs|py|rb|php|js|jsx|mjs|cjs|ts|tsx|mts|cts|vue|svelte|astro|dart|lua|ex|exs|sql|sh|ps1|gradle|html)$/i

// Commands that check code: tests, type checks, linters, builds.
export const VERIFY = /\b(npm|pnpm|yarn|bun)\s+(run\s+)?(test|check|lint|typecheck|type-check|build|verify|ci)\b|\b(vitest|jest|mocha|ava|tsc|eslint|biome|playwright|cypress|karma)\b|\bng\s+(test|build|lint)\b|\bnode\s+--test\b|\bpytest\b|\bpython3?\s+-m\s+(pytest|unittest)\b|\bcargo\s+(test|check|build|clippy)\b|\bgo\s+(test|vet|build)\b|\bmvnw?(\.cmd)?\b[\s\S]*\b(test|verify|package|compile)\b|\bgradlew?(\.bat)?\b[\s\S]*\b(test|build|check|assemble\w*|lint)\b|\bdotnet\s+(test|build)\b|\bphpunit\b|\bartisan\s+test\b|\brspec\b|\brake\s+test\b|\b(flutter|dart)\s+(test|analyze)\b|\bdeno\s+(test|check|lint)\b|\bruff\b|\bmypy\b|\bmake\s+(test|check)\b/i

// What a failed check prints. Codex gives hooks the output of a command, not its exit code.
const FAILED = [
  /^ℹ fail [1-9]/m, // node --test
  /^\s*Tests?:\s+.*\b[1-9]\d* failed/m, // jest
  /^\s*Test Files\s+.*\b[1-9]\d* failed/m, // vitest
  /^\s*[1-9]\d* failing\b/m, // mocha
  /^=+ .*\b[1-9]\d* (failed|errors?)\b/m, // pytest
  /^--- FAIL:|^FAIL\s+\S/m, // go, jest per file
  /test result: FAILED/, // cargo
  /\berror TS\d+:|^Found [1-9]\d* errors?\b/m, // tsc
  /✖ [1-9]\d* problems? \([1-9]\d* errors?/, // eslint
  /^BUILD FAILED|BUILD FAILURE|Build FAILED\.|^\s*Failed!\s+-\s+Failed:\s+[1-9]/m, // gradle, maven, dotnet
  /Executed \d+ of \d+ .*\([1-9]\d* FAILED\)/, // karma
  /^✘ \[ERROR\]|^ERROR in |Application bundle generation failed|Compilation failed/m, // esbuild, webpack, angular
  /^[1-9]\d* examples?, [1-9]\d* failures?/m, // rspec
  /^npm (ERR!|error) /m // an npm script that exited with an error
]

// The line that shows a check failed, or null if it looks like it passed.
export function failureOf(output) {
  const text = typeof output === 'string' ? output : JSON.stringify(output ?? '')
  for (const re of FAILED) {
    const m = re.exec(text)
    if (m) {
      const start = text.lastIndexOf('\n', m.index) + 1
      const end = text.indexOf('\n', m.index)
      return text.slice(start, end === -1 ? undefined : end).trim().slice(0, 160)
    }
  }
  return null
}

// An answer that admits the check is still red, in Spanish or English.
const ACKNOWLEDGED = /(?<![\p{L}])(fail\p{L}*|fall[aeoó]\p{L}*|error\p{L}*|no pasa\p{L}*|sigue en rojo|en rojo|broken|roto|rota|not passing|still red)(?![\p{L}])/iu

const union = (list, items, max) => [...new Set([...list, ...items])].slice(-max)

// On Windows Codex often calls npm.cmd (PowerShell blocks npm.ps1) or node.exe: same command.
const withoutExt = command => command.replace(/\b(npm|pnpm|yarn|bun|npx|pnpx|bunx|ng|node|deno|python3?|py|tsc|eslint|vitest|jest)\.(cmd|ps1|exe|bat)\b/gi, '$1')

// PostToolUse: remembers what the turn edited, whether a check ran after the last edit, and if it failed.
export function trackTool(state, { toolName, toolInput, cwd, verifyCmd, output }) {
  const commands = toolCommands(toolName, toolInput)
  const patch = patchFiles(toolInput)
  const written = commands.flatMap(shellWrites)
  const edits = [...patch.map(f => f.path), ...written]
  const created = [...patch.filter(f => f.op === 'add').map(f => f.path), ...written]
  const verified = commands.map(withoutExt).some(c => VERIFY.test(c) || (verifyCmd && c.includes(verifyCmd)))
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
    state.verifyFailed = failureOf(output)
  }
  return { edits: edits.length, verified }
}

// Stop: the reason that sends Codex back to verify, or null.
export function gateReason(state, project) {
  if (!project?.verify || state.gateFired) return null
  const code = state.edited.filter(f => CODE_EXT.test(f))
  if (!code.length) return null
  if (state.lastEdit > state.lastVerify) {
    const files = `${code.slice(0, 5).join(', ')}${code.length > 5 ? ', …' : ''}`
    return `[better-codex verify-gate] You changed code (${files}) but ran no check after the last edit. Run \`${project.verify}\` or a narrower, faster check that covers the change, fix what fails, then give your final answer with the result. If it cannot run here, say why in one line instead.`
  }
  // Codex already told the user it still fails: sending it back would only cost a request.
  if (state.verifyFailed && !ACKNOWLEDGED.test(state.lastAnswer || '')) {
    return `[better-codex verify-gate] The last check after your changes failed: "${state.verifyFailed}". Fix the cause and run the check again before finishing. If the failure is unrelated to your change or was already there, say so plainly in your answer instead of reporting success.`
  }
  return null
}
