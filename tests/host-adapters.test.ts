import crypto from 'node:crypto';
import { afterEach, expect, test } from 'bun:test';
import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';

const token = crypto.randomUUID();
const auth = { Authorization: `Bearer ${token}` };
const WORKSPACE_ROOT = path.resolve(import.meta.dirname, '..');
const NODE = spawnSync('node', ['-e', "require('node:fs').writeSync(1, process.execPath)"], { encoding: 'utf8' }).stdout;
const PROXY = path.join(WORKSPACE_ROOT, 'bin/stdio-proxy.mjs');
const children: ChildProcess[] = [];
const dirs: string[] = [];
const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

const canListen = await new Promise<boolean>((resolve, reject) => {
  const script = `const s = require('node:net').createServer(); const fs = require('node:fs'); s.on('error', e => { fs.writeSync(1, JSON.stringify({ code: e.code })); }); s.listen(0, '127.0.0.1', () => s.close(() => fs.writeSync(1, '{}')));`;
  const child = spawn('node', ['-e', script], { stdio: ['ignore', 'pipe', 'pipe'] });
  let output = '';
  child.stdout.on('data', chunk => { output += String(chunk); });
  child.on('error', reject);
  child.on('exit', code => {
    try {
      if (code !== 0) throw new Error(`Network probe exited ${code}`);
      const result = JSON.parse(output);
      if (!result.code) resolve(true);
      else if (result.code === 'EPERM' || result.code === 'EACCES') resolve(false);
      else throw new Error(`Unexpected listen error: ${result.code}`);
    } catch (error) { reject(error); }
  });
});
if (!canListen) console.error('[host adapters] HTTP/SSE tests skipped: sandbox denies loopback listen (EPERM/EACCES)');
const networkTest = canListen ? test : test.skip;

async function allocatePort(): Promise<number> {
  const server = net.createServer();
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const port = (server.address() as net.AddressInfo).port;
  await new Promise<void>(resolve => server.close(() => resolve()));
  return port;
}

async function stop(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) return;
  await new Promise<void>(resolve => {
    child.once('exit', () => resolve());
    child.kill('SIGTERM');
  });
}

