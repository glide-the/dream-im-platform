# ink-dream-memory PostgreSQL 迁移方案

> 状态：后续实施的正式迁移方案  
> 返回：[总索引](README.md)  
> 前置：[源系统基线](01-current-scope-and-source-baseline.md) · [业务接入边界](02-business-integration-and-admin-boundary.md)  
> 配套：[发布、验证与回滚](05-release-rollout-and-rollback.md)  
> 主要读者：Dream 后端、DBA、QA、运维、安全审计

## 1. 迁移目标与硬约束

目标是让 Dream 运行时只连接 PostgreSQL `ink-memory`，不再把 SQLite、JSON 文件或内存数据库作为业务持久化回退。

硬约束：

1. Dream 源仓库和源 SQLite 在实施前只读盘点；生产迁移必须有独立审批、备份和操作回执。
2. 测试只允许明确隔离的 `TEST_DATABASE_URL` 或一次性 `ink-memory`；不得默认读取 `.env` 后写入未知/共享库。
3. 不长期双写 SQLite/PG。选择多次演练 + 最终短暂停写切换。
4. 不重新编号 `users.id` 或 TEXT 主键，不把既有 ID 改成 UUID。
5. 不用 Admin 旧 `story_*` 平行表填充 Dream canonical 表。
6. 不在迁移中接入计费、订阅、支付、推理服务或 Gateway。
7. 不把 Secret、password hash、OAuth/refresh token、Story/Chat 正文输出到控制台、回执或截图。

## 2. 目标技术方案

### 2.1 连接与迁移工具

建议 Dream 后续实现采用：

- 应用连接：`psycopg` 3 + `psycopg_pool.ConnectionPool`，同步 Repository 与当前大量同步领域代码更接近，避免同时引入异步重写。
- Schema 迁移：Alembic，使用独立版本表 `dream_alembic_version`；migration 只管理 Dream-owned 表。
- 数据搬迁：Dream 仓库中的显式 CLI，SQLite 端只读快照，PostgreSQL 端使用 staging + 批量参数化 INSERT/COPY。
- 行返回：`dict_row` 或显式 DTO，不向领域层泄露 `sqlite3.Row`/psycopg Row 差异。

建议依赖边界（版本需在实施时通过 Dream CI 再确认）：

```text
psycopg[binary,pool] >=3,<4
alembic >=1,<2
```

这是目标依赖建议，不代表 Dream 当前已安装。

### 2.2 配置合同

拟新增的运行配置：

```dotenv
DATABASE_URL=postgresql://<app-role>:<secret>@<host>:<port>/ink-memory
DATABASE_POOL_MIN_SIZE=2
DATABASE_POOL_MAX_SIZE=10
DATABASE_CONNECT_TIMEOUT_SECONDS=5
DATABASE_STATEMENT_TIMEOUT_MS=15000
```

- 生产 `DATABASE_URL` 只能来自 Secret Manager/部署 Secret，不提交到仓库。
- 应用启动必须执行 `SELECT current_database()` 并拒绝非预期数据库；测试迁移工具额外要求显式 `TEST_DATABASE_URL`。
- `INK_DATABASE_PATH` 在切换后只能由 `migrate_sqlite_to_postgres.py` 显式参数使用，不能成为应用 fallback。
- 不为本期增加 Gateway、Billing、Subscription 或 Payment 环境变量。

## 3. Schema 所有权与基线接管

目标数据库 `ink-memory` 的 `public` schema 当前同时容纳 Dream canonical 表和 Admin 控制面表。采用共库分领域所有权：

- Dream/Alembic：拥有所有 Dream canonical 业务表。
- Admin/Drizzle：拥有 `admin_*`、Provider/Model/Pricing、Storage 控制面、系统设置等 Admin 表。
- 两套 migration journal 相互独立，不允许任一 migration runner 扫描并重建另一领域表。

以上是目标逻辑所有权，不假设目标环境的 PostgreSQL physical owner/ACL 已符合该状态。每次实施前必须通过 `pg_class`、`pg_roles`、`information_schema.role_table_grants` 做只读盘点；涉及 `ALTER OWNER` 或 GRANT/REVOKE 的变更单独审批、前向迁移并验证，文档本身不授权执行。

