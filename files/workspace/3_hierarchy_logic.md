# Ink Memory Admin：页面层级与逻辑映射

> HTML Design Workflow / Stage 3 — Hierarchy Logic Mapper
>
> 输入基线：`files/workspace/1_prd_draft.md`、`files/workspace/2_structure_sketch.md`、`files/inputs/target_image.png`
>
> 目标视口：Desktop `1440×1000`；Mobile `390×844`
>
> 稳定性约束：本文件只沿用 Stage 2 已定义的模块 ID，不新增模型、计费、网关模块，不改变单一 PostgreSQL 与现有 Storage driver 边界。

## 0. 层级结论

本轮界面由一个后台应用壳、九个业务/治理页面根节点和一组跨页面状态层组成。逻辑上分为两条互补但不混淆的链：

1. 业务实体链：`User → Workspace → Story`。User 是 Workspace 的父实体，Workspace 是 Story 的父实体；Story 同时保留 author User 关联，且 author 必须与 Workspace owner 一致。
2. 治理链：`Admin → Role → Permission` 控制访问，`Storage Object → Audit` 与所有敏感写操作共同进入 append-only Audit。RBAC、Storage、Audit 不成为 User/Workspace/Story 的平行业务模型。

全局布局继承目标图的暖纸画布、248px 桌面侧栏、清晰衬线标题与细分隔线；Stage 2 将数据区收敛为页面唯一虚线 Paper Boundary。移动端不压缩桌面侧栏，而是切换为 Drawer、筛选 Sheet 和全屏详情层。

---

## 1. 页面结构草图（模块分区，精炼版）

### 1.1 Desktop 1440×1000

```text
┌──────────────────────────────────────── [G0 Admin Shell] ────────────────────────────────────────┐
│┌──────────────── [G1 Sidebar / 248px fixed] ───────────────┐┌──────── [G2 Main Canvas / min-width:0] ────────┐│
││ 品牌 / OPERATIONS CONSOLE                                │││ [G3 Breadcrumb / 返回路径 / 数据时间]          ││
││                                                         │││ [G4 H1 / 页面目的]                 [唯一主操作] ││
││ OV 运营总览                                             │││                                               ││
││ 剧本数据                                                │││ ┌┈┈┈┈┈┈┈┈ [G5 唯一 Paper Boundary] ┈┈┈┈┈┈┈┈┐ ││
││ ├─ WS 工作区                                            │││ ┋ [G6 摘要 / 上下文 / 能力事实]              ┋ ││
││ └─ ST 剧本                                              │││ ┋─────────────────────────────────────────────┋ ││
││ 用户中心                                                │││ ┋ [G7 搜索 / 筛选 / chips / URL 状态]         ┋ ││
││ └─ US 平台用户                                          │││ ┋─────────────────────────────────────────────┋ ││
││ 权限管理                                                │││ ┋ [G8 表格 / 关系行 / 详情段]  ↔ local scroll ┋ ││
││ ├─ AU 管理员                                            │││ ┋ [X0 原位状态区：X1/X2/X3/X6/X7]           ┋ ││
││ ├─ RL 角色                                              │││ ┋─────────────────────────────────────────────┋ ││
││ └─ PM 权限                                              │││ ┋ [G9 total / pageSize / pagination]          ┋ ││
││ 资源管理                                                │││ └┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┘ ││
││ └─ FS 文件存储                                          │││                                               ││
││ 系统治理                                                │││ [详情/表单右层：W1/S1/U1/A2/R2/F3/F4/L3]     ││
││ └─ AL 审计日志                                          │││ [确认层：X4 / X5；背景 inert、上下文保留]     ││
││─────────────────────────────────────────────────────────│││                                               ││
││ [G10 当前管理员 / 角色 / 主题 / 账户]                   │││                                               ││
│└─────────────────────────────────────────────────────────┘└───────────────────────────────────────────────┘│
└───────────────────────────────────────────────────────────────────────────────────────────────────────────┘
```

桌面逻辑：`G1` 与 `G2` 是 `G0` 的并列一级区域；`G3`、`G4`、`G5` 是 `G2` 内自上而下的页面层。`G6–G9` 是列表型页面在 `G5` 内的固定阅读顺序。详情/表单作为可刷新恢复的 Resource 子路由覆盖 `G2` 右侧，背景列表保留 URL、分页、滚动与触发行焦点。

