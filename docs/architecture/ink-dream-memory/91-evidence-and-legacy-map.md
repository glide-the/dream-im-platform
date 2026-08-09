# Dream 改造证据与历史文档映射

> 文档状态：**Current**（追溯索引，不是完成声明）
> 返回：[总索引](README.md)
> 权威审计：[PG/Billing/Gateway 处理判断](../../verification/ink-dream-memory-pg-billing-gateway-treatment-decision.md)
> 主要读者：审计、架构维护者、QA、安全

## 1. 直接代码与 Schema 证据

| 事实 | Current 证据 | 能证明 / 不能证明 |
|---|---|---|
| 主库 SQLite 43 表（审计源基线） | 只读 `sqlite_master` + `backend/schema/legacy_main_sqlite.py` | 证明源 inventory；当前 runtime 已是 PostgreSQL-only，源 SQLite 仅供显式迁移 CLI |
| Notion SQLite 5 表（审计源基线） | 只读 `sqlite_master` + `backend/schema/legacy_notion_sqlite.py` | 证明源 inventory；`backend/notion/store.py` 当前已是 PG repository/UoW |
| 主库 25 trigger | 只读 schema metadata；源码 15 个生成/显式位置 | 必须在 PG 重建语义，不能只统计 CREATE TABLE |
| SQLite 深耦合 | 34 文件/115 `sqlite3.Connection`；16/52 `get_db`；42 文件/436 SQL literal/1,425 `?` | 证明需要 Repository/UoW；不是完成进度 |
| Admin 三表 importer | `scripts/import-ink-dream-story-source.mjs`、`scripts/lib/story-source-import.mjs` | 只覆盖 `users/workspaces/stories` 3/48，不能冒充全量迁移器 |
| canonical billing projection | `drizzle/0015–0019`、canonical relation/projection services/tests | 自动 mapping/account、服务端分页/搜索与 Gateway canonical 反查已验证；生产 orphan 处置另需回执 |
| Subscription/Product API | `drizzle/0014–0024`、`app/lib/subscriptions/**`、`app/lib/payments/**`、`app/api/product/v1/**` | Token-only 月度状态机、Product/Payment API、独立 Token Ledger 与 strict contract 已通过本机 PG、66 files/313 tests、tsc/lint/build、订阅 Playwright 4/4 |
| Gateway | `app/lib/gateway/**`、OpenAI/Anthropic routes、Dream `backend/services/admin_gateway/**` | strict eligibility/settlement 与 server-only client/canonical subject 已验证；外部 Provider canary未执行 |
| Dream 订阅页 | `StoryWorkspaceSubscriptionPage.tsx`、product client/hook/BFF/tests | 真实 Token-only 页面已实现；frontend lint 0 errors/21 warnings、build、Product API 9/9 与订阅 Playwright 4/4 |
| Dream PG migration/runtime | `backend/migrations/**`、`schema/**`、`script/migrate_legacy_to_postgres.py`、main/Notion runtime | 48/569/81/25、43+5 CLI、backend 1,679 passed/14 skipped + 652 subtests；本地 43+5/4,921 行 cutover，但不证明其他生产环境 |
| Payment 边界已实现 | Admin `0022–0024`、`app/lib/payments/**`、Product/internal routes 与 Dream BFF/UI | Adapter/Intent/Webhook/Fake guard、首次开通与付费月续费 **Implemented**；真实渠道 **Deferred** |
| P0 credential/ASR | Dream 历史 `speech_recognition.py`、当前 fail-closed route、Git history search | active runtime 移除与 scan 已完成；仍证明需 owner 吊销/轮换与历史处置；本文不保存 Secret 值 |

最初审计读取 SQLite 使用只读/query-only 方式，文件 size/mtime/inode 不变。后续实现验证只写明确命名、可删除的 owned disposable PostgreSQL 并事务回滚/隔离；没有写共享/生产数据库，也没有调用外部 Provider 或支付网络。

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
| [数据接入审计](../../verification/ink-dream-memory-data-integration-audit.md) | SQLite/PG 根因、真实表字段/FK/枚举、旧平行表、三表导入 | 早期范围/目标已被 Round 31–33 Token-only 决策更新 |
| [Story/User 资源审计](../../verification/story-user-resource-admin-audit.md) | User/Workspace/Story/Admin 资源差异 | 实施前快照，多项状态可能已变化 |
| [Story/User 验证](../../verification/story-user-resource-admin-verification.md) | 隔离 PG、Session/RBAC、首批 Story/User | 不能证明 48 表 runtime、Subscription/Gateway/Payment 闭环 |
| [correction worklog](../../verification/ink-memory-admin-correction-worklog.md) | Prompt Architect round、证据、测试与范围变化 | Round 24–28 全面 Deferred 与 Round 29–30 Payment Planned 均被 Round 31–33 Token-only 决策 supersede |

