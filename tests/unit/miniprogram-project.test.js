import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { MINIPROGRAM_DIR, ROOT, createMiniProgramLoader } from '../helpers/miniprogram-loader.js';
import { allThemes } from '../../server/themes.js';

const load = createMiniProgramLoader(MINIPROGRAM_DIR);
const read = (rel) => fs.readFileSync(path.join(MINIPROGRAM_DIR, rel), 'utf8');
const exists = (rel) => fs.existsSync(path.join(MINIPROGRAM_DIR, rel));
const readJson = (rel) => JSON.parse(read(rel));

/** WXML built-in tags — anything else must come from usingComponents. */
const BUILTIN_TAGS = new Set([
  'view', 'scroll-view', 'swiper', 'swiper-item', 'movable-area', 'movable-view', 'cover-view', 'cover-image',
  'text', 'rich-text', 'progress', 'icon', 'button', 'checkbox', 'checkbox-group', 'form', 'input', 'label',
  'picker', 'picker-view', 'picker-view-column', 'radio', 'radio-group', 'slider', 'switch', 'textarea',
  'navigator', 'functional-page-navigator', 'audio', 'image', 'video', 'camera', 'live-player', 'live-pusher',
  'map', 'canvas', 'open-data', 'web-view', 'ad', 'official-account', 'block', 'template', 'import', 'include',
  'wxs', 'slot', 'page-meta', 'navigation-bar', 'match-media', 'page-container', 'share-element', 'keyboard-accessory'
]);

function walk(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else out.push(full);
  }
  return out;
}

const allFiles = walk(MINIPROGRAM_DIR).map((f) => path.relative(MINIPROGRAM_DIR, f).replace(/\\/g, '/'));
const wxmlFiles = allFiles.filter((f) => f.endsWith('.wxml'));
const jsFiles = allFiles.filter((f) => f.endsWith('.js'));
const wxssFiles = allFiles.filter((f) => f.endsWith('.wxss'));
const jsonFiles = allFiles.filter((f) => f.endsWith('.json'));

/** Every JS file must at least be syntactically valid (classic script, like the mini program runtime). */
test('miniprogram: every .js file compiles', () => {
  assert.ok(jsFiles.length >= 8, `expected the mini program sources, found ${jsFiles.length} js files`);
  for (const file of jsFiles) {
    const source = read(file);
    assert.doesNotThrow(() => new vm.Script(source, { filename: file }), `syntax error in ${file}`);
  }
});

test('miniprogram: every .json file parses', () => {
  for (const file of jsonFiles) {
    assert.doesNotThrow(() => JSON.parse(read(file)), `invalid JSON in ${file}`);
  }
});

test('miniprogram: app.json pages all exist with js/json/wxml', () => {
  const app = readJson('app.json');
  assert.ok(Array.isArray(app.pages) && app.pages.length >= 3);
  for (const page of app.pages) {
    for (const ext of ['js', 'json', 'wxml']) {
      assert.ok(exists(`${page}.${ext}`), `missing ${page}.${ext}`);
    }
  }
  assert.ok(fs.existsSync(path.join(MINIPROGRAM_DIR, app.sitemapLocation)), 'sitemap file missing');
});

test('miniprogram: usingComponents paths resolve (with all files)', () => {
  for (const file of jsonFiles) {
    const dir = path.posix.dirname(file);
    const json = JSON.parse(read(file));
    const using = json.usingComponents || {};
    for (const [name, target] of Object.entries(using)) {
      const rel = target.startsWith('/')
        ? target.slice(1)
        : path.posix.normalize(path.posix.join(dir, target));
      for (const ext of ['js', 'json', 'wxml']) {
        assert.ok(exists(`${rel}.${ext}`), `${file}: component "${name}" -> missing ${rel}.${ext}`);
      }
    }
  }
});

test('miniprogram: wxml uses only declared custom components', () => {
  for (const file of wxmlFiles) {
    const jsonPath = `${file.slice(0, -'.wxml'.length)}.json`;
    const using = exists(jsonPath) ? JSON.parse(read(jsonPath)).usingComponents || {} : {};
    const source = read(file).replace(/<!--[\s\S]*?-->/g, '');
    const tags = new Set();
    for (const m of source.matchAll(/<([a-zA-Z][a-zA-Z0-9-]*)/g)) tags.add(m[1]);
    for (const tag of tags) {
      if (BUILTIN_TAGS.has(tag)) continue;
      assert.ok(using[tag], `${file}: uses <${tag}> but it is not in usingComponents`);
    }
  }
});

