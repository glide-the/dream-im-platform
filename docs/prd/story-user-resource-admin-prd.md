# Story / User / Resource Admin PRD

> **专项历史版本 / 已被替代：** 平台用户与 Story 的当前需求分别见 [`modules/01-platform-users.md`](modules/01-platform-users.md) 和 [`modules/02-story-operations.md`](modules/02-story-operations.md)。

> 版本：1.0  
> 日期：2026-08-08  
> 状态：本轮实施基线  
> 适用项目：`ink-memory-admin`  
> 设计依据：`Ink & Memory UI Design v2.1`、`docs/prd/color_system/**`、`docs/verification/story-user-resource-admin-audit.md`

## 1. 背景与问题

当前 Admin 已有 Session、RBAC、通用 Resource API、Story 查询、管理员/角色和 Storage 驱动，但 canonical 业务表、页面 Resource 与写权限没有形成闭环：Drizzle schema 未声明三张目标表；用户仅只读；Workspace/Story 仍以通用 CRUD 容器呈现；Storage 管理入口没有管理员鉴权、列表、删除和审计。

本轮把“真实业务数据可查、合法状态可管、关联链可追、敏感操作可审计”做成可运营产品，不扩展到 AI 模型、计费、网关或数据迁移。

## 2. 目标与成功定义

### 2.1 P0 目标

1. 以单一 `DATABASE_URL → ink-memory` 中的 `users`、`story_workspace_workspaces`、`story_workspace_stories` 为唯一业务事实。
2. 运营人员可按用户 → Workspace → Story 查询、筛选、排序、查看详情和返回上下文。
3. 允许 User 状态维护、Workspace 创建/合法编辑/归档、Story 合法字段编辑/审核/归档；禁止破坏正文结构和内部版本字段。
4. 管理员、角色、权限建立清晰矩阵；内置角色与最后 active super admin 受服务端保护。
5. Storage 在保留既有驱动的前提下具备受保护的配置、列表、筛选、上传、预览、下载、删除和审计。
6. Dashboard 只显示真实可查询指标；所有失败、空数据、权限、冲突和配置状态可恢复。

### 2.2 成功定义

- 每个 UI 操作均能追溯到 Resource、API、PostgreSQL/Storage、permission 与 audit。
- 无 Session 为 401；无权限为 403；外键/状态冲突为 409；敏感字段不进入响应。
- 1440×1000 和 390×844 无页面级横向溢出，键盘可完成主要路径。
- 模型、计费、网关现有路由继续可访问且无明显回归。

## 3. 非目标

- 不创建迁移、导入、ETL、同步、第二数据库或跨库查询工具。
- 不修改 `ink-dream-memory`，只读参考其字段和约束。
- 不实现 AI 模型、Token 计费、Gateway 页面重构。
- 不创建 SQLite、JSON DB、内存数据库回退。
- 不恢复 `app/(app)`。
- 不删除 deprecated 平行表；仅停止本轮页面/API 新依赖。

## 4. 用户角色

| 角色 | 目标 | 典型权限 |
|---|---|---|
| 运营查看者 | 查询用户、Workspace、Story 与审计 | `dashboard.read`、`users.read`、`story.read`、`audit.read` |
| 业务运营 | 维护用户状态、Workspace 和 Story 合法字段 | 查看权限 + `users.write`、`story.write` |
| 资源管理员 | 管理 Storage 文件 | `storage.read`、`storage.write`、`storage.delete` |
| 权限管理员 | 管理管理员与自定义角色 | `access.read`、`access.write` |
| 审计员 | 只读审计与权限矩阵 | `audit.read`、`access.read` |
| 超级管理员 | 全部管理能力 | 全部 permission；仍受 Origin、Zod、事务和审计约束 |

## 5. 数据边界与关系

```text
users.id BIGINT
  ├─< story_workspace_workspaces.owner_id BIGINT NOT NULL
  └─< story_workspace_stories.author_id BIGINT NOT NULL

story_workspace_workspaces.id TEXT
  └─< story_workspace_stories.workspace_id TEXT NOT NULL
```

- User 为业务身份；`platform_users` 继续服务计费/网关，不作为本轮用户主表，也不删除。
- Workspace owner 不在 Admin 中转移。
- Story author 和 Workspace owner 必须一致；写操作在事务内校验。
- `password_hash` 永不 SELECT、序列化、审计或回显。
- User/Workspace 使用状态停用或归档；不硬删。

## 6. 信息架构

