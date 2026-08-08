# 模块 PRD：Usage、计费账户、Ledger 与报表

> 返回：[平台 PRD 总纲](../ink-memory-admin-prd-v3.md) · 交互：[账务运营](../../design/modules/06-billing.md)

## 1. 目标与边界

让财务运营、支持和审计人员以 Request 为证据核对 Token、价格快照、Allowance/cash 分摊、余额和账本。系统不假设已接 Stripe/支付宝/微信，不把内部报表描述为外部支付账单。

## 2. 页面

| 页面 | 路由 | Resource/权限 |
|---|---|---|
| Usage | `/admin/billing/usage` | `usage`、`usage-dashboard`；`billing.read` |
| 账户 | `/admin/billing/accounts` | `billing-accounts`；`billing.read` |
| Ledger | `/admin/billing/ledger` | `ledger`；`billing.read` |
| 报表 | `/admin/billing/reports` | `billing-report`；`billing.read` |
| 调账命令 | 账户详情动作 | `billing.adjust` |

## 3. 财务规则

- 金额为 integer micro-USD；UI 可格式化 USD，但不使用浮点回写。
- Billing Account 保存 available/reserved/lifetime debited；Subscription Allowance 单独保存，不合并为含糊“余额”。
- Gateway 先 reserve，完成后 capture/release；允许超额时才从 cash 捕获。
- Ledger append-only；退款/纠错追加 refund/reversal/adjustment，不能更新原 entry。
- Usage 使用 Provider final Usage 和 Request 价格快照；未知 Usage 明确 unavailable/settlement_failed。
- 调账必填正整数、reason、idempotency key，可选 external ticket；不允许直接 PATCH 余额。

## 4. 数据映射

`billing_accounts`、`billing_ledger_entries`、`gateway_requests`、`subscription_usage_allowances`。Billing transaction 位于 `app/lib/billing/**`；报表和 Dashboard 只聚合真实全量事实，不用当前分页行伪装总量。

## 5. 验收

- BIL-01：同一个 Request 的 reserve/capture/release 与 Ledger 可追溯且幂等。
- BIL-02：Allowance 与 cash 分栏展示，token allowance 不增加 monetary consumed。
- BIL-03：并发捕获不能透支；version/余额冲突返回 409。
- BIL-04：Ledger/Usage 无 PATCH/DELETE；调账重复幂等键不重复入账。
- BIL-05：报表展示筛选、时区、币种和换算规则；不可用显示 503，不显示伪 0。

