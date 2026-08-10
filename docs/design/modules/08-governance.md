# 模块交互：Admin、RBAC 与 Audit

> 返回：[全局交互规范](../refine-admin-ui-v3-interaction-design.md) · PRD：[系统治理](../../prd/modules/08-governance.md)

> 实现状态：Admin/RBAC/Audit 已实现；System Settings 页面与管理 CRUD 已下线。

## 0. Current / Target / Release Gate

| 分层 | 交互边界 |
|---|---|
| Current | Admin/RBAC/Audit 基线。Dream ASR endpoint 已代码级 fail-closed，但历史 credential 的所有者吊销/轮换回执仍是 P0。 |
| Target | Provider/Gateway/Payment Secret 统一只写覆盖，高风险 Subscription/Payment Webhook/独立 Billing/Gateway 操作产生 append-only Audit。只有真实支付渠道 Deferred。 |
| Release Gate | Secret owner 吊销/轮换/scan 回执、ASR 持续 fail-closed、RBAC、Audit 不可变和两视口键盘/读屏验证通过。 |

## 1. 管理员

列表列 email/display、status、roles、last login、updated；筛选 email/status/role。创建/编辑 Drawer：email、display text，roles searchable multiselect，status select；密码创建/重置用 Secret 控件且不回填。

停用 Modal 显示目标、角色、活跃 Session 和影响；最后一个 active Super Admin 预先警告，服务端竞态仍返回 409。无硬删除。

## 2. Role 与 Permission

Role 列 code/name/type、permission count、admin count；自定义 Role 使用独立页或宽 Drawer。权限矩阵按 domain/risk 分组，checkbox 44px 命中区，搜索 permission code；保存前显示新增/移除及受影响管理员。

内置 Role 只读/不可删除。自定义 Role 删除要求输入 code，并显示关联管理员；有引用时 409。Permission 页面只读，列 code/name/description/domain。

## 3. Audit

高密度只读表：time、actor/type、action、resource/type/id、request ID、safe before/after。筛选 actor/action/resource/time；详情宽 Drawer 展示安全 JSON 和相关资源链接。无 create/edit/delete/export Secret 正文。

## 4. 状态、响应式与验收

- 角色/管理员 409 留在确认层并刷新关联计数；403 不显示矩阵内容。
- Mobile 权限矩阵按 domain 折叠，行标签与 checkbox 保持关联；Audit JSON 自身滚动。
- UI-GOV-01：键盘完成管理员创建、角色分配和自定义 Role 更新。
- UI-GOV-02：最后 Super Admin/内置 Role/被引用 Role 危险动作有可恢复 409。
- UI-GOV-03：Secret、密码、Session token 不进入 DOM 重读、Copy、Audit、自动化截图或遥测；人工截图验收只使用明确的脱敏测试值。
- UI-GOV-04：Audit 只读，before/after 有明确空值语义且可追溯 request ID。
- UI-GOV-05（Target release gate）：Subscription/Payment Webhook/独立 Billing/Gateway 操作的 Audit 只含安全 fingerprint/reference/digest，不含 Secret、完整 payload 或一次性 Key；查看 Payload 仍经独立权限门。
- UI-GOV-06（P0 release gate）：已提交 credential 未被所有者确认吊销/轮换或 ASR 匿名连接仍可用时，系统健康显示 blocking 而非 green；不展示 credential 值。
