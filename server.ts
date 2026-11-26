import express from 'express';
import fs from 'fs';
import path from 'path';
import type { DocCategory, DocMeta } from './src/types/docs';
import type {
  ExposureMode,
  HostScope,
  MiddlewareId,
  SkillSourceType,
  TransportProtocol,
  WorkspaceSkillCandidate,
} from './src/types/toolbox';
import {
  classifySkillFile,
  gatewayStore,
  normalizeSkillFilePath,
  parseSkillFrontmatter,
} from './src/server/gatewayStore';

const app = express();
const PORT = Number(process.env.PORT || 3000);
const ROOT_DIR = process.cwd();
const DOCS_DIR = path.resolve(ROOT_DIR, 'docs');
const SKILLS_DIR = path.resolve(ROOT_DIR, 'skills');
const PROTYPE_DIR = path.resolve(ROOT_DIR, 'protype');
const DIST_DIR = path.resolve(ROOT_DIR, 'dist');

app.use(express.json({ limit: '4mb' }));

interface RegistryEntry {
  slug: string;
  filename: string;
  title: string;
  shortTitle: string;
  category: DocCategory;
  summary: string;
}

const DOC_REGISTRY: RegistryEntry[] = [
  {
    slug: 'overview',
    filename: 'README.md',
    title: '工程文档中心总览',
    shortTitle: '文档体系总览',
    category: '产品与规划',
    summary: '文档依赖关系图、阅读路线与统一术语对齐表。',
  },
  {
    slug: 'prd',
    filename: 'prd.md',
    title: 'PRD 产品需求文档',
    shortTitle: 'PRD 产品需求',
    category: '产品与规划',
    summary: '6 大模块逐项需求、宿主权限矩阵、KPI 目标与可测试验收标准。',
  },
  {
    slug: 'feasibility',
    filename: 'feasibility_report.md',
    title: '可行性审查与 7 仓对标报告',
    shortTitle: '可行性审查报告',
    category: '产品与规划',
    summary: '7 大 GitHub 开源项目融合矩阵、四大宿主兼容评级与工程瓶颈解法。',
  },
  {
    slug: 'plan',
    filename: 'implementation_plan.md',
    title: '分阶段实施计划与界面线框',
    shortTitle: '分阶段实施计划',
    category: '产品与规划',
    summary: '视觉 Token 规范、6 大界面 ASCII 线框图与 5 阶段落地路线。',
  },
  {
    slug: 'architecture',
    filename: 'architecture.md',
    title: '系统架构设计文档',
    shortTitle: '系统架构设计',
    category: '架构与决策',
    summary: 'Hub-and-Spoke 拓扑、单守护进程模型、5 级中间件管道、双层 Skill 与三位一体向量引擎。',
  },
  {
    slug: 'adr',
    filename: 'adr.md',
    title: 'ADR 架构决策记录集 (001–006)',
    shortTitle: 'ADR 决策记录集',
    category: '架构与决策',
    summary: '6 项关键工程技术选型的背景痛点、备选方案对比与长期后果。',
  },
  {
    slug: 'api-mcp-spec',
    filename: 'api-mcp-spec.md',
    title: 'API 与 MCP 协议规范',
    shortTitle: 'API & MCP 协议',
    category: '协议与安全',
    summary: '全系统 ER 数据模型、TypeScript 契约、5 元工具 JSON-RPC 规范、错误码与 REST/SSE API。',
  },
  {
    slug: 'security-gitops',
    filename: 'security-gitops.md',
    title: '安全威胁模型与 GitOps 同步设计',
    shortTitle: '安全与 GitOps 设计',
    category: '协议与安全',
    summary: 'STRIDE 威胁分析、Quarantine 状态机、HITL 审批、Output Redaction、Vault 与零泄漏同步门禁。',
  },
];

const REGISTRY_BY_SLUG = new Map<string, RegistryEntry>(DOC_REGISTRY.map((entry) => [entry.slug, entry]));

