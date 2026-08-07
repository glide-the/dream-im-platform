# `TASK-N16-UNBLOCK-002` 已填充提示词

> 基础模板：`docs/task/TASK-REQUIREMENT-FORMAT.md`
> 这是生成提示词，不是正式任务文档。
> task 规划 Issue：[SUO-369](/SUO/issues/SUO-369)
> 上游 application unblock：[SUO-364](/SUO/issues/SUO-364)
> 被阻塞恢复链：[SUO-361](/SUO/issues/SUO-361)

Optimized Prompt:

你是资深软件交付任务设计师。请仅依据下方已填充的 Issue、新构建证据、稳定恢复设计与既有 global-error 合同，生成一份可由 StagePlanner 直接消费的 Markdown 任务文档：
`docs/task/task_014_shared_not_found_prerender_unblock.md`。本工作只定义执行合同；不得诊断或修改源码、不得运行 build、不得编排 stage、不得扩展恢复设计、不得恢复 Refine/Admin 工作。

## 任务元数据

- Task ID：`TASK-N16-UNBLOCK-002`
- 标题：独立诊断并解除 `/_not-found` 的 null `useState` prerender 阻塞
- 唯一映射 Issue：[SUO-369](/SUO/issues/SUO-369)
- 上游 application unblock：[SUO-364](/SUO/issues/SUO-364)
- 被阻塞执行链：[SUO-361](/SUO/issues/SUO-361)
- 下游 Stage Issue：尚未创建；由 `CEOOrchestrator` 在本 task 完成后另行路由，本文不得虚构标识或直接派工。
- domain：`shared`
- 优先级：`high`
- Paperclip labels：wake payload 未提供；不得虚构控制面标签。
- 文档内分类标签：`next16`、`not-found`、`prerender`、`useState`、`unblock`、`shared`
- 唯一规划主责：`TaskDesignAgent`
- 后续执行 owner：由 StagePlanner 与 execute-readiness 流程唯一绑定；本 task 不直接派工。
- domain 说明：允许的应用修复落在 App Router not-found 边界，但验收跨越页面 fallback、Next static generation、构建生成态、回滚和恢复链 handback，因此归一化为 `shared`；这不授权后端实现。

## 背景与权威事实

- [SUO-361](/SUO/issues/SUO-361) 仍因 Next 16 恢复链中的 application-level prerender 阻塞而保持 blocked。
- [SUO-364](/SUO/issues/SUO-364) 授权的临时 `app/global-error.tsx` 变化消除了原 `/_global-error` / null `useContext` 首失败。
- 同一次后续冷 build 仍 exit `1`，新的首失败发生在 prerender `/_not-found`，错误为 null `useState`。
- 上述临时源码变化已回滚；该 child build 及其 `.next/BUILD_ID` 都不是恢复成功证据，也不得作为本任务 preflight 或 [SUO-361](/SUO/issues/SUO-361) 的 R2 证据复用。
- 既有 global-error task/stage 合同已经完成并保持只读。新任务必须独立建立 preflight、诊断、单文件修复、冷 build、fresh `BUILD_ID`、回滚和 handback 证据，不得改写或重新执行旧合同。
- 当前已知 dirty state 包含 `docs/exec/exec_TASK-N16-UNBLOCK-001_global_error_prerender_unblock.md`；它属于既有执行链证据，必须原样保护，不能被本任务清理、修改、归入新任务输出或当作 clean-worktree 前提。
- 新证据只授权定义 task 合同，不足以在 task 阶段宣布根因；下游执行必须先独立确认修复可收敛在唯一 application-file allowlist 内。

## 权威输入

