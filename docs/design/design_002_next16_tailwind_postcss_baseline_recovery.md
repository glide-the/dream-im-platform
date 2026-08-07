# Next 16 + Tailwind/PostCSS 基线恢复契约

> Design ID: `DESIGN-REFINE-ADMIN-001-RECOVERY-001`
> 设计阶段 Issue: [SUO-356](/SUO/issues/SUO-356)
> 恢复父项: [SUO-355](/SUO/issues/SUO-355)
> 失败来源: [SUO-351](/SUO/issues/SUO-351)
> 稳定架构基线: `docs/design/refine-admin-validated-architecture.md`
> 状态: 可供 IssueDispatcher 只读消费
> 基线日期: 2026-08-07

## 1. 背景与目标

`TASK-REFINE-ADM-001` 的 S0 spike 在临时安装 Refine Core `5.0.12` 与 Next.js Router `7.0.5` 后通过了依赖解析和受影响 lint，但未获得 Next 16 运行证据：`pnpm build` 没有生成 `.next/BUILD_ID`，Playwright 启动开发服务器时在路由断言前报错 `Can't resolve 'tailwindcss' in '/Users/dmeck/project'`。该 spike 已完整撤销 Refine 依赖、Admin 路由壳和测试变更。

本设计是 `DESIGN-REFINE-ADMIN-001` 的增量恢复附件，只定义现有 Next `16.1.6`、Tailwind CSS `4.1.18`、`@tailwindcss/postcss` `4.1.18` 与 PostCSS `8.4.39` 基线的恢复合同。目标是先证明未接入 Refine 的现有 PWA 能冷构建并启动开发服务器，再允许上游生成新的 S0 兼容性执行 handoff。

本设计不重写 Refine 架构、资源范围、路由方案、RBAC、Data Provider 或发布模型。原设计的 `DEC-001` 至 `DEC-015`、`AC-001` 至 `AC-016` 继续有效；本文只细化 `DEC-012` / `G-03` 失败后的恢复前置门槛。

## 2. 范围界定

### 2.1 本次恢复范围

包含：

1. 固化执行根目录、Node/pnpm 版本、锁文件与已安装模块解析证据。
2. 隔离或清理可再生的 `.next/**`，排除跨 checkout / 失败 spike 缓存污染。
3. 在不改变版本与应用功能的前提下，验证 pnpm 安装图、Next 根目录推断、PostCSS 插件加载和 Tailwind CSS 入口解析。
4. 仅在诊断证据指向配置缺陷时，允许对现有 Next/PostCSS/workspace 配置做一个最小修复。
5. 形成可审计的冷构建、开发服务器启动和现有 PWA 最小回归证据。

### 2.2 明确排除

- 不安装或恢复任何 `@refinedev/*` 依赖。
- 不创建 `/admin`、`/admin/login`、动态 probe、`AdminProviders` 或 Admin 测试。
- 不修改 Refine 稳定架构的路由、Provider、QueryClient、认证、RBAC、API、数据或发布范围。
- 不引入 React Router、Ant Design/MUI、第二个 QueryClient 或 catch-all 路由。
- 不修改 Next 主版本或以 React/Next/Tailwind 升降级作为恢复捷径。
- 不修改 `app/api/**`、`app/lib/**`、数据库 schema、`drizzle/**` 或现有业务页面/组件。
- 不写 `docs/issue/`、`docs/task/`、`docs/stage/` 或 `docs/exec/`；这些目录由对应下游阶段拥有。

### 2.3 成功边界

恢复成功只表示：**无 Refine 的当前 PWA 基线可在指定 checkout 中完成 Next 16 冷构建并启动开发服务器。** 它不表示 Refine 与 Next 16 已兼容，也不解锁 S1 及后续工作。只有上游完成新的 execute-readiness check，并对全新 S0 Issue 发出结构化 handoff 后，才能再次验证 Refine。

## 3. 根因证据与有界假设

### 3.1 已验证事实