afterEach(async () => {
  for (const child of children.splice(0)) await stop(child);
  for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

function tempHome(prefix: string): string {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  dirs.push(home);
  return home;
}

function installEnv(home: string, extra: Record<string, string> = {}): NodeJS.ProcessEnv {
  return {
    ...process.env,
    HOME: home,
    TOOLBOX_MCP_TOKEN: token,
    XDG_CONFIG_HOME: path.join(home, '.config'),
    GEMINI_CONFIG_DIR: path.join(home, '.gemini', 'config'),
    TOOLBOX_DATA_FILE: path.join(home, 'gateway-state.json'),
    TOOLBOX_LOCK_FILE: path.join(home, 'toolbox.lock.json'),
    ...extra,
  };
}

function runCli(args: string[], env: NodeJS.ProcessEnv) {
  return spawnSync(NODE, ['--import', 'tsx/esm', 'src/cli.ts', ...args], {
    cwd: WORKSPACE_ROOT,
    env,
    encoding: 'utf8',
  });
}

function stdioEntry(hostFlag: string) {
  return { command: NODE, args: [PROXY, '--host', hostFlag] };
}

test('install --host claude writes the official stdio config and keeps existing servers', () => {
  const home = tempHome('toolbox-claude-home-');
  const claudeConfig = path.join(home, '.claude.json');
  fs.writeFileSync(claudeConfig, JSON.stringify({
    mcpServers: { filesystem: { command: 'node', args: ['filesystem-server.mjs'] } },
    theme: 'dark',
  }, null, 2));
  const result = runCli(['install', '--host', 'claude'], installEnv(home));
  expect(result.status).toBe(0);
  expect(fs.existsSync(`${claudeConfig}.bak`)).toBe(true);
  const config = JSON.parse(fs.readFileSync(claudeConfig, 'utf8'));
  expect(config.theme).toBe('dark');
  expect(config.mcpServers.filesystem).toEqual({ command: 'node', args: ['filesystem-server.mjs'] });
  expect(config.mcpServers['agent-toolbox']).toEqual(stdioEntry('claude-code'));
});

test('install --host claude --transport sse writes the official SSE config and keeps existing servers', () => {
  const home = tempHome('toolbox-claude-sse-home-');
  const claudeConfig = path.join(home, '.claude.json');
  fs.writeFileSync(claudeConfig, JSON.stringify({
    mcpServers: { filesystem: { command: 'node', args: ['filesystem-server.mjs'] } },
    theme: 'dark',
  }));
  const result = runCli(['install', '--host', 'claude', '--transport', 'sse'], installEnv(home, { PORT: '3000' }));
  expect(result.status).toBe(0);
  const config = JSON.parse(fs.readFileSync(claudeConfig, 'utf8'));
  expect(config.theme).toBe('dark');
  expect(config.mcpServers.filesystem).toEqual({ command: 'node', args: ['filesystem-server.mjs'] });
  expect(config.mcpServers['agent-toolbox']).toEqual({
    type: 'sse',
    headers: auth,
    url: 'http://127.0.0.1:3000/api/mcp/sse?host=claude-code',
  });
});

test('uninstall --host claude removes only the gateway entry', () => {
  const home = tempHome('toolbox-claude-uninstall-');
  const claudeConfig = path.join(home, '.claude.json');
  fs.writeFileSync(claudeConfig, JSON.stringify({
    mcpServers: {
      filesystem: { command: 'node', args: ['filesystem-server.mjs'] },
      'agent-toolbox': { command: 'node', args: ['old'] },
    },
    theme: 'dark',
  }));
  const result = runCli(['uninstall', '--host', 'claude'], installEnv(home));
  expect(result.status).toBe(0);
  const config = JSON.parse(fs.readFileSync(claudeConfig, 'utf8'));
  expect(config.theme).toBe('dark');
  expect(config.mcpServers.filesystem).toEqual({ command: 'node', args: ['filesystem-server.mjs'] });
  expect(config.mcpServers['agent-toolbox']).toBeUndefined();
});

test('install --host antigravity writes official stdio mcp_config.json and keeps existing servers', () => {
  const home = tempHome('toolbox-agy-home-');
  const configPath = path.join(home, '.gemini', 'config', 'mcp_config.json');
  fs.mkdirSync(path.dirname(configPath), { recursive: true });
  fs.writeFileSync(configPath, JSON.stringify({
    mcpServers: { docs: { command: 'npx', args: ['docs-mcp'] } },
    theme: 'system',
  }, null, 2));
  const result = runCli(['install', '--host', 'antigravity'], installEnv(home));
  expect(result.status).toBe(0);
  expect(fs.existsSync(`${configPath}.bak`)).toBe(true);
  const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
  expect(config.theme).toBe('system');
  expect(config.mcpServers.docs).toEqual({ command: 'npx', args: ['docs-mcp'] });
  expect(config.mcpServers['agent-toolbox']).toEqual(stdioEntry('antigravity'));
});

test('install --host antigravity --transport http writes an official Streamable HTTP serverUrl', () => {
  const home = tempHome('toolbox-agy-http-');
  const configPath = path.join(home, '.gemini', 'config', 'mcp_config.json');
  const result = runCli(['install', '--host', 'antigravity', '--transport', 'http'], installEnv(home, { PORT: '4123' }));
  expect(result.status).toBe(0);
  const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
  expect(config.mcpServers['agent-toolbox']).toEqual({
    headers: auth,
    serverUrl: 'http://127.0.0.1:4123/api/mcp?host=antigravity',
  });
});

test('uninstall --host antigravity removes only the gateway entry', () => {
  const home = tempHome('toolbox-agy-uninstall-');
  const configPath = path.join(home, '.gemini', 'config', 'mcp_config.json');
  fs.mkdirSync(path.dirname(configPath), { recursive: true });
  fs.writeFileSync(configPath, JSON.stringify({
    mcpServers: {
      docs: { command: 'npx', args: ['docs-mcp'] },
      'agent-toolbox': { command: 'node', args: ['old'] },
    },
  }));
  const result = runCli(['uninstall', '--host', 'antigravity'], installEnv(home));
  expect(result.status).toBe(0);
  const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
  expect(config.mcpServers.docs).toEqual({ command: 'npx', args: ['docs-mcp'] });
  expect(config.mcpServers['agent-toolbox']).toBeUndefined();
});

test('install --host opencode writes official mcp.servers local command and keeps existing servers', () => {
  const home = tempHome('toolbox-oc-home-');
  const configPath = path.join(home, '.config', 'opencode', 'opencode.json');
  fs.mkdirSync(path.dirname(configPath), { recursive: true });
  fs.writeFileSync(configPath, JSON.stringify({
    model: 'test',
    mcp: { servers: { files: { type: 'local', command: ['npx', 'files-mcp'] } } },
  }, null, 2));
  const result = runCli(['install', '--host', 'opencode'], installEnv(home));
  expect(result.status).toBe(0);
  expect(fs.existsSync(`${configPath}.bak`)).toBe(true);
  const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
  expect(config.model).toBe('test');
  expect(config.mcp.servers.files).toEqual({ type: 'local', command: ['npx', 'files-mcp'] });
  expect(config.mcp.servers['agent-toolbox']).toEqual({
    type: 'local',
    command: [NODE, PROXY, '--host', 'opencode'],
  });
});

test('install --host opencode --transport http writes official remote Streamable HTTP config', () => {
  const home = tempHome('toolbox-oc-http-');
  const configPath = path.join(home, '.config', 'opencode', 'opencode.json');
  const result = runCli(['install', '--host', 'opencode', '--transport', 'http'], installEnv(home, { PORT: '4123' }));
  expect(result.status).toBe(0);
  const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
  expect(config.mcp.servers['agent-toolbox']).toEqual({
    type: 'remote',
    headers: auth,
    url: 'http://127.0.0.1:4123/api/mcp?host=opencode',
  });
});

test('uninstall --host opencode removes only the gateway entry', () => {
  const home = tempHome('toolbox-oc-uninstall-');
  const configPath = path.join(home, '.config', 'opencode', 'opencode.json');
  fs.mkdirSync(path.dirname(configPath), { recursive: true });
  fs.writeFileSync(configPath, JSON.stringify({
    model: 'test',
    mcp: { servers: {
      files: { type: 'local', command: ['npx', 'files-mcp'] },
      'agent-toolbox': { type: 'local', command: ['node'] },
    } },
  }));
  const result = runCli(['uninstall', '--host', 'opencode'], installEnv(home));
  expect(result.status).toBe(0);
  const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
  expect(config.model).toBe('test');
  expect(config.mcp.servers.files).toEqual({ type: 'local', command: ['npx', 'files-mcp'] });
  expect(config.mcp.servers['agent-toolbox']).toBeUndefined();
});

async function startGateway(home: string, port: number, url: string) {
  const env = installEnv(home, { PORT: String(port), TOOLBOX_GATEWAY_URL: url });
  const gateway = spawn(NODE, ['--import', 'tsx/esm', 'server.ts', '--production'], {
    cwd: WORKSPACE_ROOT, env, stdio: ['ignore', 'pipe', 'pipe'],
  });
  children.push(gateway);
  let logs = '';
  gateway.stdout?.on('data', chunk => { logs += String(chunk); });
  gateway.stderr?.on('data', chunk => { logs += String(chunk); });
  for (let attempt = 0; attempt < 120; attempt++) {
    try {
      if ((await fetch(`${url}/api/v1/state`)).ok) return { env, logs: () => logs };
    } catch {}
    if (gateway.exitCode !== null) break;
    await delay(50);
  }
  throw new Error(`Gateway failed to start: ${logs}`);
}

async function hideDemo(url: string) {
  const visibility = await fetch(`${url}/api/v1/settings/visibility`, {
    method: 'PUT', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ showDemo: false, showFixtures: true }),
  });
  expect(visibility.ok).toBe(true);
}

