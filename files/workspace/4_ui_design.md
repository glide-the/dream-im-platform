# Ink Memory Admin 字段级 UI Art Direction（Stage 4）

> HTML Design Workflow / Stage 4 · UI Art Director
> 技术：Next.js 16 + React 19 + Refine 5 + Tailwind CSS 4
> 基准视口：Desktop 1440×1000；Mobile 390×844
> 风格：Warm-paper Quiet Workbench × Ultra-sensory Minimalism
> 功能依据：Stage 1–3；模型与计费骨架：`cc-switch-model-billing-adaptation.md`

## 0. 设计裁决

PDF 是品牌 Landing 视觉提案，本后台只继承其 v2.1 暖纸色板、安静工具台、少面板、多留白、单一虚线纸边、平直列表与小面积 accent；不继承 Hero、角色、装饰贴纸、胶囊 CTA 或营销卡片。

`color_system` 的亮色基础值早于 PDF v2.1：核心亮色以 PDF v2.1 为准，状态/浮层语义补齐自 color system；暗色沿用 color system 的“暖夜纸张”映射。暗色主按钮为暖白底，前景必须改用深暖画布，不能使用白字。

cc-switch 只提供四个交互骨架：Provider 全屏、Pricing 新版本全屏、Usage 全局筛选/趋势/三页签、Request Detail 分区 Drawer。全部视觉换为本文 token，数据仍来自 Ink Memory PostgreSQL、RBAC、严格 Zod、事务和审计。

不可改变：字段、状态机、关系、权限、Secret 语义、整数 micro-USD、Pricing 版本化、Ledger/Audit append-only、Story PostgreSQL fail-closed。不存在手填关系 ID、模板 ID、默认 JSON CRUD 或通用永久删除。

## 1. Aesthetic Style

| 维度 | 高保真决定 | 禁止项 |
|---|---|---|
| 画布 | 暖纸/暖夜画布包围一张主纸面 | 冷蓝灰全屏背景、纯黑暗色 |
| 分区 | 留白、字重、细实线；主纸面仅一圈 dashed | 多层卡片、每节套框 |
| 数据 | flat rows、稳定列基线、数字右对齐 | 大 KPI 卡、虚构指标 |
| 色彩 | 棕色承载阅读，黄/绿/蓝仅小面积语义 | 蓝灰照搬 cc-switch、渐变、glow |
| 排版 | Serif 定标题、Sans 定任务、Mono 定事实 | 营销大标题、伪造字重 |
| 形状 | 4/6/8/12px；按钮 6px | 泛滥的 24px 圆角与胶囊 |
| 层次 | 常驻内容无阴影，浮层才有轻阴影 | 阴影卡片海、玻璃拟态 |
| 动效 | 160–240ms 状态解释 | 弹跳、视差、持续旋转/脉冲 |

## 2. 精确色彩 Token

颜色只能出现在 token 定义；组件只使用 `var()` 或 Tailwind 语义类。`--color-action-link` 只作下划线、图标和大号链接 accent；普通字号链接正文使用 `text-primary` + 蓝色下划线，确保对比度。

