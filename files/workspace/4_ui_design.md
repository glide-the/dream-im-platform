# Ink Memory Admin v3：高保真 UI Art Direction 与前端视觉合同

> HTML Design Workflow / Stage 4 — UI Art Director
> 输入：`files/workspace/1_prd_draft.md`、`files/workspace/3_hierarchy_logic.md`、`files/inputs/target_image.png`、`docs/prd/color_system/**`
> 目标视口：Desktop `1440×1000`；Mobile `390×844`
> 输出性质：可交给 PRD v3、Refine/Next.js 页面实现与视觉验收的设计合同；不表示页面已实现

## 0. 本阶段 Prompt Architect 记录

**Optimized Prompt：**基于 Stage 1 PRD、Stage 3 层级逻辑、UI v2.1 封面与 Color System，为 Ink Memory Admin v3 产出中文高保真后台 UI 规范。视觉应采用“暖纸张编辑部运营台 × 超感官极简主义”，只继承目标图可证明的大留白、深炭棕文字、暖纸背景、轻纸面分区、单一虚线边界与无卡片设计，不将封面误作后台截图。必须覆盖统一 Admin Shell、Dream 用户/工作区/剧本层级、Plan/不可变 Version/Entitlement、用户订阅资格与 Allowance/Cash 分账、Provider/Model/Pricing、Gateway Key 一次性回执、Request/Usage/Ledger、Storage/RBAC/Session/Audit/Settings；提供 Aesthetic Style 表、组件树、CSS Variables、Tailwind 4 映射、响应式、可访问性、状态恢复、微交互及关键 HTML/Tailwind 示例。所有数据均来自真实 API，缺失时明确 loading/empty/503，不提供假指标；所有 Secret 只写不读，不在示例、日志或截图中出现明文；普通列表禁止卡片墙、渐变、glow 和常驻阴影。

**Optional Enhancers：**将月度账单预览与安全 CSV 作为筛选驱动的只读聚合；为未来支付适配器仅保留状态与幂等证据位，不出现 Stripe、支付宝或微信的虚构流程；为生命周期命令加入账务 Diff、幂等键、理由和 409 恢复界面。

## 1. 视觉裁决

本轮唯一方向为 **Editorial Operations Desk（编辑部运营台）× Ultra-sensory Minimalism（超感官极简主义）**。杂志感来自排版、留白、阅读顺序和事实的精确编排，不来自营销 Hero、夸张摄影、玻璃拟态或漂浮卡片。

目标图是 1489×2105 的 UI v2.1 封面，不是 Admin 页面截图。可采信的是居中留白、深炭棕标题、暖棕辅助文字、近纸白画布，以及封面明确写出的“减少面板、增加留白、视觉收敛、轻纸面分区、单一虚线边界、无卡片设计”。侧栏、表格、筛选、表单和移动端结构全部服从 Stage 3 的真实任务层级，不从封面臆造。

### 1.1 Aesthetic Style

| 维度 | 高保真规格 | 禁止项 |
|---|---|---|
| 风格 | 暖纸张、安静、可信、编辑部式秩序；复杂事实被排成可核对的证据页 | Landing Page、Hero、营销口号、默认 Refine/Ant 蓝后台 |
| 构图 | 248px 导航 + 64px 上下文栏 + 单一主滚动区；页面只出现一个虚线 Paper Boundary | KPI 卡片墙、多层面板嵌套、每个字段一张卡 |
| 层级 | 留白、字号、字重、细分隔线、局部底色共同建立层级 | 靠大面积阴影、渐变、glow 或彩色整行建立层级 |
| 排版 | Noto Serif SC 负责页面/区段标题；Noto Sans SC 负责任务文本；IBM Plex Mono 负责 ID、Code、金额精度和 Request | CDN 字体、手写字体用于密集表格、全站等宽字 |
| 色彩 | 暖纸和深棕为 90% 视觉面积；蓝、绿、黄、红仅作链接、状态与风险的小面积语义 | 冷灰全屏、纯黑正文、蓝紫 AI 渐变、高饱和整卡 |
| 形状 | 4/6/8/12px 圆角；短状态标签可为 pill；表格与普通条目保持平面 | 16–28px 万能大圆角、胶囊化所有控件 |
| 深度 | 常驻内容 `shadow: none`；只允许 Drawer、Dialog、Popover 使用语义阴影 | 普通行阴影、hover 抬升/缩放、层层悬浮 |
| 数据 | 名称/标题为第一识别层，ID 次行 mono；关系字段可跳转；数字 `tabular-nums` | 假趋势、随机图表、把缺失值渲染成 0 |
| 状态 | 图标/形状 + 状态文案 + 必要说明；错误附 request ID 与恢复动作 | 只用颜色、只弹 Toast、不保留上下文 |
| 动效 | 120–240ms，单轴、小位移、解释层级变化，尊重 reduced motion | 视差、弹跳、持续旋转、强扫光、逐行 stagger |

### 1.2 品牌证据到 Admin 的转译

| 品牌证据 | Admin v3 转译 |
|---|---|
| 封面大面积空白 | 页面标题区上下 24–32px；主体不被摘要卡占满 |
| 深炭棕粗标题 | 页面标题 Serif 30/38、区段标题 Serif 20/28；正文不使用纯黑 |
| 暖棕辅助文案 | 描述、更新时间、来源和次级 ID 使用 secondary/muted token |
| 单一虚线边界 | `S10/U1/P4/M5/G7` 在任一页面只能有一个；内部仅用留白和行分隔 |
| 无卡片设计 | Allowance、现金余额、资格、Usage 以同一纸面内的分区呈现，不做四张统计卡 |
| 小面积强调色 | 黄用于风险提示，绿用于已启用/成功，蓝用于链接，红用于失败/危险；均配文案 |

