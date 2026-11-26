export type HostScope = 'full' | 'audit' | 'min';
export type ExposureMode = 'pinned' | 'lazy';
export type ServerState = 'ok' | 'quarantined' | 'degraded' | 'offline';
export type TransportProtocol = 'stdio' | 'sse' | 'http';
export type MiddlewareId = 'vault' | 'quarantine' | 'hitl' | 'redact' | 'budget';

export interface HostProfile {
  id: string;
  name: string;
  latencyMs: number;
  online: boolean;
  scope: HostScope;
  configSnippet: string;
  custom?: boolean;
}

export interface MiddlewareRule {
  id: MiddlewareId;
  name: string;
  enName: string;
  description: string;
  enabled: boolean;
  order: number;
  config?: {
    maxTokensPerTurn?: number;
    customPatterns?: string[];
  };
}

export interface McpToolAnnotations {
  readOnlyHint?: boolean;
  destructiveHint?: boolean;
  idempotentHint?: boolean;
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
  inputSchema?: Record<string, unknown>;
  annotations?: McpToolAnnotations;
}

export interface McpResource {
  uri: string;
  name: string;
  mimeType: string;
  description: string;
}

export interface McpPromptArgument {
  name: string;
  required?: boolean;
  description?: string;
}

export interface McpPrompt {
  name: string;
  description: string;
  arguments?: McpPromptArgument[];
}

export interface QuarantineRecord {
  serverId: string;
  toolName: string;
  expectedHash: string;
  actualHash: string;
  baselineDescription: string;
  mutatedDescription: string;
  baselineSchema?: string;
  mutatedSchema?: string;
  riskReason: string;
  detectedAt: string;
}

export interface McpServer {
  id: string;
  name: string;
  protocol: TransportProtocol;
  commandOrUrl: string;
  args?: string[];
  env?: Record<string, string>;
  headers?: Record<string, string>;
  enabled: boolean;
  latencyMs: number;
  state: ServerState;
  fingerprint: string;
  secretRef?: string;
  tools: McpTool[];
  resources: McpResource[];
  prompts: McpPrompt[];
}

export type SkillFileCategory = 'entry' | 'script' | 'reference' | 'template' | 'asset' | 'readme';
export type SkillSourceType = 'builtin' | 'folder-upload' | 'workspace' | 'manual';

export interface SkillAttachedTool {
  name: string;
  estimatedTokens: number;
  description: string;
}

export interface SkillFileEntry {
  path: string;
  category: SkillFileCategory;
  content: string;
  sizeBytes: number;
  sha256: string;
  injectToModel: boolean;
}

export interface SkillTokenBreakdown {
  metadataTokens: number;
  entryTokens: number;
  toolsTokens: number;
  onDemandFiles: number;
  humanOnlyFiles: number;
}

export interface WorkspaceSkillCandidate {
  relativeDir: string;
  id: string;
  version: string;
  summary: string;
  fileCount: number;
  files: Array<{
    path: string;
    category: SkillFileCategory;
    sizeBytes: number;
  }>;
  alreadyImported: boolean;
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
  files: SkillFileEntry[];
  sourceType: SkillSourceType;
  sourcePath?: string;
  tokenBreakdown: SkillTokenBreakdown;
}

export interface KnowledgeChunk {
  id: string;
  index: number;
  heading: string;
  content: string;
  tokens: number;
}

export interface KnowledgeDoc {
  id: string;
  filePath: string;
  chunkCount: number;
  embeddingDim: number;
  contentPreview: string;
  content: string;
  chunks: KnowledgeChunk[];
  sourceType?: 'builtin' | 'upload' | 'workspace' | 'manual';
  indexedAt: string;
}

export interface SharedMemory {
  id: string;
  host: string;
  topic: string;
  content: string;
  scope?: 'global' | 'project';
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
  referencedBy?: string[];
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
  lastCommitMessage?: string;
}

export interface SyncPreflightCheck {
  id: string;
  passed: boolean;
  title: string;
  detail: string;
}

export interface SyncDiffLine {
  kind: 'add' | 'del' | 'ctx';
  text: string;
}

export interface SyncPreflightResult {
  ready: boolean;
  blockingReason: string;
  checks: SyncPreflightCheck[];
  manifestJson: string;
  lockfileJson: string;
  diffLines: SyncDiffLine[];
}

export interface TrinitySearchResult {
  query: string;
  latencyMs: number;
  docs: Array<{
    docId?: string;
    filePath: string;
    heading?: string;
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
