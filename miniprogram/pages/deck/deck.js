const app = getApp();
const { exportPptx, openPptx } = require('../../utils/api.js');
const { layoutLabel, formatMs } = require('../../utils/format.js');
const { THEMES } = require('../../utils/themes.generated.js');

Page({
  data: {
    deck: null,
    slides: [],
    layouts: [],
    total: 0,
    theme: 'midnight',
    themeLabel: '',
    themes: THEMES,
    thumbScale: 0.25,
    exporting: false,
    metaText: ''
  },

  onShow() {
    const deck = app.globalData.deck;
    if (!deck || !deck.slides || !deck.slides.length) {
      wx.showToast({ title: '还没有生成结果', icon: 'none' });
      setTimeout(() => wx.navigateBack(), 800);
      return;
    }
    const theme = app.globalData.theme;
    const elapsed = deck.meta && deck.meta.elapsedMs ? ` · ${(deck.meta.elapsedMs / 1000).toFixed(1)}s` : '';
    this.setData({
      deck: deck,
      slides: deck.slides,
      layouts: deck.slides.map((s) => layoutLabel(s.layout)),
      total: deck.slides.length,
      theme: theme,
      themeLabel: app.themeLabel(theme),
      metaText: `${deck.slides.length} 页${deck.meta && deck.meta.model ? ' · ' + deck.meta.model : ''}${elapsed}`
    });
    wx.setNavigationBarTitle({ title: deck.title || '页面总览' });
  },

  onPickTheme(e) {
    const id = e.currentTarget.dataset.id;
    const theme = app.setTheme(id);
    this.setData({ theme: theme, themeLabel: app.themeLabel(theme) });
  },

  onOpenPlayer(e) {
    const index = Number(e.currentTarget.dataset.index) || 0;
    wx.navigateTo({ url: `/pages/player/player?index=${index}` });
  },

  onPresent() {
    wx.navigateTo({ url: '/pages/player/player?index=0' });
  },

  onRestart() {
    wx.navigateBack();
  },

  onExport() {
    if (this.data.exporting) return;
    const deck = this.data.deck;
    if (!deck) return;

    this.setData({ exporting: true });
    wx.showLoading({ title: '正在生成 PPTX…', mask: true });

    exportPptx(deck, this.data.theme)
      .then((filePath) => {
        wx.hideLoading();
        this.setData({ exporting: false });
        wx.showToast({ title: '已生成，正在打开', icon: 'none', duration: 1200 });
        return openPptx(filePath);
      })
      .catch((err) => {
        wx.hideLoading();
        this.setData({ exporting: false });
        wx.showModal({
          title: '导出失败',
          content: (err && err.message) || '未知错误',
          showCancel: false
        });
      });
  },

  onCopyJson() {
    const deck = this.data.deck;
    if (!deck) return;
    const text = JSON.stringify({ title: deck.title, theme: this.data.theme, slides: deck.slides });
    if (text.length > 200000) {
      wx.showToast({ title: '内容过大，请改用导出 PPTX', icon: 'none' });
      return;
    }
    wx.setClipboardData({
      data: text,
      success() {
        wx.showToast({ title: '结构 JSON 已复制', icon: 'none' });
      }
    });
  },

  onShareAppMessage() {
    const deck = this.data.deck || {};
    return {
      title: deck.title ? `${deck.title} · AI 生成的演示` : 'AI 生成的网页 PPT',
      path: '/pages/index/index'
    };
  }
});
