# 模块 PRD：Gateway、Key、Request、Payload 与限流

> 返回：[平台 PRD 总纲](../ink-memory-admin-prd-v3.md) · 交互：[Gateway](../../design/modules/05-gateway.md)

> 实现状态：协议代理、Key、Request/Payload、订阅资格、账务预授权与限流基线已有；严格 canonical 校验、cash-only 退出、402 单位、终态不可变和 Dream 推理接管未完成。

## 0. Current / Target / Release Gate

| 分层 | 范围 |
|---|---|
| Current | Anthropic/OpenAI 代理、Key hash、Request/Payload、限流、reserve/capture/release 基线；auth 只 JOIN `platform_users`、cash-only 默认放行、402 Token/micro-USD 混写与 settled Request/Usage 终态 guard 仍是缺口。 |
| Target | Dream 服务端以最小权限服务身份调用，严格执行 canonical user→Subscription→Entitlement→Permission→limit→当前周期 Token Allowance→reserve→Provider，并冻结版本快照。Subscription 不提供金额 allowance 或 cash overage。 |
| Release Gate | orphan fail-closed、cash-only canary 退出、协议流/cancel/usage-missing 与 401/402/403/404/409/429/502/503 合同通过；无浏览器 Key、Provider Secret 或跨用户共享 Key。 |

## 1. 目标与协议

向 Dream 和授权客户端提供 Anthropic/OpenAI 兼容代理，并完整记录可计费、可审计的请求生命周期。支持 `/v1/messages`、`/v1/messages/count_tokens`、`/v1/chat/completions`、`/v1/models`；同协议安全透传，跨协议使用显式 Adapter。

## 2. 页面

| 页面 | 路由 | 能力 |
|---|---|---|
| Request | `/admin/gateway/requests` | 只读查询、摘要、错误、完整 Payload 权限门 |
| Gateway Key | `/admin/gateway/keys` | 创建一次性回执、scope、到期、revoke |
| 限流策略 | `/admin/gateway/rate-limits` | 用户默认 Token、用户—模型例外限制、套餐权益提示、实时用量窗口只读 |

`/admin/gateway/rate-limits` 是限制策略的唯一管理入口。历史 `/admin/models/permissions` 永久跳转到 `#user-model-permissions-manager`；模型中心不得再展示重复 Tab 或侧边导航。

权限：读取 Request/Key/限流事实使用 `gateway.read`；完整报文使用 `gateway.payloads.read`；Key 写入使用 `gateway.keys.write`；`/admin/gateway/rate-limits` 中用户默认 Token limit 与模型 override 的编辑还要求 `users.write`，实时计数始终只读。

## 3. 调用链

```mermaid
flowchart LR
  K["Hashed service/user Gateway Key"] --> Q["Scope + canonical User"]
  Q --> S["Subscription + Plan Version"] --> E["Entitlement"]
  E --> M["Model Permission + Limits"]
  M --> B["Current-period Token Reserve"]
  B --> P["Provider Transport"]
  P --> U["Final Usage"]
  U --> C["Token Capture / Release"]
  Q -. "Current legacy only: independent cash mode" .-> P
```

资格拒绝发生在上游调用前。请求创建时冻结 Subscription/Entitlement/Pricing/limit snapshot。订阅请求只使用 Token Allowance；Token 用尽不得隐式转为 cash。Provider Pricing、Provider cost 和显式独立按量现金模式可继续记账，但不能由套餐 overage 字段开启或称为订阅额度。流式响应必须支持真实增量、backpressure、client cancel 和协议正确的 SSE error；Usage 未知时不得按 0 成功结算。

## 4. Key 与 Secret

- Key 明文只在创建成功显示一次；数据库仅存 hash、prefix、scopes、状态和到期。
- 每个平台用户可有多个最小 Scope Key；revoke 保留历史 Request。
- Target Key 轮换是“创建新 Key + 撤销旧 Key”，不就地覆盖 Secret。Request 冻结 key ID/fingerprint/scope/version 快照；轮换/撤销不改写历史请求。Current Schema 若无显式 version，实现前不得把该快照标成已完成。
- Anthropic/OpenAI 接入回执显示 Gateway URL、Header、alias 示例，不显示 Provider Secret/upstream model。
- Dream 生产只通过服务端 secret provider 注入最小 scope 凭据；浏览器、用户偏好 JSON、普通数据库字段和日志均不得持有 Key。服务身份必须绑定已鉴权 canonical user，不允许全平台浏览器共享 Key。

## 5. Request 与完整报文

