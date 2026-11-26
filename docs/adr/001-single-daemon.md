# ADR-001：采用单一常驻守护进程 + 轻量 `stdio-proxy` 转发桥

- **状态**：`Accepted`
- **关联痛点**：多宿主（Antigravity / Claude Code / Codex CLI / OpenCode）并发启动 MCP 带来的进程风暴与本地数据库写锁冲突。

## 背景与问题
四大 AI 编码宿主均支持通过 `stdio` 启动本地 MCP Server。若每个宿主都直接运行一份完整的 Agent-Toolbox 网关实例，且网关下方又连接 5–10 个外部 MCP 子进程，将导致单机同时存在 25–45 个重复常驻进程，同时多个网关进程竞争本地 SQLite-vec / LanceDB 写锁，引发 `SQLITE_BUSY` 崩溃。

## 备选方案对比

| 方案 | 优点 | 缺点 | 结论 |
| :--- | :--- | :--- | :--- |
| **方案 A**：各宿主独立拉起完整网关实例 | 架构最简单，无需进程间通信 | 进程数乘数级爆炸、内存飙升、向量库与 Vault 并发写冲突、跨宿主记忆无法实时同步 | 否决 |
| **方案 B**：强制所有宿主仅使用远程 HTTP/SSE | 服务端单实例，无多进程问题 | 部分 CLI 客户端对纯 `stdio` 体验更佳，且要求用户提前手工启动后台服务 | 否决 |
| **方案 C（采用）**：单一守护进程 `toolbox-gateway` + 轻量 `stdio-proxy` 按需拉起 | 全局仅 1 份连接池与向量库写锁；`stdio-proxy` 内存 < 8MB；同时兼容 `stdio` 与 `HTTP/SSE` 宿主；首次调用自动后台守护化 | 需要维护 PID 文件锁、健康探测与跨进程转发协议 | **采纳** |

## 决策与工程后果
- 宿主在 `stdio` 配置中仅运行 `npx agent-toolbox serve --stdio`，该进程作为无状态薄桥接层将 JSON-RPC 帧转发至本地唯一 `toolbox-gateway`。
- OpenCode 等原生偏好 HTTP 的宿主可直接连接 `http://127.0.0.1:3000/api/mcp/sse`，与 `stdio` 宿主共享同一内存态连接池与跨宿主记忆。
- **代价**：需要实现健壮的 `daemon.lock` 过期清理（检测僵尸 PID）与守护进程优雅停机信号处理（`SIGINT/SIGTERM`）。
