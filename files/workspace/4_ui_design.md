# Ink Memory Admin：剧本、用户、权限与资源后台高保真 UI 规范

> HTML Design Workflow / Stage 4 — UI Art Director
>
> 技术基线：Next.js 16、React 19、Refine 5、Tailwind CSS 4
>
> 视觉输入：`files/inputs/target_image.png`（1440×1000）
>
> 结构输入：`files/workspace/1_prd_draft.md`、`files/workspace/3_hierarchy_logic.md`
>
> 主题基线：`docs/prd/color_system/light-theme.md`、`dark-theme.md`、`docs/design/admin-ui-visual-specification.md`
>
> 目标视口：Desktop `1440×1000`；Mobile `390×844`

## 0. 视觉裁决

本轮风格定义为 **Warm-paper Quiet Operations Desk（暖纸张安静运营台）× Ultra-sensory Minimalism（超感官极简）**。

目标图提供了正确的品牌骨架：248px 左侧栏、暖米色画布、衬线中文标题、等宽英文事实、小面积深棕 active 标记与低饱和数据表。实现时保留这些识别点，但作以下纠偏：

1. 主内容只允许一个虚线 Paper Boundary；筛选区、表格和分页用留白与 1px 实线分隔，不再套多层圆角卡片。
2. 列表从“技术 ID 优先”改为“名称/标题/邮箱优先，ID 次行 mono + Copy”。关系字段必须是具名链接。
3. 标题由截图约 46–48px 收敛为桌面 32px、移动 28px，让 1000px 高视口首屏至少看到筛选、表头和 6 行数据。
4. 蓝色只用于链接/焦点等小面积语义；主按钮用深棕与纸面反差。无蓝紫 AI 渐变、glow、玻璃态或 KPI 卡片海。
5. 常驻内容无阴影；仅 Drawer、Dialog、Popover 使用浮层阴影。状态不以整行高饱和底色表达。
6. 视觉范围仅覆盖 Dashboard、User → Workspace → Story、Admin → Role → Permission、Storage、Audit。模型、计费、网关保留现状，不新增、不改造。

---

## 1. Aesthetic Style

| 维度 | 高保真规格 | 禁止项 |
|---|---|---|
| 气质 | 暖纸、安静、可信、像经过编排的编辑部运营台 | 默认 Refine/Ant 蓝后台、赛博控制台、营销页 |
| 构图 | 画布包围一张主纸面；留白、字重、细线建立层级 | 嵌套卡片、每节套框、页面底部无意义空白 |
| 数据 | flat rows、稳定基线、事实数字 tabular、关系可跳转 | 虚构趋势、装饰图表、整卡状态色 |
| 排版 | Serif 定页面与区段，Sans 定任务，Mono 定事实 | 伪造 700/800 字重、远程字体、全站等宽字 |
| 色彩 | 深棕负责阅读；蓝/绿/黄/红仅表达动作和状态 | 渐变、霓虹、glow、冷灰暗色、纯黑画布 |
| 形状 | 4/6/8/12px；状态胶囊仅限短标签 | 万能 16–24px 大圆角、每行卡片化 |
| 深度 | 常驻区域无 shadow；浮层才有暖棕阴影 | 多层投影、hover 抬升缩放 |
| 动效 | 140–240ms，单轴、解释状态与层级 | 弹跳、视差、持续旋转、扫光 skeleton、stagger |
| 信息密度 | 52px 标准行、44px 表头/控件、双行识别 60px | 过宽空行、低于 44px 的操作命中区 |
| 可访问性 | 可见 Label、文字+形状状态、2px focus、完整键盘路径 | placeholder 代 Label、hover-only 操作、仅颜色状态 |

### 1.1 图像到界面的视觉映射

| 目标图特征 | 目标实现 |
|---|---|
| 248px 品牌侧栏 | Desktop 固定 248px；Mobile 切换为 `min(320px, 88vw)` Drawer |
| 左侧 2 字符代码 | 保留 12px Mono 辅助码；中文名称是主要 accessible name |
| 暖白大画布 | Light `#F6EFE5`；Dark 为深暖棕，不做简单反色 |
| 衬线大标题 | 本地 Noto Serif SC 600，Desktop 32/40，Mobile 28/35 |
| active 米色块 + 深色竖线 | 低对比 hover/active 面 + 2px 左线 + 500 字重 + `aria-current` |
| 容器式数据区 | 收敛为唯一 1px dashed Paper；内部 flat row |
| 等宽表头和 ID | 仅 ID/code/object key/request ID 使用 IBM Plex Mono |
| skeleton 横条 | 改为按真实列宽保形，不用完全等长的装饰条 |

---

## 2. 集中式 Light / Dark CSS Variables 与 Tailwind CSS 4 映射

颜色只在下列 token 区定义。组件使用 `var()` 或 Tailwind 语义类，不出现孤立十六进制。为了兼容仓库当前 `app/globals.css`，保留 `--color-paper`、`--color-ink-primary` 等 alias；新增组件优先使用完整语义名。

