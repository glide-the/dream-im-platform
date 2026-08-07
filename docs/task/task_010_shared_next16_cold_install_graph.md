# 重建冷生成态与冻结 pnpm 安装图证据

## 1. 任务标题

R1：重建冷生成态与冻结 pnpm 安装图证据。

## 2. 关联 Issue 与任务元数据

- Task ID：`TASK-N16-REC-002`
- 关联 Issue：`N16-REC-002`
- task-stage Issue：[SUO-358](/SUO/issues/SUO-358)
- 恢复父项：[SUO-355](/SUO/issues/SUO-355)
- domain：`shared`
- 上游类型：`tooling`
- domain 归一化：本任务横跨生成态、依赖图和 CSS 工具链，按合法 task domain 归入 `shared`。
- 优先级：P0
- 标签：`next16`、`tailwind`、`postcss`、`recovery`、`gate-r1`
- 唯一规划主责：`TaskDesignAgent`
- 后续执行 owner：由 StagePlanner 唯一绑定；本 task 不直接派发。
- Requirement：[TASK-REQUIREMENT-task_010_shared_next16_cold_install_graph.md](./TASK-REQUIREMENT-task_010_shared_next16_cold_install_graph.md)
- 权威设计：`docs/design/design_002_next16_tailwind_postcss_baseline_recovery.md` §3、§5.2、§5.5、§6–§9

## 3. 任务目标

只在 R0 PASS 的同一 checkout 中建立可供 Next 冷构建使用的 R1 状态：先保存旧 `.next` 污染摘要，再隔离可再生生成态；复核仓库内 pnpm 安装图，仅在证据要求时执行冻结安装；最后用独立 PostCSS/Tailwind probe 证明插件链可加载。R1 不宣称 Next build 成功。

## 4. 输入与输出

### 输入

- `TASK-N16-REC-001` 的 `R0 PASS` 证据与 dirty-file 保护清单。
- 当前 `.next/**`、`node_modules/**`、`package.json`、`pnpm-lock.yaml`、`pnpm-workspace.yaml`。
- `postcss.config.js`、`next.config.js`、`playwright.config.ts`；默认只读。
- `app/globals.css`；只作为独立 probe 输入，不允许修改。

### 输出

- 旧 `.next` 的存在性、`BUILD_ID` 状态、旧 checkout 绝对路径与已回滚 `@refinedev/*` 引用摘要，以及隔离/删除位置和结果。
- 清理后 `.next` 不存在或为空的可判定证据。
- 四个关键模块的解析路径；冻结安装是否触发、命令、退出码、lock 前后 hash/diff。
- 独立 PostCSS/Tailwind probe 的输入、cwd、插件配置、退出码、输出大小与 warning/error chain。
- `R1 PASS` 或首个 `[BLOCKED]`，以及仅本 run 变更的回滚结果。

## 5. 实现步骤

1. 校验输入确为同一 checkout 的 `R0 PASS`；若缺字段、run/cwd 不同或 dirty snapshot 已失效，停止并回到 R0。
2. 确认没有本恢复 Issue 启动且仍运行的 dev 进程。记录 `.next/BUILD_ID` 是否存在，并只保存旧绝对路径、旧 Refine 块和关键文件数量/时间摘要，不上传或提交整个 `.next`。
3. 将 `.next` 移入本次 Paperclip run scratch 的明确目录，或在证据留存后删除该 ignored 目录；操作前后记录目标路径，且不得使用指向项目根的宽泛递归删除。
4. 在现有 `node_modules` 上重复四模块解析。只有解析缺失、软链接越出 `$PROJECT_ROOT/node_modules/.pnpm` 或安装态无法解释时，才运行 `pnpm install --frozen-lockfile`。
5. 冻结安装前后记录 `package.json`、`pnpm-lock.yaml` 的 hash/scoped diff。若命令要求改写 lock、版本或 package 声明，立即停止；不得改用非冻结安装。
6. 从 `$PROJECT_ROOT` 使用现有 `postcss.config.js`、`app/globals.css` 和 `@tailwindcss/postcss` 运行独立 probe；将输出写入 run scratch，不在仓库新增 probe 源码或编译产物。
7. 扫描 R1 日志/状态，确认后续不会复用旧 checkout 或 `@refinedev/*` 生成证据。按 `REC-AC-002`、`REC-AC-003`、`REC-AC-007` 判定。
8. 若证据精确命中一个受控 tracked 配置，先保存未修改失败、命中诊断和文件基线，再只修改一个候选；记录 scoped diff，并将 R2/R3 的空 `.next` 重跑设置为硬性后继条件。没有精确证据时不得改配置。
9. 回写 PASS 或首个失败 gate、命令/cwd/退出码/error chain、diff 与回滚；失败时不创建 R2 可执行结果。

## 6. 涉及文件路径与修改边界

