# Agent-Toolbox 架构决策记录集（ADR）

此目录记录 Agent-Toolbox 的架构决策及其背景、备选方案和工程后果。

各项决策面向目标架构。仓库中可运行的能力见[当前实现](../guides/current-implementation.md)。

## 决策索引

| 编号 | 决策 | 状态 |
| --- | --- | --- |
| [ADR-001](./001-single-daemon.md) | 单一守护进程与 stdio 代理 | Accepted |
| [ADR-002](./002-pinned-lazy-discovery.md) | Pinned / Lazy 工具暴露 | Accepted |
| [ADR-003](./003-dual-layer-skill.md) | 双层 Skill 动态挂载 | Accepted |
| [ADR-004](./004-schema-integrity.md) | Schema 指纹锁与 Quarantine | Accepted |
| [ADR-005](./005-local-vector-engine.md) | 本地向量引擎 | Accepted |
| [ADR-006](./006-gitops-and-vault.md) | 声明式 GitOps 与 Local Vault | Accepted |
| [ADR-007](./007-cross-agent-gateway.md) | 跨 Agent 的本地工具网关定位 | Accepted |
| [ADR-008](./008-real-path-acceptance.md) | 真实下游验收，演示数据默认关闭 | Accepted |
| [ADR-009](./009-lexical-search-first.md) | 知识库先走现有检索，暂缓向量引擎 | Accepted |
| [ADR-010](./010-unify-mcp-lock.md) | 所有 MCP 入口统一走指纹锁 | Accepted |
| [ADR-011](./011-sync-dedicated-branch.md) | 同步推送专用分支，不覆盖基线锁 | Accepted |

## 决策依赖关系图

```mermaid
flowchart TB
    ADR1["ADR-001<br/>单一守护进程 + stdio-proxy"]
    ADR2["ADR-002<br/>Pinned/Lazy + 三段式元工具"]
    ADR3["ADR-003<br/>双层 Skill 热插拔模型"]
    ADR4["ADR-004<br/>SHA-256 指纹锁与 Quarantine"]
    ADR5["ADR-005<br/>三位一体本地嵌入式向量引擎"]
    ADR6["ADR-006<br/>声明式 GitOps + Local Vault"]

    ADR1 -->|"共享单实例连接池与写锁"| ADR2
    ADR1 -->|"统一管理运行时状态"| ADR3
    ADR1 -->|"独占嵌入式向量库写锁"| ADR5
    ADR5 -->|"语义路由推荐 Lazy 工具/Skill"| ADR2
    ADR5 -->|"语义推荐 Standby Skill"| ADR3
    ADR4 -->|"保护下游 MCP 与 Skill 完整性"| ADR3
    ADR4 -->|"Lockfile 纳入同步校验"| ADR6
    ADR3 -->|"纯文本 SKILL.md 纳入仓库"| ADR6
    ADR5 -->|"只同步源文档、本地重建索引"| ADR6
    ADR7["ADR-007<br/>跨 Agent 本地工具网关"]
    ADR8["ADR-008<br/>真实下游验收"]
    ADR9["ADR-009<br/>知识库先词法检索"]
    ADR10["ADR-010<br/>全部入口走指纹锁"]
    ADR11["ADR-011<br/>同步到专用分支"]

    ADR7 -->|"约束功能取舍"| ADR1
    ADR7 -->|"约束验收标准"| ADR8
    ADR5 -->|"落地顺序"| ADR9
    ADR4 -->|"所有入口一律执行"| ADR10
    ADR6 -->|"推送目标与基线锁"| ADR11
    ADR8 -->|"演示不得冒充真链路"| ADR3
```

## 新增决策

做产品或架构决策时必须先写或同步更新 ADR，并对照 [ADR-007](./007-cross-agent-gateway.md) 的核心定位：本项目是跨 Agent 的本地工具网关。

每项决策使用一个 Markdown 文件，按现有编号顺延，例如 `012-简短主题.md`。正文记录状态、背景、决策和后果，在索引加入对应条目；若修订已有决策，在原文注明日期并互相同步。新文件会自动出现在控制台的 ADR 分组。
