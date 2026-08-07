# `TASK-N16-UNBLOCK-002`：解除 `/_not-found` prerender 阻塞

## 1. 任务标题

独立诊断并以单一 App Router not-found 边界解除 `/_not-found` 的 null
`useState` prerender 阻塞。

## 2. 关联 Issue 与任务元数据

- Task ID：`TASK-N16-UNBLOCK-002`
- 唯一映射 Issue：[SUO-369](/SUO/issues/SUO-369)
- 上游 application unblock：[SUO-364](/SUO/issues/SUO-364)
- 被阻塞恢复链：[SUO-361](/SUO/issues/SUO-361)
- 下游 Stage Issue：尚未创建；由 `CEOOrchestrator` 在本任务完成后另行路由。
- domain：`shared`
- 优先级：`high`
- Paperclip labels：wake payload 未提供；本文不虚构控制面标签。
- 文档内分类标签：`next16`、`not-found`、`prerender`、`useState`、`unblock`、`shared`
- 唯一规划主责：`TaskDesignAgent`
- 后续执行 owner：由 StagePlanner 与 execute-readiness 流程唯一绑定；本任务不直接派工。
- Requirement：
  [TASK-REQUIREMENT-task_014_shared_not_found_prerender_unblock.md](./TASK-REQUIREMENT-task_014_shared_not_found_prerender_unblock.md)

`shared` 的归一化依据是：唯一允许的应用修复属于 App Router not-found 页面边界，
但验收跨越静态页面、Next prerender、冷构建生成态、证据隔离、回滚和恢复链
handback。该 domain 不授权后端、其他前端页面或共享基础设施变化。

### 新证据边界

- [SUO-364](/SUO/issues/SUO-364) 范围内的临时 `app/global-error.tsx` 变化已消除
  原 `/_global-error` / null `useContext` 首失败。
- 后续冷 build 仍 exit `1`，新的首失败是 prerender `/_not-found` 时读取 null
  `useState`。
- 临时源码变化随后已回滚；该 build 及其 `.next/BUILD_ID` 只构成新错误的来源证据，
  不构成本任务或 [SUO-361](/SUO/issues/SUO-361) 的成功证据。
- 本任务不在 task 阶段宣布根因，只把下游独立诊断与最小应用修复限制在一个可机判
  边界内。

## 3. 任务目标

定义一个原子、严格串行、可回滚的 execute 合同：先从冷 workspace 独立复核
`/_not-found` / null `useState` 首失败，再仅通过 `app/not-found.tsx` 的新增或最小
修改解除阻塞。该路径是唯一允许产生净应用源码变化的文件；是否新增或修改由执行前
preflight 决定，二者不能并存，也不能转向第二候选文件。

执行完成必须由以下证据共同成立：

1. preflight 证明 checkout/workspace、目标文件、`.next`、旧 global-error 产物与
   unrelated dirty state 均可归因；
2. 独立诊断证明单一 `app/not-found.tsx` allowlist 足够，不需要扩大到 layout、
   Provider、global-error、配置、版本或依赖；
3. 聚焦 ESLint exit `0`；
4. `pnpm build` exit `0`；
5. `.next/BUILD_ID` 是本 run 冷 build 开始后生成的非空普通文件；
6. build 日志不再包含 `/_not-found` / null `useState`，也未重新出现
   `/_global-error` / null `useContext` 或新的 prerender/resolver failure；
7. 最终唯一应用源码净变化是 `app/not-found.tsx`，旧 global-error 边界、恢复文档、
   `next-env.d.ts` 与所有 unrelated dirty state 保持 preflight 状态；
8. 唯一新正式执行报告完整记录 PASS 或 BLOCKED、清理/回滚和 handback。

成功结论只能写 `NOT_FOUND_UNBLOCK_PASS`。它只解除新的 application blocker，不是
[SUO-361](/SUO/issues/SUO-361) 的 `R2 PASS`、`R3 PASS` 或
`BASELINE RECOVERED`。恢复链必须在 retained workspace/checkout 中重新从 R0 串行
执行 R0 → R1 → R2 → R3。

