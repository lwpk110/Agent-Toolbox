import { afterEach, expect, test } from 'bun:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { GatewayStore } from '../src/server/gatewayStore';
import { createMcpHandler } from '../src/server/mcpHandler';

const directories: string[] = [];

function makeStore(showDemo = false, showFixtures = true) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'demo-visibility-'));
  directories.push(directory);
  const store = new GatewayStore({
    dataFile: path.join(directory, 'state.json'),
    lockFile: path.join(directory, 'toolbox.lock.json'),
  });
  store.setVisibility({ showDemo, showFixtures });
  return store;
}

afterEach(async () => {
  await new Promise((resolve) => setTimeout(resolve, 250));
  for (const directory of directories.splice(0)) fs.rmSync(directory, { recursive: true, force: true });
});

test('hides demo entities from the default snapshot while retaining fixture and real entries', () => {
  const store = makeStore();
  const state = store.getSnapshot();

  expect(state.visibility).toEqual({ showDemo: false, showFixtures: true });
  expect(state.servers.some((server) => server.id === 'github')).toBe(false);
  expect(state.servers.some((server) => server.id === 'fixture')).toBe(true);
  expect(state.hosts.some((host) => host.id === 'codex')).toBe(true);
  expect(state.metrics.totalTools).toBe(state.servers.reduce((sum, server) => sum + server.tools.length, 0));
  expect(store.getSnapshot().servers.some((server) => server.id === 'github')).toBe(false);

  store.setVisibility({ showDemo: true });
  expect(store.getSnapshot().servers.some((server) => server.id === 'github')).toBe(true);
  expect(store.getSnapshot().servers.find((server) => server.id === 'github')?.origin).toBe('demo');
});

test('keeps the registered real GitHub MCP server visible while hiding the demo GitHub namespace', async () => {
  const store = makeStore(false, false);
  const created = store.addServer({
    name: 'github-mcp',
    protocol: 'stdio',
    commandOrUrl: '/home/box/.local/bin/github-mcp-server',
    args: ['stdio'],
    env: { GITHUB_PERSONAL_ACCESS_TOKEN: 'vault://GITHUB_MCP_PAT' },
    secretRef: 'vault://GITHUB_MCP_PAT',
    defaultMode: 'pinned',
  });

  expect(created.server?.id).toBe('github-mcp');
  expect(created.server?.origin).toBe('real');
  expect(created.server?.connectOnStart).toBe(true);
  expect(created.server?.enabled).toBe(true);
  expect(created.server?.secretRef).toBe('vault://GITHUB_MCP_PAT');
  expect(created.server?.env).toEqual({ GITHUB_PERSONAL_ACCESS_TOKEN: 'vault://GITHUB_MCP_PAT' });
  expect(store.getSnapshot().servers.map(server => server.id)).toContain('github-mcp');
  expect(store.getSnapshot().servers.map(server => server.id)).not.toContain('github');
  const handler = createMcpHandler(store);
  const names = (await handler({ jsonrpc: '2.0', id: 'list', method: 'tools/list' })).result.tools.map((tool: { name: string }) => tool.name);
  expect(names.some((name: string) => name.startsWith('github__'))).toBe(false);
  expect(names).not.toContain('github__search_code');

  store.setVisibility({ showDemo: true, showFixtures: true });
  const visible = store.getSnapshot();
  expect(visible.servers.find(server => server.id === 'github-mcp')?.origin).toBe('real');
  expect(visible.servers.find(server => server.id === 'github')?.origin).toBe('demo');
});

test('preflight and sync manifest include only entities visible under the current settings', () => {
  const store = makeStore(false, false);
  const preflight = store.getPreflight();
  const checks = Object.fromEntries(preflight.checks.map((check) => [check.id, check]));
  const manifest = JSON.parse(preflight.manifestJson);
  const lockfile = JSON.parse(preflight.lockfileJson);

  expect(checks['vault-complete'].passed).toBe(true);
  expect(checks['no-quarantine'].passed).toBe(true);
  expect(manifest.servers.map((server: { id: string }) => server.id)).not.toContain('fixture');
  expect(manifest.servers.map((server: { id: string }) => server.id)).not.toContain('github');
  expect(Object.keys(lockfile.skills)).not.toContain('sql-query-optimizer');
  expect(store.getSnapshot().metrics.missingVaultKeys).toBe(0);
  expect(store.getSnapshot().metrics.quarantinedCount).toBe(0);
});

