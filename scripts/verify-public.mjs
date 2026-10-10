/**
 * Verify the PUBLIC deployment end to end.
 *
 *   node --use-system-ca scripts/verify-public.mjs https://xxxx.lhr.life <ACCESS_CODE>
 *
 * It goes out to the internet (through the tunnel) and checks:
 *   1. the SPA loads and the access gate is shown
 *   2. a wrong code is refused, the right code unlocks it
 *   3. a REAL generation works over the public URL
 *   4. rate limiting counts public traffic (headers decrease)
 *   5. the mini program's own client code streams from the public URL
 *   6. mobile viewport works over the public URL
 */
import { chromium } from '@playwright/test';
import path from 'node:path';
import fs from 'node:fs';
import { createMiniProgramLoader, MINIPROGRAM_DIR } from '../tests/helpers/miniprogram-loader.js';

const PUBLIC_URL = (process.argv[2] || process.env.PUBLIC_URL || '').replace(/\/+$/, '');
const CODE = process.argv[3] || process.env.ACCESS_CODE || '';

if (!PUBLIC_URL) {
  console.error('用法: node --use-system-ca scripts/verify-public.mjs <公网URL> <访问码>');
  process.exit(2);
}

const OUT = path.resolve('test-results', 'public');
fs.mkdirSync(OUT, { recursive: true });

let failures = 0;
const check = (name, ok, extra = '') => {
  if (ok) console.log(`  ✓ ${name}${extra ? ` — ${extra}` : ''}`);
  else {
    failures += 1;
    console.log(`  ✗ ${name}${extra ? ` — ${extra}` : ''}`);
  }
};
const section = (t) => console.log(`\n${t}`);

const SAMPLE_TEXT =
  '季度业务复盘：收入同比增长 32%，获客成本下降 18%，续费率提升到 91%。' +
  '下一步要补齐渠道覆盖，并在第二季度扩张团队，同时把交付周期压缩到两周以内。这是一段足够长的测试文案。';

console.log(`公网地址: ${PUBLIC_URL}`);
console.log(`访问码  : ${CODE ? CODE.slice(0, 4) + '****' : '(未提供)'}`);

/* ------------------------------------------------- 0. 隧道与门禁（API 层） -- */

section('0. 公网 API 与门禁');
{
  const res = await fetch(`${PUBLIC_URL}/api/session`, { redirect: 'follow' });
  const data = await res.json();
  check('公网 /api/session 可达', res.status === 200, `required=${data.required} ok=${data.ok}`);
  check('未带访问码时确实需要登录', data.required === true && data.ok === false);

  const blocked = await fetch(`${PUBLIC_URL}/api/generate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text: SAMPLE_TEXT })
  });
  check('未授权调用被拒绝 (401)', blocked.status === 401, (await blocked.json()).error?.code);

  const wrong = await fetch(`${PUBLIC_URL}/api/session`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ code: 'totally-wrong' })
  });
  check('错误访问码被拒绝', wrong.status === 401);
}

/* --------------------------------------------------- 1. 浏览器完整流程 ----- */

const browser = await chromium.launch({ channel: 'msedge' });
const context = await browser.newContext({ viewport: { width: 1440, height: 950 }, acceptDownloads: true });
const page = await context.newPage();
const pageErrors = [];
page.on('pageerror', (e) => pageErrors.push(e.message));

try {
  section('1. 公网页面与访问门禁');
  await page.goto(PUBLIC_URL, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.getByTestId('access-code').waitFor({ timeout: 30000 });
  check('公网首页打开并显示访问门禁', true, await page.title());

  await page.getByTestId('access-code').fill('wrong-code');
  await page.getByTestId('access-submit').click();
  await page.getByTestId('access-error').waitFor({ timeout: 15000 });
  check('前端能提示访问码错误', (await page.getByTestId('access-error').textContent()).includes('访问码'));

  await page.getByTestId('access-code').fill(CODE);
  await page.getByTestId('access-submit').click();
  await page.getByTestId('source-text').waitFor({ timeout: 30000 });
  check('正确的访问码可以进入', true);

  section('2. 公网真实生成（消耗一次额度）');
  await page.getByTestId('source-text').fill(SAMPLE_TEXT);
  const started = Date.now();
  await page.getByTestId('generate').click();
  await page.getByTestId('live-slides').locator('[data-testid="slide-thumb"]').first().waitFor({ timeout: 120000 });
  check('流式生成开始出页', true, `${((Date.now() - started) / 1000).toFixed(1)}s`);
  await page.getByTestId('deck-grid').waitFor({ timeout: 180000 });
  const total = await page.getByTestId('deck-grid').locator('[data-testid="slide-thumb"]').count();
  const layouts = await page
    .getByTestId('deck-grid')
    .locator('[data-testid="slide-thumb"]')
    .evaluateAll((els) => els.map((e) => e.getAttribute('data-layout')));
  check('公网生成完成', total >= 4, `${total} 页 / ${((Date.now() - started) / 1000).toFixed(1)}s`);
  check('第一页是封面', layouts[0] === 'cover');
  check('最后一页是结尾', layouts[layouts.length - 1] === 'closing');
  check('版式有变化', new Set(layouts).size >= 3, [...new Set(layouts)].join(', '));

  section('3. 公网导出与演示');
  await page.getByTestId('export-menu').click();
  const dl = page.waitForEvent('download');
  await page.getByTestId('export-pptx').click();
  const download = await dl;
  const pptx = path.join(OUT, 'public-export.pptx');
  await download.saveAs(pptx);
  const buf = fs.readFileSync(pptx);
  check('公网可导出 PPTX', download.suggestedFilename().endsWith('.pptx'), `${(buf.length / 1024).toFixed(0)} KB`);
  check('导出文件是有效的 OOXML(zip)', buf.subarray(0, 2).toString('latin1') === 'PK');
  const names = buf.toString('latin1');
  check('包含幻灯片部件', names.includes('ppt/presentation.xml') && names.includes('ppt/slides/slide1.xml'));

  await page.getByTestId('present').click();
  await page.getByTestId('player-overlay').waitFor({ timeout: 15000 });
  const counter = page.locator('[data-testid="player-overlay"] .ppt-counter');
  check('公网可进入演示', (await counter.textContent())?.trim().startsWith('1 /'));
  await page.keyboard.press('ArrowRight');
  check('键盘翻页正常', (await counter.textContent())?.trim().startsWith('2 /'));
  await page.keyboard.press('Escape');

  section('4. 公网限流计数');
  {
    const cookie = (await context.cookies(PUBLIC_URL)).find((c) => c.name === 'ppt_access');
    check('浏览器拿到 HttpOnly 会话 cookie', Boolean(cookie?.httpOnly));
    const header = `ppt_access=${cookie.value}`;
    const remainings = [];
    for (let i = 0; i < 2; i += 1) {
      const r = await fetch(`${PUBLIC_URL}/api/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', cookie: header },
        body: JSON.stringify({ text: 'x' })
      });
      remainings.push(Number(r.headers.get('x-ratelimit-remaining')));
    }
    check(
      '公网请求被计入限流（额度在减少）',
      remainings.every((n) => Number.isFinite(n)) && remainings[1] < remainings[0],
      `remaining: ${remainings.join(' → ')}`
    );
  }

  section('5. 手机视口（公网）');
  const mobile = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const mp = await mobile.newPage();
  await mp.goto(PUBLIC_URL, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await mp.getByTestId('access-code').waitFor({ timeout: 30000 });
  await mp.getByTestId('access-code').fill(CODE);
  await mp.getByTestId('access-submit').click();
  await mp.getByTestId('source-text').waitFor({ timeout: 30000 });
  const overflow = await mp.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  check('手机视口无横向溢出', overflow <= 1, `溢出 ${overflow}px`);
  await mp.screenshot({ path: path.join(OUT, 'public-mobile.png') });
  check('手机端门禁与编辑器可用', true);

  check('全流程无前端运行时错误', pageErrors.length === 0, pageErrors.join(' | '));
} catch (err) {
  failures += 1;
  console.log(`\n✗ 公网浏览器验证出现异常：${err.message}`);
} finally {
  await browser.close();
}

