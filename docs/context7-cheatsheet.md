# Context7 Cheat-Sheet — Express 5 · Vite 7 · React 19 · Playwright

Fetched via `https://context7.com/api/v1/<id-without-leading-slash>?type=txt&topic=…` (Node global fetch, reliable here). `/facebook/react` **redirects to `/react/react`**. Version-specific sites also indexed: `/websites/expressjs`, `/websites/v7_vite_dev`, `/reactjs/react.dev`, `/websites/playwright_dev`.

## Versions Context7 reports (`versions[]` in `/api/v1/search`; also `/api/v2/libs/search`)

| Library | id | `versions` (latest listed) | updated | snippets / trust |
|---|---|---|---|---|
| Express | `/expressjs/express` | `v5.1.0`, **`v5.2.0`** (also `4_21_2`) | 2026-09-29 | 208 / 9 |
| Vite | `/vitejs/vite` | `v7.0.0`…**`v7.3.5`**, `v8.0.0`, `v8.0.7`, **`v8.0.10`** | 2026-10-10 | 1914 / 8.3 |
| React | `/react/react` | `v19.2.7`, **`v19.2.8`** (also `v18.2.0`) | 2026-10-09 | 5317 / 8.3 |
| Playwright | `/microsoft/playwright` | `v1.58.2`, `v1.59.0`, `v1.61.0/1`, **`v1.63.0`** | 2026-10-09 | 8969 / 9.9 |

⚠️ **Vite 8 exists** in Context7's list (`v7.vite.dev/blog/announcing-vite8-beta` is indexed); v7 latest = **7.3.5**, so "current major" is no longer 7.

## 1. Express (v5)

**ESM + json + static** — https://github.com/expressjs/express/blob/master/_autodocs/api-reference/express.md
```js
import express from 'express';
const app = express();
app.use(express.json());            // = body-parser.json
app.use(express.static('public'));  // = serve-static
app.post('/echo', (req, res) => res.json(req.body));
```
(`express.json/urlencoded/static/raw/text` are re-exports of body-parser/serve-static. ESM `import express from 'express'` is the documented form across expressjs.com + autodocs.)

**Async errors: YES, v5 auto-forwards rejected promises** — https://expressjs.com/en/blog/2024-10-15-v5-release
> "the router catches rejected promises from async middleware and treats as calling `next(err)`"
```js
app.use(async (req, res, next) => { req.user = await getUser(req); next(); });
app.use((err, req, res, next) => { console.error(err.stack); res.status(500).send('ISE'); }); // after routes
```

**v5 breaking changes that matter** — https://expressjs.com/en/guide/migrating-5
- Wildcards must be **named**: `app.get('/*')` → `app.get('/*splat')`; wildcard param is an **array** (`req.params.splat === ['foo','bar']`).
- `{*splat}` **also matches root**; unmatched params are **omitted** from `req.params` (no `''`/`undefined`).
- **`req.query` is a getter, not writable** (`req.query.page = 1` throws); default parser changed **`extended` → `simple`**.
- **`req.body` is `undefined`** when unparsed (v4: `{}`).
- `express.static` **`dotfiles` defaults to `'ignore'`** (`{ dotfiles: 'allow' }` for `/.well-known`); `hidden` removed. `res.vary()` without a field now throws.

