# Dream 当前范围与源系统基线

> 文档状态：**Current / Release candidate**（审计源基线保留；实现状态已校准）
> 返回：[总索引](README.md)  
> 事实基线：[处理判断](../../verification/ink-dream-memory-pg-billing-gateway-treatment-decision.md)  
> 主要读者：产品、架构、Dream/Admin 后端、QA、安全

## 1. 当前事实与目标不得混写

| 领域 | Current implementation | Target / remaining release step | Release Gate |
|---|---|---|---|
| Dream 持久化 | **Implemented / Release candidate**：48/569/81/25 Alembic、baseline adopt、43+5 CLI/validator、main/Notion PG-only runtime 已在隔离 PG 验证 | 生产单一 PostgreSQL `ink-memory` | 真实源 rehearsal、owner/ACL 审批和短暂停写 cutover |
| canonical 用户 | **Implemented / Release candidate**：`users` 唯一真值、自动 mapping/account、服务端分页/搜索、Gateway canonical 反查与 QA-only 回归已验证 | 生产历史 orphan 安全映射/隔离 | 生产只读盘点与处置回执；无破坏财务历史 |
| Token Subscription / Token Ledger / 独立 Billing | **Implemented / Release candidate**：Admin `0000–0024`、Token-only 状态机/Allowance/Token Ledger、付费开通/续费、独立现金域与不可变 guard 已通过本机 PG、66 files/313 tests、tsc/lint/build 与订阅 Playwright 4/4 | 保持用户月度 Token/Token Ledger 与独立现金域解耦 | 生产数据审计、角色切换与灰度回执；角色矩阵已在 clone 通过 |
| Gateway | **Implemented / Release candidate**：Admin strict eligibility/settlement 与 Dream server-only client/canonical subject 已通过 focused/real-PG 合同 | 用户级真实 Provider canary | 生产服务身份/Secret 注入、外部 Provider 终态观测 |
| Dream 订阅 UX | **Implemented / Release candidate**：Product/Payment BFF 驱动真实月度 Token/周期/Usage/模型权限、八项 preview→execute 与付费开通/续费 | 预发布真实 Admin API 冒烟 | 无静态 fallback/假余额/假支付；订阅 Playwright 4/4 覆盖 1440×1000 与 390×844 |
| Payment/订阅支付 | **Implemented / Release candidate**：Adapter、Intent/event store、Webhook 幂等、Fake guard、refund/reversal、首次开通/付费月续费与 Dream UI | 真实渠道 **Deferred** | `0022–0024` 已应用；生产 Fake 禁用；真实表无测试数据 |
| ASR Gateway | endpoint 已 fail-closed 禁用；历史已提交 credential 的外部吊销/轮换未获所有者回执 | Gateway audio capability 仍 **Deferred** | credential owner 轮换/历史处置/scan；不得误报 ASR Gateway 已实现 |

## 2. 当前运行时数据源

| 数据存储 | Current 代码入口 | 当前连接方式 | 目标所有者 |
|---|---|---|---|
| Dream 主库 | `backend/database.py`、`backend/persistence/**`、Dream Alembic | `psycopg` pool；缺失/错误 head fail-fast，无 SQLite fallback | Dream |
| Notion Connector | `backend/notion/store.py` | PostgreSQL repository/UoW 与生命周期 pool；无文件数据库 fallback | Dream |
| Admin 控制面 | Admin `DATABASE_URL` | PostgreSQL Pool + Drizzle | Admin / Gateway |

历史两个 SQLite 仅由显式迁移 CLI 以只读 snapshot 输入使用；生产 FastAPI 启动路径不读取 `INK_DATABASE_PATH`/`INK_AGENT_NOTION_DB_PATH`。Dream 已具备 PostgreSQL driver/pool、独立 Alembic head、48 表 Manifest/DDL、staging/import/validator 与 PG-only runtime；真实生产数据搬迁仍需发布审批和最终 rehearsal。

## 3. 主库 43 表准确清单

| 领域 | 表 |
|---|---|
| 用户与认证（5） | `users`、`auth_sessions`、`oauth_accounts`、`refresh_tokens`、`device_authorizations` |
| 编辑会话/偏好/内容（4） | `user_sessions`、`user_preferences`、`analysis_reports`、`daily_pictures` |
| 社交（2） | `friendships`、`friend_invites` |
| Deck/Voice（2） | `decks`、`voices` |
| Chat（2） | `chat_thread`、`chat_message` |
| Story Workspace（6） | `story_workspace_workspaces`、`story_workspace_stories`、`story_workspace_characters`、`story_workspace_scenes`、`story_workspace_story_characters`、`story_workspace_scene_characters` |
| Workflow（4） | `workflow_preflights`、`workflow_runs`、`workflow_run_token_consumptions`、`workflow_run_transitions` |
| Deck Plugin/runtime（10） | `deck_plugin_releases`、`deck_runtime_plugin_locks`、`deck_plugin_installations`、`deck_plugin_bindings`、`deck_runtime_snapshots`、`runtime_plugin_materializations`、`runtime_plugin_reconcile_attempts`、`runtime_load_receipts`、`runtime_load_receipt_entries`、`agent_sessions` |
| Claude Plugin（3） | `claude_plugin_installations`、`claude_plugin_operations`、`deck_claude_plugin_refs` |
| Reflection（4） | `reflections_section_configs`、`reflection_task`、`reflection_result`、`reflection_task_event` |
| Event（1） | `events` |