```css
@import "tailwindcss";

@theme inline {
  --color-app: var(--color-bg-app);
  --color-paper: var(--color-bg-paper);
  --color-surface: var(--color-bg-surface-solid);
  --color-soft-surface: var(--color-bg-surface);
  --color-hover: var(--color-bg-hover);
  --color-active: var(--color-bg-active);
  --color-ink: var(--color-text-primary);
  --color-body: var(--color-text-body);
  --color-secondary: var(--color-text-secondary);
  --color-muted: var(--color-text-muted);
  --color-action: var(--color-action-primary);
  --color-on-action: var(--color-text-on-action);
  --color-paper-border: var(--color-border-paper);
  --color-control-border: var(--color-border-neutral);
  --color-focus: var(--color-border-focus);
  --color-link: var(--color-action-link);
  --color-link-hover: var(--color-action-link-hover);
  --color-success: var(--color-state-success);
  --color-warning: var(--color-state-warning);
  --color-error: var(--color-state-error);
  --color-danger: var(--color-state-danger);
  --color-memory: var(--color-voice-yellow);
  --color-spark: var(--color-voice-green);
  --font-sans: var(--font-local-sans), "Noto Sans SC", ui-sans-serif, sans-serif;
  --font-serif: var(--font-local-serif), "Noto Serif SC", ui-serif, serif;
  --font-mono: var(--font-local-mono), "IBM Plex Mono", ui-monospace, monospace;
  --shadow-soft: var(--shadow-soft-value);
  --shadow-float: var(--shadow-medium-value);
}

:root,
:root[data-theme="light"] {
  color-scheme: light;
  --color-bg-app: #F6EFE5;
  --color-bg-paper: #FFFAF2;
  --color-bg-surface: color-mix(in srgb, #FFFAF2 82%, transparent);
  --color-bg-surface-solid: #FFFDF8;
  --color-bg-overlay: rgb(63 52 41 / 0.46);
  --color-bg-hover: color-mix(in srgb, #5F4A36 5%, transparent);
  --color-bg-active: color-mix(in srgb, #4A90E2 12%, transparent);
  --color-border-paper: #D8C7B3;
  --color-border-neutral: #E0D6C8;
  --color-border-focus: #3F3429;
  --color-text-primary: #3F3429;
  --color-text-body: #4B3F33;
  --color-text-secondary: #7A6A59;
  --color-text-muted: #9A8A78;
  --color-text-on-action: #FFFFFF;
  --color-action-primary: #5F4A36;
  --color-action-link: #4A90E2;
  --color-action-link-hover: #357ABD;
  --color-state-success: #4CAF50;
  --color-state-success-hover: #45A049;
  --color-state-warning: #F39C12;
  --color-state-error: #F44336;
  --color-state-danger: #DD4444;
  --color-state-danger-hover: #BB3333;
  --color-disabled-bg: #CCCCCC;
  --color-voice-yellow: #F39C12;
  --color-voice-green: #27AE60;
  --color-code-bg: #3F3429;
  --color-code-text: #F6EFE5;
  --color-code-inline-bg: rgb(63 52 41 / 0.08);
  --color-scrollbar-thumb: #CCCCCC;
  --color-scrollbar-thumb-hover: #999999;
  --shadow-soft-value: 0 2px 8px rgb(91 69 44 / 0.08);
  --shadow-medium-value: 0 12px 30px rgb(91 69 44 / 0.16);
}

:root[data-theme="dark"] {
  color-scheme: dark;
  --color-bg-app: #1F1B16;
  --color-bg-paper: #2A251E;
  --color-bg-surface: rgb(42 37 30 / 0.82);
  --color-bg-surface-solid: #332D25;
  --color-bg-overlay: rgb(0 0 0 / 0.72);
  --color-bg-hover: rgb(255 255 255 / 0.08);
  --color-bg-active: rgb(129 183 210 / 0.18);
  --color-border-paper: #5A4D3D;
  --color-border-neutral: #4A4238;
  --color-border-focus: #F3EEE6;
  --color-text-primary: #F3EEE6;
  --color-text-body: #EEE8DF;
  --color-text-secondary: #C8BCAE;
  --color-text-muted: #9F9283;
  --color-text-on-action: #1F1B16;
  --color-action-primary: #F3EEE6;
  --color-action-link: #81B7D2;
  --color-action-link-hover: #6AA3BF;
  --color-state-success: #7BCF8F;
  --color-state-success-hover: #5ABD72;
  --color-state-warning: #F7C96A;
  --color-state-error: #FF7A70;
  --color-state-danger: #FF8A7F;
  --color-state-danger-hover: #E06060;
  --color-disabled-bg: #58504A;
  --color-voice-yellow: #F7C96A;
  --color-voice-green: #7BDBA0;
  --color-code-bg: #0D1117;
  --color-code-text: #E6EDF3;
  --color-code-inline-bg: rgb(0 0 0 / 0.18);
  --color-scrollbar-thumb: #4A4238;
  --color-scrollbar-thumb-hover: #6A5E52;
  --shadow-soft-value: 0 2px 8px rgb(0 0 0 / 0.32);
  --shadow-medium-value: 0 14px 34px rgb(0 0 0 / 0.45);
}
```

系统主题回退仅在没有显式 `data-theme` 时生效；已有首屏脚本应在 React hydrate 前解析 system/light/dark。Popover、Select、Tooltip 必须用不透明 `surface`，禁止背景透读。

## 3. 字体、密度与几何

### 3.1 本地字体

