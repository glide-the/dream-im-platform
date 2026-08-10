# Story Artifact SQLite 历史关系恢复审计

> 日期：2026-08-10  
> 模式：SQLite `mode=ro&immutable=1` + PostgreSQL read-only comparison  
> 目标：判断 full reconcile 报告的 18 个 `missing_relations` 是否为 SQLite→PostgreSQL 迁移遗漏

## 结论

18 个条目不是 PostgreSQL migration 漏迁，不能通过 Drizzle data migration 恢复。

- 原始 SQLite 和 PostgreSQL 都有相同的 20 条 `workflow_runs`。
- 20 条 Run 的 `workspace_id`、`created_by`、`source_voice_thread_id`、`source_message_id` 均无差异。
- 7 条 Run 引用的 source message 在 SQLite 与 PostgreSQL 中都不存在。
- 11 条 Run 的 Workspace、Thread、Source Message 在两库中都存在且 metadata hash 一致，但原始 metadata 本来就没有 `story_workspace_episode_identity`。
- 只有 2 条 Run 同时拥有可信 Episode identity、server-owned run registry、Project manifest 和 workflow completion facts；它们已经物化为 `浮世行路` 与 `改写规则` 两条 canonical Story。
- 其余 18 条 Run 都没有 run-scoped `episode.json` registry，也没有可绑定的 Project manifest/Artifact workflow facts。

因此 reconcile 的 `missing_relations=18` 实际混入了“非 Episode Artifact Run / 历史未绑定 Run”，不等价于 18 个漏建剧本。

## SQLite 来源证明

| 项目 | 结果 |
|---|---|
| 主库 | 唯一非空 legacy main SQLite |
| 大小 | 77,856,768 bytes |
| SHA-256 | `92df6c51724263caed2fd0d3800dfae2447d053bd54c3848a821ce6feb756f67` |
| `PRAGMA integrity_check` | `ok` |
| `workflow_runs` | 20 |
| `story_workspace_workspaces` | 12 |
| `users` | 28 |
| `chat_thread` | 1,165 |
| `chat_message` | 2,355 |

审计前后 SHA-256 相同，SQLite 文件未被修改。

## PostgreSQL 对照

逐 Run 对照结果：

| 分类 | 数量 | 说明 |
|---|---:|---|
| Episode Artifact identity 完整 | 2 | 两库 metadata 一致，registry/manifest/workflow facts 存在，Story 已 indexed |
| Source Message 在两库均不存在 | 7 | SQLite 无可回填 row；不能构造或猜测 launch provenance |
| Source Message 存在但两库均无 Episode identity | 11 | metadata 完全一致；属于历史未绑定/非 Artifact Run |
| SQLite 有、PostgreSQL 缺少的 Run/关系 row | 0 | 没有 migration omission |
| SQLite/PostgreSQL Run 关键字段差异 | 0 | 没有可生成的 UPDATE mapping |

Dream 官方 `verify-existing` 也报告 target missing rows 为 0。唯一 drift 是一条 Dream Agent command message 的运行态 dispatch claim：SQLite 为 `dispatching`，PostgreSQL 为 `pending`，变化字段仅为 `dispatch_status`、claim ID 和 lease；run/action identity 相同。该行不是 Workflow Run source message，也不包含 Episode identity，不能为 18 条 Run 提供恢复关系。

## Drizzle 判断

本轮不能安全创建关系恢复 migration：exact recoverable mapping 数量为 0。

如果创建静态 `UPDATE workflow_runs` 或 `INSERT chat_message`：

1. 值不来自原始 SQLite；
2. 会伪造 immutable provenance；
3. 没有 Episode registry/Project identity 可以证明目标 Story；
4. 可能把普通/失败/旧版 Dream Run 错建成剧本；
5. migration 无法满足 fail-closed one-to-one mapping 验收条件。

现有 Story schema migration `0027_young_stark_industries.sql` 已包含 Artifact Story 索引所需字段与 stable partial unique key，不缺新列。

## 正确后续修复

应修正 Dream reconcile 的候选与诊断语义，而不是修改业务数据：

- 只把具备 Episode authority 或 server-owned registry 证据的 Run 纳入 Story index reconcile；
- 将历史非 Episode Run 计为 `not_applicable`/ignored，而不是 `missing_relations`；
- `missing_relations` 只保留“已经证明是 Episode Artifact Run，但 Workspace/User/Thread/Source Message 关系损坏”的情况；
- 该修改属于 Dream Service/contract/test，不需要 Drizzle schema migration。

若产品决定人为将某个旧 Run 升格为 Episode Artifact，必须提供独立的受控 binding-recovery 流程与用户确认，不能借 SQLite migration 猜测。
