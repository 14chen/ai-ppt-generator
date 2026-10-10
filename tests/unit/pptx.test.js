import test from 'node:test';
import assert from 'node:assert/strict';
import JSZip from 'jszip';
import { buildPptxBuffer, estimateLines, CANVAS_H, CANVAS_W } from '../../server/pptx.js';
import { normalizeDeck } from '../../server/deck.js';
import { allThemes, getTheme } from '../../server/themes.js';
import { assertWellFormedXml, drawingText } from '../helpers/xml.js';

const RAW_SLIDES = [
  { layout: 'cover', title: '季度业务复盘', subtitle: '2024 Q3 · 数据与行动', bullets: ['调研节选', '覆盖 412 家企业'] },
  { layout: 'section', title: '规模化现状', subtitle: '过去 18 个月' },
  { layout: 'bullets', title: '关键结论', icon: '🎯', bullets: ['收入同比增长 32%', '获客成本下降 18%', '续费率提升到 91%'], notes: '这一页讲慢一点' },
  { layout: 'stats', title: '核心指标', stats: [{ value: '32%', label: '收入同比' }, { value: '91%', label: '续费率' }] },
  {
    layout: 'two-column',
    title: '优势与挑战',
    columns: [
      { heading: '优势', items: ['口碑领先', '交付效率高'] },
      { heading: '挑战', items: ['渠道覆盖不足', '人才结构单一'] }
    ]
  },
  { layout: 'timeline', title: '下一步节奏', steps: [{ title: 'Q1', detail: '补齐渠道' }, { title: 'Q2', detail: '扩张团队' }] },
  { layout: 'quote', title: '', quote: { text: '增长来自复利，而不是爆发。', author: '内部复盘' } },
  { layout: 'closing', title: '谢谢观看', subtitle: '欢迎提问' }
];

function makeDeck(themeId = 'midnight') {
  return normalizeDeck({
    rawSlides: RAW_SLIDES,
    meta: { title: '季度业务复盘', subtitle: '2024 Q3' },
    theme: themeId,
    maxSlides: 24
  });
}

async function renderDeck(themeId = 'midnight') {
  const deck = makeDeck(themeId);
  const buffer = await buildPptxBuffer(deck, { theme: themeId });
  const zip = await JSZip.loadAsync(buffer);
  return { deck, buffer, zip };
}

test('pptx: produces a real ZIP with the required OOXML parts', async () => {
  const { deck, buffer, zip } = await renderDeck();
  assert.equal(buffer.subarray(0, 2).toString('latin1'), 'PK', 'must be a zip archive');

  const names = Object.keys(zip.files);
  for (const required of [
    '[Content_Types].xml',
    '_rels/.rels',
    'ppt/presentation.xml',
    'ppt/_rels/presentation.xml.rels',
    'docProps/core.xml',
    'docProps/app.xml'
  ]) {
    assert.ok(names.includes(required), `missing ${required}`);
  }
  assert.ok(names.some((n) => /^ppt\/slideMasters\/slideMaster\d+\.xml$/.test(n)), 'missing slide master');
  assert.ok(names.some((n) => /^ppt\/theme\/theme\d+\.xml$/.test(n)), 'missing theme part');

  const slideParts = names.filter((n) => /^ppt\/slides\/slide\d+\.xml$/.test(n));
  assert.equal(slideParts.length, deck.slides.length, 'one slide part per deck page');
  assert.ok(names.some((n) => /^ppt\/notesSlides\/notesSlide\d+\.xml$/.test(n)), 'notes part missing for a slide with notes');
});

test('pptx: every XML part is well-formed', async () => {
  const { zip } = await renderDeck();
  let checked = 0;
  for (const [name, file] of Object.entries(zip.files)) {
    if (file.dir || !name.endsWith('.xml') && !name.endsWith('.rels')) continue;
    const xml = await file.async('string');
    assertWellFormedXml(xml, name);
    checked += 1;
  }
  assert.ok(checked >= 10, `expected to validate many parts, only checked ${checked}`);
});

test('pptx: page size is a real 16:9 widescreen (13.333 x 7.5 in)', async () => {
  const { zip } = await renderDeck();
  const presentation = await zip.file('ppt/presentation.xml').async('string');
  const match = presentation.match(/<p:sldSz[^>]*cx="(\d+)"[^>]*cy="(\d+)"/);
  assert.ok(match, 'p:sldSz not found');
  const cx = Number(match[1]);
  const cy = Number(match[2]);
  assert.equal(cx, 12192000, '13.3333 in in EMU');
  assert.equal(cy, 6858000, '7.5 in in EMU');
  assert.equal(Math.round((cx / cy) * 100) / 100, 1.78, 'aspect ratio ≈ 16:9');
  assert.equal(CANVAS_W / CANVAS_H, 1280 / 720);
});

