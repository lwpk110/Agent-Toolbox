import { afterEach, expect, test } from 'bun:test';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const dirs: string[] = [];
afterEach(() => { for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true }); });
async function run(scenario: string) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mcp-process-'));
  dirs.push(dir);
  const resultFile = path.join(dir, 'result.json');
  await new Promise<void>((resolve, reject) => {
    const child = spawn('node', ['--import', 'tsx/esm', `tests/fixtures/${scenario}.ts`, resultFile], { stdio: ['ignore', 'pipe', 'pipe'] });
    let logs = '';
    child.stdout.on('data', b => { logs += String(b); });
    child.stderr.on('data', b => { logs += String(b); });
    child.on('error', reject);
    const timeout = setTimeout(() => { child.kill(); reject(new Error(`Scenario timeout: ${logs}`)); }, 4500);
    child.on('exit', (code, signal) => {
      clearTimeout(timeout);
      if (code === 0 && !signal) resolve();
      else reject(new Error(`Scenario failed (${code}, ${signal}): ${logs}`));
    });
  });
  return JSON.parse(fs.readFileSync(resultFile, 'utf8'));
}

test('Node gateway runtime forwards real MCP list/call, persists audit and reconnects after restart; disconnected child yields -32006', async () => {
  const actual = await run('check-downstream');
  expect(actual.tool.inputSchema.properties.text.type).toBe('string');
  expect(actual.echo.content[0].text).toBe('hello-from-codex');
  expect(actual.echo._meta.pid === actual.gatewayPid).toBe(false);
  expect(actual.audit.host).toBe('Codex CLI');
  expect(actual.audit.requestPayload.id).toBe('real');
  expect(actual.dead.id).toBe('dead');
  expect(actual.dead.error.code).toBe(-32006);
  expect(actual.restoredAudit.requestPayload.id).toBe('dead');
  expect(actual.restarted.content[0].text).toBe('after-restart');
});

test('bun stdio entry returns -32006 without gateway, stays alive, suppresses notifications and exits cleanly on EOF', async () => {
  const actual = await run('check-stdio-offline');
  expect(actual.messages.map((m: any) => m.id)).toEqual(['initialize', 0, null]);
  expect(actual.messages[0].error.code).toBe(-32006);
  expect(actual.messages[0].error.message).toContain('请先运行 bun run dev');
  expect(actual.messages[1].error.code).toBe(-32006);
  expect(actual.messages[2].error.code).toBe(-32700);
  expect(actual.exitCode).toBe(0);
});

test('handshake failure and timeout fail closed while downstream tool errors retain MCP isError', async () => {
  const result = await run('check-downstream-faults');
  expect(result.handshakeState).toBe('offline');
  expect(result.handshake.error.code).toBe(-32006);
  expect(result.timeout.id).toBe('fault__timeout');
  expect(result.timeout.error.code).toBe(-32006);
  expect(result.toolError.result.isError).toBe(true);
  expect(JSON.parse(result.toolError.result.content[0].text).content[0].text).toBe('tool execution failed');
});
