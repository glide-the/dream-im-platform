# `TASK-REFINE-ADM-001` 已填充提示词

> 基础模板：`docs/task/TASK-REQUIREMENT-FORMAT.md`
> 这是生成提示词，不是正式任务文档。
> 增量来源：[`SUO-341 plan revision 1`](/SUO/issues/SUO-341#document-plan) →
> [SUO-345](/SUO/issues/SUO-345) → [SUO-346](/SUO/issues/SUO-346)。

Optimized Prompt:

仅依据 `REFINE-ADM-001` 与设计 §2.2–§2.3、§5.1、§12.1、§12.4–§12.7、
`DEC-012`、`DEC-014`、`DEC-015`，增量更新
`docs/task/task_001_frontend_refine_route_shell.md`。

- Task ID：`TASK-REFINE-ADM-001`；domain：`frontend`；上游类型：`tooling`；P0。
- 唯一规划主责：`TaskDesignAgent`；具体执行 owner 后续绑定。
- 前置：无；与 `000` 并行；完成后解锁 `002/003`。
- 范围：锁定 Refine Core 5.x/Next.js Router 7.x，验证 Node `>=20`、Next 16
  build/SSR/navigation、显式 `/admin`、动态 `[id]` 与现有 PWA 路由回归。
- 允许：`package.json`、lockfile、`app/(admin)/admin/**` 最小壳、
  `app/components/admin/AdminProviders.tsx` seam 与相关测试。
- 禁止：React Router、Ant Design/MUI、catch-all、第二个 Query Client、session/RBAC、
  资源 CRUD、schema/migration、旧 PWA/API 与外部文件。
- Happy path：build/SSR/navigation 通过且 `/customers` 不变。
- Failure path：Next 16 spike 失败时留证并回退设计，不擅自改 Next 或路由方案。
- 增量变化：入口在兼容证据完成前默认关闭或仅开发可见；运行失败只撤销未发布的
  依赖/路由变更并回退设计，不以工期或 `next: "*"` 代替证据。
- 验证命令至少包含 `node --version`、依赖树检查、`pnpm build`、admin/PWA 路由 E2E
  和 `git diff --check`；输出必须包含路径状态、完成信号和风险回退。

Optional Enhancers:

- 把 peer 无冲突与运行时兼容分开记录，避免证据升级过度。
