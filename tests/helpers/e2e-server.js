/**
 * Boots the real production Express app against the mock upstream for the
 * Playwright suite. Values are set before importing config.js so that they win
 * over .env (process.env takes precedence in Node's loadEnvFile).
 */
process.env.PORT = process.env.E2E_PORT || '8790';
process.env.HOST = '127.0.0.1';
process.env.DEEPSEEK_BASE_URL = process.env.E2E_UPSTREAM || 'http://127.0.0.1:8791/v1';
process.env.DEEPSEEK_API_KEY = 'e2e-test-key';
process.env.DEEPSEEK_MODEL = 'deepseek-v4-pro';
process.env.DEEPSEEK_EFFORT = 'low';

const { createApp } = await import('../../server/app.js');
const { config } = await import('../../server/config.js');

const app = await createApp({ dev: false });
const server = app.listen(config.port, config.host, () => {
  console.log(`[e2e-app] listening on http://${config.host}:${config.port} -> upstream ${config.baseUrl}`);
});

const shutdown = () => server.close(() => process.exit(0));
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
