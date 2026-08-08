# Ink Memory Admin v3：页面层级与业务逻辑映射

> HTML Design Workflow / Stage 3 — Hierarchy Logic Mapper
> 输入：`files/workspace/1_prd_draft.md`、`files/workspace/2_structure_sketch.md`、`files/inputs/target_image.png`
> 目标视口：Desktop `1440×1000`；Mobile `390×844`
> 编号规则：严格沿用 Stage 2 的 `S / D / P / U / M / G / X` 模块 ID，不另建平行编号。

## 0. 本阶段 Prompt Architect 记录

**Optimized Prompt：**综合 Stage 1 PRD、Stage 2 页面结构草图与目标图，为 Ink Memory Admin v3 输出可直接交给 UI Art Director 的中文页面结构草图和 Parent-Child 逻辑树。必须保持 Stage 2 模块 ID，明确 Admin Shell、Dream 真实实体关系、套餐与不可变版本、用户订阅状态机、Provider/Model/Pricing、Gateway 资格及 Allowance/Cash 结算、只追加 Ledger、跨页面错误层的父子关系；补充路由上下文的进入、返回与 URL 筛选继承；分别说明 1440×1000 与 390×844 的逻辑变化。不得把封面误作后台截图，不得设计 Landing Page，不得填入假指标、假金额或 Secret 明文。

**Optional Enhancers：**将月度账单预览与安全 CSV 作为 `G6` 的只读聚合子路径；将支付适配器保留为后端可插拔边界，不在界面中模拟支付成功；在状态命令与结算链中固定幂等、冲突恢复和审计入口。

## 1. 结构判断

- 目标图是 UI v2.1 封面，不含可验证的后台控件；本阶段只继承暖纸画布、大留白、深炭棕层级、视觉收敛、单一虚线 Paper、无卡片墙，不从图中虚构导航或数据。
- 页面逻辑由五个业务根页承载：`D0` Dream 层级、`P0` 套餐版本、`U0` 用户订阅、`M0` 模型中心、`G0` 网关计费；它们都嵌入 `S0`，不是五套独立 Shell。
- Dream 实体是业务事实；Subscription、Provider、Gateway、Billing、RBAC、Storage 和 Audit 是控制面。两者只通过 Billing Identity、关系筛选和审计引用连接，不建立语义重复的用户/工作区/剧本。
- `X1` 是 `S12` 的原位状态替换；`X2` 是写操作覆盖层。二者是跨页面子层，不是导航 Resource。

## 2. 页面结构草图（模块分区，精炼版）

### 2.1 Desktop 1440×1000

```text
┌────────────────────────────────────────── [S0 Admin Shell] ──────────────────────────────────────────┐
│┌──────────── [S1 固定主导航] ────────────┐┌────────────────── [S2 顶部上下文栏] ────────────────────┐│
││ [S4] 总览                              ││ 面包屑 / 数据源健康 / 主题 / 当前账户                    ││
││ [S5] 剧本运营                          │└──────────────────────────────────────────────────────────┘│
││   [D1] 用户 → [D2] 工作区 → [D3] 剧本 │┌────────────────── [S3 单一主滚动区] ────────────────────┐│
││                       ├→ [D4] 角色     ││ 页面标题 / 任务说明 / 刷新时间              [主操作]     ││
││                       └→ [D5] 场景     ││                                                          ││
││ [S6] 订阅中心                          ││ ┌┈┈┈┈┈┈┈┈┈┈ [S10 页面唯一 Paper] ┈┈┈┈┈┈┈┈┈┈┈┈┈┐ ││
││   [P1] 套餐 → [P2] 版本 → [P3] 权益   ││ ┋ [S11 查询、筛选、排序、已选上下文]              ┋ ││
││   [U1] 用户订阅入口                    ││ ┋───────────────────────────────────────────────────┋ ││
││ [S7] 模型中心                          ││ ┋ [S12 当前 Resource 主事实 / 详情 / 编辑]          ┋ ││
││   [M1] Provider → [M2] Model           ││ ┋   D0 / P0 / U0 / M0 / G0 之一                    ┋ ││
││                  → [M3] Pricing        ││ ┋   [X1 loading/empty/error 原位替换]               ┋ ││
││   [M4] 用户模型限制                    ││ ┋───────────────────────────────────────────────────┋ ││
││ [S8] 网关与计费                        ││ ┋ [S13 真实总数 / 服务端分页]                       ┋ ││
││   [G1] Key → [G2] Request → [G3] Usage││ └┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┘ ││
││   [G4] Account → [G5] Ledger          ││ [S14 Toast / live region / request ID]                     ││
││   [G6] 账单预览 / 安全 CSV            ││ [X2 高风险确认：Modal；完成或取消后归焦触发器]             ││
││ [S9] Storage / RBAC / Session / Audit ││                                                          ││
││      / System Settings                ││                                                          ││
│└────────────────────────────────────────┘└──────────────────────────────────────────────────────────┘│
└─────────────────────────────────────────────────────────────────────────────────────────────────────┘
```

