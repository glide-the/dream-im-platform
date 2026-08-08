# Refine 管理后台完成度审计

审计日期：2026-08-08

## 结论

`ink-admin-memory` 已完成 PostgreSQL-only 的 Refine 运营控制面、模型配置、用户模型权限、Token 计费账本、Claude/OpenAI 兼容网关、RBAC、系统设置与审计。本仓库没有 `app/(app)` 业务前台、SQLite 驱动或 SQLite fallback。

`ink-dream-memory` 当前仍使用自己的 SQLite 业务库；根据“不修改其业务代码”的范围，本次交付没有制造隐式双写或直接读取其数据库。业务项目切换 PostgreSQL、统一 Story 权威表和接入计费网关的后续步骤已经单独形成建议文档。

## 需求—证据

| 需求 | 当前证据 |
| --- | --- |
| Refine 管理后台 | `@refinedev/core`、Next Router、Data/Auth/Access Provider；`/admin/**` 资源页面和服务端管理 API |
| PostgreSQL-only | `pg` + Drizzle migrations；运行时缺少 `better-sqlite3`；`DATABASE_URL` 缺失时失败，不回退 |
| 移除旧前台 | `app/(app)` 不存在；`/` 跳转 `/admin`；旧 customers/todos/claude-agent 路由为 404 |
| 数据库命名 | 包名 `ink-memory-admin`，Compose 默认 PostgreSQL 数据库 `ink-memory` |
| Story 运营 | workspaces/projects/characters/scenes/workflow-runs 的 list/get/create/update/delete、RBAC、审计和外键保护 |
| 模型配置 | Provider、模型别名、定价时间窗、加密凭据、Anthropic `x-api-key`/Bearer 中转认证 |
| 用户模型权限 | 用户—模型启停、RPM、每日/月度 Token 覆盖的 Refine CRUD |
| Token 计费 | micro-USD 整数价格快照、预授权、capture/release、余额、四类 Token、不可变账本 |
| 模型代理 | `/v1/messages`、`/v1/messages/count_tokens`、`/v1/chat/completions`、`/v1/models`；流式/非流式 usage 结算 |
| 限流与异常 | 分钟/日/月计数窗口、余额/额度拒绝、`settlement_failed` 人工核对 |
| 用户/RBAC/资源 | 平台用户、Gateway Key、管理员、角色、权限、系统设置、审计日志 |
| ink-dream-memory 建议 | `docs/integration/ink-dream-memory-postgresql-gateway-migration.md` 基于真实 `database.py` 和 `ANTHROPIC_*` 契约 |

## 本轮验证结果

- PostgreSQL 空库从 `0000` 到 `0006` 全量迁移成功；临时数据库验证后已删除。
- 真实 Session Admin API 验证：用户模型权限 create/update/get/delete、限流窗口读取、Provider Bearer 配置全部成功。
- 审计验证：用户模型权限的 `create`、`update`、`delete` 均有记录。
- TypeScript：通过。
- ESLint：通过。
- Vitest：15 个文件、52 个测试全部通过。
- Playwright：既有认证/路由测试 4/4 通过。
- 已认证管理页面：1440×1000 与 390×844 均能显示用户模型权限和限流窗口，无异常浏览器诊断、无页面级横向溢出。
- Next.js production build：通过。
- Docker production image：构建成功；空库自动迁移、登录页 HTTP 200、未登录管理 API HTTP 401。
- QA preflight：通过；测试结束后 3000、3011、5433 端口均已释放。

## 有意保留的边界

- 不修改 `ink-dream-memory` 代码；其 PostgreSQL 切换必须单独实施并执行完整 Python/前端测试。
- 不调用真实上游模型凭据做自动 QA；Provider 边界由单测、配置解析和 mock/失败语义验证。
- 不保存完整 Prompt 或模型响应，只保存计费归因、usage、状态、错误摘要和安全响应摘要。