| 用途 | 文件 | 字重 |
|---|---|---:|
| 页面/区段标题 | `NotoSerifSC-600.ttf` | 600 |
| 正文/控件 | `NotoSansSC-400.ttf` / `NotoSansSC-500.ttf` | 400 / 500 |
| ID、code、金额、Token、时间 | `IBMPlexMono-400.ttf` / `IBMPlexMono-500.ttf` | 400 / 500 |

不请求 Google Fonts；不伪造仓库不存在的 700 字重。图标使用本地 SVG/React SVG，`stroke="currentColor"`，不使用 Font Awesome。

### 3.2 字号与行高

| 语义 | Desktop | Mobile | 行高 |
|---|---:|---:|---:|
| Page H1 | 32px Serif 600 | 28px | 1.25 |
| Section H2 | 20px Serif 600 | 19px | 1.4 |
| Component H3 | 16px Sans 500 | 16px | 1.5 |
| Body | 15px Sans 400 | 15px | 1.7 |
| Table/Form | 14px Sans | 14px | 1.5 |
| Meta | 12px Sans 500 | 12px | 1.6 |
| Mono facts | 12px Mono | 12px | 1.55 |

Mono facts 使用 `font-variant-numeric: tabular-nums`。说明文字不能小于 12px；关键说明至少 14px。

### 3.3 间距、边框、圆角、阴影

- 基础单位 4px；常用 8/12/16/20/24/32/40/48。
- 纸面内距 Desktop 32px，复杂全屏内容 40px；Mobile 16px。
- Section 32px；Field group 20px；label→control 8px；control→help/error 6px。
- 纸面外边 1px dashed；内部分隔、输入和表格 1px solid。只有一处 dashed。
- radius：4px code/status；6px input/button/table shell；8px popover/toast；12px paper/modal/drawer。
- 常驻 section、表格和普通行无 shadow；hover row 可用 `shadow-soft`；Popover/Dialog/Drawer 可用 `shadow-float`。

### 3.4 表格密度

| 部件 | Desktop | Mobile |
|---|---:|---:|
| 表头 | 44px；12px/500 | 44px |
| 正常行 | 52px；cell x=16/y=12 | 56px；x=14/y=12 |
| 双行识别单元 | 60px | 64px |
| 行操作 | 44×44 命中区 | 44×44 |
| sticky 主列 | 最小 220px，实色 paper | 最小 180px |

静止行透明；hover 使用 `bg-hover`；selected 同时用右侧 check、2px 左线和 `aria-selected`，不整行深色填充。

## 4. 按钮与控件层级

| 层级 | 视觉 | 用途 |
|---|---|---|
| Primary | action 底 + on-action 字，44px 高，6px radius | 每个 Header/Footer 最多一个主提交 |
| Secondary | surface 底 + neutral border + body 字 | 取消、预览、刷新影响 |
| Tertiary | 透明底 + ink/link 文本 | 返回、清筛、行内跳转 |
| Danger | 透明/soft danger 底 + danger 字；确认页才可实底 | 停用、撤销、拒绝、删除自定义 Role |
| Icon | 44×44，18–20px SVG，透明底 | Copy、More、Close、Menu |

Disabled 同时降低对比并保留原因 Tooltip/description；不能只把 opacity 降到不可读。Loading 按钮保留原宽，写“保存中…”等动词，不只显示 spinner。

输入统一 44px 高、6px radius、surface 实底、neutral border；textarea 最小 112px；JSON Editor 最小 240px；Combobox menu 最大 320px 高并分页加载。

## 5. 全局 Shell（S01–S06）

### 5.1 Desktop 1440×1000

```text
S01 Canvas: 100dvh / overflow hidden
├─ S02 Sidebar: 248px / fixed column / own vertical scroll
└─ AdminPaper: x≈280 / w≈1124 / single dashed / main vertical scroll
   ├─ S03 Topbar: 56px sticky
   ├─ S04 Page Heading: 32px title + source/time + one primary action
   ├─ S05 Module Tabs: 44px / own horizontal scroll only when needed
   └─ S06 live region: paper bottom-right, never steals focus
```

Canvas 左右最少 24px；Sidebar 与 Paper 间 24px。Sidebar 与 app 同底，不另做卡片。当前项用 3×18px Memory Yellow 短线 + 500 字重 + `aria-current="page"`。

### 5.2 Mobile 390×844

