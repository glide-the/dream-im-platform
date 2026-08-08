# Ink Memory Admin：剧本数据运营与用户、权限、资源管理 PRD 草案

> 阶段：HTML Design Workflow / Stage 1 — PRD Architect  
> 输入基线：`files/inputs/target_image.png`（1440×1000 Admin）  
> 产品基线：`docs/prd/story-user-resource-admin-prd.md`  
> 视觉基线：`docs/prd/color_system/README.md`、`light-theme.md`、`dark-theme.md`  
> 本文件用途：为后续结构草图、层级逻辑和 UI 设计提供可编码约束；不是新的数据迁移或系统重构方案。

## 1. 产品结论

本轮把当前“可进入但偏技术工作台”的 Admin 外壳，收敛成面向运营人员的专用后台。完成后，管理员应能沿着 **User → Workspace → Story** 的真实业务链查看、筛选、维护合法状态并追溯审计；同时在同一视觉语言下完成管理员/RBAC 与 Storage 资源治理。

本轮仅使用当前项目单一 PostgreSQL `DATABASE_URL → ink-memory`。业务事实表固定为：

```text
users.id BIGINT
  ├──< story_workspace_workspaces.owner_id BIGINT NOT NULL
  └──< story_workspace_stories.author_id BIGINT NOT NULL

story_workspace_workspaces.id TEXT
  └──< story_workspace_stories.workspace_id TEXT NOT NULL
```

关键产品边界：

- Workspace 必须有真实 User owner；Story 必须有真实 Workspace 与 author。
- Story author 与 Workspace owner 必须一致，写入时在 PostgreSQL transaction 内校验。
- User 停用、Workspace/Story 归档保留历史关联，不提供业务数据硬删除。
- Story 正文、内部版本、provenance、计数字段只读；Admin 不能借“编辑”破坏内容结构。
- Password、Token、Session、Provider Key、Storage credential 永不查询、回显或写入审计差异。
- AI 模型、Token 计费、Gateway 保留现状与菜单入口，但不进入本轮页面重构。

## 2. 当前 1440×1000 基线的具象判断

### 2.1 页面模块结构（自上而下、自左至右）

| 区块 | 截图中的实际形态 | 可保留的设计资产 | 本轮必须修正的问题 |
|---|---|---|---|
| A0 全局画布 | 1440×1000 暖米色底，无冷灰渐变 | 暖纸张画布与低饱和氛围 | 主内容底部留有大片无意义空区，页面边界感不完整 |
| A1 左侧品牌区 | 左 248px；约 76px 高；36px 方形 INK 标识、衬线品牌名、等宽小字副标题 | 品牌识别清晰、尺度克制 | 移动端没有对应折叠入口与 Drawer 规则 |
| A2 分组导航 | 248px 固定侧栏；两字符等宽代码 + 中文条目；active 行有米色底和左侧深色竖线 | 分组、代码标、当前项识别可延续 | 菜单混有旧角色/场景/工作流入口；Story/User/RBAC/Storage/Audit 信息架构不完整 |
| A3 账户区 | 侧栏底部固定身份、角色和圆形主题控制 | 管理员身份始终可见 | 控件语义不清；需给主题、账户菜单可见文字/Tooltip 和键盘状态 |
| B0 主区页头 | 左距约 38px；小型等宽面包屑、约 46–48px 中文标题、正文说明、右侧次按钮 | 标题层级强、内容起点稳定 | 标题占高偏大；右侧按钮“审核可追溯”更像说明而非动作 |
| B1 域页签 | 横排“工作区 / 剧本项目 / 角色 / 场景 / 工作流运行”，active 下划线 | 同域切换路径明确 | 页签与本轮三表边界冲突；需改为工作区/剧本，用户与治理模块留在全局导航 |
| B2 数据容器 | 大圆角实线容器；头部、筛选、表头、行、分页层层分隔 | 数据区结构完整，运营扫描路径明确 | 与页面边界形成多重卡片；应改为页面级单一虚线 paper boundary，内部以留白/行线分区 |
| B3 筛选区 | 标题、Workspace ID 手填、审核状态、内容状态；“应用/清除”独立一行 | 服务端筛选意图明确 | 技术 ID 对运营人员不友好；应使用可搜索 User/Workspace 选择器并同步 URL |
| B4 表格区 | 表头含 Story ID、标题、工作区、作者、类型、状态、审核、更新时间、详情；行高约 49px | 字段密度接近后台需要 | ID 过度占据首列；关联字段需成为文本链接；横滚与键盘规则缺失 |
| B5 Loading | 5 条等高横向 skeleton；页头与筛选不抖动 | 保留尺寸的加载思路正确 | skeleton 宽度完全一致，不能表达真实列；缺少完成后的 live region 播报 |
| B6 分页 | 上一页 / 第 1/1 页 / 下一页，位于容器底部 | 位置稳定，易理解 | 未显示总数与 page size；disabled 对比度和移动端布局需定义 |