## 2. 技术基线声明

Stage 4 技能模板中的 **Tailwind CSS 2.2.19、Font Awesome 6.0.0 与 Google Fonts 链接仅是示例输出合同，不是本项目依赖**。Ink Memory Admin v3 的实际落地必须是：

- Tailwind CSS 4；使用语义 CSS Variables 与 `@theme inline`，不复制 Tailwind 2.2 CDN 示例。
- 本地 Noto Serif SC、Noto Sans SC 与 IBM Plex Mono；通过项目本地字体资产/Next 字体能力加载，不请求 Google Fonts。
- 本地 SVG 图标；图标继承 `currentColor`，不加载 Font Awesome、远程图标字体或图标 CDN。
- 不新增任何 CDN、远程头像、远程字体或第三方视觉运行时。
- 不把技能模板的杂志 Landing Page 内容、热带背景、色卡、拖拽视觉或导出模块带入 Admin。

## 3. 设计基础 Tokens

### 3.1 色彩变量

亮色以 UI v2.1/PDF 更新后的暖纸值为优先；暗色沿用 Color System 的“暖夜纸张”语义。状态色沿用 Color System。任何组件不得出现孤立十六进制。

```css
@import "tailwindcss";

:root,
[data-theme="light"] {
  color-scheme: light;
  --color-bg-app: #f6efe5;
  --color-bg-paper: #fffaf2;
  --color-bg-surface: color-mix(in srgb, #fffdf8 72%, transparent);
  --color-bg-surface-solid: #fffdf8;
  --color-bg-overlay: rgba(63, 52, 41, 0.48);
  --color-bg-hover: rgba(63, 52, 41, 0.055);
  --color-bg-active: rgba(95, 74, 54, 0.10);

  --color-text-primary: #3f3429;
  --color-text-body: #4b3f33;
  --color-text-secondary: #7a6a59;
  --color-text-muted: #9a8a78;
  --color-text-on-action: #fffdf8;

  --color-border-paper: #d8c7b3;
  --color-border-neutral: color-mix(in srgb, #d8c7b3 62%, #fffdf8);
  --color-border-focus: #3f3429;

  --color-action-primary: #5f4a36;
  --color-action-primary-hover: #4b3f33;
  --color-action-link: #4a90e2;
  --color-action-link-hover: #357abd;
  --color-state-success: #27ae60;
  --color-state-success-hover: #218c4e;
  --color-state-warning: #f39c12;
  --color-state-error: #f44336;
  --color-state-danger: #dd4444;
  --color-state-danger-hover: #bb3333;
  --color-disabled-bg: #d9d0c5;

  --color-shadow-soft: rgba(63, 52, 41, 0.10);
  --color-shadow-medium: rgba(63, 52, 41, 0.18);
  --color-code-bg: #2c2c2c;
  --color-code-text: #f3eee6;
  --color-code-inline-bg: rgba(63, 52, 41, 0.08);
}

[data-theme="dark"] {
  color-scheme: dark;
  --color-bg-app: #1f1b16;
  --color-bg-paper: #2a251e;
  --color-bg-surface: rgba(42, 37, 30, 0.82);
  --color-bg-surface-solid: #332d25;
  --color-bg-overlay: rgba(0, 0, 0, 0.72);
  --color-bg-hover: rgba(255, 255, 255, 0.08);
  --color-bg-active: rgba(129, 183, 210, 0.18);

  --color-text-primary: #f3eee6;
  --color-text-body: #eee8df;
  --color-text-secondary: #c8bcae;
  --color-text-muted: #9f9283;
  --color-text-on-action: #1f1b16;

  --color-border-paper: #5a4d3d;
  --color-border-neutral: #4a4238;
  --color-border-focus: #f3eee6;
  --color-action-primary: #f3eee6;
  --color-action-primary-hover: #ddd4c8;
  --color-action-link: #81b7d2;
  --color-action-link-hover: #6aa3bf;
  --color-state-success: #7bcf8f;
  --color-state-success-hover: #5abd72;
  --color-state-warning: #f7c96a;
  --color-state-error: #ff7a70;
  --color-state-danger: #ff8a7f;
  --color-state-danger-hover: #e06060;
  --color-disabled-bg: #58504a;
  --color-shadow-soft: rgba(0, 0, 0, 0.32);
  --color-shadow-medium: rgba(0, 0, 0, 0.45);
  --color-code-bg: #0d1117;
  --color-code-text: #e6edf3;
  --color-code-inline-bg: rgba(0, 0, 0, 0.18);
}

@theme inline {
  --color-admin-app: var(--color-bg-app);
  --color-admin-paper: var(--color-bg-paper);
  --color-admin-surface: var(--color-bg-surface);
  --color-admin-solid: var(--color-bg-surface-solid);
  --color-admin-hover: var(--color-bg-hover);
  --color-admin-active: var(--color-bg-active);
  --color-admin-ink: var(--color-text-primary);
  --color-admin-body: var(--color-text-body);
  --color-admin-secondary: var(--color-text-secondary);
  --color-admin-muted: var(--color-text-muted);
  --color-admin-paper-line: var(--color-border-paper);
  --color-admin-control-line: var(--color-border-neutral);
  --color-admin-primary: var(--color-action-primary);
  --color-admin-link: var(--color-action-link);
  --color-admin-success: var(--color-state-success);
  --color-admin-warning: var(--color-state-warning);
  --color-admin-error: var(--color-state-error);
  --color-admin-danger: var(--color-state-danger);
  --font-admin-display: var(--font-noto-serif-sc);
  --font-admin-sans: var(--font-noto-sans-sc);
  --font-admin-mono: var(--font-ibm-plex-mono);
}
```

