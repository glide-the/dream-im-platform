# Ink Memory Admin 字段级页面层级与逻辑映射

> HTML Design Workflow / Stage 3 · Hierarchy Logic Mapper
> 依据：Stage 1 字段级 PRD、Stage 2 S01–Z10 草图、cc-switch 适配规范与目标图。
> 目标：把视觉区域收敛为可实现的路由、状态机、焦点层级和数据依赖；区域 ID 在桌面与移动端语义不变。

## 0. 逻辑总则

1. 唯一主流程是“列表真实行 → 最新详情 → 编辑或具名命令 → 可追溯回执”；不存在记录 ID 编辑器、默认 JSON CRUD 或通用永久删除。
2. 列表上下文由 URL 白名单参数保存；详情/表单覆盖层关闭后恢复原筛选、页签、分页、滚动位置和行触发器。
3. 关系只能由受权、分页、可搜索 Combobox 选择具名记录；ID 仅为结果辅助信息和复制值，不允许粘贴裸 ID。
4. 表单打开时只装载一次 `getOne` 初值。后台刷新可刷新列表，不得覆盖脏草稿；服务器版本变化转为“有较新版本”提示。
5. Pricing 只创建新版本；Secret 不回填；Usage、Gateway Request、Ledger、Audit 只读，Ledger/Audit append-only。
6. Story 只读写源 PostgreSQL 真实表；源不可用进入 `Z08/503`，不回退旧表、SQLite、JSON、localStorage 或内存数据。

## 1. 页面结构草图（模块分区，精炼版）

### 1.1 Desktop 1440×1000

```text
┌──────────────────────────────────── [S01 暖纸画布；根无横滚] ────────────────────────────────────┐
│┌──────────── [S02 Sidebar 248px] ────────────┐┏┈┈┈┈┈┈ 主纸面；唯一虚线边界 ┈┈┈┈┈┈┈┈┈┈┈┈┈┈┓│
││分组路由 / permission 裁剪 / 当前管理员     │┋ [S03 Topbar] 面包屑 · 数据源健康 · 管理员      ┋│
││                                            │┋ [S04 Heading] 标题 · 说明 · 来源 · 主动作      ┋│
││Story / Models / Billing / Gateway          │┋ [S05 Module Tabs ↔] 同域平级路由               ┋│
││Users / Access / System                     │┋ ┌─────────────── [L01–L04 查询带] ───────────┐ ┋│
││                                            │┋ │搜索│关系选择│状态/日期│刷新/清筛/创建/导出│ ┋│
││                                            │┋ └────────────────────────────────────────────┘ ┋│
││                                            │┋ [L05 结果范围 · 筛选摘要 · 来源 · 更新时间]   ┋│
││                                            │┋ ┌────────── [L06 Table Shell ↔] ────────────┐ ┋│
││                                            │┋ │[L07 识别/关系] [L08 状态/值/时间] [L09⋯] │ ┋│
││                                            │┋ └────────────────────────────────────────────┘ ┋│
││                                            │┋ [L10 分页；位于 L06 外]                       ┋│
│└────────────────────────────────────────────┘┋ [S06 Feedback / live region；不抢焦点]         ┋│
│                                              ┗┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┛│
└──────────────────────────────────────────────────────────────────────────────────────────────────┘

列表行 L09
├─ 查看 ─getOne→ [D01 Header][D02 Base][D03 Relations][D04 Timeline][D05 Projection][D06 Audit][D07 Footer]
├─ 编辑 ─getOne→ [E01][E02 Typed][E03 Relation][E04 Special][E05 Error][E06 Footer]；脏态由 [E07] 守卫
├─ 复杂编辑 ─→ Provider[P01–P11] / Model[M01–M08] / Pricing[R01–R09] / Role[X01–X07]
└─ 高风险命令 ─重取状态与影响→ [K01–K06] ─→ [Z09 Receipt]
```

