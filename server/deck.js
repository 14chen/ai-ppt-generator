/**
 * Deck model: normalises whatever the model emits into the strict shape the
 * player/export rely on. Being permissive here is what makes the pipeline
 * robust against an LLM that drifts from the requested schema.
 */

export const LAYOUTS = ['cover', 'section', 'bullets', 'two-column', 'stats', 'quote', 'timeline', 'closing'];

const LAYOUT_ALIASES = new Map(
  Object.entries({
    title: 'cover', cover: 'cover', intro: 'cover', opening: 'cover', '封面': 'cover', '标题页': 'cover',
    section: 'section', divider: 'section', chapter: 'section', separator: 'section', '章节': 'section', '过渡页': 'section',
    bullets: 'bullets', bullet: 'bullets', list: 'bullets', points: 'bullets', content: 'bullets',
    agenda: 'bullets', text: 'bullets', '要点': 'bullets', '列表': 'bullets',
    'two-column': 'two-column', two_column: 'two-column', twocolumn: 'two-column', columns: 'two-column',
    comparison: 'two-column', compare: 'two-column', '对比': 'two-column', '两栏': 'two-column',
    stats: 'stats', stat: 'stats', metrics: 'stats', numbers: 'stats', data: 'stats', kpi: 'stats', '数据': 'stats',
    quote: 'quote', quotation: 'quote', citation: 'quote', '引用': 'quote', '金句': 'quote',
    timeline: 'timeline', steps: 'timeline', step: 'timeline', process: 'timeline', roadmap: 'timeline',
    phases: 'timeline', flow: 'timeline', '流程': 'timeline', '时间线': 'timeline',
    closing: 'closing', end: 'closing', thanks: 'closing', summary: 'closing', conclusion: 'closing',
    '结尾': 'closing', '总结': 'closing', '谢谢': 'closing'
  })
);

export const LIMITS = {
  title: 60,
  subtitle: 120,
  bullets: 6,
  bulletLen: 120,
  columns: 3,
  columnItems: 6,
  stats: 4,
  steps: 5,
  notes: 400
};

export function normalizeLayout(value) {
  if (typeof value !== 'string') return null;
  const key = value.trim().toLowerCase().replace(/[\s_]+/g, '-');
  if (LAYOUT_ALIASES.has(key)) return LAYOUT_ALIASES.get(key);
  if (LAYOUTS.includes(key)) return key;
  return null;
}

function text(value, max = 200) {
  if (value === null || value === undefined) return '';
  let s;
  if (typeof value === 'string') s = value;
  else if (typeof value === 'number' || typeof value === 'boolean') s = String(value);
  else if (Array.isArray(value)) s = value.map((v) => text(v, max)).filter(Boolean).join('，');
  else if (typeof value === 'object') s = text(value.text ?? value.title ?? value.label ?? value.value ?? '', max);
  else return '';
  s = s.replace(/\s+/g, ' ').trim();
  // strip leading list markers: "- a", "• a", "1. a", "3、a" …
  // (a separator must be followed by a space, so "3.2x" survives untouched)
  s = s.replace(/^(?:\d{1,2}\s*[.、)）]\s+|[-–—*•·]\s+|\d{1,2}[、)）]\s*)+/, '');
  s = s.replace(/[。;；]+$/, '');
  if (s.length > max) s = `${s.slice(0, max - 1)}…`;
  return s;
}

function firstOf(raw, keys) {
  for (const key of keys) {
    const v = raw?.[key];
    if (v !== null && v !== undefined && !(typeof v === 'string' && !v.trim()) && !(Array.isArray(v) && !v.length)) {
      return v;
    }
  }
  return undefined;
}