### 2.2 基线纠偏原则

1. 保留 248px 桌面侧栏、暖纸画布、衬线大标题、等宽 ID/代码、细行分隔和低饱和状态表达。
2. 页面只保留 **一个** 由 `--color-border-paper` 派生的虚线 paper boundary；内部区域不再叠加圆角卡片海。
3. 将“技术主键优先”改为“运营名称优先、主键可复制”：列表首先显示标题/邮箱/名称，ID 放在次行 mono 文本。
4. 将“手填 Workspace ID”改为“输入名称/邮箱搜索后选择真实实体”，仍允许粘贴完整 ID 精确命中。
5. 将散落的详情按钮改为整行明确链接 + 行尾操作菜单；所有高风险动作必须始终可发现，不仅依赖 hover。
6. 将旧 `角色 / 场景 / 工作流运行` 页签从本轮 IA 隐藏；不删除相应代码或数据。

## 3. 目标、角色与成功定义

### 3.1 P0 产品目标

1. 运营人员能在 60 秒内确认用户、Workspace、Story 的真实总量、状态分布和近期变化。
2. 任意 User、Workspace、Story 可沿父子关系双向跳转，并在返回时恢复筛选、页码、滚动和触发行焦点。
3. User、Workspace、Story 的合法写操作形成 Session、permission、Origin、Zod、transaction、audit 完整闭环。
4. 权限管理员能看懂“管理员拥有什么角色、角色拥有什么权限”，并安全维护自定义角色。
5. 资源管理员能确认 Storage 配置能力并完成受保护的列举、上传、预览、下载和删除。
6. 所有页面在 1440×1000 和 390×844 下无根节点横向溢出，键盘可完成主路径。

### 3.2 使用者与权限

| 角色 | 核心任务 | 典型 permission |
|---|---|---|
| 运营查看者 | 查看 Dashboard、User、Workspace、Story | `dashboard.read`、`users.read`、`story.read` |
| 业务运营 | 维护 User 状态、Workspace 与 Story 合法字段 | 查看权限 + `users.write`、`story.write` |
| 资源管理员 | 管理 Storage 文件 | `storage.read`、`storage.write`、`storage.delete` |
| 权限管理员 | 管理管理员、自定义角色和角色分配 | `access.read`、`access.write` |
| 审计员 | 查询不可变审计与权限矩阵 | `audit.read`、`access.read` |
| 超级管理员 | 执行全部后台任务 | 全 permission；仍受所有写入安全链约束 |

### 3.3 成功指标

- 所有列表数字、状态、最近记录来自成功的真实查询；失败不得显示为 0。
- User → Workspace → Story 跳转携带稳定 query 参数，浏览器前进/后退可恢复。
- 无 Session 返回 401；无权限返回 403；外键、版本或受保护规则冲突返回 409。
- API 响应与审计记录中不出现 `password_hash`、secret、Token、Session 或文件内容。
- 模型、计费、Gateway 现有路由 smoke 通过，且未被本轮导航重排破坏。

## 4. 严格范围

### 4.1 本轮页面

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

### 4.2 明确排除

- 不创建任何 `ink-dream-memory → ink-memory` 迁移、导入、ETL、同步或定时任务。
- 不接入第二数据库，不做双 Data Provider、跨库实时查询或本地数据回退。
- 不引入 SQLite、JSON DB、内存数据库。
- 不修改 `/Users/dmeck/project/ink-dream-memory`。
- 不重构 AI 模型、Token 计费、Gateway 页面或领域代码。
- 不删除旧平行表、模型、计费、Gateway、权限或 Storage 底层驱动。
- 不创建或恢复 `app/(app)`。

## 5. Resource、API、数据与权限唯一映射

| 页面 | Refine Resource | API | PostgreSQL 表/驱动 | Read | Write/Delete |
|---|---|---|---|---|---|
| 运营总览 | dashboard virtual | `GET /api/admin/dashboard` | 三张业务表 + `admin_audit_logs` | `dashboard.read` | 无 |
| 平台用户 | `users` | `/api/admin/users` | `users` | `users.read` | `users.write` |
| 工作区 | `story-workspaces` | `/api/admin/story-workspaces` | `story_workspace_workspaces` | `story.read` | `story.write` |
| 剧本 | `stories` | `/api/admin/stories` | `story_workspace_stories` | `story.read` | `story.write` |
| 管理员 | `admin-users` | `/api/admin/admin-users` | `admin_users`、`admin_user_roles` | `access.read` | `access.write` |
| 角色 | `roles` | `/api/admin/roles` | `admin_roles`、`admin_role_permissions` | `access.read` | `access.write` |
| 权限 | `permissions` | `/api/admin/permissions` | `admin_permissions` | `access.read` | 无；migration/bootstrap 管理 |
| 文件存储 | `storage-resources` | `/api/admin/storage-resources` | 现有 S3/Vercel Blob 驱动 | `storage.read` | `storage.write` / `storage.delete` |
| 审计日志 | `audit-logs` | `/api/admin/audit-logs` | `admin_audit_logs` | `audit.read` | 无；append-only |

