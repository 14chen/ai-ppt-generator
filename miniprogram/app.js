const { THEMES, themeIds } = require('./utils/themes.generated.js');
const { API_BASE } = require('./config.js');

App({
  globalData: {
    apiBase: API_BASE,
    themes: THEMES,
    themeIds: themeIds,
    theme: 'midnight',
    /** deck produced by the last successful generation (shared across pages) */
    deck: null,
    sourceText: ''
  },

  onLaunch() {
    try {
      const savedTheme = wx.getStorageSync('ppt-theme');
      if (savedTheme && themeIds.indexOf(savedTheme) >= 0) {
        this.globalData.theme = savedTheme;
      }
      const savedText = wx.getStorageSync('ppt-draft');
      if (typeof savedText === 'string') this.globalData.sourceText = savedText;
    } catch (e) {
      /* storage is best-effort */
    }
  },

  setTheme(id) {
    if (themeIds.indexOf(id) < 0) return this.globalData.theme;
    this.globalData.theme = id;
    try {
      wx.setStorageSync('ppt-theme', id);
    } catch (e) {
      /* ignore */
    }
    return id;
  },

  themeLabel(id) {
    for (let i = 0; i < THEMES.length; i += 1) {
      if (THEMES[i].id === id) return THEMES[i].label;
    }
    return id;
  }
});
