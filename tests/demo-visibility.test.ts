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
