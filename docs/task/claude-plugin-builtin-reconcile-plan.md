# Claude Plugin 内置包启动协调计划

## Optimized Prompt

在 Admin 的既有 Registry182 Claude Plugin 数据域之后，追加两个仅允许 Dream 服务以
`plugins:catalog` 后台权限调用的业务操作。Admin 必须用严格 DTO、领域 Service 和 typed
Drizzle Repository 完成：检查平台内置 package spec 是否已有 ready installation；缺失时
创建可由 Dream 执行的安装计划；安装生命周期报告；以及根据 active Deck binding 对应的
release manifest 中 `runtime.claude_code_plugins[].claude_code_plugin_id` 原子补齐 Deck 引用。
调用方不得提交用户 ID、Deck ID、表名、列名、SQL 或事务选择器。Dream 继续负责真实 Claude
CLI 校验、制品摘要、共享文件系统导入和启动编排。Admin 不可用、scope/capability 缺失或响应
未知时 Dream 启动记录明确错误并继续，不回退 PostgreSQL。

同时补齐 Registry175-182 用户写操作及新增后台写操作的原始回执读取，使超时后的未知提交
结果可按原 service/actor/operation/request_id 恢复，禁止盲目重试。保持 Registry182 前缀字节
不变；无 schema 变化，不新增 migration。

## 目标与证据

- Dream 当前 `backend/server.py::startup_claude_plugin_seed` 仍直接查询 installation、调用旧 DB
  reporter 并执行 hard-coded Deck Plugin 回填。
- Admin 已拥有 Claude Plugin operation/installation 与 Deck ref 的 Drizzle schema、Registry175-182
  生命周期服务以及 `plugins:catalog` 后台 scope。
- Admin 已有严格 `DeckPluginManifestV1` parser；active binding 可精确关联 release manifest。

## 责任与依赖

- Admin：Registry183-184 DTO、后台鉴权、Repository 查询/写入、Service 规则、事务和回执。
- Dream：后续阶段接入两个操作，保留 CLI、制品和共享文件系统执行，删除启动 SQL 与旧回填函数。
- 依赖：Registry182、统一 Dream schema capability、Remote Marketplace capability 均保持不变。

## 接口与状态

- `claude-plugin.builtin.ensure`：输入仅含 `package_spec`；ready 时补齐 manifest 声明对应的 Deck refs，
  否则返回一次 installation plan。
- `claude-plugin.builtin.report`：复用严格 lifecycle event；complete 必须是 `platform-builtin` evidence，
  installation/operation/refs 在同一 Admin UOW 完成。
- begin/progress/fail 保持现有 queued → running → ready/error 状态机；重复 request_id 返回原结果，
  不确定结果通过 receipt 查询恢复。

## 保持不变

- Dream 的真实 Claude CLI、Git/manifest/digest 校验、immutable artifact import、文件路径和后台启动顺序。
- Deck runtime lock、Agent Runtime、SSE、turn/resume/cancel、资源策略和共享文件系统语义。
- Registry1-182 合同、数据库 schema 与 Drizzle migration 历史。

## 验收与风险

- Provider-free DTO/Service/Handler/receipt/registration tests 覆盖后台 scope、禁止 bearer、strict input、
  manifest 匹配、无匹配、重复 ref、complete source 校验和 Registry182 prefix hash。
- 运行 focused Vitest、TypeScript、ESLint、registry JSON parity 与 Markdown 引用检查。
- 风险：损坏的历史 manifest 不生成引用；有效 manifest 继续处理，Dream 启动不因单个内置包失败而退出。

<!-- [Sync] 2026-09-16: one Prompt Architect pass for Registry183-184 builtin reconciliation. -->
