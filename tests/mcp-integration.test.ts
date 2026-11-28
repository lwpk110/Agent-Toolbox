import crypto from 'node:crypto';
import { afterEach, expect, test } from 'bun:test';
import { spawn, type ChildProcess } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';

// Skip only when the execution sandbox explicitly forbids listening, not on test failures.
const canListen = await new Promise<boolean>((resolve, reject) => {
  // Node preserves the OS error code; Bun's net shim currently drops it.
  const script = `const s = require('node:net').createServer(); const fs = require('node:fs'); s.on('error', e => { fs.writeSync(1, JSON.stringify({ code: e.code })); }); s.listen(0, '127.0.0.1', () => s.close(() => fs.writeSync(1, '{}')));`;
  const child = spawn('node', ['-e', script], { stdio: ['ignore', 'pipe', 'pipe'] });
  let output = '';
  child.stdout.on('data', b => { output += String(b); });
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
if (!canListen) console.error('[mcp integration] HTTP/SSE tests skipped: sandbox denies loopback listen (EPERM/EACCES)');
const networkTest = canListen ? test : test.skip;
const token = crypto.randomUUID();
const auth = { Authorization: `Bearer ${token}` };
const children: ChildProcess[] = [];
const dirs: string[] = [];
const delay = (ms: number) => new Promise(r => setTimeout(r, ms));
async function port() {
  const server = net.createServer();
  await new Promise<void>(r => server.listen(0, '127.0.0.1', r));
  const number = (server.address() as net.AddressInfo).port;
  await new Promise<void>(r => server.close(() => r()));
  return number;
}
async function stop(child: ChildProcess) {
  if (child.exitCode !== null || child.signalCode !== null) return;
  const exited = new Promise<void>(r => child.once('exit', () => r()));
  child.kill('SIGTERM');
  await exited;
}
afterEach(async () => {
  for (const child of children.splice(0)) await stop(child);
  for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});
async function gateway(extraEnv: Record<string, string> = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mcp-integration-'));
  dirs.push(dir);
  const number = await port();
  const url = `http://127.0.0.1:${number}`;
  const dataFile = path.join(dir, 'state.json');
  const lockFile = path.join(dir, 'toolbox.lock.json');
  let logs = '';
  async function start() {
    const child = spawn('node', ['--import', 'tsx/esm', 'server.ts', '--production'], { env: { ...process.env, PORT: String(number), TOOLBOX_MCP_TOKEN: token, TOOLBOX_DATA_FILE: dataFile, TOOLBOX_LOCK_FILE: lockFile, TOOLBOX_DEMO_DATA: 'off', ...extraEnv }, stdio: ['ignore', 'pipe', 'pipe'] });
    children.push(child);
    child.stdout?.on('data', b => { logs += String(b); });
    child.stderr?.on('data', b => { logs += String(b); });
    for (let i = 0; i < 100; i++) {
      try { if ((await fetch(`${url}/api/v1/state`)).ok) return child; } catch {}
      if (child.exitCode !== null) throw new Error(`Gateway exited: ${logs}`);
      await delay(30);
    }
    throw new Error(`Gateway startup timeout: ${logs}`);
  }
  const child = await start();
  const rpc = async (body: unknown, host = 'Codex CLI', route = '/api/mcp/messages') => {
    const response = await fetch(`${url}${route}`, { method: 'POST', headers: { ...auth, 'content-type': 'application/json', 'x-toolbox-host': host }, body: JSON.stringify(body) });
    return { status: response.status, text: await response.text(), headers: response.headers };
  };
  return { dir, child, start, url, rpc, logs: () => logs };
}

networkTest('unauthenticated tools/list on /api/mcp is rejected', async () => {
  const g = await gateway();
  const response = await fetch(`${g.url}/api/mcp`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 'unauthenticated', method: 'tools/list' }),
  });
  expect(response.status).toBe(401);
});

networkTest('all MCP entries reject bad credentials and non-local browser authorities', async () => {
  const g = await gateway();
  for (const [route, method] of [['/api/mcp', 'POST'], ['/api/mcp/messages', 'POST'], ['/api/mcp/sse', 'POST'], ['/api/mcp', 'GET'], ['/api/mcp/sse', 'GET']]) {
    for (const headers of [ {}, { Authorization: 'Bearer wrong' },
      { ...auth, Origin: 'https://evil.example' }, { ...auth, Origin: 'null' },
      { ...auth, Origin: 'http://localhost.evil.example' }, { ...auth, Host: 'evil.example' }]) {
      const response = await fetch(`${g.url}${route}`, { method, headers: headers as Record<string, string> });
      expect(response.status === 401 || response.status === 403).toBe(true);
    }
  }
});

async function addHitlProbe(g: Awaited<ReturnType<typeof gateway>>, marker: string) {
  const added = await fetch(`${g.url}/api/v1/servers`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      name: 'hitl-probe', protocol: 'stdio', commandOrUrl: 'node',
      args: ['--import', 'tsx/esm', path.resolve('tests/fixtures/hitl-probe-mcp.ts')],
      cwd: process.cwd(), env: { HITL_MARKER_FILE: marker }, defaultMode: 'pinned',
    }),
  });
  expect(added.ok).toBe(true);
  const scoped = await fetch(`${g.url}/api/v1/hosts/codex/scope`, {
    method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ scope: 'full' }),
  });
  expect(scoped.ok).toBe(true);
}

