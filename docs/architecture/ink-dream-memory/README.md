<!-- [Input] Historical Dream PostgreSQL cutover evidence plus the current Admin auth/data-service contract. -->
<!-- [Output] One indexed reading order that separates the current Admin-only database boundary from dated migration evidence. -->
<!-- [Pos] Cross-project architecture index; current authority is the unified auth/data contract, while numbered files retain history. -->
<!-- [Sync] 2026-09-16: supersede Dream runtime PostgreSQL ownership with Admin DTO/Service/typed Repository/Drizzle ownership. -->

# ink-dream-memory PostgreSQL、Token 订阅与 Gateway 改造总索引

> 文档状态：**Current index / historical migration evidence**（当前认证与数据库边界见下方；编号稿保留实施历史）
> 更新：2026-09-16
> 目标项目：`/Users/dmeck/project/ink-dream-memory`  
> 编写位置：`/Users/dmeck/project/ink-admin-memory/docs/architecture/ink-dream-memory/`  
> 事实基线：[处理判断](../../verification/ink-dream-memory-pg-billing-gateway-treatment-decision.md)

> **Schema 权威更新（2026-08-12）**：本文中关于“Dream Alembic 拥有 DDL”以及 `Admin 0000–0026 → Dream Alembic → Admin 0027+` 的内容已被 [统一 PostgreSQL Schema 权威](../database-schema-authority.md)替代。历史数据与发布回执仍按原时点保留。

> **统一认证与数据访问更新（2026-09-16）**：当前方案由 [Admin/Dream 认证与数据接口契约](../admin-dream-auth-data-contract.md) 和 [数据区域方案](../admin-dream-data-ownership.md)定义。Admin 是唯一 Better Auth authority 和 PostgreSQL 访问服务；Dream 生产进程没有 PostgreSQL DSN、driver、SQL、ORM、UOW 或 DDL 路径，只通过严格 Pydantic DTO 调用 Admin 的 Zod DTO → Domain Service → typed Repository → Drizzle 操作。本文及编号稿中的 Dream Repository、Dream PG role、Alembic 和 `DATABASE_URL` 描述是迁移历史，不是现行部署合同。

## 1. 当前范围决策

Round 29–30 已替代 Round 24–28 的“全面延期”决定。当前主线同时包含：

1. Dream 主库 43 表与 Notion Connector 5 表保留在统一 PostgreSQL `ink-memory`，由 Admin Drizzle 唯一管理并由 Admin 数据服务访问；Dream 运行时不保留 PostgreSQL、SQLite、JSON DB 或内存数据库访问与回退。
2. canonical PostgreSQL `users` 继续作为唯一平台用户全集，也是唯一订阅主体全集；不存在“计费用户”产品实体、名册、筛选或手工开户。现有 `platform_users`/Billing Account 只是内部兼容与独立现金计费投影。
3. Admin 完成 Token-only Plan Version、Entitlement、Subscription、用户独立月度 Token Allowance、Gateway 与 Token Usage 闭环；套餐可包含整数 micro-USD 月费，但不包含金额额度、cash overage 或平台全局生效窗口。
4. Dream 既有 Claude Agent、Dream、Chat、Workflow 与受支持模型调用分阶段切入 Admin Gateway，浏览器不持有 Gateway Key 或 Provider Secret。
5. `PaymentAdapter`、Webhook event store、仅测试环境 Fake Adapter 与付费首次开通/到期续费已实现；真实 Stripe、支付宝、微信支付、银行等渠道仍为 **Deferred**。
6. ASR 仅在 Gateway 具备 streaming-audio capability、计量和结算合同后接入；此前 ASR Gateway 是 **Deferred**，当前未鉴权 WebSocket 必须先禁用或完成 canonical 鉴权、Origin、限流和审计。

## 2. 能力状态

