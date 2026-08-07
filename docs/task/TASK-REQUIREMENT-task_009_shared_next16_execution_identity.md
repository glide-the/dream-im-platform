# `TASK-N16-REC-001` 已填充提示词

> 基础模板：`docs/task/TASK-REQUIREMENT-FORMAT.md`
> 这是生成提示词，不是正式任务文档。
> task-stage Issue：[SUO-358](/SUO/issues/SUO-358)
> 权威输入：`docs/design/design_002_next16_tailwind_postcss_baseline_recovery.md`、`docs/issue/ISSUES_next16_tailwind_postcss_baseline_recovery.md`

Optimized Prompt:

你是资深软件交付任务设计师。请仅依据 `N16-REC-001`、恢复设计 §2、§3、§5.1、§5.5、§6–§9 与下列已填充事实，生成
`docs/task/task_009_shared_next16_execution_identity.md`。不得实现代码、不得编排 stage、不得扩展上游设计范围。

- Task ID：`TASK-N16-REC-001`；关联 Issue：`N16-REC-001`；domain：`shared`；上游类型：`tooling`；优先级：P0。
- domain 归一化说明：task 命名只允许 `frontend`、`backend`、`full-stack`、`shared`；本 gate 横跨执行环境、包管理和仓库保护，因此使用 `shared`，不改变上游 `tooling` 类型。
- 标签：`next16`、`tailwind`、`postcss`、`recovery`、`gate-r0`。
- 唯一规划主责：`TaskDesignAgent`；具体执行 owner 由 StagePlanner 后续唯一绑定，本任务不派工。
- 目标：从唯一 `$PROJECT_ROOT=/Users/dmeck/project/ink-admin-memory` 固化 cwd、Git toplevel、Paperclip workspace cwd、Node/pnpm、pnpm root、四个模块解析路径与初始 dirty-file 保护快照，只裁定是否准入 R1。
- 输入：当前 checkout、恢复设计、Issue 清单；已知工作树可能有其他 Agent 的 `docs/stage/**`、`docs/exec/**` 等改动，必须原样保护。
- 输出：包含命令、cwd/root 比对、版本、`require.resolve` 路径、`git status --short`、允许候选文件 hash/scoped diff 的 R0 证据包，以及明确 `PASS` 或 `[BLOCKED]`。
- 前置依赖：无。只有 R0 PASS 才解锁 `TASK-N16-REC-002`；不允许与 R1–R3 并行。
- 允许：只读 `package.json`、`pnpm-lock.yaml`、`pnpm-workspace.yaml`、`node_modules/**` 与全工作树状态；写入执行证据位置由后续 stage 指定。
- 禁止：删除 `.next`、安装依赖、运行 build/dev、修改任何 tracked 文件、清理既有 dirty state、向父目录安装 Tailwind、使用 npm/yarn/bun、切换版本、加入 Refine/Admin/React Router。
- 必须覆盖 `REC-AC-001`、`REC-AC-002` 与 `REC-AC-007` 的保护前提；记录命令、cwd、版本、退出码和路径证据。
- Happy path：所有 root 指向 `$PROJECT_ROOT`，Node `>=20.9.0`，pnpm `9.15.0`，Next `16.1.6`、Tailwind `4.1.18`、`@tailwindcss/postcss` `4.1.18`、PostCSS `8.4.39` 均从本项目解析，dirty snapshot 未被改动。
- Failure path：任一 root/模块解析指向 `/Users/dmeck/project`、sibling 或项目外即停止；不得以父目录依赖或配置猜测绕过。
- 阻塞 owner/action：`CEOOrchestrator` / runtime owner 修正 execution workspace 或启动 cwd；修复后从 R0 重跑。若无法区分并发改动，由当前执行 owner 停止并回写证据。
- StagePlanner 完成信号：R0 证据字段齐全且有单一 `PASS`；若为 `[BLOCKED]`，只生成阻塞/回滚证据，不创建 R1 可执行节点。
- 正式文档固定包含 12 章：任务标题；元数据；目标；输入输出；步骤；路径边界；依赖 DAG；前端/后端/联调边界；测试；完成标志；非目标；风险阻塞回退。

Optional Enhancers:

- 将 Paperclip workspace cwd 与 shell `pwd -P` 分开记录，避免把配置值当作实测值。
- 把“初始 dirty state 保护清单”和“本 gate 产生的证据文件”分栏，便于后续 scoped diff。
