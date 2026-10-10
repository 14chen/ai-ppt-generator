# Context7 API Cheat-Sheet — WeChat Mini Program + pptxgenjs

**Coverage (Context7-reported).** `/websites/developers_weixin_qq_miniprogram_dev` trust 10 / 31,527 snippets; `..._dev_api` trust 10 / 370; `/wechat-miniprogram/miniprogram-demo` trust 8.3 / 116 (noisy, TDesign vendored). `/gitbrent/pptxgenjs` trust 9 / 134; `/websites/gitbrent_github_io_pptxgenjs` trust 8.3 / 25.
Context7 returned `versions: []` (no version list) for **every** library queried, and states no version. Independent check: npm `pptxgenjs` latest = **4.0.1** (installed; `new pptxgen().version` → `4.0.1`). WeChat base-library versions are per-API, from the official doc pages.

---

## A. WeChat Mini Program (微信小程序)

### A1. Streaming HTTP — `enableChunked` is REAL
Documented `wx.request` property, base library **2.20.2**: `enableChunked boolean false 开启 transfer-encoding chunked`.
`RequestTask.onChunkReceived(listener)` — base library **2.20.1**; `res.data` is an **ArrayBuffer**. Also `offChunkReceived(listener)` (pass the same function object) and `onHeadersReceived` (`res.header`, `res.statusCode`, `res.cookies`). `RequestTask` itself: 1.4.0.
```js
const task = wx.request({
  url: 'https://example.com/sse', method: 'POST',
  enableChunked: true,             // 2.20.2
  responseType: 'arraybuffer',     // 1.7.0; legal values: text | arraybuffer
  header: { 'content-type': 'application/json' },
  success(res) { /* res.data, res.statusCode, res.header, res.cookies(2.10.0) */ }
})
task.onChunkReceived((res) => { const ab = res.data /* ArrayBuffer */ })
task.onHeadersReceived((res) => { res.statusCode; res.header })
```
- `redirect: 'manual'` (3.2.2) stops auto-following a 3xx; it fires `onHeadersReceived` and ends the request — read the target from `header.Location`.
- Documented caveat: under `useHighPerformanceMode` (3.3.3+; default true on Android from v3.5.0) HTTP3 is forced on **except when `enableChunked` is set**.
- Limits: max **10** concurrent requests; default timeout 60 s (`app.json` `networkTimeout` or per-call `timeout`).
- **NOT documented (gaps 4):** whether `enableChunked` conflicts with `responseType:'arraybuffer'`, any required header, and whether `success` still delivers the full body after streaming.

### A2. UTF-8 decoding — `TextDecoder` could NOT be confirmed
`TextDecoder` is **not documented** as a mini program global. The JS-support page says only that the base library ships a **core-js polyfill** to fill missing standard APIs — and core-js does **not** provide `TextDecoder`. No doc evidence it exists → **feature-detect it / assume unavailable.**
```js
// Option 1 — decode through the file system (official encodings include utf8/utf-8)
const fs = wx.getFileSystemManager()
fs.writeFileSync(`${wx.env.USER_DATA_PATH}/c.bin`, arrayBuffer)  // data: string|ArrayBuffer
const text = fs.readFileSync(`${wx.env.USER_DATA_PATH}/c.bin`, 'utf8')

// Option 2 — manual (pattern used in the official cloud-fn SSE sample)
let s = ''; const u8 = new Uint8Array(res.data)
for (let i = 0; i < u8.length; i++) s += String.fromCharCode(u8[i])
const decoded = decodeURIComponent(escape(s))
```
⚠️ **No official doc covers SSE chunk reassembly or multi-byte UTF-8 sequences split across chunk boundaries** — you must buffer the trailing partial bytes yourself (gap 2, not an oversight). `wx.arrayBufferToBase64` / `wx.base64ToArrayBuffer` exist.

