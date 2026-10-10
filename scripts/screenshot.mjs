/**
 * Visual verification harness.
 *
 * Drives the running app with a real browser, using the REAL DeepSeek endpoint,
 * and writes screenshots to docs/screenshots/ so the UI can be reviewed.
 * (Deliberately NOT under test-results/, which Playwright wipes on every run.)
 *
 * Usage:
 *   node server/index.js            # or: npm run dev
 *   node scripts/screenshot.mjs     # APP_URL=http://127.0.0.1:8787
 */
import { chromium } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';

const APP_URL = process.env.APP_URL || 'http://127.0.0.1:8787';
const OUT = path.resolve('docs', 'screenshots');
const SAMPLE = process.env.SAMPLE_TEXT;

fs.mkdirSync(OUT, { recursive: true });

const TEXT =
  SAMPLE ||
  `2024 年企业级 AI 应用落地调研报告（节选）

过去 18 个月，中国企业级 AI 应用从试点走向规模化。本次调研覆盖 412 家企业，其中 63% 已在至少一个业务环节部署大模型能力，同比提升 27 个百分点；但真正进入生产环境、日均调用超过 10 万次的企业仅占 14%。

典型场景有三类：知识密集型场景（客服知识库、合同审查、研发问答）平均把检索时间从 25 分钟压缩到 90 秒；流程自动化场景（工单分类、票据审核、报表生成）中，某制造企业把月度对账周期从 7 天缩短到 4 小时；创意生成场景则主要降低试错成本。

失败原因方面，58% 的项目源于数据准备不足，31% 源于评价体系缺失，22% 源于组织协同问题。成本结构上，推理成本占比从 61% 降到 38%，而数据治理与工程化投入从 19% 升到 41%。

行动建议：从有明确量化指标的单点场景切入；把数据治理前置；建立技术层与业务层的双层评价体系；用 6 到 8 周完成一次闭环验证再决定是否扩大投入。`;

const browser = await chromium.launch({ channel: 'msedge' });
const context = await browser.newContext({ viewport: { width: 1440, height: 950 }, acceptDownloads: true });
const page = await context.newPage();

const shot = async (name, opts = {}) => {
  await page.screenshot({ path: path.join(OUT, `${name}.png`), ...opts });
  console.log(`  📸 ${name}.png`);
};

console.log(`→ opening ${APP_URL}`);
await page.goto(APP_URL, { waitUntil: 'networkidle' });
await shot('01-editor-empty');

await page.getByTestId('source-text').fill(TEXT);
await page.getByTestId('pages-8').click();
await shot('02-editor-filled');

console.log('→ generating with the real model (this takes ~20-40s)…');
const started = Date.now();
await page.getByTestId('generate').click();

// early progress: reasoning phase
await page.waitForTimeout(6000);
await shot('03-progress-thinking');
console.log(`  (progress visible after ${((Date.now() - started) / 1000).toFixed(1)}s)`);

// mid progress: first pages streaming in
await page.getByTestId('live-slides').locator('[data-testid="slide-thumb"]').first().waitFor({ timeout: 120000 });
await page.waitForTimeout(2500);
await shot('04-progress-streaming');
console.log(`  (first page streamed after ${((Date.now() - started) / 1000).toFixed(1)}s)`);

// The raw-output panel only exists while generation is still running, and a
// fast model may finish first — so this step is best-effort.
try {
  await page.getByRole('button', { name: '查看模型输出' }).click({ timeout: 4000 });
  await shot('05-progress-raw');
  await page.getByRole('button', { name: '收起模型输出' }).click({ timeout: 4000 }).catch(() => {});
} catch {
  console.log('  (生成已完成，跳过「模型原始输出」截图)');
}

await page.getByTestId('deck-grid').waitFor({ timeout: 180000 });
const total = await page.getByTestId('deck-grid').locator('[data-testid="slide-thumb"]').count();
console.log(`  ✓ deck ready: ${total} pages in ${((Date.now() - started) / 1000).toFixed(1)}s`);
await page.waitForTimeout(600);
await shot('06-deck-desktop', { fullPage: true });

// focus a content page
await page.getByTestId('deck-item-2').click();
await page.waitForTimeout(400);
await shot('07-deck-focus');

