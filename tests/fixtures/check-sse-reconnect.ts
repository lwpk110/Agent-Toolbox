import http from 'node:http';
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import fs from 'node:fs';

let subscriptions = 0;
const hosts: unknown[] = [];
const server = http.createServer((req, res) => {
  if (req.url !== '/api/mcp/sse') { res.writeHead(202).end(); return; }
  hosts.push(req.headers['x-toolbox-host']);
  res.writeHead(200, { 'content-type': 'text/event-stream' });
  const sequence = ++subscriptions;
  res.write('event: endpoint\r\ndata: /api/mcp/messages\r\n\r\n');
  const notification = JSON.stringify({ jsonrpc: '2.0', method: 'notifications/tools/list_changed', params: { sequence } });
  const event = `event: message\r\ndata: ${notification}\r\n\r\n`;
  res.write(event.slice(0, 25));
  setTimeout(() => { res.write(event.slice(25)); if (sequence === 1) res.end(); }, 20);
});
await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
const port = (server.address() as import('node:net').AddressInfo).port;
const child = spawn('bun', ['src/cli/serve-stdio.ts'], { env: { ...process.env, TOOLBOX_GATEWAY_URL: `http://127.0.0.1:${port}`, TOOLBOX_HOST: 'SSE Host' } });
child.stderr.resume();
const messages: any[] = [];
const done = new Promise<void>(resolve => {
  createInterface({ input: child.stdout }).on('line', line => {
    messages.push(JSON.parse(line));
    if (messages.length === 2) resolve();
  });
});
const timeout = setTimeout(() => { child.kill(); server.closeAllConnections(); throw new Error('SSE reconnect timeout'); }, 3000);
await done;
const exit = new Promise<number | null>(resolve => child.once('exit', resolve));
child.stdin.end();
const exitCode = await exit;
clearTimeout(timeout);
server.closeAllConnections();
await new Promise<void>(resolve => server.close(() => resolve()));
fs.writeFileSync(process.argv[2], JSON.stringify({ messages, hosts, subscriptions, exitCode }));
