import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createApp } from '../../server/app.js';
import { config } from '../../server/config.js';
import { collectSse } from '../helpers/mock-upstream.js';

/**
 * Live smoke test against the real OpenAI-compatible endpoint
 * (https://api.deepseek.com/v1, model deepseek-v4-pro).
 *
 * Run with: npm run test:live
 * It is deliberately excluded from `npm test` so the default suite stays
 * offline and deterministic.
 */

const SOURCE_TEXT = `2024 年企业级 AI 应用落地调研报告（节选）

过去 18 个月，中国企业级 AI 应用从试点走向规模化。本次调研覆盖 412 家企业，其中 63% 已在至少一个业务环节部署大模型能力，同比提升 27 个百分点；但真正进入生产环境、日均调用超过 10 万次的企业仅占 14%。

典型场景有三类：知识密集型场景（客服知识库、合同审查、研发问答）平均把检索时间从 25 分钟压缩到 90 秒；流程自动化场景（工单分类、票据审核、报表生成）中，某制造企业把月度对账周期从 7 天缩短到 4 小时；创意生成场景则主要降低试错成本。

失败原因方面，58% 的项目源于数据准备不足，31% 源于评价体系缺失，22% 源于组织协同问题。成本结构上，推理成本占比从 61% 降到 38%，而数据治理与工程化投入从 19% 升到 41%。

行动建议：从有明确量化指标的单点场景切入；把数据治理前置；建立技术层与业务层的双层评价体系；用 6 到 8 周完成一次闭环验证再决定是否扩大投入。`;

let server;
let base;

test.before(async () => {
  if (!config.apiKey) {
    throw new Error('缺少 DEEPSEEK_API_KEY，无法运行真实接口测试');
  }
  const app = await createApp({ dev: false });
  server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  base = `http://127.0.0.1:${server.address().port}`;
});

test.after(async () => {
  if (server) await new Promise((resolve) => server.close(resolve));
});

test(
  '真实调用 deepseek-v4-pro：流式拆解出结构化的多页 PPT',
  { timeout: 300000 },
  async () => {
    const started = Date.now();
    const res = await fetch(`${base}/api/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: SOURCE_TEXT, options: { targetSlides: 8, language: 'zh', theme: 'midnight' } })
    });
    assert.equal(res.status, 200);

    const events = await collectSse(res);
    const names = events.map((e) => e.event);
    const done = events.find((e) => e.event === 'done');

    if (!done) {
      const err = events.find((e) => e.event === 'error');
      assert.fail(`no deck produced: ${err ? err.data.message : names.join(',')}`);
    }

    const deck = done.data.deck;
    const elapsed = Date.now() - started;

    // --- report -----------------------------------------------------------------
    console.log(`\n=== 真实接口生成结果 (${(elapsed / 1000).toFixed(1)}s) ===`);
    console.log(`标题: ${deck.title}`);
    console.log(`副标题: ${deck.subtitle || '(无)'}`);
    console.log(`页数: ${deck.slides.length}  声明的页数: ${deck.meta.requested}`);
    console.log(`用量: ${JSON.stringify(deck.meta.usage)}`);
    for (const [i, s] of deck.slides.entries()) {
      console.log(
        `  ${String(i + 1).padStart(2)}. [${s.layout}] ${s.title}` +
          (s.bullets?.length ? ` — ${s.bullets.length} 条要点` : '') +
          (s.stats?.length ? ` — ${s.stats.length} 个数据` : '') +
          (s.columns?.length ? ` — ${s.columns.length} 栏` : '') +
          (s.steps?.length ? ` — ${s.steps.length} 步` : '') +
          (s.quote ? ' — 金句' : '')
      );
      if (s.bullets?.length) console.log(`        ${s.bullets.join(' | ')}`);
      if (s.stats?.length) console.log(`        ${s.stats.map((x) => `${x.value} ${x.label}`).join(' | ')}`);
    }
    console.log('');

    // --- assertions -------------------------------------------------------------
    assert.ok(names.includes('meta'), 'streamed a meta line');
    assert.ok(events.filter((e) => e.event === 'slide').length >= 5, 'streamed page by page');
    assert.ok(deck.slides.length >= 4, `expected >= 4 slides, got ${deck.slides.length}`);
    assert.ok(deck.slides.length <= config.maxSlides);
    assert.equal(deck.slides[0].layout, 'cover');
    assert.equal(deck.slides[deck.slides.length - 1].layout, 'closing');
    assert.ok(deck.title && deck.title.length > 1, 'deck has a title');

    // Every produced page must carry real content.
    for (const slide of deck.slides) {
      const hasContent =
        Boolean(slide.title) ||
        Boolean(slide.bullets?.length) ||
        Boolean(slide.stats?.length) ||
        Boolean(slide.columns?.length) ||
        Boolean(slide.steps?.length) ||
        Boolean(slide.quote);
      assert.ok(hasContent, `slide "${slide.layout}" has no content`);
    }

    // Nothing may be truncated mid-sentence, and no layout may be repeated
    // verbatim from the prompt scaffolding.
    assert.ok(!JSON.stringify(deck).includes('页标题'), 'placeholder text leaked into the deck');

    // The deck must use a variety of layouts, not just bullets.
    const layouts = new Set(deck.slides.map((s) => s.layout));
    assert.ok(layouts.size >= 3, `expected layout variety, got ${[...layouts].join(',')}`);

    assert.ok(deck.meta.usage?.total_tokens > 0, 'token usage reported');
    assert.ok(elapsed < 240000, 'generation finished in a reasonable time');
  }
);

test('真实接口：明显的鉴权失败会被清晰上报', { timeout: 60000 }, async () => {
  const savedKey = config.apiKey;
  config.apiKey = 'sk-invalid-key-for-test';
  try {
    const res = await fetch(`${base}/api/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: SOURCE_TEXT })
    });
    const events = await collectSse(res);
    const err = events.find((e) => e.event === 'error');
    assert.ok(err, 'expected an error event');
    assert.equal(err.data.code, 'UPSTREAM_AUTH');
    console.log(`\n=== 鉴权失败提示 ===\n${err.data.message}\n`);
  } finally {
    config.apiKey = savedKey;
  }
});