async function rpc(url: string, id: string, method: string, params?: Record<string, unknown>, headers: Record<string, string> = auth) {
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify({ jsonrpc: '2.0', id, method, ...(params ? { params } : {}) }),
  });
  return response.json() as Promise<any>;
}

async function auditHas(gatewayUrl: string, requestId: string, host: string) {
  const state: any = await (await fetch(`${gatewayUrl}/api/v1/state`)).json();
  expect(state.data.visibility.showDemo).toBe(false);
  expect(state.data.auditLogs.some((event: any) => event.requestPayload?.id === requestId && event.host === host)).toBe(true);
  return state;
}

async function stdioCall(entry: { command: string; args: string[] }, env: NodeJS.ProcessEnv, id: string) {
  const bridge = spawn(entry.command, entry.args, { cwd: WORKSPACE_ROOT, env, stdio: ['pipe', 'pipe', 'pipe'] });
  children.push(bridge);
  let bridgeLogs = '';
  let output = '';
  bridge.stderr?.on('data', chunk => { bridgeLogs += String(chunk); });
  bridge.stdout?.on('data', chunk => { output += String(chunk); });
  const request = (requestId: string, message: Record<string, unknown>) => new Promise<any>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Timed out waiting for ${requestId}: ${output}\n${bridgeLogs}`)), 8000);
    const onData = () => {
      for (const line of output.split('\n')) {
        try {
          const parsed = JSON.parse(line);
          if (parsed.id === requestId) {
            clearTimeout(timer);
            bridge.stdout?.off('data', onData);
            resolve(parsed);
            return;
          }
        } catch {}
      }
    };
    bridge.stdout?.on('data', onData);
    onData();
    bridge.stdin?.write(`${JSON.stringify({ jsonrpc: '2.0', id: requestId, ...message })}\n`);
  });
  const listed = await request(`${id}-list`, { method: 'tools/list' });
  expect(listed.result.tools.some((tool: any) => tool.name === 'fixture__echo')).toBe(true);
  const called = await request(`${id}-call`, { method: 'tools/call', params: {
    name: 'fixture__echo', arguments: { text: `hello-from-${id}` },
  } });
  expect(JSON.parse(called.result.content[0].text).content[0].text).toBe(`hello-from-${id}`);
  return `${id}-call`;
}

networkTest('Claude Code stdio config lists and calls a real downstream with canonical audit identity', async () => {
  const home = tempHome('toolbox-claude-e2e-');
  const port = await allocatePort();
  const url = `http://127.0.0.1:${port}`;
  const { env } = await startGateway(home, port, url);
  await hideDemo(url);
  const installed = runCli(['install', '--host', 'claude'], env);
  expect(installed.status).toBe(0);
  const config = JSON.parse(fs.readFileSync(path.join(home, '.claude.json'), 'utf8'));
  const callId = await stdioCall(config.mcpServers['agent-toolbox'], env, 'claude');
  await auditHas(url, callId, 'Claude Code');
});

