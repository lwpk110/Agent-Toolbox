# ADR-006：采用声明式 GitOps 清单 + Local Vault 引用 + 源文档本地重建索引

- **状态**：`Accepted`

## 背景与问题
跨设备同步面临两个工程冲突：
1. 下游 MCP 配置需要 API Token / 数据库连接串（如 `GITHUB_PERSONAL_TOKEN`、`POSTGRES_PROD_DSN`），直接同步 JSON 会造成 GitHub 凭据泄露；
2. 向量数据库的二进制浮点索引体积庞大（数十至数百 MB），直接入 Git 必然导致仓库膨胀与不可解的二进制合并冲突。

## 决策与工程后果
- **配置与密钥彻底解耦**：GitHub 仓库仅同步纯文本文件——`toolbox.manifest.json`、`toolbox.lock.json`、`skills/*/SKILL.md` 与 `docs/**/*.md`。所有密钥字段强制使用 `vault://KEY_NAME` 符号引用。
- **推送前 3 项硬门禁**：UI 与 CLI 在 `Push` 前强制校验「零明文扫描」「本地 Vault 完整性」「零未处理 Quarantine 隔离项」，任一项不通过直接阻断推送。
- **新设备恢复流程**：在新电脑 `git pull` 后，网关自动检测缺失的 `vault://` 项并引导在本地 Vault 补全，同时基于纯文本 `docs/**/*.md` 在本地毫秒级增量重建 HNSW 向量索引。
