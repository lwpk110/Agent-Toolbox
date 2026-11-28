# ADR-005：采用三位一体本地嵌入式向量引擎（RAG + Memory + Smart Routing）

- **状态**：`Accepted`
- **后续修订（2026-11-28）**：目标架构不变；当前迭代按 [ADR-009](./009-lexical-search-first.md) 先交付现有词法检索，暂不引入嵌入模型与向量索引。
- **灵感来源**：`samanhappy/mcphub`（Vector Smart Routing）+ `VeriTeknik/pluggedin-mcp-proxy`（RAG & Persistent Memory）。

## 背景与问题
若分别部署一套 RAG 向量库、一套记忆数据库和一套工具语义路由器，不仅会增加本地部署依赖（如要求 Docker/PostgreSQL/Qdrant），还会导致用户与 Agent 需要发起多次割裂检索。

## 决策与工程后果
- 在 `toolbox-gateway` 内部统一嵌入式运行一套本地向量引擎（默认 LanceDB / SQLite-vec，固定 `1536d` 维度），维护 `knowledge_chunks`、`shared_memories`、`capability_index` 三个逻辑集合。
- 一次查询同时返回三路结果（文档出处 + 跨宿主共享记忆 + 可一键热挂载的推荐 Skill），P95 延迟控制在 `15ms` 内。
- 当离线环境缺少远程 Embedding API 时，支持平滑降级到本地轻量化词法/BM25 检索引擎，确保核心检索与路由能力永不瘫痪。