networkTest('Claude Code SSE config lists and calls through the written endpoint as Claude Code', async () => {
  const home = tempHome('toolbox-claude-sse-e2e-');
  const port = await allocatePort();
  const url = `http://127.0.0.1:${port}`;
  const { env } = await startGateway(home, port, url);
  await hideDemo(url);
  const installed = runCli(['install', '--host', 'claude', '--transport', 'sse'], env);
  expect(installed.status).toBe(0);
  const config = JSON.parse(fs.readFileSync(path.join(home, '.claude.json'), 'utf8'));
  expect(config.mcpServers['agent-toolbox'].type).toBe('sse');
  const sseUrl = config.mcpServers['agent-toolbox'].url as string;
  const stream = await fetch(sseUrl, { headers: { ...config.mcpServers['agent-toolbox'].headers, Accept: 'text/event-stream' } });
  expect(stream.ok).toBe(true);
  stream.body?.cancel();
  const messages = new URL('/api/mcp/messages?host=claude-code', url).toString();
  const listed = await rpc(messages, 'claude-sse-list', 'tools/list', undefined, config.mcpServers['agent-toolbox'].headers);
  expect(listed.result.tools.some((tool: any) => tool.name === 'fixture__echo')).toBe(true);
  const called = await rpc(messages, 'claude-sse-call', 'tools/call', {
    name: 'fixture__echo', arguments: { text: 'hello-from-claude-sse' },
  }, config.mcpServers['agent-toolbox'].headers);
  expect(JSON.parse(called.result.content[0].text).content[0].text).toBe('hello-from-claude-sse');
  await auditHas(url, 'claude-sse-call', 'Claude Code');
});