## 4. 输入与输出

### 输入

- [SUO-369](/SUO/issues/SUO-369) 的 Objective、New evidence、Required contract、
  phase/ownership 与 Completion signal。
- `docs/design/design_002_next16_tailwind_postcss_baseline_recovery.md`：R0–R3、冷
  `.next`、fresh `BUILD_ID`、dirty-state preservation、失败与回滚的稳定设计。
- `docs/issue/ISSUES_next16_tailwind_postcss_baseline_recovery.md`：恢复边界和串行
  handback 的只读 Issue 合同。
- `docs/task/TASK-REQUIREMENT-task_013_shared_global_error_prerender_unblock.md`、
  `docs/task/task_013_shared_global_error_prerender_unblock.md` 与
  `docs/stage/stage_global_error_prerender_unblock.md`：已完成 global-error 边界，只读。
- `docs/exec/exec_TASK-N16-UNBLOCK-001_global_error_prerender_unblock.md`：既有执行链
  dirty report，只读保护；其 build/`BUILD_ID` 不可复用。
- 下游只读应用锚点：`app/layout.tsx`、`app/app/providers.tsx`、
  `app/app/workspace-context.tsx`、`app/page.tsx`，以及 `app/not-found.tsx` 的
  preflight 状态和内容。
- 本地 Next `16.1.6` 的 `not-found` / `/_not-found` loader 与 builtin 实现，只读。
- StagePlanner 后续基于本合同形成的唯一原子 execute 准入。

### 输出

- **唯一应用源码净输出**：`app/not-found.tsx`，由 preflight 决定为新增或对既有
  clean tracked file 的最小修改。
- **唯一新正式仓库证据输出**：
  `docs/exec/exec_TASK-N16-UNBLOCK-002_not_found_prerender_unblock.md`。报告与应用
  changed-file 分开计数；所有其他 `docs/exec/**` 均不得变化。
- Paperclip/run-scratch 证据包：preflight、独立诊断、聚焦 lint、完整 cold build、
  fresh `BUILD_ID`、新旧错误反证、exact changed-file、旧 global-error/dirty-state
  保护、瞬态清理、回滚和 handback。
- 唯一执行结论：`NOT_FOUND_UNBLOCK_PASS`，或包含首失败、证据、回滚和明确
  owner/action 的 `[BLOCKED]`。
- 成功 handback：要求 [SUO-361](/SUO/issues/SUO-361) 在 retained
  workspace/checkout 从 R0 重新完成 R0 → R3；不得从旧 R2/R3 续跑。

## 5. 实现步骤

1. **固化执行身份和保护快照。**
   - 在 `$PROJECT_ROOT` 记录 Issue/run、开始时间、`pwd -P`、Git toplevel、
     Paperclip workspace cwd 与 checkout/assignee 连续性。
   - 保存 `git status --short --untracked-files=all`，逐项标记 pre-existing dirty/
     untracked 文件；已知旧报告属于保护项，不能当作本任务变化。
   - 记录 `.next` 是否存在、`next-env.d.ts` 字节/hash、`app/not-found.tsx` 的
     缺失/clean tracked/dirty/untracked 状态、内容/hash/ownership，以及
     `app/global-error.tsx` 与新旧执行报告路径的状态/hash。
   - 目标文件预先 dirty/untracked/ownership 不明、`.next` 来源不明、workspace 不同源
     或 dirty state 不可归因时，立即 `[BLOCKED]`；不得覆盖或全局清理。
2. **独立复核首失败。**
   - 只读消费 [SUO-369](/SUO/issues/SUO-369) 新证据、旧 global-error 合同/报告、
     root layout/Provider 锚点和本地 Next not-found 约定。
   - 明确记录：临时 global-error 变化曾移除原错误，但已回滚；旧 build 与旧
     `BUILD_ID` 只用于说明错误序列，不能作为当前 preflight/PASS 输入。
   - 不在此步骤修改任何文件或运行预热 build。
