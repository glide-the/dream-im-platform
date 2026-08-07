# 交付不可变 admin 审计资源与写入一致性

## 1. 关联 Issue 与任务元数据

- Task ID：`TASK-REFINE-ADM-004`
- 关联 Issue：`REFINE-ADM-004`
- 当前增量同步：[SUO-346](/SUO/issues/SUO-346)
- 权威增量：[`SUO-341 plan revision 1`](/SUO/issues/SUO-341#document-plan)；Issue 合同：
  [SUO-345](/SUO/issues/SUO-345)
- 设计来源：`DESIGN-REFINE-ADMIN-001` §5.1、§5.3、§5.5、§5.7–§5.8
- domain：`full-stack`
- 上游类型：`full-stack`
- 优先级：P0
- 标签：`audit`、`security`、`drizzle`、`admin-api`
- 唯一规划主责：`TaskDesignAgent`
- 后续执行 owner：由 StagePlanner 唯一绑定；本 task 不直接派发。
- Requirement：[TASK-REQUIREMENT-task_004_full-stack_admin_audit_resource.md](./TASK-REQUIREMENT-task_004_full-stack_admin_audit_resource.md)

## 2. 任务目标

基于 `TASK-REFINE-ADM-002` 已生成的 `admin_audit_logs` schema，交付不可变、脱敏的
audit writer、只读 list/show admin API 与 `/admin/audit` UI，并向后续 mutation task
提供“审计失败则敏感变更失败”的窄一致性接口。

## 3. 输入与输出

### 输入

- `TASK-REFINE-ADM-002`：identity、RBAC、guard、audit schema 与 migration。
- `TASK-REFINE-ADM-003`：resource/query/response/error/provider 合同。
- 设计 `AC-007`、`AC-008`、`AC-012`–`AC-014`、`RISK-006`、`RISK-007`。

### Audit 写入合同

每个事件至少包含：`request_id`、`actor_member_id`、`action`、`resource`、
`resource_id`、`outcome(success|denied|failed)`、`changed_fields`、`reason_code`、
`created_at`。

- `changed_fields` 只保存字段名，不保存值。
- denied/validation failed 只保存稳定原因码，不保存完整 request body。
- 手机号、邮箱、prompt、API key、DB credential、session secret、`extras` 不进入事件。
- success 审计与业务变更同一事务，或提供等价的可证明保证；本 MVP 不以未设计的
  outbox 替代。

### 输出

- audit writer/transaction wrapper 的稳定 `app/lib/admin` 窄接口。
- `GET /api/admin/audit` 与 `GET /api/admin/audit/{id}`；无 mutation endpoint。
- `/admin/audit` list/show 页面；三个角色均只读。
- success/denied/failed/redaction/transaction failure 的测试证据。

## 4. 实现步骤

### 后端

1. 读取 `002` schema，不修改表定义或 migration；建立只接受白名单字段的 audit
   event 类型与写入函数。
2. 生成/传播 `request_id`，将 identity、resource、action、outcome 与 reason code
   统一关联；API error 的 `requestId` 必须能与 audit `request_id` 关联，但不得复制
   response `details`、stack 或原始 cookie/header/body。
3. 提供供 `005`–`007` 调用的 mutation + audit 事务窄接口；模拟 audit insert 失败，
   证明敏感业务 mutation 不提交。
4. 记录 denied/validation failed 时只写 sanitized metadata；审计本身失败也不能把
   敏感输入写进普通日志。
5. 实现 audit list/show 查询窄接口，使用 `003` 的分页/sort/filter 白名单与统一
   response/error；Route Handler 不写 Drizzle 查询。
6. 实现只读 `/api/admin/audit` 与 `/{id}`，三角色均可 list/show；不要声明或实现
   POST/PATCH/PUT/DELETE。

### 前端

7. 声明只读 `admin-audit-logs` resource，建立 `/admin/audit` list 与 show 页面。
8. 页面只显示脱敏字段，不提供 create/edit/delete 控件；统一呈现 401/403/404/5xx。
9. 对三个角色执行只读 UI smoke，确认手工构造 mutation 请求也被 404/405/deny。

### 联调与验收

10. 用共享 provider 读取 list/show；用 `005`–`007` 可复用的测试 fixture 验证一次
    success、一次 denied、一次 failed 事件。
11. 扫描响应、日志测试捕获与 audit payload，确认没有 secret/PII/prompt 原文。

## 5. 涉及文件路径与修改边界

### 允许修改

- `app/lib/admin/audit.ts` 及相关单职责类型/查询窄接口（预期新增）。
- `app/api/admin/audit/route.ts`、`app/api/admin/audit/[id]/route.ts`（预期新增）。
- `app/(admin)/admin/(protected)/audit/**`（预期新增）。
- `app/components/admin/audit/**`（预期新增）。
- audit unit/integration/UI tests 与安全 fixtures（预期新增）。

### 只读参考

- `app/lib/db/schema.ts`、`drizzle/**`：由 `002` 独占，严禁修改。
- `app/lib/admin/auth.ts`、`policy.ts`、`contracts.ts`：消费稳定接口。

### 禁止修改

- `app/lib/db/schema.ts`、`drizzle/**`、现有业务表与 `ensureInitialized()`。
- customers/todos/system-config 的领域 mutation 实现；由 `005`–`007` 拥有。
- conversations、旧无鉴权 API、审计 update/delete endpoint/UI。
- 完整请求体、PII、prompt、secret 的持久化或日志输出。

## 6. 依赖项与 DAG

- 前置：`TASK-REFINE-ADM-002`、`TASK-REFINE-ADM-003`。
- 完成后同时解锁 `TASK-REFINE-ADM-005`、`006`、`007`。
- 下游三个 resource 可并行，只调用本 task 的稳定 writer/transaction interface；不得
  各自实现审计或修改本 task 的基础文件。

## 7. 前端 / 后端 / 联调边界

- 后端：sanitized writer、事务一致性、只读查询与 list/show API。
- 前端：只读 list/show UI，无 mutation action。
- 联调：provider 合同、三角色只读、requestId 串联、下游 mutation fixture。
- 验收：后端证明 redaction/transaction，前端证明只读，联调证明变更到审计闭环。

## 8. 测试策略

### Happy path

- 允许的测试 mutation 成功提交且产生一条包含 actor/resource/outcome/changed field
  names 的 sanitized audit；三个角色可在 list/show 读取。

### Failure path

- denied/validation failed 记录稳定原因码但无完整 body；模拟 audit insert 失败时业务
  mutation 回滚；尝试 PATCH/DELETE audit 得到拒绝且没有修改。

### 最小验证命令/方式

- `pnpm test:run -- app/lib/admin/audit.test.ts`：success、denied、failed、redaction。
- 单独运行 `app/api/admin/audit/**/*.integration.test.ts`：list/show、分页边界、三角色、
  未知 id 404、requestId 关联。
- transaction failure simulation；UI smoke/E2E 三角色只读；secret/PII pattern assertions。
- `pnpm lint`；`git diff --check -- app/lib/admin app/api/admin/audit app/components/admin`。

## 9. 完成标志

- [ ] audit writer 只接受白名单 metadata，三种 outcome 均有测试。
- [ ] 敏感 mutation 与 success audit 满足“审计失败则变更失败”。
- [ ] audit API/UI 只有 list/show，三角色可读且无 mutation surface。
- [ ] 响应、测试日志与 audit payload 无 secret、PII、prompt、`extras` 原文。
- [ ] 未修改 schema/migration；完成信号包含下游可调用接口和 failure test 结果。

## 10. 非目标

- 创建或变更 audit schema/migration。
- 实现 customers/todos/system-config 领域操作。
- 复用 Claude 工具审计、实现审计删除/编辑或未设计的 outbox。

## 11. 风险、阻塞与回退

- 风险：事务接口迫使大改稳定 `app/lib`。Owner：后续执行 owner；action：增加最窄的
  transaction callback/interface，不搬迁现有领域逻辑。
- 风险：审计失败路径把原始 body 写入日志。Action：所有错误只记录 requestId 与稳定
  reason code，并用 pattern test 反证。
- 回退：若无法证明一致性，保持 mutation 关闭并回到设计澄清；不得以“业务已成功但
  审计稍后补写”静默降级。
