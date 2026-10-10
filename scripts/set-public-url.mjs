/**
 * Point the deployment (and the mini program) at a public URL, then restart the
 * service. Quick tunnels get a new hostname every restart, so this is the one
 * command to re-run afterwards.
 *
 *   node scripts/set-public-url.mjs https://xxxx.trycloudflare.com
 *   node scripts/set-public-url.mjs --clear
 *
 * It updates:
 *   <deploy>/.env                 PUBLIC_URL + MINIPROGRAM_API_BASE
 *   <deploy>/miniprogram/config.js API_BASE (so the mini program uses the tunnel)
 * and restarts the Scheduled Task.
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const DEPLOY = path.resolve(process.env.DEPLOY_DIR || 'F:\\devbox\\ai-ppt-generator');
const TASK = process.env.DEPLOY_TASK || 'AI-PPT-Generator';
const PORT = Number(process.env.DEPLOY_PORT || 8787);

const arg = process.argv[2];
if (!arg) {
  console.error('用法: node scripts/set-public-url.mjs https://xxxx.trycloudflare.com');
  console.error('      node scripts/set-public-url.mjs --clear');
  process.exit(2);
}

const envPath = path.join(DEPLOY, '.env');
if (!fs.existsSync(envPath)) {
  console.error(`找不到 ${envPath}，请先运行 node scripts/deploy-local.mjs`);
  process.exit(1);
}

const publicUrl = arg === '--clear' ? '' : arg.replace(/\/+$/, '');
if (publicUrl && !/^https?:\/\//.test(publicUrl)) {
  console.error(`看起来不是一个 URL: ${publicUrl}`);
  process.exit(1);
}

/* ------------------------------------------------------------- update .env */

let env = fs.readFileSync(envPath, 'utf8');
const setVar = (name, value) => {
  const line = `${name}=${value}`;
  const re = new RegExp(`^${name}=.*$`, 'm');
  if (re.test(env)) env = env.replace(re, line);
  else env += `\n${line}`;
};
setVar('PUBLIC_URL', publicUrl);
setVar('MINIPROGRAM_API_BASE', publicUrl);
fs.writeFileSync(envPath, env, 'utf8');
console.log(`✓ ${envPath}`);
console.log(`  PUBLIC_URL            = ${publicUrl || '(空)'}`);
console.log(`  MINIPROGRAM_API_BASE  = ${publicUrl || '(空)'}`);

/* -------------------------------------------------- update miniprogram cfg */

const cfgPath = path.join(DEPLOY, 'miniprogram', 'config.js');
if (fs.existsSync(cfgPath)) {
  let cfg = fs.readFileSync(cfgPath, 'utf8');
  const target = publicUrl || `http://127.0.0.1:${PORT}`;
  cfg = cfg.replace(/API_BASE:\s*'[^']*'/, `API_BASE: '${target}'`);
  // The mini program authenticates with the access code header, so the deployed
  // copy must carry it too (the source copy keeps it empty — never commit it).
  const code = (fs.readFileSync(envPath, 'utf8').match(/^ACCESS_CODE=(.*)$/m) || [])[1]?.trim() ?? '';
  cfg = cfg.replace(/ACCESS_CODE:\s*'[^']*'/, `ACCESS_CODE: '${code}'`);
  fs.writeFileSync(cfgPath, cfg, 'utf8');
  console.log(`✓ ${cfgPath}`);
  console.log(`  API_BASE    = ${target}`);
  console.log(`  ACCESS_CODE = ${code ? code.slice(0, 4) + '****' : '(空)'}`);
}

/* ---------------------------------------------------------------- restart */

function killPort() {
  const res = spawnSync(
    'powershell',
    [
      '-NoProfile',
      '-Command',
      `$c = Get-NetTCPConnection -LocalPort ${PORT} -State Listen -ErrorAction SilentlyContinue; ` +
        `foreach ($x in $c) { $p = Get-Process -Id $x.OwningProcess -ErrorAction SilentlyContinue; ` +
        `if ($p -and $p.ProcessName -eq 'node') { Stop-Process -Id $p.Id -Force } }`
    ],
    { encoding: 'utf8', windowsHide: true }
  );
  return res.status === 0;
}

spawnSync('schtasks', ['/End', '/TN', TASK], { windowsHide: true });
killPort();
spawnSync('schtasks', ['/Run', '/TN', TASK], { windowsHide: true });
console.log('↻ 已重启计划任务');

/* ---------------------------------------------------------------- verify */

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
    /* keep waiting */
  }
  await new Promise((r) => setTimeout(r, 800));
}
if (!health) {
  console.error('✗ 服务没有起来，看日志: ' + path.join(DEPLOY, 'logs', 'server.log'));
  process.exit(1);
}
console.log(`✓ 服务正常: model=${health.model} accessRequired=${health.accessRequired}`);
if (publicUrl) console.log(`\n公网地址: ${publicUrl}`);
