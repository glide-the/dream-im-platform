# `TASK-REFINE-ADM-005` 已填充提示词

> 基础模板：`docs/task/TASK-REQUIREMENT-FORMAT.md`
> 这是生成提示词，不是正式任务文档。

Optimized Prompt:

仅依据 `REFINE-ADM-005` 与设计 §3.1、§5.1、§5.3–§5.5，生成
`docs/task/task_005_full-stack_customers_admin_resource.md`。

- Task ID：`TASK-REFINE-ADM-005`；domain/上游类型：`full-stack`；P0。
- 唯一规划主责：`TaskDesignAgent`；具体执行 owner 后续绑定。
- 前置：`002`、`003`、`004`；可与 `006/007` 并行。
- 输出：受保护 customers list/show/create/update/delete API 与 list/show/create/edit UI；
  三角色可读，operator/admin 可 create/update，仅 admin delete。
- 复用现有 customers 领域函数；admin contract 不开放 `conversation_id`，不暴露
  conversations；旧 customers API/PWA 不改。
- 禁止 schema/migration、共享 provider/policy/audit 基础和其他 resource。
- Happy path：admin update 后页面生效并可查 sanitized audit。
- Failure path：operator direct DELETE 403；audit failure 时 mutation 不提交。
- 输出必须包含 API/UI/联调边界、customers E2E 回归、完成信号与 PII 风险控制。

Optional Enhancers:

- 用 requestId 连接 update 响应和 audit show，便于 `008` 复用。
