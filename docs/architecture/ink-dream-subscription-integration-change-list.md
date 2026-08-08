# Ink Dream 订阅与 Gateway 接入改造清单

> 状态：Admin 控制面后续接入说明  
> 日期：2026-08-08  
> 目标项目：`/Users/dmeck/project/ink-dream-memory`  
> 边界：本文只描述后续改动；本轮没有修改 Dream 代码、Schema、迁移或运行配置。

## 1. 接入前提与责任边界

Dream 继续拥有真实业务实体 `users`、`story_workspace_workspaces`、`story_workspace_stories` 及创作运行时。Admin 使用同一 PostgreSQL `ink-memory` 读取这些 canonical 表；Gateway 与订阅控制面拥有套餐、版本、权益、订阅、Allowance、Provider、Model、Pricing、Gateway Key、Usage 和 Ledger。产品层不存在另一类“计费用户”：`users` 中的每个平台用户天然是计费主体并自动拥有一个计费账户。

Dream 不应复制订阅账本、价格版本或 Token Usage。Dream 展示的套餐、订阅、额度和 Usage 都应来自控制面只读 API；开通、续费、升级、降级、暂停和取消必须调用控制面命令，不能直接更新 PostgreSQL。真实支付尚未接入，UI 不得显示“支付成功”；当前开通由运营 Admin 执行，未来支付由可插拔 PaymentAdapter/Webhook 驱动同一幂等命令。

## 2. 唯一平台用户与内部兼容键

| 平台用户真值 | 内部兼容字段 | 规则 |
|---|---|---|
| `users.id`（INTEGER） | `platform_users.external_user_id`（TEXT） | 使用十进制字符串，禁止生成第二套业务 User ID |
| 来源 | `platform_users.source` | 固定 `ink-dream` |
| 显示资料 | `platform_users.email/display_name` | 仅为自动同步的内部投影；页面和选择器必须读取 `users` |
| 兼容主键 | `platform_users.id` | 仅供现有 Gateway/Usage/Ledger 文本外键使用；不是另一种用户 ID |

`0015_platform_users_are_billable.sql` 会回填并通过 `users` trigger 幂等同步内部兼容行，同时为每个平台用户确保唯一的 `billing_accounts`。Dream 不需要、也不得调用“创建计费用户”接口；运营后台不得提供这种创建入口。该兼容表只为非破坏地保留既有余额、订阅、Key、Usage 和 Ledger 外键，后续可分阶段把控制面外键收敛到 canonical user key。不要把 Gateway Key、Provider Secret 或密码散列写入 Dream 表。

## 3. API 调用清单

当前 Admin 已实现运营 API `/api/admin/subscription-*`，它们受 Admin Session/RBAC 保护，Dream 不能直接调用。Dream 接入前应在控制面增加面向产品用户的窄接口；推荐由 Dream backend 以服务间身份调用，浏览器只调用 Dream backend：

| 接口建议 | 用途 | 最小响应 |
|---|---|---|
| `GET /v1/billing/plans` | 已发布、当前生效的套餐版本 | plan code/name、周期、价格、trial、allowance、overage、允许模型 alias；不返回内部 Secret |
| `GET /v1/billing/me` | 当前用户订阅概览 | status、period、renewal、pending change、Allowance granted/reserved/consumed/remaining、cash available/reserved |
| `GET /v1/billing/me/usage` | 分页 Usage | request ID、model alias、Token 分类、Allowance/cash 拆分、费用、时间、状态 |
| `GET /v1/billing/me/ledger` | 用户可见账务明细 | subscription charge、credit/refund/reversal、usage capture；隐藏 actor 内部信息 |
| `POST /v1/billing/me/change-plan` | 升级或期末降级 | target plan version、idempotency key、preview receipt |
| `POST /v1/billing/me/cancel` | 期末取消 | reason、idempotency key、影响日期 |
| `POST /v1/billing/me/resume` | 恢复续费/恢复暂停 | reason、idempotency key |
| `GET /v1/models` | 当前 Key 可见模型 alias | 使用既有 Gateway endpoint |

所有写请求必须带用户 Session、CSRF/Origin 保护和客户端生成的幂等键。控制面应从已认证 Session 解析 canonical `users.id`，再在服务端解析内部兼容键；禁止信任浏览器提交的 `platform_user_id`。409 响应应携带最新 subscription version/状态，Dream 刷新后允许用户重试。

## 4. Gateway 地址、Key 与模型 Alias

Dream backend/部署 Secret 管理器注入：

