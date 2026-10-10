/**
 * Tiny XML well-formedness checker.
 *
 * The PPTX parts must be valid XML; a mismatched tag would make PowerPoint
 * refuse the file. Node has no built-in XML parser, so this does a strict
 * stack-based scan (enough to prove well-formedness of generated parts).
 */
export function assertWellFormedXml(xml, label = 'xml') {
  const errors = [];
  const stack = [];
  let i = 0;

  while (i < xml.length) {
    const lt = xml.indexOf('<', i);
    if (lt === -1) break;
    const gt = xml.indexOf('>', lt);
    if (gt === -1) {
      errors.push('unterminated tag');
      break;
    }
    const raw = xml.slice(lt + 1, gt);
    i = gt + 1;

    if (raw.startsWith('?') || raw.startsWith('!')) {
      if (raw.startsWith('!--') && !xml.slice(lt, gt + 1).endsWith('-->')) {
        // comments are handled below by scanning to '-->'
      }
      continue;
    }
    if (raw.startsWith('/')) {
      const name = raw.slice(1).trim();
      const open = stack.pop();
      if (open !== name) errors.push(`closing </${name}> does not match <${open ?? 'nothing'}>`);
      continue;
    }
    const selfClosing = raw.endsWith('/');
    const name = raw.replace(/\/$/, '').split(/[\s]/)[0];
    if (!name) {
      errors.push('empty tag name');
      continue;
    }
    if (!selfClosing) stack.push(name);
  }

  if (stack.length) errors.push(`unclosed tags: ${stack.join(', ')}`);
  const unescapedAmp = /&(?!amp;|lt;|gt;|quot;|apos;|#\d+;|#x[0-9a-fA-F]+;)/.exec(xml);
  if (unescapedAmp) errors.push(`unescaped '&' at ${unescapedAmp.index}`);

  if (errors.length) {
    const err = new Error(`${label} is not well-formed XML: ${errors.join('; ')}`);
    err.errors = errors;
    throw err;
  }
}

/** Concatenate the text of every <a:t> run in a DrawingML part. */
export function drawingText(xml) {
  const out = [];
  for (const m of xml.matchAll(/<a:t>([\s\S]*?)<\/a:t>/g)) out.push(m[1]);
  return out.join('');
}