新页面不得以 `source-users`、`story-stories`、`admin-roles`、`admin-permissions` 等旧别名为主 Resource。兼容别名可暂存，但不出现在用户可见 URL 和导航中。

## 6. 全局页面骨架

### 6.1 1440×1000 桌面结构草图

```text
┌──────────── 248px Sidebar ────────────┬──────────────── 1192px Main Canvas ────────────────┐
│ [INK] Ink Memory                      │ breadcrumb / data updated / theme                  │
│       OPERATIONS CONSOLE              │                                                    │
│───────────────────────────────────────│ Page title + one-sentence goal       [Primary]      │
│ OV  运营总览                          │ Context links / selected filters / permission note  │
│ 剧本数据                              │                                                    │
│ WS  工作区                            │ ┌ · · · one dashed Paper Boundary · · · · · · · ┐ │
│ ST  剧本                              │ │ section heading + secondary action             │ │
│ 用户中心                              │ │ search + visible filters + filter summary       │ │
│ US  平台用户                          │ │────────────────────────────────────────────────│ │
│ 权限管理                              │ │ table/list; flat rows; local horizontal scroll  │ │
│ AU  管理员                            │ │                                                │ │
│ RL  角色                              │ │ empty / error replaces rows, not page shell     │ │
│ PM  权限                              │ │────────────────────────────────────────────────│ │
│ 资源管理                              │ │ total + page size    pagination                 │ │
│ FS  文件存储                          │ └ · · · · · · · · · · · · · · · · · · · · · · ┘ │
│ 系统治理                              │                                                    │
│ AL  审计日志                          │                                                    │
│───────────────────────────────────────│                                                    │
│ Admin identity / role / theme         │                                                    │
└───────────────────────────────────────┴────────────────────────────────────────────────────┘
```

尺寸规则：

- Sidebar 固定 248px；主画布 `min-width: 0`；内容左右内距 32px，顶部 28–32px。
- 页面内容最大宽度不做窄营销页限制；数据表占满可用宽度。
- H1 桌面 40px/1.2，避免当前约 48px 继续挤压首屏；说明正文 14px/1.7。
- 页面级 paper boundary 圆角 12px、虚线 1px；内部 section 只用 1px 行线和 24px 留白。
- 表格默认 52px 行高，密集数据允许 48px，但交互点击目标不得低于 44px。

### 6.2 390×844 移动结构草图

```text
┌────────────────────── 390px ──────────────────────┐
│ [☰] Ink Memory          [theme] [account]          │ 56px sticky header
│ breadcrumb / back                                  │
│ Page title                                         │
│ one-line goal; wraps to max 3 lines                │
│ [Primary action: full or fit-content]              │
│ ┌ · · · · · Paper · · · · · · · · · · · · · · ┐ │
│ │ [Search always visible]      [筛选 3]           │ │
│ │ applied filter chips / clear                    │ │
│ │────────────────────────────────────────────────│ │
│ │ key column / status / updated / row action     │ │
│ │ < local table horizontal scroll >              │ │
│ │ or relation rows for detail                    │ │
│ │────────────────────────────────────────────────│ │
│ │ total                       [上一页] [下一页]   │ │
│ └ · · · · · · · · · · · · · · · · · · · · · · ┘ │
│ [sticky bottom form actions + safe-area inset]     │
└────────────────────────────────────────────────────┘
```

- App canvas 8px；Paper 全宽；根节点 `overflow-x: clip`。
- Sidebar 变为宽 `min(320px, 88vw)` 的左 Drawer，锁焦，Escape/遮罩关闭并归焦到菜单按钮。
- 搜索框常显，其他筛选进入底部 Sheet；Sheet 顶部显示结果计数，底部“应用/清除”。
- Detail Drawer 和创建/编辑表单改为全屏层；最后一个字段后预留至少 96px。
- 表格仅允许标记为“横向滚动区域”的容器滚动，容器 `tabindex=0` 并提供可见提示。

## 7. 全局组件与交互契约

### 7.1 Sidebar / Mobile Navigation

