# Dream 页面与交互改造清单

> 状态：后续实施清单  
> 返回：[总索引](README.md)  
> 依赖：[业务数据接入边界](02-business-integration-and-admin-boundary.md)  
> 主要读者：产品、Dream 前端、Dream 后端、QA

## 1. 页面改造原则

PostgreSQL 迁移是持久化替换，不是 Dream 产品重做。用户、Story、Character、Scene、Dream、Execution、Chat 和 Settings 应保持现有路由、信息架构和主要操作；前端只处理兼容错误状态和删除未开发领域的误导入口。

四种页面状态：

- **保留**：页面与功能不变，只做回归。
- **仅数据层适配**：页面合同不变，后端从 SQLite 切换 PostgreSQL。
- **隐藏/清理**：当前已有入口会造成未开发能力误解，应隐藏或重定向。
- **延期**：本期不创建页面、Hook、API Client 或占位 CRUD。

## 2. 路由与页面矩阵

| 页面/路由 | 当前证据 | 本期判断 | 后续具体动作 |
|---|---|---|---|
| Story 列表 | `StoryWorkspaceStoriesPage.tsx` | 仅数据层适配 | 保留筛选、分页、审阅和刷新行为；验证 PG 结果顺序/总数/409 |
| Character 列表 | `StoryWorkspaceCharactersPage.tsx` | 仅数据层适配 | 在 Character + 关系表迁移闭包完成后切换；此前不可指向 Admin 旧表 |
| Scene 列表 | `StoryWorkspaceScenesPage.tsx` | 仅数据层适配 | 在 Scene + 关系表迁移闭包完成后切换；保留 story 可空与 order 语义 |
| Dream 工作台 | `StoryWorkspaceDreamPage.tsx` | 保留 + 数据回归 | 不接新推理服务；只验证所依赖 Story/Workflow/Chat PG 持久化不回归 |
| Execution/Review | `StoryWorkspaceExecutionPage.tsx` 及 episode components | 保留 + 数据回归 | 保持 deep link、run 状态、review/confirm 和错误恢复 |
| Settings | `StoryWorkspaceSettingsPage.tsx` | 保留 | 资源、插件、模型、关于等既有分区保持现状；增加 DB 503 通用恢复仅在已有错误边界实现 |
| AI 模型设置 | `ModelConfigSection.tsx`、`/story-workspace/settings/model` | 保留既有能力 | 不连接 Admin Model/Provider/Pricing，不新增付费模型、额度或 Gateway 状态 |
| 静态订阅页 | `StoryWorkspaceSubscriptionPage.tsx`、`.css` | **隐藏/清理** | 删除静态三档方案和“即将开放”营销事实；未重新立项前导航不展示该入口，直接 URL 使用 replace navigation 重定向 `/story-workspace/settings/about` |
| 订阅设置项 | `StoryWorkspaceSettingsPage.tsx` 中 `settings-subscription` | **隐藏/清理** | 从设置导航移除；不替换成真实订阅管理或“联系运营”交易入口 |
| 订阅路由合同 | `storyWorkspacePath.ts`、`story-workspace.tsx` | 兼容清理 | 旧 URL 统一 replace 重定向 `/story-workspace/settings/about` 并补测试；不保留可点击套餐卡 |
| Billing/Usage/Ledger/支付 | 当前无正式 Dream 页面 | **延期** | 不创建新页面、Modal、Drawer、Hook、类型或静态假数据 |
| 推理服务/Gateway 管理 | 当前无正式 Dream 页面 | **延期** | 不创建 Key、Provider、Model Alias、请求日志或 Gateway 错误页 |

## 3. 静态订阅入口清理文件

后续 Dream 实施任务应至少核对：

- `frontend/src/pages/story-workspace/StoryWorkspaceSubscriptionPage.tsx`
- `frontend/src/pages/story-workspace/StoryWorkspaceSubscriptionPage.css`
- `frontend/src/pages/story-workspace/StoryWorkspaceSettingsPage.tsx`
- `frontend/src/pages/story-workspace/index.ts`
- `frontend/src/router/storyWorkspacePath.ts`
- `frontend/src/router/story-workspace.tsx`
- 与 `subscription`/`settings-subscription` 有关的 router、settings 和 responsive tests