## 4. 旧路径 → 当前权威入口

| 旧路径 | 当前状态 | 当前入口 |
|---|---|---|
| `docs/architecture/ink-dream-subscription-integration-change-list.md` | **Superseded** 历史方案 | [06 Billing/Subscription/Gateway](06-billing-subscription-gateway-integration.md) + [07 Dream 集成](07-dream-subscription-and-inference-integration.md) |
| `docs/integration/ink-dream-memory-postgresql-gateway-migration.md` | **Superseded** PG/Gateway 混合方案 | [04 PG](04-postgresql-migration-plan.md) + [05 Release](05-release-rollout-and-rollback.md) + [07 Gateway](07-dream-subscription-and-inference-integration.md) |
| `docs/integration/ink-dream-memory-admin-gateway.md` | **Superseded** Gateway 入口 | [06](06-billing-subscription-gateway-integration.md) + [07](07-dream-subscription-and-inference-integration.md) |
| `docs/prd/story-user-resource-admin-prd.md` | **Superseded** | [02 业务边界](02-business-integration-and-admin-boundary.md) + 平台 v3 PRD |
| `docs/design/story-user-resource-admin-ui-design.md` | **Superseded** | [页面清单](03-page-refactor-checklist.md) + [Dream 交互设计](../../design/ink-dream-memory/README.md) |
| `docs/design/ai-platform-admin-billing-gateway-design.md` | **Superseded** | 平台 v3 交互模块 + [Dream 交互设计](../../design/ink-dream-memory/README.md) |
| 本目录 `90-deferred-*` 的旧全文 | **Superseded history** | 当前 90 只列真实支付渠道与 ASR Gateway Deferred |

旧入口可保留轻量墓碑页以避免断链，但不得保留与当前范围竞争的完整可执行正文。

## 5. 状态证据映射

| 状态 | 需要的证据 | 当前示例 |
|---|---|---|
| Current | 可重复只读代码/Schema 证据 | PG-only runtime、48/569/81/25、Product/Payment BFF 与真实订阅页 |
| Implemented / Release candidate | 代码 + migration + full/isolated tests，生产发布门禁仍可开放 | Admin 66 files/313 tests + Payment PG 2/2；Dream backend 1,679/14 skips/652 subtests + 推理 61；frontend lint 0 errors/21 warnings + build + Product API 9/9 + 订阅 Playwright 4/4 |
| Planned release step | 实现存在，但真实生产/外部依赖步骤尚未执行 | owner/ACL/真实数据 cutover、credential owner rotation、外部 Provider/user canary |
| Deferred | 当前禁止实施且有未来触发条件 | PaymentAdapter、Webhook、Fake、真实支付渠道、ASR Gateway capability |
| Superseded | 当前权威入口已替代，正文仅追溯 | 旧全面 Deferred 与 PG/Gateway 混合方案 |

## 6. 已知风险与历史偏差

- 历史 Round 20 曾因命令漏写一次性 URL 而对共享 `5433/ink-memory` 应用非破坏 migration；此后所有写测试必须显式隔离 `TEST_DATABASE_URL` 并验证目标归属。
- PG canonical 三表可能与 SQLite 内容/约束/owner/ACL drift；只读盘点后 baseline adopt，冲突默认阻断，不自动 upsert。
- 旧文档曾设计独立“创建计费用户”；当前唯一用户全集是 `users`，mapping/account 自动投影。
- 旧静态订阅页、前 50/100 selector、Gateway canonical 反查与 cash-only 资格缺口已在 Release candidate 修复并有隔离测试；生产 Session/数据/canary 仍需回执。
- ASR endpoint 已代码级 fail-closed；已提交 credential 的密钥轮换仍需要所有者确认，代码文档不能替代外部吊销。
- Dream frontend 全仓 lint 已通过（0 errors/21 warnings）；warnings 必须保留在发布回执中。
- 物理 PostgreSQL owner/ACL 未盘点；逻辑 owner 不是执行 `ALTER OWNER`、GRANT/REVOKE 的授权。

## 7. 文档与证据维护规则

- 新 Current 事实先更新处理判断/证据，再更新对应 01–08；状态变化附测试/发布回执。
- 同一能力不得同时 Planned 与 Deferred；90 只维护真实支付渠道与 ASR Gateway 的 Deferred 条件。
- 所有相对链接可解析、H1 唯一、Mermaid fence 配对、API 路径在 06/07/交互文档一致。
- 行级审计、SQLite snapshot、Secret、正文、Token、DSN 不进入 Git；文档只保存聚合、digest 与安全结论。
- 并行修改按最新工作树增量合并，不 reset/revert 或覆盖用户未提交变更。
