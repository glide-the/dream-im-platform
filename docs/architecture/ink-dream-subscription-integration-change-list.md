# Ink Dream 订阅与 Gateway 接入改造清单

> 状态：**Superseded / 历史入口（2026-08-09 范围重启）**
> 本页不是当前 API、页面、环境变量、迁移或验收清单。

## 当前决策

Dream 43+5 PostgreSQL 全量迁移、真实订阅展示、计费协作、Gateway 与新推理调用链已重新进入 Planned/Implementation scope；本页仍不恢复为执行清单。真实第三方支付渠道保持 Deferred，只规划 PaymentAdapter、Webhook 幂等边界与测试环境 Fake Adapter。

产品身份规则保持明确：canonical `users` 是唯一平台用户全集；每个平台用户天然是计费主体，不存在单独“计费用户”或手工开户流程。

## 当前权威入口

- [Dream 后续改造总索引](ink-dream-memory/README.md)
- [业务数据接入与 Admin 边界](ink-dream-memory/02-business-integration-and-admin-boundary.md)
- [页面改造清单](ink-dream-memory/03-page-refactor-checklist.md)
- [Billing / Subscription / Gateway 架构](ink-dream-memory/06-billing-subscription-gateway-integration.md)
- [Dream 订阅与推理接入](ink-dream-memory/07-dream-subscription-and-inference-integration.md)
- [Payment Adapter 与 Deferred 渠道](ink-dream-memory/08-payment-adapter-and-webhook-boundary.md)

## 历史处理

本文件原有套餐、Billing API、Gateway Key、模型 Alias、Usage、支付和上线步骤已被新的模块化文档替代，只能通过 Git 历史用于研究。不得复制其中未经当前代码证据验证的接口名、环境变量或实施顺序；执行必须从上列 Current/Target/Release Gate 文档开始。