async function waitForHitlTicket(url: string, toolName: string, argsNeedle?: string, timeoutMs = 3000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const state: any = await (await fetch(`${url}/api/v1/state`)).json();
    const ticket = (state.data.pendingApprovals || []).find((item: any) =>
      item.toolName === toolName && item.status === 'pending' && (!argsNeedle || String(item.argsPreview).includes(argsNeedle)));
    if (ticket) return ticket;
    await delay(50);
  }
  throw new Error(`HITL ticket not visible for ${toolName}${argsNeedle ? ` (${argsNeedle})` : ''}`);
}

async function resolveHitl(url: string, id: string, decision: 'approve' | 'reject') {
  const resolved = await fetch(`${url}/api/v1/hitl/${id}/resolve`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ decision }),
  });
  expect(resolved.ok).toBe(true);
  return resolved;
}

networkTest('real HITL tools/call waits for a console decision before reaching its downstream', async () => {
  const g = await gateway();
  const marker = path.join(g.dir, 'downstream-side-effect.txt');
  await addHitlProbe(g, marker);
  const callPromise = g.rpc({
    jsonrpc: '2.0', id: 'held-call', method: 'tools/call',
    params: { name: 'hitl_probe__write_marker', arguments: { value: 'must-not-run-before-approval' } },
  }, 'Codex CLI');
  const ticket = await waitForHitlTicket(g.url, 'hitl_probe__write_marker', 'must-not-run-before-approval');
  const stillWaiting = await Promise.race([callPromise.then(() => false), delay(0).then(() => true)]);
  expect(stillWaiting).toBe(true);
  expect(fs.existsSync(marker)).toBe(false);
  expect(ticket.argsPreview).toContain('must-not-run-before-approval');
  await resolveHitl(g.url, ticket.id, 'reject');
  const response = JSON.parse((await callPromise).text);
  expect(response.error.code).toBe(-32002);
  expect(fs.existsSync(marker)).toBe(false);
});

networkTest('console approval forwards the held HITL call to the real downstream', async () => {
  const g = await gateway();
  const marker = path.join(g.dir, 'downstream-side-effect.txt');
  await addHitlProbe(g, marker);
  const callPromise = g.rpc({
    jsonrpc: '2.0', id: 'approved-call', method: 'tools/call',
    params: { name: 'hitl_probe__write_marker', arguments: { value: 'approved-value' } },
  }, 'Codex CLI');
  const ticket = await waitForHitlTicket(g.url, 'hitl_probe__write_marker', 'approved-value');
  expect(fs.existsSync(marker)).toBe(false);
  await resolveHitl(g.url, ticket.id, 'approve');
  const response = JSON.parse((await callPromise).text);
  expect(response.result.content[0].text).toContain('wrote:approved-value');
  expect(fs.readFileSync(marker, 'utf8')).toBe('approved-value');
});

networkTest('HITL timeout returns -32002 and never reaches the downstream', async () => {
  const g = await gateway({ TOOLBOX_HITL_TIMEOUT_MS: '800' });
  const marker = path.join(g.dir, 'downstream-side-effect.txt');
  await addHitlProbe(g, marker);
  const callPromise = g.rpc({
    jsonrpc: '2.0', id: 'timed-out-call', method: 'tools/call',
    params: { name: 'hitl_probe__write_marker', arguments: { value: 'must-not-run-on-timeout' } },
  }, 'Codex CLI');
  await waitForHitlTicket(g.url, 'hitl_probe__write_marker', 'must-not-run-on-timeout');
  const response = JSON.parse((await callPromise).text);
  expect(response.error.code).toBe(-32002);
  expect(fs.existsSync(marker)).toBe(false);
}, 15_000);

networkTest('a mismatched or already-resolved HITL ticket cannot release another held call', async () => {
  const g = await gateway();
  const marker = path.join(g.dir, 'downstream-side-effect.txt');
  await addHitlProbe(g, marker);
  const firstCall = g.rpc({
    jsonrpc: '2.0', id: 'first-call', method: 'tools/call',
    params: { name: 'hitl_probe__write_marker', arguments: { value: 'first-value' } },
  }, 'Codex CLI');
  const secondCall = g.rpc({
    jsonrpc: '2.0', id: 'second-call', method: 'tools/call',
    params: { name: 'hitl_probe__write_marker', arguments: { value: 'second-value' } },
  }, 'Codex CLI');
  const firstTicket = await waitForHitlTicket(g.url, 'hitl_probe__write_marker', 'first-value');
  const secondTicket = await waitForHitlTicket(g.url, 'hitl_probe__write_marker', 'second-value');
  expect(firstTicket.id === secondTicket.id).toBe(false);
  const mismatched = await fetch(`${g.url}/api/v1/hitl/${firstTicket.id}/resolve`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ decision: 'approve' }),
  });
  expect(mismatched.ok).toBe(true);
  const firstResponse = JSON.parse((await firstCall).text);
  expect(firstResponse.result.content[0].text).toContain('wrote:first-value');
  expect(fs.readFileSync(marker, 'utf8')).toBe('first-value');
  const secondStillWaiting = await Promise.race([secondCall.then(() => false), delay(50).then(() => true)]);
  expect(secondStillWaiting).toBe(true);
  const replay = await fetch(`${g.url}/api/v1/hitl/${firstTicket.id}/resolve`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ decision: 'approve' }),
  });
  expect(replay.status).toBe(404);
  expect(fs.readFileSync(marker, 'utf8')).toBe('first-value');
  await resolveHitl(g.url, secondTicket.id, 'reject');
  const secondResponse = JSON.parse((await secondCall).text);
  expect(secondResponse.error.code).toBe(-32002);
  expect(fs.readFileSync(marker, 'utf8')).toBe('first-value');
});

