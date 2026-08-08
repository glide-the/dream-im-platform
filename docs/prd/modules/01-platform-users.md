# 模块 PRD：平台用户与计费账户关系

> 返回：[平台 PRD 总纲](../ink-memory-admin-prd-v3.md) · 交互：[平台用户](../../design/modules/01-platform-users.md)

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
| 用户模型覆盖 | `user_model_permissions` | 见模型模块 |

所有用户型 Relation Selector 必须从 canonical 用户全集返回稳定内部键；POST `/api/admin/platform-users` 返回 405。

## 4. 规则与冲突

- `(source='ink-dream', external_user_id=users.id)` 唯一；每个兼容键只有一个账户。
- Backfill/trigger 只同步 email/display_name，不覆盖既有 tier、status、limits、余额、订阅、Key、Usage 或 Ledger。
- 用户、账户和内部键不一致属于数据完整性事件；页面不得通过创建第二行“修复”。
- `users.read` 可读用户；`users.write` 仅允许控制面 tier/status/limits 和模型 override。

## 5. 验收

- USR-01：`users` 行数与可选择平台用户数一致；零余额用户也可选。
- USR-02：新增 canonical 用户自动获得唯一兼容键和零余额账户；重复同步不重复。
- USR-03：订阅、Gateway Key、模型权限选择器均显示同一用户全集。
- USR-04：手工创建兼容用户返回 405；源用户通用 PATCH/DELETE 返回 405。
- USR-05：用户详情和 API 永不返回 password_hash、Session 或 Secret。

