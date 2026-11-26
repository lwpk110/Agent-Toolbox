import { useEffect, useState, type CSSProperties } from 'react';
import type { GatewayStateSnapshot, SharedMemory, TrinitySearchResult } from '../types/toolbox';
import { api } from '../lib/api';
import { ProtoIcon } from './ProtoIcon';
import { ProtoSeg, ProtoStatus, ProtoTip } from './ProtoPrimitives';
import { ModalDialog } from './ModalDialog';

interface KnowledgeViewProps {
  state: GatewayStateSnapshot;
  onMountSkill: (skillId: string, tokens?: number) => Promise<void>;
  onAddDoc: (filePath: string, content: string) => Promise<void>;
  onAddMemory: (host: string, topic: string, content: string) => Promise<void>;
  onDeleteMemory: (id: string) => Promise<void>;
  onRebuildIndex: () => Promise<void>;
}

export function KnowledgeView({
  state,
  onMountSkill,
  onAddDoc,
  onAddMemory,
  onDeleteMemory,
  onRebuildIndex,
}: KnowledgeViewProps) {
  const [query, setQuery] = useState('如何处理网关握手超时与连接池重连');
  const [searched, setSearched] = useState(true);
  const [searchResult, setSearchResult] = useState<TrinitySearchResult | null>(null);
  const [searching, setSearching] = useState(false);
  const [poolTab, setPoolTab] = useState<'memory' | 'docs'>('memory');
  const [rebuilding, setRebuilding] = useState(false);
  const [infoTip, setInfoTip] = useState<{ title: string; body: string } | null>(null);

  const [delMemTarget, setDelMemTarget] = useState<SharedMemory | null>(null);
  const [addDocOpen, setAddDocOpen] = useState(false);
  const [addMemOpen, setAddMemOpen] = useState(false);

  const [docPath, setDocPath] = useState('docs/runbook-retry.md');
  const [docBody, setDocBody] = useState('');
  const [memHost, setMemHost] = useState('Claude Code');
  const [memTopic, setMemTopic] = useState('');
  const [memContent, setMemContent] = useState('');
  const [formErr, setFormErr] = useState('');
  const [busy, setBusy] = useState(false);

  const runSearch = async (q: string) => {
    setSearched(true);
    if (!q.trim()) {
      setSearchResult({ query: '', latencyMs: 0, docs: [], memories: [], routing: [] });
      return;
    }
    setSearching(true);
    try {
      const res = await api.searchKnowledge(q);
      setSearchResult(res);
    } finally {
      setSearching(false);
    }
  };

  useEffect(() => {
    if (searched) {
      runSearch(query);
    }
  }, [state.skills, state.docs.length, state.memories.length]);

  const handleRebuild = async () => {
    setRebuilding(true);
    try {
      await onRebuildIndex();
    } finally {
      setRebuilding(false);
    }
  };

  return (
    <>
      <div className="page-h">
        <div className="od-fill">
          <h1 tabIndex={-1} id="pageTitle">
            知识库 RAG
          </h1>
          <p className="lead">
            把团队文档和 AI 积累的经验放在一起，任何一个 Agent 提问时都能查到。
          </p>
        </div>
        <div className="acts">
          <button
            type="button"
            className="btn"
            disabled={rebuilding}
            onClick={handleRebuild}
          >
            <ProtoIcon name="sync" />
            <span>{rebuilding ? '重建中…' : '重建索引'}</span>
          </button>
          <button
            type="button"
            className="btn"
            onClick={() => {
              setFormErr('');
              setAddDocOpen(true);
            }}
          >
            <ProtoIcon name="plus" />
            <span>添加文档</span>
          </button>
        </div>
      </div>

      {/* 4 Health Stats */}
      <div className="stats od-grid" id="k-health" style={{ '--od-cols': 4 } as CSSProperties}>
        <div className="stat" style={{ cursor: 'default' }}>
          <span className="lbl">已收录内容</span>
          <span className="num">{state.vectorHealth.totalChunks.toLocaleString('en-US')} 段</span>
          <span className="sub">来自 {state.docs.length} 份文档</span>
        </div>
        <div className="stat" style={{ cursor: 'default' }}>
          <span className="lbl">找得准不准</span>
          <span className="num">{state.vectorHealth.recallRate}</span>
          <span className="sub ok">召回率 · 良好</span>
        </div>
        <div className="stat" style={{ cursor: 'default' }}>
          <span className="lbl">查找速度</span>
          <span className="num">{state.vectorHealth.p95LatencyMs}ms</span>
          <span className="sub">95% 的查询快于此</span>
        </div>
        <div className="stat" style={{ cursor: 'default' }}>
          <span className="lbl">数据健康</span>
          <span className="num" style={{ fontSize: '20px' }}>
            <ProtoStatus kind="ok" text="无异常" />
          </span>
          <span className="sub">
            {state.vectorHealth.orphanChunks} 个孤立段 · {state.vectorHealth.embeddingDim} 维一致
          </span>
        </div>
      </div>

      {/* Main 2-column grid */}
      <div className="grid-main">
        {/* Trinity Search */}
        <section className="box" id="k-search">
          <div className="box-h">
            <h2>
              统一检索
              <ProtoTip
                label="统一检索"
                text="一次输入，同时在三个地方找：你上传的文档、各个 Agent 记下的经验、以及适合处理这个问题的 Skill。"
                onOpen={setInfoTip}
              />
            </h2>
          </div>

          <div className="box-b">
            <div className="od-stack" style={{ '--od-gap': '16px' } as CSSProperties}>
              <form
                className="search"
                onSubmit={(e) => {
                  e.preventDefault();
                  runSearch(query);
                }}
              >
                <label className="sr-only" htmlFor="kbQ">
                  要查找的问题
                </label>
                <input
                  className="input"
                  id="kbQ"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="例如：如何处理网关握手超时"
                />
                <button type="submit" className="btn pri" disabled={searching}>
                  <ProtoIcon name="search" />
                  <span>{searching ? '检索中…' : '检索'}</span>
                </button>
              </form>

              {!searched ? (
                <div className="empty">
                  <ProtoIcon name="search" />
                  <b>输入一个问题试试</b>
                  <span>会同时从文档、Memory 和可用 Skill 里找答案。</span>
                </div>
              ) : searchResult && !searchResult.query ? (
                <div className="empty">
                  <ProtoIcon name="search" />
                  <b>请输入要查找的内容</b>
                  <span>例如：如何处理网关握手超时</span>
                </div>
              ) : searchResult ? (
                <div className="od-stack" style={{ '--od-gap': '16px' } as CSSProperties}>
                  <div className="res-group">
                    <h3>
                      RAG 文档命中<span className="en">RAG</span>
                      <span className="count">{searchResult.docs.length} 条</span>
                    </h3>
                    {searchResult.docs.length === 0 ? (
                      <p className="muted small">没有找到相关内容。</p>
                    ) : (
                      searchResult.docs.map((d, i) => (
                        <div key={`${d.filePath}-${i}`} className="res">
                          <span>{d.excerpt}</span>
                          <span className="meta">
                            来源 <span className="mono">{d.filePath}</span> · 相关度 {d.score} ·{' '}
                            {d.latencyMs}ms
                          </span>
                        </div>
                      ))
                    )}
                  </div>

                  <div className="res-group">
                    <h3>
                      跨 Agent 共享 Memory<span className="en">Memory</span>
                      <span className="count">{searchResult.memories.length} 条</span>
                    </h3>
                    {searchResult.memories.length === 0 ? (
                      <p className="muted small">没有找到相关内容。</p>
                    ) : (
                      searchResult.memories.map((m) => (
                        <div key={m.id} className="res">
                          <span>{m.content}</span>
                          <span className="meta">
                            由 {m.host} 记录 · {m.topic}
                          </span>
                        </div>
                      ))
                    )}
                  </div>

                  <div className="res-group">
                    <h3>
                      Smart Routing 推荐<span className="en">Routing</span>
                      <span className="count">{searchResult.routing.length} 条</span>
                    </h3>
                    {searchResult.routing.length === 0 ? (
                      <p className="muted small">没有找到相关内容。</p>
                    ) : (
                      searchResult.routing.map((r) => (
                        <div key={r.skillId} className="res">
                          <div className="od-row" style={{ '--od-gap': '12px' } as CSSProperties}>
                            <div className="od-fill">
                              <div className="mono small" style={{ fontWeight: 600 }}>
                                {r.skillId}
                              </div>
                              <div className="small muted">{r.summary}</div>
                            </div>
                            {r.mounted ? (
                              <ProtoStatus kind="ok" text="已在使用" />
                            ) : (
                              <button
                                type="button"
                                className="btn sm"
                                onClick={() => onMountSkill(r.skillId, r.estimatedTokens)}
                              >
                                <span>挂载</span>
                              </button>
                            )}
                          </div>
                        </div>
                      ))
                    )}
                  </div>
                </div>
              ) : null}
            </div>
          </div>
        </section>

        {/* Right Pool: Memories & Docs */}
        <section className="box" id="k-pool">
          <div className="box-h">
            <h2>知识库与 Memory</h2>
            {poolTab === 'memory' && (
              <span className="hint">一个 AI 记下的经验，其他 AI 也能用</span>
            )}
          </div>

          <div className="box-b flush">
            <div className="filter">
              <ProtoSeg
                label="切换内容"
                items={
                  [
                    ['memory', `Memory ${state.memories.length}`],
                    ['docs', `文档 ${state.docs.length}`],
                  ] as const
                }
                value={poolTab}
                onChange={setPoolTab}
              />
              <span className="od-fill" />
              {poolTab === 'memory' && (
                <button
                  type="button"
                  className="btn sm"
                  onClick={() => {
                    setFormErr('');
                    setAddMemOpen(true);
                  }}
                >
                  <ProtoIcon name="plus" />
                  <span>记录</span>
                </button>
              )}
            </div>

            {poolTab === 'memory' ? (
              state.memories.length === 0 ? (
                <div className="empty">
                  <ProtoIcon name="inbox" />
                  <b>还没有 Memory</b>
                  <span>Agent 在对话中记下的经验会出现在这里。</span>
                </div>
              ) : (
                state.memories.map((m) => (
                  <div key={m.id} className="list-row">
                    <div className="od-fill">
                      <div>{m.content}</div>
                      <div className="small muted">
                        {m.host} 记录 · {m.topic}
                      </div>
                    </div>
                    <button
                      type="button"
                      className="btn sm danger"
                      onClick={() => setDelMemTarget(m)}
                    >
                      <span>删除</span>
                    </button>
                  </div>
                ))
              )
            ) : (
              state.docs.map((d) => (
                <div key={d.id} className="list-row">
                  <span className="mono small od-fill">{d.filePath}</span>
                  <span className="muted small od-nowrap">{d.chunkCount} 段</span>
                </div>
              ))
            )}
          </div>
        </section>
      </div>

      {/* Delete Memory Confirm */}
      <ModalDialog
        open={Boolean(delMemTarget)}
        title="删除这条 Memory？"
        confirmLabel="删除"
        danger
        onClose={() => setDelMemTarget(null)}
        onConfirm={async () => {
          if (!delMemTarget) return;
          await onDeleteMemory(delMemTarget.id);
          setDelMemTarget(null);
        }}
      >
        <p>「{delMemTarget?.content}」</p>
        <p className="muted">删除后，所有 Agent 都不会再记得这条经验。</p>
      </ModalDialog>

      {/* Add Document Modal */}
      <ModalDialog
        open={addDocOpen}
        title="添加文档"
        confirmLabel="收录并分块"
        busy={busy}
        onClose={() => setAddDocOpen(false)}
        onConfirm={async () => {
          if (!docPath.trim() || !docBody.trim()) {
            setFormErr('请填写文档路径和正文内容。');
            return;
          }
          setFormErr('');
          setBusy(true);
          try {
            await onAddDoc(docPath, docBody);
            setAddDocOpen(false);
            setDocBody('');
          } catch (err) {
            setFormErr(err instanceof Error ? err.message : '入库失败');
          } finally {
            setBusy(false);
          }
        }}
      >
        <div className="field">
          <label htmlFor="docPath">
            文档路径 <span style={{ color: 'var(--bad)' }}>*</span>
          </label>
          <input
            id="docPath"
            data-autofocus="true"
            className="input mono"
            value={docPath}
            onChange={(e) => setDocPath(e.target.value)}
          />
        </div>
        <div className="field">
          <label htmlFor="docBody">
            Markdown 正文 <span style={{ color: 'var(--bad)' }}>*</span>
          </label>
          <textarea
            id="docBody"
            rows={5}
            className="input"
            value={docBody}
            onChange={(e) => setDocBody(e.target.value)}
            placeholder="输入架构规范、排障手册或团队约定…"
          />
        </div>
        {formErr && <span className="err">{formErr}</span>}
      </ModalDialog>

      {/* Add Shared Memory Modal */}
      <ModalDialog
        open={addMemOpen}
        title="记录共享 Memory"
        confirmLabel="写入共享池"
        busy={busy}
        onClose={() => setAddMemOpen(false)}
        onConfirm={async () => {
          if (!memContent.trim()) {
            setFormErr('请填写要沉淀的共享经验内容。');
            return;
          }
          setFormErr('');
          setBusy(true);
          try {
            await onAddMemory(memHost, memTopic || '工程规范', memContent);
            setAddMemOpen(false);
            setMemTopic('');
            setMemContent('');
          } catch (err) {
            setFormErr(err instanceof Error ? err.message : '写入失败');
          } finally {
            setBusy(false);
          }
        }}
      >
        <div className="grid-2" style={{ gap: '12px' }}>
          <div className="field">
            <label htmlFor="memHost">来源 Agent</label>
            <select
              id="memHost"
              className="input"
              value={memHost}
              onChange={(e) => setMemHost(e.target.value)}
            >
              {state.hosts.map((h) => (
                <option key={h.id} value={h.name}>
                  {h.name}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label htmlFor="memTopic">主题</label>
            <input
              id="memTopic"
              className="input"
              value={memTopic}
              onChange={(e) => setMemTopic(e.target.value)}
              placeholder="如 接口规范"
            />
          </div>
        </div>
        <div className="field">
          <label htmlFor="memContent">
            经验内容 <span style={{ color: 'var(--bad)' }}>*</span>
          </label>
          <textarea
            id="memContent"
            data-autofocus="true"
            rows={3}
            className="input"
            value={memContent}
            onChange={(e) => setMemContent(e.target.value)}
            placeholder="例如：所有破坏性数据库操作必须先执行 EXPLAIN 校验"
          />
        </div>
        {formErr && <span className="err">{formErr}</span>}
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
