import test from 'node:test';
import assert from 'node:assert/strict';
import { chunkBytes, createMiniProgramLoader, encodeUtf8, MINIPROGRAM_DIR } from '../helpers/miniprogram-loader.js';

const load = createMiniProgramLoader(MINIPROGRAM_DIR);
const { createUtf8Decoder } = load('utils/utf8.js');
const { createSseParser } = load('utils/sse.js');
const { formatMs, layoutLabel, pad2, fitScale } = load('utils/format.js');

/* --------------------------------------------------------------- UTF-8 ---- */

test('utf8: decodes CJK delivered one byte at a time', () => {
  const decoder = createUtf8Decoder();
  const text = '中文字符串测试 · English 123';
  let out = '';
  for (const chunk of chunkBytes(text, 1)) out += decoder.decode(chunk);
  assert.equal(out, text);
  assert.equal(decoder.pendingLength(), 0);
});

test('utf8: survives arbitrary chunk boundaries (every size 1..17)', () => {
  const text = '季度复盘：收入同比增长 32%，续费率 91% 🎉 emoji 也要正确';
  for (let size = 1; size <= 17; size += 1) {
    const decoder = createUtf8Decoder();
    let out = '';
    for (const chunk of chunkBytes(text, size)) out += decoder.decode(chunk);
    assert.equal(out, text, `chunk size ${size} corrupted the text`);
  }
});

test('utf8: keeps an incomplete trailing sequence for the next chunk', () => {
  const decoder = createUtf8Decoder();
  const bytes = new Uint8Array(new TextEncoder().encode('中文'));
  // first chunk = the first 4 bytes: 中 (3 bytes) + 1 byte of 文
  // (.slice copies into its own buffer — .subarray would share the whole buffer)
  const first = decoder.decode(bytes.slice(0, 4).buffer);
  assert.equal(first, '中');
  assert.equal(decoder.pendingLength(), 1);
  const second = decoder.decode(bytes.slice(4).buffer);
  assert.equal(second, '文');
  assert.equal(decoder.pendingLength(), 0);
});

test('utf8: respects a typed-array view window (byteOffset/byteLength)', () => {
  const decoder = createUtf8Decoder();
  const full = new TextEncoder().encode('AAA中文BBB');
  // a view over just the CJK bytes
  assert.equal(decoder.decode(full.subarray(3, 9)), '中文');
  // and a view-like object from another realm (not instanceof Uint8Array here)
  const foreign = { buffer: full.buffer, byteOffset: 3, byteLength: 6 };
  assert.equal(decoder.decode(foreign), '中文');
});

test('utf8: 4-byte code points become surrogate pairs', () => {
  const decoder = createUtf8Decoder();
  let out = '';
  for (const chunk of chunkBytes('🎉🚀', 1)) out += decoder.decode(chunk);
  assert.equal(out, '🎉🚀');
  assert.equal(out.length, 4); // two surrogate pairs
});

test('utf8: accepts ArrayBuffer, Uint8Array and strings', () => {
  const decoder = createUtf8Decoder();
  assert.equal(decoder.decode(encodeUtf8('ab')), 'ab');
  assert.equal(decoder.decode(new Uint8Array([99])), 'c');
  assert.equal(decoder.decode('plain'), 'plain');
  assert.equal(decoder.decode(undefined), '');
});

/* ----------------------------------------------------------------- SSE ---- */

test('sse: parses event/data frames', () => {
  const parser = createSseParser();
  const events = parser.push('event: slide\ndata: {"index":0}\n\nevent: done\ndata: {"ok":true}\n\n');
  assert.equal(events.length, 2);
  assert.equal(events[0].event, 'slide');
  assert.deepEqual(events[0].data, { index: 0 });
  assert.equal(events[1].event, 'done');
  assert.deepEqual(events[1].data, { ok: true });
});

test('sse: buffers partial frames across chunks', () => {
  const parser = createSseParser();
  assert.equal(parser.push('event: sli').length, 0);
  assert.equal(parser.push('de\ndata: {"a"').length, 0);
  const events = parser.push(':1}\n\n');
  assert.equal(events.length, 1);
  assert.equal(events[0].event, 'slide');
  assert.deepEqual(events[0].data, { a: 1 });
});

test('sse: ignores heartbeat comments and empty frames', () => {
  const parser = createSseParser();
  assert.equal(parser.push(': ping\n\n\n\n').length, 0);
  const events = parser.push('data: [1]\n\n');
  assert.equal(events.length, 1);
  assert.deepEqual(events[0].data, [1]);
  assert.equal(events[0].event, 'message');
});

test('sse: handles CRLF, multi-line data and malformed JSON', () => {
  const parser = createSseParser();
  const events = parser.push('event: meta\r\ndata: {"a":1,\r\ndata: "b":2}\r\n\r\n');
  assert.equal(events.length, 1);
  assert.deepEqual(events[0].data, { a: 1, b: 2 });
  assert.equal(parser.push('event: x\ndata: {not json}\n\n').length, 0);
});

/* -------------------------------------------------------------- format ---- */