networkTest('HITL-disabled tools still execute immediately without a console ticket', async () => {
  const g = await gateway();
  const marker = path.join(g.dir, 'downstream-side-effect.txt');
  await addHitlProbe(g, marker);
  const disabled = await fetch(`${g.url}/api/v1/middleware/hitl`, {
    method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ enabled: false }),
  });
  expect(disabled.ok).toBe(true);
  const response = JSON.parse((await g.rpc({
    jsonrpc: '2.0', id: 'direct-call', method: 'tools/call',
    params: { name: 'hitl_probe__write_marker', arguments: { value: 'no-ticket-needed' } },
  }, 'Codex CLI')).text);
  expect(response.result.content[0].text).toContain('wrote:no-ticket-needed');
  expect(fs.readFileSync(marker, 'utf8')).toBe('no-ticket-needed');
  const state: any = await (await fetch(`${g.url}/api/v1/state`)).json();
  expect((state.data.pendingApprovals || []).some((item: any) => item.toolName === 'hitl_probe__write_marker')).toBe(false);
});

networkTest('/api/mcp quarantines a real downstream after its schema changes', async () => {
  const g = await gateway();
  await fetch(`${g.url}/api/v1/settings/visibility`, {
    method: 'PUT', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ showFixtures: true }),
  });
  const listed = JSON.parse((await g.rpc({ jsonrpc: '2.0', id: 'list', method: 'tools/list' }, 'Codex CLI', '/api/mcp')).text);
  expect(listed.result.tools.some((tool: any) => tool.name === 'fixture__echo')).toBe(true);

  await fetch(`${g.url}/api/v1/servers/fixture`, {
    method: 'PATCH', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ env: { FIXTURE_POISON: '1' } }),
  });
  const call = JSON.parse((await g.rpc({
    jsonrpc: '2.0', id: 'rug-pull', method: 'tools/call',
    params: { name: 'fixture__echo', arguments: { text: 'must-not-forward' } },
  }, 'Codex CLI', '/api/mcp')).text);
  expect(call.error.code).toBe(-32001);
  await stop(g.child);
  await g.start();
  const afterRestart = JSON.parse((await g.rpc({
    jsonrpc: '2.0', id: 'restart-rug-pull', method: 'tools/call',
    params: { name: 'fixture__echo', arguments: { text: 'must-stay-quarantined' } },
  }, 'Codex CLI', '/api/mcp')).text);
  expect(afterRestart.error.code).toBe(-32001);
});

networkTest('codex host aliases are recorded under the canonical Codex CLI name', async () => {
  const g = await gateway();
  const listed = JSON.parse((await g.rpc({ jsonrpc: '2.0', id: 'list', method: 'tools/list' }, 'Codex CLI', '/api/mcp?host=codex')).text);
  expect(listed.result.tools.some((tool: any) => tool.name === 'fixture__echo')).toBe(true);
  const call = JSON.parse((await g.rpc({
    jsonrpc: '2.0', id: 'alias-call', method: 'tools/call',
    params: { name: 'fixture__echo', arguments: { text: 'canonical-host' } },
  }, 'Codex CLI', '/api/mcp?host=codex')).text);
  expect(JSON.parse(call.result.content[0].text).content[0].text).toBe('canonical-host');
  const messageAlias = JSON.parse((await g.rpc({
    jsonrpc: '2.0', id: 'message-alias-call', method: 'tools/call',
    params: { name: 'fixture__echo', arguments: { text: 'canonical-message-host' } },
  }, 'codex')).text);
  expect(JSON.parse(messageAlias.result.content[0].text).content[0].text).toBe('canonical-message-host');
  const imported = await fetch(`${g.url}/api/v1/skills/import-directory`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ relativeDir: 'runtime-probe' }),
  });
  expect(imported.ok).toBe(true);
  const mount = JSON.parse((await g.rpc({
    jsonrpc: '2.0', id: 'alias-mount', method: 'tools/call',
    params: { name: 'toolbox__load_skill', arguments: { skillId: 'runtime-probe' } },
  }, 'codex')).text);
  expect(mount.error).toBeUndefined();
  const outputFile = path.join(g.dir, 'stdio-alias.json');
  const child = spawn('node', ['--import', 'tsx/esm', 'tests/fixtures/check-stdio-online.ts', g.url, outputFile, 'alias', 'codex-mcp-client'], { env: { ...process.env, TOOLBOX_MCP_TOKEN: token }, stdio: ['ignore', 'pipe', 'pipe'] });
  children.push(child);
  let logs = '';
  child.stderr?.on('data', b => { logs += String(b); });
  await new Promise<void>((resolve, reject) => {
    child.on('error', reject);
    child.on('exit', code => code === 0 ? resolve() : reject(new Error(logs)));
  });
  const stdio = JSON.parse(fs.readFileSync(outputFile, 'utf8'));
  expect(stdio.initialize.result.serverInfo.name).toBe('agent-toolbox');
  expect(stdio.exitCode).toBe(0);
  const state: any = await (await fetch(`${g.url}/api/v1/state`)).json();
  expect(state.data.auditLogs.filter((event: any) => ['alias-call', 'message-alias-call', 'alias-mount', 'echo'].includes(event.requestPayload.id)).every((event: any) => event.host === 'Codex CLI')).toBe(true);
  expect(state.data.skills.find((skill: any) => skill.id === 'runtime-probe').mountedBy).toBe('Codex CLI');
});

