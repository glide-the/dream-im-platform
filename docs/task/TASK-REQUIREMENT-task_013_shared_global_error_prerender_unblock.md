# `TASK-N16-UNBLOCK-001` 已填充提示词

> 基础模板：`docs/task/TASK-REQUIREMENT-FORMAT.md`
> 这是生成提示词，不是正式任务文档。
> task 规划 Issue：[SUO-365](/SUO/issues/SUO-365)
> 唯一映射 Issue：[SUO-364](/SUO/issues/SUO-364)
> 执行合同澄清 Issue：[SUO-367](/SUO/issues/SUO-367)

Optimized Prompt:

你是资深软件交付任务设计师。请仅依据下列已填充的 Issue、执行证据、应用锚点与仓库约束，生成一份可由 StagePlanner 直接消费的 Markdown 任务文档：
`docs/task/task_013_shared_global_error_prerender_unblock.md`。本工作只定义执行合同；不得实现代码、不得运行 execute、不得编排 stage、不得扩展到恢复链或 Refine/Admin 范围。

## 任务元数据

- Task ID：`TASK-N16-UNBLOCK-001`
- 标题：解除 `/_global-error` 的 `useContext` prerender 阻塞
- 唯一映射 Issue：[SUO-364](/SUO/issues/SUO-364)
- task 规划 Issue：[SUO-365](/SUO/issues/SUO-365)
- 下游 Stage Issue：[SUO-366](/SUO/issues/SUO-366)
- 执行合同澄清 Issue：[SUO-367](/SUO/issues/SUO-367)
- 被阻塞执行链：[SUO-361](/SUO/issues/SUO-361)
- domain：`shared`
- 优先级：`high`
- Paperclip labels：当前为空
- 文档内分类标签：`next16`、`global-error`、`prerender`、`unblock`、`shared`
- 唯一规划主责：`TaskDesignAgent`
- 后续执行 owner：由 StagePlanner 与 execute-readiness 流程唯一绑定；本 task 不直接派工。
- domain 说明：实际源码修复位于 App Router 根错误边界，但验收跨越前端 fallback、Next SSR/static generation、构建生成态和恢复链 handback，故归一化为 `shared`。

## 背景与权威事实

- [SUO-361](/SUO/issues/SUO-361) 在同一 retained checkout/workspace 中完成 R0、R1 后，从空 `.next` 在项目根执行 `pnpm build`。
- Next `16.1.6 (Turbopack)` 在 2.3 秒内编译成功，Tailwind/PostCSS/module resolution 均未报错；随后在 static generation 阶段 prerender `/_global-error` 失败：`TypeError: Cannot read properties of null (reading 'useContext')`，build worker exit `1`。
- 失败 run 生成了新鲜、非空的 21-byte `.next/BUILD_ID`，但 R2 要求 exit `0` 与新鲜 `BUILD_ID` 双证据，因此不能把部分生成物当作 PASS，R3 未获准启动。
- 污染扫描没有命中旧 checkout、父目录 `node_modules` 或 `@refinedev/*`；受控配置 diff 为空。失败 `.next` 已隔离，项目 `.next` 在证据记录时不存在；Next 自动改写的 `next-env.d.ts` 已按预运行 hash 字节级恢复。
- 既有 `TASK-N16-REC-003` 与 Stage R2 明确禁止修改 `app/**`，因此不能授权这次 application-level 例外；[SUO-364](/SUO/issues/SUO-364) 是该例外的唯一上游授权。
- 当前应用没有 `app/global-error.tsx` 或同名 JS/TS 变体。只读锚点显示：`app/layout.tsx` 将页面包裹在 `app/app/providers.tsx` 的 `QueryClientProvider` 与 `WorkspaceSessionProvider` 中；`app/app/workspace-context.tsx` 调用 React `useContext`。
- 本地安装的 Next `16.1.6` 将 `global-error` 识别为仅根层约定文件；缺失时使用 `next/dist/client/components/builtin/global-error.js`。该内建 fallback 是 Client Component 并自行输出完整 `<html>`、`<head>` 与 `<body>`，说明自定义 global error 必须独立于正常根布局和业务 Provider。

## 权威输入