Admin `0010_story_source_canonical.sql` 已创建 `users`、`story_workspace_workspaces`、`story_workspace_stories`。Dream 首个 Alembic baseline 必须：

1. 只读检查列类型、default、nullable、PK/FK/check/index、owner 和现有数据。
2. 与 Dream 当前 SQLite contract 及目标 PostgreSQL DDL 做结构 diff。
3. 完全兼容时写入“adopted baseline”版本，不重复建表。
4. 存在不兼容时停止发布并输出差异；通过新的、可回滚的前向 migration 修正，不能重写 Admin 历史迁移。
5. 所有权交接完成后，Admin migration 不再修改这些 Dream-owned 表。

## 4. 迁移波次与依赖顺序

每个波次必须同时包含 Schema、Repository、数据导入、API contract 和 PostgreSQL 集成测试，不能只建表后长期保留 SQLite 写入。

### Wave 0：迁移基础设施

- 新增 PostgreSQL pool、Unit of Work、错误映射和健康检查。
- 建立 Alembic baseline、migration version 检查和 CI 空库升级/降级验证。
- 建立只读 SQLite snapshot、manifest、staging、验证和回执工具。
- 为每个领域定义 Repository interface；生产仍用 SQLite，PG adapter 只在隔离测试/影子读取启用。

### Wave 1：身份与首批 canonical Story

依赖顺序：

1. `users`
2. `story_workspace_workspaces`
3. `story_workspace_stories`
4. `auth_sessions`、`oauth_accounts`、`refresh_tokens`、`device_authorizations`

前三表可复用现有 Admin 导入器的只读快照/fingerprint 思路，但 full migration CLI 必须由 Dream 项目拥有。认证 Token 字段按原值安全迁移，不进入日志；切换时强制验证 Session/refresh token 行为。

### Wave 2：Story 扩展闭包

依赖顺序：

1. `story_workspace_characters`
2. `story_workspace_scenes`
3. `story_workspace_story_characters`
4. `story_workspace_scene_characters`

关系表必须在两端父表通过后导入；复合 PK、同 Workspace 业务校验、story 可空和计数列均需验证。Wave 2 完成前 Admin Character/Scene 保持 503 fail-closed。

### Wave 3：用户内容、编辑会话与社交

建议顺序：

1. `user_preferences`、`user_sessions`、`analysis_reports`
2. `daily_pictures`
3. `friend_invites`、`friendships`
4. `chat_thread`、`chat_message`

`daily_pictures` 当前 base64 内容先按原 TEXT 无损迁移，避免把数据库切换和对象存储改造合并；后续若迁 Storage 应单独立项。Chat parts/metadata 在转换为 JSONB 前必须全量校验；无法解析的行进入隔离清单并阻断该波次。

### Wave 4：Deck、Plugin、Workflow 与 Agent

建议顺序：

1. `decks`、`voices`
2. `deck_plugin_releases`、`deck_plugin_installations`
3. `deck_runtime_plugin_locks`、`deck_plugin_bindings`、`deck_runtime_snapshots`
4. `workflow_preflights`
5. `runtime_plugin_materializations`、`runtime_plugin_reconcile_attempts`
6. `runtime_load_receipts`、`runtime_load_receipt_entries`
7. `workflow_runs`
8. `workflow_run_token_consumptions`、`workflow_run_transitions`
9. `agent_sessions`
10. `claude_plugin_installations`、`claude_plugin_operations`、`deck_claude_plugin_refs`

此波次依赖复杂 FK、幂等键、状态版本、append-only trigger 和事务锁，是最高风险波次。它仍只是持久化迁移；不得借机切换模型 Provider/Gateway 或增加推理计费。

### Wave 5：Reflection 与 Event

1. `reflections_section_configs`
2. `reflection_task`
3. `reflection_result`
4. `reflection_task_event`
5. `events`

