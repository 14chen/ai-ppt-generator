/**
 * 复制为 config.js 后填写（config.js 已被 .gitignore 忽略，不会被提交）。
 *
 *   cp miniprogram/config.example.js miniprogram/config.js
 *
 * 也可以直接运行 `npm run miniprogram:config`（本机局域网）或
 * `node scripts/set-public-url.mjs <公网地址>`（部署目录里）自动生成。
 */
module.exports = {
  /**
   * 后端地址。
   *  - 手机与电脑同一 Wi-Fi：用电脑的局域网地址，例如 http://192.168.1.15:8787
   *  - 已经部署到公网：用 HTTPS 域名，例如 https://xxxx.trycloudflare.com
   */
  API_BASE: 'http://192.168.1.15:8787',

  /**
   * 访问码（可选）。后端 .env 里设置了 ACCESS_CODE 时，这里必须填一样的值，
   * 否则所有接口都会返回 401。留空表示后端没有开启访问保护。
   */
  ACCESS_CODE: ''
};
