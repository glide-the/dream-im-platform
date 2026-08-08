# Ink Memory Admin 字段级页面结构草图

> HTML Design Workflow / Stage 2 · Structure Sketch Designer  
> 基准视口：Desktop `1440×1000`；Mobile `390×844`  
> 结构来源：最新 Stage 1 字段级 PRD、`cc-switch-model-billing-adaptation.md` 与目标图。  
> 设计结论：沿用 cc-switch 的 Provider、Usage、Request Detail、Pricing **交互骨架**；用 Ink Memory 的资源层级、PostgreSQL 事实、RBAC、审计和暖纸视觉语义重写内容。

## 0. 图例与不可变约束

- `[S01]` 等为稳定区域 ID；同一 ID 在桌面与移动草图中的业务含义不变。
- `{真实值}`、`{服务器选项}`、`{真实聚合｜暂不可用}` 是运行时数据槽，不是示例指标。
- `┈` 是主纸面唯一虚线边界；纸内只用细实线、留白和文字层级，不堆叠卡片。
- `↔` 表示**局部**横向滚动；根页面始终 `scrollWidth <= clientWidth`。
- `▣ sticky` 表示在所属容器内固定；`⇣ scroll` 表示中段独立纵向滚动。
- 所有关系输入均写为“可搜索 Combobox”，选中具名记录后携带 ID；没有手填关系 ID 的控件。
- 列表选择真实行后先 `getOne`；表单只在打开时装载服务器初值，后台刷新不得覆盖脏草稿。
- Usage、Gateway Request、Ledger、Audit 是只读事实；Pricing 已生效版本不原地改写。

## 1. Desktop 1440×1000：全局 Shell 与资源列表

```text
┌──────────────────────────────────────────── [S01 暖纸画布 1440×1000] ────────────────────────────────────────────┐
│ ┌─────────────── [S02 Admin Sidebar 固定 248px] ───────────────┐┏┈┈┈┈┈┈ 主纸面 x≈280 / w≈1124 / 唯一虚线边界 ┈┈┈┈┈┓│
│ │ Ink Memory / Operations Console                             │┋┌──────────────────────────────┬────────────────────┐┋│
│ │                                                             │┋│ [S03 Topbar] 面包屑/资源上下文│ 数据源健康 / 管理员│┋│
│ │ Story Source                                                │┋└──────────────────────────────┴────────────────────┘┋│
│ │  ─ Workspace / Story / Character / Scene / Workflow Run     │┋┌────────────────────────────────────┬───────────────┐┋│
│ │ AI 模型中心                                                  │┋│ [S04 Page Heading]                  │ 主动作        │┋│
│ │  Provider / Model / Pricing / Model Permission              │┋│ Serif 标题 / 任务说明 / 数据边界     │ 创建/导出/命令│┋│
│ │ Token 计费                                                   │┋└────────────────────────────────────┴───────────────┘┋│
│ │  Usage / Billing Account / Ledger / Report                  │┋┌────────────────── [S05 Module Tabs ↔] ────────────┐┋│
│ │ Gateway                                                     │┋│ 工作区 / 剧本 / 角色 / 场景 / 工作流运行           │┋│
│ │  Request / Reconciliation / Key / Rate Limit                │┋└────────────────────────────────────────────────────┘┋│
│ │ 用户与权限                                                   │┋┌────────────────────────────────────────────────────┐┋│
│ │  Source User / Platform Identity / Admin User / Role        │┋│ [L01 关键词搜索] [L02 关系 Combobox×n]             │┋│
│ │ 系统                                                         │┋│ 名称/code/精确ID   用户/Workspace/Provider/Model…  │┋│
│ │  Storage / Setting / Audit                                  │┋├────────────────────────────────────────────────────┤┋│
│ │                                                             │┋│ [L03 状态/日期/枚举]               [L04 刷新/清筛] │┋│
│ │ 当前项：棕色字重 + 黄色短线；不整行深色填充                   │┋└────────────────────────────────────────────────────┘┋│
│ │                                                             │┋ [L05 Result Context] {范围} · {筛选摘要} · {来源}   ┋│
│ │                                                             │┋ 更新于 {真实时间}；聚合失败写“暂不可用”，不写 0     ┋│
│ │                                                             │┋┌──────────────────── [L06 Table Scroll Shell ↔] ───┐┋│
│ │                                                             │┋│ caption：{资源}/{时间窗}/{来源}                   │┋│
│ │                                                             │┋├───────────────┬────────────────┬───────────┬──────┤┋│
│ │                                                             │┋│[L07 主识别/关系]│[L08 状态/数值]│时间/来源   │[L09] │┋│
│ │                                                             │┋│名称+code/具名链接│单位/unknown    │本地时区    │查看⋯ │┋│
│ │                                                             │┋├───────────────┼────────────────┼───────────┼──────┤┋│
│ │                                                             │┋│{真实记录}      │{真实字段}       │{真实时间}  │44×44 │┋│
│ │                                                             │┋│{真实记录}      │{真实字段}       │{真实时间}  │44×44 │┋│
│ │                                                             │┋└───────────────┴────────────────┴───────────┴──────┘┋│
│ │                                                             │┋┌──────────────────── [L10 Pagination] ─────────────┐┋│
│ │                                                             │┋│ {结果范围}  20/50/100              ‹ 1 2 3 ›      │┋│
│ │ 管理员身份 / permission 摘要                                │┋└────────────────────────────────────────────────────┘┋│
│ └─────────────────────────────────────────────────────────────┘┋ [S06 Feedback / aria-live：不抢焦点、不遮主动作]   ┋│
│                                                                 ┗┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┛│
└───────────────────────────────────────────────────────────────────────────────────────────────────────────────────┘
```

桌面几何：`S02=248px`；主内容左右至少 `36px`；数据表只有 `L06` 横滚，`S03/S04/S05/L01–L05/L10` 均不进入横滚层。`S05` 仅在标签本身过宽时局部滚动。

## 2. Desktop：详情、简单表单与安全确认

### 2.1 从列表进入真实详情 Drawer

```text
背景保持：原 URL / 页码 / 排序 / L01–L05 筛选 / 当前行触发器
┌─────────────────────────────── 主页面（不可交互遮罩） ───────────────────────────────┬──────────────────────────────┐
│                                                                                     │ [D01 Drawer Header ▣ sticky] │
│                                                                                     │ 返回× / {名称} / {状态}      │
│                                                                                     │ ID Mono + Copy / 关联入口    │
│                                                                                     ├──────────────────────────────┤
│                                                                                     │ [D02 Identity & Base]        │
│                                                                                     │ 人类名称、code、类型、说明   │
│                                                                                     ├──────────────────────────────┤
│                                                                                     │ [D03 Relations]              │
│                                                                                     │ 具名父级/用户/资源链接       │
│                                                                                     ├──────────────────────────────┤
│                                                                                     │ [D04 State & Timeline]       │
│                                                                                     │ 状态解释 / 完整时间 / 版本   │
│                                                                                     ├──────────────────────────────┤
│                                                                                     │ [D05 Domain Projection]      │
│                                                                                     │ Story 层级 / Ledger 链路 /   │
│                                                                                     │ Workflow provenance / JSON只读│
│                                                                                     ├──────────────────────────────┤
│                                                                                     │ [D06 Risk & Audit]           │
│                                                                                     │ Secret脱敏 / before→after /  │
│                                                                                     │ Request ID / Audit link      │
│                                                                                     ├──────────────────────────────┤
│                                                                                     │ [D07 Drawer Footer ▣ sticky] │
│                                                                                     │ 关闭 / 编辑 / 领域命令       │
└─────────────────────────────────────────────────────────────────────────────────────┴──────────────────────────────┘
                                                                                 宽 720–840px；中段 ⇣ scroll
```