function readDocEntry(slug: string): { meta: DocMeta; content: string } | null {
  const entry = REGISTRY_BY_SLUG.get(slug);
  if (!entry) return null;

  const fullPath = path.resolve(DOCS_DIR, entry.filename);
  if (!fullPath.startsWith(DOCS_DIR + path.sep)) {
    return null;
  }

  const content = fs.existsSync(fullPath)
    ? fs.readFileSync(fullPath, 'utf-8')
    : `# Missing document\n\n\`docs/${entry.filename}\` was not found.`;

  const diagramMatches = content.match(/^```mermaid\b/gm);
  const diagramCount = diagramMatches ? diagramMatches.length : 0;
  const wordCount = content.replace(/\s+/g, '').length;
  const readMinutes = Math.max(1, Math.ceil(wordCount / 550));

  return {
    meta: {
      ...entry,
      diagramCount,
      wordCount,
      readMinutes,
    },
    content,
  };
}

function sendOk(res: express.Response, data: unknown, extra?: Record<string, unknown>) {
  res.json({
    ok: true,
    ...extra,
    data,
    meta: { timestamp: new Date().toISOString() },
  });
}

function sendErr(res: express.Response, status: number, code: string, message: string) {
  res.status(status).json({
    ok: false,
    error: { code, message },
  });
}

const IGNORED_SKILL_DIRS = new Set(['node_modules', '.git', 'dist', 'build', 'system_skills']);
const MAX_WORKSPACE_FILE_BYTES = 200 * 1024;
const MAX_WORKSPACE_FILES = 60;

function readWorkspaceSkillDirectory(relativeDir: string): {
  relativeDir?: string;
  files?: Array<{ path: string; content: string; sizeBytes: number }>;
  error?: string;
} {
  const cleanRel = normalizeSkillFilePath(relativeDir);
  if (!cleanRel) {
    return { error: '目录路径非法，仅允许 skills/ 下的相对路径。' };
  }
  const segs = cleanRel.split('/');
  if (segs.some((s) => s.startsWith('.') || IGNORED_SKILL_DIRS.has(s))) {
    return { error: '禁止导入受保护或隐藏目录。' };
  }
  if (!fs.existsSync(SKILLS_DIR)) {
    return { error: '工作区不存在 skills/ 目录。' };
  }

  const realSkillsRoot = fs.realpathSync(SKILLS_DIR);
  const candidateAbs = path.resolve(SKILLS_DIR, cleanRel);
  if (!candidateAbs.startsWith(SKILLS_DIR + path.sep) || !fs.existsSync(candidateAbs)) {
    return { error: `未找到工作区目录 skills/${cleanRel}。` };
  }

  const realTargetDir = fs.realpathSync(candidateAbs);
  if (!realTargetDir.startsWith(realSkillsRoot + path.sep) || !fs.statSync(realTargetDir).isDirectory()) {
    return { error: '目标目录超出允许的工作区范围。' };
  }

  const collected: Array<{ path: string; content: string; sizeBytes: number }> = [];

  const walk = (currentDir: string, relPrefix: string, depth: number) => {
    if (depth > 4 || collected.length >= MAX_WORKSPACE_FILES) return;
    const entries = fs.readdirSync(currentDir, { withFileTypes: true });
    for (const entry of entries) {
      if (collected.length >= MAX_WORKSPACE_FILES) break;
      if (entry.name.startsWith('.') || IGNORED_SKILL_DIRS.has(entry.name)) continue;

      const absChild = path.join(currentDir, entry.name);
      let realChild: string;
      try {
        realChild = fs.realpathSync(absChild);
      } catch {
        continue;
      }
      if (!realChild.startsWith(realTargetDir + path.sep)) continue;

      const relChild = relPrefix ? `${relPrefix}/${entry.name}` : entry.name;
      const stat = fs.statSync(realChild);
      if (stat.isDirectory()) {
        walk(realChild, relChild, depth + 1);
      } else if (stat.isFile()) {
        if (stat.size > MAX_WORKSPACE_FILE_BYTES) continue;
        const buf = fs.readFileSync(realChild);
        if (buf.includes(0)) continue; // Skip binary files
        const normalizedRel = normalizeSkillFilePath(relChild);
        if (!normalizedRel) continue;
        collected.push({
          path: normalizedRel,
          content: buf.toString('utf8'),
          sizeBytes: stat.size,
        });
      }
    }
  };

  walk(realTargetDir, '', 0);
  if (!collected.some((f) => f.path === 'SKILL.md')) {
    return { error: `目录 skills/${cleanRel} 缺少必需的 SKILL.md 入口文件。` };
  }

  return { relativeDir: cleanRel, files: collected };
}

function listWorkspaceSkillCandidates(): WorkspaceSkillCandidate[] {
  if (!fs.existsSync(SKILLS_DIR)) return [];
  const realSkillsRoot = fs.realpathSync(SKILLS_DIR);
  const importedIds = new Set(gatewayStore.getSnapshot().skills.map((s) => s.id));
  const candidateRelDirs: string[] = [];

  const scan = (dir: string, relPrefix: string, depth: number) => {
    if (depth > 2) return;
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      if (entry.name.startsWith('.') || IGNORED_SKILL_DIRS.has(entry.name)) continue;
      const abs = path.join(dir, entry.name);
      let realAbs: string;
      try {
        realAbs = fs.realpathSync(abs);
      } catch {
        continue;
      }
      if (!realAbs.startsWith(realSkillsRoot + path.sep)) continue;
      const rel = relPrefix ? `${relPrefix}/${entry.name}` : entry.name;
      if (fs.existsSync(path.join(realAbs, 'SKILL.md'))) {
        candidateRelDirs.push(rel);
      } else {
        scan(realAbs, rel, depth + 1);
      }
    }
  };

  scan(realSkillsRoot, '', 0);

  const candidates: WorkspaceSkillCandidate[] = [];
  for (const relDir of candidateRelDirs.sort()) {
    const read = readWorkspaceSkillDirectory(relDir);
    if (!read.files) continue;
    const entryFile = read.files.find((f) => f.path === 'SKILL.md');
    const fm = entryFile ? parseSkillFrontmatter(entryFile.content) : {};
    const rawId = (fm.name || relDir.split('/').pop() || relDir)
      .toLowerCase()
      .replace(/[^a-z0-9-]+/g, '-')
      .replace(/^-+|-+$/g, '');
    const id = rawId || 'custom-skill';
    candidates.push({
      relativeDir: relDir,
      id,
      version: fm.version || '1.0.0',
      summary: (fm.description || `工作区目录 skills/${relDir}`).slice(0, 180),
      fileCount: read.files.length,
      files: read.files.map((f) => ({
        path: f.path,
        category: classifySkillFile(f.path).category,
        sizeBytes: f.sizeBytes,
      })),
      alreadyImported: importedIds.has(id),
    });
  }

  return candidates;
}

/* ---------- Health ---------- */
app.get('/health', (_req, res) => {
  const metrics = gatewayStore.getMetrics();
  res.json({
    status: 'ok',
    mode: 'agent-toolbox-gateway',
    metrics,
    docsCount: DOC_REGISTRY.length,
  });
});

/* ---------- Agent-Toolbox Gateway REST API (/api/v1/*) ---------- */
app.get('/api/v1/state', (_req, res) => {
  sendOk(res, gatewayStore.getSnapshot());
});

app.get('/api/v1/events', (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders?.();

  res.write(`event: connected\ndata: ${JSON.stringify({ timestamp: new Date().toISOString() })}\n\n`);

  const onEvent = (evt: { type: string; timestamp: string; payload: unknown }) => {
    res.write(`event: ${evt.type}\ndata: ${JSON.stringify(evt)}\n\n`);
  };

  gatewayStore.events.on('gateway-event', onEvent);
  const keepalive = setInterval(() => {
    res.write(': keepalive\n\n');
  }, 25000);

  req.on('close', () => {
    clearInterval(keepalive);
    gatewayStore.events.off('gateway-event', onEvent);
  });
});

app.post('/api/v1/hosts', (req, res) => {
  const { name, scope, transport } = req.body || {};
  if (typeof name !== 'string' || !name.trim()) {
    sendErr(res, 400, 'INVALID_HOST', '请填写宿主名称。');
    return;
  }
  const safeScope: HostScope = ['full', 'audit', 'min'].includes(scope) ? scope : 'audit';
  const safeTransport: 'stdio' | 'sse' = transport === 'sse' ? 'sse' : 'stdio';
  const result = gatewayStore.addHost({ name, scope: safeScope, transport: safeTransport });
  if (result.error) {
    sendErr(res, 400, 'HOST_CREATE_FAILED', result.error);
    return;
  }
  sendOk(res, gatewayStore.getSnapshot(), { hostId: result.host?.id });
});

app.delete('/api/v1/hosts/:id', (req, res) => {
  const result = gatewayStore.deleteHost(req.params.id);
  if (!result.ok) {
    sendErr(res, 400, 'HOST_DELETE_FAILED', result.error || '无法删除宿主。');
    return;
  }
  sendOk(res, gatewayStore.getSnapshot());
});

app.patch('/api/v1/hosts/:id/scope', (req, res) => {
  const scope = req.body?.scope as HostScope;
  if (!['full', 'audit', 'min'].includes(scope)) {
    sendErr(res, 400, 'INVALID_SCOPE', '无效的权限作用域，仅支持 full / audit / min。');
    return;
  }
  const updated = gatewayStore.updateHostScope(req.params.id, scope);
  if (!updated) {
    sendErr(res, 404, 'HOST_NOT_FOUND', '未找到指定的 Agent 宿主。');
    return;
  }
  sendOk(res, gatewayStore.getSnapshot());
});

app.patch('/api/v1/middleware/:id', (req, res) => {
  const id = req.params.id as MiddlewareId;
  const { enabled, config } = req.body || {};
  if (!['vault', 'quarantine', 'hitl', 'redact', 'budget'].includes(id)) {
    sendErr(res, 400, 'INVALID_MIDDLEWARE', '无效的中间件标识。');
    return;
  }
  if (typeof enabled !== 'boolean' && (!config || typeof config !== 'object')) {
    sendErr(res, 400, 'INVALID_MIDDLEWARE', '请提供开关状态或配置参数。');
    return;
  }
  if (typeof enabled === 'boolean') {
    gatewayStore.toggleMiddleware(id, enabled);
  }
  if (config && typeof config === 'object' && typeof config.maxTokensPerTurn === 'number') {
    gatewayStore.updateMiddlewareConfig(id, { maxTokensPerTurn: config.maxTokensPerTurn });
  }
  sendOk(res, gatewayStore.getSnapshot());
});

app.post('/api/v1/servers/import-json', (req, res) => {
  const { rawJson, defaultMode } = req.body || {};
  if (typeof rawJson !== 'string' || !rawJson.trim()) {
    sendErr(res, 400, 'INVALID_JSON', '请粘贴标准 mcp.json 内容。');
    return;
  }
  const mode: ExposureMode = defaultMode === 'pinned' ? 'pinned' : 'lazy';
  const result = gatewayStore.importMcpJson(rawJson, mode);
  if (result.error) {
    sendErr(res, 400, 'MCP_JSON_IMPORT_FAILED', result.error);
    return;
  }
  sendOk(res, gatewayStore.getSnapshot(), {
    addedIds: result.addedIds,
    skippedIds: result.skippedIds,
  });
});

app.post('/api/v1/servers', (req, res) => {
  const { name, protocol, commandOrUrl, args, env, headers, defaultMode, secretRef, initialToolName, initialToolDesc } =
    req.body || {};
  if (typeof name !== 'string' || !name.trim()) {
    sendErr(res, 400, 'INVALID_NAME', '请填写 MCP Server 命名空间名称。');
    return;
  }
  if (!['stdio', 'sse', 'http'].includes(protocol)) {
    sendErr(res, 400, 'INVALID_PROTOCOL', '传输协议仅支持 stdio / sse / http。');
    return;
  }
  if (typeof commandOrUrl !== 'string' || !commandOrUrl.trim()) {
    sendErr(res, 400, 'INVALID_ENDPOINT', '请填写启动命令或远程接入地址。');
    return;
  }
  const mode: ExposureMode = defaultMode === 'pinned' ? 'pinned' : 'lazy';
  const result = gatewayStore.addServer({
    name,
    protocol: protocol as TransportProtocol,
    commandOrUrl,
    args: Array.isArray(args) ? args.map(String) : undefined,
    env: env && typeof env === 'object' && !Array.isArray(env) ? env : undefined,
    headers: headers && typeof headers === 'object' && !Array.isArray(headers) ? headers : undefined,
    defaultMode: mode,
    secretRef: typeof secretRef === 'string' ? secretRef : undefined,
    initialToolName: typeof initialToolName === 'string' ? initialToolName : undefined,
    initialToolDesc: typeof initialToolDesc === 'string' ? initialToolDesc : undefined,
  });
  if (result.error) {
    sendErr(res, 400, 'SERVER_CREATE_FAILED', result.error);
    return;
  }
  sendOk(res, gatewayStore.getSnapshot());
});

app.patch('/api/v1/servers/:id', (req, res) => {
  const { protocol, commandOrUrl, args, env, headers, enabled, secretRef } = req.body || {};
  const result = gatewayStore.updateServer(req.params.id, {
    protocol: ['stdio', 'sse', 'http'].includes(protocol) ? (protocol as TransportProtocol) : undefined,
    commandOrUrl: typeof commandOrUrl === 'string' ? commandOrUrl : undefined,
    args: Array.isArray(args) ? args.map(String) : undefined,
    env: env && typeof env === 'object' && !Array.isArray(env) ? env : undefined,
    headers: headers && typeof headers === 'object' && !Array.isArray(headers) ? headers : undefined,
    enabled: typeof enabled === 'boolean' ? enabled : undefined,
    secretRef: typeof secretRef === 'string' ? secretRef : undefined,
  });
  if (result.error) {
    const status = result.error.includes('未找到') ? 404 : 400;
    sendErr(res, status, 'SERVER_UPDATE_FAILED', result.error);
    return;
  }
  sendOk(res, gatewayStore.getSnapshot());
});

app.delete('/api/v1/servers/:id', (req, res) => {
  const ok = gatewayStore.deleteServer(req.params.id);
  if (!ok) {
    sendErr(res, 404, 'SERVER_NOT_FOUND', '未找到指定的 MCP Server。');
    return;
  }
  sendOk(res, gatewayStore.getSnapshot());
});

app.patch('/api/v1/servers/:id/tools-mode', (req, res) => {
  const mode = req.body?.mode;
  if (mode !== 'pinned' && mode !== 'lazy') {
    sendErr(res, 400, 'INVALID_MODE', '加载方式仅支持 pinned 或 lazy。');
    return;
  }
  const updated = gatewayStore.setServerToolsMode(req.params.id, mode);
  if (!updated) {
    sendErr(res, 404, 'SERVER_NOT_FOUND', '未找到指定的 MCP Server。');
    return;
  }
  sendOk(res, gatewayStore.getSnapshot());
});

app.post('/api/v1/servers/:id/ping', (req, res) => {
  const pinged = gatewayStore.pingServer(req.params.id);
  if (!pinged) {
    sendErr(res, 404, 'SERVER_NOT_FOUND', '未找到指定的 MCP Server。');
    return;
  }
  sendOk(res, gatewayStore.getSnapshot());
});

app.patch('/api/v1/tools/:toolName', (req, res) => {
  const { mode, hitl } = req.body || {};
  const patch: { mode?: ExposureMode; hitl?: boolean } = {};
  if (mode !== undefined) {
    if (mode !== 'pinned' && mode !== 'lazy') {
      sendErr(res, 400, 'INVALID_MODE', '加载方式仅支持 pinned 或 lazy。');
      return;
    }
    patch.mode = mode;
  }
  if (hitl !== undefined) {
    if (typeof hitl !== 'boolean') {
      sendErr(res, 400, 'INVALID_HITL', 'HITL 开关必须为布尔值。');
      return;
    }
    patch.hitl = hitl;
  }
  const updated = gatewayStore.updateTool(req.params.toolName, patch);
  if (!updated) {
    sendErr(res, 404, 'TOOL_NOT_FOUND', '未找到指定工具。');
    return;
  }
  sendOk(res, gatewayStore.getSnapshot());
});

app.post('/api/v1/quarantine/:serverId/resolve', (req, res) => {
  const action = req.body?.action;
  if (action !== 'rollback' && action !== 'trust') {
    sendErr(res, 400, 'INVALID_ACTION', '仅支持 rollback 或 trust 处置动作。');
    return;
  }
  const resolved = gatewayStore.resolveQuarantine(req.params.serverId, action);
  if (!resolved) {
    sendErr(res, 404, 'SERVER_NOT_FOUND', '未找到待处置的隔离服务。');
    return;
  }
  sendOk(res, gatewayStore.getSnapshot());
});

app.post('/api/v1/quarantine/simulate', (req, res) => {
  const serverId = typeof req.body?.serverId === 'string' ? req.body.serverId : 'scraper';
  gatewayStore.simulateQuarantine(serverId);
  sendOk(res, gatewayStore.getSnapshot());
});

app.get('/api/v1/skills/workspace-candidates', (_req, res) => {
  sendOk(res, listWorkspaceSkillCandidates());
});

app.post('/api/v1/skills/import-directory', (req, res) => {
  const { relativeDir, id, version, summary, toolName } = req.body || {};
  if (typeof relativeDir !== 'string' || !relativeDir.trim()) {
    sendErr(res, 400, 'INVALID_DIRECTORY', '请指定要导入的工作区 Skill 目录路径。');
    return;
  }
  const read = readWorkspaceSkillDirectory(relativeDir);
  if (read.error || !read.files || !read.relativeDir) {
    sendErr(res, 400, 'DIRECTORY_READ_FAILED', read.error || '无法读取工作区 Skill 目录。');
    return;
  }
  const entryFile = read.files.find((f) => f.path === 'SKILL.md');
  const fm = entryFile ? parseSkillFrontmatter(entryFile.content) : {};
  const derivedId = (
    (typeof id === 'string' && id.trim()) ||
    fm.name ||
    read.relativeDir.split('/').pop() ||
    'workspace-skill'
  )
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/^-+|-+$/g, '');

  const result = gatewayStore.createSkill({
    id: derivedId,
    version: typeof version === 'string' && version.trim() ? version : fm.version,
    summary: typeof summary === 'string' && summary.trim() ? summary : fm.description,
    skillMarkdown: entryFile?.content,
    toolName: typeof toolName === 'string' ? toolName : undefined,
    files: read.files.map((f) => ({ path: f.path, content: f.content })),
    sourceType: 'workspace',
    sourcePath: `skills/${read.relativeDir}`,
  });
  if (result.error) {
    sendErr(res, 400, 'SKILL_IMPORT_FAILED', result.error);
    return;
  }
  sendOk(res, gatewayStore.getSnapshot(), { skillId: result.skill?.id });
});

app.post('/api/v1/skills', (req, res) => {
  const { id, version, summary, skillMarkdown, toolName, files, sourceType, sourcePath } = req.body || {};
  const hasFilesArray = Array.isArray(files) && files.length > 0;
  if (typeof id !== 'string' || !id.trim()) {
    sendErr(res, 400, 'INVALID_SKILL', '请填写 Skill 标识名称。');
    return;
  }
  if (!hasFilesArray && (typeof skillMarkdown !== 'string' || !skillMarkdown.trim())) {
    sendErr(res, 400, 'INVALID_SKILL', '请提供 SKILL.md 正文或包含 SKILL.md 的目录文件列表。');
    return;
  }
  const allowedSourceTypes: SkillSourceType[] = ['builtin', 'folder-upload', 'workspace', 'manual'];
  const safeSourceType: SkillSourceType | undefined =
    typeof sourceType === 'string' && allowedSourceTypes.includes(sourceType as SkillSourceType)
      ? (sourceType as SkillSourceType)
      : undefined;

  const result = gatewayStore.createSkill({
    id,
    version: typeof version === 'string' ? version : undefined,
    summary: typeof summary === 'string' ? summary : undefined,
    skillMarkdown: typeof skillMarkdown === 'string' ? skillMarkdown : undefined,
    toolName: typeof toolName === 'string' ? toolName : undefined,
    files: hasFilesArray ? files : undefined,
    sourceType: safeSourceType,
    sourcePath: typeof sourcePath === 'string' ? sourcePath : undefined,
  });
  if (result.error) {
    sendErr(res, 400, 'SKILL_CREATE_FAILED', result.error);
    return;
  }
  sendOk(res, gatewayStore.getSnapshot(), { skillId: result.skill?.id });
});

app.put('/api/v1/skills/:id', (req, res) => {
  const markdown = req.body?.skillMarkdown;
  if (typeof markdown !== 'string' || !markdown.trim()) {
    sendErr(res, 400, 'INVALID_MARKDOWN', 'SKILL.md 正文不能为空。');
    return;
  }
  const updated = gatewayStore.updateSkillMarkdown(req.params.id, markdown);
  if (!updated) {
    sendErr(res, 404, 'SKILL_NOT_FOUND', '未找到指定 Skill。');
    return;
  }
  sendOk(res, gatewayStore.getSnapshot());
});

app.put('/api/v1/skills/:id/files', (req, res) => {
  const filePath = req.body?.path;
  const content = req.body?.content;
  if (typeof filePath !== 'string' || !filePath.trim() || typeof content !== 'string') {
    sendErr(res, 400, 'INVALID_FILE_PAYLOAD', '请提供有效的文件相对路径与文本内容。');
    return;
  }
  const result = gatewayStore.upsertSkillFile(req.params.id, filePath, content);
  if (result.error) {
    const status = result.error.includes('未找到指定 Skill') ? 404 : 400;
    sendErr(res, status, 'SKILL_FILE_UPDATE_FAILED', result.error);
    return;
  }
  sendOk(res, gatewayStore.getSnapshot(), { file: result.file });
});

app.delete('/api/v1/skills/:id/files', (req, res) => {
  const rawPath =
    typeof req.query.path === 'string'
      ? req.query.path
      : typeof req.body?.path === 'string'
      ? req.body.path
      : '';
  if (!rawPath.trim()) {
    sendErr(res, 400, 'INVALID_FILE_PATH', '请指定要删除的文件相对路径。');
    return;
  }
  const result = gatewayStore.deleteSkillFile(req.params.id, rawPath);
  if (result.error) {
    const status = result.error.includes('未找到') ? 404 : 400;
    sendErr(res, status, 'SKILL_FILE_DELETE_FAILED', result.error);
    return;
  }
  sendOk(res, gatewayStore.getSnapshot());
});

app.post('/api/v1/skills/:id/mount', (req, res) => {
  const host = typeof req.body?.host === 'string' ? req.body.host : 'Claude Code';
  const mounted = gatewayStore.mountSkill(req.params.id, host);
  if (!mounted) {
    sendErr(res, 404, 'SKILL_NOT_FOUND', '未找到指定 Skill。');
    return;
  }
  sendOk(res, gatewayStore.getSnapshot());
});

app.post('/api/v1/skills/:id/unmount', (req, res) => {
  const unmounted = gatewayStore.unmountSkill(req.params.id);
  if (!unmounted) {
    sendErr(res, 404, 'SKILL_NOT_FOUND', '未找到指定 Skill。');
    return;
  }
  sendOk(res, gatewayStore.getSnapshot());
});

app.post('/api/v1/kb/search', (req, res) => {
  const query = typeof req.body?.query === 'string' ? req.body.query : '';
  sendOk(res, gatewayStore.searchKnowledge(query));
});

app.post('/api/v1/kb/docs', (req, res) => {
  const { filePath, content, sourceType } = req.body || {};
  if (typeof filePath !== 'string' || !filePath.trim() || typeof content !== 'string' || !content.trim()) {
    sendErr(res, 400, 'INVALID_DOC', '请填写文档路径与正文内容。');
    return;
  }
  const safeSource = sourceType === 'upload' || sourceType === 'workspace' ? sourceType : 'manual';
  gatewayStore.addKnowledgeDoc(filePath, content, safeSource);
  sendOk(res, gatewayStore.getSnapshot());
});

app.post('/api/v1/kb/docs/batch', (req, res) => {
  const docs = req.body?.docs;
  if (!Array.isArray(docs) || docs.length === 0) {
    sendErr(res, 400, 'INVALID_BATCH', '请至少上传一个 Markdown 或文本文档。');
    return;
  }
  if (docs.length > 20) {
    sendErr(res, 400, 'TOO_MANY_DOCS', '单次最多批量导入 20 篇文档。');
    return;
  }
  let importedCount = 0;
  for (const item of docs) {
    if (!item || typeof item.filePath !== 'string' || typeof item.content !== 'string') continue;
    if (!item.filePath.trim() || !item.content.trim()) continue;
    if (Buffer.byteLength(item.content, 'utf8') > MAX_WORKSPACE_FILE_BYTES) continue;
    gatewayStore.addKnowledgeDoc(item.filePath, item.content, 'upload');
    importedCount += 1;
  }
  if (importedCount === 0) {
    sendErr(res, 400, 'NO_VALID_DOCS', '未解析到有效的非空文档内容。');
    return;
  }
  sendOk(res, gatewayStore.getSnapshot(), { importedCount });
});

app.post('/api/v1/kb/import-workspace-docs', (_req, res) => {
  if (!fs.existsSync(DOCS_DIR)) {
    sendErr(res, 404, 'DOCS_DIR_NOT_FOUND', '当前工作区不存在 docs/ 目录。');
    return;
  }
  const realDocsRoot = fs.realpathSync(DOCS_DIR);
  const entries = fs.readdirSync(realDocsRoot, { withFileTypes: true });
  const importedFiles: string[] = [];

  for (const entry of entries) {
    if (importedFiles.length >= 20) break;
    if (entry.name.startsWith('.') || !entry.name.toLowerCase().endsWith('.md')) continue;
    const candidate = path.join(realDocsRoot, entry.name);
    let realFile: string;
    try {
      realFile = fs.realpathSync(candidate);
    } catch {
      continue;
    }
    if (!realFile.startsWith(realDocsRoot + path.sep)) continue;
    const stat = fs.statSync(realFile);
    if (!stat.isFile() || stat.size === 0 || stat.size > MAX_WORKSPACE_FILE_BYTES) continue;
    const buf = fs.readFileSync(realFile);
    if (buf.includes(0)) continue;
    const relPath = `docs/${entry.name}`;
    gatewayStore.addKnowledgeDoc(relPath, buf.toString('utf8'), 'workspace');
    importedFiles.push(relPath);
  }

  if (importedFiles.length === 0) {
    sendErr(res, 400, 'NO_DOCS_FOUND', 'docs/ 目录下未发现可索引的 Markdown 文件。');
    return;
  }
  sendOk(res, gatewayStore.getSnapshot(), { importedCount: importedFiles.length, importedFiles });
});

app.put('/api/v1/kb/docs/:id', (req, res) => {
  const content = req.body?.content;
  if (typeof content !== 'string' || !content.trim()) {
    sendErr(res, 400, 'INVALID_DOC', '文档正文不能为空。');
    return;
  }
  const updated = gatewayStore.updateKnowledgeDoc(req.params.id, content);
  if (!updated) {
    sendErr(res, 404, 'DOC_NOT_FOUND', '未找到指定知识库文档。');
    return;
  }
  sendOk(res, gatewayStore.getSnapshot());
});

app.delete('/api/v1/kb/docs/:id', (req, res) => {
  const ok = gatewayStore.deleteKnowledgeDoc(req.params.id);
  if (!ok) {
    sendErr(res, 404, 'DOC_NOT_FOUND', '未找到指定知识库文档。');
    return;
  }
  sendOk(res, gatewayStore.getSnapshot());
});

app.post('/api/v1/kb/memories', (req, res) => {
  const { host, topic, content, scope } = req.body || {};
  if (typeof content !== 'string' || !content.trim()) {
    sendErr(res, 400, 'INVALID_MEMORY', '请填写共享记忆正文。');
    return;
  }
  gatewayStore.addMemory(
    typeof host === 'string' ? host : 'Claude Code',
    typeof topic === 'string' ? topic : '工程经验',
    content,
    scope === 'project' ? 'project' : 'global'
  );
  sendOk(res, gatewayStore.getSnapshot());
});

app.patch('/api/v1/kb/memories/:id', (req, res) => {
  const { topic, content, scope } = req.body || {};
  const updated = gatewayStore.updateMemory(req.params.id, {
    topic: typeof topic === 'string' ? topic : undefined,
    content: typeof content === 'string' ? content : undefined,
    scope: scope === 'project' || scope === 'global' ? scope : undefined,
  });
  if (!updated) {
    sendErr(res, 404, 'MEMORY_NOT_FOUND', '未找到对应记忆条目。');
    return;
  }
  sendOk(res, gatewayStore.getSnapshot());
});

app.delete('/api/v1/kb/memories/:id', (req, res) => {
  const ok = gatewayStore.deleteMemory(req.params.id);
  if (!ok) {
    sendErr(res, 404, 'MEMORY_NOT_FOUND', '未找到对应记忆条目。');
    return;
  }
  sendOk(res, gatewayStore.getSnapshot());
});

app.post('/api/v1/kb/rebuild', (_req, res) => {
  gatewayStore.rebuildVectorIndex();
  sendOk(res, gatewayStore.getSnapshot());
});

app.put('/api/v1/vault/:key', (req, res) => {
  const { value, serviceName } = req.body || {};
  if (typeof value !== 'string') {
    sendErr(res, 400, 'INVALID_SECRET', '请填写有效的密钥值。');
    return;
  }
  const result = gatewayStore.setVaultSecret(
    req.params.key,
    value,
    typeof serviceName === 'string' ? serviceName : undefined
  );
  if (result.error) {
    sendErr(res, 400, 'VAULT_VALIDATION_ERROR', result.error);
    return;
  }
  sendOk(res, gatewayStore.getSnapshot());
});

app.delete('/api/v1/vault/:key', (req, res) => {
  const result = gatewayStore.deleteVaultSecret(req.params.key);
  if (!result.ok) {
    sendErr(res, 404, 'VAULT_NOT_FOUND', result.error || '未找到指定密钥。');
    return;
  }
  sendOk(res, gatewayStore.getSnapshot());
});

app.get('/api/v1/sync/preflight', (_req, res) => {
  sendOk(res, gatewayStore.getPreflight());
});

app.patch('/api/v1/sync/config', (req, res) => {
  const { repo, branch } = req.body || {};
  gatewayStore.updateSyncConfig({
    repo: typeof repo === 'string' ? repo : undefined,
    branch: typeof branch === 'string' ? branch : undefined,
  });
  sendOk(res, gatewayStore.getSnapshot());
});

app.post('/api/v1/sync/pull', (_req, res) => {
  const result = gatewayStore.pullFromGitHub();
  sendOk(res, gatewayStore.getSnapshot(), { message: result.status });
});

app.post('/api/v1/sync/push', (req, res) => {
  const commitMessage = typeof req.body?.commitMessage === 'string' ? req.body.commitMessage : undefined;
  const result = gatewayStore.pushToGitHub(commitMessage);
  if (!result.ok) {
    sendErr(res, 409, 'PREFLIGHT_BLOCKED', result.error || '推送前检查未通过。');
    return;
  }
  sendOk(res, gatewayStore.getSnapshot());
});

app.post('/api/v1/hitl/:id/resolve', (req, res) => {
  const decision = req.body?.decision;
  if (decision !== 'approve' && decision !== 'reject') {
    sendErr(res, 400, 'INVALID_DECISION', '审批动作仅支持 approve 或 reject。');
    return;
  }
  const resolved = gatewayStore.resolveHitlApproval(req.params.id, decision);
  if (!resolved) {
    sendErr(res, 404, 'APPROVAL_NOT_FOUND', '未找到待处理的 HITL 审批单。');
    return;
  }
  sendOk(res, gatewayStore.getSnapshot());
});

app.post('/api/v1/sandbox/rpc', (req, res) => {
  const { host, stepIndex, method, argumentsObj } = req.body || {};
  const evt = gatewayStore.executeRpc({
    hostName: typeof host === 'string' ? host : 'Claude Code',
    stepIndex: typeof stepIndex === 'number' ? stepIndex : undefined,
    method: typeof method === 'string' ? method : undefined,
    argumentsObj: argumentsObj && typeof argumentsObj === 'object' ? argumentsObj : undefined,
  });
  sendOk(res, gatewayStore.getSnapshot(), { eventId: evt.id });
});

/* ---------- Unified MCP JSON-RPC 2.0 Entrypoint (/api/mcp/*) ---------- */
app.get('/api/mcp/sse', (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders?.();
  res.write(`event: endpoint\ndata: /api/mcp/messages\n\n`);

  const onEvent = (evt: { type: string; payload: unknown }) => {
    if (evt.type === 'skill.mounted' || evt.type === 'skill.unmounted' || evt.type === 'tool.updated') {
      const notification = {
        jsonrpc: '2.0',
        method: 'notifications/tools/list_changed',
        params: evt.payload,
      };
      res.write(`event: message\ndata: ${JSON.stringify(notification)}\n\n`);
    }
  };
  gatewayStore.events.on('gateway-event', onEvent);
  const keepalive = setInterval(() => res.write(': ping\n\n'), 25000);
  req.on('close', () => {
    clearInterval(keepalive);
    gatewayStore.events.off('gateway-event', onEvent);
  });
});

app.post('/api/mcp/messages', (req, res) => {
  const body = req.body || {};
  const hostName = String(req.headers['x-toolbox-host'] || 'OpenCode');
  const method =
    body.method === 'tools/call' && typeof body.params?.name === 'string'
      ? body.params.name
      : typeof body.method === 'string'
      ? body.method
      : 'tools/list';
  const args =
    body.params?.arguments && typeof body.params.arguments === 'object' ? body.params.arguments : undefined;

  const evt = gatewayStore.executeRpc({ hostName, method, argumentsObj: args });
  res.json(evt.responsePayload);
});

/* ---------- Engineering Docs & Prototype Routes ---------- */
app.get('/api/docs', (_req, res) => {
  const docs = DOC_REGISTRY.map((entry) => readDocEntry(entry.slug)?.meta).filter(Boolean);
  res.json({ docs });
});

app.get('/api/docs/:slug', (req, res) => {
  const slug = String(req.params.slug || '');
  const result = readDocEntry(slug);
  if (!result) {
    res.status(404).json({ error: 'Document not found' });
    return;
  }
  res.json({ ...result.meta, content: result.content });
});

app.get('/raw/:slug', (req, res) => {
  const slug = String(req.params.slug || '');
  const result = readDocEntry(slug);
  if (!result) {
    res.status(404).type('text/plain; charset=utf-8').send('Document not found');
    return;
  }
  res.type('text/markdown; charset=utf-8').send(result.content);
});

if (fs.existsSync(PROTYPE_DIR)) {
  app.use('/protype', express.static(PROTYPE_DIR));
}

async function startServer() {
  if (process.env.NODE_ENV !== 'production') {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true, hmr: false },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    app.use(express.static(DIST_DIR));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(DIST_DIR, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Agent-Toolbox gateway & console listening on http://0.0.0.0:${PORT}`);
  });
}

startServer().catch((err) => {
  console.error('Failed to start server:', err);
  process.exit(1);
});
