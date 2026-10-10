import runtimeSource from '../player/runtime.js?raw';
import type { Slide } from '../types';

export interface PlayerTheme {
  id: string;
  label: string;
  dark: boolean;
  vars: Record<string, string>;
}

export interface PlayerHandle {
  version: string;
  next(): void;
  prev(): void;
  goTo(index: number, reason?: string): void;
  setTheme(id: string): string;
  cycleTheme(): string;
  toggleNotes(force?: boolean): boolean;
  toggleFullscreen(): boolean;
  fit(): void;
  destroy(): void;
  on(type: 'change' | 'theme' | 'end', cb: (payload: any) => void): () => void;
  off(type: string, cb: (payload: any) => void): void;
  getState(): { index: number; theme: string; notes: boolean; total: number };
  root: HTMLElement;
}

export interface PPTPlayerApi {
  VERSION: string;
  THEMES: PlayerTheme[];
  themes: Record<string, PlayerTheme>;
  getTheme(id: string): PlayerTheme;
  applyTheme(el: HTMLElement, id: string): PlayerTheme;
  esc(value: unknown): string;
  slideHTML(
    slide: Partial<Slide>,
    opts?: { index?: number; deckTitle?: string; active?: boolean }
  ): string;
  mount(root: HTMLElement, deck: unknown, options?: Record<string, unknown>): PlayerHandle;
}

declare global {
  interface Window {
    PPTPlayer?: PPTPlayerApi;
  }
}

export { runtimeSource };

let cached: PPTPlayerApi | null = null;

/**
 * The player runtime is authored as a classic script so the exported HTML can
 * inline it verbatim. Here we inject exactly that source into a <script> tag —
 * the app and the export therefore run byte-identical renderer code.
 */
export function getPlayer(): PPTPlayerApi {
  if (cached) return cached;
  if (typeof window === 'undefined') throw new Error('播放器只能在浏览器中运行');
  if (!window.PPTPlayer) {
    const el = document.createElement('script');
    el.setAttribute('data-ppt-runtime', '1');
    el.textContent = runtimeSource;
    document.head.appendChild(el);
  }
  if (!window.PPTPlayer) throw new Error('播放器运行时初始化失败');
  cached = window.PPTPlayer;
  return cached;
}

export function themeList(): PlayerTheme[] {
  try {
    return getPlayer().THEMES;
  } catch {
    return [];
  }
}
