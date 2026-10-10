/**
 * Download the Cloudflare quick-tunnel binary (no account needed) into
 * <deploy>/bin/cloudflared.exe.
 *
 * Usage: node scripts/get-cloudflared.mjs [targetDir]
 */
import fs from 'node:fs';
import path from 'node:path';

const targetDir = process.argv[2] || 'F:\\devbox\\bin';
const target = path.join(targetDir, 'cloudflared.exe');
const URL = 'https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-windows-amd64.exe';

fs.mkdirSync(targetDir, { recursive: true });

if (fs.existsSync(target) && fs.statSync(target).size > 5_000_000) {
  console.log(`已存在: ${target} (${(fs.statSync(target).size / 1048576).toFixed(1)} MB)`);
  process.exit(0);
}

console.log(`下载 ${URL}`);
let res;
try {
  res = await fetch(URL, { redirect: 'follow' });
} catch (err) {
  const cause = err?.cause?.message || err.message;
  console.error(`下载失败: ${cause}`);
  if (/certificate|CERT|SSL|TLS/i.test(cause)) {
    console.error(
      '\n看起来本机的 TLS 证书链 Node 无法校验（常见于装了抓包/杀软代理）。\n' +
        '请用系统证书库重试：\n' +
        '  node --use-system-ca scripts/get-cloudflared.mjs\n' +
        '或直接用 PowerShell 下载：\n' +
        '  Invoke-WebRequest -Uri "' + URL + '" -OutFile "' + target + '"\n'
    );
  }
  process.exit(1);
}
if (!res.ok) {
  console.error(`下载失败: HTTP ${res.status}`);
  process.exit(1);
}
const buffer = Buffer.from(await res.arrayBuffer());
if (buffer.length < 1_000_000) {
  console.error(`下载内容异常小 (${buffer.length} bytes)，可能被拦截`);
  process.exit(1);
}
fs.writeFileSync(target, buffer);
console.log(`已保存 ${target} (${(buffer.length / 1048576).toFixed(1)} MB)`);
