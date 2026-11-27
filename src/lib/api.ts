import type {
  CodexIntegrationStatus,
  CodexTargetPlatform,
  ExposureMode,
  GatewayStateSnapshot,
  VisibilitySettings,
  HostScope,
  MiddlewareId,
  SkillSourceType,
  TransportProtocol,
  TrinitySearchResult,
  WorkspaceSkillCandidate,
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

  updateVisibility: (patch: Partial<VisibilitySettings>) =>
    requestJson<{ ok: true; data: VisibilitySettings }>('/api/v1/settings/visibility', {
      method: 'PUT',
      body: JSON.stringify(patch),
    }).then((r) => r.data),

  addHost: (payload: { name: string; scope: HostScope; transport?: 'stdio' | 'sse' }) =>
    requestJson<{ ok: true; hostId?: string; data: GatewayStateSnapshot }>('/api/v1/hosts', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  deleteHost: (hostId: string) =>
    requestJson<{ ok: true; data: GatewayStateSnapshot }>(`/api/v1/hosts/${encodeURIComponent(hostId)}`, {
      method: 'DELETE',
    }).then((r) => r.data),

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

  updateMiddlewareConfig: (id: MiddlewareId, config: { maxTokensPerTurn?: number }) =>
    requestJson<{ ok: true; data: GatewayStateSnapshot }>(`/api/v1/middleware/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      body: JSON.stringify({ config }),
    }).then((r) => r.data),

  importMcpJson: (rawJson: string, defaultMode: ExposureMode) =>
    requestJson<{ ok: true; addedIds: string[]; skippedIds: string[]; data: GatewayStateSnapshot }>(
      '/api/v1/servers/import-json',
      {
        method: 'POST',
        body: JSON.stringify({ rawJson, defaultMode }),
      }
    ),

  addServer: (payload: {
    name: string;
    protocol: TransportProtocol;
    commandOrUrl: string;
    args?: string[];
    env?: Record<string, string>;
    headers?: Record<string, string>;
    defaultMode: ExposureMode;
    secretRef?: string;
    initialToolName?: string;
    initialToolDesc?: string;
  }) =>
    requestJson<{ ok: true; data: GatewayStateSnapshot }>('/api/v1/servers', {
      method: 'POST',
      body: JSON.stringify(payload),
    }).then((r) => r.data),

  updateServer: (
    serverId: string,
    patch: {
      protocol?: TransportProtocol;
      commandOrUrl?: string;
      args?: string[];
      env?: Record<string, string>;
      headers?: Record<string, string>;
      enabled?: boolean;
      secretRef?: string;
    }
  ) =>
    requestJson<{ ok: true; data: GatewayStateSnapshot }>(`/api/v1/servers/${encodeURIComponent(serverId)}`, {
      method: 'PATCH',
      body: JSON.stringify(patch),
    }).then((r) => r.data),

  deleteServer: (serverId: string) =>
    requestJson<{ ok: true; data: GatewayStateSnapshot }>(`/api/v1/servers/${encodeURIComponent(serverId)}`, {
      method: 'DELETE',
    }).then((r) => r.data),

  setServerToolsMode: (serverId: string, mode: ExposureMode) =>
    requestJson<{ ok: true; data: GatewayStateSnapshot }>(
      `/api/v1/servers/${encodeURIComponent(serverId)}/tools-mode`,
      {
        method: 'PATCH',
        body: JSON.stringify({ mode }),
      }
    ).then((r) => r.data),

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
    version?: string;
    summary?: string;
    skillMarkdown?: string;
    toolName?: string;
    files?: Array<{ path: string; content: string }>;
    sourceType?: SkillSourceType;
    sourcePath?: string;
  }) =>
    requestJson<{ ok: true; skillId?: string; data: GatewayStateSnapshot }>('/api/v1/skills', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  getWorkspaceSkillCandidates: () =>
    requestJson<{ ok: true; data: WorkspaceSkillCandidate[] }>('/api/v1/skills/workspace-candidates').then(
      (r) => r.data
    ),

  importWorkspaceSkillDir: (payload: {
    relativeDir: string;
    id?: string;
    version?: string;
    summary?: string;
  }) =>
    requestJson<{ ok: true; skillId?: string; data: GatewayStateSnapshot }>(
      '/api/v1/skills/import-directory',
      {
        method: 'POST',
        body: JSON.stringify(payload),
      }
    ),

  upsertSkillFile: (skillId: string, path: string, content: string) =>
    requestJson<{ ok: true; data: GatewayStateSnapshot }>(
      `/api/v1/skills/${encodeURIComponent(skillId)}/files`,
      {
        method: 'PUT',
        body: JSON.stringify({ path, content }),
      }
    ).then((r) => r.data),

  deleteSkillFile: (skillId: string, path: string) =>
    requestJson<{ ok: true; data: GatewayStateSnapshot }>(
      `/api/v1/skills/${encodeURIComponent(skillId)}/files?path=${encodeURIComponent(path)}`,
      {
        method: 'DELETE',
      }
    ).then((r) => r.data),

  searchKnowledge: (query: string) =>
    requestJson<{ ok: true; data: TrinitySearchResult }>('/api/v1/kb/search', {
      method: 'POST',
      body: JSON.stringify({ query }),
    }).then((r) => r.data),

  addKnowledgeDoc: (filePath: string, content: string, sourceType?: 'manual' | 'upload' | 'workspace') =>
    requestJson<{ ok: true; data: GatewayStateSnapshot }>('/api/v1/kb/docs', {
      method: 'POST',
      body: JSON.stringify({ filePath, content, sourceType }),
    }).then((r) => r.data),

  batchAddKnowledgeDocs: (docs: Array<{ filePath: string; content: string }>) =>
    requestJson<{ ok: true; importedCount: number; data: GatewayStateSnapshot }>('/api/v1/kb/docs/batch', {
      method: 'POST',
      body: JSON.stringify({ docs }),
    }),

  importWorkspaceDocs: () =>
    requestJson<{ ok: true; importedCount: number; importedFiles: string[]; data: GatewayStateSnapshot }>(
      '/api/v1/kb/import-workspace-docs',
      { method: 'POST' }
    ),

  updateKnowledgeDoc: (docId: string, content: string) =>
    requestJson<{ ok: true; data: GatewayStateSnapshot }>(`/api/v1/kb/docs/${encodeURIComponent(docId)}`, {
      method: 'PUT',
      body: JSON.stringify({ content }),
    }).then((r) => r.data),

  deleteKnowledgeDoc: (docId: string) =>
    requestJson<{ ok: true; data: GatewayStateSnapshot }>(`/api/v1/kb/docs/${encodeURIComponent(docId)}`, {
      method: 'DELETE',
    }).then((r) => r.data),

  addMemory: (host: string, topic: string, content: string, scope: 'global' | 'project' = 'global') =>
    requestJson<{ ok: true; data: GatewayStateSnapshot }>('/api/v1/kb/memories', {
      method: 'POST',
      body: JSON.stringify({ host, topic, content, scope }),
    }).then((r) => r.data),

  updateMemory: (id: string, patch: { topic?: string; content?: string; scope?: 'global' | 'project' }) =>
    requestJson<{ ok: true; data: GatewayStateSnapshot }>(`/api/v1/kb/memories/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      body: JSON.stringify(patch),
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

  deleteVaultSecret: (key: string) =>
    requestJson<{ ok: true; data: GatewayStateSnapshot }>(`/api/v1/vault/${encodeURIComponent(key)}`, {
      method: 'DELETE',
    }).then((r) => r.data),

  updateSyncConfig: (repo: string, branch: string) =>
    requestJson<{ ok: true; data: GatewayStateSnapshot }>('/api/v1/sync/config', {
      method: 'PATCH',
      body: JSON.stringify({ repo, branch }),
    }).then((r) => r.data),

  pullGitHub: () =>
    requestJson<{ ok: true; message: string; data: GatewayStateSnapshot }>('/api/v1/sync/pull', {
      method: 'POST',
    }),

  pushGitHub: (commitMessage?: string) =>
    requestJson<{ ok: true; data: GatewayStateSnapshot }>('/api/v1/sync/push', {
      method: 'POST',
      body: JSON.stringify({ commitMessage }),
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

  getCodexStatus: (params?: { targetPlatform?: CodexTargetPlatform; wslDistro?: string }) => {
    const qs = new URLSearchParams();
    if (params?.targetPlatform) qs.set('targetPlatform', params.targetPlatform);
    if (params?.wslDistro) qs.set('wslDistro', params.wslDistro);
    const suffix = qs.toString() ? `?${qs.toString()}` : '';
    return requestJson<{ ok: true; data: CodexIntegrationStatus }>(`/api/v1/hosts/codex/status${suffix}`).then(
      (r) => r.data
    );
  },

  installCodex: (payload?: {
    transport?: 'stdio' | 'http';
    targetPlatform?: CodexTargetPlatform;
    wslDistro?: string;
  }) =>
    requestJson<{ ok: true; data: CodexIntegrationStatus }>('/api/v1/hosts/codex/install', {
      method: 'POST',
      body: JSON.stringify(payload || { transport: 'stdio' }),
    }).then((r) => r.data),

  uninstallCodex: (payload?: { targetPlatform?: CodexTargetPlatform; wslDistro?: string }) =>
    requestJson<{ ok: true; data: CodexIntegrationStatus }>('/api/v1/hosts/codex/uninstall', {
      method: 'POST',
      body: JSON.stringify(payload || {}),
    }).then((r) => r.data),

  importCodexServers: (payload?: {
    names?: string[];
    defaultMode?: ExposureMode;
    targetPlatform?: CodexTargetPlatform;
    wslDistro?: string;
  }) =>
    requestJson<{
      ok: true;
      addedIds: string[];
      skippedIds: string[];
      codexStatus: CodexIntegrationStatus;
      data: GatewayStateSnapshot;
    }>('/api/v1/hosts/codex/import-servers', {
      method: 'POST',
      body: JSON.stringify(payload || {}),
    }),
};
