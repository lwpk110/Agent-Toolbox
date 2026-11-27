import { createReadStream, writeSync } from 'node:fs';
import { createInterface } from 'node:readline';

const mode = process.env.FAULT_MODE;
let initialized = false;
createInterface({ input: createReadStream('', { fd: 0, autoClose: false }) }).on('line', line => {
  const msg = JSON.parse(line);
  if (msg.method === 'notifications/initialized') initialized = true;
  if (!('id' in msg)) return;
  let result: unknown;
  if (msg.method === 'initialize') {
    if (mode === 'bad-handshake') result = {};
    else result = { protocolVersion: '2025-06-18', capabilities: { tools: {} }, serverInfo: { name: 'fault-fixture', version: '1' } };
  } else if (msg.method === 'tools/list' && initialized) {
    result = { tools: [{ name: `fault__${mode}`, description: 'Fault fixture', inputSchema: { type: 'object', properties: {} }, annotations: { readOnlyHint: true } }] };
  } else if (msg.method === 'tools/call') {
    if (mode === 'timeout') return;
    result = { content: [{ type: 'text', text: 'tool execution failed' }], isError: true };
  }
  writeSync(1, JSON.stringify({ jsonrpc: '2.0', id: msg.id, result }) + '\n');
});
