/**
 * 后端地址配置。
 *
 * 手机与电脑处于同一 Wi-Fi 时，用电脑的局域网地址即可（本项目默认端口 8787）。
 * 运行 `npm run miniprogram:config` 会自动把下面的 API_BASE 改写成当前电脑的局域网地址。
 *
 * 正式发布注意：
 *   1. 微信要求 request 合法域名必须是 **HTTPS**；
 *   2. 局域网 IP 在开发阶段可用，需要在微信开发者工具里勾选
 *      「开发环境不校验请求域名、TLS 版本及 HTTPS 证书」（本项目 project.config.json
 *      已设置 "urlCheck": false，对应这个开关）；
 *   3. 上线需要在微信公众平台 → 开发管理 → 服务器域名 里配置你的 HTTPS 域名。
 */
module.exports = {
  API_BASE: 'http://192.168.1.15:8787',

  /**
   * 访问码（可选）。如果后端 .env 里设置了 ACCESS_CODE，这里必须填一样的值，
   * 否则所有接口都会返回 401。留空表示后端未开启访问保护。
   */
  ACCESS_CODE: ''
};