- 当前 Issue：[SUO-369](/SUO/issues/SUO-369) 的 Objective、New evidence、Phase and ownership、Required contract 与 Completion signal。
- 稳定设计：`docs/design/design_002_next16_tailwind_postcss_baseline_recovery.md`。
- 稳定 Issue 清单：`docs/issue/ISSUES_next16_tailwind_postcss_baseline_recovery.md`。
- 已完成 global-error requirement：`docs/task/TASK-REQUIREMENT-task_013_shared_global_error_prerender_unblock.md`。
- 已完成 global-error task：`docs/task/task_013_shared_global_error_prerender_unblock.md`。
- 已完成 global-error stage：`docs/stage/stage_global_error_prerender_unblock.md`。
- 既有 global-error 执行报告：`docs/exec/exec_TASK-N16-UNBLOCK-001_global_error_prerender_unblock.md`（只读保护；不得把其 build 或 `BUILD_ID` 当本任务证据）。
- 下游执行可只读复核的应用锚点：`app/layout.tsx`、`app/app/providers.tsx`、`app/app/workspace-context.tsx`、`app/page.tsx`，以及 `app/not-found.tsx` 的 preflight 存在性、内容和 ownership。
- 下游执行可只读复核的框架锚点：本地 Next `16.1.6` 对 `not-found` / `/_not-found` 的实现与 loader；只允许读取 `node_modules/next/**`，不得 patch 或安装。
- 版本/配置只读锚点：`package.json`、`pnpm-lock.yaml`、`package-lock.json`、`pnpm-workspace.yaml`、`next.config.js`、`postcss.config.js`、`playwright.config.ts`、`tsconfig.json`、`next-env.d.ts`。

## 任务目标

定义一次独立、最小、可归因的 `/_not-found` application-level 诊断与修复执行合同。唯一允许产生净应用源码变化的路径是 `app/not-found.tsx`：下游执行在 preflight 证明其状态与 ownership 后，可以在该路径缺失时新增，或在其为既有 clean tracked file 时做最小修改；不得转向第二个应用文件。

执行必须证明 null `useState` 的 `/_not-found` prerender 错误消失，且同时满足 `pnpm build` exit `0` 与本 run 从冷 `.next` 新生成的非空 `.next/BUILD_ID`。成功后只产生 `NOT_FOUND_UNBLOCK_PASS` 并 hand back 给 [SUO-361](/SUO/issues/SUO-361) 在 retained workspace/checkout 中重新从 R0 串行执行 R0 → R1 → R2 → R3；本 task 的 build 永远不得复用为恢复 gate 证据。

## 精确允许范围

### 应用源码唯一 allowlist

- `app/not-found.tsx`：**唯一允许的应用源码净变化。**
  - preflight 必须区分“缺失”“既有 clean tracked”“预先 dirty/untracked/ownership 不明”。
  - 缺失时只允许新增此文件；既有 clean tracked 时只允许最小修改此文件；预先 dirty、untracked 或 ownership 不明时立即 `[BLOCKED]`，不得覆盖。
  - 目标输出必须是自包含、静态可 prerender、无应用 Provider 依赖的 not-found fallback。
  - 不使用 React hooks/context，不导入 TanStack Query、Workspace Context、RootLayout、页面、业务组件、`app/lib/**`、全局 CSS或新依赖，不显示敏感内部错误信息。
  - 是否使用 Client directive 必须由独立诊断证据决定；无交互需求时优先保留 Server Component/static fallback，不得为修复 null `useState` 再引入 hook。

### 正式执行报告唯一 allowlist

- `docs/exec/exec_TASK-N16-UNBLOCK-002_not_found_prerender_unblock.md`：后续执行合同指定的报告责任方必须创建或幂等更新的唯一新仓库证据报告。它不计作应用源码 changed-file；必须记录 preflight、独立诊断、聚焦 lint、冷 build、fresh `BUILD_ID`、错误反证、应用 changed-file、瞬态清理、回滚与 handback。
- 除上述精确新报告路径外，所有 `docs/exec/**` 均只读保护；尤其不得修改或删除 `docs/exec/exec_TASK-N16-UNBLOCK-001_global_error_prerender_unblock.md`。

### 仅执行证据 / 瞬态例外

- `$PAPERCLIP_RUN_SCRATCH_DIR/**`：保存 preflight、诊断、lint、build、hash、status/diff、清理和回滚证据。
- `.next/**`：preflight 时必须为空；若存在未知或前序 build 生成态，停止并先由 workspace owner 恢复可归因冷态。仅允许由本任务冷 `pnpm build` 生成、读取和取证，之后隔离/删除本 run 可证明生成的状态；不得提交或保留为后续恢复输入。
- `next-env.d.ts`：兼容性保护，不是修改目标。执行前保存字节与 hash；若 Next 自动改写，只能从本 run 快照字节级恢复，最终 hash 必须等于 preflight。
- Paperclip Issue 评论/附件：记录摘要并链接正式执行报告；不得替代仓库报告。

## 精确禁止范围

