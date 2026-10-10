const { API_BASE, ACCESS_CODE } = require('../config.js');
const { createUtf8Decoder } = require('./utf8.js');
const { createSseParser } = require('./sse.js');

/**
 * 访问码请求头。后端如果开启了 ACCESS_CODE 门禁，小程序没有 cookie，
 * 所以每个请求都带上 X-Access-Code。
 */
function authHeader() {
  var header = { 'content-type': 'application/json' };
  if (ACCESS_CODE) header['X-Access-Code'] = ACCESS_CODE;
  return header;
}

/** 把 401 变成一句人话。 */
function friendlyError(statusCode, raw) {
  if (statusCode === 401) {
    return ACCESS_CODE
      ? '访问码不正确：请检查 miniprogram/config.js 里的 ACCESS_CODE'
      : '后端开启了访问保护：请在 miniprogram/config.js 里填写 ACCESS_CODE';
  }
  if (statusCode === 429) {
    let msg = '请求过于频繁，请稍后再试';
    try {
      const parsed = JSON.parse(String(raw).trim());
      if (parsed && parsed.error && parsed.error.message) msg = parsed.error.message;
    } catch (e) {
      /* keep default */
    }
    return msg;
  }
  return null;
}

/** ArrayBuffer -> string (used for plain JSON error bodies). */
function bufferToString(data) {
  const decoder = createUtf8Decoder();
  return decoder.decode(data);
}

/**
 * 流式生成。
 *
 * 与网页端完全相同的 SSE 协议：后端按 `event: xxx\ndata: {json}\n\n` 推送，
 * 小程序通过 wx.request({ enableChunked: true }) + onChunkReceived 逐块接收
 * （基础库要求：enableChunked 2.20.2 / onChunkReceived 2.20.1）。
 *
 * 回调：
 *   onEvent({event, data})  每个 SSE 事件
 *   onError(Error)          网络或 HTTP 层错误
 *   onComplete()            流结束（无论成功失败都只调用一次）
 *
 * 返回 { abort() }
 */
function streamGenerate(options) {
  const { text, settings, onEvent, onError, onComplete } = options;
  const decoder = createUtf8Decoder();
  const sse = createSseParser();

  let finished = false;
  let statusCode = 0;
  let raw = '';
  let streamed = false;

  const finish = (err) => {
    if (finished) return;
    finished = true;
    if (err && onError) onError(err);
    if (onComplete) onComplete();
  };

  const consume = (chunk) => {
    let piece;
    try {
      piece = decoder.decode(chunk);
    } catch (e) {
      return;
    }
    if (!piece) return;
    raw += piece;
    if (raw.length > 400000) raw = raw.slice(-200000);
    const events = sse.push(piece);
    for (let i = 0; i < events.length; i += 1) {
      if (onEvent) onEvent(events[i]);
    }
  };

  let task;
  try {
    task = wx.request({
      url: `${API_BASE}/api/generate`,
      method: 'POST',
      header: Object.assign(authHeader(), { Accept: 'text/event-stream' }),
      data: { text, options: settings },
      enableChunked: true,
      responseType: 'text',
      timeout: 300000,
      onHeadersReceived(res) {
        if (res && res.statusCode) statusCode = res.statusCode;
      },
      success(res) {
        if (res && res.statusCode) statusCode = res.statusCode;

        // 基础库 < 2.20.1 没有 onChunkReceived：这里拿到的是完整响应体。
        if (!streamed && res && res.data) {
          if (typeof res.data === 'string') {
            const events = sse.push(res.data);
            for (let i = 0; i < events.length; i += 1) if (onEvent) onEvent(events[i]);
          } else {
            consume(res.data);
          }
        }

        if (statusCode >= 400) {
          let message = friendlyError(statusCode, raw) || `请求失败（HTTP ${statusCode}）`;
          try {
            const parsed = JSON.parse(raw.trim());
            if (parsed && parsed.error && parsed.error.message) message = parsed.error.message;
          } catch (e) {
            /* 不是 JSON，保留默认提示 */
          }
          finish(new Error(message));
          return;
        }
        finish(null);
      },
      fail(err) {
        const msg = (err && (err.errMsg || err.message)) || '网络请求失败';
        finish(new Error(msg));
      }
    });
  } catch (err) {
    finish(err instanceof Error ? err : new Error('发起请求失败'));
    return { abort() {} };
  }

  if (task && typeof task.onChunkReceived === 'function') {
    task.onChunkReceived((res) => {
      streamed = true;
      consume(res.data);
    });
  } else if (task && typeof task.onChunkReceived !== 'function') {
    // 老基础库：退化为一次性响应（没有实时进度，但功能可用）
    if (wx.showToast) {
      wx.showToast({ title: '基础库较低，进度将一次性返回', icon: 'none', duration: 2600 });
    }
  }

  return {
    abort() {
      finished = true;
      try {
        if (task && task.abort) task.abort();
      } catch (e) {
        /* ignore */
      }
    }
  };
}

/** 服务端健康检查（模型 / Key 状态）。 */
function checkHealth() {
  return new Promise((resolve) => {
    wx.request({
      url: `${API_BASE}/api/health`,
      method: 'GET',
      header: authHeader(),
      timeout: 15000,
      success(res) {
        resolve(res.statusCode === 200 ? res.data : null);
      },
      fail() {
        resolve(null);
      }
    });
  });
}

/**
 * 导出真正的 .pptx：请求服务端 -> 写入本地文件 -> 返回文件路径。
 * （小程序不能自己生成 OOXML，所以这一步走服务端，与网页端同一个接口。）
 */
function exportPptx(deck, theme) {
  return new Promise((resolve, reject) => {
    wx.request({
      url: `${API_BASE}/api/export/pptx`,
      method: 'POST',
      header: authHeader(),
      data: { deck: deck, theme: theme },
      responseType: 'arraybuffer',
      timeout: 180000,
      success(res) {
        if (res.statusCode !== 200) {
          const raw = bufferToString(res.data);
          let message = friendlyError(res.statusCode, raw) || `导出失败（HTTP ${res.statusCode}）`;
          try {
            const parsed = JSON.parse(raw.trim());
            if (parsed && parsed.error && parsed.error.message) message = parsed.error.message;
          } catch (e) {
            /* keep default */
          }
          reject(new Error(message));
          return;
        }
        const fs = wx.getFileSystemManager();
        const filePath = `${wx.env.USER_DATA_PATH}/ai-web-ppt-${Date.now()}.pptx`;
        fs.writeFile({
          filePath: filePath,
          data: res.data,
          success() {
            resolve(filePath);
          },
          fail(err) {
            reject(new Error((err && err.errMsg) || '写入文件失败'));
          }
        });
      },
      fail(err) {
        reject(new Error((err && err.errMsg) || '网络请求失败'));
      }
    });
  });
}

/** 用系统能力打开 pptx（showMenu: true 可以直接转发给好友）。 */
function openPptx(filePath) {
  return new Promise((resolve, reject) => {
    wx.openDocument({
      filePath: filePath,
      fileType: 'pptx',
      showMenu: true,
      success: resolve,
      fail(err) {
        reject(new Error((err && err.errMsg) || '打开文件失败'));
      }
    });
  });
}

module.exports = {
  streamGenerate,
  checkHealth,
  exportPptx,
  openPptx,
  bufferToString,
  API_BASE
};
