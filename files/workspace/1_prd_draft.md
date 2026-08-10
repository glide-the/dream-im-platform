# Ink Memory Admin v3 专项 PRD：紧凑页头、列表头与可折叠筛选

> 阶段：HTML Design Workflow / Stage 1 — PRD Architect
> 专项范围：全部业务模块的页面标题区、列表标题区、Query Bar；不改表格字段、领域权限或服务端语义。
> 视口：Desktop 1440×1000；Mobile 390×844。
> 技术基线：项目现有 Next.js、Refine、Tailwind CSS 4、本地字体、本地 SVG/React SVG 图标；禁止模板 CDN、Google Fonts、Font Awesome。

## 0. Stage 1 Prompt Architect Record

### Optimized Prompt

基于 `target_image.png` 的暖纸、克制分区、减少面板、单一虚线外边界原则，结合现有
`AdminResourceTable` 与 `AdminResourceManager`，为 Ink Memory Admin v3 设计跨模块统一的
紧凑页面/列表 Header 和可折叠 Query Bar。输出必须定义 Desktop/Mobile 布局、共享组件边界、
各业务模块保留的领域操作、收起/展开/已应用/草稿态、URL 真相源、无状态丢失、键盘与读屏规则，
并给出可验证验收标准。不可把品牌封面误作后台截图，不新增卡片堆叠或外部字体图标依赖。

### Optional Enhancers

- 用真实长标题、3 个筛选器、关系 Combobox、错误态和 100+ 条结果做密度压力测试。
- 对比 1440×1000 首屏可见表格行数与 390×844 根页面横向溢出。
- 用 Playwright 覆盖刷新、前进/后退、折叠后修改 URL、移动端 Filter Sheet 和焦点归还。
- 用 axe 或同等规则检查 `aria-expanded`、region 命名、错误关联和 44×44 命中区。

## 1. 问题与目标

### 1.1 输入图像的具体问题

- 图像是《Ink & Memory UI Design v2.1》封面，不含后台页头、筛选器或表格，不能据此复刻组件。
- 1489×2105 画布中标题集中在上半部，主体存在大面积空白；若直译到控制台会浪费首屏纵向空间。
- 封面给出的可用约束是暖白纸面、深棕文字、少面板、增加留白、轻纸面分区、单一虚线边界。
- 因此视觉方向可继承，后台信息密度必须以现有规范和真实组件为准。

### 1.2 当前实现的具体问题

- 两个共享组件的列表 Header 都使用 `px-4 py-5`，标题、说明、计数、创建动作独占约约 85–100px。
- 筛选表单默认常驻展开，再增加标签、44px 控件及 `p-4`，通常占用约 96–160px。
- 页面自身已有 H1/说明时，列表内 H2/说明再次陈述上下文，形成“双层标题”。
- `AdminResourceManager` 的筛选网格动作位于最后一格，字段数量变化时按钮位置跳动。
- `AdminResourceTable` 筛选仅保存在组件 state，刷新、分享链接和浏览器前进/后退会丢失。
- `AdminResourceManager` 已以 URL 驱动已应用值，但草稿与已应用值没有明显视觉区分。
- 当前没有收起入口；用户即使只想浏览表格，也必须持续承担整块 Query Bar 高度。
- Mobile 仍直接渲染网格筛选，复杂关系和日期筛选会把首屏表格推到屏外。

### 1.3 成功目标

- Desktop 默认在页面上下文清楚时，Header + 收起 Query Bar 总高控制在 76–112px。
- 1440×1000 首屏较当前至少多显示 1 行正常表格，且不压缩 44px 交互命中区。
- Mobile 首屏先看到标题、主动作、筛选摘要和表格主识别列；次要筛选进入 Filter Sheet。
- 所有筛选应用、清除、刷新、折叠、导航和回退均不丢状态、不伪造结果。

## 2. 页面模块结构（自上而下、自左至右）

| 编号 | 模块 | Desktop 结构 | Mobile 结构 | 功能定位 |
|---|---|---|---|---|
| H1 | 页面标题行 | 左：H1+短说明；右：来源/更新时间+唯一主动作 | 标题、元信息、主动作单列 | 页面级上下文 |
| H2 | 列表紧凑头 | 左：H2 或省略重复标题；右：结果数+刷新 | 标题截断；计数置于摘要行 | 资源级上下文 |
| Q1 | 常显查询行 | 关键词/精确 ID、筛选开关、已应用摘要 | 搜索、筛选按钮、徽标数 | 高频查询入口 |
| Q2 | 展开筛选区 | 关系、状态、日期、应用/清除 | Bottom Filter Sheet | 低频精确筛选 |
| S1 | 状态摘要 | 范围、总数、来源、时间窗、更新时间 | 两行内换行 | 查询反馈 |
| D1 | 数据区 | 唯一横滚表格壳 | 表语义保留、主列 sticky | 真实结果 |
| P1 | 分页区 | 页码、20/50/100、范围 | 上/下一页+范围 | URL 驱动分页 |

