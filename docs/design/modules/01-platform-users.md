# 模块交互：平台用户

> 返回：[全局交互规范](../refine-admin-ui-v3-interaction-design.md) · PRD：[平台用户](../../prd/modules/01-platform-users.md)

> 实现状态：用户列表与限额编辑已实现；统一 Relation Selector 是 Target。当前 Subscription、credit 和 Usage 专用选择器只加载首页 100，通用 relation 只有首页 50/100；跨模块聚合详情 Drawer 也尚未实现。

## 0. Current / Target / Release Gate

| 分层 | 交互边界 |
|---|---|
| Current | canonical 用户列表和限额编辑；Subscription/credit/Usage 各只加载首页 100，通用 relation 仅首页 50/100，跨模块详情未完成。 |
| Target | 所有 Subscription、Gateway Key、用户—模型例外、Usage 和 credit 使用同一 canonical 服务端 typeahead/paging/hydration；UI 始终称“平台用户”。 |
| Release Gate | 205 用户跨页搜索/选中/total、orphan 403/409 和 390×844 长邮箱/ID 通过；无“创建计费用户”入口。 |

## 1. 页面目的

内容运营、支持和财务人员查询同一套真实平台用户，并从用户进入 Workspace、Story、订阅、账户、Gateway 与 Usage。页面不得出现“计费用户”“初始化身份”或第二套用户创建按钮。

## 2. 用户列表 `/admin/resources/users`

| 列 | 展示 |
|---|---|
| 用户 | email 主行、display name 次行 |
| ID | canonical `users.id`，mono、可复制 |
| 业务角色 | 状态文字标签 |
| Workspace/Story | 真实数量链接 |
| 创建/更新 | 本地时区 + 原始时间 tooltip |

筛选：邮箱/显示名关键词、业务角色；排序：updated/created/email；分页 20/50/100。无创建、编辑、删除和批量动作。

详情使用宽 Drawer：身份只读 → Workspace/Story → Subscription → Account/Allowance → Gateway Keys/Usage → 技术信息。内部兼容 ID 只放技术信息并标注“内部兼容键”，不能比 canonical ID 更突出。

## 3. 关系选择器

订阅、Gateway Key、Gateway 用户—模型例外、Usage、credit 等使用同一个可搜索 Relation Select：

- accessible label 统一“平台用户”；选项主行 email，次行 display name + canonical ID。
- 默认分页加载，输入搜索服务端请求；loading/empty/error 显示在下拉内。
- 下拉显示当前范围/总数与加载更多；已选项即使不在当前页也会按 ID hydration，不因新搜索丢失 label。
- 零余额、无订阅用户仍可选；不得因内部兼容行缺少运营字段而隐藏用户。
- 浏览器提交内部兼容键，但 UI 不要求操作者理解或输入该键。

当前差距：`SubscriptionLifecycleManager`、`BillingAdjustmentForm` 与 `AdminUsageDashboard` 只请求首页 100，通用 relation 无翻页/hydration。它们必须迁移到上述服务端搜索/分页合同；在完成前，空搜索结果不得显示“该用户不是计费用户”，应明确是规模化查询缺口。

## 4. 用户计费设置

用户级 Token 上限在 `/admin/gateway/rate-limits#platform-users-manager` 的 Drawer 编辑：daily/monthly number，可空表示该层不设上限；tier/status 为有权限人员的控制面字段。保存前显示最终限制还受模型 override 和套餐权益取最小值。

## 5. 状态与验收

- 503：说明 canonical 用户表/映射迁移状态，不显示手工开户入口。
- 409：显示完整性冲突并要求运维检查，不允许创建重复身份。
- UI-USR-01（目标）：所有用户选择器可搜索同一 canonical 全集；不受前 100 条加载限制。
- UI-USR-02：390×844 的长邮箱/ID 换行或局部截断，不产生根横滚。
- UI-USR-03：用户详情中账户、订阅、Usage 都是链接/只读事实，危险动作进入所属模块。
- UI-USR-04（Target release gate）：搜索“QA”只返回匹配结果而非唯一计费名册；清搜索恢复稳定 total，orphan 不被创建第二身份“修复”。
- UI-USR-05（Target release gate）：兼容 profile email/display_name 不提供可编辑控件，避免保存成功但 canonical 列表不可见的 split-brain。
