# Ink Memory Admin：页面结构草图与模块索引

> HTML Design Workflow / Stage 2 — Structure Sketch Designer
> 结构基线：`files/workspace/1_prd_draft.md` + `files/inputs/target_image.png`
> 目标视口：Desktop `1440×1000`；Mobile `390×844`

## 0. 草图约定

- `[G0]` 一类标记是稳定模块 ID；同一 ID 在桌面、移动端和索引中含义一致。
- `┈` 表示页面级唯一虚线 Paper Boundary；内部使用留白与细行线，不叠加卡片海。
- `↔ local scroll` 仅表示被明确标记的表格/页签容器横向滚动；页面根节点不得横向溢出。
- `⇣ local scroll` 表示 Drawer、Sheet 或全屏层内容区独立纵向滚动。
- `{真实值}`、`{真实状态}` 均来自当前单一 PostgreSQL 或现有 Storage driver；不得用假数字、假趋势占位。
- ID、permission code、object key、request ID 使用等宽次级文本；标题、名称、邮箱为主要扫描信息。
- User → Workspace → Story 是唯一业务实体链；RBAC、Storage、Audit 是治理链。模型、计费、网关只保留原入口，不在本草图扩展。

---

## 1. 全局 Shell

### 1.1 Desktop 1440×1000

```text
┌──────────────────────────────────────────── [G0 Admin Shell 1440×1000] ────────────────────────────────────────────┐
│┌──────────────── [G1 Sidebar 248px / fixed] ───────────────┐┌────────────── [G2 Main Canvas 1192px / min-width:0] ─┐│
││ [INK] Ink Memory                                         │││ [G3 Breadcrumb + data time + account/theme]              ││
││       OPERATIONS CONSOLE                                 │││ [G4 H1 页面标题]                         [唯一主操作]       ││
││──────────────────────────────────────────────────────────│││ 一句话说明 / permission 提示 / 父实体返回路径            ││
││ OV  运营总览                                             │││                                                        ││
││ 剧本数据                                                 │││ ┌┈┈┈┈┈┈┈┈┈ [G5 Paper Boundary] ┈┈┈┈┈┈┈┈┈┈┐           ││
││ WS  工作区                                               │││ ┋ [G6 Context / Summary / Capability]                  ┋           ││
││ ST  剧本                                                 │││ ┋──────────────────────────────────────────────────────┋           ││
││ 用户中心                                                 │││ ┋ [G7 Search + visible filters + applied chips]        ┋           ││
││ US  平台用户                                             │││ ┋──────────────────────────────────────────────────────┋           ││
││ 权限管理                                                 │││ ┋ [G8 Table / relation rows / detail sections]         ┋           ││
││ AU  管理员                                               │││ ┋ [loading / empty / error 原位替换]                   ┋           ││
││ RL  角色                                                 │││ ┋──────────────────────────────────────────────────────┋           ││
││ PM  权限                                                 │││ ┋ [G9 total + pageSize + pagination]                   ┋           ││
││ 资源管理                                                 │││ └┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┘           ││
││ FS  文件存储                                             │││                                                        ││
││ 系统治理                                                 │││                                                        ││
││ AL  审计日志                                             │││                                                        ││
││──────────────────────────────────────────────────────────│││                                                        ││
││ [G10 Admin identity / role]            [主题] [账户菜单] │││                                                        ││
│└──────────────────────────────────────────────────────────┘└────────────────────────────────────────────────────────┘│
└─────────────────────────────────────────────────────────────────────────────────────────────────────────────────────┘
```

结构尺寸：

- `G1` 固定 248px；`G2` 左右内距 32px、顶部 28–32px；数据 Paper 占满剩余宽度。
- `G4` 桌面 H1 40px/1.2；主操作最多一个。说明类文案不伪装成按钮。
- `G5` 是页面唯一虚线边界、12px 圆角；静止列表无阴影。
- `G8` 表头 sticky、行高 48–52px、交互目标不低于 44px；仅其内部允许横滚。
- 无 `*.read` 权限的菜单入口可隐藏，但直接路由访问仍由服务端返回 403。

### 1.2 Mobile 390×844

