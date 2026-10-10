import { Router } from 'express';
import { config, publicConfig } from '../config.js';
import { AppError, streamChatCompletion } from '../deepseek.js';
import { buildMessages } from '../prompt.js';
import { createSlideStreamParser } from '../parser.js';
import { normalizeDeck } from '../deck.js';

/** Coalesce high-frequency token events to keep the browser comfortable. */
const FLUSH_INTERVAL_MS = 110;
const FLUSH_CHARS = 600;
const HEARTBEAT_MS = 15000;

export function createApiRouter() {
  const router = Router();

  router.get('/health', (req, res) => {
    res.json({ ok: true, ...publicConfig() });
  });

  /**
   * POST /api/generate  { text, options: { targetSlides, language, theme } }
   *
   * Responds with text/event-stream. Event names:
   *   status | meta | slide | progress | reasoning | raw | usage | done | error
   */
  router.post('/generate', async (req, res, next) => {
    const body = req.body && typeof req.body === 'object' ? req.body : {};
    const text = typeof body.text === 'string' ? body.text.trim() : '';
    const options = body.options && typeof body.options === 'object' ? body.options : {};

    // --- validation (plain JSON, before switching to the SSE stream) ---------
    if (!text) {
      return res.status(400).json({ error: { code: 'TEXT_REQUIRED', message: '请先粘贴需要转换的文案。' } });
    }
    if (text.length < config.minChars) {
      return res.status(400).json({
        error: { code: 'TEXT_TOO_SHORT', message: `文案太短了，至少需要 ${config.minChars} 个字符。` }
      });
    }
    if (text.length > config.maxChars) {
      return res.status(413).json({
        error: { code: 'TEXT_TOO_LONG', message: `文案太长了（${text.length} 字），最多 ${config.maxChars} 字，请分段生成。` }
      });
    }
    if (!config.apiKey) {
      return res.status(503).json({
        error: { code: 'NO_API_KEY', message: '服务器未配置 DEEPSEEK_API_KEY，请在项目根目录 .env 中设置后重启。' }
      });
    }

    const targetSlides = Math.max(3, Math.min(Number(options.targetSlides) || 10, config.maxSlides));
    const language = ['auto', 'zh', 'en'].includes(options.language) ? options.language : 'auto';
    const theme = typeof options.theme === 'string' && options.theme ? options.theme : 'paper';

    // --- SSE plumbing -------------------------------------------------------
    res.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no'
    });
    if (typeof res.flushHeaders === 'function') res.flushHeaders();
    res.write(`retry: 3000\n\n`);

    const startedAt = Date.now();
    let done = false;
    let closed = false;
    const abort = new AbortController();

    const send = (event, data) => {
      if (closed || res.writableEnded) return;
      try {
        res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
      } catch {
        closed = true;
      }
    };

    const heartbeat = setInterval(() => {
      if (closed || res.writableEnded) return;
      try {
        res.write(': ping\n\n');
      } catch {
        closed = true;
      }
    }, HEARTBEAT_MS);

    res.on('close', () => {
      closed = true;
      if (!done) abort.abort();
    });

    // --- coalesced token buffers -------------------------------------------
    let pendingReasoning = '';
    let pendingRaw = '';
    let flushTimer = null;
    let reasoningChars = 0;
    let contentChars = 0;
    let usage = null;

    const flush = () => {
      if (flushTimer) {
        clearTimeout(flushTimer);
        flushTimer = null;
      }
      if (pendingReasoning) {
        send('reasoning', { text: pendingReasoning });
        pendingReasoning = '';
      }
      if (pendingRaw) {
        send('raw', { text: pendingRaw });
        pendingRaw = '';
      }
    };

    const scheduleFlush = () => {
      if (pendingReasoning.length + pendingRaw.length >= FLUSH_CHARS) {
        flush();
        return;
      }
      if (!flushTimer) flushTimer = setTimeout(flush, FLUSH_INTERVAL_MS);
    };

    let parsedSlides = 0;
    const emitProgress = (extra = {}) => {
      send('progress', {
        slides: parsedSlides,
        total: parser.meta?.slideCount ?? null,
        reasoningChars,
        contentChars,
        elapsedMs: Date.now() - startedAt,
        tokens: usage?.total_tokens ?? null,
        ...extra
      });
    };

    const parser = createSlideStreamParser({ maxSlides: config.maxSlides });

    send('status', { stage: 'connecting', message: `正在连接 ${config.model} …` });
    emitProgress();

    try {
      const messages = buildMessages({ text, targetSlides, language, maxSlides: config.maxSlides });
      const upstream = streamChatCompletion({
        config,
        messages,
        signal: abort.signal,
        effort: options.effort || config.effort
      });

      send('status', { stage: 'thinking', message: 'AI 正在阅读文案并规划页面结构 …' });

      for await (const chunk of upstream) {
        if (closed) break;

        if (chunk.type === 'reasoning') {
          reasoningChars += chunk.text.length;
          pendingReasoning += chunk.text;
          scheduleFlush();
          continue;
        }
        if (chunk.type === 'usage') {
          usage = chunk.usage;
          continue;
        }
        if (chunk.type === 'finish') continue;
        if (chunk.type !== 'content') continue;

        contentChars += chunk.text.length;
        pendingRaw += chunk.text;

        const events = parser.feed(chunk.text);
        if (events.length) flush();
        for (const ev of events) {
          if (ev.type === 'meta') {
            send('meta', { meta: ev.meta });
          } else if (ev.type === 'slide') {
            parsedSlides += 1;
            send('slide', { index: parsedSlides - 1, slide: ev.slide, count: parsedSlides });
          }
        }
        if (events.length) emitProgress();
        else scheduleFlush();
      }

      flush();
      done = true;

      const { rawSlides, meta, fromWholeBuffer } = parser.finish();
      const deck = normalizeDeck({
        rawSlides,
        meta,
        deckTitle: meta?.title || '',
        theme,
        maxSlides: config.maxSlides,
        source: {
          model: config.model,
          sourceChars: text.length,
          elapsedMs: Date.now() - startedAt,
          fromWholeBuffer,
          usage: usage ?? null
        }
      });

      if (!deck.slides.length) {
        send('error', {
          code: 'EMPTY_RESULT',
          message: 'AI 没有返回可解析的页面内容，请重试或换一段文案。',
          partial: true
        });
      } else {
        send('usage', { usage: usage ?? null, elapsedMs: Date.now() - startedAt });
        send('done', { deck });
      }
    } catch (err) {
      flush();
      done = true;
      if (abort.signal.aborted && closed) {
        // client went away; nothing to report
      } else {
        const appError =
          err instanceof AppError
            ? err
            : new AppError('INTERNAL', err?.message || '生成失败', 500);
        send('error', { code: appError.code, message: appError.message });
      }
    } finally {
      done = true;
      clearInterval(heartbeat);
      if (flushTimer) clearTimeout(flushTimer);
      if (!res.writableEnded) res.end();
    }
  });

  return router;
}