networkTest('Antigravity stdio and Streamable HTTP configs use the canonical audit identity', async () => {
  const home = tempHome('toolbox-agy-e2e-');
  const port = await allocatePort();
  const url = `http://127.0.0.1:${port}`;
  const { env } = await startGateway(home, port, url);
  await hideDemo(url);
  expect(runCli(['install', '--host', 'antigravity'], env).status).toBe(0);
  const stdioConfig = JSON.parse(fs.readFileSync(path.join(home, '.gemini', 'config', 'mcp_config.json'), 'utf8'));
  const stdioCallId = await stdioCall(stdioConfig.mcpServers['agent-toolbox'], env, 'agy-stdio');
  await auditHas(url, stdioCallId, 'Antigravity');

  expect(runCli(['install', '--host', 'antigravity', '--transport', 'http'], env).status).toBe(0);
  const httpConfig = JSON.parse(fs.readFileSync(path.join(home, '.gemini', 'config', 'mcp_config.json'), 'utf8'));
  const remoteUrl = httpConfig.mcpServers['agent-toolbox'].serverUrl as string;
  const listed = await rpc(remoteUrl, 'agy-http-list', 'tools/list', undefined, httpConfig.mcpServers['agent-toolbox'].headers);
  expect(listed.result.tools.some((tool: any) => tool.name === 'fixture__echo')).toBe(true);
  const called = await rpc(remoteUrl, 'agy-http-call', 'tools/call', {
    name: 'fixture__echo', arguments: { text: 'hello-from-agy-http' },
  }, httpConfig.mcpServers['agent-toolbox'].headers);
  expect(JSON.parse(called.result.content[0].text).content[0].text).toBe('hello-from-agy-http');
  await auditHas(url, 'agy-http-call', 'Antigravity');
});

networkTest('OpenCode local and remote configs use the canonical audit identity', async () => {
  const home = tempHome('toolbox-oc-e2e-');
  const port = await allocatePort();
  const url = `http://127.0.0.1:${port}`;
  const { env } = await startGateway(home, port, url);
  await hideDemo(url);
  expect(runCli(['install', '--host', 'opencode'], env).status).toBe(0);
  const local = JSON.parse(fs.readFileSync(path.join(home, '.config', 'opencode', 'opencode.json'), 'utf8')).mcp.servers['agent-toolbox'];
  expect(local.type).toBe('local');
  const [command, ...args] = local.command as string[];
  const localCallId = await stdioCall({ command, args }, env, 'oc-local');
  await auditHas(url, localCallId, 'OpenCode');

  expect(runCli(['install', '--host', 'opencode', '--transport', 'http'], env).status).toBe(0);
  const remote = JSON.parse(fs.readFileSync(path.join(home, '.config', 'opencode', 'opencode.json'), 'utf8')).mcp.servers['agent-toolbox'];
  expect(remote.type).toBe('remote');
  const listed = await rpc(remote.url, 'oc-http-list', 'tools/list', undefined, remote.headers);
  expect(listed.result.tools.some((tool: any) => tool.name === 'fixture__echo')).toBe(true);
  const called = await rpc(remote.url, 'oc-http-call', 'tools/call', {
    name: 'fixture__echo', arguments: { text: 'hello-from-oc-http' },
  }, remote.headers);
  expect(JSON.parse(called.result.content[0].text).content[0].text).toBe('hello-from-oc-http');
  await auditHas(url, 'oc-http-call', 'OpenCode');
});

