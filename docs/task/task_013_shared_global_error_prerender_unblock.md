# `TASK-N16-UNBLOCK-001`：解除 `/_global-error` prerender 阻塞

## 1. 任务标题

为 Next `16.1.6` 增加独立的根级 global error fallback，解除
`/_global-error` 的 `useContext` prerender 阻塞。

## 2. 关联 Issue 与任务元数据

- Task ID：`TASK-N16-UNBLOCK-001`
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
- 后续执行 owner：由 StagePlanner 和 execute-readiness 流程唯一绑定；本任务不直接派工。
- Requirement：
  [TASK-REQUIREMENT-task_013_shared_global_error_prerender_unblock.md](./TASK-REQUIREMENT-task_013_shared_global_error_prerender_unblock.md)

`shared` 的归一化依据是：唯一源码修复属于 App Router 前端根错误边界，但验收跨越
Client Component、Next SSR/static generation、构建生成态和恢复链 handback。该
domain 不授权后端或其他前端范围。

## 3. 任务目标

以一个可归因的应用源码差异解除现有构建阻塞：只新增
`app/global-error.tsx`，让 Next `16.1.6` 在不消费正常根布局、TanStack Query、
Workspace Context 或其他应用 Provider 的情况下完成 `/_global-error` prerender。

执行结论必须由以下证据共同成立：

1. 聚焦 lint exit `0`；
2. `pnpm build` exit `0`；
3. 本次 build 生成新鲜、非空的 `.next/BUILD_ID`；
4. build 日志不再包含 `/_global-error` / `useContext` prerender failure；
5. 本 run 唯一应用/源码净差异是新增 `app/global-error.tsx`；
6. ExecTaskAgent 在唯一获准路径
   `docs/exec/exec_TASK-N16-UNBLOCK-001_global_error_prerender_unblock.md`
   保留正式执行报告；该证据文档不计作第二个源码文件；
7. 本 run 生成态被清理或隔离，除上述源码与报告外的既有 dirty state 保持不变。

本任务成功只能回报 `UNBLOCK PASS`。它不构成 [SUO-361](/SUO/issues/SUO-361)
的 `R2 PASS`、`R3 PASS` 或 `BASELINE RECOVERED`；后者必须在 retained
workspace/checkout 中重新从 R0 串行执行 R0 → R3。

## 4. 输入与输出

### 输入

- [SUO-364](/SUO/issues/SUO-364) 的 application-level exception、范围、验证和
  handback 合同。
- `docs/exec/exec_SUO-361_next16_tailwind_postcss_baseline_recovery.md` §12：
  R0/R1 PASS，Next `16.1.6` compile 成功，static generation 在
  `/_global-error` 上因 null `useContext` exit `1`；Tailwind/PostCSS、模块解析、
  old-checkout/Refine 污染和配置 diff 均不是首失败原因。
- `docs/task/task_011_shared_next16_cold_build.md` 与
  `docs/stage/stage_next16_tailwind_postcss_baseline_recovery.md`：R2 需要 exit `0`
  和 fresh `BUILD_ID` 双证据，失败时禁止进入 R3。
- 应用只读锚点：`app/layout.tsx`、`app/app/providers.tsx`、
  `app/app/workspace-context.tsx`、`app/page.tsx`。
- 本地 Next `16.1.6` 只读锚点：
  `node_modules/next/dist/esm/client/components/builtin/global-error.js` 与
  `node_modules/next/dist/esm/build/webpack/loaders/next-app-loader/index.js`。
- StagePlanner 后续为 [SUO-366](/SUO/issues/SUO-366) 形成的唯一原子执行准入。

### 输出

- **唯一净源码输出**：新增 `app/global-error.tsx`。
- **唯一正式仓库证据输出**：由 ExecTaskAgent 创建或幂等更新
  `docs/exec/exec_TASK-N16-UNBLOCK-001_global_error_prerender_unblock.md`。该报告
  与应用/源码 changed-file acceptance 分开计数；其他 `docs/exec/**` 均不得变化。
- Paperclip/run-scratch 证据包：preflight、聚焦 lint、完整 build、fresh
  `BUILD_ID`、diagnostics、错误反证、精确 changed-file 原始证据、生成态清理、
  `next-env.d.ts` 保护和 handback 结论。Issue 评论只写摘要并链接正式报告，不能替代
  报告本身。