export function toBullets(value, max = LIMITS.bullets, maxLen = LIMITS.bulletLen) {
  let list = [];
  if (Array.isArray(value)) list = value;
  else if (typeof value === 'string') {
    const lines = value.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
    list = lines.length > 1
      ? lines
      : value.split(/(?:[;；]|(?:^|\s)\d+[.、)）]\s*)/).map((l) => l.trim()).filter(Boolean);
  } else if (value && typeof value === 'object') {
    list = Object.entries(value).map(([k, v]) => `${k}：${text(v, maxLen)}`);
  }
  return list
    .map((item) => {
      if (item && typeof item === 'object' && !Array.isArray(item)) {
        const head = text(item.title ?? item.heading ?? item.label ?? '', 40);
        const body = text(item.text ?? item.detail ?? item.content ?? item.value ?? item.description ?? '', maxLen);
        return text(head && body ? `${head}：${body}` : head || body, maxLen);
      }
      return text(item, maxLen);
    })
    .filter(Boolean)
    .slice(0, max);
}

function toColumns(raw) {
  let cols = firstOf(raw, ['columns', 'cols', 'sections']);
  if (!Array.isArray(cols)) {
    const left = firstOf(raw, ['left', 'leftColumn', 'left_column']);
    const right = firstOf(raw, ['right', 'rightColumn', 'right_column']);
    if (left || right) {
      cols = [
        { heading: text(raw.leftTitle ?? raw.left_title ?? '左栏', 40), items: left },
        { heading: text(raw.rightTitle ?? raw.right_title ?? '右栏', 40), items: right }
      ];
    }
  }
  if (!Array.isArray(cols)) return [];
  return cols
    .map((c, i) => {
      if (typeof c === 'string') return { heading: '', items: toBullets(c, LIMITS.columnItems) };
      const items = toBullets(firstOf(c ?? {}, ['items', 'bullets', 'points', 'list', 'content']), LIMITS.columnItems);
      return { heading: text(c?.heading ?? c?.title ?? c?.name ?? `第 ${i + 1} 栏`, 40), items };
    })
    .filter((c) => c.heading || c.items.length)
    .slice(0, LIMITS.columns);
}

function toStats(raw) {
  let list = firstOf(raw, ['stats', 'metrics', 'numbers', 'data', 'kpis']);
  if (list && !Array.isArray(list) && typeof list === 'object') {
    list = Object.entries(list).map(([value, label]) => ({ value, label }));
  }
  if (!Array.isArray(list)) return [];
  return list
    .map((s) => {
      if (s === null || s === undefined) return null;
      if (typeof s === 'string' || typeof s === 'number') {
        const str = text(s, 60);
        // "68%：收入同比" / "68% 收入同比" / "68%"
        const colon = str.search(/[:：]/);
        if (colon > 0 && colon <= 14) {
          return { value: str.slice(0, colon).trim(), label: str.slice(colon + 1).trim() };
        }
        const spaced = str.match(/^(\S{1,14})\s+(.*)$/);
        if (spaced) return { value: spaced[1], label: spaced[2] };
        return { value: str, label: '' };
      }
      const value = text(s.value ?? s.number ?? s.figure ?? s.metric ?? s.stat ?? '', 24);
      const label = text(s.label ?? s.title ?? s.name ?? s.description ?? s.text ?? s.unit ?? '', 60);
      return value || label ? { value, label } : null;
    })
    .filter(Boolean)
    .slice(0, LIMITS.stats);
}

function toSteps(raw) {
  const list = firstOf(raw, ['steps', 'timeline', 'phases', 'process', 'flow', 'roadmap']);
  if (!Array.isArray(list)) return [];
  return list
    .map((s) => {
      if (s === null || s === undefined) return null;
      if (typeof s === 'string' || typeof s === 'number') {
        const str = text(s, 100);
        return str ? { title: str, detail: '' } : null;
      }
      const title = text(s.title ?? s.label ?? s.name ?? s.step ?? s.phase ?? '', 40);
      const detail = text(s.detail ?? s.text ?? s.desc ?? s.description ?? '', LIMITS.bulletLen);
      return title || detail ? { title, detail } : null;
    })
    .filter(Boolean)
    .slice(0, LIMITS.steps);
}

