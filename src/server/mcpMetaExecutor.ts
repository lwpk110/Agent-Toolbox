import { normalizeSkillFilePath, type GatewayStore } from './gatewayStore';
import { RpcError } from './rpcError';

export function executeMeta(store: GatewayStore, name: string, args: Record<string, any>, host: string): unknown {
  const snapshot = store.getSnapshot();
  switch (name) {
    case 'toolbox__search_knowledge': {
      const result = store.searchKnowledge(args.query);
      return { ...result, memories: args.includeMemory === false ? [] : result.memories, routing: args.includeRouting === false ? [] : result.routing };
    }
    case 'toolbox__discover_capabilities': {
      const query = args.query.toLowerCase();
      const matches = [
        ...snapshot.servers.filter(s => s.enabled).flatMap(s => s.tools.map(t => ({ id: t.name, kind: 'tool', mode: t.mode, summary: t.description }))),
        ...snapshot.skills.map(s => ({ id: s.id, kind: 'skill', mode: s.mounted ? 'mounted' : 'standby', summary: s.summary })),
      ].map(item => ({ ...item, score: `${item.id} ${item.summary}`.toLowerCase().includes(query) ? 1 : 0 }))
        .filter(item => item.score > 0).slice(0, args.topK ?? 5);
      return { matches };
    }
    case 'toolbox__inspect_schema': {
      const tool = snapshot.servers.flatMap(s => s.tools).find(t => t.name === args.toolName);
      if (!tool) throw new RpcError(-32602, 'Tool not found');
      return { ...tool, inputSchema: tool.inputSchema || { type: 'object', properties: {} } };
    }
    case 'toolbox__load_skill': {
      const skill = store.mountSkill(args.skillId, host);
      if (!skill) throw new RpcError(-32602, 'Skill not found');
      return { status: 'mounted', bundleFingerprint: skill.fingerprint, injectedTools: skill.attachedTools.map(t => t.name), tokenBreakdown: skill.tokenBreakdown, availableFiles: skill.files.map(f => ({ path: f.path, category: f.category })), skillMarkdownPreview: skill.skillMarkdown };
    }
    case 'toolbox__unload_skill': {
      const skill = snapshot.skills.find(s => s.id === args.skillId);
      if (!skill || (skill.mounted && skill.mountedBy !== host)) throw new RpcError(-32602, 'Skill not mounted by this host');
      store.unmountSkill(args.skillId);
      return { status: 'unmounted', freedTokens: skill.estimatedTokens };
    }
    case 'toolbox__read_skill_file': {
      const filePath = normalizeSkillFilePath(args.filePath);
      const skill = snapshot.skills.find(s => s.id === args.skillId);
      const file = filePath && skill?.files.find(f => f.path === filePath);
      if (!skill || !file) throw new RpcError(-32602, 'Invalid skill or filePath');
      return { skillId: skill.id, path: file.path, category: file.category, tier: 'L3', sha256: file.sha256, bundleFingerprint: skill.fingerprint, content: store.redactSensitiveText(file.content) };
    }
    default: throw new RpcError(-32602, 'Unknown tool');
  }
}