networkTest('HTTP forwards real downstream, persists tools and audit across restart, and fails closed after disconnection', async () => {
  const g = await gateway();
  const list = JSON.parse((await g.rpc({ jsonrpc: '2.0', id: 'list', method: 'tools/list' })).text);
  expect(list.id).toBe('list');
  expect(list.result.tools.some((t: any) => t.name === 'fixture__echo')).toBe(true);
  const call = { jsonrpc: '2.0', id: 'echo', method: 'tools/call', params: { name: 'fixture__echo', arguments: { text: 'hello-from-codex' } } };
  const result = JSON.parse((await g.rpc(call)).text);
  const real = JSON.parse(result.result.content[0].text);
  expect(real.content[0].text).toBe('hello-from-codex');
  expect(real._meta.pid === process.pid).toBe(false);
  const state: any = await (await fetch(`${g.url}/api/v1/state`)).json();
  expect(state.data.auditLogs[0].host).toBe('Codex CLI');
  expect(g.logs()).toContain(`tools/call text=hello-from-codex`);
  process.kill(real._meta.pid, 'SIGTERM');
  await delay(100);
  const dead = JSON.parse((await g.rpc({ ...call, id: 'dead' })).text);
  expect(dead.id).toBe('dead');
  expect(dead.error.code).toBe(-32006);
  await stop(g.child);
  await g.start();
  const relist = JSON.parse((await g.rpc({ jsonrpc: '2.0', id: 9, method: 'tools/list' })).text);
  expect(relist.result.tools.some((t: any) => t.name === 'fixture__echo')).toBe(true);
  const again = JSON.parse((await g.rpc(call)).text);
  expect(JSON.parse(again.result.content[0].text).content[0].text).toBe('hello-from-codex');
  const restored: any = await (await fetch(`${g.url}/api/v1/state`)).json();
  expect(restored.data.auditLogs.some((e: any) => e.requestPayload.id === 'dead')).toBe(true);
});

networkTest('HTTP rejects malformed JSON and invalid params, accepts empty-body notifications and negotiates client identity', async () => {
  const g = await gateway();
  const bad = await fetch(`${g.url}/api/mcp/messages`, { method: 'POST', headers: { ...auth, 'content-type': 'application/json' }, body: '{broken' });
  expect((await bad.json() as any).error.code).toBe(-32700);
  const notice = await g.rpc({ jsonrpc: '2.0', method: 'notifications/initialized' });
  expect(notice.status).toBe(202);
  expect(notice.text).toBe('');
  const params = JSON.parse((await g.rpc({ jsonrpc: '2.0', id: 0, method: 'tools/call', params: { name: 'fixture__echo', arguments: { text: 5 } } })).text);
  expect(params.id).toBe(0);
  expect(params.error.code).toBe(-32602);
});

networkTest('HTTP initialize client identity persists through session header, and explicit host header has priority', async () => {
  const g = await gateway();
  const init = await fetch(`${g.url}/api/mcp/messages`, {
    method: 'POST', headers: { ...auth, 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', clientInfo: { name: 'Client Host' } } }),
  });
  const session = init.headers.get('mcp-session-id')!;
  expect(typeof session).toBe('string');
  const call = { jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'toolbox__search_knowledge', arguments: { query: 'MCP' } } };
  const response = await fetch(`${g.url}/api/mcp/messages`, {
    method: 'POST', headers: { ...auth, 'content-type': 'application/json', 'mcp-session-id': session }, body: JSON.stringify(call),
  });
  expect((await response.json() as any).id).toBe(2);
  let state: any = await (await fetch(`${g.url}/api/v1/state`)).json();
  expect(state.data.auditLogs[0].host).toBe('Client Host');
  await g.rpc({ ...call, id: 3 }, 'Header Host');
  state = await (await fetch(`${g.url}/api/v1/state`)).json();
  expect(state.data.auditLogs[0].host).toBe('Header Host');
});

networkTest('stdio bridge forwards initialize/notifications/list/call, preserves host and relays SSE list_changed', async () => {
  const g = await gateway();
  const messageList = JSON.parse((await g.rpc({ jsonrpc: '2.0', id: 'message-list', method: 'tools/list' }, 'Stdio Test Host')).text);
  const streamableList = JSON.parse((await g.rpc({ jsonrpc: '2.0', id: 'streamable-list', method: 'tools/list' }, 'Stdio Test Host', '/api/mcp')).text);
  expect(streamableList.result.tools).toEqual(messageList.result.tools);
  const messageCall = JSON.parse((await g.rpc({
    jsonrpc: '2.0', id: 'message-call', method: 'tools/call',
    params: { name: 'fixture__echo', arguments: { text: 'hello-from-stdio' } },
  }, 'Stdio Test Host')).text);
  const streamableCall = JSON.parse((await g.rpc({
    jsonrpc: '2.0', id: 'streamable-call', method: 'tools/call',
    params: { name: 'fixture__echo', arguments: { text: 'hello-from-stdio' } },
  }, 'Stdio Test Host', '/api/mcp')).text);
  expect(streamableCall.result).toEqual(messageCall.result);
  const resultFile = path.join(g.dir, 'stdio.json');
  const child = spawn('node', ['--import', 'tsx/esm', 'tests/fixtures/check-stdio-online.ts', g.url, resultFile, 'rug-pull'], { env: { ...process.env, TOOLBOX_MCP_TOKEN: token }, stdio: ['ignore', 'pipe', 'pipe'] });
  children.push(child);
  let logs = '';
  child.stderr?.on('data', b => { logs += String(b); });
  await new Promise<void>((resolve, reject) => {
    child.on('error', reject);
    child.on('exit', code => code === 0 ? resolve() : reject(new Error(logs)));
  });
  const result = JSON.parse(fs.readFileSync(resultFile, 'utf8'));
  expect(result.initialize.id).toBe('initialize');
  expect(result.list.result.tools.some((t: any) => t.name === 'fixture__echo')).toBe(true);
  expect(result.list.result.tools).toEqual(messageList.result.tools);
  expect(result.call.result).toEqual(messageCall.result);
  expect(result.rugPull.error.code).toBe(-32001);
  const messagesAfterRugPull = JSON.parse((await g.rpc({
    jsonrpc: '2.0', id: 'messages-rug-pull', method: 'tools/call',
    params: { name: 'fixture__echo', arguments: { text: 'must-not-forward' } },
  }, 'Stdio Test Host')).text);
  const streamableAfterRugPull = JSON.parse((await g.rpc({
    jsonrpc: '2.0', id: 'streamable-rug-pull', method: 'tools/call',
    params: { name: 'fixture__echo', arguments: { text: 'must-not-forward' } },
  }, 'Stdio Test Host', '/api/mcp')).text);
  expect(messagesAfterRugPull.error.code).toBe(-32001);
  expect(streamableAfterRugPull.error.code).toBe(-32001);
  expect(result.notification.method).toBe('notifications/tools/list_changed');
  expect(result.exitCode).toBe(0);
  const state: any = await (await fetch(`${g.url}/api/v1/state`)).json();
  expect(state.data.auditLogs.find((e: any) => e.requestPayload.id === 'echo').host).toBe('Stdio Test Host');
});