- Canvas 8px，Paper 内距 16px，根 `scrollWidth <= clientWidth`。
- S03 为 52px；菜单触发器 44×44；标题/面包屑截断并配 Copy。
- S02 变 `min(320px,88vw)` 左 Drawer，实底、inert 背景、锁焦、Escape/遮罩关闭、归焦菜单按钮。
- S05 只在自身横滚；不做横向页面导航条。
- 标题→说明→数据源/更新时间→主动作单列；Footer 避让 `env(safe-area-inset-bottom)`。

## 6. List、Filter、Table（L01–L10）

- L01 名称/code/允许的精确 ID 搜索常显；L02 关系筛选必须是具名分页 Combobox。
- L03 状态/枚举/日期使用固定 select、segmented radio、Date Range；服务端 UTC，UI 标时区。
- L04 提供刷新、清筛和领域允许的创建/导出；自动刷新不覆盖选择或 Drawer。
- L05 显示结果范围、筛选摘要、来源、时间窗和更新时间；查询失败写“暂不可用”。
- L06 是唯一表格横滚壳，`tabIndex=0` 且有“可横向滚动”名称。
- L07 是主识别/具名关系；L08 是状态/数值/时间；L09 行动作由 permission + record state 决定。
- L10 在 L06 外，20/50/100、页码和范围写 URL；完成后聚焦 L05。
- URL 是 q/page/pageSize/sort/order/tab/from/to/资源白名单筛选的真相源。
- 只在真实批量命令存在时显示 checkbox；不为视觉完整添加选择列。

Mobile：L01 常显；L02/L03 进入 bottom Filter Sheet；L06 保留表语义，优先 L07、状态、关键数值/时间、L09，不转卡片。

## 7. Detail、Typed Form 与高风险确认

### 7.1 Detail Drawer（D01–D07）

- D01 720–840px；Mobile 全屏；Header sticky，初焦标题。
- D02 Identity/Base：名称、code、ID、类型、说明。
- D03 Relations：具名链接，不复制关系、不手填 ID。
- D04 State/Timeline：状态解释、version、完整本地/ISO 时间。
- D05 Domain Projection：Story 层级、Workflow、Ledger、只读 JSON 等真实投影。
- D06 Risk/Audit：脱敏状态、before/after、Request ID、Audit link。
- D07 Footer：关闭、编辑、允许的领域命令；只读域不出现 edit/delete。

关闭后回到 L09 原行；行消失则聚焦 L05。自动刷新详情只原子替换只读响应，已开表单只提示“有较新版本”。

### 7.2 Typed Form（E01–E07）

| 数据类型 | 控件 | 禁止退化 |
|---|---|---|
| 名称/code/URL | text / url；code 编辑只读 | 用 ID 代替名称 |
| enum | select / segmented radio | 自由文本 |
| boolean | switch / checkbox + 文字 | 原始 true/false |
| datetime | DateTime Picker + timezone | 假默认日期 |
| integer/Token | step=1 number + unit | 空值转 0 |
| micro-USD | USD decimal + 精确整数 preview | JS 浮点入账 |
| array/tags | MultiSelect / chip input | JSON textarea |
| capability/scope | 白名单 checkbox group | 自由 JSON |
| relation | 真实分页 searchable Combobox | 裸 ID 输入 |
| real JSON | JSON Editor + schema/diff/restore | 用于普通字段 |
| Secret | password + 本次显隐 | 回填历史值 |

E01：Modal 560–620px 或 Drawer 640–720px；Mobile 全屏。E02 类型化字段；E03 关系选择；E04 特殊控件；E05 错误摘要；E06 sticky Footer；E07 Dirty Guard。

每字段有可见 label、必填/可选、description、error，使用稳定 ID/`aria-describedby`。400 聚焦首错；409 同屏保存草稿与服务器最新值；503 保留草稿重试；404 关闭失效容器。

### 7.3 JSON Editor

- 仅 Workspace settings、Provider 未知扩展 config、Platform metadata、System value。
- Mono 13px/1.65；行号、格式化、schema 行列错误、Copy、Restore、before/after diff。
- 长行默认 wrap；编辑器可独立纵滚，不成为根横滚 owner。
- Provider 受管键从扩展 JSON 剥离，Secret 风险键服务端拒绝。

### 7.4 Confirmation（K01–K06）