### 1.2 Mobile 390×844

```text
┌──────────────────────────────── [G0 Mobile Shell] ────────────────────────────────┐
│ [M1 Sticky Header / 56px]  [☰] Ink Memory             [主题] [账户]              │
│ [G3 面包屑 / 返回父实体]                                                        │
│ [G4 H1 / 最多三行说明]                                                         │
│ [唯一主操作：另起一行，触控目标 ≥44×44]                                        │
│ ┌┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈ [G5 Paper / 8px canvas] ┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┐ │
│ ┋ [G6 摘要 / 上下文：纵向堆叠或自然换行]                         ┋ │
│ ┋ [G7 搜索常显]                                  [M3 筛选 {n}] ┋ │
│ ┋ [已生效 chips / 清除全部]                                     ┋ │
│ ┋────────────────────────────────────────────────────────────────┋ │
│ ┋ [G8 关键实体 / 状态 / 更新时间 / 常显动作]                     ┋ │
│ ┋ <可聚焦局部横滚；根节点不横滚>                                 ┋ │
│ ┋────────────────────────────────────────────────────────────────┋ │
│ ┋ [G9 共 {n} 条]                         [上一页] [下一页]        ┋ │
│ └┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┘ │
└─────────────────────────────────────────────────────────────────────────────────┘

┌────────────── [M2 Navigation Drawer / min(320px,88vw)] ──────────────┐
│ 分组导航：D0 / W0 / S0 / U0 / A0 / R0 / P0 / F0 / L0                │
│ [G10 当前管理员 / 角色 / 主题]；锁焦、Escape/遮罩关闭并归焦 M1       │
└───────────────────────────────────────────────────────────────────────┘

┌────────────────────── [M3 Filter Bottom Sheet] ──────────────────────┐
│ 次级筛选 / 当前结果 / 清除 / 应用 / safe-area；关闭后归焦 G7 触发器 │
└───────────────────────────────────────────────────────────────────────┘
```

移动逻辑：`M1` 替代 `G1` 的常驻可见性，`M2` 承载同一导航树，`M3` 承载 `G7` 的次级筛选。`W1/S1/U1/A2/R2/F3/F4/L3` 均变为全屏层；固定操作 Footer 使用 Stage 2 已有的 `W8/W10/S9/U8/A7/R8`，并包含 safe-area。

---

## 2. 页面层级结构图（父子逻辑树）

