# 模块 PRD：Provider、Model、Pricing 与模型权限

> 返回：[平台 PRD 总纲](../ink-memory-admin-prd-v3.md) · 交互：[模型供应链](../../design/modules/04-model-catalog.md)

## 1. 目标

管理上游 Provider、稳定 Model alias、不可追溯覆盖的价格版本、模型发现/目录同步和用户模型权限，为 Gateway 与订阅权益提供真实配置。

## 2. 页面

| 页面 | 路由 | Resource/权限 |
|---|---|---|
| Provider | `/admin/models/providers`、`/admin/models/providers/new`、`/admin/models/providers/[id]/edit` | `providers`；`providers.read`、`providers.write` |
| Discover Diff | `/admin/models/providers/[id]/discover/[snapshotId]` | discovery snapshot；`providers.write` |
| Model | `/admin/models/models`、`/admin/models/models/new`、`/admin/models/models/[id]/edit` | `models`；`models.read`、`models.write` |
| Pricing | `/admin/models/pricing`、`/admin/models/pricing/new`、`/admin/models/pricing/sync/[snapshotId]` | `pricing-rules`；`pricing.read`、`pricing.write` |
| 模型权限 | `/admin/models/permissions` | `user-model-permissions`；`users.read`、`users.write` |

## 3. 领域规则

- Provider Credential 加密保存、只写不读；空 Secret 表示不轮换。Provider 停用不硬删。
- `ai_models.code` 是外部稳定 alias；`upstream_model` 只在服务端解析。Model 启停不改历史 Request。
- Discover 生成不可变 snapshot；Apply 使用 snapshot version + idempotency key，冲突重新 discover，不强制覆盖。
- Pricing 使用整数 micro-USD / million tokens；活动窗口不可重叠；更新价格通过创建新版本并关闭旧窗口，Request 冻结 price snapshot。
- models.dev 同步保留 source/ref/version/hash；只有 exact match 默认选，unmatched 不按 0 定价。
- User Model Permission 是更严格 override；不扩大 Subscription Entitlement。当前 Admin 暂不开放 RPM 编辑，保留 Token limit/enable 管理。

## 4. API/表

`ai_providers`、`ai_models`、`ai_pricing_rules`、`ai_provider_discovery_snapshots`、`ai_pricing_sync_snapshots`、`user_model_permissions`。通用 Admin Route 只编排，发现、连通、校验、同步和冲突规则位于 `app/lib/admin/**`、`app/lib/models/**`。

## 5. 验收

- MOD-01：Provider Secret 创建后仅返回 configured/fingerprint，任何 GET 不返回明文。
- MOD-02：Discover 失败不回滚已保存 Provider；stale snapshot Apply 返回 409。
- MOD-03：Model alias 唯一，禁用模型在 Gateway 解析阶段拒绝。
- MOD-04：Pricing overlap/陈旧 replacement 返回 409；历史价格快照不被修改。
- MOD-05：模型权限用户选择器覆盖全部 canonical 用户，并受 Subscription 权益上限约束。
