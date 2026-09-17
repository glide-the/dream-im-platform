# Claude Plugin 数据提供方计划

## 背景与问题

Dream 的 `backend/routers/claude_plugins.py`、`install_service.py` 与
`marketplace_service.py` 仍直接查询和修改 `claude_plugin_operations`、
`claude_plugin_installations`、Remote Marketplace 表以及 Deck 引用。安装业务同时包含
Claude CLI、Git、制品导入和数据库状态，不能把整个执行器迁入 Admin，也不能继续让 Dream
持有 PostgreSQL 凭据。

## 目标与边界

本阶段按 Prompt Architect 模板将要求固化为可执行任务：Admin 新增 Registry175-182 八个
命名操作，以严格 Zod DTO、领域 Service 和 typed Drizzle Repository 提供全局 Marketplace、
安装记录、操作记录、安装 prepare、生命周期 report 与 uninstall。写操作必须在原 request ID
的 receipt/audit UOW 中提交，未知提交只读取原 receipt，不盲重试。

Dream 保留 Claude CLI、Git checkout 校验、manifest/digest 计算、immutable artifact import、
后台任务和共享文件系统。Dream 取得 Admin prepare 计划后执行本地工作，只把限定的
`begin|progress|fail|complete` 事件和服务端生成的文件证据交给 Admin。Admin 不访问文件系统，
Dream 不保留 SQL、ORM、连接池或数据库失败回退。

## 概念与规则

- `claude-plugin.installations.list`、`marketplace.list`、`operations.list`、
  `operation.read` 与 `installation.read` 是只读业务投影。
- `claude-plugin.install.prepare` 校验 package spec 或已批准的 immutable Marketplace entry，
  创建 queued operation 并返回本地执行所需的来源事实。
- `claude-plugin.install.report` 锁定 operation，只接受固定阶段和进度；complete 在一个事务内
  校验 package/Marketplace/digest/JSON evidence，按制品唯一键插入、恢复或复用 installation，
  再完成 operation。
- `claude-plugin.installation.uninstall` 锁定 installation，软删除并禁用全部 Deck refs；immutable
  artifact 保留给历史 Thread 和审计。
- 所有操作由服务凭据加 OAuth token 进入。登录 Dream 不授予 Admin 管理页面权限；当前产品
  规则仍允许所有拥有相应 Dream scope 的已登录用户管理共享插件，不自行增加角色限制。
- Marketplace 计划在 complete 时重新读取已批准 entry，digest 或身份变化以
  `CLAUDE_PLUGIN_MARKETPLACE_REMOTE_DRIFT` 失败关闭。
- 现有 `dream.schema.unified.v1` 与 `dream.claude-plugin.remote-marketplace.v1` 覆盖所需表，
  本阶段不增加 migration、DDL 或 capability。

## 正常流程与状态

1. Dream 用当前 OAuth token 调用 prepare，Admin 原子创建 queued operation。
2. Dream 后台任务报告 begin，执行 CLI/Git/文件工作，并按固定阶段报告进度。
3. Dream 写入不含 secret/token 的本地 evidence 文件，将 artifact 与 execution DTO 报告给 Admin。
4. Admin 锁定 operation，重验 immutable Marketplace facts，按唯一制品身份 insert/revive/replay
   installation，并在同一事务完成 operation、receipt 与 audit。
5. 失败路径由 Dream 写 evidence 后报告 fail；Admin 将 queued/running 转为 terminal error。
6. Admin 超时或未知提交时，Dream 只用同一 request ID 读取 receipt；没有 receipt 就返回明确的
   unknown outcome，禁止回退 PostgreSQL。

## 修改范围与保持行为

Admin 新增 `claudePluginDataDto/Repository/Service/Handler`、operation registry、路由分发、
provider-free 测试和生成契约。Dream 下一阶段新增对应 Pydantic DTO client，重写公开路由与
`PluginInstallService` persistence port，并删除生产 SQL helper 与 `MarketplaceCatalogService`。

保持现有 package spec、CLI argv、Marketplace checkout、manifest/digest、artifact store、后台
202 响应、operation polling、软删除、Deck ref disable、共享路径和错误码语义。Runner、SSE、
Agent Runtime、资源策略 LKG 与 Thread 工作区不在本阶段修改。

## 验收与风险

- DTO 拒绝 actor、user ID、role、SQL、table、column、transaction 和额外字段。
- Service tests 覆盖列表、Marketplace、prepare、begin/progress/complete、digest drift、非法 JSON、
  uninstall 与 Deck ref disable。
- Registration tests 证明 Registry174 prefix SHA 不变、八个 operation hash、Registry182 full SHA、
  exact schema requirements 和专用 Route dispatch。
- TypeScript、focused/full Vitest、ESLint、build、JSON/Markdown 引用及 diff 检查通过。
- Dream consumer、隔离 PostgreSQL ACL/事务合同及正常账户真实业务验收分别记录，不能用本阶段
  provider-free 结果宣称跨项目迁移完成。

<!-- [Sync] 2026-09-16: one Prompt Architect pass for Registry175-182 shared Claude Plugin persistence. -->