### A3. Files
`wx.getFileSystemManager()` — base library **1.9.9**. `FileSystemManager.writeFile(Object)`:
`filePath` string req · `data` string|ArrayBuffer req · `encoding` string default `utf8` (legal: `ascii, base64, binary, hex, ucs2, ucs-2, utf16le, utf-16le, utf-8, utf8, latin1`) · `success/fail/complete`. No Promise style; sync form `writeFileSync(filePath, data, encoding)`.
```js
fs.writeFileSync(`${wx.env.USER_DATA_PATH}/deck.pptx`, arrayBuffer)  // ArrayBuffer => binary write
```
- Paths: `wx.env.USER_DATA_PATH` = local **user** dir, the only read+write location; temp files are read-only and **not guaranteed across cold starts**; code-package/cache files are read-only. Error `1300202` = 100 MB file/storage cap.
- **`wx.openDocument` with `fileType:'pptx'` WORKS (CONFIRMED).** Legal `fileType`: **`doc, docx, xls, xlsx, ppt, pptx, pdf`** and nothing else. `fileType` 1.4.0; `showMenu` 2.11.0 and defaults `false` (WeChat ≥7.0.12 hides the top-right menu unless passed).
```js
wx.openDocument({ filePath, fileType: 'pptx', showMenu: true })
```
- **`wx.saveFileToDisk({filePath, success, fail})` is PC-ONLY (CONFIRMED)** — doc text: 仅在 PC 端支持. Base library **2.11.0**; 微信 Windows/Mac 版 supported; no Promise style.
- **`wx.shareFileMessage({filePath, fileName, success, fail, complete})` exists**; `filePath` must be local/temp, `fileName` optional (defaults to basename). Its minimum base library version was **not** in the retrieved docs (gap 6).

### A4. Binary response
`responseType: 'arraybuffer'` (1.7.0) puts the ArrayBuffer at **`res.data`** in `success`. Documented: *any* server response, whatever the `statusCode`, enters `success` — branch on `res.statusCode` yourself. Responses should be UTF-8 (one BOM stripped). `referer` cannot be set.
**Max response size: COULD NOT CONFIRM** — no figure in the docs (gap 3).

### A5. WXSS / rendering
- **`rpx`:** supported, `1rpx` = 1/750 of page width. Docs warn it rounds (precision loss), offer the `convertRpxToVw` option, and now **recommend `vw` over `rpx`**; both are discouraged on large screens — pair with media queries.
- **`calc()`: supported.** `env()` supported for `safe-area-inset-*`. In Skyline's WXSS table `calc() ✓`, `env() ✓`, but `currentColor ×` (not supported).
- **`var(--x)`: COULD NOT CONFIRM.** The official WXSS page (selectors, units, `@import`, inline styles) never mentions custom properties, and `var()` is absent from the Skyline WXSS support table I retrieved. Indirect evidence they work: TDesign MiniProgram ships variables like `--td-toast-bg-color`. Treat as *works in the WebView renderer, unverified under Skyline*.
- **`@media` supported** — e.g. `@media (max-width: 360px)`, `@media (min-width: 480px)`.
- **Dark mode, two independent layers:**
  - `@media (prefers-color-scheme: dark) {}` applies whenever the client supports DarkMode, **regardless of** the `darkmode` switch.
  - `app.json` `{"darkmode": true}` (DevTools 1.03.2004271+, base library **2.11.0**) — all base components follow the system theme; requires `themeLocation` pointing at a `theme.json` with `light`/`dark` variable blocks.
  - `wx.onThemeChange(l)` → `res.theme = 'dark'|'light'`, **fires only when `"darkmode": true`**; `wx.offThemeChange(l)`; also `App.onThemeChange`.
  - `wx.getSystemInfoSync()` is **deprecated since base library 2.20.1**; the replacement carrying `theme` is `wx.getAppBaseInfo()` (2.20.1+, `theme` populated only when `"darkmode": true`).
- `page { }`: WXSS supports "the vast majority of CSS selectors", but no doc confirms/denies the `page` type selector and guidance is to prefer **class selectors**. In custom components tag/id/attribute selectors are disallowed. `@import "common.wxss";` works; `app.wxss` is global.