K01 实底 Modal 600px；Mobile 全屏或不裁剪说明的 Sheet。K02 当前资源/status/version/time；K03 真实影响或“暂不可计算”；K04 before→after；K05 reason/ticket/idempotency/code；K06 具名命令。

提交前重取 status/version/impact。409 保留输入并聚焦冲突摘要。余额/结算按 idempotency key 查询未知网络结果。Role 删除要求 code；Story reject 必填说明；Provider/Model 停用显示依赖；Key revoke 显示 prefix/last used。

## 8. Provider 全屏（P01–P11）

保留 cc-switch 的全屏与分区骨架，但全页是 paper/solid rules，不是蓝灰卡片。

| ID | 分区 | UI 规格 |
|---|---|---|
| P01 | Full-screen | 100dvh；背景锁滚；内容 max 1120px |
| P02 | Header | sticky 64px；返回、标题、权限、dirty 状态 |
| P03 | Preset/Protocol | preset 只预填；Anthropic/OpenAI segmented；编辑协议只读 |
| P04 | Base | code 创建可填/编辑只读；name；status；ID 只读 |
| P05 | Credential | configured/fingerprint；新 password；空=不轮换；轮换确认 |
| P06 | Endpoint | URL + 标准化最终 Endpoint 预览 |
| P07 | Model Summary | 具名关联 Model flat rows；打开 M01，不手填 model ID |
| P08 | Managed Runtime | timeout 1000–900000；retries 0–5；authMode；outputTokenParam |
| P09 | Extension Config | 只编辑未知扩展 JSON；受管/Secret 键拒绝 |
| P10 | Impact/Error | enabled Models、近期请求、400/403/409/503 |
| P11 | Footer | sticky 64px；取消 + 保存 Provider；safe area |

Mobile 严格 P03→P10 单列，末字段下 96px。P02/P11 固定；只有中段纵滚。Provider 内打开 Model Drawer 后只刷新 P07，不覆盖 Provider 草稿。

## 9. Model 与 Pricing（M01–M08 / R01–R09）

Model 使用 Desktop 680px Drawer / Mobile 全屏：M02 Header；M03 Provider Combobox 或锁定；M04 code/upstream/display name；M05 nullable token limits；M06 capability checkbox；M07 enabled/Provider impact；M08 Footer。

Pricing 使用 cc-switch 全屏骨架，但动作永远叫“创建价格版本”：

| ID | 分区 | UI 规格 |
|---|---|---|
| R01/R02 | Full-screen/Header | 100dvh、max 1120px、旧版本只读引用 |
| R03 | Model/Tier | searchable Combobox；从 Model 发起可锁定 |
| R04 | Four Prices | Fresh input/Output/Cache read/Cache write；USD/1M + micro preview |
| R05 | Formula | markup %/bps、discount %/bps、精确顺序 |
| R06 | Window | from、nullable to、status；时区常显 |
| R07 | Diff | 四价/公式/生效窗 old→new |
| R08 | Conflict/Impact | overlap 版本链接、真实引用/差额；409 保留草稿 |
| R09 | Footer | 取消、预览影响、创建价格版本 |

已开始或被 Request snapshot 引用的旧金额/from 不可编辑，无 DELETE。服务端事务结束旧 `effective_to` 并插入新版本；成功回执列新/旧窗、Request ID、Audit。

## 10. Usage Dashboard（U01–U09）

保留 cc-switch 的“全局筛选→事实摘要→趋势→三页签”，但去掉 Hero KPI cards：

- U01 单一主滚动容器。
- U02 Date Range/timezone、protocol、Provider、Model、Platform User、outcome、refresh frequency；同时驱动全部区域并写 URL。
- U03 单一 flat summary band：request count、success rate、四类 Token、provider cost、charged、时间窗/来源/更新时间。
- U04 Token/成本真实趋势；图例键盘可达；图内 pan/tooltip 不扩大根宽。
- U05 请求日志/Provider 统计/模型统计 tabs，只在自身横滚。
- U06 Request rows；U07 Provider aggregate；U08 Model aggregate；三者表格各自局部横滚。
- U09 结果 meta 与分页在表格壳外。

真实聚合 API 不可用时写“暂不可用”，不从当前页推算全量。只有请求成功且真实零记录才显示 `0 + empty explanation`。自动刷新不改 U02、U05、page 或已开 Q01；只提示“有较新版本”。