3. **执行单文件 scope decision。**
   - 在无修改状态下判断 null `useState` 首失败能否由自包含
     `app/not-found.tsx` 收敛。
   - 若证据需要第二个应用文件、`app/global-error.tsx`、RootLayout、Provider/
     Context、配置、版本、依赖、安装或恢复文档变化，记录首个越界需求并
     `STOP_AND_BLOCK`；不得尝试第二方案。
4. **创建或最小修改唯一目标。**
   - `app/not-found.tsx` 缺失时只新增该文件；其为既有 clean tracked file 时只在
     该文件内完成最小修改。
   - 产物必须自包含、静态可 prerender、无 hooks/context/应用 Provider/业务依赖，
     提供最小 not-found 文案和返回安全入口的普通链接。
   - 不导入 RootLayout、TanStack Query、Workspace Context、页面、业务组件、
     `app/lib/**`、全局 CSS 或新依赖；不显示 error、stack、digest、环境变量等内部
     信息。
   - Client directive 不是默认要求；只有独立诊断证明必要且仍不引入 hook 时才可在
     唯一文件内使用。无交互需求时保持 Server Component/static fallback。
5. **运行聚焦静态检查。**
   - 从 `$PROJECT_ROOT` 执行 `pnpm exec eslint app/not-found.tsx`。
   - 保存命令、cwd、开始/结束时间、完整输出与 exit code；非零立即停止，不改 lint、
     TypeScript、build 或 package 配置绕过。
6. **建立真正冷 build 准入。**
   - build 前 `.next` 必须不存在；旧 child build 目录或 `BUILD_ID` 不得存在于本次
     输入。
   - 若发现未知 `.next`，停止并由 workspace owner 恢复可区分冷态；本任务不得覆盖、
     清理或借用未知生成物。
7. **运行唯一权威构建。**
   - 从 `$PROJECT_ROOT` 执行 `pnpm build`，将完整 stdout/stderr、开始/结束时间和
     exit code 写入 `$PAPERCLIP_RUN_SCRATCH_DIR`。
   - 不运行 install、dev、页面 smoke、全量 unit/E2E，不并行启动
     [SUO-361](/SUO/issues/SUO-361) gate。
8. **判定错误消失和 fresh `BUILD_ID`。**
   - build 必须 exit `0`，日志仍显示 Next `16.1.6`。
   - 日志不得出现 `/_not-found`、null `useState` prerender failure；也不得重新出现
     `/_global-error`、null `useContext`、Tailwind/PostCSS/module-resolution 或其他
     新 prerender error。
   - `.next/BUILD_ID` 必须是 build 开始后新生成的非空普通文件；记录 file type、
     mtime、size、hash/值摘要，并确认 diagnostics 不处于失败状态。
   - build exit 非零时，即使 `.next/BUILD_ID` 存在且看似新鲜，也必须判为 FAILED。
9. **形成精确 changed-file 和保护证据。**
   - 保存 pre/post status、全仓库 changed-name 对照和 `app/not-found.tsx` 的完整新增
     或最小修改 diff；新 untracked 文件不得因普通 `git diff` 忽略而漏报。
   - 对比 `next-env.d.ts`、`app/global-error.tsx`、旧 requirement/task/stage/exec
     产物及所有 pre-existing dirty/untracked 项的 pre/post 状态/hash。
   - 明确写出“本 run 唯一应用源码净变化为 `app/not-found.tsx`；唯一额外任务输出为
     精确新执行报告”。任一第三路径即停止。
10. **清理或精确回滚本 run 副作用。**
    - 取证后仅隔离/删除本 run 可证明生成的 `.next/**`；不提交、不保留给恢复链。
    - 若 Next 自动改写 `next-env.d.ts`，从 preflight 快照字节级恢复并证明 hash 相同。
    - Failure 时，若目标由本 run 新增，仅移除该新文件；若目标是既有 clean tracked
      file，仅恢复其 preflight 字节。不得 reset/checkout/stash/clean 其他路径。
