import { useCallback, useEffect, useRef, useState } from 'react';
import type {
  ExposureMode,
  GatewayStateSnapshot,
  HostScope,
  MiddlewareRule,
  TransportProtocol,
} from './types/toolbox';
import { api } from './lib/api';
import { ProtoIcon, type ProtoIconName } from './components/ProtoIcon';
import { OverviewView } from './components/OverviewView';
import { GatewayView } from './components/GatewayView';
import { SkillsView } from './components/SkillsView';
import { KnowledgeView } from './components/KnowledgeView';
import { SyncVaultView } from './components/SyncVaultView';
import { SandboxDocsView } from './components/SandboxDocsView';

type ViewId = 'home' | 'gateway' | 'skills' | 'kb' | 'sync' | 'sandbox';

const VIEWS: Array<{ id: Exclude<ViewId, 'sync'>; name: string; ic: ProtoIconName }> = [
  { id: 'home', name: '总览', ic: 'home' },
  { id: 'gateway', name: 'MCP 网关与安全', ic: 'server' },
  { id: 'skills', name: 'Skill 中心', ic: 'puzzle' },
  { id: 'kb', name: '知识库 RAG', ic: 'book' },
  { id: 'sandbox', name: 'JSON-RPC 沙箱与报告', ic: 'terminal' },
];