Mobile：Date Range 常显，其余进 Filter Sheet；U03 可换行但仍为一条事实带；U04 图内交互；Q01 为全屏。

## 11. Request Detail（Q01–Q09）

Desktop 760–840px read-only Drawer；Mobile 全屏；Header sticky、中段纵滚、无保存 Footer。

| ID | 分区 | Skeleton / 正常内容 |
|---|---|---|
| Q02 | Header | Request ID、Copy、outcome、Close |
| Q03 | Identity/User/Key | upstream ID、Platform User、Key prefix；无 hash/plaintext |
| Q04 | Routing | protocol、requested→resolved Model、Provider、Pricing Rule |
| Q05 | Token Semantics | estimated + Fresh/Output/Cache R/W；unknown 不为 0 |
| Q06 | Snapshot/Cost | 四价格、markup/discount、reserved/provider cost/charged/diff |
| Q07 | Settlement/Ledger | settlement 状态与 append-only Ledger timeline |
| Q08 | Performance/Timeline | streaming、first token、latency、created→settled |
| Q09 | Error/Safe Summary | http/error、脱敏 message、只读 response_summary JSON；无正文 |

Loading skeleton 按 Q03–Q09 每段保留标题、2–4 条 16px 高事实线，不能用一个大灰块。`settlement_failed` + `billing.adjust` 仅显示“前往 Reconciliation”。

## 12. Reconciliation、Role、Storage（C/X/T）

### 12.1 C01–C09 Reconciliation

独立路由，不手填 Request ID。C02 sticky Header；C03 冻结 User/Provider/Model/status/version/reserved/tokens/snapshot/error；503 只能重试；C04 settle/release；C05 settle 四类非负整数且 unknown 不预填 0；C06 release evidence/ticket；C07 reason/idempotency；C08 server before→after；C09 sticky submit。

version 变化进入 Z07，刷新 preview 后再次确认。成功进入不可编辑 Z09，列 Request、Ledger、Audit、金额、时间。

### 12.2 X01–X07 Role

独立权限页：X02 sticky Header；X03 code/name/description；X04 domain navigator；X05 Permission matrix（code/name/description/check）；X06 permission diff + 受影响管理员；X07 Footer。Mobile 域导航局部横滚、矩阵按当前域逐行，不隐藏 permission 描述。

内置 Role 受保护。只允许无关联自定义 Role 进入 K01 删除并输入 code；最后 active super_admin 保护由 409 表达。

### 12.3 T01–T07 Storage

T02 Driver/config health；T03 direct-upload capability/prefix；T04 keyboard-accessible upload；T05 progress/真实 receipt；T06 known-key exists/metadata/download；T07 只读 metadata。

这是能力与诊断页，不存在 list/count/delete、目录树或假资源表。失败保留选中文件信息并给安全 Request ID。

## 13. 资源容器决策

| 资源/动作 | 容器 |
|---|---|
| Workspace edit | 560px Modal / Mobile full-screen |
| Story/Character/Scene edit | 720px Drawer / Mobile full-screen |
| Story review/archive | K01 confirm |
| Workflow detail | 760px read-only Drawer；无适配器则无 retry/cancel |
| Provider create/edit/rotate | P01 full-screen |
| Model create/edit | M01 680px Drawer |
| Pricing new version | R01 full-screen |
| Model Permission | 640px Drawer；删除 override 用 K01 |
| Billing adjustment | 600px K01 |
| Usage/Gateway Request | Q01 read-only Drawer |
| Reconciliation | C01 independent page |
| Gateway Key create | 640px Modal → one-time Z09；revoke 用 K01 |
| Platform Identity | 680px Drawer |
| Admin User | 640px Drawer；disable/reset 独立确认 |
| Role | X01 independent page |
| System Setting | 640px Drawer；Secret overwrite 再确认 |
| Storage upload/check | 560px Drawer / inline capability page |

## 14. 状态与回执（Z01–Z10）