| ID | 证据 | 结论 |
| --- | --- | --- |
| `EVD-001` | [SUO-351](/SUO/issues/SUO-351) 执行报告：`pnpm build` 未生成 `.next/BUILD_ID`；dev smoke 在路由断言前从 `/Users/dmeck/project` 解析 `tailwindcss` 失败 | 故障早于 Admin 路由行为，不能归因于 Refine 页面代码 |
| `EVD-002` | `package.json` 与 `pnpm-lock.yaml` 声明 Next `16.1.6`、Tailwind CSS `4.1.18`、`@tailwindcss/postcss` `4.1.18`、PostCSS `8.4.39`；当前无 `@refinedev/*` | 源码依赖声明已经回到原基线 |
| `EVD-003` | 在 `$PROJECT_ROOT` 运行 `pnpm why`，上述四个包均由本项目解析；`node` 的 `require.resolve` 指向本仓库 `node_modules/.pnpm/**` | 当前 checkout 内的安装图具备这些模块，不支持“依赖从未安装”的结论 |
| `EVD-004` | 使用当前 `app/globals.css` 和 `@tailwindcss/postcss` 做独立 PostCSS 编译，得到 75,697 bytes CSS 且无 warning | 当前 Tailwind v4 入口与 PostCSS 插件在仓库根内可工作；不能据此证明 Next 构建链已健康 |
| `EVD-005` | Next `16.1.6` 本地 `findRootDirAndLockFiles(process.cwd())` 返回 `$PROJECT_ROOT` 与 `$PROJECT_ROOT/pnpm-lock.yaml` | 当前 shell 中 Next 根目录推断正确；不能回溯证明失败 run 的 cwd/root 正确 |
| `EVD-006` | 失败后 `.next/BUILD_ID` 不存在；忽略目录 `.next/**` 仍含回滚前 `@refinedev` 构建块，并在 `.next/dev/trace` 中保留 2,634 个旧 checkout `/Users/dmeck/project/claude-agent-next-kit` 的绝对路径引用 | 生成物存在跨 checkout / 失败 spike 污染，必须用冷缓存重新验证 |
| `EVD-007` | `packageManager` 固定 `pnpm@9.15.0`，`pnpm-workspace.yaml` 只声明当前根；仓库同时跟踪 `package-lock.json`，但当前 Next 根目录探测实际选择 pnpm lock | npm lock 共存是治理风险，但没有证据表明它单独造成当前错误 |

### 3.2 按优先级验证的假设

| 假设 | 置信度 | 支持证据 | 证伪条件 |
| --- | --- | --- | --- |
| `HYP-001` 执行 cwd / project root 错位 | 高 | 错误从 `/Users/dmeck/project` 而不是 `$PROJECT_ROOT` 解析 bare CSS import | 同一次失败 run 的 `pwd -P`、`process.cwd()`、`INIT_CWD`、`pnpm root`、Next root 与所有 `require.resolve` 都指向 `$PROJECT_ROOT` |
| `HYP-002` `.next` 跨 checkout / spike 缓存污染 | 中高 | `.next` 含旧 checkout 绝对路径和已回滚 Refine 块，且没有 `BUILD_ID` | 将原 `.next` 隔离后进行完全冷启动，仍以相同路径和错误失败 |
| `HYP-003` 失败 run 的 node_modules / lock 安装态不一致 | 中 | spike 临时安装再回滚，源码 diff 清洁不等于生成安装态清洁 | `pnpm install --frozen-lockfile` 后，模块解析与冷 build/dev 仍同样失败 |
| `HYP-004` 当前 Tailwind/PostCSS 版本或 CSS 入口本身不兼容 | 低 | Next 链路仍失败 | 独立 PostCSS 已成功；只有冷 Next run 在根目录证据正确时仍稳定失败，才允许提升该假设 |

当前没有充分证据宣布单一根因。恢复执行必须按 `HYP-001 → HYP-002 → HYP-003 → HYP-004` 收敛，禁止跳到版本替换或大范围配置重写。

## 4. 方案摘要

恢复采用四道串行门：

```text
执行根与版本证据
  → 冷生成物与冻结安装图
  → pnpm build + 新鲜 BUILD_ID
  → pnpm dev + 现有 PWA smoke
```

前一道门失败时停止，不进入下一道门。每次只改变一个变量，并保存命令、cwd、版本、退出码、关键日志和文件证据。任何 tracked file 修改都必须由“未修改时的失败 + 指向该文件的诊断证据”支持。

## 5. 详细设计

### 5.1 Gate R0：执行身份、根目录与工作区快照

