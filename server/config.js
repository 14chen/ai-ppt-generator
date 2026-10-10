import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** Project root (the folder that contains server/ and web/). */
export const ROOT = path.resolve(__dirname, '..');

/** Load .env if present (Node >= 20.12 built-in, no dotenv dependency). */
export function loadEnv(file = path.join(ROOT, '.env')) {
  try {
    if (fs.existsSync(file)) process.loadEnvFile(file);
    return true;
  } catch {
    return false;
  }
}

loadEnv();

function num(value, fallback) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

/**
 * Runtime configuration. Kept as a plain mutable object so tests can point
 * `baseUrl` at a local mock upstream.
 */
export const config = {
  port: num(process.env.PORT, 8787),
  host: process.env.HOST || '127.0.0.1',
  isDev: process.argv.includes('--dev') || process.env.NODE_ENV === 'development',

  apiKey: process.env.DEEPSEEK_API_KEY || '',
  baseUrl: (process.env.DEEPSEEK_BASE_URL || 'https://api.deepseek.com/v1').replace(/\/+$/, ''),
  model: process.env.DEEPSEEK_MODEL || 'deepseek-v4-pro',
  /** deepseek-v4-pro is a reasoning model: low effort keeps the deck generation snappy. */
  effort: process.env.DEEPSEEK_EFFORT || 'low',
  temperature: Number(process.env.DEEPSEEK_TEMPERATURE ?? 0.6),
  maxTokens: num(process.env.DEEPSEEK_MAX_TOKENS, 8000),

  /** Input guards. */
  minChars: num(process.env.MIN_CHARS, 20),
  maxChars: num(process.env.MAX_CHARS, 20000),
  maxSlides: num(process.env.MAX_SLIDES, 24),

  /** Timeouts for the upstream call. */
  requestTimeoutMs: num(process.env.REQUEST_TIMEOUT_MS, 300000),
  idleTimeoutMs: num(process.env.IDLE_TIMEOUT_MS, 90000),

  /**
   * WeChat mini program. When WX_APPID + WX_SECRET are present the server can
   * mint a real 小程序码 (scan -> open the mini program). Without them the QR
   * endpoint falls back to an H5 link that phones can open directly.
   */
  wxAppId: process.env.WX_APPID || '',
  wxSecret: process.env.WX_SECRET || '',
  wxApiBase: (process.env.WX_API_BASE || 'https://api.weixin.qq.com').replace(/\/+$/, ''),
  /** release | trial | develop — dev builds need 'develop' + a trial/dev version. */
  wxEnvVersion: process.env.WX_ENV_VERSION || 'release',
  wxPage: process.env.WX_PAGE || 'pages/index/index',
  /** Public origin used by the QR fallback (defaults to the LAN address). */
  publicUrl: process.env.PUBLIC_URL || '',
  /** Where the mini program should point; shown in the QR dialog. */
  miniprogramApiBase: process.env.MINIPROGRAM_API_BASE || '',

  /* --- public deployment guards ---------------------------------------- */
  /** Shared secret. When set, every /api call needs it (cookie or header). */
  accessCode: process.env.ACCESS_CODE || '',
  /** Per-client limit on expensive endpoints (0 disables). */
  rateLimitMax: num(process.env.RATE_LIMIT_MAX, 10),
  rateLimitWindowMs: num(process.env.RATE_LIMIT_WINDOW_MS, 600000),
  /** The owner's own machine is never rate limited. */
  rateLimitExemptLocal: process.env.RATE_LIMIT_EXEMPT_LOCAL !== '0',
  /** Trust X-Forwarded-For / CF-Connecting-IP from any peer (default: only loopback). */
  trustProxy: process.env.TRUST_PROXY === '1' || process.env.TRUST_PROXY === 'true',
  /** Public URL of the tunnel, filled in at runtime by scripts/tunnel.mjs. */
  tunnelUrl: process.env.TUNNEL_URL || '',

  webRoot: path.join(ROOT, 'web'),
  webDist: path.join(ROOT, 'dist'),
  miniprogramRoot: path.join(ROOT, 'miniprogram')
};

export function publicConfig() {
  return {
    model: config.model,
    baseUrl: config.baseUrl,
    effort: config.effort,
    hasApiKey: Boolean(config.apiKey),
    maxSlides: config.maxSlides,
    minChars: config.minChars,
    maxChars: config.maxChars,
    hasWxCredentials: Boolean(config.wxAppId && config.wxSecret),
    accessRequired: Boolean(config.accessCode),
    rateLimit: config.rateLimitMax > 0 ? { max: config.rateLimitMax, windowMs: config.rateLimitWindowMs } : null
  };
}