| 能力 | 当前状态 | 目标状态 | 权威文档 |
|---|---|---|---|
| Dream 43+5 数据区域 | **Admin API-only source implemented**：Admin Drizzle 是唯一 DDL journal，191 个命名 DTO 操作覆盖现行生产持久化；Dream runtime 没有数据库凭据、driver、SQL、ORM、UOW 或 fallback | **Release Gate**：正常库应用 `0054–0062`、激活受限角色/ACL并完成真实业务验收 | [统一数据接口契约](../admin-dream-auth-data-contract.md)、[数据区域方案](../admin-dream-data-ownership.md) |
| 共享 Schema 版本 | **Admin/Drizzle sole authority**：空库只需 `pnpm db:migrate`；V1 数据回执继续有效，新库使用 V2 | **Release Gate**：生产专用 migrator role/ACL 与单实例发布回执 | [统一 Schema 权威](../database-schema-authority.md) |
| 用户与内部投影 | **Implemented / Release candidate**：canonical-driven projection、Gateway 反查、服务端用户分页/搜索及 QA-only 回归均已修复验证 | **Release Gate**：生产历史 orphan 只读盘点、映射/隔离回执 | [02](02-business-integration-and-admin-boundary.md)、[06](06-billing-subscription-gateway-integration.md) |
| Token Subscription/Gateway | **Implemented / Release candidate**：Admin `0017–0028`、Product/Payment API、个人月度状态机、Token Allowance/Token Ledger/Gateway 结算、三套餐 seed 与 Dream BFF/client 已通过 Admin 69 files/340 tests、隔离 PG 与 Dream full/real-PG 合同 | **Release Gate**：真实外部 Provider canary、生产角色切换/凭据注入与用户级流量切换；角色矩阵已在 clone 通过 | [06](06-billing-subscription-gateway-integration.md) |
| 独立 Provider Pricing/现金计费 | **Implemented baseline / Partial** | 与 Subscription 解耦保留；不得在 Token 耗尽时自动兜底，也不进入 Dream 套餐 DTO | [06](06-billing-subscription-gateway-integration.md) |
| Dream 订阅与 Usage 页面 | **Implemented / Release candidate**：真实 Product BFF 数据、月度 Token/周期/月费/模型权限、生命周期预览与付费首次开通/到期续费；无静态价格或假余额 | **Release Gate**：真实预发布 Admin API 冒烟与生产 Session/服务身份配置 | [03](03-page-refactor-checklist.md)、[07](07-dream-subscription-and-inference-integration.md) |
| Dream 推理链 | **Implemented / Release candidate**：server-only Gateway clients、canonical-subject 服务认证、Claude Agent、writing/chat/analyze/echo/traits/patterns 与图片描述/生成均已禁用 direct fallback；61 项聚焦测试通过 | **Planned release step**：外部 Provider canary 与逐角色生产流量切换尚未执行 | [07](07-dream-subscription-and-inference-integration.md) |
| Payment/订阅支付 | **Implemented / Release candidate**：`0022–0024`、Adapter contract、Fake guard、Webhook 幂等、refund/reversal、首次开通、付费月续费与 Dream Intent UI | **Deferred only for real channels**：尚未连接真实支付网络 | [08](08-payment-adapter-and-webhook-boundary.md)、[90](90-deferred-billing-subscription-inference-payment.md) |
| ASR Gateway | **Deferred** | 具备 streaming-audio capability 与计量/结算合同后另行转 Planned | [07](07-dream-subscription-and-inference-integration.md)、[90](90-deferred-billing-subscription-inference-payment.md) |

同一能力不能同时出现在 Planned 与 Deferred。`90-deferred-*` 只维护真实支付渠道与 ASR Gateway 的延期边界；PaymentAdapter/Fake/Webhook 已实现，不能再引用旧文档将其标为 Deferred。

## 3. 文档导航

| 文档 | 状态 | 回答的问题 |
|---|---|---|
| [统一 PostgreSQL Schema 权威](../database-schema-authority.md) | **Current** | Admin/Drizzle 唯一 DDL、0032 adoption、capability、发布和回滚 |
| [01-current-scope-and-source-baseline.md](01-current-scope-and-source-baseline.md) | **Current** | 两个项目当前真实实现、43+5 表、推理入口与缺口是什么 |
| [02-business-integration-and-admin-boundary.md](02-business-integration-and-admin-boundary.md) | **Historical boundary** | Admin-only 数据服务接管前，Dream/Admin/Gateway 如何共享事实；现行边界转到统一接口契约 |
| [03-page-refactor-checklist.md](03-page-refactor-checklist.md) | **Implemented / Release candidate** | Dream 哪些页面已改造，以及哪些真实发布步骤仍开放 |
| [04-postgresql-migration-plan.md](04-postgresql-migration-plan.md) | **Superseded DDL design / historical data requirements retained** | 历史 Alembic 方案与仍有效的 43+5 数据完整性要求 |
| [05-release-rollout-and-rollback.md](05-release-rollout-and-rollback.md) | **Current release plan** | 已通过门禁、生产 PG/Gateway 灰度与回滚边界 |
| [06-billing-subscription-gateway-integration.md](06-billing-subscription-gateway-integration.md) | **Implemented / Release candidate** | Token-only Subscription、独立 Pricing/Billing、资格、API 与迁移合同 |
| [07-dream-subscription-and-inference-integration.md](07-dream-subscription-and-inference-integration.md) | **Implemented / Release candidate** | Dream 产品体验/Gateway 客户端实现与外部 canary 余项 |
| [08-payment-adapter-and-webhook-boundary.md](08-payment-adapter-and-webhook-boundary.md) | **Implemented / Release candidate** | Adapter、Intent、Webhook 幂等、Fake guard 与真实渠道边界 |
| [90-deferred-billing-subscription-inference-payment.md](90-deferred-billing-subscription-inference-payment.md) | **Deferred / Superseded history** | 真实支付渠道与 ASR 哪些能力仍延期 |
| [91-evidence-and-legacy-map.md](91-evidence-and-legacy-map.md) | **Current** | 事实证据、旧文档和当前权威入口如何对应 |