所有命令必须从 `$PROJECT_ROOT=/Users/dmeck/project/ink-admin-memory` 执行。执行记录至少包含：

```bash
pwd -P
node --version
pnpm --version
pnpm root
git rev-parse --show-toplevel
git status --short
node --input-type=module -e "import {createRequire} from 'node:module'; const r=createRequire(import.meta.url); for (const p of ['next/package.json','tailwindcss','@tailwindcss/postcss','postcss']) console.log(p, r.resolve(p))"
```

准入条件：

- `pwd -P`、Git toplevel 与 Paperclip workspace cwd 都等于 `$PROJECT_ROOT`。
- Node 满足 Next `16.1.6` 的 `>=20.9.0` engine；记录实际版本，不在本任务切换 Next。
- pnpm 与 `packageManager` 的 `9.15.0` 一致；不使用 npm/yarn/bun 安装。
- 四个模块都从 `$PROJECT_ROOT/node_modules/**` 解析；禁止从父目录或 sibling 项目借用依赖。
- 先记录现有 dirty files；当前已观察到的 `docs/stage/**` 与 `docs/exec/**` 变更属于其他阶段，恢复执行不得覆盖、清理或纳入提交。

若任一根目录证据指向 `/Users/dmeck/project` 或其他 sibling checkout，先修正任务启动 cwd / execution workspace，不能通过父目录安装 Tailwind 来掩盖错误。

### 5.2 Gate R1：冷缓存与冻结安装图

1. 记录 `.next/BUILD_ID` 是否存在、`.next` 中的旧绝对路径和已回滚 Refine 块，仅保留摘要，不把 `.next` 上传或提交。
2. 停止本 Issue 启动的 dev 进程后，将 `.next` 移入本次 Paperclip run scratch，或删除该 ignored 生成目录；不得删除任何 tracked 文件。
3. 首先在现有 `node_modules` 上重复模块解析。若解析缺失、软链接越出 `$PROJECT_ROOT/node_modules/.pnpm`，或安装态无法解释，则运行 `pnpm install --frozen-lockfile`。
4. 冻结安装若试图改写 `pnpm-lock.yaml` 或报告 package/lock 不一致，停止并记录差异；不得改用非冻结安装静默重写依赖图。
5. 独立运行一次 PostCSS/Tailwind 编译 probe。它只证明插件链，不替代 Next build。

R1 通过后，`.next` 必须由后续命令在当前 checkout 重新生成，且新日志不得再引用旧 checkout 或已回滚 Refine 模块。

### 5.3 Gate R2：生产冷构建

从空 `.next` 开始运行唯一权威命令：

```bash
pnpm build
```

通过条件必须同时满足：

- 命令退出码为 0，日志包含 Next `16.1.6` 且没有 Tailwind/PostCSS/module resolution error。
- `.next/BUILD_ID` 是本次命令后生成的非空普通文件；记录 build 开始时间、文件 mtime 和内容哈希/值摘要。
- `.next/diagnostics/build-diagnostics.json` 不停留在失败的 `compile` 状态。
- 构建日志和生成 sourcemap/trace 不引用 `/Users/dmeck/project/claude-agent-next-kit`、已回滚 `@refinedev/*` 或父目录依赖。
- 构建前后 tracked diff 只包含已经批准的最小恢复文件；不得出现应用路由、Admin、API、lib、schema 或下游文档变更。

仅看到 `Creating an optimized production build ...`、仅生成 `.next/**` 的部分文件或仅等待超时，都视为失败；没有 `.next/BUILD_ID` 不能写成 build 成功。

### 5.4 Gate R3：开发服务器与最小回归

R2 通过后再运行：

```bash
pnpm dev
```

开发服务器必须由可回收的前台/受管进程启动；记录 PID、监听地址、启动日志与关闭结果，不留下后台 orphan。通过条件：

- 日志明确出现 ready 状态，进程在首次 HTTP 请求后仍存活。
- 从同一运行环境请求 `/` 和 `/customers`，均返回非 5xx 响应且页面主文档可读取。
- 浏览器或 HTTP 证据表明 Next 静态 CSS 资源可获取，不出现 `tailwindcss`、`@tailwindcss/postcss` 或 PostCSS 解析错误。
- 不请求或断言 `/admin`；本恢复任务没有 Admin 路由。
- dev 结束后优雅停止进程，并记录退出/终止动作。