```css
@import "tailwindcss";

@theme inline {
  --color-app: var(--color-bg-app);
  --color-app-muted: var(--color-bg-muted);
  --color-paper: var(--color-bg-paper);
  --color-surface: var(--color-bg-surface-solid);
  --color-soft-surface: var(--color-bg-surface);
  --color-overlay: var(--color-bg-overlay);
  --color-hover: var(--color-bg-hover);
  --color-active: var(--color-bg-active);

  --color-ink: var(--color-text-primary);
  --color-body: var(--color-text-body);
  --color-secondary: var(--color-text-secondary);
  --color-muted: var(--color-text-muted);
  --color-on-action: var(--color-text-on-action);

  --color-action: var(--color-action-primary);
  --color-action-soft: var(--color-action-soft);
  --color-link: var(--color-action-link);
  --color-link-hover: var(--color-action-link-hover);
  --color-paper-border: var(--color-border-paper);
  --color-control-border: var(--color-border-neutral);
  --color-focus: var(--color-border-focus);

  --color-success: var(--color-state-success);
  --color-success-soft: var(--color-state-success-soft);
  --color-warning: var(--color-state-warning);
  --color-warning-soft: var(--color-state-warning-soft);
  --color-error: var(--color-state-error);
  --color-error-soft: var(--color-state-error-soft);
  --color-danger: var(--color-state-danger);
  --color-danger-soft: var(--color-state-danger-soft);
  --color-disabled: var(--color-disabled-bg);

  --font-display: var(--font-display), "Noto Serif SC", ui-serif, Georgia, serif;
  --font-body: var(--font-body), "Noto Sans SC", ui-sans-serif, system-ui, sans-serif;
  --font-mono: var(--font-mono), "IBM Plex Mono", ui-monospace, monospace;
  --shadow-paper-hover: var(--shadow-soft-value);
  --shadow-overlay: var(--shadow-medium-value);
}

:root,
:root[data-theme="light"] {
  color-scheme: light;
  --color-bg-app: #F6EFE5;
  --color-bg-muted: #EEE3D5;
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
  --color-action-soft: #EADFCE;
  --color-action-link: #4A90E2;
  --color-action-link-hover: #357ABD;

  --color-state-success: #277B50;
  --color-state-success-soft: #E5F4EA;
  --color-state-warning: #8B5D05;
  --color-state-warning-soft: #FFF0CF;
  --color-state-error: #B54B3B;
  --color-state-error-soft: #F9E5DF;
  --color-state-danger: #B23B32;
  --color-state-danger-soft: #F9E5DF;
  --color-disabled-bg: #D8D0C6;

  --color-code-bg: #3F3429;
  --color-code-text: #F6EFE5;
  --color-code-inline-bg: rgb(63 52 41 / 0.08);
  --color-scrollbar-thumb: #C7BAAA;
  --color-scrollbar-thumb-hover: #9A8A78;
  --shadow-soft-value: 0 2px 8px rgb(91 69 44 / 0.08);
  --shadow-medium-value: 0 14px 34px rgb(91 69 44 / 0.18);

  /* 当前 globals.css 兼容 alias；后续集中迁移，不在页面重复定义。 */
  --color-paper: var(--color-bg-paper);
  --color-surface-solid: var(--color-bg-surface-solid);
  --color-ink-primary: var(--color-text-primary);
  --color-ink-body: var(--color-text-body);
  --color-ink-secondary: var(--color-text-secondary);
  --color-ink-muted: var(--color-text-muted);
  --color-action: var(--color-action-primary);
  --color-link: var(--color-action-link);
  --color-warning: var(--color-state-warning);
  --color-positive: var(--color-state-success);
  --color-negative: var(--color-state-error);
  --color-focus: var(--color-border-focus);
}

:root[data-theme="dark"] {
  color-scheme: dark;
  --color-bg-app: #1F1B16;
  --color-bg-muted: #241F1B;
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
  --color-action-soft: #453B32;
  --color-action-link: #81B7D2;
  --color-action-link-hover: #A3CEE2;

  --color-state-success: #7BCF8F;
  --color-state-success-soft: #253F31;
  --color-state-warning: #F7C96A;
  --color-state-warning-soft: #493B22;
  --color-state-error: #FF8D82;
  --color-state-error-soft: #4A2E29;
  --color-state-danger: #FF8A7F;
  --color-state-danger-soft: #4A2E29;
  --color-disabled-bg: #58504A;

  --color-code-bg: #0D1117;
  --color-code-text: #E6EDF3;
  --color-code-inline-bg: rgb(0 0 0 / 0.18);
  --color-scrollbar-thumb: #4A4238;
  --color-scrollbar-thumb-hover: #6A5E52;
  --shadow-soft-value: 0 2px 8px rgb(0 0 0 / 0.32);
  --shadow-medium-value: 0 14px 34px rgb(0 0 0 / 0.45);

  --color-paper: var(--color-bg-paper);
  --color-surface-solid: var(--color-bg-surface-solid);
  --color-ink-primary: var(--color-text-primary);
  --color-ink-body: var(--color-text-body);
  --color-ink-secondary: var(--color-text-secondary);
  --color-ink-muted: var(--color-text-muted);
  --color-action: var(--color-action-primary);
  --color-link: var(--color-action-link);
  --color-warning: var(--color-state-warning);
  --color-positive: var(--color-state-success);
  --color-negative: var(--color-state-error);
  --color-focus: var(--color-border-focus);
}
```

