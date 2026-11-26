import { spawn, type ChildProcessWithoutNullStreams } from 'child_process';
import type {
  McpPrompt,
  McpResource,
  McpServer,
  McpToolAnnotations,
} from '../types/toolbox';

export interface DownstreamDiscoveredTool {
  remoteName: string;
  description: string;
  inputSchema: Record<string, unknown>;
  annotations?: McpToolAnnotations;
}

export interface DownstreamDiscoverResult {
  tools: DownstreamDiscoveredTool[];
  resources: McpResource[];
  prompts: McpPrompt[];
  latencyMs: number;
  serverInfo?: { name?: string; version?: string };
}

export interface DownstreamCallResult {
  content: Array<{ type: string; text?: string; [key: string]: unknown }>;
  isError?: boolean;
  structuredContent?: Record<string, unknown>;
  latencyMs: number;
}

interface JsonRpcResponse {
  jsonrpc: string;
  id?: number | string | null;
  result?: Record<string, unknown>;
  error?: { code: number; message: string; data?: unknown };
}

interface PendingRequest {
  resolve: (value: JsonRpcResponse) => void;
  reject: (reason: Error) => void;
  timer: NodeJS.Timeout;
}

class StdioMcpConnection {
  private child: ChildProcessWithoutNullStreams | null = null;
  private buffer = '';
  private nextId = 1;
  private pending = new Map<number, PendingRequest>();
  private initialized = false;
  private initPromise: Promise<void> | null = null;
  private stderrTail: string[] = [];

  constructor(
    private readonly serverId: string,
    private readonly command: string,
    private readonly args: string[],
    private readonly env: Record<string, string>
  ) {}

  private needsWindowsShell(cmd: string): boolean {
    if (process.platform !== 'win32') return false;
    const trimmed = cmd.trim();
    if (/\.exe$/i.test(trimmed)) return false;
    // Bare commands like npx, uvx, pnpm or .cmd/.bat shims require shell on Windows
    return /\.(cmd|bat)$/i.test(trimmed) || !/[\\/]/.test(trimmed);
  }

  private ensureProcess(): void {
    if (this.child && !this.child.killed && this.child.exitCode === null) {
      return;
    }

    const useShell = this.needsWindowsShell(this.command);
    const mergedEnv = { ...process.env, ...this.env };
    this.child = spawn(this.command, this.args, {
      stdio: ['pipe', 'pipe', 'pipe'],
      env: mergedEnv,
      shell: useShell,
      windowsHide: true,
    });

    this.buffer = '';
    this.child.stdout.setEncoding('utf8');
    this.child.stdout.on('data', (chunk: string) => {
      this.buffer += chunk;
      let newlineIdx = this.buffer.indexOf('\n');
      while (newlineIdx !== -1) {
        const line = this.buffer.slice(0, newlineIdx).trim();
        this.buffer = this.buffer.slice(newlineIdx + 1);
        newlineIdx = this.buffer.indexOf('\n');
        if (!line) continue;
        this.handleLine(line);
      }
    });

    this.child.stderr.setEncoding('utf8');
    this.child.stderr.on('data', (chunk: string) => {
      const lines = chunk.split(/\r?\n/).filter(Boolean);
      this.stderrTail.push(...lines);
      if (this.stderrTail.length > 20) {
        this.stderrTail = this.stderrTail.slice(-20);
      }
    });

    this.child.on('error', (err) => {
      this.rejectAllPending(new Error(`Downstream "${this.serverId}" spawn error: ${err.message}`));
      this.initialized = false;
      this.initPromise = null;
    });

    this.child.on('exit', (code, signal) => {
      const stderrNote = this.stderrTail.length ? ` (${this.stderrTail.slice(-3).join(' | ')})` : '';
      this.rejectAllPending(
        new Error(
          `Downstream "${this.serverId}" exited (code=${code ?? 'null'}, signal=${signal ?? 'none'})${stderrNote}`
        )
      );
      this.initialized = false;
      this.initPromise = null;
      this.child = null;
    });
  }

  private handleLine(line: string): void {
    let parsed: JsonRpcResponse;
    try {
      parsed = JSON.parse(line) as JsonRpcResponse;
    } catch {
      return;
    }
    if (typeof parsed.id === 'number') {
      const pending = this.pending.get(parsed.id);
      if (pending) {
        clearTimeout(pending.timer);
        this.pending.delete(parsed.id);
        pending.resolve(parsed);
      }
    }
  }

  private rejectAllPending(err: Error): void {
    for (const [id, entry] of this.pending.entries()) {
      clearTimeout(entry.timer);
      entry.reject(err);
      this.pending.delete(id);
    }
  }

