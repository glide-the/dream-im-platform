# Dream 改造证据与历史文档映射

> 状态：追溯索引，不是实施清单  
> 返回：[总索引](README.md)  
> 主要读者：审计、架构维护者、QA

## 1. 直接代码证据

| 事实 | Dream 只读证据 |
|---|---|
| 主库是 SQLite | `backend/database.py`：`sqlite3`、`INK_DATABASE_PATH`、`get_db()`、WAL/FK PRAGMA |
| 主库表清单 | `backend/database.py` 的 43 个 `CREATE TABLE IF NOT EXISTS` |
| Notion 是独立 SQLite | `backend/notion/store.py` 的 5 个表和独立连接 |
| PG driver/migration 尚未存在 | `backend/pyproject.toml` 当前 dependencies 与仓库目录 |
| Story API 写边界 | `backend/routers/story_workspace.py` 与 `backend/story_workspace/contracts.py` |
| SQLite 深度耦合 | Router/Service/Tool 中的 `sqlite3.Connection`、`database.get_db()`、`BEGIN IMMEDIATE`、PRAGMA |
| 静态订阅页面 | `frontend/src/pages/story-workspace/StoryWorkspaceSubscriptionPage.tsx` |
| 订阅设置入口/路由 | `StoryWorkspaceSettingsPage.tsx`、`storyWorkspacePath.ts`、`story-workspace.tsx` |
| 现有模型设置 | `frontend/src/components/dashboard/ModelConfigSection.tsx` |

本轮仅阅读这些文件，没有修改 Dream 仓库或数据库。

## 2. 现有审计与验证证据

| 文档 | 可继续使用的证据 | 使用限制 |
|---|---|---|
| [ink-dream-memory-data-integration-audit.md](../../verification/ink-dream-memory-data-integration-audit.md) | SQLite/PG 根因、真实表字段/FK/枚举、旧平行表、隔离三表导入 | Round 15+ 的 Subscription/Gateway 目标是历史阶段，不属本期 |
| [story-user-resource-admin-audit.md](../../verification/story-user-resource-admin-audit.md) | User/Workspace/Story/Admin 资源差异 | 实施前快照，多项缺口已关闭 |
| [story-user-resource-admin-verification.md](../../verification/story-user-resource-admin-verification.md) | 隔离 PG、Session/RBAC、Story/User 验证 | 不能证明 Dream 全量 PG runtime 已迁移 |
| [correction worklog](../../verification/ink-memory-admin-correction-worklog.md) | Prompt、历史决策、测试与偏差记录 | 各 Round 是时间快照，不等于当前范围 |

## 3. 旧文档 → 当前文档

| 旧路径 | 当前状态 | 当前权威入口 |
|---|---|---|
| `docs/architecture/ink-dream-subscription-integration-change-list.md` | Deferred 历史方案 | [90-deferred](90-deferred-billing-subscription-inference-payment.md) |
| `docs/integration/ink-dream-memory-postgresql-gateway-migration.md` | PG 与 Gateway 混合，已被拆分 | [04-postgresql-migration-plan](04-postgresql-migration-plan.md) |
| `docs/integration/ink-dream-memory-admin-gateway.md` | Gateway 历史入口 | [90-deferred](90-deferred-billing-subscription-inference-payment.md) |
| `docs/prd/story-user-resource-admin-prd.md` | 已被 v3 模块替代 | [02-business-integration](02-business-integration-and-admin-boundary.md) + [页面清单](03-page-refactor-checklist.md) |
| `docs/design/story-user-resource-admin-ui-design.md` | 历史 UI 设计 | [页面清单](03-page-refactor-checklist.md) |
| `docs/design/ai-platform-admin-billing-gateway-design.md` | Superseded | [90-deferred](90-deferred-billing-subscription-inference-payment.md) 仅作未来索引 |

旧路径保留轻量墓碑页并指向 current/deferred/superseded 权威入口，避免外部链接断裂；已被替代的历史正文只通过 Git 历史追溯，不继续作为仓库内可执行步骤展示。

## 4. Admin 已有三表迁移资产

| 资产 | 作用 | 不能证明什么 |
|---|---|---|
| `drizzle/0010_story_source_canonical.sql` | 在 PG 建立 `users/workspaces/stories` 首批 canonical DDL | 不能证明其他 40 + 5 表存在或 Dream runtime 已切 PG |
| `scripts/import-ink-dream-story-source.mjs` | SQLite 只读 snapshot、前三表导入、count/fingerprint/FK 验证 | 不是 Dream-owned 全量 migration runner |
| `app/lib/story-source/**` | Admin 对 canonical Story 表的 Repository/受控写 | 不能替代 Dream Repository 或 API |

后续 Dream 方案可以复用安全模式和验证思路，但 migration 代码、Schema 所有权和全量表闭包必须落在 Dream 项目。

## 5. 已知风险与历史偏差

- 历史 Round 20 曾因数据库命令漏写一次性 URL 而对共享 `5433/ink-memory` 应用非破坏 migration。后续任何命令必须显式验证目标归属，不能把 `.env` 默认值视为授权。
- 已存在的 PG canonical 三表可能与当前 SQLite 产生内容差异；迁移必须 staging 对比并人工解决，不自动 upsert。
- 旧文档曾把“创建计费用户”写成操作步骤；当前产品模型只有 canonical `users`，且本期不开发计费。
- 旧 PG 文档曾把 Gateway、充值和推理切换与数据库迁移捆绑；本次已拆到 Deferred。
- 现有验证只覆盖首批三表，不能据此宣称 Dream 43 + 5 表迁移完成。

## 6. 文档校验规则

- 新事实优先写入 01–05 对应模块；跨模块范围决策写总索引。
- Deferred 领域只更新 90，不向当前实施清单渗透。
- 历史证据保留日期、版本和偏差，不删除或重写为“从未发生”。
- 所有链接使用相对路径；旧入口必须能在一次点击内到达本目录。
- 任何数据行级审计工件不得进入 Git；文档只保存聚合、digest 和安全结果。