- 组序固定为运营总览、剧本数据、用户中心、权限管理、资源管理、系统治理；保留的模型/计费/Gateway 项置于原有后续分组，不插入本轮业务链。
- 当前项使用左 2px 主文本色竖线、`--color-bg-hover` 轻底和粗体文字共同表达；不得只用颜色。
- 无 `*.read` 权限的页面不展示入口；直接访问仍由服务端返回 403。
- 分组标题、两字符代码为辅助识别，不代替完整中文名称和 `aria-label`。

### 7.2 Page Header

- 第一行：面包屑；列表返回详情时保留 query string。
- 第二行：唯一 H1；右侧最多一个主操作，如“新建工作区”“上传文件”“新建管理员”。
- 第三行：一句具体页面目的；需要时显示“数据更新时间”或 permission 提示。
- “可追溯”“真实数据”等说明不伪装成按钮。

### 7.3 Filter Bar

- 桌面：关键词占 280–360px；其余 Select/Date Range 180–220px；允许换行但不挤压表格。
- 每个控件有可见 Label；不能仅用 placeholder。
- 搜索输入 300ms debounce；Select/日期改变后可立即提交，也可统一由“应用”提交，但全站保持一致。
- 筛选、排序、页码、pageSize 写入 URL；修改筛选时页码回到 1。
- 已生效筛选显示可移除 chip；“清除全部”恢复 Resource 默认排序。
- User/Workspace 关系筛选使用服务端搜索选择器：显示名称/邮箱，次行显示 ID；不可自由输入不存在的值。

### 7.4 Data Table / Relation List

- 首列为人类可读主实体；ID 置于次行 mono，可复制；关联实体使用带文字的链接。
- 桌面 sticky 表头；排序按钮与列名一体，并维护 `aria-sort`。
- 整行可进入详情时仍保留真实链接；行内复选/菜单点击不得触发行跳转。
- 行尾菜单只承载低频动作；查看详情、唯一主动作不得藏在 hover。
- 状态由“图标/短文本/小面积色点”共同表达；禁止整行高饱和填色。
- 本轮不做批量硬删。若以后增加批量操作，必须单独定义权限、最大条数与审计策略。

### 7.5 Drawer / Full-screen Layer

- User、Workspace、Story 详情桌面宽 720–840px 右 Drawer；复杂角色权限编辑采用独立页或 840px Drawer。
- Header 固定：返回/关闭、实体名称、只读 ID；Content 独立滚动；Footer 仅在有写动作时固定。
- 打开后焦点到标题；关闭后焦点回触发行；未保存变更需确认。
- URL 使用 Resource 详情路由，而不是纯临时 Modal，确保刷新可恢复。

### 7.6 Confirmation

- User 停用、Workspace/Story 归档、管理员停用、角色权限变化、Storage 删除均需二次确认。
- 弹层必须说明对象、影响、可否恢复和审计事实；危险动作按钮使用 `--color-state-danger`。
- Storage 删除要求输入完整对象 key；角色权限变更展示增删 diff；最后 active super admin 操作直接阻止并解释。

## 8. 页面功能需求

### 8.1 运营总览

**目标**：一分钟内确认真实规模、停用风险与近期变化。  
**角色**：拥有 `dashboard.read` 的管理员。  
**API**：`GET /api/admin/dashboard`。

页面结构：

1. 页头显示“运营总览”、数据来源“ink-memory”和最近成功刷新时间。
2. Paper 顶部为三组平铺指标行，不做卡片海：User 总数/active/disabled；Workspace 总数/active/archived；Story 总数/status 分布。
3. 中部左右两列：最近更新 Story（最多 5）与最近管理操作（最多 5）；窄屏纵向堆叠。
4. 每个数字和条目是可解释链接，例如 disabled User → `/admin/users?status=disabled`。

禁止：虚构趋势、增长百分比、健康分、随机图表、失败后显示 0。单组查询失败仅替换该组为“暂不可用 + 重试 + Request ID”。

验收：空库显示“尚无用户/Workspace/Story”的系统空状态；缺表显示 schema readiness 错误；成功时数字与服务端聚合一致。

### 8.2 Workspace 列表、创建与详情

**Resource / API / Table**：`story-workspaces` / `/api/admin/story-workspaces` / `story_workspace_workspaces`。  
**默认排序**：`updated_at desc`。

列表：

| 类别 | 字段/规则 |
|---|---|
| 主列 | `name`；次行 `id` mono + 复制 |
| 关联列 | owner display name/email，点击进入 User 详情 |
| 业务列 | `status`、Story count、`created_at`、`updated_at` |
| 筛选 | name contains、owner_id eq、owner_email contains、status eq |
| 排序 | name、story_count、created_at、updated_at |
| 行动作 | 查看、编辑合法字段、归档；无硬删、无 owner 转移 |

创建表单：

