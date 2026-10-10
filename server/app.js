import path from 'node:path';
import fs from 'node:fs';
import express from 'express';
import { config, publicConfig } from './config.js';
import { createApiRouter } from './routes/generate.js';
import { createExportRouter } from './routes/export.js';
import { rateLimit, requireAccess, sessionHandler, sweepRateLimitBuckets } from './security.js';

/**
 * Build the Express application.
 * In dev, Vite runs in middleware mode inside this very server, so one process
 * and one port serve both the API and the HMR-enabled frontend.
 */
export async function createApp({ dev = config.isDev } = {}) {
  const app = express();
  app.disable('x-powered-by');
  app.set('etag', false);
  app.use(express.json({ limit: '2mb' }));

  // ---------------------------------------------------------------- API -----
  // Session (public): exchanges ACCESS_CODE for an HttpOnly cookie.
  app.all('/api/session', express.json({ limit: '4kb' }), sessionHandler);

  // Everything else under /api needs the access code (when configured).
  app.use('/api', requireAccess);

  // Expensive endpoints are additionally rate limited per client.
  const expensive = rateLimit({
    name: 'generate',
    windowMs: config.rateLimitWindowMs,
    max: config.rateLimitMax
  });
  app.use('/api/generate', expensive);
  app.use('/api/export/pptx', rateLimit({ name: 'pptx', windowMs: config.rateLimitWindowMs, max: config.rateLimitMax }));

  app.use('/api', createApiRouter());
  app.use('/api', createExportRouter());
  app.use('/api', (req, res) => {
    res.status(404).json({ error: { code: 'NOT_FOUND', message: `接口不存在：${req.method} ${req.originalUrl}` } });
  });

  // ------------------------------------------------------------ frontend ----
  if (dev) {
    const { createServer } = await import('vite');
    const vite = await createServer({
      root: config.webRoot,
      configFile: path.join(config.webRoot, '..', 'vite.config.ts'),
      server: { middlewareMode: true },
      appType: 'spa'
    });
    app.use(vite.middlewares);
  } else {
    const dist = config.webDist;
    const indexHtml = path.join(dist, 'index.html');
    if (fs.existsSync(indexHtml)) {
      app.use(express.static(dist, { index: false, maxAge: '1h' }));
      app.use((req, res, next) => {
        if (req.method !== 'GET' && req.method !== 'HEAD') return next();
        res.sendFile(indexHtml);
      });
    } else {
      app.use((req, res) => {
        res
          .status(503)
          .type('html')
          .send(
            '<!doctype html><meta charset="utf-8"><body style="font:16px/1.6 system-ui;padding:40px">' +
              '<h2>前端尚未构建</h2><p>请先运行 <code>npm run build</code>，或用 <code>npm run dev</code> 启动开发模式。</p></body>'
          );
      });
    }
  }

  // -------------------------------------------------------- error handler ---
  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => {
    const status = err.status || err.statusCode || 500;
    if (res.headersSent) {
      if (!res.writableEnded) res.end();
      return;
    }
    if (err.type === 'entity.too.large') {
      return res.status(413).json({ error: { code: 'PAYLOAD_TOO_LARGE', message: '请求体过大。' } });
    }
    if (err instanceof SyntaxError && 'body' in err) {
      return res.status(400).json({ error: { code: 'BAD_JSON', message: '请求体不是合法 JSON。' } });
    }
    console.error('[api error]', err);
    res.status(status).json({ error: { code: 'INTERNAL', message: err.message || '服务器内部错误' } });
  });

  // Housekeeping: drop expired rate-limit buckets (unref so it never blocks exit).
  const sweep = setInterval(() => sweepRateLimitBuckets(), 5 * 60 * 1000);
  if (typeof sweep.unref === 'function') sweep.unref();
  app.locals.rateLimitSweep = sweep;

  return app;
}

export { config, publicConfig };