test('miniprogram: every wxml event handler exists in the paired .js', () => {
  for (const file of wxmlFiles) {
    const jsPath = `${file.slice(0, -'.wxml'.length)}.js`;
    assert.ok(exists(jsPath), `missing ${jsPath}`);
    const js = read(jsPath);
    const handlers = new Set();
    for (const m of read(file).matchAll(/\b(?:bind|catch):?([a-zA-Z]+)\s*=\s*"([^"{}]+)"/g)) {
      handlers.add(m[2].trim());
    }
    for (const handler of handlers) {
      const pattern = new RegExp(`\\b${handler}\\s*[:(]`);
      assert.ok(pattern.test(js), `${file}: handler "${handler}" is not defined in ${jsPath}`);
    }
  }
});

test('miniprogram: wxss @import targets exist', () => {
  for (const file of wxssFiles) {
    const dir = path.posix.dirname(file);
    for (const m of read(file).matchAll(/@import\s+["']([^"']+)["']/g)) {
      const target = path.posix.normalize(path.posix.join(dir, m[1]));
      assert.ok(exists(target), `${file}: @import "${m[1]}" -> missing ${target}`);
    }
  }
});

test('miniprogram: require() targets exist', () => {
  for (const file of jsFiles) {
    const dir = path.posix.dirname(file);
    for (const m of read(file).matchAll(/require\(\s*['"]([^'"]+)['"]\s*\)/g)) {
      assert.ok(m[1].startsWith('.'), `${file}: non-relative require "${m[1]}"`);
      let target = path.posix.normalize(path.posix.join(dir, m[1]));
      if (exists(target) && fs.statSync(path.join(MINIPROGRAM_DIR, target)).isDirectory()) {
        target = `${target}/index.js`;
      }
      if (!exists(target)) target = `${target}.js`;
      assert.ok(exists(target), `${file}: require("${m[1]}") -> missing ${target}`);
    }
  }
});

test('miniprogram: streaming code declares the required base-library features', () => {
  const api = read('utils/api.js');
  assert.match(api, /enableChunked:\s*true/, 'must request chunked transfer');
  assert.match(api, /onChunkReceived/, 'must consume streamed chunks');
  assert.match(api, /require\('\.\/utf8\.js'\)/, 'must decode UTF-8 manually (no TextDecoder in mini programs)');
  const config = read('config.js');
  assert.match(config, /API_BASE/);
  const project = readJson('project.config.json');
  assert.equal(project.setting.urlCheck, false, 'urlCheck must be false for LAN development');
  assert.equal(project.compileType, 'miniprogram');
});

/* ------------------------------------------------------ theme consistency --- */

test('miniprogram: generated themes match the player runtime exactly', () => {
  const { THEMES, themeIds } = load('utils/themes.generated.js');
  const themes = allThemes();

  assert.equal(THEMES.length, themes.length, 'theme count drifted from the web player');
  assert.deepEqual(themeIds, themes.map((t) => t.id));
  assert.ok(themes.length >= 3, 'at least 3 themes are required');

  try {
    assert.deepEqual(THEMES, themes);
  } catch (err) {
    assert.fail(`miniprogram/utils/themes.generated.js is stale — run: npm run sync:themes\n${err.message}`);
  }
});

test('miniprogram: generated wxss covers every theme and colour', () => {
  const wxss = read('styles/themes.wxss');
  const themes = allThemes();
  for (const theme of themes) {
    assert.ok(wxss.includes(`.t-${theme.id} {`), `themes.wxss missing .t-${theme.id}`);
    assert.ok(
      wxss.includes(theme.vars['ppt-slide-bg']),
      `themes.wxss missing slide background of ${theme.id} — run: npm run sync:themes`
    );
    assert.ok(wxss.includes(theme.vars['ppt-accent']), `themes.wxss missing accent of ${theme.id}`);
  }
  // The slide component must consume the generated theme classes.
  const componentWxss = read('components/slide/slide.wxss');
  assert.match(componentWxss, /@import\s+["']\.\.\/\.\.\/styles\/themes\.wxss["']/);
  assert.ok(componentWxss.includes('.s-slide'), 'slide component must style .s-slide');
  assert.ok(componentWxss.includes('1280rpx') && componentWxss.includes('720rpx'), 'design canvas must be 1280x720rpx');
});

test('miniprogram: pptx export goes through the same server endpoint as the web app', () => {
  const api = read('utils/api.js');
  assert.match(api, /\/api\/export\/pptx/);
  assert.match(api, /responseType:\s*'arraybuffer'/);
  assert.match(api, /fileType:\s*'pptx'/, 'must open with fileType pptx');
  assert.match(api, /USER_DATA_PATH/, 'must write into the writable user dir');
});

test('miniprogram: the project directory is inside the repo (not accidentally ignored)', () => {
  assert.ok(fs.existsSync(path.join(ROOT, 'miniprogram', 'app.json')));
  const gitignore = fs.readFileSync(path.join(ROOT, '.gitignore'), 'utf8');
  assert.ok(!/miniprogram/.test(gitignore), '.gitignore must not exclude the mini program sources');
});
