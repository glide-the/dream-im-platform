# Ink Memory Admin PRD v3 — 平台总纲

> 版本：3.5
> 更新：2026-08-10
> 状态：平台主体为 **Implemented / Release candidate**；Story Artifact → PostgreSQL Index 采用共享只读文件系统方案，进入隔离环境实现与验证
> 详细需求：[`docs/prd/modules/`](modules/)  
> 全局交互规范：[`docs/design/refine-admin-ui-v3-interaction-design.md`](../design/refine-admin-ui-v3-interaction-design.md)

## 0. 状态与本轮范围

| 分层 | 本文定义 |
|---|---|
| **Current / Implemented** | Admin `0000–0024`、唯一 canonical 用户投影、Token-only 个人月度订阅、付费开通/续费、Subscription Token Ledger、Product/Payment API、strict Gateway/Token settlement、PaymentAdapter/Fake/Webhook 已在本机 PG 与隔离库通过；Dream 48/569/81/25 Alembic、43+5 CLI、PG-only runtime、Product BFF、全入口 Gateway client 与真实订阅/支付页已实现。 |
| **Release candidate evidence** | Admin 66 files/313 tests、tsc/lint/build 与隔离 Payment activation/renewal 集成通过；Dream backend 1,679 passed/14 skipped/652 subtests、推理聚焦 61 passed，frontend lint 0 errors/21 warnings/build、Product API 9/9、订阅 Playwright 4/4；本地 `ink-memory` 43+5/4921 行 cutover、Admin migrations=25 与真实 startup/health 通过。 |
| **Story Artifact / Index target** | **Implementation in progress**：剧本与 Episode 产物以 Dream Artifact 为内容真源，`story_workspace_stories` 作为可检索元数据索引；Dream 唯一写入 Artifact 与索引，Admin 只读 PostgreSQL，并从同一只读挂载按数据库资源 ID 受控预览 Artifact。 |
| **Release Gate** | 真实生产源 rehearsal/owner/ACL/备份/cutover、生产 Session/服务身份、外部 Provider/user canary、credential owner 吊销/轮换回执尚未完成。不得把 Release candidate 误报为生产发布。 |
| **Deferred** | 真实 Stripe/支付宝/微信支付/银行渠道，以及尚无 streaming-audio capability/计量合同的 ASR Gateway 接入。PaymentAdapter/Fake/Webhook 不再 Deferred。 |

## 1. 产品定位

Ink Memory Admin 是剧本业务运营控制台、AI 模型控制面、订阅计费后台和安全治理入口。主要操作者是内容运营、模型运营、财务运营、客服支持、安全审计与 Super Admin；它不是 Dream 创作前台，不恢复已移除的 PWA。

平台的 Release candidate 主链已实现以下闭环；真实 Provider/cutover 仍受发布门禁约束：

```mermaid
flowchart LR
  U["Canonical User (users)"] --> S["Monthly Subscription"]
  S --> V["Plan Version"] --> E["Entitlement"] --> M["Model Permission"]
  M --> A["Current-period Token Allowance"] --> G["Gateway Request"]
  G --> X["Token Usage"]
  G --> R["Independent Provider / Model / Pricing"]
  R --> B["Independent Billing Account / Ledger"]
  U -. "Independent explicit cash mode only" .-> B
```

## 2. 不可变产品决策

