# 验证 Refine 兼容性并建立隔离路由壳

## 1. 关联 Issue 与任务元数据

- Task ID：`TASK-REFINE-ADM-001`
- 关联 Issue：`REFINE-ADM-001`
- 当前增量同步：[SUO-346](/SUO/issues/SUO-346)
- 权威增量：[`SUO-341 plan revision 1`](/SUO/issues/SUO-341#document-plan)；Issue 合同：
  [SUO-345](/SUO/issues/SUO-345)
- 稳定 task 基线：[SUO-343](/SUO/issues/SUO-343)
- domain：`frontend`
- 上游类型：`tooling`
- 优先级：P0
- 标签：`refine`、`nextjs`、`app-router`、`routing`
- 唯一规划主责：`TaskDesignAgent`
- 后续执行 owner：由 StagePlanner 唯一绑定；本 task 不直接派发。
- Requirement：[TASK-REQUIREMENT-task_001_frontend_refine_route_shell.md](./TASK-REQUIREMENT-task_001_frontend_refine_route_shell.md)

## 2. 任务目标

锁定 Refine Core 5.x 与 Next.js Router 7.x，在当前 Next.js 16 / React 19 基线上用实际 build、SSR、client navigation 与动态路由 smoke 验证运行兼容性，并建立与现有 PWA 隔离的显式 `/admin` 登录入口和最小壳层。

## 3. 输入与输出

输入：设计 `AC-001`–`AC-003`、`DEC-001`–`DEC-004`、`DEC-012`、`RISK-001`、`RISK-002`；当前 `package.json`、lockfile、根 QueryClient 和 PWA 路由。

输出：

- 锁定版本的 `@refinedev/core` 与 `@refinedev/nextjs-router`，以及 Node `>=20` 的部署约束。
- 最小显式 `/admin` App Router 壳与未受保护的 `/admin/login` 入口。
- build/SSR/navigation/dynamic-route 与既有 PWA 路由回归证据。
- 若 spike 失败：可复现证据和设计回退记录，不留下未经验证的替代路由方案。

## 4. 实现步骤

1. 核对当前 Next/React/TanStack Query/Node 版本并锁定 Refine Core 5.x、Next.js Router 7.x；更新 lockfile。
2. 验证依赖树不含 `@refinedev/react-router`、Ant Design、MUI 或第二个全局 QueryClient。
3. 新建 `app/(admin)/admin/` 显式路由树和 `/admin/login`；不改 `app/(app)`，不使用顶层 catch-all。
4. 建立稳定的 `AdminProviders(children)` client seam；Refine client boundary 不接收 session secret，也不实现真实 auth/resource CRUD。002 只消费该 seam，003 后续扩展其 provider 内容。
5. 用最小、非业务动态 smoke 路由或测试夹具验证 Refine `:id` 与 Next `[id]` 解析；实证完成后不得将临时入口加入正式导航。
6. 在兼容证据完成前保持 Admin 入口默认关闭或仅开发可见；不得把 feature flag 当作
   runtime 兼容或 public 安全证据。
7. 运行 build、SSR 与 client navigation smoke，验证 `/`、`/customers` 和未知 PWA 路由未被接管。
8. 记录 spike 版本、命令、结果与限制；明确 `UnsavedChangesNotifier` 不属于本期验收。

## 5. 涉及文件路径与修改边界

### 允许修改范围

- 修改：`package.json`、`pnpm-lock.yaml`。
- 新增：`app/(admin)/admin/login/**`、最小 `/admin` 壳、
  `app/components/admin/AdminProviders.tsx` client seam、对应路由/编译测试。

### 只读兼容保护

- `app/(app)/layout.tsx`、`app/app/providers.tsx`、`tests/e2e/customers-flow.spec.ts`。

### 禁止修改范围

- 旧业务 API、`chat-schema.ts`、`claude-agent-kit/**`、`drizzle/**`、
  `ink-admin-memory-output.xml`。

## 6. 依赖项与 DAG

- 前置依赖：无。
- 可与 `TASK-REFINE-ADM-000` 并行。
- 完成后解锁 `TASK-REFINE-ADM-003`；与 000 一起解锁 `TASK-REFINE-ADM-002`。

## 7. 前端 / 后端 / 联调边界

- 前端：唯一实现主体，拥有依赖 spike、路由壳和导航验证。
- 后端：无业务实现；只确认 server/client boundary 可编译，不接入 session 或 API。
- 联调：验证壳位于现有 Provider 树的预期位置且不产生第二个 QueryClient；真实 auth 留给 002。

## 8. 测试策略

- Happy path：`/admin` 与 `/admin/login` 可构建/渲染/导航，动态参数解析正确。
- Failure path：未知或旧 PWA 路由不被 Refine catch-all 吞没；不兼容时构建失败证据可复现。
- 最小验证命令：`node --version`；
  `pnpm why @refinedev/core @refinedev/nextjs-router @tanstack/react-query`；
  `pnpm lint`；`pnpm build`；
  `pnpm exec playwright test tests/e2e/admin-shell.spec.ts tests/e2e/customers-flow.spec.ts`；
  `git diff --check -- package.json pnpm-lock.yaml app tests/e2e`。

## 9. 完成标志

- 依赖版本与 Node engine 约束已锁定。
- build、SSR、client navigation、动态路由 smoke 均有结果。
- 现有 PWA 路由无接管/重定向回归。
- 未引入第二套 UI、路由库或 QueryClient。

## 10. 非目标

- 不实现 session、RBAC、admin API、resource CRUD 或审计。
- 不借兼容失败升级/降级 Next 或重构现有 PWA。

## 11. 风险、阻塞与回退

- `next: "*"` 不是运行兼容保证；以本任务实证为准。
- spike 失败时记录版本、堆栈与最小复现，撤销尚未发布的依赖/路由变更并回退
  DesignArchitect；禁止静默改用 React Router、升级/降级 Next 或重构现有 PWA。
