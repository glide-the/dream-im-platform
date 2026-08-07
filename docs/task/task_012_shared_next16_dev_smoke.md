# 验证受管 dev 启动与现有 PWA 最小回归

## 1. 任务标题

R3：验证受管 dev 启动与现有 PWA 最小回归。

## 2. 关联 Issue 与任务元数据

- Task ID：`TASK-N16-REC-004`
- 关联 Issue：`N16-REC-004`
- task-stage Issue：[SUO-358](/SUO/issues/SUO-358)
- 恢复父项：[SUO-355](/SUO/issues/SUO-355)
- 失败背景：[SUO-351](/SUO/issues/SUO-351)
- domain：`shared`
- 上游类型：`tooling`
- domain 归一化：本任务横跨 dev runtime、现有 PWA smoke 与恢复证据收口，按合法 task domain 归入 `shared`。
- 优先级：P0
- 标签：`next16`、`dev`、`smoke`、`recovery`、`gate-r3`
- 唯一规划主责：`TaskDesignAgent`
- 后续执行 owner：由 StagePlanner 唯一绑定；本 task 不直接派发。
- Requirement：[TASK-REQUIREMENT-task_012_shared_next16_dev_smoke.md](./TASK-REQUIREMENT-task_012_shared_next16_dev_smoke.md)
- 权威设计：`docs/design/design_002_next16_tailwind_postcss_baseline_recovery.md` §2、§5.4、§5.5、§6–§9

## 3. 任务目标

只在 R2 PASS 的同一 checkout 中，以可回收前台或 Paperclip 受管进程启动 `pnpm dev`，证明服务 ready 且在首次请求后存活；验证现有 `/`、`/customers` 与静态 CSS 资源；最后优雅停止服务并汇总 `REC-AC-001`–`REC-AC-007`。恢复成功只适用于零 Refine 的当前 PWA 基线。

## 4. 输入与输出

### 输入

- `TASK-N16-REC-003` 的 `R2 PASS`：build exit 0、新鲜 `BUILD_ID`、diagnostics、污染扫描与 scoped diff。
- R0–R1 的 root/version/install/cold-state/probe 证据。
- 任何获准单变量配置修改及修改前失败、命中诊断、冷重跑结果。
- 当前端口/进程状态和既有 `tests/e2e/customers-flow.spec.ts`。

### 输出

- dev 生命周期：启动命令/cwd、PID 或受管服务 ID、监听地址、ready 时间、首次请求后存活检查、停止命令/结果和最终进程状态。
- `/`、`/customers` 的状态码、主文档可读摘要；页面引用的 Next 静态 CSS URL、获取状态与关键响应头/大小。
- dev 日志中 Tailwind/PostCSS/module resolver error 的检查结果。
- `REC-AC-001`–`REC-AC-007` 的最终证据映射和 scoped cleanliness 结论。
- `R3 PASS`，或首个失败、外部环境隔离、回滚与澄清记录。

## 5. 实现步骤

1. 核验 R2 PASS 属于同一 checkout，并记录当前端口占用、遗留 dev 进程和构建/dirty 状态；不得复用来源不明的现有服务器。
2. 使用 Paperclip execution workspace 的受管 runtime，或可回收的前台进程，从 `$PROJECT_ROOT` 运行 `pnpm dev`；记录 PID/服务 ID、监听地址和完整启动日志。
3. 等待日志明确 ready；ready 前超时、进程退出或端口/权限错误必须分类记录，不得直接归因为应用代码。
4. 从同一运行环境请求 `/`，记录状态码和主文档可读性；请求后确认 dev 进程仍存活。
5. 请求 `/customers`，同样记录非 5xx 状态和主文档；若 DB/外部服务异常，单独保存错误并与 Tailwind/PostCSS 结果隔离，不能掩盖 5xx。
6. 从页面主文档提取实际 Next 静态 CSS 资源并请求，记录状态码、内容类型/大小；检查 dev 日志没有 `tailwindcss`、`@tailwindcss/postcss` 或 PostCSS resolver error。
7. 不请求、不创建、不断言 `/admin`。扫描依赖/日志/路由证据，确认没有 `@refinedev/*` 或 Admin 假阳性。
8. 若本恢复链修改过 tracked 配置，执行受影响配置 lint/加载检查及既有 customers Playwright smoke；无 tracked 配置变化时不扩展为全量 Vitest/E2E。
9. 优雅停止本任务启动的 dev 进程，确认监听已释放且无 orphan；记录停止结果。
10. 对照 R0 保护清单核验最终 scoped diff，汇总 `REC-AC-001`–`REC-AC-007`；全部通过才输出 R3 PASS。失败时停止、回滚本 run 变更并记录 owner/action。

