# ADR-002：采用 `Pinned / Lazy` 混合暴露与三段式渐进工作流

- **状态**：`Accepted`
- **灵感来源**：`btsouth/toolport`（Lazy Discovery）+ `1mcp-app/agent`（`Discover → Inspect → Run`）。

## 背景与问题
随着接入的外部 MCP Server 与 Skill 增长，全量在 `tools/list` 中暴露 14–80+ 工具 JSON Schema 会占用 `18,170+` Tokens/轮。一方面极大浪费上下文窗口与推理成本，另一方面会导致 LLM 在相似工具间产生幻觉误调。同时，不同宿主对 MCP 动态通知 `notifications/tools/list_changed` 的实现成熟度不一（如 Codex CLI 在部分模式下依赖静态工具表）。

## 备选方案对比

| 方案 | Token 节省 | 宿主兼容性 | 结论 |
| :--- | :--- | :--- | :--- |
| **方案 A**：全量暴露所有工具 | 0%（约 18.2k Token） | 100% | 否决 |
| **方案 B**：纯 `notifications/tools/list_changed` 动态推送 | ~90% | 不支持中途刷新工具列表的宿主无法调用新工具 | 否决 |
| **方案 C（采用）**：`Pinned` 高频工具与内置元工具常驻，其余 `Lazy` 按需发现，同时支持 `list_changed` 与代理执行 | **89.7%–91.3%** | 四个目标宿主 | **采纳** |

## 决策与工程后果
- 网关常驻元工具见[协议设计](../reference/api-mcp-spec.md)。设计通过这些工具支持能力发现、Schema 检查、Skill 挂载与资源读取以及知识检索。
- 用户可在「MCP 网关与安全」界面对任意单个工具实时切换 `Pinned` / `Lazy`，总览面板实时重算节省比例。
- 对支持 `list_changed` 的宿主（Antigravity / Claude Code / OpenCode）挂载后直接注入工具定义；对受限客户端同时保留 `toolbox__inspect_schema` + 代理调用兜底。