- [SUO-364](/SUO/issues/SUO-364) 的目标、失败证据、范围、验证与 handback 要求。
- `docs/exec/exec_SUO-361_next16_tailwind_postcss_baseline_recovery.md` §12 的最新 R0–R2 证据（只读）。
- `docs/task/task_011_shared_next16_cold_build.md`（只读 R2 双证据合同）。
- `docs/stage/stage_next16_tailwind_postcss_baseline_recovery.md`（只读 R0 → R3 连续性与回退合同）。
- `docs/design/design_002_next16_tailwind_postcss_baseline_recovery.md` 与 `docs/issue/ISSUES_next16_tailwind_postcss_baseline_recovery.md`（只读恢复边界）。
- 应用只读锚点：`app/layout.tsx`、`app/app/providers.tsx`、`app/app/workspace-context.tsx`、`app/page.tsx`。
- 框架只读锚点：`node_modules/next/dist/esm/client/components/builtin/global-error.js`、`node_modules/next/dist/esm/build/webpack/loaders/next-app-loader/index.js`。
- 版本/配置只读锚点：`package.json`、`pnpm-lock.yaml`、`next.config.js`、`postcss.config.js`、`tsconfig.json`、`next-env.d.ts`。

## 任务目标

定义并执行一次最小、可归因的 App Router 根错误边界修复：只新增 `app/global-error.tsx`，使 `/_global-error` 在不依赖正常根布局、Query Client、Workspace Context 或其他应用 Provider 的情况下可被 Next `16.1.6` 成功 prerender。必须以 `pnpm build` exit `0`、本 run 新鲜非空 `.next/BUILD_ID`、错误消失、精确 changed-file 报告和 scope-cleanliness 共同证明修复有效，并由 ExecTaskAgent 将正式结果写入唯一获准的执行报告 `docs/exec/exec_TASK-N16-UNBLOCK-001_global_error_prerender_unblock.md`。成功后只 hand back 给 [SUO-361](/SUO/issues/SUO-361) 从 R0 重启完整 R0 → R3，不得把本任务 build 视作恢复 R2 或 R3 证据。

## 精确允许范围

### 仓库源码唯一 allowlist

- `app/global-error.tsx`：**预期新增；唯一允许产生净仓库差异的应用文件。**

该组件合同必须同时满足：

1. 第一条有效指令为 `"use client"`。
2. 默认导出根级 global error 组件，显式接受 Next error-boundary 合同中的 `error`（含可选 `digest`）与 `reset(): void`。
3. 自行返回完整 `<html lang="zh-CN">` 与 `<body>`，因为它替代根布局；不得渲染或导入 `RootLayout`。
4. 使用不依赖应用 Provider 的通用错误提示，并提供调用 `reset()` 的重试动作。
5. 不读取或展示 `error.message`、stack、digest、环境变量或其他可能敏感的内部信息；详细错误只留在服务端/build 日志。
6. 不调用 React hooks/context，不导入 TanStack Query、Workspace Context、页面、布局、业务组件、`app/lib/**`、全局 CSS 或新增包；样式若需要只能使用组件内静态、无 Provider 依赖的最小表达。

### 正式执行报告唯一 allowlist

- `docs/exec/exec_TASK-N16-UNBLOCK-001_global_error_prerender_unblock.md`：**ExecTaskAgent 必须创建或更新的唯一仓库证据报告。** 该文件不属于应用/源码 changed-file acceptance；它必须记录 preflight、lint/build、fresh `BUILD_ID`、错误反证、应用源码 changed-file 判定、瞬态清理、回滚（如有）和 handback。除该精确路径外，所有 `docs/exec/**` 均禁止本任务新增、修改、移动、删除或清理。

### 仅执行证据/瞬态例外

- `$PAPERCLIP_RUN_SCRATCH_DIR/**`：保存 preflight、lint、build、hash、status/diff 与回滚证据。
- `.next/**`：只允许由本任务的 `pnpm build` 直接生成并读取；不得手工编辑、提交或作为 [SUO-361](/SUO/issues/SUO-361) 的 R2 证据。取证后只可隔离/删除本 run 可证明生成的状态，使 handback 保持冷启动条件。
- `next-env.d.ts`：兼容性保护而非修改目标。执行前保存内容与 hash；若 Next 自动改写，只能从本 run 的字节级快照恢复，并证明最终 hash 与 preflight 一致。
- Paperclip Issue 评论/附件：记录摘要并链接上述正式执行报告；不得以评论或 run scratch 替代该报告。

