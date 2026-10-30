// A stand-in language server for proxy tests: it answers every request with
// its method name and ignores anything that is not a JSON request.
'use strict';

let buffer = Buffer.alloc(0);
process.stdin.on('data', chunk => {
  buffer = Buffer.concat([buffer, chunk]);
  for (;;) {
    const headerEnd = buffer.indexOf('\r\n\r\n');
    if (headerEnd < 0) return;
    const length = Number(/content-length:\s*(\d+)/i.exec(buffer.subarray(0, headerEnd).toString('ascii'))?.[1] ?? 0);
    const end = headerEnd + 4 + length;
    if (buffer.length < end) return;
    let message;
    try {
      message = JSON.parse(buffer.subarray(headerEnd + 4, end).toString('utf8'));
    } catch {}
    buffer = buffer.subarray(end);
    if (message?.id === undefined) continue;
    const body = Buffer.from(JSON.stringify({jsonrpc: '2.0', id: message.id, result: message.method}));
    process.stdout.write(Buffer.concat([Buffer.from(`Content-Length: ${body.length}\r\n\r\n`), body]));
  }
});
process.stdin.on('end', () => process.exit(0));
