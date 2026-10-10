const app = getApp();
const { streamGenerate, checkHealth } = require('../../utils/api.js');
const { formatMs, layoutLabel } = require('../../utils/format.js');
const { THEMES } = require('../../utils/themes.generated.js');

const SAMPLE = `2024 年企业级 AI 应用落地调研报告（节选）

过去 18 个月，中国企业级 AI 应用从试点走向规模化。本次调研覆盖 412 家企业，其中 63% 已在至少一个业务环节部署大模型能力，同比提升 27 个百分点；但真正进入生产环境、日均调用超过 10 万次的企业仅占 14%。

典型场景有三类：知识密集型场景（客服知识库、合同审查、研发问答）平均把检索时间从 25 分钟压缩到 90 秒；流程自动化场景中，某制造企业把月度对账周期从 7 天缩短到 4 小时；创意生成场景则主要降低试错成本。

失败原因方面，58% 的项目源于数据准备不足，31% 源于评价体系缺失，22% 源于组织协同问题。成本结构上，推理成本占比从 61% 降到 38%，而数据治理与工程化投入从 19% 升到 41%。

行动建议：从有明确量化指标的单点场景切入；把数据治理前置；建立技术层与业务层的双层评价体系；用 6 到 8 周完成一次闭环验证再决定是否扩大投入。`;

const LANGUAGES = ['跟随原文', '简体中文', 'English'];
const LANGUAGE_IDS = ['auto', 'zh', 'en'];

