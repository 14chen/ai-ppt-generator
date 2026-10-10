import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { once } from 'node:events';
import JSZip from 'jszip';
import jsQR from 'jsqr';
import { PNG } from 'pngjs';
import QRCode from 'qrcode';
import { createApp } from '../../server/app.js';
import { config } from '../../server/config.js';
import { allThemes } from '../../server/themes.js';

const DECK = {
  title: '导出接口验收',
  subtitle: 'pptx / 二维码',
  theme: 'sunrise',
  slides: [
    { layout: 'cover', title: '导出接口验收', subtitle: '服务端生成 pptx', bullets: ['验收用例'] },
    { layout: 'bullets', title: '检查项', bullets: ['PPTP 可被打开', '中文正常', '主题一致'] },
    { layout: 'stats', title: '数据', stats: [{ value: '99%', label: '通过率' }] },
    { layout: 'closing', title: '谢谢观看' }
  ]
};

let server;
let base;
let saved;

/** Fake WeChat open-platform API. */
async function startMockWeChat({ tokenOk = true, codeImage = null, codeFails = false } = {}) {
  const png = codeImage ?? (await QRCode.toBuffer('mock-miniprogram-code', { type: 'png', width: 200 }));
  const hits = [];
  const srv = http.createServer(async (req, res) => {
    hits.push(`${req.method} ${req.url.split('?')[0]}`);
    if (req.url.startsWith('/cgi-bin/token')) {
      if (!tokenOk) {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ errcode: 40013, errmsg: 'invalid appid' }));
        return;
      }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ access_token: 'mock-access-token', expires_in: 7200 }));
      return;
    }
    if (req.url.startsWith('/wxa/getwxacodeunlimit')) {
      if (codeFails) {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ errcode: 41030, errmsg: 'invalid page' }));
        return;
      }
      if (!req.url.includes('access_token=mock-access-token')) {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ errcode: 40001, errmsg: 'invalid credential' }));
        return;
      }
      for await (const _ of req) {
        /* drain body */
      }
      res.writeHead(200, { 'Content-Type': 'image/png' });
      res.end(png);
      return;
    }
    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end('{}');
  });
  await new Promise((resolve) => srv.listen(0, '127.0.0.1', resolve));
  return {
    url: `http://127.0.0.1:${srv.address().port}`,
    hits,
    close: () => new Promise((resolve) => srv.close(resolve))
  };
}

before(async () => {
  saved = { wxAppId: config.wxAppId, wxSecret: config.wxSecret, wxApiBase: config.wxApiBase, publicUrl: config.publicUrl };
  config.wxAppId = '';
  config.wxSecret = '';
  config.publicUrl = '';
  const app = await createApp({ dev: false });
  server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  base = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  Object.assign(config, saved);
  await new Promise((resolve) => server.close(resolve));
});

/* --------------------------------------------------------------- formats --- */

test('GET /api/export/formats lists html / pptx / json and the themes', async () => {
  const res = await fetch(`${base}/api/export/formats`);
  assert.equal(res.status, 200);
  const data = await res.json();
  const ids = data.formats.map((f) => f.id);
  assert.deepEqual(ids.sort(), ['html', 'json', 'pptx']);
  const pptx = data.formats.find((f) => f.id === 'pptx');
  assert.equal(pptx.clientSide, false);
  assert.match(pptx.mime, /presentationml\.presentation/);
  assert.deepEqual(data.themes, allThemes().map((t) => t.id));
});

test('GET /api/network reports a usable mini program base URL', async () => {
  const res = await fetch(`${base}/api/network`);
  assert.equal(res.status, 200);
  const data = await res.json();
  assert.match(data.lan, /^http:\/\/\d+\.\d+\.\d+\.\d+:\d+$/);
  assert.match(data.miniprogramApiBase, /^http:/);
  assert.ok(data.note.includes('HTTPS'));
});

/* ------------------------------------------------------------------ pptx --- */

