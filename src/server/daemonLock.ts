import { spawn } from 'child_process';
import { createRequire } from 'module';
import fs from 'fs';
import os from 'os';
import path from 'path';

const require = createRequire(import.meta.url);

export interface DaemonLockInfo {
  pid: number;
  port: number;
  startedAt: string;
  workspaceRoot: string;
}

export function getToolboxHomeDir(): string {
  return process.env.TOOLBOX_HOME
    ? path.resolve(process.env.TOOLBOX_HOME)
    : path.join(os.homedir(), '.agent-toolbox');
}

export function getDaemonLockPath(): string {
  return path.join(getToolboxHomeDir(), 'daemon.lock');
}

export function getDaemonLogPath(): string {
  return path.join(getToolboxHomeDir(), 'daemon.log');
}

export function isProcessAlive(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (err: unknown) {
    const code = (err as NodeJS.ErrnoException)?.code;
    return code === 'EPERM';
  }
}

export function readDaemonLock(): DaemonLockInfo | null {
  const lockPath = getDaemonLockPath();
  if (!fs.existsSync(lockPath)) return null;
  try {
    const raw = fs.readFileSync(lockPath, 'utf8');
    const parsed = JSON.parse(raw) as DaemonLockInfo;
    if (typeof parsed.pid !== 'number' || typeof parsed.port !== 'number') {
      return null;
    }
    if (!isProcessAlive(parsed.pid)) {
      fs.unlinkSync(lockPath);
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

export function writeDaemonLock(info: DaemonLockInfo): void {
  const dir = getToolboxHomeDir();
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  fs.writeFileSync(getDaemonLockPath(), JSON.stringify(info, null, 2), 'utf8');
}

export function removeDaemonLockIfOwner(pid = process.pid): void {
  const lockPath = getDaemonLockPath();
  if (!fs.existsSync(lockPath)) return;
  try {
    const parsed = JSON.parse(fs.readFileSync(lockPath, 'utf8')) as Partial<DaemonLockInfo>;
    if (parsed.pid === pid) {
      fs.unlinkSync(lockPath);
    }
  } catch {
    // ignore lock cleanup failure
  }
}

export async function probeDaemonHealth(port: number, timeoutMs = 1200): Promise<boolean> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(`http://127.0.0.1:${port}/health`, {
      signal: controller.signal,
    });
    if (!res.ok) return false;
    const data = (await res.json()) as { status?: string; mode?: string };
    return data.status === 'ok' && data.mode === 'agent-toolbox-gateway';
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

export async function ensureDaemonRunning(options?: {
  port?: number;
  workspaceRoot?: string;
}): Promise<{ baseUrl: string; spawned: boolean }> {
  const preferredPort = options?.port ?? Number(process.env.PORT || 3000);
  const lock = readDaemonLock();
  const activePort = lock?.port ?? preferredPort;

  if (await probeDaemonHealth(activePort)) {
    return { baseUrl: `http://127.0.0.1:${activePort}`, spawned: false };
  }

  const workspaceRoot = options?.workspaceRoot || process.cwd();
  const serverTs = path.resolve(workspaceRoot, 'server.ts');
  if (!fs.existsSync(serverTs)) {
    throw new Error(`Cannot locate server.ts at ${serverTs} to start toolbox-gateway daemon.`);
  }

  let tsxCliPath: string;
  try {
    tsxCliPath = require.resolve('tsx/cli');
  } catch {
    throw new Error('Cannot resolve tsx/cli to start toolbox-gateway daemon.');
  }

  const stateDir = getToolboxHomeDir();
  if (!fs.existsSync(stateDir)) {
    fs.mkdirSync(stateDir, { recursive: true });
  }
  const logFd = fs.openSync(getDaemonLogPath(), 'a');
  const hasDist = fs.existsSync(path.resolve(workspaceRoot, 'dist', 'index.html'));
  const args = [tsxCliPath, serverTs, ...(hasDist ? ['--production'] : [])];

  const child = spawn(process.execPath, args, {
    cwd: workspaceRoot,
    env: {
      ...process.env,
      PORT: String(preferredPort),
      TOOLBOX_DAEMON: '1',
    },
    detached: true,
    stdio: ['ignore', logFd, logFd],
    windowsHide: true,
  });
  child.unref();
  fs.closeSync(logFd);

  const deadline = Date.now() + 15000;
  while (Date.now() < deadline) {
    if (await probeDaemonHealth(preferredPort, 1000)) {
      return { baseUrl: `http://127.0.0.1:${preferredPort}`, spawned: true };
    }
    await new Promise((r) => setTimeout(r, 180));
  }

  throw new Error(
    `Timed out waiting for toolbox-gateway daemon on port ${preferredPort}. See ${getDaemonLogPath()}`
  );
}
