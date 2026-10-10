import { useEffect } from 'react';
import { SlidePreview, layoutLabel } from './SlidePreview';
import { IconExpand, IconLeft, IconRight } from './Icons';
import type { Deck } from '../types';

interface Props {
  deck: Deck;
  theme: string;
  selected: number;
  onSelect: (index: number) => void;
  onPresent: () => void;
}

export function DeckView({ deck, theme, selected, onSelect, onPresent }: Props) {
  const total = deck.slides.length;
  const current = deck.slides[Math.min(selected, total - 1)] ?? deck.slides[0];

  // Arrow keys move the selection while browsing (the player owns the keys
  // once presenting).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && ['INPUT', 'TEXTAREA', 'SELECT'].includes(t.tagName)) return;
      if (e.key === 'ArrowRight') onSelect(Math.min(total - 1, selected + 1));
      else if (e.key === 'ArrowLeft') onSelect(Math.max(0, selected - 1));
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [selected, total, onSelect]);

  return (
    <div className="deck-view">
      <section className="card deck-focus">
        <div className="card-head">
          <h2>
            {deck.title}
            <span className="muted">
              {' '}
              · {total} 页{deck.meta?.model ? ` · ${deck.meta.model}` : ''}
              {deck.meta?.elapsedMs ? ` · ${(deck.meta.elapsedMs / 1000).toFixed(1)}s` : ''}
            </span>
          </h2>
          <div className="head-tools">
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => onSelect(Math.max(0, selected - 1))} aria-label="上一页">
              <IconLeft size={16} />
            </button>
            <span className="page-indicator" data-testid="page-indicator">
              {Math.min(selected, total - 1) + 1} / {total}
            </span>
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              onClick={() => onSelect(Math.min(total - 1, selected + 1))}
              aria-label="下一页"
            >
              <IconRight size={16} />
            </button>
            <button type="button" className="btn btn-primary btn-sm" onClick={onPresent} data-testid="present-2">
              <IconExpand size={16} />
              演示
            </button>
          </div>
        </div>

        <div className="focus-stage">
          {current ? (
            <SlidePreview
              slide={current}
              index={Math.min(selected, total - 1)}
              total={total}
              deckTitle={deck.title}
              themeId={theme}
              className="slide-thumb-lg"
            />
          ) : null}
        </div>

        <div className="focus-meta">
          <span className="badge">{layoutLabel(current?.layout ?? '')}</span>
          {current?.notes ? <p className="notes">备注：{current.notes}</p> : null}
        </div>
      </section>

      <section className="card deck-list">
        <div className="card-head">
          <h2>全部页面</h2>
          <span className="muted">点击查看 · 共 {total} 页</span>
        </div>
        <div className="deck-grid" data-testid="deck-grid">
          {deck.slides.map((slide, i) => (
            <button
              key={i}
              type="button"
              className={`deck-item${i === selected ? ' is-active' : ''}`}
              onClick={() => onSelect(i)}
              data-testid={`deck-item-${i}`}
            >
              <SlidePreview
                slide={slide}
                index={i}
                total={total}
                deckTitle={deck.title}
                themeId={theme}
              />
            </button>
          ))}
        </div>
      </section>
    </div>
  );
}
