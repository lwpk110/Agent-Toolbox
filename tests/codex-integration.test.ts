import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  buildCodexTomlBlock,
  decodeWslOutput,
  detectCurrentPlatform,
  getCodexIntegrationStatus,
  installAgentToolboxToCodex,
  parseCodexMcpServersFromToml,
  toWslMountPath,
  uninstallAgentToolboxFromCodex,
} from '../src/server/adapters/codex';
import { ensureDaemonRunning } from '../src/server/daemonLock';

const WORKSPACE_ROOT = path.resolve(import.meta.dirname, '..');

test('Codex TOML parser & surgical installer preserve existing config', () => {
  const tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'toolbox-codex-test-'));
  const prevCodexHome = process.env.CODEX_HOME;
  process.env.CODEX_HOME = tmpHome;

  try {
    const configPath = path.join(tmpHome, 'config.toml');
    const initialToml = [
      '# User top-level settings',
      'model = "gpt-5.4"',
      '',
      '[mcp_servers.figma]',
      'url = "https://mcp.figma.com/mcp"',
      '',
      '[mcp_servers.custom-stdio]',
      'command = "node"',
      'args = ["server.mjs", "--port", "9000"]',
      '',
      '[mcp_servers.custom-stdio.env]',
      'API_KEY = "secret-value-123456"',
      '',
      '[features]',
      'js_repl = true',
      '',
    ].join('\n');
    fs.writeFileSync(configPath, initialToml, 'utf8');

    const installRes = installAgentToolboxToCodex({
      transport: 'stdio',
      port: 3198,
      workspaceRoot: WORKSPACE_ROOT,
    });
    assert.equal(installRes.ok, true);
    assert.equal(installRes.transport, 'stdio');

    const afterInstall = fs.readFileSync(configPath, 'utf8');
    assert.match(afterInstall, /model = "gpt-5\.4"/);
    assert.match(afterInstall, /\[features\]/);
    assert.match(afterInstall, /\[mcp_servers\.agent-toolbox\]/);

    const parsed = parseCodexMcpServersFromToml(afterInstall);
    const names = parsed.map((s) => s.name);
    assert.deepEqual(names, ['figma', 'custom-stdio', 'agent-toolbox']);

    const custom = parsed.find((s) => s.name === 'custom-stdio');
    assert.deepEqual(custom?.args, ['server.mjs', '--port', '9000']);
    assert.equal(custom?.env.API_KEY, 'secret-value-123456');

    const status = getCodexIntegrationStatus({
      port: 3198,
      gatewayServerIds: ['github'],
      workspaceRoot: WORKSPACE_ROOT,
    });
    assert.equal(status.registeredInCodex, true);
    assert.equal(status.registeredTransport, 'stdio');
    // Ensure raw secret values are never exposed in status
    assert.equal(JSON.stringify(status).includes('secret-value-123456'), false);

    const uninstallRes = uninstallAgentToolboxFromCodex();
    assert.equal(uninstallRes.removed, true);
    const afterUninstall = fs.readFileSync(configPath, 'utf8');
    assert.equal(afterUninstall.includes('agent-toolbox'), false);
    assert.match(afterUninstall, /\[mcp_servers\.figma\]/);
    assert.match(afterUninstall, /\[features\]/);
  } finally {
    if (prevCodexHome === undefined) delete process.env.CODEX_HOME;
    else process.env.CODEX_HOME = prevCodexHome;
    fs.rmSync(tmpHome, { recursive: true, force: true });
  }
});