- `UNBLOCK PASS`，或包含首失败、owner/action 与精确回滚的 `[BLOCKED]`。
- 成功时向 [SUO-361](/SUO/issues/SUO-361) 发出的明确 handback：从 R0 重新执行
  R0 → R1 → R2 → R3，不从旧 R2 续跑。

## 5. 实现步骤

1. **固化执行身份与保护快照。**
   - 在 `$PROJECT_ROOT` 记录 Issue/run、时间、`pwd -P`、Git toplevel 与
     `git status --short`。
   - 记录 `app/global-error.tsx`、唯一正式报告路径是否存在，以及
     `next-env.d.ts` 的内容快照和 hash。
   - 若目标文件已由其他 actor 创建、workspace 不一致或 dirty state 无法归因，
     立即 `[BLOCKED]`；不得覆盖、reset、checkout、stash 或 clean。
   - 若精确报告路径已存在，只允许 ExecTaskAgent 在确认它属于同一 Task ID/执行链后
     幂等更新；ownership 不明时先阻塞，不得覆盖。
2. **复核首失败证据。**
   - 只读消费 [SUO-361](/SUO/issues/SUO-361) §12 的最新 R2 日志、根 layout、
     Provider/Context 与本地 Next global-error 实现。
   - 确认授权仍只针对 application-level `/_global-error` prerender；不得把版本、
     依赖、Tailwind/PostCSS、配置或 Refine 作为新入口。
3. **新增唯一错误边界文件。**
   - 只创建 `app/global-error.tsx`。
   - 第一条有效指令必须是 `"use client"`。
   - 默认导出根 global error 组件；props 合同显式包含 `error`（`Error` 加可选
     `digest`）和 `reset(): void`。
   - 组件自行返回完整 `<html lang="zh-CN">` 与 `<body>`，提供通用错误说明与调用
     `reset()` 的重试动作。
   - 不导入/渲染 `RootLayout`、Provider、Context、页面、业务组件、全局 CSS 或
     `app/lib/**`；不调用 hook/context，不新增依赖。
   - 不向 UI 输出 error message、stack、digest、环境变量或其他内部信息。样式如有，
     仅使用组件内静态且无 Provider 依赖的最小表达。
4. **运行聚焦静态检查。**
   - 从 `$PROJECT_ROOT` 执行 `pnpm exec eslint app/global-error.tsx`。
   - 保存命令、cwd、时间、完整输出和 exit code；非零时停止，不改 ESLint、
     TypeScript 或构建配置绕过。
5. **建立 build 冷态准入。**
   - build 前确认 `.next` 不存在。
   - 若存在且不能证明属于本 run，停止并请求作用域协调；不得覆盖或清理未知生成态。
6. **运行唯一权威构建。**
   - 从 `$PROJECT_ROOT` 执行 `pnpm build`，将完整 stdout/stderr、开始/结束时间和
     exit code 写入 `$PAPERCLIP_RUN_SCRATCH_DIR`。
   - 不启动 dev，不访问页面，不并行运行 [SUO-361](/SUO/issues/SUO-361) gate。
7. **判定 unblock。**
   - build 必须 exit `0`，日志显示 Next `16.1.6`。
   - 日志不得再出现 `/_global-error`、null `useContext` prerender failure、
     Tailwind/PostCSS 或 module-resolution error。
   - `.next/BUILD_ID` 必须是本 run 创建的新鲜非空普通文件；记录 mtime、size、
     hash/值摘要，并确认 diagnostics 不处于失败状态。
8. **报告精确 changed files。**
   - 保存 pre/post `git status --short`、全仓库 changed-name 对照、
     `app/global-error.tsx` 的完整新增 diff，以及 `next-env.d.ts` pre/post hash。
   - 对新文件执行 whitespace 检查；明确写出“本 run 唯一应用/源码净新增为
     `app/global-error.tsx`”。不能用全局清理伪造清洁结果，也不得把正式执行报告
     误计为第二个源码文件。
9. **收回瞬态副作用。**
   - 取证后仅隔离/删除本 run 可证明生成的 `.next/**`，不得提交或留作
     [SUO-361](/SUO/issues/SUO-361) 复用。
   - 若 Next 自动改写 `next-env.d.ts`，只能从本 run 的字节级快照恢复，并证明最终
     hash 与 preflight 相同。
   - 写正式报告前再次核验除 `app/global-error.tsx` 外没有本 run 应用/源码净变化，
     其他 dirty state 与 preflight 一致。
