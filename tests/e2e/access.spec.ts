import { test, expect } from '@playwright/test';

/**
 * The access gate, against a server started with ACCESS_CODE=e2e-secret-code.
 */
const CODE = process.env.E2E_ACCESS_CODE || 'e2e-secret-code';
const BASE = 'http://127.0.0.1:8792';

test.use({ baseURL: BASE });

const SAMPLE_TEXT =
  '季度业务复盘：收入同比增长 32%，获客成本下降 18%，续费率提升到 91%。' +
  '下一步要补齐渠道覆盖，并在第二季度扩张团队。这是一段足够长的测试文案。';

test.describe('访问码门禁', () => {
  test('未解锁时只显示门禁，接口返回 401', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByTestId('access-code')).toBeVisible();
    await expect(page.getByRole('heading', { name: 'AI 网页 PPT 生成器' })).toBeVisible();
    // The editor must not be reachable before unlocking.
    await expect(page.getByTestId('source-text')).toHaveCount(0);

    const res = await page.request.post(`${BASE}/api/generate`, { data: { text: SAMPLE_TEXT } });
    expect(res.status()).toBe(401);
    expect((await res.json()).error.code).toBe('ACCESS_REQUIRED');
  });

  test('错误的访问码会给出提示，正确的访问码进入应用', async ({ page }) => {
    await page.goto('/');
    await page.getByTestId('access-code').fill('wrong-code');
    await page.getByTestId('access-submit').click();
    await expect(page.getByTestId('access-error')).toContainText('访问码不正确');
    await expect(page.getByTestId('source-text')).toHaveCount(0);

    await page.getByTestId('access-code').fill(CODE);
    await page.getByTestId('access-submit').click();
    await expect(page.getByTestId('source-text')).toBeVisible({ timeout: 10000 });
    await expect(page.getByTestId('generate')).toBeDisabled(); // empty text
  });

  test('解锁后可以正常生成，退出后重新上锁', async ({ page }) => {
    await page.goto('/');
    await page.getByTestId('access-code').fill(CODE);
    await page.getByTestId('access-submit').click();
    await expect(page.getByTestId('source-text')).toBeVisible({ timeout: 10000 });

    await page.getByTestId('source-text').fill(SAMPLE_TEXT);
    await page.getByTestId('generate').click();
    await expect(page.getByTestId('deck-grid')).toBeVisible({ timeout: 30_000 });
    await expect(page.getByTestId('deck-grid').locator('[data-testid="slide-thumb"]')).toHaveCount(5);

    // A reload keeps the session (cookie).
    await page.reload();
    await expect(page.getByTestId('source-text')).toBeVisible({ timeout: 10_000 });

    // Signing out locks it again.
    await page.getByRole('button', { name: '退出访问' }).click();
    await expect(page.getByTestId('access-code')).toBeVisible({ timeout: 10_000 });
    await page.reload();
    await expect(page.getByTestId('access-code')).toBeVisible();
  });

  test('cookie 是 HttpOnly，脚本读不到', async ({ page, context }) => {
    await page.goto('/');
    await page.getByTestId('access-code').fill(CODE);
    await page.getByTestId('access-submit').click();
    await expect(page.getByTestId('source-text')).toBeVisible({ timeout: 10_000 });

    const cookies = await context.cookies(BASE);
    const session = cookies.find((c) => c.name === 'ppt_access');
    expect(session).toBeTruthy();
    expect(session!.httpOnly).toBe(true);
    expect(await page.evaluate(() => document.cookie)).not.toContain('ppt_access');
  });
});