桌面 Parent-Child 规则：`S1` 与右侧内容是 `S0` 的一级子区；`S2`、`S3` 在右侧上下排列；`S10` 属于 `S3`，且只包裹当前页面事实，不包裹侧栏和覆盖层。`S11 → S12 → S13` 是固定阅读顺序，`S14` 是反馈兄弟层。详情使用 Drawer 或独立子路由时保留父列表 URL、滚动和触发行。

### 2.2 Mobile 390×844

```text
┌────────────────────────────── [S0 Mobile Admin Shell] ──────────────────────────────┐
│ [S2 Sticky Header]  [打开 S1] Ink Memory        [健康] [账户]                     │
│┌──────────────────────────── [S3 主内容 / 16px] ──────────────────────────────────┐│
││ 返回父上下文 / 短面包屑                                                         ││
││ 页面标题 · 状态 · 任务说明                                                     ││
││ [主操作 / 整行]                                                               ││
││ ┌┈┈┈┈┈┈┈┈┈┈┈┈┈┈ [S10 单列 Paper] ┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┐                           ││
││ ┋ [S11 搜索常显]                      [筛选 Sheet / 条件数] ┋                           ││
││ ┋ [条件 chips / 清除]                                      ┋                           ││
││ ┋───────────────────────────────────────────────────────────┋                           ││
││ ┋ [S12 关键事实行，或当前详情的一次单层钻取]                ┋                           ││
││ ┋ [X1 原位状态；根页面不横向滚动]                           ┋                           ││
││ ┋───────────────────────────────────────────────────────────┋                           ││
││ ┋ [S13 真实总数]                     [上一页] [下一页]      ┋                           ││
││ └┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┘                           ││
│└─────────────────────────────────────────────────────────────────────────────────┘│
│ [S14 底部 live region / Toast，不遮挡 safe area]                                  │
└────────────────────────────────────────────────────────────────────────────────────┘

[S1 导航 Drawer]             [S11 筛选 Sheet]              [X2 全屏高风险确认]
分组 S4–S9                   锁焦 / 应用后写回 URL          影响 → 账务 → 幂等 → 确认
关闭后归焦 S2 触发器         关闭后归焦筛选触发器           返回保留表单与父上下文
```

移动端不是桌面缩放：侧栏变 `S1` Drawer；筛选从 `S11` 工具条变 Sheet；宽表变 `S12` 关键事实行；Drawer 详情变全屏子路由；并列事实改为有先后因果的纵向区块。

## 3. 页面层级结构图（Parent-Child 逻辑树）

```text
[S0 Admin Shell]  应用根：Session、RBAC、主题和单一 PostgreSQL 上下文
├─ [S1 主导航]  选择业务域，不承载页面数据
│  ├─ [S4 总览]  真实异常与待处理入口
│  ├─ [S5 剧本运营]
│  │  ├─ [D1 Dream User]
│  │  ├─ [D2 Workspace]
│  │  ├─ [D3 Story]
│  │  ├─ [D4 Character]
│  │  └─ [D5 Scene]
│  ├─ [S6 订阅中心]
│  │  ├─ [P1 Plan]
│  │  ├─ [P2 Plan Version]
│  │  ├─ [P3 Entitlement]
│  │  └─ [U1 用户订阅入口；页根为 U0，见歧义说明]
│  ├─ [S7 模型中心]
│  │  ├─ [M1 Provider]
│  │  ├─ [M2 Model]
│  │  ├─ [M3 Pricing]
│  │  └─ [M4 用户模型限制]
│  ├─ [S8 网关与计费]
│  │  ├─ [G1 Gateway Key]
│  │  ├─ [G2 Request]
│  │  ├─ [G3 Token Usage]
│  │  ├─ [G4 Billing Account]
│  │  ├─ [G5 Append-only Ledger]
│  │  └─ [G6 月度账单预览 / 安全 CSV]
│  └─ [S9 资源与治理]  Storage / RBAC / Session / Audit / Settings 保留现有边界
├─ [S2 顶部上下文栏]  当前路径、依赖健康、主题、账户
├─ [S3 主内容]
│  ├─ 页面标题 / 当前 Resource 上下文 / 唯一主操作
│  ├─ [S10 页面唯一 Paper Boundary]
│  │  ├─ [S11 查询与上下文]  白名单筛选、排序、URL 状态
│  │  ├─ [S12 主事实区]
│  │  │  ├─ [D0 Dream 层级页] 或
│  │  │  ├─ [P0 套餐与版本页] 或
│  │  │  ├─ [U0 用户订阅详情] 或
│  │  │  ├─ [M0 模型中心] 或
│  │  │  ├─ [G0 网关与计费]
│  │  │  └─ [X1 主事实区原位状态替换]
│  │  └─ [S13 服务端分页]  真实 total、page、pageSize
│  └─ [X2 高风险确认]  桌面 Modal / 移动全屏；提交经审计
└─ [S14 反馈层]  Toast、polite live region、request ID
```

