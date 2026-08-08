# Ink Memory Admin PRD v3 — 平台总纲

> 版本：3.0  
> 更新：2026-08-08  
> 状态：平台产品与工程实施基线  
> 详细需求：[`docs/prd/modules/`](modules/)  
> 全局交互规范：[`docs/design/refine-admin-ui-v3-interaction-design.md`](../design/refine-admin-ui-v3-interaction-design.md)

## 1. 产品定位

Ink Memory Admin 是剧本业务运营控制台、AI 模型控制面、订阅计费后台和安全治理入口。主要操作者是内容运营、模型运营、财务运营、客服支持、安全审计与 Super Admin；它不是 Dream 创作前台，不恢复已移除的 PWA。

平台必须完成以下闭环：

```mermaid
flowchart LR
  U["平台用户 users"] --> S["订阅与权益（目标主路径）"]
  U -. "当前：从未订阅用户的余额兼容路径" .-> G
  S --> G["Gateway 资格判断"]
  G --> R["Provider / Model / Pricing"]
  G --> X["Request / Usage"]
  X --> A["Allowance / Billing Account"]
  A --> L["Append-only Ledger"]
```

## 2. 不可变产品决策

1. PostgreSQL `users` 是唯一平台用户全集；所有平台用户天然可订阅、持有计费账户、获得 Gateway Key 并产生 Usage/Ledger。不存在独立“计费用户”。
2. `platform_users` 仅是现有 Gateway/Billing 文本外键的内部一对一兼容键，由迁移与 trigger 自动维护，不作为产品主数据或手工开户入口。
3. Dream 权威业务表使用真实原名；Admin 不读取错误平行 Story 表，不修改 Dream 仓库。缺表时 503 fail-closed，不回退 SQLite、JSON 或内存数据。
4. 单一 `DATABASE_URL`、单一 PostgreSQL 数据库 `ink-memory`、单一连接池。Route Handler 只做 Session/RBAC、Origin、解析、Zod 和 service 调用；SQL、事务与状态机位于 `app/lib/**`。
5. 金额事实为整数 micro-USD；Plan Version、价格快照不可覆盖；Usage、Ledger、Subscription Event 与 Audit 不可变或只追加。
6. Provider/System Secret 永不由读取接口返回；Gateway Key 明文仅在创建响应返回一次，之后永不重读。三者均不得明文落库、写日志、遥测或自动化截图；人工视觉验收只使用明确的脱敏测试值。
7. 不使用假数据、虚构 KPI 或没有真实 API/领域行为的 CRUD 外壳。

当前存在一项明确的迁移兼容例外：**从未拥有任何订阅记录**的平台用户会继续沿用既有 cash balance-only Gateway 策略；一旦用户存在订阅记录，即按订阅状态与权益强制校验。该例外不是独立“计费用户”设计，也没有运行时开关或既定结束日期；它是待通过代码变更、数据迁移与灰度发布移除的已知风险。

## 3. 模块地图

| 模块 | PRD | 主要路由 | 实现状态（2026-08-08） |
|---|---|---|---|
| 平台基础与总览 | [00-platform-foundation](modules/00-platform-foundation.md) | `/admin`、登录与 Shell | Shell/登录/真实 Story 快照已实现；Gateway/计费摘要和页面级 permission guard 未完成 |
| 平台用户 | [01-platform-users](modules/01-platform-users.md) | `/admin/resources/users` | canonical 用户模型已实现；两个本地关系选择器仍只取前 100 条，聚合详情规划中 |
| Dream 创作运营 | [02-story-operations](modules/02-story-operations.md) | `/admin/story/**` | Workspace/Story 已实现；扩展表条件开放；Workflow 跳转 Story |
| 订阅与权益 | [03-subscriptions](modules/03-subscriptions.md) | `/admin/subscriptions/**` | 核心 Schema/API/UI/Gateway 已实现；富详情/影响预览规划中 |
| 模型供应链 | [04-model-catalog](modules/04-model-catalog.md) | `/admin/models/**` | 已实现；RPM 编辑暂不开放 |
| Gateway | [05-gateway](modules/05-gateway.md) | `/admin/gateway/**`、`/v1/**` | 协议/Key/Request/Payload/限流已实现；订阅结算富详情部分实现 |
| Usage 与账务 | [06-billing](modules/06-billing.md) | `/admin/billing/**` | Usage/账户/Ledger/报表/CSV/credit 已实现；debit/reversal 命令规划中 |
| Storage | [07-storage](modules/07-storage.md) | `/admin/resources/storage`、`/api/storage/**` | 已实现 |
| 权限与系统治理 | [08-governance](modules/08-governance.md) | `/admin/access/**`、`/admin/system/**` | 已实现；Settings 当前不在主导航 |

