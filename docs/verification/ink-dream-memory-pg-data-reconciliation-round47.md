# Ink Dream Memory PostgreSQL 旧数据对账回执（Round 47）

状态：`Verified`  
复核日期：2026-08-09  
范围：Dream 主库 43 表 + Notion Connector 5 表 → 本机专用 PostgreSQL `ink-memory`

## 结论

旧 SQLite 的 48 张表、4,921 条源记录已经全部存在于 PostgreSQL；逐主键集合比较的缺失数为 `0`。本轮没有再次执行写入式导入，因为 PostgreSQL 已经比 SQLite 更新：`user_sessions` 多 1 条迁移后新记录，`user_preferences` 有 1 条记录仅 `updated_at` 在源库停止变化后更新。用旧 SQLite 重灌会覆盖或冲突于较新的 PostgreSQL 事实，因此现有 importer 的冲突阻断行为是正确的。

“页面看起来没有旧数据”不是迁移缺失。产品 API 按当前 JWT 的 canonical `user_id` 隔离数据；28 个 canonical 用户中，旧 Session 只归属 3 个用户，旧 Chat Thread 只归属 15 个用户。使用另一个登录身份时，用户作用域页面会正确返回空集合，不能据此把其他用户的数据重新归属或合并。

## 数据源与目标身份

- 主源：`backend/data/ink-and-memory.db`，43 表、4,919 行、77,856,768 bytes。
- Notion 源：`backend/data/notion-connectors.db`，5 表、2 行、90,112 bytes。
- SQLite 快照方式：只读 SQLite Online Backup；主库 WAL 在复核时为 0 bytes。
- 主库快照 SHA-256：`519a7ed8124d43a338f136aff187a2d2e4691f864fcaa4cd062d5abb7001c97a`。
- Notion 快照 SHA-256：`5fd00f7805483d9fe81405065f1aff8cc10d9f8c58c6dc81285e02324ba1d6ed`。
- 48 表 manifest SHA-256：`827dd786d10594c52325ede4cd4dc08487e3cbea3297b55516523386f0d4893c`。
- 目标：`127.0.0.1:5433/ink-memory`；Dream 与 Admin 当前配置指向同一数据库。连接密码和完整 DSN 未进入回执。
- Dream Alembic head：`20260809_06`；Admin Drizzle migration journal：25 条。

本轮源 dry-run 回执：`runId=a74d6bcd-104f-4ae1-8833-656e4017d29c`，`status=validated`，48/48 表、4,921 行、64 项源 FK 检查通过。

## 48 表逐表结果

“exact”表示源/目标行数、PK digest 与归一化整行 digest 均相同。两个“PG newer”表的全部源 PK 也都在目标中，不存在源记录缺失。

