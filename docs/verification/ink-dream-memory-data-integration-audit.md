# Ink Dream Memory 业务数据接入审计

> 审计日期：2026-08-08  
> Admin 项目：`/Users/dmeck/project/ink-admin-memory`  
> 业务源项目（只读）：`/Users/dmeck/project/ink-dream-memory`

## 1. 执行结论

当前 Admin 看不到 `ink-dream-memory` 的业务表，不是 PostgreSQL schema search path 或数据库名拼写导致，而是两个项目根本没有使用同一种持久化实现：

- `ink-admin-memory` 通过 `app/lib/db.ts` 的 `pg.Pool` 读取 `DATABASE_URL`，Drizzle 配置也固定为 `dialect: "postgresql"`。
- `ink-dream-memory` 的实际运行代码 `backend/database.py:34-46, 121-132` 通过 Python 标准库 `sqlite3` 打开 `INK_DATABASE_PATH`，默认文件为 `backend/data/ink-and-memory.db`。其任务文档 `docs/task/task_201_backend_story-workspace-schema.md:20-27` 也明确写明“项目使用 SQLite（非 PostgreSQL）”。业务源环境模板不存在 `DATABASE_URL` 或 PostgreSQL 配置。
- Admin 迁移 `drizzle/0006_smart_hedge_knight.sql` 独立创建了 `story_workspaces`、`story_projects`、`story_characters`、`story_scenes`、`story_workflow_runs`，并把它们连接到 Admin 的 `platform_users`。这些表名、字段、主外键、枚举和业务规则均没有对齐业务源的真实表。

因此，现状同时包含两个问题：Admin 连接的是自己的 PostgreSQL 控制面数据库，且又在这个数据库里重新建立了一套语义重复、结构不兼容的 Story 表。即使两个项目使用同一个数据库名字符串，也不可能让 PostgreSQL 自动看见 SQLite 文件中的表。

用户要求“业务源不修改、Admin 不引入 SQLite、最终只用 PostgreSQL”与业务源当前“真实数据只在 SQLite”之间存在客观前提冲突。可实施且不伪造数据的目标架构是：

1. Admin 立即停止读取和写入错误的 `story_*` 平行表，但不删除旧表。
2. Admin 只有一个 PostgreSQL 数据源 `DATABASE_URL`、一个连接池和一个数据库 `ink-memory`；Story repository 复用该连接池并按业务源真实表名查询。
3. 用户已明确授权 Admin 项目主动只读访问源数据库并提供受控的一次性迁移。Admin 运行时仍不连接 SQLite；迁移 CLI 只使用系统原生 `sqlite3 -readonly` 生成一致性快照，再把 canonical 原名表写入明确目标 PostgreSQL `ink-memory`。这不是第二运行数据源、复制同步服务或回退。
4. 第一批迁移范围固定为 `users`、`story_workspace_workspaces`、`story_workspace_stories`；其他 Character/Scene/Workflow 表继续按缺表 503 fail-closed。在已迁表具备之前不得读取 Admin 平行表或假数据；其他控制面模块保持可用。

## 2. 工作区与证据边界

### 2.1 Git 状态

- `ink-admin-memory`：`main...origin/main`，审计开始时工作区干净。
- `ink-dream-memory`：`story-workspace...origin/story-workspace`，存在未跟踪目录 `.claude/worktrees/`。本次审计未进入、修改或清理该目录，也未修改业务源任何文件。

### 2.2 数据安全

- 已以 `/usr/bin/sqlite3 -readonly` 和 `PRAGMA query_only=ON` 访问实际源文件 `backend/data/ink-and-memory.db`；没有连接两个 0-byte 候选文件，也未把任何邮箱、password hash、Story content 或 Secret 输出到报告。
- 源数据库只执行 schema、计数、枚举分布、JSON/FK/orphan 检查；未执行 INSERT/UPDATE/DELETE/DDL/PRAGMA 写操作，未修改业务源代码或 Storage。
- 共享 `localhost:5433/ink-memory` 只做进程归属检查，没有迁移、seed、清空或写入。后续同步与写验收只允许一次性 PostgreSQL。

## 3. 数据连接审计

