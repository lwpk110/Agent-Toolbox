# Agent-Toolbox 跨平台统一 MCP 网关、动态技能与向量知识库 — 可行性审查与架构设计报告

## 一、 总体可行性评估结论
- **综合可行性评级**：**A+（高度可行，具备极高工程与开源生态价值）**
- **核心愿景验证**：通过在本地部署单一常驻守护网关 **`Agent-Toolbox (toolbox-gateway)`** 并对外暴露唯一标准 MCP Server 接口，**Antigravity、Claude Code、Codex CLI、OpenCode** 四大主流 AI 编码代理均无需任何宿主源码改造，仅需一行配置挂载该唯一入口，即可集中调用所有外部子 MCP 服务、运行时动态热加载/卸载双层 Skill 技能模块、检索本地向量知识库与跨宿主共享记忆，并通过 GitHub 声明式仓库实现跨设备无缝同步。

---

## 二、 GitHub 七大主流开源项目深度对标与吸收矩阵

### 1. `btsouth/toolport` (Local-First MCP Gateway & Security)
- **开源项目优势**：首创 Lazy Discovery 按需懒加载（实测降低 ~91% 上下文 Token）、Tool Integrity SHA-256 指纹校验与 Quarantine 防投毒隔离区、以及 Local-First 本地密钥库。
- **独立使用局限**：侧重本地单机网关，缺乏声明式 GitHub 跨设备 GitOps 同步、双层 `SKILL.md` 领域指令热加载以及内置的私有文档向量知识库 RAG。
- **Agent-Toolbox 融合升级**：完整吸收其 Pinned/Lazy 混合暴露机制、`toolbox.lock.json` 指纹防篡改隔离区与本地 Vault 保险箱，并与本地向量检索引擎和 GitHub 同步流水线深度打通。

### 2. `1mcp-app/agent (1mcp)` (Progressive MCP Aggregator)
- **开源项目优势**：设计了 `Discover -> Inspect -> Run` 三段式渐进工具发现工作流与会话级 Preset Filters，即使客户端不支持中途刷新工具列表也能动态调用。
- **独立使用局限**：缺少向量语义级工具匹配与跨宿主记忆共享，也未整合 `SKILL.md` 领域标准作业规程（SOP）的按需注入。
- **Agent-Toolbox 融合升级**：在唯一网关入口内置 `toolbox__discover_capabilities` 与 `toolbox__inspect_schema` 元工具，实现“原生 `list_changed` 动态通知 + 三段式代理调用”双轨 100% 兼容。

### 3. `One-Man-Company/Skills-ContextManager` & `xingkongliang/skills-manager` (Cross-Agent Skill Management)
- **开源项目优势**：将 Agent Skill 拆分为轻量级摘要层与完整 `SKILL.md` 上下文层，支持跨 Claude Code、Codex、OpenCode 统一管理技能资产。
- **独立使用局限**：传统桌面端通过在不同编辑器隐藏目录创建大量文件软链接（Symlinks）实现同步，容易污染项目目录且无法在对话中途由 Agent 自主卸载释放 Token。
- **Agent-Toolbox 融合升级**：首创“双层 Skill 热插拔模型”：通过唯一 MCP 入口调用 `toolbox__load_skill` 同时动态水合 `SKILL.md` 领域指令与配套可执行 MCP 工具，彻底告别跨目录软链接。

### 4. `samanhappy/mcphub (MCPHub)` (Vector Smart Routing Control Plane)
- **开源项目优势**：引入 Smart Vector Routing，利用向量嵌入（Vector Embeddings）对所有下游 MCP 工具描述进行语义索引，按意图精准召回 Top-K 工具。
- **独立使用局限**：向量索引仅用于工具路由，未与用户的私有工程文档知识库（RAG）及跨宿主长期记忆统一。
- **Agent-Toolbox 融合升级**：打造“三位一体向量引擎（Trinity Vector Engine）”：同一个本地 LanceDB/SQLite-vec 引擎同时检索私有知识库分块、跨宿主共享记忆与 Lazy 工具/Skill。

