# Exec Report: SUO-363 - agent-workspaces build input boundary

## 1. 执行上下文

- Task ID: `SUO-363`
- 关联 Issue: [SUO-363](/SUO/issues/SUO-363)
- 上游恢复单（只读、未执行 R0–R3）: [SUO-361](/SUO/issues/SUO-361)
- 关联 Stage（只读）: `docs/stage/stage_next16_tailwind_postcss_baseline_recovery.md`
- 执行 Agent: `ExecTaskAgent`
- 执行时间: `2026-08-07T22:42:43+08:00`
- Checkout: Paperclip checkout 已在本 run 取得；状态由 `todo` 进入 `in_progress`。

## 2. TASK-REQUIREMENT-FORMAT.md 填充摘要

- 模板路径（只读）: `docs/task/TASK-REQUIREMENT-FORMAT.md`
- 输入 Issue: `SUO-363` 的独立 blocker-remediation task；`SUO-361` 不重跑且不改写 R0–R3。
- 输入 Task: 排除被 `.gitignore` 标识为非项目源码的 `agent-workspaces/**`，使其不再成为根 TypeScript project input。
- 填充后的执行目标: 用单一 `tsconfig.json` 输入边界变更，排除 `agent-workspaces`；不为其中的模板补齐应用依赖。
- 关键约束: 只修改 `tsconfig.json`；只新增本报告；`agent-workspaces/**`、`.gitignore`、现有报告与全部应用/依赖/恢复门禁均只读。
- 验收条件: 目标模板路径及任意 `/agent-workspaces/` 路径均从 `tsc --listFilesOnly` 输出消失；定向 diff 仅为该 exclude 条目；`git diff --check` 通过。

## 3. 模型生成的执行任务

根据已填充模板生成并通过范围校验的执行任务：

1. 保留现有 TypeScript include 集合和全部应用配置，不修改被忽略工作区内容。
2. 在根 `tsconfig.json` 的 `exclude` 加入目录项 `agent-workspaces`。
3. 以 `pnpm exec tsc --noEmit --incremental false --listFilesOnly` 验证 project root file set；检查目标路径和任意 `/agent-workspaces/` 路径都不存在。
4. 运行 `git diff --check -- tsconfig.json`，记录 scoped diff 和精确回滚方式。

## 4. 实现变更记录

| 文件 | 操作 | 说明 |
|---|---|---|
| `tsconfig.json` | update | 在既有 `exclude` 中增加 `agent-workspaces`，防止 `**/*.ts(x)` include 收集运行时工作区模板。 |
| `docs/exec/exec_SUO-363_agent_workspaces_build_input.md` | create | 本次独立 blocker-remediation 的执行、验证与回滚记录。 |

精确 diff：

```diff
"exclude": [
-  "node_modules"
+  "node_modules",
+  "agent-workspaces"
]
```

## 5. 测试与验证

所有命令 cwd：`/Users/dmeck/project/ink-admin-memory`。

| 检查 | 命令 | 结果 |
|---|---|---|
| 变更前输入事实 | `pnpm exec tsc --noEmit --incremental false --listFilesOnly` | exit `0`；输出包含 `/Users/dmeck/project/ink-admin-memory/agent-workspaces/chat_mlf6qur9_q69g6dp/skills/templates/home-page-template.tsx`（line 1855）。 |
| 变更后定向输入验证 | `pnpm exec tsc --noEmit --incremental false --listFilesOnly` | exit `0`；目标路径匹配数 `0`，任意 `/agent-workspaces/` 路径匹配数 `0`。 |
| 配置 diff 完整性 | `git diff --check -- tsconfig.json` | exit `0`，无空白错误。 |

未运行：`pnpm build`、R0–R3、dev、`/admin`、全量测试。它们不属于本独立 blocker-remediation 的授权验证范围。

## 6. 验证证据

- 变更前，该目标文件存在，且 `git check-ignore -v` 显示 `.gitignore:38:agent-workspaces`。
- 变更前最小 TypeScript root-file 检查确认其被根 `tsconfig.json` 的 include 收集。
- 变更后同一最小检查以 exit `0` 完成，并确认目标路径及目录前缀均不在 root file set。
- 工作树 scoped 变更仅含获准的 `tsconfig.json` 与本报告；未触碰已有未提交文档或受禁路径。

## 7. 风险与阻塞

- 风险: `agent-workspaces/**` 仍可能被其他非-TypeScript 工具显式读取；本修复只界定根 TypeScript project input，符合当前任务边界。
- 阻塞: 无。若同一目录仍以其他 project 配置被纳入，需新的明确合同后再扩展范围。
- 上游动作: [SUO-361](/SUO/issues/SUO-361) 的唯一恢复执行者现在可从 R0 重新开始；本单未声明任何 R0–R3 gate 已通过。

## 8. 完成状态

- [x] 已完成实现
- [x] 已完成定向验证
- [x] 已记录变更与验证证据
- [x] 已满足本单验收条件
- [x] 可标记本 blocker-remediation 为 done

## 9. 回滚建议

- 回滚文件: `tsconfig.json`
- 回滚方式: 仅删除本次新增的 `"agent-workspaces"` exclude 条目，并恢复 `node_modules` 为该数组唯一项。
- 注意事项: 不使用 `git reset`、全局 `git checkout`、stash 或清理命令；这些操作会影响他人的 dirty state。回滚后应重复本报告的 list-files 验证，以确认该目录重新进入输入集合这一预期回滚效果。