10. **保留唯一正式执行报告。**
    - ExecTaskAgent 创建或幂等更新
      `docs/exec/exec_TASK-N16-UNBLOCK-001_global_error_prerender_unblock.md`，记录
      `UNBLOCK PASS` 或 `[BLOCKED]`、实现文件、lint/build 命令与 exit code、fresh
      `BUILD_ID`、错误反证、应用/源码 changed-file 判定、最终仓库路径清单、生成态
      清理、回滚（如有）和 handback。
    - 报告是成功和失败路径都必须保留的交付证据；清理或回滚不得删除它，也不得创建
      第二份 `docs/exec/**` 报告。
11. **回写结论与 handback。**
    - 最终核验本 run 的应用/源码净变化只包含 `app/global-error.tsx`，任务拥有的仓库
      输出只包含该源码文件与精确报告，且其他 dirty state 与 preflight 一致。
    - 在 [SUO-364](/SUO/issues/SUO-364) 记录实现文件、lint/build exit code、fresh
      `BUILD_ID`、错误消失、最终 changed-file 清单和生成态清理结果，并链接精确报告。
    - 仅全部验收通过时写 `UNBLOCK PASS`；随后要求
      [SUO-361](/SUO/issues/SUO-361) 在其 retained workspace/checkout 从 R0 重启
      R0 → R3。

## 6. 涉及文件路径与修改边界

### 仓库源码唯一 allowlist

| 路径 | 分类 | 权限与准入 |
| --- | --- | --- |
| `app/global-error.tsx` | 预期新增 / 唯一净差异 | 只实现独立 Client global error；完整 `html/body`、通用提示、`reset()`；无 hook/context/Provider/敏感错误输出 |

### 正式执行报告唯一 allowlist

| 路径 | 分类 | 权限与准入 |
| --- | --- | --- |
| `docs/exec/exec_TASK-N16-UNBLOCK-001_global_error_prerender_unblock.md` | 必须保留的正式证据 / 非源码 | 仅 ExecTaskAgent 可为本 Task ID 创建或幂等更新；记录 PASS/BLOCKED、测试、changed-file、清理/回滚和 handback；不得在回滚中删除 |

### 瞬态执行例外与兼容性保护

| 路径 | 分类 | 权限与准入 |
| --- | --- | --- |
| `$PAPERCLIP_RUN_SCRATCH_DIR/**` | 证据写入 | 保存 preflight、lint、build、hash、diff、回滚与 handback 证据 |
| `.next/**` | build 瞬态生成 | 仅由本任务 `pnpm build` 直接生成、读取和取证；不手改、不提交，取证后仅清理本 run 可归因状态 |
| `next-env.d.ts` | 兼容性保护 | 非修改目标；仅允许对 Next 自动改写做 preflight 快照后的字节级恢复，最终 hash 必须不变 |
| Paperclip 评论/附件 | 审计摘要 | 回写结果摘要并链接唯一正式报告；不得替代仓库报告 |

### 只读参考

- 应用：`app/layout.tsx`、`app/app/providers.tsx`、
  `app/app/workspace-context.tsx`、`app/page.tsx`。
- 框架：`node_modules/next/dist/esm/client/components/builtin/global-error.js`、
  `node_modules/next/dist/esm/build/webpack/loaders/next-app-loader/index.js`。
- 版本/配置：`package.json`、`pnpm-lock.yaml`、`next.config.js`、
  `postcss.config.js`、`tsconfig.json`。
- 证据/规划：相关 `docs/design/**`、`docs/issue/**`、`docs/task/**`、
  `docs/stage/**`，以及除唯一报告外的既有 `docs/exec/**`（均只读保护）。

### Hard deny

- 除 `app/global-error.tsx` 外的全部 `app/**`，特别是 root layout、Provider、
  Workspace Context、page、`app/globals.css`、components、hooks、`app/api/**` 与
  `app/lib/**`。
- 所有 package-management/build/typecheck 配置：`package.json`、lockfile、
  `pnpm-workspace.yaml`、`next.config.js`、`postcss.config.js`、
  `playwright.config.ts`、`tsconfig.json`。
- Next、React、React DOM、Tailwind、PostCSS 版本/依赖图，以及任何安装、patch、
  新增、删除、升级或降级。
- Refine/Admin、`@refinedev/*`、React Router、`/admin`、第二个 Query Client 和旧
  S0 工作。