详情 `D01`、简单表单 `E01`、Model `M01`、Request `Q01` 在桌面是右 Drawer/Modal；Provider `P01`、Pricing `R01`、Reconciliation `C01`、Role `X01` 是全屏/独立页。固定 Header/Footer 之外只有中段纵滚。

### 1.2 Mobile 390×844

```text
┌────────────────────── [S01 viewport；scrollWidth≤clientWidth] ──────────────────────┐
│┏┈┈┈┈┈┈┈┈ 主纸面；16px 内距；唯一虚线边界 ┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┓│
│┋ [S03 52px] 菜单→S02 Drawer │ 页名/面包屑 │ 主动作/管理员          ┋│
│┋ [S04 标题→说明→来源]                                               ┋│
│┋ [S05 Tabs ↔]                                                       ┋│
│┋ [L01 搜索常显] [L02+L03→Filter Sheet] [L04 刷新/清筛]             ┋│
│┋ [L05 两行结果上下文]                                               ┋│
│┋ ┌────────────────── [L06 局部横滚 ↔] ────────────────────────────┐ ┋│
│┋ │ [L07 名称/关系] │ [L08 状态/关键值] │ [L09 44×44]             │ ┋│
│┋ └─────────────────────────────────────────────────────────────────┘ ┋│
│┋ [L10 上一页/下一页] [S06 safe-area 上方反馈]                       ┋│
│┗┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┛│
└─────────────────────────────────────────────────────────────────────────────────────┘

覆盖层：D01/E01/M01/Q01/K01/P01/R01/C01/X01 → viewport 全屏
结构：sticky Header → 单列中段纵滚 → sticky Footer + safe-area；末字段下留 ≥96px
```

移动端只是重排，不删语义：详情按 `D02→D06`，Provider 按 `P03→P10`，Pricing 按 `R03→R08`，Request 按 `Q03→Q09`，Reconciliation 按 `C03→C08`，Role 按 `X03→X06` 顺序单列。

## 2. 页面层级结构图（Root → Shell → Section → Module → Component）

```text
[Root] /admin（Session + server permission）
└─ [Shell] S01 Admin Shell
   ├─ [Section] 全局导航
   │  └─ [Module] S02 Sidebar
   │     └─ [Component] 分组资源链接 / 当前项 / 管理员 permission 摘要
   ├─ [Section] 路由上下文
   │  ├─ [Module] S03 Topbar → 面包屑 / 健康 / 用户菜单
   │  ├─ [Module] S04 Heading → 标题 / 说明 / 来源 / 主动作
   │  └─ [Module] S05 Tabs → 同域平级路由
   ├─ [Section] 列表路由
   │  ├─ [Module] 查询 → L01 搜索 / L02 关系 / L03 状态日期 / L04 动作
   │  ├─ [Module] 结果 → L05 Context / L06 Table / L10 Pagination
   │  │  └─ [Component] L07 主识别关系 / L08 状态数值时间 / L09 行动作
   │  └─ [Module] Usage 特化 → U01–U09
   ├─ [Section] 记录上下文（互斥主容器，可嵌套子层）
   │  ├─ [Module] D01–D07 通用详情
   │  ├─ [Module] Q01–Q09 Request/Usage 只读详情
   │  ├─ [Module] E01–E07 简单表单
   │  ├─ [Module] P01–P11 Provider 全屏表单
   │  ├─ [Module] M01–M08 Model Drawer
   │  ├─ [Module] R01–R09 Pricing 新版本全屏表单
   │  ├─ [Module] C01–C09 Reconciliation 命令页
   │  ├─ [Module] X01–X07 Role 权限页
   │  └─ [Module] T01–T07 Storage 能力页
   ├─ [Section] 命令与确认
   │  └─ [Module] K01 Confirmation
   │     └─ [Component] K02 Context / K03 Impact / K04 Diff / K05 Evidence / K06 Submit
   └─ [Section] 状态与反馈
      ├─ [Module] Z01–Z10 精确替代态/回执/脏态确认
      └─ [Module] S06 aria-live（可叠加但不接管焦点）
```

