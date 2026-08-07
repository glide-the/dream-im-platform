# `TASK-N16-REC-003`：R2 验证冷生产构建与新鲜 BUILD_ID

## 1. 任务标题

R2：验证 Next 16 冷生产构建与新鲜 `.next/BUILD_ID`。

## 2. 关联 Issue 与任务元数据

- Task ID：`TASK-N16-REC-003`
- 唯一映射 Issue：`N16-REC-003`
- 当前 task-stage Issue：[SUO-358](/SUO/issues/SUO-358)
- 恢复父项：[SUO-355](/SUO/issues/SUO-355)
- 设计阶段：[SUO-356](/SUO/issues/SUO-356)
- Issue 阶段：[SUO-357](/SUO/issues/SUO-357)
- 失败背景：[SUO-351](/SUO/issues/SUO-351)
- domain：`shared`
- 上游类型：`tooling`
- 优先级：P0
- 标签：`next16`、`build`、`recovery`、`gate-r2`
- 唯一规划主责：`TaskDesignAgent`
- 后续执行 owner：由 StagePlanner 唯一绑定；本 task 不直接派工。
- Requirement：
  [TASK-REQUIREMENT-task_011_shared_next16_cold_build.md](./TASK-REQUIREMENT-task_011_shared_next16_cold_build.md)

## 3. 任务目标

仅在同一 checkout 的 `R1 PASS` 后，从空 `.next` 执行唯一权威命令
`pnpm build`，并以退出码、Next `16.1.6` 日志、新鲜非空 `BUILD_ID`、build
diagnostics、旧路径/Refine 污染扫描和 scoped diff 共同证明生产冷构建成功。仅看到
构建开始、部分 `.next` 生成或超时，均不属于成功。

## 4. 输入与输出

### 输入

- `TASK-N16-REC-002` 的 `R1 PASS`，包括冷 `.next`、固定安装图和 CSS probe 证据。
- `TASK-N16-REC-001` 的 dirty-file 保护快照。
- R1 已获准的单变量配置 diff（若存在）及其修改前失败证据。
- 设计 §5.3、§5.5、§6–§8 与 Issue `N16-REC-003`。

### 输出

- build 开始/结束时间、执行 cwd、命令、退出码和关键日志。
- `.next/BUILD_ID` 的文件类型、非空状态、mtime、hash/值摘要及其新鲜性判断。
- `.next/diagnostics/build-diagnostics.json` 的最终阶段/状态。
- build 日志、trace、sourcemap 中父目录、旧 checkout、`@refinedev/*` 引用扫描。
- build 前后 `git status --short` 与获准路径 scoped diff。
- `R2 PASS` / `[BLOCKED] R2`、最后通过 gate、首失败证据及精准回滚结果。

## 5. 实现步骤

1. 验证 `TASK-N16-REC-002` 为同一 checkout 的 `R1 PASS`，并确认 `.next` 在 build
   前为空或不存在；证据不完整立即停止。
2. 保存 build 开始时间、R0 保护快照对照和获准配置的 build 前 hash/diff。
3. 从 `$PROJECT_ROOT` 运行唯一权威 `pnpm build`；记录完整退出状态，不以日志片段
   推断成功。
4. 校验退出码为 0、日志明确为 Next `16.1.6`，且无 Tailwind/PostCSS/module
   resolution error。
5. 校验 `.next/BUILD_ID` 是本次 build 后创建的非空普通文件；用开始时间、mtime 与
   hash/值摘要证明新鲜性。
6. 检查 `.next/diagnostics/build-diagnostics.json`，不得停留在失败 `compile` 状态。
7. 扫描日志、trace 与 sourcemap，不得出现
   `/Users/dmeck/project/claude-agent-next-kit`、父目录依赖或已回滚
   `@refinedev/*`。
8. 比较 build 前后 scoped diff；`.next/**` 不提交，tracked diff 只能是此前获准的
   单变量配置或本 gate 直接证据化的一个最小配置。
