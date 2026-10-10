/**
 * Extra verification: in-app theme switching of the previews, JSON export,
 * print stylesheet, fullscreen, and that all five themes produce distinct colours.
 * Usage: node scripts/verify-extras.mjs   (needs the app running on :8787)
 */
import { chromium } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';

const APP_URL = process.env.APP_URL || 'http://127.0.0.1:8787';
const OUT = path.resolve('docs', 'screenshots');
fs.mkdirSync(OUT, { recursive: true });

const TEXT =
  '成本结构变化：推理成本占 AI 项目总预算的比例从 61% 下降到 38%，数据治理与工程化投入从 19% 上升到 41%，' +
  '成为新的成本重心。行动建议：把数据治理前置，建立双层评价体系，用 6 到 8 周完成一次闭环验证再决定是否扩大投入。';

const browser = await chromium.launch({ channel: 'msedge' });
const context = await browser.newContext({ viewport: { width: 1440, height: 950 }, acceptDownloads: true });
const page = await context.newPage();

await page.goto(APP_URL, { waitUntil: 'networkidle' });
await page.getByTestId('source-text').fill(TEXT);
await page.getByTestId('pages-6').click();
await page.getByTestId('generate').click();
await page.getByTestId('deck-grid').waitFor({ timeout: 180000 });
await page.waitForTimeout(500);

// --- theme switching updates the thumbnails in the deck browser -------------
const readTheme = () =>
  page.evaluate(() => document.querySelector('[data-testid="slide-thumb"]')?.getAttribute('data-ppt-theme'));
console.log(`  preview theme before = ${await readTheme()}`);
await page.getByTestId('theme-sunrise').click();
await page.waitForTimeout(400);
console.log(`  preview theme after clicking 暖阳赤陶 = ${await readTheme()}`);
await page.screenshot({ path: path.join(OUT, '25-deck-sunrise-theme.png'), fullPage: true });
console.log('  📸 25-deck-sunrise-theme.png');

await page.getByTestId('theme-paper').click();
await page.waitForTimeout(400);
await page.screenshot({ path: path.join(OUT, '26-deck-paper-theme.png') });
console.log('  📸 26-deck-paper-theme.png');
console.log(`  preview theme after clicking 简约白 = ${await readTheme()}`);

// --- JSON export ------------------------------------------------------------
await page.getByTestId('export-menu').click();
const jsonPromise = page.waitForEvent('download');
await page.getByTestId('export-json').click();
const jsonDl = await jsonPromise;
const jsonPath = path.join(OUT, 'exported-deck.json');
await jsonDl.saveAs(jsonPath);
const parsed = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
console.log(`  ✓ JSON export: ${jsonDl.suggestedFilename()} — ${parsed.slides.length} slides, theme=${parsed.theme}`);

// --- HTML export + fullscreen ----------------------------------------------
await page.getByTestId('export-menu').click();
const htmlPromise = page.waitForEvent('download');
await page.getByTestId('export-html').click();
const htmlDl = await htmlPromise;
const htmlPath = path.join(OUT, 'exported-fullscreen.html');
await htmlDl.saveAs(htmlPath);

const ex = await context.newPage();
await ex.goto(`file:///${htmlPath.replace(/\\/g, '/')}`);
await ex.waitForTimeout(600);

// print stylesheet must expose every slide
const printState = await ex.evaluate(() => {
  const slides = document.querySelectorAll('.ppt-slide');
  return { count: slides.length, hudPresent: !!document.querySelector('.ppt-hud') };
});
console.log(`  print: ${printState.count} slides in the DOM (all printable)`);
const printCss = fs.readFileSync(htmlPath, 'utf8').includes('@media print');
console.log(`  print stylesheet inlined: ${printCss}`);

// fullscreen via the HUD button toggles both ways
await ex.locator('.ppt-btn[data-act="fullscreen"]').click();
await ex.waitForTimeout(600);
console.log(`  fullscreenElement after clicking the ⛶ button = ${await ex.evaluate(() => Boolean(document.fullscreenElement))}`);
await ex.locator('.ppt-btn[data-act="fullscreen"]').click();
await ex.waitForTimeout(500);
console.log(`  fullscreenElement after clicking it again     = ${await ex.evaluate(() => Boolean(document.fullscreenElement))}`);
await ex.screenshot({ path: path.join(OUT, '27-exported-child-themes.png') });
console.log('  📸 27-exported-child-themes.png');

// every theme renders distinct colours
const themes = ['paper', 'midnight', 'sunrise', 'forest', 'neon'];
const bgByTheme = {};
for (const t of themes) {
  await ex.evaluate((id) => {
    const root = document.querySelector('[data-ppt-theme]');
    window.PPTPlayer.applyTheme(root, id);
  }, t);
  await ex.waitForTimeout(150);
  bgByTheme[t] = await ex.evaluate(() => {
    const root = document.querySelector('[data-ppt-theme]');
    return getComputedStyle(root).getPropertyValue('--ppt-slide-bg').trim();
  });
}
console.log('  theme backgrounds:', JSON.stringify(bgByTheme));
const unique = new Set(Object.values(bgByTheme));
console.log(`  distinct themes = ${unique.size}/${themes.length}`);

await browser.close();
console.log('\ndone');
