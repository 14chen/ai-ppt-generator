import { useEffect, useRef } from 'react';
import { getPlayer } from '../lib/player';
import type { PlayerHandle } from '../lib/player';
import type { Deck } from '../types';

interface Props {
  deck: Deck;
  theme: string;
  onThemeChange: (id: string) => void;
  onClose: () => void;
}

/**
 * Fullscreen presentation overlay. The heavy lifting (rendering, keyboard,
 * touch, fullscreen, theme cycling) is done by the shared player runtime —
 * the same code that ends up inside the exported HTML file.
 */
export function PlayerOverlay({ deck, theme, onThemeChange, onClose }: Props) {
  const hostRef = useRef<HTMLDivElement>(null);
  const handleRef = useRef<PlayerHandle | null>(null);
  const closeRef = useRef(onClose);
  const themeRef = useRef(onThemeChange);

  closeRef.current = onClose;
  themeRef.current = onThemeChange;

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const handle = getPlayer().mount(host, deck, {
      theme,
      onClose: () => closeRef.current()
    });
    handleRef.current = handle;
    const offTheme = handle.on('theme', (payload: { theme: string }) => themeRef.current(payload.theme));

    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    return () => {
      offTheme();
      handle.destroy();
      handleRef.current = null;
      document.body.style.overflow = prevOverflow;
    };
    // `theme` intentionally excluded: it is applied by the effect below so that
    // changing the theme does not tear down and rebuild the player.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [deck]);

  useEffect(() => {
    handleRef.current?.setTheme(theme);
  }, [theme]);

  return (
    <div className="player-overlay" role="dialog" aria-modal="true" aria-label="演示模式" data-testid="player-overlay">
      <div ref={hostRef} className="player-host" />
      <button type="button" className="player-close" onClick={onClose} aria-label="退出演示" data-testid="player-close">
        ✕
      </button>
    </div>
  );
}
