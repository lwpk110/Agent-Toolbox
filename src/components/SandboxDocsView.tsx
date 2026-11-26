import { useEffect, useState, type CSSProperties } from 'react';
import type { GatewayStateSnapshot } from '../types/toolbox';
import type { DocDetail, DocMeta } from '../types/docs';
import { api } from '../lib/api';
import { ProtoIcon } from './ProtoIcon';
import { ProtoMore, ProtoSeg, ProtoStatus } from './ProtoPrimitives';
import { MarkdownViewer } from './MarkdownViewer';
import { DiagramLightbox } from './DiagramLightbox';

const STEPS = [
  { index: 0, title: '看看能省多少 Token', method: 'tools/list', desc: '对比全量暴露和 Lazy 按需加载的 Token 用量' },
  { index: 1, title: 'Lazy Discovery 按需发现', method: 'toolbox__discover_capabilities', desc: '用一句话描述任务，网关推荐合适的工具' },
  { index: 2, title: '挂载一个 Skill', method: 'toolbox__load_skill', desc: '把 Skill 的说明和工具一起加载进来' },
  { index: 3, title: '调用 Skill 里的工具', method: 'skill_owasp__scan_deps', desc: '真正执行一次扫描' },
  { index: 4, title: '用完卸载', method: 'toolbox__unload_skill', desc: '释放 Token，工具列表恢复原样' },
  { index: 5, title: '查知识库', method: 'toolbox__search_knowledge', desc: '同时搜索文档、Memory 和 Skill' },
  { index: 6, title: '拦截被篡改的工具', method: 'scraper__fetch_page', desc: 'Quarantine 发现指纹不一致，直接拒绝' },
  { index: 7, title: '危险操作先审批', method: 'github__delete_repo', desc: 'HITL 审批开启，调用会暂停等你确认' },
  { index: 8, title: '自动给密钥打码', method: 'postgres__query', desc: '返回内容里的密钥被替换成占位符' },
];

const REPORT_SECTIONS: ReadonlyArray<readonly [string, string]> = [
  ['r1', '结论'],
  ['r2', '借鉴的 7 个开源项目'],
  ['r3', '四个 Agent 都能接入'],
  ['r4', '四个难点与解法'],
];

interface SandboxDocsViewProps {
  state: GatewayStateSnapshot;
  tab: 'sim' | 'report';
  onTabChange: (tab: 'sim' | 'report') => void;
  onRunStep: (host: string, stepIndex: number) => Promise<void>;
  onToast: (msg: string) => void;
}