## 3. 区域责任字典

| 范围 | 可实现责任 |
|---|---|
| S01–S06 | `S01` 根画布；`S02` 权限导航；`S03` 顶栏；`S04` 标题动作；`S05` 域内页签；`S06` 非抢焦反馈。 |
| L01–L10 | `L01` 搜索；`L02` 关系筛选；`L03` 状态/日期；`L04` 刷新/清筛/允许动作；`L05` 结果上下文；`L06` 表格横滚壳；`L07` 识别关系；`L08` 状态值时间；`L09` 行动作；`L10` URL 分页。 |
| D01–D07 | `D01` Drawer/Header；`D02` 基础；`D03` 关系；`D04` 状态时间线；`D05` 领域投影；`D06` 风险审计；`D07` Footer。 |
| E01–E07 | `E01` 简单表单；`E02` 类型化字段；`E03` 关系 Combobox；`E04` tags/money/JSON/Secret；`E05` 服务器错误；`E06` Footer；`E07` 脏态守卫。 |
| K01–K06 | `K01` 确认层；`K02` 当前服务器状态；`K03` 真实影响；`K04` before→after；`K05` reason/ticket/idempotency；`K06` 防重复命令。 |
| P01–P11 | `P01` Provider 全屏；`P02` Header；`P03` 预设/协议；`P04` 基础；`P05` 凭据；`P06` Endpoint；`P07` Model 摘要；`P08` 受管配置；`P09` 扩展 JSON；`P10` 影响错误；`P11` Footer。 |
| M01–M08 | `M01` Model Drawer；`M02` Header；`M03` Provider 关系；`M04` 身份；`M05` Token 上限；`M06` 能力；`M07` 启用影响；`M08` Footer。 |
| R01–R09 | `R01` Pricing 全屏；`R02` Header；`R03` Model/Tier；`R04` 四价；`R05` 公式；`R06` 生效窗；`R07` 旧新 diff；`R08` 冲突影响；`R09` 创建版本。 |
| U01–U09 | `U01` Usage；`U02` 全局筛选；`U03` 事实摘要；`U04` 趋势；`U05` 三页签；`U06` Request；`U07` Provider 统计；`U08` Model 统计；`U09` 元信息/分页。 |
| Q01–Q09 | `Q01` 只读 Drawer；`Q02` Header；`Q03` 用户/Key；`Q04` 路由；`Q05` Token；`Q06` 价格快照；`Q07` Ledger；`Q08` 性能时间；`Q09` 脱敏错误摘要。 |
| C01–C09 | `C01` Reconciliation 页；`C02` Header；`C03` 冻结上下文；`C04` disposition；`C05` settle Token；`C06` release 证据；`C07` reason/幂等；`C08` 影响预览；`C09` Footer。 |
| X01–X07 | `X01` Role 页；`X02` Header；`X03` 身份；`X04` 域导航；`X05` 权限矩阵；`X06` 影响 diff；`X07` Footer。 |
| T01–T07 | `T01` Storage 页；`T02` Driver 健康；`T03` 能力/prefix；`T04` 上传；`T05` 进度回执；`T06` known-key 诊断；`T07` 只读 metadata。 |
| Z01–Z10 | `Z01` Loading；`Z02` 筛选空；`Z03` 系统/关系空；`Z04` 400；`Z05` 401/403；`Z06` 404；`Z07` 409；`Z08` 500/503；`Z09` 成功回执；`Z10` 脏态确认。 |

## 4. 路由与 URL 状态

### 4.1 菜单叶子