### 3.1 Dream 层级页

```text
[D0 Dream 层级详情]  从真实源实体进入的关系上下文
└─ [D6 Dream Paper]
   ├─ [D7 身份与计费映射]
   │  └─ Dream User → Billing Identity → Subscription 摘要 / 不可调用原因
   ├─ [D8 关系导航]
   │  ├─ [D1 User]  源身份；不读取 password_hash
   │  ├─ [D2 Workspace]  User owns
   │  ├─ [D3 Story]  Workspace contains；另保留 author User 关系
   │  ├─ [D4 Character]  Workspace/Story relation
   │  ├─ [D5 Scene]  Workspace/Story ordered relation
   │  └─ Subscription / Usage / Keys / Audit 上下文入口
   ├─ [D9 Story 详情主体]  基本信息 → 正文只读 → 审阅 / provenance
   ├─ [D10 Story 关系索引]
   │  ├─ [D4 Character + role_type]
   │  └─ [D5 Scene + order_index] → related [D4 Character]
   └─ [D11 受控动作与恢复]  白名单写；409 Diff；缺表 503；禁止旧表回退
```

业务父子与关系语义：

```text
[D1 User]
├─ owns ───────> [D2 Workspace]
│                 ├─ contains ──> [D3 Story]
│                 │                ├─ relates ──> [D4 Character]
│                 │                └─ orders ───> [D5 Scene]
│                 ├─ contains ──> [D4 Character]
│                 └─ contains ──> [D5 Scene] ── relates ──> [D4 Character]
└─ authors ─────> [D3 Story]
```

### 3.2 套餐、版本与权益页

```text
[P0 套餐与版本页]
└─ [P4 Plan Paper]
   ├─ [P5 Plan 查询]  name/code/status/排序 → URL
   ├─ [P1 Plan]  稳定 code/name/status/currency；不直接承载可变价格
   ├─ [P2 Plan Version]  Plan 的版本时间轴
   │  ├─ Draft：可进入 [P6]
   │  └─ Published：只读；仅可复制为新 Draft
   └─ [P6 发布工作区]  独立路由
      ├─ [P7 价格与周期]  billing interval / micro-USD / trial / grace
      ├─ [P8 权益编辑]
      │  └─ [P3 Entitlement]  model aliases / scopes / RPM / Token / 金额 / Storage
      ├─ [P9 超额策略]  deny 或 cash_balance
      ├─ [P10 发布核对]  Draft 与不可变目标快照 Diff
      └─ [P11 发布 Footer]  保存草稿 / 发布并锁定；409 保留草稿
```

父子约束：`P1 1:N P2`，`P2 1:N P3`；Published `P2` 与其 `P3` 一起冻结。现有 Subscription 始终引用具体 `P2`，发布新版本不会静默迁移订阅。

### 3.3 用户订阅详情页

