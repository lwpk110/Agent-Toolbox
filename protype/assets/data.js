/* Sample data from docs/implementation_plan.md. All state the UI renders lives here. */
window.AT = {
  view: 'home',
  hosts: [
    { name: 'Antigravity', ms: 9, on: true, scope: 'full' },
    { name: 'Claude Code', ms: 11, on: true, scope: 'full' },
    { name: 'Codex CLI', ms: 14, on: true, scope: 'audit' },
    { name: 'OpenCode', ms: 8, on: true, scope: 'audit' }
  ],
  configHost: 'antigravity',
  configs: {
    antigravity: '# 在终端运行一条命令即可接入\nagent-toolbox install --host antigravity',
    claude: '# 在终端运行\nclaude mcp add agent-toolbox -- npx agent-toolbox serve --stdio',
    codex: '# 写入 ~/.codex/config.toml\n[mcp_servers.agent-toolbox]\ncommand = "npx"\nargs = ["agent-toolbox", "serve", "--stdio"]',
    opencode: '// 写入 opencode.json\n{\n  "mcp": {\n    "agent-toolbox": { "type": "remote", "url": "http://127.0.0.1:3000/api/mcp/sse" }\n  }\n}'
  },
  middleware: [
    { id: 'vault', name: 'Vault 注入', en: 'Vault', desc: '调用时自动填入密钥，配置里不存明文', on: true },
    { id: 'quarantine', name: 'Quarantine', en: 'Quarantine', desc: '工具说明被改动时自动拦截', on: true },
    { id: 'hitl', name: 'HITL 审批', en: 'HITL', desc: '危险操作先等你点头', on: true },
    { id: 'redact', name: 'Redaction 脱敏', en: 'Redaction', desc: '返回内容里的密钥自动打码', on: true },
    { id: 'budget', name: 'Token 预算', en: 'Budget', desc: '单轮用量超限时提醒', on: false }
  ],
  services: [
    { id: 'github', name: 'github', proto: 'stdio', ms: 14, state: 'ok', fp: '8f3a', open: true, tools: [
      { name: 'github__create_issue', tok: 340, mode: 'lazy', fp: '4a1c90', hitl: false, what: '新建 Issue' },
      { name: 'github__search_code', tok: 290, mode: 'pinned', fp: '9b2e11', hitl: false, what: '搜索代码' },
      { name: 'github__delete_repo', tok: 310, mode: 'lazy', fp: '3d0f77', hitl: true, what: '删除仓库（危险）' }
    ] },
    { id: 'scraper', name: 'community-scraper', proto: 'sse', ms: 42, state: 'quarantined', fp: 'e904f2', open: true, tools: [
      { name: 'scraper__fetch_page', tok: 420, mode: 'lazy', fp: 'e904f2', hitl: false, what: '抓取网页' }
    ] },
    { id: 'postgres', name: 'postgres', proto: 'stdio', ms: 6, state: 'ok', fp: 'c21d08', open: false, tools: [
      { name: 'postgres__query', tok: 260, mode: 'lazy', fp: 'c21d08', hitl: false, what: '只读查询' },
      { name: 'postgres__drop_table', tok: 180, mode: 'lazy', fp: '71aa3e', hitl: true, what: '删除数据表（危险）' }
    ] },
    { id: 'brave', name: 'brave-search', proto: 'http', ms: 31, state: 'ok', fp: '5be902', open: false, tools: [
      { name: 'brave__web_search', tok: 220, mode: 'lazy', fp: '5be902', hitl: false, what: '网页搜索' }
    ] },
    { id: 'slack', name: 'slack', proto: 'stdio', ms: 19, state: 'ok', fp: '0d4c7f', open: false, tools: [
      { name: 'slack__post_message', tok: 240, mode: 'lazy', fp: '0d4c7f', hitl: false, what: '发送消息' }
    ] }
  ],
  svcFilter: 'all',
  svcQuery: '',
  skills: [
    { id: 'ast-code-refactor', ver: '1.4.0', tok: 980, calls: 48, rate: '98.4%', mounted: true, by: 'Claude Code', what: '跨文件安全重构 TypeScript 代码', fp: 'b71c04',
      md: '---\nname: ast-code-refactor\ntrigger: "当需要执行跨文件 TypeScript AST 安全重构时加载"\n---\n# AST 自动化代码重构标准作业规程 (SOP)\n1. 调用 `skill_ast__analyze_symbols` 分析符号引用图\n2. 验证引用完整性后执行 `skill_ast__apply_codemod`',
      tools: [['skill_ast__analyze_symbols', 210], ['skill_ast__apply_codemod', 150]] },
    { id: 'security-owasp-auditor', ver: '2.1.0', tok: 1420, calls: 0, rate: '—', mounted: false, by: '', what: '按 OWASP 清单扫描依赖与代码漏洞', fp: '6e30a1',
      md: '---\nname: security-owasp-auditor\ntrigger: "当需要做依赖与代码安全审计时加载"\n---\n# OWASP 安全审计 SOP\n1. 调用 `skill_owasp__scan_deps` 扫描依赖\n2. 汇总高危项并给出修复建议',
      tools: [['skill_owasp__scan_deps', 380], ['skill_owasp__report', 220]] },
    { id: 'sql-query-optimizer', ver: '1.1.2', tok: 760, calls: 19, rate: '97.1%', mounted: true, by: 'Codex CLI', what: '检查并优化 SQL 与迁移脚本', fp: '2f88d5',
      md: '---\nname: sql-query-optimizer\ntrigger: "当需要校验数据库迁移或慢查询时加载"\n---\n# SQL 优化 SOP\n1. 解析执行计划\n2. 给出索引建议',
      tools: [['skill_sql__explain', 190]] },
    { id: 'mcp-diagnostics-prober', ver: '0.9.3', tok: 640, calls: 0, rate: '—', mounted: false, by: '', what: '诊断网关握手超时与连接池问题', fp: '9a41c2',
      md: '---\nname: mcp-diagnostics-prober\ntrigger: "当出现 MCP 握手超时或断连时加载"\n---\n# 网关诊断 SOP\n1. 探测下游心跳\n2. 检查连接池重连策略',
      tools: [['skill_diag__probe', 160], ['skill_diag__pool_stats', 140], ['skill_diag__trace', 120]] },
    { id: 'docs-writer', ver: '1.0.0', tok: 520, calls: 0, rate: '—', mounted: false, by: '', what: '按团队模板撰写技术文档', fp: '44b0e7',
      md: '---\nname: docs-writer\ntrigger: "当需要撰写或整理技术文档时加载"\n---\n# 文档写作 SOP\n1. 读取模板\n2. 生成目录与正文', tools: [['skill_docs__template', 110]] },
    { id: 'git-release-helper', ver: '1.2.0', tok: 590, calls: 0, rate: '—', mounted: false, by: '', what: '生成版本说明并打标签', fp: 'd09f63',
      md: '---\nname: git-release-helper\ntrigger: "当需要发布新版本时加载"\n---\n# 发布 SOP\n1. 汇总提交记录\n2. 生成 CHANGELOG', tools: [['skill_git__changelog', 170]] }
  ],
  skillSel: 'ast-code-refactor',
  skillFilter: 'all',
  skillLayer: 'md',
  kb: { query: '如何处理网关握手超时与连接池重连', searched: true, tab: 'memory' },
  memories: [
    { host: 'Antigravity', topic: '网关架构', text: '所有下游 MCP 命名空间统一使用双下划线 __ 隔离' },
    { host: 'Claude Code', topic: '数据库迁移', text: '数据库迁移脚本需先通过 sql-query-optimizer 校验' },
    { host: 'Codex CLI', topic: 'GitOps 安全', text: 'GitHub 同步清单严禁包含明文 Token，统一走 vault://' },
    { host: 'Claude Code', topic: '代码规范', text: 'TypeScript 重构前必须先生成符号引用图' }
  ],
  docs: [
    { file: 'docs/mcp-gateway-architecture.md', chunks: 412 },
    { file: 'docs/security-notes.md', chunks: 268 },
    { file: 'docs/db-migration.md', chunks: 331 },
    { file: 'docs/feasibility_report.md', chunks: 273 }
  ],
  vault: [
    { key: 'GITHUB_PERSONAL_TOKEN', mask: 'ghp_****9a2f', svc: 'github' },
    { key: 'POSTGRES_PROD_DSN', mask: 'post****:5432', svc: 'postgres' },
    { key: 'BRAVE_SEARCH_API_KEY', mask: 'BSA_****77c1', svc: 'brave-search' },
    { key: 'SLACK_BOT_TOKEN', mask: '', svc: 'slack' }
  ],
  gitFile: 'manifest',
  ahead: 2,
  pushed: false,
  sandboxTab: 'sim',
  simHost: 'Claude Code',
  step: 2,
  logSel: 0,
  log: []
};
