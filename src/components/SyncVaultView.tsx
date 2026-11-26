import { useState, type CSSProperties } from 'react';
import type { GatewayStateSnapshot, VaultEntry } from '../types/toolbox';
import { ProtoIcon } from './ProtoIcon';
import { ProtoSeg, ProtoStatus, ProtoTip } from './ProtoPrimitives';
import { ModalDialog } from './ModalDialog';

interface SyncVaultViewProps {
  state: GatewayStateSnapshot;
  onSetVaultKey: (key: string, value: string, serviceName?: string) => Promise<void>;
  onDeleteVaultKey: (key: string) => Promise<void>;
  onUpdateSyncConfig: (repo: string, branch: string) => Promise<void>;
  onPull: () => Promise<void>;
  onPush: (commitMessage?: string) => Promise<void>;
  onToast: (msg: string) => void;
}

export function SyncVaultView({
  state,
  onSetVaultKey,
  onDeleteVaultKey,
  onUpdateSyncConfig,
  onPull,
  onPush,
  onToast,
}: SyncVaultViewProps) {
  const [gitTab, setGitTab] = useState<'manifest' | 'lock' | 'diff'>('manifest');
  const [commitMsg, setCommitMsg] = useState('chore(toolbox): sync mcp servers & skill lockfile');
  const [keyModal, setKeyModal] = useState<{
    prefillKey: string | null;
    defaultSvc?: string;
    isRotate?: boolean;
  } | null>(null);
  const [delKeyTarget, setDelKeyTarget] = useState<VaultEntry | null>(null);
  const [repoModalOpen, setRepoModalOpen] = useState(false);
  const [repoInput, setRepoInput] = useState(state.sync.repo);
  const [branchInput, setBranchInput] = useState(state.sync.branch);

  const [keyName, setKeyName] = useState('');
  const [keyVal, setKeyVal] = useState('');
  const [nameErr, setNameErr] = useState('');
  const [valErr, setValErr] = useState('');
  const [busy, setBusy] = useState(false);
  const [infoTip, setInfoTip] = useState<{ title: string; body: string } | null>(null);

  const openKeyDialog = (prefillKey: string | null, defaultSvc?: string, isRotate?: boolean) => {
    setKeyModal({ prefillKey, defaultSvc, isRotate });
    setKeyName(prefillKey || '');
    setKeyVal('');
    setNameErr('');
    setValErr('');
  };

  const handleSaveKey = async () => {
    const isNew = !keyModal?.prefillKey;
    const finalName = (keyModal?.prefillKey || keyName).trim();
    let ok = true;

    if (isNew) {
      if (!finalName) {
        setNameErr('请填写密钥名称。');
        ok = false;
      } else if (!/^[A-Z0-9_]+$/.test(finalName)) {
        setNameErr('名称里有不支持的字符，请只用大写字母、数字和下划线。');
        ok = false;
      } else if (state.vault.some((v) => v.key === finalName)) {
        setNameErr('这个名称已经存在，请直接点击该条目右侧的「轮换」更新。');
        ok = false;
      } else {
        setNameErr('');
      }
    }

    const trimmedVal = keyVal.trim();
    if (trimmedVal.length < 8) {
      setValErr('密钥值太短，至少需要 8 个字符。请粘贴完整的密钥。');
      ok = false;
    } else {
      setValErr('');
    }

    if (!ok) return;

    setBusy(true);
    try {
      await onSetVaultKey(finalName, trimmedVal, keyModal?.defaultSvc || undefined);
      setKeyModal(null);
    } catch (err) {
      setValErr(err instanceof Error ? err.message : '保存失败');
    } finally {
      setBusy(false);
    }
  };

  const handleExportManifest = () => {
    const filename = gitTab === 'lock' ? 'toolbox.lock.json' : 'toolbox.manifest.json';
    const content =
      gitTab === 'lock' ? state.preflight.lockfileJson : state.preflight.manifestJson;
    const blob = new Blob([content], { type: 'application/json;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
    onToast(`已导出 ${filename}`);
  };

  const canPush = state.preflight.ready && !state.sync.pushed;
  const isNewKey = !keyModal?.prefillKey;
  const changedLinesCount = state.preflight.diffLines.filter((d) => d.kind !== 'ctx').length;

  return (
    <>
      <div className="page-h">
        <div className="od-fill">
          <h1 tabIndex={-1} id="pageTitle">
            GitHub 同步与密钥
          </h1>
          <p className="lead">
            把脱敏配置与指纹锁备份到 GitHub，换电脑时一键恢复。真实密钥经 AES-256-GCM 加密只留在本机。
          </p>
        </div>
        <div className="acts">
          <button type="button" className="btn" onClick={handleExportManifest}>
            <ProtoIcon name="download" />
            <span>导出 JSON</span>
          </button>
        </div>
      </div>

      <div className="grid-main">
        <div className="od-stack" style={{ '--od-gap': '16px' } as CSSProperties}>
          {/* 3-Gate Preflight Checks */}
          <section className="box" id="y-check">
            <div className="box-h">
              <h2 className="od-fill">推送前检查</h2>
              <span className="hint mono">
                {state.sync.repo} · {state.sync.branch}
              </span>
              <button
                type="button"
                className="btn sm"
                onClick={() => {
                  setRepoInput(state.sync.repo);
                  setBranchInput(state.sync.branch);
                  setRepoModalOpen(true);
                }}
              >
                <span>配置仓库</span>
              </button>
            </div>
            <div className="box-b flush">
              {state.preflight.checks.map((c) => (
                <div key={c.id} className="list-row">
                  <ProtoStatus kind={c.passed ? 'ok' : 'warn'} />
                  <div className="od-fill">
                    <b>{c.title}</b>
                    <div className="small muted">{c.detail}</div>
                  </div>
                </div>
              ))}
            </div>
          </section>

          {/* Manifest, Lockfile & Diff Preview */}
          <section className="box" id="y-files">
            <div className="box-h">
              <h2>这次要同步的内容</h2>
              <span className="hint">
                {state.sync.pushed
                  ? `已与远端同步 (@${state.sync.commitHash})`
                  : `${changedLinesCount} 行配置变更`}
              </span>
            </div>
            <div className="box-b">
              <div className="od-stack" style={{ '--od-gap': '12px' } as CSSProperties}>
                <p className="muted small">
                  {state.sync.pushed
                    ? `最近提交：${state.sync.lastCommitMessage || '已同步'}（@${state.sync.commitHash}）。`
                    : `本地比 GitHub 多 ${state.sync.ahead} 处改动（基准 @${state.sync.commitHash}）。`}
                </p>
                <ProtoSeg
                  label="选择文件"
                  items={
                    [
                      ['manifest', '配置清单'],
                      ['lock', '指纹锁'],
                      ['diff', `变更 Diff (${changedLinesCount})`],
                    ] as const
                  }
                  value={gitTab}
                  onChange={setGitTab}
                />

                {gitTab === 'diff' ? (
                  <pre className="code" aria-label="配置变更对比" style={{ maxHeight: 340 }}>
                    {changedLinesCount === 0 ? (
                      <span className="c">// 当前本地配置与最近一次推送完全一致，无行级差异。</span>
                    ) : (
                      state.preflight.diffLines.map((line, idx) => (
                        <span
                          key={idx}
                          className={
                            line.kind === 'add' ? 'add' : line.kind === 'del' ? 'del' : 'c'
                          }
                        >
                          {line.kind === 'add' ? '+ ' : line.kind === 'del' ? '- ' : '  '}
                          {line.text}
                          {line.kind === 'ctx' ? '\n' : ''}
                        </span>
                      ))
                    )}
                  </pre>
                ) : (
                  <pre
                    className="code"
                    style={{ maxHeight: 340 }}
                    aria-label={gitTab === 'manifest' ? 'toolbox.manifest.json' : 'toolbox.lock.json'}
                  >
                    {gitTab === 'manifest'
                      ? state.preflight.manifestJson
                      : state.preflight.lockfileJson}
                  </pre>
                )}

                <div className="field">
                  <label htmlFor="syncCommitMsg" className="small">
                    提交说明 (Commit Message)
                  </label>
                  <input
                    id="syncCommitMsg"
                    className="input mono"
                    style={{ fontSize: '12px' }}
                    value={commitMsg}
                    onChange={(e) => setCommitMsg(e.target.value)}
                    placeholder="例如 feat(mcp): add linear server and update lockfile"
                  />
                </div>
              </div>
            </div>
            <div className="box-f">
              <button type="button" className="btn" onClick={onPull}>
                <ProtoIcon name="download" />
                <span>从 GitHub 拉取</span>
              </button>
              <button
                type="button"
                className="btn pri"
                disabled={!canPush}
                aria-describedby={!canPush && state.preflight.blockingReason ? 'pushWhy' : undefined}
                onClick={() => onPush(commitMsg)}
              >
                <ProtoIcon name="sync" />
                <span>
                  {state.sync.pushed ? '已推送' : `推送 ${state.sync.ahead} 处改动`}
                </span>
              </button>
              {!state.sync.pushed && state.preflight.blockingReason && (
                <span
                  className="small muted"
                  id="pushWhy"
                  style={{ flexBasis: '100%', textAlign: 'right' }}
                >
                  {state.preflight.blockingReason}
                </span>
              )}
            </div>
          </section>
        </div>

        {/* Right: Vault */}
        <section className="box" id="y-vault">
          <div className="box-h">
            <h2>
              Vault
              <ProtoTip
                label="Vault"
                text="真实的密码和 Token 经本地 AES-256-GCM 加密保存。同步到 GitHub 的只是 vault://名字 这样的引用，永远不会泄露明文。"
                onOpen={setInfoTip}
              />
            </h2>
            <span className="hint">{state.vault.length} 项凭据</span>
          </div>
          <div className="box-b flush">
            {state.vault.map((v) => (
              <div key={v.key} className="list-row">
                <div className="od-fill">
                  <div className="od-row" style={{ '--od-gap': '6px', flexWrap: 'wrap' } as CSSProperties}>
                    <span className="mono small" style={{ fontWeight: 600 }}>
                      vault://{v.key}
                    </span>
                    {v.referencedBy &&
                      v.referencedBy.map((srv) => (
                        <span key={srv} className="tag info">
                          {srv}
                        </span>
                      ))}
                  </div>
                  <div className="small muted" style={{ marginTop: '2px' }}>
                    {v.configured ? (
                      <>
                        已加密存储 · <span className="mono">{v.maskedValue}</span>
                      </>
                    ) : (
                      <>待填写 · 用于 {v.serviceName}</>
                    )}
                  </div>
                </div>
                {v.configured ? (
                  <span className="od-row" style={{ '--od-gap': '6px' } as CSSProperties}>
                    <ProtoStatus kind="ok" text="已就绪" />
                    <button
                      type="button"
                      className="btn sm"
                      onClick={() => openKeyDialog(v.key, v.serviceName, true)}
                    >
                      <span>轮换</span>
                    </button>
                    <button
                      type="button"
                      className="btn sm danger"
                      onClick={() => setDelKeyTarget(v)}
                    >
                      <span>删除</span>
                    </button>
                  </span>
                ) : (
                  <span className="od-row" style={{ '--od-gap': '8px' } as CSSProperties}>
                    <ProtoStatus kind="warn" text="缺失" />
                    <button
                      type="button"
                      className="btn sm pri"
                      onClick={() => openKeyDialog(v.key, v.serviceName)}
                    >
                      <span>填写</span>
                    </button>
                  </span>
                )}
              </div>
            ))}
          </div>
          <div className="box-f">
            <button type="button" className="btn" onClick={() => openKeyDialog(null)}>
              <ProtoIcon name="plus" />
              <span>新增密钥</span>
            </button>
          </div>
        </section>
      </div>

      {/* Vault Secret Form Dialog */}
      <ModalDialog
        open={Boolean(keyModal)}
        title={
          isNewKey
            ? '新增密钥'
            : keyModal?.isRotate
            ? `轮换更新 ${keyModal?.prefillKey}`
            : `填写 ${keyModal?.prefillKey}`
        }
        confirmLabel={keyModal?.isRotate ? '轮换并重新加密' : '存入 Vault'}
        busy={busy}
        onClose={() => setKeyModal(null)}
        onConfirm={handleSaveKey}
      >
        {isNewKey && (
          <div className="field">
            <label htmlFor="kName">
              密钥名称 <span style={{ color: 'var(--bad)' }}>*</span>
            </label>
            <input
              className="input mono"
              id="kName"
              data-autofocus="true"
              value={keyName}
              onChange={(e) => setKeyName(e.target.value)}
              placeholder="例如 OPENAI_API_KEY"
              aria-describedby="kNameHelp kNameErr"
              aria-invalid={nameErr ? 'true' : 'false'}
            />
            <span className="help" id="kNameHelp">
              只能用大写字母、数字和下划线。
            </span>
            {nameErr && (
              <span className="err" id="kNameErr">
                {nameErr}
              </span>
            )}
          </div>
        )}
        <div className="field">
          <label htmlFor="kVal">
            {keyModal?.isRotate ? '新的密钥值' : '密钥值'}{' '}
            <span style={{ color: 'var(--bad)' }}>*</span>
          </label>
          <input
            className="input mono"
            id="kVal"
            type="password"
            data-autofocus={!isNewKey ? 'true' : undefined}
            autoComplete="off"
            value={keyVal}
            onChange={(e) => setKeyVal(e.target.value)}
            aria-describedby="kValHelp kValErr"
            aria-invalid={valErr ? 'true' : 'false'}
          />
          <span className="help" id="kValHelp">
            只保存在这台电脑上，保存后界面仅显示首尾脱敏片段。
          </span>
          {valErr && (
            <span className="err" id="kValErr">
              {valErr}
            </span>
          )}
        </div>
      </ModalDialog>

      {/* Delete Vault Key Confirmation */}
      <ModalDialog
        open={Boolean(delKeyTarget)}
        title={`删除密钥「vault://${delKeyTarget?.key || ''}」？`}
        confirmLabel="确认删除"
        danger
        onClose={() => setDelKeyTarget(null)}
        onConfirm={async () => {
          if (!delKeyTarget) return;
          await onDeleteVaultKey(delKeyTarget.key);
          setDelKeyTarget(null);
        }}
      >
        <p>
          删除后，依赖该凭据的 MCP Server
          {delKeyTarget?.referencedBy?.length
            ? `（${delKeyTarget.referencedBy.join('、')}）`
            : ''}
          在重新配置前将无法注入该密钥。
        </p>
      </ModalDialog>

      {/* Edit GitHub Sync Repository & Branch */}
      <ModalDialog
        open={repoModalOpen}
        title="配置 GitHub 同步仓库"
        confirmLabel="保存仓库设置"
        busy={busy}
        onClose={() => setRepoModalOpen(false)}
        onConfirm={async () => {
          if (!repoInput.trim() || !branchInput.trim()) return;
          setBusy(true);
          try {
            await onUpdateSyncConfig(repoInput.trim(), branchInput.trim());
            setRepoModalOpen(false);
          } finally {
            setBusy(false);
          }
        }}
      >
        <div className="field">
          <label htmlFor="syncRepoInput">GitHub 仓库（owner/repo）</label>
          <input
            id="syncRepoInput"
            data-autofocus="true"
            className="input mono"
            value={repoInput}
            onChange={(e) => setRepoInput(e.target.value)}
            placeholder="github.com/your-org/agent-toolbox-config"
          />
        </div>
        <div className="field">
          <label htmlFor="syncBranchInput">目标分支</label>
          <input
            id="syncBranchInput"
            className="input mono"
            value={branchInput}
            onChange={(e) => setBranchInput(e.target.value)}
            placeholder="main"
          />
        </div>
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
