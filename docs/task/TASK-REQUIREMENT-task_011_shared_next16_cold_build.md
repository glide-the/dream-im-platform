# `TASK-N16-REC-003` 已填充提示词

> 基础模板：`docs/task/TASK-REQUIREMENT-FORMAT.md`
> 这是生成提示词，不是正式任务文档。
> task-stage Issue：[SUO-358](/SUO/issues/SUO-358)
> 权威输入：`docs/design/design_002_next16_tailwind_postcss_baseline_recovery.md`、`docs/issue/ISSUES_next16_tailwind_postcss_baseline_recovery.md`

Optimized Prompt:

你是资深软件交付任务设计师。请仅依据 `N16-REC-003`、恢复设计 §2、§3、§5.3、§5.5、§6–§9 与下列已填充事实，生成
`docs/task/task_011_shared_next16_cold_build.md`。不得实现代码、不得编排 stage、不得扩展上游设计范围。

- Task ID：`TASK-N16-REC-003`；关联 Issue：`N16-REC-003`；domain：`shared`；上游类型：`tooling`；优先级：P0。
- domain 归一化说明：合法 task domain 不含 `tooling`；本 gate 验证跨层 Next 构建基线，故使用 `shared`。
- 标签：`next16`、`build`、`recovery`、`gate-r2`。
- 唯一规划主责：`TaskDesignAgent`；具体执行 owner 由 StagePlanner 后续唯一绑定。
- 目标：仅在 `TASK-N16-REC-002` PASS 后从空 `.next` 运行权威命令 `pnpm build`，以 exit 0 与本次新鲜非空 `.next/BUILD_ID` 证明 Next 16 冷生产构建成功。
- 输入：R1 冷态、冻结安装和 CSS probe PASS 证据；任何单变量配置候选的诊断链。
- 输出：build 开始时间、命令、cwd、版本、退出码、日志、`BUILD_ID` mtime/hash/值摘要、build diagnostics、trace/sourcemap 污染扫描、scoped diff，以及 `PASS` 或失败/回滚记录。
- 前置依赖：`TASK-N16-REC-002` PASS；只有 R2 PASS 才解锁 `TASK-N16-REC-004`；不允许 build 与 dev 并行。
- 允许生成态：`.next/**` 与 run scratch/测试输出，不提交。
- 条件 tracked 候选：仅限 `next.config.js`、`postcss.config.js`、`pnpm-workspace.yaml`、`package.json`、`pnpm-lock.yaml`、`playwright.config.ts`，并要求未修改失败、精确诊断、单变量 diff、空 `.next` 重跑。
- 禁止：`app/globals.css` 与所有 `app/**`、`package-lock.json`、版本变动/新包、Refine/Admin/React Router、API/lib/schema/drizzle、下游文档、父目录/sibling。
- 必须覆盖 `REC-AC-003`、`REC-AC-004`、`REC-AC-007`。
- Happy path：`pnpm build` exit 0，日志为 Next `16.1.6` 且无 Tailwind/PostCSS/module resolution error；`BUILD_ID` 本次生成且非空；diagnostics 不停留在失败 compile；无旧 checkout、父目录依赖或 `@refinedev/*` 引用。
- Failure path：超时、非零、只有部分 `.next`、只有启动日志、缺失/陈旧 `BUILD_ID` 或污染扫描命中均为 FAILED，停止且不启动 dev。
- 阻塞/澄清 owner/action：当前执行 owner 记录最后 PASS gate、首 FAILED gate、完整错误链和精准回滚；若要求版本或应用代码变更，@mention `DesignArchitect` + `CEOOrchestrator`，保持 blocked，不重开旧 S0。
- 回滚：只撤销本 run 的条件配置，保留其他 dirty state；隔离本 run 生成的 `.next` 和日志；禁止全局 reset/checkout。
- StagePlanner 完成信号：`REC-AC-004` 的 exit 0 + 新鲜 `BUILD_ID` 双证据成立，且 `REC-AC-003/007` 扫描/范围证据齐全；否则不得创建 R3 可执行节点。
- 正式文档固定包含 12 章，并明确 shared 的前端、后端、联调与验收边界。

Optional Enhancers:

- 用 build 开始时间与 `BUILD_ID` mtime 双重证明新鲜度。
- 把部分生成和超时列为显式反证，禁止把 “Creating an optimized production build” 当作成功。
