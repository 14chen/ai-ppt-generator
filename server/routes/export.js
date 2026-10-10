/**
 * Export endpoints.
 *
 *  POST /api/export/pptx          deck -> real .pptx (Office Open XML)
 *  GET  /api/export/formats       what this server can produce
 *  GET  /api/miniprogram/code     小程序码 (needs WX_APPID/WX_SECRET) or H5 QR fallback
 *  GET  /api/miniprogram/qr.png    raw PNG of the same QR code
 *  GET  /api/network               LAN address, handy for the mini program config
 */

import { Router } from 'express';
import os from 'node:os';
import QRCode from 'qrcode';
import { config } from '../config.js';
import { buildPptxBuffer } from '../pptx.js';
import { normalizeDeck } from '../deck.js';
import { themeIds } from '../themes.js';
import { clientIp } from '../security.js';

const PPTX_MIME = 'application/vnd.openxmlformats-officedocument.presentationml.presentation';

/* ------------------------------------------------------------------ helpers */

/** File name that is safe on Windows/macOS and still readable. */
export function safeFileName(title, ext, fallback = 'AI-PPT') {
  const base = String(title || '')
    .replace(/[\\/:*?"<>|\r\n\t]+/g, ' ')
    .replace(/\s+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
  return `${base || fallback}.${ext}`;
}

/**
 * RFC 6266 needs a plain-ASCII `filename=` for old clients. A title made only of
 * CJK characters would reduce to ".pptx" (a hidden, nameless file), so fall back
 * to a real name in that case.
 */
function asciiFallback(name, ext = 'pptx') {
  const base = String(name).replace(/\.[^.]+$/, '');
  const ascii = base.replace(/[^\x20-\x7E]/g, '').replace(/["\\]/g, '').trim();
  const cleaned = ascii.replace(/^[^A-Za-z0-9]+/, '');
  return /[A-Za-z0-9]/.test(cleaned) ? `${cleaned}.${ext}` : `presentation.${ext}`;
}

/** First private IPv4 of this machine (what a phone on the same Wi-Fi can reach). */
export function lanAddress() {
  const nets = os.networkInterfaces();
  const candidates = [];
  for (const list of Object.values(nets)) {
    for (const net of list ?? []) {
      if (net.family !== 'IPv4' || net.internal) continue;
      candidates.push(net.address);
    }
  }
  const isPrivate = (ip) =>
    /^10\./.test(ip) || /^192\.168\./.test(ip) || /^172\.(1[6-9]|2\d|3[01])\./.test(ip);
  return candidates.find(isPrivate) || candidates[0] || '127.0.0.1';
}

export function publicOrigin(req) {
  if (config.publicUrl) return config.publicUrl.replace(/\/+$/, '');
  const host = req?.headers?.host;
  // Prefer the LAN address: a phone scanning the QR is not "localhost".
  const lan = `http://${lanAddress()}:${config.port}`;
  if (!host) return lan;
  if (/^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/i.test(host)) return lan;
  return `http://${host}`;
}

/* -------------------------------------------------------- WeChat 小程序码 */

/**
 * access_token cache. Keyed by appid+secret: if the credentials change (env
 * reload, different account, tests) a token minted for the previous account must
 * never be reused.
 */
let tokenCache = { key: '', value: '', expiresAt: 0 };

async function wxAccessToken() {
  const key = `${config.wxAppId}:${config.wxSecret}`;
  if (tokenCache.value && tokenCache.key === key && Date.now() < tokenCache.expiresAt) {
    return tokenCache.value;
  }
  const url =
    `${config.wxApiBase}/cgi-bin/token?grant_type=client_credential` +
    `&appid=${encodeURIComponent(config.wxAppId)}&secret=${encodeURIComponent(config.wxSecret)}`;
  const res = await fetch(url, { signal: AbortSignal.timeout(15000) });
  const data = await res.json().catch(() => ({}));
  if (!data.access_token) {
    tokenCache = { key: '', value: '', expiresAt: 0 };
    throw new Error(`获取 access_token 失败：${data.errmsg || res.status} (errcode ${data.errcode ?? '?'})`);
  }
  tokenCache = {
    key,
    value: data.access_token,
    expiresAt: Date.now() + (data.expires_in ?? 7200) * 1000 - 300000
  };
  return tokenCache.value;
}

async function wxMiniProgramCode({ scene = 'from=qr', page = config.wxPage } = {}) {
  const token = await wxAccessToken();
  const url = `${config.wxApiBase}/wxa/getwxacodeunlimit?access_token=${encodeURIComponent(token)}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      scene,
      page,
      check_path: false, // allow scanning before the page is published
      env_version: config.wxEnvVersion,
      width: 430,
      auto_color: false,
      line_color: { r: 47, g: 87, b: 230 }
    }),
    signal: AbortSignal.timeout(20000)
  });
  const type = res.headers.get('content-type') || '';
  const buf = Buffer.from(await res.arrayBuffer());
  if (!type.includes('image')) {
    let detail = buf.toString('utf8').slice(0, 300);
    try {
      const parsed = JSON.parse(detail);
      detail = `${parsed.errmsg || 'unknown'} (errcode ${parsed.errcode})`;
    } catch {
      /* keep raw */
    }
    throw new Error(`微信返回的不是图片：${detail}`);
  }
  return buf;
}

/** Decide what the scannable code should be, then render it as a PNG buffer. */
async function buildEntryCode(req) {
  const origin = publicOrigin(req);
  const h5Url = `${origin}/`;

  if (config.wxAppId && config.wxSecret) {
    try {
      const png = await wxMiniProgramCode();
      return {
        mode: 'wxacode',
        image: png,
        target: config.wxPage,
        url: '',
        note: '微信扫一扫即可打开小程序',
        hint: ''
      };
    } catch (err) {
      const png = await QRCode.toBuffer(h5Url, qrOptions());
      return {
        mode: 'h5-fallback',
        image: png,
        target: h5Url,
        url: h5Url,
        note: '微信小程序码获取失败，已回退为网页版二维码',
        hint: err.message
      };
    }
  }

  const png = await QRCode.toBuffer(h5Url, qrOptions());
  return {
    mode: 'h5',
    image: png,
    target: h5Url,
    url: h5Url,
    note: '手机扫码直接使用网页版（已适配手机）；配置 WX_APPID / WX_SECRET 后这里会变成小程序码',
    hint: ''
  };
}

function qrOptions() {
  return {
    type: 'png',
    width: 480,
    margin: 2,
    errorCorrectionLevel: 'M',
    color: { dark: '#0B1020FF', light: '#FFFFFFFF' }
  };
}

/* ------------------------------------------------------------------- routes */

export function createExportRouter() {
  const router = Router();

  router.get('/export/formats', (req, res) => {
    res.json({
      formats: [
        { id: 'html', label: '独立 HTML', mime: 'text/html', clientSide: true },
        { id: 'pptx', label: 'PowerPoint (.pptx)', mime: PPTX_MIME, clientSide: false, endpoint: '/api/export/pptx' },
        { id: 'json', label: '结构 JSON', mime: 'application/json', clientSide: true }
      ],
      themes: themeIds()
    });
  });

  router.post('/export/pptx', async (req, res, next) => {
    try {
      const body = req.body && typeof req.body === 'object' ? req.body : {};
      const incoming = body.deck;
      if (!incoming || !Array.isArray(incoming.slides) || incoming.slides.length === 0) {
        return res.status(400).json({ error: { code: 'DECK_REQUIRED', message: '缺少有效的 deck（slides 为空）' } });
      }
      if (incoming.slides.length > config.maxSlides) {
        return res
          .status(413)
          .json({ error: { code: 'TOO_MANY_SLIDES', message: `页数超过上限 ${config.maxSlides} 页` } });
      }

      const themeId = themeIds().includes(body.theme)
        ? body.theme
        : themeIds().includes(incoming.theme)
          ? incoming.theme
          : 'paper';

      // Re-normalise the payload: never trust an arbitrary client object.
      const deck = normalizeDeck({
        rawSlides: incoming.slides.slice(0, config.maxSlides),
        meta: { title: incoming.title, subtitle: incoming.subtitle },
        deckTitle: incoming.title || '',
        theme: themeId,
        maxSlides: config.maxSlides,
        source: { model: incoming?.meta?.model ?? config.model, sourceChars: incoming?.meta?.sourceChars ?? null }
      });

      const buffer = await buildPptxBuffer(deck, { theme: themeId });
      const filename = safeFileName(deck.title, 'pptx', 'AI-ppt');
      res.setHeader('Content-Type', PPTX_MIME);
      res.setHeader(
        'Content-Disposition',
        `attachment; filename="${asciiFallback(filename)}"; filename*=UTF-8''${encodeURIComponent(filename)}`
      );
      res.setHeader('Content-Length', String(buffer.length));
      res.setHeader('X-Slide-Count', String(deck.slides.length));
      res.setHeader('X-Theme', themeId);
      res.end(buffer);
    } catch (err) {
      next(err);
    }
  });

  router.get('/miniprogram/code', async (req, res, next) => {
    try {
      const code = await buildEntryCode(req);
      res.json({
        mode: code.mode,
        target: code.target,
        url: code.url,
        note: code.note,
        hint: code.hint,
        page: config.wxPage,
        envVersion: config.wxEnvVersion,
        hasWxCredentials: Boolean(config.wxAppId && config.wxSecret),
        lanUrl: `http://${lanAddress()}:${config.port}`,
        apiBase: config.miniprogramApiBase || `http://${lanAddress()}:${config.port}`,
        image: `data:image/png;base64,${code.image.toString('base64')}`
      });
    } catch (err) {
      next(err);
    }
  });

  router.get('/miniprogram/qr.png', async (req, res, next) => {
    try {
      const code = await buildEntryCode(req);
      res.setHeader('Content-Type', 'image/png');
      res.setHeader('Cache-Control', 'no-store');
      res.end(code.image);
    } catch (err) {
      next(err);
    }
  });

  router.get('/network', (req, res) => {
    res.json({
      lan: `http://${lanAddress()}:${config.port}`,
      origin: publicOrigin(req),
      port: config.port,
      host: config.host,
      /** What to paste into miniprogram/config.js */
      miniprogramApiBase: config.miniprogramApiBase || `http://${lanAddress()}:${config.port}`,
      /** Diagnostics: proves whether per-client rate limiting can see real clients. */
      yourIp: clientIp(req),
      socketIp: req.socket?.remoteAddress || '',
      forwardedFor: req.headers['x-forwarded-for'] || '',
      cfConnectingIp: req.headers['cf-connecting-ip'] || '',
      rateLimit: config.rateLimitMax > 0 ? { max: config.rateLimitMax, windowMs: config.rateLimitWindowMs, exemptLocal: config.rateLimitExemptLocal } : null,
      note: '小程序需要 HTTPS 合法域名才能正式发布；开发阶段可在微信开发者工具中勾选「不校验合法域名」'
    });
  });

  return router;
}