专项历史文档继续作为证据，不是平台入口：旧版 [AI 平台控制面设计](../design/ai-platform-admin-billing-gateway-design.md) 已标记 superseded，Gateway 完整报文条款已收敛到 [Gateway PRD](modules/05-gateway.md) 与 [Gateway 交互规范](../design/modules/05-gateway.md)；v2 保留为历史基线，不再新增跨模块需求。

## 4. 角色与权限原则

| 角色 | 默认职责 | 禁止越界 |
|---|---|---|
| Super Admin | 全模块、RBAC、Secret、财务高风险命令 | 不能改写 Ledger/Audit/历史版本 |
| Operator | Story、模型、订阅、Gateway 日常运营 | 默认无 `billing.adjust`、`access.write`、`gateway.payloads.read` |
| Auditor | 读取运营事实、RBAC、Audit、受保护 Payload | 不执行写操作 |

服务端权限码按模块使用：`dashboard.*`、`story.*`、`users.*`、`subscriptions.*`、`providers.*`、`models.*`、`pricing.*`、`gateway.*`、`billing.*`、`storage.*`、`access.*`、`system.*`、`audit.*`。客户端隐藏按钮只是可用性优化，不是授权边界。

## 5. 全局状态契约

| 状态 | 产品表现 | 恢复路径 |
|---|---|---|
| Loading | 保留页头、筛选和表头的等高骨架 | 不跳焦；超时说明仍在加载 |
| Empty | 区分系统无数据与筛选无结果 | 创建（仅允许域）、清筛或返回上层 |
| 400 | 错误摘要与字段错误，保留草稿 | 聚焦首错 |
| 401 | 清除保护内容并进入登录 | 登录后安全返回原 URL |
| 402 | 订阅额度或账户余额不足 | 展示下次重置、升级或账户处理入口 |
| 403 | 显示所需 permission，不泄露记录 | 返回可访问模块或申请权限 |
| 404 | 资源不存在或不可见 | 返回模块列表 |
| 409 | 展示最新状态、冲突对象和 request ID | 刷新/载入最新值后重试，不盲写 |
| 429 | Gateway 请求/Token 限额 | 显示 Retry-After/窗口与实际可用配置入口；实时计数只读 |
| 500 | 安全错误摘要和 request ID，不展示 SQL/stack/Secret | 重试或复制 request ID 联系支持 |
| 503 | 数据源或依赖不可用 | 明确依赖与重试；禁止假数据回退 |
| Success | 显示资源 ID、实际结果、审计/幂等回执 | 刷新受影响查询并合理归焦 |

## 6. 跨模块数据与调用边界

| 数据域 | 权威表/服务 | 写入者 | 消费模块 |
|---|---|---|---|
| 平台用户 | `users` | Dream/迁移；Admin 业务字段只读 | 用户、订阅、Gateway、账务 |
| Story | `story_workspace_*` | Dream；Admin 仅受控字段/确认命令 | Story、总览 |
| 订阅 | `subscription_*` | Subscription service | Gateway、账务、用户详情 |
| 模型供应链 | `ai_providers/models/pricing_rules` | Model services | Gateway、订阅权益、Usage |
| Gateway 事实 | `gateway_*`、payload tables | Gateway lifecycle | Usage、审计、支持排障 |
| 财务事实 | `billing_accounts`、`billing_ledger_entries` | Billing transaction services | Billing、订阅、Gateway |
| 治理 | `admin_*`、`system_settings` | Admin security services | 全模块 |

## 7. 发布与回滚

### 7.1 当前已知发布缺口

