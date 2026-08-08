# Ink Memory Admin 目标完成性审计

> 日期：2026-08-08  
> 审计口径：以用户原始目标、Round 6 反证审计和 Round 7 隔离验收为准，不以“页面存在”代替可用性证明。  
> Secret 边界：只使用 fixture Credential 与本机 mock 上游；未记录、调用或写入用户曾提供的真实 Token。

## 1. 结论

代码、文档、迁移兼容方案和隔离环境验收均已完成。运行时只有一个 PostgreSQL `ink-memory`、一个 `DATABASE_URL` 和一个共享 `pg.Pool`。Story repository 直接映射 `ink-dream-memory` 的真实 PostgreSQL 表名；控制面 Provider、Model、Pricing、Gateway、Usage、Ledger、RBAC、Audit、Settings 与 Storage 在源 Story 表尚未迁入时仍可运行，Dashboard 只降级 Story 指标。

两项外部动作没有执行：没有把业务源项目的数据真正迁入共享数据库；没有使用用户的真实 Provider Token 请求外部 DeepSeek。这两项都需要生产数据迁移/Secret 轮换授权，不属于安全的本地代码验收。对应代码合同已由隔离 PostgreSQL和 mock Anthropic-compatible 上游证明。

## 2. 根因与本轮纠偏

| 根因/反证 | 证据 | 修复 | 状态 |
|---|---|---|---|
| Admin 曾建立 `story_workspaces/story_projects/story_characters/story_scenes/story_workflow_runs` 平行表，而当前数据库缺少源项目真实 Story 表 | `drizzle/0000_*`、源项目 migrations、数据接入审计 | repository 改读真实 `users/story_workspace_*/workflow_runs`；旧表不删除，仅迁移 0008 更新 DEPRECATED 注释 | proven |
| Story 与控制面曾允许第二连接语义，导致“连接了 ink-memory 却看不到源表”难以区分 | 旧环境/注释；当前 `app/lib/db.ts` | 删除第二运行连接；`app/lib/story-source/db.ts` 复用唯一 Pool；DB 名强校验 `ink-memory` | proven |
| 缺 Story 表会拖垮总览，表现为“整个项目不可用” | 缺表复现和 Dashboard 查询 | Story 指标可诊断降级；控制面指标继续返回 | proven |
| 独立编辑页可选参数默认 `{}` 每次 render 改变引用，effect 循环加载导致 DOM 不断卸载 | Round 7 Playwright 首次 edit 反证 | `AdminResourceFormPage` 使用模块级稳定默认对象；Provider edit/停用确认已通过 E2E | proven |
| Provider/Model 的“监控”链接带 ID，但 Usage 未读取 URL；读取后服务端又未允许 `provider_id/model_id` | Round 6/7 两次反证，首次 E2E 捕获 HTTP 400 | Usage 初始化/更新 URL；资源 SQL 注册参数化 ID 筛选白名单 | proven |
| 纯 reachability 被误当作模型可用性 | Provider 仅 GET Endpoint | 新增 Model validation：已加密 Credential、1 Token 上限、15 秒上限、不读响应正文、RBAC/Origin/Audit | proven |
| Pricing 文档声称百分比控件，代码却直接录 bps | 字段矩阵与旧 field definition 对比 | `%` 控件精确转整数 bps；USD/1M 精确转整数 micro-USD；单元测试覆盖 | proven |

## 3. 数据源与表边界

| 领域 | 最终真实表/来源 | 策略 |
|---|---|---|
| 源用户 | `users` | 只读源身份；`platform_users.external_user_id` 是控制面计费 crosswalk，不复制密码或业务 Profile |
| Workspace | `story_workspace_workspaces` | 真实表查询；不写平行表 |
| Story | `story_workspace_stories` | 真实表查询和受控更新/confirm/reject/archive；同一事务写管理员审计 |
| Character | `story_workspace_characters` + 关系表 | 真实关系查询；受控更新/审核，不硬删除 |
| Scene | `story_workspace_scenes` + 关系表 | 真实 FK/owner/workspace 校验；冲突 409 |
| Workflow | `workflow_runs` 及来源关系 | 当前只读；源项目缺少 PG 命令适配器时不展示假 retry/cancel |
| 代理/计费控制面 | `ai_providers/ai_models/ai_pricing_rules/platform_users/billing_*/gateway_*/user_model_permissions` | Admin 独有；金额 micro-USD、Usage/Request/快照只读、Ledger append-only |
| 管理治理 | `admin_*`、`system_settings` | Session、RBAC、审计、加密 Secret；系统 Secret 不回显 |
| Storage | 现有 `app/api/storage/**` 与 `app/lib/file-storage/**` | 原样保留并纳入回归 |

单库迁移顺序是：先把源项目 PostgreSQL DDL/数据部署到同一个 `ink-memory`，再切换 Admin Story 功能；不能复制到 Admin 平行表。旧平行表只标记弃用，后续需在引用计数、备份和回滚窗口全部满足后另行清理。

## 4. cc-switch 源文件级适配

