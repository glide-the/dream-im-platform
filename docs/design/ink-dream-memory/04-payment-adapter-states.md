# 04 · Token 月订阅支付状态

> 文档状态：**Implemented / Release candidate**
> 真实第三方支付页面与渠道：**Deferred**

## 页面目标

Dream `/story-workspace/subscription` 让当前 canonical 用户查看真实月费并发起自己的订阅 Payment Intent。页面不是收银台，不采集卡号、钱包、二维码或 Secret；所有事实来自 Admin Product API。

## 数据与控件

| 区域 | 数据/API | 控件与规则 |
|---|---|---|
| 套餐卡 | `GET /api/story-workspace/subscription/plans` | 展示版本、每月 Token、权益、整数 micro-USD 格式化月费；禁止静态价格 |
| 影响预览 | subscription command preview | 显示目标月费、Token/模型变化、应用时点；用户确认后才继续 |
| Payment Intent | `POST .../payment-intents` | 价格大于零的首次开通或到期续费创建 Intent；携带 Idempotency-Key；不直接显示成功 |
| 支付状态 | `GET .../payment-intents/{id}` | 展示 `requires_action/processing/succeeded/failed/cancelled/refunded/reversed` 与 request ID |
| 测试环境 | `nextAction=test_webhook` | 明示等待签名测试 Webhook；页面不能自行发送或伪造成功事件 |
| 真实渠道 | `nextAction=redirect` | 仅接受服务端返回的 HTTPS URL；当前没有渠道，因此不出现该状态 |

## 状态与恢复

- loading：保持页面结构和可访问状态文本，不显示假价格。
- empty：无已发布套餐或无订阅时给出真实空态。
- `requires_action`：等待 Adapter 动作；测试环境显示“等待签名测试 Webhook”。
- `processing`：允许刷新，不重复创建 Intent。
- `past_due`：保持原周期与已消耗事实，不发下一期 Token；只提供续费 Intent。
- `succeeded`：重新读取 Subscription context；只有服务端已经激活才显示订阅成功事实。
- `failed/cancelled`：显示错误码与重试入口，不保留虚假订阅。
- `refunded/reversed`：只读显示终态并重新读取资格。
- 401/403/404/409/429/502/503：使用 Product API 安全错误合同和 request ID；不 fallback 到静态套餐或 Fake 成功。

## 响应式与可访问性

- 1440×1000：支付回执位于页头事实区，套餐与影响信息保持可扫描层级。
- 390×844：单列，无水平页面溢出；表格自身可横向滚动。
- Dialog 使用语义 heading、label、checkbox；打开后焦点进入标题，Escape 关闭并恢复触发按钮。
- 状态变化通过 `aria-live` 宣告；错误使用 `role=alert`；刷新按钮有明确 disabled/loading 文案。
- Secret、Authorization、Webhook signature、原始 payload 不进入 DOM、Storage、analytics 或截图。

## 验收

- 付费开通只产生一个 Payment Intent，订阅仍为空直到已验证 Webhook。
- 付费续费复用同一 Subscription/period 的 live Intent，订阅保持 `past_due` 直到已验证 Webhook，成功后只推进一个周期并发放一次 Allowance。
- 重复点击/重放由 Idempotency-Key 与服务端唯一约束去重。
- 1440×1000 付费开通、1440×1000 付费续费、1440×1000 既有订阅升级、390×844 焦点/溢出四条 Playwright 场景通过。
- 未接真实渠道时，不显示渠道 logo、付款表单或“支付成功”。