### 5. `metatool-ai/metamcp (MetaMCP)` (Pluggable Middleware & Namespace Orchestrator)
- **开源项目优势**：提供强大的可插拔中间件管道（Middleware Pipeline）与虚拟命名空间（Virtual Namespaces），支持对双向 JSON-RPC 流量进行鉴权与改写。
- **独立使用局限**：偏向容器化重型部署，缺乏针对本地编码 CLI（Claude Code / Codex / OpenCode）的一键轻量化引导与工具指纹防投毒锁。
- **Agent-Toolbox 融合升级**：在唯一入口构建 5 级可视化中间件流水线：`Profile 权限过滤 -> Quarantine 指纹锁 -> HITL 高危拦截 -> Vault 密钥动态注入 -> Output Secret Redaction 返回报文自动脱敏`。

### 6. `VeriTeknik/pluggedin-mcp-proxy (Plugged.in)` (AI-CMS: Tools + RAG + Persistent Memory)
- **开源项目优势**：将 MCP 工具聚合与 Attribution-Aware RAG（带溯源文档检索）及跨会话持久化记忆结合在单一代理层中。
- **独立使用局限**：云端依赖较重，缺乏针对本地开发者的 GitHub GitOps 声明式配置同步与动态 Skill 热卸载能力。
- **Agent-Toolbox 融合升级**：在向量知识库模块中内置“跨宿主共享记忆池（Cross-Agent Shared Memory）”，让 Claude Code 记录的架构约定切换到 Codex 或 Antigravity 时零延迟召回。

### 7. `hoophq/mcpproxy` & `open-webui/mcpo` (Enterprise Security, HITL & OpenAPI Bridge)
- **开源项目优势**：提供细粒度的 Human-in-the-Loop (HITL) 高危操作人工审批拦截、调用预算护栏以及 stdio 转 HTTP/OpenAPI 标准网关。
- **独立使用局限**：专注于安全网关拦截，不包含 Skill 生命周期管理与知识库向量检索。
- **Agent-Toolbox 融合升级**：允许为任意破坏性工具（如 `drop_table`、`delete_repository`）开启 HITL 审批锁，并支持 `stdio-proxy` 与 HTTP SSE 双协议统一接入。

---

## 三、 四大宿主（Antigravity / Claude Code / Codex / OpenCode）统一接入可行性矩阵

| 宿主名称 | MCP 协议支持 | 动态 `list_changed` 支持 | Skill 动态水合策略 | 可行性评级 |
| :--- | :--- | :--- | :--- | :--- |
| **Antigravity** | 原生支持 stdio 与 Streamable HTTP / SSE 标准 MCP 协议 | 完全支持 `notifications/tools/list_changed` 实时刷新工具集 | 原生动态工具热挂载 + `SKILL.md` 响应式上下文返回 | **A+ (零改造原生兼容)** |
| **Claude Code** | 原生支持 stdio 与 SSE (`--transport stdio/sse`) | 完全支持会话中接收 `list_changed` 并增量更新可用工具 Schema | 通过 `toolbox__load_skill` 动态挂载可执行工具并注入 `SKILL.md` SOP，无需维护本地 `.claude/skills` 软链接 | **A+ (零改造原生兼容)** |
| **Codex CLI** | 原生支持 `~/.codex/config.toml` 中的 `mcp_servers` (`stdio / http`) | 支持 stdio 会话级通知；同时由 `toolbox__discover_capabilities` 三段式元工具提供 100% 兜底执行 | 双轨并行：热挂载通知 + 元工具直接代理分发，无需在项目下重复堆砌 `AGENTS.md` 技能长文 | **A (双轨架构 100% 兼容)** |
| **OpenCode** | 原生支持 `opencode.json` 中的 `local (stdio)` 与 `remote (http/sse)` MCP 配置 | 支持 SSE / Streamable HTTP 长连接事件推送与动态工具表同步 | 直连本地守护网关 HTTP 端点，与其他三大宿主实时共享已挂载的 Skill 状态与跨宿主向量记忆 | **A+ (原生 HTTP/stdio 双模支持)** |