```dotenv
INK_MEMORY_GATEWAY_BASE_URL=https://gateway.example.com
INK_MEMORY_GATEWAY_KEY=<secret-manager-reference>
INK_MEMORY_DEFAULT_MODEL=<stable-model-alias>
```

若 Claude Agent SDK 直接读取 Anthropic 变量，则映射为：

```dotenv
ANTHROPIC_BASE_URL=${INK_MEMORY_GATEWAY_BASE_URL}
ANTHROPIC_AUTH_TOKEN=${INK_MEMORY_GATEWAY_KEY}
ANTHROPIC_MODEL=${INK_MEMORY_DEFAULT_MODEL}
```

- Base URL 指向 Gateway origin；Anthropic 请求入口为 `/v1/messages`，OpenAI 兼容入口为 `/v1/chat/completions`。
- Key 只在 Admin 创建回执显示一次；Dream 仅从 Secret Manager 读取，禁止写入 `.env` 提交、数据库、日志、前端 bundle、URL 或错误遥测。
- Dream 只能发送 `ai_models.code` 稳定 alias，不发送 Provider ID、上游 model name 或 Pricing Rule ID。
- 每个环境使用独立最小 Scope Key；撤销/轮换采用“新 Key 验证 → 切换 Secret → 撤销旧 Key”。

## 5. Dream 前端页面改造

现有 `frontend/src/pages/story-workspace/StoryWorkspaceSubscriptionPage.tsx` 明确是“without billing transport”的静态三档页面，且文案说明定价与开通方式尚不可用。它应成为首要替换点：

1. 删除文件内静态套餐数组和虚构档位；加载 `GET /v1/billing/plans` 的真实 published versions。
2. 页首展示真实 `trial/active/past_due/paused/cancel_at_period_end/cancelled/expired` 状态、当前周期结束、续费状态和 pending downgrade。
3. 每个套餐显示币种、周期、基础价、赠送 Token/金额额度、超额策略、允许模型和 RPM；价格从整数 micro-USD 格式化，禁止浮点回写。
4. 当前订阅区展示 Token 与金额 Allowance 的 `granted - reserved - consumed`，另列 cash available/reserved；不要把两者合成一个含糊“余额”。
5. 增加 Usage 分页列表与月度预估区；预估必须标注“截至当前 Usage 的投影”，不能冒充外部账单。
6. 升级显示立即生效和本期重置/扣费影响；降级显示下周期生效；取消显示 `cancel_at_period_end` 日期；暂停/恢复要求确认。

继续复用：

- `frontend/src/router/storyWorkspacePath.ts` 的 `/story-workspace/subscription` 路由。
- `frontend/src/pages/story-workspace/StoryWorkspaceSettingsPage.tsx` 的订阅设置入口。
- `frontend/src/pages/story-workspace/StoryWorkspaceSubscriptionPage.css` 的现有设计语言，但增加 loading、empty、error、focus、移动端长 ID/金额处理。

建议新增：

- `frontend/src/api/subscriptionApi.ts`：严格 response types、AbortSignal、错误码解析。
- `frontend/src/pages/story-workspace/useSubscription.ts`：查询、刷新和命令状态。
- `frontend/src/types/subscription.ts`：金额使用 decimal string 或 micro-USD integer，不使用浮点作为传输真值。
- `frontend/src/pages/story-workspace/__tests__/StoryWorkspaceSubscriptionPage.test.tsx`。
- `frontend/e2e/story-workspace-subscription.spec.ts`。

## 6. Dream backend/运行时改造

建议修改或新增：

- `backend/config.py`：校验 Gateway Base URL、Key Secret 引用和默认 alias；生产只允许 HTTPS，启动日志只能记录 host/alias/Key fingerprint。
- `backend/routers/billing.py`：Dream Session → canonical User → 控制面服务端 API 代理；严格超时和错误映射。
- `backend/services/billing_client.py`：服务间认证、幂等键、重试边界；只重试安全 GET 和明确可重放的幂等写。
- `backend/routers/claude_agent.py` 及其 runner/config seam：Provider 调用改用 Gateway Base URL、Gateway Key 和 alias；保留 SDK Usage 但不在 Dream 自行扣费。
- `backend/tests/test_billing_client.py`、`backend/tests/test_billing_router.py`、`backend/tests/test_claude_agent_runner.py`：验证 Secret 不进入 env diagnostics、traceback 或 subprocess echo。
- `backend/docker-compose.yml` 与部署清单：以 Secret mount/平台 Secret 注入 Key，不把明文写在 compose 文件。

