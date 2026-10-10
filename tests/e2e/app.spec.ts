import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import jsQR from 'jsqr';
import { PNG } from 'pngjs';

/** Decode a base64 PNG data-URL QR code exactly like a camera app would. */
function decodeQrDataUrl(dataUrl: string): string | null {
  const png = PNG.sync.read(Buffer.from(dataUrl.split(',')[1], 'base64'));
  const result = jsQR(new Uint8ClampedArray(png.data), png.width, png.height);
  return result ? result.data : null;
}

const SAMPLE_TEXT =
  '季度业务复盘：收入同比增长 32%，获客成本下降 18%，续费率提升到 91%。' +
  '下一步要补齐渠道覆盖，并在第二季度扩张团队，同时把交付周期压缩到两周以内。这是一段足够长的测试文案。';

/** The canned mock deck has 5 slides: cover, bullets, stats, two-column, closing. */
const EXPECTED_SLIDES = 5;

async function generateDeck(page: import('@playwright/test').Page, text = SAMPLE_TEXT) {
  await page.getByTestId('source-text').fill(text);
  await expect(page.getByTestId('generate')).toBeEnabled();
  await page.getByTestId('generate').click();
}

test.describe('AI 网页 PPT 生成器 · 端到端', () => {
  test('完整流程：输入文案 → 流式进度 → 预览 → 演示翻页 → 主题切换', async ({ page }) => {
    await page.goto('/');

    // --- editor -----------------------------------------------------------
    await expect(page.getByRole('heading', { name: '粘贴你的长文案' })).toBeVisible();
    await expect(page.locator('.model-badge')).toContainText('deepseek-v4-pro');

    // Generate stays disabled until the text is long enough.
    await page.getByTestId('source-text').fill('太短');
    await expect(page.getByTestId('generate')).toBeDisabled();

    await generateDeck(page);

    // --- streaming progress ----------------------------------------------
    const progress = page.getByTestId('progress-view');
    await expect(progress).toBeVisible();
    await expect(page.getByTestId('stage-log')).toContainText('正在连接');

    // Slides must appear in the live preview before the deck is finished.
    const live = page.getByTestId('live-slides').locator('[data-testid="slide-thumb"]');
    await expect(live.first()).toBeVisible({ timeout: 20_000 });
    await expect(page.getByTestId('deck-grid')).toBeHidden();

    // --- finished deck ----------------------------------------------------
    const grid = page.getByTestId('deck-grid');
    await expect(grid).toBeVisible({ timeout: 30_000 });
    await expect(grid.locator('[data-testid="slide-thumb"]')).toHaveCount(EXPECTED_SLIDES);
    await expect(page.getByTestId('page-indicator')).toHaveText(`1 / ${EXPECTED_SLIDES}`);

    // Selecting a thumbnail drives the big preview.
    await page.getByTestId('deck-item-2').click();
    await expect(page.getByTestId('page-indicator')).toHaveText(`3 / ${EXPECTED_SLIDES}`);

    // --- presentation mode ------------------------------------------------
    await page.getByTestId('present').click();
    const overlay = page.getByTestId('player-overlay');
    await expect(overlay).toBeVisible();
    await expect(overlay.locator('.ppt-slide')).toHaveCount(EXPECTED_SLIDES);

    const counter = overlay.locator('.ppt-counter');
    await expect(counter).toHaveText(`1 / ${EXPECTED_SLIDES}`);
    await expect(overlay.locator('.ppt-slide.is-active')).toHaveAttribute('data-layout', 'cover');

    await page.keyboard.press('ArrowRight');
    await expect(counter).toHaveText(`2 / ${EXPECTED_SLIDES}`);
    await expect(overlay.locator('.ppt-slide.is-active')).toHaveAttribute('data-layout', 'bullets');

    await page.keyboard.press('Space');
    await expect(counter).toHaveText(`3 / ${EXPECTED_SLIDES}`);
    await page.keyboard.press('ArrowLeft');
    await expect(counter).toHaveText(`2 / ${EXPECTED_SLIDES}`);
    await page.keyboard.press('End');
    await expect(counter).toHaveText(`${EXPECTED_SLIDES} / ${EXPECTED_SLIDES}`);
    await page.keyboard.press('Home');
    await expect(counter).toHaveText(`1 / ${EXPECTED_SLIDES}`);

    // Progress dots jump straight to a page.
    await overlay.locator('.ppt-dot').nth(3).click();
    await expect(counter).toHaveText(`4 / ${EXPECTED_SLIDES}`);

    // --- theme cycling in the player --------------------------------------
    const host = overlay.locator('[data-ppt-theme]');
    const themeBefore = await host.getAttribute('data-ppt-theme');
    await page.keyboard.press('t');
    await expect(host).not.toHaveAttribute('data-ppt-theme', themeBefore ?? '');
    await expect(page.locator('[data-ppt-theme]').first()).toHaveAttribute('data-ppt-theme', /.+/);

    // --- leaving the presentation ----------------------------------------
    await page.keyboard.press('Escape');
    await expect(overlay).toBeHidden();
    await expect(grid).toBeVisible();
  });

  test('可以随时取消生成并回到编辑器', async ({ page }) => {
    await page.goto('/');
    await generateDeck(page);
    await expect(page.getByTestId('progress-view')).toBeVisible();
    await page.getByTestId('cancel').click();
    await expect(page.getByTestId('progress-view')).toBeHidden();
    await expect(page.getByTestId('source-text')).toHaveValue(SAMPLE_TEXT);
    await expect(page.getByTestId('generate')).toBeEnabled();
  });

  test('导出独立 HTML：单文件、离线可演示、键控翻页正常', async ({ page }) => {
    await page.goto('/');
    await generateDeck(page);
    await expect(page.getByTestId('deck-grid')).toBeVisible({ timeout: 30_000 });

    await page.getByTestId('export-menu').click();
    const downloadPromise = page.waitForEvent('download');
    await page.getByTestId('export-html').click();
    const download = await downloadPromise;

    expect(download.suggestedFilename()).toMatch(/\.html$/);
    const outDir = path.resolve('test-results');
    fs.mkdirSync(outDir, { recursive: true });
    const target = path.join(outDir, 'exported-deck.html');
    await download.saveAs(target);
    await expect(page.getByTestId('toast')).toContainText('已导出');

    const html = fs.readFileSync(target, 'utf8');
    expect(html).toContain('window.PPTPlayer');
    expect(html).toContain('"slides"');
    // fully self-contained: no external scripts, styles or network requests
    expect(html).not.toMatch(/<script[^>]+src=/i);
    expect(html).not.toMatch(/<link[^>]+stylesheet/i);
    expect(html).not.toMatch(/https?:\/\/[^\s"']+\.(js|css|woff2?|png|jpg|svg)/i);
    expect(html).toContain('data-ppt-theme');

    // --- open the exported file straight from disk -------------------------
    const fileUrl = `file:///${target.replace(/\\/g, '/')}`;
    await page.goto(fileUrl);
    await expect(page.locator('.ppt-slide')).toHaveCount(EXPECTED_SLIDES);
    const counter = page.locator('.ppt-counter');
    await expect(counter).toHaveText(`1 / ${EXPECTED_SLIDES}`);
    await expect(page.locator('.ppt-slide.is-active')).toHaveAttribute('data-layout', 'cover');

    await page.keyboard.press('ArrowRight');
    await expect(counter).toHaveText(`2 / ${EXPECTED_SLIDES}`);

    // Themes are baked in and still switchable offline.
    const themed = page.locator('[data-ppt-theme]').first();
    const before = await themed.getAttribute('data-ppt-theme');
    await page.keyboard.press('t');
    await expect(themed).not.toHaveAttribute('data-ppt-theme', before ?? '');

    // The deck data survived the round-trip.
    await expect(page).toHaveTitle(/模拟演示/);
  });

  test('模型输出中的 HTML 会被转义（不会执行脚本）', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));

    await page.goto('/');
    await generateDeck(page, `XSS 检查：这是一段足够长的测试文案，用来验证转义是否生效。${'补充内容。'.repeat(6)}`);
    await expect(page.getByTestId('deck-grid')).toBeVisible({ timeout: 30_000 });

    expect(await page.evaluate(() => (window as unknown as { __XSS__?: number }).__XSS__)).toBeUndefined();
    await expect(page.getByTestId('deck-grid')).toContainText('<script>');
    await expect(page.getByTestId('deck-grid').locator('img[src="x"]')).toHaveCount(0);
    expect(errors).toEqual([]);

    // The same payload must not be able to break out of the exported file.
    await page.getByTestId('export-menu').click();
    const downloadPromise = page.waitForEvent('download');
    await page.getByTestId('export-html').click();
    const download = await downloadPromise;
    const target = path.resolve('test-results', 'exported-xss.html');
    fs.mkdirSync(path.dirname(target), { recursive: true });
    await download.saveAs(target);
    const html = fs.readFileSync(target, 'utf8');
    expect(html).toContain('\\u003cscript');
    expect(html).not.toContain('</script>封面');

    await page.goto(`file:///${target.replace(/\\/g, '/')}`);
    await expect(page.locator('.ppt-slide.is-active')).toBeVisible();
    expect(await page.evaluate(() => (window as unknown as { __XSS__?: number }).__XSS__)).toBeUndefined();
  });

  test('移动端视口：布局不溢出、演示自适应、支持滑动手势', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/');

    await generateDeck(page);
    await expect(page.getByTestId('deck-grid')).toBeVisible({ timeout: 30_000 });

    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth
    );
    expect(overflow).toBeLessThanOrEqual(1);

    await page.getByTestId('present').click();
    const overlay = page.getByTestId('player-overlay');
    await expect(overlay).toBeVisible();

    // The 1280x720 design canvas is scaled down to fit the phone viewport.
    const canvas = overlay.locator('.ppt-canvas');
    const box = await canvas.boundingBox();
    expect(box).not.toBeNull();
    expect(box!.width).toBeLessThanOrEqual(391);
    expect(box!.height).toBeLessThanOrEqual(845);

    const counter = overlay.locator('.ppt-counter');
    await expect(counter).toHaveText(`1 / ${EXPECTED_SLIDES}`);

    // Swipe left -> next page (synthetic touch events).
    await page.evaluate(() => {
      const stage = document.querySelector('.ppt-stage');
      if (!stage) throw new Error('no stage');
      const fire = (type: string, x: number) => {
        const touch = new Touch({ identifier: 1, target: stage as Element, clientX: x, clientY: 200 });
        stage.dispatchEvent(
          new TouchEvent(type, {
            bubbles: true,
            cancelable: true,
            touches: type === 'touchend' ? [] : [touch],
            changedTouches: [touch]
          })
        );
      };
      fire('touchstart', 320);
      fire('touchend', 80);
    });
    await expect(counter).toHaveText(`2 / ${EXPECTED_SLIDES}`);

    await page.evaluate(() => {
      const stage = document.querySelector('.ppt-stage');
      const fire = (type: string, x: number) => {
        const touch = new Touch({ identifier: 1, target: stage as Element, clientX: x, clientY: 200 });
        stage!.dispatchEvent(
          new TouchEvent(type, {
            bubbles: true,
            cancelable: true,
            touches: type === 'touchend' ? [] : [touch],
            changedTouches: [touch]
          })
        );
      };
      fire('touchstart', 80);
      fire('touchend', 320);
    });
    await expect(counter).toHaveText(`1 / ${EXPECTED_SLIDES}`);

    // The slide is still readable: text is present in the DOM at thumbnail size.
    await page.keyboard.press('Escape');
    await expect(overlay).toBeHidden();
  });

  test('生成过程中显示模型思考与原始输出', async ({ page }) => {
    await page.goto('/');
    await generateDeck(page);
    await page.getByRole('button', { name: '查看模型输出' }).click();
    const raw = page.getByTestId('raw-output');
    await expect(raw).toBeVisible();
    await expect(raw).toContainText('规划页面结构');

    await page.getByRole('button', { name: '原始输出 (NDJSON)' }).click();
    await expect(page.getByTestId('raw-output')).toContainText('"layout"');
  });

  test('导出 PowerPoint (.pptx)：下载的是真正的 Office 文件', async ({ page }) => {
    await page.goto('/');
    await generateDeck(page);
    await expect(page.getByTestId('deck-grid')).toBeVisible({ timeout: 30_000 });

    await page.getByTestId('export-menu').click();
    const downloadPromise = page.waitForEvent('download');
    await page.getByTestId('export-pptx').click();
    const download = await downloadPromise;

    expect(download.suggestedFilename()).toMatch(/\.pptx$/);
    const target = path.resolve('test-results', 'e2e-exported.pptx');
    fs.mkdirSync(path.dirname(target), { recursive: true });
    await download.saveAs(target);
    await expect(page.getByTestId('toast')).toContainText('已导出');

    const buffer = fs.readFileSync(target);
    expect(buffer.length).toBeGreaterThan(20_000);
    expect(buffer.subarray(0, 2).toString('latin1')).toBe('PK');

    // The ZIP central directory must reference the real OOXML parts.
    const names = buffer.toString('latin1');
    expect(names).toContain('[Content_Types].xml');
    expect(names).toContain('ppt/presentation.xml');
    expect(names).toContain('ppt/slides/slide1.xml');
    expect(names).toContain('ppt/slideMasters/slideMaster1.xml');
    // One slide part per page in the deck (the mock deck has 5 pages).
    const slideParts = names.match(/ppt\/slides\/slide\d+\.xml/g) ?? [];
    expect(new Set(slideParts).size).toBe(EXPECTED_SLIDES);
  });

  test('扫码使用：二维码可被真实解码，且指向局域网地址', async ({ page }) => {
    await page.goto('/');
    await page.getByTestId('scan-open').click();

    const modal = page.getByTestId('scan-modal');
    await expect(modal).toBeVisible();
    await expect(modal).toContainText('扫码');

    const src = await page.getByTestId('scan-qr').getAttribute('src');
    expect(src ?? '').toMatch(/^data:image\/png;base64,/);

    // Decoding proves a phone camera could actually read it.
    const decoded = decodeQrDataUrl(src as string);
    expect(decoded).toBeTruthy();
    expect(decoded).toMatch(/^http:\/\/\d+\.\d+\.\d+\.\d+:\d+\/$/);
    await expect(modal).toContainText('miniprogram');

    // The dialog also tells the user what to put into the mini program config.
    const apiBase = await page.evaluate(async () => (await (await fetch('/api/network')).json()).miniprogramApiBase);
    await expect(modal).toContainText(apiBase);

    await page.keyboard.press('Escape');
    await expect(modal).toBeHidden();
  });
});