| 分组 | 列表/能力路由 |
|---|---|
| Story | `/admin/story/workspaces`、`/admin/story/stories`、`/admin/story/characters`、`/admin/story/scenes`、`/admin/story/workflow-runs` |
| Models | `/admin/models/providers`、`/admin/models/models`、`/admin/models/pricing`、`/admin/models/permissions` |
| Billing | `/admin/billing/usage`、`/admin/billing/accounts`、`/admin/billing/ledger`、`/admin/billing/reports` |
| Gateway | `/admin/gateway/requests`、`/admin/gateway/reconciliation`、`/admin/gateway/keys`、`/admin/gateway/rate-limits` |
| Users/Resources | `/admin/resources/users`、`/admin/resources/storage`；Platform Identity 从 User 详情联动进入 |
| Access | `/admin/access/admins`、`/admin/access/roles`、`/admin/access/permissions` |
| System | `/admin/system/settings`、`/admin/system/audit` |

### 4.2 路由状态契约

```text
列表 URL
  ?q=&page=&pageSize=&sort=&order=&tab=&from=&to=&{资源白名单筛选}
  ├─ 筛选、排序、tab 改变：page=1；写 URL 后请求
  ├─ page/pageSize 改变：写 URL；完成后聚焦 L05
  └─ 自动刷新：不改 URL、tab、page、选中行或已开覆盖层

列表路径
  ├─ /new                 → 创建容器 E01/P01/M01/R01/X01
  ├─ /[id]                → D01/Q01；客户端从列表进入可呈现 Drawer，深链可独立呈现
  ├─ /[id]/edit           → E01/P01/M01/X01；先 getOne
  └─ 具名命令             → K01，不使用通用 /delete

显式例外
  ├─ /admin/gateway/reconciliation/[requestId] → C01；只能从异常队列/Request 进入
  ├─ Pricing → “创建价格版本”；旧 ID 仅作只读基线/引用，不提供历史 edit/delete
  └─ Z09 Receipt 是 mutation response 的内存态；Gateway Key 明文、Secret 不写 URL/storage
```

具体资源可用 `new/[id]/edit` 必须由服务端资源能力表决定：Story 产物无创建/硬删；Workflow、Usage、Request、Ledger、Permission code、Audit 无编辑；Storage 无 list/count/delete。

## 5. 页面与写入状态机

### 5.1 列表 → 详情 → 编辑/停用 → 回执

```text
LIST_READY(L01–L10)
├─ row:view → DETAIL_LOADING(Z01) → getOne
│  ├─ 200 → DETAIL_READY(D01–D07)
│  │  ├─ edit → FORM_LOADING(Z01) → FORM_CLEAN(E/P/M/X)
│  │  │  ├─ input → FORM_DIRTY
│  │  │  ├─ submit → VALIDATING → SUBMITTING
│  │  │  │  ├─ 2xx → RECEIPT(Z09) → revalidate list+detail → return focused row
│  │  │  │  ├─ 400 → Z04/E05 → first invalid field
│  │  │  │  ├─ 403 → Z05 → disable submit, retain no protected values
│  │  │  │  ├─ 404 → Z06 → close overlay, return list
│  │  │  │  ├─ 409 → Z07 → keep draft + latest version/diff
│  │  │  │  └─ 503 → Z08 → keep draft + retry same source
│  │  │  └─ close/back/refresh/route while dirty → Z10 → continue | discard
│  │  └─ disable/archive/revoke/reject/adjust → IMPACT_LOADING → K01–K06
│  │     └─ re-read version+impact → submit → Z09 | Z04/Z05/Z06/Z07/Z08
│  ├─ 403 → Z05    ├─ 404 → Z06    └─ 503 → Z08
└─ background refresh → list rows update atomically；不重置 URL/焦点/草稿
```

`409` 的“载入最新值”是显式二次确认：确认后才丢弃旧草稿并重新 `getOne`；不得把自动刷新结果合并进用户输入。命令提交禁重复；网络结果未知时以 idempotency key 查询回执。

### 5.2 Pricing 新版本