不要在 Dream 增加 Pricing、Ledger 或 Allowance 表；离线缓存只能是带短 TTL 的只读投影，控制面不可用时订阅写操作返回 503，不能假定成功。

## 7. 错误码与用户恢复

| HTTP | 典型 Code | Dream 提示与动作 |
|---:|---|---|
| 401 | `GATEWAY_API_KEY_REQUIRED/INVALID` | 服务配置异常；停止自动重试，提示稍后重试并报警，不要求用户粘贴 Key |
| 402 | `INSUFFICIENT_BALANCE` | 余额不足；进入充值/联系运营入口 |
| 402 | `SUBSCRIPTION_ALLOWANCE_EXHAUSTED` | 周期额度耗尽且禁止超额；展示下次重置时间/升级入口 |
| 403 | `SUBSCRIPTION_PAUSED/INACTIVE/PERIOD_EXPIRED` | 展示恢复、续费或重新订阅入口 |
| 403 | `SUBSCRIPTION_MODEL_NOT_ALLOWED/SCOPE_NOT_ALLOWED` | 选择套餐允许的 alias；不要循环重试同一模型 |
| 403 | `GATEWAY_SCOPE_REQUIRED` | 部署 Key Scope 配置错误；报警并停止请求 |
| 409 | `SUBSCRIPTION_ALLOWANCE_CONFLICT` | 刷新订阅/Allowance 后以同一幂等键安全重试 |
| 409 | Idempotency replay/in progress | 展示原请求状态；不要创建第二次扣费请求 |
| 429 | RPM/日/月 Token limit | 遵循 `Retry-After`；长任务进入退避队列 |
| 503 | 配置/控制面不可用 | 保留用户输入，禁用重复提交，提供重试；不得切换到未计费 Provider |

Gateway 返回的 request ID 应进入 Dream 的结构化日志与用户错误详情（可复制），但不得记录请求正文中的敏感内容或 Key。

## 8. 数据迁移与兼容顺序

1. 在隔离环境将 Dream canonical 三表迁入同一 PostgreSQL 并核对 PK/FK/fingerprint；生产迁移需另行审批。
2. 部署 Admin 0014 订阅迁移及控制面代码，但保持“从未分配订阅的旧用户走余额兼容”；已存在订阅但无资格时不得放行。
3. 核对每个 canonical 用户已由 `0015` 自动生成唯一计费账户，发放环境级 Gateway Key，配置模型 alias；不得手工创建另一类用户。
4. 影子读取套餐/订阅/Usage，Dream 仍不显示写入口；核对用户映射和金额。
5. 让一小组测试用户走 Gateway，核对 Request → Allowance → cash → Usage → Ledger。
6. 打开真实订阅页面和生命周期命令；先无支付/运营开通，再逐步接 PaymentAdapter。
7. 全量切换 Provider 流量；确认没有 Dream 直连上游的旁路 Secret。

## 9. 灰度、监控与回滚

推荐特性开关：`billing_read_ui`、`billing_self_service`、`gateway_proxy`，按环境和用户 cohort 控制。监控至少包含：Gateway 401/402/403/409/429 比例、Provider 5xx、Allowance reserve/settle invariant、cash overdraft、subscription event duplicate、Usage 未结算、Key 即将过期和控制面延迟。

回滚顺序：关闭自助写入口 → Dream 回到订阅只读页 → 将流量切回已审批的旧调用路径（只有在安全审计允许且不会绕过计费时）→ 保留订阅/Usage/Ledger/Audit 数据。不得回滚 0014 删除表或改写已发布 Plan Version；物理 schema 采用向前修复，订阅事件和账本保持只追加。

## 10. 接入验收

- `users` 是唯一用户集合；每个 Dream `users.id` 必须自动且仅拥有一个内部兼容行和一个计费账户，页面不得出现单独的“计费用户”资源。
- 页面无静态/假套餐，金额、周期、权益和 alias 与 published Plan Version 一致。
- trial、active、past_due、paused、cancel_at_period_end、cancelled、expired 均有明确页面状态。
- 升降级、续费、暂停、恢复、取消重复提交不重复扣费。
- Gateway 资格错误不触发上游 Provider；Allowance 优先，允许超额时才使用 cash。
- Usage 与 Ledger 能通过 request/subscription ID 追溯，Ledger/事件不可编辑。
- Key/Provider Secret 不出现在数据库明文、前端 bundle、日志、截图或错误响应。
- 桌面和 390×844 移动视口无页面级横向溢出；键盘可完成套餐选择和高风险确认。
- 回归 Story 创作、Storage、Session 与已有 Claude Agent 工作流。
