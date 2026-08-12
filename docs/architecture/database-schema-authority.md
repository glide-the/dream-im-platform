# 统一 PostgreSQL Schema 权威

> 状态：Capability-only implementation complete / production inventory pending
> 更新：2026-08-12
> 权威仓库：`ink-admin-memory/drizzle/**`

## 1. 决策与所有权

共享 PostgreSQL 的表、字段、索引、约束、函数和触发器只在 Admin Drizzle 演进。Dream 不再新增 Alembic revision，不在启动时执行 DDL，也不以精确 Drizzle global head 作为启动条件。

这只统一 DDL 账本，不统一业务写权限：Dream 继续拥有 Dream repository、事务、workflow 规则和业务数据完整性；Admin、Billing、Gateway 各自只能通过批准的领域接口或白名单命令写入。物理 owner/ACL 仍由目标环境发布审批决定，本设计不授权 `ALTER OWNER`、`GRANT` 或 `REVOKE`。

```mermaid
flowchart LR
  D["Admin Drizzle journal"] --> R["唯一 migration runner"]
  R --> P["PostgreSQL catalog"]
  P --> C["schema_capabilities"]
  C --> A["Dream read-only startup check"]
  A --> X["Dream repositories and domain runtime"]
  X --> B["Dream-owned business data"]
```

## 2. 版本模型

- Admin `0000–0031` 与 Dream 已发布 Alembic `20260809_01–20260809_06` 保持不可修改；revision 文本冻结在 `drizzle/legacy/dream-alembic/`，不可执行。
- 若环境已实际应用 `20260811_07`，0032 将它作为可采纳历史状态；该 revision 不成为新 DDL 入口。
- `0032_dream_schema_authority_cutover` 是唯一接管切点。
- Dream 启动检查 capability，而不是要求数据库等于 Admin 最新 head。后续 Billing 等独立 migration 不会阻止 Dream 启动。

当前 capability：

| Capability | 最低版本 | 含义 |
| --- | ---: | --- |
| `dream.schema.unified.v1` | 1 | Dream 48 表完整物理 contract 已验证 |
| `dream.workflow.thread-lookup.v1` | 1 | workflow/thread lookup 可用 |
| `dream.story-artifact-contract.v2` | 2 | Story artifact 扩展与兼容约束可用 |

## 3. 0032 原子接管

Runner 在 advisory transaction lock 下执行每条 migration，并把 SQL 与 receipt 放在同一事务。0032 的 preflight、DDL/adoption、catalog postflight、capability 和 V2 data definition 同样原子。

| 输入状态 | 行为 |
| --- | --- |
| 只有 Admin 创建的三张精确 baseline 表 | 创建其余 45 张 Dream 表及全部对象 |
| 完整 Dream schema + Alembic `20260809_06` | 接受历史上“有/无 thread lookup index”两种精确 contract，必要时只补该索引 |
| 完整 Dream schema + Alembic `20260811_07` | 精确验证后只接管版本权威 |
| partial、未知 head、列/约束/index/trigger/function 漂移 | 整个事务失败，不写 0032 receipt 或 capability |

0032 不执行 `DROP`、`TRUNCATE`、业务 `DELETE`、owner/ACL 修改，也不使用无条件 `CREATE ... IF NOT EXISTS` 掩盖未知漂移。Dream core contract 是 48 表/569 列/82 个显式索引/25 个触发器；纳入 Admin Story 扩展后的物理 contract 是 48/584/85/28，机器权威为 `drizzle/contracts/current-catalog.json`。

## 4. 唯一运行方式

```bash
export MIGRATION_DATABASE_URL='postgresql://<dedicated-migrator>@<host>/ink-memory'
pnpm db:migrate:status
pnpm db:migrate
pnpm db:migrate:check
```

