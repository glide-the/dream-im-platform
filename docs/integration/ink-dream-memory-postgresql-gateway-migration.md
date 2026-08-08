# ink-dream-memory PostgreSQL 与计费网关接入建议

## 适用范围

本文只给出 `/Users/dmeck/project/ink-dream-memory` 的后续修改建议。本次交付没有修改该项目的业务代码，也没有让管理后台读取其 SQLite 文件。

必须先明确一个事实：当前 `ink-dream-memory/backend/database.py` 仍以 `sqlite3`、`INK_DATABASE_PATH` 和 `backend/data/ink-and-memory.db` 为权威存储；因此在业务项目完成迁移前，`ink-admin-memory` 中的 PostgreSQL Story 数据不会自动等同于线上 SQLite 数据。禁止通过复制 `.db` 文件、双写无幂等保证或在管理后台恢复 SQLite 驱动来规避这一边界。

## 建议一：将业务数据迁入 PostgreSQL `ink-memory`

建议业务项目引入 PostgreSQL repository 层，将 HTTP 路由和领域服务从具体的 `sqlite3.Connection` 解耦。优先按依赖顺序迁移：

1. 身份：`users`、`user_sessions`、`auth_sessions`、`oauth_accounts`、`refresh_tokens`、`device_authorizations`；
2. Story：`story_workspace_workspaces`、`story_workspace_stories`、`story_workspace_characters`、`story_workspace_scenes`；
3. Story 关系：`story_workspace_story_characters`、`story_workspace_scene_characters`；
4. Agent：`chat_thread`、`chat_message`、`agent_sessions`；
5. Workflow/Deck：`decks`、`voices`、`workflow_preflights`、`workflow_runs`、运行快照、插件绑定和转换记录；
6. 事件与其他附属模块。

迁移注意点：

- SQLite `INTEGER PRIMARY KEY AUTOINCREMENT` 改为 PostgreSQL identity/bigint，外键类型必须统一；
- `BOOLEAN` 从 `0/1` 改为原生 boolean；
- JSON 文本列（如 `settings`、`content parts`、`metadata`）改为 `jsonb`，迁移前校验所有历史值；
- `DATETIME` 改为 `timestamptz`，按 UTC 解释旧值；
- SQLite `PRAGMA`、`INSERT OR IGNORE`、`?` 占位符、触发器语法和 `rowid` 行为必须逐一替换；
- append-only 表在 PostgreSQL 中使用拒绝 UPDATE/DELETE 的触发器和最小数据库权限；
- 先完成快照迁移与行数/外键/抽样哈希核对，再进行短暂停写、增量追平和切换；保留可回滚快照。

## 建议二：统一 Story 数据权威边界

管理后台当前以 PostgreSQL `story_workspaces`、`story_projects`、`story_characters`、`story_scenes`、`story_workflow_runs` 提供运营能力；它不是现有 SQLite 表的无损一对一映射。

业务迁移前应在以下方案中选择一个，推荐方案 A：

### A. 业务表权威，管理端使用稳定视图（推荐）

- 保留业务语义更完整的 `story_workspace_*`、`workflow_*` 表作为写入权威；
- 在 PostgreSQL 中创建 `admin_story_*` 视图，映射到管理端需要的统一字段；
- 管理后台的审核、归档等动作调用受审计的领域命令，不直接改写计数、工作流 provenance 或 append-only 记录；
- 删除动作默认改为归档，只有明确的运维清理流程才能硬删除。

### B. 管理端 Story 表成为新权威

- 为现有 SQLite 字段补齐兼容映射和数据转换；
- 修改 `ink-dream-memory` repository 使用管理端表；
- 在切换前补齐角色/场景多对多关系、审核备注、Agent Session、Workflow provenance 等当前管理端简化模型未覆盖的数据。

不要长期维持两组都可写的 Story 表。

## 建议三：让 Claude Agent 统一走计费网关

`ink-dream-memory` 已将以下变量白名单传入 Claude Agent SDK 子进程，无需在前端直连模型：

```dotenv
ANTHROPIC_BASE_URL=https://<ink-memory-admin-host>
ANTHROPIC_AUTH_TOKEN=gw_<后台一次性生成的网关密钥>
ANTHROPIC_MODEL=<后台启用的模型 code>
ANTHROPIC_DEFAULT_HAIKU_MODEL=<后台启用的模型 code>
ANTHROPIC_DEFAULT_SONNET_MODEL=<后台启用的模型 code>
ANTHROPIC_DEFAULT_OPUS_MODEL=<后台启用的模型 code>
```

管理端操作顺序：

1. 创建来源为 `ink-dream` 的平台用户，并把 `external_user_id` 绑定业务用户 ID；
2. 创建 Provider；官方 Anthropic 使用 `config.authMode=x-api-key`，只接受 Bearer 的 Claude 中转使用 `config.authMode=bearer`；
3. 创建并启用模型 code，发布有效定价；
4. 创建用户—模型权限，配置启停、RPM、日/月 Token 限额；
5. 充值后创建带 `messages:create`、`models:list` scope 的 Gateway Key；
6. 将明文 Key 交给 Secret Manager，只在创建响应中展示一次。

业务请求应携带稳定的 `Idempotency-Key`。如果 Claude Agent SDK 不能直接注入该头，建议在业务侧的网关适配器中以 `user_id + thread_id + turn_id` 生成；重试必须复用同一值。

## 建议四：用户同步与密钥隔离

- 业务注册/停用事件通过 outbox 或受签名的内部 API 同步到 `platform_users`，使用 `(source, external_user_id)` 保证幂等；
- 每个租户或用户使用独立 Gateway Key，禁止全平台共享一个可计费密钥；
- Provider 上游密钥只存在管理端加密列中，业务项目只持有 `gw_` Key；
- 不将 Provider 密钥、Gateway Key、Prompt 或完整模型响应写入普通日志；
- 当前本地 `backend/.env` 应视为敏感文件，任何已经暴露或进入版本历史的真实密钥都应立即轮换。

## 建议五：分阶段验收

1. PostgreSQL 空库迁移、SQLite 快照导入、行数和外键核对；
2. Story 列表、详情、审核、归档和工作流读取的双读对比；
3. 模型网关 mock 上游验证非流式、流式、取消、上游 4xx/5xx 和 usage 缺失；
4. 验证 Input/Output/Cache Read/Cache Write 四类 Token、价格快照、预授权、capture/release 和幂等；
5. 验证日/月限额、RPM、停用用户、停用模型、撤销 Key；
6. 灰度切换后监控 `settlement_failed`、余额透支、限流拒绝和 Provider 错误率；
7. 达到观察窗口后停止 SQLite 写入，归档只读快照，再移除 SQLite 运行时依赖。

## 不在本次管理后台代码中执行的改动

- 不修改 `ink-dream-memory/backend/database.py`；
- 不改写 Story Workspace、Deck、Claude Agent 或 Workflow 领域逻辑；
- 不复制、挂载或解析 `ink-and-memory.db`；
- 不自动替换业务项目的环境变量或真实凭据。

这些改动必须在 `ink-dream-memory` 单独立项，并以其完整测试集为发布门槛。