初始焦点落在 `D01` 标题；Tab 锁定。Escape 先关闭内层 Popover，再关闭 Drawer；关闭后焦点归还 `L09` 的原行“查看”按钮。Drawer 打开期间自动刷新可更新只读详情，但不得覆盖已打开编辑草稿。

### 2.2 简单 Modal / 右侧 Drawer

```text
┌──────────────────────────── [E01 Simple Form 容器：560–720px] ────────────────────────────┐
│ {创建/编辑的具名资源} · 服务器更新时间 · 关闭×                                              │
├──────────────────────────────────────────────────────────────────────────────────────────┤
│ [E02 Typed Fields]                                                                       │
│ Label *             [text / textarea / select / switch / datetime / integer              ]│
│                      说明 + 字段错误；null 与 0、空串语义分开                              │
│                                                                                           │
│ [E03 Relation Combobox]                                                                  │
│ Provider/Model/User/Role/Permission/Workspace/Story  [搜索具名记录… ▾]                    │
│ Loading / Empty / 403 / 分页；显示 name + code + 辅助 ID；禁止裸 ID 输入                  │
│                                                                                           │
│ [E04 Special Typed Area]                                                                 │
│ tags=标签输入；capabilities/scopes=复选；金额=USD 输入+micro-USD预览；真 JSON=Editor       │
│ Secret=password（仅本次输入可显隐，历史值不回填）                                         │
│                                                                                           │
│ [E05 Server Error Summary] 400首错 / 409最新值+冲突链接 / 503保留草稿重试                 │
├────────────────────────────── [E06 Footer ▣ sticky] ──────────────────────────────────────┤
│ [取消]                                                         [保存/创建/执行]           │
└──────────────────────────────────────────────────────────────────────────────────────────┘
             [E07 Dirty Guard] Escape / 返回 / 路由跳转 / 刷新 → “放弃未保存更改？”
```

`E01` 用于 Workspace 编辑、Story/Character/Scene 编辑、Model Permission、Gateway Key、Platform Identity、Admin User、System Setting、Storage 上传等；具体字段不得由值类型猜测，见第 10 节资源映射。

### 2.3 停用、撤销、归档、审核、调账确认

```text
┌────────────────────────────── [K01 Confirmation Modal] ───────────────────────────────┐
│ [K02 Current Context] {资源名/code/status/version/最近更新时间}                       │
├───────────────────────────────────────────────────────────────────────────────────────┤
│ [K03 Impact] {真实依赖数量/具名列表/不可逆说明｜暂不可计算}                           │
│ [K04 Before → After] 状态、余额、保留额、生效窗、权限差异（按命令显示）               │
│ [K05 Reason & Evidence] reason* / external ticket / idempotency key / role code确认   │
├──────────────────────────────── [K06 Command Footer] ─────────────────────────────────┤
│ [取消]                                                   [停用/撤销/归档/确认/拒绝]    │
└───────────────────────────────────────────────────────────────────────────────────────┘
```

提交前重新读取状态与影响；409 不盲写。Story reject 必填说明；Gateway Key revoke 展示 prefix/最近使用；余额调账展示 available/reserved before→after；Role 删除需输入 code；Provider/Model 停用显示依赖。命令成功进入 `Z09`，而不是直接消失。

## 3. Desktop：Provider 全屏设置（cc-switch 骨架，Ink Memory 数据）

```text
┌──────────────────────────── [P01 Provider Full-screen 1440×1000] ────────────────────────────┐
│ [P02 Header ▣ sticky]  ← 返回 Provider 列表  │ 新增/编辑 Provider │ 权限/保存状态/关闭            │
├──────────────────────────────────────────────────────────────────────────────────────────────┤
│                         内容 max-width 1120px；仅此中段 ⇣ scroll                              │
│ ┌──────────────────────────────── [P03 Preset & Protocol] ──────────────────────────────────┐ │
│ │ Provider 预设（只负责预填） / protocol [Anthropic|OpenAI]；编辑时 protocol 只读           │ │
│ └───────────────────────────────────────────────────────────────────────────────────────────┘ │
│ ┌────────────────────────────────── [P04 Basic Info] ───────────────────────────────────────┐ │
│ │ code（创建可填/编辑只读）│ name* │ status（启用需有效凭据）│ ID（服务器生成，只读）       │ │
│ └───────────────────────────────────────────────────────────────────────────────────────────┘ │
│ ┌────────────────────────────────── [P05 Credential] ───────────────────────────────────────┐ │
│ │ 已配置/未配置 + fingerprint │ 新 credential password │ 本次显隐 │ 轮换二次确认                │ │
│ │ 历史 Secret 不回填；空=不轮换；不进入 URL/localStorage/log/audit metadata                 │ │
│ └───────────────────────────────────────────────────────────────────────────────────────────┘ │
│ ┌────────────────────────────────── [P06 Endpoint] ─────────────────────────────────────────┐ │
│ │ base_url* [URL] │ 标准化后的最终 Endpoint 只读预览 │ 合法性/协议说明                     │ │
│ └───────────────────────────────────────────────────────────────────────────────────────────┘ │
│ ┌──────────────────────────────── [P07 Model Summary] ──────────────────────────────────────┐ │
│ │ 已关联 Model：display_name / code / enabled；[打开 Model Drawer]；不在此手填 model_id      │ │
│ └───────────────────────────────────────────────────────────────────────────────────────────┘ │
│ ┌────────────────────────────── [P08 Managed Runtime Config] ────────────────────────────────┐ │
│ │ timeout_ms 1000–900000 │ max_retries 0–5 │ authMode │ outputTokenParam（按协议显隐）      │ │
│ └───────────────────────────────────────────────────────────────────────────────────────────┘ │
│ ┌─────────────────────────────── [P09 Extension Config] ─────────────────────────────────────┐ │
│ │ 仅未知扩展键 JSON Editor；受管键剥离；Secret 风险键拒绝；格式化/diff/恢复服务器值          │ │
│ └───────────────────────────────────────────────────────────────────────────────────────────┘ │
│ [P10 Impact & Errors] enabled Models / 近期请求影响 / 400 / 403 / 409 code占用 / 503保留草稿 │
├──────────────────────────────── [P11 Footer ▣ sticky] ───────────────────────────────────────┤
│ [取消]                                                                  [保存 Provider]      │
└──────────────────────────────────────────────────────────────────────────────────────────────┘
```

`P02/P11` 固定、页面背景锁滚，焦点锁在 `P01`；打开时首焦点为标题或首错字段。返回、Escape、刷新、路由跳转均受 `E07` 未保存确认保护；关闭后回到 Provider 列表原触发器。

## 4. Desktop：Model Drawer 与 Pricing 新版本全屏

### 4.1 Model 680px Drawer