```text
[G0 Admin Shell] 后台根
├── [G1 Sidebar] Desktop 全局导航
│   ├── 运营总览 → [D0]
│   ├── 剧本数据
│   │   ├── 工作区 → [W0]
│   │   └── 剧本 → [S0]
│   ├── 用户中心
│   │   └── 平台用户 → [U0]
│   ├── 权限管理
│   │   ├── 管理员 → [A0]
│   │   ├── 角色 → [R0]
│   │   └── 权限 → [P0]
│   ├── 资源管理
│   │   └── 文件存储 → [F0]
│   ├── 系统治理
│   │   └── 审计日志 → [L0]
│   └── [G10 Admin Identity] 当前管理员 / 角色 / 主题 / 账户
├── [M1 Mobile Header] Mobile 全局入口
│   ├── [M2 Navigation Drawer] 复用 G1 的导航语义
│   └── [M3 Filter Sheet] 承接当前页面 G7 的次级筛选
└── [G2 Main Canvas] 当前 Resource 工作区
    ├── [G3 Breadcrumb] 父实体返回、查询上下文、更新时间
    ├── [G4 Page Header] 唯一 H1、页面目的、唯一主操作
    └── [G5 Paper Boundary] 当前页面唯一数据纸面
        ├── [G6 Summary/Context] 真实指标、关系上下文、能力事实
        ├── [G7 Filter Bar] 搜索、筛选、排序入口、chips、URL 状态
        ├── [G8 Data/Detail Body] 表格、关系行或详情段落
        │   └── [X0 State Region] 数据区原位状态
        │       ├── [X1 Loading] 保形 Skeleton + 加载完成播报
        │       ├── [X2 Empty] 系统空 / 筛选空 / 关系空
        │       ├── [X3 Error] 400/401/403/404/409/500/503
        │       ├── [X6 Relation Warning] 外键或 owner-author 关系异常
        │       └── [X7 Storage Unconfigured] Storage 能力/配置缺失
        ├── [G9 Pagination] total、pageSize、页码
        ├── 页面内容分支
        │   ├── [D0 Dashboard Paper]
        │   │   ├── [D1 Dashboard Source] ink-memory 与刷新事实
        │   │   ├── [D2 User Metrics] 用户总数/状态 → U0 筛选
        │   │   ├── [D3 Workspace Metrics] 工作区总数/状态 → W0 筛选
        │   │   ├── [D4 Story Metrics] 剧本总数/分布 → S0 筛选
        │   │   ├── [D5 Recent Stories] 最近 Story → S1/W1
        │   │   └── [D6 Recent Operations] 最近操作 → L3
        │   ├── [W0 Workspace List]
        │   │   └── [W1 Workspace Detail]
        │   │       ├── [W2 Workspace Header] 名称、ID、返回/关闭
        │   │       ├── [W3 Workspace Basics] 名称、状态、时间
        │   │       ├── [W4 Workspace Owner] 所属 User → U1；owner 只读
        │   │       ├── [W5 Workspace Stories] Story 子列表 → S0/S1
        │   │       ├── [W6 Workspace Settings] 白名单字段 + 未知 JSON 只读
        │   │       ├── [W7 Workspace Audit] 时间与操作 → L2/L3
        │   │       └── [W8 Workspace Actions] 编辑/归档
        │   │           └── [W9 Workspace Form]
        │   │               └── [W10 Workspace Form Footer] 取消/保存
        │   ├── [S0 Story List]
        │   │   └── [S1 Story Detail]
        │   │       ├── [S2 Story Header] title、identifier、返回/关闭
        │   │       ├── [S3 Story Identity] title/type/id
        │   │       ├── [S4 Story Relations] Workspace → W1；author → U1
        │   │       │   └── 关系异常时原位使用 [X6]
        │   │       ├── [S5 Story Content] Markdown/长文本安全只读
        │   │       ├── [S6 Story Metadata] JSON 树安全只读
        │   │       ├── [S7 Story Timeline] 状态与时间事实
        │   │       ├── [S8 Story Audit] 关联操作 → L3
        │   │       └── [S9 Story Actions] 编辑/Confirm/Reject/Archive
        │   │           └── [S10 Story Legal Edit] title/type/description
        │   ├── [U0 User List]
        │   │   └── [U1 User Detail]
        │   │       ├── [U2 User Header] 名称、邮箱、ID、返回/关闭
        │   │       ├── [U3 Safe Profile] 非敏感用户资料
        │   │       ├── [U4 User Status] active/disabled
        │   │       ├── [U5 User Workspaces] Workspace 关联 → W0/W1
        │   │       ├── [U6 User Stories] Story 关联 → S0/S1
        │   │       ├── [U7 User Audit] 用户相关操作 → L3
        │   │       └── [U8 User Actions] 编辑资料/停用/启用
        │   ├── [A0 Admin Users]
        │   │   ├── [A1 Admin List] email、roles、status、last login
        │   │   └── [A2 Admin Form]
        │   │       ├── [A3 Admin Identity] email/name/status
        │   │       ├── [A4 Admin Password] 新密码；永不回填
        │   │       ├── [A5 Admin Role Assignment] 可搜索角色 + 权限摘要
        │   │       ├── [A6 Admin Role Diff] 新增/移除角色与影响
        │   │       └── [A7 Admin Footer] 取消/复核保存
        │   ├── [R0 Roles]
        │   │   ├── [R1 Role List] 类型、权限数、管理员数、时间
        │   │   └── [R2 Role Detail/Edit]
        │   │       ├── [R3 Role Header] name/code/内置保护
        │   │       ├── [R4 Role Basics] name/description/code
        │   │       ├── [R5 Role Impact] 关联管理员与权限数量
        │   │       ├── [R6 Permission Matrix] domain × capability
        │   │       ├── [R7 Permission Diff] 增删权限、风险、受影响管理员
        │   │       └── [R8 Role Footer] 取消/复核保存
        │   ├── [P0 Permissions]
        │   │   ├── [P1 Permission Note] migration/bootstrap 发布、无 CRUD
        │   │   └── [P2 Permission Groups] 按域分组 → R0
        │   ├── [F0 Storage Resources]
        │   │   ├── [F1 Capability Strip] driver 与能力事实；无 credential
        │   │   ├── [F2 File List] filename/key/MIME/size/time/actions
        │   │   ├── [F3 Upload Layer] 文件校验与上传
        │   │   ├── [F4 Preview/Detail] 元信息与安全预览
        │   │   └── [F5 Delete Confirm] 完整 key 精确删除确认
        │   └── [L0 Audit Logs]
        │       ├── [L1 Audit Note] append-only 与脱敏说明
        │       ├── [L2 Audit List] actor/action/resource/request/result
        │       └── [L3 Audit Detail]
        │           ├── [L4 Audit Header] action/result/time/request
        │           ├── [L5 Before/After] 脱敏只读 JSON diff
        │           └── [L6 Audit Metadata] 请求关联与错误类别
        └── 跨页面保护层
            ├── [X4 Sensitive Confirm] 停用/归档/审核/RBAC/Storage 删除
            └── [X5 Unsaved Changes] 离开草稿确认
```

