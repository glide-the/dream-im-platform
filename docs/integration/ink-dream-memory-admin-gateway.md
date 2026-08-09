# Ink Memory Admin 与模型网关接入

> 状态：**Superseded / 历史入口（2026-08-09 范围重启）**
> 本页不代表 Dream 当前已经接入 Gateway；当前实施合同由下列权威文档接管。

## 当前决策

Dream 的 Claude Agent、Dream、Chat、Workflow、模型设置与其他已审计推理入口将分波接入 Admin Gateway；浏览器不持 Key，Dream 不保存 Provider Secret，且必须先通过 canonical user、subscription、entitlement、permission、limit、allowance/balance 与结算门禁。本文只作为旧路径墓碑，不定义具体 API。

## 当前权威入口

- [Dream 后续改造总索引](../architecture/ink-dream-memory/README.md)
- [页面改造清单](../architecture/ink-dream-memory/03-page-refactor-checklist.md)
- [Billing / Subscription / Gateway 架构](../architecture/ink-dream-memory/06-billing-subscription-gateway-integration.md)
- [Dream 订阅与推理接入](../architecture/ink-dream-memory/07-dream-subscription-and-inference-integration.md)

## 历史处理

原文件中的 Gateway 调用入口、管理流程、Key、错误码和 Story CRUD 描述只保留在 Git 历史。新的 06/07 文档已经基于当前 Admin Gateway、Dream Session、canonical 用户、安全与结算证据重建合同；不能直接恢复旧步骤。
