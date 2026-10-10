import { useCallback, useEffect, useState } from 'react';
import { AccessGate } from './components/AccessGate';
import { Editor } from './components/Editor';
import { ProgressView } from './components/ProgressView';
import { DeckView } from './components/DeckView';
import { PlayerOverlay } from './components/PlayerOverlay';
import { ScanModal } from './components/ScanModal';
import { TopBar } from './components/TopBar';
import { useGeneration } from './lib/useGeneration';
import { exportDeckAsHtml, exportDeckAsJson } from './lib/exportHtml';
import { exportDeckAsPptx } from './lib/exportPptx';
import type { HealthInfo } from './types';

const THEME_KEY = 'ai-ppt:theme';
const TEXT_KEY = 'ai-ppt:draft';

function readStored(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

export default function App() {
  const gen = useGeneration();
  const [text, setText] = useState(() => readStored(TEXT_KEY) ?? '');
  const [targetSlides, setTargetSlides] = useState(10);
  const [language, setLanguage] = useState<'auto' | 'zh' | 'en'>('auto');
  const [theme, setTheme] = useState(() => readStored(THEME_KEY) ?? 'midnight');
  const [health, setHealth] = useState<HealthInfo | null>(null);
  const [selected, setSelected] = useState(0);
  const [presenting, setPresenting] = useState(false);
  const [scanOpen, setScanOpen] = useState(false);
  const [pptxBusy, setPptxBusy] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [exportError, setExportError] = useState<string | null>(null);
  const [access, setAccess] = useState<{ required: boolean; ok: boolean } | null>(null);

  // --- access gate ----------------------------------------------------------
  useEffect(() => {
    let alive = true;
    fetch('/api/session')
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((data: { required: boolean; ok: boolean }) => {
        if (alive) setAccess(data);
      })
      .catch(() => {
        // If the check itself fails, do not lock the user out of the UI.
        if (alive) setAccess({ required: false, ok: true });
      });
    return () => {
      alive = false;
    };
  }, []);

  // --- health / capabilities ------------------------------------------------
  useEffect(() => {
    let alive = true;
    fetch('/api/health')
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((data: HealthInfo) => {
        if (alive) setHealth(data);
      })
      .catch(() => {
        if (alive) setHealth(null);
      });
    return () => {
      alive = false;
    };
  }, []);

  // --- persistence ----------------------------------------------------------
  useEffect(() => {
    try {
      window.localStorage.setItem(THEME_KEY, theme);
    } catch {
      /* private mode */
    }
  }, [theme]);

  useEffect(() => {
    const id = window.setTimeout(() => {
      try {
        window.localStorage.setItem(TEXT_KEY, text.slice(0, 20000));
      } catch {
        /* ignore */
      }
    }, 400);
    return () => window.clearTimeout(id);
  }, [text]);

  // --- toast ----------------------------------------------------------------
  useEffect(() => {
    if (!toast) return;
    const id = window.setTimeout(() => setToast(null), 3200);
    return () => window.clearTimeout(id);
  }, [toast]);

  useEffect(() => {
    if (gen.deck) setSelected(0);
  }, [gen.deck]);

  const handleGenerate = useCallback(() => {
    setExportError(null);
    void gen.start(text, { targetSlides, language, theme });
  }, [gen, text, targetSlides, language, theme]);

  const handleExportHtml = useCallback(() => {
    if (!gen.deck) return;
    try {
      exportDeckAsHtml(gen.deck, theme);
      setToast('已导出独立 HTML 文件，可直接离线打开演示');
      setExportError(null);
    } catch (err) {
      setExportError(`导出失败：${(err as Error).message}`);
    }
  }, [gen.deck, theme]);

  const handleExportPptx = useCallback(async () => {
    if (!gen.deck || pptxBusy) return;
    setPptxBusy(true);
    setExportError(null);
    try {
      const filename = await exportDeckAsPptx(gen.deck, theme);
      setToast(`已导出 ${filename}，可直接用 PowerPoint / WPS 打开`);
    } catch (err) {
      setExportError(`导出 PPTX 失败：${(err as Error).message}`);
    } finally {
      setPptxBusy(false);
    }
  }, [gen.deck, theme, pptxBusy]);

  const handleExportJson = useCallback(() => {
    if (!gen.deck) return;
    try {
      exportDeckAsJson(gen.deck, theme);
      setToast('已导出结构 JSON');
    } catch (err) {
      setExportError(`导出失败：${(err as Error).message}`);
    }
  }, [gen.deck, theme]);

  const handleRestart = useCallback(() => {
    gen.reset();
    setPresenting(false);
  }, [gen]);

  const stage = gen.status === 'running' ? 'progress' : gen.deck ? 'deck' : 'editor';
  const locked = Boolean(access && access.required && !access.ok) || gen.needsAccess;

  const handleSignOut = useCallback(async () => {
    await fetch('/api/session', { method: 'DELETE' }).catch(() => {});
    gen.reset();
    setAccess({ required: true, ok: false });
  }, [gen]);

  if (access === null) {
    return (
      <div className="gate">
        <div className="gate-card">
          <div className="spinner" />
          <p className="gate-sub">正在检查访问权限…</p>
        </div>
      </div>
    );
  }

  if (locked) {
    return (
      <AccessGate
        onUnlock={() => {
          gen.reset();
          setAccess({ required: true, ok: true });
        }}
      />
    );
  }

  return (
    <div className="app">
      <TopBar
        theme={theme}
        onTheme={setTheme}
        health={health}
        deck={gen.deck}
        onPresent={() => setPresenting(true)}
        onExportHtml={handleExportHtml}
        onExportPptx={handleExportPptx}
        onExportJson={handleExportJson}
        onRestart={handleRestart}
        onScan={() => setScanOpen(true)}
        pptxBusy={pptxBusy}
      />

      <main className="app-main">
        {exportError ? (
          <div className="alert alert-error" role="alert">
            <div>
              <b>导出失败</b>
              <p>{exportError}</p>
            </div>
          </div>
        ) : null}

        {stage === 'editor' ? (
          <Editor
            text={text}
            onText={setText}
            targetSlides={targetSlides}
            onTargetSlides={setTargetSlides}
            language={language}
            onLanguage={setLanguage}
            onGenerate={handleGenerate}
            health={health}
            error={gen.status === 'error' ? gen.error : null}
          />
        ) : null}

        {stage === 'progress' ? <ProgressView gen={gen} theme={theme} onCancel={gen.cancel} /> : null}

        {stage === 'deck' && gen.deck ? (
          <DeckView
            deck={gen.deck}
            theme={theme}
            selected={selected}
            onSelect={setSelected}
            onPresent={() => setPresenting(true)}
          />
        ) : null}
      </main>

      <footer className="app-foot">
        <span>
          模型 <code>{health?.model ?? 'deepseek-v4-pro'}</code> · 流式生成 · 导出文件不依赖任何网络资源
        </span>
        {access?.required ? (
          <button type="button" className="link-btn" onClick={handleSignOut}>
            退出访问
          </button>
        ) : null}
      </footer>

      {presenting && gen.deck ? (
        <PlayerOverlay
          deck={gen.deck}
          theme={theme}
          onThemeChange={setTheme}
          onClose={() => setPresenting(false)}
        />
      ) : null}

      {scanOpen ? <ScanModal onClose={() => setScanOpen(false)} /> : null}

      {toast ? (
        <div className="toast" role="status" data-testid="toast">
          {toast}
        </div>
      ) : null}
    </div>
  );
}
