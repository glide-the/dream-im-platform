# `TASK-REFINE-ADM-000` 已填充提示词

> 基础模板：`docs/task/TASK-REQUIREMENT-FORMAT.md`
> 这是生成提示词，不是正式任务文档。
> 增量来源：[`SUO-341 plan revision 1`](/SUO/issues/SUO-341#document-plan) →
> [SUO-345](/SUO/issues/SUO-345) → [SUO-346](/SUO/issues/SUO-346)。

Optimized Prompt:

仅依据 `REFINE-ADM-000` 与 `DESIGN-REFINE-ADMIN-001` §5.4、§5.9、§7.1、
§7.2、§12.3、`DEC-013`，增量更新
`docs/task/task_000_shared_delivery_gates.md`。

- Task ID：`TASK-REFINE-ADM-000`；domain：`shared`；上游类型：`pipeline`；P0。
- 唯一规划主责：`TaskDesignAgent`；具体执行 owner 留给 StagePlanner 唯一绑定。
- 输入：IdP/server-session、稳定 subject、callback 域名、暴露模型的部署事实。
- 前置：无；与 `TASK-REFINE-ADM-001` 可并行。
- 输出：四项结构化决策与 owner/evidence；internal-only 标识或 public 独立 blocker。
- 允许范围：Paperclip Issue 评论与本 task 文档；禁止 `app/**`、`drizzle/**`、
  上游设计/Issue、stage/exec、Repomix XML 与外部仓库。
- Happy path：成熟 IdP + callback + internal-only 均确认并可被 `002/008` 引用。
- Failure path：IdP 未决时 production fail-closed；public 时没有独立 blocker 不得
  public-ready。
- 增量变化：用户中心、Story、Provider/Model Registry、计费/额度/限流、Proxy
  Gateway 继续延期且不得预留 schema/route/provider 转发；Admin feature flag 不得绕过
  public 的全服务安全 blocker。
- 必须写明步骤、输入/输出、依赖边、非目标、验证命令或可审计方式、完成信号、
  owner/action 与回退，并用 `git diff --check -- docs/task/` 收口文档质量。

Optional Enhancers:

- 用固定字段名记录决策，便于 StagePlanner 检查 gate，而不把默认假设写成事实。
