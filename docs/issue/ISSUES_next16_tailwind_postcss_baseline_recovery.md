# Next 16 + Tailwind/PostCSS 基线恢复 Issue 清单

## 0. 文档元信息

- Issue 清单文件：`docs/issue/ISSUES_next16_tailwind_postcss_baseline_recovery.md`
- 来源设计稿：
  - 主设计稿：`docs/design/design_002_next16_tailwind_postcss_baseline_recovery.md`
  - 稳定架构背景：`docs/design/refine-admin-validated-architecture.md`（仅作排除边界背景，不拆入本清单）
- 关联控制面 Issue：设计 [SUO-356](/SUO/issues/SUO-356)；恢复父项 [SUO-355](/SUO/issues/SUO-355)；失败背景 [SUO-351](/SUO/issues/SUO-351)
- 生成 Agent：`IssueDispatcher`
- 所属流水线阶段：`issue`
- 上游阶段：`design`
- 下游阶段：`task`
- 下游 Agent：`@TaskDesignAgent`
- 是否作为当前实现合同：是；仅作为“零 Refine 的 Next 16 基线恢复”合同。
- 备注：
  - 本文档是 `TaskDesignAgent` 的最小充分只读 handoff，不是 task、stage 或执行报告。
  - 任何实际执行证据、异常、回滚结果和澄清，必须写回对应执行 Issue 的评论；不得以本清单替代执行证据。
  - 与主设计稿冲突时，以主设计稿为准；不得用旧 S0 spike 的实现内容覆盖本恢复合同。

---

## 1. 关联设计稿信息

- 主设计稿：`docs/design/design_002_next16_tailwind_postcss_baseline_recovery.md`（`DESIGN-REFINE-ADMIN-001-RECOVERY-001`）
- 重点章节：§2 范围、§3 证据/假设、§5.1–§5.5 gate 与文件矩阵、§6 `REC-AC-001`–`REC-AC-007`、§7 最小回归、§8 失败/回滚/澄清、§9 `DEC-016`–`DEC-020`。
- 关联设计稿：`docs/design/refine-admin-validated-architecture.md`（仅确认既有 Refine 架构仍关闭）

- 本清单覆盖范围：
  - 在固定项目根执行 R0–R3 串行恢复 gate，并保存每道 gate 的命令、cwd、版本、退出码、日志摘要与文件证据。
  - 以 `pnpm@9.15.0`、既有 lockfile 和既有 Next `16.1.6` / Tailwind `4.1.18` / `@tailwindcss/postcss` `4.1.18` / PostCSS `8.4.39` 为不可替换基线，重建冷 `.next` 证据。
  - 最小验证 `pnpm build` 的新鲜 `BUILD_ID`，以及 `pnpm dev` 后 `/`、`/customers` 与 CSS 资源；失败、回滚和澄清均按设计契约停在当前 gate。

- 明确排除范围：
  - 所有 `@refinedev/*`、React Router、`/admin` / `/admin/login`、Admin providers、Admin probe/tests，以及旧 `TASK-REFINE-ADM-001` 的任何实现内容。
  - Next/React/Tailwind/PostCSS 版本变动、新包、Ant Design/MUI、第二个 QueryClient、catch-all 路由，以及任何业务功能扩展。
  - `app/api/**`、`app/lib/**`、数据库 schema/migration、业务页面/组件、`package-lock.json`、`docs/design/**`、`docs/task/**`、`docs/stage/**`、`docs/exec/**` 与父目录/sibling 仓库。

- 关键约束：
  - 严格串行：前一 gate 未通过，不开始后一 gate；一次只改变一个变量。
  - tracked 配置仅在“未修改时失败 + 同一 run 诊断命中该文件”后作一个最小改动；改后必须从空 `.next` 重跑 R2、R3。
  - `.next/**` 是可丢弃生成态，现有 dirty files 是保护对象；禁止全局 reset/checkout 或把生成态提交。
  - `REC-AC-001` 至 `REC-AC-007` 全部通过才可向 [SUO-355](/SUO/issues/SUO-355) 回流“基线恢复”；这不复活 [SUO-351](/SUO/issues/SUO-351)，也不自动创建后续 S0 链路。