### 2.1 Token 使用规则

- Light 核心色使用 UI Design v2.1 的 `#F6EFE5 / #FFFAF2 / #3F3429 / #5F4A36`；Dark 使用 `#1F1B16 / #2A251E / #F3EEE6` 的暖夜映射。
- 普通 14px 链接使用 `text-ink underline decoration-link`，蓝色只在下划线和图标上；较大或加粗链接可使用 `text-link`。
- success/warning/error/danger 必须与文字、图标或形状同时出现；soft token 只用于小面积状态背景/错误摘要。
- Dark 主按钮为暖白 `action`，文字必须是深暖 `on-action`，禁止白底白字。
- Popover、Combobox、Tooltip 使用不透明 `surface`；不允许背后文字透读。
- 主题脚本须在 hydrate 前解析 system/light/dark；显式 `data-theme` 优先于系统偏好。

---

## 3. 本地字体、字号、间距与几何

### 3.1 仓库内字体

| 语义 | 本地文件 | 可用字重 | Next Font 变量 |
|---|---|---:|---|
| 页面/区段标题 | `app/fonts/NotoSerifSC-600.ttf` | 600 | `--font-display` |
| 正文/控件 | `app/fonts/NotoSansSC-400.ttf`、`NotoSansSC-500.ttf` | 400/500 | `--font-body` |
| ID/code/key/时间 | `app/fonts/IBMPlexMono-400.ttf`、`IBMPlexMono-500.ttf` | 400/500 | `--font-mono` |

不加载 Google Fonts，不使用 Font Awesome。图标使用仓库内 React SVG / inline SVG，统一 `20×20`、`stroke="currentColor"`、`strokeWidth={1.75}`；装饰图标 `aria-hidden`，图标按钮必须有 `aria-label`。

### 3.2 字号与行高

| 语义 | Desktop | Mobile | Tailwind 建议 |
|---|---:|---:|---|
| Page H1 | 32px / 40px / Serif 600 | 28px / 35px | `font-display text-[28px] leading-[1.25] lg:text-[32px]` |
| Section H2 | 20px / 28px / Serif 600 | 19px / 27px | `font-display text-xl leading-7` |
| Component H3 | 16px / 24px / Sans 500 | 同左 | `text-base font-medium` |
| Body | 15px / 25.5px / Sans 400 | 同左 | `text-[15px] leading-[1.7]` |
| Table/Form | 14px / 21px | 同左 | `text-sm leading-[1.5]` |
| Meta/Label | 12px / 19px / 500 | 同左 | `text-xs font-medium leading-[1.6]` |
| Mono fact | 12px / 18.5px | 同左 | `font-mono text-xs tabular-nums` |

不得请求不存在的 700/800 字重；“强调”通过 500/600、颜色与空间层级实现。说明文字不低于 12px，关键错误/帮助文字至少 14px。

### 3.3 间距、尺寸、圆角、边框、阴影

| 类别 | 规格 |
|---|---|
| 基础间距 | 4px；常用 `8 / 12 / 16 / 20 / 24 / 32 / 40 / 48` |
| Main Canvas | Desktop `32px 36px 48px`；Mobile 8px canvas + 16px Paper padding |
| Paper 内距 | Desktop 28–32px；Mobile 16px |
| Section gap | 32px；Field group 20px；Label→control 8px；control→help/error 6px |
| 控件高度 | input/select/button 44px；textarea min 112px；search 44px |
| 圆角 | code/status 4px；input/button/table shell 6px；popover/toast 8px；paper/modal/drawer 12px |
| 外边界 | 每页仅 1 处 `1px dashed paper-border` |
| 内分隔 | `1px solid paper-border/control-border`；普通 section 不另套框 |
| 阴影 | 常驻内容无阴影；hover row 可选 `shadow-paper-hover`；浮层 `shadow-overlay` |
| Focus | 2px `focus` outline + 2px offset；不得被 overflow 裁剪 |

### 3.4 表格密度

| 部件 | Desktop | Mobile |
|---|---:|---:|
| 表头 | 44px；12px/500 | 44px |
| 标准行 | 52px；cell x=16/y=12 | 56px；x=14/y=12 |
| 双行识别单元 | 60px | 64px |
| 行动作 | 44×44 命中区 | 44×44 |
| sticky 主列 | min 220px，实色 paper | min 180px，实色 paper |

表格静止行透明；hover 只用 `bg-hover`。selected 同时使用 2px 左线、右侧 check 与 `aria-selected`，不整行深色填充。数值右对齐，状态/时间不强制居中，避免扫描断裂。