```text
[U0 用户订阅详情]  解释“谁、订了什么、为什么可调用、如何计费”
└─ [U1 Subscription Paper]
   ├─ [U2 身份与状态]  D1 User → Billing Identity → Subscription → P2 Version
   ├─ [U3 资格解释]
   │  ├─ [U4 套餐权益]
   │  ├─ [U5 用户模型 Override]
   │  └─ intersection → [U6 最终权限]  Model/Scope/RPM/Quota/Overage
   ├─ [U7 周期 Allowance]  granted / reserved / consumed / remaining
   ├─ [U8 Billing Account]  available / reserved；与 U7 赠送额度分离
   ├─ [U9 当前周期 Usage]
   │  └─ [U10 预计超额]  有方法才预测，否则明确“暂不预测”
   ├─ [U11 生命周期与账务时间线]  状态事件 → Ledger / Audit 引用
   ├─ [U12 上下文链接]  Request / Usage / Ledger / Key / User / Version
   └─ [U13 生命周期操作]
      ├─ [U14 账务预览]  charge / credit / allowance 影响
      └─ [U15 幂等键与理由]  防重复、冲突恢复、审计输入
```

### 3.4 模型中心页

```text
[M0 模型中心]
└─ [M5 Model Paper]
   ├─ [M1 Provider]  protocol/base URL/健康/Credential 配置状态
   │  └─ contains/discovers → [M2 Model]
   ├─ [M2 Model]  alias → upstream_model / capabilities
   │  └─ versioned-by → [M3 Pricing]  历史只读，新价格新版本
   ├─ [M4 用户模型限制]  allow/deny override，与 U4 取交集形成 U6
   └─ [M6 链路跳转]  Provider → Model → Pricing → 已筛选 G2 Request
```

Secret 不是该树的可读子节点：`M1` 仅展示“已配置/未配置”，编辑空值表示不轮换，永不预填或查看现有值。

### 3.5 Gateway 与计费页

```text
[G0 网关与计费]
└─ [G7 Gateway Paper]
   ├─ [G8 共用筛选]  日期/时区/协议/Provider/Model/User/Subscription/outcome
   ├─ [G1 Gateway Key]  Billing Identity + scopes + expiry；仅 prefix 可回看
   │  └─ create → [G18 Key 创建] → success-once → [G19 一次性配置回执]
   ├─ [G2 Request]  请求事实与 outcome
   │  └─ open → [G9 Request Detail]
   │     ├─ [G10 Key/User]  prefix、scope、安全身份
   │     ├─ [G11 Subscription/Plan/Entitlement 资格快照]
   │     ├─ [G12 Alias → Provider → upstream_model 路由]
   │     ├─ [G13 四类 Token + Pricing Snapshot]
   │     ├─ [G14 Allowance 预留/消费/释放]
   │     ├─ [G15 Cash 预留/扣费/释放]
   │     ├─ [G16 Settlement + Ledger refs]
   │     └─ [G17 性能 / 脱敏错误 / request ID]
   ├─ [G3 Token Usage]  请求冻结后的四类 Token 与价格快照
   ├─ [G4 Billing Account]  现金 available/reserved/lifetime debited
   ├─ [G5 Append-only Ledger]  type/amount/before-after/refs/idempotency
   └─ [G6 月度账单预览 / CSV]  基于当前筛选的只读聚合与安全导出
```

## 4. 路由上下文与返回逻辑

| 进入路径 | 当前根模块 | 继承的安全上下文 | 返回行为 |
|---|---|---|---|
| `/admin/story/users` → 用户详情 → Workspace → Story | `D0` / `D1–D10` | `userId`、`workspaceId`、白名单筛选、page/sort | 逐级返回；恢复父列表筛选、页码、滚动和触发行焦点 |
| `/admin/subscriptions/plans` → Version → 发布 | `P0` / `P1–P11` | `planId`、`versionId`；Published 只读 | 返回版本时间轴；409 保留 Draft 与 Diff，不盲目覆盖 |
| `/admin/subscriptions/users` → `/{id}` | `U0` / `U1–U15` | `platformUserId`、Subscription ID、周期范围 | 生命周期操作完成后刷新同一详情；不跳失上下文 |
| `/admin/models/providers` → Model → Pricing → Request | `M0` → `G0` | Provider/Model alias 白名单筛选 | 返回时恢复模型链原筛选，而非回到未筛选网关首页 |
| `/admin/gateway/requests` → Request Detail | `G0` / `G2`、`G9–G17` | request ID 与父列表 filter/page/sort | Desktop 关闭 Drawer；Mobile 返回全屏父列表并恢复位置 |
| `/admin/billing/usage|accounts|ledger|invoices/preview` | `G3–G6` | User/Subscription/Request/period 白名单筛选 | 上下文链接互跳时保留可共享筛选，不携带 Secret |