```text
┌────────────────────────────── [G0 Mobile Shell 390×844] ──────────────────────────────┐
│┌──────────────────────── [M1 Sticky Header 56px] ───────────────────────────────────┐│
││ [☰] Ink Memory                                  [主题] [账户]                     ││
│└────────────────────────────────────────────────────────────────────────────────────┘│
│ [G3 breadcrumb / 返回父实体]                                                       │
│ [G4 页面标题]                                                                      │
│ 一句话说明；最多三行                                                               │
│ [主操作：独占一行或内容宽度]                                                       │
│┌┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈ [G5 Paper / 8px canvas] ┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┐│
│┋ [G6 Summary / Context]                                                           ┋│
│┋──────────────────────────────────────────────────────────────────────────────────┋│
│┋ [G7 Search 始终可见]                           [M3 筛选 {n}]                     ┋│
│┋ [已生效 chip ×] [清除全部]                                                       ┋│
│┋──────────────────────────────────────────────────────────────────────────────────┋│
│┋ [G8 key entity / status / updated / action]                                      ┋│
│┋ < ↔ local table scroll；容器可聚焦且有提示 >                                     ┋│
│┋──────────────────────────────────────────────────────────────────────────────────┋│
│┋ [G9 共 {n} 条]                              [上一页] [下一页]                   ┋│
│└┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┘│
└───────────────────────────────────────────────────────────────────────────────────────┘

┌────────────── [M2 Navigation Drawer：min(320px,88vw)] ──────────────┐
│ [关闭] Ink Memory                                                   │
│ OV 总览 / WS 工作区 / ST 剧本 / US 用户                            │
│ AU 管理员 / RL 角色 / PM 权限 / FS Storage / AL 审计               │
│ 当前管理员 / 角色 / 主题                                            │
└──────────────────────────────────────────────────────────────────────┘

┌────────────────────── [M3 Filter Bottom Sheet] ─────────────────────┐
│ 筛选                                   当前结果 {n} / [关闭]         │
│ [可见 Label + Select / Date Range / relation search] ⇣             │
│ [清除全部]                                      [应用筛选]          │
│ safe-area-inset-bottom                                                │
└──────────────────────────────────────────────────────────────────────┘
```

- `M2`、`M3` 打开后锁焦；Escape/遮罩关闭并归焦原触发器。
- 移动端页面 padding 8px，正文区常用 16px；触控目标至少 44×44。
- 详情 Drawer、创建/编辑表单在移动端统一变为全屏层；固定 Footer 包含 safe-area。

---

## 2. 运营总览

```text
┌┈┈┈┈┈┈┈┈┈┈┈┈┈┈ [D0 Dashboard Paper] ┈┈┈┈┈┈┈┈┈┈┈┈┈┈┐
┋ [D1 数据来源] ink-memory │ 最近成功刷新 {time} │ [刷新]          ┋
┋────────────────────────────────────────────────────────────────────┋
┋ [D2 用户事实]          [D3 Workspace 事实]       [D4 Story 事实] ┋
┋ 总数 {n}               总数 {n}                  总数 {n}        ┋
┋ active {n} →用户筛选   active {n} →WS筛选        状态分布 →筛选  ┋
┋ disabled {n} →用户筛选 archived {n} →WS筛选      review分布 →筛选┋
┋────────────────────────────────────────────────────────────────────┋
┋ [D5 最近更新 Story / max 5]       │ [D6 最近管理操作 / max 5]      ┋
┋ title → Story详情                 │ actor / action / resource       ┋
┋ Workspace → Workspace详情         │ time / result → Audit详情       ┋
┋ updated_at                        │ request_id                       ┋
└┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┘
```

- Desktop：`D2–D4` 三段平铺，`D5/D6` 两列；Mobile：依次纵向堆叠。
- 数字本身是带解释的筛选链接；单组失败只替换该组为 `X3`，不得显示 0。
- 空库显示系统 Empty；缺表显示 schema readiness 错误，不制造趋势或健康分。

---

## 3. Workspace

### 3.1 Workspace 列表

```text
┌┈┈┈┈┈┈┈┈┈┈┈┈┈┈ [W0 Workspace List] ┈┈┈┈┈┈┈┈┈┈┈┈┈┈┐
┋ [G6] 工作区总数 {n} / active {n} / archived {n}   [新建工作区] ┋
┋ [G7] 名称搜索 │ 所属用户(搜索选择) │ 状态 │ 创建/更新时间排序 ┋
┋ [chips] owner:{email} ×  status:active ×              清除全部 ┋
┋──────────────────────────────────────────────────────────────────┋
┋ [G8 ↔] 名称/ID       所属用户          状态   Story数   创建/更新   操作 ┋
┋ name → [W1详情]      user → [U1详情]   ●active  {n}→[S0] time  [查看][⋯] ┋
┋ id [复制]                                                            ┋
┋──────────────────────────────────────────────────────────────────┋
┋ [G9] 共 {total} 条 │ 20/50/100                     1/{pages} → ┋
└┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┘
```

- 主列先显示 `name`，`id` 仅次行 mono + copy；不把技术 ID 当运营主信息。
- User 筛选显示名称/邮箱，仍可粘贴完整 ID 精确命中；不可提交不存在实体。
- 行动作：查看、编辑合法字段、归档；不提供硬删或 owner 转移。

### 3.2 Workspace 创建、详情与编辑

