import { useEffect, useMemo, useState, type ChangeEvent, type CSSProperties } from 'react';
import type {
  GatewayStateSnapshot,
  KnowledgeDoc,
  SharedMemory,
  TrinitySearchResult,
} from '../types/toolbox';
import { api } from '../lib/api';
import { ProtoIcon } from './ProtoIcon';
import { ProtoSeg, ProtoStatus, ProtoTip } from './ProtoPrimitives';
import { ModalDialog } from './ModalDialog';

const QUICK_QUERIES = [
  '如何处理网关握手超时与连接池重连',
  'SSH 私钥提示词投毒防御',
  '数据库迁移锁表与索引规范',
  'GitHub 同步密钥防泄漏',
];

interface KnowledgeViewProps {
  state: GatewayStateSnapshot;
  onMountSkill: (skillId: string, tokens?: number) => Promise<void>;
  onAddDoc: (filePath: string, content: string) => Promise<void>;
  onBatchAddDocs: (docs: Array<{ filePath: string; content: string }>) => Promise<void>;
  onImportWorkspaceDocs: () => Promise<void>;
  onUpdateDoc: (docId: string, content: string) => Promise<void>;
  onDeleteDoc: (docId: string, filePath: string) => Promise<void>;
  onAddMemory: (
    host: string,
    topic: string,
    content: string,
    scope: 'global' | 'project'
  ) => Promise<void>;
  onUpdateMemory: (
    id: string,
    patch: { topic?: string; content?: string; scope?: 'global' | 'project' }
  ) => Promise<void>;
  onDeleteMemory: (id: string) => Promise<void>;
  onRebuildIndex: () => Promise<void>;
}

