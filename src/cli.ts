#!/usr/bin/env node
import path from 'path';
import readline from 'readline';
import { fileURLToPath } from 'url';
import {
  getCodexIntegrationStatus,
  installAgentToolboxToCodex,
  normalizeTargetPlatform,
  uninstallAgentToolboxFromCodex,
} from './server/adapters/codex';
import { ensureDaemonRunning, probeDaemonHealth, readDaemonLock } from './server/daemonLock';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const WORKSPACE_ROOT = path.resolve(__dirname, '..');

function getFlagValue(args: string[], flag: string): string | undefined {
  const idx = args.indexOf(flag);
  if (idx !== -1 && idx + 1 < args.length) {
    return args[idx + 1];
  }
  const eqPrefix = `${flag}=`;
  const eqMatch = args.find((a) => a.startsWith(eqPrefix));
  return eqMatch ? eqMatch.slice(eqPrefix.length) : undefined;
}

function hasFlag(args: string[], flag: string): boolean {
  return args.includes(flag);
}

async function subscribeNotifications(
  baseUrl: string,
  host: string,
  abortSignal: AbortSignal
): Promise<void> {
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

async function runStdioProxy(args: string[]): Promise<void> {
  const host = getFlagValue(args, '--host') || 'codex';
  const port = Number(getFlagValue(args, '--port') || process.env.PORT || 3000);

  const { baseUrl } = await ensureDaemonRunning({
    port,
    workspaceRoot: WORKSPACE_ROOT,
  });

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
      let parsed: unknown;
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

        if (res.status === 202 || res.status === 204) {
          return;
        }
        const text = await res.text();
        if (text.trim()) {
          process.stdout.write(`${text.trim()}\n`);
        }
      } catch (err) {
        const reqId =
          parsed && typeof parsed === 'object' && 'id' in parsed
            ? (parsed as { id?: unknown }).id ?? null
            : null;
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

async function main() {
  const [, , command, ...rest] = process.argv;
  const port = Number(getFlagValue(rest, '--port') || process.env.PORT || 3000);

  if (command === 'serve') {
    if (!hasFlag(rest, '--stdio')) {
      console.error('Usage: agent-toolbox serve --stdio [--host codex] [--port 3000]');
      process.exit(1);
    }
    await runStdioProxy(rest);
    return;
  }

  if (command === 'install') {
    const host = (getFlagValue(rest, '--host') || 'codex').toLowerCase();
    const transport = getFlagValue(rest, '--transport') === 'http' ? 'http' : 'stdio';
    const platformArg = getFlagValue(rest, '--platform');
    const targetPlatform = platformArg ? normalizeTargetPlatform(platformArg) : undefined;
    const wslDistro = getFlagValue(rest, '--distro');
    if (host !== 'codex') {
      console.error(`Host "${host}" installation is not wired yet. Currently supported: codex.`);
      process.exit(1);
    }
    const result = installAgentToolboxToCodex({
      transport,
      port,
      workspaceRoot: WORKSPACE_ROOT,
      targetPlatform,
      wslDistro,
    });
    if (!result.ok) {
      console.error(result.error || 'Failed to install Codex config.');
      console.log('\nGenerated TOML snippet:\n' + result.tomlBlock);
      process.exit(1);
    }
    console.log(`Installed Agent-Toolbox into Codex CLI (${result.targetPlatform}, ${result.transport})`);
    console.log(`Config: ${result.configPath}`);
    if (result.backupPath) console.log(`Backup: ${result.backupPath}`);
    console.log('\n' + result.tomlBlock);
    return;
  }

  if (command === 'uninstall') {
    const host = (getFlagValue(rest, '--host') || 'codex').toLowerCase();
    const platformArg = getFlagValue(rest, '--platform');
    const targetPlatform = platformArg ? normalizeTargetPlatform(platformArg) : undefined;
    const wslDistro = getFlagValue(rest, '--distro');
    if (host !== 'codex') {
      console.error(`Host "${host}" uninstall is not wired yet. Currently supported: codex.`);
      process.exit(1);
    }
    const res = uninstallAgentToolboxFromCodex({ targetPlatform, wslDistro });
    if (!res.ok) {
      console.error(res.error || 'Failed to uninstall Codex config.');
      process.exit(1);
    }
    console.log(
      res.removed
        ? `Removed [mcp_servers.agent-toolbox] from ${res.configPath}`
        : `No [mcp_servers.agent-toolbox] entry found in ${res.configPath}`
    );
    return;
  }

  if (command === 'import') {
    const host = (getFlagValue(rest, '--host') || 'codex').toLowerCase();
    const platformArg = getFlagValue(rest, '--platform');
    const targetPlatform = platformArg ? normalizeTargetPlatform(platformArg) : undefined;
    const wslDistro = getFlagValue(rest, '--distro');
    if (host !== 'codex') {
      console.error(`Host "${host}" import is not wired yet. Currently supported: codex.`);
      process.exit(1);
    }
    const { baseUrl } = await ensureDaemonRunning({ port, workspaceRoot: WORKSPACE_ROOT });
    const res = await fetch(`${baseUrl}/api/v1/hosts/codex/import-servers`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ targetPlatform, wslDistro }),
    });
    const json = await res.json();
    console.log(JSON.stringify(json, null, 2));
    return;
  }

  if (command === 'status') {
    const platformArg = getFlagValue(rest, '--platform');
    const targetPlatform = platformArg ? normalizeTargetPlatform(platformArg) : undefined;
    const wslDistro = getFlagValue(rest, '--distro');
    const lock = readDaemonLock();
    const healthy = await probeDaemonHealth(lock?.port ?? port);
    const codex = getCodexIntegrationStatus({
      port,
      workspaceRoot: WORKSPACE_ROOT,
      targetPlatform,
      wslDistro,
    });
    console.log(
      JSON.stringify(
        {
          daemon: {
            healthy,
            port: lock?.port ?? port,
            pid: lock?.pid ?? null,
          },
          codex: {
            detectedPlatform: codex.detectedPlatform,
            targetPlatform: codex.targetPlatform,
            wslDistro: codex.wslDistro,
            wslDistros: codex.wslDistros,
            canDirectWrite: codex.canDirectWrite,
            cliInstalled: codex.cliInstalled,
            cliVersion: codex.cliVersion,
            configPath: codex.configPath,
            registeredInCodex: codex.registeredInCodex,
            registeredTransport: codex.registeredTransport,
            discoveredServerCount: codex.discoveredServers.length,
          },
        },
        null,
        2
      )
    );
    return;
  }

  console.log(`Agent-Toolbox CLI

Usage:
  tsx src/cli.ts serve --stdio [--host codex] [--port 3000]
  tsx src/cli.ts install --host codex [--transport stdio|http]
  tsx src/cli.ts uninstall --host codex
  tsx src/cli.ts import --host codex
  tsx src/cli.ts status`);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