- schema/migration、`drizzle/**`、DB、API、领域逻辑、业务协议。
- 任何 repo 内 design/issue/task/stage 文档的新增或修改；除
  `docs/exec/exec_TASK-N16-UNBLOCK-001_global_error_prerender_unblock.md` 外所有
  `docs/exec/**` 的新增、修改、移动、删除或清理；父目录、sibling checkout、外部项目
  和 `node_modules/**`。
- 手工编辑或提交 `.next/**`；全局 reset/checkout/stash/clean、批量格式化，或覆盖
  任一 pre-existing dirty file。

## 7. 依赖项与 DAG

```text
[SUO-361] R2 application failure evidence
  → [SUO-364] application-level exception
      → [SUO-365] TASK-N16-UNBLOCK-001 contract
          → [SUO-366] one atomic Stage gate
              → authorized implementation + pnpm build
                  → exact ExecTaskAgent report
                      ├─ UNBLOCK PASS → [SUO-361] restart R0 → R1 → R2 → R3
                      └─ BLOCKED      → stop, rollback own delta, return to [SUO-364]
```

- 硬前置：本 task 合同完成，且 [SUO-366](/SUO/issues/SUO-366) 将其转成一个原子
  Stage 准入；execute-readiness 指定唯一执行 owner/lock/workspace。
- 并行条件：无。本任务不得与 [SUO-361](/SUO/issues/SUO-361) 的 R0–R3 并行。
- 后继：只有 `UNBLOCK PASS` 才允许 [SUO-361](/SUO/issues/SUO-361) 从 R0 重启；
  不存在直接解锁旧 R3 的边。
- 证据隔离：本任务 build 只证明 application blocker 消失，不能作为恢复 R2 的
  exit-0 / `BUILD_ID` 证据复用。

## 8. 前端 / 后端 / 联调边界

- **前端**：只交付根 global error 的独立、安全、可重试 fallback。不改正常页面、
  布局、Provider、Context、CSS 或业务交互。
- **后端**：无实现工作。不改 Route Handler、`app/lib`、DB、schema/migration、
  服务端协议或响应结构。
- **联调**：只验证自定义 Client Component 与 Next `16.1.6` App Router 的
  `/_global-error` static generation/SSR 构建路径闭合；不开展页面、API、DB、
  Admin 或 PWA runtime 联调。
- **验收**：同一执行 owner 在单一 Issue/run 中提交 lint、build、fresh
  `BUILD_ID`、错误反证、exact changed-file、冷 handback 和唯一正式报告证据。
  StagePlanner 只编排这些 gate，不运行命令；正式报告由 ExecTaskAgent 所有。

## 9. 测试策略

### 最小验证命令

```bash
pnpm exec eslint app/global-error.tsx
pnpm build
test -s .next/BUILD_ID
git status --short
git diff --name-status
git diff -- app/global-error.tsx
test -f docs/exec/exec_TASK-N16-UNBLOCK-001_global_error_prerender_unblock.md
```

对于尚未跟踪的新文件，changed-file 证据还必须包含其完整新增内容 diff；不能因普通
`git diff` 默认忽略 untracked file 而漏报。执行证据记录每条命令的 cwd、时间和 exit
code。`pnpm build` 后必须追加 `BUILD_ID` 的 file type、mtime、size、hash/值摘要，
以及 build log/diagnostics 检查。

### Happy path

1. `app/global-error.tsx` 是唯一新增源码，满足 Client Component、完整
   `html/body`、generic fallback 和 `reset()` 合同，且不含 hook/context/Provider
   依赖或敏感错误输出。
2. `pnpm exec eslint app/global-error.tsx` exit `0`。
3. `pnpm build` exit `0`；Next 为 `16.1.6`；本 run 生成 fresh、non-empty
   `.next/BUILD_ID`；日志无 `/_global-error` / `useContext` prerender error。
4. 最终应用/源码净变化只有 `app/global-error.tsx`；`next-env.d.ts` hash 不变；本 run
   `.next` 已隔离/删除；其他 dirty state 未改变。该 changed-file acceptance 不包含
   下一项要求的证据报告。
5. 唯一正式报告路径存在，内容覆盖测试、源码 changed-file、最终任务拥有路径、清理、
   回滚状态与 handback；除该精确路径外没有 `docs/exec/**` 变化。
