/**
 * PPTX (.pptx) export — real Office Open XML, generated with pptxgenjs.
 *
 * Design mapping: the web player draws on a fixed 1280x720 px canvas. At the
 * standard 96 px/inch that is exactly 13.3333 x 7.5 in — the normal 16:9
 * PowerPoint page size — so every measurement in `web/src/player/slide.css`
 * converts 1:1 (px -> inch = /96, px -> point = *0.75) and the exported deck
 * keeps the same proportions and rhythm as the web/HTML version.
 *
 * Colour themes come from `server/themes.js`, which reads the palettes out of
 * the browser runtime, so the PPTX can never drift from the web themes.
 */

import PptxGenJS from 'pptxgenjs';
import { getTheme } from './themes.js';

export const LAYOUT_NAME = 'AI_PPT_16x9';
export const CANVAS_W = 1280;
export const CANVAS_H = 720;

/** px -> inches */
const X = (px) => px / 96;
/** px -> points (font sizes) */
const F = (px) => px * 0.75;

const PAD_X = 72;
const PAD_TOP = 54;
const CONTENT_W = CANVAS_W - PAD_X * 2;
const FOOT_Y = CANVAS_H - 48;

const FONT = process.env.PPTX_FONT || 'Microsoft YaHei';
const EMOJI_FONT = 'Segoe UI Emoji';