function toQuote(raw) {
  const q = firstOf(raw, ['quote', 'quotation', 'citation', 'q']);
  const rawText = typeof q === 'string' ? q : q && typeof q === 'object' ? q.text ?? q.content ?? '' : '';
  const body = text(rawText, 220);
  const author = text(
    (q && typeof q === 'object' ? q.author ?? q.by ?? q.source ?? q.cite : undefined) ??
      firstOf(raw, ['author', 'cite', 'source', 'attribution']) ??
      '',
    60
  );
  return body ? { text: body, author } : null;
}

export function looksLikeSlide(obj) {
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return false;
  if (Array.isArray(obj.slides) || Array.isArray(obj.pages)) return false;
  const type = typeof obj.type === 'string' ? obj.type.trim().toLowerCase() : '';
  if (['meta', 'deck', 'end', 'done'].includes(type)) return false;
  if (normalizeLayout(obj.layout ?? obj.type ?? obj.kind)) return true;
  const hasTitle = ['title', 'heading', 'headline', 'name', 'subject'].some(
    (k) => typeof obj[k] === 'string' && obj[k].trim()
  );
  const hasBody = [
    'bullets', 'points', 'items', 'key_points', 'keyPoints', 'content', 'body',
    'columns', 'stats', 'metrics', 'quote', 'steps', 'timeline', 'phases', 'description', 'subtitle', 'subheading'
  ].some((k) => obj[k] !== null && obj[k] !== undefined);
  return hasTitle || hasBody;
}

function inferLayout(raw, bullets, columns, stats, quote, steps) {
  if (stats.length) return 'stats';
  if (quote) return 'quote';
  if (steps.length) return 'timeline';
  if (columns.length >= 2) return 'two-column';
  if (!bullets.length) return 'section';
  return 'bullets';
}

/** Normalise one raw slide object into the canonical shape. */
export function normalizeSlide(raw, index = 0) {
  const r = raw && typeof raw === 'object' ? raw : {};
  let title = text(firstOf(r, ['title', 'heading', 'headline', 'name', 'subject', 'topic']), LIMITS.title);
  const subtitle = text(firstOf(r, ['subtitle', 'subheading', 'sub_title', 'kicker', 'tagline', 'description']), LIMITS.subtitle);
  const bullets = toBullets(firstOf(r, ['bullets', 'points', 'items', 'key_points', 'keyPoints', 'list', 'content', 'body', 'text']));
  const columns = toColumns(r);
  const stats = toStats(r);
  const quote = toQuote(r);
  const steps = toSteps(r);
  const notes = text(firstOf(r, ['notes', 'speakerNotes', 'speaker_notes', 'remarks', 'note']), LIMITS.notes);
  const icon = text(firstOf(r, ['icon', 'emoji', 'badge']), 4);

  let layout = normalizeLayout(r.layout ?? r.kind ?? r.type);

  if (!layout) {
    layout = inferLayout(r, bullets, columns, stats, quote, steps);
    if (index === 0 && !bullets.length && !stats.length && !columns.length && !quote && !steps.length) layout = 'cover';
  }

  // Degrade gracefully when the payload does not support the requested layout.
  if (layout === 'stats' && !stats.length) layout = bullets.length ? 'bullets' : 'section';
  if (layout === 'quote' && !quote) layout = bullets.length ? 'bullets' : 'section';
  if (layout === 'timeline' && !steps.length) layout = bullets.length ? 'bullets' : 'section';
  if (layout === 'two-column' && columns.length < 2) {
    if (columns.length === 1) {
      columns[0].heading = columns[0].heading || title;
      layout = 'two-column';
    } else {
      layout = bullets.length ? 'bullets' : 'section';
    }
  }

  // A title-only "bullets" page reads better as a section divider.
  if (layout === 'bullets' && !bullets.length) {
    if (columns.length >= 2) layout = 'two-column';
    else if (stats.length) layout = 'stats';
    else layout = 'section';
  }

  if (!title && bullets.length && layout !== 'cover') title = bullets.shift();

  const slide = { layout, title, subtitle };
  if (icon) slide.icon = icon;
  if (bullets.length) slide.bullets = bullets;
  if (layout === 'two-column' && columns.length) slide.columns = columns;
  if (layout === 'stats' && stats.length) slide.stats = stats;
  if (layout === 'quote' && quote) slide.quote = quote;
  if (layout === 'timeline' && steps.length) slide.steps = steps;
  if (notes) slide.notes = notes;
  return slide;
}

