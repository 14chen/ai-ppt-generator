import test from 'node:test';
import assert from 'node:assert/strict';
import { LAYOUTS, normalizeDeck, normalizeSlide, toBullets, looksLikeSlide } from '../../server/deck.js';

test('normalises a messy slide object into the canonical shape', () => {
  const slide = normalizeSlide(
    {
      layout: '要点',
      heading: '  本期关键结论  ',
      points: ['收入同比增长 32%。', '获客成本下降 18%', '续费率提升到 91%'],
      notes: '讲慢一点'
    },
    1
  );
  assert.equal(slide.layout, 'bullets');
  assert.equal(slide.title, '本期关键结论');
  assert.deepEqual(slide.bullets, ['收入同比增长 32%', '获客成本下降 18%', '续费率提升到 91%']);
  assert.equal(slide.notes, '讲慢一点');
});

test('infers layouts from the payload when `layout` is missing', () => {
  assert.equal(normalizeSlide({ title: 'A', stats: [{ value: '1', label: 'x' }] }, 1).layout, 'stats');
  assert.equal(normalizeSlide({ title: 'A', quote: { text: 'q' } }, 1).layout, 'quote');
  assert.equal(normalizeSlide({ title: 'A', steps: ['s1', 's2'] }, 1).layout, 'timeline');
  assert.equal(
    normalizeSlide({ title: 'A', columns: [{ heading: 'L', items: ['a'] }, { heading: 'R', items: ['b'] }] }, 1).layout,
    'two-column'
  );
  assert.equal(normalizeSlide({ title: 'A', bullets: ['x'] }, 1).layout, 'bullets');
  assert.equal(normalizeSlide({ title: '只有标题' }, 1).layout, 'section');
  assert.equal(normalizeSlide({ title: '封面' }, 0).layout, 'cover');
});

test('degrades gracefully when the payload cannot support the requested layout', () => {
  assert.equal(normalizeSlide({ layout: 'stats', title: 'A', bullets: ['x'] }, 1).layout, 'bullets');
  assert.equal(normalizeSlide({ layout: 'timeline', title: 'A' }, 1).layout, 'section');
  assert.equal(normalizeSlide({ layout: 'quote', title: 'A', bullets: ['x'] }, 1).layout, 'bullets');
});

test('parses bullets from a single string with separators', () => {
  assert.deepEqual(toBullets('第一点；第二点；第三点'), ['第一点', '第二点', '第三点']);
  assert.deepEqual(toBullets('1. 甲\n2. 乙\n3. 丙'), ['甲', '乙', '丙']);
});

test('parses stats from an object map and a string list', () => {
  const a = normalizeSlide({ layout: 'stats', title: 'T', stats: { '68%': '收入同比' } }, 1);
  assert.deepEqual(a.stats, [{ value: '68%', label: '收入同比' }]);
  const b = normalizeSlide({ layout: 'stats', title: 'T', stats: ['3.2x：增长倍数'] }, 1);
  assert.equal(b.stats[0].value, '3.2x');
});

test('clamps oversized content to the model limits', () => {
  const many = Array.from({ length: 20 }, (_, i) => `要点 ${i}`.repeat(60));
  const slide = normalizeSlide({ layout: 'bullets', title: 'x'.repeat(300), bullets: many }, 1);
  assert.ok(slide.title.length <= 60);
  assert.ok(slide.bullets.length <= 6);
  assert.ok(slide.bullets.every((b) => b.length <= 120));
});

test('rejects non-slide objects', () => {
  assert.equal(looksLikeSlide({ type: 'meta', slideCount: 8 }), false);
  assert.equal(looksLikeSlide({ slides: [{ title: 'a' }] }), false);
  assert.equal(looksLikeSlide({}), false);
  assert.equal(looksLikeSlide({ title: 'ok' }), true);
});

test('builds a deck with bookends, dedupe and stable indices', () => {
  const deck = normalizeDeck({
    rawSlides: [
      { title: '内容一', bullets: ['a'] },
      { title: '内容一', bullets: ['a'] }, // duplicate
      { title: '内容二', bullets: ['b'] }
    ],
    meta: { title: '总标题', subtitle: '副标题', slideCount: 3 },
    theme: 'midnight',
    maxSlides: 24
  });
  assert.equal(deck.title, '总标题');
  assert.equal(deck.theme, 'midnight');
  assert.equal(deck.slides[0].layout, 'cover');
  assert.equal(deck.slides[deck.slides.length - 1].layout, 'closing');
  assert.deepEqual(deck.slides.map((s) => s.index), [0, 1, 2, 3]);
  const titles = deck.slides.map((s) => s.title);
  assert.equal(titles.filter((t) => t === '内容一').length, 1);
  assert.ok(LAYOUTS.includes(deck.slides[0].layout));
});

test('respects the slide cap even with bookends', () => {
  const raw = Array.from({ length: 40 }, (_, i) => ({ layout: 'bullets', title: `页 ${i}`, bullets: ['x'] }));
  const deck = normalizeDeck({ rawSlides: raw, meta: null, theme: 'paper', maxSlides: 5 });
  assert.ok(deck.slides.length <= 5, `expected <= 5, got ${deck.slides.length}`);
});

test('drops empty slides entirely', () => {
  const deck = normalizeDeck({ rawSlides: [{}, { title: '有效页', bullets: ['x'] }], meta: null, theme: 'paper' });
  assert.ok(deck.slides.every((s) => s.title || s.bullets?.length || s.layout === 'closing'));
});

test('quotes can be a bare string', () => {
  const slide = normalizeSlide({ layout: 'quote', quote: '简单即是终极的复杂', author: '达芬奇' }, 1);
  assert.equal(slide.quote.text, '简单即是终极的复杂');
  assert.equal(slide.quote.author, '达芬奇');
});
