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
```

## 新增决策

每项决策使用一个 Markdown 文件，按现有编号顺延，例如 `007-简短主题.md`。正文记录状态、背景、决策和后果，在索引加入对应条目。新文件会自动出现在控制台的 ADR 分组。
