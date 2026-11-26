# ADR-003：采用双层 Skill 动态水合模型替代跨编辑器目录软链接

- **状态**：`Accepted`
- **灵感来源**：`One-Man-Company/Skills-ContextManager` & `xingkongliang/skills-manager`。

## 背景与问题
目前主流 Agent 技能管理工具通常在 `~/.claude/skills`、`~/.codex/AGENTS.md`、项目根目录创建大量文件软链接（Symlinks）。这种方式存在三大弊端：
1. 污染项目 Git 工作区，跨平台（Windows/macOS/Linux）软链接行为不一致；
2. 所有技能文本静态塞入系统提示词，无法在任务结束后中途卸载释放 Token；
3. 只能同步文本指令（`SKILL.md`），无法随指令同步按需启停对应的可执行工具。

## 决策与工程后果
- 将 Skill 抽象为网关托管的**双层结构（Dual-Layer Skill）**：
  - **Layer 1（SOP 指令层）**：标准 Frontmatter + Markdown 作业规程 `SKILL.md`；
  - **Layer 2（可执行工具层）**：该技能绑定的命名空间工具集（如 `skill_ast__analyze_symbols`、`skill_ast__apply_codemod`）。
- 挂载（`Mount`）时通过唯一 MCP 入口同时返回 `SKILL.md` 指令正文并动态注册 Layer 2 工具；卸载（`Unmount`）时两者同步回收并立即释放对应 Token。
- **代价**：需要在网关侧实现 Skill 生命周期状态机、SHA-256 指纹校验以及与 Web UI 的双向实时同步。