Page({
  data: {
    text: '',
    initialText: '',
    charCount: 0,
    maxChars: 20000,
    minChars: 20,

    status: 'idle', // idle | running | error
    error: '',
    logs: [],
    slides: [],
    meta: null,
    percent: 2,
    elapsedText: '0s',
    contentChars: 0,
    reasoningChars: 0,
    rawPreview: '',

    targetSlides: 8,
    pageChoices: [6, 8, 10, 12, 16],
    languages: LANGUAGES,
    languageIndex: 0,

    theme: 'midnight',
    themeLabel: '深空蓝',
    themes: THEMES,

    health: null,
    thumbScale: 0.19,
    hasDeck: false
  },

  onLoad() {
    const saved = app.globalData.sourceText || '';
    this.setData({
      text: saved,
      initialText: saved,
      charCount: saved.length,
      theme: app.globalData.theme,
      themeLabel: app.themeLabel(app.globalData.theme),
      hasDeck: Boolean(app.globalData.deck)
    });
    checkHealth().then((health) => {
      if (health) this.setData({ health: health, maxChars: health.maxChars || 20000, minChars: health.minChars || 20 });
    });
  },

  onUnload() {
    this.stopRun();
  },

  onHide() {
    if (this.data.status !== 'running') return;
    // 小程序切后台时保持流；只有页面销毁才中断
  },

  /* ------------------------------------------------------------- 输入相关 */

  onInput(e) {
    const value = e.detail.value || '';
    this.setData({ text: value, charCount: value.length });
    app.globalData.sourceText = value;
  },

  onLoadSample() {
    this.setData({ text: SAMPLE, initialText: SAMPLE, charCount: SAMPLE.length, error: '' });
    app.globalData.sourceText = SAMPLE;
    wx.showToast({ title: '已载入示例', icon: 'none' });
  },

  onClear() {
    this.setData({ text: '', initialText: '', charCount: 0, error: '' });
    app.globalData.sourceText = '';
  },

  onPickPages(e) {
    this.setData({ targetSlides: this.data.pageChoices[Number(e.currentTarget.dataset.index)] });
  },

  onPickLanguage(e) {
    this.setData({ languageIndex: Number(e.detail.value) });
  },

  onPickTheme(e) {
    const id = e.currentTarget.dataset.id;
    const theme = app.setTheme(id);
    this.setData({ theme: theme, themeLabel: app.themeLabel(theme) });
  },

  /* --------------------------------------------------------------- 生成 */

  onGenerate() {
    const text = (this.data.text || '').trim();
    if (this.data.status === 'running') return;
    if (text.length < this.data.minChars) {
      wx.showToast({ title: `文案至少 ${this.data.minChars} 字`, icon: 'none' });
      return;
    }

    const startedAt = Date.now();
    this._deck = null;
    this._serverError = '';
    this._lastFlush = 0;

    this.setData({
      status: 'running',
      error: '',
      logs: [],
      slides: [],
      meta: null,
      percent: 2,
      contentChars: 0,
      reasoningChars: 0,
      elapsedText: '0s',
      rawPreview: ''
    });

    this._timer = setInterval(() => {
      this.setData({ elapsedText: formatMs(Date.now() - startedAt) });
    }, 500);

    this._task = streamGenerate({
      text: text,
      settings: {
        targetSlides: this.data.targetSlides,
        language: LANGUAGE_IDS[this.data.languageIndex] || 'auto',
        theme: this.data.theme
      },
      onEvent: (ev) => this.handleEvent(ev),
      onError: (err) => this.finishRun(err && err.message ? err.message : '网络错误'),
      onComplete: () => this.onStreamComplete()
    });
  },

  handleEvent(ev) {
    const d = ev.data || {};
    if (ev.event === 'status') {
      const logs = this.data.logs.concat([{ text: d.message, at: Date.now() }]).slice(-6);
      this.setData({ logs: logs });
      return;
    }
    if (ev.event === 'meta') {
      const meta = Object.assign({}, this.data.meta, d.meta);
      this.setData({ meta: meta });
      return;
    }
    if (ev.event === 'slide') {
      const slides = this.data.slides.concat([d.slide]);
      this.setData({
        slides: slides,
        percent: this.computePercent(slides.length, this.data.meta)
      });
      return;
    }
    if (ev.event === 'reasoning') {
      this._reasoning = (this._reasoning || 0) + String(d.text || '').length;
    }
    if (ev.event === 'raw') {
      this._raw = ((this._raw || '') + String(d.text || '')).slice(-1200);
    }
    if (ev.event === 'progress') {
      const now = Date.now();
      if (now - this._lastFlush < 350) return;
      this._lastFlush = now;
      this.setData({
        contentChars: d.contentChars || 0,
        reasoningChars: d.reasoningChars || this._reasoning || 0,
        rawPreview: this._raw || '',
        percent: this.computePercent(this.data.slides.length, this.data.meta, d)
      });
      return;
    }
    if (ev.event === 'done') {
      this._deck = d.deck;
      return;
    }
    if (ev.event === 'error') {
      this._serverError = d.message || '生成失败';
    }
  },

  computePercent(slideCount, meta, progress) {
    const total = (meta && meta.slideCount) || (progress && progress.total) || 0;
    if (total > 0) return Math.min(96, Math.round((slideCount / total) * 100));
    const chars = (progress && progress.contentChars) || 0;
    if (chars > 0) return Math.min(90, Math.round((chars / 3500) * 100));
    return this.data.slides.length ? 12 : 4;
  },

  onStreamComplete() {
    this.clearTimer();
    if (this._deck) {
      app.globalData.deck = this._deck;
      this.setData({ percent: 100, status: 'idle', hasDeck: true });
      wx.showToast({ title: '生成完成', icon: 'success', duration: 900 });
      setTimeout(() => {
        wx.navigateTo({ url: '/pages/deck/deck' });
      }, 350);
      return;
    }
    this.finishRun(this._serverError || '生成意外结束，请重试');
  },

  finishRun(message) {
    this.clearTimer();
    this.setData({ status: 'error', error: message || '生成失败' });
  },

  clearTimer() {
    if (this._timer) {
      clearInterval(this._timer);
      this._timer = null;
    }
  },

  stopRun() {
    this.clearTimer();
    if (this._task && this._task.abort) this._task.abort();
    this._task = null;
  },

  onCancel() {
    this.stopRun();
    this.setData({ status: 'idle', percent: 2 });
    wx.showToast({ title: '已取消', icon: 'none' });
  },

  onOpenDeck() {
    if (!app.globalData.deck) {
      wx.showToast({ title: '还没有生成结果', icon: 'none' });
      return;
    }
    wx.navigateTo({ url: '/pages/deck/deck' });
  },

  onOpenAbout() {
    wx.navigateTo({ url: '/pages/about/about' });
  },

  onShareAppMessage() {
    return {
      title: 'AI 网页 PPT 生成器 · 粘贴文案一键生成演示',
      path: '/pages/index/index'
    };
  }
});
