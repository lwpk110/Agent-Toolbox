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

type OpenCodeTransport = 'stdio' | 'http';
type InstallResult =
  | ({ ok: true; configPath: string; backupPath?: string } & { entry: Record<string, unknown> })
  | { ok: false; error: string };

export function opencodeConfigPath(): string {
  const home = process.env.HOME || os.homedir();
  const xdg = process.env.XDG_CONFIG_HOME || path.join(home, '.config');
  return path.join(xdg, 'opencode', 'opencode.json');
}

export function opencodeInstallEntry(options: { workspaceRoot: string; transport: OpenCodeTransport; baseUrl: string }): Record<string, unknown> {
  const base = options.baseUrl.replace(/\/$/, '');
  if (options.transport === 'http') return { type: 'remote', url: `${base}/api/mcp?host=opencode` };
  const launch = stdioLaunch(options.workspaceRoot, 'opencode');
  return { type: 'local', command: [launch.command, ...launch.args] };
}

export function opencodeConfigSnippet(workspaceRoot = process.cwd(), port = Number(process.env.PORT || 3000)): string {
  const local = opencodeInstallEntry({ workspaceRoot, transport: 'stdio', baseUrl: gatewayBaseUrl(port) });
  const remote = opencodeInstallEntry({ workspaceRoot, transport: 'http', baseUrl: gatewayBaseUrl(port) });
  return [
    '# 在终端运行',
    'agent-toolbox install --host opencode',
    'agent-toolbox install --host opencode --transport http',
    '',
    '// ~/.config/opencode/opencode.json',
    JSON.stringify({ mcp: { servers: { [GATEWAY_ENTRY]: local } } }, null, 2),
    '',
    '// remote Streamable HTTP',
    JSON.stringify({ mcp: { servers: { [GATEWAY_ENTRY]: remote } } }, null, 2),
  ].join('\n');
}

export function installAgentToolboxToOpencode(options: { workspaceRoot: string; transport: OpenCodeTransport; baseUrl: string }): InstallResult {
  const entry = opencodeInstallEntry(options);
  const result = updateJsonConfig(opencodeConfigPath(), 'OpenCode config', config => {
    config.mcp = asObject(config.mcp);
    config.mcp.servers = asObject(config.mcp.servers);
    config.mcp.servers[GATEWAY_ENTRY] = entry;
  });
  return result.ok ? { ...result, entry } : result;
}

export function uninstallAgentToolboxFromOpencode(): ConfigResult & { removed?: boolean } {
  let removed = false;
  const result = updateJsonConfig(opencodeConfigPath(), 'OpenCode config', config => {
    const mcp = asObject(config.mcp);
    const servers = asObject(mcp.servers);
    removed = Object.hasOwn(servers, GATEWAY_ENTRY);
    delete servers[GATEWAY_ENTRY];
    if (Object.keys(servers).length) mcp.servers = servers;
    else delete mcp.servers;
    if (Object.keys(mcp).length) config.mcp = mcp;
    else delete config.mcp;
  });
  return result.ok ? { ...result, removed } : result;
}
