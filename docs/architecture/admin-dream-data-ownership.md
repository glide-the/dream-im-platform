<!-- [Input] Frozen canonical Drizzle catalog and actual explicit isolated ACL deployment runner. -->
<!-- [Output] Chosen minimum data ownership, physical locations, credential boundaries and evidence gaps. -->
<!-- [Pos] Concrete database ownership decision for the Admin takeover; no runtime DDL or physical-schema claim. -->
<!-- [Sync] 2026-09-15: retain original public business tables and prove isolation through explicit restricted ACL. -->
# Admin / Dream 数据区域方案

## 背景与问题

Admin、Gateway、Billing 与 Dream 使用同一 PostgreSQL。既有 users、Story、Deck、Thread 与账本有跨领域 FK，认证注册还依赖原 canonical 初始化事务。拆为不同 database 将失去 PostgreSQL 跨库 FK，需要身份复制或分布式补偿。整域 `ALTER TABLE SET SCHEMA dream` 可以保留OID，却需要同步所有固定schema SQL、function/trigger 引用、Drizzle catalog 与旧调用兼容名；新兼容视图仍需同样的表级授权，不能独立增强受限role边界。

## 目标与边界

当前采用同一 database 内独立身份schema与精确表级职责，保留原PK、历史正文、FK、价格/账本与事务。Better Auth 中心和数据服务均由 Admin 执行，使用不同明确凭证；Dream 不持有 PostgreSQL DSN，不允许连接数据库。没有已完成的整域physical dream schema迁移； schema名称与 env名称本身不是授权证据。

| 物理位置 | 数据归属 | 应用访问边界 |
| --- | --- | --- |
| `identity` | 唯一Better Auth协议13表、显式subject/admin映射、encrypted BFF、purpose-bound Runtime delegation | AUTH协议/BFF读写与受控注册函数；DATA仅必要映射/public JWKS/provider label读取及窄委托领域写；CONTROL仅明确bootstrap/RBAC/provision职责 |
| `public` Dream业务表 | 下列实际领域表；既有Story控制面表仍由Admin领域负责，Dream仅消费API | DATA角色领域读写，server DTO与owner/permission再次过滤；不会授予canonical/entitlement/账本/Provider控制表写权限 |
| `public` Admin/Gateway/Billing共享控制 | users/platform、Admin RBAC、model/Provider、Gateway请求与金钱/订阅/账本 | 明确共享投影及注册函数；旧Admin/Gateway实际credential进一步收缩与正常激活仍待完成 |
| `dream` | operation receipts与0060 immutable Preflight原请求关联 | DATA receipts写；request表仅SELECT/INSERT，UPDATE/DELETE/TRUNCATE由ACL与immutable trigger拒绝 |
| `drizzle` | 唯一DDL历史/迁移收据/独立capability | application仅capability读取，专用migrator拥有DDL；启动只检查不迁移 |

## 概念与规则

[实际ACL runner](../../drizzle/data/auth-access-policy.mjs)依冻结0056 catalog确定既有领域表集合，前向新增dream request单独声明。当前下列54张public领域表授予DATA `SELECT, INSERT, UPDATE, DELETE`；这表示同一Admin Dream领域服务的持久化职责，不能代替每个公开API的owner、严格DTO与事务审计。

- `public.agent_sessions`
- `public.analysis_reports`
- `public.chat_message`
- `public.chat_thread`
- `public.claude_plugin_installations`
- `public.claude_plugin_marketplace_entries`
- `public.claude_plugin_marketplace_entry_policies`
- `public.claude_plugin_marketplace_revisions`
- `public.claude_plugin_marketplace_sync_runs`
- `public.claude_plugin_marketplaces`
- `public.claude_plugin_operations`
- `public.connector_chat_threads`
- `public.connector_resource_pages`
- `public.connector_resources`
- `public.connector_snapshots`
- `public.daily_pictures`
- `public.deck_claude_plugin_refs`
- `public.deck_plugin_bindings`
- `public.deck_plugin_installations`
- `public.deck_plugin_releases`
- `public.deck_runtime_plugin_locks`
- `public.deck_runtime_snapshots`
- `public.deck_versions`
- `public.decks`
- `public.dream_mcp_credentials`
- `public.dream_mcp_discovery_snapshots`
- `public.dream_mcp_import_receipts`
- `public.dream_mcp_servers`
- `public.events`
- `public.friend_invites`
- `public.friendships`
- `public.reflection_result`
- `public.reflection_task`
- `public.reflection_task_event`
- `public.reflections_section_configs`
- `public.resource_connectors`
- `public.runtime_load_receipt_entries`
- `public.runtime_load_receipts`
- `public.runtime_plugin_materializations`
- `public.runtime_plugin_reconcile_attempts`
- `public.story_workspace_characters`
- `public.story_workspace_scene_characters`
- `public.story_workspace_scenes`
- `public.story_workspace_stories`
- `public.story_workspace_story_characters`
- `public.story_workspace_workspaces`
- `public.subscriptions`
- `public.user_preferences`
- `public.user_sessions`
- `public.voices`
- `public.workflow_preflights`
- `public.workflow_run_token_consumptions`
- `public.workflow_run_transitions`
- `public.workflow_runs`