1. PostgreSQL `users` 是唯一平台用户全集；所有平台用户天然可订阅、持有计费账户、获得 Gateway Key 并产生 Usage/Ledger。不存在独立“计费用户”。
2. `platform_users` 仅是现有 Gateway/Billing 文本外键的内部一对一兼容键，由迁移与 trigger 自动维护，不作为产品主数据或手工开户入口。
3. 剧本正文、Storyboard 与 Episode 文件是 Dream Artifact 内容真源；`story_workspace_stories` 是唯一 PostgreSQL Story 元数据索引。Dream 是 Artifact 与该索引的唯一业务写入方；Admin 以 OS 只读方式挂载同一 Artifact root，只能由服务端依据数据库资源 ID、revision、registry 与 allowlist 受控读取。浏览器不提供路径，Admin 不扫描任意目录、不写 Artifact 或真实文件关系。缺表或挂载不可用时 fail-closed，不回退 SQLite、JSON 或内存数据。
4. 只有一个 PostgreSQL 数据库 `ink-memory`，但 Dream 与 Admin 使用独立 Repository、连接池、数据库角色和迁移日志；不共享超权限运行角色。Admin Route Handler 只做 Session/RBAC、Origin、解析、Zod 和 service 调用；SQL、事务与状态机位于 `app/lib/**`。
5. Subscription Plan/Version 保存月度 Token、非货币权益和整数 micro-USD 月费；不保存金额额度、cash overage 或平台统一生效日。Plan Version、Entitlement 和 Pricing 版本不可覆盖；Usage、Ledger、Payment adjustment、Subscription Event 与 Audit 只追加或终态不可变。
6. Provider/System/Payment Secret 永不由读取接口返回；Gateway Key 明文仅在创建响应返回一次，之后永不重读。这些 Secret 与 Webhook 原始签名均不得明文落库、写日志、遥测或自动化截图。
7. Dream 浏览器只调 Dream 同源 BFF；Dream 服务端使用最小权限服务身份调用 Admin 产品 API 和 Gateway。浏览器不持有 Gateway Key、Provider Secret 或服务间凭据。
8. 付费首次开通和到期续费创建 Payment Intent，只有已验证且幂等的成功 Webhook 才能激活或续期；付费到期进入 `past_due` 且不得免费发放下一期 Token。Fake Adapter 仅限测试环境且生产 fail closed；未指定的真实支付渠道继续 Deferred。
9. 不使用假数据、虚构 KPI 或没有真实 API/领域行为的 CRUD 外壳。

旧 cash balance-only 默认放行已从 Subscription Gateway 资格链移除；独立现金模式若保留，必须有显式产品资格/request mode，不能由 Token 耗尽自动触发。生产流量仍需通过用户级 Provider canary 证明无隐式回退。

## 3. 模块地图

| 模块 | PRD | 主要路由 | Current / Target（2026-08-09） |
|---|---|---|---|
| 平台基础与总览 | [00-platform-foundation](modules/00-platform-foundation.md) | `/admin`、登录与 Shell | Shell/登录/真实 Story 快照已实现；Gateway/计费摘要和页面级 permission guard 未完成 |
| 平台用户 | [01-platform-users](modules/01-platform-users.md) | `/admin/resources/users` | **Implemented / RC**：canonical 投影、所有 selector 服务端搜索/分页、命令反查和 QA-only 回归已验证；生产 orphan 处置待回执 |
| Dream 创作运营 | [02-story-operations](modules/02-story-operations.md) | `/admin/story/**` | 列表可见性纠偏已形成历史基线；共享只读 Artifact root 方案进入隔离实现：Dream 幂等物化唯一 `story_workspace_stories` 索引，Admin 分离加载 DB 元数据与受控文件预览 |
| 订阅与权益 | [03-subscriptions](modules/03-subscriptions.md) | `/admin/subscriptions/**` | **Implemented / RC**：Token-only 个人月度周期、下一周期换版、付费开通/续费与 Product/Payment API 已验证 |
| 模型供应链 | [04-model-catalog](modules/04-model-catalog.md) | `/admin/models/**` | Current 有 Provider/Model/Pricing；Target 保持不可覆盖快照并为 Dream 发布可用 alias |
| Gateway | [05-gateway](modules/05-gateway.md) | `/admin/gateway/**`、`/v1/**` | **Implemented / RC**：canonical/402/终态、无 cash fallback 与 Dream server-only client 已验证；外部 Provider canary 待执行 |
| Usage、支付与独立账务 | [06-billing](modules/06-billing.md) | `/admin/billing/**` | **Implemented / RC**：Usage/账户/Ledger、Payment Intent/Webhook/Fake 与终态 guard；真实渠道 Deferred |
| Storage | [07-storage](modules/07-storage.md) | `/admin/resources/storage`、`/api/storage/**` | 已实现 |
| 权限与系统治理 | [08-governance](modules/08-governance.md) | `/admin/access/**`、`/admin/system/audit` | 已实现；System Settings 页面与管理 CRUD 已下线 |

专项历史文档继续作为证据，不是平台入口：旧版 [AI 平台控制面设计](../design/ai-platform-admin-billing-gateway-design.md) 已标记 superseded，Gateway 完整报文条款已收敛到 [Gateway PRD](modules/05-gateway.md) 与 [Gateway 交互规范](../design/modules/05-gateway.md)；v2 保留为历史基线，不再新增跨模块需求。

### 3.1 Dream Workspace / Story 数据运营与 Artifact 索引（2026-08-10）

当前列表纠偏基线：[`story-workspace-data-visibility-audit.md`](../verification/story-workspace-data-visibility-audit.md) 与 [`story-workspace-data-visibility-fix-interaction-design.md`](../design/story-workspace-data-visibility-fix-interaction-design.md)。

