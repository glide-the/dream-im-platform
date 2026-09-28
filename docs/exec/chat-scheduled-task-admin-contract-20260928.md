<!-- [Input] 2026-09-28 scheduled-task design review, Admin Chat/TaskSession authority and forward Drizzle history. -->
<!-- [Output] Admin producer contract, four exact capabilities, operation DTOs, release gate and isolated verification plan. -->
<!-- [Pos] Admin implementation handoff for the Dream scheduled-task consumer; this is not a normal-business acceptance receipt. -->
<!-- [Sync] 2026-09-28: specify 0069-0072, pre-model turn binding and nullable link lifecycle required for safe recovery. -->

# 定时 Chat 任务 Admin 合同

## 背景与问题

现有 Chat TaskSession 能在同一数据库事务中创建独立目标 Thread 和首条用户消息，但没有退出浏览器后的计划触发或可延后使用的用户授权。浏览器 OAuth token 不能保留给后台 worker。原有 Runtime delegation 的来源校验只接受 OAuth、Story 确认、Reflections 或返回任务，不能把定时触发伪装成这些来源。

## 目标与边界

Admin 负责一次和每日计划、触发事实、原子领取、短期授权、精确版本门槛和用户日期/历史查询。Dream 负责共享 Chat 应用服务、模型选择与 Gateway 调用、worker 生命周期和界面。实际派发复用 `chat_task_session`、`chat_thread` 与 `chat_message`；计划定义本身不是 Run。没有正常业务数据库迁移、模型调用或真实账户写入。

## 概念与规则

`default` 是界面尚未保存的建议，`desired` 是提交中的用户输入。Admin 只持久化一份 `effective` 定义，成功编辑、暂停、恢复、软删除或撤销时按预期 `revision` 比较并递增。立即运行不修改 `revision` 或下一次计划时刻。单次选择不存在的当地时间会拒绝，重复当地时间须显式选偏移；每日固定 IANA 时区，缺失时刻跳过，重复时刻取较早一次。每日停机后只取最近一次到期时刻，更早的范围留在触发记录；同一计划有未结束触发时不并发启动另一个。

| 前向迁移 | 精确 capability | 用途 |
| --- | --- | --- |
| `0069_equal_blob.sql` | `dream.chat-scheduled-task.v1` | 定义、触发、唯一键、租约、状态与受权日期数据。 |
| `0070_curved_invaders.sql` | `identity.scheduled-chat-runtime.v1` | 把既有 Runtime delegation 的 `server-persistence` 或 `gateway-cli` 凭据绑定到具体触发和领取标识。 |
| `0071_rich_tombstone.sql` | `dream.chat-scheduled-turn-binding.v1` | 在模型调用前记录目标轮次编号，完成消息只能按该编号对账。 |
| `0072_chief_mentor.sql` | `dream.chat-scheduled-link-lifecycle.v1` | 普通 Chat 删除目标 Thread、TaskSession 或消息时保留触发事实，并把相应引用置空。 |

每个 capability 在其前向迁移 DDL 和最小权限授权之后发布。所有定时操作要求存储、轮次绑定和链接生命周期 capability；后台领取、准备、开始、续租、结束、对账还要求 Runtime 来源 capability。旧 Admin 缺任一项时功能拒绝读写或派发，普通 Chat 原路径不变。旧 Dream 不消费新操作；Admin 先 expand 并核对目标库，再接 Dream 消费者，最后做隔离技术与正常业务验收。不可改写 0069/0070/0071/0072 journal、snapshot 或 SQL 历史。

目标 Thread、TaskSession、首条消息及最终消息是可空引用。用户在普通 Chat 中删除它们时，数据库只清除对应链接，不删除计划或历史触发；历史列表仍显示计划时间、状态与安全错误码，已删除的 Chat 链接不提供跳转。正在运行的触发若失去目标 Thread 或完成消息，不再声称成功；对账只能按已绑定的轮次与仍存在的 final 证明完成，否则保留未知状态。删除来源 Thread 则按定义外键级联删除该计划及其触发历史，因此界面不再展示这项计划。

### 命名操作

用户受权操作：`scheduled-task.create/get/day/history/edit/pause/resume/delete/restore/run`。`create` 从当前受权主体取得用户与服务，输入只含来源 Thread、幂等键、标题、提示词及明确时间规则；`run` 用手动请求键作为持久回执幂等键。写操作在同一 Admin 事务内产生原回执与审计。`day` 按展示时区的 UTC 日期区间查询历史触发，并从每日规则只读投影未来日期。

