# Admin Story Workspace Artifact 数据域

## Prompt Architect

Optimized Prompt:

在 `ink-admin-memory` 中实现 Story Workspace Artifact 的唯一数据库访问服务。基于已确认的 Dream 生产调用，增加严格 Zod DTO、应用 Service、typed Drizzle Repository、薄 Handler、Operation Registry capability、原始写回执和确定性测试。提供按当前 OAuth 主体过滤的 Run 分页、单 Run authority、Episode authority 幂等建立、output-ready 状态推进、Story Index 检查、turn 完成态 materialize 与带 ETag 的人工 reconcile。Admin 必须派生用户、Workspace、Thread、source message、Story ID、事务与权限；输入不得包含任意用户 ID、表列、SQL、数据库路径或文件路径。Dream 继续读取和写入共享文件、计算规范化 Artifact 投影、执行 Agent Runtime、SSE、EventBus 与本地 Episode registry。所有写操作在同一个 Admin UOW 中提交领域写、operation receipt 和 audit；未知提交结果用原 request ID 查询原始 receipt，禁止盲目重试。复用现有 unified schema capability，不新增 migration；如果现有 schema 不足则 fail closed。

验收必须证明：DTO 拒绝额外字段；Repository 只使用 Drizzle schema；OAuth 和 Thread/Run delegation 都按服务端主体过滤；Episode CAS 可重放且冲突失败；output-ready 只执行 `running → output_validating → pending_review`；Story Index 维持稳定 Project identity、revision CAS、发布回退与幂等状态；Registry184 前缀不变，新操作按顺序追加；类型检查、lint、单元/契约测试通过。

Optional Enhancers:

- 在具名隔离 PostgreSQL 中补充锁竞争、receipt COMMIT 丢失与 ETag 并发验证。
- 将 capability JSON 与 Dream Pydantic DTO 做自动 parity 检查。

## 背景与问题

Dream 仍在 Story Workspace 的 Run authority、launch metadata、Episode identity、生命周期和 `story_workspace_stories` 索引路径直接执行 SQL。文件投影与 PostgreSQL 事务混在同一服务内，违反 Admin 唯一数据库访问边界。

## 目标与边界

Admin 新增 Registry185–191：

| Registry | 操作 | 类型 | 事务与重放 |
| --- | --- | --- | --- |
| 185 | `story-workspace-artifact.runs` | read | actor-scoped keyset page |
| 186 | `story-workspace-artifact.authority` | read | 单 Run、完整 provenance 校验 |
| 187 | `story-workspace-artifact.episode-authority.ensure` | write | source message row lock、幂等 authority、receipt |
| 188 | `story-workspace-artifact.output-ready` | write | Run row lock、两步状态事务、receipt |
| 189 | `story-workspace-artifact.index.inspect` | read | 当前规范化投影与 Story row 比较 |
| 190 | `story-workspace-artifact.index.materialize` | write | turn 完成态幂等 upsert、receipt |
| 191 | `story-workspace-artifact.index.reconcile` | write | ETag + row lock CAS、receipt |

共享文件的安全读取、路径规范化、符号链接边界、Episode registry、`.dream` 写入、Runtime 与流式反馈仍由 Dream 执行。接口只接收规范化业务投影，不接收文件路径或正文。

## 概念与规则

- 身份认证来自 Admin OAuth 或 exact Thread/Run delegation；认证成功不授予 Admin 管理权限。
- Repository 从 canonical user、Run 和 source message 派生 author、Workspace、Thread 与 Story identity。
- `runs` 使用 `(created_at DESC, run_id ASC)` keyset；Dream 可分页后叠加本地文件和 live-turn 状态。
- Episode authority 缺失时由 Admin 生成一次；已存在时必须与 Run、Project slug、首个 Episode code 一致。
- output-ready 只接受 `normalized_result_ready=true`，服务端决定状态目标和 transition reason。
- inspect/materialize/reconcile 共享同一投影 DTO。materialize 不要求旧 ETag；reconcile 必须匹配 inspect ETag，并在锁内重新比较。
- Index 更新不得覆盖审核正文；script revision 变化使已发布 Story 回到 draft，并清空 `published_at`。
- Admin 不可用、capability 缺失或权限失败时 Dream 返回明确失败，禁止回退 PostgreSQL。

## 验收与风险

验证命令：针对新增 DTO/Service/Repository/Handler/Registry 的 Vitest，`pnpm typecheck`，受影响文件 ESLint，Registry prefix/hash 测试；Dream 消费方完成后运行 Pydantic/HTTP contract、Story Workspace 回归和生产 DB 关闭扫描。主要风险是旧 launch metadata 的兼容解析、状态并发和索引 ETag 漂移；三者分别由严格兼容校验、行锁/状态版本和锁内 ETag 比较处理。

## 实现结果

- `storyWorkspaceArtifactDto.ts` 定义七个 strict Zod 业务操作；输入不接受 actor、user ID、SQL、表列、事务或文件路径。
- `storyWorkspaceArtifactRepository.ts` 是唯一数据库适配层，使用 Drizzle schema、显式行锁、稳定分页、状态 CAS 与 Story index upsert。
- `storyWorkspaceArtifactService.ts` 负责 OAuth/delegation 权限、业务状态、UOW、receipt/audit 与未知提交恢复边界。
- `storyWorkspaceArtifactHandler.ts` 只解析请求、建立认证事务并调用 Service；共享 Route 与 receipt handler 已接 Registry185–191。
- 现有 unified schema 足以承载该领域，本阶段未新增 migration；Registry184 前缀保持不变，Registry191 全量 SHA 为 `508731c75d4db117d587566f16cab423bd9dc41528a2b60599106623d61e2d58`。

实际验证结果：新增 DTO/Service/registration 与 Claude Plugin prefix 共 4 个文件、9 个测试通过；`pnpm exec tsc --noEmit --incremental false` 与受影响 ESLint 退出 0；`pnpm test:run` 为 274 个文件通过、17 个跳过，2067 个测试通过、36 个跳过；`pnpm build` 完成 DB package、Next.js 16.1.6 TypeScript 与 19 个静态页面构建，退出 0。
