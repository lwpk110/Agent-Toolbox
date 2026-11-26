import { useEffect, useId, useState } from 'react';
import mermaid from 'mermaid';
import { Check, Code2, Copy, Eye, Maximize2, AlertTriangle } from 'lucide-react';

interface MermaidDiagramProps {
  code: string;
  theme: 'light' | 'dark';
  index: number;
  onExpand: (payload: { code: string; svg: string; title: string }) => void;
}

// Serialize mermaid render calls so theme configuration never races across diagrams
let renderQueue: Promise<void> = Promise.resolve();

function inferDiagramLabel(code: string, index: number): string {
  const firstLine = code.trim().split('\n')[0]?.trim() || '';
  if (firstLine.startsWith('sequenceDiagram')) return `图 ${index + 1} · 时序图`;
  if (firstLine.startsWith('stateDiagram')) return `图 ${index + 1} · 状态机图`;
  if (firstLine.startsWith('erDiagram')) return `图 ${index + 1} · 数据模型 ER 图`;
  if (firstLine.startsWith('journey')) return `图 ${index + 1} · 用户旅程图`;
  if (firstLine.startsWith('flowchart') || firstLine.startsWith('graph')) return `图 ${index + 1} · 架构与流程图`;
  return `图 ${index + 1} · Mermaid 图表`;
}

export function MermaidDiagram({ code, theme, index, onExpand }: MermaidDiagramProps) {
  const reactId = useId().replace(/:/g, '');
  const [svg, setSvg] = useState<string>('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [showSource, setShowSource] = useState<boolean>(false);
  const [copied, setCopied] = useState<boolean>(false);

  const label = inferDiagramLabel(code, index);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);

    const task = async () => {
      try {
        mermaid.initialize({
          startOnLoad: false,
          securityLevel: 'strict',
          theme: theme === 'dark' ? 'dark' : 'default',
          fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", "Noto Sans", "PingFang SC", "Microsoft YaHei", Helvetica, Arial, sans-serif',
          flowchart: {
            useMaxWidth: true,
            htmlLabels: true,
            curve: 'basis',
          },
          sequence: {
            useMaxWidth: true,
            wrap: true,
          },
          er: {
            useMaxWidth: true,
          },
          themeVariables:
            theme === 'dark'
              ? {
                  background: '#161b22',
                  primaryColor: '#1f2937',
                  primaryTextColor: '#e6edf3',
                  primaryBorderColor: '#3b82f6',
                  lineColor: '#8b949e',
                  secondaryColor: '#0d1117',
                  tertiaryColor: '#161b22',
                }
              : {
                  background: '#ffffff',
                  primaryColor: '#f6f8fa',
                  primaryTextColor: '#1f2328',
                  primaryBorderColor: '#0969da',
                  lineColor: '#59636e',
                  secondaryColor: '#ffffff',
                  tertiaryColor: '#f6f8fa',
                },
        });

        const uniqueId = `mmd-${reactId}-${theme}-${Date.now()}`;
        const result = await mermaid.render(uniqueId, code.trim());
        if (!cancelled) {
          setSvg(result.svg);
          setError(null);
          setLoading(false);
        }
      } catch (err) {
        if (!cancelled) {
          const message = err instanceof Error ? err.message : 'Mermaid 图表渲染失败';
          setError(message);
          setLoading(false);
        }
      }
    };

    renderQueue = renderQueue.then(task, task);

    return () => {
      cancelled = true;
    };
  }, [code, theme, reactId]);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(code.trim());
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1800);
    } catch {
      setCopied(false);
    }
  };

  return (
    <figure className="box" style={{ margin: '20px 0', overflow: 'hidden' }}>
      <figcaption className="box-h" style={{ justifyContent: 'space-between', flexWrap: 'wrap' }}>
        <span className="small" style={{ fontWeight: 600 }}>{label}</span>
        <div className="od-row" style={{ gap: '6px' }}>
          <button type="button" onClick={() => setShowSource((prev) => !prev)} className="btn sm">
            {showSource ? <Eye className="h-3.5 w-3.5" /> : <Code2 className="h-3.5 w-3.5" />}
            <span>{showSource ? '图表视图' : '查看源码'}</span>
          </button>
          <button type="button" onClick={handleCopy} className="btn sm">
            {copied ? <Check className="h-3.5 w-3.5 text-[#1a7f37]" /> : <Copy className="h-3.5 w-3.5" />}
            <span>{copied ? '已复制' : '复制源码'}</span>
          </button>
          <button
            type="button"
            disabled={!svg || Boolean(error)}
            onClick={() => onExpand({ code, svg, title: label })}
            className="btn sm"
          >
            <Maximize2 className="h-3.5 w-3.5" />
            <span>放大审阅</span>
          </button>
        </div>
      </figcaption>

      {showSource ? (
        <pre className="code" style={{ border: 0, borderRadius: 0 }}>
          <code>{code.trim()}</code>
        </pre>
      ) : error ? (
        <div className="box-b od-stack">
          <div className="flash bad">
            <AlertTriangle className="h-4 w-4 shrink-0 text-[#cf222e]" />
            <div className="t">
              <b>图表语法解析降级</b>
              <span>{error}</span>
            </div>
          </div>
          <pre className="code">
            <code>{code.trim()}</code>
          </pre>
        </div>
      ) : loading ? (
        <div className="empty">
          <span className="small muted">正在渲染矢量架构图…</span>
        </div>
      ) : (
        <div
          className="mermaid-svg-wrap box-b"
          style={{ overflowX: 'auto' }}
          // SVG is rendered by mermaid with securityLevel: 'strict'
          dangerouslySetInnerHTML={{ __html: svg }}
        />
      )}
    </figure>
  );
}