- 补充说明：
  - 本清单将“条件配置修复”置于 R1/R2 的受控分支，避免在证据出现前虚构一个实现任务或并行化 R0–R3。
  - 对每条 Issue，`输入`是上游 gate 已归档的证据与受保护快照，`输出`是可由下一条读取的、同一 checkout 的验收/失败记录。

---

## 2. Issue 总览表

| Issue ID | 标题 | 类型 | 优先级 | 标签 | 前置依赖 | 分发去向 |
|---|---|---|---|---|---|---|
| `N16-REC-001` | R0：固化执行根、版本与受保护工作区快照 | tooling | P0 | `next16,tailwind,postcss,recovery,gate-r0` | 无 | `@TaskDesignAgent` |
| `N16-REC-002` | R1：重建冷生成态与冻结 pnpm 安装图证据 | tooling | P0 | `next16,tailwind,postcss,recovery,gate-r1` | `N16-REC-001` | `@TaskDesignAgent` |
| `N16-REC-003` | R2：验证冷生产构建与新鲜 BUILD_ID | tooling | P0 | `next16,build,recovery,gate-r2` | `N16-REC-002` | `@TaskDesignAgent` |
| `N16-REC-004` | R3：验证受管 dev 启动与现有 PWA 最小回归 | tooling | P0 | `next16,dev,smoke,recovery,gate-r3` | `N16-REC-003` | `@TaskDesignAgent` |

---

## 3. Issue 明细

### N16-REC-001

- 标题：R0：固化执行根、版本与受保护工作区快照
- 类型：tooling
- 优先级：P0
- 标签：`next16,tailwind,postcss,recovery,gate-r0`
- 描述：
  - 从唯一 `$PROJECT_ROOT=/Users/dmeck/project/ink-admin-memory` 建立恢复执行身份。收集 cwd、Git toplevel、Paperclip workspace cwd、Node/pnpm、pnpm root、四个模块解析路径及初始 dirty-file 快照。
  - 此项只裁定“是否可以在本 checkout 继续恢复”；不删除 `.next`、不安装依赖、不运行 build/dev、不修改 tracked 文件。
- 输入：
  - 主设计 §5.1 和当前 checkout；现有工作区可能含其他 Agent 的 `docs/stage/**`、`docs/exec/**` 变更。
- 输出：
  - R0 证据包：命令、完整 cwd/root 比对、版本、四个 `require.resolve` 路径、初始 `git status --short` 与允许路径的 hash/scoped diff。
  - 明确的 `PASS` 或 `[BLOCKED]` 首失败原因；仅 PASS 才将该证据交给 `N16-REC-002`。
- 验收条件：
  - `pwd -P`、Git toplevel、Paperclip workspace cwd、`pnpm root` 均为 `$PROJECT_ROOT`，满足 `REC-AC-001`。
  - Node 满足 Next `16.1.6` 的 `>=20.9.0`；pnpm 为 `9.15.0`；`next/package.json`、`tailwindcss`、`@tailwindcss/postcss`、`postcss` 全部解析到 `$PROJECT_ROOT/node_modules/**`，满足 `REC-AC-002`。
  - 初始 dirty files 已记录且未被清理、覆盖或纳入恢复变更，满足 `REC-AC-007` 的保护前提。
  - 若任一根路径是 `/Users/dmeck/project` 或 sibling，停止于 R0，记录启动 cwd/execution workspace 证据；不得向父目录安装 Tailwind。
- 前置依赖：无
- 关联路径：
  - 读取：`package.json`、`pnpm-lock.yaml`、`pnpm-workspace.yaml`、`node_modules/**`
  - 只读保护：全工作树；特别是已有 `docs/stage/**`、`docs/exec/**` dirty state
  - 禁止：`app/**`、`drizzle/**`、`docs/design/**`、`docs/issue/**`、`docs/task/**`、`docs/stage/**`、`docs/exec/**` 的业务性修改
- 分发去向：`@TaskDesignAgent`
- 主责 Agent：`TaskDesignAgent`
- 协作 Agent：无；若 R0 指向外部 execution workspace/cwd，协作方为 `CEOOrchestrator` / runtime owner，仅修正启动环境。
- 设计决策引用：`DEC-017`、`DEC-018`、`DEC-020`；`EVD-001`、`EVD-003`、`EVD-005`；§5.1；`REC-AC-001`、`REC-AC-002`、`REC-AC-007`。
- 备注：
  - `[BLOCKED]` 条件：根路径或模块解析不能固定至项目根。Owner/action：`CEOOrchestrator` / runtime owner 修正 execution workspace 或启动命令后重新从 R0 执行。
  - 不得用父目录依赖、npm/yarn/bun 或版本切换掩盖 R0 失败。

