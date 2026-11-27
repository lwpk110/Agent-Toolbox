import fs from 'node:fs';
import path from 'node:path';
import { GatewayStore } from '../../src/server/gatewayStore';
import { createMcpHandler } from '../../src/server/mcpHandler';

const outputFile = process.argv[2];
const directory = path.dirname(outputFile);
const dataFile = path.join(directory, 'state.json');
const lockFile = path.join(directory, 'toolbox.lock.json');
const markerFile = path.join(directory, 'spawned');
const logs: string[] = [];
const originalError = console.error;
console.error = (...args: unknown[]) => { logs.push(args.map(String).join(' ')); };
const store = new GatewayStore({ dataFile, lockFile });
const handle = createMcpHandler(store);
const created = store.addServer({
  name: 'github-mcp', protocol: 'stdio', commandOrUrl: process.execPath,
  args: ['--import', 'tsx/esm', path.resolve('tests/fixtures/vault-probe-mcp.ts'), markerFile],
  env: { GITHUB_PERSONAL_ACCESS_TOKEN: 'vault://GITHUB_MCP_PAT' },
  secretRef: 'vault://GITHUB_MCP_PAT', defaultMode: 'pinned',
});
if (!created.server) throw new Error(created.error);
const missing = await handle({
  jsonrpc: '2.0', id: 'missing', method: 'tools/call',
  params: { name: 'github_mcp__run_action', arguments: { input: 'probe' } },
});
const missingMarker = fs.existsSync(markerFile);
store.setVaultSecret('GITHUB_MCP_PAT', 'github-mcp-test-token', 'github-mcp');
const configured = await handle({ jsonrpc: '2.0', id: 'configured', method: 'tools/list' });
await store.refreshMcpTools('github-mcp');
const serverState = store.getSnapshot().servers.find(server => server.id === 'github-mcp')?.state;
const serverTools = store.getSnapshot().servers.find(server => server.id === 'github-mcp')?.tools.map(tool => tool.name);
const lock = JSON.parse(fs.readFileSync(lockFile, 'utf8')).servers['github-mcp'];
await store.closeMcpConnections();
await new Promise(resolve => setTimeout(resolve, 350));
const stateText = fs.readFileSync(dataFile, 'utf8');
fs.writeFileSync(outputFile, JSON.stringify({
  missing, missingMarker, configured, toolNames: configured.result?.tools?.map((tool: any) => tool.name), tokenMarker: fs.existsSync(markerFile) && fs.readFileSync(markerFile, 'utf8') === 'received-token',
  savedEnv: created.server.env, savedSecretRef: created.server.secretRef, lock, stateText,
  serverState, serverTools, lockTools: Object.keys(lock?.tools || {}),
  logs,
}));
console.error = originalError;
