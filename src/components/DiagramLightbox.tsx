import { useEffect, useState } from 'react';
import { Check, Code2, Copy, Eye, RotateCcw, X, ZoomIn, ZoomOut } from 'lucide-react';

interface DiagramLightboxProps {
  diagram: { code: string; svg: string; title: string } | null;
  onClose: () => void;
}

export function DiagramLightbox({ diagram, onClose }: DiagramLightboxProps) {
  const [zoom, setZoom] = useState<number>(1);
  const [showSource, setShowSource] = useState<boolean>(false);
  const [copied, setCopied] = useState<boolean>(false);

  useEffect(() => {
    setZoom(1);
    setShowSource(false);
    setCopied(false);
  }, [diagram]);

  useEffect(() => {
    if (!diagram) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [diagram, onClose]);

  if (!diagram) return null;

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(diagram.code.trim());
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1800);
    } catch {
      setCopied(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 md:p-8"
      style={{ background: 'rgba(31,35,40,0.5)' }}
      role="dialog"
      aria-modal="true"
      aria-label={diagram.title}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className="flex h-[88vh] w-full max-w-6xl flex-col overflow-hidden"
        style={{
          background: 'var(--bg)',
          border: '1px solid var(--line)',
          borderRadius: '12px',
          boxShadow: '0 1px 3px rgba(31,35,40,0.12), 0 8px 24px rgba(66,74,83,0.12)',
        }}
      >
        <div className="box-h" style={{ justifyContent: 'space-between', flexWrap: 'wrap', borderRadius: 0 }}>
          <div style={{ fontWeight: 600 }}>{diagram.title}</div>
          <div className="od-row" style={{ flexWrap: 'wrap', gap: '6px' }}>
            {!showSource && (
              <>
                <button
                  type="button"
                  onClick={() => setZoom((z) => Math.max(0.5, Number((z - 0.2).toFixed(2))))}
                  className="btn sm"
                  aria-label="缩小图表"
                >
                  <ZoomOut className="h-3.5 w-3.5" />
                </button>
                <span className="mono small muted" style={{ minWidth: '44px', textAlign: 'center' }}>
                  {Math.round(zoom * 100)}%
                </span>
                <button
                  type="button"
                  onClick={() => setZoom((z) => Math.min(2.2, Number((z + 0.2).toFixed(2))))}
                  className="btn sm"
                  aria-label="放大图表"
                >
                  <ZoomIn className="h-3.5 w-3.5" />
                </button>
                <button type="button" onClick={() => setZoom(1)} className="btn sm">
                  <RotateCcw className="h-3.5 w-3.5" />
                  <span>重置</span>
                </button>
              </>
            )}

            <button type="button" onClick={() => setShowSource((s) => !s)} className="btn sm">
              {showSource ? <Eye className="h-3.5 w-3.5" /> : <Code2 className="h-3.5 w-3.5" />}
              <span>{showSource ? '图表视图' : '查看源码'}</span>
            </button>

            <button type="button" onClick={handleCopy} className="btn sm">
              {copied ? <Check className="h-3.5 w-3.5 text-[#1a7f37]" /> : <Copy className="h-3.5 w-3.5" />}
              <span>{copied ? '已复制' : '复制源码'}</span>
            </button>

            <button type="button" onClick={onClose} className="btn sm" aria-label="关闭全屏预览">
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>

        <div className="flex-1 overflow-auto" style={{ padding: '24px' }}>
          {showSource ? (
            <pre className="code">
              <code>{diagram.code.trim()}</code>
            </pre>
          ) : (
            <div className="flex min-h-full items-center justify-center">
              <div
                className="mermaid-svg-wrap origin-top transition-transform duration-150"
                style={{ transform: `scale(${zoom})` }}
                dangerouslySetInnerHTML={{ __html: diagram.svg }}
              />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
