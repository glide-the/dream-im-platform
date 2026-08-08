# Story / User / Resource Admin 只读审计

> 审计日期：2026-08-08（Asia/Shanghai）  
> 审计仓库：`ink-admin-memory`  
> 只读参考：`/Users/dmeck/project/ink-dream-memory`  
> 结论状态：代码与迁移已证实；当前 shell 未配置 `DATABASE_URL`，数据库实例状态待隔离环境验证。

## 1. 结论摘要

当前后台不是从零开始：Admin Session、RBAC、统一资源 API、审计、Story Repository、Refine Data Provider、管理员/角色页面和 Storage 驱动均已存在。但本轮目标仍未形成可验收闭环，根因是“canonical 业务表、页面资源和运行时权限”处于不一致状态。

1. `app/lib/db/schema.ts` **没有**声明 `users`、`story_workspace_workspaces`、`story_workspace_stories`，违反“Drizzle schema 为唯一来源”的仓库约束。
2. 未提交的 `drizzle/0009_provider_model_sync.sql` 手工包含三张表，但同一个 migration 还混入 Provider/Pricing 改动；该 migration 与当前 schema source 不一致，且数据库是否已应用无法在当前 shell 证实。
3. `app/lib/story-source/**` 已通过与控制面相同的 `getPool()` 访问三张表，运行时没有第二数据库；但命名仍残留 `source-*`，部分查询还依赖本轮排除的 character/scene/workflow 表，导致只迁入三张目标表时 Workspace/Story 详情可返回 503。
4. 平台用户页面同时展示 canonical `users` 和计费身份 `platform_users`，但 canonical `users` 只读、无状态维护、无 Workspace/Story 统计；页面文案中的“双层身份”不符合本轮以 `users` 为平台业务用户的主任务。
5. Workspace/Story 页面建立在通用 `AdminResourceManager` 上：具备分页、基础筛选、编辑和审核命令，但缺少专用详情的信息架构、关联跳转、Workspace Story 数、用户维度跳转、长内容可读展示和目标状态覆盖。
6. Storage 页面只有配置状态与上传表单；`/api/storage`、`/api/storage/upload`、`/api/storage/upload-url` 和文件 GET 未执行 Admin Session/Permission/Origin 校验，且没有管理列表、筛选、删除或审计。注释仍称其为“PWA app”，与当前仓库事实冲突。
7. 管理员、角色和权限已具有真实表、Zod、事务、审计及内置角色保护；仍需权限矩阵专用视图、高风险确认与 Storage 权限代码。
8. Dashboard 混合展示模型、网关、计费指标；本轮要求的 active/disabled 用户、最近 Story 与最近管理操作没有完成。

## 2. 工作区保护与审计边界

审计开始时工作区已有未提交修改。必须保留并逐文件避让，尤其包括：

- `app/lib/db/schema.ts`、`drizzle/meta/_journal.json`；
- 未跟踪的 `drizzle/0009_provider_model_sync.sql`、`drizzle/meta/0009_snapshot.json`；
- `package.json` 中未提交的 `story:import` 命令；
- 未跟踪的 `scripts/import-ink-dream-story-source.mjs`、`scripts/lib/story-source-import.mjs` 与 `app/lib/story-source-import.test.ts`；
- Provider discovery 代码、PRD/设计文档和 `files/workspace/**` 设计工作流产物。

上述导入脚本是审计前已经存在的用户工作，不计入本轮交付；本轮页面、API、测试和运行时不得依赖它，也不得扩展为迁移/同步控制台。

当前 shell 的只读数据库探测结果为 `DATABASE_URL` 未配置，因此本文不会声称真实 `ink-memory` 实例已经拥有目标表。迁移存在性与真实实例状态分开记录。

## 3. 模块矩阵

