# 历史延期入口：仅真实支付渠道与 ASR Gateway 仍 Deferred

> 文档状态：**Deferred**（真实第三方支付渠道、ASR Gateway）/ **Superseded**（Billing、Subscription、PaymentAdapter、Webhook、文本推理 Gateway 全面延期的旧决定）
> 更新：2026-08-09 Round 46

## 1. 状态纠偏

Round 24–28 的全面延期决定已被后续实现替代，不能再用于阻止以下当前能力：

| 能力 | 当前状态 |
|---|---|
| Dream 43+5 PostgreSQL | **Implemented / local cutover complete**：48 表、4,921 行、PG-only runtime |
| canonical 用户投影 | **Implemented / Release candidate**：canonical `users` 是唯一用户全集 |
| Token-only 月订阅与 Gateway | **Implemented / Release candidate** |
| PaymentAdapter / Payment Intent / Webhook event store / Fake Adapter | **Implemented / Release candidate**：Admin migrations `0022–0024`，Fake 仅测试环境 |
| Dream 付费首次开通与月度续费体验 | **Implemented / Release candidate**：等待已验证 Webhook，不伪造成功；付费到期不免费发 Token |
| 真实第三方支付渠道 | **Deferred** |
| ASR Gateway | **Deferred** |

## 2. 当前真正 Deferred：真实支付渠道

本轮没有接入 Stripe、支付宝、微信支付、银行或其他真实网络，也没有生产商户、真实收银台、税务/发票、争议/chargeback 或生产退款网络。

转 Planned 至少需要指定渠道、商户主体、地区/币种、退款/争议责任、SDK 与 Webhook 安全评审、sandbox/生产 Secret 管理、reconciliation、SLA、监控和回滚。平台核心表不会把第三方专有字段设为必填真值。

当前已实现的 Adapter 合同、测试 Fake、签名验证、event ID 幂等、refund/reversal 合同和事件存储不是 Deferred；生产启用 Fake 必须 fail closed。

## 3. 当前真正 Deferred：ASR Gateway

ASR 仍 Deferred 仅指通过计费 Gateway 路由/计量/结算 streaming audio。转 Planned 前必须定义：

1. streaming-audio capability；
2. 输入时长/字节/音频 Token 与输出计量单位；
3. reserve/capture/release、断线、partial transcript 与 usage 缺失语义；
4. WebSocket backpressure、cancel、rate limit、retention 与隐私；
5. Entitlement、模型权限、Allowance 与错误合同测试。

匿名或未授权 ASR endpoint 不能因为 Gateway Deferred 而继续开放。

## 4. 仍禁止的伪实现

- 静态套餐、静态价格、假余额、默认模型数组或依赖失败时的本地真值 fallback。
- 创建 Payment Intent 后立即显示“支付成功”或激活订阅。
- 浏览器持有 Gateway Key、Provider Secret、Payment Secret、Webhook Secret 或服务凭据。
- 生产环境启用 Fake Adapter，或调用未批准的真实支付网络。
- Token 耗尽后自动转入现金超额。
- 未具备 audio capability 就把 ASR 记成 Gateway 结算成功。

## 5. 当前权威入口

- [PG 全量迁移](04-postgresql-migration-plan.md)
- [Token-only Subscription/Gateway](06-billing-subscription-gateway-integration.md)
- [Dream 产品与推理集成](07-dream-subscription-and-inference-integration.md)
- [PaymentAdapter/Webhook](08-payment-adapter-and-webhook-boundary.md)
- [发布与回滚](05-release-rollout-and-rollback.md)

旧文档、旧表述或旧验收若把 PaymentAdapter/Webhook/Fake 全部标为 Deferred，以本文件和 `08` 的当前代码证据为准。
