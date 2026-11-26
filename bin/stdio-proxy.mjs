#!/usr/bin/env node
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import readline from 'node:readline';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const WORKSPACE_ROOT = path.resolve(__dirname, '..');
const require = createRequire(import.meta.url);

function getFlagValue(args, flag) {
  const idx = args.indexOf(flag);
  if (idx !== -1 && idx + 1 < args.length) return args[idx + 1];
  const eqPrefix = `${flag}=`;
  const eqMatch = args.find((a) => a.startsWith(eqPrefix));
  return eqMatch ? eqMatch.slice(eqPrefix.length) : undefined;
}

function getToolboxHomeDir() {
  return process.env.TOOLBOX_HOME
    ? path.resolve(process.env.TOOLBOX_HOME)
    : path.join(os.homedir(), '.agent-toolbox');
}

function isProcessAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return err && err.code === 'EPERM';
  }
}

function readDaemonLock() {
  const lockPath = path.join(getToolboxHomeDir(), 'daemon.lock');
  if (!fs.existsSync(lockPath)) return null;
  try {
    const parsed = JSON.parse(fs.readFileSync(lockPath, 'utf8'));
    if (typeof parsed.pid !== 'number' || typeof parsed.port !== 'number') return null;
    if (!isProcessAlive(parsed.pid)) return null;
    return parsed;
  } catch {
    return null;
  }
}

function isRunningInsideWsl() {
  if (process.platform !== 'linux') return false;
  if (process.env.WSL_DISTRO_NAME || process.env.WSL_INTEROP) return true;
  try {
    return /microsoft|wsl/i.test(fs.readFileSync('/proc/version', 'utf8'));
  } catch {
    return false;
  }
}

function getWslHostGatewayIp() {
  try {
    const resolv = fs.readFileSync('/etc/resolv.conf', 'utf8');
    const match = resolv.match(/^nameserver\s+([0-9.]+)/m);
    return match ? match[1] : null;
  } catch {
    return null;
  }
}

async function probeHealth(baseUrl, timeoutMs = 1200) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(`${baseUrl.replace(/\/+$/, '')}/health`, { signal: controller.signal });
    if (!res.ok) return false;
    const data = await res.json();
    return data && data.status === 'ok' && data.mode === 'agent-toolbox-gateway';
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

async function ensureGatewayBaseUrl(options) {
  if (options.explicitUrl) {
    return options.explicitUrl.replace(/\/+$/, '');
  }
  if (process.env.TOOLBOX_GATEWAY_URL) {
    return process.env.TOOLBOX_GATEWAY_URL.replace(/\/+$/, '');
  }

  const preferredPort = options.port;
  const lock = readDaemonLock();
  const candidates = [`http://127.0.0.1:${lock?.port ?? preferredPort}`];
  if (lock?.port && lock.port !== preferredPort) {
    candidates.push(`http://127.0.0.1:${preferredPort}`);
  }
  if (isRunningInsideWsl()) {
    const hostIp = getWslHostGatewayIp();
    if (hostIp) {
      candidates.push(`http://${hostIp}:${preferredPort}`);
    }
  }

  for (const url of candidates) {
    if (await probeHealth(url)) {
      return url;
    }
  }

  // Spawn local daemon when none is running
  const serverTs = path.resolve(WORKSPACE_ROOT, 'server.ts');
  if (!fs.existsSync(serverTs)) {
    throw new Error(`Cannot locate server.ts at ${serverTs} to start toolbox-gateway daemon.`);
  }
  const tsxCliPath = require.resolve('tsx/cli');
  const stateDir = getToolboxHomeDir();
  if (!fs.existsSync(stateDir)) {
    fs.mkdirSync(stateDir, { recursive: true });
  }
  const logFd = fs.openSync(path.join(stateDir, 'daemon.log'), 'a');
  const hasDist = fs.existsSync(path.resolve(WORKSPACE_ROOT, 'dist', 'index.html'));
  const spawnArgs = [tsxCliPath, serverTs, ...(hasDist ? ['--production'] : [])];

  const child = spawn(process.execPath, spawnArgs, {
    cwd: WORKSPACE_ROOT,
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

  const localUrl = `http://127.0.0.1:${preferredPort}`;
  const deadline = Date.now() + 15000;
  while (Date.now() < deadline) {
    if (await probeHealth(localUrl, 1000)) {
      return localUrl;
    }
    await new Promise((r) => setTimeout(r, 180));
  }
  throw new Error(`Timed out waiting for Agent-Toolbox daemon at ${localUrl}`);
}

async function subscribeNotifications(baseUrl, host, abortSignal) {
  const sseUrl = `${baseUrl}/api/mcp/sse?host=${encodeURIComponent(host)}`;
  while (!abortSignal.aborted) {
    try {
      const res = await fetch(sseUrl, {
        headers: { Accept: 'text/event-stream', 'X-Toolbox-Host': host },
        signal: abortSignal,
      });
      if (!res.ok || !res.body) {
        await new Promise((r) => setTimeout(r, 1500));
        continue;
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let currentEvent = 'message';

      while (!abortSignal.aborted) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });

        let newlineIdx = buffer.indexOf('\n');
        while (newlineIdx !== -1) {
          const line = buffer.slice(0, newlineIdx).replace(/\r$/, '');
          buffer = buffer.slice(newlineIdx + 1);
          newlineIdx = buffer.indexOf('\n');

          if (line === '') {
            currentEvent = 'message';
          } else if (line.startsWith('event:')) {
            currentEvent = line.slice(6).trim();
          } else if (line.startsWith('data:') && currentEvent === 'message') {
            const payload = line.slice(5).trim();
            if (payload.startsWith('{')) {
              process.stdout.write(`${payload}\n`);
            }
          }
        }
      }
    } catch {
      if (abortSignal.aborted) break;
      await new Promise((r) => setTimeout(r, 1500));
    }
  }
}