本轮审计与已确认实现方案：

- 审计证据：[`story-artifact-index-sync-audit.md`](../verification/story-artifact-index-sync-audit.md)
- 跨系统架构：[`story-artifact-index-sync-architecture.md`](../architecture/story-artifact-index-sync-architecture.md)
- Admin 交互：[`story-artifact-admin-interaction-design.md`](../design/story-artifact-admin-interaction-design.md)
- Dream 同步与交互：`ink-dream-memory/docs/design/story-artifact-index-sync-design.md`

产品结论：当前“Dream execution 能读取 `script.md`，Admin Story 为 0”的根因是 Dream Artifact → canonical Story 元数据索引的 materialization 缺失，不是 Admin 对 `story_workspace_stories` 的查询错误。旧纠偏解决“表内有行但页面不可见”；本轮目标解决“文件已有内容但表内没有索引行”。

| 层级 | Current | Target | Release Gate |
|---|---|---|---|
| Artifact 内容 | Dream execution 通过 Episode Artifact API 受控读取线程文件系统；文件是实际可见内容 | Dream 保持唯一写入与解析方；`script.md`、`episode-outline.md`、`storyboard.yaml`、`review-report.md` 不复制进 PostgreSQL | Path traversal、symlink escape、TOCTOU、大小、allowlist、跨 User/Workspace/Run 防护与隔离测试通过 |
| Story 索引 | Admin 只读查询 `story_workspace_stories`；Dream context 明确跳过旧 JSON Story 存储，因此文件存在时可能无索引 | Dream 在文件安全落盘后计算 revision、提取安全 metadata，并按 Workspace + Project 稳定身份幂等 upsert 同一 Story；多 Episode 聚合为一条 Story | Schema/migration 经评审；同 revision no-op、新 revision 更新同一行、业务审核历史不被 projector 覆盖 |
| 一致性恢复 | 没有 Artifact projector 或 reconcile | Dream 负责幂等同步与 reconcile；文件成功、DB 失败可恢复，索引存在而文件缺失或 revision 变化不得伪装正常 | dry-run 先报告发现/新增/更新/冲突/无效/关系缺失；生产回填必须另获用户批准 |
| Admin 运营 | PostgreSQL 列表与安全派生摘要 | 列表只依赖 PostgreSQL；详情先显示 DB 索引，再由 Admin 服务端从共享只读挂载按资源 ID、registry、revision 和 allowlist 懒加载 Artifact 安全预览 | 文件系统不可用时仍显示 DB；浏览器、API、日志与 DOM 不出现绝对路径、thread root 或 Secret |

产品规则：

1. 继续直接使用 `users`、`story_workspace_workspaces`、`story_workspace_stories`，不得创建新的 User、Workspace 或 Story 平行业务表；`app/lib/db/schema.ts` 仍是唯一 Drizzle schema 来源。
2. `users` 是 owner/author 的唯一业务身份。`platform_users` 只作 Billing/Gateway 兼容映射；缺少映射时显示“未绑定计费身份”，不得过滤 Workspace/Story。
3. 新 Artifact 来源 Story 的旧 `content` 字段不保存完整正文；字段保留只为既有兼容行，历史内容不迁移、不清空、不自动回写。
4. Stable Story identity 由 canonical Workspace identity 与 Dream `project.yaml.project_id` 组成；重复同步不能生成新 Story，多 Episode 不能拆成多条 Story。
5. Dream projector 只维护来源、revision、Episode 数、可用性、同步状态与安全摘要，不覆盖 Admin 已存在的 review status、业务 status、确认/发布时间或审计历史。
6. Admin 列表 API 的 PostgreSQL count 与同条件 `meta.total` 必须相等；Artifact 服务失败不改变 DB total，也不把错误叙述为“0 条记录”。
7. Admin 不提供正文编辑、Artifact 文件写入、路径输入、目录扫描或通用 Story metadata PATCH。审核若保留，必须经过 Session/RBAC、严格 revision CAS 与审计；同步/retry 由 Dream 负责。
8. URL 是筛选状态真值；DB 元数据与 Artifact 内容分别加载、分别缓存、分别表达错误。ETag/If-None-Match、按 Episode 与 allowlist 文件切换以及有界预览是目标合同。

Story 目标列表字段：标题、Story ID、Workspace、作者、Project identity、Episode 数、Artifact 状态、Script revision、最近索引时间、审核状态、业务状态、更新时间。详情以“PostgreSQL 索引 / Artifact 内容”双轨展示同步健康度、安全逻辑目录和有界只读预览；桌面右侧 Drawer、移动端全屏，1440×1000 与 390×844 不产生页面级横向溢出。

