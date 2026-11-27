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
async function gateway() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mcp-integration-'));
  dirs.push(dir);
  const number = await port();
  const url = `http://127.0.0.1:${number}`;
  const dataFile = path.join(dir, 'state.json');
  let logs = '';
  async function start() {
    const child = spawn('node', ['--import', 'tsx/esm', 'server.ts', '--production'], { env: { ...process.env, PORT: String(number), TOOLBOX_DATA_FILE: dataFile }, stdio: ['ignore', 'pipe', 'pipe'] });
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
  const rpc = async (body: unknown, host = 'Codex CLI') => {
    const response = await fetch(`${url}/api/mcp/messages`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-toolbox-host': host }, body: JSON.stringify(body) });
    return { status: response.status, text: await response.text(), headers: response.headers };
  };
  return { dir, child, start, url, rpc, logs: () => logs };
}

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
  const bad = await fetch(`${g.url}/api/mcp/messages`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{broken' });
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
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', clientInfo: { name: 'Client Host' } } }),
  });
  const session = init.headers.get('mcp-session-id')!;
  expect(typeof session).toBe('string');
  const call = { jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'toolbox__search_knowledge', arguments: { query: 'MCP' } } };
  const response = await fetch(`${g.url}/api/mcp/messages`, {
    method: 'POST', headers: { 'content-type': 'application/json', 'mcp-session-id': session }, body: JSON.stringify(call),
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
  const resultFile = path.join(g.dir, 'stdio.json');
  const child = spawn('node', ['--import', 'tsx/esm', 'tests/fixtures/check-stdio-online.ts', g.url, resultFile], { stdio: ['ignore', 'pipe', 'pipe'] });
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
  expect(JSON.parse(result.call.result.content[0].text).content[0].text).toBe('hello-from-stdio');
  expect(result.notification.method).toBe('notifications/tools/list_changed');
  expect(result.exitCode).toBe(0);
  const state: any = await (await fetch(`${g.url}/api/v1/state`)).json();
  expect(state.data.auditLogs.find((e: any) => e.requestPayload.id === 'echo').host).toBe('Stdio Test Host');
});

networkTest('stdio SSE parser relays fragmented CRLF events and reconnects after disconnect', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mcp-sse-'));
  dirs.push(dir);
  const output = path.join(dir, 'sse.json');
  const child = spawn('node', ['--import', 'tsx/esm', 'tests/fixtures/check-sse-reconnect.ts', output], { stdio: ['ignore', 'pipe', 'pipe'] });
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
