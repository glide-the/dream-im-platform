# Dream 当前范围与源系统基线

> 状态：当前事实与范围基线  
> 返回：[总索引](README.md)  
> 主要读者：产品、架构、Dream 后端、QA

## 1. 本期目标

本期只为 Dream 后续实施以下工作建立基线：

1. 把 SQLite 持久化调用从 Router/Service 中解耦为 Repository 边界。
2. 在 PostgreSQL `ink-memory` 中建立或接管 Dream canonical Schema。
3. 迁移真实数据并验证业务语义、主外键、状态机和不可变事实。
4. 将 Dream 后端运行时切换为 PostgreSQL，并保持现有页面/API 行为。
5. 让 Admin 继续从同库真实原名表进行受控运营，不回退旧平行表。

计费、订阅、订阅支付、推理服务和 Gateway 明确不在本期；详细边界见 [延期领域](90-deferred-billing-subscription-inference-payment.md)。

## 2. 当前持久化事实

| 数据存储 | 代码入口 | 当前连接方式 | 当前角色 |
|---|---|---|---|
| Dream 主库 | `backend/database.py` | `sqlite3.connect(DB_PATH)`；`INK_DATABASE_PATH`；WAL + FK PRAGMA | 用户、认证、Story、Chat、Deck、Workflow、Plugin、Reflection 等主数据 |
| Notion Connector 库 | `backend/notion/store.py` | 独立 `sqlite3.Connection` | Connector、资源页、快照和关联会话 |
| Admin 数据库 | Admin `DATABASE_URL` | PostgreSQL Pool + Drizzle | Admin 控制面和已迁入的 Dream canonical 三表 |

当前不存在 Dream PostgreSQL repository、连接池或正式 migration runner；`backend/pyproject.toml` 也未声明 PostgreSQL driver。`backend/database.py` 同时承担 Schema 初始化、演进、查询、事务和 seed，不能通过简单把 `?` 替换为 `%s` 完成迁移。

## 3. 主库 43 表领域分组

| 领域 | 当前表 |
|---|---|
| 用户与认证 | `users`、`auth_sessions`、`oauth_accounts`、`refresh_tokens`、`device_authorizations` |
| 编辑会话与偏好 | `user_sessions`、`user_preferences`、`analysis_reports`、`daily_pictures` |
| 社交 | `friendships`、`friend_invites` |
| Deck 与 Voice | `decks`、`voices` |
| Chat | `chat_thread`、`chat_message` |
| Story Workspace | `story_workspace_workspaces`、`story_workspace_stories`、`story_workspace_characters`、`story_workspace_scenes`、`story_workspace_story_characters`、`story_workspace_scene_characters` |
| Workflow | `workflow_preflights`、`workflow_runs`、`workflow_run_token_consumptions`、`workflow_run_transitions` |
| Deck Plugin/runtime | `deck_plugin_releases`、`deck_runtime_plugin_locks`、`deck_plugin_installations`、`deck_plugin_bindings`、`deck_runtime_snapshots` |
| Runtime materialization | `runtime_plugin_materializations`、`runtime_plugin_reconcile_attempts`、`runtime_load_receipts`、`runtime_load_receipt_entries` |
| Agent Session | `agent_sessions` |
| Claude Plugin | `claude_plugin_installations`、`claude_plugin_operations`、`deck_claude_plugin_refs` |
| Reflection | `reflections_section_configs`、`reflection_task`、`reflection_result`、`reflection_task_event` |
| 事件 | `events` |

Notion 独立库另有：`resource_connectors`、`connector_resources`、`connector_resource_pages`、`connector_snapshots`、`connector_chat_threads`。

## 4. 已确认 canonical Story 结构

| 表 | 关键关系与语义 |
|---|---|
| `users` | INTEGER PK、email unique；是唯一业务用户集合；`role` 不是 Admin RBAC |
| `story_workspace_workspaces` | TEXT PK；`owner_id → users.id`；`settings` 当前为 JSON 文本 |
| `story_workspace_stories` | TEXT PK；`author_id → users.id`；`workspace_id → workspaces.id`；status/review/type 有真实枚举 |
| `story_workspace_characters` | Workspace 级角色；author/workspace FK；通过关系表复用于多个 Story |
| `story_workspace_scenes` | `story_id` 可空；author/workspace FK；存在 order/review/status |
| `story_workspace_story_characters` | `(story_id, character_id)` 复合 PK；包含 `role_type` |
| `story_workspace_scene_characters` | `(scene_id, character_id)` 复合 PK |
| `workflow_runs` 及附属表 | 保存不可变 provenance、状态版本、幂等、transition 与 Token consumption；不是通用 CRUD |

详细字段、枚举和只读源数据证据继续参考 [业务数据接入审计](../../verification/ink-dream-memory-data-integration-audit.md)，但该审计后半部分的订阅/Gateway 历史目标不属于本期。

## 5. 代码耦合基线

以下事实决定必须分域迁移，而不能“一次替换连接对象”：
- 大量 Router/Service 直接 import `database`、调用 `get_db()` 或声明 `sqlite3.Connection`。
- 多处依赖 `row_factory=sqlite3.Row`、`BEGIN IMMEDIATE`、`PRAGMA`、`INSERT OR REPLACE/IGNORE`、`datetime('now')`、`?` 占位符和 SQLite trigger 语法。
- `database.py` 的初始化会执行 seed/backfill，部分操作与进程启动绑定。
- Workflow、Event、runtime receipt、agent session 等表依赖 append-only trigger、状态版本和事务锁，必须逐项在 PostgreSQL 重建语义。
- 测试大量使用 SQLite 内存库或临时文件，迁移完成前需要双测试合同，切换后持久化集成测试必须改用隔离 PostgreSQL。

## 6. 目标数据所有权

| 领域 | 目标所有者 | 本期动作 |
|---|---|---|
| Dream canonical 业务表 | Dream 项目 | 迁移 Schema/数据、实现 PostgreSQL Repository、保持 API 行为 |
| Admin 控制面表 | Admin 项目 | 继续独立迁移；不得由 Dream migration 修改 |
| Admin 对 Dream 数据的运营访问 | Admin Story Source service | 同库受控 SELECT/白名单 UPDATE/命令；无通用硬删 |
| 计费、订阅、Gateway、Provider、Pricing | Admin 既有控制面 | 本期不接入 Dream，不作为 Dream 页面或 API 依赖 |

## 7. 本期非目标

- 不新增 `/v1/billing/**`、套餐或支付接口。
- 不给 Dream 配置 Gateway Base URL、Gateway Key 或计费模型 alias。
- 不新增 Usage、余额、额度、账单、充值、发票页面。
- 不替换或重构现有 Claude Agent 的上游模型调用路径。
- 不把 Admin `platform_users` 暴露为第二类业务用户。
- 不长期双写 SQLite 与 PostgreSQL，不保留 SQLite 运行时 fallback。
- 不在未知或共享数据库执行迁移、清空、覆盖或测试 fixture。

## 8. 基线验收

- 后续实施前重新生成 43 + 5 表清单、SQLite `foreign_key_check`、行数和枚举分布；任何差异更新迁移 manifest。
- 每个计划迁移的查询/写入点都能归属到明确 Repository，而不是保留通用 SQLite 兼容代理。
- 产品、前后端和 QA 对“现有推理行为保留，但不开发新推理服务”理解一致。
- 本文所有“当前事实”均可由 Dream 只读代码或现有审计定位，不依赖共享数据库假设。
