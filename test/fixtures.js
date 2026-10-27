// A Codex rollout in miniature: the event shapes seen in real ~/.codex/sessions files.
const line = (type, payload, ts = '2026-10-26T23:27:04.508Z') => JSON.stringify({ timestamp: ts, type, payload })

const tokenCount = (input, output, total, window = 258400, primary = 40, secondary = 10) =>
  line('event_msg', {
    type: 'token_count',
    info: {
      total_token_usage: { input_tokens: total, cached_input_tokens: Math.round(total * 0.9), output_tokens: 1000, reasoning_output_tokens: 300, total_tokens: total + 1000 },
      last_token_usage: { input_tokens: input, cached_input_tokens: 0, output_tokens: output, reasoning_output_tokens: 0, total_tokens: input + output },
      model_context_window: window
    },
    rate_limits: {
      primary: { used_percent: primary, window_minutes: 300, resets_at: 4102444800 },
      secondary: { used_percent: secondary, window_minutes: 10080, resets_at: 4102444800 },
      plan_type: 'plus'
    }
  })

export const ROLLOUT = [
  line('session_meta', { id: 's1', cwd: 'C:\\repo\\demo', source: 'vscode' }),
  line('turn_context', { model: 'gpt-test', effort: 'medium' }),
  line('event_msg', { type: 'task_started' }),
  line('response_item', { type: 'custom_tool_call', name: 'exec', input: 'x' }),
  line('response_item', { type: 'function_call', name: 'wait', arguments: '{}' }),
  line('response_item', { type: 'function_call', name: 'exec_command', arguments: '{}' }),
  tokenCount(50000, 500, 50000),
  tokenCount(50000, 500, 50000), // the same request reported twice
  line('event_msg', { type: 'task_complete' }),
  line('event_msg', { type: 'task_started' }),
  line('compacted', { message: '' }),
  tokenCount(200000, 1000, 250000, 258400, 80, 20),
  line('event_msg', { type: 'token_count', info: null, rate_limits: null })
].join('\n')
