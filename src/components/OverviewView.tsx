import { useEffect, useState, type CSSProperties } from 'react';
import type {
  CodexIntegrationStatus,
  CodexTargetPlatform,
  GatewayStateSnapshot,
  HostProfile,
  HostScope,
  MiddlewareId,
  MiddlewareRule,
} from '../types/toolbox';
import { api } from '../lib/api';
import { ProtoIcon } from './ProtoIcon';
import { ProtoSeg, ProtoStatus, ProtoSwitch, ProtoTip } from './ProtoPrimitives';
import { ModalDialog } from './ModalDialog';

interface OverviewViewProps {
  state: GatewayStateSnapshot;
  onNavigate: (view: 'gateway' | 'skills' | 'kb' | 'sync' | 'sandbox') => void;
  onToggleMiddleware: (rule: MiddlewareRule, nextEnabled: boolean) => Promise<void>;
  onUpdateMiddlewareConfig: (
    id: MiddlewareId,
    config: { maxTokensPerTurn?: number }
  ) => Promise<void>;
  onChangeHostScope: (hostId: string, scope: HostScope) => Promise<void>;
  onAddHost: (payload: {
    name: string;
    scope: HostScope;
    transport?: 'stdio' | 'sse';
  }) => Promise<string | undefined>;
  onDeleteHost: (hostId: string, hostName: string) => Promise<void>;
  onApplySnapshot: (next: GatewayStateSnapshot) => void;
  onToast: (msg: string) => void;
  onCopy: (text: string, label: string) => void;
}

const BUDGET_PRESETS = [3000, 4000, 6000, 8000];
const HOST_QUICK_PRESETS = ['Cursor', 'Windsurf', 'Cline', 'Zed AI'];

