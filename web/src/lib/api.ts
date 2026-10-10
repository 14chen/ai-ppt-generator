import type { GenerateOptions, StreamHandlers } from '../types';

/**
 * POST /api/generate and consume the SSE response with fetch + ReadableStream
 * (EventSource cannot POST, and we need an AbortController for cancellation).
 */
export async function streamGenerate(
  text: string,
  options: GenerateOptions,
  handlers: StreamHandlers,
  signal: AbortSignal
): Promise<void> {
  let res: Response;
  try {
    res = await fetch('/api/generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text, options }),
      signal
    });
  } catch (err) {
    if (signal.aborted) return;
    throw new Error(`无法连接后端服务：${(err as Error).message}`);
  }

  if (!res.ok) {
    let message = `请求失败（HTTP ${res.status}）`;
    try {
      const data = await res.json();
      message = data?.error?.message ?? message;
    } catch {
      /* response was not JSON */
    }
    const error = new Error(message) as Error & { code?: string; status?: number };
    error.status = res.status;
    if (res.status === 401) error.code = 'ACCESS_REQUIRED';
    throw error;
  }
  if (!res.body) throw new Error('当前浏览器不支持流式响应（ReadableStream）。');

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      buffer = buffer.replace(/\r\n/g, '\n');
      let sep: number;
      while ((sep = buffer.indexOf('\n\n')) >= 0) {
        const raw = buffer.slice(0, sep);
        buffer = buffer.slice(sep + 2);
        dispatch(raw, handlers);
      }
    }
    if (buffer.trim()) dispatch(buffer, handlers);
  } catch (err) {
    if (signal.aborted) return;
    throw new Error(`接收流式数据时中断：${(err as Error).message}`);
  } finally {
    try {
      reader.releaseLock();
    } catch {
      /* ignore */
    }
  }
}

function dispatch(raw: string, handlers: StreamHandlers) {
  let event = 'message';
  const dataLines: string[] = [];
  for (const line of raw.split('\n')) {
    if (!line || line.startsWith(':')) continue;
    if (line.startsWith('event:')) event = line.slice(6).trim();
    else if (line.startsWith('data:')) dataLines.push(line.slice(5).replace(/^ /, ''));
  }
  if (!dataLines.length) return;
  let payload: any;
  try {
    payload = JSON.parse(dataLines.join('\n'));
  } catch {
    return;
  }
  switch (event) {
    case 'status':
      handlers.onStatus?.(payload);
      break;
    case 'meta':
      handlers.onMeta?.(payload);
      break;
    case 'slide':
      handlers.onSlide?.(payload);
      break;
    case 'progress':
      handlers.onProgress?.(payload);
      break;
    case 'reasoning':
      handlers.onReasoning?.(payload);
      break;
    case 'raw':
      handlers.onRaw?.(payload);
      break;
    case 'usage':
      handlers.onUsage?.(payload);
      break;
    case 'done':
      handlers.onDone?.(payload);
      break;
    case 'error':
      handlers.onError?.(payload);
      break;
    default:
      break;
  }
}