| 级别 | 缺口 | 发布要求 |
|---|---|---|
| P0 | Gateway Key 认证当前只关联 `platform_users`，未反向 JOIN canonical `users`；`0015` 会补齐 canonical 行但不清理历史 orphan。旧 orphan 若仍有 active Key/余额，可能同时绕过 canonical 用户和订阅主路径 | Gateway auth 强制验证 canonical `users` 存在；在隔离库先审计、停用或映射 orphan，禁止直接删除有财务历史的行 |
| P0 | Token allowance 耗尽时，当前 402 可能把 Token 数写入 `available_microusd/required_microusd` | 错误载荷必须增加明确 `metric/unit`，Token 与 micro-USD 使用不同字段；协议与 Dream 错误处理同步回归 |
| P1 | 无订阅历史用户仍走 cash-only 兼容路径，且无开关/退出日期 | 明确迁移策略后以 cohort 灰度移除，不得当作独立计费用户模型 |
| P1 | 生命周期没有周期推进任务；`cancel_at_period_end` 不能通过 resume 恢复，只能 renew/upgrade 且会收费/重开周期 | 补状态推进 worker 与真正的取消恢复命令，或在 UI 明确当前限制 |
| P1 | 订阅开通与人工 credit 的用户选择器各只加载前 100 条 | 改为 canonical 用户服务端搜索/分页 |
| P1 | Dashboard UI 未呈现 API 已返回的模型、请求、Token、费用和结算失败；页面 Shell 仅做登录/启用检查，模块权限主要由 API 403 保证 | 补真实摘要和页面级 permission guard；完成前不得宣称页面直接访问返回 403 |

- Schema 只做增量、非破坏迁移；旧平行表停止使用但不在本轮删除。
- Plan Version、Pricing snapshot、Usage、Ledger、Audit 和 Subscription Event 不回滚为旧内容；问题使用向前修复或 reversal。
- 新模块按“只读影子查询 → 小范围运营写入 → Gateway cohort → 全量”灰度。
- 数据库测试只允许明确一次性 PostgreSQL 或 `TEST_DATABASE_URL`；不得迁移、清空或删除未知共享数据库。
- Dream 后续接入遵循 [`ink-dream-subscription-integration-change-list.md`](../architecture/ink-dream-subscription-integration-change-list.md)，Admin 本轮不修改 Dream 代码。

## 8. 平台级验收

- 每个平台用户自动拥有唯一内部兼容键和唯一计费账户；任何用户选择器不依赖手工开户。当前订阅开通和人工 credit 的本地选择器只加载前 100 名用户，是必须消除的已知规模化缺口。
- 所有列表具备真实总数、服务端分页/排序、白名单筛选和明确错误映射。
- Session/RBAC 401/403、唯一/FK/状态 409、依赖 503 均有自动测试。
- 目标主路径按 `User → Subscription → Entitlement → Model Permission → Allowance/Balance → Request → Usage → Ledger` 执行并冻结快照；当前仅“从未订阅”用户保留 cash-only 兼容路径，已有任意订阅记录的用户不得绕过订阅资格。
- Provider/System Secret 不出现在详情、API 重读、日志、DOM、遥测或自动化截图；Gateway Key 明文只存在于一次性创建回执。Usage/Ledger/Audit 不提供更新/删除。
- 1440×1000 与 390×844 无页面级横向溢出，键盘、焦点、label、状态文字和读屏通知可用。
- `pnpm env:check`、TypeScript、lint、unit、build、隔离 PostgreSQL与 focused Playwright 通过；Storage、PWA 404 和 Dream 真实表回归不退化。

## 9. 文档维护规则

- 新需求先进入对应模块；只有跨三个以上模块的决策才修改本总纲。
- PRD 描述“为什么、范围、规则与验收”；交互规范描述“页面如何工作”；实现细节只保留足以建立可测试契约的映射。
- 模块 PRD 与对应交互文档必须双向链接，状态、路由、权限、表名、金额单位和验收编号一致；`00-platform-foundation` 对应 `00-admin-shell`，其余模块使用同名文件。
- 变更不得覆盖历史文档；过时内容标记 superseded，并从本索引移除主入口。
