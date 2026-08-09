# Dream 业务接入与 Admin/Gateway 边界

> 文档状态：**Implemented / Release candidate**（逻辑边界已落地；物理 owner/ACL 与生产 cutover 待审批）
> 返回：[总索引](README.md)  
> 依赖：[当前基线](01-current-scope-and-source-baseline.md) · [Billing/Subscription/Gateway](06-billing-subscription-gateway-integration.md)  
> 主要读者：Dream 后端、Admin/Gateway 后端、DBA、安全审计

## 1. 已实现集成拓扑

```mermaid
flowchart LR
  Browser["Dream Browser"] --> DreamAPI["Dream FastAPI"]
  DreamAPI --> DreamRepo["Dream PG Repositories"]
  DreamRepo --> PG[("PostgreSQL ink-memory")]
  DreamAPI --> ProductAPI["Admin Product API"]
  DreamAPI --> Gateway["Admin AI Gateway"]
  AdminUI["Admin Refine"] --> AdminAPI["Admin Route Handlers"]
  AdminAPI --> ControlRepo["Admin Control-plane Repositories"]
  ProductAPI --> ControlRepo
  Gateway --> ControlRepo
  ControlRepo --> PG
```

浏览器不直连 PostgreSQL、Gateway 或 Provider。Dream FastAPI 是产品用户身份和服务间凭据的边界；Admin 浏览器仍只访问 Admin API。

## 2. 唯一用户与自动计费身份

- `users.id` 是唯一平台产品用户 ID，也是 Dream canonical 业务 FK 父键。
- `platform_users` 只为 Admin 既有 text FK 提供内部一对一映射，不能成为页面、名册、创建按钮或第二套资料源。
- 每个 `users` 行必须由受控 projection 自动获得 mapping 和 `billing_accounts`；不存在 `POST 创建计费用户`。
- 用户关系选择器必须以 `users` 为权威做服务端 `q/page/pageSize/total`，不能预载前 50/100 后本地过滤。
- Gateway Key、Subscription、Model Permission、credit 等命令必须在同一事务反向 JOIN canonical user；mapping 缺失可调用受控 projector，orphan 则 fail-closed。
- 历史 orphan `platform_users` 先审计 Key、余额、Usage、Ledger、Subscription，再隔离/禁用或映射；不得删除财务历史。

```mermaid
flowchart LR
  User["Canonical users"] -->|"automatic 1:1 projection"| Mapping["platform_users internal mapping"]
  User --> Subscription["Token Subscription"]
  Mapping -->|"automatic 1:1 independent cash domain"| Account["Billing Account"]
```

`Billing Account` 继续满足 canonical user 的内部兼容投影要求，但不是 Token Subscription 的父实体、资格前置或 Token 耗尽兜底。

## 3. 领域所有权

| 领域 | Dream 边界 | Admin/Gateway 边界 | 禁止 |
|---|---|---|---|
| 43+5 canonical Schema | DDL、Alembic、Repository、业务写、数据迁移 | 批准读取、白名单更新或领域命令 | Admin 通用硬删、继续扩展 Dream DDL |
| canonical User | 注册、认证、资料真值 | 自动映射/account、产品 API只读资料 | 独立计费用户创建、修改映射 email/display name |
| Workspace/Story/Character/Scene | 业务/Agent 完整写 | 受控读取、白名单字段和状态命令 | 直接 SQL PATCH status、通用 create/delete |
| Workflow/Plugin/Runtime/Event | 命令与不可变事实 | 默认只读、最小披露 | UPDATE/DELETE history |
| Plan/Subscription | 展示真实状态、提交产品命令 | 版本、状态机、幂等、审计 | Dream 复制 Plan/Entitlement 或直接写表 |
| Token Allowance/Usage | 展示当前用户周期的 Token 投影 | reserve/capture/release、不可变 Token Usage | 金额换算、现金余额兜底、覆盖 Usage |
| 独立现金 Billing/Ledger | 不进入 Dream Token-only 产品 API/页面 | Admin 独立运营、Provider 成本与现金账务事实 | 称为订阅余额、作为 Token 耗尽兜底、向 Dream 暴露现金 Ledger |
| Provider/Model/Pricing/Gateway | 服务端以 stable alias 发请求 | 配置、Secret、Key、资格、限流、路由、Provider 成本快照与 Token 结算 | 浏览器 Key、Dream Provider Secret、日志回显 |
| Payment | **Deferred**；Dream 无支付状态或入口 | **Deferred**；本轮不建 Adapter、Webhook、event store 或 Fake | 虚假成功、生产 Fake、真实渠道网络、把 Payment 当 Subscription 依赖 |

## 4. Repository、角色与迁移日志

目标角色与最小权限合同如下；代码、独立 Repository/pool 与 migration journal 已落地，真实环境角色/ACL 尚未因本文自动变更：

| 角色 | 最小权限目标 |
|---|---|
| `ink_dream_app` | Dream canonical 表的业务权限；实际删除仍受领域规则/FK/trigger 限制 |
| `ink_admin_app` | canonical SELECT + 批准列级 UPDATE/领域函数；Admin 控制面按自身迁移权限 |
| `ink_dream_migrator` | 仅迁移窗口使用，管理 Dream-owned DDL与导入 |
| `ink_admin_migrator` | 仅 Admin Drizzle migration，不修改已交接的 Dream 表 |