## 精确禁止范围

- 除 `app/global-error.tsx` 外的所有 `app/**`，特别是 `app/layout.tsx`、`app/app/providers.tsx`、`app/app/workspace-context.tsx`、`app/page.tsx`、`app/globals.css`、`app/api/**`、`app/lib/**`、组件、hooks、页面和路由。
- `package.json`、`pnpm-lock.yaml`、`package-lock.json`、`pnpm-workspace.yaml`、`next.config.js`、`postcss.config.js`、`playwright.config.ts`、`tsconfig.json` 及任何 package-management/build/typecheck 配置。
- Next、React、React DOM、Tailwind、PostCSS 的版本或依赖图；任何新增、删除、升级、降级、重装或 patch。
- Refine/Admin、`@refinedev/*`、React Router、`/admin` 路由/测试、第二个 Query Client，以及旧 S0 范围。
- schema/migration、`drizzle/**`、数据库、API、领域逻辑和业务协议。
- 任何 `docs/design/**`、`docs/issue/**`、`docs/task/**`、`docs/stage/**` 的新增或修改；以及除 `docs/exec/exec_TASK-N16-UNBLOCK-001_global_error_prerender_unblock.md` 外所有 `docs/exec/**` 的新增、修改、移动、删除或清理。既有 dirty 文档必须原样保护。
- `node_modules/**` 的安装/修改、父目录 `/Users/dmeck/project`、sibling checkout 或外部仓库。
- 手工修改、提交或保留 `.next/**`；全局 `git reset`、`git checkout`、stash、clean、批量格式化，以及覆盖/回滚任何 pre-existing dirty state。

## 可执行步骤

1. 在 `$PROJECT_ROOT` 记录 `pwd -P`、Git toplevel、Issue/run、时间、`git status --short`、`app/global-error.tsx` 与唯一执行报告路径是否存在、`next-env.d.ts` hash，以及全部 dirty-file 保护快照。若应用目标文件已被并发创建或 ownership 无法区分，立即 blocked，不覆盖；若精确报告路径已存在，只允许 ExecTaskAgent 在确认它属于同一 Task ID/执行链后幂等更新，否则先阻塞并协调 ownership。
2. 只读复核最新 [SUO-361](/SUO/issues/SUO-361) §12 证据、根布局/Provider/Context 锚点和本地 Next global-error 约定，确认错误仍是 application-level `/_global-error` prerender 问题而非版本、依赖或配置问题。
3. 仅新增 `app/global-error.tsx`，按上述组件合同实现无上下文依赖的完整文档 fallback；不触碰第二个文件。
4. 运行聚焦静态检查 `pnpm exec eslint app/global-error.tsx`，保存命令、cwd、exit code 和完整输出。非零立即停止，不以修改 ESLint/TypeScript 配置绕过。
5. 确认 build 前 `.next` 不存在。若存在且不能证明属于本 run，停止并请求 scope 协调；不得覆盖未知生成态。
6. 从 `$PROJECT_ROOT` 执行权威 `pnpm build`，将完整 stdout/stderr、开始/结束时间与 exit code 写入 run scratch。
7. 验证 build exit `0`；Next 为 `16.1.6`；日志不再包含 `/_global-error`、`useContext` prerender failure、Tailwind/PostCSS/module-resolution error；本 run 产生新鲜非空普通文件 `.next/BUILD_ID`，并记录 mtime、size、hash/值摘要和 diagnostics 状态。
8. 形成精确 changed-file 证据：pre/post `git status --short`、`app/global-error.tsx` 的内容 diff、全仓库 changed-name 对照、`next-env.d.ts` pre/post hash，以及“本 run 唯一应用/源码净新增为 `app/global-error.tsx`”的明确结论。对新文件执行 whitespace 检查；不得用全局清理制造清洁结果，也不得把正式执行报告误计为第二个源码文件。
9. 取证后隔离/删除本 run 生成的 `.next/**`；若 `next-env.d.ts` 被自动改写，从 preflight 快照字节级恢复。再次核验除 `app/global-error.tsx` 外没有本 run 净变化，其他 dirty state 与 preflight 一致。
10. 由 ExecTaskAgent 创建或幂等更新 `docs/exec/exec_TASK-N16-UNBLOCK-001_global_error_prerender_unblock.md`，记录 PASS 或 BLOCKED 结论、实现文件、lint/build 命令及 exit code、`BUILD_ID`、错误反证、源码 changed-file 判定、最终仓库路径清单、清理/回滚和 handback。报告是必须保留的交付物，不得在成功清理或失败回滚中删除。
11. 最终核验本 run 的应用/源码净变化只包含 `app/global-error.tsx`，任务拥有的仓库输出只包含该源码文件与上述精确报告，且所有其他 pre-existing dirty state 原样保留。在 [SUO-364](/SUO/issues/SUO-364) 回写摘要并链接精确报告。成功信号仅解除 application blocker；明确要求 [SUO-361](/SUO/issues/SUO-361) 在其 retained workspace/checkout 中重新从 R0 串行运行 R0 → R3。

