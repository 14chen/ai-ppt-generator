/**
 * Same production app as tests/helpers/e2e-server.js, but with ACCESS_CODE set,
 * so the browser suite can exercise the access gate on its own port.
 */
process.env.PORT = process.env.E2E_GATE_PORT || '8792';
process.env.HOST = '127.0.0.1';
process.env.DEEPSEEK_BASE_URL = process.env.E2E_UPSTREAM || 'http://127.0.0.1:8791/v1';
process.env.DEEPSEEK_API_KEY = 'e2e-test-key';
process.env.DEEPSEEK_MODEL = 'deepseek-v4-pro';
process.env.DEEPSEEK_EFFORT = 'low';
process.env.ACCESS_CODE = process.env.E2E_ACCESS_CODE || 'e2e-secret-code';
process.env.RATE_LIMIT_MAX = process.env.E2E_RATE_LIMIT_MAX || '50';

const { createApp } = await import('../../server/app.js');
const { config } = await import('../../server/config.js');

const app = await createApp({ dev: false });
const server = app.listen(config.port, config.host, () => {
  console.log(`[e2e-gate-app] http://${config.host}:${config.port} (ACCESS_CODE on)`);
});

const shutdown = () => server.close(() => process.exit(0));
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
