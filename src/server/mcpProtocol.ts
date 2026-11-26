import { gatewayStore } from './gatewayStore';

export interface McpDispatchOutcome {
  isNotification: boolean;
  response?: Record<string, unknown> | Array<Record<string, unknown>>;
}

const TOOLBOX_MCP_INSTRUCTIONS = [
  'Agent-Toolbox is your unified MCP gateway, dynamic Dual-Layer Skill runtime, and Cross-Agent Knowledge/Memory hub.',
  'To keep context lean, only core meta-tools and Pinned tools are shown in tools/list by default.',
  'Workflow:',
  '1. Call toolbox__discover_capabilities({ query }) to find Lazy MCP tools or Standby Skills.',
  '2. Call toolbox__inspect_schema({ toolName }) to view full parameters before calling a Lazy tool.',
  '3. Call toolbox__call_tool({ toolName, arguments }) to invoke any Lazy tool or mounted Skill tool (works even if your client does not reload tools/list dynamically).',
  '4. Call toolbox__load_skill({ skillId }) to mount SKILL.md SOP + tools, toolbox__read_skill_file to read L3 references/scripts, and toolbox__remember to share cross-agent engineering memory.',
].join('\n');

async function handleSingleRpcMessage(
  msg: Record<string, unknown>,
  hostHint: string
): Promise<Record<string, unknown> | null> {
  const hasId = msg.id !== undefined && msg.id !== null;
  const id = hasId ? msg.id : null;
  const method = typeof msg.method === 'string' ? msg.method : '';
  const params =
    msg.params && typeof msg.params === 'object' && !Array.isArray(msg.params)
      ? (msg.params as Record<string, unknown>)
      : {};

  // JSON-RPC notifications (no id) do not receive a JSON-RPC response body
  if (!hasId) {
    if (method === 'notifications/initialized') {
      gatewayStore.recordHostHeartbeat(hostHint, { latencyMs: 4 });
    }
    return null;
  }

  if (method === 'initialize') {
    const clientInfo =
      params.clientInfo && typeof params.clientInfo === 'object'
        ? (params.clientInfo as Record<string, unknown>)
        : {};
    const clientName = typeof clientInfo.name === 'string' ? clientInfo.name : '';
    const resolvedHost =
      clientName.toLowerCase().includes('codex')
        ? 'codex'
        : clientName.toLowerCase().includes('claude')
        ? 'claude'
        : clientName.toLowerCase().includes('opencode')
        ? 'opencode'
        : clientName.toLowerCase().includes('antigravity')
        ? 'antigravity'
        : hostHint;

    gatewayStore.recordHostHeartbeat(resolvedHost, { latencyMs: 4 });
    const requestedVersion =
      typeof params.protocolVersion === 'string' && params.protocolVersion.trim()
        ? params.protocolVersion.trim()
        : '2025-03-26';

    return {
      jsonrpc: '2.0',
      id,
      result: {
        protocolVersion: requestedVersion,
        capabilities: {
          tools: { listChanged: true },
          resources: { listChanged: false },
          prompts: { listChanged: false },
        },
        serverInfo: {
          name: 'agent-toolbox',
          version: '0.1.0',
        },
        instructions: TOOLBOX_MCP_INSTRUCTIONS,
      },
    };
  }

  if (method === 'ping') {
    gatewayStore.recordHostHeartbeat(hostHint, { latencyMs: 2 });
    return {
      jsonrpc: '2.0',
      id,
      result: {},
    };
  }

  if (method === 'tools/list') {
    gatewayStore.recordHostHeartbeat(hostHint);
    const tools = gatewayStore.getToolsListForMcp(hostHint);
    return {
      jsonrpc: '2.0',
      id,
      result: { tools },
    };
  }

  if (method === 'tools/call') {
    const toolName = typeof params.name === 'string' ? params.name.trim() : '';
    const args =
      params.arguments && typeof params.arguments === 'object' && !Array.isArray(params.arguments)
        ? (params.arguments as Record<string, unknown>)
        : {};

    if (!toolName) {
      return {
        jsonrpc: '2.0',
        id,
        error: { code: -32602, message: 'Missing required params.name for tools/call.' },
      };
    }

    const callRes = await gatewayStore.callMcpTool(hostHint, toolName, args);
    return {
      jsonrpc: '2.0',
      id,
      result: {
        content: callRes.content,
        ...(callRes.isError ? { isError: true } : {}),
      },
    };
  }

  if (method === 'resources/list') {
    return {
      jsonrpc: '2.0',
      id,
      result: {
        resources: gatewayStore.getResourcesListForMcp(),
      },
    };
  }

  if (method === 'prompts/list') {
    return {
      jsonrpc: '2.0',
      id,
      result: {
        prompts: gatewayStore.getPromptsListForMcp(),
      },
    };
  }

  return {
    jsonrpc: '2.0',
    id,
    error: {
      code: -32601,
      message: `Method not found: ${method || '(empty)'}`,
    },
  };
}

export async function dispatchMcpJsonRpc(
  body: unknown,
  hostHint = 'codex'
): Promise<McpDispatchOutcome> {
  if (Array.isArray(body)) {
    const results: Array<Record<string, unknown>> = [];
    for (const item of body) {
      if (!item || typeof item !== 'object' || Array.isArray(item)) continue;
      const res = await handleSingleRpcMessage(item as Record<string, unknown>, hostHint);
      if (res) results.push(res);
    }
    if (results.length === 0) {
      return { isNotification: true };
    }
    return { isNotification: false, response: results };
  }

  if (!body || typeof body !== 'object') {
    return {
      isNotification: false,
      response: {
        jsonrpc: '2.0',
        id: null,
        error: { code: -32600, message: 'Invalid JSON-RPC request payload.' },
      },
    };
  }

  const res = await handleSingleRpcMessage(body as Record<string, unknown>, hostHint);
  if (!res) {
    return { isNotification: true };
  }
  return { isNotification: false, response: res };
}
