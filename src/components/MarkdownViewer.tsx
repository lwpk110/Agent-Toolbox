import { useMemo, useState, type MouseEvent } from 'react';
import { marked } from 'marked';
import DOMPurify from 'dompurify';
import { Check, Copy } from 'lucide-react';
import { MermaidDiagram } from './MermaidDiagram';
import type { DocMeta, TocHeading } from '../types/docs';

interface MarkdownViewerProps {
  markdown: string;
  relativePath: string;
  theme: 'light' | 'dark';
  docs: DocMeta[];
  onOpenDoc: (slug: string) => void;
  onExpandDiagram: (payload: { code: string; svg: string; title: string }) => void;
}

type Segment =
  | { kind: 'markdown'; html: string }
  | { kind: 'mermaid'; code: string; diagramIndex: number }
  | { kind: 'code'; lang: string; code: string };

export function extractHeadings(markdown: string): TocHeading[] {
  const headings: TocHeading[] = [];
  const lines = markdown.split('\n');
  let inFence = false;
  let counter = 0;

  for (const line of lines) {
    if (/^```/.test(line.trim())) {
      inFence = !inFence;
      continue;
    }
    if (inFence) continue;

    const match = /^(#{2,3})\s+(.+?)\s*$/.exec(line);
    if (match) {
      const level = match[1].length as 2 | 3;
      const text = match[2].replace(/[`*_~]/g, '').trim();
      counter += 1;
      headings.push({
        id: `sec-${counter}`,
        text,
        level,
      });
    }
  }

  return headings;
}

function CodeBlock({ lang, code }: { lang: string; code: string }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1800);
    } catch {
      setCopied(false);
    }
  };

  return (
    <div className="box" style={{ margin: '16px 0', overflow: 'hidden' }}>
      <div className="box-h" style={{ justifyContent: 'space-between', padding: '8px 16px' }}>
        <span className="mono small muted">{lang || 'text'}</span>
        <button type="button" onClick={handleCopy} className="btn sm">
          {copied ? <Check className="h-3.5 w-3.5 text-[#1a7f37]" /> : <Copy className="h-3.5 w-3.5" />}
          <span>{copied ? '已复制' : '复制'}</span>
        </button>
      </div>
      <pre className="code" style={{ border: 0, borderRadius: 0 }}>
        <code>{code}</code>
      </pre>
    </div>
  );
}

export function MarkdownViewer({ markdown, relativePath, theme, docs, onOpenDoc, onExpandDiagram }: MarkdownViewerProps) {
  const docsByPath = useMemo(() => new Map(docs.map((doc) => [docUrlPath(doc.relativePath), doc.slug])), [docs]);
  const docsByLink = useMemo(() => new Map(docs.map((doc) => [`/raw/${encodeURIComponent(doc.slug)}`, doc.slug])), [docs]);
  const documentBase = new URL(docUrlPath(relativePath), window.location.origin).href;

  const segments = useMemo<Segment[]>(() => {
    const result: Segment[] = [];
    const fenceRegex = /^```([a-zA-Z0-9_-]*)\r?\n([\s\S]*?)^```/gm;

    let lastIndex = 0;
    let diagramCounter = 0;
    let headingCounter = 0;

    const renderMarkdownChunk = (rawChunk: string) => {
      if (!rawChunk.trim()) return;
      const rendered = marked.parse(rawChunk, {
        gfm: true,
        breaks: false,
        walkTokens(token) {
          if (token.type !== 'link' || /^(?:[a-z][a-z\d+.-]*:|[/#?])/i.test(token.href)) return;

          const target = new URL(token.href, documentBase);
          if (target.origin !== window.location.origin) return;
          const slug = docsByPath.get(target.pathname);
          if (slug) {
            token.href = `/raw/${encodeURIComponent(slug)}`;
          } else if (target.pathname.startsWith('/prototype/')) {
            token.href = target.pathname + target.search + target.hash;
          }
        },
      });
      const rawHtml = typeof rendered === 'string' ? rendered : '';

      // Inject sequential heading IDs matching extractHeadings() and wrap tables for safe horizontal scrolling
      const withHeadingIds = rawHtml
        .replace(/<(h[23])>([\s\S]*?)<\/\1>/g, (_m, tag: string, inner: string) => {
          headingCounter += 1;
          return `<${tag} id="sec-${headingCounter}">${inner}</${tag}>`;
        })
        .replace(/<table>/g, '<div class="table-scroll"><table>')
        .replace(/<\/table>/g, '</table></div>');

      const sanitized = DOMPurify.sanitize(withHeadingIds, {
        USE_PROFILES: { html: true },
        ADD_ATTR: ['id', 'class'],
      });

      result.push({ kind: 'markdown', html: sanitized });
    };

    let match: RegExpExecArray | null;
    while ((match = fenceRegex.exec(markdown)) !== null) {
      if (match.index > lastIndex) {
        renderMarkdownChunk(markdown.slice(lastIndex, match.index));
      }
      const lang = (match[1] || '').trim().toLowerCase();
      const code = match[2].replace(/\n$/, '');

      if (lang === 'mermaid') {
        result.push({ kind: 'mermaid', code, diagramIndex: diagramCounter });
        diagramCounter += 1;
      } else {
        result.push({ kind: 'code', lang, code });
      }
      lastIndex = fenceRegex.lastIndex;
    }

    if (lastIndex < markdown.length) {
      renderMarkdownChunk(markdown.slice(lastIndex));
    }

    return result;
  }, [markdown, documentBase, docsByPath]);

  function handleDocLink(event: MouseEvent<HTMLElement>) {
    if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) {
      return;
    }
    if (!(event.target instanceof Element)) return;

    const href = event.target.closest('a')?.getAttribute('href');
    const slug = href && docsByLink.get(href);
    if (slug) {
      event.preventDefault();
      onOpenDoc(slug);
    }
  }

  return (
    <article className="doc-prose min-w-0" onClick={handleDocLink}>
      {segments.map((seg, idx) => {
        if (seg.kind === 'mermaid') {
          return (
            <MermaidDiagram
              key={`mermaid-${seg.diagramIndex}-${idx}`}
              code={seg.code}
              theme={theme}
              index={seg.diagramIndex}
              onExpand={onExpandDiagram}
            />
          );
        }
        if (seg.kind === 'code') {
          return <CodeBlock key={`code-${idx}`} lang={seg.lang} code={seg.code} />;
        }
        return <div key={`md-${idx}`} dangerouslySetInnerHTML={{ __html: seg.html }} />;
      })}
    </article>
  );
}

function docUrlPath(relativePath: string) {
  return `/docs/${relativePath.split('/').map(encodeURIComponent).join('/')}`;
}
