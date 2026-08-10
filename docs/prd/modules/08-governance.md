# 模块 PRD：Admin、RBAC、Session 与 Audit

> 返回：[平台 PRD 总纲](../ink-memory-admin-prd-v3.md) · 交互：[系统治理](../../design/modules/08-governance.md)

> 实现状态：Admin、RBAC、Session 与 Audit 已实现；System Settings 页面和管理 CRUD 已下线。

## 0. Current / Target / Release Gate

| 分层 | 范围 |
|---|---|
| Current | Admin/RBAC/Session/Audit 基线已有。Dream ASR endpoint 已代码级 fail-closed，但历史 Provider credential 的所有者吊销/轮换回执尚未完成。 |
| Target | Provider/Gateway/Payment Secret 统一只写、安全注入与结构化日志脱敏；Subscription、Payment Webhook、独立 Billing/Ledger 与 Gateway 高风险命令写 append-only Audit。真实第三方支付渠道 Deferred。 |
| Release Gate | active runtime 移除与 secret scan 已通过；仍须取得 credential owner 吊销/轮换/历史处置回执。保持 ASR fail-closed，直到另立 streaming-audio capability/计量合同；任何 Secret 不进 DB 明文、API、DOM、log、Audit 或截图。 |

## 1. 目标

治理谁可以访问 Admin、可以执行哪些模块动作，以及所有关键操作如何留下不可变证据。

## 2. 页面

| 页面 | 路由 | 权限 |
|---|---|---|
| 管理员 | `/admin/access/admins` | `access.read`、`access.write` |
| 角色 | `/admin/access/roles` | `access.read`、`access.write` |
| 权限 | `/admin/access/permissions` | `access.read`；只读 |
| 审计日志 | `/admin/system/audit` | `audit.read` |

## 3. 领域规则

- Admin User 与平台 `users` 是不同安全域；不得复用业务用户 role 作为 Admin RBAC。
- 管理员可创建、改显示名/状态、重置密码、分配角色，不硬删；最后一个 active super_admin 不得停用。
- 内置 Role 不可删除；自定义 Role 删除前展示关联管理员，有引用返回 409。
- Permission code 只读，按域/风险分组；服务端每次请求重新校验。
- Provider 与 Gateway Secret 共享“只写不读”不变量；Gateway Key 只有创建回执一次明文，不适用于 Provider Secret。Deferred Payment 不新增 Secret 字段、普通配置键或 event payload。
- `admin_audit_logs` append-only，保存 actor/action/resource/request/before-after 的安全摘要，不复制 Secret/Payload 正文。
- Session 存 hash、到期、revoked；密码使用安全 hash；登出/revoke 立即失效。

## 4. 验收

- GOV-01：无 Session 401；无 permission 403；客户端隐藏与服务端授权一致。
- GOV-02：最后一个 Super Admin、内置 Role、被引用 Role 的危险动作返回 409。
- GOV-03：角色权限变更显示 before/after 和受影响管理员并写 Audit。
- GOV-04：Provider Secret/API Key/密码/Session token 不回显、不进 Audit 或日志。
- GOV-05：Audit 无 update/delete，按 actor/action/resource/time 可分页筛选并可追溯 request ID。
- GOV-06（Target release gate）：Subscription 生命周期、Payment Webhook、Token Allowance、独立 Ledger reversal 与 Gateway Payload reveal 均产生不含 Secret/完整 payload 的 append-only Audit；真实支付渠道审计随渠道接入另行评审。
- GOV-07（P0 release gate）：仓库 secret scan 和匿名 ASR 连接拒绝测试通过；未完成 streaming-audio 计量合同前 ASR Gateway 保持 Deferred/disabled。

交互验收映射：GOV-01/02 → UI-GOV-01/02；GOV-03/04/05 → UI-GOV-03/04 + API/数据库不可变断言。
