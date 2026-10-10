/** Typed-ish error carrying a machine readable code for the API layer. */
export class AppError extends Error {
  constructor(code, message, status = 500, details) {
    super(message);
    this.name = 'AppError';
    this.code = code;
    this.status = status;
    if (details) this.details = details;
  }
}

/**
 * Streaming client for any OpenAI-compatible /chat/completions endpoint
 * (here: https://api.deepseek.com/v1 with deepseek-v4-pro).
 *
 * Async generator yielding:
 *   { type: 'reasoning', text }   -- deepseek-v4-pro streams chain-of-thought first
 *   { type: 'content',   text }   -- the actual answer (NDJSON slides)
 *   { type: 'usage',     usage }  -- token accounting (stream_options.include_usage)
 *   { type: 'finish',    reason }
 *
 * @param {object} params
 * @param {Array<{role:string,content:string}>} params.messages
 * @param {AbortSignal} [params.signal]
 */
export async function* streamChatCompletion({ config, messages, signal, temperature, maxTokens, effort }) {
  if (!config.apiKey) {
    throw new AppError(
      'NO_API_KEY',
      '未配置 DEEPSEEK_API_KEY，请在项目根目录的 .env 中填写后重启服务。',
      503
    );
  }

  const url = `${config.baseUrl}/chat/completions`;
  const controller = new AbortController();
  const signals = [controller.signal];
  if (signal) signals.push(signal);
  const combined = typeof AbortSignal.any === 'function' ? AbortSignal.any(signals) : controller.signal;

  const payload = {
    model: config.model,
    messages,
    stream: true,
    stream_options: { include_usage: true },
    temperature: temperature ?? config.temperature,
    max_tokens: maxTokens ?? config.maxTokens
  };
  const wantEffort = effort ?? config.effort;
  if (wantEffort) payload.reasoning_effort = wantEffort;

  // Combined guard: total request budget + "no bytes for N seconds" idle guard.
  let idleTimer = null;
  let timedOut = null;
  const armIdle = () => {
    clearTimeout(idleTimer);
    idleTimer = setTimeout(() => {
      timedOut = 'idle';
      controller.abort();
    }, config.idleTimeoutMs);
  };
  const totalTimer = setTimeout(() => {
    timedOut = 'total';
    controller.abort();
  }, config.requestTimeoutMs);
  armIdle();

  let res;
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'text/event-stream',
        Authorization: `Bearer ${config.apiKey}`
      },
      body: JSON.stringify(payload),
      signal: combined
    });
  } catch (err) {
    clearTimeout(idleTimer);
    clearTimeout(totalTimer);
    if (timedOut) throw new AppError('UPSTREAM_TIMEOUT', timeoutMessage(timedOut, config), 504);
    if (signal?.aborted) return;
    throw new AppError('UPSTREAM_UNREACHABLE', `无法连接 AI 服务：${err.message}`, 502);
  }

  if (!res.ok) {
    clearTimeout(idleTimer);
    clearTimeout(totalTimer);
    const raw = await res.text().catch(() => '');
    let detail = raw;
    try {
      detail = JSON.parse(raw)?.error?.message || raw;
    } catch {
      /* keep raw text */
    }
    const code = res.status === 401 || res.status === 403 ? 'UPSTREAM_AUTH' : 'UPSTREAM_ERROR';
    throw new AppError(code, `AI 服务返回 ${res.status}：${String(detail).slice(0, 400)}`, res.status);
  }

  if (!res.body) {
    clearTimeout(idleTimer);
    clearTimeout(totalTimer);
    throw new AppError('UPSTREAM_ERROR', 'AI 服务未返回流式响应体。', 502);
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  try {
    while (true) {
      let chunk;
      try {
        chunk = await reader.read();
      } catch (err) {
        if (timedOut) throw new AppError('UPSTREAM_TIMEOUT', timeoutMessage(timedOut, config), 504);
        if (signal?.aborted) return;
        throw new AppError('UPSTREAM_STREAM_ERROR', `读取 AI 响应失败：${err.message}`, 502);
      }
      if (chunk.done) break;
      armIdle();
      buffer += decoder.decode(chunk.value, { stream: true });

      let nl;
      while ((nl = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, nl).replace(/\r$/, '');
        buffer = buffer.slice(nl + 1);
        if (!line || line.startsWith(':')) continue; // comment / heartbeat
        if (!line.startsWith('data:')) continue;
        const data = line.slice(5).trim();
        if (!data || data === '[DONE]') continue;

        let json;
        try {
          json = JSON.parse(data);
        } catch {
          continue;
        }
        if (json.error) {
          throw new AppError('UPSTREAM_ERROR', `AI 服务错误：${json.error.message || 'unknown'}`, 502);
        }
        const choice = json.choices?.[0];
        const delta = choice?.delta;
        if (delta?.reasoning_content) yield { type: 'reasoning', text: delta.reasoning_content };
        if (delta?.content) yield { type: 'content', text: delta.content };
        if (json.usage) yield { type: 'usage', usage: json.usage };
        if (choice?.finish_reason) yield { type: 'finish', reason: choice.finish_reason };
      }
    }
  } finally {
    clearTimeout(idleTimer);
    clearTimeout(totalTimer);
    // `cancel()` returns a promise: swallow its rejection, otherwise an aborted
    // client turns into an unhandled rejection that can take the process down.
    try {
      await reader.cancel();
    } catch {
      /* already closed or aborted */
    }
  }
}

function timeoutMessage(kind, config) {
  return kind === 'idle'
    ? `AI 服务 ${Math.round(config.idleTimeoutMs / 1000)} 秒内没有返回新数据，已中断。`
    : `生成超时（超过 ${Math.round(config.requestTimeoutMs / 1000)} 秒），已中断。`;
}