```text
运营总览

剧本数据
├── 工作区
└── 剧本

用户中心
└── 平台用户

权限管理
├── 管理员
├── 角色
└── 权限

资源管理
└── 文件存储

系统治理
└── 审计日志
```

模型、计费、网关菜单继续保留原位置与能力。本轮隐藏 characters、scenes、workflow-runs 等超出三表范围的旧运营入口，但不删除其代码或数据。

## 7. Resource / API / 权限唯一映射

| Refine Resource | API | 表/驱动 | Read | Write/Delete |
|---|---|---|---|---|
| `users` | `/api/admin/users` | `users` | `users.read` | `users.write` |
| `story-workspaces` | `/api/admin/story-workspaces` | `story_workspace_workspaces` | `story.read` | `story.write` |
| `stories` | `/api/admin/stories` | `story_workspace_stories` | `story.read` | `story.write` |
| `admin-users` | `/api/admin/admin-users` | `admin_users`、`admin_user_roles` | `access.read` | `access.write` |
| `roles` | `/api/admin/roles` | `admin_roles`、`admin_role_permissions` | `access.read` | `access.write` |
| `permissions` | `/api/admin/permissions` | `admin_permissions` | `access.read` | 无；migration 管理 |
| `storage-resources` | `/api/admin/storage-resources` | S3/Vercel Blob 驱动 | `storage.read` | `storage.write` / `storage.delete` |
| `audit-logs` | `/api/admin/audit-logs` | `admin_audit_logs` | `audit.read` | 无，append-only |

旧 `source-users`、`story-stories`、`admin-roles`、`admin-permissions` 允许短期兼容，但新页面不以其为主 Resource。

## 8. 全局产品与 API 规则

### 8.1 列表契约

- `page ≥ 1`，`pageSize ∈ {20,50,100}`；默认 20。
- 单字段白名单排序；默认使用业务相关的 `updated_at desc` 或 `created_at desc`。
- 白名单过滤支持 `eq`、`contains`、`in`；查询、排序、页码同步 URL。
- 响应：`{ data: T[], meta: { total, page, pageSize, totalPages } }`。
- 只有查询成功且 total=0 才显示空状态；查询失败不得伪装为 0。

### 8.2 错误契约

统一结构：

```json
{
  "error": {
    "code": "STABLE_CODE",
    "message": "可恢复说明",
    "details": []
  }
}
```

| HTTP | UI 行为 |
|---|---|
| 400 | 保留输入，顶部错误摘要并聚焦首个错误字段 |
| 401 | 清除保护值并进入登录；只带安全 return URL |
| 403 | 显示所需 permission；不渲染受限写控件 |
| 404 | 详情返回列表并恢复筛选/焦点 |
| 409 | 保留草稿，显示服务器最新状态、冲突关系和重试路径 |
| 500/503 | 说明失败边界与恢复动作；不得切换数据源或显示假数据 |

### 8.3 所有写操作

必须依次包含 Admin Session、服务端 Permission、Origin、严格 Zod、参数化 SQL、PostgreSQL transaction、before/after audit。Refine 控件隐藏仅是 UX。

## 9. 页面规格

### 9.1 运营总览

**目标**：在一分钟内发现业务数据量、停用风险和近期变化。  
**角色**：所有拥有 `dashboard.read` 的管理员。  
**API**：`GET /api/admin/dashboard`。

真实指标：

- 用户总数、active 用户数、disabled 用户数；
- Workspace 总数、active/archived 数；
- Story 总数及 status 分布；
- 最近更新 Story（最多 5 条，标题、Workspace、作者、更新时间）；
- 最近管理操作（最多 5 条，actor、action、resource、时间）。

规则：不展示虚构趋势、健康分或随机图表；每组标注来源和更新时间。单个查询失败显示“暂不可用”，不写 0。所有行可携带白名单筛选跳转目标列表。

**验收**：空库有解释性空状态；缺表为 schema readiness 错误；无 5xx 时数字与 SQL 一致。

### 9.2 Workspace 列表

**Resource/API/Table**：`story-workspaces` / `/api/admin/story-workspaces` / `story_workspace_workspaces`。  
**列表字段**：name、owner display/email、status、Story count、created_at、updated_at。  
**筛选**：name contains、owner_id eq、owner_email contains、status eq。  
**排序**：name、story_count、created_at、updated_at。默认 updated_at desc。  
**动作**：创建、查看、编辑 name/settings/status；archive 需确认；禁硬删和 owner 转移。

Workspace 创建必填 name、owner（真实 User 搜索），可选 settings；默认 active。owner 不存在返回 409。详情显示基本信息、所属用户、Story 子列表、最近更新时间和相关 audit；不依赖 character/scene/workflow 表。