## 6. 涉及文件路径与修改边界

### 可操作范围

- `.next/**`：dev 生成态；不提交，失败时按本 run 范围隔离。
- Paperclip run scratch/测试输出：server 日志、HTTP 响应、CSS 证据、PID/停止记录。
- 受管或前台 dev 进程：只管理本任务启动的实例，退出前必须停止。

### 条件候选

- `playwright.config.ts`：仅在直接 `pnpm dev` 通过、但 Playwright webServer 从错误 cwd 启动且同一 run 诊断充分时，允许固定 `$PROJECT_ROOT` cwd；不得新增 Admin assertions。
- R1/R2 已获准的其他单变量配置：只读验证其冷 build/dev 结果，本任务不得再叠加第二个猜测性变化。

### 只读验证

- `tests/e2e/customers-flow.spec.ts`
- `/`、`/customers` 对应的现有页面和 Next 静态 CSS 输出
- `next.config.js`、`postcss.config.js`、`pnpm-workspace.yaml`、`package.json`、`pnpm-lock.yaml`

### 禁止修改或访问范围

- 不请求/断言/创建 `/admin`、`/admin/login` 或 Admin probe/tests
- 不加入 `@refinedev/*`、React Router、Ant Design/MUI 或第二个 QueryClient
- 不修改 `app/**`、`app/api/**`、`app/lib/**`、schema/migration、`drizzle/**`
- 不改变 Next/React/Tailwind/PostCSS 版本，不修改 `package-lock.json`
- 不修改 `docs/design/**`、`docs/issue/**`、`docs/task/**`、`docs/stage/**`、`docs/exec/**`
- 不操作父目录、sibling 或外部项目

## 7. 依赖项与 DAG

- 前置依赖：`TASK-N16-REC-003` 的 `R2 PASS`。
- 并行条件：无；R3 是恢复链唯一收口 gate。
- 完整线性 DAG：

```text
TASK-N16-REC-001 (R0)
  └─ PASS → TASK-N16-REC-002 (R1)
       └─ PASS → TASK-N16-REC-003 (R2)
            └─ PASS → TASK-N16-REC-004 (R3)
                 └─ all REC-AC-001…007 PASS → SUO-355 recovery evaluation
```

- StagePlanner 准入信号：R3 只能依赖 R2 双证据 PASS；不得把 server process 创建、端口监听或单个页面响应单独当作完成。

## 8. 前端 / 后端 / 联调边界

- 前端：不修改页面、组件、路由或 CSS；只验证现有 `/`、`/customers` 主文档和实际静态 CSS 资源。
- 后端：不修改 API、DB、schema 或 `app/lib/**`；页面的 DB/外部服务错误只作为隔离证据，不扩展修复范围。
- 联调/运行时：拥有 dev 生命周期、HTTP/CSS smoke、日志分类、配置变更后的 customers E2E 与进程回收。
- 验收：负责合并 R0–R3 证据矩阵；没有全量 `REC-AC-001`–`REC-AC-007` 不得宣布基线恢复。

## 9. 测试策略

### Happy path

- `pnpm dev` 明确 ready，首次 HTTP 请求后进程仍存活。
- `/` 和 `/customers` 均返回非 5xx，主文档可读取。
- 页面实际引用的静态 CSS 可获取，且日志无 Tailwind/PostCSS resolver error。
- 本任务启动的服务已优雅停止，监听释放，无 orphan。
- 既有 dirty state 原样保护，生成态未提交；条件 tracked diff 有解释。

### Failure path

- dev 未 ready、ready 后首请求崩溃、任一页面 5xx、CSS 404/compile error、resolver error、服务无法回收或 scoped diff 不可区分。
- 端口占用或 sandbox `EPERM` 先归类为 `REC-RISK-005`；仅在获准端口环境重试一次，不修改应用代码。
- DB/外部服务导致的页面失败单独记录，但仍不能把 5xx 写成 smoke PASS。

