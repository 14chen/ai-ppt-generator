import test from 'node:test';
import assert from 'node:assert/strict';
import { createSlideStreamParser } from '../../server/parser.js';
import { normalizeDeck } from '../../server/deck.js';

const meta = '{"type":"meta","title":"季度复盘","subtitle":"2024 Q3","slideCount":3}\n';
const cover = '{"layout":"cover","title":"季度复盘","subtitle":"2024 Q3"}\n';
const bullets = '{"layout":"bullets","title":"关键结论","bullets":["收入增长 32%","获客成本下降 18%"]}\n';
const stats = '{"layout":"stats","title":"核心指标","stats":[{"value":"32%","label":"收入同比"}]}\n';

test('extracts meta and slides from clean NDJSON', () => {
  const parser = createSlideStreamParser({ maxSlides: 24 });
  const events = parser.feed(meta + cover + bullets);
  assert.deepEqual(
    events.map((e) => e.type),
    ['meta', 'slide', 'slide']
  );
  assert.equal(events[0].meta.slideCount, 3);
  assert.equal(events[1].slide.layout, 'cover');
  assert.equal(events[2].slide.bullets.length, 2);
});

test('emits a slide as soon as its closing brace arrives, even mid-token', () => {
  const parser = createSlideStreamParser({ maxSlides: 24 });
  const events = [];
  // Feed one character at a time: nothing may be emitted until each object closes.
  for (const ch of meta + bullets) events.push(...parser.feed(ch));
  assert.equal(events.filter((e) => e.type === 'slide').length, 1);
  assert.equal(events.find((e) => e.type === 'slide').slide.title, '关键结论');
});

test('handles a single {"slides":[...]} document (slides still stream one by one)', () => {
  const parser = createSlideStreamParser({ maxSlides: 24 });
  const first = '{"meta":{"title":"大文档"},"slides":[{"layout":"cover","title":"封面"},';
  const e1 = parser.feed(first);
  assert.deepEqual(
    e1.map((e) => e.type),
    ['meta', 'slide'],
    'the nested meta object is recognised as metadata, not as a slide'
  );
  assert.equal(e1[1].slide.layout, 'cover');

  const e2 = parser.feed('{"layout":"bullets","title":"要点","bullets":["a","b"]}]}');
  assert.equal(e2.filter((e) => e.type === 'slide').length, 1);

  const done = parser.finish();
  assert.equal(done.fromWholeBuffer, true, 'the completed wrapper parses as one document');
  assert.equal(done.rawSlides.length, 2);
});

test('ignores markdown fences and prose around the JSON', () => {
  const parser = createSlideStreamParser({ maxSlides: 24 });
  parser.feed('好的，以下是结果：\n```json\n');
  parser.feed(meta + cover);
  parser.feed('```\n以上就是全部内容。');
  const done = parser.finish();
  assert.equal(done.meta.title, '季度复盘');
  assert.equal(done.rawSlides.length, 1);
});

test('a truncated final slide is dropped instead of corrupting the deck', () => {
  const parser = createSlideStreamParser({ maxSlides: 24 });
  parser.feed(meta + cover + bullets);
  parser.feed('{"layout":"bullets","title":"被截断的页","bullets":["还没写完');
  const done = parser.finish();
  assert.equal(done.rawSlides.length, 2);
  const deck = normalizeDeck({ rawSlides: done.rawSlides, meta: done.meta, theme: 'paper' });
  assert.ok(!deck.slides.some((s) => s.title === '被截断的页'));
  // cover + bullets + synthesised closing
  assert.deepEqual(deck.slides.map((s) => s.layout), ['cover', 'bullets', 'closing']);
});

test('whole-buffer JSON array is preferred as the authoritative list', () => {
  const parser = createSlideStreamParser({ maxSlides: 24 });
  parser.feed('[{"layout":"cover","title":"A"},{"layout":"bullets","title":"B","bullets":["x"]}]');
  const done = parser.finish();
  assert.equal(done.fromWholeBuffer, true);
  assert.equal(done.rawSlides.length, 2);
});

test('does not emit duplicate slides when a container repeats its children', () => {
  const parser = createSlideStreamParser({ maxSlides: 24 });
  const events = [];
  events.push(...parser.feed('{"slides":[{"layout":"cover","title":"唯一封面"}]}'));
  assert.equal(events.filter((e) => e.type === 'slide').length, 1);
});

test('respects the maxSlides cap while still consuming the stream', () => {
  const parser = createSlideStreamParser({ maxSlides: 3 });
  let text = '';
  for (let i = 0; i < 30; i += 1) text += `{"layout":"bullets","title":"页 ${i}","bullets":["a"]}\n`;
  parser.feed(text);
  const deck = normalizeDeck({ rawSlides: parser.finish().rawSlides, meta: null, theme: 'paper', maxSlides: 3 });
  assert.ok(deck.slides.length <= 3, `expected <= 3 slides, got ${deck.slides.length}`);
});

test('braces inside strings do not confuse the scanner', () => {
  const parser = createSlideStreamParser({ maxSlides: 24 });
  const events = parser.feed('{"layout":"bullets","title":"含 } 与 { 的标题","bullets":["a \\"quoted\\" } brace"]}\n');
  assert.equal(events.filter((e) => e.type === 'slide').length, 1);
  assert.equal(events[0].slide.title, '含 } 与 { 的标题');
});

test('nested fragments (columns / stats / steps / quote) never become pages', () => {
  const parser = createSlideStreamParser({ maxSlides: 24 });
  const events = parser.feed(
    [
      JSON.stringify({
        layout: 'two-column',
        title: '优势与挑战',
        columns: [
          { heading: '优势', items: ['口碑领先', '交付效率高'] },
          { heading: '挑战', items: ['渠道不足'] }
        ]
      }),
      JSON.stringify({ layout: 'stats', title: '核心指标', stats: [{ value: '32%', label: '收入同比' }] }),
      JSON.stringify({ layout: 'timeline', title: '节奏', steps: [{ title: 'Q1', detail: '补渠道' }] }),
      JSON.stringify({ layout: 'quote', title: '', quote: { text: '增长来自复利', author: '内部复盘' } })
    ].join('\n') + '\n'
  );

  const slides = events.filter((e) => e.type === 'slide').map((e) => e.slide);
  assert.equal(slides.length, 4, `expected exactly 4 pages, got ${slides.length}`);
  assert.deepEqual(
    slides.map((s) => s.layout),
    ['two-column', 'stats', 'timeline', 'quote']
  );
  assert.equal(slides[0].columns.length, 2);
  assert.equal(slides[3].quote.text, '增长来自复利');
});

test('nested slides inside a container are still streamed in real time', () => {
  const parser = createSlideStreamParser({ maxSlides: 24 });
  const events = parser.feed(
    '{"slides":[{"layout":"bullets","title":"页一","bullets":["a"]},{"layout":"bullets","title":"页二","bullets":["b"]}]}'
  );
  assert.equal(events.filter((e) => e.type === 'slide').length, 2);
});

test('meta nested in a {"meta":{...},"slides":[...]} document is recovered', () => {
  const parser = createSlideStreamParser({ maxSlides: 24 });
  parser.feed('{"meta":{"title":"嵌套标题","slideCount":1},"slides":[{"layout":"cover","title":"封面"}]}');
  const done = parser.finish();
  assert.equal(done.meta.title, '嵌套标题');
  assert.equal(done.rawSlides.length, 1);
});