### 5.5 允许与禁止的文件边界

#### 无需审批即可操作的生成态

| 路径 | 允许操作 | 约束 |
| --- | --- | --- |
| `.next/**` | 记录摘要后隔离、删除、重新生成 | ignored，不提交；不得把旧缓存当成功证据 |
| `node_modules/**` | 用 `pnpm install --frozen-lockfile` 恢复 | 不提交；解析必须留在本项目 pnpm store 链路 |
| Paperclip run scratch / 测试输出 | 写入日志、HTTP 响应与临时 probe | 真正验收证据需在 Issue/exec 产物中摘要或附加 |

#### 只有诊断证据命中时才允许的 tracked 配置

| 路径 | 允许的最小变化 | 前置证据 |
| --- | --- | --- |
| `next.config.js` | 只允许显式固定当前 checkout 的 `turbopack.root` / tracing root，且二者必须一致 | 同一 run 中 shell cwd 正确，但 Next root 仍错误或报告多 root |
| `postcss.config.js` | 只允许修正现有 `@tailwindcss/postcss` 插件加载/基目录配置 | 冷 Next 与独立 PostCSS probe 都指向此配置失败 |
| `pnpm-workspace.yaml` | 只允许修正当前单包 workspace 根声明 | pnpm/Next 实际把 sibling 或父目录识别为 workspace |
| `package.json`、`pnpm-lock.yaml` | 只允许恢复当前已声明版本的一致性，不得新增包或改变版本 | `pnpm install --frozen-lockfile` 明确报告二者不一致 |
| `playwright.config.ts` | 只允许为既有 webServer 明确 `$PROJECT_ROOT` cwd；不新增 Admin assertions | 直接 `pnpm dev` 通过，但 Playwright webServer 在不同 cwd 失败 |

每次最多修改命中根因所需的最小项。修改一个候选后必须从空 `.next` 重跑 R2/R3；不得把多个猜测性配置改动打成一个不可归因的修复。

#### 本恢复中禁止修改

- `app/globals.css` 及其他 `app/**` 应用代码：当前独立 PostCSS probe 已通过，没有修改依据。
- `package-lock.json`：pnpm 是本任务权威安装器；删除或重生 npm lock 属于独立包管理治理决策。
- Next、React、Tailwind、PostCSS 的版本号；若证据表明只能改版本，进入澄清条件。
- 任何 `@refinedev/*`、Admin 路由/组件/测试、旧 PWA 页面或 API、`app/lib/**`、schema/migration。
- `docs/design/refine-admin-validated-architecture.md` 的稳定范围，以及 `docs/issue/`、`docs/task/`、`docs/stage/`、`docs/exec/`。
- `/Users/dmeck/project` 父目录、sibling 仓库、Repomix XML 与外部项目。

## 6. 验收标准

| AC | 验收项 | 必须证据 | 失败反证 |
| --- | --- | --- | --- |
| `REC-AC-001` | 根目录一致 | `pwd -P`、Git toplevel、Paperclip workspace cwd、pnpm root 均指向 `$PROJECT_ROOT` | 任一指向父目录/sibling |
| `REC-AC-002` | 版本与安装图固定 | Node `>=20.9.0`、pnpm `9.15.0`、Next `16.1.6`、Tailwind/PostCSS 当前版本及仓库内解析路径 | 从父目录解析、版本变化、非冻结安装 |
| `REC-AC-003` | 冷生成态 | 构建前无旧 `.next`；新生成物无旧 checkout/Refine 引用 | 复用旧 `.next` 或无法说明残留来源 |
| `REC-AC-004` | 生产构建成功 | `pnpm build` exit 0；本次生成、非空的 `.next/BUILD_ID` | 超时、非零退出、缺少/陈旧 `BUILD_ID` |
| `REC-AC-005` | dev 启动成功 | `pnpm dev` ready、进程存活、`/` 与 `/customers` 非 5xx、CSS 可获取 | 仅进程创建、端口占用、首请求崩溃或 CSS 解析失败 |
| `REC-AC-006` | 最小回归 | 首页与 customers 页面 smoke；无 `/admin` 假阳性；Tailwind 样式资源无 404/compile error | 只验证端口，不访问现有页面 |
| `REC-AC-007` | 范围与回滚清洁 | 前后 scoped diff、生成物不提交、无 Refine/Admin/业务/下游文档变更 | 未说明的 tracked diff 或覆盖其他 Agent 产物 |

