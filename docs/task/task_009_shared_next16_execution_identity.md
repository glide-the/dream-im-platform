# 固化 Next 16 恢复执行身份、版本与工作区快照

## 1. 任务标题

R0：固化 Next 16 恢复执行身份、版本与受保护工作区快照。

## 2. 关联 Issue 与任务元数据

- Task ID：`TASK-N16-REC-001`
- 关联 Issue：`N16-REC-001`
- task-stage Issue：[SUO-358](/SUO/issues/SUO-358)
- 恢复父项：[SUO-355](/SUO/issues/SUO-355)
- 失败背景：[SUO-351](/SUO/issues/SUO-351)
- domain：`shared`
- 上游类型：`tooling`
- domain 归一化：task 命名域不包含 `tooling`；本任务横跨执行环境、包管理与仓库保护，归入 `shared`，不改变上游 Issue 类型。
- 优先级：P0
- 标签：`next16`、`tailwind`、`postcss`、`recovery`、`gate-r0`
- 唯一规划主责：`TaskDesignAgent`
- 后续执行 owner：由 StagePlanner 唯一绑定；本 task 不直接派发。
- Requirement：[TASK-REQUIREMENT-task_009_shared_next16_execution_identity.md](./TASK-REQUIREMENT-task_009_shared_next16_execution_identity.md)
- 权威设计：`docs/design/design_002_next16_tailwind_postcss_baseline_recovery.md` §2、§3、§5.1、§5.5、§6–§9

## 3. 任务目标

在不改变仓库、依赖或生成态的前提下，从唯一
`$PROJECT_ROOT=/Users/dmeck/project/ink-admin-memory` 建立 R0 执行身份：证明 shell、Git、Paperclip workspace、pnpm 和四个关键模块均归属于同一 checkout，并冻结初始 dirty-file 保护快照。R0 只裁定能否进入 R1，不执行任何恢复动作。

## 4. 输入与输出

### 输入

- 当前 Paperclip execution workspace 与 checkout。
- `package.json`、`pnpm-lock.yaml`、`pnpm-workspace.yaml` 和现有 `node_modules/**`。
- 开始时的完整 `git status --short`；其中其他 Agent/用户已有变更均为保护对象。
- 上游设计的 `EVD-001`、`EVD-003`、`EVD-005` 与 `DEC-017`、`DEC-018`、`DEC-020`。

### 输出

- 一份 R0 证据包，至少包含：Paperclip run/Issue 标识、命令、`pwd -P`、Git toplevel、Paperclip workspace cwd、Node/pnpm 版本、pnpm root、关键包声明版本、四个 `require.resolve` 结果、退出码和时间戳。
- 初始 dirty-file 保护清单，以及条件候选 tracked 配置的内容 hash/scoped diff 基线。
- 唯一判定：`R0 PASS` 或 `R0 [BLOCKED]`。只有 PASS 输出可作为 `TASK-N16-REC-002` 的输入。

## 5. 实现步骤

1. 确认当前执行 Issue、run 和 workspace 指向本仓库；将 `$PROJECT_ROOT` 固定为 `/Users/dmeck/project/ink-admin-memory`，不从父目录或 sibling 启动命令。
2. 在不修改文件的条件下记录 `pwd -P`、`git rev-parse --show-toplevel`、Paperclip workspace cwd 与 `pnpm root`，逐项比较它们是否属于同一项目根。
3. 记录 `node --version`、`pnpm --version`、`package.json#packageManager`，并从 lock/package 声明读取 Next、Tailwind CSS、`@tailwindcss/postcss` 与 PostCSS 版本。
4. 使用 Node `createRequire` 分别解析 `next/package.json`、`tailwindcss`、`@tailwindcss/postcss`、`postcss`；保存完整绝对路径，不只记录“可解析”。
5. 记录 `git status --short`。对后续可能获准修改的配置文件建立 hash 与 scoped diff 基线；将已存在的 `docs/stage/**`、`docs/exec/**` 等并发变更标为“只读保护”，不清理、不暂存、不纳入恢复提交。
6. 按 `REC-AC-001`、`REC-AC-002` 和 `REC-AC-007` 保护前提判定。任何 root/解析越界或版本不符合固定合同均立即停止，不开始 R1。
7. 在执行 Issue 评论/证据产物中记录 PASS 或首个失败项、实际值、期望值、owner/action；失败时保留现场，只请求修正 execution workspace/cwd 后从 R0 重跑。

## 6. 涉及文件路径与修改边界

### 允许读取

- `package.json`、`pnpm-lock.yaml`、`pnpm-workspace.yaml`
- `node_modules/**` 的解析目标
- 全工作树状态与条件候选配置的 scoped diff/hash
- Paperclip workspace/run 元数据

### 只读兼容保护

- `next.config.js`、`postcss.config.js`、`playwright.config.ts`
- 当前已有的 `docs/stage/**`、`docs/exec/**` 及任何其他 dirty file
- `app/**`、`drizzle/**` 与现有测试

### 禁止操作

