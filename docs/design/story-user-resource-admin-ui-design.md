# Story / User / Resource Admin 交互设计稿

> **专项历史版本 / 已被替代：** 当前交互分别见 [`modules/01-platform-users.md`](modules/01-platform-users.md) 和 [`modules/02-story-operations.md`](modules/02-story-operations.md)。

> 版本：1.0  
> 日期：2026-08-08  
> 适用 PRD：`docs/prd/story-user-resource-admin-prd.md`  
> 设计工作流：PRD Architect → Structure Sketch → Hierarchy Logic → UI Art Director  
> 详细阶段产物：`files/workspace/1_prd_draft.md`、`2_structure_sketch.md`、`3_hierarchy_logic.md`、`4_ui_design.md`

## 1. 设计裁决

视觉定义为 **Warm-paper Quiet Operations Desk（暖纸张安静运营台）**。当前 1440×1000 基线的 248px Sidebar、暖纸画布、衬线标题、等宽事实信息和低饱和表格继续保留；默认 Refine/Ant Design、蓝紫 AI、冷灰企业后台、霓虹、玻璃态和卡片海不进入本轮实现。

核心规则：

1. 每个页面只有一个 dashed Paper Boundary；内部用留白、字重、轻纸面和 1px 行分隔线组织。
2. 静止列表行无阴影；只有 Drawer、Dialog、Popover 等真实浮层使用 shadow。
3. 实体以名称/标题/邮箱为主识别，ID 为次行 Mono + Copy；关系必须是具名链接。
4. 黄色、绿色、蓝色和红色只承担小面积 accent/状态/链接，不铺满整行或整卡。
5. 状态始终为文字 + dot/icon/shape；不得只靠颜色。
6. 只设计 Dashboard、User → Workspace → Story、Admin → Role → Permission、Storage、Audit；模型、计费、网关保留现状。

## 2. 设计 Token

最终代码只在 `app/globals.css`/主题入口集中定义 Token；页面不得出现孤立十六进制色。

### 2.1 Light / Dark

| Token | Light | Dark | 用途 |
|---|---:|---:|---|
| `--color-bg-app` | `#F6EFE5` | `#1F1B16` | App 画布 |
| `--color-bg-paper` | `#FFFAF2` | `#2A251E` | 主 Paper |
| `--color-bg-surface-solid` | `#FFFDF8` | `#332D25` | Drawer/Popover 实底 |
| `--color-bg-hover` | 主操作棕 5% mix | 白 8% | 行/控件 hover |
| `--color-bg-active` | 链接蓝 12% mix | muted blue 18% | selected 辅助底 |
| `--color-text-primary` | `#3F3429` | `#F3EEE6` | 标题、主事实 |
| `--color-text-body` | `#4B3F33` | `#EEE8DF` | 正文/主要数据 |
| `--color-text-secondary` | `#7A6A59` | `#C8BCAE` | Label/说明 |
| `--color-text-muted` | `#9A8A78` | `#9F9283` | 重复元信息 |
| `--color-action-primary` | `#5F4A36` | `#F3EEE6` | 主动作 |
| `--color-text-on-action` | `#FFFFFF` | `#1F1B16` | 主动作前景 |
| `--color-action-link` | `#4A90E2` | `#81B7D2` | 关系链接/链接下划线 |
| `--color-border-paper` | `#D8C7B3` | `#5A4D3D` | Paper/分隔 |
| `--color-border-neutral` | `#E0D6C8` | `#4A4238` | 控件边框 |
| `--color-border-focus` | `#3F3429` | `#F3EEE6` | 键盘 focus |
| `--color-state-success` | `#277B50` | `#7BCF8F` | 成功 |
| `--color-state-warning` | `#8B5D05` | `#F7C96A` | 提醒 |
| `--color-state-error` | `#B54B3B` | `#FF8D82` | 请求失败 |
| `--color-state-danger` | `#B23B32` | `#FF8A7F` | 破坏性动作 |
| `--color-disabled-bg` | `#D8D0C6` | `#58504A` | Disabled |

soft 状态底、overlay、shadow 和 scrollbar 从上述 Token 派生。Dark 主按钮必须是暖白底 + 深暖字。

### 2.2 字体与排版