| 项目 | 实际连接实现 | 配置入口 | 当前数据形态 | 判断 |
|---|---|---|---|---|
| ink-admin-memory | `pg.Pool` + Drizzle PostgreSQL | `DATABASE_URL`，`drizzle.config.ts` | PostgreSQL，目标库名规范为 `ink-memory` | Admin 控制面数据库 |
| ink-dream-memory | `sqlite3.connect(DB_PATH)` | `INK_DATABASE_PATH`，默认 `backend/data/ink-and-memory.db` | SQLite 文件 | 当前真实业务数据源 |
| 统一 Story/控制面数据源 | 当前 Admin 已有 `DATABASE_URL` | `DATABASE_URL` | PostgreSQL，库名 `ink-memory` | 唯一 Admin 业务与控制面读写入口 |

### 3.1 真实源文件与首批数据证据

权威源由 `backend/database.py` 的 `_DEFAULT_DB_PATH` 和 `INK_DATABASE_PATH` 解析确定为 `/Users/dmeck/project/ink-dream-memory/backend/data/ink-and-memory.db`（约 74 MB）；`backend/data/ink-memory.db` 与 `backend/data/ink_dream.db` 均为 0 byte，不是数据源。

| 表 | 行数 | 主键/唯一 | nullable/JSON | 外键证据 |
|---|---:|---|---|---|
| `users` | 28 | 28 个不同 ID，28 个不同 email；ID 1–29 | created/updated 均非空；password_hash 不抽样/不输出 | 作为 owner/author 父表 |
| `story_workspace_workspaces` | 12 | 12 个不同 text ID | owner 非空；settings 无 invalid JSON；时间非空 | owner → users orphan=0 |
| `story_workspace_stories` | 4 | 4 个不同 text ID；4 个不同 identifier | author/workspace/时间均非空 | author → users=0、workspace → workspaces=0、author/owner mismatch=0 |

Story 枚举实值：status 为 draft 3/published 1；review_status 为 pending 3/confirmed 1；type 为 long 1/outline 2/script 1；agent_generated 全部为 1。全库 `pragma_foreign_key_check` 结果为 0。

不得增加 `STORY_DATABASE_URL`，也不能在 Admin 安装 `better-sqlite3`、SQLite fixture、JSON/内存回退。真实业务表和 Admin 控制面表必须位于同一个 `DATABASE_URL` 指向的 `ink-memory`，由一个 `pg.Pool` 访问；repository 分层只表达领域边界，不表达物理数据源边界。

## 4. 实体与表映射

