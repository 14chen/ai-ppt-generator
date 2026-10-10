/**
 * Rewrite miniprogram/config.js with this machine's LAN address, so the mini
 * program can reach the local backend without hand-editing.
 *
 * Usage: node scripts/miniprogram-config.mjs [apiBase]
 */
import fs from 'node:fs';
import path from 'node:path';
import { lanAddress, publicOrigin } from '../server/routes/export.js';
import { config } from '../server/config.js';

const ROOT = path.resolve(import.meta.dirname, '..');
const FILE = path.join(ROOT, 'miniprogram', 'config.js');

const apiBase =
  process.argv[2] || config.miniprogramApiBase || publicOrigin({ headers: {} }) || `http://${lanAddress()}:${config.port}`;

const body = `/**
 * 后端地址配置（由 npm run miniprogram:config 自动生成）。
 *
 * 手机与电脑处于同一 Wi-Fi 时，用电脑的局域网地址即可（本项目默认端口 ${config.port}）。
 * 重新生成： npm run miniprogram:config
 *
 * 正式发布注意：
 *   1. 微信要求 request 合法域名必须是 **HTTPS**；
 *   2. 开发阶段可用局域网 IP，需要在微信开发者工具里勾选
 *      「开发环境不校验请求域名、TLS 版本及 HTTPS 证书」
 *      （本项目 project.config.json 已设置 "urlCheck": false）；
 *   3. 上线需要在微信公众平台 → 开发管理 → 服务器域名 里配置你的 HTTPS 域名。
 */
module.exports = {
  API_BASE: '${apiBase}'
};
`;

fs.writeFileSync(FILE, body, 'utf8');
console.log(`miniprogram/config.js  ->  API_BASE = ${apiBase}`);
