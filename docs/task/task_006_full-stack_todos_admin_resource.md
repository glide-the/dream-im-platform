# 交付 todos 管理资源

## 1. 关联 Issue 与任务元数据

- Task ID：`TASK-REFINE-ADM-006`
- 关联 Issue：`REFINE-ADM-006`
- 设计来源：`DESIGN-REFINE-ADMIN-001` §3.1、§5.1、§5.3–§5.5
- domain：`full-stack`
- 上游类型：`full-stack`
- 优先级：P0
- 标签：`todos`、`crud`、`rbac`、`admin-api`
- 唯一规划主责：`TaskDesignAgent`
- 后续执行 owner：由 StagePlanner 唯一绑定；本 task 不直接派发。
- Requirement：[TASK-REQUIREMENT-task_006_full-stack_todos_admin_resource.md](./TASK-REQUIREMENT-task_006_full-stack_todos_admin_resource.md)

## 2. 任务目标

在受保护的 `/api/admin/todos` 与 `/admin/todos` 上交付 todos 的
list/show/create/update，以及仅 admin 可执行的 delete；复用现有领域函数并保持
旧 PWA todos API/页面协议和行为不变。

## 3. 输入与输出

### 输入

- `TASK-REFINE-ADM-002` 的 identity/policy/guard。
- `TASK-REFINE-ADM-003` 的 contracts/providers/error mapping。
- `TASK-REFINE-ADM-004` 的 audit/transaction 窄接口。
- 现有领域锚点：`listTodos`、`getTodoById`、`createTodo`、`updateTodo`、
  `deleteTodo`；Todo 字段为 title、description、priority、status 与 server-managed
  id/timestamps。

### API/UI 输出

- `GET/POST /api/admin/todos` 与 `GET/PATCH/DELETE /api/admin/todos/{id}`。
- list/show 对三角色开放；create/update 对 operator/admin 开放；delete 仅 admin。
- `/admin/todos` 的 list/show/create/edit；delete 是权限 action，无独立页面。
- 每个允许、拒绝或失败的 mutation 产生共享格式的 sanitized audit。

## 4. 实现步骤

### 后端

1. 为 todos 定义 zod body/query 与字段白名单；create/update 只允许 title、
   description、priority、status，id/timestamps 由服务端管理。
2. 明确 search、status、priority 与允许 sort/order 字段；非法 enum、分页或未知字段在
   调用领域函数前拒绝。
3. 建立 todos admin adapter，复用现有 `app/lib/db.ts` 函数；Route Handler 只编排。
4. 实现五个 admin API action 与精确 RBAC；operator/auditor 直调 delete 返回 403。
5. 统一处理 401/403/404/409/422/5xx 与 requestId，不泄露内部错误。
6. 所有 mutation 通过 `004` 接口记录 success/denied/failed；audit failure 阻止提交。

### 前端

7. 使用共享 providers 实现 list/show/create/edit 与 filter/sorter 翻译。
8. 根据角色展示动作并处理统一错误；UI 隐藏不能替代 server deny。
9. 不增加批量操作、实时订阅、多租户字段或其他 resource 入口。

### 联调与验收

10. 完成 admin create/update→show→audit 的 happy path。
11. 完成 operator delete direct-call 403 与非法 filter/sort 的 failure path。
12. 回归现有 todos E2E 与 API 行为。

## 5. 涉及文件路径与修改边界

### 允许修改

- `app/api/admin/todos/**`（预期新增）。
- `app/(admin)/admin/(protected)/todos/**`（预期新增）。
- `app/components/admin/todos/**`（预期新增）。
- 仅为 todos admin 事务/审计必要的 `app/lib` 窄接口。
- todos admin unit/integration/E2E tests（预期新增）。

### 只读参考或兼容性保护

- `app/lib/db.ts`、`app/lib/types.ts`。
- `app/api/todos/**`、`app/(app)/**`：不得改。
- `tests/e2e/todos-flow.spec.ts`：既有回归。

### 禁止修改

- `app/lib/db/schema.ts`、`drizzle/**`。
- 共享 provider/policy/audit 基础文件；customers/system-config/conversations 实现。
- 旧 todos API/PWA、多租户、批量/实时能力、外部仓库与 XML。

## 6. 依赖项与 DAG

- 前置：`TASK-REFINE-ADM-002`、`003`、`004`。
- 可与 `TASK-REFINE-ADM-005`、`007` 并行，目录和 resource contract 互不重叠。
- 完成后为 `TASK-REFINE-ADM-008` 提供 todos 资源完成信号。

## 7. 前端 / 后端 / 联调边界

- 后端：admin routes、todos adapter、RBAC、zod/error/audit 调用。
- 前端：list/show/create/edit、filters/sorters、角色动作与错误体验。
- 联调：provider mapping、直调 deny、mutation→audit、旧 todos 回归。
- 验收：后端 API/RBAC/audit，前端页面，联调 happy/failure 闭环。

## 8. 测试策略

### Happy path

- admin list/show/create/update/delete 成功；update 后页面展示新状态并可通过 requestId
  找到脱敏 audit。

### Failure path

- operator/auditor delete 403；非法 priority/status、未知 sort/filter 或越界分页拒绝；
  audit insert 失败时业务 mutation 不提交。

### 最小验证

- todos contract/policy unit tests。
- API integration：五个 action、分页/白名单、401/403/404/409/422/5xx。
- admin E2E：happy update + audit、operator delete deny。
- `tests/e2e/todos-flow.spec.ts` 回归；受影响 lint。

## 9. 完成标志

- [ ] 五个 API action 与四类页面按统一合同工作。
- [ ] RBAC 与 direct-call deny 有测试，未知 query/body fail-closed。
- [ ] mutation audit 脱敏且 failure 不静默提交。
- [ ] 旧 todos API/PWA/E2E 行为不变。
- [ ] 未触碰 schema/migration、共享基础或其他 resources。
- [ ] 完成信号包含测试结果与 `008` 可引用的 audit 闭环证据。

## 10. 非目标

- 批量操作、实时订阅、多租户、行级权限或新 Todo 字段。
- 修改旧 todos route/page、复制表或改共享 provider/policy/audit。
- 为 delete 创建独立页面。

## 11. 风险、阻塞与回退

- 风险：非法 enum/sort 进入现有查询。Owner：后续执行 owner；action：在 admin
  contract 层白名单拒绝并覆盖 failure tests。
- 阻塞：共享 audit/transaction 接口不足。Owner：`TASK-REFINE-ADM-004` 后续执行
  owner；action：回流窄接口，不复制审计逻辑。
- 回退：canary 失败时关闭 todos mutation/入口，保留 additive schema/audit；不得改动
  或回滚旧 PWA 数据路径。