- 除 `app/not-found.tsx` 外的所有 `app/**`，特别是 `app/global-error.tsx`、`app/layout.tsx`、`app/app/providers.tsx`、`app/app/workspace-context.tsx`、`app/page.tsx`、`app/globals.css`、components、hooks、页面、路由、`app/api/**` 与 `app/lib/**`。
- 已完成 global-error 边界及其全部产物：不得新增、恢复、修改或删除 `app/global-error.tsx`；不得修改 task 013 requirement/task、`docs/stage/stage_global_error_prerender_unblock.md` 或旧执行报告；旧 child build、日志和 `BUILD_ID` 均为只读反证。
- Next、React、React DOM、Tailwind、`@tailwindcss/postcss`、PostCSS 版本和依赖图；任何新增、删除、升级、降级、重装、patch 或 lockfile 重写。
- 所有 package-management/build/typecheck 配置：`package.json`、`pnpm-lock.yaml`、`package-lock.json`、`pnpm-workspace.yaml`、`next.config.js`、`postcss.config.js`、`playwright.config.ts`、`tsconfig.json`。
- Refine/Admin、`@refinedev/*`、React Router、`/admin` 路由/测试、Ant Design/MUI、第二个 Query Client 和旧 S0 工作。
- schema/migration、`drizzle/**`、DB、API、领域逻辑、业务协议与 `node_modules/**` 修改。
- 任何既有 `docs/design/**`、`docs/issue/**`、`docs/task/**`、`docs/stage/**`、`docs/exec/**` 的新增、修改、移动、删除或清理；唯一本任务报告例外为精确路径 `docs/exec/exec_TASK-N16-UNBLOCK-002_not_found_prerender_unblock.md`。
- 父目录 `/Users/dmeck/project`、sibling checkout、外部仓库，以及任何 pre-existing dirty/untracked state。
- 全局 `git reset`、`git checkout`、stash、clean、批量格式化；手工编辑或提交 `.next/**`；把任一失败 build 或其 `BUILD_ID` 伪装为成功证据。

## 可执行步骤

1. 在 `$PROJECT_ROOT` 记录 Issue/run、时间、`pwd -P`、Git toplevel、workspace cwd、`git status --short`、所有 dirty/untracked 文件、`.next` 状态、`next-env.d.ts` 字节/hash、`app/not-found.tsx` 状态/内容/hash/ownership，以及新旧两个执行报告路径的状态。任何不可归因项立即 `[BLOCKED]`。
2. 只读复核 [SUO-369](/SUO/issues/SUO-369) 的新错误证据、旧 global-error 合同/报告、根 layout 与 Provider 锚点、本地 Next not-found 约定。明确记录旧 `/_global-error` 错误已被前序临时变化移除，但该变化和 build 已回滚且不可作为本任务成功证据。
3. 在不改文件的前提下判断：null `useState` 首失败能否由一个自包含 `app/not-found.tsx` 收敛。如果证据要求第二个应用文件、global-error、layout/Provider/context、配置、版本或依赖变化，停止并产出 `[BLOCKED]` 证据，不得尝试范围外修复。
4. 仅在 allowlist 足够时新增或最小修改 `app/not-found.tsx`。产物保持静态可 prerender、无 hooks/context/Provider/业务依赖、无敏感信息，并提供最小 not-found 文案与返回安全入口的普通链接；不实现额外交互或样式系统。
5. 运行 `pnpm exec eslint app/not-found.tsx`，保存命令、cwd、时间、完整输出与 exit code。非零即停止，不改 ESLint/TypeScript/构建配置绕过。
6. 确认 build 前 `.next` 不存在且旧 child `.next/BUILD_ID` 未被复用。从 `$PROJECT_ROOT` 运行唯一权威 `pnpm build`，保存完整 stdout/stderr、开始/结束时间与 exit code。
7. 验证 build exit `0`；Next 仍为 `16.1.6`；日志不含 `/_not-found` / null `useState` prerender error，也不重新出现 `/_global-error` / null `useContext`，且无新的 Tailwind/PostCSS/module-resolution/prerender error。
8. 验证 `.next/BUILD_ID` 是本 run build 开始后新生成的非空普通文件，记录 mtime、size、hash/值摘要，并确认 diagnostics 不处于失败状态。build exit 非零时即使存在新 `BUILD_ID` 也必须判定失败。
9. 形成精确 changed-file 证据：pre/post status、全仓库 changed-name 对照、`app/not-found.tsx` 的完整新增或最小修改 diff、旧 global-error 产物的未变化证明、`next-env.d.ts` pre/post hash、unrelated dirty state 的逐项未变化证明。不得依赖普通 `git diff` 漏报 untracked 文件。
10. 取证后仅隔离/删除本 run 生成的 `.next/**`；若 `next-env.d.ts` 被自动改写，从快照字节级恢复。失败时：新增目标则只移除本 run 新文件；修改既有 clean target 则只恢复该文件的 preflight 字节；正式报告仍须保留 BLOCKED 证据；不得回退任何其他文件。
11. 由后续执行合同指定的报告责任方创建或幂等更新 `docs/exec/exec_TASK-N16-UNBLOCK-002_not_found_prerender_unblock.md`，记录 `NOT_FOUND_UNBLOCK_PASS` 或 `[BLOCKED]`、诊断结论、测试、fresh `BUILD_ID`、错误反证、changed-file、旧 global-error/dirty-state 保护、清理/回滚和 handback。
12. 全部验收通过后，在后续执行 Issue 回写摘要并链接正式报告；只 hand back 给 [SUO-361](/SUO/issues/SUO-361) 在 retained workspace/checkout 中从 R0 重启 R0 → R3。本任务 build 不得满足其 R2，不得直接进入 R3，不得宣布 baseline recovered。

