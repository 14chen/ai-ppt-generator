/**
 * Incremental UTF-8 decoder.
 *
 * WeChat mini programs do not expose `TextDecoder`, and `onChunkReceived` hands
 * us raw ArrayBuffers whose multi-byte sequences can be split across chunks
 * (a Chinese character is 3 bytes), so we decode manually and carry the partial
 * sequence over to the next chunk.
 *
 * Written as CommonJS on purpose: the mini program requires it, and the Node
 * test-suite loads it through `new Function(...)` without any bundling.
 */

function createUtf8Decoder() {
  /** Bytes of an incomplete trailing sequence. */
  var pending = [];

  function seqLen(lead) {
    if (lead < 0x80) return 1;
    if ((lead & 0xe0) === 0xc0) return 2;
    if ((lead & 0xf0) === 0xe0) return 3;
    if ((lead & 0xf8) === 0xf0) return 4;
    return 1; // invalid lead — emit as-is, never stall the stream
  }

  return {
    /** @param {ArrayBuffer|Uint8Array|number[]} chunk */
    decode: function (chunk) {
      var bytes;
      if (chunk instanceof Uint8Array) bytes = chunk;
      else if (chunk instanceof ArrayBuffer) bytes = new Uint8Array(chunk);
      else if (chunk && chunk.buffer instanceof ArrayBuffer) {
        // A typed-array VIEW from another realm: respect its window into the
        // buffer, otherwise we would read unrelated bytes.
        var offset = typeof chunk.byteOffset === 'number' ? chunk.byteOffset : 0;
        var length = typeof chunk.byteLength === 'number' ? chunk.byteLength : chunk.buffer.byteLength - offset;
        bytes = new Uint8Array(chunk.buffer, offset, length);
      } else if (Array.isArray(chunk)) bytes = new Uint8Array(chunk);
      else if (typeof chunk === 'string') return chunk;
      else return '';

      if (pending.length) {
        var merged = new Uint8Array(pending.length + bytes.length);
        merged.set(pending, 0);
        merged.set(bytes, pending.length);
        bytes = merged;
        pending = [];
      }

      var out = '';
      var i = 0;
      while (i < bytes.length) {
        var lead = bytes[i];
        var need = seqLen(lead);
        if (i + need > bytes.length) {
          // incomplete tail: keep it for the next chunk
          pending = Array.prototype.slice.call(bytes.subarray(i));
          break;
        }
        if (need === 1) {
          out += String.fromCharCode(lead);
          i += 1;
          continue;
        }
        var cp = 0;
        if (need === 2) {
          cp = ((lead & 0x1f) << 6) | (bytes[i + 1] & 0x3f);
        } else if (need === 3) {
          cp = ((lead & 0x0f) << 12) | ((bytes[i + 1] & 0x3f) << 6) | (bytes[i + 2] & 0x3f);
        } else {
          cp =
            ((lead & 0x07) << 18) |
            ((bytes[i + 1] & 0x3f) << 12) |
            ((bytes[i + 2] & 0x3f) << 6) |
            (bytes[i + 3] & 0x3f);
        }
        if (cp > 0xffff) {
          cp -= 0x10000;
          out += String.fromCharCode(0xd800 + (cp >> 10), 0xdc00 + (cp & 0x3ff));
        } else {
          out += String.fromCharCode(cp);
        }
        i += need;
      }
      return out;
    },

    /** Bytes still buffered (test hook). */
    pendingLength: function () {
      return pending.length;
    }
  };
}

module.exports = { createUtf8Decoder: createUtf8Decoder };
