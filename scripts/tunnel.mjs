/**
 * Start a public tunnel and point the deployment at it — one command.
 *
 *   node scripts/tunnel.mjs                 # prefer cloudflared (per-client IPs)
 *   node scripts/tunnel.mjs --ssh           # fall back to the no-download SSH tunnel
 *
 * Quick-tunnel hostnames change on every restart, so this also runs
 * scripts/set-public-url.mjs (updates .env + miniprogram/config.js, restarts the
 * service) as soon as the public URL appears. Keep this process running.
 */
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const SRC = path.resolve(import.meta.dirname, '..');
const DEPLOY = path.resolve(process.env.DEPLOY_DIR || 'F:\\devbox\\ai-ppt-generator');
const PORT = Number(process.env.DEPLOY_PORT || 8787);
const useSsh = process.argv.includes('--ssh');

const CLOUDFLARED_CANDIDATES = [
  process.env.CLOUDFLARED || '',
  'F:\\devbox\\bin\\cloudflared.exe',
  path.join(DEPLOY, 'bin', 'cloudflared.exe'),
  'cloudflared'
].filter(Boolean);

function findCloudflared() {
  for (const c of CLOUDFLARED_CANDIDATES) {
    if (c === 'cloudflared') {
      const r = spawnSync('cloudflared', ['--version'], { encoding: 'utf8', windowsHide: true, shell: true });
      if (r.status === 0) return 'cloudflared';
      continue;
    }
    if (fs.existsSync(c)) return c;
  }
  return null;
}

function applyPublicUrl(url) {
  const script = path.join(SRC, 'scripts', 'set-public-url.mjs');
  console.log(`\n→ 写入公网地址并重启服务: ${url}`);
  const res = spawnSync(process.execPath, [script, url], {
    cwd: SRC,
    stdio: 'inherit',
    windowsHide: true,
    env: { ...process.env, DEPLOY_DIR: DEPLOY, DEPLOY_PORT: String(PORT) }
  });
  if (res.status !== 0) {
    console.error('设置公网地址失败，请手工执行： node scripts/set-public-url.mjs ' + url);
  }
}

/* --------------------------------------------------------------- start ---- */

const cloudflared = findCloudflared();
let child;
let mode;

if (!useSsh && cloudflared) {
  mode = `cloudflared (${cloudflared})`;
  console.log(`启动 cloudflared 隧道 -> http://localhost:${PORT}`);
  child = spawn(cloudflared, ['tunnel', '--url', `http://localhost:${PORT}`, '--no-autoupdate'], {
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe']
  });
} else {
  mode = 'SSH (localhost.run)';
  if (!cloudflared && !useSsh) {
    console.log('没找到 cloudflared，改用 SSH 隧道。');
    console.log('想要 cloudflared（可按访客分别限流）：node --use-system-ca scripts/get-cloudflared.mjs F:\\devbox\\bin');
  }
  const knownHosts = path.join(path.dirname(DEPLOY), 'bin', 'known_hosts');
  child = spawn(
    'ssh',
    [
      '-o', 'StrictHostKeyChecking=no',
      '-o', `UserKnownHostsFile=${knownHosts}`,
      '-o', 'ServerAliveInterval=30',
      '-R', `80:localhost:${PORT}`,
      'nokey@localhost.run'
    ],
    { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] }
  );
}

console.log(`隧道方式: ${mode}`);

let announced = false;
const seen = new Set();

function handleOutput(text) {
  process.stdout.write(text);
  for (const m of text.matchAll(/https:\/\/[a-z0-9-]+\.(?:trycloudflare\.com|lhr\.life)/gi)) {
    const url = m[0];
    if (seen.has(url)) continue;
    seen.add(url);
    if (announced) continue;
    announced = true;
    console.log(`\n${'='.repeat(64)}\n公网地址: ${url}\n${'='.repeat(64)}`);
    applyPublicUrl(url);
    console.log('\n隧道保持运行中，按 Ctrl+C 结束。');
  }
}

child.stdout.on('data', (d) => handleOutput(d.toString()));
child.stderr.on('data', (d) => handleOutput(d.toString()));

child.on('exit', (code) => {
  console.error(`\n隧道进程退出（code ${code}）。`);
  process.exit(code ?? 1);
});

const stop = () => {
  console.log('\n正在关闭隧道…');
  try {
    child.kill();
  } catch {
    /* ignore */
  }
  process.exit(0);
};
process.on('SIGINT', stop);
process.on('SIGTERM', stop);

setTimeout(() => {
  if (!announced) {
    console.error('\n⚠ 90 秒内没有拿到公网地址，请检查上面的输出（网络/防火墙可能拦截了隧道服务）。');
  }
}, 90000);
