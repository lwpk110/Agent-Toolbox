import express from 'express';
import fs from 'fs';
import path from 'path';
import type { DocCategory, DocMeta } from './src/types/docs';
import type { ExposureMode, HostScope, MiddlewareId, TransportProtocol } from './src/types/toolbox';
import { gatewayStore } from './src/server/gatewayStore';

const app = express();
const PORT = Number(process.env.PORT || 3000);
const ROOT_DIR = process.cwd();
const DOCS_DIR = path.resolve(ROOT_DIR, 'docs');
const PROTYPE_DIR = path.resolve(ROOT_DIR, 'protype');
const DIST_DIR = path.resolve(ROOT_DIR, 'dist');

app.use(express.json({ limit: '1mb' }));

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
  const enabled = req.body?.enabled;
  if (!['vault', 'quarantine', 'hitl', 'redact', 'budget'].includes(id) || typeof enabled !== 'boolean') {
    sendErr(res, 400, 'INVALID_MIDDLEWARE', '无效的中间件标识或开关状态。');
    return;
  }
  gatewayStore.toggleMiddleware(id, enabled);
  sendOk(res, gatewayStore.getSnapshot());
});

app.post('/api/v1/servers', (req, res) => {
  const { name, protocol, commandOrUrl, defaultMode, secretRef, initialToolName, initialToolDesc } = req.body || {};
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

app.post('/api/v1/skills', (req, res) => {
  const { id, version, summary, skillMarkdown, toolName } = req.body || {};
  if (typeof id !== 'string' || typeof summary !== 'string' || typeof skillMarkdown !== 'string') {
    sendErr(res, 400, 'INVALID_SKILL', '请完整填写 Skill 名称、用途简介与 SKILL.md 内容。');
    return;
  }
  const result = gatewayStore.createSkill({
    id,
    version: typeof version === 'string' ? version : '1.0.0',
    summary,
    skillMarkdown,
    toolName: typeof toolName === 'string' ? toolName : undefined,
  });
  if (result.error) {
    sendErr(res, 400, 'SKILL_CREATE_FAILED', result.error);
    return;
  }
  sendOk(res, gatewayStore.getSnapshot());
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
  const { filePath, content } = req.body || {};
  if (typeof filePath !== 'string' || !filePath.trim() || typeof content !== 'string' || !content.trim()) {
    sendErr(res, 400, 'INVALID_DOC', '请填写文档路径与正文内容。');
    return;
  }
  gatewayStore.addKnowledgeDoc(filePath, content);
  sendOk(res, gatewayStore.getSnapshot());
});

app.post('/api/v1/kb/memories', (req, res) => {
  const { host, topic, content } = req.body || {};
  if (typeof content !== 'string' || !content.trim()) {
    sendErr(res, 400, 'INVALID_MEMORY', '请填写共享记忆正文。');
    return;
  }
  gatewayStore.addMemory(
    typeof host === 'string' ? host : 'Claude Code',
    typeof topic === 'string' ? topic : '工程经验',
    content
  );
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

app.get('/api/v1/sync/preflight', (_req, res) => {
  sendOk(res, gatewayStore.getPreflight());
});

app.post('/api/v1/sync/pull', (_req, res) => {
  const result = gatewayStore.pullFromGitHub();
  sendOk(res, gatewayStore.getSnapshot(), { message: result.status });
});

app.post('/api/v1/sync/push', (_req, res) => {
  const result = gatewayStore.pushToGitHub();
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