  public request(method: string, params?: Record<string, unknown>, timeoutMs = 15000): Promise<JsonRpcResponse> {
    this.ensureProcess();
    if (!this.child || !this.child.stdin.writable) {
      return Promise.reject(new Error(`Downstream "${this.serverId}" stdin is not writable.`));
    }

    const id = this.nextId++;
    const payload = JSON.stringify({
      jsonrpc: '2.0',
      id,
      method,
      ...(params !== undefined ? { params } : {}),
    });

    return new Promise<JsonRpcResponse>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`Downstream "${this.serverId}" timed out after ${timeoutMs}ms on ${method}.`));
      }, timeoutMs);

      this.pending.set(id, { resolve, reject, timer });
      this.child!.stdin.write(`${payload}\n`, (err) => {
        if (err) {
          clearTimeout(timer);
          this.pending.delete(id);
          reject(err);
        }
      });
    });
  }

  public notify(method: string, params?: Record<string, unknown>): void {
    if (!this.child || !this.child.stdin.writable) return;
    const payload = JSON.stringify({
      jsonrpc: '2.0',
      method,
      ...(params !== undefined ? { params } : {}),
    });
    this.child.stdin.write(`${payload}\n`);
  }

  public async ensureInitialized(): Promise<{ serverInfo?: { name?: string; version?: string } }> {
    if (this.initialized && this.child && this.child.exitCode === null) {
      return {};
    }
    if (this.initPromise) {
      await this.initPromise;
      return {};
    }

    let capturedServerInfo: { name?: string; version?: string } | undefined;
    this.initPromise = (async () => {
      const res = await this.request('initialize', {
        protocolVersion: '2025-03-26',
        capabilities: {},
        clientInfo: { name: 'agent-toolbox-gateway', version: '0.1.0' },
      });
      if (res.error) {
        throw new Error(`Initialize failed: ${res.error.message}`);
      }
      if (res.result?.serverInfo && typeof res.result.serverInfo === 'object') {
        capturedServerInfo = res.result.serverInfo as { name?: string; version?: string };
      }
      this.notify('notifications/initialized', {});
      this.initialized = true;
    })();

    try {
      await this.initPromise;
      return { serverInfo: capturedServerInfo };
    } finally {
      this.initPromise = null;
    }
  }

  public close(): void {
    this.rejectAllPending(new Error(`Downstream "${this.serverId}" connection closed.`));
    this.initialized = false;
    this.initPromise = null;
    if (this.child && this.child.exitCode === null) {
      this.child.kill();
    }
    this.child = null;
  }
}

async function parseHttpMcpResponse(res: Response): Promise<JsonRpcResponse> {
  const contentType = res.headers.get('content-type') || '';
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`HTTP ${res.status}: ${text.slice(0, 240)}`);
  }

  if (contentType.includes('text/event-stream')) {
    const lines = text.split(/\r?\n/);
    for (const line of lines) {
      if (line.startsWith('data:')) {
        const jsonPart = line.slice(5).trim();
        if (!jsonPart) continue;
        try {
          const parsed = JSON.parse(jsonPart) as JsonRpcResponse;
          if (parsed.id !== undefined || parsed.result !== undefined || parsed.error !== undefined) {
            return parsed;
          }
        } catch {
          // continue scanning SSE events
        }
      }
    }
    throw new Error('SSE response did not contain a JSON-RPC payload.');
  }

  if (!text.trim()) {
    return { jsonrpc: '2.0', result: {} };
  }
  return JSON.parse(text) as JsonRpcResponse;
}

class HttpMcpSession {
  private sessionId: string | null = null;
  private nextId = 1;
  private initialized = false;

  constructor(
    private readonly url: string,
    private readonly headers: Record<string, string>
  ) {}