11. **保留唯一正式执行报告。**
    - execute-readiness 指定的报告责任方创建或幂等更新
      `docs/exec/exec_TASK-N16-UNBLOCK-002_not_found_prerender_unblock.md`。
    - 报告记录 `NOT_FOUND_UNBLOCK_PASS` 或 `[BLOCKED]`、独立诊断、目标初始状态、
      lint/build、fresh `BUILD_ID`、新旧错误反证、changed-file、global-error/dirty-state
      保护、清理/回滚和 handback。
    - 报告在成功与失败路径都必须保留；不得修改/删除旧报告或创建第二份新报告。
12. **回写结论与 handback。**
    - 最终核验应用源码变化、新报告、`next-env.d.ts`、old global-error 与 unrelated dirty
      state 均符合边界。
    - 在后续 execute Issue 回写摘要并链接报告。只有全部 AC 通过才写
      `NOT_FOUND_UNBLOCK_PASS`。
    - 成功后 hand back 给 [SUO-361](/SUO/issues/SUO-361) 从 R0 冷启动完整
      R0 → R3；本任务 build 不满足其 R2，也不允许直接进入 R3。

## 6. 涉及文件路径与修改边界

### 应用源码唯一 allowlist

| 路径 | 分类 | 权限与准入 |
| --- | --- | --- |
| `app/not-found.tsx` | 唯一应用源码净变化 | preflight 缺失时可新增；既有 clean tracked 时可最小修改；dirty/untracked/ownership 不明时 BLOCKED。只允许静态、自包含、无 hooks/context/Provider/业务依赖的 not-found fallback |

### 正式执行报告唯一 allowlist

| 路径 | 分类 | 权限与准入 |
| --- | --- | --- |
| `docs/exec/exec_TASK-N16-UNBLOCK-002_not_found_prerender_unblock.md` | 唯一新正式仓库证据 / 非应用源码 | 仅 execute-readiness 指定的报告责任方可为本 Task ID 创建或幂等更新；记录 PASS/BLOCKED、诊断、测试、changed-file、保护、清理/回滚和 handback |

### 只读诊断锚点与兼容性保护

| 路径 | 分类 | 约束 |
| --- | --- | --- |
| `app/layout.tsx`、`app/app/providers.tsx`、`app/app/workspace-context.tsx`、`app/page.tsx` | 应用诊断锚点 | 只读；不得借诊断改 layout、Provider、Context 或页面 |
| `app/global-error.tsx` | 已完成 global-error 边界保护 | 保持 preflight 状态；按新证据预期为已回滚/缺失，不得新增、恢复、修改或删除 |
| `node_modules/next/**` | Next `16.1.6` 框架锚点 | 只读 `not-found` / loader 实现；不得 patch、安装或写入 |
| `package.json`、全部 lock/workspace/config 文件 | 版本与配置锚点 | 只读；版本、依赖图与配置均冻结 |
| task 013 requirement/task、global-error stage 与旧 exec report | 已完成恢复文档 | 只读保护；旧 build/`BUILD_ID` 只作失败序列证据 |
| 所有 pre-existing dirty/untracked 文件 | unrelated dirty state | pre/post 逐项保持；不得清理、覆盖、格式化、提交或归入本任务输出 |

### 瞬态执行例外

| 路径 | 分类 | 权限与准入 |
| --- | --- | --- |
| `$PAPERCLIP_RUN_SCRATCH_DIR/**` | 运行证据 | 保存 preflight、诊断、lint/build、hash/diff、清理、回滚与 handback |
| `.next/**` | 冷 build 生成态 | preflight 必须为空；只允许本 run `pnpm build` 生成/读取；取证后隔离或删除，不提交、不复用 |
| `next-env.d.ts` | 自动改写兼容性保护 | 非修改目标；若被 Next 改写，只能字节级恢复，最终 hash 等于 preflight |
| Paperclip 评论/附件 | 审计摘要 | 链接正式报告和结果摘要；不得替代仓库报告 |

