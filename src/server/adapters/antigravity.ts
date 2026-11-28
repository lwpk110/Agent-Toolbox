import os from 'node:os';
import path from 'node:path';
import {
  GATEWAY_ENTRY,
  asObject,
  gatewayBaseUrl,
  stdioLaunch,
  updateJsonConfig,
  type ConfigResult,
} from './hostInstall';

type AntigravityTransport = 'stdio' | 'http';
type InstallResult =
  | ({ ok: true; configPath: string; backupPath?: string } & { entry: Record<string, unknown> })
  | { ok: false; error: string };

export function antigravityConfigPath(): string {
  const home = process.env.HOME || os.homedir();
  const configDir = process.env.GEMINI_CONFIG_DIR || path.join(home, '.gemini', 'config');
  return path.join(configDir, 'mcp_config.json');
}

export function antigravityInstallEntry(options: { workspaceRoot: string; transport: AntigravityTransport; baseUrl: string }): Record<string, unknown> {
  const base = options.baseUrl.replace(/\/$/, '');
  if (options.transport === 'http') return { serverUrl: `${base}/api/mcp?host=antigravity` };
  return stdioLaunch(options.workspaceRoot, 'antigravity');
}

export function antigravityConfigSnippet(workspaceRoot = process.cwd(), port = Number(process.env.PORT || 3000)): string {
  const stdio = antigravityInstallEntry({ workspaceRoot, transport: 'stdio', baseUrl: gatewayBaseUrl(port) });
  const remote = antigravityInstallEntry({ workspaceRoot, transport: 'http', baseUrl: gatewayBaseUrl(port) });
  return [
    '# 在终端运行',
    'agent-toolbox install --host antigravity',
    'agent-toolbox install --host antigravity --transport http',
    '',
    '// ~/.gemini/config/mcp_config.json',
    JSON.stringify({ mcpServers: { [GATEWAY_ENTRY]: stdio } }, null, 2),
    '',
    '// Streamable HTTP',
    JSON.stringify({ mcpServers: { [GATEWAY_ENTRY]: remote } }, null, 2),
  ].join('\n');
}

export function installAgentToolboxToAntigravity(options: { workspaceRoot: string; transport: AntigravityTransport; baseUrl: string }): InstallResult {
  const entry = antigravityInstallEntry(options);
  const result = updateJsonConfig(antigravityConfigPath(), 'Antigravity config', config => {
    config.mcpServers = asObject(config.mcpServers);
    config.mcpServers[GATEWAY_ENTRY] = entry;
  });
  return result.ok ? { ...result, entry } : result;
}

export function uninstallAgentToolboxFromAntigravity(): ConfigResult & { removed?: boolean } {
  let removed = false;
  const result = updateJsonConfig(antigravityConfigPath(), 'Antigravity config', config => {
    if (config.mcpServers && typeof config.mcpServers === 'object' && !Array.isArray(config.mcpServers)) {
      removed = Object.hasOwn(config.mcpServers, GATEWAY_ENTRY);
      delete config.mcpServers[GATEWAY_ENTRY];
      if (!Object.keys(config.mcpServers).length) delete config.mcpServers;
    }
  });
  return result.ok ? { ...result, removed } : result;
}