Event/Task Event 的 sequence、幂等和 append-only 合同必须在 PostgreSQL trigger/权限与 service 双层验证。

### Wave 6：Notion Connector 独立库

依赖顺序：

1. `resource_connectors`
2. `connector_resources`
3. `connector_resource_pages`
4. `connector_snapshots`
5. `connector_chat_threads`

`backend/notion/store.py` 是独立 SQLite 边界；主库成功切换不代表它已迁移。Wave 6 完成后才能声称 Dream 运行时不再依赖 SQLite。

## 5. SQLite → PostgreSQL 类型映射

| SQLite 语义 | PostgreSQL 目标 | 迁移规则 |
|---|---|---|
| `INTEGER PRIMARY KEY AUTOINCREMENT` | `bigint GENERATED BY DEFAULT AS IDENTITY` | 导入保留原 ID；导入后把 sequence 调整到 max(id)，不重新编号 |
| TEXT 主键/外键 | `text` | 原样保存；不猜 UUID |
| `BOOLEAN` 0/1 | `boolean` | 仅接受 0/1/null；其他值阻断 |
| `DATETIME` 文本 | `timestamptz` | 有 offset 按 offset 转 UTC；无 offset 按经确认的源时区（当前约定应显式为 UTC）解析；invalid 阻断 |
| 保存 JSON 的 TEXT | `jsonb` 或保留 `text` | 只有经全量 parse/schema 验证且不参与原始字节 hash 的列才转 jsonb；opaque/hashes/provenance 保留 text |
| base64 图片 TEXT | `text`（首迁） | 先无损迁移；对象存储重构另立项目 |
| SQLite integer count/version | `integer`/`bigint` + check | 保留范围；负数或越界进入隔离清单 |
| nullable 空字符串 | 按字段合同 | 不全局把 `''` 转 NULL；逐列 manifest 决定 |

每列转换规则必须进入版本化 `migration-manifest.yaml`（建议文件名），禁止脚本根据值形态自行猜测。

## 6. SQL 与事务语义替换

| SQLite 用法 | PostgreSQL 替代 | 注意事项 |
|---|---|---|
| `?` 占位符 | psycopg `%s` 参数 | 禁止字符串拼接列值；动态列/排序使用白名单 |
| `INSERT OR IGNORE` | `INSERT ... ON CONFLICT (...) DO NOTHING` | 必须明确冲突键；不能用任意冲突吞错 |
| `INSERT OR REPLACE` | 领域化 INSERT/UPDATE + `ON CONFLICT` | SQLite REPLACE 可能先删除，不能机械翻译 |
| `last_insert_rowid()` | `RETURNING id` | 同一语句返回 |
| `CURRENT_TIMESTAMP`/`datetime('now')` | `now()` | 存 `timestamptz`，API 返回 ISO 8601 |
| `PRAGMA table_info` | `information_schema`/`pg_catalog` | 只用于 migration/schema inspection，不进入业务查询 |
| `BEGIN IMMEDIATE` | 短事务 + `SELECT ... FOR UPDATE`/advisory lock | 按聚合根锁定；设置 lock/statement timeout |
| `sqlite3.Row` | `dict_row`/DTO | 领域服务不依赖 driver-specific row |
| SQLite `RAISE(ABORT)` trigger | PL/pgSQL trigger + SQLSTATE | 映射为稳定领域冲突；不可变表同时限制 GRANT |
| `COLLATE NOCASE`/默认 LIKE | 明确 `lower()` 索引或 `ILIKE` | 上线前比较搜索和 unique 大小写语义 |

## 7. 源快照与迁移 Manifest

每次演练/生产迁移都生成唯一 `migration_run_id`，步骤如下：

1. 显式传入源 SQLite 绝对路径；拒绝 0-byte、符号链接异常和非预期文件名。
2. SQLite 以只读 URI/query-only 打开，执行 `quick_check`、`foreign_key_check`、table/index/trigger inventory。
3. 使用 SQLite Online Backup API 或原生 `.backup` 生成一致性快照；记录源文件 size、mtime 和 SHA-256，不输出业务行。
4. 对每张表生成：row count、PK count、主键排序摘要、nullable/enum/JSON/FK 异常计数。
5. 保存 manifest、工具版本、Git commit、目标 current_database/schema version；回执只含聚合和 digest。
6. 抽取到受限临时目录或直接流式进入 staging；临时文件权限最小化，验收后按审批清理。

