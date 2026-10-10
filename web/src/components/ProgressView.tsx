import { useEffect, useRef, useState } from 'react';
import { SlidePreview } from './SlidePreview';
import { IconClose, IconSparkles } from './Icons';
import type { Generation } from '../lib/useGeneration';

interface Props {
  gen: Generation;
  theme: string;
  onCancel: () => void;
}

function formatMs(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 60) return `${s}s`;
  return `${Math.floor(s / 60)}m${String(s % 60).padStart(2, '0')}s`;
}

export function ProgressView({ gen, theme, onCancel }: Props) {
  const [showRaw, setShowRaw] = useState(false);
  const rawRef = useRef<HTMLPreElement>(null);
  const [tab, setTab] = useState<'reasoning' | 'output'>('reasoning');

  useEffect(() => {
    if (!showRaw) return;
    const el = rawRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [gen.reasoning, gen.raw, showRaw, tab]);

  const total = gen.meta?.slideCount ?? gen.progress.total;
  const title = gen.meta?.title ?? '正在规划演示结构…';

  return (
    <div className="progress-view" data-testid="progress-view">
      <section className="card progress-main">
        <div className="progress-head">
          <div>
            <span className="eyebrow">
              <IconSparkles size={14} /> 正在生成
            </span>
            <h2 data-testid="progress-title">{title}</h2>
          </div>
          <button type="button" className="btn btn-ghost btn-sm" onClick={onCancel} data-testid="cancel">
            <IconClose size={16} />
            取消
          </button>
        </div>

        <div className="progress-bar" role="progressbar" aria-valuenow={gen.percent} aria-valuemin={0} aria-valuemax={100}>
          <i style={{ width: `${gen.percent}%` }} data-testid="progress-fill" />
        </div>

        <ul className="stage-list" data-testid="stage-log">
          {gen.logs.map((log, i) => (
            <li key={`${log.at}-${i}`} className={i === gen.logs.length - 1 ? 'is-current' : ''}>
              <span className="stage-dot" />
              <span className="stage-text">{log.message}</span>
              <span className="stage-time">{(log.at - (gen.logs[0]?.at ?? log.at)) / 1000 < 0.05 ? '' : `${((log.at - (gen.logs[0]?.at ?? log.at)) / 1000).toFixed(1)}s`}</span>
            </li>
          ))}
          {gen.status === 'running' ? (
            <li className="is-live">
              <span className="stage-dot" />
              <span className="stage-text">模型正在输出…</span>
            </li>
          ) : null}
        </ul>

        <div className="stat-row">
          <div className="stat">
            <b data-testid="slide-count">{gen.slides.length}</b>
            <span>已解析页数{total ? ` / 约 ${total}` : ''}</span>
          </div>
          <div className="stat">
            <b>{formatMs(gen.elapsedMs)}</b>
            <span>已用时</span>
          </div>
          <div className="stat">
            <b>{gen.progress.contentChars.toLocaleString()}</b>
            <span>输出字符</span>
          </div>
          <div className="stat">
            <b>{gen.progress.reasoningChars.toLocaleString()}</b>
            <span>思考字符</span>
          </div>
          {gen.progress.tokens ? (
            <div className="stat">
              <b>{gen.progress.tokens.toLocaleString()}</b>
              <span>Tokens</span>
            </div>
          ) : null}
        </div>

        <div className="raw-toggle">
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => setShowRaw((v) => !v)}>
            {showRaw ? '收起模型输出' : '查看模型输出'}
          </button>
          {showRaw ? (
            <div className="raw-tabs">
              <button type="button" className={tab === 'reasoning' ? 'is-active' : ''} onClick={() => setTab('reasoning')}>
                思考过程
              </button>
              <button type="button" className={tab === 'output' ? 'is-active' : ''} onClick={() => setTab('output')}>
                原始输出 (NDJSON)
              </button>
            </div>
          ) : null}
        </div>

        {showRaw ? (
          <pre className="raw-box" ref={rawRef} data-testid="raw-output">
            {tab === 'reasoning' ? gen.reasoning || '（模型尚未输出思考内容）' : gen.raw || '（模型尚未输出正文）'}
          </pre>
        ) : null}
      </section>

      <section className="card progress-side">
        <div className="card-head">
          <h2>实时预览</h2>
          <span className="muted">每完成一页立即出现</span>
        </div>
        {gen.slides.length === 0 ? (
          <div className="live-empty">
            <div className="spinner" />
            <p>等待第一页生成…</p>
          </div>
        ) : (
          <div className="live-grid" data-testid="live-slides">
            {gen.slides.map((slide, i) => (
              <SlidePreview
                key={i}
                slide={slide}
                index={i}
                total={gen.slides.length}
                deckTitle={gen.meta?.title ?? ''}
                themeId={theme}
              />
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