跳转：Owner → User 详情；Story 数 → `stories?workspace_id=...`；Story 行 → Story 详情。

### 9.3 Story 列表与详情

**Resource/API/Table**：`stories` / `/api/admin/stories` / `story_workspace_stories`。  
**列表字段**：title/identifier、Workspace、作者、type、status、review_status、character_count、scene_count、updated_at。  
**筛选**：title/identifier contains、workspace_id、author_id、status、review_status、type。  
**排序**：title、created_at、updated_at；默认 updated_at desc。  
**合法编辑**：title、description、type；confirm/reject/archive 使用具名命令和确认。  
**只读**：id、identifier、content、author/workspace、计数、agent/provenance、内部版本和时间事实。

详情按“身份 → 归属 → 内容 → 状态时间线 → 审计”组织。content 若为 Markdown，采用安全只读排版；若为 JSON，格式化并可折叠；未知文本保留换行和换行长词。不得由 Admin 任意覆盖正文。

跳转：Workspace、作者 User、该 Story 审计；返回保持原筛选、页码、滚动与焦点。

### 9.4 平台用户

**Resource/API/Table**：`users` / `/api/admin/users` / `users`。  
**列表字段**：display_name/email、role、status、Workspace count、Story count、created_at、updated_at。  
**筛选**：email/display_name contains、role eq、status eq。  
**排序**：email、created_at、updated_at、Workspace/Story count。  
**编辑**：display_name、avatar_url、status；停用需二次确认并说明不会删除历史数据。  
**禁止**：创建密码、重置密码、返回 password_hash/Token/Session/Provider Key、硬删。

详情显示安全资料、状态、关联 Workspace、关联 Story、相关管理审计。状态变化为 409 时显示最新状态。跳转携带 `owner_id` 或 `author_id`。

### 9.5 管理员

**Resource/API/Table**：`admin-users` / `/api/admin/admin-users` / Admin RBAC 表。  
列表：email、display_name、roles、status、last_login_at。筛选 email/status/role。  
允许创建、改显示名、重置密码、分配角色、停用；email 创建后不可修改；禁止硬删。密码至少 14 字符且从不回填。最后 active super_admin 不可停用或移除该角色。

### 9.6 角色与权限

**Resources**：`roles`、`permissions`。  
角色支持自定义 role 创建/编辑/删除；code 创建后只读。页面按业务域展示权限矩阵，显示 code/name/description、已选差异和受影响管理员。内置 `super_admin`、`operator`、`auditor` 不可删除；内置 permission set 受保护。

权限页只读，支持 code/name 搜索和域分组；点击权限可筛选拥有该权限的角色。权限代码由 migration/bootstrap 管理，不提供 CRUD 表单。

### 9.7 Storage 资源管理

**Resource/API/Driver**：`storage-resources` / `/api/admin/storage-resources` / 现有 S3 或 Vercel Blob。  
列表字段：key、filename、MIME、size、uploaded/modified time、driver。  
筛选：key/filename contains、MIME prefix/eq、时间范围。排序：key、size、time。  
动作：上传、预览、下载、删除；删除必填确认并审计。

要求：

- 配置状态置于页面顶部但不泄漏 credential/bucket secret；
- 驱动支持 list 时服务端分页列举；驱动不支持时显示明确 capability 错误，不制造假列表；
- 上传校验文件存在、单文件大小、允许 MIME、文件名和 prefix；失败保留文件选择信息；
- preview/download 受 `storage.read` 保护；upload 使用 `storage.write` + Origin；delete 使用 `storage.delete` + Origin；
- 删除只针对严格 Zod 校验后的确切 key，显示不可恢复说明，成功记录 actor/key/metadata；
- 不把文件内容写入 PostgreSQL，不删除底层驱动。

### 9.8 审计日志

**Resource/API/Table**：`audit-logs` / `/api/admin/audit-logs` / `admin_audit_logs`。  
只读、append-only。字段：created_at、actor、action、resource_type/id、request_id、脱敏 before/after、metadata。筛选 actor/action/resource/time；默认 newest first。关联 User/Workspace/Story/Storage/RBAC 时提供文字链接。不得回显密码、Secret 或文件内容。

## 10. 全局状态