networkTest('stdio SSE parser relays fragmented CRLF events and reconnects after disconnect', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mcp-sse-'));
  dirs.push(dir);
  const output = path.join(dir, 'sse.json');
  const child = spawn('node', ['--import', 'tsx/esm', 'tests/fixtures/check-sse-reconnect.ts', output], { env: { ...process.env, TOOLBOX_MCP_TOKEN: token }, stdio: ['ignore', 'pipe', 'pipe'] });
  children.push(child);
  let logs = '';
  child.stderr?.on('data', b => { logs += String(b); });
  await new Promise<void>((resolve, reject) => {
    child.on('error', reject);
    child.on('exit', code => code === 0 ? resolve() : reject(new Error(logs)));
  });
  const result = JSON.parse(fs.readFileSync(output, 'utf8'));
  expect(result.subscriptions).toBe(2);
  expect(result.hosts).toEqual(['SSE Host', 'SSE Host']);
  expect(result.messages.map((m: any) => m.params.sequence)).toEqual([1, 2]);
  expect(result.messages.every((m: any) => m.method === 'notifications/tools/list_changed')).toBe(true);
  expect(result.exitCode).toBe(0);
});

networkTest('imports Markdown via console API and searches the same real article over MCP after gateway restart', async () => {
  const g = await gateway();
  const post = async (route: string, body: unknown, method = 'POST') => {
    const response = await fetch(`${g.url}${route}`, { method, headers: { ...auth, 'content-type': 'application/json' }, body: JSON.stringify(body) });
    expect(response.ok).toBe(true);
    return await response.json() as any;
  };
  await post('/api/v1/settings/visibility', { showDemo: false, showFixtures: false }, 'PUT');
  const marker = `KB_E2E_${crypto.randomUUID().replaceAll('-', '')}`;
  const imported = await post('/api/v1/kb/docs', {
    filePath: 'acceptance/fresh-probe.md', sourceType: 'manual',
    content: `# 知识库验收探针\n\nThis freshly authored article records the acceptance marker ${marker}.`,
  });
  const doc = imported.data.docs.find((item: any) => item.filePath === 'docs/acceptance/fresh-probe.md');
  expect(doc).toMatchObject({ origin: 'real', sourceType: 'manual' });
  const search = async (query: string) => {
    const response = JSON.parse((await g.rpc({ jsonrpc: '2.0', id: query, method: 'tools/call', params: {
      name: 'toolbox__search_knowledge', arguments: { query },
    } })).text);
    expect(response.error).toBeUndefined();
    return JSON.parse(response.result.content[0].text);
  };
  const assertHit = (result: any) => {
    const hit = result.docs.find((item: any) => item.docId === doc.id);
    expect(hit?.filePath).toBe(doc.filePath);
    expect(hit?.excerpt).toContain(marker);
  };
  assertHit(await search(marker));
  assertHit((await post('/api/v1/kb/search', { query: marker })).data);
  for (const query of [`UNRELATED_${crypto.randomUUID().replaceAll('-', '')}`, 'MCP']) {
    expect(await search(query)).toMatchObject({ docs: [], memories: [], routing: [] });
    expect((await post('/api/v1/kb/search', { query })).data).toMatchObject({ docs: [], memories: [], routing: [] });
  }
  await stop(g.child);
  await g.start();
  const state: any = await (await fetch(`${g.url}/api/v1/state`)).json();
  expect(state.data.visibility.showDemo).toBe(false);
  expect(state.data.docs.find((item: any) => item.id === doc.id)).toMatchObject({ origin: 'real', content: doc.content });
  expect(state.data.auditLogs.find((item: any) => item.requestPayload.id === marker)).toMatchObject({ host: 'Codex CLI', origin: 'real', outcome: 'ok' });
  assertHit(await search(marker));
}, 20000);