export default function App() {
  const [view, setView] = useState<ViewId>('home');
  const [sandboxTab, setSandboxTab] = useState<'sim' | 'report'>('sim');
  const [state, setState] = useState<GatewayStateSnapshot | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [activeAnchor, setActiveAnchor] = useState<string>('h-alert');
  const [toastMsg, setToastMsg] = useState<string | null>(null);
  const toastTimerRef = useRef<number | null>(null);

  const getSections = useCallback(
    (v: ViewId): Array<[string, string]> => {
      switch (v) {
        case 'home':
          return [
            ['h-alert', '需要处理'],
            ['h-stats', '关键数字'],
            ['h-topo', '连接关系'],
            ['h-pipe', '安全防线'],
            ['h-hosts', '接入与权限'],
          ];
        case 'gateway':
          return [
            ['g-alert', 'Quarantine 隔离审查'],
            ['g-list', 'MCP Server 列表'],
          ];
        case 'skills':
          return [
            ['s-list', 'Skill 列表'],
            ['s-detail', 'Skill 详情'],
          ];
        case 'kb':
          return [
            ['k-health', '健康状况'],
            ['k-search', '统一检索'],
            ['k-pool', '知识库与 Memory'],
          ];
        case 'sync':
          return [
            ['y-check', '同步前检查'],
            ['y-files', '变更内容'],
            ['y-vault', 'Vault'],
          ];
        case 'sandbox':
          return [['x-main', sandboxTab === 'sim' ? 'JSON-RPC 沙箱' : '报告正文']];
      }
    },
    [sandboxTab]
  );

  const showToast = useCallback((msg: string) => {
    setToastMsg(msg);
    if (toastTimerRef.current) window.clearTimeout(toastTimerRef.current);
    toastTimerRef.current = window.setTimeout(() => setToastMsg(null), 2400);
  }, []);

  useEffect(() => {
    return () => {
      if (toastTimerRef.current) window.clearTimeout(toastTimerRef.current);
    };
  }, []);

  const loadState = useCallback(async () => {
    try {
      setError(null);
      const data = await api.getState();
      setState(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : '无法连接本地网关服务');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadState();
  }, [loadState]);

  useEffect(() => {
    const es = new EventSource('/api/v1/events');
    const refresh = () => {
      api
        .getState()
        .then(setState)
        .catch(() => {});
    };
    const eventNames = [
      'quarantine.detected',
      'quarantine.resolved',
      'skill.mounted',
      'skill.unmounted',
      'hitl.pending',
      'hitl.resolved',
      'vault.updated',
      'sync.pushed',
    ];
    eventNames.forEach((ev) => es.addEventListener(ev, refresh));
    return () => es.close();
  }, []);

  const navigate = (next: ViewId) => {
    setView(next);
    const secs = getSections(next);
    setActiveAnchor(secs[0]?.[0] || '');
    window.scrollTo(0, 0);
    requestAnimationFrame(() => {
      const h = document.getElementById('pageTitle');
      if (h) h.focus({ preventScroll: true });
    });
  };

  const jumpToSection = (id: string) => {
    setActiveAnchor(id);
    const el = document.getElementById(id);
    if (el) {
      const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      el.scrollIntoView({ behavior: reduceMotion ? 'auto' : 'smooth', block: 'start' });
      el.setAttribute('tabindex', '-1');
      el.focus({ preventScroll: true });
    }
  };

  const handleCopy = (text: string, label: string) => {
    try {
      if (navigator.clipboard) navigator.clipboard.writeText(text).catch(() => {});
    } catch {
      // Clipboard may be restricted in preview iframes
    }
    showToast(`已复制${label}`);
  };

  /* ---------- Action Handlers Wired to Real Backend REST APIs ---------- */
  const handleToggleMiddleware = async (rule: MiddlewareRule, nextEnabled: boolean) => {
    const next = await api.toggleMiddleware(rule.id, nextEnabled);
    setState(next);
    showToast(`${rule.name}${nextEnabled ? ' 已开启' : ' 已关闭'}`);
  };

  const handleChangeHostScope = async (hostId: string, scope: HostScope) => {
    const next = await api.updateHostScope(hostId, scope);
    setState(next);
  };

  const handleUpdateTool = async (
    toolName: string,
    patch: { mode?: ExposureMode; hitl?: boolean },
    estimatedTokens?: number
  ) => {
    const next = await api.updateTool(toolName, patch);
    setState(next);
    if (patch.mode) {
      const tokText = typeof estimatedTokens === 'number' ? estimatedTokens : '';
      showToast(
        `${toolName}${patch.mode === 'pinned' ? ` 改为 Pinned（+${tokText} Token / 轮）` : ` 改为 Lazy（-${tokText} Token / 轮）`}`
      );
    } else if (typeof patch.hitl === 'boolean') {
      showToast(patch.hitl ? `调用 ${toolName} 前会先请你确认` : `${toolName} 不再需要审批`);
    }
  };

  const handleResolveQuarantine = async (
    serverId: string,
    serverName: string,
    action: 'rollback' | 'trust'
  ) => {
    const next = await api.resolveQuarantine(serverId, action);
    setState(next);
    showToast(
      action === 'rollback'
        ? `已回滚「${serverName}」到安全版本，恢复使用`
        : '已信任改动并更新指纹锁'
    );
  };

  const handleSimulateQuarantine = async () => {
    const next = await api.simulateQuarantine();
    setState(next);
    showToast('演示：检测到「community-scraper」被篡改，已自动隔离');
  };

  const handleAddServer = async (payload: {
    name: string;
    protocol: TransportProtocol;
    commandOrUrl: string;
    defaultMode: ExposureMode;
    secretRef?: string;
    initialToolName?: string;
    initialToolDesc?: string;
  }) => {
    const next = await api.addServer(payload);
    setState(next);
    showToast(`已接入 MCP Server：${payload.name}`);
  };

  const handleResolveHitl = async (approvalId: string, decision: 'approve' | 'reject') => {
    const next = await api.resolveHitl(approvalId, decision);
    setState(next);
    showToast(decision === 'approve' ? '已批准放行该高危调用' : '已拒绝该高危调用 (-32002)');
  };

  const handleMountSkill = async (skillId: string, tokens?: number) => {
    const next = await api.mountSkill(skillId, 'Claude Code');
    setState(next);
    const tokStr = typeof tokens === 'number' ? `，占用 ${tokens.toLocaleString('en-US')} Token / 轮` : '';
    showToast(`已挂载 ${skillId}${tokStr}`);
  };

  const handleUnmountSkill = async (skillId: string, tokens?: number) => {
    const next = await api.unmountSkill(skillId);
    setState(next);
    const tokStr = typeof tokens === 'number' ? `，释放 ${tokens.toLocaleString('en-US')} Token` : '';
    showToast(`已卸载 ${skillId}${tokStr}`);
  };

  const handleSaveSkillMd = async (skillId: string, markdown: string) => {
    const next = await api.updateSkillMarkdown(skillId, markdown);
    setState(next);
    showToast(`已保存 ${skillId} 的 SKILL.md 并更新指纹`);
  };

  const handleCreateSkill = async (payload: {
    id: string;
    version: string;
    summary: string;
    skillMarkdown: string;
    toolName?: string;
  }) => {
    const next = await api.createSkill(payload);
    setState(next);
    showToast(`已导入 Skill：${payload.id}`);
  };

  const handleAddDoc = async (filePath: string, content: string) => {
    const next = await api.addKnowledgeDoc(filePath, content);
    setState(next);
    showToast(`已收录文档：${filePath}`);
  };

  const handleAddMemory = async (host: string, topic: string, content: string) => {
    const next = await api.addMemory(host, topic, content);
    setState(next);
    showToast('已记录共享 Memory');
  };

  const handleDeleteMemory = async (id: string) => {
    const next = await api.deleteMemory(id);
    setState(next);
    showToast('已删除这条 Memory');
  };

  const handleRebuildIndex = async () => {
    const next = await api.rebuildVectorIndex();
    setState(next);
    showToast('索引重建完成，0 个孤立段');
  };

  const handleSetVaultKey = async (key: string, value: string, serviceName?: string) => {
    const next = await api.setVaultSecret(key, value, serviceName);
    setState(next);
    showToast(`已存入 Vault：vault://${key}`);
  };

  const handlePull = async () => {
    const res = await api.pullGitHub();
    setState(res.data);
    showToast(res.message || '已是最新：GitHub 上没有新的改动');
  };

  const handlePush = async () => {
    try {
      const next = await api.pushGitHub();
      setState(next);
      showToast('已推送到 GitHub · main');
    } catch (err) {
      showToast(err instanceof Error ? err.message : '推送被安全门禁拦截');
    }
  };

  const handleRunSandboxStep = async (host: string, stepIndex: number) => {
    const res = await api.runSandboxRpc({ host, stepIndex });
    setState(res.data);
  };

  const quarantinedCount = state?.metrics.quarantinedCount || 0;
  const sections = getSections(view);

  return (
    <>
      <header className="top">
        <button
          type="button"
          className="brand"
          aria-label="Agent-Toolbox"
          onClick={() => navigate('home')}
        >
          <ProtoIcon name="brand" />
          <span>Agent-Toolbox</span>
        </button>

        <nav className="nav" id="nav" aria-label="主导航">
          {VIEWS.map((v) => {
            const active = view === v.id;
            return (
              <button
                key={v.id}
                type="button"
                aria-current={active ? 'page' : undefined}
                onClick={() => navigate(v.id)}
              >
                <ProtoIcon name={v.ic} />
                {v.name}
                {v.id === 'gateway' && quarantinedCount > 0 && (
                  <span className="count" aria-label={`${quarantinedCount} 项待处理`}>
                    {quarantinedCount}
                  </span>
                )}
              </button>
            );
          })}
        </nav>

        <button
          className="btn pri"
          type="button"
          id="syncBtn"
          aria-current={view === 'sync' ? 'page' : undefined}
          onClick={() => navigate('sync')}
        >
          <ProtoIcon name="sync" />
          <span>{state?.sync.pushed ? '已同步至 GitHub' : '同步至 GitHub'}</span>
        </button>
      </header>

      <div className="layout">
        <aside className="side" id="side" aria-label="本页内容与宿主状态">
          <div className="side-sec">
            <div className="side-h">本页内容</div>
            {sections.map(([id, label]) => (
              <button
                key={id}
                type="button"
                className="side-link"
                aria-current={activeAnchor === id ? 'true' : undefined}
                onClick={() => jumpToSection(id)}
              >
                {label}
              </button>
            ))}
          </div>

          {state && (
            <div className="side-sec">
              <div className="side-h">
                已接入的 Agent · {state.hosts.filter((h) => h.online).length}
              </div>
              {state.hosts.map((h) => (
                <div key={h.id} className="host-row">
                  <ProtoIcon name="dot" className={h.online ? '' : 'off'} />
                  <span className="od-truncate">{h.name}</span>
                  <span className="mono small muted">{h.online ? `${h.latencyMs}ms` : '离线'}</span>
                </div>
              ))}
              <p className="side-note">绿点表示在线，数字是响应速度，越小越快。</p>
            </div>
          )}

          <div className="side-sec">
            <div className="side-h">统一入口地址</div>
            <div className="side-note mono" style={{ wordBreak: 'break-all' }}>
              stdio://agent-toolbox
            </div>
            <div className="side-note mono" style={{ wordBreak: 'break-all' }}>
              http://127.0.0.1:3000/api/mcp/sse
            </div>
            <button
              type="button"
              className="side-link"
              onClick={() =>
                handleCopy('stdio://agent-toolbox\nhttp://127.0.0.1:3000/api/mcp/sse', '入口地址')
              }
            >
              <ProtoIcon name="copy" />
              复制地址
            </button>
          </div>
        </aside>

        <main className="main" id="main" tabIndex={-1}>
          {loading ? (
            <div className="box">
              <div className="box-b">
                <span className="muted">正在连接本地网关服务…</span>
              </div>
            </div>
          ) : error || !state ? (
            <div className="flash bad">
              <ProtoIcon name="alert" />
              <div className="t">
                <b>这一页加载出错了</b>
                <span>{error || '无法连接本地网关服务'}</span>
              </div>
              <button type="button" className="btn" onClick={loadState}>
                重试
              </button>
            </div>
          ) : view === 'home' ? (
            <OverviewView
              state={state}
              onNavigate={navigate}
              onToggleMiddleware={handleToggleMiddleware}
              onChangeHostScope={handleChangeHostScope}
              onCopy={handleCopy}
            />
          ) : view === 'gateway' ? (
            <GatewayView
              state={state}
              onUpdateTool={handleUpdateTool}
              onResolveQuarantine={handleResolveQuarantine}
              onSimulateQuarantine={handleSimulateQuarantine}
              onAddServer={handleAddServer}
              onResolveHitl={handleResolveHitl}
            />
          ) : view === 'skills' ? (
            <SkillsView
              state={state}
              onMountSkill={handleMountSkill}
              onUnmountSkill={handleUnmountSkill}
              onSaveMarkdown={handleSaveSkillMd}
              onCreateSkill={handleCreateSkill}
            />
          ) : view === 'kb' ? (
            <KnowledgeView
              state={state}
              onMountSkill={handleMountSkill}
              onAddDoc={handleAddDoc}
              onAddMemory={handleAddMemory}
              onDeleteMemory={handleDeleteMemory}
              onRebuildIndex={handleRebuildIndex}
            />
          ) : view === 'sync' ? (
            <SyncVaultView
              state={state}
              onSetVaultKey={handleSetVaultKey}
              onPull={handlePull}
              onPush={handlePush}
            />
          ) : (
            <SandboxDocsView
              state={state}
              tab={sandboxTab}
              onTabChange={setSandboxTab}
              onRunStep={handleRunSandboxStep}
              onToast={showToast}
            />
          )}
        </main>
      </div>

      <div className={`toast${toastMsg ? ' show' : ''}`} id="toast" role="status" aria-live="polite">
        {toastMsg && (
          <>
            <ProtoIcon name="ok" />
            <span>{toastMsg}</span>
          </>
        )}
      </div>
    </>
  );
}
