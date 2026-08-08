# Ink Dream 订阅与 Gateway 接入改造清单

> 状态：**Deferred / 历史入口（2026-08-09）**
> 本页不是当前 API、页面、环境变量、迁移或验收清单。

## 当前决策

Dream 当前不开发计费、订阅、订阅支付、推理服务或 Gateway 接入。当前唯一实施主线是 Dream 真实业务持久化迁入 PostgreSQL `ink-memory`，并清理会误导用户的静态订阅入口。

产品身份规则保持明确：canonical `users` 是唯一平台用户全集；未来若重新立项，每个平台用户都天然是计费主体，不存在单独“计费用户”或手工开户流程。

## 当前权威入口

- [Dream 后续改造总索引](ink-dream-memory/README.md)
- [业务数据接入与 Admin 边界](ink-dream-memory/02-business-integration-and-admin-boundary.md)
- [页面改造清单](ink-dream-memory/03-page-refactor-checklist.md)
- [延期领域与重新立项条件](ink-dream-memory/90-deferred-billing-subscription-inference-payment.md)

## 历史处理

本文件原有套餐、Billing API、Gateway Key、模型 Alias、Usage、支付和上线步骤已被当前范围决策替代，只能通过 Git 历史用于研究。不得复制其中接口名、环境变量或实施顺序开展当前 Dream 工作；未来重新立项时必须从当时真实代码、安全边界和独立 PRD 重新审计。
