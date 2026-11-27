export type HostScope = 'full' | 'audit' | 'min';
export type ExposureMode = 'pinned' | 'lazy';
export type ServerState = 'ok' | 'quarantined' | 'degraded' | 'offline';
export type TransportProtocol = 'stdio' | 'sse' | 'http';
export type MiddlewareId = 'vault' | 'quarantine' | 'hitl' | 'redact' | 'budget';
export type DataOrigin = 'real' | 'demo' | 'fixture';
export interface VisibilitySettings {
  showDemo: boolean;
  showFixtures: boolean;
}

export interface HostProfile {
  origin?: DataOrigin;
  id: string;
  name: string;
  latencyMs: number;
  online: boolean;
  scope: HostScope;
  configSnippet: string;
  custom?: boolean;
  lastSeenAt?: string;
  activeSessions?: number;
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
  origin?: DataOrigin;
  name: string;
  serverId: string;
  description: string;
  estimatedTokens: number;
  mode: ExposureMode;
  hitl: boolean;
  fingerprint: string;
  lockedFingerprint: string;
  readOnly?: boolean;
  remoteName?: string;
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
  origin?: DataOrigin;
  serverId: string;
  toolName: string;
  expectedHash: string;
  actualHash: string;
  baselineDescription: string;
  mutatedDescription: string;
  baselineSchema?: string;
  mutatedSchema?: string;
  descriptionDiff?: string;
  schemaDiff?: string;
  riskReason: string;
  detectedAt: string;
}

export interface McpServer {
  id: string;
  name: string;
  protocol: TransportProtocol;
  commandOrUrl: string;
  cwd?: string;
  connectOnStart?: boolean;
  args?: string[];
  env?: Record<string, string>;
  headers?: Record<string, string>;
  enabled: boolean;
  latencyMs: number;
  state: ServerState;
  fingerprint: string;
  secretRef?: string;
  origin?: DataOrigin;
  tools: McpTool[];
  resources: McpResource[];
  prompts: McpPrompt[];
}

export type SkillFileCategory = 'entry' | 'script' | 'reference' | 'template' | 'asset' | 'readme';
export type SkillSourceType = 'builtin' | 'folder-upload' | 'workspace' | 'manual';

export interface SkillAttachedTool {
  inputSchema?: Record<string, unknown>;
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
  origin?: DataOrigin;
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
  origin?: DataOrigin;
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
  origin?: DataOrigin;
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

export interface DocUpdatePoint {
  date: string;
  created: number;
  updated: number;
  chunksDelta: number;
}

export interface VectorDimensionBucket {
  dimension: string;
  dimValue: number;
  model: string;
  spaceLabel: string;
  docs: number;
  chunks: number;
  sharePct: number;
}

export interface CacheHitPoint {
  date: string;
  hitRate: number;
  semanticHitRate: number;
  exactHitRate: number;
  queries: number;
  avgLatencyMs: number;
}

export interface KnowledgeAnalytics {
  updateFrequency: DocUpdatePoint[];
  dimensionDistribution: VectorDimensionBucket[];
  cacheHitTrend: CacheHitPoint[];
  currentCacheHitRate: number;
  cacheHitDelta: number;
  totalPeriodUpdates: number;
  totalVectors: number;
}

export interface VaultEntry {
  origin?: DataOrigin;
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
  origin?: DataOrigin;
  id: string;
  timestamp: string;
  host: string;
  method: string;
  stepIndex?: number;
  outcome: 'ok' | 'blocked' | 'pending_approval' | 'trusted';
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
  visibility: VisibilitySettings;
  metrics: GatewaySummaryMetrics;
  hosts: HostProfile[];
  middleware: MiddlewareRule[];
  servers: McpServer[];
  quarantines: QuarantineRecord[];
  skills: DualLayerSkill[];
  docs: KnowledgeDoc[];
  memories: SharedMemory[];
  vectorHealth: VectorHealthStats;
  knowledgeAnalytics: KnowledgeAnalytics;
  vault: VaultEntry[];
  sync: SyncStatus;
  preflight: SyncPreflightResult;
  pendingApprovals: HitlApproval[];
  auditLogs: AuditRpcEvent[];
}

export type CodexTargetPlatform = 'windows' | 'windows-wsl' | 'linux' | 'macos';

export interface CodexMcpServerEntry {
  name: string;
  transport: 'stdio' | 'http';
  command?: string;
  args?: string[];
  url?: string;
  envKeys: string[];
  enabled: boolean;
  isAgentToolbox: boolean;
  alreadyImportedToGateway: boolean;
}

export interface CodexIntegrationStatus {
  detectedPlatform: CodexTargetPlatform;
  targetPlatform: CodexTargetPlatform;
  platformLabel: string;
  wslDistro: string | null;
  wslDistros: string[];
  canDirectWrite: boolean;
  writeNote?: string;
  cliInstalled: boolean;
  cliVersion: string | null;
  codexHome: string;
  configPath: string;
  configExists: boolean;
  agentsMdExists: boolean;
  registeredInCodex: boolean;
  registeredTransport: 'stdio' | 'http' | null;
  registeredCommandOrUrl: string | null;
  discoveredServers: CodexMcpServerEntry[];
  recommendedTomlStdio: string;
  recommendedTomlHttp: string;
  recommendedCliStdio: string;
  recommendedCliHttp: string;
}
