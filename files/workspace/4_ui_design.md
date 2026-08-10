# Expert Prompt Architect 记录（非递归，仅一次）

## Optimized Prompt

综合 Stage 1 PRD、Stage 3 层级逻辑、品牌封面与现有 `AdminPageHeader`、
`AdminResourceTable`、`AdminResourceManager`，只为 Ink Memory Admin v3 的紧凑页头、列表头和
可折叠筛选建立中文高保真 UI 合同。保留 `A0–I8` 语义，明确 1440×1000 与 390×844 的尺寸、
状态、组件边界、URL applied / 本地 draft、无障碍、减弱动画和模块迁移。视觉只继承暖纸、深棕、
轻分隔与单一虚线纸面边界；实现只用项目现有 Tailwind CSS 4、Next 本地字体和 inline React SVG，
不得扩展表格字段、权限、数据库、计费、Secret 或领域生命周期。

# Ink Memory Admin v3：紧凑页头与可折叠筛选 UI 合同

> Stage 4 — UI Art Director；目标视口：Desktop `1440×1000`、Mobile `390×844`。
> 本文是实现与视觉验收合同，不表示组件已经改造完成。

## 1. 视觉裁决

方向为 **暖纸编辑部工作台 × 超感官极简主义**。原图是品牌封面，不是后台截图；只采信其近纸白、
深炭棕、暖棕辅助字、大留白、克制分区。封面的居中 Hero 与大面积空白不可移植到数据工作台。

### 1.1 Aesthetic / Spec Table

| 维度 | 高保真规格 | 禁止项 |
|---|---|---|
| 画布 | `bg-bg-primary`；内容纸面 `bg-bg-surface` | 冷灰默认后台、渐变、玻璃拟态 |
| 边界 | 页面仅一处虚线 Paper Boundary；内部均 `border-border` 实线 | 每个筛选/字段再套虚线卡片 |
| 主文字 | `text-text-primary` 深棕；正文 `text-text-secondary` | 纯黑正文、低对比灰字 |
| 标题 | 本地 `font-display`，600；H1 28/36 Mobile、32/40 Desktop | CDN 字体、超大营销标题 |
| 正文 | 本地 body，14/22；说明最多两行 | 12px 正文、重复解释 |
| 数据 | `font-mono text-[12px] leading-5 tabular-nums` | 比例数字、金额用非等宽字 |
| 圆角 | 输入 6px、列表纸面 12px、chip 999px | 所有区域 20–32px 大圆角 |
| 深度 | 常驻列表无浮起；仅 Sheet/Dialog 使用 `shadow-medium` | 卡片墙、hover 缩放、glow |
| 状态色 | success/danger/warning 只用于小面积语义，并伴随文字 | 只靠颜色表达状态 |
| 动效 | 120–180ms，透明度/单轴位移 | 弹跳、持续动画、逐行 stagger |

### 1.2 现有 Token 对应

| 用途 | Tailwind 4 class | 已有 CSS 变量 |
|---|---|---|
| App 背景 | `bg-bg-primary` | `--color-bg-app` |
| 次级底色 | `bg-bg-secondary/45` | `--color-bg-muted` |
| 纸面 | `bg-bg-surface` | `--color-paper` |
| 实底控件 | `bg-bg-elevated` | `--color-surface-solid` |
| 主/次/弱文字 | `text-text-primary/secondary/tertiary` | `--color-ink-*` |
| 操作色 | `bg-accent text-bg-surface` | `--color-action` |
| 分隔 | `border-border` | `--color-border-paper` |
| 聚焦 | 全局 `:focus-visible` | `--color-focus` |

不得复制另一套色值；亮/暗模式继续由 `app/globals.css` 的语义变量切换。

## 2. 技术基线声明

技能模板的 **Tailwind CSS 2.2.19 CDN、Font Awesome、Google Fonts 均不适用于本项目**：

- 只使用仓库已安装的 Tailwind CSS 4 与现有 `@theme` 映射。
- Noto Serif SC、Noto Sans SC、IBM Plex Mono 继续由 `next/font/local` 加载。
- 漏斗、折叠箭头、关闭符号使用本地 inline SVG/React 组件，继承 `currentColor`。
- 不新增 `<link>`、远程字体、图标字体、CDN、外部运行时或图片依赖。