test('unauthenticated startup refuses a non-loopback bind before listening', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mcp-unsafe-bind-'));
  dirs.push(dir);
  for (const address of ['0.0.0.0', '::', '192.168.1.2']) {
    const child = spawn('node', ['--import', 'tsx/esm', 'server.ts', '--production', '--allow-unauthenticated'], {
      env: { ...process.env, PORT: '45678', TOOLBOX_BIND_ADDRESS: address, TOOLBOX_MCP_TOKEN: token,
        TOOLBOX_DATA_FILE: path.join(dir, 'state.json'), TOOLBOX_LOCK_FILE: path.join(dir, 'lock.json') },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    children.push(child);
    let stderr = '';
    child.stderr!.on('data', b => { stderr += String(b); });
    const code = await new Promise(resolve => child.once('close', resolve));
    expect(code).toBe(1);
    expect(stderr).toContain('Unauthenticated MCP requires a loopback bind address');
  }
}, 15000);

networkTest('loopback startup accepts authenticated real tools with local or absent Origin on every POST entry', async () => {
  const g = await gateway();
  await fetch(`${g.url}/api/v1/settings/visibility`, {
    method: 'PUT', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ showDemo: false, showFixtures: true }),
  });
  for (const route of ['/api/mcp', '/api/mcp/messages', '/api/mcp/sse']) {
    for (const origin of [undefined, 'http://localhost:1234', 'http://127.0.0.1:1234', 'http://[::1]:1234']) {
      const headers: Record<string, string> = { ...auth, 'content-type': 'application/json' };
      if (origin) headers.Origin = origin;
      const rpc = async (method: string, params?: unknown) => {
        const response = await fetch(`${g.url}${route}`, { method: 'POST', headers,
          body: JSON.stringify({ jsonrpc: '2.0', id: method, method, params }) });
        expect(response.ok).toBe(true);
        return await response.json() as any;
      };
      const listed = await rpc('tools/list');
      expect(listed.result.tools.some((tool: any) => tool.name === 'fixture__echo')).toBe(true);
      const called = await rpc('tools/call', { name: 'fixture__echo', arguments: { text: 'authenticated-echo' } });
      expect(JSON.parse(called.result.content[0].text).content[0].text).toBe('authenticated-echo');
    }
  }
  for (const route of ['/api/mcp', '/api/mcp/sse']) {
    const stream = await fetch(`${g.url}${route}`, { headers: { ...auth, Origin: 'http://localhost:1234' } });
    expect(stream.ok).toBe(true);
    await stream.body?.cancel();
  }
  expect(g.logs().includes('listening on http://127.0.0.1:')).toBe(true);
});

networkTest('downstream poison names always retain their own service namespace', async () => {
  const g = await gateway();
  const added = await fetch(`${g.url}/api/v1/servers`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ name: 'poison', protocol: 'stdio', commandOrUrl: 'node',
      args: ['--import', 'tsx/esm', path.resolve('tests/fixtures/namespace-poison-mcp.ts')],
      cwd: process.cwd(), defaultMode: 'pinned' }),
  });
  expect(added.ok).toBe(true);
  const listed = JSON.parse((await g.rpc({ jsonrpc: '2.0', id: 'names', method: 'tools/list' })).text);
  const names = listed.result.tools.map((t: any) => t.name);
  expect(names).not.toContain('github__create_issue');
  expect(names).not.toContain('ToolBox__remember');
  expect(names.filter((n: string) => n === 'toolbox__call_tool').length).toBe(1);
  for (const original of ['echo', 'toolbox__call_tool', 'ToolBox__remember', 'github__create_issue']) {
    expect(names).toContain(`poison__${original}`);
    const call = JSON.parse((await g.rpc({ jsonrpc: '2.0', id: original, method: 'tools/call',
      params: { name: `poison__${original}`, arguments: {} } })).text);
    expect(call.error).toBeUndefined();
    expect(call.result.content[0].text).toContain(`namespace-fixture:${original}`);
  }
  for (const name of ['github__create_issue', 'ToolBox__remember', 'toolbox__call_tool']) {
    const call = JSON.parse((await g.rpc({ jsonrpc: '2.0', id: name, method: 'tools/call', params: { name, arguments: {} } })).text);
    expect(call.error).toBeDefined();
    expect(JSON.stringify(call)).not.toContain('namespace-fixture:');
  }
  const casedMeta = JSON.parse((await g.rpc({
    jsonrpc: '2.0', id: 'cased-meta', method: 'tools/call',
    params: { name: 'ToolBox__call_tool', arguments: { toolName: 'fixture__echo', arguments: { text: 'cased-meta' } } },
  })).text);
  expect(casedMeta.error).toBeUndefined();
  expect(JSON.parse(casedMeta.result.content[0].text).content[0].text).toBe('cased-meta');
  expect(JSON.stringify(casedMeta)).not.toContain('namespace-fixture:');
});

networkTest('reserved service namespaces are rejected without replacing real meta tools', async () => {
  const g = await gateway();
  for (const name of ['toolbox', 'ToolBox']) {
    const response = await fetch(`${g.url}/api/v1/servers`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name, protocol: 'stdio', commandOrUrl: 'node', defaultMode: 'pinned',
        args: ['--import', 'tsx/esm', path.resolve('tests/fixtures/namespace-poison-mcp.ts')] }),
    });
    expect(response.ok).toBe(false);
  }
  const listed = JSON.parse((await g.rpc({ jsonrpc: '2.0', id: 'reserved-list', method: 'tools/list' })).text);
  expect(listed.result.tools.filter((t: any) => t.name === 'toolbox__call_tool').length).toBe(1);
  const call = JSON.parse((await g.rpc({ jsonrpc: '2.0', id: 'reserved-call', method: 'tools/call', params: { name: 'toolbox__call_tool', arguments: {} } })).text);
  expect(call.error).toBeDefined();
  expect(JSON.stringify(call)).not.toContain('namespace-fixture:');
});

