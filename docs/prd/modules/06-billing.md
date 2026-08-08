# 模块 PRD：Usage、计费账户、Ledger 与报表

> 返回：[平台 PRD 总纲](../ink-memory-admin-prd-v3.md) · 交互：[账务运营](../../design/modules/06-billing.md)

> 实现状态：Usage Dashboard、账户、Ledger、报表、当前筛选 CSV 与受审计 credit 已实现；debit/reversal 管理命令和外部支付账单未实现。

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
- Ledger append-only；退款/纠错的目标模型是追加 refund/reversal/adjustment，不能更新原 entry。当前 Admin API/UI 只提供 credit 命令，尚不提供 debit/reversal 操作入口。
- Usage 使用 Provider final Usage 和 Request 价格快照；未知 Usage 明确 unavailable/settlement_failed。
- 当前 credit API 接收正整数 `amountMicrousd`、reason 与 idempotency key；UI 以最多 6 位小数的 USD 输入，提交前精确换算为整数 micro-USD，并在客户端自动生成幂等键。当前合同没有独立 external ticket 字段，也没有 before/after 预览；工单依据只能写入 reason。不允许直接 PATCH 余额。未来 debit/reversal 必须使用独立严格命令并保持同样的幂等、审计与只追加约束。

## 4. 数据映射

`billing_accounts`、`billing_ledger_entries`、`gateway_requests`、`subscription_usage_allowances`。Billing transaction 位于 `app/lib/billing/**`；报表和 Dashboard 只聚合真实全量事实，不用当前分页行伪装总量。

## 5. 验收

- BIL-01：同一个 Request 的 reserve/capture/release 与 Ledger 可追溯且幂等。
- BIL-02：Allowance 与 cash 分栏展示，token allowance 不增加 monetary consumed。
- BIL-03：并发捕获不能透支；version/余额冲突返回 409。
- BIL-04：Ledger/Usage 无 PATCH/DELETE；当前 credit 重复幂等键不重复入账；未实现的 debit/reversal 不应出现在当前 UI/API。
- BIL-05：报表展示筛选、时区、币种和换算规则；不可用显示 503，不显示伪 0。

交互验收映射：BIL-01/02 → UI-BIL-01；BIL-03/04 → UI-BIL-02/03；BIL-05 → UI-BIL-04。debit/reversal 属于后续目标，不进入当前 release gate。