现有 `scripts/import-ink-dream-story-source.mjs` 只可作为前三表提取/校验参考，不直接扩展成 Dream 全库生产运行器，因为其归属 Admin 且不了解其他 40 + 5 表业务事务。

## 8. Target staging、冲突和导入策略

建议在目标库使用受限 `dream_migration_stage` schema，所有 staging 行带 `migration_run_id`。运行时角色无该 schema 权限。

导入规则：

- 新表首次导入要求目标业务表为空；非空时默认失败，不执行 truncate/delete/覆盖。
- 已存在的 `users/workspaces/stories` 先导入 staging，再逐行/摘要对比目标：完全一致则 adopt；目标缺失可在审批事务中插入；任一同 PK/email 但字段不同即生成 conflict manifest 并停止。
- 如果差异来自 Admin 已审计的 canonical 写入，业务负责人必须决定先把合法变更纳入源快照还是批准显式 merge patch；通用脚本不得自动选源或目标。
- email/幂等键/复合 PK/unique 冲突分别统计；禁止只用 `ON CONFLICT DO UPDATE` 隐藏差异。
- FK 父表全部通过后才导入子表；每个波次单独事务/回执，失败回滚该波次，不回滚已验收历史事实。
- invalid JSON、时间、boolean、enum、orphan 进入隔离报告；生产切换不允许“跳过坏行继续”。
- staging 的清理是单独审批动作；文档和默认 CLI 不执行共享库 DROP/TRUNCATE/DELETE。

## 9. 只读验证 SQL 模板

以下模板只用于明确目标库的只读验证；执行前仍需确认连接归属。它们不返回密码、正文或 Secret。

```sql
SELECT current_database(), current_schema(), current_user;

SELECT 'users' AS table_name, count(*) AS row_count, count(DISTINCT id) AS pk_count
FROM users
UNION ALL
SELECT 'story_workspace_workspaces', count(*), count(DISTINCT id)
FROM story_workspace_workspaces
UNION ALL
SELECT 'story_workspace_stories', count(*), count(DISTINCT id)
FROM story_workspace_stories;

SELECT count(*) AS workspace_owner_orphans
FROM story_workspace_workspaces AS w
LEFT JOIN users AS u ON u.id = w.owner_id
WHERE u.id IS NULL;

SELECT count(*) AS story_fk_orphans
FROM story_workspace_stories AS s
LEFT JOIN users AS u ON u.id = s.author_id
LEFT JOIN story_workspace_workspaces AS w ON w.id = s.workspace_id
WHERE u.id IS NULL OR w.id IS NULL;

SELECT status, review_status, type, count(*)
FROM story_workspace_stories
GROUP BY status, review_status, type
ORDER BY status, review_status, type;
```

全量验证工具还必须覆盖所有 43 + 5 表的 count、PK/unique、FK orphan、check/enum、JSON parse、append-only trigger 和关键 API 结果；不能只以三表通过宣布全库完成。

## 10. Repository 切换策略

不采用长期双写。每个波次按以下顺序推进：

1. 为领域建立 Repository interface 和 SQLite adapter contract tests。
2. 实现 PostgreSQL adapter，使用同一组领域 contract tests。
3. 在隔离 PG 导入真实快照，运行 API/Service 回归。
4. 生产迁移前可做只读 shadow compare：主响应仍来自 SQLite，后台用 PG 执行同等只读查询并只记录摘要差异。
5. shadow 读取绝不执行 PG 写入，也不向用户返回两套结果。
6. 达到门禁后进入停写窗口，一次性切换该领域的全部读写；不让两个运行版本同时写同一聚合。

由于跨领域 FK 和同一 `database.py` 连接广泛共享，生产可以按多次波次发布，但每个波次必须有清晰的“谁写哪张表”矩阵。不能出现 SQLite 与 PG 同时写同一张逻辑表。