export function KnowledgeView({
  state,
  onMountSkill,
  onAddDoc,
  onBatchAddDocs,
  onImportWorkspaceDocs,
  onUpdateDoc,
  onDeleteDoc,
  onAddMemory,
  onUpdateMemory,
  onDeleteMemory,
  onRebuildIndex,
}: KnowledgeViewProps) {
  const [query, setQuery] = useState('如何处理网关握手超时与连接池重连');
  const [searched, setSearched] = useState(true);
  const [searchResult, setSearchResult] = useState<TrinitySearchResult | null>(null);
  const [searching, setSearching] = useState(false);
  const [poolTab, setPoolTab] = useState<'memory' | 'docs'>('memory');
  const [memHostFilter, setMemHostFilter] = useState<string>('all');
  const [rebuilding, setRebuilding] = useState(false);
  const [infoTip, setInfoTip] = useState<{ title: string; body: string } | null>(null);

  // Add Document Modal (3-mode: upload | workspace | manual)
  const [addDocOpen, setAddDocOpen] = useState(false);
  const [addDocMode, setAddDocMode] = useState<'upload' | 'workspace' | 'manual'>('upload');
  const [uploadedFiles, setUploadedFiles] = useState<Array<{ filePath: string; content: string }>>(
    []
  );
  const [docPath, setDocPath] = useState('docs/runbook-retry.md');
  const [docBody, setDocBody] = useState('');

  // Document Inspector / Editor Modal
  const [inspectDocId, setInspectDocId] = useState<string | null>(null);
  const [inspectTab, setInspectTab] = useState<'chunks' | 'edit'>('chunks');
  const [editDocBody, setEditDocBody] = useState('');
  const [delDocTarget, setDelDocTarget] = useState<KnowledgeDoc | null>(null);

  // Memory Modals
  const [delMemTarget, setDelMemTarget] = useState<SharedMemory | null>(null);
  const [addMemOpen, setAddMemOpen] = useState(false);
  const [editMemTarget, setEditMemTarget] = useState<SharedMemory | null>(null);
  const [memHost, setMemHost] = useState('Claude Code');
  const [memTopic, setMemTopic] = useState('');
  const [memContent, setMemContent] = useState('');
  const [memScope, setMemScope] = useState<'global' | 'project'>('global');

  const [formErr, setFormErr] = useState('');
  const [busy, setBusy] = useState(false);

  const inspectDoc = useMemo(
    () => state.docs.find((d) => d.id === inspectDocId) || null,
    [state.docs, inspectDocId]
  );

  const filteredMemories = useMemo(() => {
    if (memHostFilter === 'all') return state.memories;
    return state.memories.filter((m) => m.host === memHostFilter);
  }, [state.memories, memHostFilter]);

  const memoryHosts = useMemo(() => {
    const set = new Set(state.memories.map((m) => m.host));
    return Array.from(set);
  }, [state.memories]);

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

  const handleLocalFileChange = async (e: ChangeEvent<HTMLInputElement>) => {
    const fileList = e.target.files;
    if (!fileList || fileList.length === 0) return;
    setFormErr('');
    const parsed: Array<{ filePath: string; content: string }> = [];
    for (const file of Array.from(fileList).slice(0, 20)) {
      if (!/\.(md|markdown|txt)$/i.test(file.name)) continue;
      if (file.size > 200 * 1024) continue;
      const text = await file.text();
      if (!text.trim()) continue;
      const rel = (file.webkitRelativePath || file.name).replace(/^\/+/, '');
      parsed.push({ filePath: rel, content: text });
    }
    if (parsed.length === 0) {
      setFormErr('未读取到有效的 .md / .txt 文档（单文件上限 200KB）。');
      return;
    }
    setUploadedFiles(parsed);
  };

  const handleAddDocConfirm = async () => {
    setFormErr('');
    setBusy(true);
    try {
      if (addDocMode === 'upload') {
        if (uploadedFiles.length === 0) {
          setFormErr('请先选择一个或多个本地 .md / .txt 文件。');
          return;
        }
        await onBatchAddDocs(uploadedFiles);
        setUploadedFiles([]);
        setAddDocOpen(false);
        setPoolTab('docs');
      } else if (addDocMode === 'workspace') {
        await onImportWorkspaceDocs();
        setAddDocOpen(false);
        setPoolTab('docs');
      } else {
        if (!docPath.trim() || !docBody.trim()) {
          setFormErr('请填写文档路径和正文内容。');
          return;
        }
        await onAddDoc(docPath, docBody);
        setAddDocOpen(false);
        setDocBody('');
        setPoolTab('docs');
      }
    } catch (err) {
      setFormErr(err instanceof Error ? err.message : '入库失败');
    } finally {
      setBusy(false);
    }
  };

  const openDocInspector = (doc: KnowledgeDoc) => {
    setInspectDocId(doc.id);
    setEditDocBody(doc.content);
    setInspectTab('chunks');
    setFormErr('');
  };

  const openEditMemory = (m: SharedMemory) => {
    setEditMemTarget(m);
    setMemTopic(m.topic);
    setMemContent(m.content);
    setMemScope(m.scope || 'global');
    setFormErr('');
  };

  return (
    <>
      <div className="page-h">
        <div className="od-fill">
          <h1 tabIndex={-1} id="pageTitle">
            知识库 RAG
          </h1>
          <p className="lead">
            支持本地文件上传与工作区 docs/ 一键入库，按标题语义切片索引，并与跨 Agent 共享 Memory
            和 Skill 路由统一检索。
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
            className="btn pri"
            onClick={() => {
              setFormErr('');
              setAddDocMode('upload');
              setUploadedFiles([]);
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
          <span className="lbl">已收录切片</span>
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
                text="一次输入，同时在三个地方找：你上传的文档切片、各个 Agent 记下的经验、以及适合处理这个问题的 Skill。"
                onOpen={setInfoTip}
              />
            </h2>
            {searchResult && searchResult.query && (
              <span className="hint">{searchResult.latencyMs}ms</span>
            )}
          </div>

          <div className="box-b">
            <div className="od-stack" style={{ '--od-gap': '14px' } as CSSProperties}>
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

              <div className="od-cluster" style={{ '--od-gap': '6px' } as CSSProperties}>
                <span className="small muted">快捷示例：</span>
                {QUICK_QUERIES.map((q) => (
                  <button
                    key={q}
                    type="button"
                    className="chip-btn"
                    onClick={() => {
                      setQuery(q);
                      runSearch(q);
                    }}
                  >
                    {q}
                  </button>
                ))}
              </div>

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
                  <span>点击上方快捷示例或输入任意工程问题。</span>
                </div>
              ) : searchResult ? (
                <div className="od-stack" style={{ '--od-gap': '16px' } as CSSProperties}>
                  <div className="res-group">
                    <h3>
                      RAG 文档命中<span className="en">RAG</span>
                      <span className="count">{searchResult.docs.length} 条</span>
                    </h3>
                    {searchResult.docs.length === 0 ? (
                      <p className="muted small">没有找到相关文档切片。</p>
                    ) : (
                      searchResult.docs.map((d, i) => (
                        <div key={`${d.filePath}-${i}`} className="res">
                          {d.heading && (
                            <div className="small" style={{ fontWeight: 600 }}>
                              {d.heading}
                            </div>
                          )}
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
                      <p className="muted small">没有找到相关共享记忆。</p>
                    ) : (
                      searchResult.memories.map((m) => (
                        <div key={m.id} className="res">
                          <span>{m.content}</span>
                          <span className="meta">
                            由 {m.host} 记录 · {m.topic} · {m.scope === 'project' ? '当前项目' : '全局'}
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
                      <p className="muted small">没有找到匹配的 Skill 推荐。</p>
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
            <span className="hint">
              {poolTab === 'memory'
                ? '一个 AI 记下的经验，其他 AI 也能用'
                : '点击任意文档查看正文或 Markdown 切片'}
            </span>
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
              {poolTab === 'memory' && memoryHosts.length > 1 && (
                <select
                  aria-label="按宿主筛选 Memory"
                  className="input"
                  style={{ width: 'auto', height: '28px', fontSize: '12px', padding: '0 8px' }}
                  value={memHostFilter}
                  onChange={(e) => setMemHostFilter(e.target.value)}
                >
                  <option value="all">全部宿主</option>
                  {memoryHosts.map((h) => (
                    <option key={h} value={h}>
                      {h}
                    </option>
                  ))}
                </select>
              )}
              <span className="od-fill" />
              {poolTab === 'memory' && (
                <button
                  type="button"
                  className="btn sm"
                  onClick={() => {
                    setFormErr('');
                    setMemTopic('');
                    setMemContent('');
                    setMemScope('global');
                    setAddMemOpen(true);
                  }}
                >
                  <ProtoIcon name="plus" />
                  <span>记录</span>
                </button>
              )}
            </div>

            {poolTab === 'memory' ? (
              filteredMemories.length === 0 ? (
                <div className="empty">
                  <ProtoIcon name="inbox" />
                  <b>还没有匹配的 Memory</b>
                  <span>Agent 在对话中记下的经验会出现在这里。</span>
                </div>
              ) : (
                filteredMemories.map((m) => (
                  <div key={m.id} className="list-row">
                    <div className="od-fill">
                      <div>{m.content}</div>
                      <div
                        className="od-row small muted"
                        style={{ '--od-gap': '6px', marginTop: '4px', flexWrap: 'wrap' } as CSSProperties}
                      >
                        <span>
                          {m.host} · {m.topic}
                        </span>
                        <span className={`tag${m.scope === 'project' ? ' info' : ''}`}>
                          {m.scope === 'project' ? '项目级' : '全局共享'}
                        </span>
                      </div>
                    </div>
                    <div className="od-row" style={{ '--od-gap': '6px' } as CSSProperties}>
                      <button
                        type="button"
                        className="btn sm"
                        onClick={() => openEditMemory(m)}
                      >
                        <span>编辑</span>
                      </button>
                      <button
                        type="button"
                        className="btn sm danger"
                        onClick={() => setDelMemTarget(m)}
                      >
                        <span>删除</span>
                      </button>
                    </div>
                  </div>
                ))
              )
            ) : state.docs.length === 0 ? (
              <div className="empty">
                <ProtoIcon name="inbox" />
                <b>还没有收录文档</b>
                <span>点击右上角「添加文档」上传本地文件或一键收录工作区 docs/。</span>
              </div>
            ) : (
              state.docs.map((d) => (
                <div
                  key={d.id}
                  className="list-row clickable"
                  onClick={() => openDocInspector(d)}
                  role="button"
                  tabIndex={0}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      openDocInspector(d);
                    }
                  }}
                >
                  <div className="od-fill">
                    <div className="od-row" style={{ '--od-gap': '6px', flexWrap: 'wrap' } as CSSProperties}>
                      <span className="mono small" style={{ fontWeight: 600 }}>
                        {d.filePath}
                      </span>
                      {d.sourceType && (
                        <span className="tag">
                          {d.sourceType === 'workspace'
                            ? '工作区'
                            : d.sourceType === 'upload'
                            ? '本地上传'
                            : d.sourceType === 'builtin'
                            ? '内置'
                            : '手动录入'}
                        </span>
                      )}
                    </div>
                    <div className="small muted od-truncate" style={{ marginTop: '2px' }}>
                      {d.contentPreview}
                    </div>
                  </div>
                  <span className="muted small od-nowrap mono">{d.chunkCount} 段</span>
                </div>
              ))
            )}
          </div>
        </section>
      </div>

      {/* Add Document Modal (3-mode: upload | workspace | manual) */}
      <ModalDialog
        open={addDocOpen}
        title="添加知识库文档"
        confirmLabel={
          addDocMode === 'workspace'
            ? '一键收录工作区 docs/'
            : addDocMode === 'upload'
            ? `上传并切片 (${uploadedFiles.length})`
            : '收录并分块'
        }
        wide
        busy={busy}
        onClose={() => setAddDocOpen(false)}
        onConfirm={handleAddDocConfirm}
      >
        <ProtoSeg
          label="导入方式"
          items={
            [
              ['upload', '上传本地文件'],
              ['workspace', '收录工作区 docs/'],
              ['manual', '手动录入'],
            ] as const
          }
          value={addDocMode}
          onChange={(m) => {
            setAddDocMode(m);
            setFormErr('');
          }}
        />

        {addDocMode === 'upload' ? (
          <div className="drop-zone">
            <label htmlFor="kbFileUpload" style={{ fontWeight: 600 }}>
              选择本地 Markdown / 文本文档（支持多选）
            </label>
            <input
              id="kbFileUpload"
              type="file"
              accept=".md,.markdown,.txt"
              multiple
              onChange={handleLocalFileChange}
            />
            <span className="small muted">
              系统将按 Markdown 标题层级自动语义分块（单次最多 20 篇，每篇不超过 200KB）。
            </span>
            {uploadedFiles.length > 0 && (
              <div className="od-stack" style={{ '--od-gap': '4px', marginTop: '6px' } as CSSProperties}>
                <span className="small" style={{ fontWeight: 600 }}>
                  待入库文件（{uploadedFiles.length}）：
                </span>
                {uploadedFiles.map((f) => (
                  <div key={f.filePath} className="small mono muted">
                    • {f.filePath} ({f.content.length} 字符)
                  </div>
                ))}
              </div>
            )}
          </div>
        ) : addDocMode === 'workspace' ? (
          <div className="drop-zone">
            <b>一键收录本项目工作区 docs/ 目录</b>
            <p className="small muted">
              将自动读取服务端受控目录 <span className="mono">docs/*.md</span>
              （含 PRD、架构设计、ADR、安全与 GitOps 规范等），按标题切分为 RAG 向量段并立即可检。
            </p>
          </div>
        ) : (
          <>
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
                rows={7}
                className="input mono"
                style={{ fontSize: '12px' }}
                value={docBody}
                onChange={(e) => setDocBody(e.target.value)}
                placeholder={'# 标题\n\n## 章节一\n输入架构规范、排障手册或团队约定…'}
              />
            </div>
          </>
        )}
        {formErr && <span className="err">{formErr}</span>}
      </ModalDialog>

      {/* Document Inspector / Chunk Viewer / Editor Modal */}
      <ModalDialog
        open={Boolean(inspectDoc)}
        title={inspectDoc ? `文档详情：${inspectDoc.filePath}` : ''}
        confirmLabel={inspectTab === 'edit' ? '保存并重新切片' : '完成'}
        hideCancel={inspectTab === 'chunks'}
        wide
        busy={busy}
        onClose={() => setInspectDocId(null)}
        onConfirm={async () => {
          if (!inspectDoc) return;
          if (inspectTab === 'chunks') {
            setInspectDocId(null);
            return;
          }
          if (!editDocBody.trim()) {
            setFormErr('文档正文不能为空。');
            return;
          }
          setBusy(true);
          try {
            await onUpdateDoc(inspectDoc.id, editDocBody);
            setInspectTab('chunks');
          } catch (err) {
            setFormErr(err instanceof Error ? err.message : '保存失败');
          } finally {
            setBusy(false);
          }
        }}
      >
        {inspectDoc && (
          <>
            <div className="od-row" style={{ justifyContent: 'space-between', flexWrap: 'wrap' }}>
              <ProtoSeg
                label="查看模式"
                items={
                  [
                    ['chunks', `切片明细 (${inspectDoc.chunks.length} 段)`],
                    ['edit', '编辑原文'],
                  ] as const
                }
                value={inspectTab}
                onChange={setInspectTab}
              />
              <button
                type="button"
                className="btn sm danger"
                onClick={() => setDelDocTarget(inspectDoc)}
              >
                <span>删除文档</span>
              </button>
            </div>

            {inspectTab === 'chunks' ? (
              <div
                className="od-stack"
                style={{ '--od-gap': '10px', maxHeight: '380px', overflowY: 'auto' } as CSSProperties}
              >
                {inspectDoc.chunks.map((c, idx) => (
                  <div key={c.id} className="res" style={{ padding: '10px 12px' }}>
                    <div className="od-row" style={{ justifyContent: 'space-between' }}>
                      <span className="small" style={{ fontWeight: 600 }}>
                        #{idx + 1} · {c.heading}
                      </span>
                      <span className="tag mono">~{c.tokens} tok</span>
                    </div>
                    <div className="small muted" style={{ whiteSpace: 'pre-wrap' }}>
                      {c.content}
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="field">
                <label htmlFor="editDocTextarea">Markdown 正文</label>
                <textarea
                  id="editDocTextarea"
                  rows={12}
                  className="input mono"
                  style={{ fontSize: '12px' }}
                  value={editDocBody}
                  onChange={(e) => setEditDocBody(e.target.value)}
                />
              </div>
            )}
            {formErr && <span className="err">{formErr}</span>}
          </>
        )}
      </ModalDialog>

      {/* Delete Document Confirm */}
      <ModalDialog
        open={Boolean(delDocTarget)}
        title={`删除文档「${delDocTarget?.filePath || ''}」？`}
        confirmLabel="删除"
        danger
        onClose={() => setDelDocTarget(null)}
        onConfirm={async () => {
          if (!delDocTarget) return;
          const target = delDocTarget;
          await onDeleteDoc(target.id, target.filePath);
          setDelDocTarget(null);
          if (inspectDocId === target.id) setInspectDocId(null);
        }}
      >
        <p>删除后，该文档的 {delDocTarget?.chunkCount || 0} 个切片将立即从统一检索中移除。</p>
      </ModalDialog>

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
            await onAddMemory(memHost, memTopic || '工程规范', memContent, memScope);
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
            <label htmlFor="memScope">生效范围</label>
            <select
              id="memScope"
              className="input"
              value={memScope}
              onChange={(e) => setMemScope(e.target.value as 'global' | 'project')}
            >
              <option value="global">全局共享（所有项目）</option>
              <option value="project">项目级（当前工作区）</option>
            </select>
          </div>
        </div>
        <div className="field">
          <label htmlFor="memTopic">主题</label>
          <input
            id="memTopic"
            className="input"
            value={memTopic}
            onChange={(e) => setMemTopic(e.target.value)}
            placeholder="如 接口规范 / 数据库排障"
          />
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

      {/* Edit Shared Memory Modal */}
      <ModalDialog
        open={Boolean(editMemTarget)}
        title="编辑共享 Memory"
        confirmLabel="保存修改"
        busy={busy}
        onClose={() => setEditMemTarget(null)}
        onConfirm={async () => {
          if (!editMemTarget) return;
          if (!memContent.trim()) {
            setFormErr('经验内容不能为空。');
            return;
          }
          setFormErr('');
          setBusy(true);
          try {
            await onUpdateMemory(editMemTarget.id, {
              topic: memTopic.trim() || editMemTarget.topic,
              content: memContent.trim(),
              scope: memScope,
            });
            setEditMemTarget(null);
          } catch (err) {
            setFormErr(err instanceof Error ? err.message : '保存失败');
          } finally {
            setBusy(false);
          }
        }}
      >
        <div className="grid-2" style={{ gap: '12px' }}>
          <div className="field">
            <label htmlFor="editMemTopic">主题</label>
            <input
              id="editMemTopic"
              className="input"
              value={memTopic}
              onChange={(e) => setMemTopic(e.target.value)}
            />
          </div>
          <div className="field">
            <label htmlFor="editMemScope">生效范围</label>
            <select
              id="editMemScope"
              className="input"
              value={memScope}
              onChange={(e) => setMemScope(e.target.value as 'global' | 'project')}
            >
              <option value="global">全局共享</option>
              <option value="project">项目级</option>
            </select>
          </div>
        </div>
        <div className="field">
          <label htmlFor="editMemContent">经验内容</label>
          <textarea
            id="editMemContent"
            rows={3}
            className="input"
            value={memContent}
            onChange={(e) => setMemContent(e.target.value)}
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
