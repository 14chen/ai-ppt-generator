/**
 * Full-stack acceptance test against the REAL DeepSeek endpoint, driven through
 * a real browser (本机已安装的 Edge)。
 *
 * Unlike `npm run test:e2e` (fast, offline, mocked upstream), this exercises the
 * whole chain end to end exactly as a user would:
 *
 *   paste 长文案 → SSE 流式生成 → 实时预览 → 页面总览 → 全屏演示
 *   → 键盘翻页 → 主题切换 → 导出独立 HTML → 离线打开并继续翻页 → 移动端视口
 *
 * Usage:
 *   npm run dev  (或 npm start)          # 另开一个终端
 *   npm run test:acceptance
 *
 * Exit code 0 = all assertions passed.
 */
import { chromium } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawnSync } from 'node:child_process';
import jsQR from 'jsqr';
import { PNG } from 'pngjs';

const APP_URL = process.env.APP_URL || 'http://127.0.0.1:8787';
const OUT = path.resolve('test-results', 'acceptance');

const POWERPOINT = [
  'C:\\Program Files\\Microsoft Office\\root\\Office16\\POWERPNT.EXE',
  'C:\\Program Files (x86)\\Microsoft Office\\root\\Office16\\POWERPNT.EXE'
].find((p) => fs.existsSync(p));

/** Decode a base64 PNG data-URL QR code, like a camera app would. */
function decodeQrDataUrl(dataUrl) {
  const png = PNG.sync.read(Buffer.from(String(dataUrl).split(',')[1], 'base64'));
  const result = jsQR(new Uint8ClampedArray(png.data), png.width, png.height);
  return result ? result.data : null;
}

/** Open the .pptx in Microsoft PowerPoint (COM) and report what it parsed. */
function validateWithPowerPoint(file) {
  if (!POWERPOINT) return null;
  const outFile = `${file}.validation.json`;
  const script = path.resolve('scripts', 'validate-pptx.ps1');
  const res = spawnSync(
    'powershell',
    ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', script, '-Path', file, '-AllText', '-OutFile', outFile],
    { encoding: 'utf8', timeout: 180000, windowsHide: true }
  );
  if (!fs.existsSync(outFile)) return { ok: false, error: `validator produced nothing (${res.stderr || ''})` };
  try {
    return JSON.parse(fs.readFileSync(outFile, 'utf8').replace(/^\uFEFF/, ''));
  } catch (err) {
    return { ok: false, error: `validator output was not JSON: ${err.message}` };
  }
}

const SOURCE_TEXT = `2024 年企业级 AI 应用落地调研报告（节选）

过去 18 个月，中国企业级 AI 应用从试点走向规模化。本次调研覆盖 412 家企业，其中 63% 已在至少一个业务环节部署大模型能力，同比提升 27 个百分点；但真正进入生产环境、日均调用超过 10 万次的企业仅占 14%。

典型场景有三类：知识密集型场景（客服知识库、合同审查、研发问答）平均把检索时间从 25 分钟压缩到 90 秒；流程自动化场景（工单分类、票据审核、报表生成）中，某制造企业把月度对账周期从 7 天缩短到 4 小时；创意生成场景则主要降低试错成本。

失败原因方面，58% 的项目源于数据准备不足，31% 源于评价体系缺失，22% 源于组织协同问题。成本结构上，推理成本占比从 61% 降到 38%，而数据治理与工程化投入从 19% 升到 41%。

行动建议：从有明确量化指标的单点场景切入；把数据治理前置；建立技术层与业务层的双层评价体系；用 6 到 8 周完成一次闭环验证再决定是否扩大投入。`;

let failures = 0;
const check = (name, ok, extra = '') => {
  if (ok) {
    console.log(`  \u2713 ${name}${extra ? ` — ${extra}` : ''}`);
  } else {
    failures += 1;
    console.log(`  \u2717 ${name}${extra ? ` — ${extra}` : ''}`);
  }
};
const section = (t) => console.log(`\n${t}`);

