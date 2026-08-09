# 模块 PRD：Provider、Model 与 Pricing

> 返回：[平台 PRD 总纲](../ink-memory-admin-prd-v3.md) · 交互：[模型供应链](../../design/modules/04-model-catalog.md)

> 实现状态：Provider/Model/Pricing/Discover/目录同步已实现；用户—模型例外限制统一归入 Gateway 限流模块。

## 0. Current / Target / Release Gate

| 分层 | 范围 |
|---|---|
| Current | Provider/Model/Pricing/Discover/目录同步基线已有；用户—模型例外已收敛到 Gateway 限流唯一入口。 |
| Target | 为 Dream 发布当前订阅真正可用的 stable alias/label/capability；每个 Gateway Request 冻结 Provider/Model/Pricing/Permission 版本快照。 |
| Release Gate | 历史 Pricing 与已用快照无 UPDATE/DELETE；Secret 无回读/日志/DOM；未定价或未授权 alias 在 Provider 前 fail-closed。 |

## 1. 目标

管理上游 Provider、稳定 Model alias、不可覆盖且可追溯的价格版本以及模型发现/目录同步，为 Gateway 与订阅权益提供真实模型供应链配置。

## 2. 页面

| 页面 | 路由 | Resource/权限 |
|---|---|---|
| Provider | `/admin/models/providers`、`/admin/models/providers/new`、`/admin/models/providers/[id]/edit` | `providers`；`providers.read`、`providers.write` |
| Discover Diff | `/admin/models/providers/[id]/discover/[snapshotId]` | discovery snapshot；`providers.write` |
| Model | `/admin/models/models`、`/admin/models/models/new`、`/admin/models/models/[id]/edit` | `models`；`models.read`、`models.write` |
| Pricing | `/admin/models/pricing`、`/admin/models/pricing/new`、`/admin/models/pricing/sync/[snapshotId]` | `pricing-rules`；`pricing.read`、`pricing.write` |

## 3. 领域规则

- Provider Credential 加密保存、只写不读；空 Secret 表示不轮换。Provider 停用不硬删。
- `ai_models.code` 是外部稳定 alias；`upstream_model` 只在服务端解析。Model 启停不改历史 Request。
- Discover 生成不可变 snapshot；Apply 使用 snapshot version + idempotency key，冲突重新 discover，不强制覆盖。
- Pricing 使用整数 micro-USD / million tokens；活动窗口不可重叠；更新价格通过创建新版本并关闭旧窗口，Request 冻结 price snapshot。
- models.dev 同步保留 source/ref/version/hash；只有 exact match 默认选，unmatched 不按 0 定价。
- 用户—模型例外限制是 Gateway 的执行策略，不属于模型目录配置；唯一管理入口为 `/admin/gateway/rate-limits#user-model-permissions-manager`，且不能扩大 Subscription Entitlement。
- Permission 的执行顺序是先取 Entitlement 可用集，再取用户例外的更严格交集；Request 保存实际命中的 entitlement/permission/limit 版本，后续配置变更不改历史结算。

## 4. API/表

`ai_providers`、`ai_models`、`ai_pricing_rules`、`ai_provider_discovery_snapshots`、`ai_pricing_sync_snapshots`。通用 Admin Route 只编排，发现、连通、校验、同步和冲突规则位于 `app/lib/admin/**`、`app/lib/models/**`。

## 5. 验收

- MOD-01：Provider Secret 创建后仅返回 configured/fingerprint，任何 GET 不返回明文。
- MOD-02：Discover 失败不回滚已保存 Provider；stale snapshot Apply 返回 409。
- MOD-03：Model alias 唯一，禁用模型在 Gateway 解析阶段拒绝。
- MOD-04：Pricing overlap/陈旧 replacement 返回 409；历史价格快照不被修改。
- MOD-05：模型中心只保留 Provider、Models、Pricing；不得重复提供用户—模型限制入口，历史 `/admin/models/permissions` 跳转至 Gateway 限流策略。
- MOD-06（Target release gate）：`/api/product/v1/me/model-catalog` 只返回已发布、已定价、Entitlement 允许且未被用户例外禁用的 alias；空集是真实 empty，不回退静态模型。

交互验收映射：MOD-01 → UI-MOD-01；MOD-02 → UI-MOD-02；MOD-03/04 → UI-MOD-03；MOD-05 → UI-MOD-04。
