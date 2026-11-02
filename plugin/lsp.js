// Language server protocol helpers shared by the server proxies.
'use strict';

// Splits a stream into LSP frames. A header without a length is dropped, and a
// body that is not JSON reaches the handler as undefined, so it can still be
// passed on unchanged.
function frames(stream, onMessage) {
  let buffer = Buffer.alloc(0);
  stream.on('data', chunk => {
    buffer = Buffer.concat([buffer, chunk]);
    for (;;) {
      const headerEnd = buffer.indexOf('\r\n\r\n');
      if (headerEnd < 0) return;
      const length = /content-length:\s*(\d+)/i.exec(buffer.subarray(0, headerEnd).toString('ascii'))?.[1];
      if (length === undefined) {
        buffer = buffer.subarray(headerEnd + 4);
        continue;
      }
      const end = headerEnd + 4 + Number(length);
      if (buffer.length < end) return;
      const frame = buffer.subarray(0, end);
      let message;
      try {
        message = JSON.parse(buffer.subarray(headerEnd + 4, end).toString('utf8'));
      } catch {
        message = undefined;
      }
      onMessage(message, frame);
      buffer = buffer.subarray(end);
    }
  });
}

function encode(message) {
  const body = Buffer.from(JSON.stringify(message), 'utf8');
  return Buffer.concat([Buffer.from(`Content-Length: ${body.length}\r\n\r\n`, 'ascii'), body]);
}

function lineStarts(text) {
  const starts = [0];
  for (let i = 0; i < text.length; i++) if (text[i] === '\n') starts.push(i + 1);
  return starts;
}

function toOffset(text, {line, character}) {
  const starts = lineStarts(text);
  return Math.min((starts[line] ?? text.length) + character, text.length);
}

function toPosition(starts, offset) {
  let line = 0;
  while (line + 1 < starts.length && starts[line + 1] <= offset) line++;
  return {line, character: offset - starts[line]};
}

function applyChanges(text, changes) {
  for (const change of changes) {
    if (!change.range) {
      text = change.text;
      continue;
    }
    text = text.slice(0, toOffset(text, change.range.start)) + change.text + text.slice(toOffset(text, change.range.end));
  }
  return text;
}

module.exports = {applyChanges, encode, frames, lineStarts, toOffset, toPosition};
