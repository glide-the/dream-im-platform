# ink-dream-memory PostgreSQL、订阅计费与 Gateway 改造总索引

> 文档状态：**Current**（权威入口）  
> 更新：2026-08-09  
> 目标项目：`/Users/dmeck/project/ink-dream-memory`  
> 编写位置：`/Users/dmeck/project/ink-admin-memory/docs/architecture/ink-dream-memory/`  
> 事实基线：[处理判断](../../verification/ink-dream-memory-pg-billing-gateway-treatment-decision.md)

## 1. 当前范围决策

Round 29–30 已替代 Round 24–28 的“全面延期”决定。当前主线同时包含：

1. Dream 主库 43 表与 Notion Connector 5 表全量迁入统一 PostgreSQL `ink-memory`；Dream 运行时最终不保留 SQLite、JSON DB 或内存数据库回退。
2. canonical PostgreSQL `users` 继续作为唯一平台用户全集；每个用户自动投影内部 billing identity 与一对一 Billing Account，不存在“创建计费用户”产品流程。
3. Admin 完成 Plan Version、Entitlement、Subscription、Allowance/Balance、Gateway、Usage/Ledger 与 Payment Adapter 控制面闭环；Dream 只通过产品 API 展示/提交命令。
4. Dream 既有 Claude Agent、Dream、Chat、Workflow 与受支持模型调用分阶段切入 Admin Gateway，浏览器不持有 Gateway Key 或 Provider Secret。
5. 标准 `PaymentAdapter`、Webhook 签名边界、事件幂等存储和 test-only Fake Adapter进入 **Planned**；真实 Stripe、支付宝、微信支付、银行等第三方渠道保持 **Deferred**。
6. ASR 仅在 Gateway 具备 streaming-audio capability、计量和结算合同后接入；此前 ASR Gateway 是 **Deferred**，当前未鉴权 WebSocket 必须先禁用或完成 canonical 鉴权、Origin、限流和审计。

## 2. 能力状态

| 能力 | 当前状态 | 目标状态 | 权威文档 |
|---|---|---|---|
| Dream SQLite 43+5 | **Current**：两套 SQLite、25 个主库 trigger、深度方言耦合 | **Planned**：Dream Alembic、Repository/UoW、全量迁移与 PG-only runtime | [01](01-current-scope-and-source-baseline.md)、[04](04-postgresql-migration-plan.md) |
| Admin canonical 三表 | **Implemented baseline**：已有 `users/workspaces/stories` DDL 与三表导入器 | **Planned**：结构对齐后由 Dream baseline adopt；导入器扩展为 Dream-owned 48 表工具 | [04](04-postgresql-migration-plan.md) |
| 用户与计费身份 | **Partial**：canonical-driven projection 已有，但 Gateway 反查、分页和 orphan 仍有缺口 | **Planned**：全用户自动映射/account，205-user 搜索分页验证 | [02](02-business-integration-and-admin-boundary.md)、[06](06-billing-subscription-gateway-integration.md) |
| Subscription/Billing/Gateway | **Implemented baseline / Partial** | **Planned**：完整状态机、严格资格、结算终态、产品 API | [06](06-billing-subscription-gateway-integration.md) |
| Dream 订阅与 Usage 页面 | **Current defect**：静态三档套餐，不是真实订阅 | **Planned**：只渲染 Admin 产品 API 的计划、状态、额度、余额和用量 | [03](03-page-refactor-checklist.md)、[07](07-dream-subscription-and-inference-integration.md) |
| Dream 推理链 | **Current**：PolyAgent、Claude Agent、Image 等直连/本地配置 | **Planned**：server-only Gateway client、stable alias、用户 canary | [07](07-dream-subscription-and-inference-integration.md) |
| Payment 边界 | **Current**：未实现 | **Planned**：adapter/interface、event store、签名与重放幂等、Fake test adapter | [08](08-payment-adapter-and-webhook-boundary.md) |
| 真实支付渠道 | **Deferred** | 渠道、商户、税务和合规明确后独立立项 | [90](90-deferred-billing-subscription-inference-payment.md) |
| ASR Gateway | **Deferred** | 具备 streaming-audio capability 与计量/结算合同后另行转 Planned | [07](07-dream-subscription-and-inference-integration.md)、[90](90-deferred-billing-subscription-inference-payment.md) |

同一能力不能同时出现在 Planned 与 Deferred。`90-deferred-*` 是历史决策入口和当前窄化延期清单，不再覆盖已重新启用的 Subscription、Billing、文本/图像 Gateway 或 Payment 边界。

## 3. 文档导航

