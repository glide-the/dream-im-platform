# Deck Plugin 控制面 Admin 提供方验证

Registry170-174 将活跃的 Deck Plugin 安装、版本、readiness、计划和提交数据边界迁入
Admin。严格 DTO、Service 和 typed Drizzle Repository 覆盖 canonical actor、Workspace owner、
instance admin、release/lock、revision、状态转换、Runtime evidence、materialization、receipt 与
audit。Dream 的本地制品、共享文件系统与 CLI 消费切换仍是下一阶段，因此本文件只声明
Admin 技术提供方通过，不声明跨项目迁移或真实业务验收完成。

| 验证 | 工作目录 | 结果 | 关键证据 |
| --- | --- | --- | --- |
| focused Vitest | Admin worktree | exit 0 | 4 files，11 tests passed |
| full provider-free unit | Admin worktree | exit 0 | 267 files passed，17 skipped；2044 tests passed，36 skipped |
| TypeScript | Admin worktree | exit 0 | `pnpm exec tsc --noEmit --incremental false` |
| owned ESLint | Admin worktree | exit 0 | DTO/Repository/Service/Handler/registration/route 全部通过 |
| production build | Admin worktree | exit 0 | DB package build、Next.js compile、TypeScript、19 个静态页面及 route inventory 通过 |
| generated registry | Admin worktree | exit 0 | 174 operations；Registry169 prefix SHA `adb90cec21e76f709d9d10638642051f33b1eb04df618f6984aaffb5c4a0962e`；Registry174 SHA `242ddb8e06c66058b4a6a0a015a08edb41353446ae00be46e6c2f1b946cf57dc` |
| docs/JSON/diff | Admin worktree | exit 0 | Markdown 相对引用 0 missing；JSON 可解析且最后操作为 `deck-plugin-control.apply`；`git diff --check` 通过 |

Provider-free 状态机断言覆盖新安装及 materialization、能力扩张进入审批、非法 readiness
evidence、stale revision、foreign Workspace、local source、instance 非管理员、列表/readiness
投影、缺失或 digest 不一致 evidence，以及 actor/SQL/table/column/transaction 选择器拒绝。

尚未在本文件声称执行的项目：隔离 PostgreSQL 真实事务/ACL 合同、Dream 公开路由消费、源码与
运行时数据库关闭证明、正常账户和本机真实业务验收。这些在 Dream 消费切换与跨项目验收阶段完成。

<!-- [Sync] 2026-09-16: deterministic Registry170-174 provider evidence. -->