9. 若首轮 cold build 直接命中获准配置，保存首轮失败后只改变一个变量，再从空
   `.next` 重跑 R2；不得覆盖首轮失败记录或叠加第二个猜测。
10. 全部条件通过时形成 `R2 PASS` 并只解锁 `TASK-N16-REC-004`；任一条件失败则
    `[BLOCKED] R2`，不得启动 dev。

## 6. 涉及文件路径与修改边界

| 分类 | 路径 | 本 task 权限与准入 |
|---|---|---|
| 可操作生成态 | `.next/**` | cold build 生成、诊断与扫描；ignored、不提交；重跑前重新清空 |
| 允许写入 | Paperclip run scratch / 测试输出 | build 日志、hash、diagnostics 摘要和 diff |
| 条件候选 | `next.config.js` | shell cwd 正确但 Next 仍报告错误/多 root 时，只允许一致的 turbopack/tracing root 最小修复 |
| 条件候选 | `postcss.config.js` | cold Next 与独立 probe 共同直接命中插件加载/基目录时才允许修改 |
| 条件候选 | `pnpm-workspace.yaml` | pnpm/Next 实际识别父目录或 sibling 时才允许修正单包根 |
| 条件候选 | `package.json`、`pnpm-lock.yaml` | frozen install 已明确报告既有声明不一致时，只恢复当前版本一致性 |
| 默认只读 | `playwright.config.ts` | `pnpm build` 不经过 Playwright；R2 不以猜测修改，交给 R3 直接证据 |
| 禁止修改 | `app/globals.css` 与其他 `app/**` | 当前无应用代码授权 |
| 禁止修改 | `package-lock.json`、任何版本号、新依赖 | 触发澄清，不在恢复 task 内决定 |
| 禁止修改 | `app/api/**`、`app/lib/**`、schema、`drizzle/**` | 不改 API、领域/DB 逻辑或 migration |
| 禁止修改 | Refine/Admin、下游流水线文档、父目录/sibling | 不复活旧 S0，不越界 |

若 R1 已有一个 tracked 配置 diff，R2 只能消费并验证；如需另一个候选，必须先回滚
前一变量并重新建立单变量证据，或进入澄清，不能叠加修改。

## 7. 依赖项与 DAG

- 硬前置：`TASK-N16-REC-002` 的 `R1 PASS`。
- 唯一后继：`TASK-N16-REC-004`。
- 并行条件：无；R2 不得与 R0、R1、R3 并行。

```text
TASK-N16-REC-001 (R0 PASS)
  → TASK-N16-REC-002 (R1 PASS)
      → TASK-N16-REC-003 (R2)
          └─ R2 PASS only → TASK-N16-REC-004 (R3)
```

R2 failure、timeout、缺少新鲜 `BUILD_ID` 或 clarification 均关闭 R3。

## 8. 前端 / 后端 / 联调边界

- 前端：不修改页面、组件、路由或 CSS；只观察 Next build 是否编译现有前端资产。
- 后端：不修改 Route Handler、`app/lib`、schema/migration 或业务服务。
- 联调：验证 Next build 与 pnpm/PostCSS/Tailwind 链路在同一项目根内闭合。
- 验收：必须同时具备 exit 0 与本次新鲜 `BUILD_ID`；任一单项不可替代另一项。

## 9. 测试策略

### Happy path

从空 `.next` 运行 `pnpm build` exit 0，日志为 Next `16.1.6`，本次生成非空
`BUILD_ID`，diagnostics 不处于失败 compile，污染扫描与 scoped diff 清洁。

### Failure path

build 非零/超时、只生成部分 `.next`、`BUILD_ID` 缺失或陈旧、Tailwind/PostCSS
resolver error、旧 checkout/Refine 引用或越界 tracked diff 任一发生，均输出
`[BLOCKED] R2`，不启动 R3。

