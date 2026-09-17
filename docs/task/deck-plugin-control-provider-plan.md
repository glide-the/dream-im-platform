# Deck Plugin 控制面数据迁移计划

## 背景与问题

Dream 的公开 Deck Plugin 路由仍通过 `DeckPluginAdminService` 和
`InstallationService` 直接查询、更新 `deck_plugin_releases`、
`deck_runtime_plugin_locks`、`deck_plugin_installations` 与
`runtime_plugin_materializations`。这违反 Admin 统一数据库访问边界，也使
Dream 同时承担权限过滤、事务、并发控制和 PostgreSQL 凭据。

## 目标与边界

本阶段在 Admin 建立严格 Zod DTO、领域 Service 和 typed Drizzle Repository，
提供安装列表、版本详情、Runtime readiness、变更计划和变更提交五个命名业务操作。
Admin 派生 OAuth 主体，校验 Workspace owner、实例级管理员角色、release/lock、
installation revision、状态转换和本地校验证据，并将业务写入、operation receipt 与
audit 放在同一事务。现有 `dream.schema.unified.v1` 已覆盖全部表，本阶段不新增 schema
或 migration。

Dream 保留公开产品路由、本地内置/CLI 制品解析、目录边界、digest 校验、共享文件系统和
CLI 行为。Dream 先取得 Admin 计划，只对计划指定的 immutable lock 条目做本地验证，再把
封闭 evidence DTO 交回 Admin。Admin 不访问文件系统；Dream 不保留 SQL、ORM、连接池或
数据库失败回退。

## 概念与规则

- `deck-plugin-control.list`、`version` 与 `readiness` 是只读业务投影。
- `deck-plugin-control.plan` 接受封闭 action union，返回 installation revision、目标 release、
  capability diff 和是否需要本地 Runtime evidence；它不写库。
- `deck-plugin-control.apply` 重新计算计划并比较 revision；不能把旧计划用于新状态。写操作用
  原 request ID 恢复未知提交结果，禁止盲重试。
- Workspace scope 必须属于 canonical actor。Instance scope 和 purge 必须由 Admin 中的
  canonical `users.role=admin` 再次确认。认证成功不会自动获得管理权限。
- install、无能力扩张的 upgrade、approve、rollback 和 reconcile 必须携带与 lock 完全一致的
  evidence；enable、disable、reject、uninstall 不接收文件路径或 Runtime evidence。
- `local` source 继续拒绝；controlled/marketplace source 必须存在于 immutable lock。
- capability 扩张保持 `ready -> upgrade_pending`，批准后才验证目标制品并切换；拒绝恢复
  `ready`。uninstalled 保持终态，purge 在没有可核验 retention clearance 时失败关闭。
- materialization placement 来自 Admin 的 `DREAM_RUNTIME_ACTIVATION_POLICY_JSON`；
  `cache_ref` 仅保存 Dream 已规范化并验证的服务端路径，不由浏览器提供，也不在读取 DTO 中回显。

## 正常流程与状态

1. Dream 用当前 OAuth token 请求 plan。
2. Admin 在只读事务中验证主体、scope、release、lock、installation 与 revision。
3. 若计划要求 evidence，Dream 在共享文件系统解析 server-published source，校验目录和 sha256。
4. Dream 以独立 request ID 请求 apply；Admin 重做第 2 步并校验 evidence。
5. Admin 在一个事务中 upsert materialization、执行 installation 状态转换、写 receipt/audit。
6. Dream 将严格输出映射回既有公开响应；Admin 不可用或能力缺失时返回明确失败，不访问数据库。

失败包括 scope/角色拒绝、release 或 lock 不可用、source 不匹配、revision 冲突、非法状态转换、
能力审批缺失、evidence 缺失/不一致、Runtime policy 缺失与 retention 阻止。任何失败都不提交部分状态。

## 修改范围

- Admin：新增 `deckPluginControlDto/Repository/Service/Handler`、注册 operation、补单元测试，更新
  `app/lib/dream/.folder.md`、`docs/task/.folder.md` 和架构索引。
- Dream 后续阶段：新增 Admin DTO client/gateway，重写公开路由集成测试，删除已无生产调用的
  SQL gateway/installation service，并更新数据库关闭清单。

## 验收

- DTO 拒绝 actor、user ID、SQL、table、column、transaction 和额外字段。
- Provider-free tests 覆盖 list/plan/apply、owner/admin、全部状态转换、revision/evidence/receipt 失败。
- Admin TypeScript typecheck、focused Vitest、owned ESLint 和 operation registry 生成/哈希门禁通过。
- Dream 消费完成后，公开路由测试覆盖安装、审批、拒绝、回滚、禁用/启用、reconcile 和错误恢复；
  源码清单及运行测试同时证明生产路径不再访问 PostgreSQL。

<!-- [Sync] 2026-09-16: Prompt Architect stage for Registry170+ Deck Plugin control-plane ownership. -->

Admin provider implementation is now registered as Registry170-174. Deterministic focused, full unit,
TypeScript, ESLint, generated-registry and documentation gates pass; Dream consumer and isolated PostgreSQL
contract remain the next dependent stages. Registry174 SHA is
`242ddb8e06c66058b4a6a0a015a08edb41353446ae00be46e6c2f1b946cf57dc`.