```text
┌────────────────────────────── [M01 Model Drawer 680px] ──────────────────────────────┐
│ [M02 Header ▣ sticky] 创建/编辑 Model · Provider 上下文 · 关闭×                     │
├──────────────────────────────────────────────────────────────────────────────────────┤
│ [M03 Provider Relation] 可搜索 Provider Combobox；编辑只读；从 Provider 发起时锁定  │
│ [M04 Identity] code（创建可填/编辑只读）/ upstream_model / display_name             │
│ [M05 Token Limits] context_window nullable int / max_output_tokens nullable int     │
│ [M06 Capabilities] Chat / Streaming / Tools 白名单复选；未知能力仅详情只读           │
│ [M07 Enabled & Impact] enabled switch；Provider inactive 时阻止并链接 Provider      │
│                       409 展示冲突 model；null 不转 0                                │
├────────────────────────────── [M08 Footer ▣ sticky] ─────────────────────────────────┤
│ [取消]                                                        [保存 Model]           │
└──────────────────────────────────────────────────────────────────────────────────────┘
```

### 4.2 Pricing “创建价格版本”全屏

```text
┌────────────────────────── [R01 Pricing Version Full-screen 1440×1000] ──────────────────────────┐
│ [R02 Header ▣ sticky] ← 返回 Pricing │ 创建价格版本（不是覆盖保存）│ 当前旧版本/权限             │
├─────────────────────────────────────────────────────────────────────────────────────────────────┤
│                              内容 max-width 1120px；中段 ⇣ scroll                                │
│ [R03 Model & Tier] 可搜索 Model Combobox（从 Model 发起则锁定）│ user_tier Combobox/code校验    │
├─────────────────────────────────────────────────────────────────────────────────────────────────┤
│ [R04 Four Token Prices]                                                                         │
│ Fresh input USD/1M + micro-USD预览 │ Output │ Cache read │ Cache write；均非负，最多6位小数     │
├─────────────────────────────────────────────────────────────────────────────────────────────────┤
│ [R05 Adjustment Formula] markup % + bps │ discount % + bps │ 只读计价顺序与精确公式              │
├─────────────────────────────────────────────────────────────────────────────────────────────────┤
│ [R06 Effective Window] effective_from │ effective_to/持续有效 │ 新版本 status                     │
├──────────────────────────────────────┬──────────────────────────────────────────────────────────┤
│ [R07 Old → New Diff]                 │ [R08 Conflict & Impact]                                  │
│ 四价/加价/折扣/时间窗逐项精确对比    │ 重叠版本链接；真实引用/差额/时间窗｜暂不可计算             │
│ 已开始/已引用旧版本金额不可编辑       │ 409 高亮冲突并保留草稿                                    │
├──────────────────────────────────────┴──────────────────────────────────────────────────────────┤
│ [R09 Footer ▣ sticky] [取消]                               [预览影响] [创建价格版本]            │
└─────────────────────────────────────────────────────────────────────────────────────────────────┘
```

服务端事务可结束旧 `effective_to` 并插入新记录；不提供定价删除和历史改价。成功回执列出新 Pricing ID、旧窗结束值、Request ID、Audit。

## 5. Desktop：Usage Dashboard（cc-switch 骨架）

```text
┌────────────────────────────────────── [U01 Usage Dashboard] ──────────────────────────────────────┐
│ [U02 Global Filters] Date Range + 时区 │ protocol │ Provider Combobox │ Model Combobox              │
│                      Platform User Combobox │ outcome │ refresh frequency │ 手动刷新                    │
│                      └─ 同时驱动下方全部区域；写 URL；自动刷新不改选择/不关详情                  │
├───────────────────────────────────────────────────────────────────────────────────────────────────┤
│ [U03 Fact Summary：单一平直汇总带，不拆 KPI 卡片]                                                 │
│ 请求数 {真实聚合｜暂不可用} │ 成功率 │ Fresh/Output/Cache read/Cache write │ Provider cost │ Charged │
│ 时间窗 / 来源 / 更新于；真正零记录可显示 0 + 空态说明，接口失败不得显示 0                           │
├────────────────────────────────────── [U04 Trend] ────────────────────────────────────────────────┤
│ Token / 成本趋势；真实点 + 时间粒度 + 更新时间；无聚合则显示“趋势暂不可用”，不前端拼全量          │
├───────────────────────────────────── [U05 Stats Tabs ↔] ──────────────────────────────────────────┤
│  [请求日志]                 [Provider 统计]                    [模型统计]                            │
├───────────────────────────────────────────────────────────────────────────────────────────────────┤
│ [U06 Request Log Table ↔]                                                                         │
│ Request ID │ 用户 │ requested→resolved Model │ protocol/outcome │ 四类Token │ cost/charged │ created │
│ unknown Token 显式写 unknown；点击真实行 → Q01；额外筛选 outcome/error code                         │
│                                                                                                   │
│ [U07 Provider Stats（选中页签时替换 U06）]                                                        │
│ Provider │ 请求/成功率 │ 四类Token │ cost/charged │ latency（仅真实聚合）│ 查看统计 Drawer              │
│                                                                                                   │
│ [U08 Model Stats（选中页签时替换 U06）]                                                           │
│ Model/Provider │ 请求/成功率 │ 四类Token │ cost/charged │ 时间窗 │ 查看统计 Drawer                │
├───────────────────────────────────────────────────────────────────────────────────────────────────┤
│ [U09 Result Meta & Pagination] {筛选摘要}/{数据源}/{更新时间}          20/50/100    ‹ 1 2 3 ›       │
└───────────────────────────────────────────────────────────────────────────────────────────────────┘
```

`U05` 只滚动标签；`U06–U08` 各自在表格壳局部横滚。筛选变化重置相应分页；自动刷新保持打开的 `Q01`，并显示“有较新版本”而不是覆盖用户正在核对的详情。

## 6. Desktop：Usage / Gateway Request Detail

```text
背景：U01–U09 筛选、页签、分页保持原样
┌──────────────────────────────────────────────┬──────────── [Q01 Wide Read-only Drawer 760–840px] ─────────────┐
│ Usage Dashboard（遮罩）                      │ [Q02 Header ▣ sticky] Request ID + Copy / outcome / 关闭×       │
│                                              ├─────────────────────────────────────────────────────────────────┤
│                                              │ [Q03 Identity & User/Key] upstream ID / Platform User / Key prefix│
│                                              │ Key hash/明文不显示                                             │
│                                              ├─────────────────────────────────────────────────────────────────┤
│                                              │ [Q04 Routing] protocol / requested→resolved Model / Provider /    │
│                                              │ Pricing Rule 链接与解析说明                                      │
│                                              ├─────────────────────────────────────────────────────────────────┤
│                                              │ [Q05 Token Semantics] estimated + fresh input/output/cache R/W   │
│                                              │ 每项独立整数；unknown 不按 0                                     │
│                                              ├─────────────────────────────────────────────────────────────────┤
│                                              │ [Q06 Price Snapshot & Cost] 四项快照 / markup/discount / reserved │
│                                              │ provider cost / charged / 差额，精确 micro-USD                    │
│                                              ├─────────────────────────────────────────────────────────────────┤
│                                              │ [Q07 Settlement & Ledger] settled 状态 / Ledger 时间线与链接      │
│                                              ├─────────────────────────────────────────────────────────────────┤
│                                              │ [Q08 Performance & Timeline] streaming / first token / latency /  │
│                                              │ created→started→completed→settled                                │
│                                              ├─────────────────────────────────────────────────────────────────┤
│                                              │ [Q09 Error & Safe Summary] http/error code / 脱敏 message /       │
│                                              │ response_summary 只读 JSON Viewer；无 Prompt/Response 正文        │
└──────────────────────────────────────────────┴─────────────────────────────────────────────────────────────────┘
```

