/**
 * Public-deployment guards.
 *
 * The backend holds the owner's DeepSeek API key, so a public URL means anyone
 * who finds it can spend the owner's credit. Two independent layers:
 *
 *   1. ACCESS_CODE  — a shared secret; unauthenticated API calls get 401.
 *                     The browser exchanges it for an HttpOnly cookie, the mini
 *                     program sends it as an `X-Access-Code` header.
 *   2. rate limiting — per-client sliding window on the expensive endpoints.
 *
 * Both are opt-in/opt-out through .env, and both are off when ACCESS_CODE is
 * unset and RATE_LIMIT_MAX=0.
 */

import crypto from 'node:crypto';
import { config } from './config.js';

export const SESSION_COOKIE = 'ppt_access';

/** Paths that must stay reachable without the code. */
const OPEN_PATHS = new Set(['/health', '/session']);

/* ------------------------------------------------------------ access code */

export function accessRequired() {
  return Boolean(config.accessCode);
}

/** Constant-time comparison against the configured code. */
export function codeMatches(input) {
  if (!accessRequired()) return true;
  if (typeof input !== 'string' || !input) return false;
  const a = Buffer.from(input, 'utf8');
  const b = Buffer.from(config.accessCode, 'utf8');
  if (a.length !== b.length) return false;
  try {
    return crypto.timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

/**
 * Value stored in the cookie: an HMAC of the code, so the cookie never carries
 * the code itself and cannot be forged without knowing it.
 */
export function sessionToken() {
  if (!accessRequired()) return '';
  return crypto
    .createHmac('sha256', config.accessCode)
    .update('ai-ppt-access-v1')
    .digest('hex');
}

export function tokenMatches(input) {
  const expected = sessionToken();
  if (!expected) return true;
  if (typeof input !== 'string' || input.length !== expected.length) return false;
  try {
    return crypto.timingSafeEqual(Buffer.from(input), Buffer.from(expected));
  } catch {
    return false;
  }
}

function parseCookies(header) {
  const out = {};
  if (typeof header !== 'string' || !header) return out;
  for (const part of header.split(';')) {
    const idx = part.indexOf('=');
    if (idx < 0) continue;
    const key = part.slice(0, idx).trim();
    const value = part.slice(idx + 1).trim();
    if (key) out[key] = decodeURIComponent(value);
  }
  return out;
}

export function requestHasAccess(req) {
  if (!accessRequired()) return true;
  // Header (mini program, curl, scripts): accept either the raw code or the
  // session token. The mini program has no cookie jar, so it sends the code it
  // was configured with; browsers use the HttpOnly cookie, which only ever
  // carries the HMAC.
  const header = req.headers['x-access-code'];
  if (typeof header === 'string' && header) {
    if (codeMatches(header) || tokenMatches(header)) return true;
  }
  const cookies = parseCookies(req.headers.cookie);
  return tokenMatches(cookies[SESSION_COOKIE]);
}

/* --------------------------------------------------------------- middleware */

/** Guard for everything under /api (except OPEN_PATHS). */
export function requireAccess(req, res, next) {
  if (!accessRequired()) return next();
  if (OPEN_PATHS.has(req.path) || OPEN_PATHS.has(req.path.replace(/\/$/, ''))) return next();
  if (requestHasAccess(req)) return next();
  res.status(401).json({
    error: {
      code: 'ACCESS_REQUIRED',
      message: '需要访问码才能使用（本项目部署在公网，用于防止 API 额度被滥用）。'
    }
  });
}

/** Mounts GET/POST/DELETE /api/session. */
export function sessionHandler(req, res) {
  if (req.method === 'GET') {
    return res.json({ required: accessRequired(), ok: requestHasAccess(req) });
  }
  if (req.method === 'DELETE') {
    res.setHeader(
      'Set-Cookie',
      `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`
    );
    return res.json({ required: accessRequired(), ok: !accessRequired() });
  }
  // POST — exchange the code for a session cookie
  if (!accessRequired()) return res.json({ required: false, ok: true, token: '' });
  const code = req.body && typeof req.body === 'object' ? req.body.code : '';
  if (!codeMatches(code)) {
    return res.status(401).json({ error: { code: 'BAD_ACCESS_CODE', message: '访问码不正确。' } });
  }
  const token = sessionToken();
  res.setHeader(
    'Set-Cookie',
    `${SESSION_COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${60 * 60 * 24 * 30}`
  );
  // The token is also returned so non-browser clients (mini program, scripts)
  // can authenticate with `X-Access-Code: <token>` instead of the raw code.
  return res.json({ required: true, ok: true, token });
}

/* ----------------------------------------------------------- client address */

const LOOPBACK = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1']);
const PRIVATE_HOST = /^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/;

/**
 * Real client address.
 *
 * Behind `cloudflared` every request arrives from loopback, so the socket
 * address would collapse all visitors into one bucket. We therefore trust the
 * tunnel headers ONLY when the connection itself came from loopback — a client
 * on the LAN cannot spoof them.
 */
export function clientIp(req) {
  const socketIp = req.socket?.remoteAddress || '';
  const fromLocalProxy = LOOPBACK.has(socketIp);
  if (config.trustProxy || fromLocalProxy) {
    const cf = req.headers['cf-connecting-ip'];
    if (typeof cf === 'string' && cf.trim()) return cf.trim();
    const xff = req.headers['x-forwarded-for'];
    if (typeof xff === 'string' && xff.trim()) return xff.split(',')[0].trim();
  }
  return socketIp || 'unknown';
}

/**
 * True only for the owner's own machine/LAN.
 *
 * A loopback socket is NOT enough: tunnels such as localhost.run connect from
 * loopback and do not forward the visitor IP, so every public visitor would
 * look local — and the local exemption would silently disable rate limiting for
 * the whole internet. The Host header disambiguates: direct local/LAN access
 * uses localhost or a private address, a tunnel uses a public hostname.
 */
export function isLocalDirectRequest(req) {
  const ip = clientIp(req);
  if (!LOOPBACK.has(ip)) return false;
  const host = String(req.headers?.host || '').split(':')[0].toLowerCase();
  if (!host) return true;
  if (host === 'localhost' || host === '127.0.0.1' || host === '[::1]' || host === '::1') return true;
  return PRIVATE_HOST.test(host);
}

/* -------------------------------------------------------------- rate limit */

const buckets = new Map();

export function rateLimit({ name, windowMs, max }) {
  return function rateLimitMiddleware(req, res, next) {
    if (!max || max <= 0) return next();
    const ip = clientIp(req);
    if (config.rateLimitExemptLocal && isLocalDirectRequest(req)) return next();

    const key = `${name}:${ip}`;
    const now = Date.now();
    let bucket = buckets.get(key);
    if (!bucket || now >= bucket.resetAt) {
      bucket = { count: 0, resetAt: now + windowMs };
      buckets.set(key, bucket);
    }
    bucket.count += 1;

    const remaining = Math.max(0, max - bucket.count);
    res.setHeader('X-RateLimit-Limit', String(max));
    res.setHeader('X-RateLimit-Remaining', String(remaining));
    res.setHeader('X-RateLimit-Reset', String(Math.ceil(bucket.resetAt / 1000)));

    if (bucket.count > max) {
      const retryAfter = Math.max(1, Math.ceil((bucket.resetAt - now) / 1000));
      res.setHeader('Retry-After', String(retryAfter));
      return res.status(429).json({
        error: {
          code: 'RATE_LIMITED',
          message: `请求过于频繁：${Math.round(windowMs / 60000)} 分钟内最多 ${max} 次，请 ${retryAfter} 秒后再试。`
        }
      });
    }
    return next();
  };
}

/** Drop expired buckets so the map cannot grow forever. */
export function sweepRateLimitBuckets(now = Date.now()) {
  let removed = 0;
  for (const [key, bucket] of buckets) {
    if (now >= bucket.resetAt) {
      buckets.delete(key);
      removed += 1;
    }
  }
  return removed;
}

export function resetRateLimits() {
  buckets.clear();
}

export function rateLimitStats() {
  return { buckets: buckets.size };
}