Desktop 中简单核对可在 Drawer 完成，版本发布和财务/生命周期操作走独立路由或 `X2`；Mobile 所有复杂详情与编辑走全屏子路由。筛选始终由 URL 表达，临时表单和一次性 `G19` Secret 不进入 URL、历史记录或日志。

## 5. Subscription 生命周期状态机

```text
[无 Subscription]
├─ start trial ───────────────────────────────────────> [trial]
└─ activate（余额或未来 adapter 成功；幂等扣费）────> [active]

[trial]
├─ trial/renewal success ─────────────────────────────> [active]
├─ renewal failure ───────────────────────────────────> [past_due + grace_end]
├─ pause now ─────────────────────────────────────────> [paused]
├─ cancel at period end ─> [trial + cancel_at_period_end=true] ─到期→ [cancelled]
└─ cancel now（高权限）───────────────────────────────> [cancelled]

[active]
├─ renewal success ───────────────────────────────────> [active / 新周期 + 新 U7]
├─ renewal failure ───────────────────────────────────> [past_due + grace_end]
├─ upgrade now ───────────────────────────────────────> [active / 立即锁定新 P2]
│   └─ U14：旧版本未使用价值 credit + 新版本差额 charge；U7 只补正差
├─ downgrade ─────────────────────────────────────────> [active + scheduled_version_id]
│   └─ 到下次 renewal anchor 才切换 P2；当前周期权益不缩水
├─ pause now ─────────────────────────────────────────> [paused]
├─ cancel at period end ─> [active + cancel_at_period_end=true] ─到期→ [cancelled]
└─ cancel now（高权限）───────────────────────────────> [cancelled]

[past_due]
├─ payment/recovery success ──────────────────────────> [active]
└─ grace expired ─────────────────────────────────────> [paused] 或 [expired]

[paused]
└─ resume（版本、周期、计费均有效）───────────────────> [active]

[cancelled]
└─ resubscribe ───────────────────────────────────────> [新 Subscription]

[expired] ──> 终止只读；不能继续 Gateway 调用
```

逻辑规则：`cancel_at_period_end` 是 `trial/active` 上的标志，不是独立状态；所有命令经 `U13 → U14 → U15 → transaction → U11/Audit`。续费、升级、Webhook 或重复点击共享幂等键，同一业务事件不得重复扣费、重复授予 `U7` 或改写旧 `G5`。

## 6. Gateway 资格与结算逻辑

### 6.1 调用资格链

```text
[D1 Dream User]
  → [D7 Billing Identity 已绑定且启用?]
  → [G1 Key 有效且 Scope 匹配?]
  → [U2 Subscription 状态允许调用?]
  → [P2 Published Version 仍可解析?]
  → [U4 Entitlement ∩ U5 User Override]
  → [U6 Model Alias / Scope / RPM / Token Limit 通过?]
  → [M2 Alias] → [M1 Provider] → upstream model
  → [U7 Allowance 足够?]
       ├─ yes：进入 [G14 reserve allowance]
       └─ no：检查 [P9 overage]
              ├─ deny：停止，402
              └─ cash_balance：检查 [U8/G4 available]
                    ├─ 足够：进入 [G15 reserve cash]
                    └─ 不足：停止，402
  → 建立 [G2 Gateway Request]
```

拒绝分支：Key 缺失/失效为 401；Scope、Entitlement、Override 或模型禁止为 403；订阅状态/并发版本冲突为 409；RPM/Token 窗口超限为 429；余额或额度不足为 402；资格依赖不可用为 503，禁止放行或回退旧表。

### 6.2 请求与只追加结算链

```text
[G14 Allowance reserve] 或 [G15 Cash reserve]
                    │
                    ▼
             [G2 Gateway Request]
                    │  冻结 G11 资格、G12 路由、M3 价格引用
                    ▼
       上游完成 / 失败 / 流式中断 / usage 未知
                    │
                    ▼
       [G3 + G13 Usage / Pricing Snapshot]
                    │
        ┌───────────┴───────────┐
        │                       │
  capture 实际消耗        release 未使用预留
        │                       │
        └───────────┬───────────┘
                    ▼
       [G16 Settlement refs + 状态]
                    │
                    ▼
         [G5 Append-only Ledger]
```