| 场景 | Desktop | Mobile | 字体 |
|---|---:|---:|---|
| Page H1 | 32/40 | 28/35 | Noto Serif SC 600 |
| Section H2 | 20/28 | 19/27 | Noto Serif SC 600 |
| Component H3 | 16/24 | 16/24 | Noto Sans SC 500 |
| 正文 | 15/25.5 | 15/25.5 | Noto Sans SC 400 |
| 表格/表单 | 14/21 | 14/21 | Noto Sans SC 400/500 |
| Label/Meta | 12/19 | 12/19 | Noto Sans SC 500 |
| ID/Key/时间 | 12/18.5 | 12/18.5 | IBM Plex Mono 400/500 |

字体只使用 `app/fonts/**` 本地文件，不加载 Google Fonts 或 Font Awesome。

### 2.3 几何与密度

- 4px 基础间距；常用 8/12/16/20/24/32/40/48。
- Section gap 32px；field group 20px；Label→control 8px；help/error 6px。
- 输入、Select、按钮和搜索高 44px；textarea 最小 112px；触控目标至少 44×44。
- 圆角只使用 4/6/8/12px；状态胶囊只用于短标签。
- 表头 44px；桌面标准行 52px、双行识别 60px；移动 56/64px。
- 常驻区域无 shadow；hover 可用 0 2px 8px 暖棕 8%；浮层用 0 14px 34px 暖棕 18%（暗色分别 32%/45%）。
- Focus 为 2px outline + 2px offset，不依赖 shadow。

## 3. 全局 Shell

### 3.1 Desktop 1440×1000

```text
┌─ App Canvas / overflow-x clip ─────────────────────────────────────┐
│ Sidebar 248px │ Main minmax(0,1fr)                                 │
│ Brand 76px    │ Breadcrumb + source/update facts                   │
│ Nav scroll    │ H1 + purpose + max one primary action              │
│ Identity      │ ┌┈ One dashed Paper Boundary ┈──────────────────┐  │
│ Theme/Logout  │ ┋ Context → Filter → Flat table → Pagination    ┋  │
│               │ └┈───────────────────────────────────────────────┘  │
└───────────────┴─────────────────────────────────────────────────────┘
```

- Main 水平内距 36px（最少 24px），上 28px，下 48px；`min-width:0`。
- Sidebar 自身纵滚，当前项为 2px 左线 + 500 字重 + 小面积 hover/active 底 + `aria-current`。
- 表格横向滚动只由 Paper 内的可聚焦 region 拥有；页头、筛选摘要和分页不随表格横滚。
- User/Workspace 详情 780px Drawer；Story 840px；Role 840px；Audit 760px；确认 600px Modal。

### 3.2 Mobile 390×844

```text
┌─ 8px Canvas / no root horizontal overflow ──────────────┐
│ 56px sticky Header [Menu] [Brand] [Theme/Account]       │
│ Breadcrumb / Back                                       │
│ H1 + purpose                                            │
│ Primary action own row                                  │
│ ┌┈ Paper / 16px padding ┈────────────────────────────┐  │
│ ┋ Context stack                                       ┋  │
│ ┋ Search                         [筛选 n]             ┋  │
│ ┋ Active chips / clear                                ┋  │
│ ┋ Focusable local table scroll                         ┋  │
│ ┋ Total                        [上一页] [下一页]       ┋  │
│ └┈─────────────────────────────────────────────────────┘  │
└───────────────────────────────────────────────────────────┘
```

- Sidebar 变为 `min(320px,88vw)` Drawer，锁焦、Escape/遮罩关闭、归焦 Menu。
- 搜索常显；关系/状态/日期进入 Bottom Sheet，Footer 加 safe-area。
- 详情/表单全屏；56px sticky Header，中段独立滚动，64px Footer + safe-area，末字段后至少 96px。
- 列表保留 table 语义，关键列优先，其余列局部横滚；不得以全局 `overflow:hidden` 掩盖布局错误。

## 4. 页面结构

### 4.1 Dashboard

顺序：数据来源/更新时间 → User、Workspace、Story 三组 flat facts → 最近更新 Story → 最近管理操作。

- 指标为可解释文字链接，不用大 KPI 卡片或装饰图表。
- 单组查询失败显示“暂不可用”，绝不写 0。
- 最近 Story 可跳 Story/Workspace/User；最近操作跳 Audit。
- 空库显示正确的系统空说明。

### 4.2 Workspace

列表列：name + ID、owner、status、Story count、created/updated、常显“查看”。  
筛选：name、User searchable Combobox、status、时间排序；服务端分页和 URL 同步。

详情顺序：Identity → Basics → Owner → Story 子列表 → Settings → Time/Audit → Actions。

