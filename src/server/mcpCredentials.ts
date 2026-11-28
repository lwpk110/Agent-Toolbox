import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

// Shared only by HTTP ingress and remote host configuration writers. Never serialized to state.
export function mcpToken(): string {
  const supplied = process.env.TOOLBOX_MCP_TOKEN;
  if (supplied) return supplied;
  const directory = process.env.TOOLBOX_DATA_FILE
    ? path.dirname(path.resolve(process.env.TOOLBOX_DATA_FILE))
    : path.resolve('data');
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  const file = path.join(directory, 'mcp-token');
  try {
    fs.writeFileSync(file, crypto.randomBytes(32).toString('hex'), { flag: 'wx', mode: 0o600 });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
  }
  const token = fs.readFileSync(file, 'utf8').trim();
  if (!token) throw new Error('Empty local MCP token file');
  return token;
}

export function mcpHeaders(): Record<string, string> {
  return { Authorization: `Bearer ${mcpToken()}` };
}