全部 `REC-AC-001` 至 `REC-AC-007` 通过后，`SUO-355` 才能把基线标记为恢复。该信号只允许 CEOOrchestrator 继续 `issue → task → stage` 的恢复拆解/准入，不自动复活旧 [SUO-351](/SUO/issues/SUO-351)。

## 7. 最小回归检查

恢复 execute 产物至少保存以下矩阵：

| 层级 | Happy path | Failure / 反证 |
| --- | --- | --- |
| 解析 | 四个模块从本项目解析 | 从 `/Users/dmeck/project` 或 sibling 解析即失败 |
| CSS | 独立 PostCSS probe 无 warning | Tailwind import/plugin 失败需保存完整 error chain |
| Build | 冷 `pnpm build` + 新鲜 `BUILD_ID` | 部分 `.next` 生成不计成功 |
| Dev | ready 后请求 `/`、`/customers` | 首请求 5xx、CSS 404 或 resolver error |
| 隔离 | 无 Refine/Admin 路由与依赖 | 缓存或依赖树出现 `@refinedev/*` 即停止 |
| 仓库 | 只出现获准的最小配置 diff | 现有 `docs/stage/**`、`docs/exec/**` dirty state 必须原样保留 |

本恢复不要求全量 Vitest/E2E，因为没有应用功能变更；如果 tracked 配置发生变化，则必须额外执行受影响配置 lint/加载检查和现有 customers Playwright smoke。任何 DB/外部服务导致的页面失败应与构建链错误分开记录，不能用来掩盖 Tailwind/PostCSS 结果。

## 8. 风险、依赖与失败/回滚条件

| ID | 风险/依赖 | 处理 |
| --- | --- | --- |
| `REC-RISK-001` | 执行器从错误 cwd 启动 | 修正 execution workspace/启动命令；禁止向父目录安装依赖 |
| `REC-RISK-002` | `.next` 含其他 checkout 绝对路径 | 冷缓存是强制前置；旧生成物仅留摘要 |
| `REC-RISK-003` | 临时 Refine 安装污染 node_modules | 冻结安装恢复；不允许非冻结重写 lock |
| `REC-RISK-004` | 多包管理器锁文件产生歧义 | 本任务只认 pnpm；npm lock 治理另行决策 |
| `REC-RISK-005` | 端口占用或 sandbox `EPERM` 被误判为应用错误 | 记录监听/权限错误，使用获准端口环境重试一次；不得改应用代码 |
| `REC-RISK-006` | 现有其他 Agent 的 dirty 文件被误清理 | 以 R0 快照为保护清单，只比较获准路径，禁止 reset/checkout 整个工作树 |

### 8.1 失败条件

以下任一发生即恢复失败：

- R0 根目录或模块解析无法固定到 `$PROJECT_ROOT`。
- 冻结安装无法完成且需要改变已锁版本。
- 冷 `pnpm build` 非零、超时或没有新鲜 `.next/BUILD_ID`。
- dev 未 ready、首个 PWA 请求后退出，或仍出现 Tailwind/PostCSS 解析错误。
- 修复需要应用代码、Next 版本、Refine/Admin 或下游流水线文档变更。
- 无法区分本次 diff 与现有并发/用户变更。

### 8.2 回滚合同

1. 开始前记录获准 tracked 文件的内容哈希与 scoped diff；不得假设整个工作树 clean。
2. 失败时只撤销本 recovery run 实际修改的 tracked 配置，保留其他 Agent/用户已有变更。
3. 删除或隔离本 run 生成的 `.next` 与临时日志；`node_modules` 可保留冻结安装态，但不得提交。
4. 在 Issue 评论/exec 产物中记录最后一个通过 gate、首个失败 gate、命令、cwd、退出码、错误链、diff 与回滚结果。
5. 失败后不得直接重试 Refine S0，也不得把 [SUO-351](/SUO/issues/SUO-351) 改回执行中。

### 8.3 澄清条件