---

### N16-REC-002

- 标题：R1：重建冷生成态与冻结 pnpm 安装图证据
- 类型：tooling
- 优先级：P0
- 标签：`next16,tailwind,postcss,recovery,gate-r1`
- 描述：
  - 在 R0 PASS 的同一 checkout 中，记录旧 `.next` 污染摘要后将其隔离到 run scratch 或删除；先复核现有安装态，只有缺失/越界/不一致时才执行 `pnpm install --frozen-lockfile`。
  - 运行独立 PostCSS/Tailwind probe 作为插件链证据，不把它误写为 Next build 成功。将 R1 输出限定为可供 R2 使用的冷态和安装图证据。
- 输入：
  - `N16-REC-001` 的 R0 PASS 证据与 dirty-file 保护快照。
  - 当前 `.next/**`、`node_modules/**`、`package.json`、`pnpm-lock.yaml`、`app/globals.css`（仅读取 probe 输入）。
- 输出：
  - 已隔离/删除旧 `.next` 的摘要、当前 checkout 模块解析结果、冻结安装结果（若执行）和独立 CSS probe 日志。
  - R1 PASS 时确认后续 R2 必须从空 `.next` 生成；失败时记录首失败原因、退出码、差异与仅本 run 修改的回滚结果。
- 验收条件：
  - 旧 `.next` 仅作摘要后被隔离/清理；没有把生成物上传为成功证据、提交或作为 R2 输入，满足 `REC-AC-003`。
  - 依赖仍由本项目 pnpm store 链解析；若运行冻结安装，其成功且未改写 `pnpm-lock.yaml`。若 lock/package 不一致，停止而不执行非冻结安装，满足 `REC-AC-002`。
  - 独立 PostCSS/Tailwind probe 无 warning；若失败，保存完整 Tailwind import/plugin error chain。此 probe 不替代 `pnpm build`。
  - R1 后日志/生成态不得携带旧 checkout 或 `@refinedev/*` 作为后续成功依据，满足 `REC-AC-003`、`REC-AC-007`。
- 前置依赖：`N16-REC-001`
- 关联路径：
  - 可操作生成态：`.next/**`（仅隔离、删除、重新生成；不提交）、`node_modules/**`（仅 `pnpm install --frozen-lockfile` 恢复；不提交）、Paperclip run scratch/测试输出。
  - 只读/条件候选：`package.json`、`pnpm-lock.yaml`、`pnpm-workspace.yaml`、`postcss.config.js`、`next.config.js`、`playwright.config.ts`、`app/globals.css`。
  - 禁止：`package-lock.json`、所有 `app/**` 应用代码、`app/api/**`、`app/lib/**`、schema/migration、Refine/Admin 与下游流水线文档。
- 分发去向：`@TaskDesignAgent`
- 主责 Agent：`TaskDesignAgent`
- 协作 Agent：无；若安装/lock 或执行器问题需要决策，按 §8.3 指定 owner 回流，不并行绕过 R1。
- 设计决策引用：`DEC-016`、`DEC-017`、`DEC-018`、`DEC-020`；`EVD-002`、`EVD-004`、`EVD-006`、`EVD-007`；§5.2、§5.5；`REC-AC-002`、`REC-AC-003`、`REC-AC-007`。
- 备注：
  - 条件最小修复入口：仅在诊断明确命中单个获准 tracked 配置后，才可按下方 §4 矩阵修改一个候选；修改后从空 `.next` 重跑本 Issue 的必要 probe 与 `N16-REC-003`、`N16-REC-004`。
  - `[BLOCKED]` 条件：冻结安装需改 lock/version、安装解析越出项目根，或无法区分本 run 与并发变更。Owner/action：`TaskDesignAgent` 停止下游 gate，回写证据；对应 owner 按 §7 处理。

---

### N16-REC-003