额外明确投影为：`identity.subject_links` SELECT；`identity.jwks`仅id/publicKey/alg；`identity.account`仅userId/providerId；`public.users`仅id/email/display_name/avatar_url/role/status/created_at/updated_at；`platform_users`仅id/source/external_user_id/status/tier；`gateway_api_keys`仅id/service_client_id/subject_mode/status/revoked_at/expires_at/scopes。DATA不获users密码列、JWKS privateKey、OAuth account tokens、Provider密文或Gateway Key hash。`identity.runtime_delegations`和`dream.operation_receipts`由窄命名领域管理；`public.admin_audit_logs`仅INSERT；`public.system_settings` SELECT与`public.claude_agent_resource_snapshots`领域写用于明确policy/observer。原`user_model_permissions`不属于Dream表集，排除其DML；旧auth_sessions/oauth_accounts/refresh_tokens/device_authorizations同样不授予DATA。序列只授予已声明领域表所拥有的USAGE/SELECT。

AUTH仅identity协议/BFF读写、subject links与active canonical/platform/必要RBAC读取、Admin登录时间更新、audit append，并EXECUTE `identity.register_canonical_user(text,text,text)`；它不能直接插入users、订阅或账本。注册函数由前向0056发布，fixed pg_catalog search_path/qualified tables/明确旧关系与Free/default-model readiness在同一事务，PUBLIC EXECUTE撤销。CONTROL当前明确负责Admin bootstrap/RBAC与identity provision；普通Better Auth Session不得以邮箱、Google或同email自动提升Admin。

私有部署配置必须为0600且所有者匹配，明确实际database/port/datadir和四个不同role。隔离runner继续只接受具名可删除PG；正常库使用独立 `scripts/activate-unified-auth-data-access.mjs`，默认dry-run，只有 `--apply --production-approval`、停机备份SHA、完整migration/capability和目标身份全部匹配才整体事务激活。两者复用同一ACL planner，均拒superuser/createdb/createrole/replication/bypassRLS/继承membership/table或schema owner；正常Dream role额外是NOLOGIN。策略撤销PUBLIC database CONNECT/CREATE/TEMP与function EXECUTE；Dream没有CONNECT/schema/table/function权限，AUTH/DATA/CONTROL没有DDL。仅存在runner或capability回执不能冒称正常库已经激活。

协调已实际验证隔离dry/apply/repeat及16次角色权限尝试，受限AUTH/DATA的Thread14、Editor8、Deck19、refs6、Run5、Preferences2公开生产Route分别通过93/103/246/104/163/78断言；均为技术证据。[验证矩阵](../verification/admin-auth-data-provider-matrix.md)保留原失败与修复证据。新0060 immutable request capability/catalog已通过upgrade/repeat/concurrent/fresh/partial rollback；最新ACL3dry/apply/repeat通过，15次actual受限角色查询验证request SELECT+INSERT且禁止mutation/TRUNCATE/guard、AUTH/control隔离、user_model_permissions禁止I/U/D、private JWK禁止和Dream CONNECT拒绝。新增正常库发布runner也已在另一具名隔离PG通过缺批准拒绝、63 migrations/8 capabilities/active Gateway、dry/apply/repeat、credential与allow/deny probes。正常库实际激活、Google/账户与真实模型全业务验收仍未完成，不得据隔离结果宣称最终数据库访问隔离闭环。