Dream 使用独立 Alembic version table，Admin 保留 Drizzle journal；部署前检查 compatibility matrix。以上是逻辑所有权目标，不代表真实 owner/ACL。对 `pg_class`、role membership、grants、constraints 和现有行只读盘点后，任何 `ALTER OWNER`、GRANT/REVOKE 均需单独审批；本文不授权执行。

## 5. Admin 对 canonical 业务表的写边界

1. Route Handler 只做 Session、RBAC、Origin、Zod、幂等头解析和 service 调用。
2. Service 在事务中读取当前行、检查 owner/workspace/FK/乐观版本、执行白名单命令并写 Admin Audit。
3. Character/Scene/Workflow 迁移闭包未完成时 fail-closed 503，不读取旧 `story_*` 平行表。
4. Workspace/Story/Character/Scene 无通用硬删除；Workflow transition、Token consumption、Event、receipt 等不可变事实不提供 UPDATE/DELETE。
5. Admin 旧平行表只保留 deprecated 历史；任何归档/删除需独立审计与批准 migration。

## 6. Dream 对控制面的访问边界

Dream 只经 [06](06-billing-subscription-gateway-integration.md) 规定的 Product API 与 Gateway：

- 浏览器 Session → Dream FastAPI canonical user；服务端再绑定同一 user ID 和服务身份。
- Product API 只返回发布中的 Token Plan/Version/Entitlement、当前 Subscription、当前用户周期 Token Allowance/Usage 与 model catalog；不返回 Balance、现金 Ledger、Payment、内部 Secret 或任意控制面列。
- 生命周期写操作由 Dream 提交带 idempotency key 与 expected version 的命令；Dream 不自行推演/写入最终状态。
- Gateway request 只携带获准 model alias 和协议 payload；Gateway 负责资格、Provider 选择、独立 Provider 成本快照和 Token settlement。
- Dream 不缓存 Token 套餐为长期真值；短 cache 必须有版本/ETag，503 时显示不可用而不是静态 fallback。

## 7. API/领域错误合同

| HTTP | 领域语义 | Dream 恢复合同 |
|---:|---|---|
| 401 | 浏览器 Session 或服务身份无效 | 刷新/重新登录；不伪装成余额错误 |
| 402 | 当前用户周期 Token Allowance 不足，单位明确 | 保留输入，展示可用/所需 Token 与可执行动作；不读取现金余额、不自动充值 |
| 403 | 订阅状态、Entitlement、模型权限或 RBAC 拒绝 | 禁用对应操作并给出安全原因 |
| 404 | Plan/version/subscription/model alias 等不存在或不可见 | 刷新产品上下文；不使用本地默认对象 |
| 409 | idempotency、expected version、生命周期或并发冲突 | 拉取新状态并重新做影响预览 |
| 429 | RPM/token quota/平台限流 | 尊重 `Retry-After`，避免无界重试 |
| 502 | Provider 失败或协议错误 | 显示上游失败；Gateway 必须结算到 release/capture/failed 终态 |
| 503 | 数据库、配置、维护或结算不可确定 | 显示维护/重试；不回退 SQLite、静态计划或直接 Provider |

错误体统一为 `{error:{code,message,details?},meta:{requestId,retryAfterSeconds?}}`。`details` 只允许 code 对应的白名单字段（如 `metric/unit/currentVersion/availableTokens/requiredTokens`）；字段使用 camelCase，不再同时提供顶层 snake_case 变体。不返回 SQL、DSN、Secret、内部 stack、正文或 Provider 原始敏感响应。

## 8. Dream Repository 实现结构

```text
backend/
  persistence/
    postgres.py
    unit_of_work.py
    errors.py
    repositories/
  notion/
    store.py
  services/
    admin_product/
      client.py
      identity.py
      models.py
    admin_gateway/
      sdk.py
      token.py
  schema/
  script/
    migrate_legacy_to_postgres.py
    verify_postgres_schema.py
  migrations/
    env.py
    versions/
```

`backend/database.py` 当前是 PostgreSQL-only 兼容门面，委托 pool/Repository 并在 Alembic head 不匹配时 fail-fast；Notion 也使用 PostgreSQL repository/UoW。legacy SQLite builder 与测试适配器仅服务 catalog/迁移/测试，不是运行时 fallback；禁止重新建立通用 SQLite SQL→PostgreSQL 翻译层。

## 9. 验收

实现回执：Admin `0000–0024`、本机 PG migration、独立 Token Ledger、付费开通/续费、66 files/313 tests、tsc/lint/build 与隔离 PG integration；Dream 48/569/81/25、43+5 CLI、Product/Payment BFF、全入口 Gateway client，backend 1,679 passed/14 skipped/652 subtests、推理聚焦 61 passed；frontend lint 0 errors/21 warnings、build、Product API 9/9 与订阅 Playwright 4/4。角色/最小权限矩阵已在明确 clone 通过；其他生产环境、credential owner 轮换、真实角色切换与外部 Provider canary仍为 Release Gate。

- 同一 `users.id` 在 Dream、Admin 产品 API、Gateway、Billing Account 和 Subscription 中含义一致。
- Dream 与 Admin 使用独立 Repository、应用角色和 migration journal；所有权盘点与授权变更有独立回执。
- Product API 与 Gateway 是 Dream 唯一控制面/推理接入；浏览器和 Dream 业务表没有任何 Secret。
- Admin canonical 写入受白名单、版本、RBAC、Origin、事务和 Audit 保护；不可变事实拒绝修改。
- 401/402/403/404/409/429/502/503 均有自动测试和无假数据恢复状态。
