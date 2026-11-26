# Agent-Toolbox

Agent-Toolbox 是面向 Antigravity、Claude Code、Codex CLI 和 OpenCode 的 MCP 网关控制台。当前仓库提供可在本地运行的 Web 控制台和内存网关，可体验服务与工具管理、Skill 目录包、知识检索、Vault、同步演示和 JSON-RPC 沙箱。

## 本地启动

在仓库根目录运行，使用 Node.js 22.12+（或 24 LTS）和 Bun。Bun 根据仓库中的 `bun.lock` 安装依赖。

```sh
bun install --frozen-lockfile
bun run dev
```

| 入口 | 地址 |
| --- | --- |
| Web 控制台 | [http://localhost:3000/](http://localhost:3000/) |
| 交互原型 | [http://localhost:3000/prototype/](http://localhost:3000/prototype/) |
| 健康检查 | [http://localhost:3000/health](http://localhost:3000/health) |

依赖已安装时，也可用 `npm run dev` 启动。默认启动无需 API 密钥。可用进程环境变量 `PORT` 更改端口，Vault 的可选变量见 [.env.example](./.env.example)。

## 项目结构

| 路径 | 内容 |
| --- | --- |
| [server.ts](./server.ts) | Express 入口，提供控制台 API、SSE、MCP 演示端点、文档和原型预览。开发时挂载 Vite 中间件。 |
| [src/main.tsx](./src/main.tsx)、[src/App.tsx](./src/App.tsx) | React 入口、全局导航、状态加载与事件订阅。 |
| [src/components/](./src/components/) | 六个控制台页面、共享组件、Markdown 和 Mermaid 渲染。 |
| [src/lib/api.ts](./src/lib/api.ts)、[src/types/](./src/types/) | 前端 API 客户端和前后端共用的 TypeScript 类型。 |
| [src/server/gatewayStore.ts](./src/server/gatewayStore.ts) | 网关内存状态、演示数据和业务逻辑。 |
| [docs/](./docs/) | 当前实现、产品需求、架构、协议、安全设计和实施计划。 |
| [prototype/](./prototype/) | 静态交互原型、线框、主题预览和设计交接。原预览地址 `/protype/` 仍可访问。 |
| [skills/](./skills/) | 可从工作区导入的 Skill 目录包，每个包以 `SKILL.md` 为入口。 |

## 构建与检查

```sh
bun run lint
bun run build
bun run start
```

`lint` 运行 TypeScript 类型检查，`build` 构建 `dist/` 并再次检查类型。停止开发服务后，可通过 `start` 在同一端口验证 Express 提供的生产构建。这些脚本也支持 `npm run`。运行目录需要保留 `docs/`、`skills/` 和 `prototype/`，分别供文档浏览、Skill 导入和原型预览使用。

## 文档

- 查看六个模块的实现范围、API 入口和运行数据生命周期。[当前实现](./docs/guides/current-implementation.md)
- 按需求、架构、协议和实施计划查阅工程文档。[工程文档中心](./docs/README.md)
- 查看交互原型、线框与样式交接材料。[原型目录](./prototype/README.md)
