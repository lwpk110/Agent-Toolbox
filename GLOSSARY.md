# Agent-Toolbox 领域术语

Agent-Toolbox 为多个 AI Agent 宿主提供统一的工具接入、Skill 挂载、知识检索和执行治理。

## 网关与执行

**宿主配置（Host Profile）**  
标识一种 Agent 接入及其权限范围的持久配置。同一宿主配置可以建立多个**宿主会话**。

**宿主会话（Host Session）**  
一次已建立的网关连接及其有效权限、工具视图和**Skill 挂载**。

**MCP 服务（MCP Server）**  
在网关中拥有唯一命名空间、提供工具或其他 MCP 能力的下游服务。

**工具暴露策略（Pinned / Lazy）**  
决定可见工具何时呈现给宿主。Pinned 工具随默认工具列表提供，Lazy 工具通过按需发现呈现。

**工具调用（Tool Invocation）**  
一个**宿主会话**对指定工具发起的一次执行请求，具有独立的授权、执行及结果状态。

**可信 Schema 基准（Trusted Schema Baseline）**  
经过信任确认的下游工具 Schema 版本，供后续校验比较。

**隔离记录（Quarantine Case）**  
对观测到的 Schema 与**可信 Schema 基准**之间差异的待处置记录。

**人工审批（HITL Approval）**  
操作者对一笔特定**工具调用**作出的批准或拒绝。

## Skill 与知识

**Skill 包（Skill Bundle）**  
由 `SKILL.md`、关联工具和按需资源组成的可独立管理的能力包。

**Skill 挂载（Skill Mount）**  
将一个已校验的 **Skill 包**修订绑定到**宿主会话**的临时状态。

**知识源（Knowledge Source）**  
可被收录、重新读取并用于构建检索索引的原始内容。

**共享记忆（Shared Memory）**  
由宿主写入、按项目或全局范围共享的一条知识记录。

**三位一体检索（Trinity Search）**  
一次查询返回知识源片段、共享记忆和能力推荐，三类结果保留各自的出处。

## 凭据与同步

**密钥引用（Secret Reference）**  
用来指向 Local Vault 中某项凭据的符号名，例如 `vault://KEY_NAME`。

**同步清单（Sync Manifest）**  
用于跨设备恢复的声明式配置，其中凭据用**密钥引用**表达。
