# Claude Plugin 数据 Admin 提供方验证

Registry175-182 将共享 Claude Plugin 的 Marketplace、operation、installation 和 uninstall
数据职责迁入 Admin。严格 DTO、Service 和 typed Drizzle Repository 覆盖 approved entry、
operation 状态锁、制品唯一键 replay/revive/insert、Deck ref disable、receipt 与 audit。
Dream 的 CLI、Git、manifest/digest、artifact store、共享文件系统和后台任务消费切换仍是下一阶段，
因此本文件只声明 Admin 技术提供方通过。

| 验证 | 工作目录 | 结果 | 关键证据 |
| --- | --- | --- | --- |
| focused Vitest | Admin worktree | exit 0 | 4 files，11 tests passed |
| full provider-free unit | Admin worktree | exit 0 | 270 files passed，17 skipped；2053 tests passed，36 skipped |
| TypeScript | Admin worktree | exit 0 | `pnpm exec tsc --noEmit --incremental false` |
| owned ESLint | Admin worktree | exit 0 | DTO/Repository/Service/Handler/registration/route 全部通过 |
| production build | Admin worktree | exit 0 | DB package build、Next.js compile、TypeScript、19 个静态页面及 route inventory 通过 |
| generated registry | Admin worktree | exit 0 | 182 operations；Registry174 prefix SHA `242ddb8e06c66058b4a6a0a015a08edb41353446ae00be46e6c2f1b946cf57dc`；Registry182 SHA `aba16ed638cd1a88b0471208223efa2f13476c5c33ae2e01481ec559b9777fc1` |
| docs/JSON/diff | Admin worktree | exit 0 | JSON 可解析；新增 Markdown 相对引用 0 missing；`git diff --check` 通过 |

Provider-free 断言覆盖安装/operation/Marketplace 投影、entry-ID prepare、queued → running →
progress → ready、installation 原子提交、Marketplace digest drift、非法 JSON、uninstall 与 Deck refs
禁用，以及 actor/user/role/SQL/table/column/transaction 选择器拒绝。写 ingress 均经过原 request
receipt。

尚未在本文件声明完成的项目：Dream 公开路由消费、隔离 PostgreSQL 事务/ACL 合同、源码和运行时
数据库关闭证明、正常账户与本机真实业务验收。它们在 Dream 消费切换与跨项目验收阶段执行。

<!-- [Sync] 2026-09-16: deterministic Registry175-182 provider evidence. -->