networkTest('inbound aliases and header overrides map to canonical host names', async () => {
  const home = tempHome('toolbox-alias-e2e-');
  const port = await allocatePort();
  const url = `http://127.0.0.1:${port}`;
  await startGateway(home, port, url);
  await hideDemo(url);
  const cases = [
    { id: 'alias-claude-query', route: '/api/mcp?host=claude', host: 'Claude Code' },
    { id: 'alias-claude-header', route: '/api/mcp', headers: { 'x-toolbox-host': 'claude-code' }, host: 'Claude Code' },
    { id: 'alias-agy-query', route: '/api/mcp?host=antigravity', host: 'Antigravity' },
    { id: 'alias-oc-header', route: '/api/mcp', headers: { 'x-toolbox-host': 'opencode' }, host: 'OpenCode' },
  ];
  for (const item of cases) {
    const listed = await rpc(`${url}${item.route}`, `${item.id}-list`, 'tools/list', undefined, { ...auth, ...item.headers });
    expect(listed.result.tools.some((tool: any) => tool.name === 'fixture__echo')).toBe(true);
    const called = await rpc(`${url}${item.route}`, `${item.id}-call`, 'tools/call', {
      name: 'fixture__echo', arguments: { text: item.id },
    }, { ...auth, ...item.headers });
    expect(JSON.parse(called.result.content[0].text).content[0].text).toBe(item.id);
    await auditHas(url, `${item.id}-call`, item.host);
  }
});

networkTest('console snippets match the official install output for the three hosts', async () => {
  const home = tempHome('toolbox-snippets-');
  const port = await allocatePort();
  const url = `http://127.0.0.1:${port}`;
  await startGateway(home, port, url);
  const visibility = await fetch(`${url}/api/v1/settings/visibility`, {
    method: 'PUT', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ showDemo: true, showFixtures: true }),
  });
  expect(visibility.ok).toBe(true);
  const state: any = await (await fetch(`${url}/api/v1/state`)).json();
  const snippet = (id: string) => state.data.hosts.find((host: any) => host.id === id).configSnippet as string;
  for (const id of ['claude', 'antigravity', 'opencode', 'codex']) expect(snippet(id).includes(auth.Authorization)).toBe(true);
  expect(snippet('claude')).toContain('agent-toolbox install --host claude');
  expect(snippet('claude')).toContain('bin/stdio-proxy.mjs');
  expect(snippet('claude')).toContain('--host');
  expect(snippet('claude')).toContain('claude-code');
  expect(snippet('claude')).toContain('/api/mcp/sse?host=claude-code');
  expect(snippet('antigravity')).toContain('agent-toolbox install --host antigravity');
  expect(snippet('antigravity')).toContain('bin/stdio-proxy.mjs');
  expect(snippet('antigravity')).toContain('serverUrl');
  expect(snippet('antigravity')).toContain('/api/mcp?host=antigravity');
  expect(snippet('opencode')).toContain('agent-toolbox install --host opencode');
  expect(snippet('opencode')).toContain('"type": "local"');
  expect(snippet('opencode')).toContain('"type": "remote"');
  expect(snippet('opencode')).toContain('mcp');
  expect(snippet('opencode')).toContain('/api/mcp?host=opencode');
  expect(snippet('opencode')).not.toContain('"agent-toolbox": { "type": "remote"');
});

