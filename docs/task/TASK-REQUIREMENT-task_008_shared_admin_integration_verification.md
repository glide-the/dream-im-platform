# `TASK-REFINE-ADM-008` 已填充提示词

> 基础模板：`docs/task/TASK-REQUIREMENT-FORMAT.md`
> 这是生成提示词，不是正式任务文档。
> 增量来源：[`SUO-341 plan revision 1`](/SUO/issues/SUO-341#document-plan) →
> [SUO-345](/SUO/issues/SUO-345) → [SUO-346](/SUO/issues/SUO-346)。

Optimized Prompt:

仅依据 `REFINE-ADM-008` 与设计 §5.9、§6、§7、§11–§12、`DEC-011`–`DEC-015`，
增量更新 `docs/task/task_008_shared_admin_integration_verification.md`。

- Task ID：`TASK-REFINE-ADM-008`；domain/上游类型：`shared`；P0。
- 唯一规划主责：`TaskDesignAgent`；具体执行 owner 后续绑定。
- 前置：`001`–`007` 全部完成，并消费 `000` 暴露模型；这是唯一收口 gate。
- 输出：`AC-001`–`AC-016` 证据矩阵、unit/integration/E2E/PWA 回归、secret/audit
  failure 结果和明确 `internal-only` 说明。
- Happy path：admin 登录→浏览→修改 resource→查看对应 audit。
- Failure path：未登录 401/跳转、operator direct mutation 403、非法白名单拒绝、audit
  failure 不提交、secret/`extras` 不泄露。
- 若 `000` 选择 public，独立全服务安全 blocker 未完成时必须 `[BLOCKED] public-ready`；
  不得把 admin API 安全描述为全 PWA 安全。
- 只允许测试、fixture、最小 Playwright config 与既有发布说明；禁止补产品功能、改
  上游合同、stage/exec、延期域或旧 API 全面重构。
- 增量变化：补齐 build/SSR/navigation、`meta.total`/`HttpError`、requestId→audit、
  additive migration、staging backup/apply、flag-off、只读 canary、逐资源 mutation、
  非破坏回滚与延期域“不实现也不验证”证据；不得加入工期承诺。
- 输出完整依赖矩阵，明确 `000/001` 可并行、`003` 的条件并行、`005/006/007` 的资源
  并行和所有 hard blocker。
- 验证命令至少包含 `pnpm lint`、`pnpm test:run`、单独 integration、`pnpm test:e2e`、
  migration/secret 检查和 `git diff --check`；输出必须分开后端/前端/联调，列出证据、
  完成信号、owner/action 与回流条件。

Optional Enhancers:

- 用 requestId 将 E2E mutation、API 响应和 audit record 关联成可审查证据链。
