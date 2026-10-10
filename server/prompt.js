/**
 * Prompt contract for the deck-generation model.
 *
 * NDJSON (one JSON object per line) is requested on purpose: it lets the server
 * surface each finished slide to the browser the moment it is produced, which
 * is what drives the live progress UI.
 */

const LAYOUT_SPEC = [
  '{"layout":"cover","title":"主标题","subtitle":"副标题","bullets":["演讲人","日期"]}',
  '{"layout":"section","title":"章节标题","subtitle":"一句话说明这一章要讲什么"}',
  '{"layout":"bullets","title":"页标题","bullets":["要点一","要点二","要点三"],"icon":"🎯","notes":"演讲者备注"}',
  '{"layout":"two-column","title":"页标题","columns":[{"heading":"左栏标题","items":["a","b"]},{"heading":"右栏标题","items":["c","d"]}]}',
  '{"layout":"stats","title":"页标题","stats":[{"value":"68%","label":"指标说明"},{"value":"3.2x","label":"增长倍数"}]}',
  '{"layout":"quote","title":"","quote":{"text":"一句话金句","author":"出处"}}',
  '{"layout":"timeline","title":"页标题","steps":[{"title":"阶段一","detail":"这一步做什么"},{"title":"阶段二","detail":"这一步做什么"}]}',
  '{"layout":"closing","title":"谢谢观看","subtitle":"联系方式或下一步行动"}'
].join('\n');

const LANGUAGE_LABEL = {
  auto: '与用户原文保持一致（原文是中文就必须输出中文）',
  zh: '简体中文',
  en: 'English'
};

export function buildMessages({ text, targetSlides = 10, language = 'auto', maxSlides = 24 }) {
  const target = Math.max(3, Math.min(Number(targetSlides) || 10, maxSlides));

  const system = `你是一名顶尖的演示文稿（PPT）架构师，擅长把冗长的文章、报告、会议记录提炼成结构清晰、层层递进的演示页面。

# 输出格式（必须严格遵守）
你的回答**只有 NDJSON**：第一行是一个 meta 对象，之后每一行是一页幻灯片。
- 每一行必须是**单行、合法、可独立解析的 JSON 对象**：不能换行、不能有尾随逗号、不能有注释。
- 不要输出 Markdown 代码块（不要 \`\`\`），不要输出解释、前言、结语或任何 JSON 之外的字。
- 每个对象结束后立刻换行，再输出下一个对象。

第一行 meta：
{"type":"meta","title":"整份演示的主标题","subtitle":"一句话副标题","slideCount":页数}

之后每页按需使用以下字段之一（layout 决定版式）：
${LAYOUT_SPEC}

# 内容规则
1. 总页数约 ${target} 页（含封面与结尾，误差不超过 2 页）。第一页必须是 cover，最后一页必须是 closing。
2. 语言：${LANGUAGE_LABEL[language] ?? LANGUAGE_LABEL.auto}。
3. 页面要有叙事结构：封面 → 背景/问题 → 核心内容（多个要点页，必要时用 two-column / stats / timeline / quote 变化节奏）→ 结论/行动建议 → 结尾。
4. 每页标题不超过 20 字；bullets 每页 3–5 条、每条不超过 30 字；stats 2–4 项；steps 3–5 项；columns 2–3 栏。
5. 只使用原文中出现的事实、数字、专有名词，**绝对不许编造**数据、来源或引用；信息不足时做归纳概括，而不是虚构。
6. 写成可以直接念出来的要点短语，不要写成大段文字，不要在 bullet 末尾加句号。
7. 至少 2 页使用非 bullets 版式（stats / two-column / timeline / quote / section），让整份演示有节奏变化。
8. "notes" 字段用来写这一页的演讲提示（可选，1 句话以内）。`;

  const user = `请把下面这段文案拆解为网页 PPT。

<<<文案开始>>>
${text}
<<<文案结束>>>`;

  return [
    { role: 'system', content: system },
    { role: 'user', content: user }
  ];
}
