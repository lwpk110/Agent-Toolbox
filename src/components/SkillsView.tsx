import { useEffect, useState, type CSSProperties } from 'react';
import type { GatewayStateSnapshot } from '../types/toolbox';
import { ProtoIcon } from './ProtoIcon';
import { ProtoSeg, ProtoStatus, ProtoTip } from './ProtoPrimitives';
import { ModalDialog } from './ModalDialog';

interface SkillsViewProps {
  state: GatewayStateSnapshot;
  onMountSkill: (skillId: string, tokens?: number) => Promise<void>;
  onUnmountSkill: (skillId: string, tokens?: number) => Promise<void>;
  onSaveMarkdown: (skillId: string, markdown: string) => Promise<void>;
  onCreateSkill: (payload: {
    id: string;
    version: string;
    summary: string;
    skillMarkdown: string;
    toolName?: string;
  }) => Promise<void>;
}

export function SkillsView({
  state,
  onMountSkill,
  onUnmountSkill,
  onSaveMarkdown,
  onCreateSkill,
}: SkillsViewProps) {
  const [filter, setFilter] = useState<'all' | 'on' | 'off'>('all');
  const [selectedId, setSelectedId] = useState<string>(state.skills[0]?.id || '');
  const [layer, setLayer] = useState<'md' | 'tools'>('md');
  const [editing, setEditing] = useState(false);
  const [draftMd, setDraftMd] = useState('');
  const [saving, setSaving] = useState(false);
  const [infoTip, setInfoTip] = useState<{ title: string; body: string } | null>(null);

  // Import Skill dialog state
  const [importOpen, setImportOpen] = useState(false);
  const [newId, setNewId] = useState('');
  const [newVer, setNewVer] = useState('1.0.0');
  const [newSummary, setNewSummary] = useState('');
  const [newTool, setNewTool] = useState('');
  const [newMd, setNewMd] = useState(
    '---\nname: custom-skill\ntrigger: "当需要执行专项自动化流程时加载"\n---\n# 标准作业规程 (SOP)\n1. 检查上下文依赖\n2. 调用附带工具完成变更并验证结果'
  );
  const [importErr, setImportErr] = useState('');

  const mountedCount = state.skills.filter((s) => s.mounted).length;
  const list = state.skills.filter((s) =>
    filter === 'all' ? true : filter === 'on' ? s.mounted : !s.mounted
  );

  const selectedSkill = state.skills.find((s) => s.id === selectedId) || state.skills[0];

  useEffect(() => {
    if (selectedSkill) {
      setDraftMd(selectedSkill.skillMarkdown);
      setEditing(false);
    }
  }, [selectedSkill?.id]);

  const handleSaveMd = async () => {
    if (!selectedSkill || !draftMd.trim()) return;
    setSaving(true);
    try {
      await onSaveMarkdown(selectedSkill.id, draftMd);
      setEditing(false);
    } finally {
      setSaving(false);
    }
  };

  const handleCreate = async () => {
    if (!newId.trim() || !newSummary.trim() || !newMd.trim()) {
      setImportErr('请完整填写 Skill 名称、用途简介与 SKILL.md 内容。');
      return;
    }
    setImportErr('');
    setSaving(true);
    try {
      const targetId = newId.trim().toLowerCase();
      await onCreateSkill({
        id: targetId,
        version: newVer || '1.0.0',
        summary: newSummary,
        skillMarkdown: newMd,
        toolName: newTool || undefined,
      });
      setSelectedId(targetId);
      setImportOpen(false);
      setNewId('');
      setNewSummary('');
      setNewTool('');
    } catch (err) {
      setImportErr(err instanceof Error ? err.message : '导入失败');
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <div className="page-h">
        <div className="od-fill">
          <h1 tabIndex={-1} id="pageTitle">
            Skill 中心
          </h1>
          <p className="lead">
            Skill 是给 Agent 的&quot;专项能力包&quot;。需要时挂载，用完卸载，不用的 Skill 不占 Token。
          </p>
        </div>
        <div className="acts">
          <button
            type="button"
            className="btn"
            onClick={() => {
              setImportErr('');
              setImportOpen(true);
            }}
          >
            <ProtoIcon name="plus" />
            <span>导入 Skill</span>
          </button>
        </div>
      </div>

      <div className="grid-side">
        {/* Left Skill list */}
        <section className="box" id="s-list">
          <div className="box-h">
            <h2>已安装的 Skill</h2>
            <span className="hint">共 {state.skills.length} 个</span>
          </div>
          <div className="filter">
            <ProtoSeg
              label="筛选 Skill"
              items={
                [
                  ['all', '全部'],
                  ['on', `使用中 ${mountedCount}`],
                  ['off', `待命 ${state.skills.length - mountedCount}`],
                ] as const
              }
              value={filter}
              onChange={setFilter}
            />
          </div>
          {list.length === 0 ? (
            <div className="empty">
              <ProtoIcon name="inbox" />
              <b>这个分类下没有 Skill</b>
              <span>切换到「全部」查看所有 Skill。</span>
            </div>
          ) : (
            list.map((s) => (
              <button
                key={s.id}
                type="button"
                className="skill-item"
                aria-current={selectedSkill?.id === s.id ? 'true' : undefined}
                onClick={() => {
                  setSelectedId(s.id);
                  setLayer('md');
                }}
              >
                <span className="nm">{s.id}</span>
                <span className="ds">{s.summary}</span>
                {s.mounted ? (
                  <ProtoStatus
                    kind="ok"
                    text={`使用中 · 占 ${s.estimatedTokens.toLocaleString('en-US')} Token`}
                  />
                ) : (
                  <ProtoStatus kind="off" text="待命 · 不占 Token" />
                )}
              </button>
            ))
          )}
        </section>

        {/* Right Skill Detail */}
        {selectedSkill && (
          <section className="box" id="s-detail">
            <div className="box-h">
              <h2 className="mono">{selectedSkill.id}</h2>
              <span className="hint">v{selectedSkill.version}</span>
            </div>

            <div className="box-b od-stack" style={{ '--od-gap': '16px' } as CSSProperties}>
              <div
                className="od-row"
                style={{ '--od-gap': '16px', flexWrap: 'wrap' } as CSSProperties}
              >
                <div className="od-fill">
                  <p style={{ fontSize: '16px' }}>{selectedSkill.summary}</p>
                  <div className="small muted" style={{ marginTop: '4px' }}>
                    {selectedSkill.mounted
                      ? `由 ${selectedSkill.mountedBy || 'Claude Code'} 挂载 · 已调用 ${selectedSkill.callCount} 次 · 成功率 ${selectedSkill.successRate}`
                      : '目前没有任何 Agent 在使用它'}
                  </div>
                </div>
                {selectedSkill.mounted ? (
                  <ProtoStatus kind="ok" text="使用中" />
                ) : (
                  <ProtoStatus kind="off" text="待命" />
                )}
              </div>

              <div className="od-grid" style={{ '--od-cols': 3 } as CSSProperties}>
                <div className="stat" style={{ cursor: 'default' }}>
                  <span className="lbl">挂载后占用</span>
                  <span className="num">
                    {selectedSkill.estimatedTokens.toLocaleString('en-US')}
                  </span>
                  <span className="sub">Token / 轮</span>
                </div>
                <div className="stat" style={{ cursor: 'default' }}>
                  <span className="lbl">附带工具</span>
                  <span className="num">{selectedSkill.attachedTools.length} 个</span>
                  <span className="sub">挂载后才可调用</span>
                </div>
                <div className="stat" style={{ cursor: 'default' }}>
                  <span className="lbl">完整性</span>
                  <span className="num" style={{ fontSize: '20px' }}>
                    <ProtoStatus kind="ok" text="已校验" />
                  </span>
                  <span className="sub mono">sha256:{selectedSkill.fingerprint}</span>
                </div>
              </div>

              <div className="od-stack" style={{ '--od-gap': '8px' } as CSSProperties}>
                <div className="od-row">
                  <ProtoSeg
                    label="查看内容"
                    items={
                      [
                        ['md', 'SKILL.md'],
                        ['tools', `附带工具 ${selectedSkill.attachedTools.length}`],
                      ] as const
                    }
                    value={layer}
                    onChange={setLayer}
                  />
                  <ProtoTip
                    label="双层 Skill"
                    text="每个 Skill 分两层：一层是给 AI 的文字说明，一层是可执行的工具。挂载时两层一起加载，卸载时一起释放。"
                    onOpen={setInfoTip}
                  />
                  <span className="od-fill" />
                  {layer === 'md' && (
                    <button
                      type="button"
                      className="btn sm"
                      onClick={() => {
                        if (editing) {
                          setDraftMd(selectedSkill.skillMarkdown);
                          setEditing(false);
                        } else {
                          setEditing(true);
                        }
                      }}
                    >
                      <span>{editing ? '取消编辑' : '编辑'}</span>
                    </button>
                  )}
                </div>

                {layer === 'md' ? (
                  editing ? (
                    <div className="od-stack" style={{ '--od-gap': '8px' } as CSSProperties}>
                      <textarea
                        rows={9}
                        className="input mono"
                        value={draftMd}
                        onChange={(e) => setDraftMd(e.target.value)}
                      />
                      <div className="od-row" style={{ justifyContent: 'flex-end' }}>
                        <button
                          type="button"
                          className="btn pri sm"
                          disabled={saving}
                          onClick={handleSaveMd}
                        >
                          <span>{saving ? '保存中…' : '保存 SKILL.md'}</span>
                        </button>
                      </div>
                    </div>
                  ) : (
                    <>
                      <p className="muted small">
                        这一层是写给 AI 看的&quot;操作手册&quot;，告诉它什么时候用、按什么步骤做。
                      </p>
                      <pre className="code">{selectedSkill.skillMarkdown}</pre>
                    </>
                  )
                ) : (
                  <>
                    <p className="muted small">
                      这一层是 Skill 附带的工具，挂载后 AI 才能真正执行。
                    </p>
                    <table
                      className="tbl"
                      style={{ border: '1px solid var(--line)', borderRadius: '6px' }}
                    >
                      <thead>
                        <tr>
                          <th>工具名</th>
                          <th className="num">Token</th>
                        </tr>
                      </thead>
                      <tbody>
                        {selectedSkill.attachedTools.map((t) => (
                          <tr key={t.name}>
                            <td className="mono small">{t.name}</td>
                            <td className="num mono">{t.estimatedTokens}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </>
                )}
              </div>
            </div>

            <div className="box-f">
              {selectedSkill.mounted ? (
                <button
                  type="button"
                  className="btn"
                  onClick={() => onUnmountSkill(selectedSkill.id, selectedSkill.estimatedTokens)}
                >
                  <span>
                    卸载（释放 {selectedSkill.estimatedTokens.toLocaleString('en-US')} Token）
                  </span>
                </button>
              ) : (
                <button
                  type="button"
                  className="btn pri"
                  onClick={() => onMountSkill(selectedSkill.id, selectedSkill.estimatedTokens)}
                >
                  <span>挂载到唯一 MCP 入口</span>
                </button>
              )}
            </div>
          </section>
        )}
      </div>

      {/* Real Production Modal: Import Skill */}
      <ModalDialog
        open={importOpen}
        title="导入 Skill"
        confirmLabel="导入并计算指纹"
        busy={saving}
        onClose={() => setImportOpen(false)}
        onConfirm={handleCreate}
      >
        <div className="grid-2" style={{ gap: '12px' }}>
          <div className="field">
            <label htmlFor="skId">
              Skill 标识 <span style={{ color: 'var(--bad)' }}>*</span>
            </label>
            <input
              id="skId"
              data-autofocus="true"
              className="input mono"
              value={newId}
              onChange={(e) => setNewId(e.target.value)}
              placeholder="如 k8s-pod-debugger"
            />
          </div>
          <div className="field">
            <label htmlFor="skVer">版本</label>
            <input
              id="skVer"
              className="input mono"
              value={newVer}
              onChange={(e) => setNewVer(e.target.value)}
            />
          </div>
        </div>
        <div className="field">
          <label htmlFor="skSummary">
            用途简介 <span style={{ color: 'var(--bad)' }}>*</span>
          </label>
          <input
            id="skSummary"
            className="input"
            value={newSummary}
            onChange={(e) => setNewSummary(e.target.value)}
            placeholder="排查 Kubernetes Pod 崩溃与镜像拉取异常"
          />
        </div>
        <div className="field">
          <label htmlFor="skTool">附带工具名（可选）</label>
          <input
            id="skTool"
            className="input mono"
            value={newTool}
            onChange={(e) => setNewTool(e.target.value)}
            placeholder="如 skill_k8s__inspect_pod"
          />
        </div>
        <div className="field">
          <label htmlFor="skMd">
            SKILL.md 内容 <span style={{ color: 'var(--bad)' }}>*</span>
          </label>
          <textarea
            id="skMd"
            rows={5}
            className="input mono"
            value={newMd}
            onChange={(e) => setNewMd(e.target.value)}
          />
        </div>
        {importErr && <span className="err">{importErr}</span>}
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
