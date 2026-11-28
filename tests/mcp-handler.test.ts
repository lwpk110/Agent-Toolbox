import { afterEach, expect, test } from 'bun:test';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { GatewayStore } from '../src/server/gatewayStore';
import { createMcpHandler } from '../src/server/mcpHandler';

const dirs: string[] = [];
function setup() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mcp-handler-'));
  dirs.push(dir);
  const store = new GatewayStore({ dataFile: path.join(dir, 'state.json'), lockFile: path.join(dir, 'lock.json') });
  // These handler tests exercise the built-in skill and stdio seed migrations.
  store.setVisibility({ showDemo: true });
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
  const meta = list.result.tools.filter((t: any) => t.name.startsWith('toolbox__')).map((t: any) => t.name);
  expect(meta).toContain('toolbox__call_tool');
  expect(meta).toContain('toolbox__remember');
  expect(meta.length).toBe(8);
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
  // Use a non-demo skill for the isolation assertion; MCP never exposes demo skills.
  (store as any).skills.find((skill: any) => skill.id === 'security-owasp-auditor').origin = 'real';
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
  expect(unavailable.error.code).toBe(-32602);
});

test('imports, executes, audits and restores a workspace skill through MCP tools/call', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mcp-skill-'));
  dirs.push(dir);
  const dataFile = path.join(dir, 'state.json');
  const lockFile = path.join(dir, 'lock.json');
  const store = new GatewayStore({ dataFile, lockFile });
  store.setVisibility({ showDemo: false });
  const skillDir = path.resolve('skills/runtime-probe');
  const skillMd = fs.readFileSync(path.join(skillDir, 'SKILL.md'), 'utf8');
  const script = fs.readFileSync(path.join(skillDir, 'scripts/probe.ts'), 'utf8');
  const imported = store.createSkill({
    id: 'runtime-probe', skillMarkdown: skillMd, sourceType: 'workspace', sourcePath: 'skills/runtime-probe',
    files: [{ path: 'SKILL.md', content: skillMd }, { path: 'scripts/probe.ts', content: script }],
  });
  expect(imported.skill?.origin).toBe('real');
  expect(imported.skill?.attachedTools.map(tool => tool.name)).toContain('skill_runtime_probe__probe');
  const handle = createMcpHandler(store);
  const name = 'skill_runtime_probe__probe';
  const request = (id: string, token: string) => handle({ jsonrpc: '2.0', id, method: 'tools/call', params: { name, arguments: { token } } }, { hostName: 'Codex CLI' });
  expect((await handle({ jsonrpc: '2.0', id: 'list-before', method: 'tools/list' }, { hostName: 'Codex CLI' })).result.tools.some((tool: any) => tool.name === name)).toBe(false);
  expect((await request('unmounted', 'not-a-secret-token')).error.code).toBe(-32602);
  store.mountSkill('runtime-probe', 'Other Host');
  expect((await handle({ jsonrpc: '2.0', id: 'other-host-list', method: 'tools/list' }, { hostName: 'Codex CLI' })).result.tools.some((tool: any) => tool.name === name)).toBe(false);
  expect((await request('wrong-host', 'not-a-secret-token')).error.code).toBe(-32602);
  store.mountSkill('runtime-probe', 'Codex CLI');
  const list = await handle({ jsonrpc: '2.0', id: 'list-after', method: 'tools/list' }, { hostName: 'Codex CLI' });
  expect(list.result.tools.some((tool: any) => tool.name === name)).toBe(true);
  expect(list.result.tools.some((tool: any) => tool.name.startsWith('skill_owasp__'))).toBe(false);
  const token = `probe-${crypto.randomUUID()}`;
  const called = await request('real-call', token);
  const output = JSON.parse(called.result.content[0].text);
  expect(output).toEqual({ ok: true, marker: 'AGENT_TOOLBOX_SKILL_PROBE_OK', token });
  const event = store.getSnapshot().auditLogs.find(item => item.requestPayload.id === 'real-call');
  expect(event?.host).toBe('Codex CLI');
  expect(event?.origin).toBe('real');
  expect(event?.outcome).toBe('ok');
  await new Promise(resolve => setTimeout(resolve, 300));
  const restarted = new GatewayStore({ dataFile, lockFile });
  restarted.setVisibility({ showDemo: false });
  expect(restarted.getSnapshot().skills.find(skill => skill.id === 'runtime-probe')?.mounted).toBe(true);
  const restartedCall = await createMcpHandler(restarted)({
    jsonrpc: '2.0', id: 'after-restart', method: 'tools/call', params: { name, arguments: { token: `${token}-restart` } },
  }, { hostName: 'Codex CLI' });
  expect(JSON.parse(restartedCall.result.content[0].text).token).toBe(`${token}-restart`);
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

test('real Markdown search through MCP survives persistence with demo data hidden', async () => {
  const { store, handle } = setup();
  store.setVisibility({ showDemo: false, showFixtures: false });
  const marker = `KB_E2E_${crypto.randomUUID().replaceAll('-', '')}`;
  const doc = store.addKnowledgeDoc('acceptance/knowledge-probe.md', `# 知识库验收探针\n\n现场导入的 Markdown 正文：${marker}`, 'upload');
  expect(doc.origin).toBe('real');
  expect(store.getSnapshot().docs.find(item => item.id === doc.id)?.content).toContain(marker);
  const search = async (handler: ReturnType<typeof createMcpHandler>, query: string) => {
    const response = await handler({ jsonrpc: '2.0', id: query, method: 'tools/call', params: {
      name: 'toolbox__search_knowledge', arguments: { query },
    } }, { hostName: 'Codex CLI' });
    expect(response.error).toBeUndefined();
    return JSON.parse(response.result.content[0].text);
  };
  const assertHit = (result: any) => {
    expect(result.docs.map((hit: any) => hit.docId)).toContain(doc.id);
    expect(result.docs.find((hit: any) => hit.docId === doc.id).filePath).toBe(doc.filePath);
    expect(result.docs.find((hit: any) => hit.docId === doc.id).excerpt).toContain(marker);
  };
  assertHit(await search(handle, marker));
  expect(await search(handle, `UNRELATED_${crypto.randomUUID().replaceAll('-', '')}`)).toMatchObject({ docs: [], memories: [], routing: [] });
  // A query known to match seeds must also stay empty when demo data is hidden.
  expect(await search(handle, 'MCP')).toMatchObject({ docs: [], memories: [], routing: [] });
  expect(store.getSnapshot().auditLogs.find(event => event.requestPayload.id === marker)).toMatchObject({ host: 'Codex CLI', origin: 'real', outcome: 'ok' });
  await new Promise(resolve => setTimeout(resolve, 300));
  const dir = dirs[dirs.length - 1];
  const restarted = new GatewayStore({ dataFile: path.join(dir, 'state.json'), lockFile: path.join(dir, 'lock.json') });
  expect(restarted.getVisibility()).toEqual({ showDemo: false, showFixtures: false });
  expect(restarted.getSnapshot().docs.find(item => item.id === doc.id)).toMatchObject({ origin: 'real', sourceType: 'upload', content: doc.content });
  assertHit(await search(createMcpHandler(restarted), marker));
});

test('search applies independent demo and fixture visibility to documents, memories and recommendations', async () => {
  const { store } = setup();
  const visible = store.searchKnowledge('MCP');
  expect(visible.docs.length).toBeGreaterThan(0);
  expect(visible.memories.length).toBeGreaterThan(0);
  expect(visible.routing.length).toBeGreaterThan(0);
  store.setVisibility({ showDemo: false, showFixtures: true });
  expect(store.searchKnowledge('MCP')).toMatchObject({ docs: [], memories: [], routing: [] });
  await new Promise(resolve => setTimeout(resolve, 300));
  const dir = dirs[dirs.length - 1];
  const dataFile = path.join(dir, 'state.json');
  const saved = JSON.parse(fs.readFileSync(dataFile, 'utf8'));
  // Load fixture-origin records through the normal persistence loader.
  for (const collection of [saved.docs, saved.memories, saved.skills]) {
    for (const record of collection) { record.origin = 'fixture'; record.id = `fixture-${record.id}`; }
  }
  fs.writeFileSync(dataFile, JSON.stringify(saved));
  const fixtures = new GatewayStore({ dataFile, lockFile: path.join(dir, 'lock.json') });
  const shown = fixtures.searchKnowledge('MCP');
  expect(shown.docs.length).toBeGreaterThan(0);
  expect(shown.memories.length).toBeGreaterThan(0);
  expect(shown.routing.length).toBeGreaterThan(0);
  fixtures.setVisibility({ showDemo: true, showFixtures: false });
  expect(fixtures.searchKnowledge('MCP')).toMatchObject({ docs: [], memories: [], routing: [] });
});