| 分类 | 路径 | 允许动作 | 约束 |
| --- | --- | --- | --- |
| 可操作生成态 | `.next/**` | 摘要、隔离、删除 | ignored；不提交，不作成功证据 |
| 条件恢复态 | `node_modules/**` | `pnpm install --frozen-lockfile` 恢复 | 只在解析/安装态证据触发；不提交 |
| 临时证据 | Paperclip run scratch/测试输出 | 日志、probe 输入输出、hash | 关键结论须回写执行 Issue/附件 |
| 默认只读 | `app/globals.css` | 仅作为 probe 输入 | 当前无源码修改授权 |
| 条件 tracked 候选 | `next.config.js`、`postcss.config.js`、`pnpm-workspace.yaml`、`package.json`、`pnpm-lock.yaml`、`playwright.config.ts` | 精确诊断后单变量最小修改 | 需要未修改失败 + 命中诊断 + scoped diff + 冷 R2/R3 重跑 |
| 禁止 | `package-lock.json`、其余 `app/**`、`app/api/**`、`app/lib/**`、`drizzle/**`、schema/migration、下游文档、父目录/sibling | 不操作 | 触发即停止并澄清/回滚 |

版本号、新包、`@refinedev/*`、React Router、Admin 路由/测试均不在候选范围。

## 7. 依赖项与 DAG

- 前置依赖：`TASK-N16-REC-001` 的 `R0 PASS`。
- 并行条件：无；R0–R3 必须在同一证据链中串行。
- 严格依赖边：

```text
TASK-N16-REC-001 (R0 PASS)
  └─> TASK-N16-REC-002 (R1)
        └─ PASS only → TASK-N16-REC-003 (R2)
```

- StagePlanner 准入信号：将冻结安装标为条件步骤，而非无条件改依赖；将所有条件配置修改绑定到证据和后续冷重跑。

## 8. 前端 / 后端 / 联调边界

- 前端：不修改 `app/globals.css`、页面、组件或路由；CSS 文件仅作为工具链 probe 的只读输入。
- 后端：不修改 API、DB、schema 或 `app/lib/**`；不启动业务服务。
- 联调/工具链：拥有 `.next` 隔离、pnpm 安装图复核和独立 PostCSS probe。
- 验收：区分“独立 CSS probe PASS”与“Next build PASS”；前者只准入 R2，不替代 R2。

## 9. 测试策略

### Happy path

- 旧 `.next` 已留摘要后隔离，后续从空生成态开始。
- 四个模块仍从项目内 pnpm 链解析。
- 若无需冻结安装，证据明确写“未触发”；若触发，`pnpm install --frozen-lockfile` exit 0 且 lock/package 无变动。
- 独立 PostCSS/Tailwind probe exit 0、无 warning，输出非空。

### Failure path

- 冻结安装要求修改 lock/package 或改变版本。
- 模块解析越出项目根、probe 出现 Tailwind import/plugin error、旧 checkout/Refine 污染无法隔离，或并发 diff 无法归属。
- 任一失败均阻止 R2；不能用非冻结安装、改 CSS 或换版本绕过。

### 最小验证方式

- 重复 R0 的四模块 `require.resolve`。
- 条件命令：`pnpm install --frozen-lockfile`。
- 使用现有 PostCSS 配置编译 `app/globals.css` 到 run scratch，并记录 warning 数和输出大小。
- `git diff --check -- next.config.js postcss.config.js pnpm-workspace.yaml package.json pnpm-lock.yaml playwright.config.ts`（仅对实际条件修改的路径运行/解释）。

## 10. 完成标志

- `REC-AC-002`：安装器、固定版本和仓库内解析证据没有被破坏。
- `REC-AC-003`：旧 `.next` 已隔离，R2 输入明确为空生成态；旧 checkout/Refine 引用不再作为后续证据。
- `REC-AC-007`：生成态未提交，既有 dirty state 未覆盖，任何条件 tracked diff 均有完整因果链。
- R1 明确 PASS，或失败时记录首失败和回滚；只有 PASS 解锁 R2。

## 11. 非目标

- 不证明 `pnpm build` 或 `pnpm dev` 成功。
- 不修改应用 CSS、业务页面、API、lib、schema 或 migration。
- 不治理 `package-lock.json`，不升级/降级依赖，不恢复 Refine/Admin。
- 不把多个猜测性配置修改合并为一个修复。

## 12. 风险、阻塞与回退

| 条件 | Owner / action | 默认行为 | 回滚 |
| --- | --- | --- | --- |
| 冻结安装要求改版本 | `DesignArchitect` + `CEOOrchestrator` 评审新增证据 | 保持现版本并 blocked | 撤销本 run 条件配置；保留锁文件原状 |
| 必须删除/重生 `package-lock.json` 或改 workspace 布局 | 仓库 owner / `CEOOrchestrator` 决定包管理治理 | pnpm 继续权威，npm lock 不动 | 不在本任务改治理范围 |
| 独立 probe 与冷 Next 证据均指向 `app/globals.css` | `DesignArchitect` 明确 CSS 最小 diff 与回归面 | 不改 `app/**` 并 blocked | 清理临时 probe，保留错误链 |
| 安装/解析越出项目根 | runtime owner 修正执行环境 | 不向父目录安装依赖 | 隔离本 run `.next`，撤销本 run 配置 |
| 并发 dirty diff 不可区分 | 当前执行 owner 协调对应改动 owner | 停止下游 | 仅撤销可证明属于本 run 的修改 |

禁止全局 reset、checkout 或清理整个工作树。回滚后记录最后一个 PASS gate、首个 FAILED gate、scoped diff 与生成态处置。StagePlanner 必须把本任务设为 R0 PASS 后的唯一后继，并使 R2 依赖显式 `R1 PASS`；冻结安装和单变量配置修复都不得变成并行分支。本文档完成只表示 R1 已可排期，不表示 R1 或 Next build 已执行通过。