### Hard deny

- 除 `app/not-found.tsx` 外的全部 `app/**`，特别是 root layout、Provider、Workspace
  Context、page、global-error、global CSS、components、hooks、`app/api/**` 与
  `app/lib/**`。
- Next、React、React DOM、Tailwind、`@tailwindcss/postcss`、PostCSS 的版本/依赖图；
  任何 install、patch、新增、删除、升级、降级或重装。
- `package.json`、`pnpm-lock.yaml`、`package-lock.json`、`pnpm-workspace.yaml`、
  `next.config.js`、`postcss.config.js`、`playwright.config.ts`、`tsconfig.json`。
- Refine/Admin、`@refinedev/*`、React Router、`/admin`、Ant Design/MUI、第二个
  Query Client 和旧 S0 工作。
- schema/migration、`drizzle/**`、DB、API、领域逻辑和业务协议。
- 所有既有 `docs/design/**`、`docs/issue/**`、`docs/task/**`、`docs/stage/**` 与
  `docs/exec/**`；唯一本任务报告路径是上述精确例外。特别禁止修改或删除
  `docs/exec/exec_TASK-N16-UNBLOCK-001_global_error_prerender_unblock.md`。
- 父目录、sibling checkout、外部项目、`node_modules/**` 写入、pre-existing dirty
  state、全局 reset/checkout/stash/clean、批量格式化、手工编辑或提交 `.next/**`。

## 7. 依赖项与 DAG

```text
[SUO-361] recovery blocked
  → [SUO-364] scoped global-error chain exposes a distinct /_not-found failure
      → [SUO-369] TASK-N16-UNBLOCK-002 task contract
          → separate Stage Issue routed by CEOOrchestrator
              → one atomic execute gate
                  ├─ NOT_FOUND_UNBLOCK_PASS
                  │    → [SUO-361] retained workspace/checkout
                  │         → restart R0 → R1 → R2 → R3
                  └─ BLOCKED
                       → rollback own delta + preserve report
                            → CEOOrchestrator routes new scoped evidence
```

- **硬前置**：本 task 与 requirement 完成；CEOOrchestrator 另建 stage Issue；
  StagePlanner 把合同转成恰好一个串行 execute 节点；execute-readiness 绑定唯一
  assignee、checkout、retained workspace 和报告责任方。
- **并行条件**：无。不得与 [SUO-361](/SUO/issues/SUO-361) R0–R3、旧
  global-error execute 或其他候选修复并行。
- **关键路径**：preflight → independent diagnosis → one-file scope decision →
  change → lint → cold build → fresh evidence → cleanup/report → handback。
- **停止边**：任何第二文件或 hard-deny 需求、不可归因生成态/diff、lint/build/AC
  失败均进入 BLOCKED；不存在自动扩大 allowlist 的分支。
- **后继**：只有 `NOT_FOUND_UNBLOCK_PASS` 才 hand back [SUO-361](/SUO/issues/SUO-361)
  从 R0 重启；本任务 child build 不可复用。

## 8. 前端 / 后端 / 联调边界

- **前端**：只交付 `app/not-found.tsx` 的自包含、静态可 prerender、无 hooks/context
  的 fallback。不改 RootLayout、Provider、global-error、正常页面、CSS 或业务交互。
- **后端**：无实现工作。不改 Route Handler、`app/lib`、DB、schema/migration、
  服务端协议、鉴权或响应结构。
- **联调**：只验证唯一 not-found 文件与 Next `16.1.6` App Router 的
  `/_not-found` static generation/prerender 闭合，以及旧 `/_global-error` 错误不回归。
  不做页面/API/DB/Admin/PWA runtime 联调。
- **验收**：同一执行 owner 在单一 Issue/run/retained checkout 中提交 preflight、
  diagnosis、lint、cold build、fresh `BUILD_ID`、两类错误反证、exact changed-file、
  dirty-state preservation、cleanup/rollback 和 handback；StagePlanner 不运行命令。

## 9. 测试策略

