/**
 * The strongest possible validation: hand the generated .pptx to Microsoft
 * PowerPoint itself (via COM) and read back what PowerPoint parsed.
 *
 * Skipped automatically when PowerPoint is not installed, so the suite still
 * runs on machines without Office.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { buildPptxBuffer } from '../../server/pptx.js';
import { normalizeDeck } from '../../server/deck.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const VALIDATOR = path.join(ROOT, 'scripts', 'validate-pptx.ps1');

const POWERPOINT_CANDIDATES = [
  'C:\\Program Files\\Microsoft Office\\root\\Office16\\POWERPNT.EXE',
  'C:\\Program Files (x86)\\Microsoft Office\\root\\Office16\\POWERPNT.EXE',
  'C:\\Program Files\\Microsoft Office\\Office16\\POWERPNT.EXE',
  'C:\\Program Files (x86)\\Microsoft Office\\Office16\\POWERPNT.EXE'
];

const powerPointPath = process.platform === 'win32' ? POWERPOINT_CANDIDATES.find((p) => fs.existsSync(p)) : undefined;
const skip = powerPointPath ? false : 'Microsoft PowerPoint not installed on this machine';

const FIXTURE = [
  { layout: 'cover', title: '真实校验：季度复盘', subtitle: 'PowerPoint 亲自打开' },
  { layout: 'bullets', title: '三个关键结论', bullets: ['收入同比增长 32%', '获客成本下降 18%'], notes: '这里是演讲者备注' },
  { layout: 'stats', title: '核心指标', stats: [{ value: '32%', label: '收入同比' }, { value: '91%', label: '续费率' }] },
  {
    layout: 'two-column',
    title: '优势与挑战',
    columns: [
      { heading: '优势', items: ['口碑领先'] },
      { heading: '挑战', items: ['渠道不足'] }
    ]
  },
  { layout: 'quote', title: '', quote: { text: '增长来自复利。', author: '内部复盘' } },
  { layout: 'timeline', title: '节奏', steps: [{ title: 'Q1', detail: '补齐渠道' }] },
  { layout: 'section', title: '附：方法说明' },
  { layout: 'closing', title: '谢谢观看' }
];

function runValidator(file) {
  const outFile = `${file}.validation.json`;
  const res = spawnSync(
    'powershell',
    ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', VALIDATOR, '-Path', file, '-AllText', '-OutFile', outFile],
    { encoding: 'utf8', timeout: 180000, windowsHide: true }
  );
  const raw = fs.existsSync(outFile) ? fs.readFileSync(outFile, 'utf8') : '';
  let parsed = null;
  if (raw) {
    try {
      parsed = JSON.parse(raw.replace(/^\uFEFF/, ''));
    } catch (err) {
      parsed = { ok: false, error: `validator output was not JSON: ${raw.slice(0, 200)}` };
    }
  }
  return { res, parsed, raw };
}

test('pptx: Microsoft PowerPoint opens and parses the generated deck', { skip, timeout: 240000 }, async () => {
  const deck = normalizeDeck({ rawSlides: FIXTURE, meta: { title: '真实校验：季度复盘' }, theme: 'midnight', maxSlides: 24 });
  const buffer = await buildPptxBuffer(deck, { theme: 'midnight' });

  const file = path.join(os.tmpdir(), `ai-ppt-validate-${Date.now()}.pptx`);
  fs.writeFileSync(file, buffer);
  assert.ok(buffer.length > 20000, `pptx suspiciously small: ${buffer.length}`);

  const { parsed, raw, res } = runValidator(file);
  assert.ok(parsed, `PowerPoint validator produced no parseable output (stderr: ${res.stderr?.slice(0, 300)})`);

  try {
    assert.equal(parsed.ok, true, `PowerPoint refused the file: ${parsed.error}\n${raw.slice(0, 400)}`);
    assert.equal(parsed.slides, deck.slides.length, 'PowerPoint sees a different page count');

    // 960x540 pt == 13.333 x 7.5 in
    assert.equal(Math.round(parsed.slideWidthPt), 960);
    assert.equal(Math.round(parsed.slideHeightPt), 540);

    const allText = parsed.details.map((d) => (d.texts || []).join(' ')).join('\n');
    for (const slide of deck.slides) {
      if (slide.title) {
        assert.ok(
          allText.includes(slide.title),
          `PowerPoint did not surface the title "${slide.title}" (page ${slide.layout})`
        );
      }
    }
    for (const bullet of deck.slides[1].bullets) {
      assert.ok(allText.includes(bullet), `PowerPoint did not surface the bullet "${bullet}"`);
    }

    // Speaker notes survive the round trip.
    const noted = parsed.details.find((d) => d.notes && d.notes.includes('演讲者备注'));
    assert.ok(noted, `speaker notes were lost: ${JSON.stringify(parsed.details.map((d) => d.notes))}`);

    // A shape count of 1 would mean the page rendered as a blank rectangle.
    for (const detail of parsed.details) {
      assert.ok(detail.shapes >= 3, `page ${detail.index} has only ${detail.shapes} shapes — looks empty`);
    }
  } finally {
    try {
      fs.unlinkSync(file);
      fs.unlinkSync(`${file}.validation.json`);
    } catch {
      /* best effort */
    }
  }
});