| 文档 | 状态 | 回答的问题 |
|---|---|---|
| [01-current-scope-and-source-baseline.md](01-current-scope-and-source-baseline.md) | **Current** | 两个项目当前真实实现、43+5 表、推理入口与缺口是什么 |
| [02-business-integration-and-admin-boundary.md](02-business-integration-and-admin-boundary.md) | **Planned** | Dream/Admin/Gateway 如何共享事实又保持最小权限 |
| [03-page-refactor-checklist.md](03-page-refactor-checklist.md) | **Planned** | Dream 哪些页面保留、改造、增加真实数据状态或禁止假数据 |
| [04-postgresql-migration-plan.md](04-postgresql-migration-plan.md) | **Planned** | 48 表如何 baseline adopt、迁移、验证和切换 |
| [05-release-rollout-and-rollback.md](05-release-rollout-and-rollback.md) | **Planned** | PG、产品 API、Gateway 与支付边界的分阶段门禁和回滚是什么 |
| [06-billing-subscription-gateway-integration.md](06-billing-subscription-gateway-integration.md) | **Planned** | 产品链、资格判断、结算、API 与错误合同是什么 |
| [07-dream-subscription-and-inference-integration.md](07-dream-subscription-and-inference-integration.md) | **Planned** | Dream 如何展示订阅并安全迁移既有推理调用 |
| [08-payment-adapter-and-webhook-boundary.md](08-payment-adapter-and-webhook-boundary.md) | **Planned** | Payment Adapter、Webhook、幂等、退款/冲正如何建模 |
| [90-deferred-billing-subscription-inference-payment.md](90-deferred-billing-subscription-inference-payment.md) | **Deferred / Superseded history** | 哪些能力仍延期，历史全面延期为何已失效 |
| [91-evidence-and-legacy-map.md](91-evidence-and-legacy-map.md) | **Current** | 事实证据、旧文档和当前权威入口如何对应 |

## 4. 目标总链路

```mermaid
flowchart LR
  U["Canonical User"] --> B["Billing Account"]
  B --> S["Subscription"]
  S --> V["Plan Version"]
  V --> E["Entitlement"]
  E --> M["Model Permission"]
  M --> A["Allowance / Balance"]
  A --> G["Gateway Request"]
  G --> T["Token Usage"]
  T --> L["Ledger"]
```

Dream 不复制 Plan、Subscription、Usage、Ledger 或 Pricing 真值，也不直接写 Admin 控制面表。Dream 浏览器只访问 Dream 服务端；Dream 服务端以受控服务身份调用 Admin 产品 API与 Gateway。

## 5. 所有权摘要

| 领域 | 逻辑所有者 | 约束 |
|---|---|---|
| Dream canonical 43+5 Schema、Repository、业务写、Alembic | Dream | Admin 仅批准读取、白名单更新或领域命令；无通用硬删 |
| Admin/RBAC/Audit、Provider/Model/Pricing、Subscription/Billing/Gateway/Usage/Ledger/Payment | Admin / Gateway | Dream 只经产品 API/Gateway；不直接写表 |
| `users` | Dream canonical User 领域 | 唯一用户全集；`platform_users` 仅内部兼容映射 |
| physical PostgreSQL owner/ACL | 目标环境 DBA/审批流程 | 本文逻辑所有权不授权 `ALTER OWNER`、GRANT 或 REVOKE |

## 6. 发布阻断项

- 48 表 Alembic、Repository、迁移器和 validator 未齐，或 Dream runtime 仍能打开 SQLite。
- canonical 用户反查、超过 100 用户服务端搜索分页、orphan billing identity 隔离未通过。
- Subscription 生命周期、Allowance 守恒、Gateway reserve/capture/release 与 Usage/Ledger 终态未通过隔离 PG 并发测试。
- Dream 订阅页仍含静态套餐/假价格/假余额，或浏览器能取得 Gateway/Provider/Payment Secret。
- 已提交 Provider credential 未由密钥所有者确认吊销/轮换并完成代码移除与 secret scan。
- 未鉴权 ASR WebSocket 未禁用或未补 canonical 鉴权、Origin、限流和审计。
- Payment Fake Adapter 可在生产启用，或重复 Webhook 能重复开通/扣费。
- 1440×1000、390×844 focused E2E、Admin/Dream 全门禁和迁移演练未通过。

## 7. 文档状态规则

- **Current**：可由当前代码/Schema/只读证据复核的事实。
- **Implemented**：已有实现且仍需按 Release Gate 验证；不等于整条链已完成。
- **Planned**：已批准进入本轮设计和实现，但尚未通过最终验收。
- **Deferred**：明确不在当前实现范围；当前仅真实第三方支付渠道与未具备 capability 的 ASR Gateway。
- **Superseded**：历史方案被当前入口替代，只用于追溯。

最终状态以代码、隔离测试和发布回执为准，不能因文档写成目标合同就声称已实现。