export function SandboxDocsView({
  state,
  tab,
  onTabChange,
  onRunStep,
  onToast,
}: SandboxDocsViewProps) {
  const [simHost, setSimHost] = useState<string>('Claude Code');
  const [activeStep, setActiveStep] = useState<number>(2);
  const [selectedLogIdx, setSelectedLogIdx] = useState<number>(0);
  const [running, setRunning] = useState<boolean>(false);

  // Report & Extended Engineering Docs state
  const [docList, setDocList] = useState<DocMeta[]>([]);
  const [activeDocSlug, setActiveDocSlug] = useState<string>('summary');
  const [docDetail, setDocDetail] = useState<DocDetail | null>(null);
  const [docLoading, setDocLoading] = useState<boolean>(false);
  const [lightboxDiagram, setLightboxDiagram] = useState<{
    code: string;
    svg: string;
    title: string;
  } | null>(null);

  useEffect(() => {
    if (tab !== 'report') return;
    if (docList.length === 0) {
      api.getDocsList().then(setDocList).catch(() => {});
    }
  }, [tab, docList.length]);

  useEffect(() => {
    if (tab !== 'report' || activeDocSlug === 'summary') return;
    setDocLoading(true);
    api
      .getDocDetail(activeDocSlug)
      .then(setDocDetail)
      .finally(() => setDocLoading(false));
  }, [tab, activeDocSlug]);

  const handleRun = async () => {
    setRunning(true);
    try {
      await onRunStep(simHost, activeStep);
      setSelectedLogIdx(0);
      if (activeStep < STEPS.length - 1) {
        setActiveStep((prev) => prev + 1);
      }
    } finally {
      setRunning(false);
    }
  };

  const handleExportMd = async () => {
    try {
      const target =
        activeDocSlug !== 'summary' && docDetail
          ? docDetail
          : await api.getDocDetail('feasibility');
      const blob = new Blob([target.content], { type: 'text/markdown;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = target.filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      onToast(`已导出 ${target.filename}`);
    } catch {
      onToast('导出失败，请稍后重试');
    }
  };

  const jumpToReportAnchor = (id: string) => {
    const el = document.getElementById(id);
    if (el) {
      const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      el.scrollIntoView({ behavior: reduceMotion ? 'auto' : 'smooth', block: 'start' });
    }
  };

  const selectedLog = state.auditLogs[selectedLogIdx] || state.auditLogs[0];

  return (
    <>
      <div className="page-h">
        <div className="od-fill">
          <h1 tabIndex={-1} id="pageTitle">
            JSON-RPC 沙箱与报告
          </h1>
          <p className="lead">
            阅读架构可行性报告，或一步步演练 AI 是怎样通过唯一 MCP 入口调用工具的。
          </p>
        </div>
        {tab === 'report' && (
          <div className="acts">
            <button type="button" className="btn" onClick={handleExportMd}>
              <ProtoIcon name="download" />
              <span>导出 .md</span>
            </button>
          </div>
        )}
      </div>

      <div className="od-row">
        <ProtoSeg
          label="切换内容"
          items={
            [
              ['sim', 'JSON-RPC 沙箱'],
              ['report', '可行性报告'],
            ] as const
          }
          value={tab}
          onChange={onTabChange}
        />
      </div>

      {tab === 'sim' ? (
        <div className="grid-side">
          {/* Left: Sandbox Steps */}
          <section className="box" id="x-main">
            <div className="box-h">
              <h2>沙箱步骤</h2>
              <span className="hint">
                {state.auditLogs.length} / {STEPS.length} 已运行
              </span>
            </div>

            <div className="box-b">
              <div className="field">
                <label htmlFor="simHost">模拟哪个 Agent</label>
                <select
                  className="input"
                  id="simHost"
                  value={simHost}
                  onChange={(e) => setSimHost(e.target.value)}
                >
                  {state.hosts.map((h) => (
                    <option key={h.id} value={h.name}>
                      {h.name}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div className="steps">
              {STEPS.map((s) => {
                const done = state.auditLogs.some((l) => l.stepIndex === s.index);
                const current = activeStep === s.index;
                return (
                  <button
                    key={s.index}
                    type="button"
                    className={`step${done ? ' done' : ''}`}
                    aria-current={current ? 'true' : undefined}
                    onClick={() => setActiveStep(s.index)}
                  >
                    <span className="mk">{done ? '✓' : s.index + 1}</span>
                    <span>
                      <span className="tt" style={{ display: 'block' }}>
                        {s.title}
                      </span>
                      <span className="dd" style={{ display: 'block' }}>
                        {s.desc}
                      </span>
                    </span>
                  </button>
                );
              })}
            </div>

            <div className="box-f">
              <button
                type="button"
                className="btn pri"
                disabled={running}
                onClick={handleRun}
              >
                <span>{running ? '运行中…' : `运行第 ${activeStep + 1} 步`}</span>
              </button>
            </div>
          </section>

          {/* Right: Gateway Response + Run History */}
          <div className="od-stack" style={{ '--od-gap': '16px' } as CSSProperties}>
            <section className="box">
              <div className="box-h">
                <h2>网关返回的内容</h2>
              </div>
              <div className="box-b">
                {selectedLog ? (
                  <div className="od-stack" style={{ '--od-gap': '12px' } as CSSProperties}>
                    <p className="small muted">
                      {selectedLog.host} 调用 <span className="mono">{selectedLog.method}</span> ·{' '}
                      {selectedLog.latencyMs}ms ·{' '}
                      {selectedLog.outcome === 'blocked'
                        ? '已拦截'
                        : selectedLog.outcome === 'pending_approval'
                        ? '待审批'
                        : '成功'}
                    </p>
                    <pre className="code">
                      {JSON.stringify(selectedLog.responsePayload, null, 2)}
                    </pre>
                  </div>
                ) : (
                  <div className="empty">
                    <ProtoIcon name="terminal" />
                    <b>还没有运行任何步骤</b>
                    <span>在左侧选一步，点「运行」，这里会显示网关返回的内容。</span>
                  </div>
                )}
              </div>
              {selectedLog && (
                <ProtoMore label="查看请求报文（Request）">
                  <pre className="code">
                    {JSON.stringify(selectedLog.requestPayload, null, 2)}
                  </pre>
                </ProtoMore>
              )}
            </section>

            <section className="box">
              <div className="box-h">
                <h2>运行记录</h2>
              </div>
              <div className="tbl-wrap">
                <table className="tbl">
                  <thead>
                    <tr>
                      <th>时间</th>
                      <th>Agent</th>
                      <th>调用</th>
                      <th>结果</th>
                      <th className="num">耗时</th>
                    </tr>
                  </thead>
                  <tbody>
                    {state.auditLogs.length === 0 ? (
                      <tr>
                        <td colSpan={5} className="muted small" style={{ padding: '16px' }}>
                          运行记录会出现在这里，点任意一行查看详情。
                        </td>
                      </tr>
                    ) : (
                      state.auditLogs.map((l, idx) => (
                        <tr
                          key={l.id}
                          className="pick"
                          tabIndex={0}
                          aria-selected={idx === selectedLogIdx ? 'true' : 'false'}
                          onClick={() => setSelectedLogIdx(idx)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter' || e.key === ' ') {
                              e.preventDefault();
                              setSelectedLogIdx(idx);
                            }
                          }}
                        >
                          <td className="mono small">{l.timestamp}</td>
                          <td>{l.host}</td>
                          <td className="mono small">{l.method}</td>
                          <td>
                            {l.outcome === 'blocked' ? (
                              <ProtoStatus kind="bad" text="已拦截" />
                            ) : l.outcome === 'pending_approval' ? (
                              <ProtoStatus kind="warn" text="待审批" />
                            ) : (
                              <ProtoStatus kind="ok" text="成功" />
                            )}
                          </td>
                          <td className="num mono">{l.latencyMs}ms</td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </section>
          </div>
        </div>
      ) : (
        /* Feasibility Report (1:1 prototype default) + Extended Engineering Docs & Mermaid */
        <div className="report">
          <nav className="toc" aria-label="报告目录">
            {activeDocSlug === 'summary' ? (
              REPORT_SECTIONS.map(([id, label]) => (
                <button
                  key={id}
                  type="button"
                  className="side-link"
                  onClick={() => jumpToReportAnchor(id)}
                >
                  {label}
                </button>
              ))
            ) : (
              <button
                type="button"
                className="side-link"
                onClick={() => setActiveDocSlug('summary')}
              >
                ← 返回报告摘要
              </button>
            )}

            {docList.length > 0 && (
              <div
                className="side-sec"
                style={{
                  marginTop: '16px',
                  paddingTop: '12px',
                  borderTop: '1px solid var(--line-row)',
                }}
              >
                <div className="side-h">完整工程文档与架构图</div>
                {docList.map((d) => (
                  <button
                    key={d.slug}
                    type="button"
                    className="side-link"
                    aria-current={activeDocSlug === d.slug ? 'true' : undefined}
                    onClick={() => setActiveDocSlug(d.slug)}
                  >
                    <span className="od-truncate">{d.shortTitle}</span>
                  </button>
                ))}
              </div>
            )}
          </nav>

          {activeDocSlug === 'summary' ? (
            <article className="prose" id="x-main">
              <h2 id="r1">结论：高度可行（A+）</h2>
              <p>
                只要在本机运行一个常驻网关，对外暴露唯一的 MCP 入口，Antigravity、Claude Code、Codex
                CLI、OpenCode 四个工具都不需要改源码，加一行配置就能用上所有外部工具、Skill、知识库和共享记忆，并通过
                GitHub 在多台电脑间同步。
              </p>

              <h2 id="r2">借鉴的 7 个开源项目</h2>
              <ul>
                <li>
                  <b>toolport</b>：按需加载省 Token、指纹锁与隔离区、本地密钥库
                </li>
                <li>
                  <b>1mcp</b>：发现 → 检查 → 调用的三段式流程
                </li>
                <li>
                  <b>Skills-ContextManager / skills-manager</b>：双层 Skill，告别软链接
                </li>
                <li>
                  <b>MCPHub</b>：用向量语义推荐工具
                </li>
                <li>
                  <b>MetaMCP</b>：可插拔的中间件流水线
                </li>
                <li>
                  <b>pluggedin-mcp-proxy</b>：带出处的知识库与跨工具记忆
                </li>
                <li>
                  <b>mcpproxy / mcpo</b>：危险操作 HITL 审批
                </li>
              </ul>

              <h2 id="r3">四个 Agent 都能接入</h2>
              <p>
                Antigravity、Claude Code、OpenCode 原生支持工具列表实时刷新，评级 A+。Codex CLI
                通过三段式元工具兜底，评级 A。
              </p>

              <h2 id="r4">四个难点与解法</h2>
              <h3>1. 进程太多、数据库写锁冲突</h3>
              <p>全局只跑一个守护进程，各工具通过轻量转发器共享连接池。</p>
              <h3>2. 工具太多导致 Token 爆炸</h3>
              <p>默认只暴露常驻工具和 5 个元工具（约 1,580 Token），其余按需加载。</p>
              <h3>3. 第三方工具被静默篡改</h3>
              <p>用 SHA-256 指纹锁比对，发现变化立即隔离，返回内容自动脱敏。</p>
              <h3>4. 同步时泄露密钥、索引文件过大</h3>
              <p>GitHub 只存配置和原文，密钥用 vault:// 引用，向量索引在本机重建。</p>
            </article>
          ) : (
            <article className="min-w-0" id="x-main">
              {docLoading ? (
                <div className="box">
                  <div className="box-b">
                    <span className="muted">正在加载文档与 Mermaid 架构图…</span>
                  </div>
                </div>
              ) : docDetail ? (
                <MarkdownViewer
                  markdown={docDetail.content}
                  theme="light"
                  onExpandDiagram={setLightboxDiagram}
                />
              ) : null}
            </article>
          )}
        </div>
      )}

      <DiagramLightbox diagram={lightboxDiagram} onClose={() => setLightboxDiagram(null)} />
    </>
  );
}