历史证据中的 Workspace=12、Story=4 仅代表 2026-08-09 列表可见性纠偏时的数据库快照，不得作为当前数量。2026-08-10 的文件侧只读盘点发现 5 个有效 Project manifest、39 个 Episode 目录与 3 个严格可索引 Story 候选；本轮数据库握手超时，因此新增/更新/冲突数量保持“未知”，不得推断或写共享真实数据。

本节与 Admin 方案已获准按共享只读文件系统实施；Dream 由用户在另一执行上下文实施。生产历史回填仍未获授权。

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
| 402 | 订阅 Token 或独立现金账户不足 | Token 合同只显示 tokens/周期重置/下期换版；独立现金合同才显示 micro-USD/账户处理，两者不得互相 fallback 或混写 |
| 403 | 显示所需 permission，不泄露记录 | 返回可访问模块或申请权限 |
| 404 | 资源不存在或不可见 | 返回模块列表 |
| 409 | 展示最新状态、冲突对象和 request ID | 刷新/载入最新值后重试，不盲写 |
| 429 | Gateway 请求/Token 限额 | 显示 Retry-After/窗口与实际可用配置入口；实时计数只读 |
| 502 | 上游 Provider/Adapter 调用或协议失败 | 区分 retryable 与终态失败；保留 request ID，不显示虚假成功 |
| 500 | 安全错误摘要和 request ID，不展示 SQL/stack/Secret | 重试或复制 request ID 联系支持 |
| 503 | 数据源或依赖不可用 | 明确依赖与重试；禁止假数据回退 |
| Success | 显示资源 ID、实际结果、审计/幂等回执 | 刷新受影响查询并合理归焦 |

## 6. 跨模块数据与调用边界

| 数据域 | 权威表/服务 | 写入者 | 消费模块 |
|---|---|---|---|
| 平台用户 | `users` | Dream/迁移；Admin 业务字段只读 | 用户、订阅、Gateway、账务 |
| Story Artifact 与索引 | Artifact 文件；`story_workspace_workspaces`、`story_workspace_stories` | Dream 唯一写 Artifact 和 Story 索引；Admin 仅通过受控领域命令协作审核/重试，不直写内容或来源关系 | Story、总览、审计 |
| 订阅 | `subscription_*` | Subscription service | Gateway、账务、用户详情 |
| 模型供应链 | `ai_providers/models/pricing_rules` | Model services | Gateway、订阅权益、Usage |
| Gateway 事实 | `gateway_*`、payload tables | Gateway lifecycle | Usage、审计、支持排障 |
| 财务事实 | `billing_accounts`、`billing_ledger_entries` | Billing transaction services | 独立 Billing、Gateway 成本/按量模式；不得成为 Subscription Allowance |
| 支付协作 | `subscription_payment_intents`、`payment_webhook_events`、`subscription_payment_adjustments` | Payment service / Adapter boundary | 订阅首次开通、退款/冲正、审计；真实渠道 Deferred |
| 治理 | `admin_*`、`system_settings` | Admin security services | 全模块 |

## 7. 发布与回滚

### 7.1 当前 Release Gate

| 级别 | 缺口 | 发布要求 |
|---|---|---|
| P0 | 生产 owner/ACL/约束/现有行、历史 orphan、真实源 43+5 未完成只读盘点/最终 rehearsal | 只读 inventory、备份/恢复、冲突回执和 DBA 审批齐全后方可短暂停写 cutover；不得删除财务历史 |
| P0 | 外部 Provider/user canary 未执行 | 用生产等价服务身份逐 cohort 验证资格、402/429/5xx、cancel/usage-missing 与 Token 守恒；关闭时不得 direct fallback |
| P0 | credential owner 尚未确认吊销/轮换/历史处置 | 所有者回执 + secret scan；ASR endpoint 保持 fail-closed，ASR Gateway继续 Deferred |
| P2 | Dream frontend lint 仍有 21 warnings | lint 已 0 errors 通过；发布回执保留 warnings 数量，不误报为 0 warnings |
| P1 | Dashboard UI 未呈现 API 已返回的模型、请求、Token、费用和结算失败；页面 Shell 仅做登录/启用检查，模块权限主要由 API 403 保证 | 补真实摘要和页面级 permission guard；完成前不得宣称页面直接访问返回 403 |
| P0 | Story Artifact → PostgreSQL Index 正在按共享只读挂载方案实现；Dream projector/reconcile、Admin 安全 Reader/UI 与隔离验收尚未全部完成 | 只在隔离 PostgreSQL/临时 Artifact root 实现并验证。未通过同 revision、新 revision、多 Episode、失败恢复与路径/symlink/TOCTOU 安全测试前不得执行历史回填 |
| P0 | Story 历史 materialization 数量尚未完成 DB 联合 dry-run；2026-08-10 文件侧仅确认 3 个严格候选，数据库连接本轮握手超时 | 实现 dry-run 后重新输出 Project/Episode/新增/更新/冲突/无效/关系缺失；生产 apply 必须获得用户单独明确批准 |

