import { useState, type CSSProperties } from 'react';
import type { GatewayStateSnapshot } from '../types/toolbox';
import { ProtoIcon } from './ProtoIcon';
import { ProtoSeg, ProtoStatus, ProtoTip } from './ProtoPrimitives';
import { ModalDialog } from './ModalDialog';

interface SyncVaultViewProps {
  state: GatewayStateSnapshot;
  onSetVaultKey: (key: string, value: string, serviceName?: string) => Promise<void>;
  onPull: () => Promise<void>;
  onPush: () => Promise<void>;
}

export function SyncVaultView({ state, onSetVaultKey, onPull, onPush }: SyncVaultViewProps) {
  const [gitFile, setGitFile] = useState<'manifest' | 'lock'>('manifest');
  const [keyModal, setKeyModal] = useState<{ prefillKey: string | null; defaultSvc?: string } | null>(
    null
  );
  const [keyName, setKeyName] = useState('');
  const [keyVal, setKeyVal] = useState('');
  const [nameErr, setNameErr] = useState('');
  const [valErr, setValErr] = useState('');
  const [busy, setBusy] = useState(false);
  const [infoTip, setInfoTip] = useState<{ title: string; body: string } | null>(null);

  const openKeyDialog = (prefillKey: string | null, defaultSvc?: string) => {
    setKeyModal({ prefillKey, defaultSvc });
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
        setNameErr('这个名称已经存在，请换一个。');
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

  const canPush = state.preflight.ready && !state.sync.pushed;
  const isNewKey = !keyModal?.prefillKey;

  return (
    <>
      <div className="page-h">
        <div className="od-fill">
          <h1 tabIndex={-1} id="pageTitle">
            GitHub 同步与密钥
          </h1>
          <p className="lead">
            把配置备份到 GitHub，换电脑时一键恢复。真实密钥只留在本机，不会上传。
          </p>
        </div>
      </div>

      <div className="grid-main">
        <div className="od-stack" style={{ '--od-gap': '16px' } as CSSProperties}>
          {/* 3-Gate Preflight Checks */}
          <section className="box" id="y-check">
            <div className="box-h">
              <h2>推送前检查</h2>
              <span className="hint">
                {state.sync.repo} · {state.sync.branch}
              </span>
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

          {/* Manifest & Lockfile Preview */}
          <section className="box" id="y-files">
            <div className="box-h">
              <h2>这次要同步的内容</h2>
            </div>
            <div className="box-b">
              <div className="od-stack" style={{ '--od-gap': '12px' } as CSSProperties}>
                <p className="muted small">
                  {state.sync.pushed
                    ? '已推送，本地和 GitHub 一致。'
                    : `本地比 GitHub 多 ${state.sync.ahead} 处改动（@${state.sync.commitHash}）。`}
                </p>
                <ProtoSeg
                  label="选择文件"
                  items={
                    [
                      ['manifest', '配置清单'],
                      ['lock', '指纹锁'],
                    ] as const
                  }
                  value={gitFile}
                  onChange={setGitFile}
                />
                <pre
                  className="code"
                  aria-label={gitFile === 'manifest' ? 'toolbox.manifest.json' : 'toolbox.lock.json'}
                >
                  {gitFile === 'manifest'
                    ? state.preflight.manifestJson
                    : state.preflight.lockfileJson}
                </pre>
                <span className="small muted mono">
                  {gitFile === 'manifest' ? 'toolbox.manifest.json' : 'toolbox.lock.json'}
                </span>
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
                onClick={onPush}
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
                text="真实的密码和 Token 只保存在这台电脑上。同步到 GitHub 的只是 vault://名字 这样的引用，别人看不到真实值。"
                onOpen={setInfoTip}
              />
            </h2>
          </div>
          <div className="box-b flush">
            {state.vault.map((v) => (
              <div key={v.key} className="list-row">
                <div className="od-fill">
                  <div className="mono small" style={{ fontWeight: 600 }}>
                    vault://{v.key}
                  </div>
                  <div className="small muted">
                    用于 {v.serviceName}
                    {v.maskedValue ? (
                      <>
                        {' · '}
                        <span className="mono">{v.maskedValue}</span>
                      </>
                    ) : null}
                  </div>
                </div>
                {v.configured ? (
                  <ProtoStatus kind="ok" text="已就绪" />
                ) : (
                  <span className="od-row" style={{ '--od-gap': '8px' } as CSSProperties}>
                    <ProtoStatus kind="warn" text="缺失" />
                    <button
                      type="button"
                      className="btn sm"
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

      {/* Vault Secret Form Dialog matching protype keyDialog() */}
      <ModalDialog
        open={Boolean(keyModal)}
        title={isNewKey ? '新增密钥' : `填写 ${keyModal?.prefillKey}`}
        confirmLabel="存入 Vault"
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
            密钥值 <span style={{ color: 'var(--bad)' }}>*</span>
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
            只保存在这台电脑上，保存后只显示首尾几位。
          </span>
          {valErr && (
            <span className="err" id="kValErr">
              {valErr}
            </span>
          )}
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