test('Codex stdio-proxy + single daemon + real downstream MCP server end-to-end', async () => {
  const testPort = 3299;
  const tmpToolboxHome = fs.mkdtempSync(path.join(os.tmpdir(), 'toolbox-daemon-test-'));
  const prevToolboxHome = process.env.TOOLBOX_HOME;
  process.env.TOOLBOX_HOME = tmpToolboxHome;

  // Tiny real downstream stdio MCP server for end-to-end proxy verification
  const mockDownstreamPath = path.join(tmpToolboxHome, 'echo-mcp.mjs');
  fs.writeFileSync(
    mockDownstreamPath,
    `
import readline from 'node:readline';
const rl = readline.createInterface({ input: process.stdin });
rl.on('line', (line) => {
  if (!line.trim()) return;
  const req = JSON.parse(line);
  if (req.id === undefined) return;
  if (req.method === 'initialize') {
    process.stdout.write(JSON.stringify({
      jsonrpc: '2.0',
      id: req.id,
      result: {
        protocolVersion: '2025-03-26',
        capabilities: { tools: {} },
        serverInfo: { name: 'echo-mcp', version: '1.0.0' }
      }
    }) + '\\n');
  } else if (req.method === 'tools/list') {
    process.stdout.write(JSON.stringify({
      jsonrpc: '2.0',
      id: req.id,
      result: {
        tools: [{
          name: 'echo',
          description: 'Echoes text from real downstream stdio MCP server',
          inputSchema: { type: 'object', properties: { text: { type: 'string' } }, required: ['text'] },
          annotations: { readOnlyHint: true }
        }]
      }
    }) + '\\n');
  } else if (req.method === 'tools/call') {
    process.stdout.write(JSON.stringify({
      jsonrpc: '2.0',
      id: req.id,
      result: {
        content: [{ type: 'text', text: 'ECHO:' + (req.params?.arguments?.text || '') + ' token=ghp_1234567890abcdef1234567890' }]
      }
    }) + '\\n');
  } else {
    process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: req.id, result: {} }) + '\\n');
  }
});
`,
    'utf8'
  );

  // Start the daemon on testPort via ensureDaemonRunning
  const daemon = await ensureDaemonRunning({ port: testPort, workspaceRoot: WORKSPACE_ROOT });
  const proxy = spawn(
    process.execPath,
    [path.join(WORKSPACE_ROOT, 'bin', 'stdio-proxy.mjs'), '--host', 'codex', '--port', String(testPort)],
    {
      cwd: WORKSPACE_ROOT,
      env: { ...process.env, TOOLBOX_HOME: tmpToolboxHome },
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true,
    }
  );

  const receivedLines: Array<Record<string, unknown>> = [];
  let stdoutBuf = '';
  proxy.stdout.setEncoding('utf8');
  proxy.stdout.on('data', (chunk: string) => {
    stdoutBuf += chunk;
    let idx = stdoutBuf.indexOf('\n');
    while (idx !== -1) {
      const line = stdoutBuf.slice(0, idx).trim();
      stdoutBuf = stdoutBuf.slice(idx + 1);
      idx = stdoutBuf.indexOf('\n');
      if (line) receivedLines.push(JSON.parse(line));
    }
  });

  const sendAndWait = (payload: Record<string, unknown>): Promise<Record<string, unknown>> => {
    const id = payload.id;
    proxy.stdin.write(`${JSON.stringify(payload)}\n`);
    return new Promise((resolve, reject) => {
      const start = Date.now();
      const poll = setInterval(() => {
        const found = receivedLines.find((m) => m.id === id);
        if (found) {
          clearInterval(poll);
          resolve(found);
        } else if (Date.now() - start > 8000) {
          clearInterval(poll);
          reject(new Error(`Timed out waiting for id=${String(id)}`));
        }
      }, 25);
    });
  };

  try {
    // 1. Initialize & handshake
    const initRes = await sendAndWait({
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: {
        protocolVersion: '2025-03-26',
        capabilities: {},
        clientInfo: { name: 'codex-mcp-client', version: '0.169.0' },
      },
    });
    assert.equal((initRes.result as Record<string, unknown>)?.protocolVersion, '2025-03-26');
    proxy.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized', params: {} })}\n`);

    // 2. tools/list returns meta-tools + pinned tools
    const listRes = await sendAndWait({ jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} });
    const tools = ((listRes.result as Record<string, unknown>)?.tools || []) as Array<{ name: string }>;
    assert.ok(tools.some((t) => t.name === 'toolbox__discover_capabilities'));
    assert.ok(tools.some((t) => t.name === 'toolbox__call_tool'));
    assert.ok(tools.some((t) => t.name === 'toolbox__remember'));

    // 3. Load Skill and confirm notification or result
    const loadRes = await sendAndWait({
      jsonrpc: '2.0',
      id: 3,
      method: 'tools/call',
      params: { name: 'toolbox__load_skill', arguments: { skillId: 'security-owasp-auditor' } },
    });
    const loadText = (((loadRes.result as Record<string, unknown>)?.content as Array<{ text: string }>)?.[0]?.text) || '';
    assert.match(loadText, /security-owasp-auditor/);

    // 4. Codex audit scope blocks destructive tool
    const blockedRes = await sendAndWait({
      jsonrpc: '2.0',
      id: 4,
      method: 'tools/call',
      params: {
        name: 'toolbox__call_tool',
        arguments: { toolName: 'github__delete_repo', arguments: { repo: 'org/test' } },
      },
    });
    assert.equal((blockedRes.result as Record<string, unknown>)?.isError, true);

    // 5. Add real downstream echo MCP server, sync its tools, and invoke via toolbox__call_tool with redaction!
    const addRes = await fetch(`${daemon.baseUrl}/api/v1/servers`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'echo-test',
        protocol: 'stdio',
        commandOrUrl: process.execPath,
        args: [mockDownstreamPath],
        defaultMode: 'lazy',
      }),
    });
    assert.equal(addRes.ok, true);

    const pingRes = await fetch(`${daemon.baseUrl}/api/v1/servers/echo-test/ping`, { method: 'POST' });
    const pingJson = (await pingRes.json()) as { syncOk: boolean; discoveredCount: number };
    assert.equal(pingJson.syncOk, true);
    assert.equal(pingJson.discoveredCount, 1);

    const echoCallRes = await sendAndWait({
      jsonrpc: '2.0',
      id: 5,
      method: 'tools/call',
      params: {
        name: 'toolbox__call_tool',
        arguments: { toolName: 'echo_test__echo', arguments: { text: 'hello-codex' } },
      },
    });
    const echoText =
      (((echoCallRes.result as Record<string, unknown>)?.content as Array<{ text: string }>)?.[0]?.text) || '';
    assert.match(echoText, /ECHO:hello-codex/);
    assert.match(echoText, /\[REDACTED_BY_TOOLBOX\]/);
    assert.equal(echoText.includes('ghp_1234567890abcdef1234567890'), false);

    // 6. Codex writes shared memory via toolbox__remember
    const remRes = await sendAndWait({
      jsonrpc: '2.0',
      id: 6,
      method: 'tools/call',
      params: {
        name: 'toolbox__remember',
        arguments: { topic: 'Codex Test', content: 'Verified Codex stdio bridge end-to-end.' },
      },
    });
    const remText = (((remRes.result as Record<string, unknown>)?.content as Array<{ text: string }>)?.[0]?.text) || '';
    assert.match(remText, /saved/);
  } finally {
    proxy.kill();
    const lockFile = path.join(tmpToolboxHome, 'daemon.lock');
    if (fs.existsSync(lockFile)) {
      try {
        const lock = JSON.parse(fs.readFileSync(lockFile, 'utf8')) as { pid?: number };
        if (typeof lock.pid === 'number') process.kill(lock.pid);
      } catch {
        // ignore cleanup
      }
    }
    if (prevToolboxHome === undefined) delete process.env.TOOLBOX_HOME;
    else process.env.TOOLBOX_HOME = prevToolboxHome;
    fs.rmSync(tmpToolboxHome, { recursive: true, force: true });
  }
});

