# Dream 当前范围与源系统基线

> 文档状态：**Current**  
> 返回：[总索引](README.md)  
> 事实基线：[处理判断](../../verification/ink-dream-memory-pg-billing-gateway-treatment-decision.md)  
> 主要读者：产品、架构、Dream/Admin 后端、QA、安全

## 1. 当前事实与目标不得混写

| 领域 | Current | Target / Planned | Release Gate |
|---|---|---|---|
| Dream 持久化 | 主库 SQLite 43 表；Notion SQLite 5 表；主库 25 trigger | 单一 PostgreSQL `ink-memory`、Dream Alembic、Repository/UoW | 48/48 DDL、Repository、导入、validator、owner 归属齐全；runtime SQLite open=0 |
| canonical 用户 | `users` 是业务用户真值；Admin 有内部 `platform_users`/account 投影 | 每个 canonical user 天然是订阅主体；内部投影不构成第二类用户 | 205 用户搜索/分页/total；Gateway 反向 JOIN `users`；无“计费用户”入口；orphan fail-closed |
| Token Subscription / 独立 Billing | Admin Plan/Allowance baseline 仍混入金额与 cash fallback；Provider Pricing/Billing/Ledger 已存在 | Subscription 固定用户月度 Token；独立现金域不作套餐权益/兜底 | Token 周期/守恒/幂等通过；新套餐金额写入为 0；历史账务 append-only |
| Gateway | Admin 有 Anthropic/OpenAI 兼容路由与部分结算；Dream 仍多路直连 | Dream server-only Gateway；stable model alias；严格资格顺序 | 401/402/403/409/429/502/503、流取消与 usage 缺失终态通过 |
| Dream 订阅 UX | `/story-workspace/subscription` 是静态三档数组 | 真实产品 API 驱动的月度 Token 计划/用户周期/Allowance/Usage/模型权限页面 | 无静态 fallback、金额/余额/支付或全局生效日期 |
| Payment/订阅支付 | 无 Adapter、intent/event store、Webhook 幂等实现 | **Deferred**：Adapter、Webhook、Fake 与真实渠道均不开发 | 本轮依赖、表、路由、环境变量和 UI 增量为 0 |
| ASR Gateway | 未鉴权 WebSocket 直连 Provider，且源码发现已提交 credential | endpoint 先禁用/加固；Gateway audio capability 仍 **Deferred** | credential 吊销/轮换、移除、secret scan；匿名请求被拒绝 |

## 2. 当前数据源

| 数据存储 | Current 代码入口 | 当前连接方式 | 目标所有者 |
|---|---|---|---|
| Dream 主库 | `backend/database.py` | `sqlite3.connect(DB_PATH)`、`INK_DATABASE_PATH`、WAL/FK PRAGMA | Dream |
| Notion Connector | `backend/notion/store.py` | 独立 `sqlite3.Connection` 与文件路径 | Dream |
| Admin 控制面 | Admin `DATABASE_URL` | PostgreSQL Pool + Drizzle | Admin / Gateway |

Dream 当前没有正式 PostgreSQL driver、pool、Dream Alembic 或 48 表迁移器。`backend/database.py` 同时承担建表、演进、seed/backfill、查询和事务；不能机械替换占位符完成迁移。

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

## 4. SQLite 耦合下界

排除 `.venv` 与 `backend/tests/**` 后，审计得到：

| 耦合 | Current 证据 |
|---|---:|
| `sqlite3.Connection` | 34 文件 / 115 处 |
| `database.get_db()`（含别名） | 16 文件 / 52 处 |
| PRAGMA | 3 文件 / 7 处 |
| `BEGIN IMMEDIATE` | 11 文件 / 22 处 |
| SQL string literal + `?` | 42 文件 / 436 literal / 1,425 placeholder |
| SQLite trigger | 源码 15 个生成/显式位置；真实库 25 个 trigger |

迁移必须处理 transaction lock、`INSERT OR REPLACE/IGNORE`、`last_insert_rowid()`、`datetime('now')`、driver row、LIKE/collation 和 SQLite trigger，不允许长期 SQL 翻译层。

## 5. Admin 三表导入器真实上限

`scripts/import-ink-dream-story-source.mjs` 与 `scripts/lib/story-source-import.mjs` 只处理：

- `users`
- `story_workspace_workspaces`
- `story_workspace_stories`

它已提供只读 snapshot/fingerprint、显式 `TEST_DATABASE_URL`、拒绝共享 runtime URL/端口、dry-run、目标非空阻断、serializable 单事务、count/PK/FK/部分 JSON/enum 与 sequence 校准等安全模式。但它只覆盖 3/48，且存在每表 64 MiB stdout、三表并发全量载入内存、逐行 insert、无 staging/batch/COPY、sequence 校准未再验证等上限。它不能冒充全量迁移器。

## 6. 当前推理调用面

| Current 入口 | 真实行为 | Planned 接管点 |
|---|---|---|
| `server.py`、`stateless_analyzer.py` | `PolyAgent` 直接使用 Dream endpoint/key/model 配置 | server-only Gateway client + role→stable alias |
| Claude Agent / Chat | 前端可提交模型字段，后端 runner/SDK 直达旧执行面 | 在单一 runner 网络边界接管，保留 SSE/tool/thread/resume |
| Dream/Workflow/Guidance/Reflection | 复用 `ClaudeAgentRunRequest` 与 thread factory | 同一 Gateway 接管，避免不同业务行为分叉 |
| `picture_service.py` | image endpoint/key/model 直连 | Gateway 有 image capability/usage 合同后 canary 切换 |
| `ModelConfigSection.tsx` | 静态 Auto/Claude/GPT 选项 | 只渲染产品 API 返回的可用 alias |
| `/ws/speech-recognition` | 未鉴权直连 ASR Provider | release 前禁用/加固；audio Gateway 仍 Deferred |

Dream 的 `dream_launch_gateway.py` 是 Story Workspace 启动协调器，不是 Admin 计费 Gateway；文件名不能作为“已接入”的证据。

## 7. 数据与 Secret 边界

- `.ink/*.json`、plugin manifest/receipt、workspace 文件可作为显式 artifact 存在，但不能作为数据库真值 fallback。
- SSE/EventBus/confirmation store 只可保存短生命周期协调状态；需恢复的业务事实必须进入 PostgreSQL。
- `system_config.env_vars` 不得接受 Provider/Gateway/Payment/System secret 名称或值；服务凭据只能来自服务端 secret provider。
- 受版本控制的 `backend/speech_recognition.py` 含已提交 Provider credential。本文不复述该值；吊销/轮换、移除、历史处置与 secret scan 是 P0，不得以“改成环境变量”替代密钥轮换。

## 8. 本轮明确 Deferred

- 真实 Stripe、支付宝、微信、银行等第三方支付 Adapter 与网络调用。
- 在 Gateway 尚无 streaming-audio capability、计量单位与结算合同前的 ASR Gateway 接入。

Plan/Subscription/Billing、Dream 产品 API、文本/受支持媒体 Gateway、Payment Adapter/Webhook 边界均是 Planned，不得再写成 Deferred。

## 9. 基线验收

- 43/43 主表、5/5 Notion 表、25 trigger 和 SQLite 耦合能由审计证据复核。
- Current、Planned、Implemented、Deferred 没有混写；静态订阅页与直接推理调用未被误报为完成。
- `users` 是唯一用户全集，`platform_users` 只作内部映射；单 QA 用户结果被明确判为缺陷。
- P0 credential/ASR、owner/ACL 未授权和共享数据库安全边界可在一次阅读中找到。