- 标题：R2：验证冷生产构建与新鲜 BUILD_ID
- 类型：tooling
- 优先级：P0
- 标签：`next16,build,recovery,gate-r2`
- 描述：
  - 仅在 R1 PASS 后，从空 `.next` 运行唯一权威命令 `pnpm build`，确认“Next 16 冷构建”而非仅启动了构建或生成了部分文件。
  - 如冷失败证据精确指向 §5.5 的受控配置文件，执行至多一个最小修复；每次修复都须保留未修改失败证据、候选文件诊断、scoped diff 与从空 `.next` 的重跑结果。
- 输入：
  - `N16-REC-002` 的冷态/冻结安装/插件链 PASS 证据；任何条件配置修改的单变量说明。
- 输出：
  - `pnpm build` 退出码和日志；新的非空 `.next/BUILD_ID` 的生成时间、mtime 和 hash/值摘要；build diagnostics、trace/sourcemap 污染扫描与 scoped diff。
  - R2 PASS 可供 R3 启动 dev；否则记录最后一个通过 gate、首个失败 gate、错误链与精准回滚。
- 验收条件：
  - `pnpm build` exit 0，日志包含 Next `16.1.6`，且无 Tailwind/PostCSS/module resolution error，满足 `REC-AC-004`。
  - `.next/BUILD_ID` 为本次命令生成、非空普通文件；`.next/diagnostics/build-diagnostics.json` 不停在失败 `compile` 状态，满足 `REC-AC-004`。
  - build 输出、sourcemap、trace 不引用 `/Users/dmeck/project/claude-agent-next-kit`、父目录依赖或已回滚 `@refinedev/*`，满足 `REC-AC-003`。
  - build 前后 tracked diff 仅限获准且已证据化的最小配置，且没有 Refine/Admin、业务/API/lib/schema/下游文档变更，满足 `REC-AC-007`。
  - 仅出现 `Creating an optimized production build ...`、`.next` 部分生成、超时、非零退出或缺少新鲜 `BUILD_ID`，均为 R2 FAILED，不能推进 R3。
- 前置依赖：`N16-REC-002`
- 关联路径：
  - 可操作生成态：`.next/**`、Paperclip run scratch/测试输出（均不提交）。
  - 只有诊断命中时可最小修改：`next.config.js`、`postcss.config.js`、`pnpm-workspace.yaml`、`package.json`、`pnpm-lock.yaml`、`playwright.config.ts`（具体准入在 §4）。
  - 禁止：`app/globals.css` 和其他 `app/**`、`package-lock.json`、版本号、Refine/Admin、`app/api/**`、`app/lib/**`、`drizzle/**`、下游文档及父目录/sibling。
- 分发去向：`@TaskDesignAgent`
- 主责 Agent：`TaskDesignAgent`
- 协作 Agent：无；若需要外部执行环境修复或设计授权，协作方为 §7 所列 owner，仍由 `TaskDesignAgent` 保持该 Issue 的唯一主责。
- 设计决策引用：`DEC-017`、`DEC-018`、`DEC-019`、`DEC-020`；`HYP-002`–`HYP-004`；§5.3、§5.5；`REC-AC-003`、`REC-AC-004`、`REC-AC-007`。
- 备注：
  - `[BLOCKED]` 条件：R2 非零/超时/无新鲜 `BUILD_ID`，或修复需要应用代码/版本/Refine/Admin/下游文档。Owner/action：`TaskDesignAgent` 按 §7 记录失败与回滚，且停止，不得重新打开旧 S0。
  - 不得以 “build started” 或缓存产物代替本 Issue 的成功输出。

---

### N16-REC-004

- 标题：R3：验证受管 dev 启动与现有 PWA 最小回归
- 类型：tooling
- 优先级：P0
- 标签：`next16,dev,smoke,recovery,gate-r3`
- 描述：
  - 在 R2 PASS 的相同 checkout 内，以可回收前台或受管进程运行 `pnpm dev`，记录 PID、监听地址、ready 日志、HTTP/CSS 证据与优雅停止动作。
  - 仅验证现有 PWA 的 `/`、`/customers` 和静态 CSS；不请求、不创建、不断言 `/admin`，不把端口占用或外部服务问题混同为 Tailwind/PostCSS 成败。