## 3. 尺寸与排版合同

| 元素 | Desktop | Mobile |
|---|---:|---:|
| 页面内容最大宽 | 现有 Shell 宽度，左右 24px | 左右 16px |
| `A1` PageHeader | `pb-3`，内容行最小 52px | `pb-3`，单列 56–92px |
| eyebrow | 10/14，tracking `0.18em` | 10/14，同值 |
| H1 | 32/40，600，tracking `-0.02em` | 28/36，最多两行 |
| H1 说明 | 14/22，`mt-1.5`，最多两行 | 13/20，`mt-1` |
| `B1` ListHeader | 44px，`px-4` | 44px，`px-3` |
| `C0` 常显 Query 行 | 最小 56px，`px-4 py-1.5` | 最小 60px，`p-2` |
| 输入/按钮命中区 | 最小 44×44px | 最小 44×44px |
| `D0` 展开区 | `p-3`，gap 12px | Sheet 内 `p-4`，gap 16px |
| chip | 高 28px，`px-2.5`，12/16 | 同值，最多显示 1 个 + `+N` |
| 状态行 `E0` | 32px，`px-4` | 40px 内，两行上限 |

当 `A1` 与 `B1` 同义时，`B1` 标题改为 `sr-only` 且不重复说明；Desktop 的
`A1 + B1 + collapsed C0` 以 `76–112px` 为目标。说明过长应截短，不压缩 44px 命中区。

## 4. 组件树与职责

```text
AdminPageFrame [A0]                     // 现有页面唯一虚线边界
├─ AdminPageHeader [A1]                 // 唯一 H1、短说明、元信息、唯一主动作
└─ AdminListSurface [B0]                // 平面纸面；不增加第二条虚线
   ├─ AdminListHeader [B1]              // H2/sr-only、结果数、刷新、允许的创建动作
   ├─ AdminQueryBar [C0]
   │  ├─ PrimaryQuery [C1]              // keyword / email / request ID / key prefix
   │  ├─ FilterToggle [C2]              // 文案、数量、漏斗、chevron
   │  ├─ AppliedFilterSummary [C3]      // URL 投影；最多 2 个 chip
   │  ├─ DraftHint [C4]                 // “有未应用更改”
   │  └─ SecondaryFilterFields [D1–D3] // 单一字段定义树
   ├─ DesktopFilterRegion [D0,D4,D5]    // md+ 原位 region
   ├─ MobileFilterSheet [D0,D6,D7]      // <md Portal/dialog 承载同一 draft
   ├─ QueryStatus [E0]
   ├─ DataRegion [F0]                   // 唯一表格横滚壳
   └─ Pagination [G0]

useAdminListQueryState [H0]             // URL applied、draft、disclosure、request
ResourceAdapter [I1–I8]                 // 字段、白名单、摘要、领域动作
```

`AdminResourceTable` 与 `AdminResourceManager` 都消费上述共享层；前者不再保留独立的纯内存筛选语义。
`AdminPageHeader` 增加可选 `meta` / `primaryAction` 插槽，但每页仍只有一个主动作。

## 5. Header 高保真结构

- 面包屑从当前 `mb-5` 收紧到 `mb-2`；字号仍 12px，链接保留下划线和清晰焦点环。
- H1 左对齐；状态/来源/更新时间在右侧，mono 10/16；Mobile 移至标题下方。
- 页面说明若与列表说明同义，列表说明完全移除；不能在 A1、B1 连续复述。
- 创建是唯一 Primary；刷新是 44px Secondary；删除、撤销、轮换不得进入 Header 主位。
- 计数请求失败显示“计数不可用”，不得显示 `0`；同步为“正在同步 · 128 条”。

```tsx
<header className="border-b border-border pb-3">
  <div className="flex min-h-13 flex-col gap-2 md:flex-row md:items-end md:justify-between">
    <div className="min-w-0">
      <p className="font-mono text-[10px] leading-3.5 tracking-[0.18em] text-text-tertiary">{eyebrow}</p>
      <h1 className="mt-1 font-display text-[28px] font-semibold leading-9 tracking-[-0.02em] md:text-[32px] md:leading-10">{title}</h1>
      {description && <p className="mt-1 max-w-3xl text-[13px] leading-5 text-text-secondary md:text-sm md:leading-[22px]">{description}</p>}
    </div>
    <div className="flex min-h-11 items-center gap-2">{meta}{primaryAction}</div>
  </div>
</header>
```