## 3. 共享与独立模块影响矩阵

| 业务模块 | 共享 Header/Query Bar | 独立保留项 | 默认策略 |
|---|---|---|---|
| Story 工作区/剧本/版本/章节/场景 | 标题、计数、关键词、关系筛选、折叠器 | 工作区关系、审核/发布状态、版本动作 | 关键词常显，关系/状态收起 |
| 用户 | 标题、计数、刷新、关键词 | email/精确 ID、订阅入口、异常关系提示 | 搜索常显，其余收起 |
| 订阅详情 | 页面 Header、状态摘要 | 当前套餐版本、周期、取消/恢复等生命周期动作 | 详情页不重复列表 H2 |
| 套餐/不可变版本 | 标题、筛选、计数 | 发布、关闭、创建新版本；已发布版本只读 | 状态筛选收起 |
| 权益/周期额度/余额 | 标题、关系筛选、时间窗 | micro-USD、Token、重置周期、覆盖来源 | 用户关系常显 |
| Gateway Key | 标题、状态筛选、计数 | 一次性明文回执、撤销/轮换、高风险说明 | Key prefix 搜索常显 |
| Gateway 请求/用量 | 标题、时间、关系、状态 | request ID、模型、Token、延迟、错误 | 时间与 request ID 常显 |
| 只追加账本 | 标题、关系、时间、计数 | 金额快照、事件类型；禁止编辑/删除 | 筛选收起但已应用摘要常显 |
| Provider/Model/Pricing | 标题、状态、刷新 | Secret 不回显、能力、价格版本、全屏编辑 | 列表紧凑，复杂编辑独立页 |
| Role/权限 | 标题、关键词、状态 | permission + record state 动作 | 搜索常显 |
| Storage/系统资源 | 标题、状态、刷新 | 健康、容量、只读事实 | 默认收起 |

## 4. 功能与状态需求

### 4.1 Header 密度

- 页面只有一个 H1；嵌套列表 H2 若与 H1 同义，则仅保留 `sr-only` 名称，不再重复说明。
- H1 Desktop 32px、Mobile 28px；列表 H2 Desktop 20px、Mobile 19px，均用本地 Serif 600。
- Header Desktop 建议 `py-3/py-4`，Mobile `p-4`；说明最多两行，超长内容提供完整可访问文本。
- 每个 Header 最多一个 Primary；刷新为 Secondary/Icon，清筛为 Tertiary，危险动作不得进入 Header 主位。
- 计数、金额、Token、时间使用本地 IBM Plex Mono 12px 与 tabular nums；不可用显示“暂不可用”。

### 4.2 收起态 `collapsed`

- Q1 常显关键词或精确 ID、`筛选`按钮、已应用条件数量、简短筛选摘要。
- `筛选`按钮含本地漏斗 SVG、文字和 `aria-expanded="false"`，不依赖颜色表达状态。
- 有已应用条件时显示最多 2 个摘要 chip，其余显示“+N”；chip 可逐项清除。
- 收起只隐藏 Q2，不清空草稿或已应用条件，不触发请求，不重置分页。

### 4.3 展开态 `expanded`

- Desktop Q2 在 Q1 下方以 solid border 分隔，不新增卡片或 shadow。
- 字段顺序：关键词补充项→主要关系→状态/枚举→日期/时间→应用→清除。
- Q2 打开后焦点进入首个次要筛选；关闭后焦点回到触发按钮。
- “应用”仅在草稿与已应用值不同时可用；提交后 page=1，区域可按用户原选择保持展开。

### 4.4 已应用态 `active`

- URL 中白名单筛选是已应用状态的唯一真相源；摘要、结果和空态均从 URL 派生。
- 显示“已应用 N 项”、结果范围和总数；不得把 `defaultFilters` 误计为用户筛选。
- Filter Empty 显示条件摘要与“清除筛选”；System Empty 解释真实无数据原因。
- 自动刷新不得覆盖 URL、选择、打开的 Drawer 或 Q2 展开状态。

### 4.5 草稿态 `draft`

- 输入变化只更新本地草稿，不立即改 URL，不请求列表；关键词若采用 debounce 必须在模块定义中显式声明。
- 草稿与 URL 不同时，显示“有未应用更改”；折叠后该提示仍可见。
- 点击清除：先清草稿并更新 URL，再请求 page=1；浏览器回退必须恢复此前已应用值。
- 外部 URL 变化时同步草稿与已应用值，避免旧草稿覆盖分享链接。

### 4.6 Mobile `390×844`

- Q1 保留搜索与 44×44 `筛选`按钮；次要筛选进入 bottom/full-height Filter Sheet。
- Sheet 使用实底、焦点锁、背景 inert；Escape、遮罩和关闭按钮可关闭并归焦。
- Sheet 内底部应用区 sticky，并避让 `env(safe-area-inset-bottom)`；不得遮住错误摘要。
- 关闭 Sheet 不丢草稿；“应用”更新 URL 后关闭，“取消”恢复打开前草稿快照。
- 根页面 `scrollWidth <= clientWidth`；只有表格壳与模块 Tabs 可局部横滚。