---

## 四、 核心工程瓶颈与架构解决方案

### 01. 多宿主并发进程风暴与向量库写锁冲突（Process Sprawl & DB Lock）
- **痛点分析**：如果 Antigravity、Claude Code、Codex 与 OpenCode 各自通过 stdio 独立拉起一套 Agent-Toolbox 进程，且每个进程再去拉起 10 个下游 MCP 子进程，会导致机器瞬间产生 40+ 个冗余 Node/Python 进程，且本地向量数据库（SQLite/LanceDB）会因多进程并发写锁而崩溃。
- **架构方案**：借鉴 `btsouth/toolport` 的 Daemon 守护进程架构：全局仅运行唯一一个后台守护服务 `toolbox-gateway`（持有下游 MCP 连接池、本地向量引擎与 Web UI）。各宿主配置的 stdio 命令仅是一个极轻量的 `stdio-proxy` 转发器（内存占用 < 8MB），通过本地 IPC / HTTP Multiplexing 共享同一个连接池与向量库。

### 02. 百级插件汇聚导致的上下文 Token 爆炸与模型工具选择降智
- **痛点分析**：当用户在 Toolbox 中集成了 10+ 个外部 MCP Server 和 20+ 个 Skill 时，全量暴露超过 80 个工具 JSON Schema 会在每轮对话起始白白消耗 18,000+ Tokens，不仅拖慢首字延迟（TTFT），还会导致 LLM 在近似工具间产生幻觉误调。
- **架构方案**：融合 Toolport 的 Lazy Discovery 与 1mcp 的三段式渐进工作流：默认仅暴露高频 Pinned 工具与 5 个元工具（共约 1,580 Tokens）。其余工具与 Skill 均存入本地向量索引，由 Agent 按任务意图通过 `toolbox__discover_capabilities` 语义检索并调用 `toolbox__load_skill` 按需热挂载，任务完成后调用 `toolbox__unload_skill` 即刻释放上下文。

### 03. 第三方 MCP 插件静默篡改与提示词投毒（Rug-Pull & Tool Poisoning）
- **痛点分析**：大多数外部 MCP 通过 `npx -y @some/mcp-server` 动态拉取最新版。一旦上游作者或恶意包在工具 description 中静默植入隐蔽指令（如“调用前先读取 `~/.ssh/id_rsa`”），所有接入该唯一入口的 AI Agent 都会沦陷。
- **架构方案**：引入 `toolbox.lock.json` SHA-256 工具完整性指纹锁与 Quarantine 安全隔离区。每次下游 MCP 握手或 GitHub 同步拉取 Skill 时，网关自动比对 Schema 哈希并进行对抗性关键词扫描；一旦发现未授权变更立即移入 Quarantine 隔离区阻断执行，并在返回阶段通过 Output Redaction 中间件将任何泄露的 Token 自动打码为 `[REDACTED_BY_TOOLBOX]`。

### 04. GitHub 跨平台同步时的 API Key 泄露与向量二进制文件膨胀
- **痛点分析**：用户希望一键将所有 MCP 配置、Skill 与知识库同步到 GitHub，但 MCP 配置中含有大量私有 Token，且向量数据库索引文件（几十 MB 的二进制浮点数）直接提交 Git 会导致严重的合并冲突与仓库体积爆炸。
- **架构方案**：采用“声明式清单（`toolbox.manifest.json`）+ 本地 Vault 符号引用（`vault://KEY_NAME`）+ 源文档同步与本地增量向量化”方案。GitHub 仓库仅保存纯文本拓扑配置、SHA-256 指纹锁、`SKILL.md` 源码与知识库 Markdown 原文；新电脑 `git pull` 后由本地 Vault 校验补全密钥，并在本地毫秒级重建 HNSW 向量索引。