## 6. Query Bar 与本地图标

```tsx
const FilterIcon = () => (
  <svg viewBox="0 0 20 20" width="18" height="18" fill="none" aria-hidden="true">
    <path d="M3 5h14M6 10h8M8.5 15h3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
  </svg>
);
const ChevronIcon = ({ open }: { open: boolean }) => (
  <svg viewBox="0 0 20 20" width="16" height="16" fill="none" aria-hidden="true"
    className={`transition-transform duration-150 motion-reduce:transition-none ${open ? "rotate-180" : ""}`}>
    <path d="m6 8 4 4 4-4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);
```

SVG 不单独获得焦点，按钮必须提供完整可访问名称；线宽 1.5px，视觉框 16–18px，颜色继承按钮。

```tsx
<div className="border-b border-border bg-bg-surface px-2 py-2 md:px-4 md:py-1.5">
  <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-2 md:grid-cols-[minmax(260px,520px)_auto_1fr]">
    <label className="sr-only" htmlFor={queryId}>搜索</label>
    <input id={queryId} type="search" className="admin-field text-sm" value={draft.q ?? ""} onChange={onQueryChange} />
    <button type="button" aria-expanded={open} aria-controls={regionId} onClick={toggle}
      className="inline-flex min-h-11 items-center gap-2 border border-border bg-bg-elevated px-3 text-sm font-semibold">
      <FilterIcon /><span>筛选{activeCount ? ` ${activeCount}` : ""}</span><ChevronIcon open={open} />
    </button>
    <AppliedFilterSummary className="col-span-2 min-w-0 md:col-span-1" />
  </div>
  {dirty && <p className="mt-1 text-xs text-accent-orange" role="status">有未应用更改</p>}
</div>
```

## 7. 状态合同

| 状态 | Desktop | Mobile | 不变量 |
|---|---|---|---|
| collapsed | C1/C2/C3/C4 可见，D0 隐藏 | 次要筛选不占页面高度 | 不请求、不清值、不改 page |
| expanded | D0 原位实线分隔，3 列网格 | 打开底部/全高 Sheet | 首个次要字段获焦 |
| active | 最多 2 chip + `+N` | 1 chip + `+N` | 只由 URL 白名单派生 |
| draft | 显示“有未应用更改” | Sheet 关闭后仍可见 | 输入不请求、不改 URL |
| loading | 初载骨架；刷新保留旧表 | 同左 | 不伪造 0 条 |
| error | E0 错误摘要 + 重试，旧表保留 | 两行摘要，详情可展开 | 保留 URL/draft/disclosure |
| filter-empty | 条件摘要 + 清除筛选 | 同左 | 清除回 page=1 |
| system-empty | 真实原因 + 允许的创建动作 | 同左 | 不出现清筛 |

Desktop 展开区使用 `md:grid md:grid-cols-3`，字段 label 12/16、控件 44px；动作固定在末行右侧，
不随字段数量跳位。Apply 仅在 `draft !== applied` 且校验通过时可用。

## 8. Mobile Filter Sheet

- `390×844` 下以原生 `<dialog>` 或等价 Portal 呈现；宽 100vw、高 `min(88dvh, 720px)`。
- 顶部 56px：标题、已应用数量、44×44 关闭按钮；主体纵向滚动，字段全宽。
- 底部动作条 sticky，最小 68px，`padding-bottom: max(16px, env(safe-area-inset-bottom))`。
- 背景 inert、焦点锁定；Escape/遮罩/关闭回到 C2。取消恢复 openingDraft；应用写 URL 后关闭。
- 根页面禁止横滚；只有 `F0` 表格壳与既有 Tabs 可以局部 `overflow-x-auto`。

## 9. 可访问性与动效