| 模块 | 当前页面 | 当前数据表 | 正确业务表 | 存在问题 | 处理方式 | 权限要求 |
|---|---|---|---|---|---|---|
| 运营总览 | `/admin` | `platform_users`、模型/网关/计费表及三张目标表 | `users`、`story_workspace_workspaces`、`story_workspace_stories`、`admin_audit_logs` | 指标范围混杂；无用户状态、最近 Story、最近操作 | 本轮卡片只增加并优先展示真实业务指标，保留旧模块不重构 | `dashboard.read` |
| Workspace | `/admin/story/workspaces` | `story_workspace_workspaces`，详情又查询 character/scene/workflow 表 | `story_workspace_workspaces` → `users`；Story 计数来自 `story_workspace_stories` | schema source 缺表；无 status；缺专用详情和关联跳转；详情对排除表有硬依赖 | 建立 canonical Drizzle 表；列表聚合 Story 数；详情只依赖本轮三表；允许创建与合法字段编辑，禁硬删 | `story.read` / `story.write` |
| Story | `/admin/story/stories` | `story_workspace_stories`，详情额外查询 character/scene 桥表 | `story_workspace_stories` → Workspace → User | 长内容展示、用户/Workspace 跳转不足；详情对排除表有硬依赖；Resource 名称为 `story-stories` | 改为 `stories` Resource；专用列表/详情；只允许标题、说明、类型与受控状态动作 | `story.read` / `story.write` |
| 平台用户 | `/admin/resources/users` | `users` + `platform_users` | 业务用户为 `users`；`platform_users` 仅保留为计费/网关表 | canonical 用户只读、无 status、无关系统计；敏感字段虽未 SELECT 但缺状态写 API | `users` Resource 作为主视图；新增状态维护和关联计数；计费映射留在现有模块 | `users.read` / `users.write` |
| 管理员 | `/admin/access/admins` | `admin_users`、`admin_user_roles`、`admin_roles` | 同左 | 核心能力已存在；确认交互与专用详情不足 | 保留现有事务/审计/最后 super admin 保护，完善 UI 确认和详情 | `access.read` / `access.write` |
| 角色 | `/admin/access/roles` | `admin_roles`、`admin_role_permissions`、`admin_permissions` | 同左 | 通用多选而非清晰矩阵；内置角色保护已在服务端 | 增强矩阵展示；自定义角色 CRUD；内置角色不可删/不可破坏 | `access.read` / `access.write` |
| 权限 | `/admin/access/permissions` | `admin_permissions` | 同左 | 列表真实但只提供通用表格 | 保持只读；按模块分组展示并支持角色跳转 | `access.read` |
| Storage | `/admin/resources/storage` | 对象存储；无 PostgreSQL 文件索引 | 现有 S3/Vercel Blob 驱动 + `admin_audit_logs` | API 无 Admin 鉴权；无列表/删除/筛选/审计；文件 GET 公开 | 新增受保护 Admin Storage API；不替换驱动；写操作做 Origin、permission、审计 | `storage.read` / `storage.write` / `storage.delete` |
| 审计日志 | `/admin/system/audit` | `admin_audit_logs` | 同左 | 只读资源已存在；需 Story/User/Storage 跳转 | 维持 append-only；补资源类型过滤与实体链接 | `audit.read` |
| 错误平行 Story 模型 | 角色、场景、workflow 页面仍在菜单 | `story_workspaces`、`story_projects` 等 deprecated 表曾存在 | 本轮只用三张 canonical 表 | 旧表已有 DEPRECATED comment，但 UI 仍暴露本轮排除资源；容易误认为当前业务主模型 | 不删除；新 Workspace/Story/User 页面停止依赖；菜单本轮隐藏排除页；另行废弃 | `story.read`（遗留） |

## 4. 三张业务表与约束

只读参考 `ink-dream-memory/backend/database.py` 后，真实字段与关系为：

```text
users.id (bigint)
  └─< story_workspace_workspaces.owner_id (bigint, NOT NULL)
         └─< story_workspace_stories.workspace_id (text, NOT NULL)

users.id (bigint)
  └─< story_workspace_stories.author_id (bigint, NOT NULL)
```

