import { mcpToken } from '../mcpCredentials';
import { execFileSync } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';
import type {
  CodexIntegrationStatus,
  CodexMcpServerEntry,
  CodexTargetPlatform,
} from '../../types/toolbox';

export interface ParsedCodexMcpServer {
  name: string;
  transport: 'stdio' | 'http';
  command?: string;
  args?: string[];
  url?: string;
  env: Record<string, string>;
  httpHeaders: Record<string, string>;
  enabled: boolean;
}

const PLATFORM_LABELS: Record<CodexTargetPlatform, string> = {
  windows: 'Windows',
  'windows-wsl': 'Windows WSL',
  linux: 'Linux',
  macos: 'macOS',
};

export function detectCurrentPlatform(): CodexTargetPlatform {
  const override = process.env.TOOLBOX_PLATFORM_OVERRIDE as CodexTargetPlatform | undefined;
  if (override && ['windows', 'windows-wsl', 'linux', 'macos'].includes(override)) {
    return override;
  }

  if (process.platform === 'win32') return 'windows';
  if (process.platform === 'darwin') return 'macos';
  if (process.platform === 'linux') {
    if (process.env.WSL_DISTRO_NAME || process.env.WSL_INTEROP) {
      return 'windows-wsl';
    }
    try {
      const procVersion = fs.readFileSync('/proc/version', 'utf8');
      if (/microsoft|wsl/i.test(procVersion)) {
        return 'windows-wsl';
      }
    } catch {
      // ignore if /proc/version unavailable
    }
    return 'linux';
  }
  return 'linux';
}

export function normalizeTargetPlatform(raw?: string): CodexTargetPlatform {
  if (raw === 'windows' || raw === 'windows-wsl' || raw === 'linux' || raw === 'macos') {
    return raw;
  }
  return detectCurrentPlatform();
}

export function toWslMountPath(winPath: string): string {
  const normalized = winPath.replace(/\\/g, '/');
  const driveMatch = normalized.match(/^([a-zA-Z]):\/(.*)$/);
  if (driveMatch) {
    return `/mnt/${driveMatch[1].toLowerCase()}/${driveMatch[2]}`;
  }
  return normalized;
}

export function decodeWslOutput(buf: Buffer): string {
  if (buf.includes(0)) {
    return buf.toString('utf16le').replace(/\0/g, '');
  }
  return buf.toString('utf8');
}

let cachedWslDistros: { checkedAt: number; distros: string[] } | null = null;

export function listWslDistros(): string[] {
  if (detectCurrentPlatform() !== 'windows') {
    if (detectCurrentPlatform() === 'windows-wsl' && process.env.WSL_DISTRO_NAME) {
      return [process.env.WSL_DISTRO_NAME];
    }
    return [];
  }

  if (cachedWslDistros && Date.now() - cachedWslDistros.checkedAt < 30000) {
    return cachedWslDistros.distros;
  }

  try {
    const outBuf = execFileSync('wsl.exe', ['-l', '-q'], {
      timeout: 2500,
      windowsHide: true,
    });
    const text = decodeWslOutput(outBuf);
    const distros = text
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => Boolean(line) && !/^docker-desktop(-data)?$/i.test(line));
    cachedWslDistros = { checkedAt: Date.now(), distros };
    return distros;
  } catch {
    cachedWslDistros = { checkedAt: Date.now(), distros: [] };
    return [];
  }
}

const cachedWslHomeByDistro = new Map<string, { checkedAt: number; home: string }>();

function getWslUserHome(distro: string): string | null {
  const cached = cachedWslHomeByDistro.get(distro);
  if (cached && Date.now() - cached.checkedAt < 60000) {
    return cached.home;
  }
  try {
    const out = execFileSync('wsl.exe', ['-d', distro, '--', 'sh', '-lc', 'printf %s "$HOME"'], {
      encoding: 'utf8',
      timeout: 8000,
      windowsHide: true,
    }).trim();
    if (out.startsWith('/')) {
      cachedWslHomeByDistro.set(distro, { checkedAt: Date.now(), home: out });
      return out;
    }
    return null;
  } catch {
    return null;
  }
}