逻辑意图：列表是可恢复的父上下文，详情是该 Resource 的子路由层，表单或确认层再从详情/行操作派生。状态只替换失败区域，不替换 `G0–G5`，所以用户始终知道自己在哪、失败发生在哪、如何恢复。

---

## 3. 组件、路由与状态层级

### 3.1 Canonical Resource 路由映射

| 导航层级 | 页面根模块 | Canonical Refine Resource | 目标路由层级 | API / 数据事实 | Read / Write |
|---|---:|---|---|---|---|
| 运营总览 | D0 | dashboard virtual | `/admin` | `GET /api/admin/dashboard` / 三张业务表 + `admin_audit_logs` | `dashboard.read` / 无 |
| 剧本数据 → 工作区 | W0 | `story-workspaces` | `/admin/story/workspaces` → `/:id` | `/api/admin/story-workspaces` / `story_workspace_workspaces` | `story.read` / `story.write` |
| 剧本数据 → 剧本 | S0 | `stories` | `/admin/story/stories` → `/:id` | `/api/admin/stories` / `story_workspace_stories` | `story.read` / `story.write` |
| 用户中心 → 平台用户 | U0 | `users` | `/admin/users` → `/:id` | `/api/admin/users` / `users` | `users.read` / `users.write` |
| 权限管理 → 管理员 | A0 | `admin-users` | `/admin/access/admins` → `/:id` | `/api/admin/admin-users` / `admin_users`、`admin_user_roles` | `access.read` / `access.write` |
| 权限管理 → 角色 | R0 | `roles` | `/admin/access/roles` → `/:id` | `/api/admin/roles` / `admin_roles`、`admin_role_permissions` | `access.read` / `access.write` |
| 权限管理 → 权限 | P0 | `permissions` | `/admin/access/permissions` | `/api/admin/permissions` / `admin_permissions` | `access.read` / 只读 |
| 资源管理 → 文件存储 | F0 | `storage-resources` | `/admin/resources/storage` → 对象详情层 | `/api/admin/storage-resources` / 现有 Storage driver | `storage.read` / `storage.write`、`storage.delete` |
| 系统治理 → 审计日志 | L0 | `audit-logs` | `/admin/system/audit` → 审计详情层 | `/api/admin/audit-logs` / `admin_audit_logs` | `audit.read` / append-only |

路由层的 `/:id` 表示 Stage 1、2 要求的可刷新恢复 Resource 详情层；筛选、排序、页码、pageSize 使用 query string。现有模型、计费、网关路由保持原导航和实现，本文件不为其新增模块、层级或交互。

### 3.2 页面内组件组合规则