---

## 4. 按钮、表单控件与状态标记

### 4.1 按钮层级

| 层级 | 视觉 | 用途 |
|---|---|---|
| Primary | `bg-action text-on-action`，44px，6px radius | 每个 Header/Footer 最多一个主提交 |
| Secondary | `bg-surface border-control-border text-body` | 取消、刷新、预览、下载 |
| Tertiary | 透明底，`text-ink`，hover `bg-hover` | 返回、清筛、行内通用动作 |
| Link | `text-ink underline decoration-link` | User/Workspace/Story/Audit 关系跳转 |
| Danger | 平时透明/soft danger；最终确认才允许 danger 实底 | 停用、归档、拒绝、删除 Storage/自定义 Role |
| Icon | 44×44、20px SVG、透明底 | Menu、Close、Copy、More、Theme |

Disabled 不只降 opacity：保留可读文案、真实 `disabled`，并在相邻帮助文字说明原因。Loading 按钮保持原宽，显示“保存中…”“上传中…”，spinner 仅为辅助。

### 4.2 控件规格

- 输入/Select/Combobox：44px、6px radius、solid surface、1px neutral border；hover 加深边框，focus 2px outline。
- 所有输入有可见 Label；placeholder 只给示例，不代替字段名。
- 关系字段使用分页 searchable Combobox：主行名称/邮箱，次行 mono ID；不可手填不存在的 ID。
- Checkbox/Switch 命中区至少 44px；文字是 label 的一部分。Permission matrix 的 code、名称、描述不能只藏在 Tooltip。
- Textarea min 112px。Story content、metadata、内部 version/provenance 只读，不渲染可编辑控件。
- JSON Viewer：13px Mono/1.65，默认展开两层，长行 wrap，局部最大高 480px；Copy 结果由 live region 播报。
- Date/Time：UI 明示时区；本地时间旁可查看 ISO 值。

### 4.3 StatusMark

视觉形式为 `6px dot + 12px/500 文本 + 可选短边框`，例如“正常”“已停用”“待审核”“配置缺失”。icon/dot 标记 `aria-hidden`，完整状态由文本提供。状态色不可用于整行背景。

---

## 5. 1440×1000 Desktop 组件结构

```text
┌─ G0 App Canvas: 1440×1000 / bg-app / overflow-x clip ──────────────────────────┐
│ G1 Sidebar 248px                 │ G2 Main minmax(0,1fr)                        │
│ ├ Brand 76px                     │ ├ G3 Breadcrumb + source/time               │
│ ├ Scrollable nav groups          │ ├ G4 H1 + purpose + one primary action       │
│ └ G10 identity/theme 116px       │ └ G5 one dashed Paper Boundary              │
│                                  │   ├ G6 summary/context/capability            │
│                                  │   ├ G7 search/filter/chips                   │
│                                  │   ├ G8 flat table/detail body ↔ local scroll│
│                                  │   └ G9 total/pageSize/pagination             │
└──────────────────────────────────┴──────────────────────────────────────────────┘
```

### 5.1 精确尺寸

- Sidebar：`248px` 固定；自身 `overflow-y:auto`。品牌 76px；导航组之间 24px；条目 40px；底部身份区至少 112px。
- Main：`min-width:0`；水平内距 36px（最少 24px），上 28px，下 48px；可用内容宽约 1120px。
- Page Heading：breadcrumb 20px 高；H1 与说明区约 94px；主按钮只在有真实写权限时出现。
- Paper：`width:100%`、12px radius、1px dashed；Desktop padding 28–32px。其本身不制造第二个页面滚动条。
- 首屏预算：顶部导航/标题约 174px，Paper 筛选约 154px，表头 44px + 6×52px 行 + 分页 56px，可在 1000px 高度内形成有效数据密度。
- Table 横滚由唯一 `G8/L06` 容器拥有；Sidebar、Heading、Pagination 不随表格横向移动。

### 5.2 页面模块在 Paper 中的构图

| 页面 | G6 | G7 | G8 |
|---|---|---|---|
| Dashboard | 数据源/刷新事实 | 无通用筛选 | 三组 flat metric band；最近 Story / 最近操作两列 |
| Workspace | 总数/当前筛选摘要 | 搜索、owner/status、时间排序 | name+ID、owner、status、Story count、时间、动作 |
| Story | 总数/关系上下文 | 搜索、Workspace/User/status/review/type | title+ID、关系、type/status/count、时间、动作 |
| User | 总数/active-disabled | 搜索、role/status、时间排序 | name/email、status、Workspace/Story count、时间、动作 |
| Admin | active/disabled 与角色摘要 | email/status/role | email/name、roles、status、last login、动作 |
| Role | 内置/自定义摘要 | name/code/type | name/code、type、permission/admin count、时间、动作 |
| Permission | “系统发布，只读”说明 | code/name 搜索 | 按 domain 分组的 flat rows / role count |
| Storage | driver/capability strip | key/MIME/date | filename/key、MIME、size、time、driver、动作 |
| Audit | append-only/脱敏说明 | actor/action/resource/date | time、actor、action、resource、request、result |

