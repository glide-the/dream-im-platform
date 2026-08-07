# 交付 customers 管理资源

## 1. 关联 Issue 与任务元数据

- Task ID：`TASK-REFINE-ADM-005`
- 关联 Issue：`REFINE-ADM-005`
- 设计来源：`DESIGN-REFINE-ADMIN-001` §3.1、§5.1、§5.3–§5.5
- domain：`full-stack`
- 上游类型：`full-stack`
- 优先级：P0
- 标签：`customers`、`crud`、`rbac`、`admin-api`
- 唯一规划主责：`TaskDesignAgent`
- 后续执行 owner：由 StagePlanner 唯一绑定；本 task 不直接派发。
- Requirement：[TASK-REQUIREMENT-task_005_full-stack_customers_admin_resource.md](./TASK-REQUIREMENT-task_005_full-stack_customers_admin_resource.md)

## 2. 任务目标

在受保护的 `/api/admin/customers` 与 `/admin/customers` 上交付 customers 的
list/show/create/update，以及仅 admin 可执行的 delete；复用现有领域/DB 能力，
不改变旧 PWA customers 行为，不暴露 conversations。

## 3. 输入与输出

### 输入

- `TASK-REFINE-ADM-002` 的 identity/policy/guard。
- `TASK-REFINE-ADM-003` 的 contracts/providers/error mapping。
- `TASK-REFINE-ADM-004` 的 audit/transaction 窄接口。
- 现有领域锚点：`listCustomers`、`getCustomerById`、`createCustomer`、
  `updateCustomer`、`deleteCustomer`；`createCustomerWithConversationLink` 只读参考，
  admin contract 不开放 `conversation_id`。

### API/UI 输出

- `GET/POST /api/admin/customers` 与
  `GET/PATCH/DELETE /api/admin/customers/{id}`。
- list/show 对 auditor/operator/admin 开放；create/update 对 operator/admin 开放；
  delete 仅 admin。
- `/admin/customers` 的 list/show/create/edit；delete 是受 RBAC 控制的 action，无
  独立页面。
- 每个允许、拒绝或失败的 mutation 使用共享 sanitized audit writer。

## 4. 实现步骤

### 后端

1. 基于 `003` 为 customers 声明 query/body/sort/filter 白名单；只开放既有
   Customer 领域字段，排除 `conversation_id`、server-managed id/timestamps 与未知字段。
2. 建立 customers admin 领域 adapter/窄接口，复用 `app/lib/db.ts` 现有函数；不得在
   Route Handler 写 Drizzle、复制表或改旧 API。
3. 实现 list/show/create/update/delete admin routes：解析→zod→session→permission→
   domain→audit→统一 response。
4. 精确执行角色矩阵；在 UI 之外直接 DELETE 时，auditor/operator 必须 403。
5. 为 update/delete 的不存在资源返回 404，为可识别的并发/重复冲突返回 409；5xx
   只返回通用信息和 requestId。
6. 将允许、拒绝、validation failed 与领域失败 mutation 写为 sanitized audit；敏感
   值不进入 `changed_fields`，audit failure 阻止 mutation 提交。

### 前端

7. 使用共享 Data/Access Control Provider 实现 list/show/create/edit 页面与表单。
8. 根据角色隐藏或禁用动作，但保留 403/404/409/5xx 的明确、非泄密反馈。
9. 展示业务所需联系方式时遵循最小字段范围；不得追加 conversations、消息或附件。

### 联调与验收

10. 完成 admin 登录→更新 customer→查看 audit 的资源级 happy path。
11. 完成 operator 直调 delete 403 的 failure path，并回归既有 customers PWA/E2E。

## 5. 涉及文件路径与修改边界

### 允许修改

- `app/api/admin/customers/**`（预期新增）。
- `app/(admin)/admin/(protected)/customers/**`（预期新增）。
- `app/components/admin/customers/**`（预期新增）。
- 仅为 customers admin 事务/审计所需的 `app/lib` 窄接口。
- customers admin unit/integration/E2E tests（预期新增）。

### 只读参考或兼容性保护

- `app/lib/db.ts`、`app/lib/types.ts`：复用既有领域类型/函数。
- `app/api/customers/**`、`app/(app)/customers/**`：不得改，作为回归基线。
- `tests/e2e/customers-flow.spec.ts`：既有 PWA 回归。

### 禁止修改

- `app/lib/db/schema.ts`、`drizzle/**`。
- 共享 provider/policy/audit 基础文件；若接口不足，先回流到其 owner，不在本 task
  私自分叉。
- `app/api/customers/**`、`app/(app)/customers/**` 现有合同/体验。
- conversations API/UI、用户 ownership、多租户字段、外部仓库与 XML。

## 6. 依赖项与 DAG

- 前置：`TASK-REFINE-ADM-002`、`003`、`004`。
- 可与 `TASK-REFINE-ADM-006`、`007` 并行；三者拥有互不重叠的 route/page/component
  目录，均不得修改共享 schema/provider/policy/audit 基础。
- 完成后为 `TASK-REFINE-ADM-008` 提供 customers 资源完成信号。

## 7. 前端 / 后端 / 联调边界

- 后端：admin routes、customers adapter、RBAC、zod/error/audit 调用。
- 前端：list/show/create/edit、角色动作与错误体验。
- 联调：provider 映射、server direct-call deny、mutation→audit、旧 PWA 回归。
- 验收：后端证明 API/RBAC/audit；前端证明页面；联调证明完整 happy/failure path。

## 8. 测试策略

### Happy path

- admin list/show/create/update/delete 均按合同返回；至少一次 update 后可用 requestId
  查到 changed field names 的 audit，且页面显示更新结果。

### Failure path

- operator/auditor 直调 DELETE 返回 403；未知 sort/filter 被拒绝；不存在 id 404；
  audit insert 失败时 mutation 不提交。

### 最小验证

- customers admin contract/policy unit tests。
- API integration：list/show/create/update/delete、分页、白名单、401/403/404/409/5xx。
- admin resource E2E：happy update + audit、operator delete deny。
- `tests/e2e/customers-flow.spec.ts` 回归；受影响 lint。

## 9. 完成标志

- [ ] 五个 API action 与四类页面按统一合同工作。
- [ ] 三角色 read、operator/admin write、admin-only delete 均有直调 API 证据。
- [ ] mutation 的 success/denied/failed audit 均脱敏，audit failure 不静默提交。
- [ ] 旧 customers API/PWA/E2E 行为不变。
- [ ] 未触碰 schema/migration、共享基础或 conversations。
- [ ] 完成信号包含测试结果与 `008` 可引用的 requestId/audit 闭环证据。

## 10. 非目标

- conversations、消息/附件、普通用户 ownership、多租户或批量导入导出。
- 修改旧 customers route/page，复制 customers 表或改通用 provider/policy/audit。
- 为 delete 创建独立 Refine 页面。

## 11. 风险、阻塞与回退

- 风险：客户联系方式造成 PII 泄露。Owner：后续执行 owner；action：最小字段、RBAC、
  audit 只记字段名并覆盖响应/日志扫描。
- 阻塞：共享 transaction/audit 接口不能满足一致性。Owner：`TASK-REFINE-ADM-004`
  后续执行 owner；action：回流窄接口，不在本 task 绕过。
- 回退：资源 canary 失败时关闭 customers mutation/入口，保留 additive schema 与 audit
  证据；不回滚旧 PWA 数据或删除表。