### 最小验证命令

```bash
pnpm exec eslint app/not-found.tsx
pnpm build
test -s .next/BUILD_ID
git status --short --untracked-files=all
git diff --name-status
git diff -- app/not-found.tsx
test -f docs/exec/exec_TASK-N16-UNBLOCK-002_not_found_prerender_unblock.md
```

若 `app/not-found.tsx` 是新增 untracked 文件，必须额外保存其完整新增内容或使用能显示
untracked 内容的等效 diff；不能因普通 `git diff` 默认忽略新文件而漏报。每条命令都
记录 cwd、时间、完整输出与 exit code。`pnpm build` 后追加 `BUILD_ID` 的 file type、
mtime、size、hash/值摘要和 diagnostics 检查；旧 report、global-error 状态、
`next-env.d.ts` 与 unrelated dirty state 使用 pre/post hash/status 对照。

### Happy path

1. preflight 证明 target、cold `.next`、checkout/workspace 和 dirty state 均可归因；
   单一 `app/not-found.tsx` allowlist 足够。
2. not-found fallback 自包含、静态可 prerender、无 hooks/context/Provider/业务依赖或
   敏感信息。
3. `pnpm exec eslint app/not-found.tsx` exit `0`。
4. `pnpm build` exit `0`；Next 仍为 `16.1.6`；本 run 生成 fresh non-empty
   `.next/BUILD_ID`；diagnostics 非失败。
5. 日志不再包含 `/_not-found` / null `useState`，不回归 `/_global-error` / null
   `useContext`，且没有新的 Tailwind/PostCSS/module-resolution/prerender error。
6. 最终唯一应用源码净变化是 `app/not-found.tsx`；精确新报告是唯一额外任务输出；旧
   global-error 边界、恢复文档、`next-env.d.ts` 与 unrelated dirty state 未变化。
7. 本 run `.next` 已隔离/删除；正式报告结论为 `NOT_FOUND_UNBLOCK_PASS`；
   [SUO-361](/SUO/issues/SUO-361) 从 R0 完整重启。

### Failure paths

任一条件命中都必须输出 `[BLOCKED]`、停止后续步骤并禁止扩大范围：

- `app/not-found.tsx` 在 preflight 时为 dirty/untracked/ownership 不明；workspace/
  checkout 不连续；未知 `.next` 或 dirty state 无法归因。
- 独立诊断要求第二个应用文件、global-error、layout/Provider/context、配置、版本、
  依赖、安装或 recovery 文档变化。
- 聚焦 lint 非零；build 非零/超时；`BUILD_ID` 缺失、为空、陈旧，或仅在失败 build 后
  出现；diagnostics 失败。
- `/_not-found` / null `useState` 仍在；`/_global-error` / null `useContext` 回归；
  出现新的 prerender、Tailwind/PostCSS 或 module-resolution 首失败。
- changed-file 超出 `app/not-found.tsx`；任务输出出现精确新报告以外的路径；旧
  global-error 产物、recovery 文档或 unrelated dirty state 变化；`next-env.d.ts`
  无法恢复。
- 新报告缺失、路径或 Task ID 不符、ownership 不明，或本 run 触碰旧 exec report/
  其他 `docs/exec/**`。

Failure 时不得尝试第二修复方案、运行 dev/R3 或修改 hard deny。先保存最后成功步骤与
首失败步骤，然后仅回滚本 run 对 `app/not-found.tsx` 的可归因变化、隔离本 run
`.next`、按快照恢复 `next-env.d.ts`。其他文件保持原样。正式报告必须保留 BLOCKED、
command、cwd、exit code、完整 error chain、evidence location、changed-file、回滚结果
与 owner/action。

### 验收矩阵

