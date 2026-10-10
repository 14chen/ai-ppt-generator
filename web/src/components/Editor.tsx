import { useMemo, useState } from 'react';
import { SAMPLES } from '../samples';
import { IconSparkles, IconWarn } from './Icons';
import type { HealthInfo } from '../types';

interface Props {
  text: string;
  onText: (value: string) => void;
  targetSlides: number;
  onTargetSlides: (value: number) => void;
  language: 'auto' | 'zh' | 'en';
  onLanguage: (value: 'auto' | 'zh' | 'en') => void;
  onGenerate: () => void;
  health: HealthInfo | null;
  error: string | null;
  busy?: boolean;
}

const PAGE_CHOICES = [6, 8, 10, 12, 16];

export function Editor({
  text,
  onText,
  targetSlides,
  onTargetSlides,
  language,
  onLanguage,
  onGenerate,
  health,
  error,
  busy
}: Props) {
  const [sampleOpen, setSampleOpen] = useState(false);

  const minChars = health?.minChars ?? 20;
  const maxChars = health?.maxChars ?? 20000;
  const tooShort = text.trim().length < minChars;
  const tooLong = text.length > maxChars;
  const overLimit = text.length > maxChars * 0.9 && !tooLong;

  const counterClass = useMemo(() => {
    if (tooLong) return 'counter is-bad';
    if (overLimit) return 'counter is-warn';
    return 'counter';
  }, [tooLong, overLimit]);

  const keyMissing = health ? !health.hasApiKey : false;

  return (
    <div className="editor">
      <section className="card editor-main">
        <div className="card-head">
          <h2>粘贴你的长文案</h2>
          <div className="head-tools">
            <div className="menu">
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => setSampleOpen((v) => !v)}>
                载入示例
              </button>
              {sampleOpen ? (
                <div className="menu-pop menu-pop-right">
                  {SAMPLES.map((s) => (
                    <button
                      key={s.id}
                      type="button"
                      onClick={() => {
                        onText(s.text);
                        setSampleOpen(false);
                      }}
                    >
                      <b>{s.label}</b>
                      <small>{s.text.slice(0, 38)}…</small>
                    </button>
                  ))}
                </div>
              ) : null}
            </div>
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              onClick={() => onText('')}
              disabled={!text}
              data-testid="clear-text"
            >
              清空
            </button>
          </div>
        </div>

        <textarea
          className="source-input"
          value={text}
          onChange={(e) => onText(e.target.value)}
          placeholder={
            '把文章、报告、会议记录或产品资料整段粘贴进来…\n\n例如：一份 2000 字的行业分析，AI 会自动提炼出封面、章节页、要点页、数据页和结尾页。'
          }
          spellCheck={false}
          data-testid="source-text"
          aria-label="待转换的文案"
        />

        <div className="editor-foot">
          <span className={counterClass}>
            {text.length.toLocaleString()} / {maxChars.toLocaleString()} 字
            {tooShort && text.length > 0 ? ` · 至少 ${minChars} 字` : ''}
          </span>
          <button
            type="button"
            className="btn btn-primary btn-lg"
            onClick={onGenerate}
            disabled={busy || tooShort || tooLong || keyMissing}
            data-testid="generate"
          >
            <IconSparkles size={18} />
            {busy ? '生成中…' : '生成 PPT'}
          </button>
        </div>
      </section>

      <aside className="editor-side">
        {keyMissing ? (
          <div className="alert alert-error" role="alert">
            <IconWarn size={18} />
            <div>
              <b>未配置 API Key</b>
              <p>
                请在项目根目录的 <code>.env</code> 中设置 <code>DEEPSEEK_API_KEY</code>，然后重启服务。
              </p>
            </div>
          </div>
        ) : null}

        {error ? (
          <div className="alert alert-error" role="alert" data-testid="editor-error">
            <IconWarn size={18} />
            <div>
              <b>出错了</b>
              <p>{error}</p>
            </div>
          </div>
        ) : null}

        <div className="card">
          <div className="card-head">
            <h2>生成设置</h2>
          </div>
          <div className="field">
            <label htmlFor="target-slides">目标页数</label>
            <div className="segmented" id="target-slides" role="radiogroup" aria-label="目标页数">
              {PAGE_CHOICES.map((n) => (
                <button
                  key={n}
                  type="button"
                  role="radio"
                  aria-checked={targetSlides === n}
                  className={targetSlides === n ? 'is-active' : ''}
                  onClick={() => onTargetSlides(n)}
                  data-testid={`pages-${n}`}
                >
                  {n}
                </button>
              ))}
            </div>
          </div>

          <div className="field">
            <label htmlFor="lang">输出语言</label>
            <select
              id="lang"
              value={language}
              onChange={(e) => onLanguage(e.target.value as 'auto' | 'zh' | 'en')}
              data-testid="language"
            >
              <option value="auto">跟随原文</option>
              <option value="zh">简体中文</option>
              <option value="en">English</option>
            </select>
          </div>

          <div className="hint">
            <p>
              <b>生成流程</b>
            </p>
            <ol>
              <li>后端以流式方式调用 <code>{health?.model ?? 'deepseek-v4-pro'}</code></li>
              <li>模型逐行输出页面 JSON，服务端边收边解析</li>
              <li>前端实时显示进度，并可直接开始全屏演示</li>
            </ol>
          </div>
        </div>

        <div className="card">
          <div className="card-head">
            <h2>快捷键</h2>
          </div>
          <ul className="keys">
            <li>
              <kbd>←</kbd> <kbd>→</kbd> <span>翻页</span>
            </li>
            <li>
              <kbd>空格</kbd> <span>下一页</span>
            </li>
            <li>
              <kbd>F</kbd> <span>全屏</span>
            </li>
            <li>
              <kbd>T</kbd> <span>切换主题</span>
            </li>
            <li>
              <kbd>N</kbd> <span>演讲备注</span>
            </li>
            <li>
              <kbd>Esc</kbd> <span>退出演示</span>
            </li>
          </ul>
        </div>
      </aside>
    </div>
  );
}