- 输入：
  - `N16-REC-003` 的 R2 PASS 证据、对应 build trace/scope diff，及任何已获准单变量配置改动。
- 输出：
  - dev 生命周期记录（PID、地址、ready、首次请求后存活、终止结果），`/` 与 `/customers` 非 5xx 的响应证据，CSS 获取/无解析错误证据，以及最终范围/回滚清洁结论。
  - 全部 PASS 时产生 `REC-AC-001`–`REC-AC-007` 的汇总映射，供 [SUO-355](/SUO/issues/SUO-355) 评估恢复；失败时形成回滚/澄清输入而不是新的 Refine 任务。
- 验收条件：
  - `pnpm dev` 明确 ready，首次 HTTP 请求后仍存活；记录 PID、监听地址和关闭动作，满足 `REC-AC-005`。
  - 在同一运行环境请求 `/`、`/customers` 均为非 5xx 且主文档可读取；静态 CSS 可获取，未出现 Tailwind/PostCSS resolver error，满足 `REC-AC-005`、`REC-AC-006`。
  - 不请求或断言 `/admin`；无 Refine/Admin 依赖/路由假阳性，满足 `REC-AC-006`、`REC-AC-007`。
  - 如 tracked 配置已变动，额外执行受影响配置 lint/加载检查及现有 customers Playwright smoke；没有应用功能变更时不要求全量 Vitest/E2E。
  - 现有并发 dirty state 原样保留，生成态不提交；任何本 run tracked 修改已按 scoped diff 说明或回滚，满足 `REC-AC-007`。
- 前置依赖：`N16-REC-003`
- 关联路径：
  - 可操作生成态：`.next/**`、Paperclip run scratch/测试输出；受管/前台 dev 进程必须在退出前停止。
  - 读取与可能条件校验：`playwright.config.ts`、既有 customers smoke、Next 静态 CSS 输出。
  - 禁止：所有 `/admin` 路由/测试、`@refinedev/*`、React Router、`app/**` 应用代码、业务 API/lib/schema/migration、`docs/design/**`、`docs/task/**`、`docs/stage/**`、`docs/exec/**`。
- 分发去向：`@TaskDesignAgent`
- 主责 Agent：`TaskDesignAgent`
- 协作 Agent：无；端口/sandbox 权限问题由 runtime owner 协作，页面的 DB/外部服务异常仅作隔离记录。
- 设计决策引用：`DEC-016`、`DEC-019`、`DEC-020`；§5.4、§7、§8；`REC-AC-005`、`REC-AC-006`、`REC-AC-007`。
- 备注：
  - `[BLOCKED]` 条件：dev 未 ready、首请求后退出、CSS 404/resolver error，或无法安全区分本 run diff。Owner/action：`TaskDesignAgent` 停止服务、记录首失败 gate/命令/cwd/退出码/错误链，依 §7 回滚和澄清。
  - 端口占用或 sandbox `EPERM` 先作为 `REC-RISK-005` 外部环境证据；仅在获准端口环境重试一次，不修改应用代码。

---

## 4. 共享任务与依赖说明

- 本批没有 `shared` 类型 Issue；四项均为 tooling 工作单元，唯一主责均为 `TaskDesignAgent`，不存在无主责 shared 交接。
- 依赖是不可并行的线性 DAG：`N16-REC-001 → N16-REC-002 → N16-REC-003 → N16-REC-004`。下游只消费上游 `PASS` 输出；失败和澄清不允许跳关。
- 受控文件矩阵（映射设计 §5.5）：