Drawer 中段独立纵滚，Header 固定；只读，没有“编辑 Request/Ledger”按钮。`settlement_failed` 且有 `billing.adjust` 时仅提供“前往 Reconciliation”链接。

## 7. Desktop：Reconciliation、权限矩阵与 Storage

### 7.1 Reconciliation 独立命令页

```text
┌────────────────────────────── [C01 Reconciliation Page 1440×1000] ──────────────────────────────┐
│ [C02 Header ▣ sticky] ← settlement_failed 队列 │ Request ID只读 │ 第 {当前步骤}/3 │ 权限/关闭    │
├─────────────────────────────────────────────────────────────────────────────────────────────────┤
│ [C03 Frozen Context] User / Provider / requested→resolved Model / status+version / reserved     │
│                      已知Token（unknown显式）/ pricing snapshot / error / 最近更新时间           │
│                      503 时仅可重试，不进入填写态；Request ID 不手填                             │
├─────────────────────────────────────────────────────────────────────────────────────────────────┤
│ [C04 Disposition] ( ) settle 捕获并结算   ( ) release 释放冻结；固定枚举                          │
│ [C05 Actual Tokens] settle 时：fresh input / output / cache read / cache write 非负整数           │
│                      unknown 不预填 0；由命令契约决定必填                                        │
│ [C06 Release Evidence] release 时：证据 textarea* / external ticket*                             │
│ [C07 Reason & Idempotency] reason 8–500* / idempotency_key 8–128*                                │
├─────────────────────────────────────────────────────────────────────────────────────────────────┤
│ [C08 Impact Preview] available/reserved before→after │ release/capture │ charged │ Ledger type   │
│                      数据变化返回 409；刷新预览但保留输入，需再次确认                              │
├──────────────────────────────── [C09 Footer ▣ sticky] ────────────────────────────────────────────┤
│ [返回队列]                                [上一步] [刷新影响] [提交处置] → 不可变 Receipt          │
└─────────────────────────────────────────────────────────────────────────────────────────────────┘
```

提交成功后主体切换为 `Z09`：Request、Ledger、Audit、金额、时间、request ID，只读且不可再次编辑。

### 7.2 Admin Role 独立权限矩阵

```text
┌─────────────────────────────── [X01 Role Page 1440×1000] ────────────────────────────────┐
│ [X02 Header ▣ sticky] ← Roles │ 创建/编辑 Role │ 内置状态 │ 未保存状态/关闭               │
├───────────────────────────────────────────────────────────────────────────────────────────┤
│ [X03 Identity] code（创建可填/编辑只读）│ name │ description                           │
├──────────────────────────┬────────────────────────────────────────────────────────────────┤
│ [X04 Domain Navigator]   │ [X05 Permission Matrix ↔/⇣]                                   │
│ Story                    │ 权限 code(Mono) │ name/description │ [查看] [授予]                │
│ Models / Billing         │ 按域分组；全组选/清；真实 Permission API；1–100               │
│ Gateway / Users          │ 内置 super_admin 权限只读/受限                                │
│ Access / System / Audit  │                                                               │
├──────────────────────────┴────────────────────────────────────────────────────────────────┤
│ [X06 Impact & Diff] 新增/移除权限 │ 受影响管理员真实数量与具名列表｜暂不可计算             │
├──────────────────────────────── [X07 Footer ▣ sticky] ────────────────────────────────────┤
│ [取消]                                                        [保存 Role]                 │
└───────────────────────────────────────────────────────────────────────────────────────────┘
```

删除 Role 不在本页常驻；仅自定义且无管理员关联时进入 `K01–K06`，要求输入 role code。Admin User 角色编辑使用 `E03` 多选并在保存前显示差异；禁止停用最后 active super_admin。

### 7.3 Storage 能力页

```text
┌────────────────────────────────── [T01 Storage Page] ────────────────────────────────────┐
│ [T02 Driver Health] driver / config health / request ID / 刷新；不显示凭据               │
│ [T03 Capability & Prefix] direct upload 支持/原因 │ prefix rule Mono；无假目录树         │
├───────────────────────────────────────────────────────────────────────────────────────────┤
│ [T04 Upload] file input/键盘可达拖放 │ 文件名/类型/大小 │ 服务端限制说明                    │
│ [T05 Progress & Receipt] 进度/取消（若API支持）│ 成功后的真实 key/etag/size/metadata   │
├───────────────────────────────────────────────────────────────────────────────────────────┤
│ [T06 Known-key Check] 已知 key text │ 检查 exists/metadata │ download（能力允许时）            │
│ [T07 Metadata Result] 定义列表 / 只读 JSON Viewer；明确“诊断，不是 list”                  │
└───────────────────────────────────────────────────────────────────────────────────────────┘
```

Storage 没有 list/count/delete 控件。上传可用 `E01` Drawer；失败保留选中文件信息和安全 Request ID。

## 8. Mobile 390×844：全局 Shell、列表与覆盖层

### 8.1 Shell 与资源列表

```text
┌──────────────────── [S01 390×844；根节点无横向溢出] ────────────────────┐
│┏┈┈┈┈┈┈┈┈┈ 主纸面：内边距 16px / 唯一虚线边界 ┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┓│
│┋┌─────── [S03 Topbar 52px] ──────────────────────────────────────┐┋│
│┋│ [菜单☰]  {页名/紧凑面包屑}            {高优先动作/管理员}     │┋│
│┋└────────────────────────────────────────────────────────────────┘┋│
│┋ [S04 Heading] Serif 28px 标题                                   ┋│
│┋ 任务说明 / 数据边界 / 更新时间                                  ┋│
│┋┌──────────────────── [S05 Tabs ↔] ──────────────────────────────┐┋│
│┋│ Workspace  Story  Character  Scene  Workflow…                 │┋│
│┋└────────────────────────────────────────────────────────────────┘┋│
│┋ [L01 搜索常显] [名称/code/精确 ID                          ]     ┋│
│┋ [L02+L03 Filter Sheet触发] 筛选（{启用数}） [L04 刷新/清除]      ┋│
│┋ [L05 Context] {范围/筛选摘要}                                  ┋│
│┋               {来源/真实更新时间/暂不可用}                      ┋│
│┋┌──────────────────── [L06 Table Shell ↔] ───────────────────────┐┋│
│┋│[L07 名称/具名关系]│[L08 状态/关键值/时间]│[L09 ⋯ 44×44]       │┋│
│┋│{真实记录}          │{单位/unknown}            │查看/领域命令    │┋│
│┋│{真实记录}          │{单位/unknown}            │查看/领域命令    │┋│
│┋└────────────────────────────────────────────────────────────────┘┋│
│┋ ← 仅 L06 横滚；次要字段进入 D01，不复制为假摘要 →               ┋│
│┋┌──────────────────── [L10 Pagination] ──────────────────────────┐┋│
│┋│ {范围}  每页20                         [‹] [›]（≥44px）        │┋│
│┋└────────────────────────────────────────────────────────────────┘┋│
│┋ [S06 Feedback：safe-area 上方 / aria-live / 不抢焦点]           ┋│
│┗┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┛│
└───────────────────────────────────────────────────────────────────┘
```

`S02` 在移动端为左 Drawer：`width=min(320px,88vw)`，含与桌面一致的分组导航；打开锁焦，Escape/遮罩关闭，焦点归还 Topbar 菜单按钮。`L02+L03` 为底部 Filter Sheet：关系 Combobox、状态、日期逐项单列，Sheet 可纵滚且不改变根宽度。