```text
┌──────────────────── 背景：W0 保持 URL / 分页 / 滚动 / 触发行 ────────────────────┬──────── [W1 Detail Layer 780px] ────────┐
│                                                                                │ [W2 Header fixed] ← 工作区名称 / ID [复制] × │
│                                                                                ├───────────────────────────────────────────────┤
│                                                                                │ ⇣ local scroll                                │
│                                                                                │ [W3 基本信息] name / status / created / updated│
│                                                                                │ [W4 所属用户] name/email → U1；owner只读       │
│                                                                                │ [W5 Story 子列表 max 10] title/status/updated  │
│                                                                                │     [查看全部 → S0?workspace_id={id}]          │
│                                                                                │ [W6 Settings] 白名单字段；未知JSON只读树       │
│                                                                                │ [W7 时间与相关审计] actor/action/time → L2     │
│                                                                                ├───────────────────────────────────────────────┤
│                                                                                │ [W8 Footer fixed] [编辑] [归档]                │
└────────────────────────────────────────────────────────────────────────────────┴───────────────────────────────────────────────┘

┌────────────────────────────── [W9 Create/Edit Form] ──────────────────────────────┐
│ [Header] 新建工作区 / 编辑 {name}                              [关闭]              │
│ ⇣ 名称* [1–120字符]                                                           │
│   所属用户* [可搜索真实User；创建后不可转移]                                  │
│   Settings [安全结构化字段]                                                   │
│   高级设置 [未知合法JSON只读，不提供通用JSON编辑台]                           │
│ [W10 Footer] [取消]                                            [保存]           │
└─────────────────────────────────────────────────────────────────────────────────┘
```

- `W1` 在 Mobile 变全屏层；最后字段后预留 Footer 高度。
- 创建默认 active。用户不存在、已不允许建立关系或归档被 active Story 阻塞时用 `X3/409`。
- `W8` 归档进入 `X4`，说明 Story 不会被删除；所有成功写入产生 Audit。

---

## 4. Story

### 4.1 Story 列表

```text
┌┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈ [S0 Story List] ┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┐
┋ [G6] Story总数 {n} / review分布 / status分布                   ┋
┋ [G7] 标题/identifier │ Workspace │ 用户 │ 状态 │ 审核 │ 类型 │ 更新排序 ┋
┋ [chips] workspace:{name} × author:{email} × review:pending ×  ┋
┋────────────────────────────────────────────────────────────────┋
┋ [G8 ↔] 标题/ID    Workspace      作者       类型  状态/审核  字符/场景 更新时间 操作 ┋
┋ title→[S1]        name→[W1]      user→[U1]  type  marks      {n}/{n}   time  [查看][⋯] ┋
┋ identifier/id [复制]                                                   ┋
┋────────────────────────────────────────────────────────────────┋
┋ [G9] 共 {total} 条 │ 20/50/100                         1/{pages} ┋
└┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┘
```

- 无标题时显示“未命名剧本”；Workspace 与作者始终是具名文字链接。
- 行动作：查看、编辑合法字段、confirm、reject、archive；不可更改内部版本或内容结构。

### 4.2 Story 详情、内容阅读与合法编辑

```text
┌──────────────── 背景：S0 保留 workspace/user 筛选上下文 ────────────────┬──────────── [S1 Detail Layer 840px] ────────────┐
│                                                                         │ [S2 Header fixed] ← title / identifier [复制] ×│
│                                                                         ├─────────────────────────────────────────────────┤
│                                                                         │ ⇣ [S3 身份] title / type / id                    │
│                                                                         │   [S4 归属] Workspace→W1 / author→U2             │
│                                                                         │   若异常：[X6 关系异常] 技术事实只读              │
│                                                                         │   [S5 描述与正文]                                 │
│                                                                         │   Markdown：安全排版；unknown长文 max-height 480  │
│                                                                         │   空正文：“该剧本尚无正文”                        │
│                                                                         │   [S6 Metadata JSON] 折叠树/展开前两层/复制JSON    │
│                                                                         │   解析失败：原文只读 + 可理解错误                  │
│                                                                         │   [S7 状态时间线] status/review/created/...        │
│                                                                         │   [S8 关联审计] actor/action/time → L2             │
│                                                                         ├─────────────────────────────────────────────────┤
│                                                                         │ [S9 Footer] [编辑] [Confirm] [Reject] [Archive] │
└─────────────────────────────────────────────────────────────────────────┴─────────────────────────────────────────────────┘

┌──────────────────────────── [S10 Legal Edit Form] ────────────────────────────┐
│ title [text] │ type [真实枚举] │ description [textarea]                       │
│ 只读提示：content / author / workspace / count / version / provenance / time │
│ [取消]                                                       [保存合法字段]   │
└───────────────────────────────────────────────────────────────────────────────┘
```

