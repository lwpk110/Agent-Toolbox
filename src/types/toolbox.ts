export type HostScope = 'full' | 'audit' | 'min';
export type ExposureMode = 'pinned' | 'lazy';
export type ServerState = 'ok' | 'quarantined' | 'degraded' | 'offline';
export type TransportProtocol = 'stdio' | 'sse' | 'http';
export type MiddlewareId = 'vault' | 'quarantine' | 'hitl' | 'redact' | 'budget';

export interface HostProfile {
  id: 'antigravity' | 'claude' | 'codex' | 'opencode';
  name: string;
  latencyMs: number;
  online: boolean;
  scope: HostScope;
  configSnippet: string;
}

export interface MiddlewareRule {
  id: MiddlewareId;
  name: string;
  enName: string;
  description: string;
  enabled: boolean;
  order: number;
}

export interface McpTool {
  name: string;
  serverId: string;
  description: string;
  estimatedTokens: number;
  mode: ExposureMode;
  hitl: boolean;
  fingerprint: string;
  lockedFingerprint: string;
  readOnly?: boolean;
}

export interface QuarantineRecord {
  serverId: string;
  toolName: string;
  expectedHash: string;
  actualHash: string;
  baselineDescription: string;
  mutatedDescription: string;
  riskReason: string;
  detectedAt: string;
}

export interface McpServer {
  id: string;
  name: string;
  protocol: TransportProtocol;
  commandOrUrl: string;
  latencyMs: number;
  state: ServerState;
  fingerprint: string;
  secretRef?: string;
  tools: McpTool[];
}

export interface SkillAttachedTool {
  name: string;
  estimatedTokens: number;
  description: string;
}

export interface DualLayerSkill {
  id: string;
  version: string;
  summary: string;
  estimatedTokens: number;
  callCount: number;
  successRate: string;
  mounted: boolean;
  mountedBy: string;
  fingerprint: string;
  skillMarkdown: string;
  attachedTools: SkillAttachedTool[];
}

export interface KnowledgeDoc {
  id: string;
  filePath: string;
  chunkCount: number;
  embeddingDim: number;
  contentPreview: string;
  indexedAt: string;
}

export interface SharedMemory {
  id: string;
  host: string;
  topic: string;
  content: string;
  createdAt: string;
}

export interface VectorHealthStats {
  totalChunks: number;
  recallRate: string;
  p95LatencyMs: number;
  orphanChunks: number;
  embeddingDim: number;
  engineName: string;
  lastRebuiltAt: string;
}

export interface VaultEntry {
  key: string;
  serviceName: string;
  maskedValue: string;
  configured: boolean;
  updatedAt: string;
}

export interface HitlApproval {
  id: string;
  host: string;
  toolName: string;
  argsPreview: string;
  createdAt: string;
  status: 'pending' | 'approved' | 'rejected';
}

export interface AuditRpcEvent {
  id: string;
  timestamp: string;
  host: string;
  method: string;
  stepIndex?: number;
  outcome: 'ok' | 'blocked' | 'pending_approval';
  latencyMs: number;
  requestPayload: Record<string, unknown>;
  responsePayload: Record<string, unknown>;
}

export interface GatewaySummaryMetrics {
  fullExposureTokens: number;
  metaToolsTokens: number;
  currentExposureTokens: number;
  savedPercentage: string;
  savedTokensK: string;
  connectedServers: number;
  totalTools: number;
  mountedSkills: number;
  totalSkills: number;
  quarantinedCount: number;
  missingVaultKeys: number;
}

export interface SyncStatus {
  repo: string;
  branch: string;
  commitHash: string;
  ahead: number;
  pushed: boolean;
  lastSyncedAt: string | null;
}

export interface SyncPreflightCheck {
  id: string;
  passed: boolean;
  title: string;
  detail: string;
}

export interface SyncPreflightResult {
  ready: boolean;
  blockingReason: string;
  checks: SyncPreflightCheck[];
  manifestJson: string;
  lockfileJson: string;
}

export interface TrinitySearchResult {
  query: string;
  latencyMs: number;
  docs: Array<{
    filePath: string;
    excerpt: string;
    score: string;
    latencyMs: number;
  }>;
  memories: SharedMemory[];
  routing: Array<{
    skillId: string;
    summary: string;
    mounted: boolean;
    score: string;
    estimatedTokens: number;
  }>;
}

export interface GatewayStateSnapshot {
  metrics: GatewaySummaryMetrics;
  hosts: HostProfile[];
  middleware: MiddlewareRule[];
  servers: McpServer[];
  quarantines: QuarantineRecord[];
  skills: DualLayerSkill[];
  docs: KnowledgeDoc[];
  memories: SharedMemory[];
  vectorHealth: VectorHealthStats;
  vault: VaultEntry[];
  sync: SyncStatus;
  preflight: SyncPreflightResult;
  pendingApprovals: HitlApproval[];
  auditLogs: AuditRpcEvent[];
}
