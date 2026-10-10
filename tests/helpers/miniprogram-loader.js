/**
 * Loads the mini program's CommonJS modules in Node.
 *
 * The mini program is plain CJS (no bundler), so a tiny loader is enough — and
 * it lets the whole streaming path (UTF-8 chunk decoding + SSE framing) be
 * unit-tested without a phone or the WeChat DevTools.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
export const MINIPROGRAM_DIR = path.join(ROOT, 'miniprogram');

export function createMiniProgramLoader(rootDir = MINIPROGRAM_DIR) {
  const cache = new Map();

  function load(file) {
    let abs = path.isAbsolute(file) ? file : path.resolve(rootDir, file);
    if (!fs.existsSync(abs)) {
      const withExt = `${abs}.js`;
      if (!fs.existsSync(withExt)) throw new Error(`module not found: ${file}`);
      abs = withExt;
    }
    if (cache.has(abs)) return cache.get(abs).exports;

    const source = fs.readFileSync(abs, 'utf8');
    const mod = { exports: {} };
    cache.set(abs, mod);

    const req = (spec) => {
      if (!spec.startsWith('.')) throw new Error(`mini program module required a non-relative path: ${spec}`);
      let target = path.resolve(path.dirname(abs), spec);
      if (fs.existsSync(target) && fs.statSync(target).isDirectory()) target = path.join(target, 'index.js');
      if (!fs.existsSync(target)) target = `${target}.js`;
      return load(target);
    };

    // eslint-disable-next-line no-new-func
    const fn = new Function('module', 'exports', 'require', '__dirname', '__filename', source);
    fn(mod, mod.exports, req, path.dirname(abs), abs);
    return mod.exports;
  }

  return load;
}

/** UTF-8 encode a string into an ArrayBuffer (for chunked-feeding tests). */
export function encodeUtf8(text) {
  return new TextEncoder().encode(text).buffer;
}

/**
 * Split text into ArrayBuffer chunks of `size` bytes. Because the split is done
 * on raw bytes, multi-byte characters WILL be cut in half — exactly what
 * happens on a real network.
 */
export function chunkBytes(text, size) {
  const bytes = new TextEncoder().encode(text);
  const out = [];
  for (let i = 0; i < bytes.length; i += size) {
    out.push(bytes.slice(i, i + size).buffer);
  }
  return out;
}

/** Decode an ArrayBuffer back to a string using Node's TextDecoder. */
export function decodeUtf8(buffer) {
  return new TextDecoder().decode(buffer);
}