function hex(color, fallback = '000000') {
  if (typeof color !== 'string' || !color) return fallback;
  const m = color.trim().match(/^#?([0-9a-fA-F]{6})$/);
  return m ? m[1].toUpperCase() : fallback;
}

function palette(themeId) {
  const t = getTheme(themeId);
  const v = (name, fb) => hex(t.vars?.[name], fb);
  return {
    id: t.id,
    label: t.label,
    dark: t.dark,
    pageBg: v('ppt-page-bg', 'E9EDF4'),
    slideBg: v('ppt-slide-bg', 'FFFFFF'),
    slideBg2: v('ppt-slide-bg2', 'F5F8FF'),
    text: v('ppt-text', '0F1727'),
    dim: v('ppt-dim', '5C6A80'),
    accent: v('ppt-accent', '2F57E6'),
    accent2: v('ppt-accent2', '7B5CF5'),
    line: v('ppt-line', 'E2E8F2'),
    chip: v('ppt-chip-bg', 'F1F5FC'),
    quoteBg: v('ppt-quote-bg', 'F6F8FD'),
    // colours that read well on top of an accent-filled shape
    onAccent: t.dark ? '08131F' : 'FFFFFF'
  };
}

/* ------------------------------------------------------------------ helpers */

function charWeight(ch) {
  const code = ch.codePointAt(0);
  if (code === undefined) return 1;
  if (code <= 0x2e7f) return 0.56; // latin, digits, ascii punctuation
  return 1; // CJK / fullwidth — roughly one em per glyph
}

/** Rough line count for a proportional font; used to size boxes honestly. */
export function estimateLines(text, fontPx, boxWpx) {
  const perLine = Math.max(1, boxWpx / fontPx);
  let lines = 1;
  let acc = 0;
  for (const ch of String(text ?? '')) {
    if (ch === '\n') {
      lines += 1;
      acc = 0;
      continue;
    }
    const w = charWeight(ch);
    if (acc + w > perLine) {
      lines += 1;
      acc = w;
    } else {
      acc += w;
    }
  }
  return lines;
}

function clip(text, max) {
  const s = String(text ?? '');
  return s.length > max ? `${s.slice(0, max - 1)}…` : s;
}

/* ------------------------------------------------------------------ builder */

/**
 * Render a canonical deck into a .pptx buffer.
 * @param {object} deck  output of server/deck.js normalizeDeck()
 * @param {{theme?: string}} [options]
 * @returns {Promise<Buffer>}
 */
export async function buildPptxBuffer(deck, options = {}) {
  const themeId = options.theme || deck?.theme || 'paper';
  const c = palette(themeId);
  const slides = Array.isArray(deck?.slides) ? deck.slides : [];
  if (!slides.length) throw new Error('deck 没有任何页面，无法导出 PPTX');

  const pptx = new PptxGenJS();
  pptx.defineLayout({ name: LAYOUT_NAME, width: CANVAS_W / 96, height: CANVAS_H / 96 });
  pptx.layout = LAYOUT_NAME;
  pptx.author = 'AI 网页 PPT 生成器';
  pptx.company = 'AI 网页 PPT 生成器';
  pptx.title = clip(deck.title || 'AI 生成的演示文稿', 120);
  pptx.subject = clip(deck.subtitle || '', 160);
  pptx.lang = 'zh-CN';
  pptx.theme = {
    headFontFace: FONT,
    bodyFontFace: FONT,
    lang: 'zh-CN'
  };

  const S = pptx.ShapeType;
  const ctx = { pptx, S, c, deckTitle: deck.title || '' };

  slides.forEach((slide, i) => {
    const s = pptx.addSlide();
    s.background = { color: c.slideBg };
    decorations(s, ctx);
    const layout = slide.layout || 'bullets';
    if (layout === 'cover') cover(s, slide, ctx, i, slides.length);
    else if (layout === 'closing') closing(s, slide, ctx, i, slides.length);
    else if (layout === 'section') section(s, slide, ctx, i, slides.length);
    else if (layout === 'stats') stats(s, slide, ctx, i, slides.length);
    else if (layout === 'quote') quote(s, slide, ctx, i, slides.length);
    else if (layout === 'timeline') timeline(s, slide, ctx, i, slides.length);
    else if (layout === 'two-column') twoColumn(s, slide, ctx, i, slides.length);
    else bullets(s, slide, ctx, i, slides.length);
    if (slide.notes) s.addNotes(String(slide.notes).slice(0, 2000));
  });

  return pptx.write({ outputType: 'nodebuffer' });
}

/* ------------------------------------------------------------- decorations */

function decorations(slide, ctx) {
  const { S, c } = ctx;
  const noLine = { color: c.slideBg, width: 0 };
  // PowerPoint has no gradient/blur fills in pptxgenjs, so the app's soft radial
  // wash is approximated with very low-contrast shapes whose arc stays close to
  // the corner. Kept faint on purpose: a visible hard edge looks like a bug.
  slide.addShape(S.ellipse, {
    x: X(-1140), y: X(-1240), w: X(1900), h: X(1900),
    fill: { color: c.accent, transparency: 94 },
    line: noLine
  });
  slide.addShape(S.ellipse, {
    x: X(980), y: X(560), w: X(1100), h: X(1100),
    fill: { color: c.accent2, transparency: 96 },
    line: noLine
  });
}

function footer(slide, ctx, index, total) {
  const { c, deckTitle } = ctx;
  slide.addText(clip(deckTitle, 60), {
    x: X(PAD_X), y: X(FOOT_Y), w: X(800), h: X(26),
    fontSize: F(15), color: c.dim, fontFace: FONT, align: 'left', valign: 'middle',
    margin: 0, fit: 'shrink'
  });
  slide.addText(`${index + 1}`, {
    x: X(CANVAS_W - PAD_X - 120), y: X(FOOT_Y), w: X(120), h: X(26),
    fontSize: F(15), bold: true, color: c.dim, fontFace: FONT, align: 'right', valign: 'middle', margin: 0
  });
}

function head(slide, ctx, slideData) {
  const { S, c } = ctx;
  let y = PAD_TOP;
  if (slideData.icon) {
    slide.addShape(S.roundRect, {
      x: X(PAD_X), y: X(y), w: X(46), h: X(46), rectRadius: 0.06,
      fill: { color: c.chip }, line: { color: c.line, width: 1 }
    });
    slide.addText(clip(slideData.icon, 3), {
      x: X(PAD_X), y: X(y), w: X(46), h: X(46),
      fontSize: F(24), align: 'center', valign: 'middle', margin: 0, fontFace: EMOJI_FONT
    });
    y += 46 + 14;
  }

  const title = clip(slideData.title || '', 80);
  const titleFont = 46;
  const titleLines = title ? estimateLines(title, titleFont, CONTENT_W) : 0;
  const titleH = Math.max(1, titleLines) * titleFont * 1.16;
  if (title) {
    slide.addText(title, {
      x: X(PAD_X), y: X(y), w: X(CONTENT_W), h: X(titleH),
      fontSize: F(titleFont), bold: true, color: c.text, fontFace: FONT,
      align: 'left', valign: 'top', margin: 0, fit: 'shrink', lineSpacingMultiple: 1.02
    });
    y += titleH;
  }

  if (slideData.subtitle) {
    const sub = clip(slideData.subtitle, 140);
    const subLines = estimateLines(sub, 22, CONTENT_W * 0.9);
    const subH = subLines * 22 * 1.4 + 10;
    slide.addText(sub, {
      x: X(PAD_X), y: X(y + 10), w: X(CONTENT_W * 0.92), h: X(subH),
      fontSize: F(22), color: c.dim, fontFace: FONT, align: 'left', valign: 'top',
      margin: 0, fit: 'shrink'
    });
    y += subH + 10;
  }
  return y;
}

/* ----------------------------------------------------------------- layouts */

function cover(slide, data, ctx, index, total) {
  const { S, c } = ctx;
  slide.addText(clip(data.subtitle || '', 60), {
    x: X(PAD_X), y: X(186), w: X(CONTENT_W), h: X(44),
    fontSize: F(24), bold: true, color: c.accent, fontFace: FONT,
    align: 'center', valign: 'middle', margin: 0, charSpacing: 2, fit: 'shrink'
  });

  const title = clip(data.title || '未命名演示', 60);
  const tLines = estimateLines(title, 78, CONTENT_W - 80);
  const tH = tLines * 78 * 1.18;
  slide.addText(title, {
    x: X(PAD_X + 40), y: X(244), w: X(CONTENT_W - 80), h: X(Math.max(120, tH)),
    fontSize: F(78), bold: true, color: c.text, fontFace: FONT,
    align: 'center', valign: 'middle', margin: 0, fit: 'shrink', lineSpacingMultiple: 1.02
  });

  const ruleY = 244 + Math.max(120, tH) + 22;
  slide.addShape(S.roundRect, {
    x: X((CANVAS_W - 92) / 2), y: X(ruleY), w: X(92), h: X(6), rectRadius: 0.03,
    fill: { color: c.accent }, line: { color: c.accent, width: 0 }
  });

  const meta = Array.isArray(data.bullets) ? data.bullets.slice(0, 4).map((b) => clip(b, 22)) : [];
  if (meta.length) {
    const chipH = 40;
    const widths = meta.map((m) => Math.min(360, Math.max(110, m.length * 19 + 40)));
    const gap = 14;
    const totalW = widths.reduce((a, b) => a + b, 0) + gap * (meta.length - 1);
    let x = (CANVAS_W - totalW) / 2;
    const y = Math.min(ruleY + 34, CANVAS_H - 150);
    meta.forEach((m, i) => {
      slide.addShape(S.roundRect, {
        x: X(x), y: X(y), w: X(widths[i]), h: X(chipH), rectRadius: 0.5,
        fill: { color: c.chip }, line: { color: c.line, width: 1 }
      });
      slide.addText(m, {
        x: X(x), y: X(y), w: X(widths[i]), h: X(chipH),
        fontSize: F(19), color: c.dim, fontFace: FONT, align: 'center', valign: 'middle', margin: 0, fit: 'shrink'
      });
      x += widths[i] + gap;
    });
  }
  footer(slide, ctx, index, total);
}

function closing(slide, data, ctx, index, total) {
  const { S, c } = ctx;
  const titleH = 150;
  slide.addText(clip(data.title || '谢谢观看', 40), {
    x: X(PAD_X), y: X(250), w: X(CONTENT_W), h: X(titleH),
    fontSize: F(78), bold: true, color: c.text, fontFace: FONT,
    align: 'center', valign: 'middle', margin: 0, fit: 'shrink'
  });
  if (data.subtitle) {
    slide.addText(clip(data.subtitle, 90), {
      x: X(PAD_X + 60), y: X(410), w: X(CONTENT_W - 120), h: X(70),
      fontSize: F(24), color: c.dim, fontFace: FONT, align: 'center', valign: 'top', margin: 0, fit: 'shrink'
    });
  }
  slide.addShape(S.roundRect, {
    x: X((CANVAS_W - 92) / 2), y: X(224), w: X(92), h: X(6), rectRadius: 0.03,
    fill: { color: c.accent }, line: { color: c.accent, width: 0 }
  });
  footer(slide, ctx, index, total);
}

function section(slide, data, ctx, index, total) {
  const { c } = ctx;
  slide.addText(String(index + 1).padStart(2, '0'), {
    x: X(PAD_X), y: X(150), w: X(CONTENT_W), h: X(150),
    fontSize: F(130), bold: true, color: c.accent, fontFace: FONT,
    align: 'center', valign: 'middle', margin: 0, fit: 'shrink'
  });
  slide.addText(clip(data.title || '', 50), {
    x: X(PAD_X), y: X(318), w: X(CONTENT_W), h: X(96),
    fontSize: F(62), bold: true, color: c.text, fontFace: FONT,
    align: 'center', valign: 'middle', margin: 0, fit: 'shrink'
  });
  if (data.subtitle) {
    slide.addText(clip(data.subtitle, 80), {
      x: X(PAD_X + 80), y: X(418), w: X(CONTENT_W - 160), h: X(70),
      fontSize: F(27), color: c.dim, fontFace: FONT, align: 'center', valign: 'top', margin: 0, fit: 'shrink'
    });
  }
  footer(slide, ctx, index, total);
}

function bullets(slide, data, ctx, index, total) {
  const { S, c } = ctx;
  const top = head(slide, ctx, data);
  const items = (data.bullets || []).slice(0, 6).map((b) => clip(b, 160));
  if (!items.length) {
    footer(slide, ctx, index, total);
    return;
  }

  const bodyTop = top + 26;
  const bodyBottom = FOOT_Y - 24;
  const bodyH = Math.max(120, bodyBottom - bodyTop);

  // Shrink the font a little when the text is long so 5-6 bullets always fit.
  const longest = Math.max(...items.map((t) => t.length));
  const fontSize = longest > 46 ? 24 : longest > 30 ? 27 : 30;
  const textW = CONTENT_W - 34;
  const gap = 20;

  const rowHeights = items.map((t) => {
    const lines = estimateLines(t, fontSize, textW);
    return Math.max(fontSize * 1.45, lines * fontSize * 1.5);
  });
  const totalH = rowHeights.reduce((a, b) => a + b, 0) + gap * (items.length - 1);
  let y = bodyTop + Math.max(0, (bodyH - totalH) / 2);

  items.forEach((text, i) => {
    const rowH = rowHeights[i];
    const markSize = fontSize > 28 ? 12 : 10;
    slide.addShape(S.rect, {
      x: X(PAD_X + 4), y: X(y + fontSize * 0.52), w: X(markSize), h: X(markSize), rotate: 45,
      fill: { color: c.accent }, line: { color: c.accent, width: 0 }
    });
    slide.addText(text, {
      x: X(PAD_X + 34), y: X(y), w: X(textW), h: X(rowH),
      fontSize: F(fontSize), color: c.text, fontFace: FONT,
      align: 'left', valign: 'top', margin: 0, fit: 'shrink', lineSpacingMultiple: 1.1
    });
    y += rowH + gap;
  });
  footer(slide, ctx, index, total);
}

function twoColumn(slide, data, ctx, index, total) {
  const { S, c } = ctx;
  const top = head(slide, ctx, data);
  const cols = (data.columns || []).slice(0, 3);
  const bodyTop = top + 26;
  const bodyBottom = FOOT_Y - 24;
  const bodyH = Math.max(180, bodyBottom - bodyTop);
  const gap = 24;
  const colW = (CONTENT_W - gap * (cols.length - 1)) / cols.length;

  const fontPx = 25;
  const textW = colW - 52 - 26;
  const rowGap = 14;

  // First pass: how tall does each column actually need to be?
  const prepared = cols.map((col) => {
    const items = (col.items || []).slice(0, 6).map((t) => clip(t, 80));
    const heights = items.map((t) => Math.max(fontPx * 1.45, estimateLines(t, fontPx, textW) * fontPx * 1.5));
    const contentH = heights.reduce((a, b) => a + b, 0) + rowGap * Math.max(0, items.length - 1);
    return { col, items, heights, needed: 70 + contentH + 34 };
  });

  const needed = Math.max(180, ...prepared.map((p) => p.needed));
  const cardH = Math.min(bodyH, needed);
  const cardY = bodyTop + (bodyH - cardH) / 2;

  prepared.forEach(({ col, items, heights }, i) => {
    const x = PAD_X + i * (colW + gap);
    slide.addShape(S.roundRect, {
      x: X(x), y: X(cardY), w: X(colW), h: X(cardH), rectRadius: 0.05,
      fill: { color: c.chip }, line: { color: c.line, width: 1 }
    });
    slide.addText(clip(col.heading || '', 40), {
      x: X(x + 26), y: X(cardY + 22), w: X(colW - 52), h: X(38),
      fontSize: F(26), bold: true, color: c.accent, fontFace: FONT,
      align: 'left', valign: 'middle', margin: 0, fit: 'shrink'
    });

    if (!items.length) return;
    const totalH = heights.reduce((a, b) => a + b, 0) + rowGap * (items.length - 1);
    if (totalH > cardH - 80) {
      // Too tall for the card: fall back to one tighter paragraph.
      slide.addText(
        items.map((t) => ({ text: t, options: { bullet: { code: '25AA' }, breakLine: true } })),
        {
          x: X(x + 22), y: X(cardY + 66), w: X(colW - 44), h: X(cardH - 80),
          fontSize: F(20), color: c.text, fontFace: FONT, align: 'left', valign: 'top',
          margin: 0, fit: 'shrink', lineSpacingMultiple: 1.15
        }
      );
      return;
    }
    let y = cardY + 70;
    items.forEach((t, k) => {
      slide.addShape(S.rect, {
        x: X(x + 26), y: X(y + fontPx * 0.5), w: X(9), h: X(9), rotate: 45,
        fill: { color: c.accent }, line: { color: c.accent, width: 0 }
      });
      slide.addText(t, {
        x: X(x + 48), y: X(y), w: X(textW), h: X(heights[k]),
        fontSize: F(fontPx), color: c.text, fontFace: FONT,
        align: 'left', valign: 'top', margin: 0, fit: 'shrink'
      });
      y += heights[k] + rowGap;
    });
  });
  footer(slide, ctx, index, total);
}

function stats(slide, data, ctx, index, total) {
  const { S, c } = ctx;
  const top = head(slide, ctx, data);
  const items = (data.stats || []).slice(0, 4);
  const bodyTop = top + 26;
  const bodyH = Math.max(160, FOOT_Y - 24 - bodyTop);
  const cardH = Math.min(260, bodyH);
  const cardY = bodyTop + (bodyH - cardH) / 2;
  const gap = 26;
  const cardW = (CONTENT_W - gap * (items.length - 1)) / items.length;

  items.forEach((stat, i) => {
    const x = PAD_X + i * (cardW + gap);
    slide.addShape(S.roundRect, {
      x: X(x), y: X(cardY), w: X(cardW), h: X(cardH), rectRadius: 0.06,
      fill: { color: c.chip }, line: { color: c.line, width: 1 }
    });
    slide.addText(clip(stat.value || '', 16), {
      x: X(x + 24), y: X(cardY + cardH * 0.24), w: X(cardW - 48), h: X(cardH * 0.34),
      fontSize: F(58), bold: true, color: c.accent, fontFace: FONT,
      align: 'left', valign: 'middle', margin: 0, fit: 'shrink'
    });
    slide.addText(clip(stat.label || '', 60), {
      x: X(x + 24), y: X(cardY + cardH * 0.6), w: X(cardW - 48), h: X(cardH * 0.32),
      fontSize: F(21), color: c.dim, fontFace: FONT,
      align: 'left', valign: 'top', margin: 0, fit: 'shrink', lineSpacingMultiple: 1.1
    });
  });
  footer(slide, ctx, index, total);
}

function quote(slide, data, ctx, index, total) {
  const { S, c } = ctx;
  const top = head(slide, ctx, data);
  const q = data.quote || {};
  const text = clip(q.text || '', 200);
  const bodyTop = top + 26;
  const bodyBottom = FOOT_Y - 24;

  const fontPx = 40;
  const innerW = CONTENT_W - 100;
  const lines = estimateLines(text, fontPx, innerW);
  const textH = lines * fontPx * 1.45;
  const boxH = Math.min(bodyBottom - bodyTop, textH + 120);
  const boxY = bodyTop + Math.max(0, (bodyBottom - bodyTop - boxH) / 2);

  slide.addShape(S.roundRect, {
    x: X(PAD_X), y: X(boxY), w: X(CONTENT_W), h: X(boxH), rectRadius: 0.05,
    fill: { color: c.quoteBg }, line: { color: c.line, width: 1 }
  });
  slide.addShape(S.rect, {
    x: X(PAD_X), y: X(boxY), w: X(6), h: X(boxH),
    fill: { color: c.accent }, line: { color: c.accent, width: 0 }
  });
  slide.addText('“', {
    x: X(PAD_X + 18), y: X(boxY + 4), w: X(90), h: X(90),
    fontSize: F(96), bold: true, color: c.accent, fontFace: 'Georgia', align: 'left', valign: 'top', margin: 0, transparency: 60
  });
  slide.addText(text, {
    x: X(PAD_X + 50), y: X(boxY + 40), w: X(innerW), h: X(Math.max(60, textH)),
    fontSize: F(fontPx), bold: true, color: c.text, fontFace: FONT,
    align: 'left', valign: 'top', margin: 0, fit: 'shrink', lineSpacingMultiple: 1.12
  });
  if (q.author) {
    slide.addText(`— ${clip(q.author, 60)}`, {
      x: X(PAD_X + 50), y: X(boxY + boxH - 56), w: X(innerW), h: X(36),
      fontSize: F(21), color: c.dim, fontFace: FONT, align: 'left', valign: 'middle', margin: 0, fit: 'shrink'
    });
  }
  footer(slide, ctx, index, total);
}

function timeline(slide, data, ctx, index, total) {
  const { S, c } = ctx;
  const top = head(slide, ctx, data);
  const steps = (data.steps || []).slice(0, 5);
  const bodyTop = top + 22;
  const bodyBottom = FOOT_Y - 24;
  const bodyH = Math.max(140, bodyBottom - bodyTop);
  const gap = 18;
  const dot = 46;

  const rowHeights = steps.map((st) => {
    const t = clip(st.title || '', 50);
    const d = clip(st.detail || '', 100);
    const h = Math.max(dot, estimateLines(t, 27, CONTENT_W - 90) * 27 * 1.35 + (d ? estimateLines(d, 21, CONTENT_W - 90) * 21 * 1.4 + 6 : 0));
    return h;
  });
  const totalH = rowHeights.reduce((a, b) => a + b, 0) + gap * (steps.length - 1);
  let y = bodyTop + Math.max(0, (bodyH - totalH) / 2);

  steps.forEach((st, i) => {
    slide.addShape(S.ellipse, {
      x: X(PAD_X), y: X(y), w: X(dot), h: X(dot),
      fill: { color: c.accent }, line: { color: c.accent, width: 0 }
    });
    slide.addText(String(i + 1), {
      x: X(PAD_X), y: X(y), w: X(dot), h: X(dot),
      fontSize: F(20), bold: true, color: c.onAccent, fontFace: FONT, align: 'center', valign: 'middle', margin: 0
    });
    slide.addText(clip(st.title || '', 50), {
      x: X(PAD_X + 66), y: X(y), w: X(CONTENT_W - 66), h: X(34),
      fontSize: F(27), bold: true, color: c.text, fontFace: FONT, align: 'left', valign: 'middle', margin: 0, fit: 'shrink'
    });
    if (st.detail) {
      slide.addText(clip(st.detail, 100), {
        x: X(PAD_X + 66), y: X(y + 34), w: X(CONTENT_W - 66), h: X(rowHeights[i] - 34),
        fontSize: F(21), color: c.dim, fontFace: FONT, align: 'left', valign: 'top', margin: 0, fit: 'shrink', lineSpacingMultiple: 1.1
      });
    }
    y += rowHeights[i] + gap;
  });
  footer(slide, ctx, index, total);
}