test('format: helpers behave', () => {
  assert.equal(pad2(3), '03');
  assert.equal(pad2(12), '12');
  assert.equal(formatMs(0), '0s');
  assert.equal(formatMs(9500), '10s');
  assert.equal(formatMs(65000), '1m05s');
  assert.equal(layoutLabel('two-column'), '两栏');
  assert.equal(layoutLabel('unknown'), 'unknown');
});

test('format: fitScale keeps the 16:9 canvas inside the viewport', () => {
  const designW = 1280;
  const designH = 720;
  const cases = [
    { viewW: 375, viewH: 667 },
    { viewW: 414, viewH: 896 },
    { viewW: 812, viewH: 375 },
    { viewW: 768, viewH: 1024 }
  ];
  for (const c of cases) {
    const k = fitScale({ designW, designH, viewW: c.viewW, viewH: c.viewH - 120 });
    const canvasW = (designW / 750) * c.viewW * k;
    const canvasH = (designH / 750) * c.viewW * k;
    assert.ok(canvasW <= c.viewW + 0.5, `width overflows at ${c.viewW}x${c.viewH}: ${canvasW}`);
    assert.ok(canvasH <= c.viewH - 120 + 0.5, `height overflows at ${c.viewW}x${c.viewH}: ${canvasH}`);
    assert.ok(k > 0 && k <= 1);
  }
});

/* ------------------------------------------- api.streamGenerate (fake wx) -- */

/** Build the fake `wx` runtime the mini program expects. */
function installFakeWx({ chunks, statusCode = 200, supportsChunked = true, fullBody = '' }) {
  const calls = [];
  globalThis.wx = {
    request(options) {
      calls.push(options);
      const task = {
        _cb: null,
        onChunkReceived(cb) {
          this._cb = cb;
        },
        abort() {
          this.aborted = true;
        }
      };
      setTimeout(() => {
        if (options.onHeadersReceived) options.onHeadersReceived({ statusCode, header: {} });
        if (supportsChunked && typeof task._cb === 'function') {
          for (const chunk of chunks) task._cb({ data: chunk });
        }
        options.success({ statusCode, data: supportsChunked ? undefined : fullBody });
      }, 0);
      return task;
    },
    showToast() {},
    setStorageSync() {},
    getStorageSync() {
      return '';
    }
  };
  return { calls, cleanup: () => delete globalThis.wx };
}

test('api: streamGenerate reassembles SSE chunks split mid-character', async () => {
  const sseText =
    'event: status\ndata: {"stage":"connecting","message":"正在连接"}\n\n' +
    'event: meta\ndata: {"meta":{"title":"季度复盘","slideCount":2}}\n\n' +
    'event: slide\ndata: {"index":0,"slide":{"layout":"cover","title":"封面标题"}}\n\n' +
    'event: progress\ndata: {"slides":1,"total":2,"contentChars":88}\n\n' +
    'event: done\ndata: {"deck":{"title":"季度复盘","slides":[{},{}]}}\n\n';
  const { cleanup, calls } = installFakeWx({ chunks: chunkBytes(sseText, 5) });
  const api = load('utils/api.js');

  const events = [];
  let error = null;
  await new Promise((resolve) => {
    api.streamGenerate({
      text: '一段足够长的文案内容用于测试流式解析',
      settings: { targetSlides: 2 },
      onEvent: (e) => events.push(e),
      onError: (e) => {
        error = e;
      },
      onComplete: resolve
    });
  });
  cleanup();

  assert.equal(error, null);
  assert.deepEqual(
    events.map((e) => e.event),
    ['status', 'meta', 'slide', 'progress', 'done']
  );
  assert.equal(events[1].data.meta.title, '季度复盘');
  assert.equal(events[2].data.slide.title, '封面标题');
  assert.equal(events[4].data.deck.title, '季度复盘');
  assert.equal(calls[0].url.endsWith('/api/generate'), true);
  assert.equal(calls[0].enableChunked, true);
  assert.equal(calls[0].method, 'POST');
});

test('api: streamGenerate reports HTTP errors using the JSON body', async () => {
  const body = JSON.stringify({ error: { code: 'TEXT_TOO_SHORT', message: '文案太短了，至少需要 20 个字符。' } });
  const { cleanup } = installFakeWx({ chunks: chunkBytes(body, 4), statusCode: 400 });
  const api = load('utils/api.js');

  let error = null;
  await new Promise((resolve) => {
    api.streamGenerate({
      text: 'x',
      settings: {},
      onEvent: () => {},
      onError: (e) => {
        error = e;
      },
      onComplete: resolve
    });
  });
  cleanup();

  assert.ok(error, 'expected an error');
  assert.match(error.message, /文案太短/);
});

test('api: falls back to a one-shot response when onChunkReceived is missing', async () => {
  const sseText = 'event: status\ndata: {"stage":"connecting","message":"hi"}\n\nevent: done\ndata: {"deck":{"slides":[]}}\n\n';
  const { cleanup } = installFakeWx({ chunks: [], supportsChunked: false, fullBody: sseText });
  const api = load('utils/api.js');

  const events = [];
  await new Promise((resolve) => {
    api.streamGenerate({ text: 'x', settings: {}, onEvent: (e) => events.push(e), onError: () => {}, onComplete: resolve });
  });
  cleanup();

  assert.deepEqual(
    events.map((e) => e.event),
    ['status', 'done']
  );
});
