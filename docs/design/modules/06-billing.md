# 模块交互：Usage、账户、Ledger 与报表

> 返回：[全局交互规范](../refine-admin-ui-v3-interaction-design.md) · PRD：[账务运营](../../prd/modules/06-billing.md)

> 实现状态：Usage、账户、Ledger、报表、当前筛选 CSV 与 credit 已实现；跨域富详情及 debit/reversal 命令是后续目标。

## 0. Current / Target / Release Gate

| 分层 | 交互边界 |
|---|---|
| Current | Usage/账户/Ledger/报表/CSV/credit；当前 coverage 仍可能混写 Subscription money allowance/cash overage，credit selector 预载前 100，无 debit/refund/reversal，settled Usage/Request 终态 guard 未齐。 |
| Target | Subscription Token Allowance 与独立现金账户明确分域；本页只呈现 Token Usage、Provider price/cost 和显式独立现金 reserve/capture/release/refund/reversal。 |
| Release Gate | 205-user selector、Token/micro-USD 单位隔离、独立现金守恒/并发/重放、不可变与两视口 E2E 通过；订阅开通/续期/换版没有金额 UI 或 Ledger。Payment/Webhook 为 Deferred。 |

## 1. Usage Dashboard

全局筛选：Date Range/timezone、protocol、Provider、Model、平台用户、outcome、refresh。筛选同时驱动事实摘要、趋势和“请求日志 / Provider 统计 / 模型统计”；聚合不可用时显示不可用，不用当前页合计替代。

Usage 表列 request ID、user、provider/model、四类 Token、明确的 product mode、Subscription Token coverage（若适用）、独立 cash charge（若适用）、status、time。Token 与 micro-USD 使用不同列名/单位，不能合并为 `allowance/cash charge`。详情复用 Gateway Request Drawer，Subscription Token 与独立价格/现金/Ledger 分区展示。

Dream Token-only 订阅体验只消费 `GET /api/product/v1/me/usage` 的当前周期 Token 聚合，预计耗尽按 remaining tokens、真实 Usage 和 period end 计算并标注算法/更新时间；不读取 cash balance 或预计金额超额。`GET /api/product/v1/me/ledger` 若未来提供，只属于独立账务视图，不得成为 Subscription 页面依赖。两者目前均未实现，不允许假余额或当前页合计。

## 2. 计费账户

列表列平台用户、currency、available、reserved、lifetime debited、version、updated；筛选 user/tier，金额 mono/tabular。标题和帮助文案固定为“独立现金账户”，不得称为“订阅余额”。详情宽 Drawer：cash → applicable Request/Price → recent Ledger/Usage → 调账入口；Subscription Token 只提供带 permission 的跳转，不嵌入金额分区。

当前调账 Modal 仅为 credit：平台用户普通 Select（只预载前 100）、USD number（最多 6 位小数）+ micro-USD 换算提示、reason textarea、不可变账本确认 checkbox；幂等键由客户端提交时自动生成。当前没有 external ticket 独立字段、before/after 预览、类型 radio 或 debit/refund/reversal；也不能直接输入目标余额。服务端仍只接收整数 `amountMicrousd`。

Target refund/reversal 从原 Ledger reference 发起，确认层显示原 entry、可操作余额、本次 integer micro-USD、操作后守恒、reason、idempotency key 和反向关联。不编辑原 entry，不使用浮点传输，也不改变 Subscription Token。

## 3. Ledger 与报表

Ledger 列 entry type、signed amount、available/reserved after、user、request/subscription、actor、created；筛选 user/account/type/request/subscription/time；只读，无行编辑/删除。未来 reversal 应从原 entry 发起新命令并显示双向关联；当前 UI 不展示未实现入口。

报表选择日期、时区、Provider/Model/User、币种展示；显示 Usage 与 Ledger 的真实聚合、舍入规则和数据更新时间。当前已实现客户端 CSV 导出，导出当前已加载报表结果且不包含 Prompt/Secret；“导出前行数/时间范围确认”是后续增强，不得把它写成现状。

## 4. Payment / Webhook 诊断（Deferred）

本阶段不创建页面、路由、主导航、可点入口或 Test Adapter 成功态。以下内容仅保留未来独立支付域的边界，不能作为 Subscription release gate：

- Payment intent/reference：只能关联未来独立订单/现金 Ledger，不得把 `subscription`、Plan Version 或 Token Allowance 作为金额容器；无 Secret/支付凭据。
- Webhook event：仅已验签 trusted event 可显示 adapter、event ID/fingerprint、processing status/attempt、received/processed time、安全 error 与 Audit 链接；不得直接开通订阅或发 Token。

未单独立项前，test/dev 也不显示 Fake Adapter。未来若实现，必须有明确水印且 production hard fail；未接真实渠道永不显示“支付成功”。

未来 Payment 详情把 `authorize` 与 `capture` 显示为独立时序事件和幂等回执，不把 authorized 写成 captured/订阅已开通或 Token 已发放。所有错误不载入 payload/Secret。

Payment/Webhook 错误定义为 `{error:{code,message,details?},meta:{requestId,retryAfterSeconds?}}`；错误摘要和恢复动作读 `error`，追踪/重试元数据读 `meta`，不从 payload 或旧顶层字段推测。

1440×1000 以摘要 + 紧凑表 + 宽 Drawer 保持 Subscription Token Usage 与独立 cash/Ledger 分区；390×844 摘要单列、表格局部滚动，字段 label 始终带 tokens 或 micro-USD 单位。金额/Token/ID 有独立 Copy accessible name；未知结果播报“确认中”而非成功。

## 5. 状态与验收

- 未知 Usage 显示“未知/待处置”，不能显示 0 Token 或成功结算。
- 当前 409/网络错误保留调账输入并显示安全错误；“自动刷新当前 version/balance、按幂等键查询未知结果”是目标恢复能力，完成前不能显示成功。
- Mobile 摘要纵向，金额标签不省略；表格局部横滚。
- UI-BIL-01：Subscription Token 只追到 Subscription/Request/Usage；独立 cash 只追到 Account/Request/Pricing/Ledger，两者始终分区且无 fallback 文案。
- UI-BIL-02：调账只能追加 Ledger，重复提交只显示一次结果。
- UI-BIL-03：Ledger 无编辑/删除控件，审计角色可完整键盘查询。
- UI-BIL-04：报表不可用时不显示假指标或空 CSV。
- UI-BIL-05（Target release gate）：1440×1000 与 390×844 的 Token/micro-USD 列名、详情分区、402 恢复和 CSV 单位一致；订阅动作前后独立现金账户与金额 Ledger 不变。
- UI-BIL-06（Deferred）：Payment/Webhook 单独立项前无 DOM、路由或测试成功态；未来 refund/reversal 只能新增独立现金 Ledger，不改变 Subscription Token。