networkTest('later Skill cannot take over an enabled service tool name', async () => {
  const g = await gateway();
  const created = await fetch(`${g.url}/api/v1/skills`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ id: 'name-collision', skillMarkdown: '# Collision\n\nA colliding skill.', toolName: 'fixture__echo' }),
  });
  expect(created.ok).toBe(true);
  const mount = await fetch(`${g.url}/api/v1/skills/name-collision/mount`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ host: 'Codex CLI' }),
  });
  expect(mount.ok).toBe(false);
  const load = JSON.parse((await g.rpc({
    jsonrpc: '2.0', id: 'load-collision', method: 'tools/call',
    params: { name: 'toolbox__load_skill', arguments: { skillId: 'name-collision' } },
  })).text);
  expect(load.error).toBeDefined();
  const state: any = await (await fetch(`${g.url}/api/v1/state`)).json();
  expect(state.data.skills.find((skill: any) => skill.id === 'name-collision').mounted).toBe(false);
  expect(g.logs()).toContain('Namespace collision rejected for Skill name-collision');
  const listed = JSON.parse((await g.rpc({ jsonrpc: '2.0', id: 'after-skill', method: 'tools/list' })).text);
  expect(listed.result.tools.filter((tool: any) => tool.name === 'fixture__echo').length).toBe(1);
  const call = JSON.parse((await g.rpc({
    jsonrpc: '2.0', id: 'still-echo', method: 'tools/call',
    params: { name: 'fixture__echo', arguments: { text: 'skill-must-not-take-over' } },
  })).text);
  expect(JSON.parse(call.result.content[0].text).content[0].text).toBe('skill-must-not-take-over');
});

networkTest('later service with a colliding normalized prefix is isolated', async () => {
  const g = await gateway();
  const seed = await fetch(`${g.url}/api/v1/servers`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      name: 'seed-prefix', protocol: 'stdio', commandOrUrl: 'node',
      args: ['--import', 'tsx/esm', path.resolve('tests/fixtures/echo-mcp.ts')],
      cwd: process.cwd(), defaultMode: 'pinned',
    }),
  });
  expect(seed.ok).toBe(true);
  await delay(400);
  await stop(g.child);
  const statePath = path.join(g.dir, 'state.json');
  const persisted = JSON.parse(fs.readFileSync(statePath, 'utf8'));
  const earlier = persisted.servers.find((server: any) => server.id === 'seed-prefix');
  expect(earlier).toBeDefined();
  earlier.id = 'foo_bar';
  earlier.name = 'foo_bar';
  for (const tool of earlier.tools || []) {
    tool.serverId = 'foo_bar';
    if (typeof tool.name === 'string' && tool.name.startsWith('seed_prefix__')) {
      tool.name = `foo_bar__${tool.name.slice('seed_prefix__'.length)}`;
    }
  }
  fs.writeFileSync(statePath, `${JSON.stringify(persisted, null, 2)}\n`);
  await g.start();
  const before = JSON.parse((await g.rpc({ jsonrpc: '2.0', id: 'prefix-before', method: 'tools/list' })).text);
  expect(before.result.tools.some((tool: any) => tool.name === 'foo_bar__echo')).toBe(true);
  const later = await fetch(`${g.url}/api/v1/servers`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      name: 'foo-bar', protocol: 'stdio', commandOrUrl: 'node',
      args: ['--import', 'tsx/esm', path.resolve('tests/fixtures/namespace-poison-mcp.ts')],
      cwd: process.cwd(), defaultMode: 'pinned',
    }),
  });
  expect(later.ok).toBe(true);
  const listed = JSON.parse((await g.rpc({ jsonrpc: '2.0', id: 'prefix-after', method: 'tools/list' })).text);
  const names = listed.result.tools.map((tool: any) => tool.name);
  expect(names.filter((name: string) => name === 'foo_bar__echo').length).toBe(1);
  expect(names).not.toContain('foo_bar__toolbox__call_tool');
  expect(names).not.toContain('foo_bar__github__create_issue');
  expect(g.logs()).toContain('Namespace collision rejected for service foo-bar');
  const snapshot: any = await (await fetch(`${g.url}/api/v1/state`)).json();
  expect(snapshot.data.servers.find((server: any) => server.id === 'foo-bar').tools).toEqual([]);
  const call = JSON.parse((await g.rpc({
    jsonrpc: '2.0', id: 'first-wins', method: 'tools/call',
    params: { name: 'foo_bar__echo', arguments: { text: 'first-wins' } },
  })).text);
  expect(call.error).toBeUndefined();
  expect(JSON.parse(call.result.content[0].text).content[0].text).toBe('first-wins');
  expect(JSON.stringify(call)).not.toContain('namespace-fixture:');
});

networkTest('console rejects metadata, userinfo, public HTTP and unallowed private downstreams before connecting', async () => {
  const g = await gateway();
  for (const commandOrUrl of ['http://169.254.169.254/latest/meta-data', 'https://metadata.google.internal/', 'https://user:password@example.com/mcp', 'http://93.184.216.34/mcp', 'http://127.0.0.1:9/mcp', 'https://[::ffff:127.0.0.1]/mcp']) {
    const response = await fetch(`${g.url}/api/v1/servers`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'unsafe-target', protocol: 'http', commandOrUrl, defaultMode: 'pinned' }),
    });
    expect(response.status).toBe(400);
  }
});

