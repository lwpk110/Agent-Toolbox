import { createReadStream, writeSync } from 'node:fs';
import { createInterface } from 'node:readline';

const lines = createInterface({ input: createReadStream('', { fd: 0, autoClose: false }) });
let initialized = false;
lines.on('line', (line) => {
  let msg: any;
  try { msg = JSON.parse(line); } catch { return; }
  if (!('id' in msg)) {
    if (msg.method === 'notifications/initialized') initialized = true;
    return;
  }
  let result: unknown;
  let error: unknown;
  switch (msg.method) {
    case 'initialize':
      result = { protocolVersion: '2025-06-18', capabilities: { tools: {} }, serverInfo: { name: 'fixture-echo', version: '1.0.0' } };
      break;
    case 'tools/list':
      if (!initialized) { error = { code: -32000, message: 'Initialize first' }; break; }
      result = { tools: [{ name: 'fixture__echo', description: 'Echo text from a real stdio child process', inputSchema: { type: 'object', properties: { text: { type: 'string' } }, required: ['text'], additionalProperties: false }, annotations: { readOnlyHint: true } }] };
      break;
    case 'tools/call':
      if (msg.params?.name !== 'fixture__echo' || typeof msg.params?.arguments?.text !== 'string') {
        error = { code: -32602, message: 'Expected fixture__echo with text' };
      } else {
        result = { content: [{ type: 'text', text: msg.params.arguments.text }], _meta: { pid: process.pid } };
        writeSync(2, `[fixture-echo pid=${process.pid}] tools/call text=${msg.params.arguments.text}\n`);
      }
      break;
    case 'ping': result = {}; break;
    default: error = { code: -32601, message: 'Method not found' };
  }
  writeSync(1, JSON.stringify({ jsonrpc: '2.0', id: msg.id, ...(error ? { error } : { result }) }) + '\n');
});
