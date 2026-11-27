import fs from 'node:fs';

const markerFile = process.argv[2];
const receivedToken = process.env.GITHUB_PERSONAL_ACCESS_TOKEN === 'github-mcp-test-token';
fs.writeFileSync(markerFile, receivedToken ? 'received-token' : 'wrong-token');
let buffer = '';
for await (const chunk of process.stdin) {
  buffer += String(chunk);
  while (buffer.includes('\n')) {
    const index = buffer.indexOf('\n');
    const line = buffer.slice(0, index);
    buffer = buffer.slice(index + 1);
    const message = JSON.parse(line);
    if (message.method === 'initialize') {
      process.stdout.write(`${JSON.stringify({ jsonrpc: '2.0', id: message.id, result: { protocolVersion: '2025-06-18', capabilities: {}, serverInfo: { name: 'vault-probe', version: '1' } } })}\n`);
    } else if (message.method === 'tools/list') {
      process.stdout.write(`${JSON.stringify({ jsonrpc: '2.0', id: message.id, result: { tools: [{ name: 'read_probe', description: 'Read-only Vault probe', inputSchema: { type: 'object', properties: {} }, annotations: { readOnlyHint: true } }] } })}\n`);
    }
  }
}