| 表 | 来源 | SQLite 行数 | PG 行数 | 结果 |
|---|---:|---:|---:|---|
| `agent_sessions` | main | 0 | 0 | exact |
| `analysis_reports` | main | 6 | 6 | exact |
| `auth_sessions` | main | 0 | 0 | exact |
| `chat_message` | main | 2,355 | 2,355 | exact |
| `chat_thread` | main | 1,165 | 1,165 | exact |
| `claude_plugin_installations` | main | 4 | 4 | exact |
| `claude_plugin_operations` | main | 8 | 8 | exact |
| `daily_pictures` | main | 0 | 0 | exact |
| `deck_claude_plugin_refs` | main | 15 | 15 | exact |
| `deck_plugin_bindings` | main | 8 | 8 | exact |
| `deck_plugin_installations` | main | 4 | 4 | exact |
| `deck_plugin_releases` | main | 1 | 1 | exact |
| `deck_runtime_plugin_locks` | main | 1 | 1 | exact |
| `deck_runtime_snapshots` | main | 4 | 4 | exact |
| `decks` | main | 96 | 96 | exact |
| `device_authorizations` | main | 2 | 2 | exact |
| `events` | main | 0 | 0 | exact |
| `friend_invites` | main | 0 | 0 | exact |
| `friendships` | main | 0 | 0 | exact |
| `oauth_accounts` | main | 1 | 1 | exact |
| `reflection_result` | main | 85 | 85 | exact |
| `reflection_task` | main | 9 | 9 | exact |
| `reflection_task_event` | main | 10 | 10 | exact |
| `reflections_section_configs` | main | 0 | 0 | exact |
| `refresh_tokens` | main | 5 | 5 | exact |
| `runtime_load_receipt_entries` | main | 0 | 0 | exact |
| `runtime_load_receipts` | main | 0 | 0 | exact |
| `runtime_plugin_materializations` | main | 1 | 1 | exact |
| `runtime_plugin_reconcile_attempts` | main | 0 | 0 | exact |
| `story_workspace_characters` | main | 10 | 10 | exact |
| `story_workspace_scene_characters` | main | 30 | 30 | exact |
| `story_workspace_scenes` | main | 13 | 13 | exact |
| `story_workspace_stories` | main | 4 | 4 | exact |
| `story_workspace_story_characters` | main | 10 | 10 | exact |
| `story_workspace_workspaces` | main | 12 | 12 | exact |
| `user_preferences` | main | 22 | 22 | PG newer：源 PK 缺失 0；1 行仅 `updated_at` 更新 |
| `user_sessions` | main | 488 | 489 | PG newer：源 PK 缺失 0；PG 多 1 条新记录 |
| `users` | main | 28 | 28 | exact |
| `voices` | main | 443 | 443 | exact |
| `workflow_preflights` | main | 20 | 20 | exact |
| `workflow_run_token_consumptions` | main | 13 | 13 | exact |
| `workflow_run_transitions` | main | 26 | 26 | exact |
| `workflow_runs` | main | 20 | 20 | exact |
| `connector_chat_threads` | notion | 0 | 0 | exact |
| `connector_resource_pages` | notion | 0 | 0 | exact |
| `connector_resources` | notion | 1 | 1 | exact |
| `connector_snapshots` | notion | 0 | 0 | exact |
| `resource_connectors` | notion | 1 | 1 | exact |

汇总：46 表完全一致；2 表仅有 PostgreSQL cutover 后的新写入；4,921/4,921 个源 PK 均存在；源记录缺失 0。

## 运行时读取证明

使用与正式 `backend/server.py` 相同的 env-file 加载路径导入应用，再通过 `database.get_db()` 执行只读 Repository probe：

```text
runtime_database=ink-memory
runtime_alembic=20260809_06
users=28
sessions=489
session_owners=3
chat_threads=1165
chat_owners=15
workspaces=12
stories=4
voices=443
notion_connectors=1
```

该结果同时证明运行时读取的是 PostgreSQL 的迁移后状态，而非 488 条 Session 的旧 SQLite 快照。

随后以仓库虚拟环境真实启动 Uvicorn，日志进入 `Application startup complete`；`GET /api/health` 返回 200，未认证的 `GET /api/sessions` 返回预期 401。SIGINT 后 scheduler、Claude Agent factory 和应用正常关闭。

canonical 用户计费投影也保持完整：28 个 `users` 均存在 `source=ink-dream` 的内部 `platform_users` 兼容映射和一一对应 Billing Account，缺失数为 0；额外测试/管理映射不改变 canonical `users` 是唯一产品用户全集。

## “看不到数据”的处理判断

- `/api/sessions` 从 JWT 取得 `current_user["user_id"]`，Repository 使用 `WHERE user_id = %s`；该隔离符合产品权限边界。
- Session 所有者记录分布为 487、1、1；其余 25 个 canonical 用户没有 Session。
- Chat Thread 分布覆盖 15 个用户，其中主要所有者有 1,122 条；其余 13 个用户没有 Chat Thread。
- 不应自动把主要所有者的旧数据转移给当前登录用户。若需要跨账号合并，必须先明确源/目标账号并单独审计 OAuth identity、Workspace、Story、Session、Chat、Usage 和 Ledger 引用，再设计可回滚的领域迁移。

## 安全与清理

- 本轮所有数据库操作均为只读；没有执行 `DROP`、`TRUNCATE`、`DELETE`、upsert、fixture、owner/ACL 修改或旧数据覆盖。
- 因源 PK 缺失数为 0，没有创建补迁 clone，也没有对真实 `ink-memory` 执行 production importer。
- 未读取或输出正文、密码哈希、Token、用户邮箱、Gateway/Provider/Payment Secret 或完整 DSN。
- 复核结束后 8765 无监听；没有留下本轮测试数据库。
