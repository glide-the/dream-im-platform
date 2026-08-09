# Dream 改造证据与历史文档映射

> 文档状态：**Current**（追溯索引，不是完成声明）
> 返回：[总索引](README.md)
> 权威审计：[PG/Billing/Gateway 处理判断](../../verification/ink-dream-memory-pg-billing-gateway-treatment-decision.md)
> 主要读者：审计、架构维护者、QA、安全

## 1. 直接代码与 Schema 证据

| 事实 | Current 证据 | 能证明 / 不能证明 |
|---|---|---|
| 主库 SQLite 43 表 | Dream `backend/database.py` + 真实 `sqlite_master` | 能证明当前表/trigger；不能证明 PG 已迁移 |
| Notion SQLite 5 表 | `backend/notion/store.py` + 真实 `sqlite_master` | 能证明独立第二数据源；主库切换不代表它已迁移 |
| 主库 25 trigger | 只读 schema metadata；源码 15 个生成/显式位置 | 必须在 PG 重建语义，不能只统计 CREATE TABLE |
| SQLite 深耦合 | 34 文件/115 `sqlite3.Connection`；16/52 `get_db`；42 文件/436 SQL literal/1,425 `?` | 证明需要 Repository/UoW；不是完成进度 |
| Admin 三表 importer | `scripts/import-ink-dream-story-source.mjs`、`scripts/lib/story-source-import.mjs` | 只覆盖 `users/workspaces/stories` 3/48，不能冒充全量迁移器 |
| canonical billing projection | `drizzle/0015_platform_users_are_billable.sql` | 已有自动 mapping/account baseline；不能证明 Gateway 反查/orphan/分页已修 |
| Subscription baseline | `drizzle/0014_subscription_control_plane.sql`、`app/lib/subscriptions/**` | 已有六表与部分命令；不能证明周期推进/产品 API/完整状态机已完成 |
| Gateway baseline | `app/lib/gateway/**`、OpenAI/Anthropic routes、billing services | 已有 protocol/部分结算；不能证明 strict subscription eligibility 或 Dream 已接入 |
| 静态订阅页 | Dream `StoryWorkspaceSubscriptionPage.tsx` | Current defect；不是 Plan/Subscription 实现 |
| 静态模型与直连 | `ModelConfigSection.tsx`、`server.py`、`stateless_analyzer.py`、Claude runner、`picture_service.py` | 证明 Gateway 接管点；`dream_launch_gateway.py` 不是 Admin Gateway |
| Payment 边界不存在 | Admin `app`/`drizzle`/`tests` 未见 Adapter/intent/Webhook event schema | 支持 Planned 判断；真实渠道仍 Deferred |
| P0 credential/ASR | Dream `speech_recognition.py`、`server.py` WebSocket route、Git history search | 证明需吊销/轮换/移除与 endpoint 加固；本文不保存 Secret 值 |

审计读取 SQLite 使用只读/query-only 方式，文件 size/mtime/inode 不变；没有连接、迁移、清空或写入 PostgreSQL，也没有调用 Provider/支付网络。

## 2. 权威证据层级

1. 当前工作树代码、migration、真实只读 Schema metadata 与隔离测试结果。
2. [处理判断](../../verification/ink-dream-memory-pg-billing-gateway-treatment-decision.md) 的证据化 Current decision。
3. 本目录 README 与 01–08 的 Current/Target/Release Gate 合同。
4. 平台 v3 PRD 与对应交互模块。
5. correction worklog 的各 Round 时间快照。
6. 旧路径墓碑与 Git 历史。

较低层级不能覆盖较高层级的当前代码事实。文档写为 Planned 不等于实现；只有隔离测试和发布回执可以更新为 Implemented。

## 3. 现有审计与验证

| 文档 | 可复用证据 | 限制 |
|---|---|---|
| [PG/Billing/Gateway 处理判断](../../verification/ink-dream-memory-pg-billing-gateway-treatment-decision.md) | 43+5 逐表语义、耦合统计、三表上限、用户/控制面/Gateway/Payment/P0 决策 | Task 1 只读审计，不是代码完成报告 |
| [数据接入审计](../../verification/ink-dream-memory-data-integration-audit.md) | SQLite/PG 根因、真实表字段/FK/枚举、旧平行表、三表导入 | 早期范围/目标已被 Round 29–30 更新 |
| [Story/User 资源审计](../../verification/story-user-resource-admin-audit.md) | User/Workspace/Story/Admin 资源差异 | 实施前快照，多项状态可能已变化 |
| [Story/User 验证](../../verification/story-user-resource-admin-verification.md) | 隔离 PG、Session/RBAC、首批 Story/User | 不能证明 48 表 runtime、Subscription/Gateway/Payment 闭环 |
| [correction worklog](../../verification/ink-memory-admin-correction-worklog.md) | Prompt Architect round、证据、测试与范围变化 | Round 24–28 全面 Deferred 已被 Round 29–30 supersede |

