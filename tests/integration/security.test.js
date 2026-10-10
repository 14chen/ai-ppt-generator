/**
 * Integration tests for the public-deployment guards: the ACCESS_CODE gate and
 * per-client rate limiting, exercised through the real Express app.
 */
import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createApp } from '../../server/app.js';
import { config } from '../../server/config.js';
import { resetRateLimits, SESSION_COOKIE, sessionToken } from '../../server/security.js';
import { startMockUpstream } from '../helpers/mock-upstream.js';

const CODE = 'code-for-integration-test';

let server;
let base;
let mock;
let saved;

before(async () => {
  saved = {
    accessCode: config.accessCode,
    rateLimitMax: config.rateLimitMax,
    rateLimitWindowMs: config.rateLimitWindowMs,
    rateLimitExemptLocal: config.rateLimitExemptLocal,
    baseUrl: config.baseUrl,
    apiKey: config.apiKey
  };
  mock = await startMockUpstream({ delayMs: 1 });
  config.baseUrl = mock.baseUrl;
  config.apiKey = 'security-test-key';
  config.accessCode = CODE;
  config.rateLimitMax = 3;
  config.rateLimitWindowMs = 60000;
  config.rateLimitExemptLocal = false;

  const app = await createApp({ dev: false });
  server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  base = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  Object.assign(config, saved);
  resetRateLimits();
  await new Promise((resolve) => server.close(resolve));
  await mock.close();
});

const TEXT = '这是一段足够长的测试文案，用来验证访问码门禁与限流是否生效，包含中文字符。';

test('session probe reports that access is required and currently missing', async () => {
  const res = await fetch(`${base}/api/session`);
  assert.equal(res.status, 200);
  const data = await res.json();
  assert.equal(data.required, true);
  assert.equal(data.ok, false);
});

test('health stays public (so the UI can show the model before unlocking)', async () => {
  const res = await fetch(`${base}/api/health`);
  assert.equal(res.status, 200);
  const data = await res.json();
  assert.equal(data.ok, true);
  assert.equal(data.accessRequired, true);
});

test('protected endpoints answer 401 without a code', async () => {
  for (const [method, url] of [
    ['POST', '/api/generate'],
    ['POST', '/api/export/pptx'],
    ['GET', '/api/miniprogram/code'],
    ['GET', '/api/export/formats']
  ]) {
    const res = await fetch(`${base}${url}`, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: method === 'POST' ? JSON.stringify({ text: TEXT, deck: { slides: [] } }) : undefined
    });
    assert.equal(res.status, 401, `${method} ${url} should require the code`);
    assert.equal((await res.json()).error.code, 'ACCESS_REQUIRED');
  }
});

test('a wrong code is rejected, the right code returns a session cookie', async () => {
  let res = await fetch(`${base}/api/session`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ code: 'nope' })
  });
  assert.equal(res.status, 401);
  assert.equal((await res.json()).error.code, 'BAD_ACCESS_CODE');

  res = await fetch(`${base}/api/session`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ code: CODE })
  });
  assert.equal(res.status, 200);
  const setCookie = res.headers.get('set-cookie');
  assert.ok(setCookie, 'expected a Set-Cookie header');
  assert.ok(setCookie.includes(`${SESSION_COOKIE}=`));
  assert.match(setCookie, /HttpOnly/i, 'the session cookie must not be readable from JS');
  assert.match(setCookie, /SameSite=Lax/i);

  const cookie = setCookie.split(';')[0];

  // The cookie now unlocks the API.
  const health = await fetch(`${base}/api/session`, { headers: { cookie } });
  assert.equal((await health.json()).ok, true);

  const formats = await fetch(`${base}/api/export/formats`, { headers: { cookie } });
  assert.equal(formats.status, 200);
});

test('the header form works too (this is how the mini program authenticates)', async () => {
  // session token
  const res = await fetch(`${base}/api/export/formats`, { headers: { 'X-Access-Code': sessionToken() } });
  assert.equal(res.status, 200);

  // raw code — the mini program only has the code in its config file
  const raw = await fetch(`${base}/api/export/formats`, { headers: { 'X-Access-Code': CODE } });
  assert.equal(raw.status, 200, 'the mini program sends the raw configured code');

  const bad = await fetch(`${base}/api/export/formats`, { headers: { 'X-Access-Code': 'guessed' } });
  assert.equal(bad.status, 401);
});

test('POST /api/session returns the token for non-browser clients', async () => {
  const res = await fetch(`${base}/api/session`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ code: CODE })
  });
  const data = await res.json();
  assert.equal(data.ok, true);
  assert.match(data.token, /^[0-9a-f]{64}$/, 'expected the session token in the body');

  const viaToken = await fetch(`${base}/api/export/formats`, { headers: { 'X-Access-Code': data.token } });
  assert.equal(viaToken.status, 200);
});

test('a full generation works while authenticated', async () => {
  const res = await fetch(`${base}/api/generate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Access-Code': sessionToken() },
    body: JSON.stringify({ text: TEXT, options: { targetSlides: 6 } })
  });
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-type'), /text\/event-stream/);
  const body = await res.text();
  assert.ok(body.includes('event: done'), 'expected the stream to finish');
});

test('rate limiting kicks in after the configured number of requests', async () => {
  resetRateLimits();
  const headers = { 'Content-Type': 'application/json', 'X-Access-Code': sessionToken() };
  const bad = () => fetch(`${base}/api/generate`, { method: 'POST', headers, body: JSON.stringify({ text: 'x' }) });

  // max is 3: the first three reach validation (400 for short text), the 4th is 429.
  const codes = [];
  for (let i = 0; i < 4; i += 1) codes.push((await bad()).status);
  assert.deepEqual(codes.slice(0, 3), [400, 400, 400]);
  assert.equal(codes[3], 429, `expected the 4th request to be limited, got ${codes.join(',')}`);

  const limited = await bad();
  const payload = await limited.json();
  assert.equal(payload.error.code, 'RATE_LIMITED');
  assert.ok(Number(limited.headers.get('retry-after')) > 0);
  assert.equal(limited.headers.get('x-ratelimit-remaining'), '0');
});

test('rate limits are per client, and tunnel headers identify the client', async () => {
  resetRateLimits();
  const headers = (ip) => ({ 'Content-Type': 'application/json', 'X-Access-Code': sessionToken(), 'CF-Connecting-IP': ip });
  const bad = (ip) => fetch(`${base}/api/generate`, { method: 'POST', headers: headers(ip), body: JSON.stringify({ text: 'x' }) });

  for (let i = 0; i < 3; i += 1) assert.equal((await bad('203.0.113.10')).status, 400);
  assert.equal((await bad('203.0.113.10')).status, 429, 'client A is limited');
  assert.equal((await bad('203.0.113.11')).status, 400, 'client B still has budget');
});

test('signing out clears the session cookie', async () => {
  const res = await fetch(`${base}/api/session`, { method: 'DELETE' });
  assert.equal(res.status, 200);
  const setCookie = res.headers.get('set-cookie');
  assert.ok(setCookie.includes('Max-Age=0'), 'the cookie must be expired');
  assert.equal((await res.json()).ok, false);
});

test('when ACCESS_CODE is removed the gate opens again', async () => {
  resetRateLimits();
  config.accessCode = '';
  const res = await fetch(`${base}/api/export/formats`);
  assert.equal(res.status, 200);
  const session = await (await fetch(`${base}/api/session`)).json();
  assert.equal(session.required, false);
  assert.equal(session.ok, true);
  config.accessCode = CODE;
});