6. 结论为 `UNBLOCK PASS`，Issue 评论链接正式报告，并只 hand back 给
   [SUO-361](/SUO/issues/SUO-361) 从 R0 重启。

### Failure paths

任一条件命中都输出 `[BLOCKED]`，停止并禁止扩大范围：

- lint 非零；build 非零/超时；`/_global-error` / `useContext` 错误仍存在；
  `BUILD_ID` 缺失、为空或不新鲜；diagnostics 仍失败。
- 修复需要第二个应用文件、Provider/layout/context、全局 CSS、版本、依赖、配置或
  package-manager 变化。
- 新错误边界使用 hook/context、导入业务组件或向 UI 输出 message/stack/digest。
- 执行前目标文件已存在，未知 `.next` 无法安全隔离，或 pre/post dirty state 无法
  归因。
- 应用/源码 changed-file 判定出现除 `app/global-error.tsx` 外的本 run 净变化，
  任务拥有的仓库输出出现除该源码与精确报告外的路径，或 `next-env.d.ts` 无法恢复到
  原 hash。
- 唯一正式报告缺失、路径拼写不一致、由非 ExecTaskAgent 所有，或本 run 触碰任一
  其他 `docs/exec/**` 路径。

Failure 时不得尝试第二修复方案、运行 dev/R3 或修改 hard deny。先保存首失败证据；
随后只移除本 run 新建且失败的 `app/global-error.tsx`、隔离本 run `.next`，并按
preflight 快照恢复 `next-env.d.ts`。其他 dirty state 保持原样。ExecTaskAgent 仍须在
唯一正式报告记录 BLOCKED、首失败和回滚结果；失败回滚不得删除该报告。

### 验收矩阵

| 验收项 | PASS 判定 | 反证 / 停止条件 |
| --- | --- | --- |
| `UNBLOCK-AC-001` 源码范围 | 唯一净差异为新增 `app/global-error.tsx` | 任一第二文件或不可归因 diff |
| `UNBLOCK-AC-002` 错误边界合同 | Client、完整 `html/body`、generic + retry、无 Provider/context/敏感输出 | hook/context/业务依赖、根 layout 复用或信息泄露 |
| `UNBLOCK-AC-003` 静态质量 | 聚焦 ESLint exit `0` | 非零或需改配置绕过 |
| `UNBLOCK-AC-004` build | `pnpm build` exit `0` + fresh non-empty `BUILD_ID` | 非零/超时/部分 `.next`/陈旧或缺失 `BUILD_ID` |
| `UNBLOCK-AC-005` 原错误反证 | 日志无 `/_global-error` / null `useContext` prerender failure | 原错误或 diagnostics failure 仍存在 |
| `UNBLOCK-AC-006` 清理与 handback | `.next` 已隔离/删除；`next-env.d.ts` hash 不变；指示 [SUO-361](/SUO/issues/SUO-361) 从 R0 重启 | 生成态/自动改写残留，或把 child build 当恢复 R2 |
| `UNBLOCK-AC-007` 正式报告边界 | 精确报告路径存在且覆盖 PASS/BLOCKED、测试、源码 changed-file、清理/回滚和 handback；其他 `docs/exec/**` 无本 run 变化 | 报告缺失/错路径/被回滚删除，或触碰任一其他 exec 路径 |

本任务不要求全量 Vitest/E2E，也不运行 `pnpm dev`。额外测试不能替代上述最小命令，
也不能成为扩大应用范围的理由。

## 10. 完成标志

- [ ] `TASK-N16-UNBLOCK-001` 唯一映射 [SUO-364](/SUO/issues/SUO-364)，domain 为
  `shared`，allow/deny 与 [SUO-361](/SUO/issues/SUO-361) 的失败证据一致。
- [ ] Stage/execute 使用单一 owner、Issue/run、checkout/workspace，并保留初始
  dirty-file 快照。
- [ ] 唯一净源码差异为新增 `app/global-error.tsx`；组件满足
  `UNBLOCK-AC-002`。
- [ ] 聚焦 lint exit `0`。
- [ ] `pnpm build` exit `0`，且 fresh non-empty `.next/BUILD_ID` 证据完整。
- [ ] build 日志与 diagnostics 证明 `/_global-error` / null `useContext` 首失败消失。
- [ ] 精确 changed-file、`next-env.d.ts` hash、瞬态 `.next` 清理和其他 dirty state
  保护证据完整。