### 8.2 Detail / Simple Form / Model / Request 的全屏变体

```text
┌──────────────────── 390×844 覆盖层（D01 / E01 / M01 / Q01 共用容器规则） ───────────────────┐
│ [D01|E01|M02|Q02 Header ▣ sticky] ←返回 / 标题 / 状态 / 关闭                              │
├─────────────────────────────────────────────────────────────────────────────────────────────┤
│ 中段 ⇣ 独立纵滚；左右 16px；长 ID/URL 换行或截断；无页面横滚                              │
│ Detail：D02 → D03 → D04 → D05 → D06                                                       │
│ Simple：E02 → E03 → E04 → E05                                                             │
│ Model：M03 → M04 → M05 → M06 → M07                                                        │
│ Request：Q03 → Q04 → Q05 → Q06 → Q07 → Q08 → Q09                                          │
│ 每段由细实线分隔，不转成卡片；关系选择结果显示名称，ID仅辅助复制                           │
├──────────────── [D07|E06|M08 Footer ▣ sticky + safe-area-inset-bottom] ────────────────────┤
│ 取消/关闭                                                保存/领域命令（只读Q01无保存）    │
└─────────────────────────────────────────────────────────────────────────────────────────────┘
```

最后字段下预留至少 `96px`。`K01` 在移动端为全屏确认或不裁剪说明的底部 Sheet，顺序固定为 `K02→K03→K04→K05→K06`；所有按钮 `≥44×44`。

## 9. Mobile：复杂页面单列重排

### 9.1 Provider 全屏

```text
┌────────────────────── [P01 Provider 390×844] ──────────────────────┐
│ [P02 Header ▣] ← Provider / 新增或编辑 / 未保存标记               │
├─────────────────────────────────────────────────────────────────────┤
│ ⇣ scroll                                                           │
│ [P03] 预设 → 协议                                                   │
│ [P04] code → name → status                                         │
│ [P05] 凭据状态 → 本次 password → 显隐/轮换说明                     │
│ [P06] base_url → 最终 Endpoint 预览                                │
│ [P07] 关联 Model 摘要 → 打开 M01                                   │
│ [P08] timeout → retries → authMode → outputTokenParam              │
│ [P09] 扩展 JSON → schema错误 → diff/恢复                           │
│ [P10] 影响/冲突/权限/数据源错误                                    │
│ 最后字段下 ≥96px                                                    │
├────────────────────── [P11 Footer ▣ safe-area] ────────────────────┤
│ [取消]                                              [保存 Provider]│
└─────────────────────────────────────────────────────────────────────┘
```

### 9.2 Pricing 全屏

```text
┌────────────────── [R01 Pricing Version 390×844] ───────────────────┐
│ [R02 Header ▣] ← Pricing / 创建价格版本                            │
├─────────────────────────────────────────────────────────────────────┤
│ ⇣ scroll                                                           │
│ [R03] Model Combobox → Tier                                        │
│ [R04] Fresh input → Output → Cache read → Cache write              │
│       每项 USD/1M 输入 + 精确 micro-USD 预览                        │
│ [R05] markup → discount → 公式                                     │
│ [R06] from → to/持续有效 → status                                  │
│ [R07] 旧→新逐项 diff                                               │
│ [R08] 重叠冲突 / 真实影响 / 409恢复                                │
│ 最后字段下 ≥96px                                                    │
├────────────────────── [R09 Footer ▣ safe-area] ────────────────────┤
│ [取消]                              [预览] [创建价格版本]           │
└─────────────────────────────────────────────────────────────────────┘
```

### 9.3 Usage Dashboard 与 Request Detail

```text
┌────────────────────── [U01 Usage 390×844] ─────────────────────────┐
│ [U02] 时间范围常显 / “更多筛选”Sheet / 刷新频率                    │
│        protocol / Provider / Model / User / outcome 在 Sheet 单列  │
├─────────────────────────────────────────────────────────────────────┤
│ [U03] 平直事实摘要，可换行：请求/成功率/四Token/cost/charged       │
│       {真实聚合｜暂不可用} + 时间窗/来源/更新时间                   │
├─────────────────────────────────────────────────────────────────────┤
│ [U04] 趋势：可横向平移图内数据，不扩大页面                         │
├──────────────────── [U05 Tabs ↔] ──────────────────────────────────┤
│ 请求日志 │ Provider统计 │ 模型统计                                 │
├─────────────────────────────────────────────────────────────────────┤
│ [U06|U07|U08 表格壳 ↔] 主识别 / 关键值 / 时间 / 行详情             │
├─────────────────────────────────────────────────────────────────────┤
│ [U09] 范围/更新时间 / 上一页 / 下一页                              │
└─────────────────────────────────────────────────────────────────────┘

点击 U06 真实行 → Q01 全屏；返回后恢复 U02 筛选、U05 页签与 U09 页码。
```

### 9.4 Reconciliation、Role 与 Storage

```text
Reconciliation：
┌──────────────────── [C01 390×844] ─────────────────────┐
│ [C02 Header ▣] ← 队列 / 步骤 / Request ID只读         │
├─────────────────────────────────────────────────────────┤
│ ⇣ [C03] 冻结上下文                                      │
│   [C04] disposition                                     │
│   [C05] settle 四Token                                  │
│   [C06] release evidence                                │
│   [C07] reason / idempotency                            │
│   [C08] before→after 影响                               │
├──────────────── [C09 Footer ▣ safe-area] ───────────────┤
│ 返回 / 上一步 / 刷新影响 / 提交                         │
└─────────────────────────────────────────────────────────┘

Role：
┌──────────────────── [X01 390×844] ─────────────────────┐
│ [X02 Header ▣] ← Role / 未保存状态                      │
├─────────────────────────────────────────────────────────┤
│ [X03] code/name/description                             │
│ [X04] 域选择器 ↔                                        │
│ [X05] 当前域权限逐行 checkbox；code/说明完整可读        │
│ [X06] 权限 diff / 受影响管理员                          │
├──────────────── [X07 Footer ▣ safe-area] ───────────────┤
│ 取消 / 保存                                             │
└─────────────────────────────────────────────────────────┘

Storage：
┌──────────────────── [T01 390×844] ─────────────────────┐
│ [T02] Driver health                                    │
│ [T03] Capability / prefix                              │
│ [T04] Upload                                           │
│ [T05] Progress / receipt                               │
│ [T06] Known-key check                                  │
│ [T07] Metadata（只读；不是 list）                      │
└─────────────────────────────────────────────────────────┘
```

## 10. 资源级字段落位与容器索引

此表把字段级 PRD 映射到上述结构，防止后续阶段退化为“通用 CRUD 工作台”。“关系”均为 `E03` 或对应专用 Combobox；列表中的 ID 是查看/复制字段，不是写入口。