  public async request(
    method: string,
    params?: Record<string, unknown>,
    timeoutMs = 15000
  ): Promise<JsonRpcResponse> {
    const id = this.nextId++;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const reqHeaders: Record<string, string> = {
        'Content-Type': 'application/json',
        Accept: 'application/json, text/event-stream',
        ...this.headers,
      };
      if (this.sessionId) {
        reqHeaders['Mcp-Session-Id'] = this.sessionId;
      }

      const res = await fetch(this.url, {
        method: 'POST',
        headers: reqHeaders,
        body: JSON.stringify({
          jsonrpc: '2.0',
          id,
          method,
          ...(params !== undefined ? { params } : {}),
        }),
        signal: controller.signal,
      });

      const returnedSid = res.headers.get('mcp-session-id');
      if (returnedSid) {
        this.sessionId = returnedSid;
      }
      return await parseHttpMcpResponse(res);
    } finally {
      clearTimeout(timer);
    }
  }

  public async notify(method: string, params?: Record<string, unknown>): Promise<void> {
    const reqHeaders: Record<string, string> = {
      'Content-Type': 'application/json',
      Accept: 'application/json, text/event-stream',
      ...this.headers,
    };
    if (this.sessionId) {
      reqHeaders['Mcp-Session-Id'] = this.sessionId;
    }
    await fetch(this.url, {
      method: 'POST',
      headers: reqHeaders,
      body: JSON.stringify({
        jsonrpc: '2.0',
        method,
        ...(params !== undefined ? { params } : {}),
      }),
    }).catch(() => {});
  }

  public async ensureInitialized(): Promise<{ serverInfo?: { name?: string; version?: string } }> {
    if (this.initialized) return {};
    const res = await this.request('initialize', {
      protocolVersion: '2025-03-26',
      capabilities: {},
      clientInfo: { name: 'agent-toolbox-gateway', version: '0.1.0' },
    });
    if (res.error) {
      throw new Error(`HTTP MCP initialize failed: ${res.error.message}`);
    }
    await this.notify('notifications/initialized', {});
    this.initialized = true;
    const serverInfo =
      res.result?.serverInfo && typeof res.result.serverInfo === 'object'
        ? (res.result.serverInfo as { name?: string; version?: string })
        : undefined;
    return { serverInfo };
  }
}

export class DownstreamPool {
  private stdioConnections = new Map<string, { key: string; conn: StdioMcpConnection }>();
  private httpSessions = new Map<string, { key: string; conn: HttpMcpSession }>();

  private getStdioConnection(
    server: McpServer,
    resolvedEnv: Record<string, string>
  ): StdioMcpConnection {
    const signature = JSON.stringify({
      cmd: server.commandOrUrl,
      args: server.args || [],
      env: resolvedEnv,
    });
    const existing = this.stdioConnections.get(server.id);
    if (existing && existing.key === signature) {
      return existing.conn;
    }
    if (existing) {
      existing.conn.close();
    }
    const conn = new StdioMcpConnection(server.id, server.commandOrUrl, server.args || [], resolvedEnv);
    this.stdioConnections.set(server.id, { key: signature, conn });
    return conn;
  }

  private getHttpSession(server: McpServer, resolvedHeaders: Record<string, string>): HttpMcpSession {
    const signature = JSON.stringify({ url: server.commandOrUrl, headers: resolvedHeaders });
    const existing = this.httpSessions.get(server.id);
    if (existing && existing.key === signature) {
      return existing.conn;
    }
    const conn = new HttpMcpSession(server.commandOrUrl, resolvedHeaders);
    this.httpSessions.set(server.id, { key: signature, conn });
    return conn;
  }

  public async connectAndDiscover(
    server: McpServer,
    resolvedEnv: Record<string, string>,
    resolvedHeaders: Record<string, string>
  ): Promise<DownstreamDiscoverResult> {
    const start = Date.now();
    if (server.protocol === 'stdio') {
      const conn = this.getStdioConnection(server, resolvedEnv);
      const { serverInfo } = await conn.ensureInitialized();
      const toolsRes = await conn.request('tools/list', {});
      if (toolsRes.error) {
        throw new Error(toolsRes.error.message);
      }
      const resourcesRes = await conn.request('resources/list', {}).catch(() => ({ jsonrpc: '2.0', result: {} }));
      const promptsRes = await conn.request('prompts/list', {}).catch(() => ({ jsonrpc: '2.0', result: {} }));
      return {
        tools: mapDiscoveredTools(toolsRes.result),
        resources: mapDiscoveredResources(resourcesRes.result),
        prompts: mapDiscoveredPrompts(promptsRes.result),
        latencyMs: Math.max(1, Date.now() - start),
        serverInfo,
      };
    }

    const session = this.getHttpSession(server, resolvedHeaders);
    const { serverInfo } = await session.ensureInitialized();
    const toolsRes = await session.request('tools/list', {});
    if (toolsRes.error) {
      throw new Error(toolsRes.error.message);
    }
    const resourcesRes = await session.request('resources/list', {}).catch(() => ({ jsonrpc: '2.0', result: {} }));
    const promptsRes = await session.request('prompts/list', {}).catch(() => ({ jsonrpc: '2.0', result: {} }));
    return {
      tools: mapDiscoveredTools(toolsRes.result),
      resources: mapDiscoveredResources(resourcesRes.result),
      prompts: mapDiscoveredPrompts(promptsRes.result),
      latencyMs: Math.max(1, Date.now() - start),
      serverInfo,
    };
  }