- 删除、隔离或生成 `.next/**`
- 运行依赖安装、`pnpm build` 或 `pnpm dev`
- 修改任何 tracked 文件或清理任何已有变更
- 向 `/Users/dmeck/project` 父目录或 sibling 安装依赖
- 使用 npm/yarn/bun、改变版本、加入 `@refinedev/*`、React Router 或 Admin 路由

## 7. 依赖项与 DAG

- 前置依赖：无。
- 并行条件：无；R0 是恢复链唯一入口，不得与 R1–R3 并行。
- 严格依赖边：

```text
TASK-N16-REC-001 (R0)
  └─ PASS only → TASK-N16-REC-002 (R1)
```

- StagePlanner 准入信号：本 task 文档字段完整、边界可判定，且 Stage plan 将 R1 设置为依赖 R0 的 PASS 输出；不得把文档完成误认为 R0 已实际 PASS。

## 8. 前端 / 后端 / 联调边界

- 前端：无页面、组件、CSS 或路由实现；`app/**` 仅作为受保护范围。
- 后端：无 API、DB、schema 或 `app/lib/**` 实现；Route Handler 约束保持不变。
- 联调/工具链：负责 cwd/root、版本、模块解析和工作树快照证据，是本任务唯一执行主体。
- 验收：逐字段比对实际根路径和解析路径；不接受“命令能启动”或“包已声明”作为解析归属证据。

## 9. 测试策略

### Happy path

- `pwd -P`、Git toplevel 与 Paperclip workspace cwd 均为 `$PROJECT_ROOT`。
- `pnpm root` 位于 `$PROJECT_ROOT/node_modules`。
- Node `>=20.9.0`、pnpm `9.15.0`；Next `16.1.6`、Tailwind CSS `4.1.18`、`@tailwindcss/postcss` `4.1.18`、PostCSS `8.4.39` 声明和解析一致。
- 四个模块解析路径均落在 `$PROJECT_ROOT/node_modules/**`；dirty snapshot 采集前后无清理或覆盖。

### Failure path

- 任一 root/解析路径指向 `/Users/dmeck/project`、旧 checkout、sibling 或其他项目时，判定 R0 FAILED。
- Node/pnpm 不满足固定合同，或无法区分初始并发变更时，判定 R0 FAILED。

### 最小验证方式

```bash
pwd -P
git rev-parse --show-toplevel
git status --short
node --version
pnpm --version
pnpm root
node --input-type=module -e "import {createRequire} from 'node:module'; const r=createRequire(import.meta.url); for (const p of ['next/package.json','tailwindcss','@tailwindcss/postcss','postcss']) console.log(p, r.resolve(p))"
```

执行记录必须保存每条命令的 cwd、退出码和输出；Paperclip workspace cwd 单独记录，不能用 shell cwd 代替。

## 10. 完成标志

- `REC-AC-001` 有四类 root/cwd 的同源证据。
- `REC-AC-002` 有 Node/pnpm/包版本和仓库内解析路径证据。
- `REC-AC-007` 的初始 dirty-file 保护清单和条件候选 hash/scoped diff 基线已冻结。
- R0 只有一个明确结果；PASS 才允许 R1，FAILED/BLOCKED 时已有 owner/action 且未触碰生成态或 tracked 文件。

## 11. 非目标

- 不诊断或清理 `.next`，不恢复安装图，不运行 CSS probe、build、dev 或页面 smoke。
- 不修复 Next/PostCSS/workspace 配置。
- 不验证 Refine/Next 16 兼容性，不创建 Admin 路由，也不恢复旧 S0。
- 不制定 stage 波次、工期或直接执行人员。

## 12. 风险、阻塞与回退

| 条件 | 判定与影响 | Owner / unblock action | 回退或默认行为 |
| --- | --- | --- | --- |
| shell/Paperclip 从父目录或 sibling 启动 | `R0 [BLOCKED]`，R1–R3 不得开始 | `CEOOrchestrator` / runtime owner 修正 execution workspace 或启动 cwd | 不改项目配置；修复后从 R0 重跑 |
| 模块从项目外解析 | `R0 [BLOCKED]` | runtime owner 修正执行环境；后续安装态问题留给 R1 | 不向父目录安装依赖 |
| Node/pnpm 版本不符 | `R0 [BLOCKED]` | runtime owner 提供满足合同的执行镜像/工具链 | 不改变 Next 或包版本 |
| dirty state 无法归属 | `R0 [BLOCKED]` | 当前执行 owner 记录冲突路径并请对应改动 owner 澄清 | 不 reset/checkout/stash 他人改动 |

R0 本身不产生 tracked 或生成态修改，因此无需代码回滚；退出前只需确认没有文件被本任务改变，并把首个失败证据回写到执行 Issue。StagePlanner 必须将本任务建为串行链首节点，gate 判定必须是显式 `PASS`；`[BLOCKED]` 时阻止下游执行。本文档完成只表示 task-stage 可消费，不表示 Next 16 基线已恢复。
