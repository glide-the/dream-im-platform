# Task Requirement Prompt Template

> 用途：TaskDesignAgent 在生成正式 task 文档前，先复制本模板并完整填入一条 Issue 的事实字段。
> 本文件是 Prompt Template，不是最终任务文档。

Optimized Prompt:

你是资深软件交付任务设计师。请仅依据下方已填充的 Issue、设计证据与仓库约束，生成一份可由 StagePlanner 直接消费的 Markdown 任务文档。不得实现代码、不得编排 stage、不得扩展上游设计范围。

必须保留并明确：

1. Task ID、标题、关联 Issue、domain、优先级、标签、唯一主责。
2. 任务目标、输入、前置依赖、允许与禁止修改范围。
3. 按顺序可执行的实现步骤、前端/后端/联调边界（适用于 shared/full-stack）、非目标。
4. 输入/输出合同、happy path、至少一个 failure path、最小验证命令或方式。
5. StagePlanner 可读取的依赖边、并行条件、完成信号、回退/澄清条件与风险。
6. API Route Handler 只做解析、zod 校验、鉴权与编排；领域和 DB 逻辑留在 `app/lib/**`。
7. `app/lib` 保持稳定；schema 只在 `app/lib/db/schema.ts` 或既有 `app/lib/db/**` 维护。

输出章节固定为：

1. 任务标题
2. 关联 Issue 与任务元数据
3. 任务目标
4. 输入与输出
5. 实现步骤
6. 涉及文件路径与修改边界
7. 依赖项与 DAG
8. 前端 / 后端 / 联调边界
9. 测试策略
10. 完成标志
11. 非目标
12. 风险、阻塞与回退

Optional Enhancers:

- 对计划新增路径标注“新增”，对现有锚点标注“只读参考”或“兼容性保护”。
- 对条件性 blocker 写出 owner、触发条件和 unblock action，不把默认假设伪装为已确认事实。

USER REQUIREMENT:

对 Refine 管理后台 MVP 的 9 份既有 task 文档执行增量同步，覆盖
`REFINE-ADM-000` 至 `REFINE-ADM-008`，但只改动已确认增量实际影响的文档。权威输入为：

