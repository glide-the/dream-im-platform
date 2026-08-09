# Dream Workspace / Story 数据可见性修复交互设计

> 版本：1.0  
> 日期：2026-08-09  
> PRD：[`ink-memory-admin-prd-v3.md`](../prd/ink-memory-admin-prd-v3.md#31-dream-workspace--story-数据运营纠偏2026-08-09)  
> 审计：[`story-workspace-data-visibility-audit.md`](../verification/story-workspace-data-visibility-audit.md)

## 1. 设计目标与边界

两个页面是 canonical Dream 业务数据的运营读面，不是第二个 Story 编辑器。它们直接消费 `ink-memory.public` 的 `users`、`story_workspace_workspaces`、`story_workspace_stories`；Repository 保留受控名称/settings/metadata 更新与 review 命令，页面不创建/删除 Workspace/Story、不修改正文、不修复真实关系。

统一合同：

| 页面 | Refine Resource | API | 主表 | 权限 |
|---|---|---|---|---|
| Workspace | `story-workspaces` | `/api/admin/story-workspaces` | `story_workspace_workspaces` | `story.read` / `story.write` |
| Story | `story-stories` | `/api/admin/story-stories` | `story_workspace_stories` | `story.read` / `story.write` |
| User relation | `users` | `/api/admin/users` | `users` | `users.read` |

`stories` 只能作为短期 HTTP compatibility alias；页面、关系控件、query key、invalidate 和导航不得使用它。

## 2. 页面信息架构

### 2.1 Desktop 1440×1000

```text
┌ fixed Admin sidebar 248 ─┬──────────────── main, min-width:0 ────────────────┐
│ Story / Workspaces       │ Breadcrumb · data source status · refresh         │
│ Story / Stories          │ H1 + explanation                    N records      │
│                          │ Query bar: keyword | relation | status | dates     │
│                          │ Active-filter summary · clear                      │
│                          │ ┌ local horizontal scroll table ─────────────────┐ │
│                          │ │ primary + ID | relations | status | timestamps │ │
│                          │ └─────────────────────────────────────────────────┘ │
│                          │ range / total       server pagination             │
└──────────────────────────┴────────────────────────────────────────────────────┘
                                                   ┌ right Drawer 560–640px ─┐
                                                   │ header / copy ID / close │
                                                   │ relation health          │
                                                   │ safe read-only sections  │
                                                   │ allowed commands         │
                                                   └───────────────────────────┘
```

- 页面主区 `min-width:0`；table wrapper 自身横滚，document overflow ≤1px。
- Query Bar 优先顺序：关键词、主要关系、状态、更新时间、清除、刷新。
- Drawer 宽 `min(640px, 46vw)`，固定 header/footer，中段滚动；关闭后焦点回到触发行。

### 2.2 Mobile 390×844

```text
┌ topbar: menu · title · refresh ┐
│ keyword [____________] [筛选 3]│
│ active filters · 清除          │
│ ┌ compact row/card ──────────┐ │
│ │ Name / Title       status  │ │
│ │ mono short ID + copy       │ │
│ │ owner / workspace / author │ │
│ │ updated · count/type       │ │
│ └────────────────────────────┘ │
│ previous · range · next        │
└────────────────────────────────┘

Filter button → full-width bottom/full-screen sheet
Row → full-screen detail Drawer, safe-area footer
```

- 主识别信息、status、核心 relation、updated time 保留；created time、辅助 ID 可进入详情。
- 筛选 Sheet 内顺序与 Desktop 一致；Apply 后关闭并聚焦“筛选”按钮，显示启用数量。
- 长 ID/Email 使用 `overflow-wrap:anywhere`；复制按钮 44×44；不得靠横向拖动完成主任务。

## 3. Workspace 页面

### 3.1 列表字段

| 数据项 | Desktop 表现 | Mobile 表现 | 行为 |
|---|---|---|---|
| 工作区名称 | 第一列主文本 | 卡片首行 | 点击打开详情 |
| Workspace ID | mono 全值/安全截断 | mono short + copy | Copy accessible name 包含“Workspace ID” |
| 所属用户 | Email/显示名；下一行真实 User ID | Email/显示名 | 进入 `/admin/resources/users?id=<id>` 或 canonical User detail |
| Billing identity | 辅助 tag：已绑定/未绑定 | 详情内 | 仅诊断，不决定记录是否显示 |
| 状态 | `active/archived` 文本 tag | 首行右侧 | 不只靠颜色 |
| 剧本数量 | 整数，链接 | `N 个剧本` | 进入 `/admin/story/stories?workspace_id=<id>` |
| 创建时间 | locale datetime + timezone title | 详情 | mono/tabular |
| 更新时间 | locale datetime + timezone title | 卡片底部 | 默认降序 |

### 3.2 筛选器

| 筛选 | 控件 | URL/API |
|---|---|---|
| 工作区名称 | text，300ms debounce 或 Apply | `name=<value>` → `filter[name][contains]` |
| 所属用户 | 可搜索 relation combobox | `owner_id=<string>` → `filter[owner_id][eq]` |
| 状态 | Select：全部/active/archived | `status=<enum>` |
| 更新时间 | 起止 datetime/date range | `updated_from`、`updated_to` |
| 清除筛选 | Button | 删除全部 canonical filter query，不保留旧参数 |

关系 option 显示 `display_name/email · user id`；搜索由 `/api/admin/users` 服务端分页，不把第一页当全集。

### 3.3 Workspace Drawer

分区：

1. 身份：名称、完整可复制 Workspace ID、status。
2. 所属用户：真实 User ID、Email/显示名、User 详情链接、Billing identity 状态。
3. 关系：Story count、进入过滤后 Story 列表、relation health。
4. Settings：格式化只读 JSON；编辑模式仍走严格白名单 schema，不显示 Secret。
5. 时间：created/updated，明确时区。

若 owner relation 缺失，主 Workspace 仍可显示；Drawer 顶部显示 `relation_mismatch`，详情 User 链接禁用，提供复制 request ID/刷新，不将其伪装为 0 数据。

## 4. Story 页面

### 4.1 列表字段

| 数据项 | Desktop 表现 | Mobile 表现 | 行为 |
|---|---|---|---|
| 剧本标题 | 第一列主文本 | 卡片首行 | 打开详情 |
| Story ID | mono + copy | mono short + copy | API string |
| 所属工作区 | name；辅助 Workspace ID | 第二行 | `/admin/story/workspaces?id=<id>` 或详情 |
| 作者 | Email/显示名；辅助 User ID | 第二/三行 | canonical User detail |
| 类型 | `short/long/script/outline` 本地化 tag | card meta | 完整枚举 |
| 审核状态 | `pending/confirmed/rejected` tag | 首行/次行 | 完整枚举 |
| 业务状态 | `draft/published/archived` tag | 首行右侧 | 完整枚举 |
| 更新时间 | datetime | card footer | 默认降序 |

### 4.2 筛选器

| 筛选 | 控件 | URL/API |
|---|---|---|
| 标题 | text | `title` / contains |
| 工作区 | 可搜索 relation combobox | `workspace_id` / eq |
| 作者 | 可搜索 canonical User combobox | `author_id` / eq |
| 类型 | Select | `type` / eq |
| 审核状态 | Select | `review_status` / eq |
| 业务状态 | Select | `status` / eq |
| 更新时间 | 起止 date range | `updated_from`、`updated_to` |

不再使用“标题、工作区或用户”的虚假单字段标签。若未来增加全局 `q`，Repository 必须明确 OR 搜索白名单列，并让 count/data 共用同一 predicate。

### 4.3 Story Drawer

分区：

1. 基础信息：title、identifier、Story ID、type。
2. 真实 Workspace：name/ID/link/relation health。
3. 真实作者：display name/email/User ID/Billing identity 状态。
4. 状态：review/status、confirmed/published 时间、允许的 confirm 命令。
5. 结构摘要：`content_length`、character_count、scene_count、agent-generated、安全 review note summary；不返回正文或未经批准的内部结构。
6. 时间：created/updated。

详情 API 不应把 `content` 发到浏览器后再隐藏。内部结构摘要由 Repository/DTO 在服务端派生；敏感字段 deny-by-default。

## 5. 状态机与恢复

| 状态 | 标题/说明 | 主动作 | 语义 |
|---|---|---|---|
| Loading | 保留表头的 5 行 skeleton | 无 | `aria-busy=true`，不播报0 |
| System empty | “尚无真实工作区/剧本” | 刷新；无伪造创建 | SQL/API total=0 且无筛选 |
| Filter empty | “没有匹配当前筛选的记录” + 条件 chips | 清除筛选 | 有至少一个 canonical filter |
| 400 | “筛选或排序字段无效” | 重置查询参数 | 显示安全字段名，不显示 SQL |
| 401 | 不渲染表格数据 | 重新登录并返回原 URL | 清除保护内容 |
| 403 | “缺少 story.read” | 返回可访问模块 | 不显示0或记录是否存在 |
| 404 | “关联记录不存在” | 返回列表/清 relation filter | Detail/relation only |
| 409 | “关系或状态已变化” | 载入最新值 | 保留草稿；显示 request ID |
| 500 | “Story 服务发生异常” | 重试/复制 request ID | 不显示 stack/SQL/Secret |
| 503 | “PostgreSQL 数据源不可用” | 重试/查看连接诊断 | 明确依赖 `ink-memory/public`，不回退 |
| Source mismatch | “数据源或关系不一致” | 刷新/复制诊断 ID | 展示主记录，关系位置降级 |

Header 计数规则：只有成功 response 才显示 `N 条记录`；Loading 显示“读取中”；Error 显示“计数不可用”。Table body 在错误时不追加普通 empty row。

## 6. URL、分页、排序与 cache

- Canonical query keys：`page`、`pageSize`、`sort`、`order` 与本页定义的 filters。关系导航只写这些 key。
- 初次加载解析 URL；Apply/clear/pagination/sort 都 `router.replace` 同步 URL，浏览器前进/后退重新驱动 query state。
- 未知 `filter[...]` 或旧 alias 参数返回/显示 400 recovery，并提供“重置为默认列表”；清除后 reload 不得恢复。
- 服务端 pageSize 12/20，最大100；显示 `第 a–b 条，共 N 条`，total 与 data predicates 相同。
- 所有 Story list/detail/update/command 使用 `story-stories` query key。成功写入后失效：当前 Story detail/list、所属 Workspace detail/list、author User detail/list；Workspace 更新失效 Workspace list/detail。
- 数据导入是外部运维事件，页面 focus/reconnect/手动 refresh 必须触发 re-fetch；不使用永久持久化空结果。

## 7. 无障碍与响应式验收

- Table caption、`scope=col`、sortable header `aria-sort`；local scroll wrapper 可聚焦并有说明。
- Drawer/Dialog 锁焦，Escape 关闭，关闭/成功后归焦；错误 `role=alert`，后台刷新 `aria-live=polite`。
- Filter labels 与 controls 稳定关联；relation combobox 支持键盘输入、上下选择、Escape 关闭。
- 状态同时有文字；copy 成功播报，不依赖颜色或 tooltip。
- 1440×1000：sidebar+main 无 document 横滚，Drawer 打开仍≤1px；table 可局部横滚。
- 390×844：无 document 横滚；filter/detail 全屏，safe-area footer 不遮最后一项；200% 字号仍可清筛/关闭。

## 8. 自动化验收映射

| ID | 验收 |
|---|---|
| SV-01 | SQL Workspace count = API `meta.total` = clean UI total |
| SV-02 | SQL Story count = API `meta.total` = clean UI total |
| SV-03 | 页面只请求 canonical `/api/admin/story-stories`，无独立 `stories` cache |
| SV-04 | 无 Session 307/401；auditor write 403；story.read 允许读 |
| SV-05 | User 无 Billing identity 时，其 Workspace/Story 仍显示并标注未绑定 |
| SV-06 | Workspace→Story、User→Workspace→Story canonical URL关系导航正确 |
| SV-07 | text/status/type/review/relation/date filters、sort、page、clear正确；clear reload不复活 |
| SV-08 | system empty与filter empty selector/文案不同 |
| SV-09 | 400/500/503不渲染普通空表；relation mismatch有专用诊断 |
| SV-10 | Story list/detail payload 不含正文、password hash或Secret |
| SV-11 | 1440×1000、390×844 document overflow≤1px，Drawer/Filter可键盘完成 |
| SV-12 | Storage、Provider、Gateway、Billing、RBAC不回归；移除PWA路由404 |

## 9. 实现门禁

审计、主 PRD 与本交互稿均完成后才可修改 `app/**`。实现不得修改 Dream 仓库、不得新增平行业务表、不得迁移/写共享数据库；关系异常、503 与缺 Billing identity 在 disposable PostgreSQL fixture 中验证。
