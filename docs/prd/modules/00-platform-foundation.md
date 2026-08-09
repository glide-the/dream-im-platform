# 模块 PRD：平台基础、Admin Shell 与运营总览

> 返回：[平台 PRD 总纲](../ink-memory-admin-prd-v3.md) · 交互：[Shell 与总览](../../design/modules/00-admin-shell.md)

> 实现状态：登录、Shell、真实 Story 快照、API Session/RBAC 已实现；Dashboard UI 目前只渲染用户/Workspace/Story/待审核四项，尚未呈现 API 已返回的模型、Gateway、Token、费用和结算失败；页面层模块 permission guard 未完成，主要由数据 API 返回 403。

## 0. Current / Target / Release Gate

| 分层 | 范围 |
|---|---|
| Current | 登录、Shell、Session/RBAC API 和部分真实摘要；页面级 403、完整 Gateway/计费摘要未完成。 |
| Target | 显示 Admin 控制面、Dream 43+5 PostgreSQL 迁移健康、Token-only Product/Payment API 与 Gateway 结算的真实状态；不跨域执行写命令。PaymentAdapter/Webhook 已实现，只有真实第三方支付渠道 Deferred。 |
| Release Gate | 直接页面与 API 均有 401/403；部分依赖失败只影响对应分区；所有数字有时间窗/时区/来源，缺数据不显示 0。 |

## 1. 目标与角色

为所有 Admin 模块提供一致的登录、Session、RBAC、导航、数据源健康、错误恢复和真实运营总览。适用所有管理员；Super Admin 负责初始化，Operator/Auditor 仅看到获权模块。

非范围：业务前台、PWA、虚构 KPI、跨模块绕过权限的快捷写操作。

## 2. 页面与能力

| 页面 | 路由 | 能力 |
|---|---|---|
| 登录/首次初始化 | `/admin/login` | bootstrap、登录、错误恢复；首次管理员只能创建一次 |
| 运营总览 | `/admin` | Story 数据源/迁移状态、启用模型、产品 API、今日请求/Token/独立 Provider 成本与结算失败等真实事实（Target） |
| 全局 Shell | `/admin/**` | permission-aware 导航、面包屑、身份菜单、移动导航 |

总览数据不可用时显示 unavailable，不显示 0；所有数字标注时间窗、时区、更新时间和来源。卡片只能导航或刷新，不提供跨域写入。

## 3. 技术映射

| Resource/API | Service/表 | 权限 |
|---|---|---|
| `GET /api/admin/dashboard` | `app/lib/admin/dashboard.ts`；跨域只读聚合 | `dashboard.read` |
| `/api/admin/auth/bootstrap`、`/login`、`/logout`、`/me` | Session、Admin User/Role/Permission tables | 登录入口 + 服务端防护 |

## 4. 核心规则

- 显式 `ADMIN_CONSOLE_ENABLED=false` 必须 fail-closed；生产环境不得隐式开放。
- HttpOnly、SameSite Session；服务端重新校验 Session、状态、角色和 permission。
- 初始化 Token、Session Secret 不回显；不能创建第二个“首位管理员”。
- 导航隐藏不代替 API 授权。目标合同是无权页面与接口分别呈现 403；当前页面 Shell 只校验控制台启用/登录状态，具体数据 API 会 403，但直接页面请求可能先返回 200 壳层，这是已知缺口。
- PostgreSQL 迁移健康只读取 manifest/rehearsal/cutover 真实事实；未连接、未迁移或权限不足显示 unavailable/503，不用静态“健康”占位。

## 5. 状态与验收

- FND-01：未登录访问 `/admin` 跳转登录，保护 API 返回 401。
- FND-02（目标 release gate）：无 permission 的菜单不可见，直接请求页面/API 返回 403 且不泄露数据；当前仅 API 403 已满足。
- FND-03（目标 release gate）：总览显示数据库真实值及 API 已提供的模型/Gateway/Token/费用/结算失败；每项有时间窗、时区、更新时间和来源。缺 Story 表时仅 Story 区显示 migration required，其他控制面仍可用。
- FND-04：首次初始化并发请求至多一个成功，其他返回 409。
- FND-05：1440×1000 与 390×844 导航、面包屑、键盘焦点和页面滚动符合全局规范。
- FND-06（Target release gate）：迁移、产品 API 与 Gateway 健康均来自可追溯真实数据；502/503 有依赖名称、request ID 和安全重试。Payment/Webhook 不得出现伪健康指标。

交互验收映射：FND-01/02/03 → UI-FND-02/04；FND-05 → UI-FND-01/03；FND-04 由 API 并发测试覆盖。
