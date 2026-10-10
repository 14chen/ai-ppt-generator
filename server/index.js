import { createApp } from './app.js';
import { config } from './config.js';
import { lanAddress } from './routes/export.js';

const app = await createApp();

const server = app.listen(config.port, config.host, () => {
  const url = `http://${config.host === '0.0.0.0' ? 'localhost' : config.host}:${config.port}`;
  const lan = `http://${lanAddress()}:${config.port}`;
  console.log('');
  console.log('  ⚡ AI 网页 PPT 生成器');
  console.log(`  ➜  本地地址:   ${url}`);
  console.log(`  ➜  局域网地址: ${lan}   (手机/小程序用这个)`);
  console.log(`  ➜  运行模式:   ${config.isDev ? 'development (Vite HMR)' : 'production'}`);
  console.log(`  ➜  模型:       ${config.model}  @ ${config.baseUrl}`);
  console.log(`  ➜  API Key:    ${config.apiKey ? '已配置 ✓' : '未配置 ✗  (请在 .env 中设置 DEEPSEEK_API_KEY)'}`);
  console.log(
    `  ➜  微信小程序: ${
      config.wxAppId && config.wxSecret
        ? '已配置 WX_APPID/WX_SECRET，扫码入口为真正的小程序码 ✓'
        : '未配置 WX_APPID/WX_SECRET，扫码入口回退为手机网页版'
    }`
  );
  console.log(`  ➜  扫码入口:   ${url}/  → 右上角「扫码使用」`);
  console.log('');
});

server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.error(`\n端口 ${config.port} 已被占用。请设置 PORT 环境变量后重试，例如：PORT=8899 npm run dev\n`);
  } else {
    console.error(err);
  }
  process.exit(1);
});

for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, () => {
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 1500).unref();
  });
}