networkTest('console update and import reject unsafe remote addresses without changing the saved endpoint', async () => {
  const g = await gateway();
  const added = await fetch(`${g.url}/api/v1/servers`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ name: 'safe-command', protocol: 'stdio', commandOrUrl: 'node', connectOnStart: false, defaultMode: 'lazy' }),
  });
  expect(added.ok).toBe(true);
  for (const commandOrUrl of ['http://169.254.169.254/', 'http://metadata.google.internal/', 'http://169.254.1.2/', 'http://168.63.129.16/', 'http://100.100.100.200/']) {
    const patched = await fetch(`${g.url}/api/v1/servers/safe-command`, {
      method: 'PATCH', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ protocol: 'http', commandOrUrl, allowPrivateNetwork: true }),
    });
    expect(patched.status).toBe(400);
    const imported = await fetch(`${g.url}/api/v1/servers/import-json`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ rawJson: JSON.stringify({ mcpServers: { unsafe: { url: commandOrUrl, allowPrivateNetwork: true } } }) }),
    });
    expect(imported.status).toBe(400);
  }
  const state = await (await fetch(`${g.url}/api/v1/state`)).json() as any;
  expect(state.data.servers.find((server: any) => server.id === 'safe-command').commandOrUrl).toBe('node');
});

networkTest('explicit allow cannot open AWS IMDS IPv6 metadata addresses', async () => {
  const g = await gateway();
  const added = await fetch(`${g.url}/api/v1/servers`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ name: 'safe-command', protocol: 'stdio', commandOrUrl: 'node', connectOnStart: false, defaultMode: 'lazy' }),
  });
  expect(added.ok).toBe(true);
  for (const commandOrUrl of ['https://[fd00:ec2::254]/latest/meta-data', 'https://[FD00:0EC2:0:0:0:0:0:254]/mcp', 'http://[fd00:ec2::254]/']) {
    const created = await fetch(`${g.url}/api/v1/servers`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'imds-v6', protocol: 'http', commandOrUrl, allowPrivateNetwork: true, defaultMode: 'pinned' }),
    });
    expect(created.status).toBe(400);
    const patched = await fetch(`${g.url}/api/v1/servers/safe-command`, {
      method: 'PATCH', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ protocol: 'http', commandOrUrl, allowPrivateNetwork: true }),
    });
    expect(patched.status).toBe(400);
    const imported = await fetch(`${g.url}/api/v1/servers/import-json`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ rawJson: JSON.stringify({ mcpServers: { 'imds-v6': { url: commandOrUrl, allowPrivateNetwork: true } } }) }),
    });
    expect(imported.status).toBe(400);
  }
  const state = await (await fetch(`${g.url}/api/v1/state`)).json() as any;
  expect(state.data.servers.find((server: any) => server.id === 'safe-command').commandOrUrl).toBe('node');
  expect(state.data.servers.some((server: any) => server.id === 'imds-v6')).toBe(false);
});

networkTest('explicitly allowed HTTP and SSE downstreams list and call real tools; redirects cannot reach other private origins', async () => {
  const http = await import('node:http');
  let forbiddenHits = 0;
  const forbidden = http.createServer((_req, res) => { forbiddenHits++; res.end('{}'); });
  await new Promise<void>(resolve => forbidden.listen(0, '127.0.0.1', resolve));
  const forbiddenUrl = `http://127.0.0.1:${(forbidden.address() as net.AddressInfo).port}/mcp`;
  const fixture = http.createServer(async (req, res) => {
    if (req.url === '/redirect') { res.writeHead(307, { location: forbiddenUrl }); res.end(); return; }
    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(Buffer.from(chunk));
    const body = JSON.parse(Buffer.concat(chunks).toString());
    if (!body.id) { res.writeHead(202); res.end(); return; }
    const result = body.method === 'initialize' ? { protocolVersion: '2025-03-26', capabilities: {}, serverInfo: { name: 'http-fixture', version: '1' } }
      : body.method === 'tools/list' ? { tools: [{ name: 'echo', description: 'real remote echo', inputSchema: { type: 'object' }, annotations: { readOnlyHint: true } }] }
      : body.method === 'tools/call' ? { content: [{ type: 'text', text: 'guarded-real-result' }] }
      : {};
    res.setHeader('content-type', req.url === '/sse' ? 'text/event-stream' : 'application/json');
    const message = JSON.stringify({ jsonrpc: '2.0', id: body.id, result });
    res.end(req.url === '/sse' ? `data: ${message}\n\n` : message);
  });
  await new Promise<void>(resolve => fixture.listen(0, '127.0.0.1', resolve));
  try {
    const g = await gateway();
    const base = `http://127.0.0.1:${(fixture.address() as net.AddressInfo).port}`;
    for (const protocol of ['http', 'sse']) {
      const added = await fetch(`${g.url}/api/v1/servers`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: `remote-${protocol}`, protocol, commandOrUrl: `${base}/${protocol}`, allowPrivateNetwork: true, defaultMode: 'pinned' }) });
      expect(added.ok).toBe(true);
      const listed = JSON.parse((await g.rpc({ jsonrpc: '2.0', id: 'list-remote', method: 'tools/list' })).text);
      expect(listed.result.tools.some((tool: any) => tool.name === `remote_${protocol}__echo`)).toBe(true);
      const called = JSON.parse((await g.rpc({ jsonrpc: '2.0', id: 'call-remote', method: 'tools/call', params: { name: `remote_${protocol}__echo`, arguments: {} } })).text);
      expect(JSON.stringify(called)).toContain('guarded-real-result');
    }
    await fetch(`${g.url}/api/v1/servers`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: 'redirect-probe', protocol: 'http', commandOrUrl: `${base}/redirect`, allowPrivateNetwork: true, defaultMode: 'pinned' }) });
    const ping = await (await fetch(`${g.url}/api/v1/servers/redirect-probe/ping`, { method: 'POST' })).json() as any;
    expect(ping.syncOk).toBe(false);
    expect(forbiddenHits).toBe(0);
  } finally {
    await Promise.all([new Promise<void>(r => fixture.close(() => r())), new Promise<void>(r => forbidden.close(() => r()))]);
  }
});
