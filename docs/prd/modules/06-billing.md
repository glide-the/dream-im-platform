# 模块 PRD：Usage、计费账户、Ledger 与报表

> 返回：[平台 PRD 总纲](../ink-memory-admin-prd-v3.md) · 交互：[账务运营](../../design/modules/06-billing.md)

> 实现状态：**Implemented / Release candidate**；Usage、账户、Ledger、Product Token Usage、PaymentAdapter/Webhook/Fake 与终态 guard 已实现。真实外部支付渠道与外部账单继续 Deferred。

## 0. Current / Target / Release Gate

| 分层 | 范围 |
|---|---|
| Current / Implemented | Usage/账户/金额 Ledger、Token/micro-USD 分域、Dream Product Token Usage、Payment Intent/Webhook event store/Fake guard 与终态 guard 已实现。 |
| Target | Subscription Token Allowance/Token Ledger 与本模块完全分域；本模块只处理 Provider Pricing、显式独立现金模式、micro-USD 账户与 append-only 金额 Ledger，reserve/capture/release/refund/reversal 事务化幂等。 |
| Release Gate | Token 与 micro-USD 字段分离、整数传输、Webhook 签名/幂等、失败不激活、refund/reversal 只追加、Usage/Ledger/Audit 不可变通过；真实渠道不得启用。 |

## 1. 目标与边界

让财务运营、支持和审计人员以 Request 为证据核对 Token Usage、Provider Pricing/成本快照、显式独立现金扣费、余额和账本。Subscription Token Allowance 只在订阅模块展示；本模块不得把 Token 换算成套餐金额额度或将现金余额称为订阅余额。系统未接 Stripe/支付宝/微信，不把内部报表描述为外部支付账单。

## 2. 页面

| 页面 | 路由 | Resource/权限 |
|---|---|---|
| Usage | `/admin/billing/usage` | `usage`、`usage-dashboard`；`billing.read` |
| 账户 | `/admin/billing/accounts` | `billing-accounts`；`billing.read` |
| Ledger | `/admin/billing/ledger` | `ledger`；`billing.read` |
| 报表 | `/admin/billing/reports` | `billing-report`；`billing.read` |
| 调账命令 | 账户详情动作 | `billing.adjust` |
| Payment Intent / Webhook 事件 | 当前由 Product API 与 internal webhook route 提供；暂无独立主导航 | Product session / internal Adapter auth |

## 3. 财务规则

- 金额语义为 integer micro-USD；现有 JSON number 合同只接受 `Number.isSafeInteger(value)` 且绝对值不超过 `9,007,199,254,740,991` 的值，并同时满足字段正负/数据库 bigint 约束。越界、指数/小数、字符串隐式转换或舍入一律 fail-closed 400 `AMOUNT_MICROUSD_INVALID`；UI 可格式化 USD，但不使用浮点回写。未来若需超出 safe-integer，必须版本化改为 canonical decimal-string wire contract，不能静默改变类型。
- Billing Account 保存显式独立现金模式的 available/reserved/lifetime debited；Subscription Allowance 只保存 Token，不归入 Billing Account，也不合并为含糊“余额”。
- 独立现金模式的 Gateway 才执行 micro-USD reserve/capture/release。订阅 Token 用尽返回 Token 402，不能由 `cash_balance` overage 或账户余额继续调用。
- Ledger append-only；退款/纠错的 Target 模型是追加 refund/reversal/adjustment 并双向关联原 entry，不能更新原 entry。当前 Admin API/UI 只提供 credit 命令，尚不提供 debit/refund/reversal 操作入口。
- Usage 使用 Provider final Usage 和 Request 价格快照；未知 Usage 明确 unavailable/settlement_failed。
- 当前 credit API 接收正整数 `amountMicrousd`、reason 与 idempotency key；UI 以最多 6 位小数的 USD 输入，提交前精确换算为整数 micro-USD，并在客户端自动生成幂等键。当前合同没有独立 external ticket 字段，也没有 before/after 预览；工单依据只能写入 reason。不允许直接 PATCH 余额。Target debit/refund/reversal 必须使用独立严格命令并保持同样的幂等、审计与只追加约束。
- 任何金额 request/response 的真值字段均为 integer `*_microusd`；字符串 USD 只是显示投影，禁止浮点作为传输或守恒真值。

## 4. Payment/订阅支付（Implemented boundary）

`PaymentAdapter`、Intent、refund/reversal contract、Webhook 签名、event store 和仅测试环境 Fake Adapter 已实现。付费首次开通与到期续费只有在已验证 `payment.succeeded` Webhook 后才激活/推进周期；重复点击复用 live Intent，重复事件不重复写。Stripe、支付宝、微信、银行等真实渠道仍 Deferred。

## 5. 数据映射

本模块权威表包括 `billing_accounts`、`billing_ledger_entries`、`gateway_requests`、`subscription_payment_intents`、`payment_webhook_events` 与 `subscription_payment_adjustments`；`subscription_usage_allowances` 属于 Subscription。Billing transaction 位于 `app/lib/billing/**`，支付协调位于 `app/lib/payments/**`。

## 6. 验收

- BIL-01：同一个 Request 的 reserve/capture/release 与 Ledger 可追溯且幂等。
- BIL-02：Subscription Token Allowance 不进入 Billing Account/Ledger 金额汇总；订阅开通、续期和换版不增加任何 monetary reserved/consumed/debited。
- BIL-03：并发捕获不能透支；version/余额冲突返回 409。
- BIL-04：Ledger/Usage 无 PATCH/DELETE；当前 credit 重复幂等键不重复入账；未实现的 debit/reversal 不应出现在当前 UI/API。
- BIL-05：报表展示筛选、时区、币种和换算规则；不可用显示 503，不显示伪 0。
- BIL-06（Target release gate）：独立现金模式 reserve/capture/release/refund/reversal 在失败、取消、usage 缺失、并发和重试下保持单一财务结果；available/reserved 不为负。Token 守恒由 Subscription 测试独立证明。
- BIL-07：Payment/Webhook 重复投递不重复激活；Fake 生产 fail closed；无真实网络请求。
- BIL-08（Implemented / release candidate）：`/api/product/v1/me/usage` 只返回 canonical user 当前/历史用户周期的 Token Usage，强制用户隔离、服务端分页、稳定 total 和不可变投影；Dream 产品 API 不提供现金 Ledger endpoint。生产大分页/Session 冒烟仍待执行。

交互验收映射：BIL-01/02/06 → UI-BIL-01；BIL-03/04 → UI-BIL-02/03；BIL-05 → UI-BIL-04；BIL-07/08 → Dream Payment/Usage。不得把测试 Adapter 宣称为外部支付闭环。