| 标记 | 触发条件 | Owner / 动作 | 默认行为 |
| --- | --- | --- | --- |
| `[CLARIFICATION_NEEDED]` 版本变更 | 只有改变 Next/React/Tailwind/PostCSS 版本才能继续 | DesignArchitect + CEOOrchestrator 评审新证据并增量修订设计 | 保持当前版本，恢复 blocked |
| `[CLARIFICATION_NEEDED]` 应用 CSS 变更 | 冷环境中独立 PostCSS 与 Next 均证明 `app/globals.css` 本身失败 | DesignArchitect 明确允许的 CSS 最小 diff 与回归面 | 不改 `app/**` |
| `[CLARIFICATION_NEEDED]` 包管理治理 | 必须删除/重生 `package-lock.json` 或改变 workspace 布局 | 仓库 owner / CEOOrchestrator 决定唯一 lock 策略 | pnpm 继续权威，npm lock 不动 |
| `[CLARIFICATION_NEEDED]` 外部执行器 | 正确 repo 命令在本地通过，但 Paperclip/Playwright 固定从父目录启动 | CEOOrchestrator / runtime owner 修正 execution workspace | 不以项目配置隐藏外部 cwd 错误 |

## 9. 关键决策记录

### `DEC-016` 基线恢复与 Refine spike 分离

- 决策：先在零 Refine 状态证明 Next/Tailwind/PostCSS，再创建新的 S0 spike。
- 原因：失败发生在 Admin 断言前，混合恢复与 Refine 会破坏归因。

### `DEC-017` pnpm 冻结安装图是恢复权威

- 决策：使用 `pnpm@9.15.0` 和 `pnpm-lock.yaml`；不由 npm lock、父目录或 sibling 依赖补齐模块。
- 原因：与仓库 `packageManager` 和现有执行命令一致。

### `DEC-018` 采用证据阶梯而不是猜测性改配置

- 决策：按 cwd → 冷缓存 → 冻结安装 → 配置缺陷顺序验证，每次只改变一个变量。
- 原因：当前仓库内模块解析与独立 PostCSS 已通过，直接换版本或改 CSS 缺乏依据。

### `DEC-019` build 与 dev 是两个独立硬门

- 决策：build 必须有新鲜 `.next/BUILD_ID`；dev 必须 ready 且能服务现有 PWA 请求，二者不可相互替代。
- 原因：失败 spike 已显示两类证据都可能在路由断言前失败。

### `DEC-020` `.next` 是可丢弃生成态，tracked 并发变更不是

- 决策：恢复必须冷启动 `.next`，同时按 R0 快照保护现有 dirty files。
- 原因：当前 `.next` 有旧 checkout/Refine 残留，而工作树存在其他阶段产物，不能使用全局 reset/checkout。

## 10. 增量变更说明

### 2026-08-07 / S0 失败后的恢复附件

- 新增 `DESIGN-REFINE-ADMIN-001-RECOVERY-001`，不改写主架构设计。
- 将“Next 16 待实证”细化为可执行的 R0–R3 恢复 gate。
- 记录当前模块解析、独立 PostCSS 成功、错误 cwd 和污染 `.next` 的证据强度。
- 冻结允许/禁止文件面、`BUILD_ID`/dev 证据、最小回归、失败、回滚与澄清合同。
- 保持 Refine、Admin 路由和全部后续 MVP 工作关闭，直到独立恢复完成并重新走固定流水线。

## 11. IssueDispatcher 只读交接

IssueDispatcher 应把本文映射为一个独立的“Next 16 + Tailwind/PostCSS 基线恢复”执行边界，并引用 `REC-AC-001` 至 `REC-AC-007`、R0–R3 串行 gate 及 §5.5 文件矩阵。不得把 Refine 依赖、Admin 路由壳或原 `TASK-REFINE-ADM-001` 的实现内容混入恢复 Issue；恢复成功后也只能把证据交回 CEOOrchestrator，由其另行启动新的 S0 `issue → task → stage → execute` 链路。

本设计阶段没有待决输入阻塞。若下游证据触发 §8.3 任一澄清条件，应停止恢复、在对应 Issue 评论引用相关 `DEC-016` 至 `DEC-020`，并回流同一设计附件增量修订，禁止创建平行冲突主稿。
