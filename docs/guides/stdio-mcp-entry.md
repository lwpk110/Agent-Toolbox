# stdio MCP 入口与真实下游联调

入口是 `bun src/cli/serve-stdio.ts`，也可以运行 `bun run serve:stdio`。桥只做逐行 JSON-RPC → HTTP 转发和 SSE 通知转写；持久化、审计、元工具和下游进程均由唯一网关管理。stdout 仅包含 JSON-RPC，诊断写 stderr。

网关通过 `PORT` 和 `TOOLBOX_DATA_FILE` 配置监听端口及状态文件。桥通过 `TOOLBOX_GATEWAY_URL` 配置网关地址，默认 `http://127.0.0.1:3000`；`TOOLBOX_HOST` 优先于 initialize 的 `clientInfo.name`。HTTP 客户端也可使用 initialize 返回的 `mcp-session-id` 继续携带宿主身份。

默认 fixture 服务使用 Node + tsx 启动 `tests/fixtures/echo-mcp.ts`，先握手，再从真实子进程读取 `tools/list`；`fixture__echo` 默认 Pinned 且只读。配置记录支持 `commandOrUrl`、`args`、`cwd`、`env`。原有演示服务保留元数据，但不会被当作已连接的真实服务执行。下游退出、握手失败或 3 秒超时返回 `-32006`，不会回退到沙盒。断开的会话在当前网关生命周期内保持失败，重启网关会重新握手。

六个元工具由网关实现；Pinned 工具和挂载到当前宿主的 Skill 工具取自 store。没有对应真实下游的 Skill 演示工具调用返回不可用。`executeRpc` 仅用于原有 `/api/v1/sandbox/rpc` 演示接口。

## 在允许监听端口及访问模型的环境联调

终端一创建临时目录和独立配置，再启动网关（以下路径以本仓库为例）：

```bash
toolbox_demo_dir=$(mktemp -d)
mkdir -p "$toolbox_demo_dir/codex"
cat > "$toolbox_demo_dir/codex/config.toml" <<'TOML'
[mcp_servers.agent-toolbox]
command = "bun"
args = ["/workspace/Agent-Toolbox/src/cli/serve-stdio.ts"]
env = { TOOLBOX_HOST = "Codex CLI" }
# Codex 默认拒绝调用 MCP 工具，不加这行会报 requires approval
default_tools_approval_mode = "approve"
TOML
printf '联调目录：%s\n' "$toolbox_demo_dir"
TOOLBOX_DATA_FILE="$toolbox_demo_dir/gateway-state.json" bun run dev
```

终端二把 `<联调目录>` 替换为上述输出的目录；如 Codex 要求登录，在这个临时 CODEX_HOME 下配置认证。

```bash
CODEX_HOME=<联调目录>/codex codex exec \
  "列出 agent-toolbox 提供的工具，然后调用 fixture__echo，参数 text 为 hello-from-codex"
```

应能发现 `fixture__echo`，调用响应的文本内含下游原始 MCP 结果，其 `content[0].text` 是 `hello-from-codex`，`_meta.pid` 是下游 PID。网关 stderr 应有 `[downstream:fixture] [fixture-echo pid=...] tools/call text=hello-from-codex`。打开控制台审计，宿主应为 `Codex CLI`。停止并用相同 `TOOLBOX_DATA_FILE` 重启网关，再调用；下游重新启动，已有审计仍在。

也可直接检查 HTTP：

```bash
curl -s http://127.0.0.1:3000/api/mcp/messages \
  -H 'content-type: application/json' -H 'x-toolbox-host: Codex CLI' \
  -d '{"jsonrpc":"2.0","id":"list","method":"tools/list"}'
curl -s http://127.0.0.1:3000/api/mcp/messages \
  -H 'content-type: application/json' -H 'x-toolbox-host: Codex CLI' \
  -d '{"jsonrpc":"2.0","id":"echo","method":"tools/call","params":{"name":"fixture__echo","arguments":{"text":"hello-from-codex"}}}'
curl -s http://127.0.0.1:3000/api/v1/state
```

## 本次验证记录

按 TDD 逐步运行协议、子进程和桥测试。真实下游验证使用生产网关运行时（Node + tsx），将 `executeRpc` 替换为立即抛错以证明不走沙盒；真实子进程不作 mock。`tests/mcp-process.test.ts` 验证回显、不同 PID、审计、杀掉进程后 `-32006`、恢复存储并重新握手；另测握手失败、超时、工具 `isError` 和 Bun 桥离线存活/EOF。

实际日志片段（PID 随运行变化）：

```text
[downstream:fixture] [fixture-echo pid=22] tools/call text=hello-from-codex
[downstream:fixture] [fixture-echo pid=40] tools/call text=after-restart
```

实际断开响应：

```json
{"jsonrpc":"2.0","id":"dead","error":{"code":-32006,"message":"Downstream fixture unavailable: process exited (SIGTERM)"}}
```

当前执行沙箱禁止本机监听和外网连接。HTTP/stdio/SSE 的五个真实端口集成测试仅在探测到 OS `EPERM` / `EACCES` 时明确跳过；正常环境不跳过，其他错误仍使测试失败。它们覆盖随机端口 HTTP 网关、真实下游/审计恢复、stdio 正常转发、宿主身份、SSE 通知和重连。已运行的真实进程测试不依赖网络，不跳过。

本次在 `/tmp/toolbox-codex-smoke-hmej5rxv/codex/config.toml` 创建临时 Codex 配置，未改动全局配置。实际 `bun run dev` 启动被拒：

```text
Error: listen EPERM: operation not permitted /tmp/tsx-1000/11.pipe
error: script "dev" exited with code 1
```

实际 `codex exec` 因网络被拒而无法完成：

```text
failed to connect to Responses WebSocket
Falling back from WebSockets to HTTPS transport.
stream disconnected before completion: Operation not permitted (os error 1)
```

因此，本次没有声称 Codex → HTTP 网关的完整联调通过；需在允许监听端口及访问模型的环境执行上述命令完成验收。
