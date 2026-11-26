import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

export const PERSISTENCE_SCHEMA_VERSION = 1;

export type PersistedGatewayState = Record<string, unknown>;

const persistences = new Set<GatewayPersistence>();
let signalHandlersRegistered = false;

function flushAndExit(): void {
  for (const persistence of persistences) persistence.flushSync();
  process.exit(0);
}

function registerSignalHandlers(): void {
  if (signalHandlersRegistered) return;
  signalHandlersRegistered = true;
  process.on('SIGINT', flushAndExit);
  process.on('SIGTERM', flushAndExit);
}

export class GatewayPersistence {
  readonly dataFile: string;
  readonly vaultKey: Buffer;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private pendingState: PersistedGatewayState | undefined;
  constructor(dataFile = process.env.TOOLBOX_DATA_FILE || './data/gateway-state.json') {
    this.dataFile = path.resolve(dataFile);
    this.vaultKey = this.loadVaultKey();
    persistences.add(this);
    registerSignalHandlers();
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
      if (error instanceof SyntaxError) {
        const corruptFile = `${this.dataFile}.corrupt-${Date.now()}`;
        try {
          fs.renameSync(this.dataFile, corruptFile);
          console.warn(`[gateway-persistence] Invalid JSON moved to ${corruptFile}; using seed data`);
        } catch (renameError) {
          throw new Error(`[gateway-persistence] Could not archive invalid state ${this.dataFile}; refusing to overwrite it: ${String(renameError)}`);
        }
        return undefined;
      }
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
    let key: Buffer | undefined;
    try {
      key = fs.readFileSync(keyFile);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw new Error(`[gateway-persistence] Could not read vault key at ${keyFile}: ${String(error)}`);
    }
    if (key) {
      if (key.length !== 32) {
        throw new Error(`[gateway-persistence] Invalid vault key at ${keyFile}: expected 32 bytes, found ${key.length}; refusing to replace it`);
      }
      fs.chmodSync(keyFile, 0o600);
      return key;
    }

    const generatedKey = crypto.randomBytes(32);
    fs.mkdirSync(path.dirname(keyFile), { recursive: true });
    fs.writeFileSync(keyFile, generatedKey, { mode: 0o600, flag: 'wx' });
    fs.chmodSync(keyFile, 0o600);
    return generatedKey;
  }
}
