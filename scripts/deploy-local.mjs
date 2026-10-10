/**
 * Deploy this project to a local folder and make it reachable from other
 * machines on the network.
 *
 *   node scripts/deploy-local.mjs                 # -> F:\devbox\ai-ppt-generator
 *   DEPLOY_DIR=D:\apps\ppt node scripts/deploy-local.mjs
 *   node scripts/deploy-local.mjs --no-firewall --no-task
 *
 * What it does:
 *   1. copies the sources (never node_modules/dist/test-results)
 *   2. npm install + vite build in the target folder
 *   3. writes a .env with HOST=0.0.0.0, a generated ACCESS_CODE and rate limits
 *   4. opens the Windows Firewall for the port (needs Administrator)
 *   5. registers a startup Scheduled Task so it survives reboots
 *   6. starts it and verifies /api/session + /api/health
 *
 * It never deletes anything outside the target folder.
 */
import { execFileSync, spawnSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const SRC = path.resolve(import.meta.dirname, '..');
const DEST = path.resolve(process.env.DEPLOY_DIR || 'F:\\devbox\\ai-ppt-generator');
const PORT = Number(process.env.DEPLOY_PORT || 8787);
const TASK_NAME = process.env.DEPLOY_TASK || 'AI-PPT-Generator';
const args = new Set(process.argv.slice(2));

const log = (...a) => console.log(...a);
const step = (n, t) => console.log(`\n[${n}] ${t}`);

function run(cmd, cmdArgs, opts = {}) {
  // On Windows npm/npx are .cmd shims, which spawnSync cannot execute without a shell.
  const needsShell = process.platform === 'win32' && /^(npm|npx)$/i.test(cmd);
  const res = spawnSync(needsShell ? `${cmd}.cmd` : cmd, cmdArgs, {
    stdio: 'inherit',
    windowsHide: true,
    shell: needsShell,
    env: { ...process.env, NVM_SYMLINK: process.env.NVM_SYMLINK || 'C:\\Users\\HP\\AppData\\Local\\nodejs', ...opts.env },
    cwd: opts.cwd
  });
  if (res.error) throw res.error;
  return res.status ?? 0;
}

function runCapture(cmd, cmdArgs) {
  const res = spawnSync(cmd, cmdArgs, { encoding: 'utf8', windowsHide: true });
  return { code: res.status ?? 0, out: `${res.stdout || ''}${res.stderr || ''}` };
}

function isAdmin() {
  const res = runCapture('net', ['session']);
  return res.code === 0;
}

/** Kill whatever node process is holding the port (stale instance). */
function freePort(port) {
  if (process.platform !== 'win32') return;
  runCapture('powershell', [
    '-NoProfile',
    '-Command',
    `$c = Get-NetTCPConnection -LocalPort ${port} -State Listen -ErrorAction SilentlyContinue; ` +
      `foreach ($x in $c) { $p = Get-Process -Id $x.OwningProcess -ErrorAction SilentlyContinue; ` +
      `if ($p -and $p.ProcessName -eq 'node') { Stop-Process -Id $p.Id -Force } }`
  ]);
}

/* ------------------------------------------------------------------ checks */

log('AI 网页 PPT 生成器 · 本地部署');
log(`  源目录: ${SRC}`);
log(`  目标  : ${DEST}`);
log(`  端口  : ${PORT}`);

if (path.parse(DEST).root.toLowerCase() === path.parse(SRC).root.toLowerCase() && DEST === SRC) {
  throw new Error('目标目录不能等于源目录');
}
if (DEST.length < 8) throw new Error(`目标目录看起来不安全: ${DEST}`);

const admin = isAdmin();
log(`  管理员: ${admin ? '是' : '否（防火墙/开机自启会跳过）'}`);

/* ------------------------------------------------------------- 1. copy ---- */

step(1, '复制源码（排除 node_modules / dist / test-results / .git）');
fs.mkdirSync(DEST, { recursive: true });
const EXCLUDE_DIRS = ['node_modules', 'dist', 'test-results', '.git', '.vite'];
const EXCLUDE_FILES = ['*.log'];
const rc = run('robocopy', [
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
]);
// robocopy: 0-7 == success
if (rc > 7) throw new Error(`robocopy 失败，退出码 ${rc}`);
log(`  已复制到 ${DEST}`);

/* ------------------------------------------------------- 2. install/build - */

step(2, '安装依赖并构建前端');
if (!args.has('--skip-install')) {
  const code = run('npm', ['install', '--no-audit', '--no-fund'], { cwd: DEST });
  if (code !== 0) throw new Error(`npm install 失败（${code}）`);
} else {
  log('  跳过（--skip-install）');
}
{
  const code = run('npx', ['vite', 'build'], { cwd: DEST });
  if (code !== 0) throw new Error(`vite build 失败（${code}）`);
}

/* ------------------------------------------------------------- 3. .env ---- */

step(3, '写入运行配置 .env');
const envPath = path.join(DEST, '.env');
const existing = fs.existsSync(envPath) ? fs.readFileSync(envPath, 'utf8') : '';
const readKey = (name) => {
  const m = existing.match(new RegExp(`^${name}=(.*)$`, 'm'));
  return m ? m[1].trim() : '';
};
const apiKey = readKey('DEEPSEEK_API_KEY') || process.env.DEEPSEEK_API_KEY || '';
if (!apiKey) log('  ⚠ 没有找到 DEEPSEEK_API_KEY，请手工填入 ' + envPath);

let accessCode = readKey('ACCESS_CODE');
if (!accessCode) {
  // readable but not guessable
  accessCode = `ppt-${crypto.randomBytes(4).toString('hex')}`;
}
const extraEnv = readKey('PUBLIC_URL') && readKey('PUBLIC_URL') !== '' ? readKey('PUBLIC_URL') : '';

const envBody = `# 由 scripts/deploy-local.mjs 生成 —— ${new Date().toISOString()}
# 改完请重启服务：schtasks /Run /TN "${TASK_NAME}"

# ---- DeepSeek ----
DEEPSEEK_API_KEY=${apiKey}
DEEPSEEK_BASE_URL=${readKey('DEEPSEEK_BASE_URL') || 'https://api.deepseek.com/v1'}
DEEPSEEK_MODEL=${readKey('DEEPSEEK_MODEL') || 'deepseek-v4-pro'}
DEEPSEEK_EFFORT=${readKey('DEEPSEEK_EFFORT') || 'low'}
DEEPSEEK_TEMPERATURE=${readKey('DEEPSEEK_TEMPERATURE') || '0.6'}
DEEPSEEK_MAX_TOKENS=${readKey('DEEPSEEK_MAX_TOKENS') || '8000'}

# ---- 服务：0.0.0.0 让局域网/公网可以访问 ----
PORT=${PORT}
HOST=0.0.0.0

# ---- 公网保护：访问码 + 限流 ----
# 别人打开页面需要输入这个访问码（可以随时改）
ACCESS_CODE=${accessCode}
RATE_LIMIT_MAX=${readKey('RATE_LIMIT_MAX') || '10'}
RATE_LIMIT_WINDOW_MS=${readKey('RATE_LIMIT_WINDOW_MS') || '600000'}
RATE_LIMIT_EXEMPT_LOCAL=1

# ---- 输入与限额 ----
MIN_CHARS=${readKey('MIN_CHARS') || '20'}
MAX_CHARS=${readKey('MAX_CHARS') || '20000'}
MAX_SLIDES=${readKey('MAX_SLIDES') || '24'}
REQUEST_TIMEOUT_MS=${readKey('REQUEST_TIMEOUT_MS') || '300000'}
IDLE_TIMEOUT_MS=${readKey('IDLE_TIMEOUT_MS') || '90000'}

# ---- 对外地址（反向代理 / 隧道地址；脚本会自动更新）----
PUBLIC_URL=${extraEnv}
MINIPROGRAM_API_BASE=${readKey('MINIPROGRAM_API_BASE') || ''}

# ---- 微信小程序（可选）----
WX_APPID=${readKey('WX_APPID') || ''}
WX_SECRET=${readKey('WX_SECRET') || ''}
WX_ENV_VERSION=${readKey('WX_ENV_VERSION') || 'release'}
WX_PAGE=${readKey('WX_PAGE') || 'pages/index/index'}

# ---- PPTX ----
PPTX_FONT=${readKey('PPTX_FONT') || 'Microsoft YaHei'}
`;
fs.writeFileSync(envPath, envBody, 'utf8');
log(`  已写入 ${envPath}`);
log(`  ★ 访问码（分享给使用者）: ${accessCode}`);

/* --------------------------------------------------------- 4. firewall ---- */

step(4, `放行防火墙 TCP ${PORT}`);
if (args.has('--no-firewall') || !admin) {
  log('  跳过');
} else {
  runCapture('netsh', ['advfirewall', 'firewall', 'delete', 'rule', `name=AI-PPT-Generator ${PORT}`]);
  const res = runCapture('netsh', [
    'advfirewall', 'firewall', 'add', 'rule',
    `name=AI-PPT-Generator ${PORT}`,
    'dir=in', 'action=allow', 'protocol=TCP', `localport=${PORT}`, 'profile=any'
  ]);
  log(res.out.trim().split('\n').filter(Boolean).slice(-1)[0] || '  ok');
}

/* ------------------------------------------------------------- 5. task ---- */

step(5, '注册开机自启计划任务');
const launcher = path.join(DEST, 'start-server.cmd');
// NOTE: the task runs as SYSTEM, whose PATH does not contain a user-local Node
// install, so the launcher must use an absolute path to node.exe.
const nodeExe = process.execPath;
fs.writeFileSync(
  launcher,
  [
    '@echo off',
    'chcp 65001 >nul',
    'cd /d "%~dp0"',
    'if not exist logs mkdir logs',
    `echo ==== start %DATE% %TIME% ==== >> logs\\server.log`,
    `"${nodeExe}" server\\index.js >> logs\\server.log 2>&1`,
    'echo ==== stopped %DATE% %TIME% ==== >> logs\\server.log',
    ''
  ].join('\r\n'),
  'utf8'
);
log(`  启动脚本: ${launcher}`);
log(`  使用 node: ${nodeExe}`);
if (args.has('--no-task') || !admin) {
  log('  跳过（可用 ' + launcher + ' 手工启动）');
} else {
  const tr = `"${launcher}"`;
  const res = runCapture('schtasks', [
    '/Create', '/TN', TASK_NAME, '/TR', tr, '/SC', 'ONSTART', '/RU', 'SYSTEM', '/RL', 'HIGHEST', '/F'
  ]);
  if (res.code === 0) {
    log(`  已注册：开机自动启动（任务名 ${TASK_NAME}）`);
    // Stop any previous instance first: an orphaned node.exe would keep the
    // port and the new process would die with EADDRINUSE while the old code
    // kept serving (a very confusing failure mode).
    runCapture('schtasks', ['/End', '/TN', TASK_NAME]);
    freePort(PORT);
    runCapture('schtasks', ['/Run', '/TN', TASK_NAME]);
    log('  已启动');
  } else {
    log(`  注册失败：${res.out.trim().split('\n').slice(-1)[0]}`);
  }
}

/* ------------------------------------------------------------ 6. verify ---- */

step(6, '等待服务并自检');
async function waitForServer(timeoutMs = 30000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    try {
      const res = await fetch(`http://127.0.0.1:${PORT}/api/health`, { signal: AbortSignal.timeout(3000) });
      if (res.ok) return await res.json();
    } catch {
      /* not up yet */
    }
    await new Promise((r) => setTimeout(r, 800));
  }
  return null;
}

