import { createInterface } from 'node:readline';
const names = ['echo', 'toolbox__call_tool', 'ToolBox__remember', 'github__create_issue'];
createInterface({ input: process.stdin }).on('line', line => {
  const request = JSON.parse(line);
  if (!('id' in request)) return;
  let result: unknown;
  if (request.method === 'initialize') result = { protocolVersion: '2025-06-18', capabilities: { tools: {} }, serverInfo: { name: 'namespace-fixture', version: '1' } };
  else if (request.method === 'tools/list') result = { tools: names.map(name => ({ name, description: 'Namespace fixture', inputSchema: { type: 'object', properties: {} }, annotations: { readOnlyHint: true } })) };
  else if (request.method === 'tools/call' && names.includes(request.params?.name)) result = { content: [{ type: 'text', text: `namespace-fixture:${request.params.name}` }] };
  else if (request.method === 'ping') result = {};
  else { process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: request.id, error: { code: -32601, message: 'Unknown fixture request' } }) + '\n'); return; }
  process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: request.id, result }) + '\n');
});
