import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createApp } from '../../server/app.js';
import { config } from '../../server/config.js';
import { buildNdjsonLines, collectSse, startMockUpstream } from '../helpers/mock-upstream.js';

const LONG_TEXT =
  '这是一段用于测试的文案，内容足够长，能够通过后端的最小长度校验。它描述了一个季度复盘：收入同比增长百分之三十二，' +
  '获客成本下降百分之十八，续费率提升到百分之九十一。下一步要补齐渠道覆盖，并在第二季度扩张团队。';

let mock;
let server;
let base;
let realBaseUrl;
let realApiKey;

before(async () => {
  mock = await startMockUpstream({ delayMs: 1 });
  realBaseUrl = config.baseUrl;
  realApiKey = config.apiKey;
  config.baseUrl = mock.baseUrl;
  config.apiKey = 'test-key';

  const app = await createApp({ dev: false });
  server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  base = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  config.baseUrl = realBaseUrl;
  config.apiKey = realApiKey;
  await new Promise((resolve) => server.close(resolve));
  await mock.close();
});

async function generate(body, init = {}) {
  return fetch(`${base}/api/generate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    ...init
  });
}

test('GET /api/health reports model and key status', async () => {
  const res = await fetch(`${base}/api/health`);
  assert.equal(res.status, 200);
  const data = await res.json();
  assert.equal(data.ok, true);
  assert.equal(data.model, config.model);
  assert.equal(data.hasApiKey, true);
});

test('POST /api/generate streams status → meta → slide → progress → done', async () => {
  const res = await generate({ text: LONG_TEXT, options: { targetSlides: 8, theme: 'forest' } });
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-type') ?? '', /text\/event-stream/);

  const events = await collectSse(res);
  const names = events.map((e) => e.event);

  assert.equal(names[0], 'status');
  assert.ok(names.includes('meta'), 'expected a meta event');
  assert.ok(names.includes('slide'), 'expected slide events');
  assert.ok(names.includes('progress'), 'expected progress events');
  assert.ok(names.includes('usage'), 'expected a usage event');
  assert.equal(names[names.length - 1], 'done', 'done must be the final event');

  const slides = events.filter((e) => e.event === 'slide');
  assert.ok(slides.length >= 5, `expected >= 5 slides, got ${slides.length}`);
  assert.deepEqual(
    slides.map((e) => e.data.index),
    slides.map((_, i) => i),
    'slide indices must be sequential'
  );

  const meta = events.find((e) => e.event === 'meta');
  assert.equal(meta.data.meta.slideCount, 6);

  const progress = events.filter((e) => e.event === 'progress');
  const last = progress[progress.length - 1];
  assert.ok(last.data.slides >= 5, 'progress must count parsed slides');
  assert.ok(last.data.total === 6, 'progress must expose the declared page count');

  const done = events.find((e) => e.event === 'done');
  assert.equal(done.data.deck.theme, 'forest');
  assert.equal(done.data.deck.slides[0].layout, 'cover');
  assert.equal(done.data.deck.slides[done.data.deck.slides.length - 1].layout, 'closing');
  assert.equal(done.data.deck.meta.model, config.model);
  assert.ok(done.data.deck.meta.usage.total_tokens > 0);
});

test('reasoning tokens are streamed separately from slide content', async () => {
  const res = await generate({ text: LONG_TEXT });
  const events = await collectSse(res);
  const reasoning = events.filter((e) => e.event === 'reasoning').map((e) => e.data.text).join('');
  assert.ok(reasoning.includes('规划页面结构'), 'reasoning text should be relayed');

  const raw = events.filter((e) => e.event === 'raw').map((e) => e.data.text).join('');
  assert.ok(raw.includes('"layout":"cover"'), 'raw content should be relayed');

  // The reasoning stream must never leak into the parsed deck.
  const done = events.find((e) => e.event === 'done');
  assert.ok(!JSON.stringify(done.data.deck).includes('规划页面结构'));
});

test('validation: empty / too short / too long', async () => {
  let res = await generate({ text: '' });
  assert.equal(res.status, 400);
  assert.equal((await res.json()).error.code, 'TEXT_REQUIRED');

  res = await generate({ text: '太短' });
  assert.equal(res.status, 400);
  assert.equal((await res.json()).error.code, 'TEXT_TOO_SHORT');

  res = await generate({ text: 'a'.repeat(config.maxChars + 10) });
  assert.equal(res.status, 413);
  assert.equal((await res.json()).error.code, 'TEXT_TOO_LONG');
});

test('responds 503 when no API key is configured', async () => {
  const saved = config.apiKey;
  config.apiKey = '';
  try {
    const res = await generate({ text: LONG_TEXT });
    assert.equal(res.status, 503);
    assert.equal((await res.json()).error.code, 'NO_API_KEY');
  } finally {
    config.apiKey = saved;
  }
});

test('unknown API routes return JSON 404 (not the SPA shell)', async () => {
  const res = await fetch(`${base}/api/does-not-exist`);
  assert.equal(res.status, 404);
  assert.equal((await res.json()).error.code, 'NOT_FOUND');
});

test('upstream auth errors surface as an error event', async () => {
  const bad = await startMockUpstream({ status: 401, errorBody: { error: { message: 'invalid api key' } } });
  const saved = config.baseUrl;
  config.baseUrl = bad.baseUrl;
  try {
    const res = await generate({ text: LONG_TEXT });
    assert.equal(res.status, 200, 'SSE headers are already sent at this point');
    const events = await collectSse(res);
    const err = events.find((e) => e.event === 'error');
    assert.ok(err, 'expected an error event');
    assert.equal(err.data.code, 'UPSTREAM_AUTH');
    assert.match(err.data.message, /invalid api key/);
    assert.ok(!events.some((e) => e.event === 'done'));
  } finally {
    config.baseUrl = saved;
    await bad.close();
  }
});

test('a client disconnect does not take the server down', async () => {
  const controller = new AbortController();
  const res = await generate({ text: LONG_TEXT }, { signal: controller.signal });
  const reader = res.body.getReader();
  await reader.read(); // first chunks
  controller.abort();
  try {
    await reader.cancel();
  } catch {
    /* expected */
  }

  // Give the server a moment to unwind the aborted upstream request.
  await new Promise((resolve) => setTimeout(resolve, 200));

  // The server must still answer a fresh request.
  const ok = await fetch(`${base}/api/health`);
  assert.equal(ok.status, 200);
  assert.equal((await ok.json()).ok, true);
});

test('a truncated upstream stream still yields the completed slides', async () => {
  const lines = buildNdjsonLines({ slides: 6 });
  const truncated = [...lines.slice(0, 4), '{"layout":"bullets","title":"没写完的一页","bullets":["x'];
  const partial = await startMockUpstream({ fragments: truncated, splitMidToken: false });
  const saved = config.baseUrl;
  config.baseUrl = partial.baseUrl;
  try {
    const res = await generate({ text: LONG_TEXT });
    const events = await collectSse(res);
    const done = events.find((e) => e.event === 'done');
    assert.ok(done, 'a deck should still be produced');
    assert.ok(!JSON.stringify(done.data.deck).includes('没写完的一页'));
    assert.ok(done.data.deck.slides.length >= 3);
  } finally {
    config.baseUrl = saved;
    await partial.close();
  }
});
