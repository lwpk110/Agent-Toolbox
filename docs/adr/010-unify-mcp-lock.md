# ADR-010：所有 MCP 入口统一走指纹锁

- **状态**：`Accepted`
- **日期**：2026-11-28
- **关联**：[ADR-004](./004-schema-integrity.md)、[ADR-007](./007-cross-agent-gateway.md)

## 背景与问题

[ADR-004](./004-schema-integrity.md) 要求在握手拉清单和 `tools/call` 前校验 SHA-256 指纹，不一致则隔离并返回 `-32001`，不得转发到下游。仓库后来并存两条 MCP 路径：`/api/mcp/messages`（及 stdio 桥）走指纹锁；`/api/mcp` 的 Streamable HTTP 路径经由另一套下游连接池，一度绕过锁校验。对跨 Agent 网关而言，宿主选哪条 URL 不应改变安全保证。

## 备选方案对比

| 方案 | 优点 | 缺点 | 结论 |
| :--- | :--- | :--- | :--- |
| **方案 A**：维持两条路径，只在文档中建议使用带锁的入口 | 改动小 | 安全策略可被换 URL 绕过，违反 ADR-004 | 否决 |
| **方案 B**：删除 `/api/mcp`，只保留 messages / stdio | 入口单一 | 已按 Streamable HTTP 接入的宿主会中断 | 否决 |
| **方案 C（采用）**：保留多种传输，但所有入口共用同一套指纹锁与转发逻辑 | 兼容 stdio 与 HTTP 宿主，安全策略一致 | 需要合并实现并做双入口回归 | **采纳** |

## 决策与工程后果

- `/api/mcp`、`/api/mcp/messages` 与 stdio 桥必须经过同一套 Schema 锁、Quarantine 与审计；任一入口在指纹不匹配时都不得转发。
- 统一工作可与 Skill、知识库并行，但不得被其它功能长期搁置，因为这是安全缺口而不是新功能。
- 回归须在两条 HTTP 路径和 stdio 入口上同时覆盖隔离拦截与正常转发。
