import { afterEach, describe, expect, test } from 'bun:test';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { GatewayStore } from '../src/server/gatewayStore';

const tempDirs: string[] = [];

function makeDataFile(): string {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'gateway-persistence-'));
  tempDirs.push(directory);
  return path.join(directory, 'gateway-state.json');
}

async function waitForWrite(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 300));
}

afterEach(() => {
  for (const directory of tempDirs.splice(0)) fs.rmSync(directory, { recursive: true, force: true });
});

describe('GatewayStore persistence', () => {
  test('restores hosts in a new store instance', async () => {
    const dataFile = makeDataFile();
    const first = new GatewayStore({ dataFile });
    expect(first.addHost({ name: 'Persistence Test Host', scope: 'audit' }).host).toBeDefined();
    await waitForWrite();

    const second = new GatewayStore({ dataFile });
    expect(second.getSnapshot().hosts.some((host) => host.id === 'persistence-test-host')).toBe(true);
  });

  test('persists encrypted vault secrets and never writes plaintext', async () => {
    const dataFile = makeDataFile();
    const plaintext = 'unique-secret-value-94820';
    const first = new GatewayStore({ dataFile });
    expect(first.setVaultSecret('TEST_SECRET', plaintext).entry?.configured).toBe(true);
    await waitForWrite();

    const serialized = fs.readFileSync(dataFile, 'utf8');
    expect(serialized).not.toContain(plaintext);
    expect(fs.statSync(path.join(path.dirname(dataFile), '.vault-key')).mode & 0o777).toBe(0o600);

    const second = new GatewayStore({ dataFile });
    expect(second.redactSensitiveText(`value=${plaintext}`)).toBe('value=[REDACTED_BY_TOOLBOX]');
  });

  test('falls back to seed state on corrupt and unknown-version files', async () => {
    const dataFile = makeDataFile();
    fs.writeFileSync(dataFile, '{broken');
    expect(() => new GatewayStore({ dataFile })).not.toThrow();
    expect(fs.readdirSync(path.dirname(dataFile)).some((name) => /^gateway-state\.json\.corrupt-\d+$/.test(name))).toBe(true);
    await waitForWrite();
    expect(new GatewayStore({ dataFile }).getSnapshot().hosts.length).toBeGreaterThan(0);

    fs.writeFileSync(dataFile, JSON.stringify({ schemaVersion: 999, hosts: [] }));
    expect(() => new GatewayStore({ dataFile })).not.toThrow();
    expect(fs.readdirSync(path.dirname(dataFile)).filter((name) => /^gateway-state\.json\.corrupt-\d+$/.test(name)).length).toBe(2);
    await waitForWrite();
    expect(new GatewayStore({ dataFile }).getSnapshot().hosts.length).toBeGreaterThan(0);
  });

  test('rejects an invalid vault key with a clear error', () => {
    const dataFile = makeDataFile();
    const keyFile = path.join(path.dirname(dataFile), '.vault-key');
    fs.writeFileSync(keyFile, Buffer.from('short'));

    let message = '';
    try {
      new GatewayStore({ dataFile });
    } catch (error) {
      message = String(error);
    }

    expect(message).toContain(`Invalid vault key at ${keyFile}: expected 32 bytes, found 5`);
    expect(fs.readFileSync(keyFile, 'utf8')).toBe('short');
  });

  test('flushes and exits when receiving SIGTERM', async () => {
    const dataFile = makeDataFile();
    const moduleUrl = new URL('../src/server/persistence.ts', import.meta.url).href;
    const script = `import { GatewayPersistence } from ${JSON.stringify(moduleUrl)}; const p = new GatewayPersistence(${JSON.stringify(dataFile)}); p.schedule({ marker: 'flushed' }); setInterval(() => {}, 10000); setImmediate(() => process.kill(process.pid, 'SIGTERM'));`;

    await new Promise<void>((resolve, reject) => {
      const child = spawn('node', ['--import', 'tsx/esm', '--input-type=module', '-e', script], { stdio: ['ignore', 'pipe', 'pipe'] });
      let stderr = '';
      child.stderr.setEncoding('utf8').on('data', (chunk: string) => { stderr += chunk; });
      child.on('error', reject);
      child.on('exit', (code, signal) => {
        if (code !== 0 || signal !== null) {
          reject(new Error(`Child did not exit cleanly (code=${code}, signal=${signal}): ${stderr}`));
          return;
        }
        try {
          const saved = JSON.parse(fs.readFileSync(dataFile, 'utf8')) as { marker?: string };
          expect(saved.marker).toBe('flushed');
          resolve();
        } catch (error) {
          reject(new Error(`${String(error)}; child stderr: ${stderr}`));
        }
      });
    });
  });

  test('atomically replaces state without leaving temporary files', async () => {
    const dataFile = makeDataFile();
    const store = new GatewayStore({ dataFile });
    store.addHost({ name: 'Atomic Host', scope: 'audit' });
    await waitForWrite();

    expect(fs.existsSync(dataFile)).toBe(true);
    expect(fs.readdirSync(path.dirname(dataFile)).filter((name) => name.endsWith('.tmp'))).toEqual([]);
  });
});
