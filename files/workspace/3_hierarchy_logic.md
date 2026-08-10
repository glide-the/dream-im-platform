# Expert Prompt Architect 记录（非递归，仅一次）

## Optimized Prompt

综合 Stage 1 PRD、Stage 2 结构草图与原始品牌封面，为 Ink Memory Admin v3 的“紧凑页面/列表头 +
可折叠筛选”建立中文层级逻辑图。严格沿用 `A0–I8` 稳定 ID；明确 Desktop/Mobile 承载归属、
`collapsed ↔ expanded`、URL `applied` 与本地 `draft`、清除/应用副作用、组件持续挂载、共享消费者与
独立适配器，以及 loading/error/filter-empty/system-empty。仅继承暖纸、深棕、少面板、轻分隔、
单一虚线边界；实现限定 Tailwind CSS 4、本地字体和本地 SVG/React SVG，不扩展表格、权限或领域流程。

# Ink Memory Admin v3：页面结构草图（精炼）

> Stage 3 — Hierarchy Logic Mapper
> Desktop `1440×1000`；Mobile `390×844`。原图是品牌封面，不是后台页面截图。

## 1. 稳定 ID 与总骨架

```text
[A0 页面内容区]
├─ [A1 PageHeader] 唯一 H1 / 短说明 / 元信息 / 唯一主动作
└─ [B0 ListSurface] 唯一虚线 Paper Boundary
   ├─ [B1 AdminListHeader] H2 或 sr-only / 结果数 / 刷新
   ├─ [C0 AdminQueryBar] 常显查询与筛选状态
   │  ├─ [C1 PrimaryQuery] 关键词或精确 ID
   │  ├─ [C2 FilterToggle] 展开状态 / 已应用数量
   │  ├─ [C3 AppliedFilterSummary] URL 已应用摘要 / 逐项移除
   │  ├─ [C4 DraftHint] 本地草稿与 URL 不同时提示
   │  └─ [D0 SecondaryFilters] 同一字段树，不同视口承载
   │     ├─ [D1] 主要关系 Combobox
   │     ├─ [D2] 状态 / 枚举
   │     ├─ [D3] 日期 / 时间窗
   │     ├─ [D4] 清除
   │     ├─ [D5] Desktop 应用
   │     ├─ [D6] Mobile Sheet 标题 / 关闭
   │     └─ [D7] Mobile Sticky Actions / safe area
   ├─ [E0 QueryStatus] 范围 / 总数 / 来源 / 同步 / 错误
   ├─ [F0 DataRegion] 表格、空态或旧结果；唯一数据横滚壳
   └─ [G0 Pagination] URL 驱动分页 / pageSize / 范围

[H0 useAdminListQueryState] 为 C0、D0、E0、G0 提供统一状态逻辑
[I1–I8 ResourceAdapter] 只注入领域字段、白名单、摘要与动作
```

约束：`A–I` 在所有资源、状态和视口中语义不变；隐藏不等于改号或销毁。

## 2. Desktop 页面结构草图

```text
┌────────────────────────────── [A0 / Desktop] ──────────────────────────────┐
│ [A1] H1 + 最多两行说明         {来源/更新时间}              [唯一主动作] │
│ ┌┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈ [B0 单一虚线边界] ┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┐ │
│ ┋ [B1] H2/sr-only                         {结果数/暂不可用} [刷新] ┋ │
│ ┋──────────────────────────────────────────────────────────────┋ │
│ ┋ [C0] [C1 搜索/精确 ID_______________] [C2 筛选 N ▾/▴]       ┋ │
│ ┋      [C3 chip ×][chip ×][+N]  [C4 有未应用更改]             ┋ │
│ ┋──────────────── [D0：收起时视觉隐藏、展开时原位显示] ────────┋ │
│ ┋ [D1 关系________] [D2 状态______] [D3 从____至____]          ┋ │
│ ┋                                    [D4 清除] [D5 应用]       ┋ │
│ ┋──────────────────────────────────────────────────────────────┋ │
│ ┋ [E0] {1–20 / 总数 / 来源 / 正在同步 / 错误摘要}              ┋ │
│ ┋ [F0] caption + sticky 表头/主列；真实行 / 空态 / 保留旧结果  ┋ │
│ ┋ [G0] {范围}             [20/50/100] [上一页] 1…n [下一页]    ┋ │
│ └┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┘ │
└────────────────────────────────────────────────────────────────────────────┘
```

