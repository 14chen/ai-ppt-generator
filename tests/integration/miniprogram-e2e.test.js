/**
 * End-to-end test of the mini program's own client code (miniprogram/utils/api.js)
 * against the real backend, using a `wx` shim backed by Node's fetch.
 *
 * This is as close as we can get to running the mini program without WeChat
 * DevTools: the same SSE streaming path (`enableChunked` + `onChunkReceived`),
 * the same UTF-8 chunk decoding, the same /api/export/pptx download and the same
 * wx.openDocument hand-off are all exercised for real.
 */
import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import JSZip from 'jszip';
import { once } from 'node:events';
import { createApp } from '../../server/app.js';
import { config } from '../../server/config.js';
import { buildNdjsonLines, startMockUpstream } from '../helpers/mock-upstream.js';
import { createMiniProgramLoader, MINIPROGRAM_DIR } from '../helpers/miniprogram-loader.js';

const load = createMiniProgramLoader(MINIPROGRAM_DIR);

let app;
let server;
let mock;
let savedBaseUrl;
let savedKey;
let baseUrl;

const writes = [];
const opened = [];

/** A `wx` runtime whose network layer is a real fetch against the local server. */
function installFetchBackedWx() {
  globalThis.wx = {
    request(options) {
      const controller = new AbortController();
      const listeners = [];
      const task = {
        onChunkReceived(cb) {
          listeners.push(cb);
        },
        abort() {
          controller.abort();
        }
      };

      const run = async () => {
        try {
          const isBinary = options.responseType === 'arraybuffer';
          const res = await fetch(options.url, {
            method: options.method || 'GET',
            headers: options.header,
            body: options.data === undefined ? undefined : JSON.stringify(options.data),
            signal: controller.signal
          });
          if (options.onHeadersReceived) options.onHeadersReceived({ statusCode: res.status, header: {} });

          if (isBinary) {
            const buf = Buffer.from(await res.arrayBuffer());
            options.success({
              statusCode: res.status,
              data: buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength)
            });
            return;
          }

          // Stream the body as chunks, exactly like enableChunked does.
          for await (const chunk of res.body) {
            const view = chunk instanceof Uint8Array ? chunk : new Uint8Array(chunk);
            const ab = view.buffer.slice(view.byteOffset, view.byteOffset + view.byteLength);
            for (const cb of listeners) cb({ data: ab });
          }
          options.success({ statusCode: res.status, data: undefined });
        } catch (err) {
          if (options.fail) options.fail({ errMsg: err && err.message ? err.message : String(err) });
        }
      };
      run();
      return task;
    },
    env: { USER_DATA_PATH: 'C:\\Temp\\miniprogram-user-data' },
    getFileSystemManager() {
      return {
        writeFile({ filePath, data, success }) {
          writes.push({ filePath, data });
          if (success) success();
        }
      };
    },
    openDocument({ filePath, fileType, showMenu, success }) {
      opened.push({ filePath, fileType, showMenu });
      if (success) success();
    },
    showToast() {},
    showLoading() {},
    hideLoading() {},
    showModal() {},
    getStorageSync() {
      return '';
    },
    setStorageSync() {}
  };
}

before(async () => {
  mock = await startMockUpstream({ delayMs: 4 });
  savedBaseUrl = config.baseUrl;
  savedKey = config.apiKey;
  config.baseUrl = mock.baseUrl;
  config.apiKey = 'mini-test-key';

  app = await createApp({ dev: false });
  server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  baseUrl = `http://127.0.0.1:${server.address().port}`;

  // Point the mini program config at this test server BEFORE api.js is loaded
  // (api.js destructures API_BASE at require time).
  const miniConfig = load('config.js');
  miniConfig.API_BASE = baseUrl;

  installFetchBackedWx();
});

after(async () => {
  config.baseUrl = savedBaseUrl;
  config.apiKey = savedKey;
  delete globalThis.wx;
  await new Promise((resolve) => server.close(resolve));
  await mock.close();
});