export function slideFingerprint(slide) {
  return JSON.stringify([
    slide.layout,
    slide.title,
    slide.bullets ?? [],
    (slide.columns ?? []).map((c) => [c.heading, c.items]),
    (slide.stats ?? []).map((s) => [s.value, s.label]),
    slide.quote?.text ?? '',
    (slide.steps ?? []).map((s) => s.title)
  ]);
}

export function normalizeMeta(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const title = text(firstOf(raw, ['title', 'name', 'topic', 'subject']), LIMITS.title);
  const subtitle = text(firstOf(raw, ['subtitle', 'subheading', 'tagline', 'description']), LIMITS.subtitle);
  const n = Number(firstOf(raw, ['slideCount', 'slide_count', 'total', 'count', 'pages']));
  const meta = {};
  if (title) meta.title = title;
  if (subtitle) meta.subtitle = subtitle;
  if (Number.isFinite(n) && n > 0) meta.slideCount = Math.min(Math.round(n), 99);
  return Object.keys(meta).length ? meta : null;
}

/** True when the object is a container ({slides:[...]}) rather than a slide. */
export function asSlideContainer(obj) {
  if (!obj || typeof obj !== 'object') return null;
  if (Array.isArray(obj)) return obj;
  if (Array.isArray(obj.slides)) return obj.slides;
  if (Array.isArray(obj.pages)) return obj.pages;
  if (obj.deck && Array.isArray(obj.deck.slides)) return obj.deck.slides;
  return null;
}

/**
 * Build the final, canonical deck.
 * @param {object} input
 * @param {Array} input.rawSlides
 * @param {object|null} [input.meta]
 */
export function normalizeDeck({ rawSlides = [], meta = null, deckTitle = '', theme = 'paper', maxSlides = 24, ensureBookends = true, source = {} }) {
  const seen = new Set();
  const slides = [];
  for (const raw of rawSlides) {
    if (slides.length >= maxSlides) break;
    const slide = normalizeSlide(raw, slides.length);
    if (!slide.title && !slide.bullets?.length && !slide.stats?.length && !slide.columns?.length && !slide.steps?.length && !slide.quote) {
      continue;
    }
    const fp = slideFingerprint(slide);
    if (seen.has(fp)) continue;
    seen.add(fp);
    slides.push(slide);
  }

  let title = meta?.title || deckTitle || slides.find((s) => s.layout === 'cover')?.title || slides[0]?.title || '未命名演示';
  let subtitle = meta?.subtitle || slides.find((s) => s.layout === 'cover')?.subtitle || '';

  if (ensureBookends && slides.length) {
    if (slides[0].layout !== 'cover') {
      const cover = { layout: 'cover', title, subtitle };
      slides.unshift(cover);
      if (slides.length > maxSlides) slides.pop();
    } else {
      if (!slides[0].title) slides[0].title = title;
      if (!slides[0].subtitle && subtitle) slides[0].subtitle = subtitle;
    }
    const last = slides[slides.length - 1];
    if (last && last.layout !== 'closing' && slides.length < maxSlides) {
      slides.push({ layout: 'closing', title: '谢谢观看', subtitle: last.title ? `${last.title}` : '' });
    }
  }

  return {
    version: 1,
    title,
    subtitle,
    theme,
    slides: slides.map((s, i) => ({ ...s, index: i })),
    meta: {
      slideCount: slides.length,
      requested: meta?.slideCount ?? null,
      generatedAt: new Date().toISOString(),
      ...source
    }
  };
}
