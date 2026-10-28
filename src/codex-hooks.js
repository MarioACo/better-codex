// Asks Codex itself which hooks it loads, whether each one is trusted, and what went wrong reading
// them: the app server's hooks/list, the same list /hooks shows. Codex answers asynchronously, so the
// conversation runs in a child process and callers stay synchronous.
import { spawn, spawnSync } from 'node:child_process'
import { resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const SELF = fileURLToPath(import.meta.url)

// { hooks: [{ eventName, command, trustStatus, sourcePath, … }], errors: [{ path, message }], warnings } or null.
export function codexHooks(codex, cwd, { timeout = 30000 } = {}) {
  const r = spawnSync(process.execPath, [SELF, JSON.stringify({ codex, cwd, timeout: timeout - 2000 })], { encoding: 'utf8', timeout, windowsHide: true })
  try {
    return JSON.parse(r.stdout)
  } catch {
    return null
  }
}

function ask({ codex, cwd, timeout }) {
  return new Promise(done => {
    const child = spawn(codex.bin, [...(codex.prefix || []), 'app-server'], { cwd, stdio: ['pipe', 'pipe', 'ignore'], windowsHide: true })
    const finish = value => {
      clearTimeout(timer)
      child.kill()
      done(value)
    }
    const timer = setTimeout(() => finish(null), timeout)
    child.on('error', () => finish(null))
    let buffer = ''
    child.stdout.on('data', chunk => {
      buffer += chunk
      let nl
      while ((nl = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, nl)
        buffer = buffer.slice(nl + 1)
        let message
        try {
          message = JSON.parse(line)
        } catch {
          continue
        }
        if (message.id === 1) {
          child.stdin.write(`${JSON.stringify({ method: 'initialized' })}\n`)
          child.stdin.write(`${JSON.stringify({ id: 2, method: 'hooks/list', params: { cwds: [cwd] } })}\n`)
        } else if (message.id === 2) {
          const entries = message.result?.data || []
          finish(message.result ? { hooks: entries.flatMap(e => e.hooks || []), errors: entries.flatMap(e => e.errors || []), warnings: entries.flatMap(e => e.warnings || []) } : null)
        }
      }
    })
    child.stdin.write(`${JSON.stringify({ id: 1, method: 'initialize', params: { clientInfo: { name: 'better-codex', version: '0' } } })}\n`)
  })
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  const answer = await ask(JSON.parse(process.argv[2]))
  process.stdout.write(JSON.stringify(answer))
  process.exit(0)
}