暗色主按钮必须使用深色前景 `--color-text-on-action: #1f1b16`，不得沿用旧文档中“暖白按钮 + 白字”的低对比组合。

### 3.2 字体、字号与数字

| 语义 | Font | Desktop | Mobile | 规则 |
|---|---|---:|---:|---|
| Page title | Noto Serif SC 600 | 30/38 | 26/34 | 最多两行，不做超大 Hero |
| Section title | Noto Serif SC 600 | 20/28 | 19/27 | 每个纸面分区一个即可 |
| Resource title | Noto Sans SC 600 | 16/24 | 16/24 | 名称、邮箱、剧本标题优先 |
| Body | Noto Sans SC 400 | 14/22 | 14/22 | 最小正文 14px |
| Control | Noto Sans SC 500 | 14/20 | 14/20 | 触控高度不低于 44px |
| Meta | Noto Sans SC 400 | 12/18 | 12/18 | 不承载关键动作 |
| ID/Code | IBM Plex Mono 400 | 12/18 | 12/18 | 默认截断，可复制，不自动折断布局 |
| Amount | IBM Plex Mono 500 | 14/22 | 14/22 | `tabular-nums`；USD 与 micro-USD 同时可核对 |
| Table header | Noto Sans SC 600 | 12/18 | 不作为移动表头 | 正常中文，不全大写 |

金额、Token、RPM、序号和时间使用 `font-variant-numeric: tabular-nums`。金额主行展示格式化 USD，下一行只读展示精确整数 micro-USD；两者都来自后端/整数转换，不允许用 JS 浮点计算视觉结果。

### 3.3 间距、尺寸、圆角与阴影

```css
:root {
  --space-1: 0.25rem;  /* 4 */
  --space-2: 0.5rem;   /* 8 */
  --space-3: 0.75rem;  /* 12 */
  --space-4: 1rem;     /* 16 */
  --space-5: 1.25rem;  /* 20 */
  --space-6: 1.5rem;   /* 24 */
  --space-8: 2rem;     /* 32 */
  --space-10: 2.5rem;  /* 40 */
  --space-12: 3rem;    /* 48 */
  --radius-xs: 0.25rem;
  --radius-sm: 0.375rem;
  --radius-md: 0.5rem;
  --radius-lg: 0.75rem;
  --control-h: 2.75rem;
  --table-row-h: 3.25rem;
  --sidebar-w: 15.5rem;
  --topbar-h: 4rem;
  --drawer-w: 42rem;
  --content-max: 90rem;
  --shadow-overlay: 0 18px 52px var(--color-shadow-medium);
  --shadow-popover: 0 10px 28px var(--color-shadow-soft);
}
```

- App Shell 常驻区无阴影；侧栏以 1px 纸边线分隔。
- Paper Boundary 为 `1px dashed color-mix(in srgb, var(--color-border-paper) 84%, transparent)`，圆角 12px。
- 内部 section 不重复画外框。仅表头下、section 间和行间使用 1px 分隔。
- Drawer/Dialog/Popover 可用 overlay shadow；普通 row、状态、Allowance、Billing Account 不可使用 shadow。

## 4. UI Component Structure

### 4.1 Admin Shell

```text
S0 AdminShell
├─ S1 AdminNavigation
│  ├─ BrandMark（本地 SVG + “Ink Memory”文本）
│  ├─ NavGroup × 5（S4–S9）
│  └─ AccountContext（身份、角色、退出；无 Session Token）
├─ S2 ContextBar
│  ├─ MobileMenuTrigger
│  ├─ Breadcrumbs
│  ├─ DependencyHealth（文字 + 图标）
│  ├─ ThemeToggle
│  └─ AccountMenu
├─ S3 MainContent
│  ├─ PageHeading（标题、目的、刷新时间、唯一主操作）
│  └─ S10 PagePaper（页面唯一虚线边界）
│     ├─ S11 QueryBar
│     ├─ S12 FactRegion / X1 InlineState
│     └─ S13 ServerPagination
├─ X2 RiskDialog / MobileFullScreenConfirm
└─ S14 FeedbackLayer（Toast + polite live region + request ID）
```

Desktop：`S1` 固定 248px，`S2` 高 64px，`S3` 只保留一个垂直滚动容器。Mobile：`S1` 是 `min(320px, 88vw)` 的锁焦 Drawer，`S2` 高 56px，`S3` 左右 16px。

### 4.2 核心业务页面组件

| 页面根 | Paper 与组件结构 | 主要视觉重点 |
|---|---|---|
| `D0` Dream 层级 | `D6 → D7 身份映射 → D8 关系导航 → D9 Story → D10 Character/Scene → D11 受控动作` | 用关系线、具名链接和面包屑表达 User→Workspace→Story，不用树形卡片墙 |
| `P0` 套餐版本 | `P4 → P5 查询 → P1 Plan → P2 版本时间轴 → P6 发布工作区(P7–P11)` | Published 使用锁定条与只读快照；Draft 使用四段编辑 + Sticky Footer |
| `U0` 用户订阅 | `U1 → U2 身份状态 → U3–U6 资格 → U7 Allowance → U8 Cash → U9/U10 Usage → U11 时间线 → U12 链接 → U13–U15 动作` | 作为 v3 主样板：解释“为何可调用/不可调用”，Allowance 与 Cash 永不合并 |
| `M0` 模型中心 | `M5 → M1 Provider → M2 Model Alias → M3 Pricing versions → M4 Override → M6 Requests` | 以一条横向/纵向路由链表达依赖；Credential 只显示配置状态 |
| `G0` 网关计费 | `G7 → G8 筛选 → G1 Key/G18/G19 → G2 Requests → G9–G17 Detail → G3–G6 Billing` | Request Drawer 是资格、路由、价格、预留、结算和 Ledger 的证据链 |
| `S9` 治理 | Storage / Admin / Role / Session / Audit / Settings 共用 S10–S13 | 平面表格与受控命令；Secret、Session Token、Prompt/response 永不展示 |

