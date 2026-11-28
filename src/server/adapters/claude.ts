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

type ClaudeTransport = 'stdio' | 'sse' | 'http';
type ClaudeInstallResult =
  | ({ ok: true; configPath: string; backupPath?: string } & { entry: Record<string, unknown> })
  | { ok: false; error: string };

export function claudeConfigPath(): string {
  const home = process.env.HOME || os.homedir();
  return path.join(home, '.claude.json');
}

export function claudeInstallEntry(options: { workspaceRoot: string; transport: ClaudeTransport; baseUrl: string }): Record<string, unknown> {
  const base = options.baseUrl.replace(/\/$/, '');
  if (options.transport === 'sse') return { type: 'sse', url: `${base}/api/mcp/sse?host=claude-code` };
  if (options.transport === 'http') return { type: 'http', url: `${base}/api/mcp?host=claude-code` };
  return stdioLaunch(options.workspaceRoot, 'claude-code');
}

export function claudeConfigSnippet(workspaceRoot = process.cwd(), port = Number(process.env.PORT || 3000)): string {
  const stdio = claudeInstallEntry({ workspaceRoot, transport: 'stdio', baseUrl: gatewayBaseUrl(port) });
  const sse = claudeInstallEntry({ workspaceRoot, transport: 'sse', baseUrl: gatewayBaseUrl(port) });
  return [
    '# 在终端运行',
    'agent-toolbox install --host claude',
    'agent-toolbox install --host claude --transport sse',
    '',
    '// ~/.claude.json',
    JSON.stringify({ mcpServers: { [GATEWAY_ENTRY]: stdio } }, null, 2),
    '',
    '// SSE',
    JSON.stringify({ mcpServers: { [GATEWAY_ENTRY]: sse } }, null, 2),
  ].join('\n');
}

export function installAgentToolboxToClaude(options: { workspaceRoot: string; transport: ClaudeTransport; baseUrl: string }): ClaudeInstallResult {
  const entry = claudeInstallEntry(options);
  const result = updateJsonConfig(claudeConfigPath(), 'Claude Code config', config => {
    config.mcpServers = asObject(config.mcpServers);
    config.mcpServers[GATEWAY_ENTRY] = entry;
  });
  return result.ok ? { ...result, entry } : result;
}

export function uninstallAgentToolboxFromClaude(): ConfigResult & { removed?: boolean } {
  let removed = false;
  const result = updateJsonConfig(claudeConfigPath(), 'Claude Code config', config => {
    if (config.mcpServers && typeof config.mcpServers === 'object' && !Array.isArray(config.mcpServers)) {
      removed = Object.hasOwn(config.mcpServers, GATEWAY_ENTRY);
      delete config.mcpServers[GATEWAY_ENTRY];
      if (!Object.keys(config.mcpServers).length) delete config.mcpServers;
    }
  });
  return result.ok ? { ...result, removed } : result;
}
