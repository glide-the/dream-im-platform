# Deferred：计费、订阅、推理服务与订阅支付

> 状态：**延期，未排期，不是当前实施清单**  
> 返回：[总索引](README.md)  
> 主要读者：产品、架构、后续项目负责人

## 1. 延期决策

以下 Dream 能力暂不开发：

- 计费账户、余额、充值、Usage、Ledger、账单预览或导出；
- 套餐、Plan Version、Entitlement、Allowance、订阅生命周期、自助升降级/暂停/取消；
- Stripe、支付宝、微信或其他订阅支付、收银台、Webhook、退款、发票；
- Dream → Admin Gateway、Provider/Model Alias 目录、Gateway Key、推理请求日志；
- 新的模型推理服务、路由、配额、Token 限流和对应错误页面。

本期没有这些领域的 Dream API、类型、Hook、页面、环境变量、数据库表或验收任务。

## 2. 与既有能力的关系

- Admin 仓库中已经存在的 Subscription/Billing/Gateway/Provider 能力不因本决定删除；只是 Dream 本期不接入、不展示、不依赖。
- Dream 已有 Claude Agent、Dream、Chat、Workflow 和模型设置继续按现状运行；PostgreSQL 项目只保证持久化迁移回归，不替换其推理传输。
- 若未来重新启用计费，canonical `users` 全集中的每个平台用户都天然是计费主体；不存在独立的“计费用户”产品实体、名册、筛选入口或手工开户流程。`platform_users` 只能作为内部兼容/映射键，不能成为第二套用户源。
- 若任一页面或查询只把 `qa-author@ink-memory.test` 等单个测试账号显示为“计费用户”，应判定为数据投影、查询范围或测试种子缺陷，而不是有效产品状态；未来重新立项时必须从 canonical `users` 全集做服务端分页与搜索。
- `platform_users`、`billing_accounts`、`subscriptions`、`gateway_*`、`billing_ledger_entries` 等控制面表不进入 Dream Repository。
- Dream 静态 `StoryWorkspaceSubscriptionPage` 不构成真实订阅能力；当前页面改造仅隐藏入口或安全重定向，见 [页面清单](03-page-refactor-checklist.md)。

## 3. 当前明确禁止的工作

- 不创建 `/v1/billing/**` 或 Dream billing proxy。
- 不在 Dream 部署中新增 Gateway Base URL/Key、Payment Secret 或 Webhook Secret。
- 不把静态套餐数组替换成 Admin Plan API。
- 不显示“支付成功”“余额不足”“额度耗尽”“订阅已激活”等无真实合同状态。
- 不把现有 Token usage metadata 当作可结算 Usage/Ledger。
- 不让浏览器、Dream 数据库或日志保存 Provider Secret/Gateway Key。
- 不以“预留接口”为由在当前 PG migration 中新增这些领域表。

## 4. 未来重新立项的最低触发条件

只有以下条件全部具备，才能从 Deferred 转为 Planned：

1. 产品批准独立 PRD，明确免费/付费策略、用户价值、角色、生命周期和客服流程。
2. 明确推理服务是否通过 Admin Gateway，以及用户级/环境级 Key 和租户隔离模型。
3. Subscription/Billing/Gateway 当前已知 P0/P1 风险关闭并通过独立安全审计。
4. 用户身份、PostgreSQL canonical 数据和 Dream Session 的服务间认证合同稳定。
5. 支付涉及的商户、税务、退款、对账、Webhook 幂等、隐私和合规责任已确认。
6. API 错误合同、SLA、监控、灰度、回滚和客服文案完成。
7. Dream 前后端、Admin、QA、运维分别有 Owner 与可执行测试环境。

## 5. 未来研究输入，不是承诺

历史文档 [ink-dream-subscription-integration-change-list.md](../ink-dream-subscription-integration-change-list.md) 曾描述套餐、Gateway、Usage 和支付适配候选。其内容仅作为研究输入；任何接口名、环境变量、页面和上线顺序都必须在重新立项时从当前代码重新审计，不得直接复制实施。

Admin 当前相关领域合同可从以下文档了解，但不进入本期 Dream 验收：

- [Subscription PRD](../../prd/modules/03-subscriptions.md)
- [Model Catalog PRD](../../prd/modules/04-model-catalog.md)
- [Gateway PRD](../../prd/modules/05-gateway.md)
- [Billing PRD](../../prd/modules/06-billing.md)

## 6. Deferred 验收

- 当前 Dream 改造清单和 PG migration 不含上述领域的实施步骤。
- Dream 页面无静态假套餐、交易 CTA 或付费状态。
- 现有 Dream 推理行为未被本期数据库工作意外修改。
- 未来负责人能找到历史输入，但不会误解为已排期或已批准。
