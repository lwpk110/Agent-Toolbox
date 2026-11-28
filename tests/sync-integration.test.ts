import { afterEach, expect, test } from 'bun:test';
import { spawn, type ChildProcess } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import http from 'node:http';
import crypto from 'node:crypto';

const canListen = await new Promise<boolean>((resolve, reject) => {
  const script = `const s = require('node:net').createServer(); const fs = require('node:fs'); s.on('error', e => { fs.writeSync(1, JSON.stringify({ code: e.code })); }); s.listen(0, '127.0.0.1', () => s.close(() => fs.writeSync(1, '{}')));`;
  const child = spawn('node', ['-e', script], { stdio: ['ignore', 'pipe', 'pipe'] });
  let output = '';
  child.stdout.on('data', (chunk) => { output += String(chunk); });
  child.on('error', reject);
  child.on('exit', (code) => {
    try {
      if (code !== 0) throw new Error(`listen probe exited ${code}`);
      const result = JSON.parse(output);
      if (!result.code) resolve(true);
      else if (result.code === 'EPERM' || result.code === 'EACCES') resolve(false);
      else throw new Error(`Unexpected listen error: ${result.code}`);
    } catch (error) { reject(error); }
  });
});
const networkTest = canListen ? test : test.skip;
const children: ChildProcess[] = [];
const directories: string[] = [];
const remoteServers: http.Server[] = [];

async function startGateway() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'sync-integration-'));
  directories.push(directory);
  const probe = net.createServer();
  await new Promise<void>((resolve) => probe.listen(0, '127.0.0.1', resolve));
  const port = (probe.address() as net.AddressInfo).port;
  await new Promise<void>((resolve) => probe.close(() => resolve()));
  const remotePort = await freePort();
  const files = new Map<string, string>();
  const commits = new Set<string>();
  const branches = new Set(['main']);
  const remote = http.createServer(async (request, response) => {
    const chunks: Buffer[] = [];
    for await (const chunk of request) chunks.push(Buffer.from(chunk));
    const body = chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {};
    const url = new URL(request.url || '/', 'http://localhost');
    if (url.pathname === '/repos/lwpk110/Agent-Toolbox') {
      response.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ default_branch: 'main' }));
      return;
    }
    if (url.pathname.startsWith('/repos/lwpk110/Agent-Toolbox/git/ref/heads/')) {
      const branch = decodeURIComponent(url.pathname.split('/').pop() || '');
      if (branches.has(branch)) response.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ object: { sha: 'a'.repeat(40) } }));
      else response.writeHead(404).end(JSON.stringify({ message: 'ref not found' }));
      return;
    }
    if (url.pathname === '/repos/lwpk110/Agent-Toolbox/git/refs' && request.method === 'POST') {
      branches.add(String(body.ref).replace(/^refs\/heads\//, ''));
      response.writeHead(201, { 'content-type': 'application/json' }).end(JSON.stringify({ ref: body.ref, object: { sha: body.sha } }));
      return;
    }
    const match = url.pathname.match(/^\/repos\/([^/]+\/[^/]+)\/contents\/(.+)$/);
    if (!match) { response.writeHead(404).end(JSON.stringify({ message: 'not found' })); return; }
    const branch = String(url.searchParams.get('ref') || body.branch || '');
    const fileKey = `${decodeURIComponent(match[1])}@${branch}/${match[2].split('/').map(decodeURIComponent).join('/')}`;
    if (request.method === 'GET') {
      const content = files.get(fileKey);
      if (content === undefined) { response.writeHead(404).end(JSON.stringify({ message: 'not found' })); return; }
      response.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ sha: crypto.createHash('sha1').update(content).digest('hex'), content: Buffer.from(content).toString('base64') }));
      return;
    }
    if (request.method === 'PUT') {
      const content = Buffer.from(String(body.content), 'base64').toString('utf8');
      files.set(fileKey, content);
      const sha = crypto.createHash('sha1').update(`${fileKey}:${content}`).digest('hex');
      commits.add(sha);
      response.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ commit: { sha } }));
      return;
    }
    response.writeHead(405).end();
  });
  remoteServers.push(remote);
  await new Promise<void>((resolve) => remote.listen(remotePort, '127.0.0.1', resolve));
  const url = `http://127.0.0.1:${port}`;
  const child = spawn('node', ['--import', 'tsx/esm', 'server.ts', '--production'], {
    env: { ...process.env, PORT: String(port), TOOLBOX_DATA_FILE: path.join(directory, 'state.json'), TOOLBOX_LOCK_FILE: path.join(directory, 'toolbox.lock.json'), TOOLBOX_DEMO_DATA: 'off', TOOLBOX_GITHUB_API_URL: `http://127.0.0.1:${remotePort}` },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  children.push(child);
  let logs = '';
  child.stdout?.on('data', (chunk) => { logs += String(chunk); });
  child.stderr?.on('data', (chunk) => { logs += String(chunk); });
  for (let attempt = 0; attempt < 120; attempt++) {
    try {
      if ((await fetch(`${url}/api/v1/state`)).ok) break;
    } catch { /* Wait for the gateway to listen. */ }
    if (child.exitCode !== null) throw new Error(`Gateway exited: ${logs}`);
    await new Promise((resolve) => setTimeout(resolve, 30));
  }
  return { url, files, commits };
}

async function freePort() {
  const probe = net.createServer();
  await new Promise<void>((resolve) => probe.listen(0, '127.0.0.1', resolve));
  const port = (probe.address() as net.AddressInfo).port;
  await new Promise<void>((resolve) => probe.close(() => resolve()));
  return port;
}

afterEach(async () => {
  for (const child of children.splice(0)) {
    if (child.exitCode === null && child.signalCode === null) {
      const exited = new Promise<void>((resolve) => child.once('exit', () => resolve()));
      child.kill('SIGTERM');
      await exited;
    }
  }
  for (const remote of remoteServers.splice(0)) await new Promise<void>((resolve) => remote.close(() => resolve()));
  for (const directory of directories.splice(0)) fs.rmSync(directory, { recursive: true, force: true });
});

networkTest('preflight with demo data hidden only includes visible vault entries', async () => {
  const gateway = await startGateway();
  const visibility = await fetch(`${gateway.url}/api/v1/settings/visibility`, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ showDemo: false }) });
  expect(visibility.ok).toBe(true);
  const preflightResponse = await fetch(`${gateway.url}/api/v1/sync/preflight`);
  const preflight = await preflightResponse.json() as any;
  expect(preflight.data.ready).toBe(true);
  expect(preflight.data.manifestJson).not.toContain('GITHUB_PERSONAL_TOKEN');
});