## 输入 / 输出合同

### 输入

- [SUO-369](/SUO/issues/SUO-369) 的 scoped task-stage授权与内联新证据。
- 稳定 design/issue、task 013 requirement/task、global-error stage 和旧执行报告的只读上下文。
- 下游 StagePlanner 另行产出的唯一原子 execute 准入。

### 输出

- 唯一应用源码净变化：`app/not-found.tsx` 的新增或最小修改（二选一，由 preflight 决定）。
- 唯一新仓库证据报告：`docs/exec/exec_TASK-N16-UNBLOCK-002_not_found_prerender_unblock.md`，与应用 changed-file 分开计数。
- Paperclip/run-scratch 证据包：preflight、独立诊断、聚焦 lint、完整 cold build、fresh `BUILD_ID`、错误反证、exact changed-file、global-error/dirty-state 保护、清理/回滚和 handback。
- 唯一执行结论：`NOT_FOUND_UNBLOCK_PASS` 或带 owner/action 的 `[BLOCKED]`。

## 依赖与 DAG

```text
[SUO-361] recovery blocked
  → [SUO-364] global-error scoped chain produces new /_not-found evidence
      → [SUO-369] TASK-N16-UNBLOCK-002 contract
          → separate Stage Issue (CEOOrchestrator routes)
              → one atomic execute gate
                  ├─ NOT_FOUND_UNBLOCK_PASS → [SUO-361] restart R0 → R1 → R2 → R3
                  └─ BLOCKED → rollback own delta + new scoped evidence, no range expansion
```

- 本 task 与 [SUO-361](/SUO/issues/SUO-361) R0–R3、旧 global-error execute 均不得并行。
- StagePlanner 只能创建一个严格串行节点：preflight → independent diagnosis → one-file correction → lint → cold build → evidence → cleanup/report → handback。
- 没有可并行实现分支；任何第二候选文件都触发 STOP_AND_BLOCK。

## 前端 / 后端 / 联调 / 验收边界

- 前端：只交付 `app/not-found.tsx` 的自包含、静态、无 hooks/context 的 not-found fallback；不改正常页面、RootLayout、Provider、global-error、CSS 或业务交互。
- 后端：无实现工作；不改 Route Handler、`app/lib`、DB、schema/migration、服务端协议或响应结构。
- 联调：只验证 `app/not-found.tsx` 与 Next `16.1.6` App Router 的 `/_not-found` static generation/prerender 闭合，以及旧 `/_global-error` 错误不回归；不做页面/API/DB/Admin/PWA runtime 联调。
- 验收：同一执行 owner 在单一 Issue/run/retained checkout 中提交 diagnosis、lint、cold build、fresh `BUILD_ID`、两类错误反证、exact changed-file、回滚/清理和 handback 证据；StagePlanner 不执行这些命令。

## 测试策略

### Happy path

