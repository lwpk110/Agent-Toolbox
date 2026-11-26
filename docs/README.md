# Agent-Toolbox 工程文档中心

六个模块的实现范围、运行数据和 API 入口见[当前实现](./guides/current-implementation.md)。

## 文档索引

| 分类目录 | 归档内容 | 现有文档 |
| --- | --- | --- |
| `guides/` 开发指南 | 当前实现、开发流程和操作指南 | [当前实现](./guides/current-implementation.md) |
| `product/` 产品与规划 | 需求、验收、调研和实施路线 | [产品需求](./product/prd.md)、[可行性报告](./product/feasibility_report.md)、[实施计划](./product/implementation_plan.md) |
| `architecture/` 系统架构 | 系统设计、模块和数据流 | [系统架构](./architecture/architecture.md) |
| `adr/` 架构决策记录 | 每项决策独立成文，按编号查阅 | [ADR 索引](./adr/README.md) |
| `reference/` 协议与安全 | API 契约、协议规范、安全和同步设计 | [API 与 MCP 协议设计](./reference/api-mcp-spec.md)、[安全与 GitOps 设计](./reference/security-gitops.md) |

## 阅读顺序

- **运行和开发** 先看当前实现，再阅读系统架构和 API 协议设计。
- **产品和验收** 先读产品需求和实施计划，再对照[交互原型](../prototype/index.html)和[界面线框](../prototype/wireframes.html)。
- **了解设计取舍** 从可行性报告进入架构决策，安全与状态持久化相关设计见安全与 GitOps 文档。

## 新增文档

将 Markdown 放入上表对应的目录，可按专题继续建子目录。用一级标题写文档名称，正文第一段写简短概览。控制台每次打开「可行性报告」时会读取最新文件并分组。新文档的链接由相对于 `docs/` 的文件路径生成。

在此索引补上主要阅读入口。知识库中的「收录工作区 docs/」会递归导入 Markdown，保留各文件的相对路径。

## 术语

| 术语 | 含义 |
| --- | --- |
| MCP 统一入口 | 向宿主集中暴露工具的网关入口。目标设计包括 stdio 代理和 HTTP 传输。 |
| Pinned / Lazy | Pinned 工具随 `tools/list` 暴露，Lazy 工具按需发现和使用。 |
| Quarantine | 工具 Schema 指纹异常时隔离下游服务的机制。 |
| HITL | Human-in-the-Loop，在敏感操作前等待人工审批。 |
| 双层 Skill | Skill 指令（`SKILL.md`）和关联的 MCP 工具。目录包可附带按需读取的资源。 |
| 三位一体检索 | 同次查询返回文档、记忆和推荐 Skill。 |
| Local Vault | 使用 `vault://KEY_NAME` 引用密钥，便于将配置与密钥值分开管理。 |
