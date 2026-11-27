#!/usr/bin/env bun
import { createReadStream, writeSync } from 'node:fs';
import { createInterface } from 'node:readline';
import { setTimeout as delay } from 'node:timers/promises';
import { rpcError } from '../server/rpcError';

const gatewayUrl = (process.env.TOOLBOX_GATEWAY_URL || 'http://127.0.0.1:3000').replace(/\/$/, '');
let hostName = process.env.TOOLBOX_HOST || '';
const lifetime = new AbortController();
let stream: AbortController | undefined;
let chain = Promise.resolve();
const output = (message: unknown) => writeSync(1, JSON.stringify(message) + '\n');
const headers = (): Record<string, string> => hostName ? { 'x-toolbox-host': hostName } : {};

async function subscribe() {
  while (!lifetime.signal.aborted) {
    const controller = new AbortController();
    stream = controller;
    const abort = () => controller.abort();
    lifetime.signal.addEventListener('abort', abort, { once: true });
    try {
      const response = await fetch(`${gatewayUrl}/api/mcp/sse`, { headers: headers(), signal: controller.signal });
      if (!response.ok || !response.body) throw new Error(`SSE HTTP ${response.status}`);
      const reader = response.body.pipeThrough(new TextDecoderStream()).getReader();
      let buffer = '';
      let data: string[] = [];
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += value;
        let end: number;
        while ((end = buffer.indexOf('\n')) >= 0) {
          const line = buffer.slice(0, end).replace(/\r$/, '');
          buffer = buffer.slice(end + 1);
          if (!line) {
            if (data.length) {
              try {
                const notification = JSON.parse(data.join('\n'));
                if (notification.jsonrpc === '2.0' && notification.method === 'notifications/tools/list_changed' && !('id' in notification)) output(notification);
              } catch { console.error('[stdio] Ignored malformed SSE event'); }
              data = [];
            }
          } else if (line.startsWith('data:')) data.push(line.slice(5).replace(/^ /, ''));
        }
      }
    } catch (error) {
      if (!controller.signal.aborted) console.error(`[stdio] SSE disconnected: ${String(error)}`);
    } finally {
      controller.abort();
      lifetime.signal.removeEventListener('abort', abort);
    }
    try { await delay(500, undefined, { signal: lifetime.signal }); } catch {}
  }
}

async function forward(line: string) {
  let message: any;
  try { message = JSON.parse(line); } catch { output(rpcError(null, -32700, 'Parse error')); return; }
  const initialization = (Array.isArray(message) ? message : [message]).find(item => item?.method === 'initialize');
  if (!process.env.TOOLBOX_HOST && typeof initialization?.params?.clientInfo?.name === 'string') {
    hostName = initialization.params.clientInfo.name;
    stream?.abort();
  }
  try {
    const response = await fetch(`${gatewayUrl}/api/mcp/messages`, {
      method: 'POST', headers: { 'content-type': 'application/json', ...headers() },
      body: JSON.stringify(message), signal: AbortSignal.timeout(10000),
    });
    if (response.status === 202 || response.status === 204) return;
    if (!response.ok) throw new Error(`Gateway HTTP ${response.status}`);
    const text = await response.text();
    if (text.trim()) output(JSON.parse(text));
  } catch (error) {
    console.error(`[stdio] Gateway unavailable: ${String(error)}`);
    const unavailable = (item: any) => item && typeof item === 'object' && 'id' in item
      ? rpcError(item.id, -32006, '网关不可用，请先运行 bun run dev') : null;
    if (Array.isArray(message)) {
      const replies = message.map(unavailable).filter(Boolean);
      if (replies.length) output(replies);
    } else {
      const reply = unavailable(message);
      if (reply) output(reply);
    }
  }
}

void subscribe();
const input = createInterface({ input: createReadStream('', { fd: 0, autoClose: false }), crlfDelay: Infinity });
input.on('line', line => {
  chain = chain.then(() => forward(line)).catch(error => { console.error(`[stdio] ${String(error)}`); });
});
input.on('close', () => {
  lifetime.abort();
  void chain.finally(() => process.exit(0));
});