## 5. 页面高保真规格

### 5.1 Dream 用户 → Workspace → Story

- 页首使用可返回的关系面包屑；每一层显示“名称/邮箱”为主信息、“ID + Copy”为次信息。
- Desktop 的关系导航可同纸面三列：User 24%、Workspace 31%、Story 45%；列间仅一条竖分隔。390px 改为单层钻取，顶部提供返回父层。
- Workspace 列表行：名称、Owner 关系链接、Story/Character/Scene 的真实计数或“暂不可用”、更新时间、行级菜单。
- Story 主行：标题/identifier、Workspace、Author、type、status、review status、关联数量、updated_at。状态都使用文字标签。
- Story 详情依次为基本信息、正文只读、角色关系、按 `order_index` 的 Scene、审阅/provenance；不提供无源契约的创建/硬删除。
- Character/Scene 表未迁入时，`D10` 原位替换为 503 状态，列出缺失依赖和 request ID；不显示旧 Admin 表数据。
- 编辑 Workspace 使用右 Drawer：name 是 Text，Owner 只读关系，settings 是 JSON Editor；没有 create/delete/status 控件。

### 5.2 Plan、Version 与 Entitlement

- Plan 列表保持平面：name/code、status、currency、最新已发布版本、订阅引用数、updated_at。禁止显示虚构收入。
- Version 时间轴不是卡片列：左侧 20px 时间轨道，右侧每一版为 64px 条目；Published 为锁图标 + “已发布 · 不可变”，Draft 为铅笔图标 + “草稿”。
- `P6` 使用独立路由。Desktop 四段纵向展开：价格与周期、权益、超额策略、发布核对；Mobile 一步一屏，但 URL/草稿 ID 不变。
- Entitlement 模型选择是服务端分页 Searchable Multi-select；scope 为 Checkbox Group；RPM/Token/micro-USD/Storage 是整数 + 单位；`null` 与 `0` 必须有不同辅助说明。
- 发布前 Diff 采用两列“当前 Draft / 将锁定快照”，仅变化行出现淡黄 3px 左线。发布后全部控件只读，唯一可变动作是“复制为新 Draft”。
- 409 在发布工作区内显示服务器最新版本、冲突字段和“刷新比较”；不得清空草稿或跳回列表。

### 5.3 用户订阅详情（视觉主样板）

1. `U2` 身份带：Dream User → Billing Identity → Subscription → Plan Version。使用连续细线和箭头 SVG，不使用四张卡；每个节点包含具名链接、状态和次级 ID。
2. `U3–U6` 资格解释：先列 Plan Entitlement，再列 User Override，最后以“交集结果”输出实际 Model Alias、Scope、RPM、Token/金额/Storage 与 overage。拒绝项显示命中规则和来源。
3. `U7` 周期 Allowance：同一水平标尺显示 granted、reserved、consumed、remaining；数据缺失显示“额度数据暂不可用”，不得画 0% 进度。
4. `U8` Billing Account：紧随 Allowance 之后但以区段标题和说明明确“现金余额，不含订阅赠送额度”；只显示 available、reserved、lifetime debited。
5. `U9/U10` Usage：真实用量才绘制折线/柱；数据不足时显示“暂不预测”及原因，不画占位趋势。
6. `U11` 生命周期时间线以时间倒序 flat rows 展示事件、操作者/系统、Ledger/Audit 引用；原账本不可编辑。
7. `U13–U15` 生命周期操作先打开影响摘要：目标状态、即时/下周期、charge/credit、Allowance 变化、幂等键、理由。危险操作采用 danger text + 边框，不用大红底。

### 5.4 Provider → Model → Pricing

- Provider 列表每行显示 name/code、protocol、base URL host、Credential“已配置/未配置”、健康、模型数、定价覆盖和真实近期请求状态；无数据时显示“暂不可用”。
- Provider 编辑面板的 Secret 输入永远为空；辅助文案固定为“留空表示不轮换。已保存凭据不可查看”。页面、详情、Toast、Audit 和截图均不出现 Secret。
- Model 以 `alias → Provider → upstream_model` 三段链展示；alias 是主识别，upstream model 只在控制面显示。
- Pricing 历史是版本表；新价格使用“USD / 1M Token”输入和 micro-USD 镜像。不得在历史行提供 Edit。
- Model/Provider 行可跳到预筛选 Request；返回恢复原筛选、页码、滚动和焦点。

### 5.5 Gateway Key、Request、Usage 与 Ledger

- Key 列表只显示 name、prefix、status、scope、Billing Identity、last used、expires at；动作只有创建、revoke、复制安全配置地址，不存在“查看 Key”。
- 创建成功进入 `G19` 一次性回执。真实 Token 仅在受控运行态临时区域出现一次；本文档与示例不写任何模拟明文。离开前需确认“已保存”，刷新后不可恢复。
- Request 列表使用共享 URL 筛选；Request ID/Provider/Model/User/Subscription/outcome/error/time 为主要列。
- Desktop `G9` 为 672px 宽 Drawer；Mobile 为全屏详情。顺序固定为 Key/User → 资格快照 → 路由 → Token/价格 → Allowance → Cash → Settlement/Ledger → 性能/脱敏错误。
- `G14` Allowance 与 `G15` Cash 使用互斥来源标识；不能视觉上合成“总余额”。Pending/unknown usage 显示待结算，不能按 0 费用渲染。
- Ledger 表为只读 flat rows，reversal 是新行并链接原条目；不提供行内编辑、删除或批量删除。
- 月度账单预览与 CSV 只聚合当前真实筛选；UI 显示时区、周期、字段清单和导出时间。导出不含 Secret、Prompt、response、完整 Key 或敏感 metadata。