```text
Pricing list/detail → R01 NEW_VERSION_CLEAN
→ R03 选择/锁定 Model+Tier
→ R04–R06 输入价格、公式、生效窗
→ PREVIEW → R07 old→new + R08 overlap/impact
→ CREATE_VERSION
   ├─ 2xx：事务结束旧 effective_to（若需）+ 插入新行 → Z09
   ├─ 400：Z04 聚焦精确字段
   └─ 409：Z07/R08 高亮冲突版本，草稿保留
```

按钮必须写“创建价格版本”。已开始生效或被 Request 快照引用的价格金额/起始时间只读；无历史 PATCH 改价和 DELETE。

### 5.3 Reconciliation

```text
settlement_failed row / Q01 link
→ C03 冻结上下文（Request ID只读；503不可进入填写态）
→ C04 disposition
   ├─ settle → C05 四类 Token（unknown 不预填 0）
   └─ release → C06 evidence + ticket
→ C07 reason + idempotency → C08 server impact preview
→ 若 version 改变：Z07 → 刷新 preview → 再确认
→ C09 submit → Z09 immutable Request/Ledger/Audit receipt
```

## 6. 焦点层级、嵌套与 Escape

### 6.1 层级优先级（数值越高越先处理）

| 级别 | 层 | 示例 | Tab / Escape / 归还 |
|---:|---|---|---|
| 0 | 非交互播报 | S06 | 不接管焦点；`aria-live=polite`。 |
| 1 | 基页 | S01–S05、L01–L10、U01–U09、T01–T07 | 正常文档序；打开覆盖层后背景 inert。 |
| 2 | 路由覆盖层/全屏页 | D01、E01、P01、M01、R01、Q01、C01、X01 | 锁焦；初焦标题，错误时首错；关闭归还保存的触发器。 |
| 3 | 控件浮层 | S02 Mobile Drawer、L02/L03 Filter Sheet、E03 Combobox、Select/Date Picker/Popover | 只锁定自身适用范围；Escape 先关当前最内层并归还输入/按钮。 |
| 4 | 命令确认 | K01–K06 | 锁焦；取消归还命令触发器；成功聚焦 Z09 标题。 |
| 5 | 脏态确认 | Z10 | 全局最高；Escape 等同“继续编辑”，焦点回到触发离开的原字段/按钮。 |

### 6.2 允许的嵌套

```text
Base list
├─ D01 Detail → E01 Edit → E03 Combobox
│              └─ K01 Secret覆盖/高风险确认 → Z10（若已有输入）
├─ P01 Provider → P07 打开 M01 Model → M03 Provider Combobox
├─ U01 Usage → Q01 Request → “前往 Reconciliation”切换到 C01 路由
└─ 任一 dirty Form/Full-screen → Z10
```

- 每次打开都记录 `returnFocusKey={route,recordId,action}`。详情关闭归 `L09` 原行；该行因刷新消失则归 `L05`。编辑关闭归 `D07` 的“编辑”；全屏创建归 `S04` 主动作；Reconciliation 返回异常队列对应行。
- Escape 顺序：最内层 Combobox/Popover/Date Picker → K01 → 当前 Drawer/Modal/全屏页；若当前层 dirty，不关闭而打开 Z10。S02 Drawer 和 Filter Sheet 在无更高层时响应 Escape/遮罩。
- Provider 脏草稿中打开 M01 后，Model 成功只刷新 P07 摘要，不重置 P03–P10。Q01 在核对期间保持打开时快照，后台新版本只显示提示。
- 浏览器返回、Header 返回、关闭、刷新、路由跳转均走同一 E07/Z10 守卫；不能只拦 Escape。

## 7. 数据依赖与领域动线

### 7.1 Provider → Model → Pricing

```text
Provider(P03–P10)
└─ Model(M03–M07；provider_id 来自真实选择/锁定)
   ├─ Pricing Version(R03–R08)
   │  └─ Request Price Snapshot → Usage(Q05/Q06) → Ledger(Q07)
   ├─ User Model Permission(E03/E02)
   └─ Gateway Request(Q04)
```