## 输入 / 输出合同

### 输入

- [SUO-364](/SUO/issues/SUO-364) 及 StagePlanner 后续产出的可执行 Stage 准入。
- [SUO-361](/SUO/issues/SUO-361) §12 的原始失败证据与当前 dirty-file 基线。
- 只读应用/框架/版本锚点。

### 输出

- 唯一净源码差异：新增 `app/global-error.tsx`。
- 必须保留的正式仓库证据报告：`docs/exec/exec_TASK-N16-UNBLOCK-001_global_error_prerender_unblock.md`；它与源码 changed-file acceptance 分开计数。
- Paperclip/run-scratch 证据包：preflight、聚焦 lint、完整 build、fresh `BUILD_ID`、diagnostics、错误反证、exact changed-file 证据、瞬态清理和 handback；Paperclip 评论回写报告链接与摘要。
- 唯一结论：`UNBLOCK PASS` 或带 owner/action 的 `[BLOCKED]`；不得输出 `R2 PASS`、`R3 PASS` 或 `BASELINE RECOVERED`。

## 依赖与 DAG

```text
[SUO-361] R2 application failure evidence
  → [SUO-364] application-level exception
      → [SUO-365] TASK-N16-UNBLOCK-001 contract
          → [SUO-366] Stage gate
              → authorized implementation / pnpm build
                  → exact ExecTaskAgent report (PASS or BLOCKED)
                      → UNBLOCK PASS only
                          → [SUO-361] restart R0 → R1 → R2 → R3
```

- 本 task 不与 [SUO-361](/SUO/issues/SUO-361) 的 R0–R3 并行执行。
- [SUO-366](/SUO/issues/SUO-366) 只能在本任务文档完成后消费 allow/deny/test 边界。
- 本任务 build 只验证 unblock，不复用为 [SUO-361](/SUO/issues/SUO-361) 的 R2 证据。

## 前端 / 后端 / 联调 / 验收边界

- 前端：只负责根 global error 的独立、安全、可重试 fallback；不改正常页面、布局、Provider、CSS 或业务交互。
- 后端：无实现工作；不改 Route Handler、`app/lib`、DB、schema/migration 或服务端协议。
- 联调：只验证自定义 Client Component 与 Next `16.1.6` App Router 的 `/_global-error` static generation/SSR 构建路径闭合。
- 验收：由同一执行 owner 在单一 Issue/run 中提交 lint、build、fresh `BUILD_ID`、错误消失、exact changed-file 和冷 handback 证据，并由 ExecTaskAgent 保留唯一正式执行报告；StagePlanner 不执行这些命令。

## 测试策略

### Happy path

- `pnpm exec eslint app/global-error.tsx` exit `0`。
- `pnpm build` exit `0`，本 run 新鲜非空 `.next/BUILD_ID` 存在，且日志没有 `/_global-error` / `useContext` prerender error。
- 最终应用/源码净变化只有新增 `app/global-error.tsx`；任务拥有的仓库输出仅再包含精确执行报告；`next-env.d.ts` 与 preflight hash 相同；本 run `.next` 已清理/隔离；其他 dirty state 未改变。
- 精确执行报告存在且完整记录测试、清理、changed-file 与 handback；成功回写为 `UNBLOCK PASS` 并链接报告，只触发 [SUO-361](/SUO/issues/SUO-361) 从 R0 重启。