| 验收项 | PASS 判定 | 反证 / 停止条件 |
| --- | --- | --- |
| `NOTFOUND-AC-001` 独立冷 preflight | checkout/workspace 同源；`.next` 为空；target、old global-error 与 dirty state 有快照 | 未知生成态、ownership 或 diff 不可归因 |
| `NOTFOUND-AC-002` 单文件范围 | 唯一应用源码净变化为 `app/not-found.tsx` | 任一第二文件、配置、版本、依赖或文档修复需求 |
| `NOTFOUND-AC-003` fallback 合同 | 静态可 prerender、无 hooks/context/Provider/业务依赖/敏感输出 | 新 hook、Client state、业务 import 或信息泄露 |
| `NOTFOUND-AC-004` 聚焦静态质量 | `pnpm exec eslint app/not-found.tsx` exit `0` | 非零或需改配置绕过 |
| `NOTFOUND-AC-005` 冷 build | `pnpm build` exit `0` + 本 run fresh non-empty `BUILD_ID` + diagnostics 非失败 | 非零/超时/旧、空或缺失 `BUILD_ID`；部分 `.next` 生成 |
| `NOTFOUND-AC-006` 错误反证 | 无 `/_not-found` / null `useState`，且 `/_global-error` / null `useContext` 不回归 | 原错误仍在、旧错误回归或出现新 prerender/resolver failure |
| `NOTFOUND-AC-007` 保护与报告 | 旧 global-error/recovery/dirty state/hash 未变；唯一新 report 完整；`.next` 已收回 | 第三路径、旧产物变化、报告缺失/错路径、生成态残留 |
| `NOTFOUND-AC-008` handback | 只写 `NOT_FOUND_UNBLOCK_PASS`，要求 [SUO-361](/SUO/issues/SUO-361) 从 R0 重启 | 将 child build 复用为 R2/R3 或宣布 baseline recovered |

本任务不要求也不允许 `pnpm dev`、页面 smoke、全量 Vitest/E2E。额外测试不能替代上述
最小证据，也不能成为扩大 application allowlist 的理由。

## 10. 完成标志

### Task 阶段完成信号

- [ ] `TASK-N16-UNBLOCK-002` 唯一映射 [SUO-369](/SUO/issues/SUO-369)，domain 为
  `shared`，并链接已填充 requirement。
- [ ] 应用修改 allowlist 精确到 `app/not-found.tsx`；新正式报告精确到
  `docs/exec/exec_TASK-N16-UNBLOCK-002_not_found_prerender_unblock.md`。
- [ ] framework/dependency、package-management、Refine/Admin/React Router、
  recovery documents、global-error 边界与 unrelated dirty state 全部进入显式 deny/
  compatibility protection。
- [ ] preflight、独立诊断、focused lint、cold build/fresh `BUILD_ID`、错误反证、
  changed-file、failure rollback 与 R0 handback 均为 machine-decidable。
- [ ] StagePlanner 可以据此生成一个原子串行 gate，无需猜测文件、测试、停止条件或
  owner/action；本文未编排 stage 或直接派发执行人。

### 后续 execute 完成信号

- [ ] `NOTFOUND-AC-001` 至 `NOTFOUND-AC-008` 全部通过。
- [ ] `pnpm build` exit `0` 且 fresh non-empty `.next/BUILD_ID` 证据完整。
- [ ] `/_not-found` / null `useState` 消失，`/_global-error` / null `useContext` 未回归。
- [ ] 唯一应用源码净变化与唯一新 report 符合 allowlist；其他所有状态与 preflight
  一致；本 run `.next` 已收回。
- [ ] 正式报告与 Issue 评论只写 `NOT_FOUND_UNBLOCK_PASS`，并将
  [SUO-361](/SUO/issues/SUO-361) hand back 到 R0，而非复用 child build。

任一 execute 项缺失都必须是 `[BLOCKED]`，不能以编译完成、部分 `.next`、单独
`BUILD_ID` 或“错误看似消失”代替完成。

## 11. 非目标

- 在 task 阶段诊断源码、实现 `app/not-found.tsx`、运行 lint/build 或生成
  `.next/**`。
- 修改/恢复 `app/global-error.tsx`、RootLayout、Provider、Workspace Context、页面、
  业务组件、CSS、API、`app/lib`、schema/migration 或 DB。