### A6. Scan / account / 小程序码
```js
wx.scanCode({ onlyFromCamera: false,                 // 1.2.0
  scanType: ['barCode','qrCode','wxCode'],           // 1.7.0; also datamatrix, pdf417
  success(res) { res.result; res.scanType; res.charSet; res.path; res.rawData /*base64*/ } })
const { miniProgram } = wx.getAccountInfoSync()      // 2.2.2
miniProgram.appId; miniProgram.envVersion /*develop|trial|release*/; miniProgram.version
```
`res.path` only when the scanned code is this mini program's own; `version` only in a **release** build.
**Generating a 小程序码 requires a server-side call — CONFIRMED.** Path `POST /wxa/getwxacodeunlimit`, i.e. **`https://api.weixin.qq.com/wxa/getwxacodeunlimit?access_token=ACCESS_TOKEN`** (Context7 shows the path plus sibling calls of the form `https://api.weixin.qq.com/wxa/getwxacode?from_appid=...`, pinning host + token query param). Body: `page` (optional, no leading `/`, no params), `scene` (**required**, ≤32 visible chars from `!#$&'()*+,/:;=?@-._~`), `check_path`, `env_version` (`release|trial|develop`), `width`. Returns an **image Buffer** on success, JSON on failure. Cloud equivalent: `cloud.openapi.wxacode.getUnlimited({...})`.
⚠️ `api.weixin.qq.com` **cannot be a configured request domain and cannot be called from inside the mini program** — keep AppSecret and `access_token` acquisition server-side.

### A7. Clipboard / navigation
```js
wx.setClipboardData({ data: 'text' })        // 1.1.0; shows "内容已复制" 1.5s; Promise style
wx.navigateTo({ url: 'pages/x/x?id=1' })     // page stack max 10; not for tabBar pages; events 2.7.3
wx.setNavigationBarColor({ frontColor: '#ffffff', backgroundColor: '#ff0000',
  animation: { duration: 400, timingFunc: 'easeIn' } })   // 1.4.0; frontColor ONLY #ffffff|#000000
```
Per-page `page.json` equivalent:
```json
{ "navigationBarBackgroundColor": "#ffffff", "navigationBarTextStyle": "black",
  "navigationBarTitleText": "微信接口功能演示", "backgroundColor": "#eeeeee",
  "backgroundTextStyle": "light" }
```
A page may override app.json only for options listed in the page-config doc; below iOS/Android 7.0.0 `navigationStyle` works only from `app.json`.

### A8. 合法域名 (request legal domains) — CONFIRMED
- **HTTPS only** for `wx.request`/`wx.uploadFile`/`wx.downloadFile`; **wss** for `wx.connectSocket`.
- **IP addresses NOT allowed**, and `localhost` not allowed — **except LAN IPs**: since base library **2.4.0** network APIs may reach LAN IPs but **never the device's own IP** (from 2.18.0 `wx.createTCPSocket` permits same-LAN non-self IPs).
- Ports are exact: configuring `https://myserver.com:8080` means only that host:port works; with a bare-domain config even `:443` fails.
- Domain needs China **ICP 备案**; no parent-domain config (subdomains only); TLS ≥1.2; valid, trusted, complete-chain, CN-matching cert; iOS rejects self-signed.
- DevTools escape hatch, exact label: **「开发环境不校验请求域名、TLS 版本及 HTTPS 证书」**; on a phone it applies only in debug mode.
- `project.config.json` shape:
```json
{ "appid": "wxxxxxxxxxxx", "projectname": "my-miniprogram", "compileType": "miniprogram",
  "libVersion": "latest",
  "setting": { "urlCheck": true, "es6": true, "enhance": true, "postcss": true, "minified": true } }
```
`libVersion` = base-library version; `project.private.config.json` overrides `project.config.json` and is where DevTools writes local-dev settings.

---

## B. pptxgenjs