### Failure paths

至少覆盖以下一项，任一命中都必须 `[BLOCKED]` 并禁止扩大范围：

1. 聚焦 lint 非零、build 非零/超时、`/_global-error` 或 `useContext` 错误仍存在、`BUILD_ID` 缺失/陈旧，或 diagnostics 仍失败。
2. 修复需要第二个应用文件、Provider/layout/context 改动、版本/依赖/配置变化，或新文件引入 hook/context/敏感错误输出。
3. `app/global-error.tsx` 在执行前已由其他 actor 创建，未知 `.next` 无法安全隔离，或 pre/post dirty state 无法归因。

Failure 时停止：不尝试第二方案，不运行 dev/R3，不修改禁止文件；只移除本 run 新建且失败的 `app/global-error.tsx`、隔离本 run `.next`、按快照恢复 `next-env.d.ts`，保留其他 dirty state。ExecTaskAgent 仍须创建或更新精确执行报告，记录首失败命令、cwd、exit code、错误链、scoped diff、证据位置、回滚结果和所需 owner/action；失败回滚不得删除该报告，并须在 [SUO-364](/SUO/issues/SUO-364) 链接它。

## StagePlanner 完成信号

- 应用/源码 allowlist 精确到 `app/global-error.tsx`；仓库证据 allowlist 精确到 `docs/exec/exec_TASK-N16-UNBLOCK-001_global_error_prerender_unblock.md`，所有其他 repo 文件均 deny；瞬态 `.next` 与 `next-env.d.ts` 自动改写有可审计保护规则。
- happy/failure、lint/build/fresh `BUILD_ID`、exact changed-file、回滚和 handback 条件均可判定。
- Stage 只能生成一个原子 unblock 执行节点；其 PASS 后回流 [SUO-364](/SUO/issues/SUO-364)，再要求 [SUO-361](/SUO/issues/SUO-361) 从 R0 重启，不得直接解锁旧 R3。

## 正式文档输出要求

正式文档固定包含以下 12 章，并保持事实与本提示词一致：

1. 任务标题
2. 关联 Issue 与任务元数据
3. 任务目标
4. 输入与输出
5. 实现步骤
6. 涉及文件路径与修改边界
7. 依赖项与 DAG
8. 前端 / 后端 / 联调边界
9. 测试策略
10. 完成标志
11. 非目标
12. 风险、阻塞与回退

Optional Enhancers:

- 将 `app/global-error.tsx` 标为“预期新增 / 唯一净差异”，将根 layout、Provider、Context、Next 内建 global error 标为“只读参考 / 兼容性保护”。
- 用表格分别列出 repo source allowlist、唯一正式报告 allowlist、瞬态 build 例外、只读锚点和 hard deny，避免把 `.next` 的 build 生成或执行报告误写成第二个源码修改授权。
- 在验收矩阵中将“child build 成功”和“[SUO-361](/SUO/issues/SUO-361) 恢复链 PASS”分开，防止错误复用证据。

USER REQUIREMENT:

为 [SUO-364](/SUO/issues/SUO-364) 生成 `TASK-N16-UNBLOCK-001` 的 shared 执行合同，仅授权最小 application-level `/_global-error` prerender 修复。按 [SUO-367](/SUO/issues/SUO-367) 的增量澄清，`app/global-error.tsx` 仍是唯一允许的应用/源码净变化，同时必须允许且只允许 ExecTaskAgent 在 `docs/exec/exec_TASK-N16-UNBLOCK-001_global_error_prerender_unblock.md` 写正式执行报告，其他 `docs/exec/**` 全部保持禁止。正式任务必须要求 `pnpm build` exit `0`、精确 changed-file 报告、happy path、至少一个 failure path，以及成功后 [SUO-361](/SUO/issues/SUO-361) 从 R0 → R3 完整重启；禁止实现代码、版本/依赖/Refine/Admin/React Router/配置/Provider 扩域和复用 child build 作为恢复 gate 证据。