- Schema 只做增量、非破坏迁移；旧平行表停止使用但不在本轮删除。
- Plan Version、Pricing snapshot、Usage、Ledger、Audit 和 Subscription Event 不回滚为旧内容；订阅货币列与历史收费只读保留，问题使用向前修复或独立账务 reversal。
- 新模块按“隔离库演练 → 只读 shadow comparison → 小范围运营写入 → Gateway 用户级 canary → 全量”灰度。先 shadow eligibility 不扣费，再受控 reserve/capture/release。
- 数据库测试只允许明确一次性 PostgreSQL 或 `TEST_DATABASE_URL`；不得迁移、清空或删除未知共享数据库。
- Dream 43+5 PostgreSQL、Token-only 月订阅、订阅支付边界与 Gateway 接入已进入实现范围，遵循 [`ink-dream-memory/README.md`](../architecture/ink-dream-memory/README.md)。本文不授权把逻辑 owner 当作 `ALTER OWNER`/GRANT/REVOKE 授权。
- PG cutover 后产生新业务写时默认向前修复；只有预先演练的旧功能+PG Repository build 或受验证 PG→SQLite delta exporter 才允许回切，不得丢弃 PG 新写。

## 8. 平台级验收

- 每个平台用户自动拥有唯一内部兼容键和唯一计费账户；任何用户选择器不依赖手工开户，并以至少 205 用户验证服务端搜索、跨页选中和稳定 total。Current 前 50/100 条缺口未修前不通过。
- 所有列表具备真实总数、服务端分页/排序、白名单筛选和明确错误映射。
- 401/402/403/404/409/429/502/503 均有单一 HTTP/code/unit 映射、幂等恢复和 Dream UI 合同；上游失败、cancel、流中断、usage 缺失不按 0 成功结算。
- Subscription 主路径按 `User → Subscription → Plan Version → Entitlement → Model Permission → Current-period Token Allowance → Request → Token Usage` 执行并冻结快照；Provider Pricing/现金账户/Ledger 是独立链路。cash-only 默认放行已从代码合同退出，生产 canary 必须继续证明不存在套餐 overage 或隐式长期分支。
- Provider/System Secret 不出现在详情、API 重读、日志、DOM、遥测或自动化截图；Gateway Key 明文只存在于一次性创建回执。Usage/Ledger/Audit/Subscription Event 无通用更新/删除。
- 重复订阅命令、Payment Intent、Webhook 重放、月末续期和 Token reserve/capture/release 均有自动测试；本阶段没有真实支付网络请求。
- Dream 生成 `script.md` 后可按稳定 Workspace + Project identity 幂等创建或更新同一 canonical Story 索引；相同 revision 不重复写，多 Episode 不重复建 Story，文件/索引状态独立且可 reconcile。
- Admin 无需扫描或接收任意文件路径即可分页检索 Story；详情由服务端从共享只读挂载读取 allowlist Artifact 预览。文件系统不可用时保留 PostgreSQL 元数据，revision 冲突、文件缺失、413、422 与 503 不伪装为正常。
- 1440×1000 与 390×844 无页面级横向溢出，键盘、焦点、label、状态文字和读屏通知可用。
- `pnpm env:check`、TypeScript、lint、unit、build、隔离 PostgreSQL与 focused Playwright 通过；Storage、PWA 404 和 Dream 真实表回归不退化。

## 9. 文档维护规则

- 新需求先进入对应模块；只有跨三个以上模块的决策才修改本总纲。
- PRD 描述“为什么、范围、规则与验收”；交互规范描述“页面如何工作”；实现细节只保留足以建立可测试契约的映射。
- 模块 PRD 与对应交互文档必须双向链接，状态、路由、权限、表名、金额单位和验收编号一致；`00-platform-foundation` 对应 `00-admin-shell`，其余模块使用同名文件。
- 变更不得覆盖历史文档；过时内容标记 superseded，并从本索引移除主入口。
