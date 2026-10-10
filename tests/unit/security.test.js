import test, { afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { config } from '../../server/config.js';
import {
  accessRequired,
  clientIp,
  codeMatches,
  isLocalDirectRequest,
  rateLimit,
  requestHasAccess,
  resetRateLimits,
  sessionToken,
  sweepRateLimitBuckets,
  tokenMatches,
  SESSION_COOKIE
} from '../../server/security.js';

const savedCode = config.accessCode;
const savedTrust = config.trustProxy;

afterEach(() => {
  config.accessCode = savedCode;
  config.trustProxy = savedTrust;
  resetRateLimits();
});

/* --------------------------------------------------------------- the code */

test('security: no ACCESS_CODE means no gate at all', () => {
  config.accessCode = '';
  assert.equal(accessRequired(), false);
  assert.equal(codeMatches(''), true);
  assert.equal(codeMatches('anything'), true);
  assert.equal(sessionToken(), '');
  assert.equal(tokenMatches('whatever'), true);
  assert.equal(requestHasAccess({ headers: {} }), true);
});

test('security: the code is compared exactly (and constant-time safely)', () => {
  config.accessCode = 'super-secret-2024';
  assert.equal(accessRequired(), true);
  assert.equal(codeMatches('super-secret-2024'), true);
  assert.equal(codeMatches('super-secret-2025'), false);
  assert.equal(codeMatches('super-secret'), false, 'prefix must not pass');
  assert.equal(codeMatches(''), false);
  assert.equal(codeMatches(undefined), false);
  assert.equal(codeMatches(12345), false);
  assert.equal(codeMatches('另一个很长的访问码不同长度'), false);
});

test('security: the session cookie carries an HMAC, not the code', () => {
  config.accessCode = 'my-code';
  const token = sessionToken();
  assert.match(token, /^[0-9a-f]{64}$/);
  assert.ok(!token.includes('my-code'), 'the cookie must not embed the raw code');
  assert.equal(tokenMatches(token), true);
  assert.equal(tokenMatches(token.slice(0, -1) + '0'), false);
  assert.equal(tokenMatches(''), false);

  config.accessCode = 'a-different-code';
  assert.notEqual(sessionToken(), token, 'a different code must produce a different token');
});

test('security: access via cookie or header, rejected otherwise', () => {
  config.accessCode = 'let-me-in';
  const token = sessionToken();

  assert.equal(requestHasAccess({ headers: {} }), false);
  assert.equal(requestHasAccess({ headers: { [SESSION_COOKIE]: 'wrong' } }), false);
  assert.equal(requestHasAccess({ headers: { cookie: `${SESSION_COOKIE}=${token}` } }), true);
  assert.equal(requestHasAccess({ headers: { cookie: `other=1; ${SESSION_COOKIE}=${token}; x=2` } }), true);
  // header accepts the token (scripts) …
  assert.equal(requestHasAccess({ headers: { 'x-access-code': token } }), true);
  // … and the raw code, because the mini program has no cookie jar
  assert.equal(requestHasAccess({ headers: { 'x-access-code': 'let-me-in' } }), true);
  assert.equal(requestHasAccess({ headers: { 'x-access-code': 'wrong' } }), false);
  // the cookie must never be satisfiable with the raw code
  assert.equal(requestHasAccess({ headers: { cookie: `${SESSION_COOKIE}=let-me-in` } }), false);
});

/* ------------------------------------------------------------ client addr */

test('security: tunnel headers are trusted only from a local proxy', () => {
  config.trustProxy = false;
  // cloudflared connects from loopback and sets CF-Connecting-IP
  assert.equal(
    clientIp({ socket: { remoteAddress: '127.0.0.1' }, headers: { 'cf-connecting-ip': '203.0.113.9' } }),
    '203.0.113.9'
  );
  assert.equal(
    clientIp({ socket: { remoteAddress: '::ffff:127.0.0.1' }, headers: { 'x-forwarded-for': '198.51.100.4, 10.0.0.1' } }),
    '198.51.100.4'
  );
  // A LAN client must NOT be able to spoof the header to dodge rate limits.
  assert.equal(
    clientIp({ socket: { remoteAddress: '192.168.1.50' }, headers: { 'cf-connecting-ip': '203.0.113.9' } }),
    '192.168.1.50'
  );
  // Direct loopback traffic with no headers
  assert.equal(clientIp({ socket: { remoteAddress: '127.0.0.1' }, headers: {} }), '127.0.0.1');
});

test('security: trustProxy forces header trust from any peer', () => {
  config.trustProxy = true;
  assert.equal(
    clientIp({ socket: { remoteAddress: '192.168.1.50' }, headers: { 'cf-connecting-ip': '203.0.113.9' } }),
    '203.0.113.9'
  );
});

/* --------------------------------------------------------- local exemption */

test('security: local exemption covers the owner machine only', () => {
  // Direct localhost — the owner
  assert.equal(isLocalDirectRequest({ socket: { remoteAddress: '127.0.0.1' }, headers: { host: '127.0.0.1:8787' } }), true);
  assert.equal(isLocalDirectRequest({ socket: { remoteAddress: '::1' }, headers: { host: 'localhost:8787' } }), true);
  assert.equal(isLocalDirectRequest({ socket: { remoteAddress: '127.0.0.1' }, headers: { host: '192.168.1.15:8787' } }), true);
  // A colleague on the LAN is a different person: counted, not exempt
  assert.equal(
    isLocalDirectRequest({ socket: { remoteAddress: '192.168.1.20' }, headers: { host: '192.168.1.15:8787' } }),
    false
  );
  // Through a tunnel that hides the client IP: loopback socket, public Host
  assert.equal(
    isLocalDirectRequest({ socket: { remoteAddress: '127.0.0.1' }, headers: { host: '15e61ea22bd291.lhr.life' } }),
    false,
    'tunneled traffic must NOT be exempt or the whole internet shares one free bucket'
  );
  // cloudflared: real client IP is visible, so it is not local either
  assert.equal(
    isLocalDirectRequest({
      socket: { remoteAddress: '127.0.0.1' },
      headers: { host: 'abc.trycloudflare.com', 'cf-connecting-ip': '203.0.113.5' }
    }),
    false
  );
});

test('security: tunneled traffic is actually counted against the limit', () => {
  config.rateLimitExemptLocal = true;
  const limit = rateLimit({ name: 'tunnel', windowMs: 60000, max: 2 });

  const tunneled = () => ({
    socket: { remoteAddress: '127.0.0.1' },
    headers: { host: 'example.lhr.life' }
  });
  assert.equal(run(limit, tunneled()).passed, true);
  assert.equal(run(limit, tunneled()).passed, true);
  const { res, passed } = run(limit, tunneled());
  assert.equal(passed, false, 'the 3rd tunneled request must be limited even though the socket is loopback');
  assert.equal(res.statusCode, 429);

  // while the owner, hitting it directly, is still exempt
  assert.equal(run(limit, { socket: { remoteAddress: '127.0.0.1' }, headers: { host: '127.0.0.1:8787' } }).passed, true);
});

/* ------------------------------------------------------------ rate limit */

function fakeReq(ip, headers = {}) {
  return { socket: { remoteAddress: ip }, headers };
}

function fakeRes() {
  return {
    statusCode: 200,
    headers: {},
    body: null,
    setHeader(k, v) {
      this.headers[k.toLowerCase()] = v;
    },
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(payload) {
      this.body = payload;
      return this;
    }
  };
}

function run(middleware, req) {
  const res = fakeRes();
  let passed = false;
  middleware(req, res, () => {
    passed = true;
  });
  return { res, passed };
}

test('security: rate limit allows up to max then answers 429', () => {
  config.rateLimitExemptLocal = false;
  const limit = rateLimit({ name: 'unit', windowMs: 60000, max: 3 });
  const req = fakeReq('203.0.113.1');

  for (let i = 1; i <= 3; i += 1) {
    const { res, passed } = run(limit, req);
    assert.equal(passed, true, `request ${i} should pass`);
    assert.equal(res.headers['x-ratelimit-remaining'], String(3 - i));
  }

  const { res, passed } = run(limit, req);
  assert.equal(passed, false);
  assert.equal(res.statusCode, 429);
  assert.equal(res.body.error.code, 'RATE_LIMITED');
  assert.ok(Number(res.headers['retry-after']) >= 1);
  assert.match(res.body.error.message, /请求过于频繁/);
});

test('security: rate limit buckets are per client', () => {
  config.rateLimitExemptLocal = false;
  const limit = rateLimit({ name: 'perclient', windowMs: 60000, max: 1 });
  assert.equal(run(limit, fakeReq('203.0.113.1')).passed, true);
  assert.equal(run(limit, fakeReq('203.0.113.1')).passed, false);
  assert.equal(run(limit, fakeReq('203.0.113.2')).passed, true, 'a different client has its own budget');
});

test('security: the window resets', async () => {
  config.rateLimitExemptLocal = false;
  const limit = rateLimit({ name: 'window', windowMs: 60, max: 1 });
  assert.equal(run(limit, fakeReq('203.0.113.7')).passed, true);
  assert.equal(run(limit, fakeReq('203.0.113.7')).passed, false);
  await new Promise((r) => setTimeout(r, 80));
  assert.equal(run(limit, fakeReq('203.0.113.7')).passed, true, 'bucket should have expired');
});

test('security: loopback is exempt by default (the owner is never blocked)', () => {
  config.rateLimitExemptLocal = true;
  const limit = rateLimit({ name: 'exempt', windowMs: 60000, max: 1 });
  for (let i = 0; i < 5; i += 1) {
    assert.equal(run(limit, fakeReq('127.0.0.1')).passed, true);
  }
});

test('security: max=0 disables rate limiting entirely', () => {
  const limit = rateLimit({ name: 'off', windowMs: 60000, max: 0 });
  for (let i = 0; i < 20; i += 1) assert.equal(run(limit, fakeReq('203.0.113.9')).passed, true);
});

test('security: expired buckets are swept', () => {
  config.rateLimitExemptLocal = false;
  const limit = rateLimit({ name: 'sweep', windowMs: 50, max: 1 });
  run(limit, fakeReq('198.51.100.1'));
  run(limit, fakeReq('198.51.100.2'));
  assert.equal(sweepRateLimitBuckets(Date.now()), 0, 'nothing expired yet');
  assert.equal(sweepRateLimitBuckets(Date.now() + 1000), 2, 'both buckets should be collected');
});
