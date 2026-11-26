export type DocCategory = '产品与规划' | '架构与决策' | '协议与安全';

export interface DocMeta {
  slug: string;
  filename: string;
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
