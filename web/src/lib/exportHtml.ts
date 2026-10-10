import slideCss from '../player/slide.css?raw';
import { getPlayer, runtimeSource } from './player';
import type { Deck } from '../types';

function escapeForInlineScript(json: string): string {
  return json
    .replace(/</g, '\\u003c')
    .replace(/>/g, '\\u003e')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029');
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] as string
  );
}

export function safeFileName(title: string, ext: string): string {
  const base = (title || 'AI生成的网页PPT')
    .replace(/[\\/:*?"<>|\r\n\t]+/g, ' ')
    .replace(/\s+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
  return `${base || 'AI生成的网页PPT'}.${ext}`;
}

/**
 * Produce a fully self-contained HTML presentation: inline CSS, inline player
 * runtime and inline deck JSON. No network access is required to open it.
 */
export function buildStandaloneHtml(deck: Deck, themeId: string): string {
  const player = getPlayer();
  const theme = player.getTheme(themeId);
  const deckForExport = { ...deck, theme: theme.id };
  const json = escapeForInlineScript(JSON.stringify(deckForExport));
  const title = escapeHtml(deck.title || 'AI 生成的网页 PPT');
  const exportedAt = new Date().toLocaleString('zh-CN');

  return `<!doctype html>
<html lang="zh-CN" data-ppt-export="1">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="generator" content="AI 网页 PPT 生成器 · 导出时间 ${escapeHtml(exportedAt)}">
<title>${title}</title>
<style>
html, body { margin: 0; padding: 0; height: 100%; background: #0b1020; }
#ppt-app { position: fixed; inset: 0; }
@media print { html, body { background: #fff; } #ppt-app { position: static; } }
</style>
<style>
${slideCss}
</style>
</head>
<body>
<div id="ppt-app"></div>
<noscript><p style="color:#fff;font:16px system-ui;padding:24px">这份演示需要启用 JavaScript 才能翻页。</p></noscript>

<script id="ppt-deck" type="application/json">${json}</script>

<!-- player runtime (identical code to the editor preview) -->
<script>
${runtimeSource}
</script>

<script>
(function () {
  var deck = JSON.parse(document.getElementById('ppt-deck').textContent);
  var app = document.getElementById('ppt-app');
  var player = window.PPTPlayer;
  player.mount(app, deck, { theme: deck.theme || '${theme.id}' });
  // Keep the browser tab title in sync with the deck title.
  if (deck.title) document.title = deck.title;
})();
</script>
</body>
</html>
`;
}

export function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.rel = 'noopener';
  a.style.display = 'none';
  document.body.appendChild(a);
  a.click();
  window.setTimeout(() => {
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }, 1500);
}

export function downloadFile(content: string, filename: string, mime: string) {
  downloadBlob(new Blob([content], { type: mime }), filename);
}

export function exportDeckAsHtml(deck: Deck, themeId: string) {
  const html = buildStandaloneHtml(deck, themeId);
  downloadFile(html, safeFileName(deck.title, 'html'), 'text/html;charset=utf-8');
  return html;
}

export function exportDeckAsJson(deck: Deck, themeId: string) {
  const payload = JSON.stringify({ ...deck, theme: themeId }, null, 2);
  downloadFile(payload, safeFileName(deck.title, 'json'), 'application/json;charset=utf-8');
  return payload;
}
