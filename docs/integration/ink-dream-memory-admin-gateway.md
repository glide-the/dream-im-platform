# Ink Memory Admin 与模型网关接入

> 状态：**Deferred / 历史入口（2026-08-09）**
> 本页不代表 Dream 当前已接入或需要接入 Gateway。

## 当前决策

Dream 本期不开发新推理服务，不切换到 Admin Gateway，也不新增 Provider、Model Alias、Gateway Key、Token 配额、Usage/Ledger 或对应错误处理。Dream 现有 Claude Agent、Dream、Chat、Workflow 与模型设置保持原有产品行为，只参与 PostgreSQL 持久化回归。

## 当前权威入口

- [Dream 后续改造总索引](../architecture/ink-dream-memory/README.md)
- [页面改造清单](../architecture/ink-dream-memory/03-page-refactor-checklist.md)
- [延期领域与未来触发条件](../architecture/ink-dream-memory/90-deferred-billing-subscription-inference-payment.md)

## 历史处理

原文件中的 Gateway 调用入口、管理流程、Key、错误码和 Story CRUD 描述只保留在 Git 历史。未来若独立立项，必须重新审计当时的 Admin Gateway、Dream Session、canonical 用户、安全和 SLA 合同，不能直接恢复旧步骤。