Notion 独立库 5 表：`resource_connectors`、`connector_resources`、`connector_resource_pages`、`connector_snapshots`、`connector_chat_threads`。

PK、FK、unique、check/enum、JSON/time、partial unique 与 25 trigger 的逐表证据以 [处理判断第 3 节](../../verification/ink-dream-memory-pg-billing-gateway-treatment-decision.md#3-dream-435-真实-schema-清单) 为准。关键不可变事实包括 Workflow token/transition、runtime snapshot/receipt/entry/reconcile、Event、Agent binding；目标 PG 必须重建等价 trigger/constraint/permission，而不只是搬行。

## 4. 审计时 SQLite 耦合下界与当前处置

以下计数是实现前审计下界，保留用于证明迁移规模，不再描述当前生产运行时：

| 耦合 | Current 证据 |
|---|---:|
| `sqlite3.Connection` | 34 文件 / 115 处 |
| `database.get_db()`（含别名） | 16 文件 / 52 处 |
| PRAGMA | 3 文件 / 7 处 |
| `BEGIN IMMEDIATE` | 11 文件 / 22 处 |
| SQL string literal + `?` | 42 文件 / 436 literal / 1,425 placeholder |
| SQLite trigger | 源码 15 个生成/显式位置；真实库 25 个 trigger |

当前实现已将这些语义收敛到 PostgreSQL SQL、Repository/UoW、PL/pgSQL trigger 和领域冲突映射；runtime 静态边界扫描对 SQLite/PRAGMA/`BEGIN IMMEDIATE`/`?`/runtime DDL 为 0。SQLite 构造仅保留在 legacy schema/catalog、显式只读迁移 CLI 与测试兼容 fixture，不构成运行时 fallback。

## 5. Admin 三表导入器真实上限

`scripts/import-ink-dream-story-source.mjs` 与 `scripts/lib/story-source-import.mjs` 只处理：

- `users`
- `story_workspace_workspaces`
- `story_workspace_stories`

它已提供只读 snapshot/fingerprint、显式 `TEST_DATABASE_URL`、拒绝共享 runtime URL/端口、dry-run、目标非空阻断、serializable 单事务、count/PK/FK/部分 JSON/enum 与 sequence 校准等安全模式。但它只覆盖 3/48，且存在每表 64 MiB stdout、三表并发全量载入内存、逐行 insert、无 staging/batch/COPY、sequence 校准未再验证等上限。它不能冒充全量迁移器。

## 6. 推理调用面实现状态

| 入口 | 当前实现 | 剩余 Release Gate |
|---|---|---|
| `server.py`、Claude Agent/Chat/Dream/Workflow | server-only Gateway client、canonical-subject 服务认证和 canary/禁 direct-fallback 边界已实现 | 外部 Provider canary 与逐角色生产流量切换 |
| Product model catalog | Dream Product/Payment BFF 已实现；订阅页只消费 allowlisted alias/权限投影 | 真实预发布 Admin API/Session 冒烟 |
| `picture_service.py` 等 capability 特定媒体 | 未声明 capability 时不得伪报 Gateway 完成 | image capability/usage 合同后另行 canary |
| `/ws/speech-recognition` | fail-closed 禁用 | audio Gateway 仍 Deferred；credential owner 轮换回执仍开放 |

Dream 的 `dream_launch_gateway.py` 是 Story Workspace 启动协调器，不是 Admin 计费 Gateway；文件名不能作为“已接入”的证据。

## 7. 数据与 Secret 边界

- `.ink/*.json`、plugin manifest/receipt、workspace 文件可作为显式 artifact 存在，但不能作为数据库真值 fallback。
- SSE/EventBus/confirmation store 只可保存短生命周期协调状态；需恢复的业务事实必须进入 PostgreSQL。
- `system_config.env_vars` 不得接受 Provider/Gateway/Payment/System secret 名称或值；服务凭据只能来自服务端 secret provider。
- 历史 `backend/speech_recognition.py` 曾含已提交 Provider credential。当前 active runtime 已移除该值且 secret scan 通过；本文不复述该值。密钥所有者吊销/轮换与历史处置仍是 P0，代码修复不能替代外部轮换。

## 8. 本轮明确 Deferred

- `PaymentAdapter`、Payment intent/refund/reversal contract、Webhook event store/验签/幂等、Fake/Test Adapter，以及 Stripe、支付宝、微信、银行等真实第三方渠道和网络调用。
- 在 Gateway 尚无 streaming-audio capability、计量单位与结算合同前的 ASR Gateway 接入。

Token-only 月度 Plan/Subscription、Product/Payment BFF、真实订阅页和全入口 Gateway client 已进入 **Implemented / Release candidate**；真实外部 Provider canary 与生产 cutover 仍是 Release Gate。Provider Pricing 与现金 Billing/Ledger 是独立 Current 域。PaymentAdapter/Webhook/Fake 与付费开通/续费已实现；只有真实第三方支付渠道 Deferred。

## 9. 基线验收

- 43/43 主表、5/5 Notion 表、25 trigger 和 SQLite 耦合能由审计证据复核。
- Current、Implemented/Release candidate、Planned release step 与 Deferred 没有混写；实现代码与尚未执行的生产 cutover/外部 Provider canary 明确分开。
- `users` 是唯一用户全集，`platform_users` 只作内部映射；单 QA 用户结果被明确判为缺陷。
- P0 credential/ASR、owner/ACL 未授权和共享数据库安全边界可在一次阅读中找到。
