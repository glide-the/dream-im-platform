# `TASK-REFINE-ADM-003` 已填充提示词

> 基础模板：`docs/task/TASK-REQUIREMENT-FORMAT.md`
> 这是生成提示词，不是正式任务文档。
> 增量来源：[`SUO-341 plan revision 1`](/SUO/issues/SUO-341#document-plan) →
> [SUO-345](/SUO/issues/SUO-345) → [SUO-346](/SUO/issues/SUO-346)。

Optimized Prompt:

仅依据 `REFINE-ADM-003` 与设计 §5.2、§5.3、§12.2、§12.4、§12.7、
`DEC-011`，增量更新 `docs/task/task_003_shared_admin_contracts_providers.md`。

- Task ID：`TASK-REFINE-ADM-003`；domain/上游类型：`shared`；P0。
- 唯一规划主责：`TaskDesignAgent`；具体执行 owner 后续绑定。
- 前置：`001`；可与 `002` 并行定义，真实 protected API 验收等待 `002`。
- 输出：resource allowlist、zod query/body/response、分页/sort/filter 白名单、统一
  error，以及 Data/Auth/Access Control providers。
- list 必须将 API `{ data, meta.total }` 映射为 Refine `{ data, total }`；错误只暴露
  白名单 `code/message/requestId/details` 并映射 `HttpError.statusCode`；401、403、404、
  409、422、429、5xx 分别处理且不泄密。
- 允许 `app/lib/admin/contracts.ts`、单职责 helper、`AdminProviders`/provider 组件与测试；
  禁止具体 resource、SQL、schema/migration、旧 API、secret、任意代理或第二套缓存。
- Happy path：标准 CRUD 与单例方法映射正确。
- Failure path：越界分页/未知 resource/action/sort/filter 在领域查询前拒绝。
- 验证命令至少包含 contracts/provider unit、mock 状态码测试、`pnpm lint` 与
  `git diff --check`；输出必须分开后端/前端/联调边界并给出可供 `004` 消费的稳定导出。

Optional Enhancers:

- 用 mock API 验证 provider，不提前制造具体 resource 实现。
