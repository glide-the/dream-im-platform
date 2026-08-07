# `TASK-REFINE-ADM-002` 已填充提示词

> 基础模板：`docs/task/TASK-REQUIREMENT-FORMAT.md`
> 这是生成提示词，不是正式任务文档。
> 增量来源：[`SUO-341 plan revision 1`](/SUO/issues/SUO-341#document-plan) →
> [SUO-345](/SUO/issues/SUO-345) → [SUO-346](/SUO/issues/SUO-346)。

Optimized Prompt:

仅依据 `REFINE-ADM-002` 与设计 §5.1、§5.3–§5.5、§5.8、§12.2、§12.5、
§12.7、`DEC-014`，增量更新 `docs/task/task_002_shared_admin_auth_rbac.md`。

- Task ID：`TASK-REFINE-ADM-002`；domain/上游类型：`shared`；P0。
- 唯一规划主责：`TaskDesignAgent`；具体执行 owner 后续绑定。
- 前置：`000`、`001`；IdP 未配置时只允许 production fail-closed。
- 输出：server-only identity/session、active member mapping、默认拒绝三档 RBAC、route
  guard、protected layout，以及 `admin_members`、`admin_audit_logs` 的唯一
  schema/generated migration 基座。
- 本 task 独占 `app/lib/db/schema.ts` 与 `drizzle/`；禁止在
  `ensureInitialized()` 加 runtime DDL，禁止延期域表。
- shared 边界分别写明后端、前端、联调和验收；客户端权限不能替代 API guard。
- Happy path：active 三角色映射和允许矩阵通过。
- Failure path：无 session 401，unknown/disabled/无权限 403，未知 resource/action deny。
- 增量变化：明确 401/403 session 语义；migration 只加不删且在 Admin feature flag
  关闭、新表已存在时保持 schema-forward；留下 staging backup/apply、schema snapshot、
  失败停止并从已验证备份恢复的证据要求。
- 验证命令至少包含 `pnpm db:generate`、generated SQL 破坏性语句检查、auth/policy
  unit、route integration 与 `git diff --check`；输出完成信号和 gate owner/action。

Optional Enhancers:

- 用稳定 `AdminIdentity`/`can()` seam 降低与 `003` 并行时的文件冲突。
