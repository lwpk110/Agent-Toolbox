import { afterEach, expect, test } from 'bun:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { GatewayStore } from '../src/server/gatewayStore';
import { createMcpHandler } from '../src/server/mcpHandler';

const dirs: string[] = [];
function setup() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mcp-handler-'));
  dirs.push(dir);
  const store = new GatewayStore({ dataFile: path.join(dir, 'state.json') });
  store.updateServer('fixture', { enabled: false });
  return { store, handle: createMcpHandler(store) };
}
afterEach(async () => {
  await new Promise(r => setTimeout(r, 250));
  for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

test('negotiates initialize versions, echoes ids and handles notifications, ping and batches', async () => {
  const { handle } = setup();
  for (const version of ['2025-06-18', '2025-03-26', '2024-11-05', 'unknown']) {
    const response = await handle({ jsonrpc: '2.0', id: 'init', method: 'initialize', params: { protocolVersion: version, clientInfo: { name: 'Test Host' } } });
    expect(response.id).toBe('init');
    expect(response.result.protocolVersion).toBe(version === 'unknown' ? '2025-06-18' : version);
    expect(response.result.serverInfo.name).toBe('agent-toolbox');
  }
  expect(await handle({ jsonrpc: '2.0', method: 'notifications/initialized' })).toBe(null);
  expect(await handle({ jsonrpc: '2.0', method: 'anything' })).toBe(null);
  expect(await handle([
    { jsonrpc: '2.0', id: 0, method: 'ping' },
    { jsonrpc: '2.0', method: 'notifications/initialized' },
    { jsonrpc: '2.0', id: 'missing', method: 'missing' },
  ])).toEqual([
    { jsonrpc: '2.0', id: 0, result: {} },
    { jsonrpc: '2.0', id: 'missing', error: { code: -32601, message: 'Method not found: missing' } },
  ]);
});

test('lists real schemas and implements audited gateway meta tools without sandbox execution', async () => {
  const { store, handle } = setup();
  store.executeRpc = () => { throw new Error('sandbox must not be called'); };
  const list = await handle({ jsonrpc: '2.0', id: 2, method: 'tools/list' });
  expect(list.result.tools.filter((t: any) => t.name.startsWith('toolbox__')).length).toBe(6);
  for (const tool of list.result.tools) {
    expect(typeof tool.name).toBe('string');
    expect(tool.inputSchema.type).toBe('object');
  }
  const response = await handle({ jsonrpc: '2.0', id: 'search', method: 'tools/call', params: { name: 'toolbox__search_knowledge', arguments: { query: 'MCP' } } }, { hostName: 'Custom Host' });
  expect(response.result.content[0].type).toBe('text');
  expect(Array.isArray(JSON.parse(response.result.content[0].text).docs)).toBe(true);
  const event = store.getSnapshot().auditLogs[0];
  expect(event.host).toBe('Custom Host');
  expect(event.requestPayload.id).toBe('search');
  expect(event.responsePayload.id).toBe('search');
  expect((await handle({ jsonrpc: '2.0', id: 4, method: 'tools/call', params: { name: 'toolbox__search_knowledge', arguments: {} } })).error.code).toBe(-32602);
});


test('rejects invalid requests and params with original id, and keeps skill tools isolated to their mounting host', async () => {
  const { store, handle } = setup();
  expect((await handle(null)).error.code).toBe(-32600);
  expect((await handle([])).error.code).toBe(-32600);
  expect(await handle([{ jsonrpc: '2.0', method: 'notification' }])).toBe(null);
  expect((await handle({ jsonrpc: '2.0', id: 0, method: 'ping', params: [] })).error.code).toBe(-32602);
  expect((await handle({ jsonrpc: '2.0', id: null, method: 'ping' })).id).toBe(null);
  const response = await handle({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'toolbox__load_skill', arguments: { skillId: 'security-owasp-auditor' } } }, { hostName: 'Host A' });
  expect(response.result.content[0].type).toBe('text');
  const own = store.getMcpTools('Host A');
  const other = store.getMcpTools('Host B');
  expect(own.some(t => t.name === 'skill_owasp__scan_deps')).toBe(true);
  expect(other.some(t => t.name === 'skill_owasp__scan_deps')).toBe(false);
  const unavailable = await handle({ jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'skill_owasp__scan_deps', arguments: {} } }, { hostName: 'Host A' });
  expect(unavailable.error.code).toBe(-32006);
});

test('preserves existing configuration during stdio seed migration and respects fixture deletion across restarts', async () => {
  const { store } = setup();
  const dataFile = path.join(dirs[dirs.length - 1], 'state.json');
  store.updateHostScope('codex', 'full');
  store.updateServer('github', { commandOrUrl: '/custom/github', args: ['custom-arg'], cwd: '/tmp' });
  await new Promise(r => setTimeout(r, 250));
  const previous = JSON.parse(fs.readFileSync(dataFile, 'utf8'));
  delete previous.stdioMcpSeedVersion;
  previous.servers = previous.servers.filter((s: any) => s.id !== 'fixture');
  delete previous.servers.find((s: any) => s.id === 'github').connectOnStart;
  fs.writeFileSync(dataFile, JSON.stringify(previous));
  const migrated = new GatewayStore({ dataFile });
  expect(migrated.getSnapshot().hosts.find(h => h.id === 'codex')?.scope).toBe('full');
  expect(migrated.getSnapshot().servers.find(s => s.id === 'github')?.commandOrUrl).toBe('/custom/github');
  expect(migrated.getSnapshot().servers.find(s => s.id === 'github')?.connectOnStart).toBe(undefined);
  expect(migrated.getSnapshot().servers.some(s => s.id === 'fixture')).toBe(true);
  migrated.deleteServer('fixture');
  await new Promise(r => setTimeout(r, 250));
  const restarted = new GatewayStore({ dataFile });
  expect(restarted.getSnapshot().servers.some(s => s.id === 'fixture')).toBe(false);
  expect(restarted.getSnapshot().hosts.find(h => h.id === 'codex')?.configSnippet).toContain('serve-stdio.ts');
});