- `A1 + B1 + collapsed C0` 目标高度 `76–112px`；交互目标仍至少 `44×44px`。
- `B1` 与 `A1` 同义时只保留 `sr-only` H2；Header 不放危险动作。
- `D0` 与 `C0` 只用实线分隔，不新增卡片或阴影。

## 3. Mobile 页面结构草图

```text
┌────────────────────── [A0 / Mobile 390×844] ──────────────────────┐
│ [A1] H1（最多两行） / 元信息 / 唯一主动作                         │
│ ┌┈┈┈┈┈┈┈┈┈┈┈ [B0 单一虚线边界] ┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┐ │
│ ┋ [B1] H2/sr-only                   {结果数} [刷新]       ┋ │
│ ┋ [C0] [C1 搜索______________] [C2 筛选 N]              ┋ │
│ ┋      [C3 chip ×][+N] [C4 有未应用更改]                ┋ │
│ ┋ [E0] {范围 / 总数 / 同步 / 错误，最多两行}             ┋ │
│ ┋ [F0] 表语义保留；主列 sticky；仅表格壳横滚            ┋ │
│ ┋ [G0] {范围}                   [上一页] [下一页]        ┋ │
│ └┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┘ │
└───────────────────────────────────────────────────────────────────┘

┌───────────────────── [D0 MobileFilterSheet] ─────────────────────┐
│ [D6] 筛选 / 关闭 ×                                                 │
│ [D1] 主要关系（全宽）                                              │
│ [D2] 状态/枚举（全宽）                                             │
│ [D3] 日期/时间（纵向）                                             │
│ {错误摘要 role=alert；字段错误紧邻控件}                            │
│ ┌────────────── [D7 Sticky Actions + safe area] ────────────────┐ │
│ │ [取消]                         [D4 清除] [应用]                │ │
│ └───────────────────────────────────────────────────────────────┘ │
└───────────────────────────────────────────────────────────────────┘
```

Mobile 的 `D0` 由 Sheet 拥有呈现、锁焦与 inert；`H0` 仍拥有草稿、已应用值和 URL。
Sheet 关闭后归焦 `C2`；根页面不横滚，只有 `F0` 与既有 Tabs 可局部横滚。

## 4. Parent–Child 逻辑与所有权

```text
Page Root [A0]
├─ Page Context [A1]                         ← 页面级所有权
└─ List Experience [B0]
   ├─ Resource Context [B1]                  ← 共享呈现 + I* 文案/动作
   ├─ Query Controller [C0]                  ← 共享呈现
   │  ├─ Primary Input [C1]
   │  ├─ Disclosure Trigger [C2] ─controls─> [D0]
   │  ├─ Applied Projection [C3] <────────── applied(URL)
   │  ├─ Dirty Projection [C4] <──────────── draft != applied
   │  └─ Secondary Input Tree [D0]
   │     ├─ Field Adapters [D1–D3] <──────── I1–I8 definitions
   │     └─ Commands [D4–D7] ──────────────> H0 transition API
   ├─ Query Feedback [E0] <───────────────── request state + URL
   ├─ Results [F0] <──────────────────────── last successful query
   └─ Paging [G0] ─────────────────────────> URL page/pageSize

State Owner [H0]
├─ applied：URL 白名单值（唯一查询真相源）
├─ draft：本地可编辑值；外部 URL 导航时重新同步
├─ disclosure：collapsed / expanded；纯视觉，不写 URL
├─ request：idle / loading / success / error；旧请求取消或末次胜出
└─ hydration：稳定 ID → 显示 label；label 不写 URL
```

`D0` 应保持逻辑挂载：Desktop 可用 `hidden`/可访问性控制，Mobile 可由 Portal 改变视觉父级；
切换承载或收起不得重建字段定义、丢失 `draft`、清除 `applied` 或重置 `page`。

## 5. 折叠/展开状态转换

```text
[collapsed]
  C1/C2/C3/C4 可见；D0 视觉隐藏但状态仍在 H0
  ├─ click C2 / Enter ───────────────────────────────> [expanded]
  │   Desktop：D0 原位 region；焦点进入首个 D1–D3
  │   Mobile：打开 D0 Sheet；记录 openingDraft；焦点锁定
  └─ URL 外部变化：applied 重建，draft 同步；保持 collapsed

[expanded]
  ├─ click C2 / Escape / close D6 ───────────────────> [collapsed]
  │   保留 draft；不请求、不改 URL、不改 page；焦点回 C2
  ├─ Mobile cancel ──────────────────────────────────> [collapsed]
  │   draft = openingDraft；applied/URL/结果不变；焦点回 C2
  └─ viewport 改变：D0 region ↔ Sheet；H0 状态不换 owner、不丢值
```