- `S5/S6` 只读，不执行不可信 HTML/script；长文本仅内容区局部滚动。
- Reject 使用 `X4` 且原因必填；Confirm/Archive 同样具名确认并显示影响。
- 并发更新显示“你看到的值 / 服务器最新值”，不提供强制覆盖。

---

## 5. 平台用户

### 5.1 User 列表

```text
┌┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈ [U0 User List] ┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┐
┋ [G6] 用户总数 {n} / active {n} / disabled {n}                  ┋
┋ [G7] 邮箱/显示名搜索 │ role │ status │ 创建/更新/关联数排序    ┋
┋─────────────────────────────────────────────────────────────────┋
┋ [G8 ↔] 用户                role   status   Workspace   Story   创建/更新   操作 ┋
┋ display_name/email→[U1]    role   ●active   {n}→[W0]   {n}→[S0] time    [查看][⋯] ┋
┋ id [复制]                                                                ┋
┋─────────────────────────────────────────────────────────────────┋
┋ [G9] 共 {total} 条 │ 20/50/100                          1/{pages} ┋
└┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┘
```

- 响应和页面中不出现 password、Token、Session、Provider Key。
- 不提供业务用户创建、密码重置或硬删；合法编辑仅 display_name、avatar_url、status。

### 5.2 User 详情与状态维护

```text
┌──────────────────── 背景：U0 保持筛选/分页/焦点 ───────────────────────┬───────────── [U1 Detail Layer 780px] ────────────┐
│                                                                       │ [U2 Header] ← display_name / email / ID [复制] ×│
│                                                                       ├──────────────────────────────────────────────────┤
│                                                                       │ ⇣ [U3 安全资料] avatar/display_name/email/role   │
│                                                                       │   [U4 状态] active/disabled / 状态更新时间       │
│                                                                       │   [U5 Workspace关联] count / 最近10条 / 全部→W0 │
│                                                                       │   [U6 Story关联] count / 最近10条 / 全部→S0     │
│                                                                       │   [U7 用户操作审计] actor/action/time → L2       │
│                                                                       ├──────────────────────────────────────────────────┤
│                                                                       │ [U8 Footer] [编辑资料] [停用/启用]              │
└───────────────────────────────────────────────────────────────────────┴──────────────────────────────────────────────────┘
```

- 停用进入 `X4`：说明业务访问受限，但 Workspace、Story、Audit 不删除。
- `U5/U6` 链接携带 `owner_id` / `author_id`；返回时恢复 User 详情、触发项与滚动位置。

---

## 6. 管理员、角色与权限

### 6.1 管理员

```text
┌┈┈┈┈┈┈┈┈┈┈┈┈┈ [A0 Admin Users] ┈┈┈┈┈┈┈┈┈┈┈┈┈┐
┋ [G6] 管理员 {n} / active {n}                         [新建管理员] ┋
┋ [G7] email搜索 │ status │ role                                 ┋
┋──────────────────────────────────────────────────────────────────┋
┋ [A1 List] email/name   roles→R0   status   last_login   [查看][停用] ┋
┋──────────────────────────────────────────────────────────────────┋
┋ [G9] total / pageSize / pagination                               ┋
└┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┘

┌──────────────────────── [A2 Admin Create/Edit Layer] ───────────────────────┐
│ [A3 身份] email*（创建后只读）/ display_name / status                      │
│ [A4 新密码] password输入≥14；永不回填已保存密码                           │
│ [A5 角色分配] 可搜索角色 / permission摘要                                 │
│ [A6 变更摘要] 新增角色 / 移除角色 / 受影响权限                            │
│ [A7 Footer] [取消]                                      [复核变更并保存]   │
└─────────────────────────────────────────────────────────────────────────────┘
```

- 最后 active super admin 不可停用、不可移除 super_admin；以 409 `X3` 明确阻止。
- 角色变更必须先进入 `X4` 展示 diff，不能直接静默提交。

### 6.2 角色与权限矩阵

