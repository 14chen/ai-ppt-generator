/**
 * Tolerant NDJSON/JSON stream parser.
 *
 * The model is asked to answer with one JSON object per line (a `meta` line and
 * then one line per slide). Real models drift: they wrap output in ```json
 * fences, they emit a single `{"slides":[...]}` document instead of NDJSON, or
 * they get truncated by max_tokens.
 *
 * This parser therefore does NOT try to match a schema while streaming. It runs
 * a single-pass brace scanner that keeps a stack of open `{` positions and, as
 * soon as ANY balanced JSON object completes, tries to parse and classify it:
 *
 *   - `{...}` inside a `slides: [...]` container closes BEFORE the container,
 *     so slides still arrive one-by-one in real time
 *   - incomplete objects at the end of the stream are simply never emitted
 *     (a truncated final slide is dropped instead of corrupting the deck)
 *   - a whole-buffer JSON parse at the end provides the authoritative list when
 *     the model returned one big document
 *
 * The scanner is O(n) with no backtracking, so it is safe to call per token.
 */

import {
  asSlideContainer,
  looksLikeSlide,
  normalizeLayout,
  normalizeMeta,
  normalizeSlide,
  slideFingerprint
} from './deck.js';

const MAX_BUFFER = 4 * 1024 * 1024;

/** Keys that can only belong to a deck-level meta object. */
const META_KEYS = new Set([
  'type', 'title', 'subtitle', 'subheading', 'name', 'description', 'desc',
  'slidecount', 'slide_count', 'total', 'pages', 'count', 'author', 'date',
  'theme', 'language', 'lang', 'tags', 'meta', 'version'
]);

const BODY_KEYS = [
  'layout', 'kind', 'bullets', 'points', 'items', 'keyPoints', 'key_points',
  'content', 'body', 'columns', 'stats', 'metrics', 'quote', 'steps', 'timeline',
  'phases', 'icon', 'notes', 'speakerNotes'
];

/**
 * Fields that only ever appear on a FULL slide. Used to decide whether a
 * nested object (depth > 1) is a slide rather than one of its own fragments:
 * a column `{heading, items}`, a stat `{value, label}`, a step
 * `{title, detail}` or a quote body `{text, author}` must never become a page
 * of its own.
 */
const SLIDE_LEVEL_KEYS = [
  'bullets', 'columns', 'stats', 'metrics', 'steps', 'timeline', 'phases',
  'quote', 'notes', 'speakerNotes', 'subtitle', 'subheading', 'icon'
];