- `pnpm exec eslint app/not-found.tsx` exit `0`。
- build 前 `.next` 不存在；`pnpm build` exit `0`；本 run 生成 fresh、non-empty `.next/BUILD_ID`。
- 日志不再出现 `/_not-found` / null `useState`，也未重新出现 `/_global-error` / null `useContext` 或其他新的 prerender/resolver error；diagnostics 非失败。
- 最终应用源码净变化只有 `app/not-found.tsx`；新执行报告是唯一额外任务输出；旧 global-error 边界、recovery 文档、`next-env.d.ts` 和 unrelated dirty state 未变化。
- 本 run `.next` 已隔离/删除；结论为 `NOT_FOUND_UNBLOCK_PASS`；[SUO-361](/SUO/issues/SUO-361) 从 R0 完整重启。

### Failure paths

至少覆盖并保留以下任一类反证；命中即 `[BLOCKED]`：

1. 预先存在的 `app/not-found.tsx` 为 dirty/untracked 或 ownership 不明；未知 `.next`/`BUILD_ID` 无法归因；workspace/checkout 不连续。
2. 独立诊断表明必须修改第二个应用文件、`app/global-error.tsx`、layout/Provider/context、配置、版本、依赖或 recovery 文档。
3. 聚焦 lint 非零；build 非零/超时；`/_not-found` / null `useState` 仍存在；旧 `/_global-error` / null `useContext` 回归；出现新 prerender/resolver error；`BUILD_ID` 缺失、为空、陈旧，或仅在非零 build 后出现。
4. changed-file 超出 `app/not-found.tsx`，旧 global-error 产物或 unrelated dirty state 被改动，`next-env.d.ts` 无法恢复，或正式报告缺失/错路径。

Failure 时停止，不尝试第二方案、不运行 dev/R3、不改 hard deny。只回滚本 run 对 `app/not-found.tsx` 的可归因变化、隔离本 run `.next`、恢复 `next-env.d.ts`；保留新执行报告中的首失败命令、cwd、exit code、完整 error chain、证据位置、changed-file、回滚结果和明确 owner/action。

## StagePlanner 完成信号

- 应用修改 allowlist 精确到 `app/not-found.tsx`；正式报告 allowlist 精确到 `docs/exec/exec_TASK-N16-UNBLOCK-002_not_found_prerender_unblock.md`；所有其他 repo 路径均为只读或 hard deny。
- old build/`BUILD_ID` 排除、preflight、独立诊断、lint、cold build/fresh `BUILD_ID`、双错误反证、changed-file、rollback、dirty-state preservation 与 handback 均可机判。
- Stage 只能生成一个原子 execute 节点，不复用旧 global-error stage，也不直接绑定本 task 未授权的执行人。
- PASS 仅表示 not-found application blocker 被解除；[SUO-361](/SUO/issues/SUO-361) 必须重新从 R0 跑完 R3。

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

- 将 `app/not-found.tsx` 标为“预期新增或既有 clean tracked 最小修改 / 唯一应用净差异”，将 global-error 边界、root layout/Provider、配置、recovery 文档标为“只读参考 / 兼容性保护”。
- 在验收矩阵中拆开 build exit、fresh `BUILD_ID`、`/_not-found` 错误消失、`/_global-error` 不回归、changed-file、dirty-state preservation 和 handback，避免任一单项被误当成 PASS。
- 为 StagePlanner 提供 machine-readable 单节点拓扑与 STOP_AND_BLOCK 条件，但不写 stage 波次、工期或执行人派发。

USER REQUIREMENT:

为 [SUO-369](/SUO/issues/SUO-369) 生成 `TASK-N16-UNBLOCK-002` 的 shared 执行合同，独立处理在前序临时 global-error 变化后暴露的 `/_not-found` / null `useState` prerender failure。只允许 `app/not-found.tsx` 作为应用源码净变化；保护 framework/dependency 版本、package-management 文件、Refine/Admin/React Router、恢复文档、unrelated dirty state 与既有 global-error 边界。验收必须要求错误消失、`pnpm build` exit `0`、本 run 冷生成的 fresh non-empty `.next/BUILD_ID`、focused validation、failure rollback，以及成功后 [SUO-361](/SUO/issues/SUO-361) 从 R0 → R3 完整重启。旧 child build 和其 `BUILD_ID` 不得作为成功或恢复证据；不得实现代码或编排 stage。
