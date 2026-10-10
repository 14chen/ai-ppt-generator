import { useState } from 'react';
import type { FormEvent } from 'react';
import { IconWarn } from './Icons';

interface Props {
  onUnlock: () => void;
}

/**
 * Public deployments are protected by an ACCESS_CODE so that a stranger who
 * finds the URL cannot spend the owner's model credit. The code is exchanged
 * for an HttpOnly cookie by POST /api/session.
 */
export function AccessGate({ onUnlock }: Props) {
  const [code, setCode] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!code.trim() || busy) return;
    setBusy(true);
    setError('');
    try {
      const res = await fetch('/api/session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code: code.trim() })
      });
      if (!res.ok) {
        let message = `验证失败（HTTP ${res.status}）`;
        try {
          const data = await res.json();
          message = data?.error?.message ?? message;
        } catch {
          /* not json */
        }
        throw new Error(message);
      }
      onUnlock();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="gate">
      <form className="gate-card" onSubmit={submit}>
        <span className="gate-mark">⚡</span>
        <h1>AI 网页 PPT 生成器</h1>
        <p className="gate-sub">
          这个部署开启了访问保护。请输入访问码后使用（生成会消耗部署者的模型额度，所以设置了门禁）。
        </p>

        <label className="gate-label" htmlFor="access-code">
          访问码
        </label>
        <input
          id="access-code"
          className="gate-input"
          type="password"
          value={code}
          onChange={(e) => setCode(e.target.value)}
          placeholder="请输入访问码"
          autoComplete="off"
          autoFocus
          data-testid="access-code"
        />

        {error ? (
          <div className="alert alert-error gate-alert" role="alert" data-testid="access-error">
            <IconWarn size={18} />
            <div>
              <b>无法进入</b>
              <p>{error}</p>
            </div>
          </div>
        ) : null}

        <button type="submit" className="btn btn-primary btn-lg gate-btn" disabled={busy || !code.trim()} data-testid="access-submit">
          {busy ? '验证中…' : '进入'}
        </button>

        <p className="gate-foot">访问码由部署者在 <code>.env</code> 的 <code>ACCESS_CODE</code> 中设置。</p>
      </form>
    </div>
  );
}