let health = await waitForServer();
if (!health && args.has('--no-task')) {
  log('  服务未运行，直接启动一个前台进程用于验证…');
  const child = spawnSync('node', ['server/index.js'], { cwd: DEST, stdio: 'ignore', windowsHide: true, detached: true });
  if (child.error) log(`  启动失败: ${child.error.message}`);
  health = await waitForServer();
}

if (!health) {
  log('  ✗ 服务没有起来，请检查 logs/server.log');
  process.exit(1);
}
log(`  ✓ /api/health: model=${health.model} key=${health.hasApiKey} accessRequired=${health.accessRequired}`);

const session = await (await fetch(`http://127.0.0.1:${PORT}/api/session`)).json();
log(`  ✓ /api/session: required=${session.required} ok=${session.ok}`);

const lan = Object.values(os.networkInterfaces())
  .flat()
  .filter((n) => n && n.family === 'IPv4' && !n.internal)
  .map((n) => n.address);
log(`\n完成。`);
log(`  本机   : http://127.0.0.1:${PORT}`);
lan.forEach((ip) => log(`  局域网 : http://${ip}:${PORT}`));
log(`  访问码 : ${accessCode}`);
log(`  日志   : ${path.join(DEST, 'logs', 'server.log')}`);
log(`  重启   : schtasks /Run /TN "${TASK_NAME}"`);