## 4. 目标总链路

```mermaid
flowchart LR
  U["Canonical User"] --> S["Subscription"]
  S --> V["Plan Version"]
  V --> E["Entitlement"]
  E --> M["Model Permission"]
  M --> A["Current-period Token Allowance"]
  A --> G["Gateway Request"]
  G --> T["Token Usage"]
```

```mermaid
flowchart LR
  R["Provider Pricing rule"] --> Q["Explicit cash pay-as-you-go request"]
  Q --> C["Billing Account reserve/capture"]
  C --> L["Append-only Ledger"]
```

第二条链是独立现金计费域，不是套餐权益，也不能在 Token Allowance 耗尽时自动承接第一条链。Dream 不复制 Plan、Subscription、Token Usage、Ledger 或 Pricing 真值，也不直接写 Admin 控制面表。Dream 浏览器只访问 Dream 服务端；Dream 服务端以受控服务身份调用 Admin 产品 API 与 Gateway。

## 5. 所有权摘要

| 领域 | 逻辑所有者 | 约束 |
|---|---|---|
| 共享 PostgreSQL Schema/DDL 版本 | Admin Drizzle | 唯一 journal/runner；应用启动不迁移 |
| 数据库 Repository、事务与业务持久化 | Admin 数据服务 | 严格 DTO、权限、锁、事务、receipt/audit 与 Drizzle；Dream 不连接 PostgreSQL |
| Dream workflow、Runtime、SSE 与共享文件系统 | Dream | 调用 Admin 命名接口持久化；不把执行编排、文件字节或 Runtime 控制迁入 Admin |
| Admin/RBAC/Audit、Provider/Model/Pricing、Token Subscription、独立 Billing、Gateway/Usage/Ledger | Admin / Gateway | Dream 只经产品 API/Gateway；Subscription DTO 不携带金额；不直接写表 |
| `users` 与身份映射 | Admin 统一认证/数据服务 | 保留唯一 canonical 用户与稳定主键；Better Auth subject 显式映射，不按邮箱自动合并 |
| physical PostgreSQL owner/ACL | 目标环境 DBA/审批流程 | 本文逻辑所有权不授权 `ALTER OWNER`、GRANT 或 REVOKE |

## 6. 实现证据与剩余发布阻断项

当前 Schema authority transition 证据：Admin `0000–0032` 可从空库一次执行；0032 的 fresh、06（有/无 thread index）、07 与 partial/unknown 原子失败已在 PostgreSQL 16 验证。真实一次性数据迁移 E2E 当前导入 48 表/4,930 行、初始化 3 个 Plan 与 28 个 canonical User Subscription，并验证 V2 回执复用、冲突阻断和 append-only。历史整仓测试数字保留在 91 evidence 文档，本轮聚焦结果以统一 Schema 权威文档为准。

- 预发布/生产环境的 Alembic 06/07 分布、PITR、migrator role/ACL 与 0032 回执尚未盘点，不能借用一次性数据库回执。
- 外部 Provider canary、生产 Gateway 服务身份/Secret 注入和逐角色真实流量切换尚未执行。
- 已提交 Provider credential 已从 active runtime 移除且 secret scan 通过；密钥所有者吊销/轮换仍未确认。
- ASR endpoint 已代码级 fail-closed；密钥所有者吊销/轮换仍未确认，ASR Gateway 继续 Deferred。
- 生产 Fake Adapter 必须 fail closed；未配置真实渠道时不得展示成功或调用支付网络。
- Dream 全仓 frontend lint 已通过（0 errors / 21 warnings）；warnings 仍须保留在回执中，不得写成 0 warnings。

## 7. 文档状态规则

- **Current**：可由当前代码/Schema/只读证据复核的事实。
- **Implemented**：已有实现且仍需按 Release Gate 验证；不等于整条链已完成。
- **Planned**：已批准进入本轮设计和实现，但尚未通过最终验收。
- **Deferred**：明确不在当前实现范围；当前包括真实第三方支付渠道与未具备 capability 的 ASR Gateway。
- **Superseded**：历史方案被当前入口替代，只用于追溯。

最终状态以代码、隔离测试和发布回执为准，不能因文档写成目标合同就声称已实现。
