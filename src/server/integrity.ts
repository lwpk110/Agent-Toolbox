import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

export interface FingerprintedTool {
  name: string;
  description?: string;
  inputSchema?: Record<string, unknown>;
}

export interface ServerLockEntry {
  fingerprint: string;
  tools: Record<string, string>;
  lockedAt: string;
}

export interface ToolboxLock {
  lockVersion: 1;
  servers: Record<string, ServerLockEntry>;
}

function ordered(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(ordered);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map(key => [key, ordered((value as Record<string, unknown>)[key])]));
  }
  return value;
}

export function canonicalJson(value: unknown): string {
  return JSON.stringify(ordered(value));
}

function sha256(value: string): string {
  return crypto.createHash('sha256').update(value).digest('hex');
}

export function toolFingerprint(tool: FingerprintedTool): string {
  return sha256(canonicalJson({ name: tool.name, description: tool.description ?? '', inputSchema: tool.inputSchema ?? {} }));
}

export function serverFingerprint(tools: FingerprintedTool[]): string {
  return sha256([...tools].sort((a, b) => a.name < b.name ? -1 : a.name > b.name ? 1 : 0).map(tool => `${tool.name}:${toolFingerprint(tool)}\n`).join(''));
}

function isHexHash(value: unknown): value is string {
  return typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
}

function parseLock(value: unknown): ToolboxLock {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('lock file must contain an object');
  const record = value as Record<string, unknown>;
  if (record.lockVersion !== 1) throw new Error(`unsupported lockVersion: ${String(record.lockVersion)}`);
  if (!record.servers || typeof record.servers !== 'object' || Array.isArray(record.servers)) throw new Error('lock servers must be an object');
  const servers: Record<string, ServerLockEntry> = {};
  for (const [id, raw] of Object.entries(record.servers as Record<string, unknown>)) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error(`invalid lock entry for ${id}`);
    const entry = raw as Record<string, unknown>;
    if (!isHexHash(entry.fingerprint) || !entry.tools || typeof entry.tools !== 'object' || Array.isArray(entry.tools) || typeof entry.lockedAt !== 'string') {
      throw new Error(`invalid lock entry for ${id}`);
    }
    const tools: Record<string, string> = {};
    for (const [name, fingerprint] of Object.entries(entry.tools as Record<string, unknown>)) {
      if (!isHexHash(fingerprint)) throw new Error(`invalid tool fingerprint for ${id}/${name}`);
      tools[name] = fingerprint;
    }
    servers[id] = { fingerprint: entry.fingerprint, tools, lockedAt: entry.lockedAt };
  }
  return { lockVersion: 1, servers };
}

function sortRecord<T>(record: Record<string, T>): Record<string, T> {
  return Object.fromEntries(Object.keys(record).sort().map(key => [key, record[key]]));
}

export class ToolboxLockFile {
  readonly file: string;
  readonly valid: boolean;
  private lock: ToolboxLock;

  constructor(file = process.env.TOOLBOX_LOCK_FILE || './toolbox.lock.json') {
    this.file = path.resolve(file);
    this.lock = { lockVersion: 1, servers: {} };
    this.valid = this.read();
  }

  private read(): boolean {
    try {
      const parsed: unknown = JSON.parse(fs.readFileSync(this.file, 'utf8'));
      this.lock = parseLock(parsed);
      return true;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return true;
      console.error(`[integrity] Invalid lock file ${this.file}: ${String(error)}`);
      return false;
    }
  }

  get(serverId: string): ServerLockEntry | undefined {
    return this.lock.servers[serverId];
  }

  writeServer(serverId: string, tools: FingerprintedTool[]): ServerLockEntry {
    if (!this.valid) throw new Error(`Refusing to overwrite invalid lock file ${this.file}`);
    const entry: ServerLockEntry = {
      fingerprint: serverFingerprint(tools),
      tools: sortRecord(Object.fromEntries(tools.map(tool => [tool.name, toolFingerprint(tool)]))),
      lockedAt: new Date().toISOString(),
    };
    this.lock = { lockVersion: 1, servers: { ...this.lock.servers, [serverId]: entry } };
    const serverEntries = Object.fromEntries(Object.entries(this.lock.servers).map(([id, server]) => [id, {
      fingerprint: server.fingerprint,
      lockedAt: server.lockedAt,
      tools: sortRecord(server.tools),
    }])) as Record<string, ServerLockEntry>;
    const normalized: ToolboxLock = {
      lockVersion: 1,
      servers: sortRecord(serverEntries),
    };
    const directory = path.dirname(this.file);
    const temporary = `${this.file}.${process.pid}.${crypto.randomBytes(6).toString('hex')}.tmp`;
    try {
      fs.mkdirSync(directory, { recursive: true });
      fs.writeFileSync(temporary, `${JSON.stringify(normalized, null, 2)}\n`, { mode: 0o600 });
      fs.renameSync(temporary, this.file);
    } catch (error) {
      try { fs.rmSync(temporary, { force: true }); } catch {}
      throw error;
    }
    this.lock = normalized;
    return entry;
  }
}

export function unifiedDiff(label: string, before: string, after: string): string {
  if (before === after) return '';
  const oldLines = before.split('\n');
  const liveLines = after.split('\n');
  return `--- locked/${label}\n+++ live/${label}\n@@ -1,${oldLines.length} +1,${liveLines.length} @@\n${oldLines.map(line => `-${line}`).join('\n')}\n${liveLines.map(line => `+${line}`).join('\n')}`;
}
