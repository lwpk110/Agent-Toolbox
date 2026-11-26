export const DOC_CATEGORIES = ['总览', '开发指南', '产品与规划', '系统架构', 'ADR', '协议与安全'] as const;

export type DocCategory = (typeof DOC_CATEGORIES)[number];

export interface DocMeta {
  slug: string;
  filename: string;
  relativePath: string;
  title: string;
  shortTitle: string;
  category: DocCategory;
  summary: string;
  diagramCount: number;
  wordCount: number;
  readMinutes: number;
}

export interface DocDetail extends DocMeta {
  content: string;
}

export interface TocHeading {
  id: string;
  text: string;
  level: 2 | 3;
}
