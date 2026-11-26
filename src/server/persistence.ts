import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

export const PERSISTENCE_SCHEMA_VERSION = 1;

export type PersistedGatewayState = Record<string, unknown>;

export class GatewayPersistence {
  readonly dataFile: string;
  readonly vaultKey: Buffer;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private pendingState: PersistedGatewayState | undefined;
  private readonly flushOnExit: () => void;

  constructor(dataFile = process.env.TOOLBOX_DATA_FILE || './data/gateway-state.json') {
    this.dataFile = path.resolve(dataFile);
    this.vaultKey = this.loadVaultKey();
    this.flushOnExit = () => this.flushSync();
    process.on('SIGINT', this.flushOnExit);
    process.on('SIGTERM', this.flushOnExit);
  }

  load(): PersistedGatewayState | undefined {
    if (!fs.existsSync(this.dataFile)) return undefined;
    try {
      const parsed: unknown = JSON.parse(fs.readFileSync(this.dataFile, 'utf8'));
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        console.warn(`[gateway-persistence] Invalid state in ${this.dataFile}; using seed data`);
        return undefined;
      }
      const record = parsed as Record<string, unknown>;
      if (record.schemaVersion !== PERSISTENCE_SCHEMA_VERSION) {
        console.warn(`[gateway-persistence] Unsupported schema version in ${this.dataFile}; using seed data`);
        return undefined;
      }
      return record;
    } catch (error) {
      console.warn(`[gateway-persistence] Could not read ${this.dataFile}; using seed data: ${String(error)}`);
      return undefined;
    }
  }

  schedule(state: PersistedGatewayState): void {
    this.pendingState = state;
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => this.flushSync(), 200);
    this.timer.unref?.();
  }

  flushSync(): void {
    if (!this.pendingState) return;
    if (this.timer) clearTimeout(this.timer);
    this.timer = undefined;
    const state = this.pendingState;
    this.pendingState = undefined;
    const directory = path.dirname(this.dataFile);
    const tempFile = `${this.dataFile}.${process.pid}.${crypto.randomBytes(6).toString('hex')}.tmp`;
    try {
      fs.mkdirSync(directory, { recursive: true });
      fs.writeFileSync(tempFile, `${JSON.stringify({ schemaVersion: PERSISTENCE_SCHEMA_VERSION, ...state }, null, 2)}\n`, {
        mode: 0o600,
      });
      fs.renameSync(tempFile, this.dataFile);
    } catch (error) {
      this.pendingState = state;
      try {
        fs.rmSync(tempFile, { force: true });
      } catch {
        // Preserve the original persistence error.
      }
      console.error(`[gateway-persistence] Could not write ${this.dataFile}: ${String(error)}`);
    }
  }

  private loadVaultKey(): Buffer {
    const configured = process.env.TOOLBOX_VAULT_MASTER_KEY;
    if (configured) return crypto.createHash('sha256').update(configured).digest();

    const keyFile = path.join(path.dirname(this.dataFile), '.vault-key');
    try {
      const key = fs.readFileSync(keyFile);
      if (key.length === 32) {
        fs.chmodSync(keyFile, 0o600);
        return key;
      }
      console.warn(`[gateway-persistence] Invalid vault key at ${keyFile}; generating a replacement`);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        console.warn(`[gateway-persistence] Could not read vault key at ${keyFile}: ${String(error)}`);
      }
    }

    const key = crypto.randomBytes(32);
    fs.mkdirSync(path.dirname(keyFile), { recursive: true });
    fs.writeFileSync(keyFile, key, { mode: 0o600, flag: 'wx' });
    fs.chmodSync(keyFile, 0o600);
    return key;
  }
}