## 4. 旧路径 → 当前权威入口

| 旧路径 | 当前状态 | 当前入口 |
|---|---|---|
| `docs/architecture/ink-dream-subscription-integration-change-list.md` | **Superseded** 历史方案 | [06 Billing/Subscription/Gateway](06-billing-subscription-gateway-integration.md) + [07 Dream 集成](07-dream-subscription-and-inference-integration.md) |
| `docs/integration/ink-dream-memory-postgresql-gateway-migration.md` | **Superseded** PG/Gateway 混合方案 | [04 PG](04-postgresql-migration-plan.md) + [05 Release](05-release-rollout-and-rollback.md) + [07 Gateway](07-dream-subscription-and-inference-integration.md) |
| `docs/integration/ink-dream-memory-admin-gateway.md` | **Superseded** Gateway 入口 | [06](06-billing-subscription-gateway-integration.md) + [07](07-dream-subscription-and-inference-integration.md) |
| `docs/prd/story-user-resource-admin-prd.md` | **Superseded** | [02 业务边界](02-business-integration-and-admin-boundary.md) + 平台 v3 PRD |
| `docs/design/story-user-resource-admin-ui-design.md` | **Superseded** | [页面清单](03-page-refactor-checklist.md) + [Dream 交互设计](../../design/ink-dream-memory/README.md) |
| `docs/design/ai-platform-admin-billing-gateway-design.md` | **Superseded** | 平台 v3 交互模块 + [Dream 交互设计](../../design/ink-dream-memory/README.md) |
| 本目录 `90-deferred-*` 的旧全文 | **Superseded history** | 当前 90 仅列真实支付渠道与 ASR Gateway Deferred |

旧入口可保留轻量墓碑页以避免断链，但不得保留与当前范围竞争的完整可执行正文。

## 5. 状态证据映射

| 状态 | 需要的证据 | 当前示例 |
|---|---|---|
| Current | 可重复只读代码/Schema 证据 | 43+5 SQLite、25 trigger、静态订阅、未鉴权 ASR |
| Implemented baseline | 代码 + migration + focused tests，但整链仍可 Partial | Admin Plan Version/Entitlement、Allowance、Gateway protocol |
| Planned | PRD/架构/交互/验收明确，代码未全部通过 | 48 表 PG、Product API、Dream UX、Payment boundary |
| Deferred | 当前禁止实施且有未来触发条件 | 真实支付渠道、ASR Gateway capability |
| Superseded | 当前权威入口已替代，正文仅追溯 | 旧全面 Deferred 与 PG/Gateway 混合方案 |

## 6. 已知风险与历史偏差

- 历史 Round 20 曾因命令漏写一次性 URL 而对共享 `5433/ink-memory` 应用非破坏 migration；此后所有写测试必须显式隔离 `TEST_DATABASE_URL` 并验证目标归属。
- PG canonical 三表可能与 SQLite 内容/约束/owner/ACL drift；只读盘点后 baseline adopt，冲突默认阻断，不自动 upsert。
- 旧文档曾设计独立“创建计费用户”；当前唯一用户全集是 `users`，mapping/account 自动投影。
- 旧文档曾声称静态订阅 URL 已重定向；当前代码仍渲染静态三档，必须按真实 Product API改造。
- 现有用户列表/selector 仍有前 50/100 风险，Gateway auth 未反查 canonical user，cash-only 兼容无安全默认；均不得误报完成。
- 已提交 credential 和匿名 ASR 是 P0；密钥轮换需要所有者确认，代码文档不能替代外部吊销。
- 物理 PostgreSQL owner/ACL 未盘点；逻辑 owner 不是执行 `ALTER OWNER`、GRANT/REVOKE 的授权。

## 7. 文档与证据维护规则

- 新 Current 事实先更新处理判断/证据，再更新对应 01–08；状态变化附测试/发布回执。
- 同一能力不得同时 Planned 与 Deferred；90 只维护真实渠道和 ASR Gateway。
- 所有相对链接可解析、H1 唯一、Mermaid fence 配对、API 路径在 06/07/交互文档一致。
- 行级审计、SQLite snapshot、Secret、正文、Token、DSN 不进入 Git；文档只保存聚合、digest 与安全结论。
- 并行修改按最新工作树增量合并，不 reset/revert 或覆盖用户未提交变更。