`MIGRATION_DATABASE_URL` 必须显式提供；runner 不读取应用 `DATABASE_URL` 作为后备。`status` 和 `check` 验证 journal 的连续 index、唯一 tag/time、数据库 receipt 连续前缀、未知 receipt、缺口和历史 SQL hash。`db:push` 仅允许显式批准且名称包含 test/codex/ephemeral/scratch 的 loopback 一次性数据库。

## 5. Schema 与数据迁移分离

`pnpm db:migrate` 不读取 SQLite，不搬运大规模业务数据。43+5 导入仍是显式命令：

```bash
pnpm db:data:legacy -- \
  --main-sqlite /absolute/path/to/ink-and-memory.db \
  --notion-sqlite /absolute/path/to/notion-connectors.db \
  --mode execute --record
pnpm db:data:subscriptions -- --apply
```

新库写入 `dream-legacy-43-plus-5-v2-drizzle`，它依赖 `dream.schema.unified.v1`，固定 48 表但不把可增长的业务行数写成版本常量。每次回执仍校验 manifest hash、逐表 count/PK digest/row digest、FK、sequence、trigger、安全字段和目标冲突。既有 `dream-legacy-43-plus-5-v1` 定义与成功回执不可修改；相同源指纹会复用 V1，不重复导入。

## 6. 发布与回滚

```text
备份与 PITR 确认
→ 盘点各环境 Alembic 06/07 与 catalog
→ 保持当前已发布 Dream 版本或进入维护窗口
→ 单实例执行 Admin 0032 并证明 capabilities
→ db:migrate:check + catalog/capability 验证
→ 部署 Dream capability-only 版本（仓库中唯一版本）
→ 观察期
→ 观察并完成环境回执归档
```

不提供 destructive downgrade。0032 失败由事务回滚；应用问题回滚到已批准的旧应用制品；schema 问题新增前向 migration；灾难性数据问题使用备份/PITR。回滚窗口内保留 `dream_alembic_version` 作为历史审计，不再更新，Dream runtime 不读取它。

## 7. 尚未完成的外部证明

本工作树已在一次性 PostgreSQL 16 验证 fresh、06（有/无索引）、07、partial/unknown failure、重复执行、历史 hash 篡改和并发 migrator；旧库夹具完全由 Admin 0032 的已审查 DDL 构造，不依赖 Dream 仓库。真实 43+5 E2E 使用当前 4,930 行源数据通过。尚未盘点预发布/生产各环境、PITR 可用性、真实 migrator role/ACL 和哪些环境已应用过 07。可执行 Dream Alembic 已删除；冻结文本仅在 Admin 审计目录保留。

## 8. Prompt Architect 轮次记录

| 轮次 | 目标与范围 | 完成标准 | 实际结果 | 未验证推断 |
| --- | --- | --- | --- | --- |
| 1 | 固定双账本事实与 0032 contract | 不改历史，支持 fresh/06/07，漂移原子失败 | 生成完整 catalog、schema 声明、snapshot 与 0032 | 生产环境状态未盘点 |
| 2 | 强化唯一 runner | journal/hash/prefix/lock/atomic receipt | status/check/through、专用 URL、并发和篡改验证通过 | 生产 migrator role 未配置 |
| 3 | Dream 过渡启动 | capability 优先，06/07 临时回退，无 runtime DDL | database/importer 与聚焦测试通过 | capability-only 最终发布尚未执行 |
| 4 | 数据账本切换 | V1 可复用，新数据只写 V2 | 当前真实 48 表/4,930 行 E2E 通过 | 其他环境源行数和冲突待各自 rehearsal |
| 5 | 文档与调用方 | 活跃初始化只剩 `pnpm db:migrate` | README、AGENTS、设计和 E2E 已切换 | 历史审计文档仍保留原时点事实 |
| 6 | 移除 Dream Alembic | capability-only runtime；Admin 独立构造旧库夹具；07 不丢失 | Dream migrations/DDL generator/dependency 已删除，07 归档且 0032 cutover E2E 通过 | 生产环境/PITR/角色仍需逐环境证明 |