Dashboard 的数字是可解释链接而非大号装饰卡：32px Serif 数字，12px Label，单行 3 组，组间以 1px 竖线分隔。查询失败时该组显示“暂不可用”，绝不显示 0。

### 5.3 Desktop 详情与表单层

| 层 | 宽度 | 结构 |
|---|---:|---|
| User/Workspace Detail | 780px | sticky 64px Header / scroll Content / optional 64px Footer |
| Story Detail | 840px | Identity → Relations → Content → Metadata → Timeline → Audit |
| Admin Form | 680px | Identity → Password（永不回填）→ Roles → Diff |
| Role Edit | 840px | Basics → Impact → Permission Matrix → Diff |
| Storage Upload/Preview | 680/760px | capability/context → form/preview → receipt/action |
| Audit Detail | 760px | Header → redacted before/after → metadata |
| Sensitive Confirm | 600px Modal | object → impact → before/after → reason/key → named action |

打开层时背景 `inert`，焦点落到标题；关闭回到触发行。详情 URL 可刷新恢复，不使用无法恢复的临时 Modal 代替 Resource route。

---

## 6. 390×844 Mobile 组件结构

```text
┌─ 390px viewport / 8px canvas / no root horizontal overflow ────────────┐
│ M1 sticky header 56px: [Menu] Ink Memory             [Theme][Account] │
│ G3 breadcrumb/back                                                     │
│ G4 H1 28px + max 3-line purpose                                       │
│ primary action on its own row, min-height 44px                         │
│ ┌┈ G5 Paper / full width / 16px padding ┈────────────────────────────┐ │
│ ┋ G6 summary/context: vertical stack or wrap                        ┋ │
│ ┋ G7 search always visible                       [筛选 n]           ┋ │
│ ┋ active chips / clear all                                           ┋ │
│ ┋ G8 table semantics / local focusable horizontal scroll            ┋ │
│ ┋ G9 total                              [上一页] [下一页]            ┋ │
│ └┈───────────────────────────────────────────────────────────────────┘ │
└────────────────────────────────────────────────────────────────────────┘
```

### 6.1 Mobile 行为

- Sidebar 变为左 Drawer `width:min(320px,88vw)`；实色 surface、锁焦、Escape/遮罩关闭，归焦菜单按钮。
- Search 始终可见；关系/状态/日期筛选放入 Bottom Sheet。筛选按钮显示 active 数量，Sheet 固定 Header/Footer，底部含 `env(safe-area-inset-bottom)`。
- 主操作不与 H1 同行挤压；创建/上传按钮单独一行，可按内容宽或全宽。
- 列表保留 `<table>` 语义，不强制改卡片。优先主实体、状态、关键时间和常显动作；其余列通过局部横滚查看。
- 横滚壳 `tabIndex={0}`，accessible name 为“剧本列表，可横向滚动”等资源化文案；首次出现时给可见提示。
- Detail/创建/编辑层全部全屏。Header 56px sticky；中段独立纵滚；Footer 64px + safe-area；最后字段后至少留 96px。
- 关系矩阵、JSON、长 key 只在自身容器滚动/换行；根节点 `scrollWidth <= clientWidth`，不能靠全局 `overflow:hidden` 掩盖错误宽度。

### 6.2 Mobile 信息优先级

| 页面 | 首屏必须可见 | 延后/横滚可见 |
|---|---|---|
| Workspace | name、status、Story count、动作 | owner ID、created time |
| Story | title、review/status、updated、动作 | type、计数、完整关系列 |
| User | name/email、status、Workspace count、动作 | role、Story count、created |
| Admin | email、status、roles、动作 | last login、ID |
| Role | name/code、type、权限数、动作 | admin count、updated |
| Storage | filename/key、size、动作 | MIME、driver、完整时间 |
| Audit | time、action、result、resource | actor ID、request ID |

---

## 7. 核心组件视觉规格

### 7.1 Sidebar / Navigation

- 背景与 app 同色，右侧 1px paper border；不做独立浮卡。
- 分组 Label：12px Sans 500、secondary；条目代码 11px Mono、muted，固定 28px 宽。
- active：2px action 左线 + `bg-hover` + 500 字重 + `aria-current="page"`；不得仅靠米色底。
- 无 read permission 不显示入口；直接路由仍由服务端 403。保留现有模型/计费/网关入口，但本稿不改变其分组与页面。

### 7.2 Page Header

- breadcrumb 12px Mono/Sans，名称可换行，ID 可 Copy。
- 每页唯一 H1。说明用 15px body，最多一句解释目标；“可追溯”“真实数据”等事实不可伪装成按钮。
- 右侧最多一个 Primary。无写权限时不留空按钮占位。

### 7.3 Filter Bar