| 文件/路径 | 本批允许操作 | 准入或边界 | 禁止/回归要求 |
|---|---|---|---|
| `.next/**` | 摘要、隔离、删除、重建 | 仅 ignored 生成态；R1 后 R2/R3 必须冷生成 | 不提交、不把旧缓存当成功证据 |
| `node_modules/**` | `pnpm install --frozen-lockfile` 恢复 | 解析缺失、越界或安装态不一致时 | 不提交；不能用非冻结安装改图 |
| Paperclip run scratch/测试输出 | 写入日志、HTTP 响应、probe | 真正验收证据要在执行 Issue 摘要/附件中可审计 | 不替代结果摘要 |
| `next.config.js` | 显式固定当前 checkout 的 turbopack/tracing root | 同一 run cwd 正确但 Next root 仍错误/多 root | 改后冷跑 R2/R3 |
| `postcss.config.js` | 修正现有 `@tailwindcss/postcss` 加载/基目录 | 冷 Next 与独立 probe 同时指向本配置 | 改后冷跑 R2/R3 |
| `pnpm-workspace.yaml` | 修正单包 workspace 根声明 | pnpm/Next 实际识别父目录或 sibling | 改后冷跑 R2/R3 |
| `package.json`、`pnpm-lock.yaml` | 恢复既有声明版本的一致性 | 冻结安装明确报告二者不一致 | 不新增包/不改版本；改后冷跑 R2/R3 |
| `playwright.config.ts` | 为既有 webServer 固定 `$PROJECT_ROOT` cwd | 直接 dev 通过但 Playwright webServer cwd 错误 | 不新增 Admin assertions；改后 cold R2/R3 + customers smoke |
| `app/**`、`app/api/**`、`app/lib/**`、schema/migration、`package-lock.json`、版本号、Refine/Admin、下游文档、父目录/sibling | 不允许 | 不存在恢复授权 | 触发即停止并澄清/回滚 |

- 条件修复不是独立并行 Issue：每次仅允许一个命中项，且需保存“修改前失败 + 指向文件的诊断 + 修改后 R2/R3 重跑”三件证据。若范围超过该矩阵，必须回到 Issue 评论区并标记 `[CLARIFICATION_NEEDED]`。

---

## 5. 分发去向说明

- `@TaskDesignAgent`：
  - 统一接收 `N16-REC-001`–`N16-REC-004`，按线性依赖生成 task 阶段文档；不得将它们拆成前后端双 owner，也不得直接下发给 `StagePlanner` 或 `ExecTaskAgent`。
  - 在 task 规划中保留每个 gate 的输入、输出、证据格式、失败停止条件、限定文件边界及回滚步骤。
  - 不得把本清单视作对 Refine、Admin 或旧 S0 spike 的重新授权。

- `CEOOrchestrator`：
  - 只在四项回流且全量 `REC-AC-001`–`REC-AC-007` 证据齐备后，评估是否另行创建全新的 S0 `issue → task → stage → execute` 链路。
  - 处理 §7 中属其职责的版本、包管理和外部执行器澄清；不以恢复成功自动重开 [SUO-351](/SUO/issues/SUO-351)。

- shared Issue 处理规则：
  - 本批无 shared Issue。后续若出现跨域证据整理，必须新建有唯一主责和至少一位协作方的 shared Issue；不能将当前单 owner gate 改写为无主责 shared 项。

---

## 6. 推荐推进顺序

1. 先完成 `N16-REC-001`：固定 root/版本/dirty snapshot；失败立即修复外部 cwd，不进入 R1。
2. 完成 `N16-REC-002`：冷缓存、冻结安装和 CSS probe；仅在诊断命中时做一个配置变更。
3. 完成 `N16-REC-003`：从空 `.next` 得到冷 `pnpm build` 与新鲜 `BUILD_ID`。
4. 完成 `N16-REC-004`：受管 dev、`/` 与 `/customers`、CSS、终止与 scope-cleanliness；汇总全部 AC。
5. 仅将全量 evidence 回流 [SUO-355](/SUO/issues/SUO-355)；不创建 task/stage/execute 内容，不重试旧 [SUO-351](/SUO/issues/SUO-351)。

```text
N16-REC-001 (R0: root / version / snapshot)
  ↓ PASS only
N16-REC-002 (R1: cold .next / frozen install / CSS probe)
  ↓ PASS only
N16-REC-003 (R2: pnpm build / fresh BUILD_ID)
  ↓ PASS only
N16-REC-004 (R3: dev / / + /customers / CSS / clean stop)
  ↓ all REC-AC-001…007 evidence only
SUO-355 recovery evaluation → CEOOrchestrator may create a new S0 pipeline
```

---

## 7. 阻塞与澄清记录

生成本清单时没有设计输入阻塞；下列是执行中必须即时写入对应 Issue 评论区的条件化记录。默认行为均为停止当前 gate，不越过序列。

### [BLOCKED] N16-REC-001 / N16-REC-002 / N16-REC-003 / N16-REC-004

