# 定义 admin API 合同与 Refine providers

## 1. 关联 Issue 与任务元数据

- Task ID：`TASK-REFINE-ADM-003`
- 关联 Issue：`REFINE-ADM-003`
- 当前增量同步：[SUO-346](/SUO/issues/SUO-346)
- 权威增量：[`SUO-341 plan revision 1`](/SUO/issues/SUO-341#document-plan)；Issue 合同：
  [SUO-345](/SUO/issues/SUO-345)
- task 阶段控制：[SUO-343](/SUO/issues/SUO-343)
- domain：`shared`
- 上游类型：`shared`
- 优先级：P0
- 标签：`api`、`zod`、`data-provider`、`refine`
- 唯一规划主责：`TaskDesignAgent`
- 后续执行 owner：由 StagePlanner 唯一绑定；本 task 不直接派发。
- Requirement：[TASK-REQUIREMENT-task_003_shared_admin_contracts_providers.md](./TASK-REQUIREMENT-task_003_shared_admin_contracts_providers.md)

## 2. 任务目标

建立 `/api/admin/*` 可复用的 resource allowlist、zod query/body、分页/排序/过滤、统一响应/错误合同，并实现 custom Data/Auth/Access Control Providers。此任务只提供协议与映射基座，不实现具体资源操作。

## 3. 输入与输出

输入：001 的 Refine/路由基线、设计 §5.2/§5.3、现有 `app/app/providers.tsx` QueryClient 生命周期与各领域 list 参数。

输出：

- server contracts、safe response/error helpers、资源/action/sort/filter allowlist 类型。
- Data Provider 的标准 CRUD 与 system-config 单例映射。
- Auth Provider 与 Access Control Provider 的客户端体验适配。
- contract/provider/mock 联调测试。

核心合同：

- List API：`{ data: T[], meta: { page, pageSize, total, totalPages } }` → Refine `{ data: T[], total }`。
- One/create/update/delete API：`{ data: T }`；delete 为 `{ data: { id } }`。
- Error：`{ error: { code, message, details?, requestId } }` → `HttpError`，不得传服务端堆栈或敏感 details。

## 4. 实现步骤

1. 在 `app/lib/admin` 定义 resource/action、分页上下界与稳定 error schema；所有 zod object 对写入默认 strict。
2. 定义 list query 翻译：`page>=1`、`1<=pageSize<=100`，sort/filter 必须由每个 resource 显式注册。
3. 定义同源 `/api/admin/{resource}` 与 `/{id}` 映射；system-config 使用固定 id=`default` 的 GET/PUT 单例映射。
4. 实现 Data Provider，仅允许已注册 resource；未知 resource/action/sort/filter 不得拼接进 URL/SQL。
5. 实现 Auth Provider 的 login/logout/check/onError/getIdentity；401 触发登录，403 保留 session 与当前页。
6. 实现 Access Control Provider，镜像 002 的同一权限矩阵输入；标注其只负责 UI 体验。
7. 挂载 client `AdminProviders`，复用现有 QueryClient 生命周期，不建立第二个全局缓存。
8. 覆盖数据映射和 401/403/404/409/422/429/5xx 的单元/mock smoke。

## 5. 涉及文件路径与修改边界

### 允许修改范围

- 新增：`app/lib/admin/contracts.ts`、窄 response/route helper、`app/components/admin/AdminProviders.tsx` 与 provider 辅助文件、相关测试。
- 修改：`app/components/admin/AdminProviders.tsx` 与 provider 辅助文件；保持 001 的 `children` seam。

### 只读参考

- 只读参考：`app/app/providers.tsx`、`app/lib/client.ts`、现有 API/list params，以及由 002 独占的 protected layout/policy。

### 禁止修改范围

- 具体 resource routes/pages、旧 API、route 内 SQL、secret、chat/Claude 协议、第二套
  UI/QueryClient。

## 6. 依赖项与 DAG

- 前置依赖：`TASK-REFINE-ADM-001`。
- 可与 002 并行定义；任何真实 protected API 验收仍等待 002 guard。
- 与 002 共同解锁 004。
- 005–007 只能消费本 task 已完整声明的各 resource allowlist/contract，不得修改或重写共享基座。

## 7. 前端 / 后端 / 联调边界

- 后端：zod contracts、response/error helpers、allowlist 与 route helper 测试。
- 前端：Data/Auth/Access Providers、filter/sorter 翻译与错误 UX。
- 联调：mock admin API 证明 `{data,meta}`→`{data,total}`、同源 cookie 和状态码行为闭环。

## 8. 测试策略

- Happy path：list/one/create/update/delete 与 system-config 单例映射正确。
- Failure path：未知 resource/action/sort/filter 被拒绝；恶意字段不被转发；403 不触发 logout，401 才触发登录。
- 最小验证命令：
  `pnpm test:run -- app/lib/admin/contracts.test.ts app/components/admin/admin-providers.test.tsx`；
  mock 401/403/404/409/422/429/5xx smoke；`pnpm lint`；
  `git diff --check -- app/lib/admin app/components/admin`。

## 9. 完成标志

- 合同、allowlist、统一错误和 requestId 语义可被 004–007 直接复用。
- Provider 覆盖所有 MVP 方法且不暴露任意 `custom` 代理能力。
- QueryClient 单一生命周期有测试/组件树证据。
- 所有关键状态码行为明确且不泄密。

## 10. 非目标

- 不实现任何 customers/todos/system-config/audit 业务 route 或页面。
- 不把客户端 provider 当作授权权威。
- 不引入第二套 UI、QueryClient 或任意上游代理。

## 11. 风险、阻塞与回退

- 002 未完成时只能用 mock 验证，不能宣称 protected API 已交付。
- 若 Refine 实际类型与设计映射冲突，保留 API 合同并回到 001/设计评估，不改旧 API 迎合 provider。
