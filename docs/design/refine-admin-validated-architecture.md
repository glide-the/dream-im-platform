# Refine 管理后台已验证架构

本文件记录 2026-08-08 PostgreSQL 完整迁移后的有效结论。早期“保留 PWA、Story SQLite 只读”的方案已废弃。

## 已确认决策

- 项目包名：`ink-memory-admin`。
- 唯一 UI：显式 `/admin` App Router 路由树；不使用 catch-all。
- 唯一数据库：PostgreSQL `ink-memory`；无 SQLite fallback。
- 唯一业务前台行为：根路径跳转 `/admin`；旧 ai4sales 路由返回 404。
- Refine DataProvider 映射受保护的 `/api/admin/:resource` CRUD。
- 所有管理 API 以服务端 Session/RBAC 为最终授权边界。
- 网关提供 Anthropic/OpenAI 兼容入口，使用不可变定价快照和账本。

## Resource 覆盖

Story：workspaces/projects/characters/scenes/workflow-runs；Identity：platform-users/admin-users/admin-roles/admin-permissions；Model：providers/models/pricing-rules；Billing/Gateway：accounts/usage/ledger/requests/keys；System：settings/audit。

## 发布门槛

1. 空 PostgreSQL 从 `0000` 顺序应用全部迁移。
2. 最终 schema 不包含 customers/todos/conversations/system_configs。
3. TypeScript、ESLint、Vitest、Playwright、Next build 通过。
4. 未登录 `/admin` 跳转登录页，旧 PWA 路由为 404。
5. 隔离库中 bootstrap/login/Story CRUD/RBAC/audit 验证通过。

详细架构见 [项目架构设计说明](../architecture/项目架构设计说明.md)，交互见 [Refine 管理后台交互设计](./refine-admin-interaction-design.md)。