- `name` 必填，1–120 字符；自动 trim，空白名拒绝。
- `owner_id` 必填，通过真实 User 搜索选择；User 不存在或已不允许创建关系时返回 409。
- `settings` 可选，默认使用安全的结构化字段表单；未知但合法 JSON 在“高级设置”只读预览，不用通用 JSON Workbench 代替业务字段。
- 新建默认 `status=active`；创建成功进入详情并显示审计事件。

详情顺序：基本信息 → 所属 User → Story 子列表 → Settings → 时间事实 → 相关审计。Story count 点击进入 `stories?workspace_id=...`；子列表最多展示 10 条并提供“查看全部”。

合法编辑：`name`、受白名单保护的 settings、`status` 具名命令。归档说明 Story 不会被删除；若业务规则不允许带 active Story 归档，服务端返回 409 并列出阻塞数量。

### 8.3 Story 列表、详情、审核与归档

**Resource / API / Table**：`stories` / `/api/admin/stories` / `story_workspace_stories`。  
**默认排序**：`updated_at desc`。

列表：

| 类别 | 字段/规则 |
|---|---|
| 主列 | `title`，无标题时显示“未命名剧本”；次行 identifier/id mono |
| 关联列 | Workspace 名称、author 用户；均为文字链接 |
| 业务列 | type、status、review_status、character_count、scene_count、updated_at |
| 筛选 | title/identifier、workspace_id、author_id、status、review_status、type |
| 排序 | title、created_at、updated_at |
| 行动作 | 查看、编辑合法字段、confirm/reject、archive |

详情结构：

1. 身份：title、identifier/id、type。
2. 归属：Workspace 与 User；若关系异常显示“关系异常”警告和只读技术信息，不制造替代实体。
3. 内容：description、content、结构化 metadata。
4. 状态时间线：status、review_status、created/updated/reviewed/archived 时间事实。
5. 关联审计：仅显示本 Story 的最近管理动作。

内容展示：

- Markdown：使用安全 sanitizer 的只读排版；外链标识目标，不执行 HTML/script。
- JSON：先验证可解析；树形折叠默认展开前两层，提供“复制 JSON”；不允许行内修改。
- 未知长文本：保留换行，`overflow-wrap:anywhere`，单区最大高度 480px 后局部滚动。
- 空内容：显示“该剧本尚无正文”，不显示空白卡片；解析失败显示原始只读文本和错误说明。

合法编辑仅限 `title`、`description`、`type`；confirm/reject/archive 使用具名命令。`content`、author/workspace、计数、内部版本、agent/provenance、ID、时间事实只读。Reject 必填原因；操作成功写入 before/after audit。

### 8.4 平台用户

**Resource / API / Table**：`users` / `/api/admin/users` / `users`。  
**默认排序**：`updated_at desc`。

| 类别 | 字段/规则 |
|---|---|
| 列表 | display_name/email、role、status、Workspace count、Story count、created_at、updated_at |
| 筛选 | email/display_name contains、role eq、status eq |
| 排序 | email、created_at、updated_at、Workspace count、Story count |
| 合法编辑 | display_name、avatar_url、status |
| 禁止 | 从 Admin 创建密码、重置业务用户密码、硬删、回显任何凭据 |

详情顺序：安全资料 → 状态 → Workspace 关联列表 → Story 关联列表 → 管理审计。Workspace/Story 数量均可进入带 `owner_id`/`author_id` 的过滤列表。

停用确认明确说明：用户不能继续使用业务能力，但历史 Workspace、Story 和审计不删除。并发状态变化返回 409 时，显示“你看到的值 / 服务器最新值”，提供刷新后重试，不静默覆盖。

### 8.5 管理员

**Resource / API / Table**：`admin-users` / `/api/admin/admin-users` / Admin RBAC 表。  
**列表**：email、display_name、roles、status、last_login_at；筛选 email/status/role。

允许：创建管理员、编辑显示名、设置新密码、分配角色、停用。email 创建后不可改；不硬删。密码输入至少 14 字符，不提供当前密码回填或“显示已保存密码”。

角色分配以当前服务器值为起点；保存前展示新增/移除角色 diff 与受影响权限摘要。最后 active super admin 不可停用，也不可移除其 super_admin 角色；错误应为可理解的 409，而非通用 500。

### 8.6 角色

**Resource / API / Table**：`roles` / `/api/admin/roles` / `admin_roles` + `admin_role_permissions`。

- 列表显示 name、code、type（内置/自定义）、permission count、admin count、updated_at。
- 筛选 name/code、type；排序 name、updated_at。
- 自定义角色允许创建、改名称/描述/权限集合、删除；code 创建后只读。
- `super_admin`、`operator`、`auditor` 等内置角色禁止删除；受保护字段不可改。
- 权限矩阵按 `dashboard/users/story/access/storage/audit` 域分组，行是 permission，列是 read/write/delete 等能力；每个 checkbox 有完整 label。
- 保存前显示权限增删 diff、受影响管理员数量与高风险权限警告。