| 资源 | 列表 / 筛选落位 | 详情落位 | 写入容器与字段 | 专用动作 / 禁止项 |
|---|---|---|---|---|
| Source User | L07 email/display name/ID；role、日期筛选 | D02 id/email/name/avatar/role；D03 Workspace/Story/计费身份；D04 时间 | 无编辑；Platform Identity 从当前记录进入 E01，source/external user 锁定 | 不显示 password hash；Story source 503 无回退 |
| Workspace | L07 name/owner；L08 时间 | D02 id/name/settings状态；D03 owner；D05 Story/Character/Scene真实聚合 | E01：name text、settings 真 JSON Editor；owner只读 | 聚合失败“不可用”不写0；无创建/删除/停用 |
| Story | L07 title/id/workspace/author；L08 type/status/review/time | D02 description/content只读；D03 Workspace/Author/Character+role_type/ordered Scene；D04 状态时间线；D05 Workflow/Agent provenance | 720px E01：title、description、type；关系只读 | K01 confirm/reject/archive；content 无编辑；reject说明必填 |
| Character | L07 name/id/workspace；L08 status/review/count/time | D02 avatar/identity/personality/background/catchphrase/tags/notes；D03 Story+role_type/Scene | 720px E01：name、avatar URL、三段 textarea、catchphrase、tags标签输入 | K01 confirm/reject/archive；tags不使用JSON |
| Scene | L07 name/id/Story/Workspace；L08 order/status/review/time | D02 description/order；D03 Story/Author/Workspace/角色/上一下一场 | 720px E01：name、description、Story Combobox可清空、order非负整数 | 同租户候选；K01审核/归档；story_id可空但不可手填 |
| Workflow Run | L07 id/Workspace；L08 status/error/created | D02 plugin/version/definition；D03 retry/Agent/message；D04全时间线；D05 snapshot/hash/fingerprint/transitions/四Token | 无表单 | 无 PostgreSQL 命令适配器时不显示 retry/cancel 假按钮 |
| Provider | L07 name/code/Endpoint；L08 protocol/status/credential/Models/health | D02–D06；字段详见 P03–P10 | P01–P11 全屏 | K01停用/轮换确认；Secret不回填；协议变更需新建 |
| Model | L07 display_name/code/Provider；L08 enabled/context/output | D02身份与能力；D03 Provider/Pricing/Permissions；D04时间 | M01–M08 | K01启停；Provider inactive冲突跳转；能力非JSON |
| Pricing Rule | L07 Model/tier/id；L08四价/markup/discount/status/window | D02精确值；D03 Model/引用Request；D04生效历史；D06审计 | R01–R09 只创建版本 | 已生效/被引用记录不改价、不删；结束/停用走K01 |
| Model Permission | L07 Platform User/Model；L08 enabled/限额/time | D02限额；D03 User/Model | 640px E01：User+Model Combobox（编辑锁定）、enabled、nullable整数限额 | 删除 override 用K01，语义为恢复默认，不删User/Model |
| Usage | U06字段 | Q01–Q09 | 无写入 | unknown Token不按0；只读 |
| Billing Account | L07用户/tier；L08 available/reserved/lifetime/version | D02货币与精确余额；D03 User/Ledger；D04版本时间 | K01高风险调账：仅真实已实现type、USD+micro预览、reason/idempotency/ticket | 行锁+版本409；不直接编辑reserved/lifetime |
| Ledger | L07 id/type/User/Request；L08 amount/before→after/time | D02金额方向；D03 Account/Request；D05幂等/描述/脱敏metadata | 无 update/delete | 纠错进入新 reversal/adjustment 命令，原Ledger ID只读引用 |
| Billing Report | L02 User/Provider/Model；L03日期/status | D1式平表：请求/四Token/cost/charged/diff/分日 | 无表单；当前筛选导出CSV | 不用装饰图表；导出无Secret/正文/Prompt/Response |
| Gateway Request | U06或L07 request/user/model；L08 outcome/token/charged/time | Q01–Q09 | 无编辑 | settlement_failed 只可进入 C01；Request/Ledger只读 |
| Reconciliation | 从 settlement_failed 真实行进入 | C03冻结上下文 | C01–C09 | 不手填Request ID；成功不可编辑回执 |
| Gateway Key | L07 name/User/prefix；L08 scopes/status/times | D02脱敏信息；D03 User | 640px E01：User Combobox、name、scope复选、expires datetime | 创建成功Z09明文仅一次；K01 revoke，无硬删 |
| Rate Limit Window | L07 User/Model；L08 window/count/time | D02窗口计数；D03 User/Model | 无编辑 | 修改策略跳 Model Permission，并保留具名上下文 |
| Platform Identity | L07 email/name/source/tier；L08 status/limits/time | D02 metadata JSON只读；D03 Source User/Account/Usage/Key/Ledger | 680px E01：Source User Combobox或锁定、展示覆盖、tier、status、nullable限额、metadata真JSON | 不创建/改写业务源用户；停用K01 |
| Admin User | L07 email/name/roles；L08 status/last login | D02身份；D03角色；D04时间 | 640px E01：email创建后只读、name、创建password、Role多选 | 密码重置/停用K01；最后active super_admin 409 |
| Admin Role | L07 code/name；L08内置/权限/管理员数 | D02说明；D03权限/管理员 | X01–X07 | 自定义无关联才可K01删除；内置角色无删除入口 |
| Admin Permission | L07 code/name；L08 domain/time | D02说明；D03使用Role真实投影 | 无编辑 | 只读 |
| System Setting | L07 category/key；L08 secret/status/time | D02描述/非Secret JSON；D06 Secret仅已配置 | 640px E01：category/key创建后只读、value真JSON、is_secret创建后只读、status | Secret覆盖K01；旧值不进diff；无DELETE |
| Audit Log | L07 actor/action/resource/request ID；L08 time/IP | D02动作；D03资源链接；D05脱敏before/after/metadata | 无编辑 | append-only；剥离Secret/password/Key/Token/正文 |
| Storage | 非资源列表；T02–T07 | T07结果 | T04上传 / T06已知key诊断 | 无list/count/delete/假目录树 |

## 11. 模块编号索引

### 11.1 Shell、列表、详情、简单表单、确认