test('POST /api/export/pptx returns a downloadable Office file', async () => {
  const res = await fetch(`${base}/api/export/pptx`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ deck: DECK, theme: 'sunrise' })
  });
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-type'), /presentationml\.presentation/);
  assert.equal(res.headers.get('x-slide-count'), String(DECK.slides.length));
  assert.equal(res.headers.get('x-theme'), 'sunrise');

  const disposition = res.headers.get('content-disposition');
  assert.match(disposition, /attachment/);
  assert.match(disposition, /filename\*=UTF-8''/);
  // The plain ASCII fallback must not degenerate into ".pptx"
  const plain = disposition.match(/filename="([^"]+)"/)[1];
  assert.ok(/^[A-Za-z0-9].*\.pptx$/.test(plain), `bad ascii filename fallback: ${plain}`);

  const buffer = Buffer.from(await res.arrayBuffer());
  assert.equal(buffer.subarray(0, 2).toString('latin1'), 'PK');
  const zip = await JSZip.loadAsync(buffer);
  const slides = Object.keys(zip.files).filter((n) => /^ppt\/slides\/slide\d+\.xml$/.test(n));
  assert.equal(slides.length, DECK.slides.length);
  const xml = await zip.file('ppt/slides/slide1.xml').async('string');
  assert.ok(xml.includes('导出接口验收'), 'deck title missing from the exported file');
});

test('POST /api/export/pptx applies the requested theme', async () => {
  const theme = allThemes().find((t) => t.id === 'neon');
  const res = await fetch(`${base}/api/export/pptx`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ deck: DECK, theme: 'neon' })
  });
  assert.equal(res.status, 200);
  const zip = await JSZip.loadAsync(Buffer.from(await res.arrayBuffer()));
  const xml = await zip.file('ppt/slides/slide1.xml').async('string');
  assert.ok(xml.toUpperCase().includes(theme.vars['ppt-accent'].replace('#', '').toUpperCase()));
});

test('POST /api/export/pptx rejects bad payloads with clear errors', async () => {
  let res = await fetch(`${base}/api/export/pptx`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({})
  });
  assert.equal(res.status, 400);
  assert.equal((await res.json()).error.code, 'DECK_REQUIRED');

  res = await fetch(`${base}/api/export/pptx`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ deck: { slides: [] } })
  });
  assert.equal(res.status, 400);

  const tooMany = { slides: Array.from({ length: config.maxSlides + 5 }, (_, i) => ({ layout: 'bullets', title: `页 ${i}`, bullets: ['x'] })) };
  res = await fetch(`${base}/api/export/pptx`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ deck: tooMany })
  });
  assert.equal(res.status, 413);
  assert.equal((await res.json()).error.code, 'TOO_MANY_SLIDES');
});

test('POST /api/export/pptx sanitises a hostile deck instead of trusting it', async () => {
  const res = await fetch(`${base}/api/export/pptx`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      deck: {
        title: '注入测试',
        slides: [{ layout: 'bullets', title: 'x'.repeat(500), bullets: Array.from({ length: 50 }, () => 'y'.repeat(500)) }]
      },
      theme: '../../../etc/passwd'
    })
  });
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('x-theme'), 'paper', 'unknown theme must fall back');
  const zip = await JSZip.loadAsync(Buffer.from(await res.arrayBuffer()));
  const xml = await zip.file('ppt/slides/slide1.xml').async('string');
  assert.ok(!xml.includes('y'.repeat(200)), 'oversized text must be clipped');
});

/* ------------------------------------------------------------ QR / 小程序码 */

function decodeQr(pngBuffer) {
  const png = PNG.sync.read(pngBuffer);
  const result = jsQR(new Uint8ClampedArray(png.data), png.width, png.height);
  return result ? result.data : null;
}

test('GET /api/miniprogram/code falls back to a scannable H5 QR code', async () => {
  const res = await fetch(`${base}/api/miniprogram/code`);
  assert.equal(res.status, 200);
  const data = await res.json();
  assert.equal(data.mode, 'h5');
  assert.equal(data.hasWxCredentials, false);
  assert.match(data.image, /^data:image\/png;base64,/);
  assert.ok(data.note.includes('WX_APPID'));

  // The QR must actually decode — i.e. a real phone camera could read it.
  const png = Buffer.from(data.image.split(',')[1], 'base64');
  const decoded = decodeQr(png);
  assert.equal(decoded, data.target, 'decoded QR payload mismatch');
  assert.match(decoded, /^http:\/\/\d+\.\d+\.\d+\.\d+:\d+\/$/, 'QR should point at the LAN address');
});

test('GET /api/miniprogram/qr.png serves the same code as a raw PNG', async () => {
  const res = await fetch(`${base}/api/miniprogram/qr.png`);
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('content-type'), 'image/png');
  const buffer = Buffer.from(await res.arrayBuffer());
  assert.equal(buffer.subarray(1, 4).toString('latin1'), 'PNG');
  assert.match(decodeQr(buffer) ?? '', /^http:\/\//);
});

