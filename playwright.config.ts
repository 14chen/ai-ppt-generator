import { defineConfig, devices } from '@playwright/test';

/**
 * Browser E2E suite.
 *
 * It drives a real production build of the app (Express serving dist/) wired to
 * a local mock of the OpenAI-compatible endpoint, so runs are fast, offline and
 * deterministic. The real API is exercised separately by `npm run test:live`.
 *
 * Browsers: we reuse the already-installed Microsoft Edge via `channel: 'msedge'`
 * so no browser download is required.
 */
export default defineConfig({
  testDir: './tests/e2e',
  outputDir: './test-results/playwright',
  timeout: 90_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [['list']],
  use: {
    baseURL: 'http://127.0.0.1:8790',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'off',
    acceptDownloads: true
  },
  projects: [
    {
      name: 'desktop-edge',
      use: {
        ...devices['Desktop Edge'],
        channel: 'msedge',
        viewport: { width: 1440, height: 900 }
      }
    }
  ],
  webServer: [
    {
      command: 'node tests/helpers/mock-server.js',
      url: 'http://127.0.0.1:8791/health',
      reuseExistingServer: false,
      timeout: 30_000,
      stdout: 'pipe',
      stderr: 'pipe'
    },
    {
      command: 'node tests/helpers/e2e-server.js',
      url: 'http://127.0.0.1:8790/api/health',
      reuseExistingServer: false,
      timeout: 60_000,
      stdout: 'pipe',
      stderr: 'pipe'
    },
    {
      // Same app, but with ACCESS_CODE set, for tests/e2e/access.spec.ts
      command: 'node tests/helpers/gate-server.js',
      url: 'http://127.0.0.1:8792/api/health',
      reuseExistingServer: false,
      timeout: 60_000,
      stdout: 'pipe',
      stderr: 'pipe'
    }
  ]
});