| ID | 模块 | 结构职责 | 响应 / 滚动 / 焦点 |
|---|---|---|---|
| S01 | 暖纸画布 | 全局应用背景与唯一主纸面 | 根节点无横溢；Desktop包围Sidebar，Mobile贴近视口 |
| S02 | Admin Sidebar | Ink Memory 分组路由与权限裁剪 | Desktop 248px固定；Mobile左Drawer锁焦并归还菜单按钮 |
| S03 | Topbar | 面包屑、数据源健康、管理员入口 | Mobile 52px；状态不只靠颜色 |
| S04 | Page Heading | 任务标题、说明、来源、主动作 | 标题与动作可换行；无Hero/KPI |
| S05 | Module Tabs | 同域平级资源切换 | 标签自身局部横滚，不带动页面 |
| S06 | Feedback / live region | 后台刷新、成功和错误播报 | 不抢焦点；Mobile位于safe-area固定动作上方 |
| L01 | 关键词搜索 | name/code/允许的精确ID查询 | URL同步；Mobile常显 |
| L02 | 关系筛选 | User/Workspace/Provider/Model等真实选项 | Desktop横排；Mobile进入Filter Sheet |
| L03 | 状态/枚举/日期筛选 | 白名单状态与UTC边界 | Mobile进入Filter Sheet |
| L04 | 列表动作 | 刷新、清筛、允许时创建/导出 | 自动刷新不覆盖选择 |
| L05 | 结果上下文 | 范围、筛选、来源、时间 | 数据源失败不伪装为0 |
| L06 | 表格局部滚动壳 | 原生table/caption/th/aria-sort | 唯一列表横滚区，可键盘聚焦 |
| L07 | 主识别与关系列 | 名称、code、具名资源链接 | Mobile优先保留，必要时sticky实底 |
| L08 | 状态/数值/时间列 | 单位、unknown、状态文字 | 次要字段可进入详情，不丢语义 |
| L09 | 行动作 | 查看、允许的领域动作 | ≥44px；permission+状态共同决定 |
| L10 | 分页 | 范围、页容量、页码 | 位于L06外；更新URL与焦点 |
| D01 | Detail Drawer框架/Header | 真实记录身份与关闭 | Desktop 720–840px；Mobile全屏；锁焦/归焦L09 |
| D02 | 身份与基础资料 | 字段定义列表 | 长值换行/复制，不扩根宽 |
| D03 | 关系 | 具名链接与层级 | 白名单query返回原上下文 |
| D04 | 状态与时间线 | 状态、版本、完整时间 | 中段纵滚 |
| D05 | 领域投影 | Story/Workflow/Ledger/安全JSON | 不用可编辑JSON代替关系 |
| D06 | 风险与审计 | 脱敏、diff、Request/Audit | Secret永不回显 |
| D07 | Detail Footer | 关闭、编辑、领域命令 | 容器内sticky；Mobile safe-area |
| E01 | Simple Form容器 | Modal或Drawer | Desktop 560–720px；Mobile全屏；锁焦 |
| E02 | 类型化字段 | text/textarea/select/switch/date/int | 字段schema明确，不按值猜控件 |
| E03 | 关系Combobox | 真实分页options | loading/empty/403；禁止裸ID |
| E04 | 特殊类型区 | tags/checkbox/money/JSON/Secret | 仅真JSON用Editor；Secret仅本次显隐 |
| E05 | 服务端错误摘要 | 400/409/503 | 聚焦首错；冲突不覆盖草稿 |
| E06 | Simple Form Footer | 取消与提交 | sticky；Mobile safe-area，末字段留96px |
| E07 | 未保存确认 | 拦截关闭/返回/刷新/跳转 | 内层Escape优先；确认后归还原触发器 |
| K01 | 安全确认容器 | 高风险命令Modal/Sheet | 重取状态；Mobile全屏或不裁剪Sheet |
| K02 | 当前上下文 | 资源、状态、版本、时间 | 只读 |
| K03 | 真实影响 | 依赖、权限、不可逆说明 | 无聚合写“暂不可计算” |
| K04 | Before→After | 状态、余额、时间窗、权限diff | 精确单位与语义 |
| K05 | 理由与证据 | reason/ticket/idempotency/code确认 | 按领域严格必填 |
| K06 | 命令Footer | 取消与具名领域命令 | 防重复提交；成功进入Z09 |

### 11.2 Provider、Model、Pricing

| ID | 模块 | 字段 / 职责 | 固定与响应 |
|---|---|---|---|
| P01 | Provider全屏框架 | cc-switch分区骨架、Ink数据语义 | Desktop全屏/内容1120；Mobile全屏 |
| P02 | Provider Header | 返回、标题、权限、保存状态 | sticky；锁焦/归焦 |
| P03 | 预设与协议 | preset、Anthropic/OpenAI | 预设只预填；编辑协议只读 |
| P04 | 基础信息 | id/code/name/status | code编辑只读 |
| P05 | 凭据 | configured/fingerprint/password/轮换 | 历史Secret不回填 |
| P06 | Endpoint | base_url、最终URL预览 | 结构化URL字段 |
| P07 | Model摘要 | 关联Model与M01入口 | 不手填关系ID |
| P08 | 受管运行配置 | timeout/retries/authMode/outputTokenParam | 结构化控件 |
| P09 | 扩展配置 | 未知扩展JSON、diff、恢复 | 受管/Secret键拒绝 |
| P10 | 影响与错误 | Model/近期请求、400/403/409/503 | 真实查询或暂不可用 |
| P11 | Provider Footer | 取消、保存 | sticky + Mobile safe-area |
| M01 | Model Drawer框架 | 创建/编辑Model | Desktop 680px；Mobile全屏 |
| M02 | Model Header | Provider上下文、关闭 | sticky |
| M03 | Provider关系 | Provider Combobox/锁定 | 真实options |
| M04 | Model身份 | code/upstream/display name | 编辑code只读 |
| M05 | Token上限 | context/output nullable int | null不转0 |
| M06 | Capabilities | 白名单复选 | 不用JSON |
| M07 | 启用与影响 | enabled、Provider依赖、409 | 具名跳转 |
| M08 | Model Footer | 取消、保存 | sticky + safe-area |
| R01 | Pricing全屏框架 | 只创建价格版本 | Desktop/Mobile全屏 |
| R02 | Pricing Header | 返回、旧版本、权限 | sticky |
| R03 | Model与Tier | 真实Combobox | 从Model发起可锁定 |
| R04 | 四类Token价格 | USD/1M输入+micro预览 | 精确整数提交 |
| R05 | 调整公式 | markup/discount/bps/顺序 | 不用JS浮点账务 |
| R06 | 生效窗 | from/to/status | 重叠409 |
| R07 | 旧新对比 | 四价/调整/时间窗diff | 已生效旧价只读 |
| R08 | 冲突与影响 | 版本链接、引用、差额 | 无真实聚合则暂不可计算 |
| R09 | Pricing Footer | 取消、预览、创建版本 | sticky + safe-area |

### 11.3 Usage 与 Request Detail

| ID | 模块 | 字段 / 职责 | 滚动 / 状态 |
|---|---|---|---|
| U01 | Usage Dashboard框架 | cc-switch Usage骨架 | 单一主纵滚 |
| U02 | 全局筛选 | 日期/时区/protocol/Provider/Model/User/outcome/refresh | 同时驱动全部区域；Mobile Sheet |
| U03 | 事实摘要 | 请求/成功率/四Token/cost/charged | 单一平直汇总带；无假指标 |
| U04 | 趋势 | Token/成本真实时间点 | 图内交互不扩大根宽 |
| U05 | 三统计页签 | 请求日志/Provider/模型 | 标签局部横滚 |
| U06 | 请求日志 | request/user/model/outcome/tokens/cost/time | 表格局部横滚；行开Q01 |
| U07 | Provider统计 | Provider事实聚合 | 替换U06；可开统计Drawer |
| U08 | 模型统计 | Model/Provider事实聚合 | 替换U06；可开统计Drawer |
| U09 | 结果元信息 | 时间窗/来源/更新/分页 | 不随表格横滚 |
| Q01 | Request Detail Drawer | Usage/Gateway共享只读详情 | Desktop宽Drawer；Mobile全屏 |
| Q02 | Request Header | request ID/outcome/关闭 | sticky、归还U06行 |
| Q03 | 身份/用户/Key | upstream/User/key prefix | 无Key明文/hash |
| Q04 | 路由 | protocol/requested→resolved/Provider/Pricing | 具名关系链接 |
| Q05 | Token语义 | estimated+四类实际Token | unknown不按0 |
| Q06 | 快照与成本 | 四价/markup/discount/reserved/cost/charged | micro-USD精确事实 |
| Q07 | 结算与Ledger | 状态/条目时间线 | append-only链接 |
| Q08 | 性能与时间线 | streaming/first token/latency/lifecycle | tabular nums |
| Q09 | 错误与安全摘要 | code/message/response_summary | 脱敏只读JSON，无正文 |

### 11.4 Reconciliation、权限与 Storage