```text
┌┈┈┈┈┈┈┈┈┈┈┈┈┈┈ [R0 Roles] ┈┈┈┈┈┈┈┈┈┈┈┈┈┈┐
┋ [G6] 内置角色 {n} / 自定义角色 {n}                      [新建角色] ┋
┋ [G7] name/code搜索 │ 内置/自定义 │ 更新时间排序                   ┋
┋───────────────────────────────────────────────────────────────────┋
┋ [R1 List] name/code   type   permission数→P0   admin数→A0   updated   操作 ┋
┋───────────────────────────────────────────────────────────────────┋
┋ [G9] total / pageSize / pagination                                ┋
└┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┘

┌────────────────────────── [R2 Role Detail/Edit 840px] ──────────────────────────┐
│ [R3 Header] role name / code / 内置保护状态                                    │
│ [R4 基本信息] name / description；code创建后只读                               │
│ [R5 影响摘要] 已分配管理员 {n} / 当前权限 {n}                                  │
│ [R6 Permission Matrix ↔ local scroll]                                          │
│ domain      permission code          read   write   delete   完整checkbox label │
│ dashboard   dashboard.read            ☑       —       —                       │
│ users       users.read/write          ☑       ☑       —                       │
│ story       story.read/write          ☑       ☑       —                       │
│ access      access.read/write         ☑       □       —                       │
│ storage     storage.read/write/delete ☑       □       □                       │
│ audit       audit.read                ☑       —       —                       │
│ [R7 Diff] 新增权限 / 移除权限 / 高风险警告 / 受影响管理员                       │
│ [R8 Footer] [取消]                               [复核权限变更并保存]           │
└─────────────────────────────────────────────────────────────────────────────────┘
```

- 内置角色允许查看，但受保护字段与删除动作禁用并解释原因。
- 自定义角色可创建、编辑、删除；删除仍需 `X4` 并显示关联管理员阻塞。
- Mobile 的 `R6` 保留首列 sticky，矩阵容器横滚；不把 checkbox 缩成不可点小格。

### 6.3 权限只读页

```text
┌┈┈┈┈┈┈┈┈┈┈┈┈┈ [P0 Permissions / Read-only] ┈┈┈┈┈┈┈┈┈┈┈┈┈┐
┋ [P1 系统说明] 权限定义由 migration/bootstrap 发布；无创建/编辑/删除入口  ┋
┋ [G7] code/name搜索 │ domain                                      ┋
┋────────────────────────────────────────────────────────────────────┋
┋ [P2 Domain Group] dashboard / users / story / access / storage / audit ┋
┋ code [mono] │ name │ description │ role count → R0?permission={code}   ┋
└┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┘
```

---

## 7. Storage 文件资源

```text
┌┈┈┈┈┈┈┈┈┈┈┈┈┈┈ [F0 Storage Resources] ┈┈┈┈┈┈┈┈┈┈┈┈┈┈┐
┋ [F1 Capability Strip] driver:{type} │ list ✓ │ upload ✓ │ preview ✓ │ download ✓ │ delete ✓ ┋
┋ 最近刷新 {time} / 配置事实不含 credential                         [上传文件] ┋
┋───────────────────────────────────────────────────────────────────────────┋
┋ [G7] key/filename │ MIME │ 时间范围 │ key/size/time排序                  ┋
┋───────────────────────────────────────────────────────────────────────────┋
┋ [F2 File List ↔] filename   object key[复制]   MIME   size   time   driver   actions ┋
┋                  image.png  media/…            image  2MB    …      S3       [预览][下载][删除] ┋
┋───────────────────────────────────────────────────────────────────────────┋
┋ [G9] total / pageSize / pagination                                        ┋
└┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┘

┌────────────────────── [F3 Upload Layer] ──────────────────────┐
│ 文件* [选择文件]                                              │
│ 文件名 / size / MIME / 上限 / 允许类型 / prefix              │
│ 校验错误保留非敏感文件元信息；需重选时明确说明                │
│ [取消]                                            [上传]      │
└────────────────────────────────────────────────────────────────┘

┌───────────── 背景：F0 对象行保持 ────────────────┬──────── [F4 Preview/Detail] ────────┐
│                                                  │ filename / object key [复制] / ×   │
│                                                  │ MIME / size / time / driver        │
│                                                  │ 安全图片/文本/PDF预览              │
│                                                  │ 不支持类型：元信息 + [下载]        │
│                                                  │ [下载] [删除]                      │
└──────────────────────────────────────────────────┴────────────────────────────────────┘

┌──────────────────────── [F5 Exact-key Delete Confirm] ─────────────────────────┐
│ 删除 Storage 对象：{filename}                                                  │
│ Key：{完整 object key} │ MIME │ size │ 此操作不可恢复、会写审计               │
│ 输入完整 object key [____________________________________________]             │
│ [取消]                                                [删除精确对象]           │
└────────────────────────────────────────────────────────────────────────────────┘
```

- Storage 未配置或 driver 不支持 list 时，由 `X7` 替换 `F2`；只显示缺失配置类别，不显示 endpoint secret/bucket credential。
- 不支持内联预览的文件不执行；文件内容不写 PostgreSQL、不进入 Audit。
- Mobile：`F1` 可换行但不压缩状态文字；`F3/F4` 全屏；`F5` 保留完整 key 输入和 safe-area Footer。

---

## 8. 审计日志

