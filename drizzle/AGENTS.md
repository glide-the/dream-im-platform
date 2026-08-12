# Drizzle migration protocol

- 修改本目录前必须读取仓库根目录 `AGENTS.md`。
- 每个 schema 变更只有一个 migration owner；并行 Agent 不得同时分配相同序号。
- 迁移必须由 `db:generate` 建立 journal/snapshot，再对复杂 SQL 做人工审查。
- 禁止修改历史 migration、snapshot、tag、when 或已记录 hash；禁止用 `IF EXISTS` / `IF NOT EXISTS` 掩盖未知漂移。
- `DROP`、rename、`NOT NULL`、类型收窄、唯一约束和大表索引必须提供兼容期、数据审计、锁影响和回滚说明。
- Dream-owned 业务表的语义变更必须包含 Dream contract 测试和 capability 更新。
- `legacy/dream-alembic/**` 只是冻结审计文本；禁止导入、执行、重命名为可执行 revision，或把它重新接入任何 runner。
- migration、receipt、日志不得包含 DSN、Secret、Token 或业务正文。
- 提交必须通过空库 replay、旧库 adoption、partial-drift failure、重复执行和并发 migrator 测试。