test('mini program: streamGenerate talks to the real SSE endpoint', { timeout: 60000 }, async () => {
  const api = load('utils/api.js');
  const events = [];
  const order = [];
  let error = null;

  await new Promise((resolve) => {
    api.streamGenerate({
      text: '这是一段足够长的测试文案，用来验证小程序端的流式生成链路是否完整可用，包含中文字符与标点。',
      settings: { targetSlides: 6, language: 'zh', theme: 'forest' },
      onEvent: (ev) => {
        events.push(ev);
        if (ev.event === 'slide') order.push(events.filter((e) => e.event !== 'slide').length);
      },
      onError: (e) => {
        error = e;
      },
      onComplete: resolve
    });
  });

  assert.equal(error, null, `unexpected error: ${error && error.message}`);
  const names = events.map((e) => e.event);
  assert.equal(names[0], 'status');
  assert.ok(names.includes('meta'), 'no meta event');
  const slides = events.filter((e) => e.event === 'slide');
  assert.ok(slides.length >= 4, `expected >= 4 slides, got ${slides.length}`);
  assert.ok(names.includes('progress'), 'no progress events');
  assert.ok(names.includes('done'), 'no done event');

  // Streaming, not a single blob: slides must arrive interleaved with progress
  // events rather than all at the very end.
  const firstSlideIndex = names.indexOf('slide');
  assert.ok(firstSlideIndex < names.length - 1, 'slide events arrived only at the end');

  const deck = events.find((e) => e.event === 'done').data.deck;
  assert.ok(deck.slides.length >= 4);
  assert.equal(deck.theme, 'forest');
  assert.equal(deck.slides[0].layout, 'cover');
  assert.ok(deck.slides[deck.slides.length - 1].layout === 'closing');
  // CJK survived the manual UTF-8 decoding across chunk boundaries.
  assert.ok(JSON.stringify(deck).includes(deck.title), 'CJK text was mangled');
});

test('mini program: partial UTF-8 sequences survive a slow, fragmented stream', { timeout: 60000 }, async () => {
  // A deck whose titles are dense CJK, delivered in tiny delayed chunks, so
  // multi-byte characters are guaranteed to be split across chunk boundaries.
  const fragments = buildNdjsonLines({ slides: 6, title: '中文标题压力测试：季度复盘与行动建议' });
  const slow = await startMockUpstream({ fragments, splitMidToken: true, delayMs: 3 });
  const saved = config.baseUrl;
  config.baseUrl = slow.baseUrl;
  try {
    const api = load('utils/api.js');
    const events = [];
    await new Promise((resolve) => {
      api.streamGenerate({
        text: '中文压力测试文案，长度足够通过校验，用来验证跨分块的多字节字符解码是否正确。',
        settings: {},
        onEvent: (e) => events.push(e),
        onError: (e) => assert.fail(`error: ${e.message}`),
        onComplete: resolve
      });
    });
    const deck = events.find((e) => e.event === 'done').data.deck;
    assert.ok(deck.title.includes('中文标题压力测试'), `title was corrupted: ${deck.title}`);
    const bullets = deck.slides.flatMap((s) => s.bullets || []);
    assert.ok(bullets.length > 0);
    for (const b of bullets) {
      assert.ok(!b.includes('\uFFFD'), `replacement character in "${b}" — decoding failed`);
    }
  } finally {
    config.baseUrl = saved;
    await slow.close();
  }
});

test('mini program: exportPptx downloads a real .pptx and hands it to openDocument', { timeout: 60000 }, async () => {
  const api = load('utils/api.js');
  const deck = {
    title: '小程序导出验收',
    theme: 'neon',
    slides: [
      { layout: 'cover', title: '小程序导出验收', subtitle: 'pptx via wx.request' },
      { layout: 'bullets', title: '要点', bullets: ['中文正常', '主题正确'] },
      { layout: 'closing', title: '谢谢观看' }
    ]
  };

  writes.length = 0;
  opened.length = 0;

  const filePath = await api.exportPptx(deck, 'neon');
  assert.match(filePath, /\.pptx$/, 'file path must end with .pptx');
  assert.match(filePath, /USER_DATA_PATH|miniprogram-user-data/, 'must be written into the user data dir');
  assert.equal(writes.length, 1, 'exactly one file write expected');
  assert.equal(writes[0].filePath, filePath);

  const buffer = Buffer.from(writes[0].data);
  assert.equal(buffer.subarray(0, 2).toString('latin1'), 'PK', 'not a zip/pptx');
  const zip = await JSZip.loadAsync(buffer);
  const slides = Object.keys(zip.files).filter((n) => /^ppt\/slides\/slide\d+\.xml$/.test(n));
  assert.equal(slides.length, deck.slides.length);
  const xml = await zip.file('ppt/slides/slide1.xml').async('string');
  assert.ok(xml.includes('小程序导出验收'), 'title missing from the pptx');

  await api.openPptx(filePath);
  assert.equal(opened.length, 1);
  assert.equal(opened[0].fileType, 'pptx', 'openDocument must be told it is a pptx');
  assert.equal(opened[0].showMenu, true, 'showMenu lets the user forward the file');
});

test('mini program: a bad export payload surfaces the server error message', { timeout: 60000 }, async () => {
  const api = load('utils/api.js');
  await assert.rejects(() => api.exportPptx({ slides: [] }, 'paper'), /缺少有效的 deck/);
});