```text
┌┈┈┈┈┈┈┈┈┈┈┈┈┈┈ [L0 Audit Logs / append-only] ┈┈┈┈┈┈┈┈┈┈┈┈┈┈┐
┋ [L1 Read-only Note] 管理操作不可修改或删除；敏感字段已脱敏           ┋
┋ [G7] actor │ action │ resource type/id │ result │ 时间范围           ┋
┋──────────────────────────────────────────────────────────────────────┋
┋ [L2 List ↔] created_at actor action resource→实体详情 request_id result [查看] ┋
┋──────────────────────────────────────────────────────────────────────┋
┋ [G9] total / pageSize / pagination                                   ┋
└┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┘

┌──────────────────────────── [L3 Audit Detail] ───────────────────────────┐
│ [L4 Header] action / result / created_at / request_id [复制]             │
│ actor → A0 │ resource_type / resource_id → U1/W1/S1/F4/R2               │
│ [L5 Before / After] 脱敏只读 JSON viewer；默认展开前两层                │
│ [L6 Metadata] request关联 / 结果 / 错误类别；无密码/secret/token/session │
│ [关闭]                                                                   │
└───────────────────────────────────────────────────────────────────────────┘
```

- 无法映射的 resource ID 以 mono 原值保留，不创建占位实体。
- Mobile 的 `L3` 为全屏层；JSON viewer 局部横滚/换行，不造成页面根横滚。

---

## 9. 通用状态层、确认层与恢复

```text
┌───────────────────────────── [X0 State Region] ─────────────────────────────┐
│ [X1 Loading] 保留G3/G4/G7/表头尺寸；按真实列宽绘制Skeleton                 │
│              完成后 live region：“已加载 {n} 条”                          │
├─────────────────────────────────────────────────────────────────────────────┤
│ [X2 Empty] 系统空 / 筛选空 / 关系空 三种文案                               │
│            [允许的创建动作] 或 [移除单个筛选] [清除全部] [返回父实体]       │
├─────────────────────────────────────────────────────────────────────────────┤
│ [X3 Error] 400字段错误 / 401登录 / 403 permission / 404实体 / 409冲突 /    │
│            500/503失败范围 + Request ID                                    │
│            [聚焦首错] [登录后恢复安全URL] [刷新比较] [重试区域] [返回列表] │
├─────────────────────────────────────────────────────────────────────────────┤
│ [X6 Relation Warning] 外键/owner-author异常：只读事实 + 去关联实体/审计     │
├─────────────────────────────────────────────────────────────────────────────┤
│ [X7 Storage Unconfigured] 缺失 driver/endpoint/授权类别；动作禁用           │
│                           [部署修复说明] [重新检查]；不显示 credential       │
└─────────────────────────────────────────────────────────────────────────────┘

┌────────────────────────── [X4 Sensitive Confirm Dialog] ──────────────────────────┐
│ {停用用户 / 归档Workspace / 审核Story / 停用管理员 / 变更角色 / 删除Storage}     │
│ 对象：{人类可读名称} / {精确ID或Key}                                             │
│ 影响：{真实影响} │ 可否恢复：{是/否} │ 将写入审计                               │
│ {Reject原因必填 / Permission diff / Storage完整Key输入 / 高风险警告}             │
│ [取消]                                                    [具名危险动作]         │
└───────────────────────────────────────────────────────────────────────────────────┘

┌──────────────────────────── [X5 Unsaved Changes] ───────────────────────────┐
│ 尚有未保存更改。返回、关闭、Escape、刷新或路由跳转会丢失草稿。              │
│ [继续编辑]                                           [放弃并离开]          │
└──────────────────────────────────────────────────────────────────────────────┘
```

状态规则：

1. 查询失败绝不降级到假空数据或第二数据源；局部失败尽量原位替换，不摧毁 Shell 与上下文。
2. 401 清除保护数据后转登录；403 显示所需 permission；404 返回保留 query 的列表；409 保留草稿并展示服务器最新值。
3. Dialog、Drawer、Sheet、全屏层都锁焦；关闭后归焦触发行/按钮。Toast 不承载唯一错误信息。
4. Hover/focus 160–240ms；`prefers-reduced-motion` 下取消位移、缩放和非必要动画。
5. 所有输入有可见 Label、错误描述与 `aria-describedby`；排序使用 `aria-sort`，禁用分页使用真实 `disabled`。

---

## 10. 关联跳转与 URL 恢复

```text
[U1 User Detail]
   ├── [U5 Workspace count] ── owner_id={user.id} ──→ [W0 Workspace List]
   │                                                └── row → [W1 Workspace Detail]
   │                                                           └── [W5 Story count]
   │                                                                workspace_id={workspace.id}
   │                                                                └──→ [S0 Story List] → [S1]
   └── [U6 Story count] ───── author_id={user.id} ───→ [S0 Story List]

[S1 Story Detail]
   ├── [S4 Workspace] ──→ [W1 Workspace Detail]
   ├── [S4 Author] ─────→ [U1 User Detail]
   └── [S8 Audit] ──────→ [L3 Audit Detail]

[A2 Admin] ─ role ─→ [R2 Role] ─ permission ─→ [P0 Permissions]
    └──────────────────────────── 管理动作 ─────→ [L3 Audit Detail]

[F4 Storage Object] ─ delete/upload审计 ─→ [L3 Audit Detail]
```