Provider 停用先查询 enabled Models 与近期 Request；Model 启用要求 Provider active。Pricing overlap、Model/Provider 唯一/FK 冲突均以 409 返回相关具名记录链接。

### 7.2 User → Permission → Usage → Billing

```text
Source User（只读源）
└─ Platform Billing Identity（从 User 详情发起并锁定 source/external_user）
   ├─ User Model Permission（User + Model 真实 Combobox；编辑后关系锁定）
   ├─ Gateway Request → Usage + Price Snapshot
   └─ Billing Account → Ledger Entries
```

User 详情到 Permission、Usage、Request、Account、Ledger、Key 只携带白名单 query；删除 Permission override 表示恢复默认，不删除用户/模型/历史限流。余额只经具名 adjustment/reversal 命令改变。

### 7.3 Gateway Request → Usage → Ledger → Reconciliation

```text
Gateway Request（immutable）
├─ normal → Usage + Pricing Snapshot（immutable）→ Ledger Entry（append-only）
└─ settlement_failed/unknown/inconsistent → Reconciliation(C01–C09)
   └─ settle/release → 新 Ledger Entry / reversal + Audit（append-only）
```

Reconciliation 是异常分支，不是编辑旧 Request/Usage/Ledger；Q01 只读展示路由、四类 Token、价格快照、结算、Ledger、性能和脱敏错误，不展示完整 Prompt/Response 或 Key 明文。

### 7.4 Workspace → Story → Character/Scene → Workflow

```text
Workspace
└─ Story
   ├─ Character（Story↔Character M:N，含 role_type）
   ├─ Scene（按 order_index；story_id 可空）
   │  └─ Character（Scene↔Character M:N）
   └─ Workflow Run / Agent provenance（只读 timeline/transition/四类 Token）
```

Story/Character/Scene 关系投影在 D03/D05 展示；Scene 改 Story 只能选同 author+workspace 的候选。正文、关系数组和 provenance 不降级为可编辑 JSON；没有 PostgreSQL 命令适配器时 Workflow 不显示 retry/cancel。

## 8. 并发刷新、URL 与数据源

| 场景 | 规则 |
|---|---|
| 手动/自动刷新列表 | 重新请求当前 URL；不改 `page/tab/filter/sort`，不关闭 D/Q，不重置焦点。 |
| 筛选/页签/排序变化 | 写白名单 URL；筛选/排序/tab 改变将 `page=1`；请求期间旧表头保留并进入 Z01。 |
| D01 只读详情刷新 | 可按完整响应原子替换并 polite 播报；若已进入 E/P/M/R/X，则只提示服务器版本，不写入表单。 |
| U01/Q01 自动刷新 | U03–U09 可刷新；Q01 当前核对快照不被覆盖，显示“有较新版本”与显式重载。 |
| 关系 options 刷新 | 保留当前已选具名对象；若无权/消失，显示 403/404，不退化为裸 ID 输入。 |
| 409 | 同屏保存草稿与服务器最新值/版本；重新加载需二次确认，禁止 last-write-wins。 |
| Story/source 503 | 页面或关系区进入 Z08；保留筛选/草稿；重试同一 PostgreSQL 源，控制面其他域仍可用。 |

## 9. 错误与回执映射