**SPA fallback** — GET-only named splat, registered last:
```js
app.get('/*splat', (req, res) => res.sendFile(indexHtmlPath)); // NOT '/*' in v5
```
(Forms `{*splat}` / `*all` per https://expressjs.com/en/api/router ; the Express+Vite snippets use `app.use('*all', …)`.)

**Streaming / SSE** — https://expressjs.com/en/api/express , .../_autodocs/api-reference/response.md
`res` is Node's `ServerResponse`, so `setHeader`/`flushHeaders`/`write`/`end` are available; `res.set()` adds charset to Content-Type and returns `res`.
```js
res.setHeader('Content-Type', 'text/event-stream');   // + Cache-Control: no-cache, Connection: keep-alive
res.flushHeaders();                              // push headers before first chunk
res.write(`data: ${JSON.stringify(evt)}\n\n`);
res.end();
```
⚠️ **Could NOT confirm from Context7**: no Express page documents `res.flushHeaders`/`res.write`/`res.end`, and there is **no SSE page** in `/expressjs/express` or `/websites/expressjs` — they are inherited Node methods. Also no `"type":"module"` ESM setup section (only `import` usage).

## 2. Vite (v7)

**Express + middleware mode, `appType: 'custom'`** — https://github.com/vitejs/vite/blob/main/docs/config/server-options.md , .../docs/guide/ssr.md
```js
import express from 'express'
import { createServer as createViteServer } from 'vite'
const app = express()
const vite = await createViteServer({ server: { middlewareMode: true }, appType: 'custom' })
app.use(vite.middlewares)         // same reference survives restarts
app.use('*all', async (req, res) => { /* serve index.html yourself */ })
app.listen(5173)
```
- `'custom'` = "don't include Vite's default HTML handling middlewares" → **you** must read `index.html` and call `vite.transformIndexHtml(url, template)`.
- `'spa'`/`'mpa'`: Vite handles HTML requests **and 404s**, so your own API/static middleware must be registered **before** `vite.middlewares`.
- With your own router: use `router.use(vite.middlewares)`.

**custom-mode index.html (dev)** — .../docs/guide/ssr.md
```js
let template = fs.readFileSync(path.resolve(import.meta.dirname, 'index.html'), 'utf-8')
template = await vite.transformIndexHtml(url, template)  // HMR client + React preamble
res.status(200).set({ 'Content-Type': 'text/html' }).end(template)
```
Wrap in try/catch → `vite.ssrFixStacktrace(e)` → `next(e)` to reach the Express error handler.

**Programmatic createServer** — .../docs/guide/api-javascript.md :
`const server = await createServer({ configFile: false, root: import.meta.dirname, server: { port: 1337 } })` → `await server.listen(); server.printUrls(); server.bindCLIShortcuts({ print: true })`.

**server.proxy** — .../docs/config/server-options.md
```js
server: { proxy: { '/api': { target: 'http://localhost:3000', changeOrigin: true } } }
```
Matched proxy requests are **not** transformed by Vite. WS: `{ target: 'ws://localhost:5174', ws: true }`; middleware mode WS proxying needs `middlewareMode: { server: parentServer }`.
**Build / SPA fallback / ports** — https://github.com/vitejs/vite/blob/main/docs/guide/static-deploy.md , .../docs/config/build-options.md
- `vite build` → **`dist` by default**; override with `build.outDir` (other build paths are relative to it).
- Prod: `express.static(distDir)` + GET `/*splat` → index.html. `vite preview` serves `dist` at **:4173**; dev server **:5173**.
- **Node requirement** (https://v7.vite.dev/guide): scaffolding requires **Node.js 20.19+ or 22.12+**.
⚠️ **Could NOT confirm**: any official "Express serves `build.outDir` + SPA fallback" recipe (docs cover `vite preview` / static deploy / `build.manifest` backend integration), and an explicit "Vite 7 dropped Node 18" statement.

## 3. React (v19)

**createRoot + StrictMode** — https://github.com/reactjs/react.dev/blob/main/src/content/reference/react/StrictMode.md
```jsx
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
const root = createRoot(document.getElementById('root'));
root.render(<StrictMode><App /></StrictMode>);
```
**StrictMode is development-only** and "activates extra setup and cleanup cycles for effects and ref callbacks"; it "**re-runs Effects in development**" → an unguarded `useEffect(fetch, [])` **fires twice in dev**.

**Don't guard the double-fire with a ref; make the effect cancelable** — https://github.com/reactjs/react.dev/blob/main/src/content/learn/synchronizing-with-effects.md
```jsx
if (!connectionRef.current) { /* 🚩 won't fix the bug → leaks resources */ }
useEffect(() => {
  const ac = new AbortController();
  fetch('/api/stream', { signal: ac.signal }).then(/* … */);
  return () => ac.abort();   // cleanup cancels the first dev run
}, []);
```
**Refs**: `useRef` is stable across renders → **omit `ref` from the dependency array**. React Compiler lint also flags synchronous `setState` inside an effect (`EffectSetState`).

## 4. Playwright

**Use an installed browser** — https://github.com/microsoft/playwright/blob/main/docs/src/browsers.md
```js
import { defineConfig, devices } from '@playwright/test';
export default defineConfig({
  projects: [{ name: 'Edge', use: { ...devices['Desktop Edge'], channel: 'msedge' } }],
});
```
Channels: `"chrome"`, `"msedge"`, `"chrome-beta"`, `"msedge-beta"`, `"msedge-dev"`; `channel: 'chromium'` = new authentic-Chromium headless (…/docs/src/test-api/class-testoptions.md). Install-time opt-out for helper packages: `PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1 npm install`; `--no-shell` skips the headless shell. `browserType.executablePath()` = where Playwright *expects* a bundled binary.
⚠️ **Could NOT confirm**: that `channel: 'msedge'` **never** downloads a browser, or any test-run skip-download switch. Docs describe `channel` as branded-browser selection; no `skipInstall`-style option appears.

**baseURL + webServer** — https://github.com/microsoft/playwright/blob/main/docs/src/test-webserver-js.md
```js
export default defineConfig({
  webServer: { command: 'npm run start', url: 'http://localhost:3000', reuseExistingServer: !process.env.CI },
  use: { baseURL: 'http://localhost:3000' },   // page.goto('./login') → http://localhost:3000/login
});
```
**Assert / capture a download** — https://github.com/microsoft/playwright/blob/main/docs/src/api/class-download.md
```js
const downloadPromise = page.waitForEvent('download');  // start before the click, no await
await page.getByText('Download file').click();
const download = await downloadPromise;
expect(download.suggestedFilename()).toBe('report.csv');
await download.saveAs('/tmp/' + download.suggestedFilename());
```
Also: `download.path()` (waits for completion; **throws when connected remotely**), `download.createReadStream()` (throws for failed/canceled), `page.on('download', …)`.
⚠️ **Could NOT confirm**: a dedicated `expect(download)` matcher in Context7 — docs show `suggestedFilename()` + `saveAs()` with generic `expect`.
