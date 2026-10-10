import { useEffect, useRef, useState } from 'react';
import { ThemePicker } from './ThemePicker';
import { IconDownload, IconExpand, IconPpt, IconQr, IconRefresh } from './Icons';
import type { Deck, HealthInfo } from '../types';

interface Props {
  theme: string;
  onTheme: (id: string) => void;
  health: HealthInfo | null;
  deck: Deck | null;
  onPresent: () => void;
  onExportHtml: () => void;
  onExportPptx: () => void;
  onExportJson: () => void;
  onRestart: () => void;
  onScan: () => void;
  busy?: boolean;
  pptxBusy?: boolean;
}

export function TopBar({
  theme,
  onTheme,
  health,
  deck,
  onPresent,
  onExportHtml,
  onExportPptx,
  onExportJson,
  onRestart,
  onScan,
  busy,
  pptxBusy
}: Props) {
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!menuOpen) return;
    const onDoc = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [menuOpen]);

  return (
    <header className="topbar">
      <div className="topbar-brand">
        <span className="brand-mark">
          <IconPpt size={20} />
        </span>
        <span className="brand-text">
          <b>AI 网页 PPT 生成器</b>
          <small>文案 → 流式生成 → 可演示 / 可导出</small>
        </span>
      </div>

      <div className="topbar-mid">
        <ThemePicker value={theme} onChange={onTheme} compact />
      </div>

      <div className="topbar-actions">
        {health ? (
          <span className={`model-badge${health.hasApiKey ? '' : ' is-bad'}`} title={`${health.baseUrl} · effort=${health.effort}`}>
            <i className={health.hasApiKey ? 'dot ok' : 'dot bad'} />
            {health.model}
          </span>
        ) : null}

        <button type="button" className="btn btn-ghost" onClick={onScan} title="扫码在手机上使用" data-testid="scan-open">
          <IconQr size={16} />
          <span className="hide-sm">扫码使用</span>
        </button>

        {deck ? (
          <>
            <button type="button" className="btn btn-ghost" onClick={onRestart} title="重新输入文案">
              <IconRefresh size={16} />
              <span className="hide-sm">重新生成</span>
            </button>
            <div className="menu" ref={menuRef}>
              <button
                type="button"
                className="btn btn-ghost"
                onClick={() => setMenuOpen((v) => !v)}
                aria-expanded={menuOpen}
                aria-haspopup="menu"
                data-testid="export-menu"
                disabled={busy}
              >
                <IconDownload size={16} />
                <span className="hide-sm">导出</span>
              </button>
              {menuOpen ? (
                <div className="menu-pop" role="menu">
                  <button
                    type="button"
                    role="menuitem"
                    data-testid="export-pptx"
                    disabled={pptxBusy}
                    onClick={() => {
                      setMenuOpen(false);
                      onExportPptx();
                    }}
                  >
                    <b>{pptxBusy ? '正在生成 PPTX…' : '导出 PowerPoint (.pptx)'}</b>
                    <small>真正的 Office 文件，可直接编辑/放映</small>
                  </button>
                  <button
                    type="button"
                    role="menuitem"
                    data-testid="export-html"
                    onClick={() => {
                      setMenuOpen(false);
                      onExportHtml();
                    }}
                  >
                    <b>导出独立 HTML</b>
                    <small>单文件，含主题与翻页脚本，可离线打开</small>
                  </button>
                  <button
                    type="button"
                    role="menuitem"
                    data-testid="export-json"
                    onClick={() => {
                      setMenuOpen(false);
                      onExportJson();
                    }}
                  >
                    <b>导出结构 JSON</b>
                    <small>仅数据，便于二次加工</small>
                  </button>
                </div>
              ) : null}
            </div>
            <button type="button" className="btn btn-primary" onClick={onPresent} data-testid="present">
              <IconExpand size={16} />
              开始演示
            </button>
          </>
        ) : null}
      </div>
    </header>
  );
}
