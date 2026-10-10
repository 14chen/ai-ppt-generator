/**
 * Build a .pptx from a fixed, representative deck (one page per layout) so the
 * generator can be inspected and validated without calling the model.
 *
 * Usage:
 *   node scripts/pptx-preview.mjs [themeId]
 * Then rasterise + inspect with:
 *   powershell -File scripts/validate-pptx.ps1 -Path test-results/pptx-preview/deck.pptx -AllText -ExportPng test-results/pptx-preview/png
 */
import fs from 'node:fs';
import path from 'node:path';
import { buildPptxBuffer } from '../server/pptx.js';
import { normalizeDeck } from '../server/deck.js';
import { allThemes } from '../server/themes.js';

const themeId = process.argv[2] || 'midnight';
const OUT_DIR = path.resolve('test-results', 'pptx-preview');
fs.mkdirSync(OUT_DIR, { recursive: true });

const rawSlides = [
  { layout: 'cover', title: '2024 企业级 AI 应用落地调研', subtitle: '从试点到规模化：关键数据与行动指南', bullets: ['调研节选', '覆盖 412 家企业', '2024 年度'] },
  { layout: 'section', title: '规模化落地现状', subtitle: '过去 18 个月，从试点走向规模化' },
  { layout: 'bullets', title: '项目失败的三个原因', icon: '⚠️', bullets: ['58% 源于数据准备不足', '31% 源于评价体系缺失', '22% 源于组织协同问题', '缺少业务与技术的指标映射'] },
  {
    layout: 'stats',
    title: '部署率 vs 生产环境渗透率',
    stats: [
      { value: '63%', label: '企业已部署大模型能力' },
      { value: '14%', label: '进入生产环境且日均调用超 10 万次' },
      { value: '27pp', label: '部署率同比提升' }
    ]
  },
  {
    layout: 'two-column',
    title: '成本结构变化',
    columns: [
      { heading: '推理成本', items: ['占比从 61% 降到 38%', '缓存复用降低重复计算', '模型效率持续提升'] },
      { heading: '治理投入', items: ['占比从 19% 升到 41%', '数据标准化', '权限建模与版本管理'] }
    ]
  },
  {
    layout: 'timeline',
    title: '四步落地路径',
    steps: [
      { title: '选定单点场景', detail: '优先选择有明确量化指标的场景' },
      { title: '数据治理前置', detail: '文档标准化、权限建模、版本管理' },
      { title: '建立双层评价体系', detail: '技术层看准确率，业务层看工时节省' },
      { title: '6–8 周闭环验证', detail: '验证通过后再决定是否扩大投入' }
    ]
  },
  { layout: 'quote', title: '', quote: { text: '规模化落地的关键，在于把数据治理当作前置工程而不是收尾工作。', author: '2024 企业级 AI 应用落地调研报告' } },
  { layout: 'closing', title: '谢谢观看', subtitle: '欢迎交流：下一步行动清单已同步至共享文档' }
];

const deck = normalizeDeck({ rawSlides, meta: { title: '2024 企业级 AI 应用落地调研', subtitle: '从试点到规模化' }, theme: themeId, maxSlides: 24 });
const buffer = await buildPptxBuffer(deck, { theme: themeId });
const file = path.join(OUT_DIR, 'deck.pptx');
fs.writeFileSync(file, buffer);

console.log(`theme     : ${themeId} (${allThemes().find((t) => t.id === themeId)?.label ?? '?'})`);
console.log(`slides    : ${deck.slides.length}`);
console.log(`layouts   : ${deck.slides.map((s) => s.layout).join(', ')}`);
console.log(`bytes     : ${buffer.length}`);
console.log(`written   : ${file}`);