export function createSlideStreamParser({ maxSlides = 24 } = {}) {
  let buffer = '';
  let cursor = 0;
  let inString = false;
  let escaped = false;
  /** Stack of indices of currently open `{`. */
  const open = [];
  const rawSlides = [];
  const rawSeen = new Set();
  const emitted = new Set();
  let meta = null;

  function hasBody(obj) {
    return BODY_KEYS.some((k) => obj[k] !== null && obj[k] !== undefined);
  }

  function looksLikeNestedSlide(obj) {
    if (normalizeLayout(obj.layout ?? obj.kind ?? obj.type)) return true;
    return SLIDE_LEVEL_KEYS.some((k) => obj[k] !== null && obj[k] !== undefined);
  }

  /**
   * A plain `{"title":"…"}` object seen before any slide is deck metadata
   * (e.g. the nested intro of a `{"meta":{…},"slides":[…]}` document), not a slide.
   */
  function isLeadingMeta(obj) {
    if (emitted.size > 0) return false;
    if (hasBody(obj)) return false;
    const keys = Object.keys(obj).map((k) => k.toLowerCase());
    if (!keys.length) return false;
    return keys.every((k) => META_KEYS.has(k));
  }

  /**
   * @param {object} obj parsed JSON object
   * @param {number} depth 1 = top level of the stream, 2+ = nested inside another object
   */
  function classify(obj, depth) {
    const container = asSlideContainer(obj);
    if (container) return { kind: 'container', slides: container };
    const type = typeof obj.type === 'string' ? obj.type.trim().toLowerCase() : '';
    if (type === 'meta' || type === 'end' || type === 'done') return { kind: 'meta' };
    if (!hasBody(obj) && (obj.slideCount !== undefined || obj.slide_count !== undefined || obj.total !== undefined)) {
      return { kind: 'meta' };
    }
    if (isLeadingMeta(obj)) return { kind: 'meta' };
    // Nested fragments (columns / stats / steps / quote bodies) are not pages.
    if (depth > 1 && !looksLikeNestedSlide(obj)) return { kind: 'ignore' };
    if (looksLikeSlide(obj)) return { kind: 'slide' };
    return { kind: 'ignore' };
  }

  function remember(raw) {
    const key = JSON.stringify(raw);
    if (rawSeen.has(key)) return false;
    rawSeen.add(key);
    if (rawSlides.length < maxSlides * 3) rawSlides.push(raw);
    return true;
  }

  function emitSlide(raw, events) {
    if (!remember(raw)) return;
    if (events.length > maxSlides * 4) return;
    const slide = normalizeSlide(raw, rawSlides.length - 1);
    const fp = slideFingerprint(slide);
    if (emitted.has(fp)) return;
    emitted.add(fp);
    events.push({ type: 'slide', index: emitted.size - 1, slide });
  }

  function handleObject(obj, events, depth) {
    const { kind, slides } = classify(obj, depth);
    if (kind === 'meta') {
      const next = normalizeMeta(obj);
      if (next) {
        meta = { ...(meta ?? {}), ...next };
        events.push({ type: 'meta', meta: { ...meta } });
      }
    } else if (kind === 'container') {
      for (const raw of slides) {
        if (raw && typeof raw === 'object') emitSlide(raw, events);
      }
    } else if (kind === 'slide') {
      emitSlide(obj, events);
    }
  }

  /** Feed a chunk of model output; returns the list of parsed events. */
  function feed(text) {
    if (typeof text !== 'string' || !text) return [];
    buffer += text;
    if (buffer.length > MAX_BUFFER) buffer = buffer.slice(-MAX_BUFFER);
    const events = [];
    for (; cursor < buffer.length; cursor++) {
      const code = buffer.charCodeAt(cursor);
      if (inString) {
        if (escaped) escaped = false;
        else if (code === 92 /* \ */) escaped = true;
        else if (code === 34 /* " */) inString = false;
        continue;
      }
      if (code === 34 /* " */) {
        inString = true;
      } else if (code === 123 /* { */) {
        open.push(cursor);
      } else if (code === 125 /* } */) {
        const start = open.pop();
        if (start === undefined) continue;
        const depth = open.length + 1; // 1 = outermost object of the stream
        const slice = buffer.slice(start, cursor + 1);
        let obj;
        try {
          obj = JSON.parse(slice);
        } catch {
          continue; // not valid JSON on its own -> ignore this candidate
        }
        handleObject(obj, events, depth);
      }
    }
    return events;
  }

  function tryParseWholeBuffer() {
    const empty = { slides: [], meta: null };
    const cleaned = buffer
      .replace(/^\s*```[a-zA-Z]*\s*$/gm, '')
      .replace(/```/g, '')
      .trim();
    if (!cleaned) return empty;

    const parse = (s) => {
      try {
        return JSON.parse(s);
      } catch {
        return undefined;
      }
    };

    let value = parse(cleaned);
    if (value === undefined) {
      const firstBrace = cleaned.indexOf('{');
      const firstBracket = cleaned.indexOf('[');
      const candidates = [firstBrace, firstBracket].filter((n) => n >= 0);
      if (candidates.length) {
        const start = Math.min(...candidates);
        const end = Math.max(cleaned.lastIndexOf('}'), cleaned.lastIndexOf(']'));
        if (end > start) value = parse(cleaned.slice(start, end + 1));
      }
    }
    if (value === undefined) return empty;

    let metaCandidate = null;
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      const type = typeof value.type === 'string' ? value.type.trim().toLowerCase() : '';
      if (value.meta && typeof value.meta === 'object') metaCandidate = normalizeMeta(value.meta);
      else if (type === 'meta') metaCandidate = normalizeMeta(value);
    }

    const container = asSlideContainer(value);
    if (container) return { slides: container.filter((s) => s && typeof s === 'object'), meta: metaCandidate };
    if (Array.isArray(value)) return { slides: value.filter((s) => s && typeof s === 'object'), meta: metaCandidate };
    if (looksLikeSlide(value)) return { slides: [value], meta: metaCandidate };
    return { slides: [], meta: metaCandidate };
  }

  /**
   * Finalise the stream.
   * @returns {{rawSlides: Array, meta: object|null, fromWholeBuffer: boolean, raw: string}}
   */
  function finish() {
    const whole = tryParseWholeBuffer();
    const mergedMeta = { ...(meta ?? {}), ...(whole.meta ?? {}) };
    return {
      rawSlides: whole.slides.length ? whole.slides : rawSlides.slice(),
      meta: Object.keys(mergedMeta).length ? mergedMeta : null,
      fromWholeBuffer: whole.slides.length > 0,
      raw: buffer
    };
  }

  return {
    feed,
    finish,
    get raw() {
      return buffer;
    },
    get meta() {
      return meta;
    },
    get slides() {
      return rawSlides;
    }
  };
}