| 状态 | 要求 |
|---|---|
| Loading | 保留页头、筛选和表头尺寸；使用等高 skeleton；完成后 polite 播报 |
| Empty | 区分系统空、筛选空、关系空；提供清筛/返回父实体/允许的创建动作 |
| Error | 说明发生了什么、影响范围、Request ID 和恢复动作 |
| 403 | 显示 permission；无权写控件不渲染 |
| 404 | 返回保持查询上下文；焦点回到触发行 |
| 409 | 显示最新值、冲突实体和重试；不静默覆盖 |
| Storage 未配置 | 显示缺失配置类别和安全修复说明；禁用依赖动作 |

## 11. 响应式与可访问性

### Desktop 1440×1000

- Sidebar 248px；主 Paper 最大可用宽度，页面级仅一个 dashed paper boundary。
- 页面内距 32px；表格行约 52px；筛选横排且允许换行。
- 表格横向滚动只发生在标记清楚、`tabindex=0` 的容器中。
- Detail 使用 720–840px Drawer；复杂 Role 使用独立页。

### Mobile 390×844

- 8px canvas，Paper 全宽；导航为 `min(320px,88vw)` Drawer，支持锁焦、Escape、遮罩关闭和归焦。
- 搜索常显，其他筛选进入 Sheet；详情/表单全屏。
- 关键列常显，其余在表格容器内横滚；根节点 `overflow-x: clip`。
- 底部动作考虑 safe area；最后字段至少 96px 余量。

### 通用

- 所有输入有可见 Label、稳定 ID、错误与 `aria-describedby`。
- 触控目标至少 44×44；`focus-visible` 为 2px outline + offset。
- 状态不只依赖颜色；链接有文字/下划线；表头排序有 `aria-sort`。
- `prefers-reduced-motion` 下禁用位移、缩放和非必要过渡。

## 12. 视觉原则

- 关键词：暖纸张、手写笔记、安静工具台；不是默认 Refine/Ant Design 或 AI 蓝紫后台。
- 大面积使用 `--color-bg-app` / `--color-bg-paper`；主文本炭棕；黄色和绿色仅小面积 accent。
- 页面级承载只保留一条 paper dashed border；内部主要依靠留白、字重与行分隔线。
- 静止列表无卡片 shadow；hover 才允许轻派生 shadow。
- 不新增孤立十六进制；Light/Dark 语义 token 对称。
- 字体：本地 Noto Serif SC 标题、Noto Sans SC 正文/控件、IBM Plex Mono 数据与 ID。

## 13. 实施顺序

1. Drizzle schema source 与独立 migration；三表、status、索引和外键。
2. User/Workspace/Story repository 与测试；统一 Resource alias。
3. Dashboard、Storage Admin facade、RBAC permission 与测试。
4. Refine Resources、导航与专用页面/详情。
5. 状态、可访问性、双视口 Playwright；最后回归模型/计费/网关。

## 14. 验收与测试矩阵

| 能力 | 成功路径 | 失败/安全路径 |
|---|---|---|
| User | 查询、筛选、状态 active↔disabled、关联计数 | 401、403、严格 Zod、password_hash 不回显 |
| Workspace | 创建、列表/详情、合法更新、归档 | User FK 409、Owner 不可转移、禁止硬删 |
| Story | 列表/详情、合法字段更新、审核/归档 | Workspace/User FK 或状态 409、content/版本字段拒绝 |
| RBAC | 管理员创建/停用、角色分配、自定义角色 | 内置角色与最后 super admin 保护 |
| Storage | 配置、列表、上传、预览、下载、删除 | 401/403/Origin、无配置、非法 key/MIME/size、审计 |
| Dashboard | 真实数量、最近 Story/操作 | 缺表/查询失败显示不可用而非 0 |
| UI | loading/empty/error/403/404/409 | 1440×1000、390×844、键盘、无根横滚 |
| 回归 | 模型、计费、网关路由 smoke | 无 Secret 泄漏，无旧 PWA 路由恢复 |

发布前命令：`pnpm env:check`、`pnpm exec tsc --noEmit`、`pnpm lint`、`pnpm test:run`、`pnpm build`，以及隔离 PostgreSQL focused Playwright。

## 15. Deprecated 模型计划

旧 `story_workspaces`、`story_projects` 等表不删除。新页面/API 停止依赖；本轮隐藏相关旧菜单。后续单独任务在证明无模型/网关/计费/审计依赖、完成数据保留策略和回滚方案后再退役。

## 16. 合规确认

- 本 PRD 不要求创建数据迁移程序。
- 运行时只有一个 PostgreSQL `DATABASE_URL`。
- 不引入 SQLite 或任何数据库回退。
- 不修改 `ink-dream-memory`。
- 不删除模型、网关、计费、权限或 Storage。
- 不创建或恢复 `app/(app)`。