```text
列表页 = G3 + G4 + G5(G6 + G7 + G8(X0) + G9)
详情层 = Resource Detail(W1/S1/U1/R2/F4/L3) + fixed Header + scroll Content + optional fixed Footer
创建/编辑层 = W9/S10/A2/R2/F3 + 可见Label + X3字段错误 + X5离开保护 + fixed Footer
高风险写入 = 触发动作 → X4/F5复核 → 服务端校验 → 成功刷新事实 → L2/L3可追溯
只读页面 = P0/L0 + 常显说明(P1/L1) + 查询区 + 安全只读内容
```

任何 `*.read` 缺失时，`G1/M2` 可隐藏入口，但直接路由仍进入 `X3/403`；按钮隐藏不是授权边界。所有写入均保持 Session → permission → Origin → 严格 Zod → transaction → 脱敏 audit 的服务端顺序。

### 3.3 状态层级与恢复路径

| 状态模块 | 挂载层级 | 触发条件 | 不得发生 | 恢复动作 |
|---|---|---|---|---|
| X1 Loading | G8 或单个 D2–D6 | 首次查询、筛选、分页、局部刷新 | 清空 Shell、标题或筛选；显示假 0 | 保形 Skeleton；完成后 live region 播报 |
| X2 Empty | G8、W5、U5、U6 | 成功查询且 total=0 | 把请求失败解释为空数据 | 区分系统空/筛选空/关系空；创建、清筛选或返回父实体 |
| X3 Error | G8、表单顶部或局部指标 | 400/401/403/404/409/500/503 | 切第二数据源、静默覆盖冲突 | 聚焦首错、登录恢复、返回列表、刷新比较、区域重试 |
| X4 Sensitive Confirm | G0 顶层 Modal | 停用、归档、审核、RBAC 变更、Storage 删除 | 无对象/影响说明的静默提交 | 取消归焦；具名确认后提交并进入 Audit |
| X5 Unsaved Changes | Detail/Form 之上 | 关闭、Escape、刷新、路由跳转会丢草稿 | 未提醒丢弃输入 | 继续编辑或放弃并离开 |
| X6 Relation Warning | S4 或其他关系事实区 | 外键异常、Story author ≠ Workspace owner | 自动造替代实体或伪造关联 | 展示只读技术事实，跳父实体或关联 Audit |
| X7 Storage Unconfigured | F2 原位 | driver/endpoint/授权或 list 能力缺失 | 回显 credential、制造假文件列表 | 查看部署修复说明并重新检查 |

`401` 需先清除保护数据再去登录；`403` 明示所需 permission；`404` 返回保留 query 的父列表；`409` 保留草稿并对比服务器最新值；`500/503` 显示失败范围与 Request ID。

---

## 4. User → Workspace → Story 业务逻辑

### 4.1 数据父子关系

```text
[U0/U1] User：users.id BIGINT
├── owner 1:N
│   └── [W0/W1] Workspace：story_workspace_workspaces.owner_id → users.id
│       └── contains 1:N
│           └── [S0/S1] Story：story_workspace_stories.workspace_id → workspace.id
└── author 1:N
    └── [S0/S1] Story：story_workspace_stories.author_id → users.id

一致性不变量：Story.author_id = Story.workspace.owner_id
生命周期：User 停用、Workspace/Story 归档只改变业务状态；历史关系与 Audit 保留，不硬删除。
```

### 4.2 页面跳转与上下文恢复

```text
[U1 User Detail]
├── [U5 Workspace count/list]
│   └── owner_id={user.id} → [W0 Workspace List]
│       └── row → [W1 Workspace Detail]
│           ├── [W4 Owner] → [U1 User Detail]
│           └── [W5 Story count/list]
│               └── workspace_id={workspace.id} → [S0 Story List] → [S1 Story Detail]
└── [U6 Story count/list]
    └── author_id={user.id} → [S0 Story List] → [S1 Story Detail]

[S1 Story Detail]
├── [S4 Workspace] → [W1 Workspace Detail]
├── [S4 Author] → [U1 User Detail]，进入后标题焦点落在 [U2]
└── [S8 Audit] → [L3 Audit Detail]
```

所有跳转只在 URL 中保存稳定 ID；界面显示 name、title、display_name/email。详情关闭或浏览器返回时恢复来源列表的筛选、排序、页码、pageSize、滚动位置和触发行焦点。无效关系进入 `X3` 或 `X6`，不得静默清空筛选。