- 阻塞原因：任一 gate 发生 §8.1 失败条件（root 不固定、冻结安装须改锁版本、冷 build 失败/无 `BUILD_ID`、dev/CSS 失败、超出文件边界或并发 diff 不可区分）。
- 影响范围：当前及所有后续 gate；禁止重新触发 Refine S0。
- 当前责任 Agent：`TaskDesignAgent`（规划时将此状态和证据回写要求保留到执行 task）。
- 需要唤醒的 Agent：依触发条件为 `CEOOrchestrator`、runtime owner 或 `DesignArchitect`；必须在执行 Issue 评论中使用 @mention 并附首失败证据。
- 建议处理方式：记录最后 PASS gate、首 FAILED gate、命令、cwd、退出码、完整错误链、scoped diff、仅本 run 的回滚结果；不执行全局 reset/checkout。
- 是否需要回退到 design：仅当触发下列澄清条件；否则先按既有合同修正外部环境或恢复生成态。

### [CLARIFICATION_NEEDED] N16-REC-002 / N16-REC-003：版本变更

- 歧义点：证据显示必须改变 Next/React/Tailwind/PostCSS 版本才可能继续。
- 可能解释 A：配置或执行环境仍可在当前版本恢复。
- 可能解释 B：当前固定版本确实不能满足恢复合同。
- 默认采用解释：A；保持当前版本并将恢复标为 blocked。
- 需要确认方：`DesignArchitect` + `CEOOrchestrator`，基于新增证据增量修订本设计附件。
- 是否阻塞 task 阶段：是；不得创建版本升级/降级 task。

### [CLARIFICATION_NEEDED] N16-REC-002 / N16-REC-003：应用 CSS 变更

- 歧义点：冷环境中独立 PostCSS 与 Next 同时证明 `app/globals.css` 本身失败。
- 可能解释 A：配置/执行器缺陷，无需改 `app/**`。
- 可能解释 B：需要最小 CSS 源码变更。
- 默认采用解释：A；不改 `app/**`。
- 需要确认方：`DesignArchitect` 明确允许的 CSS 最小 diff 与回归面。
- 是否阻塞 task 阶段：是；在许可前不得把 CSS 修改加入 task。

### [CLARIFICATION_NEEDED] N16-REC-002：包管理治理

- 歧义点：恢复必须删除/重生 `package-lock.json` 或改变 workspace 布局。
- 可能解释 A：pnpm lock 仍能作为唯一恢复权威。
- 可能解释 B：仓库需要独立的包管理治理决策。
- 默认采用解释：A；`package-lock.json` 不动、pnpm 继续权威。
- 需要确认方：仓库 owner / `CEOOrchestrator`。
- 是否阻塞 task 阶段：是；不得借恢复 task 改锁策略。

### [CLARIFICATION_NEEDED] N16-REC-001 / N16-REC-004：外部执行器

- 歧义点：项目根命令本地可通过，但 Paperclip/Playwright 固定从父目录启动。
- 可能解释 A：execution workspace / 启动 cwd 错误。
- 可能解释 B：项目配置需要掩盖外部错误。
- 默认采用解释：A；不改项目配置。
- 需要确认方：`CEOOrchestrator` / runtime owner 修正 execution workspace。
- 是否阻塞 task 阶段：是；修复后从 R0 重启整个串行链。

---

## 8. Issue-First 协作说明

* Issue 是最小调度单元；`N16-REC-001`–`004` 任一时刻均有唯一主责 `TaskDesignAgent`，并按前置依赖串行推进。
* 执行中的 PASS、FAILED、[BLOCKED]、[CLARIFICATION_NEEDED]、回滚和补充证据必须写入对应 Issue 评论区；用 @mention 唤醒 `CEOOrchestrator`、`DesignArchitect` 或 runtime owner，不能依赖隐式共享内存。
* 后续 `TaskDesignAgent` 只能把本清单转换为 task 阶段输入；`StagePlanner` 只消费完成的 task 文档，`ExecTaskAgent` 只能在 stage 完成后由 `CEOOrchestrator` 指派。
* 成功边界是当前无 Refine PWA 的 Next 16 冷 build + dev 最小回归；不是 Refine/Next 16 兼容结论，不是 Admin 重新授权，也不是旧 [SUO-351](/SUO/issues/SUO-351) 的恢复。