### B1. Import, version, Buffer output
Version **4.0.1**; `exports` = `{types, import: dist/pptxgen.es.js, require: dist/pptxgen.cjs.js}`. Context7 lists no version.
```js
import pptxgen from 'pptxgenjs'                  // ESM
const pptxgen = require('pptxgenjs')             // CJS — the class itself, NOT {default}. Both verified.
const pptx = new pptxgen()
const buf = await pptx.write({ outputType: 'nodebuffer' })  // Buffer (verified isBuffer === true)
await pptx.writeFile({ fileName: 'out.pptx' })              // Promise<string> filename; needs fs
```
`write(props?)` → `Promise<string|ArrayBuffer|Blob|Uint8Array>`. `outputType` legal: **`arraybuffer | base64 | binarystring | blob | nodebuffer | uint8array`** (default `'blob'`). Also `stream(props)`. `writeFile`'s `compression: true` can save ~30%.
⚠️ In **4.0.1 the enums are instance properties, not statics**: use `pptx.ShapeType.rect`, `pptx.AlignH.center`, `pptx.SchemeColor.accent1`. `pptxgen.ShapeType` and `pptx.OutputType` were `undefined` in my test — README examples using the static form are stale for v4.

### B2. Slide content
```js
const slide = pptx.addSlide()                 // addSlide(props?) | addSlide(masterName) [deprecated]
slide.addText('Hello 世界', {
  x: 0.5, y: 0.5, w: 4, h: 1,                 // Coord: inches (number) or percent string '75%' — verified
  fontSize: 24, bold: true, color: 'FF0000',  // color: HexColor | ThemeColor
  align: 'center',                            // AlignH: left|center|right|justify
  valign: 'middle',                           // AlignV: top|middle|bottom
  fontFace: 'Microsoft YaHei',
  bullet: true,                               // or { type:'bullet'|'number', indent, numberStartAt, ... }
  breakLine: true,
  lineSpacing: 28,                            // points ("Exactly")
  lineSpacingMultiple: 1.5,                   // 0.0–9.99, since v3.5.0
  italic, underline: { style, color }, highlight, transparency, fit: 'none'|'shrink'|'resize',
  inset: /*points*/, softBreakBefore, textDirection, indentLevel, charSpacing, lang
})
slide.addShape(pptx.ShapeType.roundRect, {
  x: 5, y: 0.5, w: 3, h: 1,
  fill: { color: '0088CC', transparency: 20 },   // or pptx.SchemeColor.accent1
  line: { color: '000000', width: 1 }
})
slide.addTable(rows, { x: 0.5, y: 2, w: 6, border: { type: 'solid', pt: 1, color: '999999' } })
slide.addNotes('speaker notes')   // returns the Slide (chainable) — verified
```
`Slide` also has `addImage`, `addChart`, `addMedia`, plus `background`/`bkgd`, `color`, `hidden`, `slideNumber`, `newAutoPagedSlides`. `ShapeType` covers all OOXML presets (`rect`, `roundRect`, `ellipse`, `line`, `pie`, `arc`, `blockArc`, `customGeometry`, callouts, actionButtons…). `TableProps`/`TableCellProps` extend `TextBaseProps`, so text options apply per cell. `addSlide({masterName})` with an unknown master does **not** throw — it fails silently.

### B3. Masters, layouts, units
```js
pptx.defineLayout({ name: 'A3', width: 16.5, height: 11.7 }); pptx.layout = 'A3'
pptx.defineSlideMaster({
  title: 'MASTER_SIMPLE', background: { color: 'FFFFFF' },   // or { path } / { data }
  margin, slideNumber: {...},
  objects: [ { rect: { x:0, y:0, w:'100%', h:0.4, fill:{ color:'EEEEEE' } } },
             { text: { text:'Header', options:{ x:0.2, y:0.05, w:5, h:0.3, fontSize:12 } } } ]
})
const s = pptx.addSlide({ masterName: 'MASTER_SIMPLE' })
```
Units: `x/y/w/h` in **inches** (number) or **percent strings** (`'50%'`); internal EMU, `1in = 914400`. `lineSpacing`/`inset`/margins are **points**.

Standard layouts, verified at runtime:

| `pptx.layout` | EMU w×h | inches |
|---|---|---|
| *(unset)* default `screen16x9` | 9144000 × 5143500 | **10" × 5.625"** |
| `LAYOUT_16x9` | 9144000 × 5143500 | 10" × 5.625" |
| `LAYOUT_16x10` | 9144000 × 5715000 | 10" × 6.25" |
| `LAYOUT_4x3` | 9144000 × 6858000 | 10" × 7.5" |
| `LAYOUT_WIDE` | 12192000 × 6858000 | **13.333" × 7.5"** ← true widescreen |

Custom 16:9: `pptx.defineLayout({ name:'C16x9', width:13.333, height:7.5 })`. Note `pptx.layout` reads `undefined` until a name is assigned.

### B4. Chinese fonts — explicit `fontFace` is REQUIRED
Verified on 4.0.1 output XML:
- With **no** `fontFace`, the run's `<a:rPr>` contains **no `<a:latin>` and no `<a:ea>`** → PowerPoint falls back to the theme font, a classic tofu cause for CJK.
- With `fontFace: 'Microsoft YaHei'`, pptxgenjs emits `<a:latin typeface="Microsoft YaHei"/>`, **`<a:ea typeface="Microsoft YaHei" charset="-122"/>`** and `<a:cs .../>`. That `<a:ea>` East-Asian run property is what routes CJK glyphs to the intended face.
```js
slide.addText('中文标题', { x:0.5, y:0.5, w:6, h:1, fontSize:24, fontFace: 'Microsoft YaHei' })
```
- **No font embedding in pptxgenjs** (not found in Context7; `/liyao1520/pptx-embed-fonts`, trust 7.1 / 36 snippets, is a third-party wrapper). If the viewer lacks the named font it substitutes.
- `lang` defaults to `'en-US'` — set `lang: 'zh-CN'` on CJK runs for correct language tagging. `pptx.theme` is settable but read `undefined` in my v4.0.1 test.

### B5. Validation & runtime
- **No built-in validator** — no validate/schema-check API exists. Practical verification is unzip + assert:
```js
const z = await require('jszip').loadAsync(fs.readFileSync('out.pptx'))
z.file('[Content_Types].xml'); z.file('ppt/presentation.xml'); z.file('ppt/slides/slide1.xml')
```
Verified real output: 41 ZIP entries (`[Content_Types].xml`, `ppt/presentation.xml`, `ppt/slides/slideN.xml` + `_rels`, `slideLayouts`, `slideMasters`, `notesSlides`, `notesMasters`), magic bytes `504b0304`. For strict OOXML conformance, open it in PowerPoint/LibreOffice or lint it — pptxgenjs won't.
- **No browser needed in Node.** `package.json` `browser` maps `fs`, `node:fs`, `path`, `os`, `https`, `node:https`, `express`, `image-size` → `false`, i.e. those builtins are shimmed out only for browser builds. Deps: `jszip`, `image-size`, `https`, `@types/node`. `write({outputType:'nodebuffer'})` returned a real `Buffer` in plain Node with no DOM.

---

### Gaps — could NOT confirm from Context7 (do not treat as fact)
1. `TextDecoder` in a mini program (no doc mention; core-js polyfill doesn't supply it).
2. Official SSE/chunk reassembly guidance and partial multi-byte UTF-8 across `onChunkReceived` boundaries.
3. `wx.request` maximum ArrayBuffer response size.
4. Whether `enableChunked` conflicts with `responseType:'arraybuffer'`, any required header, and whether `success` still delivers the full body after streaming.
5. `var(--css-variable)` support in WXSS (absent from official WXSS + Skyline support tables; only third-party UI libs imply it works).
6. `wx.shareFileMessage` minimum base library version.
7. Literal UI wording of the DevTools 不校验合法域名 checkbox (only the doc phrase 「开发环境不校验请求域名、TLS 版本及 HTTPS 证书」 was found).
8. pptxgenjs font embedding (not a library feature) and any `versions` list (Context7 returned `versions: []` for all ids).