| ID | 视觉与恢复 | 焦点 |
|---|---|---|
| Z01 Loading | 保留 title/filter/header；等高 skeleton；超时提示 | 不跳焦；完成 polite 播报 |
| Z02 Filter Empty | 筛选摘要 + 清筛 | 清筛后 L05 |
| Z03 System/Relation Empty | 区分系统空/关系无选项，只在允许域给创建 | 返回父资源/选择器输入 |
| Z04 400 | 顶部 summary + 字段 error，草稿保留 | 首错；summary link 可回字段 |
| Z05 401/403 | 清保护值；403 写 permission | 错误标题；登录后安全 return URL |
| Z06 404 | 关闭失效 overlay、返回列表 | 原行或 L05 |
| Z07 409 | 当前草稿 + latest/diff/related record | conflict heading；载入最新需确认 |
| Z08 500/503 | 安全文案 + Request ID + retry；503 标源 | 保留 filter/draft；无回退 |
| Z09 Receipt | action/resource/Request/Audit/Ledger/time | receipt heading；刷新 list/detail |
| Z10 Dirty Confirm | Continue / Discard，覆盖 Escape/back/refresh/route | 最高层锁焦；取消回原字段 |

Gateway Key plaintext 只在本次创建 Z09 出现，关闭即不可恢复；Provider/System Secret 回执不含本次或历史明文。

## 15. 焦点、键盘与浮层

焦点层级：Base(1) → Route overlay/full-screen(2) → Combobox/Date/Popover/Filter Sheet(3) → K01(4) → Z10(5)。最内层先处理 Escape。

- 首个 Tab 是 skip link；之后 Sidebar→Topbar→Heading→Filter→Table→Pagination→overlay。
- Drawer/Modal/full-screen 锁 Tab；背景 `inert`；初焦标题，400 初焦首错。
- 每次保存 `returnFocusKey={route,recordId,action}`；触发行消失则归 L05。
- Combobox 用 Arrow keys/Enter/Escape，加载/空/403 有文字；不退化为 ID text input。
- 图标按钮有 accessible name；装饰 SVG `aria-hidden`；状态含文字+图标/形状。
- table 有 caption、scope、aria-sort；横滚壳可聚焦；selected 有 `aria-selected`。
- Form label/description/error/required 完整关联；错误摘要 `role=alert`；S06 `aria-live=polite`。
- 200% 文字缩放仍可完成任务；所有 target 至少 44×44；不能 hover-only。

## 16. Overflow 与响应规则

| Owner | Desktop | Mobile |
|---|---|---|
| S02 | 248px 固定 | `min(320px,88vw)` Drawer |
| S05/U05/X04 | 紧凑 tabs | 自身横滚 |
| L06/U06–U08/X05 | table shell 横滚 | 保留主字段与行详情 |
| U04 | 正常图宽 | 图内 pan/reflow |
| D/E/M/Q | 560–840px Modal/Drawer | full-screen |
| P/R/C/X | full-screen，content 1120px | full-screen single column |

长 ID/code/URL 在自身 cell 截断/换行+Copy；JSON wrap；关系链换行。根不能依赖 `overflow:hidden` 掩盖错误宽度。

## 17. Motion 与 reduced motion

```css
@keyframes paper-enter { from { opacity: 0; transform: translateY(4px); } to { opacity: 1; transform: none; } }
@keyframes quiet-pulse { 0%,100% { opacity: .48; } 50% { opacity: .72; } }
.motion-paper-enter { animation: paper-enter 220ms ease-out both; }
.motion-skeleton { animation: quiet-pulse 1200ms ease-in-out infinite; }
@media (prefers-reduced-motion: reduce) {
  *,*::before,*::after { scroll-behavior:auto!important; animation-duration:1ms!important; animation-iteration-count:1!important; transition-duration:1ms!important; }
}
```

Drawer/Sheet 240ms 单轴；Popover 160ms；row hover 140ms；状态替换 180ms。Skeleton 不扫光；没有 stagger、glow 或无限装饰旋转。

## 18. 可编码 React / Tailwind 4 片段

```tsx
export function AdminFullScreenForm({ title, children, footer }:{
  title:string; children:React.ReactNode; footer:React.ReactNode;
}) {
  return <section role="dialog" aria-modal="true" aria-labelledby="panel-title" className="fixed inset-0 z-50 grid grid-rows-[64px_minmax(0,1fr)_64px] bg-paper text-body">
    <header className="flex items-center border-b border-paper-border bg-paper px-4 lg:px-10">
      <button className="min-h-11 rounded-sm px-3 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus">返回</button>
      <h1 id="panel-title" tabIndex={-1} className="ml-3 font-serif text-[28px] font-semibold text-ink lg:text-[32px]">{title}</h1>
    </header>
    <div className="min-h-0 overflow-y-auto overflow-x-clip px-4 py-6 lg:px-10 lg:py-8"><div className="mx-auto max-w-[1120px] space-y-8">{children}</div></div>
    <footer className="border-t border-paper-border bg-paper px-4 pb-[env(safe-area-inset-bottom)] lg:px-10"><div className="mx-auto flex h-16 max-w-[1120px] items-center justify-end gap-3">{footer}</div></footer>
  </section>;
}
```

