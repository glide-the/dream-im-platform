# Admin Notion Connector 数据域迁移执行稿

> 状态：实施中<br>
> 日期：2026-09-16<br>
> 所属项目：Admin 提供数据能力，Dream 消费数据接口并保留业务编排、Notion CLI、共享文件系统与 Agent Runtime。

## Optimized Prompt

You are the implementation owner for the Admin/Dream Notion connector data-domain migration.

Move every production PostgreSQL operation for `resource_connectors`, `connector_resources`, `connector_resource_pages`, `connector_snapshots`, and `connector_chat_threads` from Dream into Admin. Admin must expose named business operations through strict Zod DTOs, an authorization-aware domain service, and typed Drizzle repositories. Dream must consume the matching strict Pydantic DTOs through its existing `AdminDataClient`; it must not retain SQL, a PostgreSQL pool, transaction emulation, runtime DDL, or a database fallback for this domain.

Use the existing Admin Drizzle definitions and the published `dream.schema.unified.v1` capability. Do not create a migration when no schema change is required. Send canonical user IDs across HTTP as positive decimal strings so JavaScript cannot truncate PostgreSQL bigint values. OAuth and delegated Runtime calls must derive the actor from Admin credentials. Scheduled synchronization operations must require the configured service background scope, identify a connector by its server-owned connector ID, and derive the owner from stored data; they must not accept an arbitrary user ID.

Keep `replace connector resources` as one Admin transaction. Keep `save snapshot` as one Admin transaction covering snapshot upsert, connector current-version update, exact resource status updates, and database-page replacement. Every non-idempotent write must use the existing request receipt mechanism so an unknown HTTP result can be recovered without blind retry. Return stable domain errors for missing ownership, invalid canonical snapshot metadata, conflicts, and unavailable capabilities.

Preserve Dream behavior: Notion login/poll orchestration, remote discovery, synchronization policy evaluation, Notion CLI credential files, shared snapshot publication, per-thread materialization, Agent Runtime integration, and background failure isolation stay in Dream. Admin stores structured state only and never receives credential file paths or executes Notion/Agent operations. If Admin is unavailable, Dream returns or records the existing bounded business failure and never reconnects to PostgreSQL.

Implement and verify the Admin provider before switching Dream consumers. Add provider-free DTO/service/handler tests, Drizzle repository contract tests where available, Dream client/adapter tests, router/facade/scheduler regressions, capability/hash parity, typecheck, lint, Python compilation, and the production database-access closure scan. Update affected folder contracts and file headers.

Acceptance requires: all Notion production paths use Admin operations; no Notion module imports Dream `database`, `psycopg`, `persistence.postgres`, or owns a connection pool; actor and background authorization are separated; the two compound writes remain atomic; receipt recovery is tested; shared filesystem and Runtime semantics remain unchanged; and the final scan records the removed database entries.

USER REQUIREMENT:

Migrate the Dream Notion connector database access to Admin according to strict DTO/ORM design while preserving Dream business execution and shared filesystem behavior.

## 本轮目标与证据

- Admin Drizzle 已定义五张目标表，migration `0032_dream_schema_authority_cutover.sql` 已由 `dream.schema.unified.v1` 发布，当前不需要 DDL。
- Dream `backend/notion/store.py` 仍创建 PostgreSQL pool，并由 OAuth 路由、后台同步与 Agent turn 共同调用。
- `replace_connector_resources` 和 `save_snapshot` 是现有复合事务，迁移后必须各自对应一个 Admin 业务操作。
- Admin 已有 `AdminDataClient`、operation registry、服务认证、OAuth/委托身份解析、typed Drizzle transaction 与 receipt recovery，优先复用。

## 责任、依赖与影响范围

| 责任 | 项目 | 依赖 | 影响范围 |
| --- | --- | --- | --- |
| DTO、权限、Repository、事务、capability、receipt | Admin | 既有身份与 `dream.schema.unified.v1` | `app/lib/dream/**`、internal operation/receipt routes、契约测试 |
| HTTP consumer 与 Store 兼容层 | Dream | Admin operation catalog | `backend/services/admin_data/**`、`backend/notion/store.py` |
| OAuth 路由身份传递 | Dream | 当前 `AdminRequestActor` | `backend/routers/notion.py`、facade composition |
| 后台同步身份 | 两项目 | service background scope | scheduler candidate/read/write operations |
| Agent turn 数据读取 | Dream | server-persistence grant | turn persistence 与 Notion facade composition |

## 接口、事务与状态

- 用户操作不接收 `user_id`，Admin 从 OAuth 或 server-persistence grant 得到 canonical actor。
- 后台操作不接收 `user_id`，只接收 connector ID，Admin 从 connector 记录派生 owner；candidate 输出使用十进制字符串 user ID。
- connector create/list/get/patch/delete、auth state、resource list/delete/replace、snapshot current/get/list/save、thread attach/resolve 都是具名 DTO。
- 写操作由 receipt 绑定 service、subject、operation、request ID、输入摘要和委托实体 scope；网络结果未知时只查询 receipt。
- `replace resources` 在 connector owner row lock 后完成 delete/insert/config merge。
- `save snapshot` 在 connector owner row lock 后完成 metadata 校验、snapshot upsert、page replacement、resource status 与 current snapshot update。

## 保持不变的行为

- Notion 登录和轮询、远端 API、同步策略、失败分类与锁仍由 Dream 执行。
- Notion credential 与 snapshot 共享文件路径不传给 Admin。
- Agent thread workspace、`.notion` 投影、Claude Code 临时目录和 sandbox 规则不变。
- Admin 不执行 Notion CLI、SSE、Agent turn 或共享文件写入。

## 验收与风险

- Admin：focused tests、typecheck、lint、operation registry/hash、receipt recovery。
- Dream：Notion store/client/facade/router/scheduler/Agent focused tests、`py_compile`、数据库访问 closure scan。
- 风险：bigint 截断、后台 service 越权、复合事务被拆分、unknown commit 盲重试、JSON snapshot/config 形状漂移。分别通过 decimal-string DTO、connector 派生 owner、单操作事务、receipt recovery、双端严格 DTO 关闭。
