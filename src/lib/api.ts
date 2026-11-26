import type {
  ExposureMode,
  GatewayStateSnapshot,
  HostScope,
  MiddlewareId,
  TransportProtocol,
  TrinitySearchResult,
} from '../types/toolbox';
import type { DocDetail, DocMeta } from '../types/docs';

async function requestJson<T>(url: string, options?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    headers: { 'Content-Type': 'application/json', ...(options?.headers || {}) },
    ...options,
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg =
      (body as { error?: { message?: string } | string })?.error &&
      typeof (body as { error?: unknown }).error === 'object'
        ? ((body as { error: { message?: string } }).error.message || `HTTP ${res.status}`)
        : typeof (body as { error?: unknown }).error === 'string'
        ? (body as { error: string }).error
        : `请求失败 (${res.status})`;
    throw new Error(msg);
  }
  return body as T;
}

export const api = {
  getState: () => requestJson<{ ok: true; data: GatewayStateSnapshot }>('/api/v1/state').then((r) => r.data),

  updateHostScope: (hostId: string, scope: HostScope) =>
    requestJson<{ ok: true; data: GatewayStateSnapshot }>(`/api/v1/hosts/${encodeURIComponent(hostId)}/scope`, {
      method: 'PATCH',
      body: JSON.stringify({ scope }),
    }).then((r) => r.data),

  toggleMiddleware: (id: MiddlewareId, enabled: boolean) =>
    requestJson<{ ok: true; data: GatewayStateSnapshot }>(`/api/v1/middleware/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      body: JSON.stringify({ enabled }),
    }).then((r) => r.data),

  addServer: (payload: {
    name: string;
    protocol: TransportProtocol;
    commandOrUrl: string;
    defaultMode: ExposureMode;
    secretRef?: string;
    initialToolName?: string;
    initialToolDesc?: string;
  }) =>
    requestJson<{ ok: true; data: GatewayStateSnapshot }>('/api/v1/servers', {
      method: 'POST',
      body: JSON.stringify(payload),
    }).then((r) => r.data),

  pingServer: (serverId: string) =>
    requestJson<{ ok: true; data: GatewayStateSnapshot }>(`/api/v1/servers/${encodeURIComponent(serverId)}/ping`, {
      method: 'POST',
    }).then((r) => r.data),

  updateTool: (toolName: string, patch: { mode?: ExposureMode; hitl?: boolean }) =>
    requestJson<{ ok: true; data: GatewayStateSnapshot }>(`/api/v1/tools/${encodeURIComponent(toolName)}`, {
      method: 'PATCH',
      body: JSON.stringify(patch),
    }).then((r) => r.data),

  resolveQuarantine: (serverId: string, action: 'rollback' | 'trust') =>
    requestJson<{ ok: true; data: GatewayStateSnapshot }>(
      `/api/v1/quarantine/${encodeURIComponent(serverId)}/resolve`,
      {
        method: 'POST',
        body: JSON.stringify({ action }),
      }
    ).then((r) => r.data),

  simulateQuarantine: () =>
    requestJson<{ ok: true; data: GatewayStateSnapshot }>('/api/v1/quarantine/simulate', {
      method: 'POST',
      body: JSON.stringify({ serverId: 'scraper' }),
    }).then((r) => r.data),

  mountSkill: (skillId: string, host?: string) =>
    requestJson<{ ok: true; data: GatewayStateSnapshot }>(`/api/v1/skills/${encodeURIComponent(skillId)}/mount`, {
      method: 'POST',
      body: JSON.stringify({ host }),
    }).then((r) => r.data),

  unmountSkill: (skillId: string) =>
    requestJson<{ ok: true; data: GatewayStateSnapshot }>(`/api/v1/skills/${encodeURIComponent(skillId)}/unmount`, {
      method: 'POST',
    }).then((r) => r.data),

  updateSkillMarkdown: (skillId: string, skillMarkdown: string) =>
    requestJson<{ ok: true; data: GatewayStateSnapshot }>(`/api/v1/skills/${encodeURIComponent(skillId)}`, {
      method: 'PUT',
      body: JSON.stringify({ skillMarkdown }),
    }).then((r) => r.data),

  createSkill: (payload: {
    id: string;
    version: string;
    summary: string;
    skillMarkdown: string;
    toolName?: string;
  }) =>
    requestJson<{ ok: true; data: GatewayStateSnapshot }>('/api/v1/skills', {
      method: 'POST',
      body: JSON.stringify(payload),
    }).then((r) => r.data),

  searchKnowledge: (query: string) =>
    requestJson<{ ok: true; data: TrinitySearchResult }>('/api/v1/kb/search', {
      method: 'POST',
      body: JSON.stringify({ query }),
    }).then((r) => r.data),

  addKnowledgeDoc: (filePath: string, content: string) =>
    requestJson<{ ok: true; data: GatewayStateSnapshot }>('/api/v1/kb/docs', {
      method: 'POST',
      body: JSON.stringify({ filePath, content }),
    }).then((r) => r.data),

  addMemory: (host: string, topic: string, content: string) =>
    requestJson<{ ok: true; data: GatewayStateSnapshot }>('/api/v1/kb/memories', {
      method: 'POST',
      body: JSON.stringify({ host, topic, content }),
    }).then((r) => r.data),

  deleteMemory: (id: string) =>
    requestJson<{ ok: true; data: GatewayStateSnapshot }>(`/api/v1/kb/memories/${encodeURIComponent(id)}`, {
      method: 'DELETE',
    }).then((r) => r.data),

  rebuildVectorIndex: () =>
    requestJson<{ ok: true; data: GatewayStateSnapshot }>('/api/v1/kb/rebuild', {
      method: 'POST',
    }).then((r) => r.data),

  setVaultSecret: (key: string, value: string, serviceName?: string) =>
    requestJson<{ ok: true; data: GatewayStateSnapshot }>(`/api/v1/vault/${encodeURIComponent(key)}`, {
      method: 'PUT',
      body: JSON.stringify({ value, serviceName }),
    }).then((r) => r.data),

  pullGitHub: () =>
    requestJson<{ ok: true; message: string; data: GatewayStateSnapshot }>('/api/v1/sync/pull', {
      method: 'POST',
    }),

  pushGitHub: () =>
    requestJson<{ ok: true; data: GatewayStateSnapshot }>('/api/v1/sync/push', {
      method: 'POST',
    }).then((r) => r.data),

  resolveHitl: (approvalId: string, decision: 'approve' | 'reject') =>
    requestJson<{ ok: true; data: GatewayStateSnapshot }>(
      `/api/v1/hitl/${encodeURIComponent(approvalId)}/resolve`,
      {
        method: 'POST',
        body: JSON.stringify({ decision }),
      }
    ).then((r) => r.data),

  runSandboxRpc: (payload: { host: string; stepIndex?: number; method?: string; argumentsObj?: Record<string, unknown> }) =>
    requestJson<{ ok: true; eventId: string; data: GatewayStateSnapshot }>('/api/v1/sandbox/rpc', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  getDocsList: () => requestJson<{ docs: DocMeta[] }>('/api/docs').then((r) => r.docs),

  getDocDetail: (slug: string) => requestJson<DocDetail>(`/api/docs/${encodeURIComponent(slug)}`),
};