服务专用操作：`scheduled-trigger.claim/prepare/renew/start/finish/reconcile/authority.resolve`，只接受配置中有 `schedule:execute` 的 confidential client，拒绝浏览器 Cookie；除 `authority.resolve` 必须同时提交服务凭据与 `sta_` bearer 外，其余操作拒绝用户 bearer。`claim` 使用数据库时间、行锁及唯一约束；`prepare` 再查活动主体、来源 Thread、Deck/Voice，并用触发 ID 作为既有 TaskSession 请求键，原子建立目标 Thread/首条消息。准备失败记录安全错误码。`start` 必须在模型调用前把共享 Chat 应用服务为此次轮次分配的 `target_turn_id` 写入 Admin；重复提交只接受相同值。`finish` 成功必须验证已提交的 assistant final 所属 Thread、最终投影、完成状态及完全相同的 `turnId`。过期租约先按这些事实对账；不能证明的轮次保留 `state_unknown`，不重发模型调用。

`prepare` 发放只含服务、触发、领取、用户、来源/目标 Thread、用途及期限的 `sta_` 签名令牌；服务端以 `AUTH_CHAT_SCHEDULE_AUTHORITY_SECRET` 签发，每次使用再查领取、账户和 Deck/Voice。令牌不写回执、审计、日志或数据库。Dream 用它通过现有 `/api/internal/dream/v1/runtime-delegations` 换取同一触发限定的 `idg_`：`server-persistence` 供既有 Chat/配置/Workflow context 持久化，`gateway-cli` 供既有 Gateway 模型调用。Admin 将派生凭据的哈希存入 `identity.scheduled_chat_grant_sources`，每次 `idg_` resolve/renew 都重查真实触发与租约；过期、撤销、换领取、主体停用或 Deck/Voice 失效均拒绝。旧 OAuth token 不被保存。

`sta_` 的直接调用面只允许目标 Thread 的用户/助手消息持久化、Thread get/update-session 和委托创建。需要其他数据读写时，Dream 必须取得上述来源限定的 `server-persistence` 凭据，不能扩大 `sta_` allowlist。Gateway 的既有模型可用性、订阅、余额及账本边界仍对该 canonical subject 生效；Dream 共享 Chat 应用服务还须在流启动前重查模型与 Deck 并沿用普通 turn 的 Factory、持久化、资源 admission 与错误路径。Admin 只提供受权合同，单独部署 Admin 不代表后台模型执行已闭环。

后台 actor 由 `scheduled-trigger.authority.resolve` 在 Admin 校验当前领取后返回 subject、canonical user、服务客户端、来源/目标 Thread、scope、用途、签发时间和期限；Dream 不自行解码 `sta_`，也不构造虚假的浏览器用户。既有前置读取的精确接线为：`user-system-config.get` 仅对带此来源的 `server-persistence idg_` 复用 `thread-system-config.get` 的当前目标 Thread 所有权校验，配置写入继续只准 OAuth；`workflow-context.resolve`、`deck-chat-context.resolve` 及目标 Thread 的 Chat 持久化使用同一来源限定的 `server-persistence idg_`；`_resolve_platform_model_selection` 的 `/v1/models` 使用另行派生的 `gateway-cli idg_` 与现有 `models:list` scope，Gateway 继续判定模型可调用性。两个 `idg_` 凭据用途不同，不能共用一个 bearer 字段。

### Dream 接线门槛

现有 `ThreadFactory.run_streaming` 为普通轮次自行生成 ID，且现有 TaskSession 首条消息不写入 `chat_input_queue`。Dream 必须在共享公开 Chat 应用服务中先生成本轮 ID，调用 `scheduled-trigger.start` 提交该 ID，再让 Factory 用它启动同一轮次。不得把该 ID 偷换成现有返回任务专用的 `task_result_turn_id`，也不得用“目标 Thread 最近一条 assistant 消息”推断完成。公开路由与 worker 应调用同一个校验用户、Thread、Deck、模型、Gateway、消息持久化和 Runtime 的应用服务；没有这条接线与隔离集成证据时调度保持关闭。

## 验证与发布门槛

代码完成后的独立验证由主任务执行：静态类型检查、lint、确定性单元测试、聚焦 Playwright，以及四条迁移在明确命名且可删除的隔离 PostgreSQL 上依次回放。首先比较 URL 中的数据库名和 `SELECT current_database()`，明确确认它是本轮创建的隔离库，再执行 `pnpm --filter @ink-memory/db migrate`；根命令 `pnpm db:migrate` 是 Provider orchestrator，不用于本次直接回放。不得对 `.env.local` 的正常数据库运行。重点证明 DST 缺失/重复、用户幂等、revision 冲突、双 worker 唯一领取、停机跳过、手动请求键、准备前后崩溃、预绑定的首轮 final、未知状态后确证 final、失效授权、普通 Chat 删除引用、部分迁移漂移、既有行锁的领取接管与现有普通 Chat/Gateway 回归。若后续有真实业务测试，按仓库 AGENTS.md 使用用户指定正常账户和公开生产入口另行验收。