`gateway_requests` 保存热摘要；`gateway_request_payloads`、`gateway_response_payloads`、`gateway_response_events` 保存脱敏完整报文/流事件。默认不加载 Payload；二次确认请求需要明确 header 并写 append-only Audit。认证、Cookie、Key、Provider Secret 固定脱敏。

429 摘要必须记录 limit/current/reserve/remaining/exceeded。Token 限额链接到可实际调整的用户默认/模型覆盖/套餐权益；RPM 仅展示策略来源和“当前 Admin 未开放编辑”，不能伪造修复入口。实时 `gateway_rate_limits` 只读，不能改计数解除限流。

## 6. Gateway 拒绝与错误契约

本表是 Gateway 资格/计费错误的唯一产品映射；订阅和 Dream 接入文档引用本表，不另行发明状态码。

| 阶段 | HTTP / code | 是否落 Request | 客户端/运营恢复 |
|---|---|---|---|
| Key 认证 | 401 `GATEWAY_AUTH_REQUIRED` | 否；尚不能识别安全主体 | missing/invalid/revoked Key 统一安全响应；停止自动重试，检查服务端 Secret 注入/到期/revoke，不要求终端用户粘贴 Key |
| Key scope | 403 `GATEWAY_SCOPE_REQUIRED` | 否 | 更换具备最小必要 scope 的 Key；写部署告警 |
| Canonical 用户 | 403 `CANONICAL_USER_REQUIRED` | 否；Key 有效但 mapping 是 orphan | 停止调用；审计 Key/余额/Usage/Ledger/Subscription 后映射或隔离，不创建第二用户/删除财务历史 |
| 平台访问策略 | 401 `GATEWAY_AUTH_REQUIRED`（canonical 用户存在但非 active 时统一处理） | 否 | 在平台用户控制面检查访问状态；不泄露更多身份细节 |
| 从未订阅兼容 | 无订阅错误；继续既有独立 cash-only 预授权 | 是 | 仅为 Current 迁移缺口，不代表套餐 overage 或独立计费用户；该路径无配置开关，移除需代码变更与灰度迁移 |
| Subscription 状态 | 403 `SUBSCRIPTION_PAUSED` / `SUBSCRIPTION_INACTIVE` / `SUBSCRIPTION_PERIOD_EXPIRED` | 是，`rejected` | 恢复、续费或重新订阅；同请求不循环重试 |
| Entitlement | 403 `SUBSCRIPTION_MODEL_NOT_ALLOWED` / `SUBSCRIPTION_SCOPE_NOT_ALLOWED` | 是，`rejected` | 选择允许 alias/scope 或调整下一版权益 |
| Allowance 未就绪/并发 | 409 `SUBSCRIPTION_ALLOWANCE_NOT_READY` / `SUBSCRIPTION_ALLOWANCE_CONFLICT` | 是，`rejected` | 刷新订阅/Allowance；并发冲突可按幂等边界重试 |
| 订阅 Token | 402 `SUBSCRIPTION_TOKEN_ALLOWANCE_EXHAUSTED` | 是，`rejected` | 只展示个人周期重置时间与下期换版；`metric/unit=tokens`，使用 `available_tokens/required_tokens/period_end`；不得 fallback 到 cash 或返回 micro-USD 字段 |
| 独立现金模式 | 402 `INSUFFICIENT_BALANCE` | 是，`rejected` | 只在显式独立按量产品模式使用；`metric=money`、`unit=microusd`，使用 `available_microusd/required_microusd`；不得称为订阅余额 |
| 预授权限流 | 429 `REQUEST_RATE_LIMIT_EXCEEDED` / `DAILY_TOKEN_LIMIT_EXCEEDED` / `MONTHLY_TOKEN_LIMIT_EXCEEDED` | 是，`rejected`，保存 limit summary/Payload | 返回 `Retry-After: 60`；Token 限额导航可编辑策略；RPM 当前仅说明未开放编辑 |
| Idempotency | 409 `REQUEST_IN_PROGRESS` / `REQUEST_ALREADY_COMPLETED` / `STREAM_REPLAY_NOT_SUPPORTED` | 关联原 Request | 展示原 Request 状态；不得创建第二次扣费请求 |
| Model/产品资源 | 404 `GATEWAY_MODEL_NOT_FOUND` | 是，`rejected` | 刷新 `/api/product/v1/me/model-catalog` 或套餐投影；不静态回退已下线 alias |
| Gateway 配置 | 503 `GATEWAY_AUTH_NOT_CONFIGURED` / `INVALID_ACCOUNT_LIMIT` / `GATEWAY_MIN_RESERVE_INVALID` 等 | 取决于发生在 Request 创建前/后 | 服务告警、复制 request ID；不切换未计费 Provider，不泄露配置值 |
| 上游限流/失败 | 429 `UPSTREAM_RATE_LIMITED` 或 502 `GATEWAY_PROVIDER_UPSTREAM_FAILURE` | 是，保留 Provider/Request 状态 | 仅 retryable 错误遵循 `Retry-After`/退避；未知 Usage 不按 0 结算，不使用 Payment Adapter code |

