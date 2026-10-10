/**
 * Focused mobile/landscape visual check for the player HUD + rotate hint.
 * Usage: node scripts/verify-mobile.mjs   (needs the app running on :8787)
 */
import { chromium } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';

const APP_URL = process.env.APP_URL || 'http://127.0.0.1:8787';
const OUT = path.resolve('docs', 'screenshots');
fs.mkdirSync(OUT, { recursive: true });

const TEXT =
  '产品发布：星尘 X1 智能会议终端。配备 8 麦克风环形阵列，拾音半径 6 米；在 45 分贝噪声下识别准确率 96.4%。' +
  '会后 30 秒生成纪要，自动提取待办并同步到企业微信、飞书与钉钉。提供公有云、私有化、完全离线三种部署模式，' +
  '硬件售价 4980 元，专业版服务每年 1980 元，4 月 15 日正式发售。';

const browser = await chromium.launch({ channel: 'msedge' });

// --- phone, portrait --------------------------------------------------------
const phone = await browser.newContext({
  viewport: { width: 390, height: 844 },
  deviceScaleFactor: 2,
  isMobile: true,
  hasTouch: true
});
const p = await phone.newPage();
await p.goto(APP_URL, { waitUntil: 'networkidle' });
await p.getByTestId('source-text').fill(TEXT);
await p.getByTestId('pages-6').click();
await p.getByTestId('generate').click();
await p.getByTestId('deck-grid').waitFor({ timeout: 180000 });
await p.getByTestId('present').click();
await p.waitForTimeout(900);
await p.screenshot({ path: path.join(OUT, '20-mobile-present-fixed.png') });
console.log('  📸 20-mobile-present-fixed.png');

// theme label must not wrap: the HUD keeps a single row
const hudBox = await p.locator('[data-testid="player-overlay"] .ppt-hud').boundingBox();
console.log(`  HUD height = ${hudBox?.height?.toFixed(0)}px (single row expected, < 70px)`);
const labelVisible = await p.locator('[data-testid="player-overlay"] .ppt-hud [data-theme-label]').isVisible();
console.log(`  theme label visible on phone: ${labelVisible} (expected false)`);

// rotate to landscape
await p.setViewportSize({ width: 844, height: 390 });
await p.waitForTimeout(600);
await p.screenshot({ path: path.join(OUT, '21-mobile-landscape.png') });
console.log('  📸 21-mobile-landscape.png');
const labelLandscape = await p.locator('[data-testid="player-overlay"] .ppt-hud [data-theme-label]').isVisible();
console.log(`  theme label visible in landscape: ${labelLandscape} (expected true)`);
const canvas = await p.locator('[data-testid="player-overlay"] .ppt-canvas').boundingBox();
console.log(`  canvas in landscape = ${canvas?.width?.toFixed(0)}x${canvas?.height?.toFixed(0)}`);

// --- export from the phone, re-open it, screenshot --------------------------
const downloadPromise = p.waitForEvent('download').catch(() => null);
await p.keyboard.press('Escape');
await p.waitForTimeout(300);
await p.getByTestId('export-menu').click();
await p.getByTestId('export-html').click();
const download = await downloadPromise;
if (download) {
  const target = path.join(OUT, 'exported-mobile.html');
  await download.saveAs(target);
  const size = fs.statSync(target).size;
  console.log(`  ✓ fresh export (${(size / 1024).toFixed(0)} KB)`);
  const exported = await phone.newPage();
  await exported.goto(`file:///${target.replace(/\\/g, '/')}`);
  await exported.waitForTimeout(800);
  await exported.screenshot({ path: path.join(OUT, '22-exported-mobile.png') });
  console.log('  📸 22-exported-mobile.png');
  const hb = await exported.locator('.ppt-hud').boundingBox();
  console.log(`  exported HUD height = ${hb?.height?.toFixed(0)}px`);
  await exported.keyboard.press('ArrowRight');
  await exported.waitForTimeout(500);
  await exported.screenshot({ path: path.join(OUT, '23-exported-mobile-p2.png') });
  console.log('  📸 23-exported-mobile-p2.png');
}

// --- small tablet -----------------------------------------------------------
const tablet = await browser.newContext({ viewport: { width: 834, height: 1112 }, hasTouch: true });
const t = await tablet.newPage();
await t.goto(APP_URL, { waitUntil: 'networkidle' });
await t.screenshot({ path: path.join(OUT, '24-tablet-editor.png'), fullPage: true });
console.log('  📸 24-tablet-editor.png');

await browser.close();
console.log('\ndone');