## 11. 最终切换窗口

1. 确认 Admin 对 Dream canonical 表的写入口也进入维护/只读，避免目标三表在快照后变化。
2. 停止 Dream scheduler、worker 和写 API；只读健康页继续可用。
3. 等待在途事务结束，记录 SQLite WAL/checkpoint 状态并制作最终只读快照。
4. 执行源校验、staging 导入、冲突检查、目标导入和全量验证。
5. 运行 Alembic head、Dream/Admin compatibility check 和数据库权限检查。
6. 部署 `DATABASE_URL` 版本；先运行不提交业务写的 smoke/transaction rollback 检查。
7. 验证认证、Story、Chat、Deck、Workflow、Plugin、Reflection、Notion（若已到 Wave 6）关键路径。
8. 解除维护并开启 PG 写入；SQLite 快照转为受控只读归档，应用不再连接。

## 12. 回滚边界

- **开放 PG 写入前**：停止新版本，恢复旧应用和最终 SQLite 快照；PG 导入数据保留供审计，不自动删除。
- **开放 PG 写入后但尚无业务写**：同上，须由数据库审计证明没有提交写事务。
- **已有 PG 业务写后**：不能简单切回旧 SQLite，否则会丢数据。默认优先前向修复；若业务要求可回 SQLite，必须在上线前实现并演练 PG→SQLite delta exporter、幂等/冲突合同和完整验证，否则该回滚路径视为不可用。
- 任何回滚都不执行共享 PG 的自动 DROP/TRUNCATE/DELETE；通过流量、应用版本和凭据切换恢复服务，保留证据。

## 13. 安全与可观察性

- DSN、password hash、OAuth/refresh token、Secret 和正文不进入日志/回执。
- 迁移日志使用 table、count、digest、duration、error code；行级 conflict 使用内部加密工件，不打印值。
- 每批次记录 migration_run_id、source fingerprint、target DB fingerprint、schema version、actor、开始/结束、结果和审批号。
- PostgreSQL 监控覆盖 pool wait、connection errors、lock wait、deadlock、statement timeout、transaction rollback、replication/backup 状态。
- 本期监控不增加 Billing、Subscription、Payment、Gateway 或推理指标。

## 14. 文件级实施清单

Dream 后续预计新增/调整：

- `backend/pyproject.toml`、lock/requirements：PG driver、pool、migration tool。
- `backend/config.py`、`.env.example`、`docker-compose.yml`、CI/deploy workflow：`DATABASE_URL` 与隔离测试配置。
- `backend/persistence/**`、`backend/repositories/**`：连接、事务、错误和领域 Repository。
- `backend/migrations/**`：baseline 与波次 migration。
- `backend/scripts/migrate_sqlite_to_postgres.py`、`verify_postgres_migration.py`：显式 CLI。
- `backend/database.py`：逐步变成兼容门面并最终移除 SQLite runtime。
- 所有直接声明 `sqlite3.Connection` 或调用 `database.get_db()` 的 Router/Service/Tool。
- `backend/notion/store.py`：独立 Wave 6。
- `backend/tests/**`：Repository contract、PG integration、migration rehearsal、API/领域并发回归。

## 15. PostgreSQL 迁移验收

- 空库可从 baseline 升到 head；已存在 canonical 三表可安全 adopt 或明确 fail，无隐式重建。
- 43 + 5 表均有 manifest、DDL、Repository、数据导入和验证归属。
- 源/目标行数、PK digest、unique、FK、enum/check、JSON 和业务抽样一致。
- append-only、状态版本、幂等和锁语义在 PG 下通过并发测试。
- Dream 全测试、前端测试和关键 E2E 使用隔离 PostgreSQL 通过。
- 运行时不再打开主 SQLite 或 Notion SQLite；`INK_DATABASE_PATH` 只存在于迁移 CLI。
- Admin 仍读取同一 canonical 表，旧平行 Story 表未被重新启用。
- 未新增计费、订阅、支付、推理服务或 Gateway 接入。