- [ ] ExecTaskAgent 已保留
  `docs/exec/exec_TASK-N16-UNBLOCK-001_global_error_prerender_unblock.md`，且其他
  `docs/exec/**` 没有本 run 变化；该报告未被误计为应用/源码差异。
- [ ] 结论只写 `UNBLOCK PASS`，并明确要求
  [SUO-361](/SUO/issues/SUO-361) 从 R0 → R3 完整重启；未复用 child build。

以上全部成立才可关闭 application unblock。任一项缺失均为 `[BLOCKED]`，不能以
`BUILD_ID` 单项、编译成功、部分 `.next` 或“错误看似消失”代替完成。

## 11. 非目标

- 修改 root layout、Provider、Workspace Context、页面、业务组件、全局 CSS、API、
  `app/lib`、schema/migration 或 DB。
- 诊断/修复 Next/React/Tailwind/PostCSS 版本或依赖图，改构建/TypeScript/workspace
  配置，运行 install 或 package-manager 治理。
- 重加 Refine，创建/验证 `/admin`，切换 React Router，恢复旧 S0，或引入第二个
  Query Client。
- 运行 dev、`/` / `/customers` smoke、R3、全量 unit/E2E，或直接宣布
  `BASELINE RECOVERED`。
- 修改既有 recovery/design/issue/task/stage 文档；修改、删除或新增除
  `docs/exec/exec_TASK-N16-UNBLOCK-001_global_error_prerender_unblock.md` 外的任何
  exec 文档；触碰父目录、sibling checkout 与外部项目。
- 用全局 Git 清理、隐藏 dirty state、保留/提交 `.next`，或把本任务 build 复用为
  [SUO-361](/SUO/issues/SUO-361) gate 证据。

## 12. 风险、阻塞与回退

| 触发条件 | 停止与回退 | Owner | Unblock / 澄清 action |
| --- | --- | --- | --- |
| 目标文件在 preflight 前已存在或 ownership 不明 | 不覆盖、不继续 | 当前执行 owner + `CEOOrchestrator` | 在 [SUO-364](/SUO/issues/SUO-364) 协调唯一文件 owner，重新建立 preflight |
| lint 非零或组件需要 Provider/context | 保存首失败；移除本 run 新文件 | 当前执行 owner | 在唯一文件内收敛到无上下文 fallback；不得改 Provider/layout/配置 |
| build 非零、超时或原 `useContext` error 仍在 | 锁定后续；隔离本 run `.next`；回滚新文件 | 当前执行 owner | 回写完整错误链、diagnostics、diff；交 [SUO-364](/SUO/issues/SUO-364) 判断新的 scoped contract |
| 需要版本、依赖、配置或第二个应用文件 | 不实施、不猜测第二方案 | `CEOOrchestrator`；必要时 `DesignArchitect` | 基于新证据另行授权；本 task 保持 blocked |
| 未知 `.next` 或 dirty diff 无法归因 | 不覆盖、不全局清理 | `CEOOrchestrator / workspace owner` | 恢复可区分的 execution workspace 后重新从 preflight 开始 |
| `next-env.d.ts` 自动改写无法按 hash 恢复 | build 结果不收口；停止 handback | 当前执行 owner | 用本 run 字节快照恢复并证明 hash；失败则 blocked |
| 唯一正式报告缺失、ownership 不明或出现其他 `docs/exec/**` 变化 | 不 hand back；保留测试/回滚证据，不清理既有 exec dirty state | `ExecTaskAgent + CEOOrchestrator` | 只在精确路径补齐/校正报告 ownership，撤销本 run 对其他 exec 路径的可归因变化 |
| child build 成功但 handback 被误当作 R2 PASS | 拒绝直接进入 R3 | `CEOOrchestrator + ExecTaskAgent` | [SUO-361](/SUO/issues/SUO-361) 在 retained chain 中重新从 R0 执行 |

回退只覆盖本 run 可证明创建的 `app/global-error.tsx`、本 run 生成的 `.next/**` 和
Next 对 `next-env.d.ts` 的自动改写；不得回退或格式化任何 pre-existing dirty file。
唯一正式执行报告必须保留并写明失败与回退，不属于可删除的实现 delta。阻塞记录必须
包含最后成功步骤、首失败步骤、命令、cwd、exit code、完整错误链、evidence location、
exact changed-file、回滚结果、报告路径，以及拥有下一 action 的 owner。