| 业务实体 | ink-dream-memory 真实表 | 当前 Admin 表/Resource | 是否重复 | 最终数据源 | 读写策略 | 需要修改的代码 |
|---|---|---|---|---|---|---|
| 业务用户 | `users`（`id INTEGER`、email、display_name、avatar_url、role、created/updated） | `platform_users` / `platform-users` | 部分重复。`platform_users` 可作为计费身份映射，但不能代替业务用户主数据 | Story PostgreSQL 的 `users`；控制面保留 `platform_users(source, external_user_id)` 交叉引用 | 业务字段只读；状态/套餐/Token 限额只写控制面；不得修改源 password_hash | 新建 source-user repository；用户页组合源用户与计费身份；禁止独立创建“业务用户” |
| 工作区 | `story_workspace_workspaces`（owner_id、name、settings） | `story_workspaces` / `story-workspaces` | 是 | Story PostgreSQL | 列表/详情；仅允许受控更新 name/settings；不允许任意创建或删除 | 停止 `resources.ts` 与 `mutations.ts` 对 `story_workspaces` 的 SQL；映射真实表 |
| 剧本/故事 | `story_workspace_stories`（identifier、title、description、type、content、author_id、workspace_id、review_status、agent_session_id 等） | `story_projects` / `story-projects` | 是，且字段语义错误 | Story PostgreSQL | Agent/业务流程负责创建；Admin 可编辑源 API 已允许字段，执行 confirm/reject/archive；禁止硬删除 | Resource 改名/兼容别名为 stories；实现真实 repository/service；移除 create/delete UI |
| 角色 | `story_workspace_characters`（全局 workspace 角色，经过关联表连接 Story） | `story_characters`（错误地直接 `project_id` FK） | 是，关系模型错误 | Story PostgreSQL | 编辑源契约字段、confirm/reject/archive；禁止创建/硬删除 | 映射真实表和 `story_workspace_story_characters`；修正列表、详情与层级导航 |
| 场景 | `story_workspace_scenes`（`story_id` 可空、author/workspace、order_index、review fields） | `story_scenes`（`project_id` 必填、content/word_count） | 是，字段和可空性错误 | Story PostgreSQL | 编辑 name/description/story_id/order_index 与审阅动作；禁止创建/硬删除；变更 story_id 前校验同 owner/workspace | 映射真实表和源外键；删除虚构 content/word_count CRUD |
| Story-角色关系 | `story_workspace_story_characters`，复合 PK `(story_id, character_id)` | 无；Admin 把角色错误建模为 project 子项 | 缺失且被错误替代 | Story PostgreSQL | 详情读取；关系调整必须事务校验同 workspace/owner 并维护计数 | 新增关系查询；角色页按关联表跳转 |
| 场景-角色关系 | `story_workspace_scene_characters`，复合 PK `(scene_id, character_id)` | 无 | 缺失 | Story PostgreSQL | 详情读取；关系调整必须校验 scene/character 同 workspace/owner | 新增关系查询与详情展示 |
| 工作流运行 | `workflow_runs` + `workflow_run_transitions` + `workflow_run_token_consumptions` | `story_workflow_runs` / `story-workflow-runs` | 是，Admin 发明了 `project_id`、`workflow_code`、`input/output` 等不存在关系 | Story PostgreSQL | 运行、转换、Token 消费只读；取消/重试使用明确命令流程，不做通用 PATCH/DELETE | 映射真实表；工作流 Resource 改为只读；详情展示 provenance 与 transition |
| Deck/创作配置 | `decks`、`voices` | 无对应业务 Resource | 否（当前遗漏） | Story PostgreSQL | 首阶段只读关联；不得与 AI Provider/Model 混为一类 | PRD 标记跨模块关系，后续按运营优先级接入 |
| Chat/Agent 会话 | `chat_thread`、`chat_message`、`agent_sessions` | 无对应业务 Resource | 否（当前遗漏） | Story PostgreSQL | 默认只读、内容按权限和隐私最小化展示 | 工作流详情仅显示必要 provenance，不回显敏感消息 |
| Storage | 源项目有 Storage API；Admin 自有 `app/api/storage` 与 `app/lib/file-storage` | Storage routes/lib | 不是数据库重复建模 | Admin 现有 Storage 服务 | 保持现有上传、签名 URL、代理读取与驱动配置，不删除不降级 | 增加管理视图但复用现有 API/lib |
| Provider | 无同义业务表 | `ai_providers` | 否 | Admin PostgreSQL 控制面 | 完整 CRUD/停用；凭据只写、加密、永不回显 | 保留现有实现并改善 UI |
| Model | 无同义业务表 | `ai_models` | 否 | Admin PostgreSQL 控制面 | CRUD/启停；删除受 Provider/Pricing FK 保护 | 保留 |
| Pricing | 无同义业务表 | `ai_pricing_rules` | 否 | Admin PostgreSQL 控制面 | 生效窗口规则；历史价格快照不可被覆写 | 保留并强化冲突 UI |
| Token usage | 业务源 `workflow_run_token_consumptions` 仅表示 workflow token/idempotency 消费，不是代理计费用量 | `gateway_requests` 的 Token 字段 | 否，语义不同 | Admin PostgreSQL 控制面；详情可关联 source run external ID | 只读、不可删除；micro-USD 价格快照 | 保留 |
| 计费账户/账本 | 无同义业务表 | `billing_accounts`、`billing_ledger_entries` | 否 | Admin PostgreSQL 控制面 | 账户仅通过受审计调整；账本 append-only | 保留 DB trigger 与 API 限制 |
| Gateway | 无同义业务表 | `gateway_api_keys`、`gateway_requests`、`gateway_rate_limits` | 否 | Admin PostgreSQL 控制面 | Key 一次明文、之后仅掩码；请求/限流只读；失败结算显式 reconcile | 保留 |
| Admin 身份/RBAC | 源 `users.role` 不是 Admin RBAC | `admin_users/roles/permissions/sessions` | 否 | Admin PostgreSQL 控制面 | Session/RBAC 服务端强制；内置角色保护 | 保留 |
| 系统设置/审计 | 无同义控制面表 | `system_settings`、`admin_audit_logs` | 否 | Admin PostgreSQL 控制面 | Secret 永不回显；审计 append-only | 保留 |

## 5. 关键结构差异

### 5.1 主键与身份