test('Codex HTTP install writes official http_headers without logging the credential', () => {
  const home = tempHome('toolbox-codex-http-');
  const env = installEnv(home, { CODEX_HOME: path.join(home, '.codex') });
  const installed = runCli(['install', '--host', 'codex', '--transport', 'http', '--target-platform', 'linux'], env);
  expect(installed.status).toBe(0);
  const config = fs.readFileSync(path.join(home, '.codex', 'config.toml'), 'utf8');
  expect(config.includes(`Authorization = "Bearer ${token}"`)).toBe(true);
  expect(installed.stdout.includes(token)).toBe(false);
});

test('Claude HTTP install and console snippet use the same official credential header', () => {
  const home = tempHome('toolbox-claude-http-');
  const env = installEnv(home);
  const installed = runCli(['install', '--host', 'claude', '--transport', 'http'], env);
  expect(installed.status).toBe(0);
  const entry = JSON.parse(fs.readFileSync(path.join(home, '.claude.json'), 'utf8')).mcpServers['agent-toolbox'];
  expect(entry.type).toBe('http');
  expect(entry.headers.Authorization === auth.Authorization).toBe(true);
  expect(installed.stdout.includes(token)).toBe(false);
});

networkTest('Claude HTTP and Codex HTTP written credentials call a real downstream', async () => {
  const home = tempHome('toolbox-http-e2e-');
  const port = await allocatePort();
  const url = `http://127.0.0.1:${port}`;
  const { env } = await startGateway(home, port, url);
  await hideDemo(url);
  env.CODEX_HOME = path.join(home, '.codex');
  for (const host of ['claude', 'codex']) {
    expect(runCli(['install', '--host', host, '--transport', 'http'], env).status).toBe(0);
    let endpoint: string;
    let headers: Record<string, string>;
    if (host === 'claude') {
      const entry = JSON.parse(fs.readFileSync(path.join(home, '.claude.json'), 'utf8')).mcpServers['agent-toolbox'];
      endpoint = entry.url;
      headers = entry.headers;
    } else {
      const toml = fs.readFileSync(path.join(home, '.codex', 'config.toml'), 'utf8');
      endpoint = JSON.parse(toml.match(/^url = (".*")$/m)![1]);
      headers = { Authorization: JSON.parse(toml.match(/Authorization = ("[^"]*")/)![1]) };
    }
    // Supply only the written headers; no fallback authentication.
    const request = async (method: string, params?: unknown) => {
      const response = await fetch(endpoint, { method: 'POST', headers: { ...headers, 'content-type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: method, method, params }) });
      expect(response.ok).toBe(true);
      return await response.json() as any;
    };
    expect((await request('tools/list')).result.tools.some((tool: any) => tool.name === 'fixture__echo')).toBe(true);
    const called = await request('tools/call', { name: 'fixture__echo', arguments: { text: 'written-config' } });
    expect(JSON.parse(called.result.content[0].text).content[0].text).toBe('written-config');
  }
});

test('generated remote credential persists privately outside state and lock files', () => {
  const home = tempHome('toolbox-generated-token-');
  const env = installEnv(home);
  delete env.TOOLBOX_MCP_TOKEN;
  const args = ['install', '--host', 'claude', '--transport', 'http'];
  const first = runCli(args, env);
  expect(first.status).toBe(0);
  const tokenFile = path.join(home, 'mcp-token');
  expect(fs.statSync(tokenFile).mode & 0o777).toBe(0o600);
  const secret = fs.readFileSync(tokenFile, 'utf8');
  expect(secret.length >= 32).toBe(true);
  expect(first.stdout.includes(secret)).toBe(false);
  const second = runCli(args, env);
  expect(second.status).toBe(0);
  expect(fs.readFileSync(tokenFile, 'utf8') === secret).toBe(true);
  const entry = JSON.parse(fs.readFileSync(path.join(home, '.claude.json'), 'utf8')).mcpServers['agent-toolbox'];
  expect(entry.headers.Authorization === `Bearer ${secret}`).toBe(true);
  for (const file of ['gateway-state.json', 'toolbox.lock.json']) {
    if (fs.existsSync(path.join(home, file))) expect(fs.readFileSync(path.join(home, file), 'utf8').includes(secret)).toBe(false);
  }
});