## 5. URL、查询与无状态丢失规则

- 统一支持 `q/page/pageSize/sort/order/tab/from/to` 与各资源白名单字段；未知参数不传 API。
- `AdminResourceTable` 应补齐 URL 同步能力，行为与 `AdminResourceManager` 收敛到共享 hook。
- 变更筛选将 page 归 1；变更 page/pageSize 不改筛选；排序不改草稿；清筛保留允许的 tab。
- URL 序列化省略空值和默认 page=1；日期由 UI 标时区，发往服务端为合法 UTC ISO。
- 关系筛选保存稳定 ID，不保存显示 label；重新打开时分页 hydration 出稳定 label。
- 请求竞态采用最后一次查询胜出或取消旧请求；加载时保留旧表格并标“正在同步”。
- 查询失败保留 URL、草稿、展开态和旧结果上下文，提供重试，不把失败显示成 0 条。
- 刷新、深链、复制链接、前进/后退后，筛选摘要、字段值、页码和结果必须一致。

## 6. 可访问性

- 筛选触发器使用 `button`、`aria-expanded`、`aria-controls`；Q2 使用具名 `region`。
- 所有输入有可见 label；帮助/错误通过 `aria-describedby` 关联；错误摘要使用 `role="alert"`。
- Enter 应用；Escape 关闭浮层；Tab 顺序与视觉顺序一致，不使用正 tabindex。
- Icon button 必须有 accessible name；所有命中区至少 44×44px；焦点环对暖纸背景清晰可见。
- 状态不能只靠颜色；展开/收起图标伴随文字，已应用数量对读屏可读。
- 表格保留 caption、`scope="col"`、`aria-sort`；横滚壳 `tabIndex=0` 且有明确名称。
- 动画只做 120–180ms 高度/透明度过渡，并遵循 `prefers-reduced-motion`。

## 7. 技术建议

- 提取 `AdminListHeader`、`AdminQueryBar`、`AppliedFilterSummary`、`MobileFilterSheet`。
- 提取 `useAdminListQueryState`，集中解析/校验/序列化 URL 和 draft/applied 转换。
- Filter definition 增加 `priority: "primary" | "secondary"`、摘要 formatter 与 URL key 白名单。
- 折叠偏好可按 resource 写入 sessionStorage；URL 不存纯视觉展开态，SSR 首屏默认收起。
- 使用 Tailwind 4 现有 token/class；字体与图标仅引用仓库本地资源，保持 `currentColor`。
- Route Handler 继续只做编排；筛选白名单、Zod 校验、SQL 与权限仍留在 `app/lib/**`。
- 不改变 PostgreSQL 单库、金额 micro-USD、价格快照、账本只追加与 Secret 不回显约束。

## 8. 验收标准

- [ ] 1440×1000 下共享列表默认收起 Q2，Header+Q1 不超过 112px，并至少多露出 1 行表格。
- [ ] 390×844 下标题、主动作、搜索、筛选数量均在首屏；根页面无横向滚动。
- [ ] 所有矩阵模块使用共享 Header/Query Bar，独立生命周期与高风险动作没有被抹平。
- [ ] 收起、展开、已应用、草稿、Mobile 五类状态均有视觉与读屏可辨识反馈。
- [ ] 收起/展开不会发请求、清值或重置 page；折叠后仍能看到已应用条件和未应用提示。
- [ ] 应用后 URL 与请求一致；刷新、深链、复制、前进/后退恢复同一筛选和页码。
- [ ] 清筛回到 page=1；默认系统筛选仍有效但不计入用户筛选数量。
- [ ] 查询错误保留状态并显示“暂不可用”；Filter Empty 与 System Empty 文案和动作不同。
- [ ] Mobile Filter Sheet 支持锁焦、Escape、遮罩/按钮关闭、焦点归还与 safe area。
- [ ] 全部控件至少 44×44px，键盘可完成应用/清除/分页，axe 无严重可访问性问题。
- [ ] 表格是唯一数据横滚壳；主识别列 sticky；列表未转成卡片，document 不横滚。
- [ ] 不加载 CDN、Google Fonts 或 Font Awesome；Tailwind 4、本地字体和本地图标通过构建。
- [ ] `AdminResourceTable` 与 `AdminResourceManager` 的 URL、草稿、已应用语义一致。
- [ ] focused unit/E2E 覆盖成功路径及无结果/400/500 至少一个失败路径。

## 9. 非目标

- 不在本专项重排表格列、详情 Drawer、编辑表单或高风险确认流程。
- 不改变服务端权限、PostgreSQL schema、计费算法、账本语义或 Secret 生命周期。
- 不依据品牌封面的空白比例制造大 Hero，不新增装饰卡片、统计假数据或自动展开筛选。