- `G14` 与 `G15` 是互斥或有明确顺序的资金来源，不能把赠送额度与现金合并成一个“总余额”。
- 价格以整数 micro-USD 快照结算；历史 Request 不因 `M3` 新版本、套餐升级或退款而重算。
- 失败、释放、退款和纠错均新增 Ledger entry/reversal；不更新或删除原账本。
- 流式中断或 usage 未知进入安全待结算/失败状态，不按 0 假结算；`G17` 只显示脱敏错误。

## 7. Desktop / Mobile 逻辑变化

| 逻辑对象 | Desktop 1440×1000 | Mobile 390×844 | 不变条件 |
|---|---|---|---|
| `S1` 导航 | 248px 固定侧栏，分组展开 | 锁焦 Drawer | 分组和目标 Resource 不变 |
| `S11` 查询 | 搜索、筛选、排序同栏 | 搜索常显，筛选进 Sheet | 应用后写回相同 URL 白名单参数 |
| `S12` 列表 | 表格；表体可局部横滚 | 关键事实行；一次只看一个层级 | 真实 total、排序和服务端分页不变 |
| `D0` 层级 | User/Workspace/Story 关系可同屏核对 | 单层钻取，关系 Tab 可聚焦横滚 | 返回恢复父上下文与焦点 |
| `P6` 发布 | 四段同页 + 固定 `P11` | 一步一屏 + Sticky `P11` | Published 不可编辑；409 保留 Draft |
| `U7/U8` | 双列并排 | 纵向分区 | Allowance 与现金语义始终分离 |
| `U13–U15` | 影响摘要 Modal | 操作 Sheet → 全屏确认 | 幂等、账务预览、理由与审计不变 |
| `M0` | Provider/Model/Pricing 可同屏联动 | 独立全屏列表/表单 | Secret 只写不读 |
| `G9` | 宽 Drawer 展示证据链 | 全屏按 `G10→G17` 展开 | 快照、结算、Ledger 引用顺序不变 |
| `G3–G6` | 可在 `G0` 分区汇总 | 各自独立路由 | 从 Request/User 进入时继承安全筛选 |
| `X1/X2` | 原位状态 + Modal | 原位状态 + 全屏确认 | 状态语义、焦点恢复和 request ID 不变 |

## 8. 歧义与 Stage 4 处理说明

1. Stage 2 的全局信息架构把 `U1` 标成“用户订阅”，模块索引又把 `U1` 定义为 “Subscription Paper”。本文件不改号：Stage 4 应以 `U0` 作为用户订阅页面/路由根，以 `U1` 作为页内唯一 Paper；侧栏点击文案仍为“用户订阅”。
2. Stage 1 只给出部分建议路由，Dream User、Workspace、Story 的详情子路径未全部定稿。界面可表达父子钻取与 URL 上下文，但不应在视觉稿中写死未经实现确认的动态段名。
3. Character、Scene 及更深 Dream 表若尚未迁入 PostgreSQL，`D4/D5/D10` 必须显示 `X1` 的 503 缺表证据与 request ID，不得借旧 Admin 表或假数据补齐。
4. `past_due` 宽限期是否继续允许调用由锁定 `P2/P3` 策略决定；资格解释必须在 `U3/G11` 显示实际命中规则，不能把所有 `past_due` 统一画成可用或禁用。
5. `past_due` 宽限到期后的目标可能是 `paused` 或 `expired`，应由服务端状态机策略返回；UI 只展示影响摘要和实际目标，不自行推断。
6. 支付渠道尚未接入。`U14` 只展示余额扣费或适配器返回的真实预览/状态，不展示 Stripe、支付宝、微信按钮或虚构支付成功。
7. 目标图仅证明品牌视觉原则，不证明任何 Admin 控件、布局尺寸或交互；Stage 4 不得将其封面标题、Landing Page 文案或营销区复制进控制台。

## 9. Stage 3 验收

- [x] 同时输出精炼页面结构草图与 Parent-Child 页面层级树。
- [x] 沿用 Stage 2 的全部模块 ID，并标明 `U1` 复用歧义。
- [x] 明确 Dream、Plan、Subscription、Model、Gateway 五个页面根及其父子关系。
- [x] 覆盖路由上下文、订阅状态机、Gateway 资格、Allowance/Cash 预留和只追加 Ledger。
- [x] 说明 Desktop 与 Mobile 的逻辑重排，而非等比缩放。
- [x] 未使用假数据、Secret 明文、Landing Page 或默认卡片墙结构。