### 5.6 Storage、RBAC、Session、Audit 与 Settings

- Storage 只展示 driver/API 确认支持的能力。没有 list 时显示“当前 Driver 不提供列表能力”，不能放一个空文件 KPI。
- Role 权限矩阵桌面按域×read/write/high-risk；移动按域逐组。checkbox 旁保留完整 permission code。
- 最后一个 active super_admin 的停用操作禁用，并通过文字解释原因。
- Session 只显示设备/时间/IP 等安全元信息和 revoke；Session Token 从不作为字段节点存在。
- Audit 使用 append-only 时间表，before/after/metadata 先服务端递归脱敏。没有 update/delete 动作。
- System Secret 只有 Password 输入、配置状态和“轮换”动作；已保存值永不预填。

## 6. 控件与状态合同

| 数据/任务 | 控件 | 高保真与安全规则 |
|---|---|---|
| 文本 | 44px Text Input | label 常显；错误位于控件下方；Code 创建后只读 |
| 整数/配额 | Number Input + 单位 suffix | 禁止小数；空值/0 的解释紧邻控件 |
| 金额 | Decimal USD + micro-USD read-only | UI 只负责安全字符串输入；提交整数；禁止浮点计算 |
| 枚举 | Select / Segmented Radio | 选项来自服务端/Zod 白名单；状态不能自由输入 |
| 多模型/Scope | Searchable Multi-select / Checkbox Group | 服务端分页、选中数量、真实 ID/code |
| 关系 | Searchable Relation Combobox | 显示名称 + 次级 ID；支持精确 ID 粘贴；不手填未知 FK |
| 时间 | DateTime Picker | 可见时区；API 为 ISO；相对时间附精确值 |
| Boolean | Switch + 影响说明 | label 写清“开启后……”；不能只有开关 |
| JSON | JSON Editor | 仅真实 JSON 字段；行列错误；可恢复服务器值 |
| Secret | 空 Password Input | 只写不读、不可预填；空值表示不轮换；禁止 Copy 已存值 |
| ID/快照 | Read-only Code + Copy | Copy 按钮有 accessible name；不把 ID 当页标题 |
| 简单编辑 | Desktop Drawer / Mobile 全屏 | 离开未保存提醒；关闭归还焦点 |
| 复杂发布 | 独立路由 + Sticky Footer | 发布前 review + Diff；409 保留草稿 |
| 高风险命令 | Modal / Mobile 全屏确认 | 影响、账务、幂等键、理由、确认短语、审计说明 |

### 6.1 状态标签

- 高度 24px，水平 padding 8px，12px Sans 500，图标 12px；短状态才使用 pill。
- `active/success`：绿色圆点 + 文案；`trial`：蓝色描边 + 文案；`past_due/warning`：黄色三角 + 文案；`paused`：中性双线图标 + 文案；`cancelled/expired`：中性删除线/时钟 + 文案；`error/danger`：红色图标 + 文案。
- `cancel_at_period_end` 是 active/trial 的次级标记，不设计成独立状态色。
- 任何状态均提供 `aria-label`；颜色不承担唯一含义。

### 6.2 Loading / Empty / Error / Success

| 状态 | 放置方式 | 文案与恢复 |
|---|---|---|
| Loading | 保留 S11、表头和真实行高 skeleton；`aria-busy=true` | 超时后转“仍在加载”，不清空已有结果 |
| Empty | S12 原位 240px 空区 | 区分“资源为空”与“筛选无结果”；只读页不诱导创建 |
| 401 | 页面状态 | “会话已过期”，登录后回原 URL |
| 402 | U/G 原位风险条 | 明确 Allowance/现金不足和对应详情入口；不建议重试消耗请求 |
| 403 | 页面或受限分区 | 显示所需权限/权益类别，不泄露记录内容 |
| 404 | 页面状态 | 返回对应列表，保留可安全继承的筛选 |
| 409 | 表单/命令原位 | 服务器最新状态 + Diff + 刷新比较；保留草稿 |
| 429 | U/G 原位状态 | 显示命中的 RPM/Token 来源与 reset time |
| 500 | S12 原位 | 安全摘要 + request ID + 重试/复制 ID |
| 503 | 对应依赖分区 | 缺失 Dream 表/数据库/依赖 + 运维提示；无旧表/假数据回退 |
| Success | 就近行内确认 + Toast/live region | 资源 ID、真实动作、下一步；焦点回合理位置 |

## 7. Responsive Behavior

### 7.1 Desktop 1440×1000

- `S1` 248px 固定，`S2` 64px sticky；`S3` 可用宽 1192px，左右 padding 32px，内容不超过 1440px。
- 页面标题区不高于 112px；首屏需看到 S11、表头和至少 5–6 个标准行，不能被摘要卡占满。
- 表格仅其内部可横向滚动；页面根节点不可横向滚动。
- 简单详情 Drawer 672px；复杂发布/财务命令使用独立页或最大宽 720px Dialog。
- U7/U8 可 1:1 并排，但属于同一 Paper 的两个分区，不各自画卡片。

### 7.2 Mobile 390×844

- App padding 16px；顶部 56px；主按钮在标题下全宽，次级动作进入 overflow。
- 导航为锁焦 Drawer；搜索常显，其他筛选进入底部 Sheet，并显示已选数量。应用后写回同一 URL 参数。
- 表格改为 72–96px 的关键事实行：主标题、状态、一个关键关系、时间、44px 行菜单。禁止根页面横滚。
- Dream 关系一次只展示一层；关系 Tab 可以局部横滚，返回恢复父层滚动和触发器焦点。
- P6 一步一屏；Sticky Footer 避开 safe area。U7 后接 U8，视觉与语义保持分离。
- Request/Provider/Version/编辑 Drawer 全部改全屏子路由；浏览器返回恢复筛选、页码、滚动。
- 高风险操作先打开动作 Sheet，再进入全屏确认；键盘弹出后 Footer 不遮挡字段错误。
- 触控目标至少 44×44，紧邻危险按钮保持至少 8px 间距。