### 4.1 已证实的 canonical 字段

- `users`：`id`、`email`、`password_hash`、`display_name`、`avatar_url`、`role`、`created_at`、`updated_at`。
- `story_workspace_workspaces`：`id`、`name`、`owner_id`、`settings`、`created_at`、`updated_at`。
- `story_workspace_stories`：`id`、`identifier`、`title`、`description`、`status`、`review_status`、`type`、`content`、`author_id`、`workspace_id`、计数字段、Agent/审核字段和时间字段。

### 4.2 本轮需要规范化的增量

- `users.status`：`active | disabled`，默认 `active`；支持业务用户停用，不删除密码/历史关系。
- `story_workspace_workspaces.status`：`active | archived`，默认 `active`；Workspace 使用归档代替硬删。
- Workspace 所有权索引和 `status, updated_at` 索引。
- Story 的 Workspace/更新时间复合索引；现有 author/status/review/type 索引继续保留。
- `settings` 应在 Drizzle 中声明为 JSONB；如果现有实例来自 text 结构，必须通过审查后的 PostgreSQL migration 显式转换并验证合法 JSON。
- Story `author_id` 必须与 Workspace `owner_id` 一致。仅靠两个独立外键无法保证该跨表约束；写操作必须在事务内校验，必要时再增加数据库触发器/复合约束。

### 4.3 删除和只读策略

- User：允许管理员修改 `status`、显示名等安全资料；禁止返回/修改 `password_hash`；禁止硬删。
- Workspace：允许创建、修改名称/设置/状态；有 Story 的 Workspace 不硬删，统一归档。
- Story：不从 Admin 创建；允许修改标题、描述、类型与受控审核/归档动作；正文和内部版本/Agent 字段只读；禁止硬删。
- Permission：系统能力代码只读，通过审查后的 migration 初始化。
- Audit、账本、用量：只读、只追加。
- Storage：允许上传、预览、下载；删除必须二次确认、专用权限和审计。对象存储是否支持列举由驱动能力决定，配置不可用时必须显示可恢复错误。

## 5. 页面外壳与映射问题

### 5.1 已有真实能力

- 通用 `/api/admin/[resource]` Route Handler 仅做转发，复杂 SQL 在 `app/lib/admin/**` 或 `app/lib/story-source/**`。
- `requireAdminRequest` 实现 401/403；`assertAdminMutationOrigin` 实现生产 Origin 校验。
- Admin mutations 使用严格 Zod、PostgreSQL transaction 和 `admin_audit_logs`。
- `AdminResourceManager` 已支持服务端分页/筛选/排序、创建/编辑容器和命令动作。
- 管理员创建/停用、角色分配、自定义角色和内置角色保护已有服务端基础。

### 5.2 仍属外壳或不完整能力

- Workspace/Story 虽有真实 SQL，但主要是通用 CRUD 表格/Drawer；缺少运营专用详情与跨实体导航。
- `source-users` 仅是安全字段只读表格，无法执行本轮要求的用户状态维护。
- Storage 只显示 driver status 和一次上传结果，不是资源管理页面。
- 权限页是平铺列表，不是权限矩阵。
- Dashboard 的最近 Story/最近操作、异常/孤儿/空数据提示未完成。
- Navigation 仍暴露 characters/scenes/workflow-runs，超出本轮三表边界。

### 5.3 Resource 修正目标

| Refine Resource | API | PostgreSQL/Driver | 结论 |
|---|---|---|---|
| `users` | `/api/admin/users` | `users` | 新的 canonical 主资源；替代页面对 `source-users` 的主依赖 |
| `story-workspaces` | `/api/admin/story-workspaces` | `story_workspace_workspaces` | 保留名称，补创建/状态/计数/详情 |
| `stories` | `/api/admin/stories` | `story_workspace_stories` | 采用目标命名；旧 `story-stories` 仅兼容，不再作为新页面主资源 |
| `admin-users` | `/api/admin/admin-users` | `admin_users` + roles | 保留 |
| `roles` | `/api/admin/roles` | `admin_roles` + permissions | 新页面别名或迁移到目标命名；旧 `admin-roles` 可兼容 |
| `permissions` | `/api/admin/permissions` | `admin_permissions` | 只读；旧 `admin-permissions` 可兼容 |
| `storage-resources` | `/api/admin/storage-resources` | 现有对象存储驱动 | 新增受保护管理 facade |
| `audit-logs` | `/api/admin/audit-logs` | `admin_audit_logs` | 保留 |

