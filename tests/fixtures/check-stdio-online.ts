import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import fs from 'node:fs';

const clientHost = process.argv[5] || 'Stdio Test Host';
const child = spawn('node', ['bin/stdio-proxy.mjs', '--host', clientHost, '--url', process.argv[2]], { env: process.env });
let stderr = '';
child.stderr.on('data', b => { stderr += String(b); });
const queue: any[] = [];
const waiters: Array<{ match: (msg: any) => boolean; resolve: (msg: any) => void }> = [];
createInterface({ input: child.stdout }).on('line', line => {
  const msg = JSON.parse(line);
  const index = waiters.findIndex(w => w.match(msg));
  if (index >= 0) waiters.splice(index, 1)[0].resolve(msg);
  else queue.push(msg);
});
function next(match: (msg: any) => boolean) {
  const index = queue.findIndex(match);
  if (index >= 0) return Promise.resolve(queue.splice(index, 1)[0]);
  return new Promise<any>(resolve => waiters.push({ match, resolve }));
}
async function rpc(msg: any) {
  const reply = next(reply => reply.id === msg.id);
  child.stdin.write(JSON.stringify(msg) + '\n');
  return reply;
}
const timeout = setTimeout(() => { child.kill(); throw new Error(`stdio timeout: ${stderr}`); }, 4000);
const initialize = await rpc({ jsonrpc: '2.0', id: 'initialize', method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: clientHost, version: '1' } } });
child.stdin.write(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) + '\n');
const list = await rpc({ jsonrpc: '2.0', id: 'list', method: 'tools/list' });
const call = await rpc({ jsonrpc: '2.0', id: 'echo', method: 'tools/call', params: { name: 'fixture__echo', arguments: { text: 'hello-from-stdio' } } });
// Allow the initial SSE subscription (restarted with initialize's client identity) to settle.
await new Promise(r => setTimeout(r, 650));
const notice = next(msg => msg.method === 'notifications/tools/list_changed');
await rpc({ jsonrpc: '2.0', id: 'mount', method: 'tools/call', params: { name: 'toolbox__load_skill', arguments: { skillId: 'security-owasp-auditor' } } });
const notification = await notice;
let rugPull;
if (process.argv[4] === 'rug-pull') {
  await fetch(`${process.argv[2]}/api/v1/servers/fixture`, {
    method: 'PATCH', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ env: { FIXTURE_POISON: '1' } }),
  });
  rugPull = await rpc({ jsonrpc: '2.0', id: 'rug-pull', method: 'tools/call', params: { name: 'fixture__echo', arguments: { text: 'must-not-forward' } } });
}
const exit = new Promise<number | null>(resolve => child.once('exit', resolve));
child.stdin.end();
const exitCode = await exit;
clearTimeout(timeout);
fs.writeFileSync(process.argv[3], JSON.stringify({ initialize, list, call, notification, rugPull, exitCode }));