`aria-expanded` 与当前显示一致，`aria-controls` 指向同一语义 `D0`；减弱动画时直接切换。

## 6. Applied / Draft 与命令副作用

```text
输入 D1–D3：draft' = edit(draft)；不改 URL；不请求
draft == applied：C4 隐藏；D5/应用禁用
draft != applied：C4 显示“有未应用更改”；折叠后仍可见

Apply：
  validate(draft) → URL = whitelist(draft) + page=1 → applied = URL
  → 发起查询；Desktop 保持用户展开偏好；Mobile 应用后关闭并归焦 C2

Clear [D4]：
  draft = empty user filters → URL 移除用户筛选且 page=1 → applied = URL
  → 发起查询；保留允许的 tab 与系统默认筛选，后者不计入 C2 数量

Remove chip [C3]：
  同时移除对应 draft/applied URL key → page=1 → 发起查询

Back/Forward/Deep link：
  URL → applied → draft；摘要、字段、页码和结果按同一 URL 恢复
```

筛选折叠/展开本身零查询副作用；自动刷新不得覆盖 URL、draft、D0 状态或已打开 Drawer。

## 7. 查询反馈：Loading / Error / Empty

| 状态 | [E0] 反馈 | [F0] 内容 | 状态保留与动作 |
|---|---|---|---|
| Initial loading | “正在加载” | 骨架但保持表结构 | 保留 URL、draft、disclosure |
| Refresh/loading | “正在同步” | 保留旧成功结果，不伪造 0 条 | 可取消旧请求，末次查询胜出 |
| Query error | “加载失败”+ request ID + 重试 | 保留旧结果上下文 | 不清 URL/draft/applied/D0 |
| Filter empty | “无符合条件结果”+条件摘要 | 空态 + 清除筛选 | 清除走 D4 语义并回 page=1 |
| System empty | “尚无可显示数据”+真实原因 | 领域允许的主动作 | 不显示清筛，不伪造权限结论 |
| Success | 范围/总数/来源/更新时间 | 真实表格行 | 结果与 URL applied 一致 |

## 8. 共享消费者与独立适配器

```text
共享组件 / 状态：
  [B1] AdminListHeader
  [C0–C4] AdminQueryBar / AppliedFilterSummary
  [D0–D7] DesktopFilterRegion / MobileFilterSheet
  [H0] useAdminListQueryState

共享消费者（同一语义，不各自复制状态机）：
  AdminResourceTable ─────┐
                          ├─ consume B1/C*/D*/H0
  AdminResourceManager ───┘

独立适配器（只供给定义，不拥有共享状态机）：
  [I1] Story：workspace/story、审核/发布、版本动作
  [I2] 用户/订阅：email/ID、套餐周期、取消/恢复
  [I3] 套餐/权益：不可变版本、Token、micro-USD 来源
  [I4] Gateway Key：prefix、一次性回执、撤销/轮换
  [I5] 请求/用量：request ID、模型、时间、状态、延迟
  [I6] 只追加账本：关系、时间、事件、金额快照；无编辑/删除
  [I7] Provider/Model/Pricing：能力、价格版本；Secret 不回显
  [I8] Role/Storage：permission/record state、健康/容量只读事实
```

每个 `I*` 仅提供字段 schema、URL key 白名单、summary formatter、优先级与领域动作；
`AdminResourceTable` 和 `AdminResourceManager` 共享 `H0`，各自 API/渲染差异留在独立 adapter。

## 9. 实现边界与备注

- Tailwind CSS 4 使用仓库现有 token/class；字体与图标均为本地资源，SVG 使用 `currentColor`。
- 所有输入有可见 label；`D0` 为具名 region，错误以 `aria-describedby` / `role=alert` 关联。
- 不改变表格列、详情 Drawer、服务端权限、PostgreSQL、计费、账本或 Secret 生命周期。
- 原图只提供视觉调性；其大面积空白与居中封面排版不进入后台层级。
- 歧义约束：关系筛选的 label hydration 可按资源独立实现，但 URL 必须只保存稳定 ID。
