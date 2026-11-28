import fs from 'node:fs';
import path from 'node:path';

export const GATEWAY_ENTRY = 'agent-toolbox';

export type ConfigResult =
  | { ok: true; configPath: string; backupPath?: string }
  | { ok: false; error: string };

export function gatewayBaseUrl(port = Number(process.env.PORT || 3000)): string {
  return (process.env.TOOLBOX_GATEWAY_URL || `http://127.0.0.1:${port}`).replace(/\/$/, '');
}

export function stdioLaunch(workspaceRoot: string, hostFlag: string): { command: string; args: string[] } {
  return {
    command: process.execPath,
    args: [path.resolve(workspaceRoot, 'bin/stdio-proxy.mjs'), '--host', hostFlag],
  };
}

export function asObject(value: unknown): Record<string, any> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, any> : {};
}

export function updateJsonConfig(target: string, label: string, update: (config: Record<string, any>) => void): ConfigResult {
  let backupPath: string | undefined;
  try {
    const dir = path.dirname(target);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    let config: Record<string, any> = {};
    if (fs.existsSync(target)) {
      const raw = fs.readFileSync(target, 'utf8');
      config = JSON.parse(raw);
      if (!config || typeof config !== 'object' || Array.isArray(config)) throw new Error('Config root must be a JSON object.');
      backupPath = `${target}.bak`;
      fs.copyFileSync(target, backupPath);
    }
    update(config);
    fs.writeFileSync(target, `${JSON.stringify(config, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
    return { ok: true, configPath: target, backupPath };
  } catch (error) {
    return { ok: false, error: `Could not update ${label} ${target}: ${error instanceof Error ? error.message : String(error)}` };
  }
}