  public async ping(
    server: McpServer,
    resolvedEnv: Record<string, string>,
    resolvedHeaders: Record<string, string>
  ): Promise<number> {
    const start = Date.now();
    if (server.protocol === 'stdio') {
      const conn = this.getStdioConnection(server, resolvedEnv);
      await conn.ensureInitialized();
      const res = await conn.request('ping', {}, 8000);
      if (res.error && res.error.code !== -32601) {
        throw new Error(res.error.message);
      }
      return Math.max(1, Date.now() - start);
    }
    const session = this.getHttpSession(server, resolvedHeaders);
    await session.ensureInitialized();
    const res = await session.request('ping', {}, 8000);
    if (res.error && res.error.code !== -32601) {
      throw new Error(res.error.message);
    }
    return Math.max(1, Date.now() - start);
  }

  public async callTool(
    server: McpServer,
    remoteToolName: string,
    args: Record<string, unknown>,
    resolvedEnv: Record<string, string>,
    resolvedHeaders: Record<string, string>
  ): Promise<DownstreamCallResult> {
    const start = Date.now();
    let res: JsonRpcResponse;
    if (server.protocol === 'stdio') {
      const conn = this.getStdioConnection(server, resolvedEnv);
      await conn.ensureInitialized();
      res = await conn.request('tools/call', { name: remoteToolName, arguments: args }, 30000);
    } else {
      const session = this.getHttpSession(server, resolvedHeaders);
      await session.ensureInitialized();
      res = await session.request('tools/call', { name: remoteToolName, arguments: args }, 30000);
    }

    const latencyMs = Math.max(1, Date.now() - start);
    if (res.error) {
      throw new Error(res.error.message);
    }

    const resultObj = res.result || {};
    const content = Array.isArray(resultObj.content)
      ? (resultObj.content as Array<{ type: string; text?: string; [key: string]: unknown }>)
      : [{ type: 'text', text: JSON.stringify(resultObj, null, 2) }];

    return {
      content,
      isError: Boolean(resultObj.isError),
      structuredContent:
        resultObj.structuredContent && typeof resultObj.structuredContent === 'object'
          ? (resultObj.structuredContent as Record<string, unknown>)
          : undefined,
      latencyMs,
    };
  }

  public disconnect(serverId: string): void {
    const stdio = this.stdioConnections.get(serverId);
    if (stdio) {
      stdio.conn.close();
      this.stdioConnections.delete(serverId);
    }
    this.httpSessions.delete(serverId);
  }

  public disconnectAll(): void {
    for (const entry of this.stdioConnections.values()) {
      entry.conn.close();
    }
    this.stdioConnections.clear();
    this.httpSessions.clear();
  }
}

function mapDiscoveredTools(result?: Record<string, unknown>): DownstreamDiscoveredTool[] {
  const rawTools = Array.isArray(result?.tools) ? result.tools : [];
  const out: DownstreamDiscoveredTool[] = [];
  for (const item of rawTools) {
    if (!item || typeof item !== 'object') continue;
    const obj = item as Record<string, unknown>;
    const name = typeof obj.name === 'string' ? obj.name.trim() : '';
    if (!name) continue;
    out.push({
      remoteName: name,
      description: typeof obj.description === 'string' ? obj.description : `Downstream tool ${name}`,
      inputSchema:
        obj.inputSchema && typeof obj.inputSchema === 'object'
          ? (obj.inputSchema as Record<string, unknown>)
          : { type: 'object', properties: {} },
      annotations:
        obj.annotations && typeof obj.annotations === 'object'
          ? (obj.annotations as McpToolAnnotations)
          : undefined,
    });
  }
  return out;
}

function mapDiscoveredResources(result?: Record<string, unknown>): McpResource[] {
  const raw = Array.isArray(result?.resources) ? result.resources : [];
  return raw
    .filter((r): r is Record<string, unknown> => Boolean(r && typeof r === 'object'))
    .map((r) => ({
      uri: String(r.uri || ''),
      name: String(r.name || r.uri || 'resource'),
      mimeType: String(r.mimeType || 'text/plain'),
      description: String(r.description || ''),
    }))
    .filter((r) => Boolean(r.uri));
}

function mapDiscoveredPrompts(result?: Record<string, unknown>): McpPrompt[] {
  const raw = Array.isArray(result?.prompts) ? result.prompts : [];
  return raw
    .filter((p): p is Record<string, unknown> => Boolean(p && typeof p === 'object'))
    .map((p) => ({
      name: String(p.name || ''),
      description: String(p.description || ''),
      arguments: Array.isArray(p.arguments)
        ? (p.arguments as McpPrompt['arguments'])
        : undefined,
    }))
    .filter((p) => Boolean(p.name));
}

export const downstreamPool = new DownstreamPool();
