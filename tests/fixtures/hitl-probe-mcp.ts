import { writeFileSync } from 'node:fs';
import { createInterface } from 'node:readline';

const lines = createInterface({ input: process.stdin });
let initialized = false;

lines.on('line', line => {
  let request: any;
  try { request = JSON.parse(line); } catch { return; }
  if (!('id' in request)) {
    if (request.method === 'notifications/initialized') initialized = true;
    return;
  }

  let result: unknown;
  let error: unknown;
  if (request.method === 'initialize') {
    result = { protocolVersion: '2025-06-18', capabilities: { tools: {} }, serverInfo: { name: 'hitl-probe', version: '1.0.0' } };
  } else if (request.method === 'tools/list') {
    result = { tools: [{
      name: 'write_marker',
      description: 'Write an observable fixture marker',
      inputSchema: { type: 'object', properties: { value: { type: 'string' } }, required: ['value'], additionalProperties: false },
      annotations: { destructiveHint: true },
    }] };
  } else if (request.method === 'tools/call' && (request.params?.name === 'write_marker' || request.params?.name === 'hitl_probe__write_marker')) {
    const marker = process.env.HITL_MARKER_FILE;
    if (typeof marker !== 'string' || typeof request.params.arguments?.value !== 'string') {
      error = { code: -32602, message: 'Expected marker path and value' };
    } else {
      writeFileSync(marker, request.params.arguments.value);
      result = { content: [{ type: 'text', text: `wrote:${request.params.arguments.value}` }] };
    }
  } else if (request.method === 'ping') {
    result = {};
  } else {
    error = { code: -32601, message: 'Method not found' };
  }

  process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: request.id, ...(error ? { error } : { result }) }) + '\n');
});