### `REC-AC` 证据矩阵

| AC | R2 责任 | 完成判定 |
|---|---|---|
| `REC-AC-001` | 消费并反证检查 | build cwd/log 不得推翻 R0 root 结论 |
| `REC-AC-002` | 消费并反证检查 | build 使用固定 Next/pnpm/安装图，无版本或外部解析变化 |
| `REC-AC-003` | 直接验证 | 从空 `.next` 生成，trace/sourcemap 无旧 checkout/Refine |
| `REC-AC-004` | 直接产出 | `pnpm build` exit 0 且本次新鲜非空 `BUILD_ID` |
| `REC-AC-005` | 后续待验证 | build 不替代 dev ready/HTTP 证据 |
| `REC-AC-006` | 后续待验证 | build 不替代现有页面 smoke |
| `REC-AC-007` | 直接维护 | 生成态不提交，tracked diff 只含获准单变量，其他 dirty state 保留 |

最小验证命令/方式为 `pnpm build`、`BUILD_ID` 时间/hash 检查、diagnostics 读取、
污染路径扫描、`git status --short` 与获准路径 scoped diff。没有应用功能变更时不要求
全量 Vitest/E2E。

## 10. 完成标志

- [ ] `N16-REC-003` 与 `TASK-N16-REC-003` 一一对应。
- [ ] 已消费同一 checkout 的 `R1 PASS`，并证明 build 前 `.next` 为冷态。
- [ ] `pnpm build` exit 0、Next 版本与关键日志可审计。
- [ ] `.next/BUILD_ID` 为本次生成、非空且 mtime/hash 证据完整。
- [ ] diagnostics、污染扫描和 scoped diff 满足 `REC-AC-003/004/007`。
- [ ] 结论为 `R2 PASS` 并只解锁 R3；或为带 owner/action 的 `[BLOCKED] R2`。

以上全部满足且结论为 PASS，才构成 StagePlanner 可消费的完成信号。缺少新鲜
`BUILD_ID` 永远不能标记完成。

## 11. 非目标

- 启动 dev、访问 `/`、`/customers` 或运行浏览器 smoke。
- 修改应用代码、API/lib/schema/migration 或补产品功能。
- 安装 Refine、创建 Admin 路由/测试或重试旧 S0。
- 更改版本、新增依赖、删除/重生 npm lock，或用多个配置猜测根因。

## 12. 风险、阻塞与回退

| 触发条件 | 停止/回滚 | Owner | Unblock / 澄清 action |
|---|---|---|---|
| build 非零/超时/无新鲜 `BUILD_ID` | R2 停止，隔离本 run `.next` | 当前唯一执行 owner | 记录错误链；仅在直接证据命中获准配置时做一次单变量冷重跑 |
| Next root 仍指向父目录 | 不向父目录安装依赖或改应用 | `CEOOrchestrator / runtime owner` | 修正 execution workspace 后从 R0 重跑 |
| 需要版本变化 | 撤销本 run tracked diff，保持 blocked | `DesignArchitect + CEOOrchestrator` | 评审并增量修订设计 |
| 需要修改 `app/globals.css` | 不改 `app/**` | `DesignArchitect` | 明确最小 CSS diff 与回归面 |
| 需要删除 npm lock/改变 workspace 治理 | 不擅自改锁策略 | `仓库 owner / CEOOrchestrator` | 作独立治理决定 |
| tracked diff 与并发变更不可区分 | 不 reset/checkout 全树 | `TaskDesignAgent` | 记录冲突并阻塞，待作用域可区分后重启链路 |

回滚只覆盖本 run 实际修改的单一 tracked 配置，并移除/隔离本 run `.next`；其他
Agent/用户变更保持原样。阻塞记录必须含最后 PASS gate、首 FAILED gate、命令、cwd、
退出码、错误链、scoped diff 与回滚结果。
