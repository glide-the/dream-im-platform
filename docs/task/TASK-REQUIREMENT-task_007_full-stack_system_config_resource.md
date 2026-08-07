# `TASK-REFINE-ADM-007` 已填充提示词

> 基础模板：`docs/task/TASK-REQUIREMENT-FORMAT.md`
> 这是生成提示词，不是正式任务文档。
> 增量来源：[`SUO-341 plan revision 1`](/SUO/issues/SUO-341#document-plan) →
> [SUO-345](/SUO/issues/SUO-345) → [SUO-346](/SUO/issues/SUO-346)。

Optimized Prompt:

仅依据 `REFINE-ADM-007` 与设计 §5.1–§5.3、§5.5–§5.7、§12.3、§12.5、
§12.7、`DEC-013`、`DEC-014`，增量更新
`docs/task/task_007_full-stack_system_config_resource.md`。

- Task ID：`TASK-REFINE-ADM-007`；domain/上游类型：`full-stack`；P0。
- 唯一规划主责：`TaskDesignAgent`；具体执行 owner 后续绑定。
- 前置：`002`、`003`、`004`；可与 `005/006` 并行。
- 输出：单例 GET/PUT 与 settings show/edit，id 固定 `default`；三角色可读，仅 admin
  在确认后更新 `system_prompt/model/provider/workspace_enabled`。
- response/body 使用 strict projection；`theme`、`extras`、secret 不进入 contract、UI、
  响应、日志或 audit；旧 `/api/system-config` 不改。
- 禁止 schema/migration、Model Registry、价格/密钥轮换、create/delete 与共享基础。
- Happy path：admin 确认 PUT 后刷新生效并查到只含字段名的 audit。
- Failure path：operator PUT 403、未知字段拒绝、audit failure 时配置不更新。
- 增量变化：只读 canary 先行；customers/todos mutation 稳定后才以独立 feature gate
  最后开放 system-config mutation；回退先关 mutation/入口并保留审计与新增表。
- 验证命令至少包含 strict projection/policy/audit unit、GET/PUT integration、admin 与
  operator E2E、secret-pattern assertion、`pnpm lint` 与 `git diff --check`；输出必须包含
  后端/前端/联调边界、完成信号和澄清回退。

Optional Enhancers:

- 将 response projection 独立测试，防止未来类型扩展意外泄露 `extras`。