test('GET /api/miniprogram/code returns a real 小程序码 when WX credentials work', async () => {
  const wx = await startMockWeChat();
  Object.assign(config, { wxAppId: 'wx-test-appid', wxSecret: 'wx-test-secret', wxApiBase: wx.url });
  try {
    const res = await fetch(`${base}/api/miniprogram/code`);
    const data = await res.json();
    assert.equal(data.mode, 'wxacode');
    assert.equal(data.hasWxCredentials, true);
    assert.equal(data.page, config.wxPage);
    assert.ok(wx.hits.some((h) => h.includes('/cgi-bin/token')), 'did not request an access token');
    assert.ok(wx.hits.some((h) => h.includes('/wxa/getwxacodeunlimit')), 'did not request the mini program code');
    const png = Buffer.from(data.image.split(',')[1], 'base64');
    assert.equal(png.subarray(1, 4).toString('latin1'), 'PNG');
  } finally {
    Object.assign(config, { wxAppId: '', wxSecret: '', wxApiBase: saved.wxApiBase });
    await wx.close();
  }
});

test('GET /api/miniprogram/code degrades gracefully when WeChat rejects the appid', async () => {
  const wx = await startMockWeChat({ tokenOk: false });
  Object.assign(config, { wxAppId: 'wx-bad', wxSecret: 'bad', wxApiBase: wx.url });
  try {
    const res = await fetch(`${base}/api/miniprogram/code`);
    const data = await res.json();
    assert.equal(data.mode, 'h5-fallback');
    assert.match(data.hint, /invalid appid/);
    assert.ok(wx.hits.some((h) => h.includes('/cgi-bin/token')), 'stale token cache was reused for new credentials');
    assert.equal(decodeQr(Buffer.from(data.image.split(',')[1], 'base64')), data.target);
  } finally {
    Object.assign(config, { wxAppId: '', wxSecret: '', wxApiBase: saved.wxApiBase });
    await wx.close();
  }
});

test('access tokens are cached per credential set (no cross-appid reuse)', async () => {
  const wx = await startMockWeChat();
  Object.assign(config, { wxAppId: 'wx-cache-a', wxSecret: 'secret-a', wxApiBase: wx.url });
  try {
    await fetch(`${base}/api/miniprogram/code`);
    const tokenCallsAfterFirst = wx.hits.filter((h) => h.includes('/cgi-bin/token')).length;
    assert.equal(tokenCallsAfterFirst, 1);

    await fetch(`${base}/api/miniprogram/code`);
    assert.equal(
      wx.hits.filter((h) => h.includes('/cgi-bin/token')).length,
      1,
      'the second call should reuse the cached token'
    );

    config.wxAppId = 'wx-cache-b';
    await fetch(`${base}/api/miniprogram/code`);
    assert.equal(
      wx.hits.filter((h) => h.includes('/cgi-bin/token')).length,
      2,
      'changing the appid must invalidate the cached token'
    );
  } finally {
    Object.assign(config, { wxAppId: '', wxSecret: '', wxApiBase: saved.wxApiBase });
    await wx.close();
  }
});

test('GET /api/miniprogram/code degrades when the page path is rejected', async () => {
  const wx = await startMockWeChat({ codeFails: true });
  Object.assign(config, { wxAppId: 'wx-test', wxSecret: 'secret', wxApiBase: wx.url });
  try {
    const data = await (await fetch(`${base}/api/miniprogram/code`)).json();
    assert.equal(data.mode, 'h5-fallback');
    assert.match(data.hint, /invalid page/);
  } finally {
    Object.assign(config, { wxAppId: '', wxSecret: '', wxApiBase: saved.wxApiBase });
    await wx.close();
  }
});

test('PUBLIC_URL overrides the QR target (for an HTTPS deployment)', async () => {
  config.publicUrl = 'https://ppt.example.com';
  try {
    const data = await (await fetch(`${base}/api/miniprogram/code`)).json();
    assert.equal(data.target, 'https://ppt.example.com/');
    assert.equal(decodeQr(Buffer.from(data.image.split(',')[1], 'base64')), 'https://ppt.example.com/');
  } finally {
    config.publicUrl = '';
  }
});
