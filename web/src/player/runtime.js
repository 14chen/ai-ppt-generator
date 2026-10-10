/*!
 * AI Web PPT — slide player runtime (single source of truth).
 *
 * This file is intentionally written as a CLASSIC script (no `import` / `export`,
 * no top-level await) so that the very same source can be used in two ways:
 *   1. the app injects it into a <script> tag (see loadRuntime.ts)
 *   2. the "export standalone HTML" feature inlines it verbatim
 * That guarantees the exported deck renders exactly like the in-app player.
 *
 * Public API (window.PPTPlayer):
 *   THEMES, themes, getTheme(id), applyTheme(el, id)
 *   slideHTML(slide, opts) -> string
 *   mount(rootEl, deck, options) -> handle
 *   VERSION
 */
(function (global) {
  'use strict';

  var VERSION = '1.0.0';
  var DESIGN_W = 1280;
  var DESIGN_H = 720;

  /* ------------------------------------------------------------------ themes */

  var THEMES = [
    {
      id: 'paper',
      label: '简约白',
      dark: false,
      vars: {
        'ppt-page-bg': '#e9edf4',
        'ppt-page-bg2': '#dfe6f2',
        'ppt-slide-bg': '#ffffff',
        'ppt-slide-bg2': '#f5f8ff',
        'ppt-text': '#0f1727',
        'ppt-dim': '#5c6a80',
        'ppt-accent': '#2f57e6',
        'ppt-accent2': '#7b5cf5',
        'ppt-line': '#e2e8f2',
        'ppt-chip-bg': '#f1f5fc',
        'ppt-quote-bg': '#f6f8fd',
        'ppt-shadow': '0 24px 60px rgba(21, 38, 74, .18)',
        'ppt-font-title': '"PingFang SC", "Microsoft YaHei", "Segoe UI", system-ui, sans-serif',
        'ppt-font-body': '"PingFang SC", "Microsoft YaHei", "Segoe UI", system-ui, sans-serif'
      }
    },
    {
      id: 'midnight',
      label: '深空蓝',
      dark: true,
      vars: {
        'ppt-page-bg': '#05080f',
        'ppt-page-bg2': '#0a1020',
        'ppt-slide-bg': '#0e1730',
        'ppt-slide-bg2': '#152245',
        'ppt-text': '#eaf1ff',
        'ppt-dim': '#93a4c9',
        'ppt-accent': '#3ddcff',
        'ppt-accent2': '#6c8cff',
        'ppt-line': '#1e2b4d',
        'ppt-chip-bg': '#16223f',
        'ppt-quote-bg': '#101c38',
        'ppt-shadow': '0 24px 70px rgba(0, 0, 0, .6)',
        'ppt-font-title': '"PingFang SC", "Microsoft YaHei", "Segoe UI", system-ui, sans-serif',
        'ppt-font-body': '"PingFang SC", "Microsoft YaHei", "Segoe UI", system-ui, sans-serif'
      }
    },
    {
      id: 'sunrise',
      label: '暖阳赤陶',
      dark: false,
      vars: {
        'ppt-page-bg': '#f6ece2',
        'ppt-page-bg2': '#f1e0d1',
        'ppt-slide-bg': '#fffaf4',
        'ppt-slide-bg2': '#fdf1e6',
        'ppt-text': '#2c1c14',
        'ppt-dim': '#8a6a58',
        'ppt-accent': '#dd5a35',
        'ppt-accent2': '#f0a05a',
        'ppt-line': '#f0dccd',
        'ppt-chip-bg': '#fbeade',
        'ppt-quote-bg': '#fdf1e7',
        'ppt-shadow': '0 24px 60px rgba(120, 72, 44, .22)',
        'ppt-font-title': '"PingFang SC", "Microsoft YaHei", "Segoe UI", system-ui, sans-serif',
        'ppt-font-body': '"PingFang SC", "Microsoft YaHei", "Segoe UI", system-ui, sans-serif'
      }
    },
    {
      id: 'forest',
      label: '墨绿森野',
      dark: true,
      vars: {
        'ppt-page-bg': '#05100c',
        'ppt-page-bg2': '#081913',
        'ppt-slide-bg': '#0c1f18',
        'ppt-slide-bg2': '#123026',
        'ppt-text': '#e9f6ef',
        'ppt-dim': '#8db3a4',
        'ppt-accent': '#32d69b',
        'ppt-accent2': '#a9e05f',
        'ppt-line': '#1b3a2f',
        'ppt-chip-bg': '#123026',
        'ppt-quote-bg': '#0e251d',
        'ppt-shadow': '0 24px 70px rgba(0, 0, 0, .55)',
        'ppt-font-title': '"PingFang SC", "Microsoft YaHei", "Segoe UI", system-ui, sans-serif',
        'ppt-font-body': '"PingFang SC", "Microsoft YaHei", "Segoe UI", system-ui, sans-serif'
      }
    },
    {
      id: 'neon',
      label: '霓虹夜色',
      dark: true,
      vars: {
        'ppt-page-bg': '#08040f',
        'ppt-page-bg2': '#0e0619',
        'ppt-slide-bg': '#140a24',
        'ppt-slide-bg2': '#1e0f33',
        'ppt-text': '#f6ecff',
        'ppt-dim': '#a98fd0',
        'ppt-accent': '#ff3ea5',
        'ppt-accent2': '#7c5cff',
        'ppt-line': '#2c1a47',
        'ppt-chip-bg': '#1e0f33',
        'ppt-quote-bg': '#180c2b',
        'ppt-shadow': '0 24px 70px rgba(0, 0, 0, .65)',
        'ppt-font-title': '"PingFang SC", "Microsoft YaHei", "Segoe UI", system-ui, sans-serif',
        'ppt-font-body': '"PingFang SC", "Microsoft YaHei", "Segoe UI", system-ui, sans-serif'
      }
    }
  ];

  var THEME_MAP = {};
  for (var i = 0; i < THEMES.length; i++) THEME_MAP[THEMES[i].id] = THEMES[i];

  function getTheme(id) {
    return THEME_MAP[id] || THEMES[0];
  }

  function applyTheme(el, id) {
    var t = getTheme(id);
    if (!el) return t;
    el.setAttribute('data-ppt-theme', t.id);
    if (el.style && el.style.setProperty) {
      for (var k in t.vars) {
        if (Object.prototype.hasOwnProperty.call(t.vars, k)) el.style.setProperty('--' + k, t.vars[k]);
      }
    }
    return t;
  }

  /* ------------------------------------------------------------- html helpers */

  var ESC_MAP = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };

  function esc(v) {
    if (v === null || v === undefined) return '';
    return String(v).replace(/[&<>"']/g, function (c) { return ESC_MAP[c]; });
  }

  function str(v) {
    if (v === null || v === undefined) return '';
    if (typeof v === 'string') return v;
    if (typeof v === 'number' || typeof v === 'boolean') return String(v);
    return '';
  }

  function arr(v) {
    return Array.isArray(v) ? v : [];
  }

  function textList(v) {
    var out = [];
    var list = arr(v);
    for (var i = 0; i < list.length; i++) {
      var item = list[i];
      var s = typeof item === 'string' ? item : str(item && (item.text || item.title || item.label || item.value));
      s = s.trim();
      if (s) out.push(s);
    }
    return out;
  }

  /* -------------------------------------------------------------- slide html */

  function num(o) {
    return '<span class="ppt-num">' + ((o.index || 0) + 1) + '</span>';
  }

  function footer(o) {
    var brand = str(o.deckTitle);
    return '<div class="ppt-foot">' +
      '<span class="ppt-brand">' + esc(brand) + '</span>' +
      num(o) +
      '</div>';
  }

  function headHTML(s) {
    var out = '<header class="ppt-head">';
    if (s.icon) out += '<span class="ppt-chip">' + esc(s.icon) + '</span>';
    out += '<h2 class="ppt-title">' + esc(s.title) + '</h2>';
    if (s.subtitle) out += '<p class="ppt-sub">' + esc(s.subtitle) + '</p>';
    out += '</header>';
    return out;
  }

  function frame(s, kind, inner, o) {
    return '<div class="ppt-inner">' + headHTML(s) +
      '<div class="ppt-body ppt-body-' + esc(kind) + '">' + inner + '</div>' +
      footer(o) + '</div>';
  }

  function bulletsInner(s) {
    var items = textList(s.bullets);
    if (!items.length) return '<p class="ppt-empty"></p>';
    var html = '<ul class="ppt-list">';
    for (var i = 0; i < items.length; i++) {
      html += '<li class="ppt-li"><span class="ppt-li-mark"></span><span class="ppt-li-text">' + esc(items[i]) + '</span></li>';
    }
    return html + '</ul>';
  }

  function bodyHTML(s, layout, o) {
    if (layout === 'cover') {
      var meta = textList(s.bullets);
      return '<div class="ppt-cover">' +
        '<span class="ppt-glow ppt-glow-a"></span><span class="ppt-glow ppt-glow-b"></span>' +
        '<div class="ppt-cover-inner">' +
        (s.subtitle ? '<p class="ppt-kicker">' + esc(s.subtitle) + '</p>' : '') +
        '<h1 class="ppt-title ppt-title-xl">' + esc(s.title || '未命名演示') + '</h1>' +
        '<span class="ppt-rule"></span>' +
        (meta.length ? '<ul class="ppt-cover-meta">' + meta.map(function (m) {
          return '<li>' + esc(m) + '</li>';
        }).join('') + '</ul>' : '') +
        '</div>' + footer(o) + '</div>';
    }

    if (layout === 'closing') {
      return '<div class="ppt-closing">' +
        '<span class="ppt-glow ppt-glow-a"></span><span class="ppt-glow ppt-glow-b"></span>' +
        '<div class="ppt-cover-inner">' +
        '<h1 class="ppt-title ppt-title-xl">' + esc(s.title || '谢谢观看') + '</h1>' +
        (s.subtitle ? '<p class="ppt-kicker ppt-kicker-lg">' + esc(s.subtitle) + '</p>' : '') +
        (textList(s.bullets).length ? '<ul class="ppt-cover-meta">' + textList(s.bullets).map(function (m) {
          return '<li>' + esc(m) + '</li>';
        }).join('') + '</ul>' : '') +
        '</div>' + footer(o) + '</div>';
    }

    if (layout === 'section') {
      var sec = '<div class="ppt-section">' +
        '<span class="ppt-section-idx">' + String((o.index || 0) + 1).padStart(2, '0') + '</span>' +
        '<h2 class="ppt-title ppt-title-lg">' + esc(s.title) + '</h2>' +
        (s.subtitle ? '<p class="ppt-sub ppt-sub-lg">' + esc(s.subtitle) + '</p>' : '') +
        '</div>';
      return '<div class="ppt-inner ppt-inner-center">' + sec + footer(o) + '</div>';
    }

    if (layout === 'stats') {
      var stats = arr(s.stats);
      var inner = '<div class="ppt-stats">';
      for (var i = 0; i < stats.length; i++) {
        var st = stats[i] || {};
        inner += '<div class="ppt-stat"><span class="ppt-stat-value">' + esc(str(st.value)) + '</span>' +
          '<span class="ppt-stat-label">' + esc(str(st.label)) + '</span></div>';
      }
      inner += '</div>';
      return frame(s, 'stats', inner, o);
    }

    if (layout === 'quote') {
      var q = s.quote || {};
      var qtext = typeof q === 'string' ? q : str(q.text);
      var qauthor = typeof q === 'string' ? str(s.subtitle) : str(q.author || s.subtitle);
      var qi = '<blockquote class="ppt-quote">' +
        '<span class="ppt-quote-mark">&ldquo;</span>' +
        '<p class="ppt-quote-text">' + esc(qtext) + '</p>' +
        (qauthor ? '<footer class="ppt-quote-author">— ' + esc(qauthor) + '</footer>' : '') +
        '</blockquote>';
      return frame(s, 'quote', qi, o);
    }

    if (layout === 'timeline') {
      var steps = arr(s.steps);
      var ti = '<ol class="ppt-timeline">';
      for (var j = 0; j < steps.length; j++) {
        var step = steps[j] || {};
        var title = str(step.title || step.label || step.name);
        var detail = str(step.detail || step.text || step.desc);
        ti += '<li class="ppt-step"><span class="ppt-step-dot">' + (j + 1) + '</span>' +
          '<div class="ppt-step-body"><h3 class="ppt-step-title">' + esc(title) + '</h3>' +
          (detail ? '<p class="ppt-step-detail">' + esc(detail) + '</p>' : '') + '</div></li>';
      }
      ti += '</ol>';
      return frame(s, 'timeline', ti, o);
    }

    if (layout === 'two-column') {
      var cols = arr(s.columns);
      var ci = '<div class="ppt-columns" data-count="' + cols.length + '">';
      for (var c = 0; c < cols.length; c++) {
        var col = cols[c] || {};
        var items = textList(col.items || col.bullets);
        ci += '<div class="ppt-column"><h3 class="ppt-col-title">' + esc(str(col.heading || col.title)) + '</h3>' +
          '<ul class="ppt-list ppt-list-sm">' + items.map(function (it) {
            return '<li class="ppt-li"><span class="ppt-li-mark"></span><span class="ppt-li-text">' + esc(it) + '</span></li>';
          }).join('') + '</ul></div>';
      }
      ci += '</div>';
      return frame(s, 'two-column', ci, o);
    }

    return frame(s, 'bullets', bulletsInner(s), o);
  }

  function slideHTML(slide, opts) {
    opts = opts || {};
    var s = slide || {};
    var layout = str(s.layout) || 'bullets';
    var o = { index: opts.index || 0, deckTitle: opts.deckTitle || '' };
    return '<section class="ppt-slide' + (opts.active ? ' is-active' : '') + '"' +
      ' data-layout="' + esc(layout) + '"' +
      ' aria-roledescription="slide"' +
      ' aria-label="第 ' + (o.index + 1) + ' 页"' +
      '>' + bodyHTML(s, layout, o) + '</section>';
  }

  /* ------------------------------------------------------------------ player */

  function mount(root, deck, options) {
    if (!root) throw new Error('PPTPlayer.mount: root element is required');
    options = options || {};
    deck = deck || { slides: [] };
    var slides = arr(deck.slides);
    if (!slides.length) slides = [{ layout: 'cover', title: str(deck.title) || '空白演示' }];

    var listeners = {};
    var state = {
      index: 0,
      theme: options.theme || deck.theme || THEMES[0].id,
      notes: !!options.notes,
      destroyed: false
    };

    function emit(type, payload) {
      var l = listeners[type];
      if (!l) return;
      for (var i = 0; i < l.length; i++) {
        try { l[i](payload, state); } catch (e) { /* listener errors must not break the player */ }
      }
    }

    function on(type, cb) {
      (listeners[type] = listeners[type] || []).push(cb);
      return function () { off(type, cb); };
    }

    function off(type, cb) {
      var l = listeners[type];
      if (!l) return;
      var i = l.indexOf(cb);
      if (i >= 0) l.splice(i, 1);
    }

    var deckTitle = str(deck.title);

    // ---- build DOM
    root.classList.add('ppt-player');
    applyTheme(root, state.theme);
    if (options.chrome === false) root.classList.add('ppt-no-chrome');

    var stageHTML = slides.map(function (s, i) {
      return slideHTML(s, { index: i, deckTitle: deckTitle, active: i === 0 });
    }).join('');

    var dotsHTML = slides.map(function (s, i) {
      return '<button class="ppt-dot" type="button" data-go="' + i + '" aria-label="第 ' + (i + 1) + ' 页"' +
        (i === 0 ? ' aria-current="true"' : '') + '></button>';
    }).join('');

    root.innerHTML =
      '<div class="ppt-stage"><div class="ppt-canvas" data-canvas>' + stageHTML + '</div></div>' +
      '<div class="ppt-progress"><i data-progress></i></div>' +
      '<div class="ppt-hud">' +
      '<div class="ppt-hud-group">' +
      '<button class="ppt-btn" type="button" data-act="prev" aria-label="上一页" title="上一页 (←)">‹</button>' +
      '<button class="ppt-btn" type="button" data-act="next" aria-label="下一页" title="下一页 (→ / 空格)">›</button>' +
      '</div>' +
      '<div class="ppt-dots" data-dots>' + dotsHTML + '</div>' +
      '<div class="ppt-hud-group">' +
      '<span class="ppt-counter" data-counter>1 / ' + slides.length + '</span>' +
      '<button class="ppt-btn ppt-btn-sm" type="button" data-act="theme" aria-label="切换配色主题" title="切换主题 (T)">🎨 <span data-theme-label></span></button>' +
      (slides.some(function (s) { return s && s.notes; })
        ? '<button class="ppt-btn ppt-btn-sm" type="button" data-act="notes" aria-label="演讲者备注" title="演讲者备注 (N)">📝</button>'
        : '') +
      '<button class="ppt-btn ppt-btn-sm" type="button" data-act="fullscreen" aria-label="全屏" title="全屏 (F)">⛶</button>' +
      (options.onClose ? '<button class="ppt-btn ppt-btn-sm" type="button" data-act="close" aria-label="退出演示" title="退出 (Esc)">✕</button>' : '') +
      '</div>' +
      '</div>' +
      '<div class="ppt-notes" data-notes hidden><div class="ppt-notes-inner"><b>演讲者备注</b><p data-notes-body></p></div></div>';

    var stage = root.querySelector('.ppt-stage');
    var canvas = root.querySelector('[data-canvas]');
    var slideEls = Array.prototype.slice.call(root.querySelectorAll('.ppt-slide'));
    var dotEls = Array.prototype.slice.call(root.querySelectorAll('.ppt-dot'));
    var counterEl = root.querySelector('[data-counter]');
    var progressEl = root.querySelector('[data-progress]');
    var themeLabelEl = root.querySelector('[data-theme-label]');
    var notesEl = root.querySelector('[data-notes]');
    var notesBody = root.querySelector('[data-notes-body]');

    // ---- scale to fit (fixed 1280x720 design canvas)
    function fit() {
      var w = stage.clientWidth || root.clientWidth || DESIGN_W;
      var h = stage.clientHeight || root.clientHeight || DESIGN_H;
      var k = Math.min(w / DESIGN_W, h / DESIGN_H);
      if (!isFinite(k) || k <= 0) k = 1;
      canvas.style.setProperty('--ppt-scale', String(k));
    }

    // ---- rendering state
    function render() {
      for (var i = 0; i < slideEls.length; i++) {
        slideEls[i].classList.toggle('is-active', i === state.index);
        slideEls[i].setAttribute('aria-hidden', i === state.index ? 'false' : 'true');
      }
      for (var d = 0; d < dotEls.length; d++) {
        if (d === state.index) dotEls[d].setAttribute('aria-current', 'true');
        else dotEls[d].removeAttribute('aria-current');
      }
      counterEl.textContent = (state.index + 1) + ' / ' + slides.length;
      progressEl.style.width = (((state.index + 1) / slides.length) * 100).toFixed(2) + '%';
      updateNotes();
    }

    function updateNotes() {
      if (!notesEl) return;
      var slide = slides[state.index] || {};
      notesBody.textContent = str(slide.notes) || '（本页没有备注）';
      notesEl.hidden = !state.notes;
    }

    function goTo(i, reason) {
      i = Math.max(0, Math.min(slides.length - 1, i | 0));
      if (i === state.index) { render(); return; }
      state.index = i;
      render();
      emit('change', { index: state.index, reason: reason || 'api' });
    }

    function next() {
      if (state.index >= slides.length - 1) { emit('end'); return; }
      goTo(state.index + 1, 'next');
    }

    function prev() { goTo(state.index - 1, 'prev'); }

    function setTheme(id) {
      state.theme = getTheme(id).id;
      applyTheme(root, state.theme);
      if (themeLabelEl) themeLabelEl.textContent = getTheme(state.theme).label;
      emit('theme', { theme: state.theme });
      return state.theme;
    }

    function cycleTheme() {
      var idx = 0;
      for (var i = 0; i < THEMES.length; i++) if (THEMES[i].id === state.theme) idx = i;
      return setTheme(THEMES[(idx + 1) % THEMES.length].id);
    }

    function toggleNotes(force) {
      state.notes = typeof force === 'boolean' ? force : !state.notes;
      updateNotes();
      return state.notes;
    }

    function toggleFullscreen() {
      var doc = global.document;
      if (!doc) return false;
      var fsEl = doc.fullscreenElement || doc.webkitFullscreenElement;
      if (fsEl) {
        (doc.exitFullscreen || doc.webkitExitFullscreen || function () {}).call(doc);
        return false;
      }
      var req = root.requestFullscreen || root.webkitRequestFullscreen;
      if (req) { try { req.call(root); } catch (e) { /* ignore */ } }
      return true;
    }

    // ---- events
    function onClick(e) {
      var goBtn = e.target.closest ? e.target.closest('[data-go]') : null;
      if (goBtn) { goTo(Number(goBtn.getAttribute('data-go')), 'dot'); return; }
      var btn = e.target.closest ? e.target.closest('[data-act]') : null;
      if (!btn) return;
      var act = btn.getAttribute('data-act');
      if (act === 'next') next();
      else if (act === 'prev') prev();
      else if (act === 'theme') cycleTheme();
      else if (act === 'notes') toggleNotes();
      else if (act === 'fullscreen') toggleFullscreen();
      else if (act === 'close' && options.onClose) options.onClose();
    }

    function isTypingTarget(t) {
      if (!t || !t.tagName) return false;
      var tag = t.tagName.toLowerCase();
      return tag === 'input' || tag === 'textarea' || tag === 'select' || t.isContentEditable;
    }

    function onKeyDown(e) {
      if (e.defaultPrevented || isTypingTarget(e.target)) return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      var k = e.key;
      if (k === 'ArrowRight' || k === 'ArrowDown' || k === 'PageDown' || k === ' ' || k === 'Spacebar' || k === 'Enter' || k === 'j') {
        e.preventDefault(); next();
      } else if (k === 'ArrowLeft' || k === 'ArrowUp' || k === 'PageUp' || k === 'k') {
        e.preventDefault(); prev();
      } else if (k === 'Home') { e.preventDefault(); goTo(0, 'home'); }
      else if (k === 'End') { e.preventDefault(); goTo(slides.length - 1, 'end-key'); }
      else if (k === 'f' || k === 'F') { e.preventDefault(); toggleFullscreen(); }
      else if (k === 't' || k === 'T') { e.preventDefault(); cycleTheme(); }
      else if (k === 'n' || k === 'N') { if (notesEl) { e.preventDefault(); toggleNotes(); } }
      else if (k === 'Escape') {
        var doc = global.document;
        if (doc && (doc.fullscreenElement || doc.webkitFullscreenElement)) return; // browser exits fullscreen itself
        if (state.notes) { e.preventDefault(); toggleNotes(false); }
        else if (options.onClose) { e.preventDefault(); options.onClose(); }
      }
    }

    var touch = null;
    function onTouchStart(e) {
      if (!e.touches || e.touches.length !== 1) { touch = null; return; }
      touch = { x: e.touches[0].clientX, y: e.touches[0].clientY, t: Date.now() };
    }
    function onTouchEnd(e) {
      if (!touch || !e.changedTouches || !e.changedTouches.length) return;
      var dx = e.changedTouches[0].clientX - touch.x;
      var dy = e.changedTouches[0].clientY - touch.y;
      var dt = Date.now() - touch.t;
      touch = null;
      if (dt > 800) return;
      if (Math.abs(dx) > 45 && Math.abs(dx) > Math.abs(dy) * 1.4) {
        if (dx < 0) next(); else prev();
      }
    }

    root.addEventListener('click', onClick);
    root.addEventListener('touchstart', onTouchStart, { passive: true });
    root.addEventListener('touchend', onTouchEnd, { passive: true });
    if (global.document) global.document.addEventListener('keydown', onKeyDown);

    var ro = null;
    if (global.ResizeObserver) {
      ro = new ResizeObserver(fit);
      ro.observe(stage);
    }
    global.addEventListener('resize', fit);

    // A 16:9 deck is hard to read on a phone held upright — nudge once.
    var hintEl = null;
    var hintTimer = null;
    function maybeShowRotateHint() {
      if (!global.document || options.rotateHint === false) return;
      var portraitPhone = global.innerWidth < 760 && global.innerHeight > global.innerWidth;
      if (!portraitPhone || hintEl) return;
      hintEl = global.document.createElement('div');
      hintEl.className = 'ppt-rotate-hint';
      hintEl.textContent = '📱 横屏观看更清晰';
      root.appendChild(hintEl);
      hintTimer = global.setTimeout(function () {
        if (hintEl && hintEl.parentNode) hintEl.parentNode.removeChild(hintEl);
        hintEl = null;
      }, 4500);
    }

    setTheme(state.theme);
    fit();
    render();
    maybeShowRotateHint();
    // double rAF: layout may not be final on the very first frame (fonts/overlay mount)
    if (global.requestAnimationFrame) {
      global.requestAnimationFrame(function () { global.requestAnimationFrame(fit); });
    }

    function destroy() {
      if (state.destroyed) return;
      state.destroyed = true;
      if (ro) ro.disconnect();
      if (hintTimer) global.clearTimeout(hintTimer);
      global.removeEventListener('resize', fit);
      if (global.document) global.document.removeEventListener('keydown', onKeyDown);
      root.removeEventListener('click', onClick);
      root.removeEventListener('touchstart', onTouchStart);
      root.removeEventListener('touchend', onTouchEnd);
      root.classList.remove('ppt-player', 'ppt-no-chrome');
      root.innerHTML = '';
      listeners = {};
    }

    return {
      version: VERSION,
      next: next,
      prev: prev,
      goTo: goTo,
      setTheme: setTheme,
      cycleTheme: cycleTheme,
      toggleNotes: toggleNotes,
      toggleFullscreen: toggleFullscreen,
      fit: fit,
      destroy: destroy,
      on: on,
      off: off,
      getState: function () { return { index: state.index, theme: state.theme, notes: state.notes, total: slides.length }; },
      root: root
    };
  }

  global.PPTPlayer = {
    VERSION: VERSION,
    DESIGN_W: DESIGN_W,
    DESIGN_H: DESIGN_H,
    THEMES: THEMES,
    themes: THEME_MAP,
    getTheme: getTheme,
    applyTheme: applyTheme,
    esc: esc,
    slideHTML: slideHTML,
    mount: mount
  };
})(typeof window !== 'undefined' ? window : globalThis);