## 6. 跨模块跳转

- User 详情 → 该用户的 Workspace 列表（`owner_id` filter）→ Story 列表（`author_id` filter）。
- Workspace 详情 → Owner User 详情；Story 子列表（`workspace_id` filter）。
- Story 详情 → 所属 Workspace；作者 User；审核/编辑该 Story 的 `admin_audit_logs`。
- Admin User/Role → Role/Permission 矩阵；权限本身只读。
- Storage 资源 → 预览/下载；相关管理操作 → 审计日志。对象文件没有稳定业务用户外键时不得伪造 User 关联。

## 7. 具体实施清单

### Schema / Migration

1. 在 `app/lib/db/schema.ts` 声明三张 canonical 表及关系约束，不创建平行模型。
2. 将三表建表/补字段从混合的未提交 migration 中拆分为可审查的 PostgreSQL migration，或在不覆盖用户工作前提下生成后继 migration；确保 snapshot/journal 与 schema source 一致。
3. 新增 `status`、索引和约束；保留 deprecated 表，只记录后续退役计划。

### Repository / API

1. 将 Story repository 明确为同库 domain repository；列表/详情仅依赖本轮三表。
2. 增加 User query/mutation、关联计数和状态维护。
3. 增加 Workspace 创建、状态更新与 Story 聚合；Story 保持受控更新/审核。
4. 增加 Storage Admin facade，所有入口执行 Session、permission、Origin、Zod、audit；不删除底层驱动。
5. Dashboard 增加真实 active/disabled、最近 Story 和最近管理操作。
6. 统一 400/401/403/404/409/500 错误；所有排序字段白名单；永不 SELECT/返回密码、Token、Session 或 Provider Key。

### Refine / 页面

1. 注册本轮八个目标 Resource，并保留旧 Resource 的兼容性但停止新页面依赖。
2. 导航按运营总览、剧本数据、用户中心、权限管理、资源管理、系统治理分组。
3. Workspace、Story、User 改为专用列表/详情；关联实体可点击；长文本/JSON 可读；提供 loading/empty/error/403/404/409。
4. Storage 增加列表、筛选、上传、预览、下载、删除确认和错误恢复。
5. 桌面 1440×1000 与移动 390×844 验证容器滚动、Drawer 导航、焦点与 reduced motion。

## 8. 错误平行表废弃计划

`story_workspaces`、`story_projects`、`story_characters`、`story_scenes`、`story_workflow_runs` 等旧 Admin 模型已经在 migration comments 中标记 deprecated。本轮不删除这些表，也不清理历史数据：

1. 新的 User/Workspace/Story 页面和 API 不再读写它们；
2. 本轮菜单隐藏超出范围的旧角色/场景/工作流运营入口；
3. 记录访问/数据对比与保留期后，另开数据库治理变更执行退役；
4. 退役前必须证明模型、网关、计费及历史审计没有依赖。

## 9. 本轮明确边界

- 不创建或扩展 `ink-dream-memory → ink-memory` 数据迁移程序；现有未提交导入脚本不作为交付依赖。
- 运行时只允许一个 `DATABASE_URL` PostgreSQL pool；`app/lib/story-source/db.ts` 当前已复用 `getPool()`。
- 不引入 SQLite、JSON DB 或内存数据库回退。
- 不修改 `ink-dream-memory`。
- 不重构模型、网关、计费页面；不删除现有 RBAC 或 Storage 驱动。
- 不创建或恢复 `app/(app)`。
