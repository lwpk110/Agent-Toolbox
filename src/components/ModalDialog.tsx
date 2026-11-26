import { useEffect, useRef, type ReactNode } from 'react';

interface ModalDialogProps {
  open: boolean;
  title: string;
  children: ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  danger?: boolean;
  hideCancel?: boolean;
  busy?: boolean;
  onConfirm?: () => void;
  onClose: () => void;
}

export function ModalDialog({
  open,
  title,
  children,
  confirmLabel = '确定',
  cancelLabel = '取消',
  danger = false,
  hideCancel = false,
  busy = false,
  onConfirm,
  onClose,
}: ModalDialogProps) {
  const dlgRef = useRef<HTMLDialogElement>(null);
  const openerRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    const el = dlgRef.current;
    if (!el) return;
    if (open) {
      openerRef.current = document.activeElement as HTMLElement | null;
      if (!el.open) {
        if (typeof el.showModal === 'function') {
          el.showModal();
        } else {
          el.setAttribute('open', '');
        }
      }
      requestAnimationFrame(() => {
        const auto = el.querySelector<HTMLElement>('[data-autofocus]');
        const cancelBtn = el.querySelector<HTMLElement>('[data-cancel]');
        const okBtn = el.querySelector<HTMLElement>('[data-ok]');
        (auto || cancelBtn || okBtn)?.focus();
      });
    } else if (el.open) {
      if (typeof el.close === 'function') {
        el.close();
      } else {
        el.removeAttribute('open');
      }
      if (openerRef.current && document.contains(openerRef.current)) {
        openerRef.current.focus();
      }
    }
  }, [open]);

  return (
    <dialog
      ref={dlgRef}
      className="dlg"
      aria-labelledby="dlgTitle"
      onCancel={(e) => {
        e.preventDefault();
        if (!busy) onClose();
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget && !busy) onClose();
      }}
      onKeyDown={(e) => {
        if (
          e.key === 'Enter' &&
          (e.target as HTMLElement).tagName === 'INPUT' &&
          onConfirm &&
          !busy
        ) {
          e.preventDefault();
          onConfirm();
        }
      }}
    >
      {open && (
        <>
          <div className="dlg-h" id="dlgTitle">
            {title}
          </div>
          <div className="dlg-b">{children}</div>
          <div className="dlg-f">
            {!hideCancel && (
              <button
                type="button"
                className="btn"
                data-cancel="true"
                disabled={busy}
                onClick={onClose}
              >
                {cancelLabel}
              </button>
            )}
            {onConfirm && (
              <button
                type="button"
                className={`btn ${danger ? 'danger' : 'pri'}`}
                data-ok="true"
                disabled={busy}
                onClick={onConfirm}
              >
                {busy ? '处理中…' : confirmLabel}
              </button>
            )}
          </div>
        </>
      )}
    </dialog>
  );
}