// --- preflight --------------------------------------------------------------
try {
  const health = await fetch(`${APP_URL}/api/health`).then((r) => r.json());
  console.log(`目标应用: ${APP_URL}`);
  console.log(`模型:     ${health.model} @ ${health.baseUrl}`);
  if (!health.hasApiKey) {
    console.error('\n✗ 服务端未配置 DEEPSEEK_API_KEY，无法运行真实接口验收。');
    process.exit(2);
  }
} catch (err) {
  console.error(`\n✗ 无法连接 ${APP_URL}：${err.message}`);
  console.error('  请先启动服务： npm run dev   或   npm run build && npm start');
  process.exit(2);
}

fs.mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch({ channel: 'msedge' });
const context = await browser.newContext({ viewport: { width: 1440, height: 950 }, acceptDownloads: true });
const page = await context.newPage();
const pageErrors = [];
page.on('pageerror', (e) => pageErrors.push(e.message));

let counter = () => page.locator('.ppt-counter').textContent();

try {
  // --- 1. 输入 ---------------------------------------------------------------
  section('1. 输入文案');
  await page.goto(APP_URL, { waitUntil: 'networkidle' });
  await page.getByTestId('source-text').fill(SOURCE_TEXT);
  const enabled = await page.getByTestId('generate').isEnabled();
  check('长文案输入后「生成 PPT」可用', enabled);

  // --- 2. 流式生成 -----------------------------------------------------------
  section('2. 流式生成（真实模型）');
  const startedAt = Date.now();
  const [response] = await Promise.all([
    page.waitForResponse((r) => r.url().includes('/api/generate'), { timeout: 30000 }),
    page.getByTestId('generate').click()
  ]);
  const contentType = response.headers()['content-type'] || '';
  check('后端以 SSE (text/event-stream) 响应', contentType.includes('text/event-stream'), contentType);
  check('HTTP 200', response.status() === 200, String(response.status()));

  await page.getByTestId('progress-view').waitFor({ timeout: 20000 });
  check('进入生成进度界面', true);

  // slides must appear while the stream is still running
  await page.getByTestId('live-slides').locator('[data-testid="slide-thumb"]').first().waitFor({ timeout: 120000 });
  const liveCount = await page.getByTestId('live-slides').locator('[data-testid="slide-thumb"]').count();
  const deckVisibleYet = await page.getByTestId('deck-grid').isVisible().catch(() => false);
  check(
    '每解析出一页立刻出现在实时预览中（整体尚未完成）',
    !deckVisibleYet && liveCount >= 1,
    `此时实时预览 ${liveCount} 张，页面总览尚未出现`
  );

  await page.getByTestId('progress-view').getByRole('button', { name: '查看模型输出' }).click({ timeout: 5000 }).catch(() => {});
  const rawText = await page.getByTestId('raw-output').textContent().catch(() => '');
  check('可查看模型思考过程', (rawText || '').length > 20, `${(rawText || '').length} 字符`);

  await page.getByTestId('deck-grid').waitFor({ timeout: 180000 });
  const elapsed = ((Date.now() - startedAt) / 1000).toFixed(1);
  console.log(`    （真实生成耗时 ${elapsed}s）`);

  // --- 3. 结构与内容 ---------------------------------------------------------
  section('3. 生成的 PPT 结构');
  const thumbs = page.getByTestId('deck-grid').locator('[data-testid="slide-thumb"]');
  const total = await thumbs.count();
  const layouts = await thumbs.evaluateAll((els) => els.map((e) => e.getAttribute('data-layout')));
  const titles = await thumbs.evaluateAll((els) =>
    els.map((e) => e.querySelector('.ppt-title')?.textContent?.trim() || '')
  );
  check('生成多页 PPT（≥4 页）', total >= 4, `${total} 页`);
  check('第一页是封面', layouts[0] === 'cover', layouts[0]);
  check('最后一页是结尾', layouts[layouts.length - 1] === 'closing', layouts[layouts.length - 1]);
  check('版式有变化（≥3 种）', new Set(layouts).size >= 3, [...new Set(layouts)].join(', '));
  check('每页都有标题', titles.every((t) => t.length > 0), `${titles.filter(Boolean).length}/${total}`);
  const bodyText = (await page.getByTestId('deck-grid').textContent()) || '';
  check('正文包含原文事实（未编造占位内容）', /63%|412|14%|61%|38%|41%/.test(bodyText));
  check('没有残留提示词占位符', !bodyText.includes('页标题'));

  // --- 4. 全屏演示 + 键盘翻页 -------------------------------------------------
  section('4. 全屏演示与键盘翻页');
  await page.getByTestId('present').click();
  const overlay = page.getByTestId('player-overlay');
  await overlay.waitFor({ timeout: 10000 });
  const presented = await overlay.locator('.ppt-slide').count();
  check('演示模式渲染全部页面', presented === total, `${presented}/${total}`);

  check('起始为第 1 页', (await counter())?.trim() === `1 / ${total}`);
  await page.keyboard.press('ArrowRight');
  check('→ 翻到下一页', (await counter())?.trim() === `2 / ${total}`);
  await page.keyboard.press('Space');
  check('空格翻到下一页', (await counter())?.trim() === `3 / ${total}`);
  await page.keyboard.press('ArrowLeft');
  check('← 返回上一页', (await counter())?.trim() === `2 / ${total}`);
  await page.keyboard.press('End');
  check('End 跳到末页', (await counter())?.trim() === `${total} / ${total}`);
  await page.keyboard.press('Home');
  check('Home 回到首页', (await counter())?.trim() === `1 / ${total}`);

  await overlay.locator('.ppt-btn[data-act="fullscreen"]').click();
  await page.waitForTimeout(600);
  const isFs = await page.evaluate(() => Boolean(document.fullscreenElement));
  check('可进入全屏', isFs);
  await overlay.locator('.ppt-btn[data-act="fullscreen"]').click();
  await page.waitForTimeout(400);

  // --- 5. 主题切换 -----------------------------------------------------------
  section('5. 配色主题');
  const themed = overlay.locator('[data-ppt-theme]');
  const seen = new Set([await themed.getAttribute('data-ppt-theme')]);
  for (let i = 0; i < 4; i += 1) {
    await page.keyboard.press('t');
    await page.waitForTimeout(250);
    seen.add(await themed.getAttribute('data-ppt-theme'));
  }
  check('T 键可循环切换主题', seen.size >= 3, [...seen].join(' → '));
  const bg = await page.evaluate(() => {
    const el = document.querySelector('[data-ppt-theme]');
    return getComputedStyle(el).getPropertyValue('--ppt-slide-bg').trim();
  });
  check('主题实际改变了配色变量', bg.length > 0, bg);

  await page.keyboard.press('Escape');
  await page.waitForTimeout(300);
  check('Esc 退出演示', !(await overlay.isVisible()));

  // --- 6. 导出独立 HTML ------------------------------------------------------
  section('6. 导出独立 HTML');
  await page.getByTestId('export-menu').click();
  const downloadPromise = page.waitForEvent('download');
  await page.getByTestId('export-html').click();
  const download = await downloadPromise;
  const target = path.join(OUT, 'acceptance.html');
  await download.saveAs(target);
  const html = fs.readFileSync(target, 'utf8');
  const kb = (Buffer.byteLength(html) / 1024).toFixed(0);
  check('下载了 .html 文件', download.suggestedFilename().endsWith('.html'), `${download.suggestedFilename()} (${kb} KB)`);
  check('文件内联了运行时', html.includes('window.PPTPlayer'));
  check('文件内联了全部数据', html.includes('"slides"'));
  check('没有外链脚本', !/<script[^>]+src=/i.test(html));
  check('没有外链样式表', !/<link[^>]+stylesheet/i.test(html));
  check('没有远程静态资源', !/https?:\/\/[^\s"']+\.(js|css|woff2?|png|jpg|svg)/i.test(html));

  const offline = await context.newPage();
  const offlineErrors = [];
  offline.on('pageerror', (e) => offlineErrors.push(e.message));
  await offline.goto(`file:///${target.replace(/\\/g, '/')}`);
  await offline.waitForTimeout(600);
  check('离线打开后有渲染内容', (await offline.locator('.ppt-slide').count()) === total);
  const oc = () => offline.locator('.ppt-counter').textContent();
  check('离线文件起始为第 1 页', (await oc())?.trim() === `1 / ${total}`);
  await offline.keyboard.press('ArrowRight');
  await offline.waitForTimeout(300);
  check('离线文件可键盘翻页', (await oc())?.trim() === `2 / ${total}`);
  const t0 = await offline.locator('[data-ppt-theme]').first().getAttribute('data-ppt-theme');
  await offline.keyboard.press('t');
  await offline.waitForTimeout(300);
  const t1 = await offline.locator('[data-ppt-theme]').first().getAttribute('data-ppt-theme');
  check('离线文件可切换主题', Boolean(t0) && t0 !== t1, `${t0} → ${t1}`);
  check('离线文件无脚本错误', offlineErrors.length === 0, offlineErrors.join(' | '));

  // --- 6b. 导出 PowerPoint (.pptx) -------------------------------------------
  section('6b. 导出 PowerPoint (.pptx)');
  await page.getByTestId('export-menu').click();
  const pptxPromise = page.waitForEvent('download');
  await page.getByTestId('export-pptx').click();
  const pptxDownload = await pptxPromise;
  const pptxPath = path.join(OUT, 'acceptance.pptx');
  await pptxDownload.saveAs(pptxPath);
  const pptxBuffer = fs.readFileSync(pptxPath);
  const pptxKb = (pptxBuffer.length / 1024).toFixed(0);

  check(
    '下载了 .pptx 文件',
    pptxDownload.suggestedFilename().endsWith('.pptx'),
    `${pptxDownload.suggestedFilename()} (${pptxKb} KB)`
  );
  check('是有效的 OOXML(zip) 容器', pptxBuffer.subarray(0, 2).toString('latin1') === 'PK');

  const names = pptxBuffer.toString('latin1');
  check('包含 [Content_Types].xml', names.includes('[Content_Types].xml'));
  check('包含 ppt/presentation.xml', names.includes('ppt/presentation.xml'));
  check('包含幻灯片母版', names.includes('ppt/slideMasters/slideMaster1.xml'));
  const slideParts = new Set(names.match(/ppt\/slides\/slide\d+\.xml/g) ?? []);
  check('页数与生成结果一致', slideParts.size === total, `${slideParts.size} 页 vs 生成 ${total} 页`);

  if (POWERPOINT) {
    const result = validateWithPowerPoint(pptxPath);
    check('Microsoft PowerPoint 能打开它', Boolean(result && result.ok), result?.error ?? '');
    if (result && result.ok) {
      check('PowerPoint 读到的页数一致', result.slides === total, `${result.slides} 页`);
      check(
        'PowerPoint 读到的画布是 16:9 宽屏',
        Math.round(result.slideWidthPt) === 960 && Math.round(result.slideHeightPt) === 540,
        `${result.slideWidthPt}x${result.slideHeightPt} pt`
      );
      const allText = result.details.map((d) => (d.texts || []).join(' ')).join('\n');
      check('PowerPoint 能读到页面文字', allText.length > 40, `${allText.length} 字符`);
      if (titles && titles[0]) check('能读到封面标题', allText.includes(titles[0]), titles[0]);
      check(
        '没有空白页',
        result.details.every((d) => d.shapes >= 3),
        `最少形状数 ${Math.min(...result.details.map((d) => d.shapes))}`
      );
    }
  } else {
    console.log('  – 未安装 Microsoft PowerPoint，跳过 COM 校验');
  }

  // --- 7. 响应式 -------------------------------------------------------------
  section('7. 响应式多端兼容');
  const mobile = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
  const mp = await mobile.newPage();
  await mp.goto(APP_URL, { waitUntil: 'networkidle' });
  const overflow = await mp.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  check('手机视口无横向溢出', overflow <= 1, `溢出 ${overflow}px`);

  await mp.getByTestId('source-text').fill(SOURCE_TEXT.slice(0, 300));
  await mp.getByTestId('generate').click();
  await mp.getByTestId('deck-grid').waitFor({ timeout: 180000 });
  await mp.getByTestId('present').click();
  await mp.waitForTimeout(800);
  const box = await mp.locator('[data-testid="player-overlay"] .ppt-canvas').boundingBox();
  check('演示画面自适应手机宽度', Boolean(box) && box.width <= 391, `${box?.width?.toFixed(0)}x${box?.height?.toFixed(0)}`);
  const before = (await mp.locator('.ppt-counter').textContent())?.trim();
  await mp.evaluate(() => {
    const stage = document.querySelector('.ppt-stage');
    const fire = (type, x) => {
      const t = new Touch({ identifier: 1, target: stage, clientX: x, clientY: 300 });
      stage.dispatchEvent(
        new TouchEvent(type, { bubbles: true, cancelable: true, touches: type === 'touchend' ? [] : [t], changedTouches: [t] })
      );
    };
    fire('touchstart', 330);
    fire('touchend', 60);
  });
  await mp.waitForTimeout(400);
  const after = (await mp.locator('.ppt-counter').textContent())?.trim();
  check('手机支持左右滑动翻页', before !== after, `${before} → ${after}`);

  const wide = await browser.newContext({ viewport: { width: 834, height: 1112 } });
  const wp = await wide.newPage();
  await wp.goto(APP_URL, { waitUntil: 'networkidle' });
  const toverflow = await wp.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  check('平板视口无横向溢出', toverflow <= 1, `溢出 ${toverflow}px`);

  // --- 8. 扫码使用（微信小程序入口） -----------------------------------------
  section('8. 扫码使用（微信小程序入口）');
  await page.getByTestId('scan-open').click();
  const scanModal = page.getByTestId('scan-modal');
  await scanModal.waitFor({ timeout: 10000 });
  check('扫码弹窗可打开', await scanModal.isVisible());

  const qrSrc = await page.getByTestId('scan-qr').getAttribute('src');
  const decoded = decodeQrDataUrl(qrSrc);
  check('二维码可被真实解码（相机可读）', Boolean(decoded), decoded ?? '解码失败');
  if (decoded) {
    check('二维码指向可访问地址', /^https?:\/\/.+/.test(decoded), decoded);
  }
  const network = await (await fetch(`${APP_URL}/api/network`)).json();
  check('弹窗里给出了小程序 API 地址', (await scanModal.textContent()).includes(network.miniprogramApiBase), network.miniprogramApiBase);

  const formats = await (await fetch(`${APP_URL}/api/export/formats`)).json();
  check(
    '服务端声明三种导出格式',
    ['html', 'pptx', 'json'].every((f) => formats.formats.some((x) => x.id === f)),
    formats.formats.map((f) => f.id).join(', ')
  );

  await page.keyboard.press('Escape');
  await scanModal.waitFor({ state: 'hidden', timeout: 5000 }).catch(() => {});
  check('Esc 可关闭扫码弹窗', !(await scanModal.isVisible()));

  check('整个过程无前端运行时错误', pageErrors.length === 0, pageErrors.join(' | '));
} catch (err) {
  failures += 1;
  console.log(`\n✗ 验收过程中出现异常：${err.message}`);
} finally {
  await browser.close();
}

console.log(`\n${'='.repeat(56)}`);
console.log(failures === 0 ? '验收结果：全部通过 ✅' : `验收结果：${failures} 项失败 ❌`);
console.log('='.repeat(56));
process.exit(failures === 0 ? 0 : 1);