test('migrates every seeded skill and memory to demo origin in legacy persisted state', async () => {
  const store = makeStore(true);
  const directory = directories[directories.length - 1];
  await new Promise((resolve) => setTimeout(resolve, 250));
  const dataFile = path.join(directory, 'state.json');
  const legacy = JSON.parse(fs.readFileSync(dataFile, 'utf8'));
  for (const skill of legacy.skills) skill.origin = 'real';
  for (const memory of legacy.memories) memory.origin = 'real';
  legacy.visibility = { showDemo: false, showFixtures: true };
  fs.writeFileSync(dataFile, JSON.stringify(legacy));

  const migrated = new GatewayStore({ dataFile, lockFile: path.join(directory, 'toolbox.lock.json') });
  const state = migrated.getSnapshot();
  const visibleSkillIds = state.skills.map((skill) => skill.id);
  const visibleMemoryIds = state.memories.map((memory) => memory.id);
  for (const id of ['sql-query-optimizer', 'mcp-diagnostics-prober', 'docs-writer', 'git-release-helper']) {
    expect(visibleSkillIds).not.toContain(id);
  }
  for (const id of ['mem-1', 'mem-2', 'mem-3', 'mem-4']) {
    expect(visibleMemoryIds).not.toContain(id);
  }
});

test('hides fixture audit and quarantine records when fixtures are disabled', async () => {
  const store = makeStore(true, true);
  const directory = directories[directories.length - 1];
  await new Promise((resolve) => setTimeout(resolve, 250));
  const dataFile = path.join(directory, 'state.json');
  const persisted = JSON.parse(fs.readFileSync(dataFile, 'utf8'));
  persisted.quarantines.push({ serverId: 'fixture', toolName: 'fixture__echo', origin: 'fixture' });
  persisted.auditLogs.push({
    id: 'fixture-event',
    requestPayload: { params: { name: 'fixture__echo' } },
    origin: 'fixture',
  });
  fs.writeFileSync(dataFile, JSON.stringify(persisted));

  const restarted = new GatewayStore({ dataFile, lockFile: path.join(directory, 'toolbox.lock.json') });
  restarted.setVisibility({ showFixtures: false });
  const state = restarted.getSnapshot();
  expect(state.quarantines.some((record) => record.serverId === 'fixture')).toBe(false);
  expect(state.auditLogs.some((event) => event.id === 'fixture-event')).toBe(false);
});

test('persists visibility settings and filters MCP tools independently of display visibility', async () => {
  const store = makeStore(true, true);
  const handler = createMcpHandler(store);
  const response = await handler({ jsonrpc: '2.0', id: 1, method: 'tools/list' });
  const names = response.result.tools.map((tool: { name: string }) => tool.name);

  expect(names).not.toContain('github__search_code');
  expect(names).toContain('fixture__echo');
  store.setVisibility({ showFixtures: false });
  const fixtureHidden = await handler({ jsonrpc: '2.0', id: 2, method: 'tools/list' });
  expect(fixtureHidden.result.tools.map((tool: { name: string }) => tool.name)).not.toContain('fixture__echo');

  await new Promise((resolve) => setTimeout(resolve, 250));
  const restarted = new GatewayStore({
    dataFile: path.join(directories[directories.length - 1], 'state.json'),
    lockFile: path.join(directories[directories.length - 1], 'toolbox.lock.json'),
  });
  expect(restarted.getVisibility()).toEqual({ showDemo: true, showFixtures: false });
  expect(restarted.getSnapshot().servers.some((server) => server.id === 'github')).toBe(true);
});

test('blocks sandbox simulation while demo visibility is off', () => {
  const store = makeStore(false);
  let error = '';
  try {
    store.executeRpc({ hostName: 'codex', stepIndex: 0 });
  } catch (caught) {
    error = String(caught);
  }
  expect(error).toContain('DEMO_DISABLED');
});

test('uses environment settings only as first-run defaults', async () => {
  const previous = process.env.TOOLBOX_DEMO_DATA;
  process.env.TOOLBOX_DEMO_DATA = 'on';
  try {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'demo-visibility-env-'));
    directories.push(directory);
    const first = new GatewayStore({
      dataFile: path.join(directory, 'state.json'),
      lockFile: path.join(directory, 'toolbox.lock.json'),
    });
    expect(first.getVisibility().showDemo).toBe(true);
    first.setVisibility({ showDemo: false });
    await new Promise((resolve) => setTimeout(resolve, 250));
    const restarted = new GatewayStore({
      dataFile: path.join(directory, 'state.json'),
      lockFile: path.join(directory, 'toolbox.lock.json'),
    });
    expect(restarted.getVisibility().showDemo).toBe(false);
  } finally {
    if (previous === undefined) delete process.env.TOOLBOX_DEMO_DATA;
    else process.env.TOOLBOX_DEMO_DATA = previous;
  }
});
