/**
 * Standalone mock upstream for the Playwright suite.
 * Speaks the OpenAI /chat/completions streaming protocol and picks a canned
 * deck based on the user text (see tests/helpers/mock-upstream.js).
 */
import { startMockUpstream } from './mock-upstream.js';

const port = Number(process.env.MOCK_PORT || 8791);
const upstream = await startMockUpstream({
  port,
  delayMs: Number(process.env.MOCK_DELAY_MS || 110),
  scenarioFromBody: true
});

console.log(`[mock-upstream] listening on ${upstream.url}/v1`);

const shutdown = async () => {
  await upstream.close();
  process.exit(0);
};

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