- 更改 Next/React/Tailwind/PostCSS 版本、依赖图、lock/workspace/build/typecheck 配置，
  或运行 install/package-manager 治理。
- 重加 Refine，创建/验证 `/admin`，切换 React Router，引入 UI 套件或第二个 Query
  Client，恢复旧 S0。
- 修改既有 design/issue/task/stage/exec 文档；清理旧 global-error report 或其他
  pre-existing dirty/untracked state。
- 运行 dev、`/` / `/customers` smoke、R3、全量 unit/E2E，或直接宣布
  `BASELINE RECOVERED`。
- 用全局 Git 清理、保留/提交 `.next`、复用旧 build/`BUILD_ID`，或让本任务 build
  直接满足 [SUO-361](/SUO/issues/SUO-361) gate。
- 设计 stage 波次、工期、并行实现分支或执行 Agent 派发。

## 12. 风险、阻塞与回退

| 触发条件 | 停止与回退 | Owner | Unblock / 澄清 action |
| --- | --- | --- | --- |
| target 预先 dirty/untracked、ownership 不明，或 checkout/workspace 不连续 | 不覆盖、不开始诊断修复；保留 preflight | `CEOOrchestrator / workspace owner` | 建立唯一 retained workspace 与可归因 target 后重新从 preflight 开始 |
| `.next`、旧 `BUILD_ID` 或 dirty state 来源不明 | 不清理、不复用、不 build | `CEOOrchestrator / workspace owner` | 隔离前序执行生成态并提供 cold-start ownership 证明 |
| 独立诊断需要第二文件、global-error、Provider/layout/context、配置、版本或依赖 | STOP_AND_BLOCK；不实施猜测性方案 | `CEOOrchestrator`；需要设计变更时由 `DesignArchitect` 参与 | 基于新错误链另建 scoped design/issue/task；当前 allowlist 不扩张 |
| lint 非零或 fallback 需要 hook/client state | 保存首失败；回滚本 run target 变化 | 当前执行 owner | 仅在同一文件内收敛为静态无 hook fallback；若不能则回到 CEOOrchestrator |
| build 非零/超时、null `useState` 仍在或新 prerender error 出现 | 停止后续；隔离本 run `.next`；精确回滚 target | 当前执行 owner + `CEOOrchestrator` | 回写完整 error chain、diagnostics、diff 与 rollback；路由独立后续合同 |
| 旧 `/_global-error` / null `useContext` 回归 | 不修改 global-error；本任务 BLOCKED | `CEOOrchestrator` | 将回归作为独立链路证据处理，不复用/改写 completed global-error contract |
| `next-env.d.ts`、old artifacts 或 unrelated dirty state 无法恢复/保持 | 不 hand back；保留证据与新 report | 当前执行 owner + workspace owner | 只恢复本 run 可归因字节；无法证明一致时保持 BLOCKED |
| 新报告缺失、ownership/路径不明，或旧/其他 exec 文档变化 | 不 hand back；不得删除旧 dirty report | readiness 指定的报告责任方 + `CEOOrchestrator` | 只补齐精确新报告并撤销本 run 对其他 exec 路径的可归因变化 |
| child build 被当作 [SUO-361](/SUO/issues/SUO-361) R2/R3 | 拒绝推进恢复链 | `CEOOrchestrator + 后续执行 owner` | 在 retained checkout 从 R0 重跑完整 R0 → R3 |

回退只覆盖本 run 可证明新增/修改的 `app/not-found.tsx`、本 run 生成的 `.next/**` 和
Next 对 `next-env.d.ts` 的自动改写。不得回退、格式化、提交或清理任何 pre-existing
dirty/untracked file，也不得修改已完成 global-error 边界。唯一新正式报告必须在失败
路径保留并记录：最后成功步骤、首失败步骤、command、cwd、exit code、完整 error
chain、evidence location、target 初始状态、exact changed-file、保护项对照、回滚结果和
拥有下一 action 的 owner。
