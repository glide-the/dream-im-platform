# `TASK-REFINE-ADM-006` 已填充提示词

> 基础模板：`docs/task/TASK-REQUIREMENT-FORMAT.md`
> 这是生成提示词，不是正式任务文档。

Optimized Prompt:

仅依据 `REFINE-ADM-006` 与设计 §3.1、§5.1、§5.3–§5.5，生成
`docs/task/task_006_full-stack_todos_admin_resource.md`。

- Task ID：`TASK-REFINE-ADM-006`；domain/上游类型：`full-stack`；P0。
- 唯一规划主责：`TaskDesignAgent`；具体执行 owner 后续绑定。
- 前置：`002`、`003`、`004`；可与 `005/007` 并行。
- 输出：受保护 todos list/show/create/update/delete API 与 list/show/create/edit UI；
  三角色可读，operator/admin 可 create/update，仅 admin delete。
- 复用 `listTodos/getTodoById/createTodo/updateTodo/deleteTodo`；白名单 title、
  description、priority、status 与既有 query；旧 todos API/PWA 不改。
- 禁止 schema/migration、共享基础、批量/实时/多租户或其他 resource。
- Happy path：admin update 后页面生效并可查 sanitized audit。
- Failure path：operator delete 403、非法 enum/sort/filter 拒绝、audit failure 不提交。
- 输出必须包含 API/UI/联调边界、todos E2E 回归、完成信号与回退。

Optional Enhancers:

- 让非法 enum 与未知 query 在调用现有查询函数前 fail closed。