- 源业务用户 `users.id` 是自增整数；Admin `platform_users.id` 是文本 ID。跨领域身份映射使用 `(source, external_user_id)`；由于键类型和生命周期不同，不伪造直接数据库外键。
- 源 Story/Workspace/Character/Scene/Workflow Run 主键是文本 ID。Admin 可以原样返回这些 ID，不生成替代 ID。
- Story 内部关系继续使用迁入后原有 PostgreSQL 外键；业务身份到 `platform_users` 的 crosswalk 由同库 repository 在事务中校验 `(source, external_user_id)`，控制面审计保存源 ID 快照。

### 5.2 Story 聚合关系

源模型不是 `Project -> Character/Scene` 的简单树：

1. Workspace 拥有 Stories、Characters、Scenes。
2. Story 与 Character 是多对多关系，通过 `story_workspace_story_characters` 连接并携带 `role_type`。
3. Scene 可选关联一个 Story，并通过 `story_workspace_scene_characters` 与 Character 多对多关联。
4. Admin 当前 `story_characters.project_id` 与 `story_scenes.project_id` 直接 FK 会丢失跨 Story 复用角色和场景角色关系。

### 5.3 Workflow Run

源 `workflow_runs` 保存 Deck/Plugin/runtime/preflight 不可变 provenance、幂等键、状态版本和创建者，状态枚举为 `preflight/queued/running/output_validating/pending_review/confirmed/rejected/continuing/completed/failed/cancelled`。Admin 的 `story_workflow_runs` 没有这些关键字段，却虚构了 `project_id`、`workflow_code/version`、`input/output`。该表不能继续作为运行记录来源。

## 6. API 与写操作安全边界

业务源 FastAPI `backend/routers/story_workspace.py` 提供的真实能力是：

- Workspace：`GET /api/story-workspace/workspace`、`PATCH /workspace/{id}`。
- Story：list/detail/PATCH，以及 confirm/reject/archive；没有通用 create/delete。
- Character：list/detail/PATCH，以及 confirm/reject；没有通用 create/delete。
- Scene：list/detail/PATCH，以及 confirm/reject；没有通用 create/delete。
- Workflow：list/detail、preflight/start/retry/cancel/guidance 等命令式接口；没有通用 CRUD。

Admin 写边界必须与此契约一致：

1. 禁止为 Story/Character/Scene/Workflow 暴露虚构的通用创建和硬删除。
2. 严格 Zod 校验只允许源契约中的字段与枚举，忽略字段不是可接受行为。
3. 更新 Story/Character/Scene 前在同一 Story 数据源事务中校验资源、author、workspace 及关联 FK；`story_id` 变更必须验证目标 Story 与 Scene 同 owner/workspace。
4. confirm/reject/archive 使用条件更新，旧状态不满足时返回 409；批量操作要么全部成功，要么回滚。
5. Workflow 运行与 transition、源 Token consumption 默认只读；retry/cancel 是显式命令而不是 PATCH status。
6. 每个 Admin 成功或失败写入控制面审计，保存 actor、action、source resource ID、request ID、before/after 的安全字段和冲突原因；不记录密码、Token、密钥或完整敏感内容。
7. Story 与 Admin 审计位于同一个 PostgreSQL；写操作必须在同一数据库事务中提交业务更新与审计，不再接受“跨库审计补写”语义。
8. FK/unique/check 冲突映射为 409，业务数据源不可用映射为 503，未知异常为 500。

## 7. 单数据源决策

代码使用一个 Refine Data Provider、一个服务端 PostgreSQL Pool 和一个 `DATABASE_URL`：

```mermaid
flowchart LR
  UI[Refine Admin Data Provider] --> API[Next.js Admin API]
  API --> Guard[Session + RBAC + Zod]
  Guard --> Control[Control-plane repositories]
  Guard --> Story[Story source repositories]
  Control --> PG[(DATABASE_URL / ink-memory)]
  Story --> PG
```

- `app/lib/db.ts` 是唯一连接来源；`app/lib/story-source/**` 直接复用 `getPool()`。
- Refine 不直接持有数据库连接，只调用统一 Admin API；repository 分层保留真实字段和写边界。
- 当前实际：业务源仍是 SQLite，但首批真实表已完成只读 schema/数据审计。Admin 项目负责提供一次性迁移和隔离验收；迁移完成后的应用只读写同库 PostgreSQL。没有执行同步前仍不能声称生产已接通。

## 8. 旧表处置与迁移兼容策略