| cc-switch 参考 | Admin 实现 | 平台适配判断 |
|---|---|---|
| `ProviderList/ProviderCard/ProviderHealthBadge` | `AIProviderRegistry.tsx` | 卡片、协议/状态、Credential 状态、模型数、24h 请求/成功率、分页/联合搜索 |
| `ProviderPresetSelector/ApiKeySection/EndpointField/ProviderAdvancedConfig` | Provider `/new`、`/[id]/edit` + `AdminResourceFormPage` | 独立页面；Secret password 不回填；具名配置不藏 JSON；DeepSeek 预设无 Secret |
| `EndpointSpeedTest` | `provider-reachability.ts` | SSRF 白名单、8 秒、无 Credential、无正文、RBAC/Origin/Audit |
| `ModelDropdown` 与 Provider 模型字段 | Model `/new`、`/[id]/edit` + `AIModelRegistry.tsx` | 稳定 alias、上游型号 datalist/自定义、能力复选、Token 上限、Provider 关系 |
| 配置可用性反馈 | `model-validation.ts` | 服务端解密 fixture Credential；1 Token 非流式验证；不记录模型响应内容 |
| `PricingConfigPanel/PricingEditModal` | `AIPricingTimeline.tsx` + Pricing `/new` | 四类 Token、USD→micro-USD、%→bps、版本化生效窗；不覆盖历史 |
| `UsageHero/UsageTrendChart/RequestLogTable/RequestDetailPanel/ProviderStatsTable/ModelStatsTable` | `AdminUsageDashboard.tsx` + `usage-dashboard.ts` | 同一 URL 筛选、事实摘要、趋势、三页签、Drawer、自动刷新与真实 SQL 聚合 |
| Rust proxy/model mapper/error mapper | `/v1/messages`、`/v1/messages/count_tokens`、`/v1/chat/completions`、`/v1/models` 与 `app/lib/gateway/**` | 改写为 Next.js 服务端代理；外部只持有 Gateway Key 与 alias |
| 桌面 `ProxyToggle` | 始终在线的部署端 `/v1/*` | 不复制浏览器/桌面接管开关；可用性由部署、Gateway Key、Provider/Model/Pricing/RBAC/余额/限流共同决定 |
| 本地 `FailoverQueueManager` | 未直接复制 | 当前 alias→Provider 与价格/请求快照是一对一；静默 failover 会破坏成本归属。未来必须先新增版本化路由候选、逐尝试审计和结算模型 |

## 5. 表单容器与字段控件证明

- Provider、Model、Pricing：独立路由全屏页面；固定 Header/Footer；离开脏表单确认。
- Provider/Model 停用、Pricing 结束版本：有影响摘要的确认 Modal。
- Usage/Gateway Request：只读 Drawer；移动端按全屏抽屉处理。
- 普通关系/治理编辑：按字段矩阵选 Modal、Drawer 或 full-screen，不使用默认 Refine CRUD 外壳。
- 文本、URL、password、select、relation search/select、model datalist、checkbox group、switch、integer、USD、percentage、datetime-local、JSON Editor 的字段、默认值、只读、脱敏、校验和错误恢复详见 `docs/design/admin-resource-field-control-matrix.md`。

## 6. 验收证据

| 门禁 | 结果 |
|---|---|
| `pnpm env:check` | passed |
| `pnpm exec tsc --noEmit` | passed |
| `pnpm lint` | passed |
| `pnpm test:run` | 27 files，159/159 passed |
| `pnpm build` | passed；Provider/Model/Pricing 独立路由与 `/v1/*` 均进入构建产物 |
| migrations | PostgreSQL 16 临时 `ink-memory`；0000–0008 共 9 个迁移 passed |
| focused PostgreSQL + mock upstream E2E | 1/1 passed；含真实 Story CRUD、RBAC、Secret、Model validation、Pricing、Usage/Ledger、Gateway、Storage、404 与双视口 |
| Session/Bootstrap E2E | 6/6 passed |
| 数据库后置 | 2 admins、20 audits、2 model_validation audits、3 ledger entries；目标请求 settled；Story published/confirmed |
| 视觉 | 11 张截图；1440×1000 与 390×844；每个目标页断言 document 横向溢出 ≤1px |

截图目录：`test-results/round7-postgres/admin-bootstrap-postgres-R-68c61--billing-and-both-viewports-chromium/`。

## 7. 明确安全确认

- 未修改 `/Users/dmeck/project/ink-dream-memory` 业务代码、Schema、迁移或运行逻辑。
- 未修改 `/Users/dmeck/project/cc-switch`；仅只读分析其设计与代码组织。
- 未引入 SQLite、JSON DB 或内存数据库回退。
- 未恢复 `app/(app)`；已移除的 PWA 路由继续 404。
- 未删除或弱化 Storage API、file-storage 和共享 lib。
- 未迁移、清空、删除或写入共享 `localhost:5433/ink-memory`；只操作自有临时 55432 容器。
- 用户曾暴露的 Token 前缀在工作区扫描匹配为 0，且未用于任何网络请求；该 Token 仍应由用户在 Provider 侧立即轮换。
