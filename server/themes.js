/**
 * Server-side access to the colour themes.
 *
 * The palettes deliberately live in exactly ONE place: the browser player
 * runtime (`web/src/player/runtime.js`). That file is a classic script with no
 * DOM access at module scope, so we can evaluate it in a sandbox here and read
 * the very same `THEMES` table the web player and the exported HTML use.
 *
 * Consequence: the PPTX export, the web preview and the standalone HTML file can
 * never drift apart. `tests/unit/themes.test.js` guards this contract.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const RUNTIME_PATH = path.resolve(__dirname, '..', 'web', 'src', 'player', 'runtime.js');

let cached = null;

function loadRuntime() {
  if (cached) return cached;
  const source = fs.readFileSync(RUNTIME_PATH, 'utf8');
  // The runtime ends with `global.PPTPlayer = {…}` where global is `window`
  // when it exists. Hand it a plain object instead of a real DOM window.
  const sandbox = {};
  // eslint-disable-next-line no-new-func
  const factory = new Function('window', 'globalThis', `${source}\n;return window.PPTPlayer;`);
  const api = factory(sandbox, sandbox);
  if (!api || !Array.isArray(api.THEMES) || !api.THEMES.length) {
    throw new Error(`无法从 ${RUNTIME_PATH} 读取 THEMES（播放器运行时结构已变更？）`);
  }
  cached = api;
  return api;
}

/** All themes exactly as the web player knows them. */
export function allThemes() {
  return loadRuntime().THEMES;
}

export function getTheme(id) {
  return loadRuntime().getTheme(id);
}

export function themeIds() {
  return allThemes().map((t) => t.id);
}

/** Resolve one CSS variable of a theme, with a fallback. */
export function themeVar(theme, name, fallback = '000000') {
  const value = theme?.vars?.[name];
  return typeof value === 'string' && value ? value : fallback;
}
