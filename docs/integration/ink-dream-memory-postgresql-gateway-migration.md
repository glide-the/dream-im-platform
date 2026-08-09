# ink-dream-memory PostgreSQL 与计费网关接入建议

> 状态：**Superseded / 已拆分（2026-08-09）**
> 本页不是当前迁移执行基线。

## 当前决策

旧方案把 PostgreSQL、计费和 Gateway 混成一份执行单，现已按所有权和 release gate 拆分：

- PostgreSQL 43+5 全量迁移、计费/订阅协作、真实 Dream 订阅体验、Gateway 与新推理链均进入 Planned/Implementation scope，但必须按文档顺序逐门禁实现。
- 真实第三方支付渠道仍 Deferred；只实现标准 Adapter、Webhook 幂等边界和测试环境 Fake Adapter。

## 当前权威入口

- [Dream 后续改造总索引](../architecture/ink-dream-memory/README.md)
- [PostgreSQL 迁移方案](../architecture/ink-dream-memory/04-postgresql-migration-plan.md)
- [发布、验证与回滚](../architecture/ink-dream-memory/05-release-rollout-and-rollback.md)
- [Billing / Subscription / Gateway](../architecture/ink-dream-memory/06-billing-subscription-gateway-integration.md)
- [Dream 订阅与推理接入](../architecture/ink-dream-memory/07-dream-subscription-and-inference-integration.md)
- [Payment Adapter 与 Webhook](../architecture/ink-dream-memory/08-payment-adapter-and-webhook-boundary.md)

## 历史处理

原文件中的 SQLite→PG 研究已校正并纳入当前迁移方案；Gateway、Billing、Key 和推理切换由新的 06/07 文档接管，真实支付渠道由 08/90 记录为 Deferred。旧正文仅通过 Git 历史追溯，不得作为当前命令或发布清单执行。