### 7.3 断点合同

| 范围 | 行为 |
|---|---|
| `< 640px` | 单列、Mobile Header、Drawer/Sheet、关键事实行、16px padding |
| `640–1023px` | 可折叠导航、24px padding、两列只用于简短事实，不显示三列关系 |
| `≥ 1024px` | 固定侧栏、完整 QueryBar、桌面表格、Drawer 详情 |
| `≥ 1440px` | 保持内容密度，不无限拉宽；行文本设 max-width 与截断/展开 |

## 8. Motion、Focus 与无障碍

```css
@keyframes admin-page-enter {
  from { opacity: 0; transform: translateY(4px); }
  to { opacity: 1; transform: translateY(0); }
}

@keyframes admin-drawer-enter {
  from { opacity: 0; transform: translateX(12px); }
  to { opacity: 1; transform: translateX(0); }
}

.admin-page-enter { animation: admin-page-enter 180ms ease-out both; }
.admin-drawer-enter { animation: admin-drawer-enter 220ms ease-out both; }

@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after {
    scroll-behavior: auto !important;
    animation-duration: 1ms !important;
    animation-iteration-count: 1 !important;
    transition-duration: 1ms !important;
  }
}
```

- Hover 背景 120ms；focus ring 120ms；Drawer 220ms；Accordion 180ms；Toast 180ms。无 `scale`、bounce、stagger 和无限动画。
- Skeleton 使用低对比静态/轻脉冲，不能扫光；reduced motion 下完全静态。
- 全局 focus 为 2px `--color-border-focus` + 2px offset；不得移除 outline。
- Drawer/Dialog/Sheet 锁焦点，Escape 关闭，关闭后归还触发器；危险提交中不可误关闭。
- 表格有 caption、`scope=col`；移动事实行用 `dl`，不是用无表头 div 伪装表格。
- 异步成功用 `aria-live=polite`；字段/提交错误用 `role=alert`；复制动作播报复制对象，不播报 Secret 内容。
- 图标按钮使用中文 accessible name；本地 SVG `aria-hidden=true`，状态文字承担名称。

## 9. 关键 HTML / Tailwind 4 示例

以下是结构合同而非独立运行页面。它们依赖本地字体变量、本地 SVG 组件、真实 API 数据和项目鉴权上下文；不包含任何 CDN、假指标或 Secret 明文。

### 9.1 Admin Shell + 平面数据 Paper

```html
<div class="min-h-dvh bg-admin-app font-admin-sans text-admin-body lg:grid lg:grid-cols-[15.5rem_minmax(0,1fr)]">
  <aside class="hidden border-r border-admin-paper-line bg-admin-app lg:fixed lg:inset-y-0 lg:block lg:w-[15.5rem]"
         aria-label="管理后台主导航">
    <div class="flex h-16 items-center gap-3 px-6 text-admin-ink">
      <!-- 本地 SVG BrandMark；不使用 Font Awesome -->
      <svg aria-hidden="true" class="size-6" viewBox="0 0 24 24"><path fill="currentColor" d="M5 4h14v16H5z"/></svg>
      <span class="font-admin-display text-lg font-semibold">Ink Memory</span>
    </div>
    <nav class="px-3" aria-label="业务模块"><!-- NavGroup / aria-current=page --></nav>
  </aside>

  <div class="min-w-0 lg:col-start-2">
    <header class="sticky top-0 z-30 flex h-14 items-center border-b border-admin-paper-line bg-admin-app/95 px-4 backdrop-blur-sm lg:h-16 lg:px-8">
      <button class="grid size-11 place-items-center rounded-md focus-visible:outline-2 focus-visible:outline-offset-2 lg:hidden"
              aria-label="打开主导航"><!-- local Menu SVG --></button>
      <nav aria-label="面包屑" class="min-w-0 truncate text-sm text-admin-secondary">剧本运营 / 用户</nav>
      <div class="ml-auto flex items-center gap-2"><!-- Health / Theme / Account --></div>
    </header>

    <main class="mx-auto max-w-[90rem] px-4 py-6 lg:px-8 lg:py-8">
      <header class="mb-6 flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <h1 class="font-admin-display text-[1.625rem] font-semibold leading-[2.125rem] text-admin-ink lg:text-[1.875rem] lg:leading-[2.375rem]">业务用户</h1>
          <p class="mt-2 max-w-3xl text-sm leading-6 text-admin-secondary">直接读取 Dream 真实用户，并核对计费身份与订阅关系。</p>
        </div>
      </header>

      <section class="overflow-hidden rounded-xl border border-dashed border-admin-paper-line bg-admin-paper" aria-labelledby="user-list-title">
        <h2 id="user-list-title" class="sr-only">业务用户列表</h2>
        <div class="flex min-h-16 flex-wrap items-center gap-3 border-b border-admin-paper-line px-4 py-3 lg:px-6">
          <!-- Search 始终可见；服务端白名单筛选 -->
        </div>
        <div class="overflow-x-auto">
          <table class="w-full min-w-[52rem] border-collapse text-left text-sm">
            <caption class="sr-only">Dream 真实用户、计费身份和订阅状态</caption>
            <thead class="text-xs font-semibold text-admin-secondary"><!-- columns --></thead>
            <tbody class="divide-y divide-admin-paper-line"><!-- API rows / X1 --></tbody>
          </table>
        </div>
        <footer class="flex min-h-14 items-center justify-between border-t border-admin-paper-line px-4 text-sm text-admin-secondary lg:px-6">
          <span aria-live="polite">总数来自服务端</span><!-- S13 -->
        </footer>
      </section>
    </main>
  </div>
</div>
```