networkTest('preflight blocks a missing visible Vault reference before any remote content is written', async () => {
  const gateway = await startGateway();
  const request = async (route: string, method: string, body: unknown) => {
    const response = await fetch(`${gateway.url}${route}`, { method, headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
    return { response, body: await response.json() as any };
  };
  await request('/api/v1/settings/visibility', 'PUT', { showDemo: false });
  await request('/api/v1/servers', 'POST', {
    name: 'required-sync-vault', protocol: 'http', commandOrUrl: 'http://127.0.0.1:1',
    env: { API_TOKEN: 'vault://REQUIRED_SYNC_TOKEN' }, secretRef: 'vault://REQUIRED_SYNC_TOKEN', connectOnStart: false,
  });
  const preflight = await fetch(`${gateway.url}/api/v1/sync/preflight`).then(response => response.json()) as any;
  expect(preflight.data.ready).toBe(false);
  const pushed = await request('/api/v1/sync/push', 'POST', {});
  expect(pushed.response.status).toBe(409);
  expect(pushed.body.ok).toBe(false);
  expect(pushed.body.error.code).toBe('PREFLIGHT_BLOCKED');
  expect(gateway.files.size).toBe(0);
});

networkTest('push publishes manifest and sync lock and pull applies the remote JSON view', async () => {
  const gateway = await startGateway();
  const request = async (route: string, method: string, body: unknown) => {
    const response = await fetch(`${gateway.url}${route}`, { method, headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
    return { response, body: await response.json() as any };
  };
  await request('/api/v1/settings/visibility', 'PUT', { showDemo: false });
  await request('/api/v1/vault/GITHUB_SYNC_PAT', 'PUT', { value: 'ghp_sync_boundary_secret_123', serviceName: 'github-sync' });
  const configured = await request('/api/v1/sync/config', 'PATCH', { repo: 'lwpk110/Agent-Toolbox', branch: 'toolbox-sync' });
  expect(configured.body.ok).toBe(true);

  const pushed = await request('/api/v1/sync/push', 'POST', { commitMessage: 'test sync content' });
  expect(pushed.body.ok).toBe(true);
  expect(typeof pushed.body.commitHash === 'string' && pushed.body.commitHash.length === 40 && /^[a-f0-9]+$/.test(pushed.body.commitHash)).toBe(true);
  expect(gateway.commits.has(pushed.body.commitHash)).toBe(true);
  const manifestPath = 'lwpk110/Agent-Toolbox@toolbox-sync/sync/toolbox.manifest.json';
  const lockPath = 'lwpk110/Agent-Toolbox@toolbox-sync/sync/toolbox.lock.json';
  const manifest = gateway.files.get(manifestPath)!;
  const lock = gateway.files.get(lockPath)!;
  expect(JSON.parse(manifest).gateway.secretRefs).toContain('vault://GITHUB_SYNC_PAT');
  expect(manifest).not.toContain('ghp_sync_boundary_secret_123');
  expect(JSON.parse(lock).schemaVersion).toBe('1.1');

  const pulled = await request('/api/v1/sync/pull', 'POST', {});
  expect(pulled.body.ok).toBe(true);
  expect(JSON.parse(pulled.body.data.preflight.manifestJson)).toEqual(JSON.parse(manifest));
  expect(JSON.parse(pulled.body.data.preflight.lockfileJson)).toEqual(JSON.parse(lock));
});
