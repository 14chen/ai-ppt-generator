import { useEffect, useState } from 'react';
import { IconClose, IconWarn } from './Icons';

interface EntryCode {
  mode: 'wxacode' | 'h5' | 'h5-fallback';
  target: string;
  url: string;
  note: string;
  hint: string;
  page: string;
  envVersion: string;
  hasWxCredentials: boolean;
  lanUrl: string;
  apiBase: string;
  image: string;
}

interface Props {
  onClose: () => void;
}

/**
 * "扫码使用" dialog.
 *
 * With WX_APPID/WX_SECRET configured the backend returns a real WeChat
 * 小程序码; otherwise it falls back to a QR of the LAN URL, which opens the
 * (already mobile-responsive) web app on the phone.
 */
export function ScanModal({ onClose }: Props) {
  const [code, setCode] = useState<EntryCode | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState('');

  useEffect(() => {
    let alive = true;
    fetch('/api/miniprogram/code')
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((data: EntryCode) => {
        if (alive) setCode(data);
      })
      .catch((err: Error) => {
        if (alive) setError(err.message);
      });
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  const copy = async (text: string, which: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(which);
      window.setTimeout(() => setCopied(''), 1600);
    } catch {
      setError('复制失败，请手动选择文本复制');
    }
  };

  return (
    <div className="modal-backdrop" onClick={onClose} data-testid="scan-modal">
      <div className="modal" role="dialog" aria-modal="true" aria-label="扫码使用" onClick={(e) => e.stopPropagation()}>
        <button type="button" className="modal-close" onClick={onClose} aria-label="关闭">
          <IconClose size={18} />
        </button>

        <h2>扫码直接使用</h2>

        {error ? (
          <div className="alert alert-error" role="alert">
            <IconWarn size={18} />
            <div>
              <b>无法获取扫码入口</b>
              <p>{error}</p>
            </div>
          </div>
        ) : null}

        {!code && !error ? <div className="scan-loading"><div className="spinner" />正在生成二维码…</div> : null}

        {code ? (
          <>
            <div className="scan-body">
              <div className="scan-qr">
                <img src={code.image} alt="扫码入口二维码" width={240} height={240} data-testid="scan-qr" />
                <span className={`scan-badge${code.mode === 'wxacode' ? ' is-wx' : ''}`}>
                  {code.mode === 'wxacode' ? '微信小程序码' : '网页版二维码'}
                </span>
              </div>
              <div className="scan-info">
                <p className="scan-note">{code.note}</p>
                {code.hint ? <p className="scan-hint">原因：{code.hint}</p> : null}
                <dl>
                  <dt>扫码地址</dt>
                  <dd>
                    <code>{code.target}</code>
                    <button type="button" className="btn btn-ghost btn-sm" onClick={() => copy(code.target, 'target')}>
                      {copied === 'target' ? '已复制' : '复制'}
                    </button>
                  </dd>
                  <dt>小程序 API 地址</dt>
                  <dd>
                    <code>{code.apiBase}</code>
                    <button type="button" className="btn btn-ghost btn-sm" onClick={() => copy(code.apiBase, 'api')}>
                      {copied === 'api' ? '已复制' : '复制'}
                    </button>
                  </dd>
                </dl>
              </div>
            </div>

            <ol className="scan-steps">
              <li>
                <b>手机扫码</b>：与电脑处于同一 Wi-Fi 时，直接扫码即可打开（当前地址 <code>{code.lanUrl}</code>）。
              </li>
              <li>
                <b>使用小程序</b>：用微信开发者工具打开仓库中的 <code>miniprogram/</code>，把
                <code> config.js</code> 里的 <code>apiBase</code> 填成上面的「小程序 API 地址」，并勾选
                「不校验合法域名」。
              </li>
              <li>
                <b>变成真正的小程序码</b>：在 <code>.env</code> 里配置 <code>WX_APPID</code> 与
                <code> WX_SECRET</code> 后重启，这里会自动换成微信小程序码。
              </li>
            </ol>
          </>
        ) : null}
      </div>
    </div>
  );
}
