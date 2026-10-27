import { closeSync, fstatSync, openSync, readSync } from 'node:fs'

// The last `bytes` of a file, starting at a line boundary.
export function readTail(file, bytes) {
  let fd
  try {
    fd = openSync(file, 'r')
    const { size } = fstatSync(fd)
    const start = Math.max(0, size - bytes)
    const buffer = Buffer.alloc(size - start)
    readSync(fd, buffer, 0, buffer.length, start)
    const text = buffer.toString('utf8')
    return start > 0 ? text.slice(text.indexOf('\n') + 1) : text
  } catch {
    return ''
  } finally {
    if (fd !== undefined) closeSync(fd)
  }
}

const limit = l =>
  l && typeof l.used_percent === 'number'
    ? { pct: Math.round(l.used_percent), windowMinutes: l.window_minutes ?? null, resetsAt: l.resets_at ? l.resets_at * 1000 : null }
    : null

export function toUsage(info, rate) {
  const last = info?.last_token_usage
  const window = info?.model_context_window
  const used = last ? (last.input_tokens || 0) + (last.output_tokens || 0) : null
  return {
    context: used != null && window ? { used, window, pct: Math.round((used / window) * 100) } : null,
    total: info?.total_token_usage ?? null,
    primary: limit(rate?.primary),
    secondary: limit(rate?.secondary),
    plan: rate?.plan_type ?? null
  }
}

// Latest token counts and rate limits in a Codex rollout (JSONL). The format is not a stable interface:
// anything unexpected gives null instead of an error.
export function usageFromText(text) {
  const lines = text.split('\n')
  let info = null
  let rate = null
  for (let i = lines.length - 1; i >= 0 && !(info && rate); i--) {
    const line = lines[i]
    if (!line.includes('"token_count"')) continue
    let payload
    try {
      payload = JSON.parse(line).payload
    } catch {
      continue
    }
    if (payload?.type !== 'token_count') continue
    info ??= payload.info ?? null
    rate ??= payload.rate_limits ?? null
  }
  return info || rate ? toUsage(info, rate) : null
}

export function readUsage(file) {
  if (!file) return null
  for (const bytes of [1 << 20, 16 << 20]) {
    const usage = usageFromText(readTail(file, bytes))
    if (usage?.context || usage?.primary) return usage
  }
  return null
}