### 最小验证方式

- `pnpm dev`（前台或 Paperclip 受管 runtime）。
- 同一环境对 `/`、`/customers` 和页面实际 CSS URL 发起 HTTP 请求，并记录状态/主文档/资源证据。
- 请求后进程存活检查与优雅停止检查。
- 若有 tracked 配置变化：受影响配置 lint/加载检查，以及
  `pnpm exec playwright test tests/e2e/customers-flow.spec.ts`。
- 对实际配置变化运行 `git diff --check -- <scoped-paths>`。

## 10. 完成标志

| AC | 本任务要求的完成证据 |
| --- | --- |
| `REC-AC-001` | 引用 R0 的 cwd/Git/Paperclip/pnpm root 同源证据 |
| `REC-AC-002` | 引用 R0/R1 的固定版本、仓库内解析和冻结安装状态 |
| `REC-AC-003` | 引用 R1/R2 的冷 `.next` 和无旧 checkout/Refine 污染证据 |
| `REC-AC-004` | 引用 R2 的 build exit 0 + 新鲜非空 `BUILD_ID` |
| `REC-AC-005` | dev ready、首请求后存活、两个页面非 5xx、CSS 可获取 |
| `REC-AC-006` | `/`、`/customers` 最小回归，无 `/admin` 假阳性 |
| `REC-AC-007` | scoped diff、生成态不提交、既有 dirty state 保护与回滚清洁 |

全部七项有可审计证据、dev 生命周期闭环且无越界变化时，才输出 `R3 PASS / BASELINE RECOVERED` 供 [SUO-355](/SUO/issues/SUO-355) 评估。

## 11. 非目标

- 不验证或宣称 Refine 与 Next 16 兼容，不重开 [SUO-351](/SUO/issues/SUO-351)。
- 不创建 Admin 路由、Provider、测试或依赖。
- 不修复业务页面、API、DB 或外部服务问题。
- 不修改版本、应用代码或扩大到全量测试。
- 不自动创建新的 S0 task/stage/execute 链路。

## 12. 风险、阻塞与回退

| 条件 | Owner / action | 默认行为 | 回退 |
| --- | --- | --- | --- |
| dev 未 ready、首请求后退出或 CSS resolver error | 当前执行 owner 保存完整日志和 HTTP 证据 | R3 FAILED，停止恢复 | 停止服务、隔离本 run `.next`、撤销本 run 条件配置 |
| 端口占用/sandbox `EPERM` | runtime owner 提供获准端口/权限环境 | 仅重试一次，不改应用 | 关闭本 run 进程并保留环境证据 |
| 正确 repo 命令通过但 Paperclip/Playwright 从父目录启动 | `CEOOrchestrator` / runtime owner 修正 execution workspace | blocked；修复后从 R0 重启完整链 | 不以项目配置隐藏外部 cwd 错误 |
| 需要版本或应用 CSS 变化 | `DesignArchitect` + `CEOOrchestrator` 评审并增量修订设计 | blocked，不扩展本任务 | 回滚本 run 配置，保持当前版本/源码 |
| DB/外部服务导致页面 5xx | 对应系统 owner 后续单独处置；当前 owner保存隔离证据 | R3 不得 PASS | 不改业务/API/lib/schema |
| 无法区分并发 diff | 当前执行 owner 协调对应改动 owner | blocked | 只撤销可证明属于本 run 的修改 |

失败记录必须包含最后 PASS gate、首 FAILED gate、命令、cwd、退出码、error chain、HTTP/CSS 证据、进程停止结果、scoped diff 与回滚结果。禁止全局 reset/checkout。StagePlanner 必须将本任务设为线性恢复链的唯一收口节点，为 dev 生命周期、两页面、CSS、进程回收和七项 AC 分别保留可判定证据字段；`R3 PASS / BASELINE RECOVERED` 只回流 [SUO-355](/SUO/issues/SUO-355) 给 `CEOOrchestrator` 做恢复评估。本文档完成只表示 R3 已可排期，不表示当前 task-stage 已运行 build/dev 或恢复基线。