不得直接删除 `story_workspaces`、`story_projects`、`story_characters`、`story_scenes`、`story_workflow_runs`：

1. **阶段 A - 停止使用**：Resource/repository 从旧表切走；旧表保留，添加代码级 deprecated 清单与运行时禁止新写。
2. **阶段 B - 只读核对**：由 DBA 在明确隔离/备份环境比较旧表与真实源表。不得自动合并，因为字段与关系并非一一对应。
3. **阶段 C - 归档**：如确有历史数据，导出到受控归档 schema，并记录映射决策；不把它写回源业务表。
4. **阶段 D - 可选删除**：只在业务负责人签字、备份验证、回滚演练完成后新增独立 destructive migration；本次不创建该迁移。

`drizzle/0006_smart_hedge_knight.sql` 已经发布过，不能重写历史迁移。允许新增一个独立、可回滚的 canonical schema migration，为首批真实原名表 `users`、`story_workspace_workspaces`、`story_workspace_stories` 建表；它不得从旧平行表搬数据，也不得把这些表加入 Admin 语义命名。数据导入由单独显式 CLI 完成，不在 `db:migrate` 时隐式连接源文件。

## 9. 需要修改的代码

### 数据与服务层

- 新增 `app/lib/story-source/**`：PostgreSQL pool、真实表类型/映射、list/detail/update/review repositories、错误归一化。
- 调整 `app/lib/admin/resources.ts`：Story 和 source-user 资源委托给 story-source service；控制面资源继续使用 `DATABASE_URL`。
- 调整 `app/lib/admin/mutations.ts`：移除旧 Story 通用 create/delete 绑定；只保留明确的 patch/review/archive 命令。
- `app/lib/db/schema.ts`：移除旧平行表导出，避免未来 `db:generate` 继续把错误模型当作目标 Schema；历史物理表由非破坏迁移保留并标记 deprecated。
- `scripts/setup-env.mjs`、`.env.local.example`：删除 `STORY_DATABASE_URL`，只校验 `DATABASE_URL` 使用 PostgreSQL 且库名为 `ink-memory`。

### 本轮非破坏迁移决策

- `drizzle/0007_curvy_sabretooth.sql` 只为五张平行表写入 `COMMENT ON TABLE ... DEPRECATED`，不执行 DROP、RENAME、TRUNCATE、数据搬运或同步。
- `drizzle/meta/0007_snapshot.json` 与当前 Drizzle Schema 不再包含平行表，确保以后生成控制面迁移时不会继续扩展这些错误模型。
- 最终删除仍保留为需要数据核对、备份和负责人批准的独立未来阶段，本轮不执行。

### 首批 canonical 数据迁移决策

- PostgreSQL DDL 精确映射源三表主键、email unique、status/review/type/agent checks、owner/author/workspace FK 与查询索引；时间统一为 `timestamptz`，源文本按明确 UTC/offset 规则解析。
- CLI 默认只输出迁移计划和计数；`--apply` 需要显式源路径和目标 PostgreSQL URL，并拒绝目标数据库名不是 `ink-memory`。源通过只读一致性快照抽取，目标单事务写入 users → workspaces → stories。
- 首次导入采用 conflict-fail；目标已有任一同 PK/email 但内容不同即 409/退出，不做 `ON CONFLICT DO UPDATE`。成功后设置 users identity sequence，执行行数、PK、JSON、枚举、FK orphan 与 fingerprint 校验。
- 真实数据只同步到一次性 PostgreSQL 做本轮测试；生产目标需要停写窗口、备份、操作者再次确认和独立运行记录，不能复用测试授权静默写入。

### API 与 Refine

- 保持 `app/api/admin/[resource]/**` 仅编排；Story 自定义动作增加轻量 Route Handler。
- 调整 `app/components/admin/providers.ts` 的 Resource 注册、错误语义与只读/命令式能力。
- 把 `/admin/story` 拆为工作区、剧本、角色、场景、工作流运行等清晰路由和真实字段表格。
- 用户模块区分“源业务用户”和“计费身份”，不再把 `platform_users` 当作源用户表。

### 测试

