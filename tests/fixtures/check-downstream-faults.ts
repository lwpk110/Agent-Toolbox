import fs from 'node:fs';
import path from 'node:path';
import { GatewayStore } from '../../src/server/gatewayStore';
import { createMcpHandler } from '../../src/server/mcpHandler';

const resultFile = process.argv[2];
const store = new GatewayStore({ dataFile: path.join(path.dirname(resultFile), 'state.json') });
store.updateServer('fixture', { enabled: false });
const handle = createMcpHandler(store);
for (const mode of ['bad-handshake', 'timeout', 'tool-error']) {
  store.addServer({ name: mode, protocol: 'stdio', commandOrUrl: 'node', args: ['--import', 'tsx/esm', path.resolve('tests/fixtures/fault-mcp.ts')], cwd: process.cwd(), env: { FAULT_MODE: mode }, defaultMode: 'pinned' });
}
const list = await handle({ jsonrpc: '2.0', id: 0, method: 'tools/list' });
const call = (name: string) => handle({ jsonrpc: '2.0', id: name, method: 'tools/call', params: { name, arguments: {} } });
const [timeout, toolError] = await Promise.all([call('timeout__run'), call('tool_error__run')]);
const handshake = await call('bad_handshake__run_action');
const failedHandshake = store.getSnapshot().servers.find(s => s.id === 'bad-handshake');
await store.closeMcpConnections();
fs.writeFileSync(resultFile, JSON.stringify({ list, timeout, toolError, handshake, handshakeState: failedHandshake?.state }));
process.exit(0);
