# 模块 PRD：Admin、RBAC、Session、Settings 与 Audit

> 返回：[平台 PRD 总纲](../ink-memory-admin-prd-v3.md) · 交互：[系统治理](../../design/modules/08-governance.md)

> 实现状态：Admin、RBAC、Session、Settings 与 Audit 已实现；Settings 路由当前不在主导航，Secret 当前使用 masked-marker + JSON 覆盖流程而非专用 password 控件。

## 1. 目标

治理谁可以访问 Admin、可以执行哪些模块动作、系统配置如何安全更新，以及所有关键操作如何留下不可变证据。

## 2. 页面

| 页面 | 路由 | 权限 |
|---|---|---|
| 管理员 | `/admin/access/admins` | `access.read`、`access.write` |
| 角色 | `/admin/access/roles` | `access.read`、`access.write` |
| 权限 | `/admin/access/permissions` | `access.read`；只读 |
| 系统设置 | `/admin/system/settings` | `system.read`、`system.write`；当前非主导航入口 |
| 审计日志 | `/admin/system/audit` | `audit.read` |

## 3. 领域规则

- Admin User 与平台 `users` 是不同安全域；不得复用业务用户 role 作为 Admin RBAC。
- 管理员可创建、改显示名/状态、重置密码、分配角色，不硬删；最后一个 active super_admin 不得停用。
- 内置 Role 不可删除；自定义 Role 删除前展示关联管理员，有引用返回 409。
- Permission code 只读，按域/风险分组；服务端每次请求重新校验。
- System Secret 只写不读；GET 返回 masked marker；空值不清除历史 Secret。
- `admin_audit_logs` append-only，保存 actor/action/resource/request/before-after 的安全摘要，不复制 Secret/Payload 正文。
- Session 存 hash、到期、revoked；密码使用安全 hash；登出/revoke 立即失效。

## 4. 验收

- GOV-01：无 Session 401；无 permission 403；客户端隐藏与服务端授权一致。
- GOV-02：最后一个 Super Admin、内置 Role、被引用 Role 的危险动作返回 409。
- GOV-03：角色权限变更显示 before/after 和受影响管理员并写 Audit。
- GOV-04：System Secret/API Key/密码/Session token 不回显、不进 Audit 或日志。
- GOV-05：Audit 无 update/delete，按 actor/action/resource/time 可分页筛选并可追溯 request ID。

交互验收映射：GOV-01/02 → UI-GOV-01/02；GOV-03/04/05 → UI-GOV-03/04 + API/数据库不可变断言。