test('pptx: content of every page lands in the right slide part', async () => {
  const { deck, zip } = await renderDeck();
  for (let i = 0; i < deck.slides.length; i += 1) {
    const xml = await zip.file(`ppt/slides/slide${i + 1}.xml`).async('string');
    const text = drawingText(xml);
    const slide = deck.slides[i];
    if (slide.title) {
      assert.ok(text.includes(slide.title), `slide ${i + 1} (${slide.layout}) is missing its title "${slide.title}"`);
    }
    if (slide.bullets?.length) {
      for (const bullet of slide.bullets) {
        assert.ok(text.includes(bullet), `slide ${i + 1} missing bullet "${bullet}"`);
      }
    }
    if (slide.stats?.length) {
      for (const stat of slide.stats) {
        assert.ok(text.includes(stat.value), `slide ${i + 1} missing stat value "${stat.value}"`);
        assert.ok(text.includes(stat.label), `slide ${i + 1} missing stat label "${stat.label}"`);
      }
    }
    if (slide.columns?.length) {
      for (const col of slide.columns) {
        assert.ok(text.includes(col.heading), `slide ${i + 1} missing column heading "${col.heading}"`);
        for (const item of col.items) assert.ok(text.includes(item), `slide ${i + 1} missing column item "${item}"`);
      }
    }
    if (slide.steps?.length) {
      for (const step of slide.steps) {
        assert.ok(text.includes(step.title), `slide ${i + 1} missing step "${step.title}"`);
        if (step.detail) assert.ok(text.includes(step.detail), `slide ${i + 1} missing step detail`);
      }
    }
    if (slide.quote?.text) {
      assert.ok(text.includes(slide.quote.text), `slide ${i + 1} missing the quote`);
      assert.ok(text.includes(slide.quote.author), `slide ${i + 1} missing the quote author`);
    }
  }
});

test('pptx: speaker notes are exported', async () => {
  const { deck, zip } = await renderDeck();
  const index = deck.slides.findIndex((s) => s.notes);
  assert.ok(index >= 0, 'fixture must contain a slide with notes');
  const noteXml = await zip.file(`ppt/notesSlides/notesSlide${index + 1}.xml`).async('string');
  assert.ok(noteXml.includes(deck.slides[index].notes), 'note text missing from the notes part');
});

test('pptx: CJK text uses an explicit east-asian font (no tofu)', async () => {
  const { zip } = await renderDeck();
  const xml = await zip.file('ppt/slides/slide1.xml').async('string');
  const eaFonts = [...xml.matchAll(/<a:ea typeface="([^"]+)"/g)].map((m) => m[1]);
  assert.ok(eaFonts.length > 0, 'no <a:ea> font was emitted — CJK would render as tofu');
  assert.ok(eaFonts.every((f) => f && f.length > 0));
  const latinFonts = [...xml.matchAll(/<a:latin typeface="([^"]+)"/g)].map((m) => m[1]);
  assert.ok(latinFonts.length > 0, 'no <a:latin> font emitted');
});

test('pptx: theme colours are baked in (all five themes build)', async () => {
  const themes = allThemes();
  assert.ok(themes.length >= 3);
  for (const theme of themes) {
    const { buffer, zip } = await renderDeck(theme.id);
    assert.ok(buffer.length > 20000, `${theme.id}: suspiciously small pptx`);
    const slide1 = await zip.file('ppt/slides/slide1.xml').async('string');
    const accent = theme.vars['ppt-accent'].replace('#', '').toUpperCase();
    assert.ok(
      slide1.toUpperCase().includes(accent),
      `${theme.id}: accent colour ${accent} not present in the exported slide`
    );
  }
});

test('pptx: text is never silently dropped for long content', async () => {
  const longBullet = '这是一条比较长的要点'.repeat(8); // 80 CJK chars
  const deck = normalizeDeck({
    rawSlides: [
      { layout: 'cover', title: '长文本测试' },
      { layout: 'bullets', title: '很长的标题'.repeat(6), bullets: [longBullet, longBullet] }
    ],
    meta: { title: '长文本测试' },
    theme: 'paper'
  });
  const buffer = await buildPptxBuffer(deck, { theme: 'paper' });
  const zip = await JSZip.loadAsync(buffer);
  const text = drawingText(await zip.file('ppt/slides/slide2.xml').async('string'));
  assert.ok(text.includes(deck.slides[1].title), 'long title was dropped');
  const firstBullet = deck.slides[1].bullets[0];
  assert.ok(text.includes(firstBullet), 'long bullet was dropped');
});

test('pptx: an empty deck is rejected with a clear error', async () => {
  await assert.rejects(() => buildPptxBuffer({ slides: [] }, { theme: 'paper' }), /没有任何页面/);
});

test('pptx: estimateLines handles latin, CJK and mixed text', () => {
  assert.equal(estimateLines('abc', 30, 1000), 1);
  assert.equal(estimateLines('中文'.repeat(40), 30, 1200), 2);
  assert.ok(estimateLines('a'.repeat(200), 20, 500) >= 5);
  assert.equal(estimateLines('', 20, 500), 1);
});

test('pptx: unknown theme id falls back to the first theme instead of throwing', async () => {
  const deck = normalizeDeck({ rawSlides: RAW_SLIDES, meta: {}, theme: 'does-not-exist', maxSlides: 24 });
  const buffer = await buildPptxBuffer(deck, { theme: 'does-not-exist' });
  const zip = await JSZip.loadAsync(buffer);
  assert.ok(zip.file('ppt/presentation.xml'));
  assert.equal(getTheme('does-not-exist').id, allThemes()[0].id);
});