/* ------------------------------------------- 6. 小程序客户端打公网接口 ----- */

section('6. 小程序客户端（真实代码）打公网接口');
try {
  const load = createMiniProgramLoader(MINIPROGRAM_DIR);
  const miniConfig = load('config.js');
  miniConfig.API_BASE = PUBLIC_URL;
  miniConfig.ACCESS_CODE = CODE;

  // fetch-backed wx shim (same behaviour as enableChunked + onChunkReceived)
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
      (async () => {
        try {
          const isBinary = options.responseType === 'arraybuffer';
          const res = await fetch(options.url, {
            method: options.method || 'GET',
            headers: options.header,
            body: options.data === undefined ? undefined : JSON.stringify(options.data),
            signal: controller.signal
          });
          if (options.onHeadersReceived) options.onHeadersReceived({ statusCode: res.status });
          if (isBinary) {
            const b = Buffer.from(await res.arrayBuffer());
            options.success({ statusCode: res.status, data: b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) });
            return;
          }
          for await (const chunk of res.body) {
            const v = chunk instanceof Uint8Array ? chunk : new Uint8Array(chunk);
            const ab = v.buffer.slice(v.byteOffset, v.byteOffset + v.byteLength);
            for (const cb of listeners) cb({ data: ab });
          }
          options.success({ statusCode: res.status, data: undefined });
        } catch (err) {
          if (options.fail) options.fail({ errMsg: err.message });
        }
      })();
      return task;
    },
    env: { USER_DATA_PATH: 'F:\\Temp\\mini' },
    getFileSystemManager: () => ({ writeFile: ({ success }) => success && success() }),
    openDocument: ({ success }) => success && success(),
    showToast() {},
    showLoading() {},
    hideLoading() {},
    getStorageSync: () => '',
    setStorageSync() {}
  };

  const api = load('utils/api.js');
  const events = [];
  let error = null;
  await new Promise((resolve) => {
    api.streamGenerate({
      text: SAMPLE_TEXT,
      settings: { targetSlides: 6, language: 'zh', theme: 'forest' },
      onEvent: (e) => events.push(e),
      onError: (e) => {
        error = e;
      },
      onComplete: resolve
    });
  });
  check('小程序流式接口可用（带访问码请求头）', error === null, error ? error.message : '');
  const names = events.map((e) => e.event);
  check('收到 SSE 事件', names.includes('slide') && names.includes('done'), names.slice(0, 6).join(','));
  const deck = events.find((e) => e.event === 'done')?.data?.deck;
  check('小程序拿到完整 deck', Boolean(deck && deck.slides.length >= 3), deck ? `${deck.slides.length} 页` : '');
  if (deck) check('中文没有乱码', !JSON.stringify(deck).includes('\uFFFD'));

  delete globalThis.wx;
} catch (err) {
  failures += 1;
  console.log(`  ✗ 小程序公网验证异常：${err.message}`);
}

console.log(`\n${'='.repeat(56)}`);
console.log(failures === 0 ? '公网验收：全部通过 ✅' : `公网验收：${failures} 项失败 ❌`);
console.log('='.repeat(56));
process.exit(failures === 0 ? 0 : 1);