### 8.7 权限

**Resource / API / Table**：`permissions` / `/api/admin/permissions` / `admin_permissions`。  
该页面只读，不提供新建、编辑、删除按钮。permission 由 migration/bootstrap 管理。

页面按业务域分组，显示 code、name、description、拥有该权限的角色数量。支持 code/name 搜索；点击角色数量进入 `roles?permission=...`。页面顶部明确“权限定义由系统发布管理”，避免运营人员误认为是缺失功能。

### 8.8 Storage 文件资源

**Resource / API / Driver**：`storage-resources` / `/api/admin/storage-resources` / 现有 S3 或 Vercel Blob 驱动。

页面结构：

1. 顶部 capability strip：driver 类型、list/upload/preview/download/delete 可用性、最近刷新时间；不得显示 endpoint secret、bucket credential。
2. 筛选：key/filename contains、MIME prefix/eq、时间范围；排序 key、size、uploaded/modified time。
3. 列表：filename、object key（mono + copy）、MIME、格式化 size、时间、driver、可用动作。
4. 上传 Drawer：可见文件 Label、单文件大小上限、允许 MIME、prefix；校验失败保留文件名/大小信息，要求重新选文件时明确说明。
5. Preview：仅安全支持的图片/文本/PDF 类型；不支持类型显示元信息和下载，不尝试内联执行。
6. Delete：必须输入完整 object key；只删除严格 Zod 校验后的精确 key，成功审计 actor/key/metadata。

状态：

- 未配置：显示缺失“驱动/端点/授权类别”，不给出 credential 值；禁用依赖动作并提供安全修复路径。
- 驱动不支持 list：显示 capability error，不制造假列表。
- 上传/删除失败：保留筛选和对象上下文，显示 Request ID、重试或返回动作。
- 文件内容不写 PostgreSQL；底层 Storage 驱动不得删除或替换。

### 8.9 审计日志

**Resource / API / Table**：`audit-logs` / `/api/admin/audit-logs` / `admin_audit_logs`。  
只读且 append-only。

- 列表字段：created_at、actor、action、resource_type、resource_id、request_id、结果。
- 筛选：actor、action、resource_type/id、时间范围；默认 `created_at desc`。
- 详情：脱敏 before/after、metadata、请求关联；JSON 采用安全只读 viewer。
- resource 能映射到 User/Workspace/Story/Storage/RBAC 时提供文字链接；无法映射时保留原 ID，不创建占位实体。
- Password、secret、Token、Session、Storage 文件内容不得出现在 before/after 或 metadata。

## 9. 列表、API 与写操作契约

### 9.1 列表查询

- `page >= 1`；`pageSize ∈ {20, 50, 100}`，默认 20。
- 单字段白名单排序；筛选仅支持资源定义的 `eq`、`contains`、`in`、时间范围。
- API 响应统一为 `{ data, meta: { total, page, pageSize, totalPages } }`。
- 仅在查询成功且 `total=0` 时显示 Empty；失败不得伪装成空数据。
- Repository/Query 层执行参数化 SQL、关联计数和敏感字段白名单；Route Handler 不承载复杂业务逻辑。

### 9.2 所有写操作

执行顺序必须包含：

1. 验证管理员 Session；
2. 服务端验证对应 permission；
3. 验证 Origin；
4. 严格 Zod Schema 拒绝未知字段；
5. 调用 `app/lib/**` Repository/Mutation；
6. 在 PostgreSQL transaction 内校验关系并更新；
7. 写入脱敏 before/after audit；
8. 返回统一成功或错误结构。

Refine 按钮隐藏只是 UX，不是授权边界。

## 10. 状态与恢复

| 状态 | 页面行为 | 恢复动作 |
|---|---|---|
| Loading | 保留 Sidebar、Page Header、Filter 与表头高度；按真实列宽绘制 skeleton | 完成后 `aria-live=polite` 播报“已加载 N 条” |
| 系统 Empty | 解释尚无业务数据；只显示该角色允许的创建动作 | 创建 Workspace/上传文件，或返回父实体 |
| 筛选 Empty | 显示当前筛选摘要，不暗示系统无数据 | 移除单个筛选或清除全部 |
| 关系 Empty | 在 User/Workspace 详情说明“尚无关联 Story/Workspace” | 返回父实体或进入允许的创建路径 |
| 400 | 表单保留输入；顶部错误摘要聚焦首个错误字段 | 修改后重试 |
| 401 | 不显示残留保护数据；转登录且只携带安全 return URL | 登录后恢复目标路由 |
| 403 | 显示所需 permission；受限写控件不渲染 | 返回可访问模块 |
| 404 | 说明实体可能已归档/不存在 | 返回保留 query 的列表并恢复焦点 |
| 409 | 展示服务器最新值、冲突关系/受保护规则；保留草稿 | 刷新比较后重试，不强制覆盖 |
| 500/503 | 说明失败范围、Request ID；不切换数据源 | 重试该区域或返回安全页面 |
| Storage 未配置 | 显示 capability 和缺失配置类别，不泄密 | 按部署说明修复后重新检查 |