- Desktop 搜索 320px；Select/Combobox 180–220px；最多两行，不压缩表格。
- 搜索 300ms debounce；筛选/排序/page/pageSize 是 URL 真相源；改变筛选后 page 归 1。
- 已应用筛选用小型 chip，但“清除全部”是文字按钮而非无 label 的 ×。
- 关系项显示 `name/email` + 次行 ID；不存在/403/加载失败分别有明确文案。

### 7.4 Data Table / Relation List

- 首列为真实 `<a>`，主文案 14px/500，ID 次行 12px Mono + Copy。
- sticky header；排序按钮与列名一体，维护 `aria-sort`。
- 整行可进入详情时仍保留真实链接；行内按钮点击不得触发行导航。
- 行尾主动作“查看”常显，低频动作进入 Menu；禁止 hover-only。
- 无真实批量命令时不显示 checkbox，避免假能力。

### 7.5 Detail Layer

- Header 固定：返回/关闭、实体名、只读 ID/Copy。Content 独立滚动。仅有合法写动作时显示 Footer。
- Section 之间用 32px 空间和细分隔线，不把每个 section 做成卡片。
- Story Content：安全 Markdown/长文本只读；最大 480px 局部滚动。JSON 默认展开两层；解析失败显示原文与错误说明。
- 关联异常用 warning strip 呈现真实 ID，不自动创建替代实体。

### 7.6 Sensitive Confirm

- 标题直接命名动作：“停用用户”“归档工作区”“拒绝剧本”“删除文件”。
- 固定顺序：对象 → 当前状态/版本 → 真实影响 → before→after → reason/key → 最终按钮。
- Storage 删除必须输入完整 object key；Role 变更显示 permission diff；最后 active super admin 阻止并解释。
- Cancel 后归焦触发器；409 保留输入并聚焦冲突摘要。

---

## 8. 可编码 React / Tailwind CSS 4 片段

以下片段只展示视觉与语义骨架；数据仍由 Refine hooks 和现有服务端 permission/API 提供。

### 8.1 `AdminPaper`

```tsx
export function AdminPaper({
  labelledBy,
  children,
}: {
  labelledBy: string;
  children: React.ReactNode;
}) {
  return (
    <section
      aria-labelledby={labelledBy}
      className="motion-paper-enter overflow-clip rounded-xl border border-dashed border-paper-border bg-paper text-body"
    >
      {children}
    </section>
  );
}
```

### 8.2 `StatusMark`

```tsx
const toneClass = {
  success: "text-success",
  warning: "text-warning",
  error: "text-error",
  neutral: "text-secondary",
} as const;

export function StatusMark({
  label,
  tone,
}: {
  label: string;
  tone: keyof typeof toneClass;
}) {
  return (
    <span className={`inline-flex min-h-7 items-center gap-2 text-xs font-medium ${toneClass[tone]}`}>
      <span aria-hidden className="size-1.5 rounded-full bg-current" />
      <span>{label}</span>
    </span>
  );
}
```

### 8.3 具名实体单元格与局部横滚表格

```tsx
export function EntityCell({ href, name, id }: { href: string; name: string; id: string }) {
  return (
    <div className="min-w-0 py-1">
      <a
        href={href}
        className="block truncate font-medium text-ink underline decoration-link decoration-1 underline-offset-4 hover:decoration-link-hover"
      >
        {name}
      </a>
      <div className="mt-1 flex items-center gap-2 text-xs text-muted">
        <code className="min-w-0 truncate font-mono tabular-nums">{id}</code>
        <button type="button" aria-label={`复制 ${name} 的 ID`} className="min-h-11 shrink-0 px-2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus">
          <CopyIcon aria-hidden />
        </button>
      </div>
    </div>
  );
}

export function ScrollTable({ children }: { children: React.ReactNode }) {
  return (
    <div
      role="region"
      aria-label="剧本列表，可横向滚动"
      tabIndex={0}
      className="min-w-0 overflow-x-auto border-y border-paper-border focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
    >
      <table className="w-full min-w-[980px] border-collapse text-left text-sm">
        <caption className="sr-only">剧本列表</caption>
        {children}
      </table>
    </div>
  );
}
```

实际 Next.js 页面使用 `Link` 代替示例中的 `<a>`。Copy 按钮可缩小视觉图形，但命中区始终 44px。

### 8.4 Detail Drawer / Mobile Full-screen