确定合同：设置导航不显示“订阅”；旧 `/story-workspace/subscription` 不展示静态套餐，统一使用 replace navigation 返回当前已存在的 `/story-workspace/settings/about`。浏览器后退不得重新进入静态订阅页，桌面和移动入口采用同一行为。

该清理任务的目的只是避免虚构档位，不包括套餐 API、订阅状态、价格、额度、余额或支付开发。

## 4. 数据迁移期间的页面状态

| 状态 | 页面表现 | 禁止行为 |
|---|---|---|
| 正常 | 行为与 SQLite 版本一致 | 暴露数据库类型或内部 DSN |
| 维护窗口 | 全局只读维护提示；写按钮禁用；显示预计重试而非成功 | 写回 SQLite、排队无幂等请求、显示伪成功 |
| 503 数据库不可用 | 保留未提交编辑草稿；提供重试；显示 request ID | 用本地假数据继续提交 |
| 409 资源冲突 | 保留层与输入；加载最新资源后由用户确认重试 | 盲目覆盖 PG 最新值 |
| 401 | 维持当前 Session 刷新/登录流程 | 把数据库错误伪装成登录过期 |
| Empty | 区分真实无数据与筛选无结果 | 因迁移失败显示“暂无内容” |

## 5. 前端 API 与类型边界

- 现有 `frontend/src/api/storyWorkspaceApi.ts`、Story hooks 和 contracts 保持业务字段兼容。
- PostgreSQL `bigint/numeric/timestamptz` 不直接泄露为无法安全处理的 JS number；ID 保持当前 string/number 合同，时间继续使用 ISO 8601。
- JSONB 响应仍按现有对象/数组 contract，不让页面解析数据库 JSON 字符串。
- 分页排序必须由 API 返回稳定 tie-breaker；PG 与 SQLite 默认排序不同，所有列表查询应显式 ORDER BY。
- 任何新增错误字段使用可选类型进行灰度，旧前端仍能显示安全通用错误。
- 本期不新增 `subscriptionApi.ts`、billing types、Gateway client 或 payment SDK。

## 6. 现有模型与推理 UI 边界

`frontend/src/components/dashboard/ModelConfigSection.tsx` 是 Dream 既有配置面，不属于本期新推理服务。PG 迁移只处理它所依赖的配置持久化；不得在本任务中：

- 禁止拉取 Admin Provider/Model/Pricing 目录；
- 禁止展示订阅可用模型、Token 额度或付费标签；
- 禁止注入 Gateway Key；
- 禁止改造 Claude Agent transport；
- 禁止新增 401/402/403/429 Gateway 业务提示。

这些能力只有在 [延期领域](90-deferred-billing-subscription-inference-payment.md) 重新立项后才能进入页面 PRD。

## 7. 页面回归清单

- Story/Character/Scene 列表、详情、筛选、分页、排序和审阅动作结果与迁移前一致。
- Dream deep link、Execution run、Episode review、Workflow timeline、Chat 历史和 Settings 正常。
- 页面请求不包含数据库凭据、password hash、OAuth token 或内部迁移字段。
- 静态订阅入口从导航消失，直接 URL 不再展示虚构三档方案。
- 不出现余额、充值、套餐、支付、用量账单、Gateway Key 或推理服务新入口。
- 1440×1000 和 390×844 无页面级横向溢出；维护/503/409 提示键盘可达并可归焦。

## 8. 测试文件建议

- 更新 router/path 单测覆盖旧 subscription URL 到 `/story-workspace/settings/about` 的 replace redirect。
- 更新 Settings 导航测试确认无订阅入口且其他分区未丢失。
- 为 Story/Character/Scene API hooks 增加 PG contract fixture，验证显式排序和时间/JSON 类型。
- 后端 PostgreSQL 集成测试通过后，复跑 Story Workspace、Dream Agent、Execution、Workflow、Plugin、Session 全部既有测试。
- Playwright 使用隔离 PostgreSQL；不得把 SQLite fixture 当作最终持久化 E2E 通过证据。
