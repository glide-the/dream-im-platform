# `TASK-N16-REC-004` 已填充提示词

> 基础模板：`docs/task/TASK-REQUIREMENT-FORMAT.md`
> 这是生成提示词，不是正式任务文档。
> task-stage Issue：[SUO-358](/SUO/issues/SUO-358)
> 权威输入：`docs/design/design_002_next16_tailwind_postcss_baseline_recovery.md`、`docs/issue/ISSUES_next16_tailwind_postcss_baseline_recovery.md`

Optimized Prompt:

你是资深软件交付任务设计师。请仅依据 `N16-REC-004`、恢复设计 §2、§5.4、§5.5、§6–§9 与下列已填充事实，生成
`docs/task/task_012_shared_next16_dev_smoke.md`。不得实现代码、不得编排 stage、不得扩展上游设计范围。

- Task ID：`TASK-N16-REC-004`；关联 Issue：`N16-REC-004`；domain：`shared`；上游类型：`tooling`；优先级：P0。
- domain 归一化说明：合法 task domain 不含 `tooling`；本 gate 横跨 dev runtime、PWA smoke 与最终证据收口，故使用 `shared`。
- 标签：`next16`、`dev`、`smoke`、`recovery`、`gate-r3`。
- 唯一规划主责：`TaskDesignAgent`；具体执行 owner 由 StagePlanner 后续唯一绑定。
- 目标：仅在 `TASK-N16-REC-003` PASS 的同一 checkout 中，以可回收前台或受管进程启动 `pnpm dev`，验证 ready、首次请求后存活、`/`、`/customers`、静态 CSS 和优雅停止，并收口 `REC-AC-001`–`REC-AC-007`。
- 输入：R2 build PASS、`BUILD_ID`/trace/scoped diff、此前 R0–R1 证据及任何获准单变量配置说明。
- 输出：PID、监听地址、ready/存活/停止日志，两个页面非 5xx 且主文档可读的响应证据，CSS 可获取且无 resolver error 的证据，最终 AC 映射、scope-cleanliness 与 `PASS` 或失败/回滚记录。
- 前置依赖：`TASK-N16-REC-003` PASS；本任务是唯一恢复收口 gate，不能与 R0–R2 并行。
- 允许：`.next/**`、run scratch/测试输出、受管 dev 生命周期；`playwright.config.ts` 仅在直接 dev 通过而 Playwright webServer cwd 错误且诊断充分时作单变量最小修改。
- 禁止：请求/断言/创建 `/admin`，加入 `@refinedev/*` 或 React Router，修改 `app/**`、API/lib/schema/migration、版本、`package-lock.json`、下游文档或外部项目；不得留下 orphan 进程。
- 必须覆盖 `REC-AC-005`、`REC-AC-006`、`REC-AC-007`，并汇总 `REC-AC-001`–`REC-AC-004` 的上游证据。
- Happy path：dev 明确 ready，首次请求后仍存活；`/` 与 `/customers` 非 5xx、主文档可读；静态 CSS 可获取且无 Tailwind/PostCSS 错误；进程优雅停止；dirty state 原样保护。
- Failure path：未 ready、首请求崩溃、页面 5xx、CSS 404/resolver error、无法停止进程或 diff 不可区分均停止；端口占用/sandbox `EPERM` 作为外部环境证据，仅在获准端口环境重试一次。
- 测试边界：无 tracked 配置变化时不要求全量 Vitest/E2E；若配置变更，则加受影响配置 lint/加载检查与现有 `tests/e2e/customers-flow.spec.ts` smoke。
- 阻塞/澄清 owner/action：runtime owner 处理端口/执行环境；外部 cwd 由 `CEOOrchestrator` / runtime owner 修正并从 R0 重启；版本/应用 CSS 超界由 `DesignArchitect` + `CEOOrchestrator` 决策。
- 回滚：停止本 run dev，隔离本 run `.next`/日志，仅撤销本 run 条件配置，保留其他 Agent/用户改动。
- StagePlanner 完成信号：R3 PASS、dev 生命周期闭环、`REC-AC-001`–`REC-AC-007` 一一有证据且无越界 diff；该信号只供 [SUO-355](/SUO/issues/SUO-355) 恢复评估，不自动重开 [SUO-351](/SUO/issues/SUO-351) 或授权新 S0。
- 正式文档固定包含 12 章，并明确 shared 的前端、后端、联调与验收边界。

Optional Enhancers:

- 把端口/权限故障与应用构建链故障分栏，避免误归因。
- 用表格逐项映射 `REC-AC-001`–`REC-AC-007` 的证据来源和判定。