// presentation mode, several themes
await page.getByTestId('present').click();
await page.waitForTimeout(900);
await shot('08-present-cover');

await page.keyboard.press('ArrowRight');
await page.keyboard.press('ArrowRight');
await page.waitForTimeout(700);
await shot('09-present-content');

await page.keyboard.press('t');
await page.waitForTimeout(600);
await shot('10-present-theme-2');

await page.keyboard.press('t');
await page.waitForTimeout(600);
await shot('11-present-theme-3');

await page.keyboard.press('ArrowRight');
await page.keyboard.press('ArrowRight');
await page.waitForTimeout(700);
await shot('12-present-more');

// leave the presentation first (the overlay would intercept later clicks)
await page.keyboard.press('Escape');
await page.waitForTimeout(400);

// export menu + scan dialog
await page.getByTestId('export-menu').click();
await page.waitForTimeout(300);
await shot('28-export-menu');
await page.keyboard.press('Escape');
await page.waitForTimeout(250);
await page.getByTestId('scan-open').click();
await page.waitForTimeout(1000);
await shot('29-scan-modal');
await page.keyboard.press('Escape');
await page.waitForTimeout(300);

// export the standalone file, then download the pptx too
await page.getByTestId('export-menu').click();
const downloadPromise = page.waitForEvent('download');
await page.getByTestId('export-html').click();
const download = await downloadPromise;
const exported = path.join(OUT, 'exported.html');
await download.saveAs(exported);
const size = fs.statSync(exported).size;
console.log(`  ✓ exported ${download.suggestedFilename()} (${(size / 1024).toFixed(0)} KB)`);

await page.getByTestId('export-menu').click();
await page.waitForTimeout(200);
const pptxPromise = page.waitForEvent('download');
await page.getByTestId('export-pptx').click();
const pptxDownload = await pptxPromise;
const pptxFile = path.join(OUT, 'exported.pptx');
await pptxDownload.saveAs(pptxFile);
console.log(`  ✓ exported ${pptxDownload.suggestedFilename()} (${(fs.statSync(pptxFile).size / 1024).toFixed(0)} KB)`);

await page.goto(`file:///${exported.replace(/\\/g, '/')}`);
await page.waitForTimeout(700);
await shot('13-exported-offline');
await page.keyboard.press('ArrowRight');
await page.keyboard.press('ArrowRight');
await page.waitForTimeout(700);
await shot('14-exported-page3');

// mobile viewports
const mobile = await browser.newContext({
  viewport: { width: 390, height: 844 },
  deviceScaleFactor: 2,
  isMobile: true,
  hasTouch: true,
  userAgent:
    'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1'
});
const mpage = await mobile.newPage();
await mpage.goto(APP_URL, { waitUntil: 'networkidle' });
await mpage.getByTestId('source-text').fill(TEXT.slice(0, 400));
await mpage.screenshot({ path: path.join(OUT, '15-mobile-editor.png') });
console.log('  📸 15-mobile-editor.png');

await mpage.getByTestId('generate').click();
await mpage.getByTestId('deck-grid').waitFor({ timeout: 180000 });
await mpage.waitForTimeout(600);
await mpage.screenshot({ path: path.join(OUT, '16-mobile-deck.png'), fullPage: true });
console.log('  📸 16-mobile-deck.png');

await mpage.getByTestId('present').click();
await mpage.waitForTimeout(900);
await mpage.screenshot({ path: path.join(OUT, '17-mobile-present.png') });
console.log('  📸 17-mobile-present.png');
await mpage.evaluate(() => {
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
await mpage.waitForTimeout(800);
await mpage.screenshot({ path: path.join(OUT, '18-mobile-present-swiped.png') });
console.log('  📸 18-mobile-present-swiped.png');

// tablet
const tablet = await browser.newContext({ viewport: { width: 834, height: 1112 } });
const tpage = await tablet.newPage();
await tpage.goto(`file:///${exported.replace(/\\/g, '/')}`);
await tpage.waitForTimeout(700);
await tpage.screenshot({ path: path.join(OUT, '19-tablet-exported.png') });
console.log('  📸 19-tablet-exported.png');

await browser.close();
console.log(`\nAll screenshots written to ${OUT}`);
