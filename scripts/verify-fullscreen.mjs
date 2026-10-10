/** Fullscreen toggle + Escape semantics on the exported file. */
import { chromium } from '@playwright/test';
import path from 'node:path';

const file = path.resolve('docs', 'screenshots', 'exported-fullscreen.html');
const url = `file:///${file.replace(/\\/g, '/')}`;

const browser = await chromium.launch({ channel: 'msedge' });
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
await page.goto(url);
await page.waitForTimeout(500);

const isFs = () => page.evaluate(() => Boolean(document.fullscreenElement));
const counter = () => page.locator('.ppt-counter').textContent();

console.log(`  start: fullscreen=${await isFs()}`);

await page.locator('.ppt-btn[data-act="fullscreen"]').click();
await page.waitForTimeout(500);
console.log(`  after 1st click: fullscreen=${await isFs()} (expect true)`);

await page.locator('.ppt-btn[data-act="fullscreen"]').click();
await page.waitForTimeout(500);
console.log(`  after 2nd click: fullscreen=${await isFs()} (expect false)`);

// The F key toggles the same way while not typing.
await page.keyboard.press('f');
await page.waitForTimeout(500);
console.log(`  after 'f' key:   fullscreen=${await isFs()} (expect true)`);
await page.keyboard.press('f');
await page.waitForTimeout(500);
console.log(`  after 'f' again: fullscreen=${await isFs()} (expect false)`);

// Navigation still works after leaving fullscreen, and Escape (no fullscreen,
// no notes) closes nothing in the export but must not break the player.
const before = await counter();
await page.keyboard.press('ArrowRight');
await page.waitForTimeout(300);
const after = await counter();
console.log(`  navigation: ${before?.trim()} -> ${after?.trim()}`);

await page.keyboard.press('Escape');
await page.waitForTimeout(300);
console.log(`  after Escape in export: counter=${(await counter())?.trim()} (player stays, as designed)`);

// Notes panel (the canned deck has none, so the button must be absent).
const notesBtn = await page.locator('.ppt-btn[data-act="notes"]').count();
console.log(`  notes button present: ${notesBtn} (0 expected when no page has notes)`);

const errs = [];
page.on('pageerror', (e) => errs.push(e.message));
await page.keyboard.press('t');
await page.keyboard.press('Home');
await page.keyboard.press('End');
await page.waitForTimeout(300);
console.log(`  page errors: ${errs.length === 0 ? 'none' : errs.join(' | ')}`);

await browser.close();