所有已创建 Request 的资格拒绝必须保存协议正确、已脱敏的 JSON 响应；认证阶段未创建 Request 时仍返回安全 `x-request-id`。429 `Retry-After` 的当前固定值是实现事实，未来若改为动态窗口必须同步更新测试和本文。

Gateway `/v1/**` 是 Anthropic/OpenAI 兼容协议面，计费诊断 details 保留已发布 snake_case（`available_tokens/required_tokens`、`available_microusd/required_microusd`）以避免破坏既有客户端；这不是 Product API JSON 命名。Dream BFF 必须通过 allowlist 映射为 Product camelCase `error.details.availableTokens/requiredTokens/availableMicrousd/requiredMicrousd` 和 `meta.requestId/retryAfterSeconds`，禁止对 Gateway 响应做原样 spread/透传。

当前缺口：Token allowance 不足时实现仍可能把 Token 数写入 `available_microusd/required_microusd`，且 Gateway Key auth 未反向 JOIN canonical `users`。两项均为发布阻断风险；修复前客户端只能按 `code` 展示通用额度不足，不能把错误字段格式化为 USD。

Current 认证实现仍可能返回旧 `GATEWAY_API_KEY_REQUIRED/GATEWAY_API_KEY_INVALID`；Target 合同统一为上表 `GATEWAY_AUTH_REQUIRED`，并仅在 Key 有效但 canonical mapping orphan 时返 `CANONICAL_USER_REQUIRED`。代码、Dream 错误处理和 contract 测试未同步前不得标记 Release Gate 通过。

已 settle Request/Usage 当前还缺数据库终态不可变 guard。Target 必须禁止对已完成/已结算事实的通用 UPDATE/DELETE，任何纠错以新 Ledger reversal/安全 Audit 表达。ASR WebSocket 在未定义 streaming-audio capability/计量/结算前不纳入本 Gateway Target，发布前必须禁用或另行完成 canonical 鉴权、Origin、限流和审计。

## 7. 验收

- GTW-01（Target release gate）：无/错/revoked Key 均返回协议正确 401 `GATEWAY_AUTH_REQUIRED`；有效 Key + canonical orphan 返 403 `CANONICAL_USER_REQUIRED`，且 Secret 不进日志/DOM。
- GTW-02：Scope、订阅、模型、当前周期 Token、RPM/Token limit 在 Provider 前拒绝并记录 Request；Subscription Token 用尽不进入独立现金链路。
- GTW-03：Anthropic/OpenAI 非流与流式 contract、任意 chunk 边界、cancel、错误映射通过。
- GTW-04：Payload 默认不加载；无 `gateway.payloads.read` 返回 403；查看产生 Audit。
- GTW-05：Usage settle 产生唯一 Usage/Ledger 链；未知 Usage 标记 `settlement_failed`，不自动按 0。
- GTW-06：Current 只允许从未有订阅记录的用户进入独立 cash-only 兼容路径；已有任何订阅记录时必须执行 Subscription/Entitlement/Token Allowance 校验，Target canary 关闭后无隐式现金 fallback。
- GTW-07：Gateway Key 认证必须证明内部兼容行存在对应 canonical 用户；402 的字段名、metric 与 unit 一致，Token 值永不进入 micro-USD 字段。
- GTW-08（Target release gate）：Dream 的 Claude Agent/Chat/Dream/Workflow 经用户级 canary 调用 Gateway，旧行为/工具/流式协议无回归；流取消、上游 5xx、usage 缺失分别产生确定 release/capture/`settlement_failed`。
- GTW-09（Target release gate）：已 settle Request/Usage 的 UPDATE/DELETE 在数据库层失败；历史 price/entitlement/permission/limit snapshot 不因新配置变化。
- GTW-10（Target release gate）：Key 轮换创建新版本且旧 Key 不可恢复；转动前后 Request 分别保存正确 key/scope snapshot，无明文重读。
- GTW-11（Target release gate）：Gateway `/v1` snake_case 诊断经 Dream BFF 逐字段转为 Product camelCase envelope；contract test 证明 Token 值不进 micro-USD 字段、Secret/未知字段不被透传。

交互验收映射：GTW-01 → UI-GTW-01；GTW-02/05 → UI-GTW-03 + API/数据库断言；GTW-03 由协议 contract E2E；GTW-04 → UI-GTW-02/04。
