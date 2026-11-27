# 当前实现

Agent-Toolbox 由一个 Express 进程提供 React 控制台、REST API、服务端事件和文档。应用从仓库根目录运行，初始网关状态由 `src/server/gatewayStore.ts` 中的示例数据生成。

## 模块与实现范围

| 模块 | 当前可用 | 目标设计 |
| --- | --- | --- |
| 总览 | 查看网关快照，管理宿主配置、权限和中间件，复制接入示例 | 自动启动守护进程及四个宿主的完整联调 |
| MCP 网关 | 管理服务和工具配置、导入 MCP JSON、切换 Pinned / Lazy、演练隔离和审批。stdio MCP 真实会话、工具发现与转发；默认提供 fixture__echo。沙箱演示保留 | 扩展所有下游、持久化 Schema 锁文件 |
| Skill 中心 | 创建、导入 `skills/` 下的目录包，编辑运行时副本、挂载或卸载 Skill，通过沙箱读取包内资源 | 为其余 Skill 工具配置真实下游执行器 |
| 知识库 | 导入 Markdown、管理文档和记忆，按关键词和内置同义词检索文档、记忆与 Skill，查看包含预置数据的统计图 | 使用嵌入模型、向量索引与持久化数据 |
| 同步与 Vault | 用 AES-256-GCM 加密落盘密钥并展示掩码，生成配置清单，执行推送前检查和同步演示 | 通过 GitHub 实际拉取、推送和恢复 |
| 沙箱与文档 | 运行预设或自定义 JSON-RPC 演练，查看审计记录和工程文档 | 更多真实宿主联调 |

宿主与工具配置、Skill 编辑、知识库内容、审计记录和加密 Vault 通过原子 JSON 写入持久化，重启后恢复。导入工作区文档或 Skill 会读取磁盘并创建内存副本，控制台中的编辑作用于该副本。

## 代码入口与数据流

| 入口 | 从这里查找 |
| --- | --- |
| `src/main.tsx`、`src/App.tsx` | React 启动、页面导航、状态快照、事件订阅 |
| `src/components/` | 各模块视图、共有控件、文档和图表渲染 |
| `src/lib/api.ts`、`src/types/` | 前端请求、响应类型、网关和文档类型 |
| `server.ts` | HTTP 路由、文档注册表、工作区文件读取和静态资源 |
| `src/server/gatewayStore.ts` | 状态、持久化、RPC 演练、知识检索、Vault 和同步逻辑 |
| `src/server/mcpHandler.ts`、`src/server/downstreamMcp.ts` | MCP JSON-RPC 处理与真实下游 stdio 会话 |
| `src/cli/serve-stdio.ts` | 宿主 stdio → HTTP 薄桥与 SSE 通知转发 |

前端通过 `GET /api/v1/state` 拉取快照，通过 `/api/v1/*` 提交变更，并订阅 `GET /api/v1/events`。Express 将业务操作交给 `GatewayStore`，并把它发出的事件转为 SSE。

## 接口速查

| 请求 | 用途 |
| --- | --- |
| `GET /health` | 查询进程状态、网关指标和已登记文档数量 |
| `GET /api/v1/state`、`GET /api/v1/events` | 获取控制台快照，订阅管理事件 |
| `POST /api/v1/sandbox/rpc` | 执行沙箱步骤或自定义方法，并返回包含审计记录的快照 |
| `GET /api/mcp/sse`、`POST /api/mcp/messages` | MCP SSE 通知与 JSON-RPC 请求（支持批量）；通知返回 202，其余请求回传原始 id。 |
| `GET /api/docs`、`GET /api/docs/:slug`、`GET /raw/:slug` | 读取自动发现的文档索引、详情和 Markdown 原文 |
| `GET /prototype/` | 预览静态交互原型，兼容旧路径 `/protype/` |

REST 管理接口通常返回 `{ ok, data, meta }`。具体参数和状态码以 `server.ts` 的路由为准。预期的宿主传输、类型和错误码见 [API 与 MCP 协议设计](../reference/api-mcp-spec.md)。

## 维护文档

控制台从各分类目录读取 Markdown。文档归档和命名约定见[文档索引](../README.md)。

真实 stdio 入口、临时 Codex 配置、联调日志和环境限制见 [stdio MCP 联调](stdio-mcp-entry.md)。

## 数据来源开关

网关会为数据标记 `real`、`demo` 或 `fixture` 来源。真实数据和用户运行时添加的数据始终保留；开关只影响控制台展示和 MCP 工具暴露。首次创建数据文件时，可用环境变量设置默认值：

```bash
TOOLBOX_DEMO_DATA=on   # 首次默认显示演示数据；off 或未设置则隐藏
TOOLBOX_FIXTURE=off    # 首次默认隐藏测试夹具；未设置则显示
```

环境变量只参与首次默认值，已经持久化的设置以控制台的“数据来源”开关及 `GET/PUT /api/v1/settings/visibility` 为准。测试应使用临时 `TOOLBOX_DATA_FILE` 和 `TOOLBOX_LOCK_FILE`，并在需要断言内置演示种子时显式调用 `store.setVisibility({ showDemo: true })`；需要测试夹具过滤时再设置 `showFixtures`。