export function OverviewView({
  state,
  onNavigate,
  onToggleMiddleware,
  onUpdateMiddlewareConfig,
  onChangeHostScope,
  onAddHost,
  onDeleteHost,
  onApplySnapshot,
  onToast,
  onCopy,
}: OverviewViewProps) {
  const [configHostId, setConfigHostId] = useState<string>('codex');
  const [codexStatus, setCodexStatus] = useState<CodexIntegrationStatus | null>(null);
  const [codexTransport, setCodexTransport] = useState<'stdio' | 'http'>('stdio');
  const [codexPlatform, setCodexPlatform] = useState<CodexTargetPlatform | undefined>(undefined);
  const [codexWslDistro, setCodexWslDistro] = useState<string | undefined>(undefined);
  const [codexBusy, setCodexBusy] = useState<boolean>(false);
  const [confirmMw, setConfirmMw] = useState<MiddlewareRule | null>(null);
  const [infoTip, setInfoTip] = useState<{ title: string; body: string } | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  // Add / Delete custom host state
  const [addHostOpen, setAddHostOpen] = useState(false);
  const [hostName, setHostName] = useState('');
  const [hostScope, setHostScope] = useState<HostScope>('audit');
  const [hostTransport, setHostTransport] = useState<'stdio' | 'sse'>('stdio');
  const [hostErr, setHostErr] = useState('');
  const [delHostTarget, setDelHostTarget] = useState<HostProfile | null>(null);

  const quarantinedServers = state.servers.filter((s) => s.state === 'quarantined');
  const missingKeys = state.vault.filter((v) => !v.configured);
  const selectedHostCfg = state.hosts.find((h) => h.id === configHostId) || state.hosts[0];

  useEffect(() => {
    let active = true;
    api
      .getCodexStatus({ targetPlatform: codexPlatform, wslDistro: codexWslDistro })
      .then((res) => {
        if (active) {
          setCodexStatus(res);
          if (!codexPlatform) {
            setCodexPlatform(res.detectedPlatform);
          }
          if (res.wslDistro && !codexWslDistro) {
            setCodexWslDistro(res.wslDistro);
          }
          if (res.registeredTransport) {
            setCodexTransport(res.registeredTransport);
          }
        }
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [state.servers.length, codexPlatform, codexWslDistro]);

  const handleInstallCodex = async () => {
    setCodexBusy(true);
    try {
      const next = await api.installCodex({
        transport: codexTransport,
        targetPlatform: codexPlatform,
        wslDistro: codexWslDistro,
      });
      setCodexStatus(next);
      onToast(`已将 Agent-Toolbox (${next.platformLabel} · ${codexTransport}) 写入 ${next.configPath}`);
    } catch (err) {
      onToast(err instanceof Error ? err.message : '写入 Codex 配置失败');
    } finally {
      setCodexBusy(false);
    }
  };

  const handleUninstallCodex = async () => {
    setCodexBusy(true);
    try {
      const next = await api.uninstallCodex({
        targetPlatform: codexPlatform,
        wslDistro: codexWslDistro,
      });
      setCodexStatus(next);
      onToast(`已从 ${next.platformLabel} Codex CLI 移除 Agent-Toolbox 配置`);
    } catch (err) {
      onToast(err instanceof Error ? err.message : '移除 Codex 配置失败');
    } finally {
      setCodexBusy(false);
    }
  };

  const handleImportCodexServers = async () => {
    setCodexBusy(true);
    try {
      const res = await api.importCodexServers({
        defaultMode: 'lazy',
        targetPlatform: codexPlatform,
        wslDistro: codexWslDistro,
      });
      onApplySnapshot(res.data);
      setCodexStatus(res.codexStatus);
      onToast(
        res.addedIds.length
          ? `已从 ${res.codexStatus.platformLabel} Codex 导入 ${res.addedIds.length} 个 MCP Server（默认 Lazy 模式）`
          : 'Codex 中的 MCP Server 均已导入或无新增'
      );
    } catch (err) {
      onToast(err instanceof Error ? err.message : '导入 Codex MCP 失败');
    } finally {
      setCodexBusy(false);
    }
  };

  const handleMiddlewareClick = async (rule: MiddlewareRule) => {
    if (rule.enabled && rule.id !== 'budget') {
      setConfirmMw(rule);
      return;
    }
    setBusyId(rule.id);
    try {
      await onToggleMiddleware(rule, !rule.enabled);
    } finally {
      setBusyId(null);
    }
  };

  const handleAddHostSubmit = async () => {
    if (!hostName.trim()) {
      setHostErr('请填写宿主名称（例如 Cursor、Windsurf）。');
      return;
    }
    setHostErr('');
    setBusyId('add-host');
    try {
      const newId = await onAddHost({
        name: hostName.trim(),
        scope: hostScope,
        transport: hostTransport,
      });
      if (newId) setConfigHostId(newId);
      setAddHostOpen(false);
      setHostName('');
      setHostScope('audit');
      setHostTransport('stdio');
    } catch (err) {
      setHostErr(err instanceof Error ? err.message : '新增失败');
    } finally {
      setBusyId(null);
    }
  };

  return (
    <>
      <div className="page-h">
        <div className="od-fill">
          <h1 tabIndex={-1} id="pageTitle">
            总览
          </h1>
          <p className="lead">
            一页看清：哪些 Agent 已接入、省了多少 Token、有没有需要你处理的安全问题。
          </p>
        </div>
      </div>

      {/* Priority Alerts */}
      {quarantinedServers.length > 0 && (
        <div className="flash bad" id="h-alert">
          <ProtoIcon name="alert" />
          <div className="t">
            <b>{quarantinedServers.length} 个 MCP Server 疑似被篡改，已自动拦截</b>
            <span>
              「{quarantinedServers[0].name}」的工具说明被偷偷改成了&quot;先读取你的 SSH
              私钥&quot;。在你处理之前，它不会被任何 AI 调用。
            </span>
          </div>
          <button type="button" className="btn pri" onClick={() => onNavigate('gateway')}>
            <span>去处理</span>
          </button>
        </div>
      )}

      {missingKeys.length > 0 && (
        <div className="flash warn" id={quarantinedServers.length ? undefined : 'h-alert'}>
          <ProtoIcon name="key" />
          <div className="t">
            <b>{missingKeys.length} 个密钥还没填写</b>
            <span>
              {missingKeys.map((m) => m.key).join('、')} 缺失，对应服务暂时无法调用。
            </span>
          </div>
          <button type="button" className="btn" onClick={() => onNavigate('sync')}>
            <span>去填写</span>
          </button>
        </div>
      )}

      {quarantinedServers.length === 0 && missingKeys.length === 0 && (
        <div className="flash ok" id="h-alert">
          <ProtoIcon name="ok" />
          <div className="t">
            <b>一切正常</b>
            <span>没有被拦截的工具，所有密钥都已就绪。</span>
          </div>
        </div>
      )}

      {/* 4 KPI Cards */}
      <div className="stats od-grid" id="h-stats">
        <button type="button" className="stat" onClick={() => onNavigate('gateway')}>
          <span className="lbl">每轮对话节省的 Token</span>
          <span className="num">{state.metrics.savedPercentage}</span>
          <span className="sub ok">省下约 {state.metrics.savedTokensK} · 只加载要用的工具</span>
        </button>

        <button type="button" className="stat" onClick={() => onNavigate('gateway')}>
          <span className="lbl">已接入的 MCP Server</span>
          <span className="num">{state.metrics.connectedServers} 个</span>
          <span className="sub">共 {state.metrics.totalTools} 个工具</span>
        </button>

        <button type="button" className="stat" onClick={() => onNavigate('skills')}>
          <span className="lbl">正在使用的 Skill</span>
          <span className="num">
            {state.metrics.mountedSkills} / {state.metrics.totalSkills}
          </span>
          <span className="sub">其余待命，不占 Token</span>
        </button>

        <button
          type="button"
          className="stat"
          onClick={() => onNavigate(quarantinedServers.length ? 'gateway' : 'kb')}
        >
          <span className="lbl">安全状态</span>
          <span className="num">
            {quarantinedServers.length > 0 ? `${quarantinedServers.length} 项拦截` : '正常'}
          </span>
          <span className={`sub ${quarantinedServers.length > 0 ? 'bad' : 'ok'}`}>
            {quarantinedServers.length > 0 ? '需要你确认' : '指纹校验全部通过'}
          </span>
        </button>
      </div>

      {/* Hub-and-Spoke Topology */}
      <section className="box" id="h-topo">
        <div className="box-h">
          <h2>它是怎么连起来的</h2>
          <span className="hint">每个 Agent 只需接这一个入口，就能用到所有能力</span>
        </div>
        <div className="box-b">
          <div className="topo">
            <div className="topo-col">
              <span className="cap">你的 AI Agent（{state.hosts.length}）</span>
              {state.hosts.map((h) => (
                <div key={h.id} className="node">
                  <ProtoIcon name="dot" />
                  <span className="od-fill">{h.name}</span>
                  {h.custom && <span className="tag">自定义</span>}
                </div>
              ))}
            </div>

            <div className="arrow">
              <ProtoIcon name="arrow" />
            </div>

            <div className="hub">
              <span className="small muted">唯一 MCP 入口</span>
              <b>Agent-Toolbox</b>
              <span className="small">统一转发 · 统一把关</span>
            </div>

            <div className="arrow">
              <ProtoIcon name="arrow" />
            </div>

            <div className="topo-col">
              <span className="cap">背后的能力</span>
              <div className="node">MCP Server · {state.metrics.connectedServers} 运行中</div>
              <div className="node">Skill · {state.metrics.mountedSkills} 个在用</div>
              <div className="node">知识库 RAG · {state.docs.length} 篇文档</div>
              <div className="node">GitHub 同步与密钥</div>
            </div>
          </div>
        </div>
      </section>

      {/* 5-Stage Middleware Pipeline */}
      <section className="box" id="h-pipe">
        <div className="box-h">
          <h2>
            请求经过的 5 道安全防线
            <ProtoTip
              label="安全防线"
              text="AI 每次调用工具，请求都会依次经过这 5 道检查。任何一道不通过，请求就会被拦下。"
              onOpen={setInfoTip}
            />
          </h2>
        </div>
        <div className="box-b flush">
          <div className="pipe">
            {state.middleware.map((mw, i) => {
              const isQuarantineAlert =
                mw.enabled && mw.id === 'quarantine' && quarantinedServers.length > 0;
              const isBudget = mw.id === 'budget';
              const maxTok = mw.config?.maxTokensPerTurn ?? 4000;
              const usedTok = state.metrics.currentExposureTokens;
              const pct = Math.min(100, Math.round((usedTok / maxTok) * 100));
              const fillClass = pct >= 95 ? 'bad' : pct >= 75 ? 'warn' : '';
              return (
                <div key={mw.id}>
                  <span className="n">0{i + 1}</span>
                  <b>
                    {mw.name}
                    <span className="en">{mw.enName}</span>
                  </b>
                  <span className="desc">{mw.description}</span>
                  {!mw.enabled ? (
                    <ProtoStatus kind="off" text="未开启" />
                  ) : isQuarantineAlert ? (
                    <ProtoStatus kind="bad" text={`拦截 ${quarantinedServers.length} 项`} />
                  ) : isBudget && usedTok > maxTok ? (
                    <ProtoStatus kind="warn" text="已超预算" />
                  ) : (
                    <ProtoStatus kind="ok" text="运行中" />
                  )}

                  {isBudget && (
                    <div className="od-stack" style={{ '--od-gap': '6px', marginTop: '4px' } as CSSProperties}>
                      <div className="od-row" style={{ justifyContent: 'space-between' }}>
                        <span className="small muted mono">
                          {usedTok.toLocaleString('en-US')} / {maxTok.toLocaleString('en-US')}
                        </span>
                        <span className="small muted mono">{pct}%</span>
                      </div>
                      <div className="budget-track" aria-hidden="true">
                        <div className={`budget-fill ${fillClass}`} style={{ width: `${pct}%` }} />
                      </div>
                      <label className="sr-only" htmlFor="budgetLimit">
                        每轮 Token 预算上限
                      </label>
                      <select
                        id="budgetLimit"
                        className="input mono"
                        style={{ height: '26px', fontSize: '12px', padding: '0 8px' }}
                        value={maxTok}
                        disabled={busyId === 'budget-cfg'}
                        onChange={async (e) => {
                          setBusyId('budget-cfg');
                          try {
                            await onUpdateMiddlewareConfig('budget', {
                              maxTokensPerTurn: Number(e.target.value),
                            });
                          } finally {
                            setBusyId(null);
                          }
                        }}
                      >
                        {BUDGET_PRESETS.map((v) => (
                          <option key={v} value={v}>
                            上限 {v.toLocaleString('en-US')} tok/轮
                          </option>
                        ))}
                      </select>
                    </div>
                  )}

                  <ProtoSwitch
                    checked={mw.enabled}
                    label={`${mw.name} 开关`}
                    disabled={busyId === mw.id}
                    onToggle={() => handleMiddlewareClick(mw)}
                  />
                </div>
              );
            })}
          </div>
        </div>
      </section>

      {/* Host Scopes + Onboarding Config Generator */}
      <div className="grid-2" id="h-hosts">
        <section className="box">
          <div className="box-h">
            <h2 className="od-fill">
              每个 Agent 能用到什么
              <ProtoTip
                label="权限"
                text="完整开发：可以用全部工具。只读审计：只能查询，不能修改或删除。最小权限：只开放搜索类工具。"
                onOpen={setInfoTip}
              />
            </h2>
            <button
              type="button"
              className="btn sm"
              onClick={() => {
                setHostErr('');
                setAddHostOpen(true);
              }}
            >
              <ProtoIcon name="plus" />
              <span>新增宿主</span>
            </button>
          </div>
          <div className="box-b flush">
            {state.hosts.map((h) => (
              <div key={h.id} className="list-row">
                <div className="od-fill od-row" style={{ '--od-gap': '6px' } as CSSProperties}>
                  <span className="od-truncate">{h.name}</span>
                  {h.custom && <span className="tag">自定义</span>}
                </div>
                <ProtoSeg
                  label={`${h.name} 的权限`}
                  items={
                    [
                      ['full', '完整开发'],
                      ['audit', '只读审计'],
                      ['min', '最小权限'],
                    ] as const
                  }
                  value={h.scope}
                  onChange={(val) => onChangeHostScope(h.id, val)}
                />
                {h.custom && (
                  <button
                    type="button"
                    className="btn sm danger"
                    aria-label={`删除宿主 ${h.name}`}
                    onClick={() => setDelHostTarget(h)}
                  >
                    <span>删除</span>
                  </button>
                )}
              </div>
            ))}
          </div>
        </section>

        <section className="box">
          <div className="box-h">
            <h2>把新的 Agent 接进来</h2>
            <span className="hint">按宿主自动生成连接片段</span>
          </div>
          <div className="box-b">
            <div className="od-stack" style={{ '--od-gap': '12px' } as CSSProperties}>
              <div style={{ overflowX: 'auto' }}>
                <ProtoSeg
                  label="选择要接入的工具"
                  items={state.hosts.map((h) => [h.id, h.name] as const)}
                  value={selectedHostCfg?.id || configHostId}
                  onChange={setConfigHostId}
                />
              </div>
              {selectedHostCfg?.id === 'codex' && codexStatus ? (
                <div className="od-stack" style={{ '--od-gap': '10px' } as CSSProperties}>
                  <div className="od-row" style={{ justifyContent: 'space-between', flexWrap: 'wrap', gap: '8px' }}>
                    <div style={{ overflowX: 'auto' }}>
                      <ProtoSeg
                        label="目标运行平台"
                        items={
                          [
                            ['windows', 'Windows'],
                            ['windows-wsl', 'Windows WSL'],
                            ['linux', 'Linux'],
                            ['macos', 'macOS'],
                          ] as const
                        }
                        value={codexPlatform || codexStatus.targetPlatform}
                        onChange={(nextPlatform) => {
                          setCodexPlatform(nextPlatform);
                          if (nextPlatform !== 'windows-wsl') {
                            setCodexWslDistro(undefined);
                          }
                        }}
                      />
                    </div>
                    <ProtoSeg
                      label="Codex 接入传输模式"
                      items={
                        [
                          ['stdio', 'stdio 自动守护'],
                          ['http', 'HTTP Streamable'],
                        ] as const
                      }
                      value={codexTransport}
                      onChange={setCodexTransport}
                    />
                  </div>
                  <div className="od-row" style={{ justifyContent: 'space-between', flexWrap: 'wrap', gap: '8px' }}>
                    <div className="od-row" style={{ '--od-gap': '8px' } as CSSProperties}>
                      <ProtoStatus
                        kind={codexStatus.registeredInCodex ? 'ok' : codexStatus.canDirectWrite ? 'warn' : 'off'}
                        text={
                          codexStatus.registeredInCodex
                            ? `已写入 (${codexStatus.registeredTransport})`
                            : codexStatus.canDirectWrite
                            ? '尚未写入 config.toml'
                            : '仅预览配置'
                        }
                      />
                      <span className="small muted mono">
                        {codexStatus.targetPlatform === codexStatus.detectedPlatform ? '当前环境 · ' : ''}
                        {codexStatus.cliInstalled ? codexStatus.cliVersion : '未检测到 codex CLI'}
                      </span>
                    </div>
                    {codexStatus.targetPlatform === 'windows-wsl' && codexStatus.wslDistros.length > 0 && (
                      <select
                        aria-label="选择 WSL 发行版"
                        className="input mono"
                        style={{ height: '26px', fontSize: '12px', padding: '0 8px', width: 'auto' }}
                        value={codexWslDistro || codexStatus.wslDistro || codexStatus.wslDistros[0]}
                        onChange={(e) => setCodexWslDistro(e.target.value)}
                      >
                        {codexStatus.wslDistros.map((d) => (
                          <option key={d} value={d}>
                            WSL: {d}
                          </option>
                        ))}
                      </select>
                    )}
                  </div>
                  <p className="muted small">
                    配置文件：<span className="mono">{codexStatus.configPath}</span>
                    {selectedHostCfg.lastSeenAt
                      ? ` · 最近心跳 ${new Date(selectedHostCfg.lastSeenAt).toLocaleTimeString()}`
                      : ''}
                  </p>
                  {codexStatus.writeNote && (
                    <p className="small" style={{ color: 'var(--warn)' }}>
                      {codexStatus.writeNote}
                    </p>
                  )}
                  <pre className="code">
                    {codexTransport === 'http'
                      ? codexStatus.recommendedTomlHttp
                      : codexStatus.recommendedTomlStdio}
                  </pre>
                  {codexStatus.discoveredServers.filter((s) => !s.isAgentToolbox).length > 0 && (
                    <div className="od-stack" style={{ '--od-gap': '6px', paddingTop: '4px' } as CSSProperties}>
                      <div className="od-row" style={{ justifyContent: 'space-between' }}>
                        <span className="small muted">
                          检测到 {codexStatus.discoveredServers.filter((s) => !s.isAgentToolbox).length} 个 Codex 已有 MCP 服务：
                          {codexStatus.discoveredServers
                            .filter((s) => !s.isAgentToolbox)
                            .map((s) => s.name)
                            .join('、')}
                        </span>
                        <button
                          type="button"
                          className="btn sm"
                          disabled={codexBusy}
                          onClick={handleImportCodexServers}
                        >
                          <span>导入到 Lazy 网关</span>
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              ) : (
                <>
                  <p className="muted small">复制下面的配置片段，粘贴到对应宿主客户端的 MCP 配置中即可。</p>
                  <pre className="code">{selectedHostCfg?.configSnippet}</pre>
                </>
              )}
            </div>
          </div>
          <div className="box-f" style={{ justifyContent: 'space-between', flexWrap: 'wrap', gap: '8px' }}>
            <button
              type="button"
              className="btn"
              onClick={() => {
                const snippet =
                  selectedHostCfg?.id === 'codex' && codexStatus
                    ? codexTransport === 'http'
                      ? codexStatus.recommendedTomlHttp
                      : codexStatus.recommendedTomlStdio
                    : selectedHostCfg?.configSnippet || '';
                onCopy(snippet, `${selectedHostCfg?.name || ''} 接入配置`);
              }}
            >
              <ProtoIcon name="copy" />
              <span>复制配置</span>
            </button>
            {selectedHostCfg?.id === 'codex' && codexStatus && (
              <div className="od-row" style={{ '--od-gap': '8px' } as CSSProperties}>
                {codexStatus.registeredInCodex && codexStatus.canDirectWrite && (
                  <button
                    type="button"
                    className="btn danger"
                    disabled={codexBusy}
                    onClick={handleUninstallCodex}
                  >
                    <span>移除接入</span>
                  </button>
                )}
                <button
                  type="button"
                  className="btn pri"
                  disabled={codexBusy || !codexStatus.canDirectWrite}
                  onClick={handleInstallCodex}
                >
                  <span>
                    {!codexStatus.canDirectWrite
                      ? `请复制配置到 ${codexStatus.platformLabel}`
                      : codexStatus.registeredInCodex
                      ? `更新 ${codexStatus.platformLabel} 配置`
                      : `一键写入 ${codexStatus.platformLabel} 配置`}
                  </span>
                </button>
              </div>
            )}
          </div>
        </section>
      </div>

      {/* Add Custom Host Modal */}
      <ModalDialog
        open={addHostOpen}
        title="新增自定义 Agent 宿主"
        confirmLabel="新增并生成配置"
        busy={busyId === 'add-host'}
        onClose={() => setAddHostOpen(false)}
        onConfirm={handleAddHostSubmit}
      >
        <div className="field">
          <label htmlFor="newHostName">
            宿主名称 <span style={{ color: 'var(--bad)' }}>*</span>
          </label>
          <input
            id="newHostName"
            data-autofocus="true"
            className="input"
            value={hostName}
            onChange={(e) => setHostName(e.target.value)}
            placeholder="例如 Cursor、Windsurf、Cline"
            aria-invalid={Boolean(hostErr)}
          />
          <div className="od-cluster" style={{ '--od-gap': '6px', marginTop: '4px' } as CSSProperties}>
            <span className="small muted">快捷填充：</span>
            {HOST_QUICK_PRESETS.map((preset) => (
              <button
                key={preset}
                type="button"
                className="chip-btn"
                onClick={() => setHostName(preset)}
              >
                {preset}
              </button>
            ))}
          </div>
        </div>
        <div className="grid-2" style={{ gap: '12px' }}>
          <div className="field">
            <label htmlFor="newHostTransport">接入方式</label>
            <select
              id="newHostTransport"
              className="input"
              value={hostTransport}
              onChange={(e) => setHostTransport(e.target.value as 'stdio' | 'sse')}
            >
              <option value="stdio">stdio（本地子进程，推荐）</option>
              <option value="sse">SSE（HTTP 远程流式）</option>
            </select>
          </div>
          <div className="field">
            <label htmlFor="newHostScope">默认权限范围</label>
            <select
              id="newHostScope"
              className="input"
              value={hostScope}
              onChange={(e) => setHostScope(e.target.value as HostScope)}
            >
              <option value="audit">只读审计（默认安全）</option>
              <option value="full">完整开发</option>
              <option value="min">最小权限</option>
            </select>
          </div>
        </div>
        {hostErr && <span className="err">{hostErr}</span>}
      </ModalDialog>

      {/* Delete Custom Host Confirmation */}
      <ModalDialog
        open={Boolean(delHostTarget)}
        title={`移除宿主「${delHostTarget?.name || ''}」？`}
        confirmLabel="移除"
        danger
        onClose={() => setDelHostTarget(null)}
        onConfirm={async () => {
          if (!delHostTarget) return;
          const target = delHostTarget;
          await onDeleteHost(target.id, target.name);
          if (configHostId === target.id) setConfigHostId('antigravity');
          setDelHostTarget(null);
        }}
      >
        <p>移除后，该宿主的权限策略和接入片段将从网关配置中删除。</p>
      </ModalDialog>

      {/* Confirm disabling a security middleware */}
      <ModalDialog
        open={Boolean(confirmMw)}
        title={confirmMw ? `确定关闭「${confirmMw.name}」吗？` : ''}
        confirmLabel="关闭这道防线"
        danger
        busy={Boolean(busyId)}
        onClose={() => setConfirmMw(null)}
        onConfirm={async () => {
          if (!confirmMw) return;
          setBusyId(confirmMw.id);
          try {
            await onToggleMiddleware(confirmMw, false);
            setConfirmMw(null);
          } finally {
            setBusyId(null);
          }
        }}
      >
        <p>{confirmMw?.description}。</p>
        <p className="muted">关闭后，所有 Agent 的请求都会跳过这一步检查，直到你重新开启。</p>
      </ModalDialog>

      <ModalDialog
        open={Boolean(infoTip)}
        title={infoTip?.title || ''}
        confirmLabel="知道了"
        hideCancel
        onClose={() => setInfoTip(null)}
        onConfirm={() => setInfoTip(null)}
      >
        <p>{infoTip?.body}</p>
      </ModalDialog>
    </>
  );
}