## 11. 视觉系统与 Token

### 11.1 视觉语言

关键词是 **“暖纸张、手写笔记、安静工具台”**。不得套用默认 Refine/Ant Design 蓝色后台、蓝紫 AI 渐变、冷灰企业面板、霓虹、高饱和整卡状态或多层 shadow 卡片海。

### 11.2 Token 约束

| 语义 | Light | Dark | 使用 |
|---|---|---|---|
| App canvas | `--color-bg-app` / `#f8f0e6` | `#1f1b16` | 页面大面积背景 |
| Paper | `--color-bg-paper` / `#fffef9` | `#2a251e` | 主阅读/数据面 |
| Solid popover | `--color-bg-surface-solid` / `#ffffff` | `#332d25` | Menu/Tooltip/Popover |
| Paper border | `--color-border-paper` / `#d0c4b0` | `#5a4d3d` | 单一虚线页边界、行分隔 |
| Primary text | `--color-text-primary` / `#2c2c2c` | `#f3eee6` | 标题、主操作 |
| Body / secondary | `--color-text-body`、`--color-text-secondary` | 对称暖白/暖灰 token | 正文、元信息 |
| Primary action | `--color-action-primary` | 暗色需用深色前景保证对比 | 唯一主按钮 |
| Link | `--color-action-link` | 暗色 muted blue | 关联实体和恢复动作 |
| Success/warning/danger | `--color-state-*` | 对称暖色 token | 小面积状态点、图标、短标记 |

- 新组件只引用集中 CSS variables / Tailwind 4 theme 映射，不散落孤立十六进制。
- 普通列表静止态无 shadow；真正浮层才用 `--color-shadow-medium`。
- Dark 不是简单反色：保持深暖棕画布、深纸面与暖白文字，不使用纯黑冷蓝后台。
- 状态不可只用颜色；必须搭配文字和图标。

### 11.3 字体、密度与形状

- Admin 标题：本地 Noto Serif SC/可用中文衬线，40/32/24px 层级；不加载远程字体。
- 正文与控件：Noto Sans SC/系统无衬线，14–16px；表头 12px，适度 letter spacing。
- ID、permission code、object key、request ID：IBM Plex Mono/系统等宽，11–13px。
- 间距基线 4px；常用 8/12/16/24/32px。
- 圆角：输入 6px，Paper/Drawer 12px，状态 badge 999px；不把每行做成圆角卡片。
- Focus：2px `--color-border-focus` outline + 2px offset；不可被 overflow 裁剪。
- Hover/focus 过渡 160–240ms；`prefers-reduced-motion` 下移除位移、缩放和非必要过渡。

## 12. 响应式与无障碍验收

### 12.1 1440×1000

- Sidebar 248px 稳定；主内容无页面级横滚；首屏至少显示筛选、表头和 6 条 52px 数据行或等高 loading。
- Filter 最多两行；不会因为 4–6 个筛选压缩首列至不可读。
- Detail 720–840px；主内容保留上下文但不可接受焦点。
- Paper 内横滚时 Sidebar 与 Page Header 不移动。

### 12.2 390×844

- 页面顶栏 56px；导航 Drawer、筛选 Sheet、详情全屏层均有焦点锁定、Escape、遮罩关闭和归焦。
- 搜索常显；筛选按钮显示已生效数量；主操作不会与标题同排挤压。
- 触控目标至少 44×44；底部操作含 `env(safe-area-inset-bottom)`。
- 表格关键列可读；横滚只发生在容器；页面根节点宽度不超过 viewport。

### 12.3 通用无障碍

- 所有输入有可见 Label、稳定 ID、错误描述与 `aria-describedby`。
- Dialog/Drawer 有语义标题；打开/关闭焦点顺序可预测。
- 排序维护 `aria-sort`；分页 disabled 使用真实 `disabled`。
- Toast 不承载唯一错误信息；错误同时显示在相关区域。
- 加载完成、保存成功、冲突发生由合适的 live region 播报。

## 13. 技术实现建议