### 9.2 用户订阅资格、Allowance 与 Cash 分区

```html
<section class="rounded-xl border border-dashed border-admin-paper-line bg-admin-paper" aria-labelledby="subscription-title">
  <header class="border-b border-admin-paper-line px-4 py-5 lg:px-6">
    <div class="flex flex-wrap items-center gap-2 text-sm text-admin-secondary" aria-label="身份与订阅路径">
      <a class="text-admin-link underline-offset-4 hover:underline" href="#dream-user">Dream User</a>
      <span aria-hidden="true">→</span>
      <a class="text-admin-link underline-offset-4 hover:underline" href="#billing-identity">Billing Identity</a>
      <span aria-hidden="true">→</span>
      <span>Subscription</span><span aria-hidden="true">→</span><span>Plan Version</span>
    </div>
    <h2 id="subscription-title" class="mt-3 font-admin-display text-xl font-semibold text-admin-ink">用户订阅与调用资格</h2>
  </header>

  <div class="divide-y divide-admin-paper-line">
    <section class="px-4 py-6 lg:px-6" aria-labelledby="eligibility-title">
      <div class="grid gap-6 lg:grid-cols-[1fr_auto_1fr_auto_1.2fr] lg:items-start">
        <div><h3 id="eligibility-title" class="font-semibold text-admin-ink">套餐权益</h3><!-- entitlement facts --></div>
        <span class="hidden text-admin-muted lg:block" aria-hidden="true">∩</span>
        <div><h3 class="font-semibold text-admin-ink">用户限制</h3><!-- override facts --></div>
        <span class="hidden text-admin-muted lg:block" aria-hidden="true">=</span>
        <div class="border-l-[3px] border-admin-success pl-4"><h3 class="font-semibold text-admin-ink">最终权限</h3><!-- API intersection --></div>
      </div>
    </section>

    <div class="grid lg:grid-cols-2 lg:divide-x lg:divide-admin-paper-line">
      <section class="px-4 py-6 lg:px-6" aria-labelledby="allowance-title">
        <p class="text-xs font-semibold text-admin-secondary">订阅赠送额度</p>
        <h3 id="allowance-title" class="mt-1 font-admin-display text-lg font-semibold text-admin-ink">周期 Allowance</h3>
        <dl class="mt-5 grid grid-cols-2 gap-x-6 gap-y-4 font-admin-mono text-sm tabular-nums">
          <div><dt class="font-admin-sans text-xs text-admin-muted">Granted</dt><dd data-field="allowance.granted">—</dd></div>
          <div><dt class="font-admin-sans text-xs text-admin-muted">Reserved</dt><dd data-field="allowance.reserved">—</dd></div>
          <div><dt class="font-admin-sans text-xs text-admin-muted">Consumed</dt><dd data-field="allowance.consumed">—</dd></div>
          <div><dt class="font-admin-sans text-xs text-admin-muted">Remaining</dt><dd data-field="allowance.remaining">—</dd></div>
        </dl>
      </section>

      <section class="border-t border-admin-paper-line px-4 py-6 lg:border-t-0 lg:px-6" aria-labelledby="cash-title">
        <p class="text-xs font-semibold text-admin-secondary">现金账户 · 不含赠送额度</p>
        <h3 id="cash-title" class="mt-1 font-admin-display text-lg font-semibold text-admin-ink">Billing Account</h3>
        <dl class="mt-5 grid grid-cols-2 gap-x-6 gap-y-4 font-admin-mono text-sm tabular-nums">
          <div><dt class="font-admin-sans text-xs text-admin-muted">Available</dt><dd data-field="billing.available">—</dd></div>
          <div><dt class="font-admin-sans text-xs text-admin-muted">Reserved</dt><dd data-field="billing.reserved">—</dd></div>
        </dl>
      </section>
    </div>
  </div>
</section>
```

### 9.3 Published Version 锁定与 Diff

```html
<section class="border-l-[3px] border-admin-warning pl-4" aria-labelledby="publish-review-title">
  <div class="flex items-start gap-3">
    <svg aria-hidden="true" class="mt-0.5 size-5 shrink-0 text-admin-warning" viewBox="0 0 24 24"><path fill="currentColor" d="M12 2 2 22h20L12 2z"/></svg>
    <div>
      <h2 id="publish-review-title" class="font-admin-display text-xl font-semibold text-admin-ink">发布并锁定版本</h2>
      <p class="mt-1 text-sm leading-6 text-admin-secondary">发布后价格和权益不可覆盖；后续变更需要复制为新 Draft。</p>
    </div>
  </div>

  <div class="mt-5 overflow-x-auto">
    <table class="w-full min-w-[38rem] text-left text-sm">
      <caption class="sr-only">Draft 与将锁定快照的差异</caption>
      <thead><tr class="border-b border-admin-paper-line text-xs text-admin-secondary"><th>字段</th><th>当前 Draft</th><th>将锁定快照</th></tr></thead>
      <tbody class="divide-y divide-admin-paper-line"><!-- 仅由真实 Diff 生成变化行 --></tbody>
    </table>
  </div>
</section>
```

### 9.4 Gateway Key 一次性回执（Secret-safe 结构）