- Owner 是具名 User 链接且不可转移。
- Settings 为结构化/只读 JSON Viewer；仅合法编辑态提供 JSON Editor。
- 创建使用真实 User Combobox；归档进入二次确认，说明 Story 不会删除。
- Story 子列表最多 10 条，“查看全部”进入带 `workspace_id` 的 Story 列表。

### 4.3 Story

列表列：title/identifier、Workspace、author、type、status/review、计数、updated、查看。  
筛选：标题/identifier、Workspace、User、status、review、type；默认 updated desc。

详情顺序：Identity → Relations → Content → Metadata → Timeline → Audit → Actions。

- Workspace 与 Author 为具名链接；不一致时显示 relation warning 和真实 ID，不自动修复或造实体。
- Content 使用安全 Markdown/长文本只读，最大 480px 局部纵滚；JSON 默认展开两层并可复制。
- 编辑只提供 title、description、type；content、version/provenance、关系、计数和时间无控件。
- Confirm/Reject/Archive 具名确认；Reject 必填原因；409 保留输入并展示最新状态。

### 4.4 User

列表列：name/email、role、status、Workspace/Story count、created/updated、查看。  
详情顺序：Safe identity → status → Workspace list → Story list → Audit → Actions。

- 永不为 password_hash、Token、Session、Provider Key 创建 UI 槽位。
- `owner_id`/`author_id` 跳转保持 query、页码、滚动和返回焦点。
- 停用确认明确“限制业务访问，不删除 Workspace、Story 或 Audit”。

### 4.5 Admin / Role / Permission

- Admin：email/name/roles/status/last login；密码从不回填；停用和角色变化进入确认；最后 active super admin 409 阻止。
- Role：Basics → impact → permission matrix → diff。内置角色显式保护；自定义角色删除需输入 code。
- Permission：按 domain 分组的只读 flat rows；显示 code/name/description/role count，无 CRUD 控件。
- Mobile 权限矩阵只让矩阵容器横滚，首列 sticky；每个 checkbox 有完整 Label 与描述。

### 4.6 Storage

顺序：Driver/config/capability → Search/MIME/date → file table → upload/preview/detail layers。

- 列：filename/key、MIME、size、time、driver、预览/下载/删除。
- driver 不支持 list 或配置缺失时显示 capability strip；不得显示 credential、bucket secret 或假列表。
- 上传显示 progress 与真实 receipt；失败保留文件选择信息。
- Preview 只允许安全图片/文本/PDF；HTML/script 不执行。
- 删除标题为“删除文件”，显示完整 key、size/MIME/时间，要求输入精确 key；成功回执含 Audit request ID。

### 4.7 Audit

- append-only 提示常显；列表字段为 time、actor、action、resource、request、result。
- 详情为 Header → redacted before/after → metadata；长 JSON 局部滚动。
- Password、Token、Session、Provider Secret 和 file content 不进入列表/详情。
- 能映射的 User/Workspace/Story/Storage/RBAC 提供具名链接；未知 ID 保留原始 Mono，不创建占位实体。

## 5. 全局组件

### 5.1 Filter Bar

- Desktop 搜索 320px，Select/Combobox 180–220px，最多两行；Mobile 次筛选进入 Sheet。
- 搜索 debounce 300ms；filter/sort/page/pageSize 是 URL 真相源；filter 改变后 page=1。
- Active filter 用小 chip；“清除全部”是有文字的按钮。
- 关系选项主行显示名称/邮箱，次行 ID；loading/empty/403/failed 均有明确文案。

### 5.2 Flat Data Table

- 原生 caption/thead/tbody/th/td；排序列维护 `aria-sort`。
- 首列真实链接，名称 14px/500，ID 次行 Mono + 44px Copy 命中区。
- 行尾“查看”常显，低频动作进入具名 Menu；禁止 hover-only 操作。
- 数值右对齐并使用 tabular nums；无真实批量命令时不显示 checkbox。

### 5.3 Detail Layer

- fixed Header / scroll Content / optional fixed Footer。
- 打开后背景 inert，初焦标题；关闭回触发行。404 回保留 query 的列表。
- 区段间以 32px 留白和细线分隔，不生成 section cards。
- Resource detail 有可刷新 URL；不能只存在于不可恢复的临时 Modal。

### 5.4 Sensitive Confirm

顺序固定为：对象 → 当前状态/版本 → 真实影响 → before→after → reason/key → 最终具名动作。

覆盖停用 User/Admin、归档 Workspace/Story、Story reject/confirm、Role permission diff、Storage delete。取消归焦，400 聚焦首错，409 聚焦冲突摘要。

