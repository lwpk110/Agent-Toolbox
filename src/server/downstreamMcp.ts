import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { writeSync } from 'node:fs';
import { createInterface } from 'node:readline';
import type { McpServer } from '../types/toolbox';
import { RpcError } from './rpcError';

export interface DownstreamTool {
  name: string;
  description?: string;
  inputSchema: Record<string, unknown>;
  annotations?: { readOnlyHint?: boolean };
}

class StdioSession {
  private child: ChildProcessWithoutNullStreams;
  private sequence = 0;
  private failed?: RpcError;
  private pending = new Map<number, { resolve: (result: any) => void; reject: (error: Error) => void; timer: ReturnType<typeof setTimeout> }>();
  readonly ready: Promise<void>;

  constructor(server: McpServer, onDisconnect: () => void, onToolsChanged: () => void) {
    this.child = spawn(server.commandOrUrl, server.args || [], {
      cwd: server.cwd, env: { ...process.env, ...server.env }, stdio: ['pipe', 'pipe', 'pipe'],
    });
    const fail = (reason: string) => {
      if (this.failed) return;
      this.failed = new RpcError(-32006, `Downstream ${server.id} unavailable: ${reason}`);
      for (const p of this.pending.values()) { clearTimeout(p.timer); p.reject(this.failed); }
      this.pending.clear();
      this.child.kill();
      onDisconnect();
    };
    this.child.on('error', error => fail(error.message));
    this.child.on('exit', (code, signal) => fail(`process exited (${signal || code})`));
    this.child.stdin.on('error', error => fail(error.message));
    this.child.stderr.on('data', chunk => writeSync(2, `[downstream:${server.id}] ${chunk}`));
    createInterface({ input: this.child.stdout }).on('line', line => {
      try {
        const msg = JSON.parse(line);
        if (msg.jsonrpc === '2.0' && !('id' in msg) && msg.method === 'notifications/tools/list_changed') {
          onToolsChanged();
          return;
        }
        const p = this.pending.get(msg.id);
        if (!p) return;
        if (msg.jsonrpc !== '2.0' || (!('result' in msg) && !msg.error)) { fail('invalid JSON-RPC response'); return; }
        this.pending.delete(msg.id);
        clearTimeout(p.timer);
        if (msg.error) p.reject(new RpcError(msg.error.code, msg.error.message));
        else p.resolve(msg.result);
      } catch { fail('invalid JSON on stdout'); }
    });
    this.ready = this.request('initialize', {
      protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'agent-toolbox', version: '0.0.0' },
    }).then(result => {
      if (!result?.serverInfo || !result.capabilities || !['2025-06-18', '2025-03-26', '2024-11-05'].includes(result.protocolVersion)) throw new Error('invalid initialize response');
      this.child.stdin.write(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) + '\n');
    }).catch(error => { fail(`handshake failed: ${String(error)}`); throw this.failed; });
  }

  request(method: string, params: unknown): Promise<any> {
    if (this.failed) return Promise.reject(this.failed);
    const id = ++this.sequence;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new RpcError(-32006, `Downstream timeout: ${method}`));
        this.close();
      }, 3000);
      this.pending.set(id, { resolve, reject, timer });
      this.child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n');
    });
  }

  close() { this.child.kill(); }
}

export class DownstreamMcp {
  private sessions = new Map<string, { signature: string; session: StdioSession }>();
  constructor(private onDisconnect: (server: McpServer) => void, private onToolsChanged: (server: McpServer) => void = () => {}) {}

  private async session(server: McpServer) {
    if (!server.enabled || server.protocol !== 'stdio' || server.connectOnStart === false) throw new RpcError(-32006, `Downstream ${server.id} is not connected`);
    if (Object.values(server.env || {}).some(value => value.includes('vault://'))) throw new RpcError(-32004, `Downstream ${server.id} requires a configured secret`);
    const signature = JSON.stringify([server.commandOrUrl, server.args, server.cwd, server.env]);
    let entry = this.sessions.get(server.id);
    if (!entry || entry.signature !== signature) {
      entry?.session.close();
      const session = new StdioSession(server, () => {
        if (this.sessions.get(server.id)?.session === session) this.onDisconnect(server);
      }, () => this.onToolsChanged(server));
      entry = { signature, session };
      this.sessions.set(server.id, entry);
    }
    await entry.session.ready;
    return entry.session;
  }

  async list(server: McpServer): Promise<DownstreamTool[]> {
    const result = await (await this.session(server)).request('tools/list', {});
    if (!Array.isArray(result?.tools) || result.tools.some((t: any) => typeof t?.name !== 'string' || !t.inputSchema || t.inputSchema.type !== 'object')) throw new RpcError(-32006, 'Invalid downstream tools/list result');
    return result.tools;
  }

  async call(server: McpServer, name: string, args: Record<string, unknown>) {
    const result = await (await this.session(server)).request('tools/call', { name, arguments: args });
    if (!Array.isArray(result?.content)) throw new RpcError(-32006, 'Invalid downstream tools/call result');
    return result;
  }

  reconcile(servers: McpServer[]) {
    for (const [id, entry] of this.sessions) {
      if (!servers.some(s => s.id === id && s.enabled && s.protocol === 'stdio' && s.connectOnStart !== false)) {
        this.sessions.delete(id);
        entry.session.close();
      }
    }
  }

  close() {
    const entries = [...this.sessions.values()];
    this.sessions.clear();
    for (const { session } of entries) session.close();
  }
}