- C2 使用 `button`、`aria-expanded`、`aria-controls`；D0 使用 `role="region"` + `aria-labelledby`。
- 所有输入有可见 label；错误通过 `aria-invalid`、`aria-describedby` 关联；摘要 `role="alert"`。
- Enter 应用；Escape 关闭；Tab 顺序等于视觉顺序；禁止正 `tabIndex`。
- chip 的移除按钮读作“移除筛选：状态 已启用”；不能只显示无名称的 `×`。
- F0 保留 `caption`、`scope="col"`、`aria-sort`；横滚壳 `tabIndex={0}` 且有明确名称。
- 焦点环沿用全局 2px `--color-focus` + 2px offset；所有指针目标至少 44×44px。
- 展开仅做 150ms opacity + `translateY(-4px→0)`；Chevron 150ms 旋转；不动画未知高度。

```css
@media (prefers-reduced-motion: reduce) {
  [data-query-region], [data-filter-chevron], [data-filter-sheet] {
    animation: none !important;
    transition-duration: 0.01ms !important;
    scroll-behavior: auto !important;
  }
}
```

## 10. 模块迁移矩阵

| Adapter | 模块 | PrimaryQuery 常显 | SecondaryFilters 收起 | Header 独立保留 |
|---|---|---|---|---|
| I1 | Story 工作区/剧本/版本/章节/场景 | 名称、精确 ID | 关系、审核/发布状态 | 版本与审核动作 |
| I2 | 用户/订阅 | email / 用户 ID | 套餐、周期、状态 | 取消/恢复生命周期 |
| I3 | 套餐/权益/额度/余额 | 名称或用户关系 | 版本、来源、重置周期 | micro-USD/Token 语义 |
| I4 | Gateway Key | key prefix | 状态、用户关系 | 创建、轮换；不回显 Secret |
| I5 | Gateway 请求/用量 | request ID | 模型、状态、时间窗 | 刷新与 UTC 来源 |
| I6 | 只追加账本 | 用户/事件 ID | 事件、时间、金额方向 | 无编辑/删除 |
| I7 | Provider/Model/Pricing | 名称/code | 能力、状态、价格版本 | Secret 不回显、版本动作 |
| I8 | Role/权限/Storage | 名称/permission | record state、健康状态 | 只读事实或允许动作 |

迁移顺序：先抽取 `H0` 与共享展示组件，再让 `AdminResourceManager` 接入，最后将
`AdminResourceTable` 从组件 state 迁到同一 URL 合同。两消费者的 API/表格/Drawer 保持各自实现。

## 11. 视觉验收

- [ ] 1440×1000：默认收起 D0；同义 B1 不重复；A1+B1+C0 为 76–112px，至少多露出 1 行表格。
- [ ] 390×844：标题、唯一主动作、搜索、筛选数量在首屏；`document.scrollWidth <= clientWidth`。
- [ ] 全页只有现有 PageFrame 一处虚线边界；D0、E0、F0 仅用实线与底色分区，无新卡片/阴影。
- [ ] H1 为 32/40 Desktop、28/36 Mobile；正文不小于 13px；计数/金额为 12px mono tabular nums。
- [ ] collapsed/expanded/active/draft/loading/error/filter-empty/system-empty 均可凭文字而非颜色辨识。
- [ ] 折叠、展开不请求、不清值、不改 page；应用/清除后 URL、摘要、结果一致。
- [ ] 刷新、深链、复制链接、前进/后退恢复 applied、draft、页码；未知 URL key 不进入 API。
- [ ] Mobile Sheet 锁焦、背景 inert、Escape/遮罩/按钮关闭、取消回滚、应用归焦、避让 safe area。
- [ ] 全部交互目标至少 44×44px；键盘可完成筛选、清除、分页；读屏名称与 region 关系完整。
- [ ] reduced motion 下无位移/旋转过渡；普通模式动效不超过 180ms，无遮蔽内容的高度动画。
- [ ] 表格仍是表格且为唯一数据横滚壳；主识别列可 sticky；不改列、详情 Drawer 与领域动作。
- [ ] 不加载 Tailwind 2 CDN、Font Awesome、Google Fonts 或任何远程视觉资源；Tailwind 4 构建通过。
- [ ] light/dark 均只使用现有语义 token，焦点、正文、边界和状态文字对比清晰。

## 12. 范围边界

本阶段不改表格字段、排序语义、详情/编辑容器、服务端权限、PostgreSQL schema、计费、账本、
Gateway 协议与 Secret 生命周期；不新增 Dashboard、统计卡、图表或品牌 Landing Page 视觉。