| ID | 模块 | 字段 / 职责 | 安全 / 响应 |
|---|---|---|---|
| C01 | Reconciliation框架 | settlement_failed独立命令页 | Desktop/Mobile全屏 |
| C02 | Reconciliation Header | 返回队列/步骤/Request ID | sticky；ID只读 |
| C03 | 冻结上下文 | User/Provider/Model/version/reserved/tokens/snapshot/error | 503仅重试 |
| C04 | disposition | settle/release radio | 固定枚举 |
| C05 | 实际Token | settle四类非负整数 | unknown不默认0 |
| C06 | release证据 | evidence/ticket | release时必填 |
| C07 | 理由/幂等 | reason/idempotency | 网络未知按key查询 |
| C08 | 影响预览 | 余额/冻结/charged/Ledger before→after | 409刷新后重确认 |
| C09 | Reconciliation Footer | 返回/上步/刷新/提交 | sticky + safe-area；成功Z09 |
| X01 | Role页框架 | 独立权限治理页 | Desktop/Mobile全屏 |
| X02 | Role Header | 返回/内置/未保存 | sticky |
| X03 | Role身份 | code/name/description | code编辑只读 |
| X04 | 权限域导航 | Story/Models/Billing等 | Mobile局部横滚 |
| X05 | 权限矩阵 | code/name/description/check | Desktop表格局部横纵滚 |
| X06 | 影响与diff | 权限变化/管理员 | 真实聚合或暂不可计算 |
| X07 | Role Footer | 取消/保存 | sticky + safe-area |
| T01 | Storage框架 | 能力页 | 无假资源列表 |
| T02 | Driver健康 | driver/config/request ID | 不显示凭据 |
| T03 | 能力与prefix | upload支持/原因/rule | 无假目录树 |
| T04 | 上传 | file/拖放/name/type/size | 键盘可达、服务端限制 |
| T05 | 进度与回执 | progress/key/etag/metadata | 只显示真实结果 |
| T06 | 已知key检查 | key/exists/metadata/download | 诊断，不是list |
| T07 | Metadata结果 | 定义列表/只读JSON | 无delete/count |

## 12. 所有替代态

```text
页面主体 / Drawer / Modal / Full-screen 的正常内容可被以下状态精确替换：
┌──────────────────────────────────────────────────────────────────────────────────────────┐
│ [Z01 Loading] 标题/筛选/表头保留；骨架与真实行/分区等高；超时提示“仍在加载”             │
├──────────────────────────────────────────────────────────────────────────────────────────┤
│ [Z02 Filter Empty] 当前筛选无结果 + 筛选摘要 + 清筛；归焦结果标题                        │
├──────────────────────────────────────────────────────────────────────────────────────────┤
│ [Z03 System/Relation Empty] 系统尚无数据或无可选关系；只在可创建域给入口                 │
├──────────────────────────────────────────────────────────────────────────────────────────┤
│ [Z04 400 Validation] 顶部摘要 + 字段错误；保留草稿；聚焦首错                            │
├──────────────────────────────────────────────────────────────────────────────────────────┤
│ [Z05 401/403] 清除受保护值 / 显示所需permission；登录后返原URL                           │
├──────────────────────────────────────────────────────────────────────────────────────────┤
│ [Z06 404 Gone] 关闭失效覆盖层；返回列表；播报记录不存在/不可见                           │
├──────────────────────────────────────────────────────────────────────────────────────────┤
│ [Z07 409 Conflict] 类型/服务器最新值/相关记录/当前草稿；“载入最新”需二次确认             │
├──────────────────────────────────────────────────────────────────────────────────────────┤
│ [Z08 500/503] 安全文案 + Request ID + 重试；503明确PostgreSQL/Story源；保留筛选/草稿      │
├──────────────────────────────────────────────────────────────────────────────────────────┤
│ [Z09 Success Receipt] 实际动作/resource ID/Request ID/Audit/Ledger；Key明文只在此显示一次 │
├──────────────────────────────────────────────────────────────────────────────────────────┤
│ [Z10 Dirty Confirm] 放弃/继续编辑；拦截Escape、返回、刷新和路由跳转；归还原触发器        │
└──────────────────────────────────────────────────────────────────────────────────────────┘
```

| ID | 替代态 | 焦点与恢复 |
|---|---|---|
| Z01 | Loading | 不主动跳焦；异步完成后polite播报 |
| Z02 | 筛选空态 | 清筛后聚焦结果标题 |
| Z03 | 系统/关系空态 | 关系选择器保留父资源返回路径 |
| Z04 | 400字段错误 | 摘要链接到字段并聚焦首错 |
| Z05 | 401/403 | 聚焦错误标题；不泄露资源值 |
| Z06 | 404 | 关闭覆盖层并归还列表上下文 |
| Z07 | 409 | 当前草稿与最新值并存；禁止盲写 |
| Z08 | 500/503 | 复制Request ID/重试；无SQLite/JSON/内存回退 |
| Z09 | 成功回执 | 聚焦回执标题；刷新列表/详情；一次性Secret关闭后不可再看 |
| Z10 | 未保存确认 | 内层Dialog锁焦；取消回到原字段，确认后归还外层触发器 |

## 13. 动线、焦点与溢出交付规则

```text
资源列表 L01–L10
   ├─ 查看真实行 ─ getOne ─→ D01–D07 ─ 编辑 ─→ E01 / P01 / M01 / R01 / X01
   ├─ 领域命令 ─ 重新取状态/影响 ─→ K01–K06 ─→ Z09
   ├─ Usage真实行 ─→ Q01–Q09 ─ settlement_failed ─→ C01–C09 ─→ Z09
   └─ 跨资源链接 ─ 白名单query ─→ 目标列表/详情 ─ 返回恢复URL、页码、筛选、行焦点
```

1. 容器层级：内层 Select/Popover 的 Escape 优先；其后是确认 Dialog；再后才是 Drawer/全屏面板。所有覆盖层锁定 Tab，关闭后归还触发器。
2. 脏草稿：服务器初值只装载一次。`Z10` 覆盖 Escape、返回按钮、浏览器后退、刷新和路由跳转；503/409 不丢草稿。
3. 固定区：`P02/P11`、`R02/R09`、`C02/C09`、`X02/X07`、Drawer Header/Footer 固定；只有中段纵滚。移动 Footer 使用 `env(safe-area-inset-bottom)`，末字段至少留 `96px`。
4. 横向溢出：仅 `S05/L06/U05/U06–U08/X05` 等明确标记区域可局部横滚；长 code/ID/URL 在自身单元截断、换行或复制，禁止用根节点隐藏真实布局错误。
5. 关系安全：Provider/Model/User/Role/Permission/Workspace/Story 选项由受权 API 分页加载；编辑记录直接带入服务器关系，不提供粘贴 ID 捷径。
6. 数据事实：摘要、趋势、依赖数、管理员影响、价格差额来自真实聚合并携带时间窗/来源/更新时间；失败显示“暂不可用”，不存在前端当前页推算全量或装饰性数字。
7. 财务事实：金额 API 使用整数 micro-USD；UI 十进制输入只负责精确转换预览。Ledger/Audit append-only；Pricing 通过新版本处理历史。
8. 视觉边界：暖纸 `#F6EFE5/#FFFAF2`、棕色文字、细线与少量黄/绿/蓝语义标记；不用默认 Refine/Ant CRUD 外观、远程字体、Tailwind 2、Landing Page、卡片海、渐变或假图表。
