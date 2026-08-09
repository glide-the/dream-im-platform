# 模块 PRD：Usage、计费账户、Ledger 与报表

> 返回：[平台 PRD 总纲](../ink-memory-admin-prd-v3.md) · 交互：[账务运营](../../design/modules/06-billing.md)

> 实现状态：Usage Dashboard、账户、Ledger、报表、当前筛选 CSV 与受审计 credit 已实现；debit/reversal 管理命令和外部支付账单未实现。

## 0. Current / Target / Release Gate

| 分层 | 范围 |
|---|---|
| Current | Usage/账户/Ledger/报表/CSV/credit 基线；现有结算错误地允许 Subscription money allowance/cash overage，且无 debit/refund/reversal 命令、Dream 产品 Usage/Ledger API，已 settle Usage/Request 的终态 DB guard 仍待补。 |
| Target | Subscription Token Allowance 与本模块完全分域；本模块只处理 Provider Pricing、显式独立现金模式、micro-USD 账户与 append-only Ledger，reserve/capture/release/refund/reversal 事务化幂等。 |
| Release Gate | Token 与 micro-USD 字段/错误/页面分离、整数传输、独立现金账户守恒、并发不透支、重放不重复入账及 Usage/Ledger/Audit 不可变测试通过；订阅开通/续期/换版不产生金额事实。Payment/Webhook 不在本期 gate。 |

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
| Payment 协作 / Webhook 事件 | Deferred；不进主导航、不提供路由 | 未立项 |

## 3. 财务规则

- 金额为 integer micro-USD；UI 可格式化 USD，但不使用浮点回写。
- Billing Account 保存显式独立现金模式的 available/reserved/lifetime debited；Subscription Allowance 只保存 Token，不归入 Billing Account，也不合并为含糊“余额”。
- 独立现金模式的 Gateway 才执行 micro-USD reserve/capture/release。订阅 Token 用尽返回 Token 402，不能由 `cash_balance` overage 或账户余额继续调用。
- Ledger append-only；退款/纠错的 Target 模型是追加 refund/reversal/adjustment 并双向关联原 entry，不能更新原 entry。当前 Admin API/UI 只提供 credit 命令，尚不提供 debit/refund/reversal 操作入口。
- Usage 使用 Provider final Usage 和 Request 价格快照；未知 Usage 明确 unavailable/settlement_failed。
- 当前 credit API 接收正整数 `amountMicrousd`、reason 与 idempotency key；UI 以最多 6 位小数的 USD 输入，提交前精确换算为整数 micro-USD，并在客户端自动生成幂等键。当前合同没有独立 external ticket 字段，也没有 before/after 预览；工单依据只能写入 reason。不允许直接 PATCH 余额。Target debit/refund/reversal 必须使用独立严格命令并保持同样的幂等、审计与只追加约束。
- 任何金额 request/response 的真值字段均为 integer `*_microusd`；字符串 USD 只是显示投影，禁止浮点作为传输或守恒真值。

## 4. PaymentAdapter 与 Webhook（Deferred，非 Subscription 依赖）

| 能力 | 合同 |
|---|---|
| Adapter | 渠道中立 `capabilities/create_intent/authorize/capture/cancel/refund/reverse/verify_webhook`；平台核心只存 adapter code、capability、内部 intent/reference 与安全 external reference。 |
| Webhook event store | 先 verify；仅 verified event 按 adapter + external event ID unique 进 trusted store，保存已脱敏 payload digest、验签/处理状态、attempt、received/processed time 与错误摘要。invalid signature 只写不占 external ID 的安全 ingress Audit；事件无 DELETE，原 payload 按敏感数据政策受保护。 |
| Idempotency | 同 event ID + 同 canonical digest 返回原处理回执；异 digest 409 并写安全 Audit；乱序事件按平台状态机校验，不回退已确认终态。 |
| Fake Adapter | 仅显式 test/dev，可确定模拟 authorized/failed/refunded/reversed；生产启用时 hard fail，无默认成功。 |
| 真实渠道 | Deferred；本阶段不连 Stripe/支付宝/微信支付/银行，不把内部报表称为第三方正式账单。 |

本节只保留未来独立支付域的边界，不授权本期实现 Schema、API、导航或测试成功态。未来 `authorize` 与 `capture` 必须是两个显式幂等 operation；即使 capture 成功，也只能触发独立订单/现金 Ledger 命令，不得向 Subscription Plan/Version/Allowance 写入金额或把支付状态作为 Token 权益生效条件。

Payment/Webhook Target 错误合同：缺失/无效签名统一为 401 `PAYMENT_WEBHOOK_SIGNATURE_INVALID`，已验签但环境不匹配为 403 `PAYMENT_WEBHOOK_ENVIRONMENT_MISMATCH`，引用不存在为 404 `PAYMENT_REFERENCE_NOT_FOUND`，事件/状态冲突为 409 `PAYMENT_WEBHOOK_EVENT_CONFLICT` / `PAYMENT_STATE_CONFLICT`，重放限流为 429 `PAYMENT_REPLAY_RATE_LIMITED`，Adapter 上游为 502 `PAYMENT_ADAPTER_UPSTREAM_FAILURE`，配置不可用为 503 `PAYMENT_ADAPTER_UNAVAILABLE`。错误 JSON 统一使用 camelCase `{error:{code,message,details?},meta:{requestId,retryAfterSeconds?}}`；不在 error 内放 requestId/retryable，不返回签名、Secret 或完整 payload。

## 5. 数据映射

本模块 Current 表为 `billing_accounts`、`billing_ledger_entries`、`gateway_requests`；`subscription_usage_allowances` 属于 Subscription 且 Target 新写只使用 Token 列。Payment intent/reference 和 webhook event store 尚不存在并维持 Deferred。Billing transaction 位于 `app/lib/billing/**`；报表和 Dashboard 只聚合真实全量事实，不用当前分页行伪装总量。

## 6. 验收

- BIL-01：同一个 Request 的 reserve/capture/release 与 Ledger 可追溯且幂等。
- BIL-02：Subscription Token Allowance 不进入 Billing Account/Ledger 金额汇总；订阅开通、续期和换版不增加任何 monetary reserved/consumed/debited。
- BIL-03：并发捕获不能透支；version/余额冲突返回 409。
- BIL-04：Ledger/Usage 无 PATCH/DELETE；当前 credit 重复幂等键不重复入账；未实现的 debit/reversal 不应出现在当前 UI/API。
- BIL-05：报表展示筛选、时区、币种和换算规则；不可用显示 503，不显示伪 0。
- BIL-06（Target release gate）：独立现金模式 reserve/capture/release/refund/reversal 在失败、取消、usage 缺失、并发和重试下保持单一财务结果；available/reserved 不为负。Token 守恒由 Subscription 测试独立证明。
- BIL-07（Deferred）：Payment/Webhook 只有单独立项后才进入 release gate；在此之前无运行时 endpoint、导航、Fake Adapter 或真实网络请求。
- BIL-08（Target release gate）：`/api/product/v1/me/usage` 与 `/api/product/v1/me/ledger` 以 canonical user 强制隔离、服务端分页、稳定 total 和不可变投影返回；不泄露他人财务事实。

交互验收映射：BIL-01/02/06 → UI-BIL-01；BIL-03/04 → UI-BIL-02/03；BIL-05 → UI-BIL-04；BIL-08 → UI-BIL-05。debit/refund/reversal 是 Target，Payment boundary 是 Deferred；未完成前不得宣称外部支付闭环。