- 列表的筛选、排序、页码、pageSize 全部写入 URL；变更筛选时 page 回到 1。
- Detail 使用可刷新恢复的 Resource 路由；返回恢复 query、滚动位置与原触发行焦点。
- 关系筛选器只保存稳定 ID，界面显示名称/邮箱；无效关系返回可理解错误而不是静默清空。

---

## 11. 统一模块索引

| ID | 模块 | 主要内容 | Desktop / Mobile |
|---|---|---|---|
| G0 | Admin Shell | 单一后台应用壳 | 1440双栏；390单栏 |
| G1 | Sidebar | 分组导航、品牌、治理入口 | 248px fixed；移动隐藏 |
| G2 | Main Canvas | 主内容画布 | `min-width:0`；根无横滚 |
| G3 | Breadcrumb | 返回、面包屑、更新时间 | 移动位于Header下 |
| G4 | Page Header | H1、说明、唯一主操作 | 移动主操作另起一行 |
| G5 | Paper Boundary | 页面唯一虚线主纸面 | 全宽暖纸，无卡片海 |
| G6 | Summary/Context | 指标、上下文、能力事实 | 移动纵排/换行 |
| G7 | Filter Bar | 搜索、筛选、chips、URL状态 | 移动搜索常显+M3 |
| G8 | Data/Detail Body | 表格、关系行、详情段落 | 仅容器可横滚 |
| G9 | Pagination | total、pageSize、页码 | 移动上一页/下一页 |
| G10 | Admin Identity | 当前管理员、角色、主题 | 移动进入M2/账户菜单 |
| M1 | Mobile Header | 菜单、品牌、主题、账户 | sticky 56px |
| M2 | Navigation Drawer | 全局分组导航 | `min(320px,88vw)`、锁焦 |
| M3 | Filter Sheet | 次级筛选与应用/清除 | Bottom Sheet + safe-area |
| D0 | Dashboard Paper | 总览内容容器 | 单一Paper |
| D1 | Dashboard Source | 数据库来源、刷新时间 | 真实事实 |
| D2 | User Metrics | 用户总数/状态 | 移动纵排 |
| D3 | Workspace Metrics | Workspace总数/状态 | 移动纵排 |
| D4 | Story Metrics | Story总数/分布 | 移动纵排 |
| D5 | Recent Stories | 最近更新Story | 详情关联链接 |
| D6 | Recent Operations | 最近管理操作 | Audit关联链接 |
| W0 | Workspace List | 查询、表格、分页 | 表格壳局部横滚 |
| W1 | Workspace Detail | 详情层框架 | 780px Drawer / 全屏 |
| W2 | Workspace Header | 名称、ID、关闭 | fixed |
| W3 | Workspace Basics | 名称、状态、时间 | 纵向详情段 |
| W4 | Workspace Owner | 所属User链接 | owner只读 |
| W5 | Workspace Stories | Story子列表与全部链接 | 最多10条 |
| W6 | Workspace Settings | 白名单字段与只读JSON | 安全只读未知字段 |
| W7 | Workspace Audit | 时间事实、审计链接 | 只读 |
| W8 | Workspace Actions | 编辑、归档 | fixed Footer |
| W9 | Workspace Form | 新建/合法编辑 | Drawer / 全屏 |
| W10 | Workspace Form Footer | 取消、保存 | fixed + safe-area |
| S0 | Story List | 查询、表格、分页 | 表格壳局部横滚 |
| S1 | Story Detail | 详情层框架 | 840px Drawer / 全屏 |
| S2 | Story Header | 标题、identifier、关闭 | fixed |
| S3 | Story Identity | title/type/id | 只读事实+合法字段入口 |
| S4 | Story Relations | Workspace、author链接 | 异常用X6 |
| S5 | Story Content | Markdown/长文本只读 | max-height局部滚动 |
| S6 | Story Metadata | JSON树与复制 | 只读、安全解析 |
| S7 | Story Timeline | 状态与时间事实 | 只读 |
| S8 | Story Audit | 关联管理操作 | 跳L3 |
| S9 | Story Actions | 编辑/审核/归档 | fixed Footer |
| S10 | Story Legal Edit | title/type/description | 禁止内部字段 |
| U0 | User List | 查询、关联计数、分页 | 表格壳局部横滚 |
| U1 | User Detail | 详情层框架 | 780px Drawer / 全屏 |
| U2 | User Header | 名称、邮箱、ID | fixed |
| U3 | Safe Profile | 非敏感用户资料 | 无凭据字段 |
| U4 | User Status | active/disabled | 维护入口 |
| U5 | User Workspaces | Workspace关联列表 | 跳W0/W1 |
| U6 | User Stories | Story关联列表 | 跳S0/S1 |
| U7 | User Audit | 用户相关操作 | 跳L3 |
| U8 | User Actions | 编辑、停用/启用 | fixed Footer |
| A0 | Admin Users | 管理员列表页 | 查询与分页 |
| A1 | Admin List | email/role/status/login | 具名动作 |
| A2 | Admin Form | 创建/编辑层 | Drawer / 全屏 |
| A3 | Admin Identity | email/name/status | email创建后只读 |
| A4 | Admin Password | 新密码输入 | 永不回填 |
| A5 | Admin Role Assignment | 角色选择、权限摘要 | 服务端RBAC |
| A6 | Admin Role Diff | 新增/移除与影响 | 保存前必看 |
| A7 | Admin Footer | 取消、复核保存 | fixed |
| R0 | Roles | 角色列表页 | 查询与分页 |
| R1 | Role List | type/count/admin/update | 关联链接 |
| R2 | Role Detail/Edit | 角色详情层 | 840px / 全屏 |
| R3 | Role Header | name/code/protection | fixed |
| R4 | Role Basics | name/description/code | 内置保护 |
| R5 | Role Impact | 管理员与权限数量 | 真实统计 |
| R6 | Permission Matrix | 域×能力矩阵 | 容器横滚、首列sticky |
| R7 | Permission Diff | 增删权限与风险 | 保存前必看 |
| R8 | Role Footer | 取消、复核保存 | fixed |
| P0 | Permissions | 权限只读页 | 无CRUD |
| P1 | Permission Note | 系统发布说明 | 常显 |
| P2 | Permission Groups | 按域分组的权限列表 | role count跳R0 |
| F0 | Storage Resources | Storage管理页 | 现有driver事实 |
| F1 | Capability Strip | 驱动与能力状态 | 无credential |
| F2 | File List | 文件、Key、MIME、大小、动作 | 容器横滚 |
| F3 | Upload Layer | 文件校验与上传 | Drawer / 全屏 |
| F4 | Preview/Detail | 元信息与安全预览 | Drawer / 全屏 |
| F5 | Delete Confirm | 完整Key二次确认 | 不可恢复提示 |
| L0 | Audit Logs | 审计列表页 | append-only |
| L1 | Audit Note | 只读、脱敏说明 | 常显 |
| L2 | Audit List | actor/action/resource/request | 表格壳横滚 |
| L3 | Audit Detail | 审计详情层 | Drawer / 全屏 |
| L4 | Audit Header | action/result/request/time | fixed |
| L5 | Before/After | 脱敏JSON差异 | 只读 |
| L6 | Audit Metadata | 请求关联与错误类别 | 无secret/file content |
| X0 | State Region | 状态容器 | 原位替换内容 |
| X1 | Loading | 保形Skeleton、live region | 不抖动 |
| X2 | Empty | 系统/筛选/关系空 | 精确恢复动作 |
| X3 | Error | 400/401/403/404/409/5xx | Request ID与恢复 |
| X4 | Sensitive Confirm | 停用/归档/审核/RBAC/删除 | 具名危险动作 |
| X5 | Unsaved Changes | 离开草稿确认 | 返回编辑/放弃 |
| X6 | Relation Warning | 外键/归属异常 | 只读事实与跳转 |
| X7 | Storage Unconfigured | 能力/配置缺失 | 不泄密、重新检查 |

---

## 12. 结构验收清单

- [x] 1440×1000：248px Sidebar、暖纸 Main、单一虚线 Paper、表格容器内横滚。
- [x] 390×844：56px Header、导航 Drawer、筛选 Sheet、详情/表单全屏、safe-area Footer。
- [x] 覆盖 Dashboard、Workspace/User/Story 列表与详情、RBAC、Storage、Audit。
- [x] 覆盖 loading、empty、400/401/403/404/409/5xx、Storage 未配置、关系异常。
- [x] 覆盖停用、归档、审核、权限 diff、Storage 精确 Key 删除与未保存更改确认。
- [x] User → Workspace → Story 双向跳转；RBAC/Storage → Audit 可追溯。
- [x] 搜索/筛选/排序/分页写 URL；返回恢复滚动和焦点。
- [x] 内容、JSON、Storage Preview 均为安全只读结构；敏感字段无显示槽位。
- [x] 未扩展模型、计费、网关；未引入迁移/同步/第二数据库/SQLite/`app/(app)`。
