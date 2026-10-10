const { pad2 } = require('../../utils/format.js');

/**
 * 单页幻灯片渲染组件。
 *
 * 设计画布固定 1280rpx x 720rpx（与网页端 1280x720 px 画布数值一一对应），
 * 由外层用 transform: scale(k) 缩放到目标尺寸 —— 与网页/导出 HTML 的
 * 「固定画布 + 等比缩放」策略完全一致。
 *
 * 配色通过 `t-<themeId>` 类切换（见 styles/themes.wxss，由脚本从网页端主题生成），
 * 不使用 CSS 变量，因为微信官方文档没有承诺 WXSS 支持 var()。
 */
Component({
  options: {
    addGlobalClass: true,
    multipleSlots: false
  },

  properties: {
    slide: { type: Object, value: {} },
    index: { type: Number, value: 0 },
    total: { type: Number, value: 1 },
    deckTitle: { type: String, value: '' },
    theme: { type: String, value: 'midnight' }
  },

  data: {
    indexLabel: '01',
    pageLabel: '1',
    meta: []
  },

  observers: {
    'slide, index': function (slide, index) {
      const s = slide || {};
      const isBookend = s.layout === 'cover' || s.layout === 'closing';
      const meta = isBookend && Array.isArray(s.bullets) ? s.bullets.slice(0, 4) : [];
      this.setData({
        meta: meta,
        indexLabel: pad2((index || 0) + 1),
        pageLabel: String((index || 0) + 1)
      });
    }
  }
});
