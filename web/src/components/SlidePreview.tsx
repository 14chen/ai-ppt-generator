import { useEffect, useRef } from 'react';
import { getPlayer } from '../lib/player';
import type { Slide } from '../types';

interface Props {
  slide: Slide;
  index: number;
  total: number;
  deckTitle: string;
  themeId: string;
  className?: string;
  active?: boolean;
}

/**
 * Renders one slide at the fixed 1280x720 design size and scales it down to the
 * container width. Uses the exact same runtime renderer as the player/export,
 * so the thumbnail is a faithful preview.
 */
export function SlidePreview({ slide, index, total, deckTitle, themeId, className, active = true }: Props) {
  const boxRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLDivElement>(null);

  let html = '';
  try {
    html = getPlayer().slideHTML(slide, { index, deckTitle, active });
  } catch {
    html = '';
  }

  useEffect(() => {
    const box = boxRef.current;
    const canvas = canvasRef.current;
    if (!box || !canvas) return;
    const apply = () => {
      const w = box.clientWidth || 320;
      canvas.style.setProperty('--ppt-scale', String(w / 1280));
    };
    apply();
    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(apply);
    ro.observe(box);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    const box = boxRef.current;
    if (box) getPlayer().applyTheme(box, themeId);
  }, [themeId]);

  return (
    <div
      ref={boxRef}
      className={`slide-thumb${className ? ` ${className}` : ''}`}
      data-testid="slide-thumb"
      data-layout={slide.layout}
    >
      <div
        ref={canvasRef}
        className="ppt-canvas slide-thumb-canvas"
        dangerouslySetInnerHTML={{ __html: html }}
      />
      <span className="slide-thumb-badge">{index + 1}</span>
      <span className="slide-thumb-layout">{layoutLabel(slide.layout)}</span>
      <span className="sr-only">{`第 ${index + 1} 页，共 ${total} 页`}</span>
    </div>
  );
}

export function layoutLabel(layout: string): string {
  const map: Record<string, string> = {
    cover: '封面',
    section: '章节',
    bullets: '要点',
    'two-column': '两栏',
    stats: '数据',
    quote: '金句',
    timeline: '流程',
    closing: '结尾'
  };
  return map[layout] ?? layout;
}