function wslPosixToUncPath(distro: string, posixPath: string): string {
  const cleanRel = posixPath.replace(/^\/+/, '').replace(/\//g, '\\');
  return `\\\\wsl.localhost\\${distro}\\${cleanRel}`;
}

function getWindowsHomeFromWsl(): string | null {
  try {
    const winProfile = execFileSync('cmd.exe', ['/d', '/s', '/c', 'echo %USERPROFILE%'], {
      encoding: 'utf8',
      timeout: 4000,
    }).trim();
    if (!winProfile || winProfile.includes('%USERPROFILE%')) return null;
    const wslPath = execFileSync('wslpath', ['-u', winProfile], {
      encoding: 'utf8',
      timeout: 3000,
    }).trim();
    return wslPath || null;
  } catch {
    return null;
  }
}

export function getCodexPaths(targetPlatform?: CodexTargetPlatform, wslDistro?: string) {
  const detected = detectCurrentPlatform();
  const target = normalizeTargetPlatform(targetPlatform);

  if (target === detected) {
    const codexHome = process.env.CODEX_HOME
      ? path.resolve(process.env.CODEX_HOME)
      : path.join(os.homedir(), '.codex');
    return {
      detectedPlatform: detected,
      targetPlatform: target,
      wslDistro: detected === 'windows-wsl' ? process.env.WSL_DISTRO_NAME || 'WSL' : null,
      canDirectWrite: true,
      codexHome,
      configPath: path.join(codexHome, 'config.toml'),
      agentsMdPath: path.join(codexHome, 'AGENTS.md'),
      useWslDistroAccess: false as const,
    };
  }

  if (detected === 'windows' && target === 'windows-wsl') {
    const distros = listWslDistros();
    const chosen = wslDistro && distros.includes(wslDistro) ? wslDistro : distros[0] || null;
    if (!chosen) {
      return {
        detectedPlatform: detected,
        targetPlatform: target,
        wslDistro: null,
        canDirectWrite: false,
        writeNote: '当前 Windows 主机未检测到可用的 WSL 发行版，可复制下方 WSL 配置到 WSL 内手动写入。',
        codexHome: '~/.codex',
        configPath: '~/.codex/config.toml',
        agentsMdPath: '~/.codex/AGENTS.md',
        useWslDistroAccess: false as const,
      };
    }

    const wslHome = getWslUserHome(chosen);
    if (!wslHome) {
      return {
        detectedPlatform: detected,
        targetPlatform: target,
        wslDistro: chosen,
        canDirectWrite: false,
        writeNote: `无法访问 WSL 发行版「${chosen}」的用户目录，请确认 WSL 处于可用状态或复制配置手动写入。`,
        codexHome: '~/.codex',
        configPath: '~/.codex/config.toml',
        agentsMdPath: '~/.codex/AGENTS.md',
        useWslDistroAccess: false as const,
      };
    }

    const posixCodexHome = `${wslHome}/.codex`;
    const posixConfigPath = `${posixCodexHome}/config.toml`;
    const posixAgentsPath = `${posixCodexHome}/AGENTS.md`;
    return {
      detectedPlatform: detected,
      targetPlatform: target,
      wslDistro: chosen,
      canDirectWrite: true,
      codexHome: wslPosixToUncPath(chosen, posixCodexHome),
      configPath: wslPosixToUncPath(chosen, posixConfigPath),
      agentsMdPath: wslPosixToUncPath(chosen, posixAgentsPath),
      posixConfigPath,
      useWslDistroAccess: true as const,
    };
  }

  if (detected === 'windows-wsl' && target === 'windows') {
    const winHomeInWsl = getWindowsHomeFromWsl();
    if (winHomeInWsl) {
      const codexHome = path.posix.join(winHomeInWsl, '.codex');
      return {
        detectedPlatform: detected,
        targetPlatform: target,
        wslDistro: null,
        canDirectWrite: true,
        codexHome,
        configPath: path.posix.join(codexHome, 'config.toml'),
        agentsMdPath: path.posix.join(codexHome, 'AGENTS.md'),
        useWslDistroAccess: false as const,
      };
    }
  }

  const defaultDisplayPaths: Record<CodexTargetPlatform, { home: string; sep: string }> = {
    windows: { home: '%USERPROFILE%\\.codex', sep: '\\' },
    'windows-wsl': { home: '~/.codex', sep: '/' },
    linux: { home: '~/.codex', sep: '/' },
    macos: { home: '~/.codex', sep: '/' },
  };
  const info = defaultDisplayPaths[target];
  return {
    detectedPlatform: detected,
    targetPlatform: target,
    wslDistro: null,
    canDirectWrite: false,
    writeNote: `当前服务端运行在 ${PLATFORM_LABELS[detected]}，无法直接写入远程 ${PLATFORM_LABELS[target]} 路径；请复制配置或在目标环境运行一键写入。`,
    codexHome: info.home,
    configPath: `${info.home}${info.sep}config.toml`,
    agentsMdPath: `${info.home}${info.sep}AGENTS.md`,
    useWslDistroAccess: false as const,
  };
}

const cachedCliInfoByKey = new Map<string, { checkedAt: number; installed: boolean; version: string | null }>();

export function detectCodexCliBinary(
  targetPlatform?: CodexTargetPlatform,
  wslDistro?: string
): { installed: boolean; version: string | null } {
  const detected = detectCurrentPlatform();
  const target = normalizeTargetPlatform(targetPlatform);
  const cacheKey = `${detected}:${target}:${wslDistro || ''}`;
  const cached = cachedCliInfoByKey.get(cacheKey);
  if (cached && Date.now() - cached.checkedAt < 30000) {
    return { installed: cached.installed, version: cached.version };
  }

  try {
    let out = '';
    if (target === detected) {
      if (detected === 'windows') {
        out = execFileSync('cmd.exe', ['/d', '/s', '/c', 'codex --version'], {
          encoding: 'utf8',
          timeout: 3000,
          windowsHide: true,
        });
      } else {
        out = execFileSync('codex', ['--version'], {
          encoding: 'utf8',
          timeout: 3000,
        });
      }
    } else if (detected === 'windows' && target === 'windows-wsl' && wslDistro) {
      out = execFileSync('wsl.exe', ['-d', wslDistro, '--', 'sh', '-lc', 'codex --version'], {
        encoding: 'utf8',
        timeout: 6000,
        windowsHide: true,
      });
    } else {
      cachedCliInfoByKey.set(cacheKey, { checkedAt: Date.now(), installed: false, version: null });
      return { installed: false, version: null };
    }

    const version = out.trim().split(/\r?\n/)[0] || null;
    cachedCliInfoByKey.set(cacheKey, { checkedAt: Date.now(), installed: Boolean(version), version });
    return { installed: Boolean(version), version };
  } catch {
    cachedCliInfoByKey.set(cacheKey, { checkedAt: Date.now(), installed: false, version: null });
    return { installed: false, version: null };
  }
}

function stripTomlComment(line: string): string {
  let inSingle = false;
  let inDouble = false;
  let escaped = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (inDouble && ch === '\\') {
      escaped = true;
      continue;
    }
    if (!inSingle && ch === '"') {
      inDouble = !inDouble;
    } else if (!inDouble && ch === "'") {
      inSingle = !inSingle;
    } else if (!inSingle && !inDouble && ch === '#') {
      return line.slice(0, i);
    }
  }
  return line;
}

