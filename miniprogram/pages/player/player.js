const app = getApp();
const { fitScale, layoutLabel } = require('../../utils/format.js');
const { exportPptx, openPptx } = require('../../utils/api.js');
const { THEMES } = require('../../utils/themes.generated.js');

const DESIGN_W = 1280;
const DESIGN_H = 720;

Page({
  data: {
    slides: [],
    total: 0,
    index: 0,
    theme: 'midnight',
    themeLabel: '',
    themes: THEMES,
    scale: 0.5,
    stageW: 640,
    stageH: 360,
    hudVisible: true,
    notesVisible: false,
    notes: '',
    layoutText: '',
    safeTop: 20,
    exporting: false
  },

  onLoad(query) {
    const deck = app.globalData.deck;
    if (!deck || !deck.slides || !deck.slides.length) {
      wx.showToast({ title: '没有可演示的内容', icon: 'none' });
      setTimeout(() => wx.navigateBack(), 800);
      return;
    }
    const index = Math.max(0, Math.min(deck.slides.length - 1, Number(query && query.index) || 0));
    this.setData({
      slides: deck.slides,
      total: deck.slides.length,
      index: index,
      theme: app.globalData.theme,
      themeLabel: app.themeLabel(app.globalData.theme)
    });
    this.layout();
    wx.setKeepScreenOn && wx.setKeepScreenOn({ keepScreenOn: true });
  },

  onUnload() {
    wx.setKeepScreenOn && wx.setKeepScreenOn({ keepScreenOn: false });
  },

  onResize() {
    this.layout();
  },

  /** 固定 1280x720 设计画布 -> 按屏幕等比缩放（与网页端同一策略） */
  layout() {
    let info = {};
    try {
      info = wx.getWindowInfo ? wx.getWindowInfo() : wx.getSystemInfoSync();
    } catch (e) {
      info = { windowWidth: 375, windowHeight: 667, safeArea: null };
    }
    const viewW = info.windowWidth || 375;
    const viewH = info.windowHeight || 667;
    const safeTop = info.safeArea && info.safeArea.top ? info.safeArea.top : 20;
    // 底部 HUD 与顶部安全区占用
    const scale = fitScale({
      designW: DESIGN_W,
      designH: DESIGN_H,
      viewW: viewW,
      viewH: Math.max(200, viewH - safeTop - 120)
    });
    this.setData({
      scale: Number(scale.toFixed(4)),
      stageW: Math.round(DESIGN_W * scale),
      stageH: Math.round(DESIGN_H * scale),
      safeTop: safeTop
    });
    this.updateDerived(this.data.index);
  },

  updateDerived(index) {
    const slide = this.data.slides[index] || {};
    this.setData({
      notes: slide.notes || '',
      notesVisible: false,
      layoutText: layoutLabel(slide.layout)
    });
  },

  goTo(index, silent) {
    const total = this.data.total;
    if (!total) return;
    const next = Math.max(0, Math.min(total - 1, index));
    if (next === this.data.index && !silent) return;
    this.setData({ index: next });
    this.updateDerived(next);
  },

  next() {
    if (this.data.index >= this.data.total - 1) {
      wx.showToast({ title: '已经是最后一页', icon: 'none', duration: 900 });
      return;
    }
    this.goTo(this.data.index + 1);
  },

  prev() {
    if (this.data.index <= 0) {
      wx.showToast({ title: '已经是第一页', icon: 'none', duration: 900 });
      return;
    }
    this.goTo(this.data.index - 1);
  },

  /* ------------------------------------------------------------- 交互 */

  onTapZone(e) {
    const zone = e.currentTarget.dataset.zone;
    if (zone === 'prev') this.prev();
    else if (zone === 'next') this.next();
    else this.setData({ hudVisible: !this.data.hudVisible });
  },

  onTouchStart(e) {
    const t = e.touches && e.touches[0];
    if (!t) return;
    this._touch = { x: t.clientX, y: t.clientY, at: Date.now() };
  },

  onTouchEnd(e) {
    const start = this._touch;
    this._touch = null;
    if (!start) return;
    const t = (e.changedTouches && e.changedTouches[0]) || null;
    if (!t) return;
    const dx = t.clientX - start.x;
    const dy = t.clientY - start.y;
    if (Date.now() - start.at > 900) return;
    if (Math.abs(dx) > 45 && Math.abs(dx) > Math.abs(dy) * 1.4) {
      if (dx < 0) this.next();
      else this.prev();
    }
  },

  onJump(e) {
    this.goTo(Number(e.currentTarget.dataset.index) || 0);
  },

  onCycleTheme() {
    const ids = app.globalData.themeIds;
    const current = this.data.theme;
    let i = ids.indexOf(current);
    if (i < 0) i = 0;
    const nextTheme = app.setTheme(ids[(i + 1) % ids.length]);
    this.setData({ theme: nextTheme, themeLabel: app.themeLabel(nextTheme) });
  },

  onPickTheme(e) {
    const id = e.currentTarget.dataset.id;
    const theme = app.setTheme(id);
    this.setData({ theme: theme, themeLabel: app.themeLabel(theme) });
  },

  onToggleNotes() {
    if (!this.data.notes) {
      wx.showToast({ title: '本页没有备注', icon: 'none' });
      return;
    }
    this.setData({ notesVisible: !this.data.notesVisible });
  },

  onBack() {
    wx.navigateBack();
  },

  onExport() {
    if (this.data.exporting) return;
    const deck = app.globalData.deck;
    if (!deck) return;
    this.setData({ exporting: true });
    wx.showLoading({ title: '正在生成 PPTX…', mask: true });
    exportPptx(deck, this.data.theme)
      .then((filePath) => {
        wx.hideLoading();
        this.setData({ exporting: false });
        return openPptx(filePath);
      })
      .catch((err) => {
        wx.hideLoading();
        this.setData({ exporting: false });
        wx.showModal({ title: '导出失败', content: (err && err.message) || '未知错误', showCancel: false });
      });
  },

  onShareAppMessage() {
    const deck = app.globalData.deck || {};
    return { title: deck.title || 'AI 生成的网页 PPT', path: '/pages/index/index' };
  }
});
