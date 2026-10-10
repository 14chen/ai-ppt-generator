/** 小工具集（小程序里避免依赖较新的内置方法）。 */

function pad2(n) {
  var v = Number(n) || 0;
  return v < 10 ? '0' + v : '' + v;
}

function formatMs(ms) {
  var s = Math.max(0, Math.round((Number(ms) || 0) / 1000));
  if (s < 60) return s + 's';
  return Math.floor(s / 60) + 'm' + pad2(s % 60) + 's';
}

var LAYOUT_LABELS = {
  cover: '封面',
  section: '章节',
  bullets: '要点',
  'two-column': '两栏',
  stats: '数据',
  quote: '金句',
  timeline: '流程',
  closing: '结尾'
};

function layoutLabel(layout) {
  return LAYOUT_LABELS[layout] || layout || '';
}

function clampText(value, max) {
  var s = value === null || value === undefined ? '' : String(value);
  return s.length > max ? s.slice(0, max - 1) + '…' : s;
}

/** rpx 设计画布 -> 适配屏幕的缩放系数 */
function fitScale(opts) {
  var designW = opts.designW || 1280;
  var designH = opts.designH || 720;
  var viewW = opts.viewW || 375;
  var viewH = opts.viewH || 600;
  // 750rpx == viewW(px)，所以设计画布在屏幕上的实际像素：
  var canvasW = (designW / 750) * viewW;
  var canvasH = (designH / 750) * viewW;
  var k = Math.min(viewW / canvasW, viewH / canvasH);
  return Math.max(0.05, k);
}

module.exports = {
  pad2: pad2,
  formatMs: formatMs,
  layoutLabel: layoutLabel,
  clampText: clampText,
  fitScale: fitScale
};