function unquoteTomlScalar(raw: string): string {
  const trimmed = raw.trim();
  if (trimmed.startsWith('"') && trimmed.endsWith('"') && trimmed.length >= 2) {
    return trimmed
      .slice(1, -1)
      .replace(/\\\\/g, '\\')
      .replace(/\\"/g, '"')
      .replace(/\\n/g, '\n')
      .replace(/\\r/g, '\r')
      .replace(/\\t/g, '\t');
  }
  if (trimmed.startsWith("'") && trimmed.endsWith("'") && trimmed.length >= 2) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

function parseTomlStringArray(raw: string): string[] {
  const trimmed = raw.trim();
  if (!trimmed.startsWith('[') || !trimmed.endsWith(']')) return [];
  const inner = trimmed.slice(1, -1).trim();
  if (!inner) return [];

  const items: string[] = [];
  let current = '';
  let inSingle = false;
  let inDouble = false;
  let escaped = false;

  for (let i = 0; i < inner.length; i++) {
    const ch = inner[i];
    if (escaped) {
      current += ch;
      escaped = false;
      continue;
    }
    if (inDouble && ch === '\\') {
      current += ch;
      escaped = true;
      continue;
    }
    if (!inSingle && ch === '"') {
      inDouble = !inDouble;
      current += ch;
    } else if (!inDouble && ch === "'") {
      inSingle = !inSingle;
      current += ch;
    } else if (!inSingle && !inDouble && ch === ',') {
      const val = unquoteTomlScalar(current);
      if (val) items.push(val);
      current = '';
    } else {
      current += ch;
    }
  }
  const last = unquoteTomlScalar(current);
  if (last) items.push(last);
  return items;
}

function unquoteSectionSegment(seg: string): string {
  return unquoteTomlScalar(seg.trim());
}

function parseSectionHeader(trimmedLine: string): string[] | null {
  if (!trimmedLine.startsWith('[') || trimmedLine.startsWith('[[')) return null;
  const closeIdx = trimmedLine.lastIndexOf(']');
  if (closeIdx <= 0) return null;
  const inner = trimmedLine.slice(1, closeIdx).trim();
  if (!inner) return null;

  const segments: string[] = [];
  let current = '';
  let inSingle = false;
  let inDouble = false;

  for (let i = 0; i < inner.length; i++) {
    const ch = inner[i];
    if (!inSingle && ch === '"') {
      inDouble = !inDouble;
      current += ch;
    } else if (!inDouble && ch === "'") {
      inSingle = !inSingle;
      current += ch;
    } else if (!inSingle && !inDouble && ch === '.') {
      segments.push(unquoteSectionSegment(current));
      current = '';
    } else {
      current += ch;
    }
  }
  segments.push(unquoteSectionSegment(current));
  return segments;
}

export function parseCodexMcpServersFromToml(tomlText: string): ParsedCodexMcpServer[] {
  const servers = new Map<string, ParsedCodexMcpServer>();
  const ensureServer = (name: string): ParsedCodexMcpServer => {
    let entry = servers.get(name);
    if (!entry) {
      entry = {
        name,
        transport: 'stdio',
        env: {},
        httpHeaders: {},
        enabled: true,
      };
      servers.set(name, entry);
    }
    return entry;
  };

  let currentSection: string[] = [];
  const lines = tomlText.split(/\r?\n/);

  for (let idx = 0; idx < lines.length; idx++) {
    const clean = stripTomlComment(lines[idx]).trim();
    if (!clean) continue;

    const header = parseSectionHeader(clean);
    if (header) {
      currentSection = header;
      if (currentSection[0] === 'mcp_servers' && currentSection.length >= 2 && currentSection[1]) {
        ensureServer(currentSection[1]);
      }
      continue;
    }

    if (currentSection[0] !== 'mcp_servers' || currentSection.length < 2) {
      continue;
    }

    const eqIdx = clean.indexOf('=');
    if (eqIdx <= 0) continue;

    const key = unquoteSectionSegment(clean.slice(0, eqIdx));
    let val = clean.slice(eqIdx + 1).trim();

    if (val.startsWith('[') && !val.endsWith(']')) {
      while (idx + 1 < lines.length && !val.endsWith(']')) {
        idx += 1;
        const nextClean = stripTomlComment(lines[idx]).trim();
        if (nextClean) {
          val += ` ${nextClean}`;
        }
      }
    }

    const serverName = currentSection[1];
    const entry = ensureServer(serverName);

    if (currentSection.length === 2) {
      if (key === 'command') {
        entry.command = unquoteTomlScalar(val);
        entry.transport = 'stdio';
      } else if (key === 'args') {
        entry.args = parseTomlStringArray(val);
      } else if (key === 'url') {
        entry.url = unquoteTomlScalar(val);
        entry.transport = 'http';
      } else if (key === 'enabled') {
        entry.enabled = val.toLowerCase() !== 'false';
      }
    } else if (currentSection.length === 3 && currentSection[2] === 'env') {
      entry.env[key] = unquoteTomlScalar(val);
    } else if (
      currentSection.length === 3 &&
      (currentSection[2] === 'http_headers' || currentSection[2] === 'headers')
    ) {
      entry.httpHeaders[key] = unquoteTomlScalar(val);
    }
  }

  return Array.from(servers.values()).filter((s) => Boolean(s.command || s.url));
}

function escapeTomlString(str: string): string {
  return `"${str.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}

export function resolveStdioLaunchCommand(
  workspaceRoot = process.cwd(),
  targetPlatform?: CodexTargetPlatform
): {
  command: string;
  args: string[];
} {
  const detected = detectCurrentPlatform();
  const target = normalizeTargetPlatform(targetPlatform);
  const proxyScriptAbs = path.resolve(workspaceRoot, 'bin', 'stdio-proxy.mjs');
  const hasProxyScript = fs.existsSync(proxyScriptAbs);

  if (!hasProxyScript) {
    return {
      command: 'npx',
      args: ['agent-toolbox', 'serve', '--stdio', '--host', 'codex'],
    };
  }

  if (target === 'windows') {
    const winScriptPath =
      detected === 'windows'
        ? proxyScriptAbs
        : proxyScriptAbs.replace(/^\/mnt\/([a-zA-Z])\/(.*)$/, (_m, d: string, rest: string) => {
            return `${d.toUpperCase()}:\\${rest.replace(/\//g, '\\')}`;
          });
    return {
      command: detected === 'windows' ? process.execPath : 'node',
      args: [winScriptPath, '--host', 'codex'],
    };
  }

  if (target === 'windows-wsl') {
    const wslScriptPath = toWslMountPath(proxyScriptAbs);
    return {
      command: detected === 'windows-wsl' ? process.execPath : 'node',
      args: [wslScriptPath, '--host', 'codex'],
    };
  }

  if (target === 'macos') {
    const macScriptPath =
      detected === 'macos'
        ? proxyScriptAbs
        : detected === 'windows'
        ? '/path/to/Agent-Toolbox/bin/stdio-proxy.mjs'
        : proxyScriptAbs;
    return {
      command: detected === 'macos' ? process.execPath : 'node',
      args: [macScriptPath, '--host', 'codex'],
    };
  }

  // Linux
  const linuxScriptPath =
    detected === 'linux' || detected === 'windows-wsl'
      ? proxyScriptAbs
      : detected === 'windows'
      ? '/path/to/Agent-Toolbox/bin/stdio-proxy.mjs'
      : proxyScriptAbs;
  return {
    command: detected === 'linux' ? process.execPath : 'node',
    args: [linuxScriptPath, '--host', 'codex'],
  };
}

export function buildCodexTomlBlock(
  transport: 'stdio' | 'http',
  options?: { port?: number; workspaceRoot?: string; targetPlatform?: CodexTargetPlatform }
): string {
  const port = options?.port ?? Number(process.env.PORT || 3000);
  const target = normalizeTargetPlatform(options?.targetPlatform);
  if (transport === 'http') {
    return [
      '[mcp_servers.agent-toolbox]',
      `url = ${escapeTomlString(`http://127.0.0.1:${port}/api/mcp?host=codex`)}`,
      `http_headers = { Authorization = ${escapeTomlString(`Bearer ${mcpToken()}`)} }`,
      'startup_timeout_sec = 20',
      'tool_timeout_sec = 60',
    ].join('\n');
  }

  const launch = resolveStdioLaunchCommand(options?.workspaceRoot, target);
  return [
    '[mcp_servers.agent-toolbox]',
    `command = ${escapeTomlString(launch.command)}`,
    `args = [${launch.args.map(escapeTomlString).join(', ')}]`,
    'startup_timeout_sec = 30',
    'tool_timeout_sec = 60',
  ].join('\n');
}

function removeAgentToolboxSectionsFromToml(tomlText: string): string {
  const lines = tomlText.split(/\r?\n/);
  const kept: string[] = [];
  let skipping = false;

  for (const line of lines) {
    const clean = stripTomlComment(line).trim();
    const header = parseSectionHeader(clean);
    if (header) {
      const isAgentToolboxSection =
        header[0] === 'mcp_servers' &&
        header.length >= 2 &&
        (header[1] === 'agent-toolbox' || header[1] === 'agent_toolbox');
      skipping = isAgentToolboxSection;
      if (skipping) continue;
    }
    if (!skipping) {
      kept.push(line);
    }
  }

  while (kept.length > 0 && kept[kept.length - 1].trim() === '') {
    kept.pop();
  }
  return kept.join('\n');
}

function readConfigTextForPaths(pathsInfo: ReturnType<typeof getCodexPaths>): {
  exists: boolean;
  text: string;
} {
  if (!pathsInfo.canDirectWrite) return { exists: false, text: '' };
  try {
    if (fs.existsSync(pathsInfo.configPath)) {
      return { exists: true, text: fs.readFileSync(pathsInfo.configPath, 'utf8') };
    }
  } catch {
    // Fallback to wsl.exe if UNC path isn't accessible
  }

  if (pathsInfo.useWslDistroAccess && pathsInfo.wslDistro && 'posixConfigPath' in pathsInfo) {
    try {
      const out = execFileSync(
        'wsl.exe',
        ['-d', pathsInfo.wslDistro, '--', 'sh', '-lc', 'if [ -f "$HOME/.codex/config.toml" ]; then cat "$HOME/.codex/config.toml"; fi'],
        { encoding: 'utf8', timeout: 5000, windowsHide: true }
      );
      return { exists: Boolean(out), text: out };
    } catch {
      return { exists: false, text: '' };
    }
  }

  return { exists: false, text: '' };
}

function writeConfigTextForPaths(
  pathsInfo: ReturnType<typeof getCodexPaths>,
  nextContent: string,
  prevContent: string,
  prevExists: boolean
): { backupPath?: string } {
  let backupPath: string | undefined;
  try {
    if (!fs.existsSync(pathsInfo.codexHome)) {
      fs.mkdirSync(pathsInfo.codexHome, { recursive: true });
    }
    if (prevExists) {
      backupPath = `${pathsInfo.configPath}.agent-toolbox.bak`;
      fs.writeFileSync(backupPath, prevContent, 'utf8');
    }
    fs.writeFileSync(pathsInfo.configPath, nextContent, 'utf8');
    return { backupPath };
  } catch (err) {
    if (pathsInfo.useWslDistroAccess && pathsInfo.wslDistro) {
      execFileSync(
        'wsl.exe',
        [
          '-d',
          pathsInfo.wslDistro,
          '--',
          'sh',
          '-lc',
          'mkdir -p "$HOME/.codex" && if [ -f "$HOME/.codex/config.toml" ]; then cp "$HOME/.codex/config.toml" "$HOME/.codex/config.toml.agent-toolbox.bak"; fi && cat > "$HOME/.codex/config.toml"',
        ],
        { input: nextContent, encoding: 'utf8', timeout: 8000, windowsHide: true }
      );
      return { backupPath: prevExists ? `${pathsInfo.configPath}.agent-toolbox.bak` : undefined };
    }
    throw err;
  }
}

export function installAgentToolboxToCodex(options?: {
  transport?: 'stdio' | 'http';
  port?: number;
  workspaceRoot?: string;
  targetPlatform?: CodexTargetPlatform;
  wslDistro?: string;
}): {
  ok: boolean;
  error?: string;
  targetPlatform: CodexTargetPlatform;
  configPath: string;
  backupPath?: string;
  transport: 'stdio' | 'http';
  tomlBlock: string;
} {
  const transport = options?.transport === 'http' ? 'http' : 'stdio';
  const target = normalizeTargetPlatform(options?.targetPlatform);
  const pathsInfo = getCodexPaths(target, options?.wslDistro);
  const tomlBlock = buildCodexTomlBlock(transport, {
    port: options?.port,
    workspaceRoot: options?.workspaceRoot,
    targetPlatform: target,
  });

  if (!pathsInfo.canDirectWrite) {
    return {
      ok: false,
      error: pathsInfo.writeNote || `当前环境无法直接写入 ${PLATFORM_LABELS[target]} 配置。`,
      targetPlatform: target,
      configPath: pathsInfo.configPath,
      transport,
      tomlBlock,
    };
  }

  const prev = readConfigTextForPaths(pathsInfo);
  const stripped = removeAgentToolboxSectionsFromToml(prev.text);
  const nextContent = stripped ? `${stripped}\n\n${tomlBlock}\n` : `${tomlBlock}\n`;
  const { backupPath } = writeConfigTextForPaths(pathsInfo, nextContent, prev.text, prev.exists);

  return {
    ok: true,
    targetPlatform: target,
    configPath: pathsInfo.configPath,
    backupPath,
    transport,
    tomlBlock,
  };
}

export function uninstallAgentToolboxFromCodex(options?: {
  targetPlatform?: CodexTargetPlatform;
  wslDistro?: string;
}): {
  ok: boolean;
  error?: string;
  targetPlatform: CodexTargetPlatform;
  configPath: string;
  removed: boolean;
} {
  const target = normalizeTargetPlatform(options?.targetPlatform);
  const pathsInfo = getCodexPaths(target, options?.wslDistro);
  if (!pathsInfo.canDirectWrite) {
    return {
      ok: false,
      error: pathsInfo.writeNote || `当前环境无法直接修改 ${PLATFORM_LABELS[target]} 配置。`,
      targetPlatform: target,
      configPath: pathsInfo.configPath,
      removed: false,
    };
  }

  const prev = readConfigTextForPaths(pathsInfo);
  if (!prev.exists) {
    return {
      ok: true,
      targetPlatform: target,
      configPath: pathsInfo.configPath,
      removed: false,
    };
  }

  const parsed = parseCodexMcpServersFromToml(prev.text);
  const hasEntry = parsed.some((s) => s.name === 'agent-toolbox' || s.name === 'agent_toolbox');
  if (!hasEntry) {
    return {
      ok: true,
      targetPlatform: target,
      configPath: pathsInfo.configPath,
      removed: false,
    };
  }

  const next = removeAgentToolboxSectionsFromToml(prev.text);
  writeConfigTextForPaths(pathsInfo, next ? `${next}\n` : '', prev.text, true);
  return {
    ok: true,
    targetPlatform: target,
    configPath: pathsInfo.configPath,
    removed: true,
  };
}

export function getCodexIntegrationStatus(options?: {
  port?: number;
  gatewayServerIds?: string[];
  workspaceRoot?: string;
  targetPlatform?: CodexTargetPlatform;
  wslDistro?: string;
}): CodexIntegrationStatus {
  const port = options?.port ?? Number(process.env.PORT || 3000);
  const detectedPlatform = detectCurrentPlatform();
  const targetPlatform = normalizeTargetPlatform(options?.targetPlatform);
  const wslDistros = listWslDistros();
  const pathsInfo = getCodexPaths(targetPlatform, options?.wslDistro);
  const cli = detectCodexCliBinary(targetPlatform, pathsInfo.wslDistro || undefined);

  const read = readConfigTextForPaths(pathsInfo);
  let agentsMdExists = false;
  if (pathsInfo.canDirectWrite) {
    try {
      agentsMdExists = fs.existsSync(pathsInfo.agentsMdPath);
    } catch {
      agentsMdExists = false;
    }
  }

  let parsedServers: ParsedCodexMcpServer[] = [];
  if (read.exists && read.text) {
    try {
      parsedServers = parseCodexMcpServersFromToml(read.text);
    } catch {
      parsedServers = [];
    }
  }

  const gatewayIdSet = new Set((options?.gatewayServerIds || []).map((id) => id.toLowerCase()));
  const toolboxEntry = parsedServers.find(
    (s) => s.name === 'agent-toolbox' || s.name === 'agent_toolbox'
  );

  const discoveredServers: CodexMcpServerEntry[] = parsedServers.map((s) => {
    const cleanId = s.name
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9-]+/g, '-')
      .replace(/^-+|-+$/g, '');
    return {
      name: s.name,
      transport: s.transport,
      command: s.command,
      args: s.args,
      url: s.url,
      envKeys: Object.keys(s.env),
      enabled: s.enabled,
      isAgentToolbox: s.name === 'agent-toolbox' || s.name === 'agent_toolbox',
      alreadyImportedToGateway: gatewayIdSet.has(cleanId),
    };
  });

  const launch = resolveStdioLaunchCommand(options?.workspaceRoot, targetPlatform);
  const recommendedCliStdio = `codex mcp add agent-toolbox -- "${launch.command}" ${launch.args
    .map((a) => `"${a}"`)
    .join(' ')}`;
  const recommendedCliHttp = `# ~/.codex/config.toml\n${buildCodexTomlBlock('http', { port })}`;

  return {
    detectedPlatform,
    targetPlatform,
    platformLabel: PLATFORM_LABELS[targetPlatform],
    wslDistro: pathsInfo.wslDistro,
    wslDistros,
    canDirectWrite: pathsInfo.canDirectWrite,
    writeNote: 'writeNote' in pathsInfo ? pathsInfo.writeNote : undefined,
    cliInstalled: cli.installed,
    cliVersion: cli.version,
    codexHome: pathsInfo.codexHome,
    configPath: pathsInfo.configPath,
    configExists: read.exists,
    agentsMdExists,
    registeredInCodex: Boolean(toolboxEntry),
    registeredTransport: toolboxEntry ? toolboxEntry.transport : null,
    registeredCommandOrUrl: toolboxEntry
      ? toolboxEntry.url || [toolboxEntry.command, ...(toolboxEntry.args || [])].filter(Boolean).join(' ')
      : null,
    discoveredServers,
    recommendedTomlStdio: buildCodexTomlBlock('stdio', {
      port,
      workspaceRoot: options?.workspaceRoot,
      targetPlatform,
    }),
    recommendedTomlHttp: buildCodexTomlBlock('http', { port, targetPlatform }),
    recommendedCliStdio,
    recommendedCliHttp,
  };
}

export function readRawCodexServersForImport(options?: {
  targetPlatform?: CodexTargetPlatform;
  wslDistro?: string;
}): ParsedCodexMcpServer[] {
  const pathsInfo = getCodexPaths(options?.targetPlatform, options?.wslDistro);
  const read = readConfigTextForPaths(pathsInfo);
  if (!read.exists || !read.text) return [];
  return parseCodexMcpServersFromToml(read.text).filter(
    (s) => s.name !== 'agent-toolbox' && s.name !== 'agent_toolbox'
  );
}