## 6. 状态与恢复

| 状态 | 呈现 | 恢复 |
|---|---|---|
| Loading | 保留 Shell/Header/Filter/表头；按真实列宽 quiet skeleton | 完成后 live region 播报 N 条 |
| System Empty | “尚无…”真实事实 | 仅有写权限时提供创建 |
| Filter Empty | 筛选摘要 + 无匹配说明 | 删除 chip / 清筛 |
| Relation Empty | “该用户尚无 Workspace”等父子语义 | 返回父实体或允许创建 |
| 400 | Paper error summary + field error；保留草稿 | 聚焦首错 |
| 401 | 清除保护内容后登录 | 安全 return URL |
| 403 | 所需 permission；无受限写控件 | 返回有权限模块 |
| 404 | 实体不存在/已归档 | 关闭详情，回列表并归焦 |
| 409 | 草稿 + latest + diff/关系 | 确认后加载最新 |
| 500/503 | 失败范围 + Request ID | 区域重试，保留上下文 |
| Storage 未配置 | 缺失 capability/config 类别 | 修复后重新检查 |
| Success | action/resource/request/audit/time | 刷新列表/详情并聚焦回执 |

Toast 不作为唯一错误载体；恢复说明必须在相关区域持续可读。

## 7. 键盘、焦点与 Motion

- 焦点层级：Base → Resource Detail → Combobox/Sheet → Sensitive Confirm → Dirty Guard；最内层先响应 Escape。
- 首个元素为 Skip Link；顺序为 Sidebar → Header → Filter → Table → Pagination → Overlay。
- Drawer/Dialog/Sheet 锁 Tab，背景 inert；保存 `returnFocusKey={route,recordId,action}`。原行消失时回结果摘要。
- 所有 target ≥44×44；200% 文字缩放不遮挡主操作；无 hover-only 能力。
- row hover 140ms；field/button 160ms；Popover 160ms；Drawer/Sheet 240ms；只过渡实际属性，不使用 `transition-all`。
- `prefers-reduced-motion: reduce` 下 animation/transition 约 1ms，Drawer/Sheet 直接显隐；焦点、live region 和 loading 文案继续工作。

## 8. 跨模块逻辑

```text
User Detail
├─ Workspace count → Workspace List(owner_id) → Workspace Detail
│                                      └─ Story count → Story List(workspace_id)
└─ Story count → Story List(author_id) → Story Detail

Story Detail
├─ Workspace → Workspace Detail
├─ Author → User Detail
└─ Audit → Audit Detail

Admin → Role → Permission
Storage upload/delete ─┐
User/Workspace/Story ──┼─→ append-only Audit
RBAC changes ──────────┘
```

所有跳转保留白名单 query、page、sort、scroll 和 return focus。浏览器前进/后退应恢复上下文。

## 9. 实现映射

- Shell/Navigation：现有 `AdminNavigation` 结构重排，保留 permission 过滤和移动 Drawer。
- Token：集中更新 `app/globals.css`；现有组件通过 alias 渐进迁移。
- Query/Table：复用 Refine hooks 和服务端 Data Provider；替换主业务页的通用 JSON workbench 展示。
- Detail/Form：创建可复用的 EntityCell、StatusMark、ScrollTable、DetailLayer、Field、SensitiveConfirm；业务字段由页面配置/专用组件提供。
- Storage：沿用 `app/lib/file-storage/**`，只增加受保护管理 facade 与管理 UI。
- 详细 Tailwind 4/React 片段见 `files/workspace/4_ui_design.md`。

## 10. 双视口验收

### 1440×1000

- Sidebar 248px；Main `min-width:0`；页面无根横滚。
- 单一 dashed Paper；Filter 最多两行；首屏至少 6 个 52px 数据行。
- Table 只在自身横滚；Detail 780–840px，背景 inert，关闭归焦。

### 390×844

- 56px Header；8px canvas；16px Paper padding；target ≥44px。
- Sidebar→Drawer，次筛选→Bottom Sheet，详情/表单→Full-screen。
- Footer 包含 safe-area；末字段后 ≥96px。
- 根 `scrollWidth <= clientWidth`；Table/Matrix/JSON 仅局部滚动。

## 11. 范围确认

- 设计只覆盖运营总览、Workspace、Story、User、Admin、Role、Permission、Storage、Audit。
- 不新增或重构 AI 模型、Token 计费、Gateway 页面。
- 不暗示第二数据源、迁移/同步/ETL、SQLite、JSON DB、内存回退或 `app/(app)`。
