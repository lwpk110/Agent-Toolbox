import type { ReactNode } from 'react';
import { ProtoIcon, type ProtoIconName } from './ProtoIcon';

export function ProtoStatus({
  kind,
  text,
}: {
  kind: 'ok' | 'warn' | 'bad' | 'off';
  text?: string;
}) {
  const iconMap: Record<'ok' | 'warn' | 'bad' | 'off', ProtoIconName> = {
    ok: 'ok',
    warn: 'pause',
    bad: 'alert',
    off: 'pause',
  };
  return (
    <span className={`st ${kind}`}>
      <ProtoIcon name={iconMap[kind]} />
      {text ?? ''}
    </span>
  );
}

export function DataOriginTag({ origin }: { origin?: 'real' | 'demo' | 'fixture' }) {
  if (origin === 'demo') return <span className="origin-tag demo">演示</span>;
  if (origin === 'fixture') return <span className="origin-tag fixture">测试</span>;
  return null;
}

export function ProtoTip({
  label,
  text,
  onOpen,
}: {
  label: string;
  text: string;
  onOpen: (tip: { title: string; body: string }) => void;
}) {
  return (
    <button
      type="button"
      className="tip"
      aria-label={`${label} 是什么？`}
      onClick={() => onOpen({ title: `${label} 是什么？`, body: text })}
    >
      <ProtoIcon name="info" />
    </button>
  );
}

export function ProtoSeg<T extends string>({
  label,
  items,
  value,
  onChange,
}: {
  label: string;
  items: ReadonlyArray<readonly [T, string]>;
  value: T;
  onChange: (val: T) => void;
}) {
  return (
    <div className="seg" role="group" aria-label={label}>
      {items.map(([val, text]) => (
        <button
          key={val}
          type="button"
          aria-pressed={value === val ? 'true' : 'false'}
          onClick={() => onChange(val)}
        >
          {text}
        </button>
      ))}
    </div>
  );
}

export function ProtoSwitch({
  checked,
  label,
  disabled = false,
  onToggle,
}: {
  checked: boolean;
  label: string;
  disabled?: boolean;
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      className="sw"
      role="switch"
      aria-checked={checked ? 'true' : 'false'}
      aria-label={label}
      disabled={disabled}
      onClick={onToggle}
    >
      <span className="track" />
      <span>{checked ? '开' : '关'}</span>
    </button>
  );
}

export function ProtoMore({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <details className="more">
      <summary>
        <ProtoIcon name="chev" />
        {label}
      </summary>
      <div className="inner">{children}</div>
    </details>
  );
}
