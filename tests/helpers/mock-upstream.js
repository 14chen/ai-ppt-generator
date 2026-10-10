import http from 'node:http';

/**
 * A minimal OpenAI-compatible streaming endpoint used by the test suite so that
 * integration/E2E runs are deterministic and never hit the real API.
 */

export function buildNdjsonLines({ slides = 6, title = '模拟演示：季度业务复盘', text = '' } = {}) {
  const lines = [
    JSON.stringify({ type: 'meta', title, subtitle: '由 mock 上游生成', slideCount: slides })
  ];
  lines.push(JSON.stringify({ layout: 'cover', title, subtitle: '2024 年度复盘与下一步计划' }));
  const plans = [
    { layout: 'bullets', title: '本期关键结论', bullets: ['收入同比增长 32%', '获客成本下降 18%', '续费率提升到 91%'] },
    { layout: 'stats', title: '核心指标', stats: [{ value: '32%', label: '收入同比' }, { value: '91%', label: '续费率' }] },
    {
      layout: 'two-column',
      title: '优势与挑战',
      columns: [
        { heading: '优势', items: ['产品口碑领先', '交付效率高'] },
        { heading: '挑战', items: ['渠道覆盖不足', '人才结构单一'] }
      ]
    },
    { layout: 'timeline', title: '下一步节奏', steps: [{ title: 'Q1', detail: '补齐渠道' }, { title: 'Q2', detail: '扩张团队' }] },
    { layout: 'quote', title: '', quote: { text: '增长来自复利，而不是爆发。', author: '内部复盘' } }
  ];
  for (const p of plans) {
    if (lines.length >= slides - 1) break;
    lines.push(JSON.stringify(p));
  }
  lines.push(JSON.stringify({ layout: 'closing', title: '谢谢观看', subtitle: text ? '感谢阅读' : '欢迎提问' }));
  return lines;
}

export function buildXssLines() {
  return [
    JSON.stringify({ type: 'meta', title: '<img src=x onerror="window.__XSS__=1">危险标题', slideCount: 3 }),
    JSON.stringify({
      layout: 'cover',
      title: '<script>window.__XSS__ = 1;<\/script>封面',
      subtitle: '<b>加粗</b> 与 & 符号'
    }),
    JSON.stringify({
      layout: 'bullets',
      title: '转义检查',
      bullets: ['<img src=x onerror="window.__XSS__=2">', '"引号" 与 \'单引号\'', '</section><script>window.__XSS__=3<\/script>']
    }),
    JSON.stringify({ layout: 'closing', title: '结束' })
  ];
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * @param {object} [options]
 * @param {string[]} [options.fragments] raw content deltas (defaults to NDJSON lines)
 * @param {boolean} [options.splitMidToken] split each fragment into 2 pieces to
 *   exercise the incremental brace scanner
 * @param {boolean} [options.scenarioFromBody] pick a canned deck based on the
 *   user text in the request body (used by the browser E2E suite)
 * @param {string} [options.reasoning]
 * @param {number} [options.status]
 * @param {object} [options.errorBody]
 * @param {number} [options.delayMs]
 * @param {number} [options.port] fixed port (0 = ephemeral)
 */
export async function startMockUpstream(options = {}) {
  const {
    fragments,
    splitMidToken = true,
    scenarioFromBody = false,
    reasoning = '先读一遍文案，再规划页面结构。',
    status = 200,
    errorBody = { error: { message: 'mock upstream failure' } },
    delayMs = 0,
    port = 0,
    usage = { prompt_tokens: 120, completion_tokens: 340, total_tokens: 460 }
  } = options;

  const server = http.createServer(async (req, res) => {
    if (req.url && req.url.startsWith('/health')) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end('{"ok":true,"mock":true}');
      return;
    }
    if (!req.url || !req.url.includes('/chat/completions')) {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end('{"error":{"message":"not found"}}');
      return;
    }

    let rawBody = '';
    for await (const chunk of req) rawBody += chunk;

    let lines = fragments;
    if (!lines && scenarioFromBody) {
      lines = rawBody.includes('XSS') ? buildXssLines() : buildNdjsonLines({});
    }
    if (!lines) lines = buildNdjsonLines({});

    const pieces = splitMidToken
      ? lines.flatMap((l) => [l.slice(0, Math.max(1, Math.floor(l.length / 2))), l.slice(Math.max(1, Math.floor(l.length / 2))) + '\n'])
      : lines.map((l) => `${l}\n`);

    if (status !== 200) {
      res.writeHead(status, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(errorBody));
      return;
    }

    res.writeHead(200, { 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-cache' });
    const send = (payload) => res.write(`data: ${JSON.stringify(payload)}\n\n`);

    send({ choices: [{ index: 0, delta: { role: 'assistant', content: null, reasoning_content: '' } }] });
    for (const piece of reasoning.match(/.{1,6}/g) ?? []) {
      send({ choices: [{ index: 0, delta: { reasoning_content: piece } }] });
      if (delayMs) await sleep(delayMs);
    }
    for (const piece of pieces) {
      send({ choices: [{ index: 0, delta: { content: piece } }] });
      if (delayMs) await sleep(delayMs);
    }
    send({ choices: [{ index: 0, delta: {}, finish_reason: 'stop' }], usage });
    res.write('data: [DONE]\n\n');
    res.end();
  });

  await new Promise((resolve) => server.listen(port, '127.0.0.1', resolve));
  const address = server.address();

  return {
    server,
    port: address.port,
    url: `http://127.0.0.1:${address.port}`,
    baseUrl: `http://127.0.0.1:${address.port}/v1`,
    close: () => new Promise((resolve) => server.close(resolve))
  };
}

/** Read an SSE response fully and return [{event, data}]. */
export async function collectSse(response) {
  const events = [];
  const decoder = new TextDecoder();
  let buffer = '';
  for await (const chunk of response.body) {
    buffer += decoder.decode(chunk, { stream: true });
    buffer = buffer.replace(/\r\n/g, '\n');
    let sep;
    while ((sep = buffer.indexOf('\n\n')) >= 0) {
      const raw = buffer.slice(0, sep);
      buffer = buffer.slice(sep + 2);
      let event = 'message';
      const data = [];
      for (const line of raw.split('\n')) {
        if (line.startsWith('event:')) event = line.slice(6).trim();
        else if (line.startsWith('data:')) data.push(line.slice(5).trim());
      }
      if (!data.length) continue;
      try {
        events.push({ event, data: JSON.parse(data.join('\n')) });
      } catch {
        events.push({ event, data: null });
      }
    }
  }
  return events;
}
