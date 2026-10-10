import { safeFileName, downloadBlob } from './exportHtml';
import type { Deck } from '../types';

/**
 * .pptx is generated server-side (real Office Open XML via pptxgenjs) so that
 * the web app and the WeChat mini program produce byte-identical files from the
 * same endpoint. Returns the suggested file name.
 */
export async function exportDeckAsPptx(deck: Deck, themeId: string): Promise<string> {
  let res: Response;
  try {
    res = await fetch('/api/export/pptx', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ deck, theme: themeId })
    });
  } catch (err) {
    throw new Error(`无法连接导出服务：${(err as Error).message}`);
  }

  if (!res.ok) {
    let message = `导出失败（HTTP ${res.status}）`;
    try {
      const data = await res.json();
      message = data?.error?.message ?? message;
    } catch {
      /* not JSON */
    }
    throw new Error(message);
  }

  const blob = await res.blob();
  if (!blob.size) throw new Error('导出服务返回了空文件');

  const disposition = res.headers.get('content-disposition') ?? '';
  const utf8 = disposition.match(/filename\*=UTF-8''([^;]+)/i);
  const plain = disposition.match(/filename="([^"]+)"/i);
  const filename = utf8
    ? decodeURIComponent(utf8[1])
    : plain
      ? plain[1]
      : safeFileName(deck.title, 'pptx');

  downloadBlob(blob, filename);
  return filename;
}
