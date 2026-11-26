import { useState, type CSSProperties } from 'react';
import type { GatewayStateSnapshot, HostScope, MiddlewareRule } from '../types/toolbox';
import { ProtoIcon } from './ProtoIcon';
import { ProtoSeg, ProtoStatus, ProtoSwitch, ProtoTip } from './ProtoPrimitives';
import { ModalDialog } from './ModalDialog';

interface OverviewViewProps {
  state: GatewayStateSnapshot;
  onNavigate: (view: 'gateway' | 'skills' | 'kb' | 'sync' | 'sandbox') => void;
  onToggleMiddleware: (rule: MiddlewareRule, nextEnabled: boolean) => Promise<void>;
  onChangeHostScope: (hostId: string, scope: HostScope) => Promise<void>;
  onCopy: (text: string, label: string) => void;
}

export function OverviewView({
  state,
  onNavigate,
  onToggleMiddleware,
  onChangeHostScope,
  onCopy,
}: OverviewViewProps) {
  const [configHostId, setConfigHostId] = useState<'antigravity' | 'claude' | 'codex' | 'opencode'>(
    'antigravity'
  );
  const [confirmMw, setConfirmMw] = useState<MiddlewareRule | null>(null);
  const [infoTip, setInfoTip] = useState<{ title: string; body: string } | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const quarantinedServers = state.servers.filter((s) => s.state === 'quarantined');
  const missingKeys = state.vault.filter((v) => !v.configured);
  const selectedHostCfg = state.hosts.find((h) => h.id === configHostId) || state.hosts[0];

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
              <span className="cap">你的 AI Agent</span>
              {state.hosts.map((h) => (
                <div key={h.id} className="node">
                  <ProtoIcon name="dot" />
                  <span className="od-fill">{h.name}</span>
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
              <div className="node">MCP Server · {state.metrics.connectedServers}</div>
              <div className="node">Skill · {state.metrics.mountedSkills} 个在用</div>
              <div className="node">知识库 RAG · Memory</div>
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
                  ) : (
                    <ProtoStatus kind="ok" text="运行中" />
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
            <h2>
              每个 Agent 能用到什么
              <ProtoTip
                label="权限"
                text="完整开发：可以用全部工具。只读审计：只能查询，不能修改或删除。最小权限：只开放搜索类工具。"
                onOpen={setInfoTip}
              />
            </h2>
          </div>
          <div className="box-b flush">
            {state.hosts.map((h) => (
              <div key={h.id} className="list-row">
                <span className="od-fill">{h.name}</span>
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
              </div>
            ))}
          </div>
        </section>

        <section className="box">
          <div className="box-h">
            <h2>把新的 Agent 接进来</h2>
          </div>
          <div className="box-b">
            <div className="od-stack" style={{ '--od-gap': '12px' } as CSSProperties}>
              <ProtoSeg
                label="选择要接入的工具"
                items={
                  [
                    ['antigravity', 'Antigravity'],
                    ['claude', 'Claude Code'],
                    ['codex', 'Codex CLI'],
                    ['opencode', 'OpenCode'],
                  ] as const
                }
                value={configHostId}
                onChange={setConfigHostId}
              />
              <p className="muted small">复制下面的内容，按注释提示操作即可。</p>
              <pre className="code">{selectedHostCfg?.configSnippet}</pre>
            </div>
          </div>
          <div className="box-f">
            <button
              type="button"
              className="btn"
              onClick={() => onCopy(selectedHostCfg?.configSnippet || '', '接入配置')}
            >
              <ProtoIcon name="copy" />
              <span>复制</span>
            </button>
          </div>
        </section>
      </div>

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
