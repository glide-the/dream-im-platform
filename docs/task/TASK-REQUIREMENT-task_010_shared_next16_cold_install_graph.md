# `TASK-N16-REC-002` 已填充提示词

> 基础模板：`docs/task/TASK-REQUIREMENT-FORMAT.md`
> 这是生成提示词，不是正式任务文档。
> task-stage Issue：[SUO-358](/SUO/issues/SUO-358)
> 权威输入：`docs/design/design_002_next16_tailwind_postcss_baseline_recovery.md`、`docs/issue/ISSUES_next16_tailwind_postcss_baseline_recovery.md`

Optimized Prompt:

你是资深软件交付任务设计师。请仅依据 `N16-REC-002`、恢复设计 §2、§3、§5.2、§5.5、§6–§9 与下列已填充事实，生成
`docs/task/task_010_shared_next16_cold_install_graph.md`。不得实现代码、不得编排 stage、不得扩展上游设计范围。

- Task ID：`TASK-N16-REC-002`；关联 Issue：`N16-REC-002`；domain：`shared`；上游类型：`tooling`；优先级：P0。
- domain 归一化说明：合法 task domain 不含 `tooling`；本 gate 管理跨层生成态、安装图和 CSS 工具链，故使用 `shared`。
- 标签：`next16`、`tailwind`、`postcss`、`recovery`、`gate-r1`。
- 唯一规划主责：`TaskDesignAgent`；具体执行 owner 由 StagePlanner 后续唯一绑定。
- 目标：仅在 `TASK-N16-REC-001` PASS 的同一 checkout 中摘要并隔离旧 `.next`，复核仓库内安装图，必要时执行 `pnpm install --frozen-lockfile`，并以独立 PostCSS/Tailwind probe 建立 R1 证据。
- 输入：R0 PASS 证据与 dirty-file 保护快照；当前 `.next/**`、`node_modules/**`、`package.json`、`pnpm-lock.yaml`；`app/globals.css` 仅作 probe 输入。
- 输出：旧缓存污染摘要、冷 `.next` 状态、模块解析、冻结安装结果（若执行）、CSS probe 日志，以及明确 `PASS` 或首个失败原因/回滚结果。
- 前置依赖：`TASK-N16-REC-001` PASS；只有 R1 PASS 才解锁 `TASK-N16-REC-003`；不允许越过或并行。
- 允许生成态：`.next/**` 摘要后隔离/删除；`node_modules/**` 仅用冻结安装恢复；Paperclip run scratch/测试输出。
- 条件候选：`next.config.js`、`postcss.config.js`、`pnpm-workspace.yaml`、`package.json`、`pnpm-lock.yaml`、`playwright.config.ts` 只在同一 run 的未修改失败证据精确命中后允许单变量最小修复；改后必须冷跑 R2/R3。
- 禁止：非冻结安装、改版本/新增包、修改 `package-lock.json`、`app/globals.css` 或其他 `app/**`、API/lib/schema/migration、Refine/Admin/React Router、下游文档、父目录/sibling。
- 必须覆盖 `REC-AC-002`、`REC-AC-003`、`REC-AC-007`；独立 CSS probe 不能替代 Next build。
- Happy path：旧 `.next` 已隔离；依赖解析留在项目 pnpm 链；冻结安装若触发则 exit 0 且 lock 无变动；CSS probe 无 warning；后续从空 `.next` 开始。
- Failure path：冻结安装要求改 lock/version、模块解析越出项目根、probe 失败或并发 diff 不可区分时停止，不执行 R2。
- 阻塞/澄清 owner/action：版本变更由 `DesignArchitect` + `CEOOrchestrator` 评审；包管理治理由仓库 owner / `CEOOrchestrator` 决定；应用 CSS 变更由 `DesignArchitect` 明确授权；默认均保持现版本/现 CSS/现 pnpm 权威并 blocked。
- 回滚：仅撤销本 run 的获准 tracked 配置，保留既有 dirty state；删除/隔离本 run 生成态和临时 probe，不做全局 reset/checkout。
- StagePlanner 完成信号：R1 输出证明冷态、安装图和 CSS probe 均 PASS；如存在条件配置修复，必须附“修改前失败 + 命中诊断 + scoped diff + 后续冷重跑要求”。
- 正式文档固定包含 12 章，并明确 shared 的前端、后端、联调与验收边界。

Optional Enhancers:

- 分别记录“未运行冻结安装”与“运行且成功”，不能把条件步骤伪装成必做变更。
- 把旧 checkout / `@refinedev/*` 扫描结果列为 R2 输入的反证字段。