```tsx
export function DetailLayer({
  title,
  resourceId,
  children,
  footer,
}: {
  title: string;
  resourceId: string;
  children: React.ReactNode;
  footer?: React.ReactNode;
}) {
  return (
    <section
      role="dialog"
      aria-modal="true"
      aria-labelledby="detail-title"
      className="fixed inset-0 z-50 grid min-w-0 grid-rows-[56px_minmax(0,1fr)_auto] bg-paper text-body shadow-overlay md:left-auto md:w-[min(840px,calc(100vw-248px))] md:grid-rows-[64px_minmax(0,1fr)_auto]"
    >
      <header className="flex min-w-0 items-center gap-3 border-b border-paper-border px-4 md:px-6">
        <button type="button" aria-label="关闭详情" className="grid size-11 place-items-center rounded-md hover:bg-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus">
          <CloseIcon aria-hidden />
        </button>
        <div className="min-w-0">
          <h1 id="detail-title" tabIndex={-1} className="truncate font-display text-xl font-semibold text-ink">{title}</h1>
          <p className="truncate font-mono text-xs text-muted">{resourceId}</p>
        </div>
      </header>
      <div className="min-h-0 overflow-y-auto overflow-x-clip px-4 py-6 md:px-8 md:py-8">
        <div className="space-y-8">{children}</div>
      </div>
      {footer ? (
        <footer className="border-t border-paper-border bg-paper px-4 pb-[max(16px,env(safe-area-inset-bottom))] pt-3 md:px-8">
          <div className="flex min-h-12 items-center justify-end gap-3">{footer}</div>
        </footer>
      ) : null}
    </section>
  );
}
```

### 8.5 可见 Label 的字段

```tsx
export function Field({
  id,
  label,
  description,
  error,
  children,
}: {
  id: string;
  label: string;
  description?: string;
  error?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-2" data-invalid={Boolean(error)}>
      <label htmlFor={id} className="block text-sm font-medium text-ink">{label}</label>
      {description ? <p id={`${id}-help`} className="text-sm leading-6 text-secondary">{description}</p> : null}
      {children}
      {error ? <p id={`${id}-error`} role="alert" className="text-sm leading-6 text-error">{error}</p> : null}
    </div>
  );
}
```

实际 control 必须接收相同 `id`，并组合 `aria-describedby`、`aria-invalid`；wrapper 不能代替原生关联。

---

## 9. Loading、Empty、Error、权限与回执

| 状态 | 视觉与文案 | 恢复与焦点 |
|---|---|---|
| Loading | 保留 Shell/Header/Filter/表头；按真实列宽画 quiet skeleton | 不跳焦；完成后 polite 播报“已加载 N 条” |
| System Empty | “尚无工作区/剧本/文件”等真实事实 | 仅在有写权限时显示创建动作 |
| Filter Empty | 显示已生效筛选摘要，不说“系统无数据” | 移除单个 chip / 清除全部；焦点回结果摘要 |
| Relation Empty | “该用户尚无工作区”等父子语义 | 返回父实体或进入允许的创建路径 |
| 400 | Paper 顶部 error summary + 字段错误，保留输入 | 聚焦首错；summary 链接回字段 |
| 401 | 清除保护数据后转登录 | 安全 return URL；登录后恢复 route |
| 403 | 写明所需 permission；不残留敏感内容 | 聚焦错误标题；返回可访问模块 |
| 404 | 实体可能不存在或已归档 | 关闭失效 overlay，回保留 query 的列表 |
| 409 | 同屏显示草稿、服务器最新值、diff/阻塞关系 | 聚焦冲突摘要；用户确认后加载最新 |
| 500/503 | 说明失败范围、Request ID；不切数据源 | 区域重试，保留 filter/draft |
| Storage 未配置 | capability strip + 缺失配置类别，不显示 credential | 禁用依赖动作；修复后“重新检查” |
| Success Receipt | action/resource/request/audit/time | 聚焦回执标题；刷新列表/详情 |
| Dirty Guard | “继续编辑 / 放弃更改” | 最高层锁焦；取消回原字段 |

Skeleton 使用纸面相邻色块，透明度 0.48→0.72 缓慢呼吸；禁止亮色扫光。Toast 不是唯一错误载体，错误必须在相应区域常驻可读。

---

## 10. 微交互与 Motion

| 交互 | 时长/曲线 | 视觉反馈 |
|---|---|---|
| Row hover | 140ms ease-out | `bg-hover`，不位移、不缩放 |
| Button/field | 160ms ease-out | 背景/边框/文字颜色过渡 |
| Popover | 160ms ease-out | opacity + translateY(2px→0) |
| Drawer | 240ms cubic-bezier(.2,.8,.2,1) | 单轴 x 12px→0 + opacity |
| Bottom Sheet | 240ms 同上 | 单轴 y 16px→0 + opacity |
| Paper enter | 220ms ease-out | y 4px→0 + opacity；仅首次路由进入 |
| 状态替换 | 180ms ease-out | opacity；不改变容器高度 |
| Save/Copy success | 180ms | 图标/文字替换并由 live region 播报 |

```css
@keyframes paper-enter {
  from { opacity: 0; transform: translateY(4px); }
  to { opacity: 1; transform: none; }
}

@keyframes quiet-pulse {
  0%, 100% { opacity: 0.48; }
  50% { opacity: 0.72; }
}

.motion-paper-enter { animation: paper-enter 220ms ease-out both; }
.motion-skeleton { animation: quiet-pulse 1200ms ease-in-out infinite; }

@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after {
    scroll-behavior: auto !important;
    animation-duration: 1ms !important;
    animation-iteration-count: 1 !important;
    transition-duration: 1ms !important;
  }
}
```

