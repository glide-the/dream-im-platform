# `TASK-REFINE-ADM-004` 已填充提示词

> 基础模板：`docs/task/TASK-REQUIREMENT-FORMAT.md`
> 这是生成提示词，不是正式任务文档。
> 增量来源：[`SUO-341 plan revision 1`](/SUO/issues/SUO-341#document-plan) →
> [SUO-345](/SUO/issues/SUO-345) → [SUO-346](/SUO/issues/SUO-346)。

Optimized Prompt:

仅依据 `REFINE-ADM-004` 与设计 §5.1、§5.3、§5.5、§5.7–§5.8、§12.2、
§12.7、`DEC-011`、`DEC-014`，增量更新
`docs/task/task_004_full-stack_admin_audit_resource.md`。

- Task ID：`TASK-REFINE-ADM-004`；domain/上游类型：`full-stack`；P0。
- 唯一规划主责：`TaskDesignAgent`；具体执行 owner 后续绑定。
- 前置：`002`、`003`；完成后解锁 `005`、`006`、`007`。
- 输出：sanitized audit writer、事务窄接口、只读 list/show API/UI 与测试。
- 事件只含 requestId、actor、resource/action/id、outcome、changed field names、reason；
  不含 body、PII、prompt、secret、`extras`。
- audit failure 必须阻止敏感 mutation；不得修改 `app/lib/db/schema.ts` 或
  `drizzle/`，不得实现具体资源业务或 audit mutation。
- Happy path：允许 mutation 与 success audit 同步可查。
- Failure path：denied/failed 脱敏，audit insert 失败时业务不提交。
- 增量变化：API error 的 `requestId` 必须与 audit `request_id` 脱敏可关联，但不得
  复制 response `details`、请求体或 stack。
- 验证命令至少包含 audit unit、admin audit route integration、事务失败模拟、
  secret-pattern assertion、`pnpm lint` 与 `git diff --check`；输出必须分开后端/前端/
  联调、列出路径和下游稳定接口。

Optional Enhancers:

- 通过 requestId 串联 API、审计与 E2E 证据。