### 4.3 合法动作边界

| 实体 | 可维护 | 只读/禁止 | 保护层 |
|---|---|---|---|
| User | display_name、avatar_url、active/disabled | 创建密码、重置业务密码、硬删、任何凭据 | U4/U8 → X4；并发冲突 → X3/409 |
| Workspace | 创建；name、白名单 settings、active/archived | 创建后转移 owner、通用 JSON 工作台、硬删 | W8/W9/W10 → X4/X5；FK/阻塞 → X3/409 |
| Story | title、description、type；confirm/reject/archive | content、author、workspace、count、version、provenance、时间、硬删 | S9/S10 → X4/X5；关系异常 → X6 |

---

## 5. RBAC、Storage 与 Audit 治理逻辑

### 5.1 RBAC 父子关系与写入链

```text
[A0 Admin Users]
├── [A1 Admin List] → 进入 [A2 Admin Form]
└── [A2]
    ├── [A3] 管理员身份
    ├── [A4] 新密码（仅新值输入，永不回填）
    ├── [A5] 分配 Role → [R0/R2]
    ├── [A6] 角色增删与权限影响 diff
    └── [A7] 复核保存 → [X4] → transaction → [L2/L3]

[R0 Roles]
├── [R1 Role List] → [R2 Role Detail/Edit]
└── [R2]
    ├── [R3/R4] 身份与内置保护
    ├── [R5] 关联管理员/权限真实数量
    ├── [R6] Permission Matrix → [P0/P2]
    ├── [R7] Permission diff 与高风险提示
    └── [R8] 复核保存 → [X4] → transaction → [L2/L3]

[P0 Permissions]
├── [P1] migration/bootstrap 发布说明
└── [P2] domain 分组与 role count → [R0]
```

内置角色只读保护；自定义角色可创建、编辑、删除，但有关联管理员时由服务端规则阻止。最后一个 active super admin 不可停用或移除 `super_admin`，进入 `X3/409`。Permission 本身不提供 UI CRUD。

### 5.2 Storage → Audit

```text
[F0 Storage Resources]
├── [F1 Capability Strip] 判断 list/upload/preview/download/delete 能力
│   └── 配置或能力缺失 → [X7]
├── [F2 File List]
│   ├── 上传 → [F3] → permission/Origin/Zod/driver → 成功 → [L2/L3]
│   ├── 预览/详情 → [F4] → 安全图片/文本/PDF；不支持类型仅元信息+下载
│   ├── 下载 → permission/精确 key/driver；不把文件内容写入 Audit
│   └── 删除 → [F5] 完整 key 输入 → [X4]具名确认 → driver delete → [L2/L3]
└── 失败 → [X3] 保留筛选、对象上下文与 Request ID

[L0 Audit Logs / append-only]
├── [L1] 只读与脱敏说明
├── [L2] actor/action/resource/request/result 列表
└── [L3]
    ├── [L4] action/result/time/request
    ├── [L5] 脱敏 Before/After
    └── [L6] 请求关联/错误类别；无 password/secret/token/session/file content
```

User、Workspace、Story、Admin、Role 与 Storage 的成功敏感操作都可进入对应 `L3`；无法映射的 resource ID 保留原始 mono 值，不创建占位实体。

---

## 6. Desktop / Mobile 响应式映射

