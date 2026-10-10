/**
 * Server-Sent Events framing, shared by the mini program.
 *
 * The backend emits `event: <name>\ndata: <json>\n\n`. Chunks arrive on
 * arbitrary boundaries, so this buffers text and only emits when a full
 * `\n\n` frame is complete — exactly the same protocol the web client speaks.
 */

function parseFrame(raw) {
  var event = 'message';
  var dataLines = [];
  var lines = raw.split('\n');
  for (var i = 0; i < lines.length; i++) {
    var line = lines[i];
    if (!line || line.charAt(0) === ':') continue; // comment / heartbeat
    if (line.indexOf('event:') === 0) event = line.slice(6).trim();
    else if (line.indexOf('data:') === 0) dataLines.push(line.slice(5).replace(/^ /, ''));
  }
  if (!dataLines.length) return null;
  var payload = null;
  try {
    payload = JSON.parse(dataLines.join('\n'));
  } catch (e) {
    return null;
  }
  return { event: event, data: payload };
}

var MAX_BUFFER = 1024 * 1024;

function createSseParser() {
  var buffer = '';

  return {
    /** @returns {Array<{event:string,data:any}>} */
    push: function (text) {
      if (!text) return [];
      buffer += text;
      if (buffer.length > MAX_BUFFER) buffer = buffer.slice(-MAX_BUFFER);
      // normalise CRLF without breaking a '\r' that is the last character seen
      buffer = buffer.replace(/\r\n/g, '\n');

      var out = [];
      var idx;
      while ((idx = buffer.indexOf('\n\n')) >= 0) {
        var frame = buffer.slice(0, idx);
        buffer = buffer.slice(idx + 2);
        var ev = parseFrame(frame);
        if (ev) out.push(ev);
      }
      return out;
    },

    /** Anything left undecoded (used by tests). */
    rest: function () {
      return buffer;
    }
  };
}

module.exports = { createSseParser: createSseParser, parseFrame: parseFrame };