test('Multi-platform Codex adapter supports windows, windows-wsl, linux, and macos', () => {
  assert.equal(
    toWslMountPath('D:\\workspace\\github\\Agent-Toolbox\\bin\\stdio-proxy.mjs'),
    '/mnt/d/workspace/github/Agent-Toolbox/bin/stdio-proxy.mjs'
  );
  const utf16Buf = Buffer.from('Ubuntu\r\n', 'utf16le');
  assert.equal(decodeWslOutput(utf16Buf).trim(), 'Ubuntu');

  const prevOverride = process.env.TOOLBOX_PLATFORM_OVERRIDE;
  const prevCodexHome = process.env.CODEX_HOME;

  try {
    for (const plat of ['windows', 'windows-wsl', 'linux', 'macos'] as const) {
      const tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), `toolbox-${plat}-`));
      process.env.TOOLBOX_PLATFORM_OVERRIDE = plat;
      process.env.CODEX_HOME = tmpHome;

      assert.equal(detectCurrentPlatform(), plat);
      const res = installAgentToolboxToCodex({
        transport: 'stdio',
        targetPlatform: plat,
        workspaceRoot: WORKSPACE_ROOT,
      });
      assert.equal(res.ok, true);
      assert.equal(res.targetPlatform, plat);
      assert.match(res.tomlBlock, /stdio-proxy\.mjs/);
      if (plat === 'windows-wsl') {
        assert.match(res.tomlBlock, /\/mnt\//);
      }

      const status = getCodexIntegrationStatus({
        targetPlatform: plat,
        workspaceRoot: WORKSPACE_ROOT,
      });
      assert.equal(status.detectedPlatform, plat);
      assert.equal(status.targetPlatform, plat);
      assert.equal(status.canDirectWrite, true);
      assert.equal(status.registeredInCodex, true);

      fs.rmSync(tmpHome, { recursive: true, force: true });
    }

    // Cross-OS guard: running on Windows cannot directly write macOS local config
    process.env.TOOLBOX_PLATFORM_OVERRIDE = 'windows';
    const macStatus = getCodexIntegrationStatus({
      targetPlatform: 'macos',
      workspaceRoot: WORKSPACE_ROOT,
    });
    assert.equal(macStatus.canDirectWrite, false);
    assert.match(macStatus.recommendedTomlStdio, /stdio-proxy\.mjs/);
    const macInstall = installAgentToolboxToCodex({
      targetPlatform: 'macos',
      workspaceRoot: WORKSPACE_ROOT,
    });
    assert.equal(macInstall.ok, false);

    // WSL TOML block built even when detected platform is Windows
    const wslToml = buildCodexTomlBlock('stdio', {
      targetPlatform: 'windows-wsl',
      workspaceRoot: 'D:\\workspace\\github\\Agent-Toolbox',
    });
    assert.match(wslToml, /\/mnt\/d\/workspace\/github\/Agent-Toolbox\/bin\/stdio-proxy\.mjs/);
  } finally {
    if (prevOverride === undefined) delete process.env.TOOLBOX_PLATFORM_OVERRIDE;
    else process.env.TOOLBOX_PLATFORM_OVERRIDE = prevOverride;
    if (prevCodexHome === undefined) delete process.env.CODEX_HOME;
    else process.env.CODEX_HOME = prevCodexHome;
  }
});
