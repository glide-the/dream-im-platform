# ink-dream-memory PostgreSQL 与计费网关接入建议

> 状态：**Superseded / 已拆分（2026-08-09）**
> 本页不是当前迁移执行基线。

## 当前决策

旧方案把 PostgreSQL、计费和 Gateway 捆绑在同一次 Dream 改造中，现已拆分：

- PostgreSQL 是当前唯一实施主线，使用独立的全量迁移、验证、切换和回滚方案。
- 计费、订阅、订阅支付、推理服务和 Gateway 全部延期；当前不得配置 Key、模型代理、Billing API 或支付变量。

## 当前权威入口

- [Dream 后续改造总索引](../architecture/ink-dream-memory/README.md)
- [PostgreSQL 迁移方案](../architecture/ink-dream-memory/04-postgresql-migration-plan.md)
- [发布、验证与回滚](../architecture/ink-dream-memory/05-release-rollout-and-rollback.md)
- [延期领域](../architecture/ink-dream-memory/90-deferred-billing-subscription-inference-payment.md)

## 历史处理

原文件中的 SQLite→PG 研究已校正并纳入当前迁移方案；Gateway、充值、Key 和推理切换步骤已移入 Deferred 决策。旧正文仅通过 Git 历史追溯，不得作为当前命令或发布清单执行。
