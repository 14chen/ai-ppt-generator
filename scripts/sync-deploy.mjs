/**
 * Update an existing deployment from the working copy: copy sources (NEVER .env),
 * rebuild, restart, verify.
 *
 *   node scripts/sync-deploy.mjs
 *
 * Safe to run repeatedly. The deployment keeps its own .env (API key, access
 * code, public URL) — copying the working copy's .env over it would silently
 * disable the access gate, which is exactly the mistake this script prevents.
 */
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import fs from 'node:fs';

const SRC = path.resolve(import.meta.dirname, '..');
const DEST = path.resolve(process.env.DEPLOY_DIR || 'F:\\devbox\\ai-ppt-generator');
const TASK = process.env.DEPLOY_TASK || 'AI-PPT-Generator';
const PORT = Number(process.env.DEPLOY_PORT || 8787);

const log = (...a) => console.log(...a);

if (!fs.existsSync(path.join(DEST, '.git')) && !fs.existsSync(path.join(DEST, 'package.json'))) {
  console.error(`目标目录不像是部署 ($ {DEST})，请先运行 node scripts/deploy-local.mjs`);
  process.exit(1);
}

log(`同步 ${SRC}`);
log(`  -> ${DEST}`);

const EXCLUDE_DIRS = ['node_modules', 'dist', 'test-results', '.git', '.vite', 'logs', 'bin'];
const EXCLUDE_FILES = ['*.log', '.env', '.env.local', 'start-server.cmd'];

const rc = spawnSync(
  'robocopy',
  [
    SRC,
    DEST,
    '/E',
    '/NFL',
    '/NDL',
    '/NJH',
    '/NJS',
    '/R:1',
    '/W:1',
    ...EXCLUDE_DIRS.flatMap((d) => ['/XD', path.join(SRC, d), path.join(DEST, d)]),
    ...EXCLUDE_FILES.flatMap((f) => ['/XF', f])
  ],
  { stdio: 'inherit', windowsHide: true }
);
if ((rc.status ?? 0) > 7) {
  console.error('robocopy 失败');
  process.exit(1);
}

// Preserve the deployment's own mini program config (it holds the access code).
const srcCfg = path.join(SRC, 'miniprogram', 'config.js');
const dstCfg = path.join(DEST, 'miniprogram', 'config.js');
if (fs.existsSync(srcCfg)) {
  log('注意: 源目录的 miniprogram/config.js 被忽略了（部署目录保留自己的副本）');
}

log('\n构建前端…');
const build = spawnSync('npx.cmd', ['vite', 'build'], {
  cwd: DEST,
  stdio: 'inherit',
  shell: true,
  windowsHide: true,
  env: { ...process.env, NVM_SYMLINK: process.env.NVM_SYMLINK || 'C:\\Users\\HP\\AppData\\Local\\nodejs' }
});
if ((build.status ?? 1) !== 0) {
  console.error('构建失败');
  process.exit(1);
}

log('\n重启服务…');
spawnSync('schtasks', ['/End', '/TN', TASK], { windowsHide: true });
spawnSync(
  'powershell',
  [
    '-NoProfile',
    '-Command',
    `$c = Get-NetTCPConnection -LocalPort ${PORT} -State Listen -ErrorAction SilentlyContinue; ` +
      `foreach ($x in $c) { $p = Get-Process -Id $x.OwningProcess -ErrorAction SilentlyContinue; ` +
      `if ($p -and $p.ProcessName -eq 'node') { Stop-Process -Id $p.Id -Force } }`
  ],
  { windowsHide: true }
);
spawnSync('schtasks', ['/Run', '/TN', TASK], { windowsHide: true });

const deadline = Date.now() + 30000;
let health = null;
while (Date.now() < deadline) {
  try {
    const res = await fetch(`http://127.0.0.1:${PORT}/api/health`, { signal: AbortSignal.timeout(3000) });
    if (res.ok) {
      health = await res.json();
      break;
    }
  } catch {
    /* wait */
  }
  await new Promise((r) => setTimeout(r, 800));
}

if (!health) {
  console.error('✗ 服务没起来，看 ' + path.join(DEST, 'logs', 'server.log'));
  process.exit(1);
}
log(`✓ 服务正常: model=${health.model} accessRequired=${health.accessRequired}`);
if (!health.accessRequired) {
  log('⚠ 警告：当前部署没有开启访问码门禁，公网任何人都可以使用！');
  log('  修复：node scripts/deploy-local.mjs   （会生成新的 ACCESS_CODE）');
  process.exit(2);
}
