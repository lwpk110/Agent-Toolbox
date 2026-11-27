import fs from 'node:fs';
import path from 'node:path';
import { GatewayStore } from '../../src/server/gatewayStore';
import { createMcpHandler } from '../../src/server/mcpHandler';

const output = process.argv[2];
const dataFile = path.join(path.dirname(output), 'state.json');
const store = new GatewayStore({ dataFile });
store.executeRpc = () => { throw new Error('Forbidden sandbox execution'); };
const handle = createMcpHandler(store);
const context = { hostName: 'Codex CLI' };
const list = await handle({ jsonrpc: '2.0', id: 1, method: 'tools/list' }, context);
const call = (id: string, text: string) => ({ jsonrpc: '2.0', id, method: 'tools/call', params: { name: 'fixture__echo', arguments: { text } } });
const response = await handle(call('real', 'hello-from-codex'), context);
if (response.error) throw new Error(JSON.stringify(response));
const echo = JSON.parse(response.result.content[0].text);
const audit = store.getSnapshot().auditLogs[0];
process.kill(echo._meta.pid, 'SIGTERM');
await new Promise(r => setTimeout(r, 100));
const dead = await handle(call('dead', 'must-not-fake'), context);
await store.closeMcpConnections();
await new Promise(r => setTimeout(r, 300));
const restored = new GatewayStore({ dataFile });
const restoredAudit = restored.getSnapshot().auditLogs[0];
const restartedHandle = createMcpHandler(restored);
await restartedHandle({ jsonrpc: '2.0', id: 2, method: 'tools/list' }, context);
const restarted = await restartedHandle(call('again', 'after-restart'), context);
await restored.closeMcpConnections();
fs.writeFileSync(output, JSON.stringify({
  tool: list.result.tools.find((t: any) => t.name === 'fixture__echo'),
  gatewayPid: process.pid, echo, audit, dead, restoredAudit,
  restarted: JSON.parse(restarted.result.content[0].text),
}));
process.exit(0);