| 逻辑区域 | Desktop 1440×1000 | Mobile 390×844 | 不变量 |
|---|---|---|---|
| G0/G1/G2/G10 | 248px 固定 G1 + 剩余 G2；G10 位于侧栏底部 | G1 隐藏，M1 触发 M2；G10 进入 M2/账户菜单 | 导航分组、权限裁剪语义相同；直接路由仍服务端鉴权 |
| G3/G4 | 面包屑与 H1 横向空间充足；主操作最多一个 | 位于 M1 下；说明最多三行；主操作另起一行 | 清晰返回路径、唯一 H1、说明不伪装成按钮 |
| G5–G9 | Paper 占满可用宽；G7 可换至两行；G8 内横滚；完整 pageSize/页码 | 8px canvas；搜索常显，次筛选进 M3；G8 可聚焦横滚；简化为上一页/下一页 | 根无横滚、筛选写 URL、状态原位替换 |
| D0–D6 | D2–D4 三列；D5/D6 两列 | D1–D6 依次纵向堆叠 | 只展示真实数据；单组失败不显示 0 |
| W0/S0/U0/A0/R0/P0/L0 | sticky 表头，48–52px 行高，关联文字链接与行尾动作 | 保留关键实体/状态/更新时间/动作；完整表格在 G8 局部横滚 | 主信息优先、ID 次行 mono、触控/点击目标 ≥44px |
| W1/S1/U1 | 右侧 780/840/780px Drawer，背景列表 inert 且上下文保留 | 全屏详情层，内容独立纵滚 | 固定 Header；有写操作才固定 Footer；关闭归焦 |
| W9/S10/A2 | Drawer 或专用层；字段与复核摘要完整可见 | 全屏表单；最后字段后预留 ≥96px | 可见 Label、字段错误、X5 草稿保护、safe-area Footer |
| R2/R6 | 840px 详情/编辑层；矩阵容器横滚 | 全屏；R6 首列 sticky、矩阵局部横滚 | Checkbox 保持完整 label，不缩成不可点击小格 |
| F0–F5 | F1 横排；F2 表格；F3/F4 Drawer；F5 Dialog | F1 自然换行；F3/F4 全屏；F5 保留完整 key 输入与 safe-area | 不泄露 credential；仅安全预览；精确 key 删除 |
| L3–L6 | Drawer；JSON diff 局部滚动 | 全屏；JSON viewer 局部横滚/换行 | append-only、脱敏、无页面根横滚 |
| X0–X7 | X1/X2/X3/X6/X7 原位；X4/X5 居中 Modal 并锁焦 | 原位状态不变；X4/X5 适配窄屏与 safe-area | Escape/遮罩规则明确，关闭归焦；reduced-motion 下取消非必要动画 |
| M1–M3 | 不显示 | M1 sticky 56px；M2 左 Drawer；M3 Bottom Sheet | M2/M3 锁焦、Escape/遮罩关闭、归焦触发器 |

键盘与无障碍逻辑保持跨视口一致：输入始终有可见 Label，排序维护 `aria-sort`，禁用分页使用真实 `disabled`，焦点使用可见 outline，Drawer/Dialog/Sheet 有语义标题与确定的打开、关闭焦点顺序。

---

## 7. 层级完整性与歧义说明

### 7.1 模块 ID 完整性

本文件完整复用 Stage 2 的稳定 ID 集：

```text
G0–G10；M1–M3；D0–D6；W0–W10；S0–S10；U0–U8；
A0–A7；R0–R8；P0–P2；F0–F5；L0–L6；X0–X7。
```

没有引入新的功能区编号，也没有复用同一 ID 表示不同语义。所有页面根节点都从 `G1/M2` 导航进入，并挂载在 `G2 → G5`；所有状态均挂载到 `X0` 或顶层保护层，不与实体页面争夺父级。

### 7.2 歧义处理

1. Stage 2 的 Story 草图写作 `S4 author → U2`，而模块索引定义 `U2` 为 User Header、`U1` 才是 User Detail。这里保持模块含义不变，将导航目标明确为 `U1`，进入详情后焦点落在 `U2`；未重编号。
2. Stage 1 要求详情使用可刷新恢复的 Resource 路由，但未固定全部 `/:id` 文件结构。本文件以当前导航层级为父路由，并用 `/:id` 表示目标详情子层；实现阶段可使用同语义的 Next.js segment，但不可退化为不可刷新恢复的纯临时 Modal。
3. Storage 对象未必有 PostgreSQL 主键，`F4` 详情与 `F5` 删除都以严格校验的完整 object key 为稳定身份；文件内容仍留在现有 Storage driver，不进入 PostgreSQL 或 Audit。

### 7.3 范围校验

- User → Workspace → Story 是唯一业务实体父子链；未创建平行实体。
- RBAC 和 Storage 是治理域，所有敏感写入可追溯至 L0–L6。
- 模型、计费、网关只保留现有入口，本阶段没有新增其模块、流程或页面设计。
- 未引入第二数据源、SQLite、JSON/内存回退、迁移/同步/ETL 或 `app/(app)`。
