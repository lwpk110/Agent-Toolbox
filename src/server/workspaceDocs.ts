import fs from 'node:fs';
import path from 'node:path';
import { marked, type Tokens } from 'marked';
import type { DocCategory, DocDetail, DocMeta } from '../types/docs';

const SECTIONS = {
  guides: '开发指南',
  product: '产品与规划',
  architecture: '系统架构',
  adr: 'ADR',
  reference: '协议与安全',
} as const satisfies Record<string, DocCategory>;

const EXISTING_DOCS: Record<string, { slug: string; shortTitle: string }> = {
  'README.md': { slug: 'overview', shortTitle: '文档体系总览' },
  'guides/current-implementation.md': { slug: 'current-implementation', shortTitle: '当前实现' },
  'product/prd.md': { slug: 'prd', shortTitle: 'PRD 产品需求' },
  'product/feasibility_report.md': { slug: 'feasibility', shortTitle: '可行性审查报告' },
  'product/implementation_plan.md': { slug: 'plan', shortTitle: '分阶段实施计划' },
  'architecture/architecture.md': { slug: 'architecture', shortTitle: '系统架构设计' },
  'adr/README.md': { slug: 'adr', shortTitle: 'ADR 索引' },
  'reference/api-mcp-spec.md': { slug: 'api-mcp-spec', shortTitle: 'API 与 MCP 协议' },
  'reference/security-gitops.md': { slug: 'security-gitops', shortTitle: '安全与 GitOps 设计' },
};

export function* walkWorkspaceDocs(root: string, relativeDir = ''): Generator<string> {
  const dir = path.join(root, relativeDir);
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  entries.sort((a, b) => a.name.localeCompare(b.name));

  for (const entry of entries) {
    if (entry.name.startsWith('.')) continue;
    const relativePath = relativeDir ? `${relativeDir}/${entry.name}` : entry.name;
    if (entry.isDirectory()) {
      yield* walkWorkspaceDocs(root, relativePath);
    } else if (entry.isFile() && /\.md$/i.test(entry.name)) {
      yield relativePath;
    }
  }
}

function* listDocs(root: string) {
  if (!fs.existsSync(root)) return;
  for (const relativePath of walkWorkspaceDocs(root)) {
    const section = relativePath.split('/')[0];
    const category: DocCategory | undefined = relativePath === 'README.md'
      ? '总览'
      : Object.hasOwn(SECTIONS, section) ? SECTIONS[section as keyof typeof SECTIONS] : undefined;
    if (!category) continue;
    const existing = EXISTING_DOCS[relativePath];
    yield { relativePath, category, slug: existing?.slug ?? relativePath, shortTitle: existing?.shortTitle };
  }
}

function readDoc(root: string, doc: { relativePath: string; category: DocCategory; slug: string; shortTitle?: string }): DocDetail {
  const filename = path.posix.basename(doc.relativePath);
  const content = fs.readFileSync(path.join(root, doc.relativePath), 'utf8');
  const tokens = marked.lexer(content);
  const heading = tokens.find((token): token is Tokens.Heading => token.type === 'heading' && token.depth === 1);
  const firstParagraph = tokens.find((token): token is Tokens.Paragraph => token.type === 'paragraph');
  const title = heading?.text || filename.replace(/\.md$/i, '');
  const wordCount = content.replace(/\s+/g, '').length;

  return {
    ...doc,
    filename,
    title,
    shortTitle: doc.shortTitle ?? title,
    summary: (firstParagraph?.text || '').replace(/\s+/g, ' ').slice(0, 160),
    diagramCount: tokens.filter((token) => token.type === 'code' && token.lang === 'mermaid').length,
    wordCount,
    readMinutes: Math.max(1, Math.ceil(wordCount / 550)),
    content,
  };
}

export function findWorkspaceDoc(root: string, slug: string): DocDetail | null {
  for (const doc of listDocs(root)) {
    if (doc.slug === slug) return readDoc(root, doc);
  }
  return null;
}

export function listWorkspaceDocs(root: string): DocMeta[] {
  return Array.from(listDocs(root), (doc) => {
    const { content, ...meta } = readDoc(root, doc);
    return meta;
  });
}

export function countWorkspaceDocs(root: string): number {
  return Array.from(listDocs(root)).length;
}
