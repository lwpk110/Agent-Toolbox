import { executeMeta } from './mcpMetaExecutor';
import { gatewayStore, type GatewayStore } from './gatewayStore';

import { RpcError, rpcError } from './rpcError';
export { rpcError } from './rpcError';
export function isObject(value: unknown): value is Record<string, any> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
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
  return async function handle(msg: unknown, context: { hostName?: string } = {}): Promise<any> {
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
          const args = params.arguments || {};
          const definition = store.getMcpTool(params.name, hostName);
          const schema = definition.inputSchema as any;
          validateArguments(args, schema);
          const actual: any = params.name.startsWith('toolbox__') ? executeMeta(store, params.name, args, hostName) : await store.callDownstream(params.name, args);
          result = { content: [{ type: 'text', text: store.redactSensitiveText(JSON.stringify(actual)) }], ...(actual?.isError ? { isError: true } : {}) };
          break;
        }
        default: throw new RpcError(-32601, `Method not found: ${msg.method}`);
      }
      response = { jsonrpc: '2.0', id: msg.id, result };
    } catch (error) {
      response = rpcError(msg.id, error instanceof RpcError ? error.code : -32603, error instanceof Error ? error.message : String(error));
    }
    if (msg.method === 'tools/call') store.recordMcpCall(hostName, msg, response, started);
    return response;
  };
}
export const handleMcpMessage = createMcpHandler(gatewayStore);