| 状态 | 区域和行为 | 焦点/恢复 |
|---|---|---|
| Z01 Loading | 保留 S03–S05、查询和表头；骨架等高。 | 不跳焦；完成后 S06 播报。 |
| Z02 Filter Empty | 显示当前筛选与清筛。 | 清筛后聚焦 L05。 |
| Z03 System/Relation Empty | 区分系统无数据与 Combobox 无选项；只在可创建域给入口。 | 关系空态提供返回父资源。 |
| Z04 400 | E05 顶部摘要 + 字段错误，草稿保留。 | 聚焦首错；摘要锚点可回字段。 |
| Z05 401/403 | 清除保护值；403 说明所需 permission，不显示资源值。 | 聚焦错误标题；登录后安全回原 URL。 |
| Z06 404 | 记录消失/不可见，关闭失效覆盖层。 | 返回列表并聚焦 L05 或仍存在的原行。 |
| Z07 409 | 冲突类型、最新版本、相关记录、当前草稿并列。 | 聚焦冲突标题；载入最新需确认。 |
| Z08 500/503 | 安全文案、Request ID、重试；503 标明源。 | 保留筛选/草稿；无数据源回退。 |
| Z09 Success | 动作、resource ID、Request ID、Audit/Ledger receipt。 | 聚焦回执标题；刷新列表/详情后归行。 |
| Z10 Dirty | “继续编辑/放弃更改”。 | 最高层锁焦；取消离开归原字段。 |

Gateway Key 明文只可出现在本次创建的 Z09，关闭后不可恢复；Provider/System Secret 回执也不包含历史值或本次明文，Audit before/after 必须脱敏。

## 10. 响应式与滚动所有权

| Owner | Desktop | Mobile | 禁止外溢规则 |
|---|---|---|---|
| S02 | 固定 248px | `min(320px,88vw)` 左 Drawer | 打开锁焦，关闭归菜单按钮。 |
| S05/U05/X04 | 横向紧凑 tabs/domain nav | 自身横滚 | 不带动页面。 |
| L06/U06–U08/X05 | 表格局部横滚，可键盘聚焦并有说明 | 保留主识别、状态/关键值、行详情 | 分页 L10/U09 在滚动壳外。 |
| U04 | 正常图宽 | 图内平移/重排 | 图容器裁切交互，不扩大根宽。 |
| D/E/M/Q | 720–840px Drawer/Modal | 全屏 | 中段纵滚，Header/Footer 固定。 |
| P/R/C/X | 全屏，内容最大 1120px | 全屏单列 | Footer safe-area；末字段余量≥96px。 |
| T01 | 单一能力页 | T02→T07 单列 | 无假资源表、目录树或删除入口。 |

`S01` 不得靠隐藏真实布局错误实现无横溢：长 code/ID/URL 在本组件截断、换行并提供复制；JSON 编辑器折行；`D03/D05/Q04/Q07` 关系链换行。所有触控目标至少 44×44px。

## 11. cc-switch 继承与禁止项

- 保留：Provider 全屏分区与固定操作、Pricing 全屏价格版本流程、Usage 全局筛选驱动摘要/趋势/页签、Request Detail 的只读核对分区。
- 重写：所有视觉使用 Ink Memory 暖纸 Token；数据来自 PostgreSQL、Session/RBAC、Zod、事务和审计；金额提交为整数 micro-USD。
- 不复制：Tauri 窗口/拖拽、本地配置或 localStorage 状态、覆盖式定价保存、Pricing 删除、可编辑 Request/Ledger、硬编码蓝灰和装饰性指标。
- 真实聚合不可用时显示“暂不可用”；只有查询成功且确为零记录时才显示 `0 + 空态说明`。

## 12. 歧义决议

1. Stage 2 将详情/表单表现为 Drawer/全屏，但没有规定深链语义；本图以 `[id]`、`[id]/edit` 的逻辑路由表达，实际可用 Next.js intercepted route 呈现 Drawer，直接访问仍必须有独立可恢复页面。
2. Gateway 链路文字常写成 `Request→Usage→Ledger→Reconciliation`；按不可变账本约束，Reconciliation 应是异常 Request 的补偿分支，结果追加 Ledger/Audit，绝不位于旧 Ledger 的编辑尾端。
3. Story 层级是导航层级，不是纯树形外键：Story–Character、Scene–Character 均为 M:N，Scene `story_id` 可空；界面必须使用具名关系投影。
4. cc-switch 的自动刷新和本地偏好不能直接移植；本实现以 URL 为查询真相源，以服务器 `version/updated_at` 检测陈旧数据，以 Z10 保护草稿。
