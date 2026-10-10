const { API_BASE } = require('../../config.js');
const { THEMES } = require('../../utils/themes.generated.js');

Page({
  data: {
    apiBase: API_BASE,
    themeCount: THEMES.length,
    themeNames: THEMES.map((t) => t.label).join(' / '),
    checks: []
  },

  onLoad() {
    wx.request({
      url: `${API_BASE}/api/health`,
      method: 'GET',
      timeout: 15000,
      success: (res) => {
        const d = res.data || {};
        this.setData({
          checks: [
            { label: '后端连通', ok: res.statusCode === 200, value: `HTTP ${res.statusCode}` },
            { label: '模型', ok: Boolean(d.model), value: d.model || '-' },
            { label: 'API Key', ok: Boolean(d.hasApiKey), value: d.hasApiKey ? '已配置' : '未配置' },
            { label: '服务地址', ok: true, value: d.baseUrl || '-' }
          ]
        });
      },
      fail: (err) => {
        this.setData({
          checks: [
            { label: '后端连通', ok: false, value: (err && err.errMsg) || '连接失败' },
            { label: '服务地址', ok: false, value: API_BASE }
          ]
        });
      }
    });
  },

  onCopyBase() {
    wx.setClipboardData({
      data: API_BASE,
      success() {
        wx.showToast({ title: '已复制服务地址', icon: 'none' });
      }
    });
  },

  onShareAppMessage() {
    return { title: 'AI 网页 PPT 生成器 · 粘贴文案一键生成演示', path: '/pages/index/index' };
  }
});