- `docs/issue/ISSUES_refine_admin_mvp.md`
- `docs/design/refine-admin-validated-architecture.md`
- 权威增量：[`SUO-341 plan revision 1`](/SUO/issues/SUO-341#document-plan)，
  revisionId=`81c35c47-83c8-4e15-a3cf-e3e1e7f3e80f`
- 已完成 Issue 合同：[SUO-345](/SUO/issues/SUO-345)
- 当前增量同步 Issue：[SUO-346](/SUO/issues/SUO-346)
- 稳定规划基线：[SUO-343](/SUO/issues/SUO-343)
- 代码基线：当前 `ink-admin-memory` checkout

## 增量同步处置

| Task | 本次变化 | 处置 |
|---|---|---|
| `000` | 延期安全域不得预留；feature flag 不得绕过 public blocker | 更新 requirement 与 task |
| `001` | Node `>=20`；Next 16 build/SSR/client navigation/PWA runtime spike；失败回退 | 更新 requirement 与 task |
| `002` | 401/403 语义；additive migration；flag-off schema-forward；staging/恢复证据 | 更新 requirement 与 task |
| `003` | `{ data, meta.total } -> { data, total }`；`requestId`/`HttpError`；422/429 | 更新 requirement 与 task |
| `004` | API `requestId` 与 audit `request_id` 的脱敏关联证据 | 更新 requirement 与 task |
| `005` | 既有合同已覆盖增量 | 稳定保留，不改文档 |
| `006` | 既有合同已覆盖增量 | 稳定保留，不改文档 |
| `007` | system-config mutation 最后开放；secret/Registry 延期；feature-gated rollback | 更新 requirement 与 task |
| `008` | runtime、错误/requestId、迁移/canary/rollback 与延期域证据矩阵 | 更新 requirement 与 task |

只在受影响文档中列本次新增或变化项，不重写稳定 Task ID、domain、主责、资源边界、
依赖和既有验收。不得修改 `005/006` 的 requirement 或 task 文档。

## 输出矩阵

| Task ID | Issue | domain | 输出文件 |
|---|---|---|---|
| `TASK-REFINE-ADM-000` | `REFINE-ADM-000` | `shared` | `docs/task/task_000_shared_delivery_gates.md` |
| `TASK-REFINE-ADM-001` | `REFINE-ADM-001` | `frontend` | `docs/task/task_001_frontend_refine_route_shell.md` |
| `TASK-REFINE-ADM-002` | `REFINE-ADM-002` | `shared` | `docs/task/task_002_shared_admin_auth_rbac.md` |
| `TASK-REFINE-ADM-003` | `REFINE-ADM-003` | `shared` | `docs/task/task_003_shared_admin_contracts_providers.md` |
| `TASK-REFINE-ADM-004` | `REFINE-ADM-004` | `full-stack` | `docs/task/task_004_full-stack_admin_audit_resource.md` |
| `TASK-REFINE-ADM-005` | `REFINE-ADM-005` | `full-stack` | `docs/task/task_005_full-stack_customers_admin_resource.md` |
| `TASK-REFINE-ADM-006` | `REFINE-ADM-006` | `full-stack` | `docs/task/task_006_full-stack_todos_admin_resource.md` |
| `TASK-REFINE-ADM-007` | `REFINE-ADM-007` | `full-stack` | `docs/task/task_007_full-stack_system_config_resource.md` |
| `TASK-REFINE-ADM-008` | `REFINE-ADM-008` | `shared` | `docs/task/task_008_shared_admin_integration_verification.md` |

## 全局合同

- 当前 MVP 默认 `internal-only`。若决定 public，必须另建并前置“全服务认证 +
  数据 ownership/行级授权 + 旧 API 加固” blocker，不得扩大本期 MVP。
- `TASK-REFINE-ADM-000` 保留 IdP/server-session、稳定
  `identity_subject`、callback 域名、internal-only/public 四项决策字段。
- `TASK-REFINE-ADM-002` 开始实际身份接入前必须消费上述 gate；未配置
  IdP 时 production admin route fail-closed，不得自建密码学或开发旁路。
- `TASK-REFINE-ADM-002` 独占 `app/lib/db/schema.ts` 与 `drizzle/` 的 admin
  schema/migration 修改；只新增 `admin_members`、`admin_audit_logs`，不得在
  `ensureInitialized()` 复制 runtime DDL。
- `/admin` 使用显式 App Router 页面和独立 layout；Refine 仅采用 Core 5.x、
  Next.js Router 7.x、现有 Tailwind/组件与 Query Client。禁止 catch-all、React
  Router、Ant Design/MUI 和第二套 Query Client。
- Refine provider 不是安全边界；protected server layout 与每个
  `/api/admin/*` route 均须服务端 fail-closed。
- Route Handler 只做请求解析、zod、session/RBAC、`app/lib` 调用、审计编排和
  统一响应；customers/todos/system-config 复用现有表与领域函数。
- 审计只读、不可变且脱敏；敏感变更必须满足“审计失败则变更失败”。
- 禁止修改 `ink-admin-memory-output.xml`、`ink-dream-memory`、
  `story-workspace`；禁止把 conversations、用户/多租户、Story、模型注册、
  密钥轮换、计费、额度、网关等延期域带入本期。
- `TaskDesignAgent` 是所有 task 文档的唯一规划主责；shared/full-stack 文档中
  分开写明后端、前端、联调和验收边界。具体执行 owner 由 StagePlanner 后续
  唯一绑定，本阶段不直接指派 StagePlanner 或 ExecTaskAgent。

## Issue 摘要

1. `REFINE-ADM-000`（pipeline/P0）：收敛 IdP/server-session 与暴露模型；无
   决策时阻止生产身份接入，public 时触发独立安全 blocker。
2. `REFINE-ADM-001`（tooling/P0）：锁定 Refine Core 5.x 与 Next.js Router
   7.x，验证 Node `>=20`、Next 16 build/SSR/navigation、动态 `[id]` 和 PWA
   路由隔离；失败时回退设计评估，不改用 React Router。
3. `REFINE-ADM-002`（shared/P0）：交付 server-only identity/session、三档
   RBAC、protected layout，以及两张 admin 表的唯一 schema/generated
   migration 基座；401/403 与未知 action/resource 默认拒绝。
4. `REFINE-ADM-003`（shared/P0）：交付 resource allowlist、zod
   query/body/response、分页/sort/filter 白名单、统一错误，以及
   Data/Auth/Access Control providers；list 将 API `meta.total` 映射为 Refine
   顶层 `total`，不实现具体资源业务。
5. `REFINE-ADM-004`（full-stack/P0）：交付 sanitized audit writer、只读
   audit list/show API 与 UI、事务一致性；不得修改 schema/migration。
6. `REFINE-ADM-005`（full-stack/P0）：交付 customers admin
   list/show/create/update/delete API 与 list/show/create/edit UI；delete 仅
   admin；mutation 调共享 audit；旧 PWA/API 不变。
7. `REFINE-ADM-006`（full-stack/P0）：交付 todos admin
   list/show/create/update/delete API 与 list/show/create/edit UI；delete 仅
   admin；mutation 调共享 audit；旧 PWA/API 不变。
8. `REFINE-ADM-007`（full-stack/P0）：交付 system-config 单例 GET/PUT 和
   settings show/edit；只开放 `system_prompt`、`model`、`provider`、
   `workspace_enabled`，PUT 仅 admin，并有确认与审计；排除 `theme`、
   `extras`、secret。
9. `REFINE-ADM-008`（shared/P0）：覆盖 `AC-001`–`AC-016` 的 unit、
   integration、E2E、secret 与 PWA 回归；happy path 为 admin 登录→修改→查看
   audit，failure path 至少包含 operator delete 或未登录 API 的 401/403；
   最终明确 `internal-only`，public 前置不完整时保持条件阻塞。

## 必须保留的 DAG

```text
TASK-REFINE-ADM-000 ─┐
                    ├─> TASK-REFINE-ADM-002 ─┐
TASK-REFINE-ADM-001 ─┼─> TASK-REFINE-ADM-003 ─┼─> TASK-REFINE-ADM-004 ─┬─> TASK-REFINE-ADM-005 ─┐
                    │                        │                        ├─> TASK-REFINE-ADM-006 ─┼─> TASK-REFINE-ADM-008
                    │                        │                        └─> TASK-REFINE-ADM-007 ─┘
                    └────────────────────────┘
```

`000` 与 `001` 可并行；`003` 可在 `002` 的 IdP 实现期间并行定义合同与
providers，但受保护 API 验收仍须等待 `002`；`005`、`006`、`007` 在共同依赖
完成后可并行且不得修改共享 provider/policy/audit/schema 基础文件；`008` 是唯一
收口 gate。

## 文档质量要求

- 每份文档必须列出 Task ID、Issue、domain、上游类型、优先级、标签、唯一主责、
  输入、依赖、允许/禁止范围、步骤、非目标、可判定验收、happy/failure 验证、
  预期输出、依赖边、完成信号、风险、阻塞、owner/action 与回退条件。
- 计划新增路径标记为“预期新增”；现有路径标记为“现有锚点/只读参考/兼容性保护”。
- 不写实现代码、工期、stage 波次或直接 Agent 派发。
- 最终检查 9 条 Issue 一一覆盖、schema/migration 单一 owner、引用路径分类、必填
  字段、依赖边与 `git diff --check`。