async function main() {
  const args = process.argv.slice(2);
  const host = getFlagValue(args, '--host') || 'codex';
  const port = Number(getFlagValue(args, '--port') || process.env.PORT || 3000);
  const explicitUrl = getFlagValue(args, '--url');

  const baseUrl = await ensureGatewayBaseUrl({ port, explicitUrl });
  const abortController = new AbortController();
  void subscribeNotifications(baseUrl, host, abortController.signal);

  const rl = readline.createInterface({
    input: process.stdin,
    crlfDelay: Infinity,
  });

  let inFlight = Promise.resolve();

  rl.on('line', (rawLine) => {
    const line = rawLine.trim();
    if (!line) return;

    inFlight = inFlight.then(async () => {
      let parsed;
      try {
        parsed = JSON.parse(line);
      } catch {
        process.stdout.write(
          `${JSON.stringify({
            jsonrpc: '2.0',
            id: null,
            error: { code: -32700, message: 'Parse error: invalid JSON on stdin.' },
          })}\n`
        );
        return;
      }

      try {
        const res = await fetch(`${baseUrl}/api/mcp?host=${encodeURIComponent(host)}`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Accept: 'application/json',
            'X-Toolbox-Host': host,
          },
          body: JSON.stringify(parsed),
        });
        if (res.status === 202 || res.status === 204) return;
        const text = await res.text();
        if (text.trim()) {
          process.stdout.write(`${text.trim()}\n`);
        }
      } catch (err) {
        const reqId =
          parsed && typeof parsed === 'object' && 'id' in parsed ? parsed.id ?? null : null;
        if (reqId !== null) {
          process.stdout.write(
            `${JSON.stringify({
              jsonrpc: '2.0',
              id: reqId,
              error: {
                code: -32006,
                message: `Gateway forward error: ${err instanceof Error ? err.message : String(err)}`,
              },
            })}\n`
          );
        }
      }
    });
  });

  rl.on('close', () => {
    inFlight.finally(() => {
      abortController.abort();
      process.exit(0);
    });
  });

  process.on('SIGINT', () => {
    abortController.abort();
    process.exit(0);
  });
  process.on('SIGTERM', () => {
    abortController.abort();
    process.exit(0);
  });
}

main().catch((err) => {
  process.stderr.write(`[agent-toolbox stdio-proxy] ${err instanceof Error ? err.message : String(err)}\n`);
  process.exit(1);
});
