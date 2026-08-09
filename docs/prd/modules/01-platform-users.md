# 模块 PRD：平台用户与计费账户关系

> 返回：[平台 PRD 总纲](../ink-memory-admin-prd-v3.md) · 交互：[平台用户](../../design/modules/01-platform-users.md)

> 实现状态：**Implemented / Release candidate**；canonical 用户列表、自动兼容键/账户、统一服务端搜索/分页/hydration、命令反查与 QA-only 回归已通过隔离验证。生产历史 orphan 处置仍需回执。

## 0. Current / Target / Release Gate

| 分层 | 范围 |
|---|---|
| Current / Implemented | `CanonicalUserRelationService` 从 `users` 提供 `q/page/pageSize/total`、跨页 hydration 与内部 billing identity；Subscription/credit/Usage/Gateway 等关系入口共享该合同并反查 canonical 用户。 |
| Release candidate evidence | 205-user 搜索/翻页/稳定 total、超过 100 用户、QA seed 非唯一结果、无 `POST 创建计费用户` 与 orphan fail-closed 合同已通过。 |
| Release Gate | 至少 205 用户的搜索/翻页/total 自动化通过；QA seed 不得成为唯一计费用户；orphan 先审计 Key/余额/Usage/Ledger/Subscription 再隔离，不删财务历史。 |

## 1. 目标与产品模型

让运营人员以唯一的 canonical `users` 集合查询平台用户、关联 Story、订阅、账户、Gateway 和用量。每个平台用户天然是计费主体；不存在手工创建或绑定“计费用户”的产品流程。

`platform_users` 仅作为现有文本 FK 的内部一对一兼容键；`billing_accounts` 是用户的一对一财务附属对象。源邮箱、显示名、角色等业务真值来自 `users`。

## 2. 页面与范围

| 页面 | 路由 | 能力 |
|---|---|---|
| 平台用户 | `/admin/resources/users` | 查询真实用户、Workspace/Story 数量、只读详情 |
| 用户默认 Token 上限 | `/admin/gateway/rate-limits#platform-users-manager` | 修改控制面 daily/monthly limit，不修改业务用户 |
| 账户余额 | `/admin/billing/accounts` | 查看一对一账户；调账属于 Billing 模块 |

禁止：创建/删除平台用户、修改 password_hash、手工创建内部兼容行、把停用 Gateway 调用等同删除用户。

## 3. 数据与 API 映射

| 产品对象 | 表/Resource | 读写 |
|---|---|---|
| 平台用户 | `users` / `users`、`source-users` | 业务字段只读 |
| 内部兼容键 | `platform_users` / 内部 `platform-users` | `0015` 自动维护；仅 tier/status/limits 可控 |
| 计费账户 | `billing_accounts` / `billing-accounts` | 自动创建；余额命令式调整 |
| 用户—模型例外限制 | `user_model_permissions` | 见 [Gateway 限流模块](05-gateway.md)；不扩大 Entitlement |

所有用户型 Relation Selector 当前都从 canonical 用户全集经服务端搜索/分页返回稳定内部键；POST `/api/admin/platform-users` 返回 405。生产历史 orphan 的 Key/余额/Usage/Ledger/Subscription 仍需先审计再映射/隔离，不能因 UI 修复而破坏财务历史。

## 4. 规则与冲突

- `(source='ink-dream', external_user_id=users.id)` 唯一；每个兼容键只有一个账户。
- Backfill/trigger 只同步 email/display_name，不覆盖既有 tier、status、limits、余额、订阅、Key、Usage 或 Ledger。
- `platform_users.status` 是 Gateway/控制面访问策略，不是平台用户成员资格。`active` 才能新开订阅并通过 Gateway Key 鉴权；`suspended/closed` 保留用户、账户、订阅和历史事实，不删除 canonical 用户。
- 用户、账户和内部键不一致属于数据完整性事件；页面不得通过创建第二行“修复”。
- `0015` 只补齐/同步 canonical 用户对应兼容行，不删除历史 orphan `platform_users`；当前 Gateway auth 已反向验证 `users.id::text = platform_users.external_user_id` 且 source 正确并对 orphan fail-closed。生产 orphan 仍必须先审计关联 Key、余额、Usage/Ledger，再停用、映射或隔离，禁止破坏性删除财务历史。
- `users.read` 可读用户；`users.write` 仅允许控制面 tier/status/limits 和模型 override。
- `platform_users.email/display_name` 已从产品 mutation 白名单移除；资料变更只走 canonical User 领域命令，兼容 snapshot 不能成为第二套资料真值。

## 5. 验收

- USR-01（Implemented / release candidate）：`users` 全集都可经搜索选择；零余额用户也可选，不受前 100 条本地缓存限制。
- USR-02：新增 canonical 用户自动获得唯一兼容键和零余额账户；重复同步不重复。
- USR-03（Implemented / release candidate）：订阅、Gateway Key、模型权限和人工 credit 选择器均基于同一用户全集。
- USR-04：手工创建兼容用户返回 405；源用户通用 PATCH/DELETE 返回 405。
- USR-05：用户详情和 API 永不返回 password_hash、Session 或 Secret。
- USR-06（P0）：不存在对应 canonical `users` 的兼容行，即使持有 active Key/余额也不能通过 Gateway 认证。
- USR-07（Implemented / release candidate）：Subscription、Gateway Key、用户—模型例外、Usage 和 credit 选择器共享同一 canonical 服务端搜索合同；跨页已选项不丢失。
- USR-08（Implemented / release candidate）：兼容表无 email/display_name 写入路径；新增 canonical 用户在同一可观测边界幂等产生 mapping 和零余额 account。

交互验收映射：USR-01/03 → UI-USR-01；USR-02/04 由 PostgreSQL/API 测试覆盖；USR-05 → UI-USR-02/03。