```html
<section class="rounded-xl border border-dashed border-admin-paper-line bg-admin-paper p-4 lg:p-6" aria-labelledby="key-receipt-title">
  <div role="status" class="border-l-[3px] border-admin-success pl-4">
    <h2 id="key-receipt-title" class="font-admin-display text-xl font-semibold text-admin-ink">Gateway Key 已创建</h2>
    <p class="mt-1 text-sm leading-6 text-admin-secondary">真实 Token 只在本次受控回执中显示。离开后不可恢复，请先保存到安全位置。</p>
  </div>

  <!-- 文档与 Storybook fixture 禁止注入示例 Key；真实值仅来自 create response 的临时内存 -->
  <div class="mt-6 rounded-md border border-admin-control-line bg-admin-solid p-4">
    <div class="flex items-center justify-between gap-3">
      <span class="text-sm font-medium text-admin-ink">一次性 Token</span>
      <button class="min-h-11 rounded-md border border-admin-control-line px-3 text-sm font-medium focus-visible:outline-2 focus-visible:outline-offset-2"
              type="button" aria-label="复制一次性 Gateway Token">复制 Token</button>
    </div>
    <div class="mt-3 font-admin-mono text-sm text-admin-muted" aria-label="一次性 Token 受保护区域">仅在真实创建响应后渲染</div>
  </div>

  <div class="mt-6 border-t border-admin-paper-line pt-5"><!-- Base URL / Anthropic / OpenAI 配置；Secret 引用环境变量名，不重复明文 --></div>
  <p class="sr-only" aria-live="polite"><!-- “Token 已复制”，不朗读 Token 内容 --></p>
</section>
```

### 9.5 503 原位状态

```html
<section class="min-h-60 px-4 py-10 text-center lg:px-6" role="status" aria-labelledby="dependency-title">
  <svg aria-hidden="true" class="mx-auto size-8 text-admin-warning" viewBox="0 0 24 24"><path fill="currentColor" d="M12 2 2 22h20L12 2z"/></svg>
  <h2 id="dependency-title" class="mt-4 font-admin-display text-xl font-semibold text-admin-ink">真实业务依赖暂不可用</h2>
  <p class="mx-auto mt-2 max-w-xl text-sm leading-6 text-admin-secondary">Character / Scene 真实表尚未就绪。系统不会回退到旧 Admin 平行表。</p>
  <p class="mt-4 font-admin-mono text-xs text-admin-muted">Request ID：<span data-field="request.id">—</span></p>
  <button class="mt-6 min-h-11 rounded-md bg-admin-primary px-4 text-sm font-medium text-[var(--color-text-on-action)] focus-visible:outline-2 focus-visible:outline-offset-2" type="button">重试</button>
</section>
```

## 10. Refine / Next.js 实现映射

- Refine Resource 只决定路由与数据操作，不直接套默认 CRUD 视觉；列表、Show、Create/Edit 外壳统一使用上述 Shell、Paper、QueryBar、FactRegion 和 Pagination。
- Data Provider 的 `page/pageSize/sorter/filter/meta.total` 必须驱动 S11–S13；UI 不在客户端伪分页或猜 total。
- Server Component 负责首屏安全数据边界；有交互的筛选、Drawer、Dialog 和复制控件再进入 Client Component。
- Route Handler 的错误映射到统一 `ProblemState`：status、safe message、request ID、retryability、field errors；不能向 UI 透出 SQL 或 Secret。
- 所有关系 ComboBox 使用受权、服务端分页端点；跨页面链接只携带白名单 filter，不携带 Secret、临时表单或一次性 Token。
- 设计 Token 集中维护；组件只使用语义类。Dark Theme 通过 `data-theme` 切换，不为单个页面复制颜色表。
- 本地 SVG 图标统一 16/20/24px，`stroke-width` 1.75–2；不以 emoji 作为生产图标。

## 11. 视觉与交互验收清单

- [ ] 1440×1000：固定 248px 侧栏、64px 顶栏、单一主滚动；首屏可见查询、表头与真实数据行。
- [ ] 390×844：无根节点横向滚动；导航 Drawer、筛选 Sheet、详情全屏、触控目标 ≥44px。
- [ ] 任一页面最多一个虚线 Paper Boundary；普通行、Allowance、Cash、状态与设置项无阴影。
- [ ] 无 Landing Page、Hero、卡片墙、假指标、渐变、glow、远程字体、Font Awesome 或 CDN。
- [ ] Tailwind CSS 4 语义 token、本地 Noto/IBM Plex、本地 SVG 的技术合同明确且可实现。
- [ ] Dream User→Workspace→Story 关系可读、可返回；未迁入表为 503，不读旧平行表。
- [ ] Published Version/Entitlement 明确锁定；Draft 发布有 Diff；409 保留草稿并恢复比较。
- [ ] 用户订阅页解释 Entitlement ∩ Override；Allowance 与 Billing Account 视觉、文案和计算语义分离。
- [ ] Provider Secret、System Secret、Session Token 与已保存 Gateway Key 从不作为可读字段；一次性 Key 不进入示例、日志或截图。
- [ ] Request 详情按资格→路由→价格→预留→结算→Ledger 顺序；unknown usage 不显示 0。
- [ ] Ledger、Usage、Audit 只读/只追加；reversal 显示为新记录。
- [ ] Loading、Empty、401、402、403、404、409、429、500、503、Success 均有原位状态和恢复动作。
- [ ] 所有状态有文字；所有表单有 label；Dialog/Drawer 锁焦并归焦；live region 不朗读 Secret。
- [ ] 两主题关键文本、按钮、状态和 focus ring 通过 WCAG AA；reduced motion 下无持续动效。

## 12. 交付边界

本稿是 Admin v3 的 UI Art Direction，不修改 Dream 业务系统，不定义平行业务表，不恢复 PWA，不删除 Storage，不接入真实支付渠道，也不包含任何模拟数据或 Secret。后续页面实现必须以 PRD/Repository/API 的真实字段和权限结果为准；若实现字段与本稿占位语义不一致，应优先纠正数据合同，而不是用视觉假值填补。