```tsx
export function Field({ id,label,description,error,children }:{
  id:string; label:string; description?:string; error?:string; children:React.ReactNode;
}) {
  const describedBy=[description&&`${id}-description`,error&&`${id}-error`].filter(Boolean).join(" ")||undefined;
  return <div className="space-y-2" data-invalid={Boolean(error)}>
    <label htmlFor={id} className="block text-sm font-medium text-ink">{label}</label>
    {description&&<p id={`${id}-description`} className="text-xs leading-5 text-secondary">{description}</p>}
    <div data-control-id={id} data-describedby={describedBy}>{children}</div>
    {error&&<p id={`${id}-error`} role="alert" className="text-sm text-error">{error}</p>}
  </div>;
}
```

实际 control 必须把 `id/aria-describedby/aria-invalid` 传给 input；上例的 wrapper 不代替原生关联。Refine hooks 负责 getOne/list/invalidate/useCan，不引入默认 CRUD DOM。

## 19. 编号覆盖与实现门槛

编号全集：

- Shell：S01, S02, S03, S04, S05, S06。
- List：L01, L02, L03, L04, L05, L06, L07, L08, L09, L10。
- Detail：D01, D02, D03, D04, D05, D06, D07。
- Typed Form：E01, E02, E03, E04, E05, E06, E07。
- Confirmation：K01, K02, K03, K04, K05, K06。
- Provider：P01, P02, P03, P04, P05, P06, P07, P08, P09, P10, P11。
- Model：M01, M02, M03, M04, M05, M06, M07, M08。
- Pricing：R01, R02, R03, R04, R05, R06, R07, R08, R09。
- Usage：U01, U02, U03, U04, U05, U06, U07, U08, U09。
- Request：Q01, Q02, Q03, Q04, Q05, Q06, Q07, Q08, Q09。
- Reconciliation：C01, C02, C03, C04, C05, C06, C07, C08, C09。
- Role：X01, X02, X03, X04, X05, X06, X07。
- Storage：T01, T02, T03, T04, T05, T06, T07。
- State：Z01, Z02, Z03, Z04, Z05, Z06, Z07, Z08, Z09, Z10。

### Acceptance checklist

- [ ] Light/Dark 完整映射本文 token；组件无孤立色值、cc-switch 蓝灰、渐变或 glow。
- [ ] 1440×1000 的 248px Sidebar、1120px 复杂内容、单一 dashed paper、局部 table 横滚成立。
- [ ] 390×844 的 Drawer/Filter Sheet/full-screen/safe-area/96px 末字段余量成立，根无横溢。
- [ ] 列表真实行→getOne→详情→预填表单→回执；无手填关系 ID、模板 ID 或通用 JSON CRUD。
- [ ] Typed Form 按 string/enum/bool/date/int/money/array/relation/JSON/Secret 显式选控件。
- [ ] Provider P01–P11、Pricing R01–R09、Usage U01–U09、Request Q01–Q09 保留 cc-switch 骨架并完成暖纸换肤。
- [ ] Usage 摘要/趋势/统计来自真实聚合；失败为“暂不可用”，unknown Token 不为 0。
- [ ] Provider/System Secret 不回显；Gateway Key 只在 Z09 显示一次；Audit 脱敏。
- [ ] micro-USD 只以安全整数提交；Pricing 新版本；Ledger/Audit/Usage/Request 无修改/删除入口。
- [ ] Story 关系和 Workflow provenance 是具名只读投影；503 无 SQLite/JSON/旧表回退。
- [ ] 400/401/403/404/409/500/503/Success/Dirty 均有恢复与焦点策略。
- [ ] 键盘、focus trap/return、Escape nesting、labels、caption、aria-sort、live region、200% zoom、reduced motion 通过。
