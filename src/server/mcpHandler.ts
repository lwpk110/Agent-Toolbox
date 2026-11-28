import { executeMeta } from './mcpMetaExecutor';
import { gatewayStore, type GatewayStore } from './gatewayStore';
import { spawn } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { RpcError, rpcError } from './rpcError';
export { rpcError } from './rpcError';

const META_TOOL_NAMES = [
  'toolbox__discover_capabilities',
  'toolbox__inspect_schema',
  'toolbox__call_tool',
  'toolbox__load_skill',
  'toolbox__unload_skill',
  'toolbox__read_skill_file',
  'toolbox__search_knowledge',
  'toolbox__remember',
] as const;

function canonicalizeMcpName(name: string): string {
  return META_TOOL_NAMES.find(item => item.toLowerCase() === name.toLowerCase()) ?? name;
}

function isReservedToolboxName(name: string): boolean {
  return /^toolbox__/i.test(name);
}

export function isObject(value: unknown): value is Record<string, any> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

async function executeSkillTool(store: GatewayStore, name: string, args: Record<string, unknown>, hostName: string): Promise<unknown> {
  const skill = store.getSnapshot().skills.find(item => item.origin !== 'demo' && item.mounted && item.mountedBy === hostName && item.attachedTools.some(tool => tool.name === name));
  if (!skill) throw new RpcError(-32602, 'Skill tool is not mounted for this host');
  const attached = skill.attachedTools.find(tool => tool.name === name)!;
  const namedScript = name.slice(name.indexOf('__') + 2);
  const filePath = skill.files.find(file => file.category === 'script' && file.path.startsWith('scripts/')
    && file.path.replace(/^scripts\//, '').replace(/\.[^.]+$/, '').toLowerCase().replace(/[^a-z0-9_]/g, '_') === namedScript)?.path
    || (skill.attachedTools.length === 1 ? skill.files.find(file => file.category === 'script' && file.path.startsWith('scripts/'))?.path : undefined);
  const sourcePath = skill.sourcePath;
  if (!filePath || !sourcePath?.startsWith('skills/') || !/^scripts\/[\w.-]+\.(?:[cm]?js|ts)$/.test(filePath)) throw new RpcError(-32602, 'Skill tool has no executable package script');
  const skillsRoot = fs.realpathSync(path.resolve(process.cwd(), 'skills'));
  const packageRoot = path.resolve(process.cwd(), sourcePath);
  const scriptPath = path.resolve(packageRoot, filePath);
  const relative = path.relative(packageRoot, scriptPath);
  const realPackageRoot = fs.realpathSync(packageRoot);
  const realScriptPath = fs.realpathSync(scriptPath);
  if (path.relative(skillsRoot, realPackageRoot).startsWith('..') || relative.startsWith('..') || path.isAbsolute(relative) || !realScriptPath.startsWith(`${realPackageRoot}${path.sep}`)) throw new RpcError(-32602, 'Skill script is outside its package');
  if (!skill.files.some(file => file.path === filePath && file.category === 'script')) throw new RpcError(-32602, 'Skill script is not classified as a script');
  const token = args.token;
  if (typeof token !== 'string') throw new RpcError(-32602, 'Missing argument: arguments.token');
  const executable = 'node';
  const scriptArgs = filePath.endsWith('.ts') ? ['--import', 'tsx/esm', scriptPath, token] : [scriptPath, token];
  return await new Promise((resolve, reject) => {
    const outputFile = path.join(requireTmpDir(), `toolbox-skill-${crypto.randomUUID()}.out`);
    const outputFd = fs.openSync(outputFile, 'wx', 0o600);
    const child = spawn(executable, scriptArgs, { cwd: packageRoot, stdio: ['ignore', outputFd, 'pipe'], shell: false });
    let stderr = '';
    const timer = setTimeout(() => child.kill('SIGKILL'), 10_000);
    child.stderr?.setEncoding('utf8').on('data', chunk => { stderr += chunk; });
    child.on('error', error => { clearTimeout(timer); fs.closeSync(outputFd); fs.rmSync(outputFile, { force: true }); reject(new RpcError(-32602, `Could not start skill script: ${error.message}`)); });
    child.on('close', code => {
      clearTimeout(timer);
      fs.closeSync(outputFd);
      const stdout = fs.readFileSync(outputFile, 'utf8');
      fs.rmSync(outputFile, { force: true });
      if (code !== 0) return reject(new RpcError(-32602, `Skill script failed${stderr ? `: ${stderr.trim()}` : ''}`));
      const output = stdout.trimEnd();
      try { resolve(JSON.parse(output)); } catch { resolve(output); }
    });
  });
}

function requireTmpDir(): string {
  return os.tmpdir();
}

function validateArguments(value: unknown, schema: any, path = 'arguments'): void {
  if (!schema || typeof schema !== 'object') return;
  const matchesType = (type: string) => {
    switch (type) {
      case 'object': return isObject(value);
      case 'array': return Array.isArray(value);
      case 'null': return value === null;
      case 'integer': return Number.isInteger(value);
      default: return typeof value === type;
    }
  };
  const types = schema.type ? (Array.isArray(schema.type) ? schema.type : [schema.type]) : [];
  if (types.length && !types.some(matchesType)) throw new RpcError(-32602, `Invalid type: ${path}`);
  if (typeof value === 'string' && schema.minLength !== undefined && value.length < schema.minLength) throw new RpcError(-32602, `Invalid length: ${path}`);
  if (typeof value === 'number' && schema.minimum !== undefined && value < schema.minimum) throw new RpcError(-32602, `Invalid minimum: ${path}`);
  if (isObject(value)) {
    for (const key of schema.required || []) if (!Object.hasOwn(value, key)) throw new RpcError(-32602, `Missing argument: ${path}.${key}`);
    for (const [key, item] of Object.entries(value)) {
      const rule = schema.properties?.[key];
      if (!rule && schema.additionalProperties === false) throw new RpcError(-32602, `Unknown argument: ${path}.${key}`);
      if (rule) validateArguments(item, rule, `${path}.${key}`);
    }
  }
  if (Array.isArray(value) && schema.items) value.forEach((item, index) => validateArguments(item, schema.items, `${path}[${index}]`));
}

export function createMcpHandler(store: GatewayStore) {
  return async function handle(msg: unknown, context: { hostName?: string; sessionId?: string } = {}): Promise<any> {
    if (Array.isArray(msg)) {
      if (!msg.length) return rpcError(null, -32600, 'Invalid Request');
      const results = [];
      for (const item of msg) {
        const result = await handle(item, context);
        if (result !== null) results.push(result);
      }
      return results.length ? results : null;
    }
    if (!isObject(msg) || msg.jsonrpc !== '2.0' || typeof msg.method !== 'string' ||
        ('id' in msg && msg.id !== null && typeof msg.id !== 'string' && typeof msg.id !== 'number')) {
      return rpcError(null, -32600, 'Invalid Request');
    }
    if (!('id' in msg)) return null;
    const started = Date.now();
    const hostName = context.hostName || msg.params?.clientInfo?.name || 'Unknown Host';
    let response: any;
    try {
      if (msg.params !== undefined && !isObject(msg.params)) throw new RpcError(-32602, 'Invalid params');
      const params = msg.params || {};
      let result: unknown;
      switch (msg.method) {
        case 'initialize':
          if (typeof params.protocolVersion !== 'string' || !isObject(params.clientInfo) || typeof params.clientInfo.name !== 'string') throw new RpcError(-32602, 'Invalid initialize params');
          result = {
            protocolVersion: ['2025-06-18', '2025-03-26', '2024-11-05'].includes(params.protocolVersion) ? params.protocolVersion : '2025-06-18',
            capabilities: { tools: { listChanged: true } },
            serverInfo: { name: 'agent-toolbox', version: '0.0.0' },
          };
          break;
        case 'ping': result = {}; break;
        case 'tools/list': await store.refreshMcpTools(); result = { tools: store.getMcpTools(hostName) }; break;
        case 'tools/call': {
          if (typeof params.name !== 'string' || (params.arguments !== undefined && !isObject(params.arguments))) throw new RpcError(-32602, 'Invalid tools/call params');
          let name = canonicalizeMcpName(params.name);
          let args = params.arguments || {};
          if (name === 'toolbox__call_tool') {
            const innerName = canonicalizeMcpName(String(args.toolName || args.name || '').trim());
            const innerArgs = isObject(args.arguments) ? args.arguments : {};
            if (!innerName || innerName === 'toolbox__call_tool') throw new RpcError(-32602, 'Valid target toolName is required for toolbox__call_tool.');
            name = innerName;
            args = innerArgs;
          }
          const matchingSkill = store.getSnapshot().skills.find(skill => skill.origin !== 'demo' && skill.mounted && skill.mountedBy === hostName && skill.attachedTools.some(tool => tool.name === name));
          if (!isReservedToolboxName(name) && !matchingSkill) await store.validateMcpTool(name);
          const definition = store.getMcpTool(name, hostName);
          const schema = definition.inputSchema as any;
          validateArguments(args, schema);
          if (!isReservedToolboxName(name) && store.requiresHitlApproval(definition)) {
            const approval = store.createHitlHold({ toolName: name, args, host: hostName, sessionId: context.sessionId });
            const decision = await store.awaitHitlDecision(approval);
            if (decision !== 'approve') {
              throw new RpcError(-32002, decision === 'timeout'
                ? 'HITL approval timed out before execution'
                : 'Operation rejected by HITL human approval gate');
            }
          }
          const skillTool = Boolean(matchingSkill);
          const actual: any = isReservedToolboxName(name) ? executeMeta(store, name, args, hostName) : skillTool
            ? await executeSkillTool(store, name, args, hostName)
            : await store.callDownstream(name, args);
          result = { content: [{ type: 'text', text: store.redactSensitiveText(typeof actual === 'string' ? actual : JSON.stringify(actual)) }], ...(actual?.isError ? { isError: true } : {}) };
          break;
        }
        default: throw new RpcError(-32601, `Method not found: ${msg.method}`);
      }
      response = { jsonrpc: '2.0', id: msg.id, result };
    } catch (error) {
      response = rpcError(msg.id, error instanceof RpcError ? error.code : -32603, error instanceof Error ? error.message : String(error), error instanceof RpcError ? error.data : undefined);
    }
    if (msg.method === 'tools/call') store.recordMcpCall(hostName, msg, response, started);
    return response;
  };
}
export const handleMcpMessage = createMcpHandler(gatewayStore);
