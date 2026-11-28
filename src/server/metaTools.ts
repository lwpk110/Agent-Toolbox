const string = { type: 'string', minLength: 1 };
function tool(name: string, description: string, properties: Record<string, unknown>, required: string[]) {
  return { name: `toolbox__${name}`, description, inputSchema: { type: 'object', properties, required, additionalProperties: false } };
}
export const metaTools = [
  tool('discover_capabilities', '发现 Lazy 工具与可挂载 Skill', { query: string, topK: { type: 'integer', minimum: 1 } }, ['query']),
  tool('inspect_schema', '查看工具完整 Schema', { toolName: string }, ['toolName']),
  tool('load_skill', '挂载 Skill 目录包和附带工具', { skillId: string }, ['skillId']),
  tool('read_skill_file', '按需读取 Skill 文件', { skillId: string, filePath: string }, ['skillId', 'filePath']),
  tool('unload_skill', '卸载 Skill 并释放上下文', { skillId: string }, ['skillId']),
  tool('search_knowledge', '检索文档、共享记忆与能力推荐', { query: string, includeMemory: { type: 'boolean' }, includeRouting: { type: 'boolean' } }, ['query']),
  tool('call_tool', '通过网关安全管线调用已发现的 Lazy 工具或已挂载 Skill 工具', { toolName: string, arguments: { type: 'object' } }, ['toolName']),
  tool('remember', '把一条共享记忆写入网关', { topic: string, content: string, scope: { type: 'string' } }, ['content']),
];
