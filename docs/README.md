<!-- [Input] Repository documentation tree and current product/architecture decisions. -->
<!-- [Output] Canonical entry points for current design, architecture, deployment, and verification documents. -->
<!-- [Pos] Root documentation inventory; historical documents are explicitly separated from current contracts. -->
<!-- [Sync] 2026-09-04: index the final deployment-gated Go contract for product Device authorization and managed credentials. -->

# 文档索引

## 当前执行入口

- [Ink Memory Admin PRD v3](prd/ink-memory-admin-prd-v3.md)
- [Ink Memory Admin 全局交互规范 v3](design/refine-admin-ui-v3-interaction-design.md)
- [ink-dream-memory 后续改造总索引](architecture/ink-dream-memory/README.md)
- [ink-dream-memory PostgreSQL 迁移方案](architecture/ink-dream-memory/04-postgresql-migration-plan.md)
- [ink-dream-memory Billing / Subscription / Gateway 架构](architecture/ink-dream-memory/06-billing-subscription-gateway-integration.md)
- [ink-dream-memory 产品交互设计](design/ink-dream-memory/README.md)
- [项目架构设计说明](architecture/项目架构设计说明.md)
- [数据库 Package 与内嵌 PostgreSQL](architecture/database-package-and-embedded-postgresql.md)
- [部署指南](deploy.md)
- [Dream Claude Agent 资源 Observer 与 Admin 控制台设计](design/dream-agent-resource-observer-console.md)
- [模型提供方认证能力与凭据生命周期](design/provider-authentication-capability-and-credential-lifecycle.md)

## Dream 当前范围

Dream 主库 43 表与 Notion Connector 5 表的 PostgreSQL 全量迁移、真实订阅展示、计费协作、Gateway 与新推理调用链现为 Planned/Implementation scope；Admin 现有控制面能力须按 Current / Target / Release Gate 逐项补齐。真实第三方支付渠道仍 Deferred，只实现 PaymentAdapter、Webhook 幂等边界与测试环境 Fake Adapter。范围状态以 [Dream 总索引](architecture/ink-dream-memory/README.md) 为准，历史延期决定见 [范围变更入口](architecture/ink-dream-memory/90-deferred-billing-subscription-inference-payment.md)。

## 历史与验证

- [Dream 数据接入审计](verification/ink-dream-memory-data-integration-audit.md)
- [Dream PG / Billing / Gateway 处理判断](verification/ink-dream-memory-pg-billing-gateway-treatment-decision.md)
- [Dream 证据与旧文档映射](architecture/ink-dream-memory/91-evidence-and-legacy-map.md)
- [工作日志](verification/ink-memory-admin-correction-worklog.md)

`docs/task`、`docs/exec`、`docs/stage`、`docs/issue` 及已标记 Superseded/Deferred 的旧 Gateway、计费和 Refine 文档只作为历史执行证据，不再代表 Dream 当前范围或实施顺序。