1. `app/lib/db/schema.ts` 是唯一 Drizzle schema 来源；缺表/字段通过 PostgreSQL migration 修正，不建平行模型。
2. User、Workspace、Story、Storage Admin 通过 `app/lib/**` Repository/Query/Mutation 访问；Route Handler 只编排鉴权、解析、Zod 和调用。
3. Refine Data Provider 把 server pagination/sort/filter 映射为统一查询参数；Resource URL 使用本 PRD 的 canonical 名称。
4. 页面专用组件建议：`AdminPageHeader`、`AdminPaper`、`ServerFilterBar`、`EntityLink`、`StatusMark`、`AdminDataTable`、`DetailDrawer`、`ConflictPanel`、`SensitiveConfirmDialog`、`JsonReadOnlyViewer`、`StorageCapabilityStrip`。
5. 页面状态组件共享，但文案与恢复动作按 Resource 定制；不得回退成通用 JSON CRUD Workbench。
6. Markdown/JSON/文件预览必须采用安全 renderer；未经信任的 HTML 不执行。
7. 列表查询使用白名单排序和参数化 SQL；常用 `owner_id/workspace_id/author_id/status/updated_at` 筛选排序建立索引。
8. 所有更新携带版本或最新 `updated_at` 条件以检测并发；0 行更新转 409。

## 14. 端到端主路径

### 14.1 User → Workspace → Story

1. 运营人员在平台用户按邮箱搜索并进入详情。
2. 点击 Workspace count，进入带 `owner_id` 的 Workspace 列表。
3. 点击 Workspace 名称进入详情；返回时恢复 User 上下文。
4. 点击 Story count，进入带 `workspace_id` 的 Story 列表。
5. 点击 Story，查看内容、状态时间线与审计；可跳转 author User 或父 Workspace。
6. 返回列表后恢复筛选、页码、滚动和触发行焦点。

### 14.2 RBAC 变更

1. 权限管理员进入管理员详情查看当前角色。
2. 打开角色选择器；候选项显示角色名称、code、权限数量。
3. 保存前确认新增/移除角色 diff 与受影响权限。
4. 服务端检查最后 active super admin 保护并在 transaction 内更新、审计。
5. 成功后详情显示服务器新状态；失败保留选择并给出可恢复说明。

### 14.3 Storage 删除

1. 资源管理员在 Storage 列表搜索并打开文件详情/预览。
2. 选择删除；对话框显示 key、MIME、size、不可恢复说明。
3. 输入完整 object key；服务端验证 `storage.delete`、Origin、Zod exact key。
4. 驱动删除成功后写审计并返回列表；失败保留对象上下文和 Request ID。

## 15. 验收矩阵

| 能力 | 成功路径 | 必测失败/安全路径 |
|---|---|---|
| Dashboard | 真实数量、状态分布、最近 Story/操作 | 单查询失败显示不可用；空库与缺表区分 |
| User | 搜索、排序、分页、状态 active↔disabled、关联跳转 | 401/403、严格 Zod、敏感字段不回显、并发 409 |
| Workspace | 创建、详情、合法编辑、归档、Story 计数 | User FK 409、owner 不可转移、禁止硬删 |
| Story | 列表/详情、长内容读取、合法编辑、审核、归档 | Workspace/User 冲突、只读字段拒绝、reject reason 必填 |
| Admin | 创建、停用、设置新密码、角色分配 | 最后 active super admin 保护、密码不回填 |
| Role/Permission | 自定义角色、权限矩阵、只读 permission | 内置角色保护、diff 确认、无 permission CRUD |
| Storage | capability、列表、筛选、上传、预览、下载、删除 | 未配置、非法 key/MIME/size、权限/Origin、删除审计 |
| Audit | 筛选、详情、关联跳转 | append-only、脱敏、无文件内容/secret |
| UI | Light/Dark、loading/empty/error、返回恢复 | 1440×1000、390×844、键盘、焦点、无根横滚 |
| 回归 | 模型、计费、Gateway 路由可访问 | 未重构其页面、未泄漏 Secret、未恢复业务前台 |

发布前至少执行：`pnpm env:check`、`pnpm exec tsc --noEmit`、`pnpm lint`、`pnpm test:run`、`pnpm build`，以及使用明确隔离 PostgreSQL 的 focused Playwright。禁止迁移或清理未知数据库。

## 16. 完成定义

- 本 PRD 中每个页面都有目标、角色、Resource、API、表/驱动、字段、筛选、排序、动作、permission、状态、关联跳转与双视口行为。
- 核心页面是运营专用列表、详情和表单，不是通用 JSON CRUD Workbench。
- 三张业务表关系、只读字段、软状态、外键与冲突处理在 UI 和 API 中一致。
- Light/Dark 使用集中语义 Token；页面仅一条虚线 paper boundary；普通列表无多层卡片与 shadow。
- 所有敏感和高风险操作均有服务端权限、Origin、Zod、transaction、审计和二次确认。
- 未创建数据迁移/同步程序；运行时只有一个 PostgreSQL；未引入 SQLite；未修改 `ink-dream-memory`；未删除或重构模型、网关、计费、权限或 Storage；未恢复 `app/(app)`。