reduced motion 下 Drawer/Sheet 直接显隐，不做位移；焦点、live region、loading 文案保持工作。不可用 `transition-all`，只声明实际变化属性。

---

## 11. 键盘、焦点与 Overlay 层级

焦点层级：Base（1）→ Route Detail/Full-screen（2）→ Combobox/Popover/Filter Sheet（3）→ Sensitive Confirm（4）→ Dirty Guard（5）。最内层先响应 Escape。

- 首个可聚焦元素是 Skip Link；顺序为 Sidebar → Header → Filter → Table → Pagination → Overlay。
- Drawer/Dialog/Sheet 锁 Tab，背景 `inert`；初焦标题，400 初焦首错，409 初焦冲突摘要。
- 保存 `returnFocusKey={route, recordId, action}`；原行消失则回结果摘要。
- Combobox 支持 Arrow/Enter/Escape，loading/empty/403 均有文字。
- 表格有 caption、`scope="col"`、`aria-sort`；横滚壳可聚焦。
- 所有 target 至少 44×44；200% 文字缩放不遮挡主操作；不能存在 hover-only 功能。
- Modal 遮罩可关闭仅适用于无脏数据、无进行中提交的安全场景；否则先进入 Dirty Guard。

---

## 12. 页面级高保真验收要点

### 12.1 Dashboard

- 只显示真实 User、Workspace、Story 数量/状态与最近 Story/操作；失败不伪装为 0。
- 指标为 flat band 而非卡片海；条目可跳转到带筛选的 canonical Resource。

### 12.2 Workspace / Story / User

- User → Workspace → Story 双向具名跳转；返回保留 query、页码、滚动和焦点。
- Workspace owner 只读，Story author/workspace/content/version/provenance/计数只读。
- 停用/归档不以“删除”文案出现；所有高风险动作二次确认并可进入 Audit。

### 12.3 Admin / Role / Permission

- Admin password 永不回填；角色变更显示 diff 和影响。
- 内置 Role 明确保护；Permission 页面显示“由系统发布管理”且无 CRUD。
- Permission matrix 在移动端只让矩阵容器横滚，首列 sticky，checkbox 有完整 Label。

### 12.4 Storage / Audit

- Storage capability、object key、MIME、size、time 清晰可读；不显示 endpoint secret/bucket credential。
- 删除要求完整 key；Preview 仅安全图片/文本/PDF，不执行 HTML/script。
- Audit append-only、before/after 脱敏、长 JSON 局部滚动；无 Password/Token/Session/file content。

---

## 13. 双视口与 Token 验收清单

### 13.1 Token

- [ ] Light/Dark 每个语义 token 均有映射；Dark 主按钮是暖白底 + 深暖字。
- [ ] 页面组件无孤立 hex、渐变、glow、远程字体、Font Awesome 或 Tailwind 2 写法。
- [ ] 当前本地字体仅使用真实存在的 400/500/600 字重。
- [ ] 普通行无 shadow；仅浮层使用 `shadow-overlay`。
- [ ] 状态均为文字 + dot/icon/shape，不只靠颜色。

### 13.2 Desktop 1440×1000

- [ ] Sidebar 精确 248px；Main `min-width:0`；页面无根级横滚。
- [ ] 页面仅一个 dashed Paper；Filter 最多两行；首屏至少 6 个 52px 行。
- [ ] Table 只在自身横滚；sticky header/主列使用实色 paper。
- [ ] Detail 780–840px；背景 inert；关闭归焦。

### 13.3 Mobile 390×844

- [ ] 56px Header；8px canvas；16px Paper padding；触控目标 ≥44px。
- [ ] Sidebar→Drawer、次筛选→Bottom Sheet、详情/表单→Full-screen。
- [ ] Footer 包含 safe-area；末字段后 ≥96px；主操作不挤压 H1。
- [ ] 根 `scrollWidth <= clientWidth`；Table/Matrix/JSON 仅局部滚动。
- [ ] Drawer/Sheet/Dialog 有锁焦、Escape、遮罩规则与 return focus。

### 13.4 范围

- [ ] 只覆盖运营总览、Workspace、Story、User、Admin、Role、Permission、Storage、Audit。
- [ ] 不新增、不重构 AI 模型、Token 计费、Gateway 页面；仅保证原入口不受导航影响。
- [ ] 不暗示第二数据源、迁移/同步/ETL、SQLite、JSON DB、内存回退或 `app/(app)`。

## 14. 交付结论

本稿把目标截图的品牌资产转译为可编码的 Tailwind CSS 4 视觉系统：以暖纸画布、单一虚线 Paper、Serif/Sans/Mono 三层排版和 flat rows 建立稳定运营密度；以 780–840px Desktop Drawer 与 Mobile Full-screen 保持父列表上下文；以集中 Light/Dark token、44px 命中区、明确焦点层级和 reduced-motion 保证跨主题、跨视口与键盘使用的一致性。

实现阶段应直接复用这里的语义 token 和组件结构，不应回退到默认 Refine DOM、通用 JSON CRUD、远程 CDN 或散落颜色。
