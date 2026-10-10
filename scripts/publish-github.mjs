/**
 * Prepare the GitHub publish for the DEPLOYED copy, then tell the user the one
 * command to run.
 *
 *   node scripts/publish-github.mjs <github-username> [repo-name]
 *
 * Why not push for you: pushing needs your credentials. GitHub removed password
 * authentication for git in 2021, so it has to be a Personal Access Token (or an
 * SSH key) that YOU enter — this script never asks for or stores either.
 *
 * Safety: it refuses to commit if it finds a real secret in the staged files.
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const DEPLOY = path.resolve(process.env.DEPLOY_DIR || 'F:\\devbox\\ai-ppt-generator');
const username = process.argv[2];
const repo = process.argv[3] || 'ai-ppt-generator';
const EMAIL = process.env.GIT_EMAIL || '2241502609@qq.com';

if (!username) {
  console.error('用法: node scripts/publish-github.mjs <你的GitHub用户名> [仓库名]');
  process.exit(2);
}
if (!fs.existsSync(DEPLOY)) {
  console.error(`找不到部署目录 ${DEPLOY}，请先运行 node scripts/deploy-local.mjs`);
  process.exit(1);
}

const git = (args, opts = {}) =>
  spawnSync('git', args, { cwd: DEPLOY, encoding: 'utf8', windowsHide: true, ...opts });

const log = (...a) => console.log(...a);

/* --------------------------------------------------------- 1. init + ident -- */

log('初始化仓库…');
if (!fs.existsSync(path.join(DEPLOY, '.git'))) {
  log(git(['init', '-b', 'main']).stdout?.trim() || '  git init -b main');
} else {
  log('  已存在 .git');
}
git(['config', 'user.email', EMAIL]);
git(['config', 'user.name', username]);
git(['config', 'core.autocrlf', 'false']);
git(['config', 'credential.helper', 'manager']);
log(`  提交身份: ${username} <${EMAIL}>`);

/* ------------------------------------------------------ 0. secret hygiene -- */
// (after `git init`: `git check-ignore` needs a repository)

log('\n检查是否会误提交密钥…');
const mustIgnore = ['.env', 'logs/', 'node_modules/', 'bin/'];
for (const item of mustIgnore) {
  const res = git(['check-ignore', '-q', item]);
  if (res.status !== 0) {
    console.error(`  ✗ .gitignore 没有排除 ${item} —— 终止，避免泄露 API Key`);
    process.exit(1);
  }
  log(`  ✓ 已忽略 ${item}`);
}

/* ------------------------------------------------------------ 2. stage ----- */

log('\n暂存文件…');
git(['add', '-A']);
const staged = git(['diff', '--cached', '--name-only']).stdout.split('\n').filter(Boolean);
log(`  共 ${staged.length} 个文件`);

// Last line of defence: scan staged text files for the real key / access code.
const envPath = path.join(DEPLOY, '.env');
const secrets = [];
if (fs.existsSync(envPath)) {
  const env = fs.readFileSync(envPath, 'utf8');
  for (const m of env.matchAll(/^(DEEPSEEK_API_KEY|ACCESS_CODE|WX_SECRET)=(.*)$/gm)) {
    if (m[2].trim()) secrets.push({ name: m[1], value: m[2].trim() });
  }
}
let leaked = 0;
for (const file of staged) {
  const abs = path.join(DEPLOY, file);
  if (!fs.existsSync(abs) || fs.statSync(abs).size > 2_000_000) continue;
  let text = '';
  try {
    text = fs.readFileSync(abs, 'utf8');
  } catch {
    continue;
  }
  for (const s of secrets) {
    if (text.includes(s.value)) {
      console.error(`  ✗ ${file} 里出现了 ${s.name} 的真实值！`);
      git(['reset', 'HEAD', file]);
      leaked += 1;
    }
  }
  if (/\bsk-[0-9a-f]{20,}\b/.test(text) && !/sk-your-key|\*\*\*/.test(text)) {
    console.error(`  ✗ ${file} 里出现了疑似 API Key（sk-…）`);
    leaked += 1;
  }
}
if (leaked) {
  console.error('\n发现疑似密钥，已取消这些文件的暂存。请清理后再执行本脚本。');
  process.exit(1);
}
log('  ✓ 没有发现泄露的密钥');

/* ------------------------------------------------------------ 3. commit ---- */

const hasCommit = git(['rev-parse', '--verify', 'HEAD']).status === 0;
if (!hasCommit) {
  const message = [
    'feat: AI 网页 PPT 生成器（网页 + 微信小程序 + PPTX 导出）',
    '',
    '- 后端 Express 5 + SSE 流式转发 DeepSeek(deepseek-v4-pro)，容错 NDJSON 逐页解析',
    '- 前端 React 19 + Vite 8：实时进度、页面总览、全屏演示、键盘/滑动翻页',
    '- 5 套配色主题，导出独立 HTML / 真正的 .pptx / 结构 JSON',
    '- 原生微信小程序端：enableChunked 流式收流 + 手写 UTF-8 增量解码',
    '- 公网部署保护：ACCESS_CODE 门禁 + 按客户端限流',
    '- 测试：89 个单元/集成用例 + 12 个 Playwright 端到端 + PowerPoint COM 校验 + 公网验收'
  ].join('\n');
  const res = git(['commit', '-m', message]);
  if (res.status !== 0) {
    console.error(res.stdout || res.stderr);
    process.exit(1);
  }
  log('\n已提交');
} else {
  const res = git(['commit', '-m', 'chore: 部署与公网访问相关的更新']);
  if (res.status === 0) log('\n已提交增量改动');
  else log('\n没有需要提交的改动');
}

log(git(['--no-pager', 'log', '--oneline', '-3']).stdout.trim());

/* ------------------------------------------------------------ 4. remote ---- */

const url = `https://github.com/${username}/${repo}.git`;
const hasRemote = git(['remote', 'get-url', 'origin']).status === 0;
git(hasRemote ? ['remote', 'set-url', 'origin', url] : ['remote', 'add', 'origin', url]);
log(`\n已设置 remote origin -> ${url}`);

log(`
${'='.repeat(72)}
接下来只需要你做两件事（我无法代劳：GitHub 2021 年起就不再支持密码认证了）：

1) 在浏览器里新建一个空仓库（不要勾选 README / .gitignore / license）：
   https://github.com/new?name=${repo}

2) 在本机执行（会提示输入用户名和 Personal Access Token）：
   cd ${DEPLOY}
   git push -u origin main

   访问令牌在这里创建（勾选 repo 权限即可）：
   https://github.com/settings/tokens/new?scopes=repo&description=ai-ppt-generator

   提示密码时：用户名填 ${username}，密码粘 Personal Access Token（不是账户密码）。
   想省掉每次输入，可以先执行：
   git config --global credential.helper manager
${'='.repeat(72)}
`);

if (process.argv.includes('--push')) {
  log('尝试推送（会等待你输入凭据）…');
  const res = spawnSync('git', ['push', '-u', 'origin', 'main'], { cwd: DEPLOY, stdio: 'inherit' });
  process.exit(res.status ?? 1);
}