- 单元测试：真实字段白名单、分页排序筛选、冲突映射、禁止 create/delete、无配置 fail-closed。
- PostgreSQL 集成：使用一个明确 disposable `ink-memory` 数据库；同库应用控制面/canonical schema migration，并通过系统原生只读提取器同步真实源三表。应用测试过程不使用 SQLite driver，其他关系仍可使用 PostgreSQL-only 合成 fixture 单独覆盖。
- Playwright：无 Session、RBAC、源数据查询/受控更新、FK/状态冲突、数据库不可用、移动/桌面视觉。

## 10. 验收判断

- [x] 已检查两个项目的连接方式、Schema/迁移、Story 查询/API、字段关系、Admin Resources/API/页面绑定。
- [x] 已证明“看不到源表”的根因是 PostgreSQL 与 SQLite 的数据源分离，而非 schema 名猜测。
- [x] 已识别 Admin `0006` 的平行 Story 建模与字段/关系差异。
- [x] 已划分真实业务域和 Admin 控制面边界。
- [x] 已纠正为唯一 PostgreSQL/唯一 `DATABASE_URL`/唯一 Pool，并定义 Story 缺表 fail-closed 行为。
- [x] 已定义 Story 写边界、审计、FK/unique/state 冲突和无破坏旧表退役策略。
- [x] 未修改业务源代码、未写业务源数据库、未写共享 PostgreSQL、未删除旧表。
- [x] 已主动只读访问实际业务源并证明首批真实数据为 users 28 / workspaces 12 / stories 4，外键检查为 0。
- [x] 已实现迁移 CLI，将真实三表同步到一次性 PostgreSQL，并完成 Admin 查询、受控写、冲突、审计和 E2E；生产库仍需独立变更窗口与操作者确认，未在本轮写入。
## 隔离 PostgreSQL 实迁验收（2026-08-08）

在明确拥有的临时 PostgreSQL 16 容器 `127.0.0.1:55432/ink-memory` 上完成了第一批真实迁移验收；共享 `localhost:5433/ink-memory` 未连接、未迁移、未清理。

- 最终迁移链 `0000` 至 `0010` 全部成功：`0009_provider_model_sync.sql` 只承载 Provider/Pricing 同步控制面，`0010_story_source_canonical.sql` 从唯一 Drizzle schema source 生成 canonical `users`、`story_workspace_workspaces`、`story_workspace_stories`。拆分后在全新容器再次验证，避免未来 `db:generate` 重复建表。
- dry-run 读取原生只读快照成功：`users=28`、`workspaces=12`、`stories=4`，目标三表均为 0。
- 显式 `--apply` 在单个 serializable 事务中完成，导入后数量与三组主键 SHA-256 指纹均与源快照一致。
- `workspace_owner_orphans=0`、`story_author_orphans=0`、`story_workspace_orphans=0`。
- 第二次 dry-run 因目标非空被拒绝；工具没有 merge、truncate、delete 或 overwrite 分支。
- 源文件在快照前后保持相同 SHA-256 和文件状态；操作回执不包含邮箱、密码哈希、正文或其他行级业务数据。

## 发布验证汇总（2026-08-08）

| 验证项 | 结果 |
|---|---|
| `pnpm env:check` | 通过 |
| `pnpm exec tsc --noEmit` | 通过 |
| `pnpm lint` | 通过，0 error / 0 warning |
| `pnpm test:run` | 30 files / 169 tests 全部通过 |
| `pnpm build` | Next.js production build 通过；新 discover/pricing sync 页面和 API 均在 route manifest |
| PostgreSQL migration | 全新 PostgreSQL 16 `ink-memory` 应用 `0000–0010` 通过 |
| 真实源实迁 | 28 users / 12 workspaces / 4 stories；三组 PK fingerprint 一致；orphans=0 |
| Focused Playwright | 隔离 PostgreSQL主场景 1/1；Session/Bootstrap 6/6 |
| 视觉 | 14 张截图；1440×1000 与 390×844；根节点横向溢出断言通过 |

主 E2E 还验证了真实 Session、401/403、canonical Story 查询和受控更新、跨 Workspace 409、Provider Secret 不回显、Provider discover/diff/apply、models.dev 价格快照 apply 后新增 `source=models.dev` 价格版本、不可变历史价格、余额/账本、Gateway Key、失败结算、Storage GET、移动导航及旧 PWA 路由 404。外部 Provider 与 models.dev 实网未调用：Provider 使用本机 mock，models.dev fetch/parser/matcher 使用 unit contract，价格 apply 使用隔离 PostgreSQL真实事务。一次性容器与 55432 监听已删除；共享 5433 未操作。
