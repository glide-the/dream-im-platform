# Refine 管理后台 MVP Issue 清单

## 0. 文档元信息

- Issue 清单文件：`docs/issue/ISSUES_refine_admin_mvp.md`
- 来源设计稿：
  - 主设计稿：`docs/design/refine-admin-validated-architecture.md`
  - 背景设计稿：`docs/design/security-audit-design.md`（仅用于确认 Claude 工具审计不可复用；不拆入其实现）
- 生成 Agent：`IssueDispatcher`
- 所属流水线阶段：`issue`
- 上游阶段：`design`
- 下游阶段：`task`
- 下游 Agent：`@TaskDesignAgent`
- 关联编排：[`SUO-338`](/SUO/issues/SUO-338)；验证设计：[`SUO-340`](/SUO/issues/SUO-340)
- 权威增量输入：[`SUO-341 plan revision 1`](/SUO/issues/SUO-341#document-plan)（固定 revision：`81c35c47-83c8-4e15-a3cf-e3e1e7f3e80f`）的 §12.1–§12.9 与 `DEC-011`–`DEC-015`
- 增量修订 Issue：[`SUO-345`](/SUO/issues/SUO-345)；稳定清单基线：[`SUO-342`](/SUO/issues/SUO-342)
- 共享设计稿来源：`docs/design/`
- 是否作为当前实现合同：是
- 基线与增量说明：`REFINE-ADM-000` 至 `REFINE-ADM-008`、其 P0 优先级、主责、分发、资源边界与 DAG 均是稳定基线。本次只把 `DESIGN-REFINE-ADMIN-001` §12 的已确认增量映射为已有 Issue 的合同、证据和发布约束；不新增 Issue、不纳入延期域、不下发 task/stage/execute。

本文档只定义 Issue 阶段的交付边界。`TaskDesignAgent` 只能据此创建 task 文档；不得直接将本清单下发给 `StagePlanner` 或 `ExecTaskAgent`。

---

## 1. 关联设计稿信息

- 主设计稿：`docs/design/refine-admin-validated-architecture.md`（`DESIGN-REFINE-ADMIN-001`）
- 背景设计稿：`docs/design/security-audit-design.md`（仅作“不可复用 Claude 工具审计”的证据）

- 本清单覆盖范围：
  - 已裁决的 internal-only Refine 管理台：`/admin`、受保护 admin API、customers、todos、system-config 与 admin audit logs。
  - 最小管理员成员映射、server-side session 适配、三档 RBAC、不可变且脱敏的后台审计。
  - Headless Refine Core + Next.js Router、统一 resource 契约和 MVP 所需单元/集成/E2E 验证。

- 明确排除范围：
  - 用户/套餐/额度/账务/模型注册/代理网关、普通用户与多租户/行级权限。
  - `conversations` 消息和附件的后台暴露、Story 数据、`ink-dream-memory`、`story-workspace`。
  - Ant Design/MUI 等第二套 UI、实时订阅、批量导入导出、富仪表盘和动态权限编辑器。

- 关键约束：
  - 以当前 `ink-admin-memory` checkout 为唯一代码基线；绝不修改 `ink-admin-memory-output.xml` 或外部仓库（`DEC-001`）。
  - `/api/admin/*` 只做解析、zod 校验、session/RBAC、编排和统一响应；领域查询及 DB 细节在 `app/lib/**`（`DEC-005`）。
  - Refine 的客户端 provider 不是安全边界；layout 和每个 admin API 必须服务端 fail-closed（`DEC-007`）。
  - 未完成全服务认证/旧 API 加固前，交付只能标示为 `internal-only`，不得宣称公网 SaaS 就绪（`DEC-009`）。
  - 新增表只能是 `admin_members` 和 `admin_audit_logs`，并以 Drizzle schema + generated migration 为唯一来源（`DEC-006`、`DEC-008`）。
  - Admin API 保持 `{ data, meta }`；Data Provider 的 list 必须适配为 Refine `{ data, total }`，且错误只暴露白名单 `code/message/requestId/details` 并映射为 `HttpError`（`DEC-011`）。
  - Next 16 目前只有依赖层无已声明 peer 冲突的证据；兼容性必须由锁定依赖后的 build、SSR、client navigation 与现有 PWA 回归 spike 实证（`DEC-012`）。
  - 采用 schema 只加不删、入口默认关闭、先只读 canary 后逐资源 mutation 的发布/回滚路径；不得以 feature flag 绕过 public 的全服务安全 blocker（`DEC-014`）。
  - 用户中心、Story、Provider/Model Registry、计费/额度/限流和 Proxy Gateway 仍属延期安全域，禁止预留其 schema、route、provider `custom` 转发或实现工期（`DEC-013`、`DEC-015`）。

- 补充说明：
  - 本批的 API/resource 设计以主设计稿 §5.1–§5.9、验收以 §6、依赖以 §7、裁决以 §8 为准；§12.1–§12.9 与 `DEC-011`–`DEC-015` 是对这组稳定边界的权威增量。
  - 设计稿已明确的身份提供方与暴露模型尚未由上游确认；下方以显式 gate 保留默认假设，未静默扩展为自建认证或 public 发布范围。
  - 后续若 `DEC-001`、`DEC-005`、`DEC-006`、`DEC-009` 或 `DEC-011`–`DEC-015` 被新证据推翻，必须先回到设计阶段更新，而不是直接改写 task 范围。

---

### 1.1 SUO-341 增量覆盖 / 差异矩阵

| Plan 增量 | 受影响 Issue | 本次处置 | 依赖 / 数量影响 |
|---|---|---|---|
| §12.1、`DEC-012`：官方 peer 证据不等于 Next 16 运行时兼容；Node `>=20` 需部署保证 | `REFINE-ADM-001` | 补充“运行时 spike 才可宣称兼容”、锁定版本和 Node 条件；原有隔离路由壳边界不变 | 无；仍与 `REFINE-ADM-000` 并行 |
| §12.2、`DEC-011`：API / Provider 返回契约分离、requestId 与错误映射 | `REFINE-ADM-002`、`REFINE-ADM-003`、`REFINE-ADM-004`、`REFINE-ADM-008` | 强化 Auth/Access 的服务端裁决、Data Provider `{ data, total }` 映射、稳定错误字段和 requestId 审计关联 | 无；`003 → 004 → 005/006/007 → 008` 保持 |
| §12.3、`DEC-013`：高风险域延期且不得预留 schema | `REFINE-ADM-000`、`REFINE-ADM-002`、`REFINE-ADM-003`、`REFINE-ADM-005`–`REFINE-ADM-008` | 明确延期域不是 MVP 资源；不创建表、任意上游代理或 public 补丁 | 无新增 Issue；public 仍是条件性 blocker |
| §12.4：Next App Router / `app/lib` / Query Client 的真实仓库映射 | `REFINE-ADM-001`、`REFINE-ADM-003` | 现有路径与薄 Route Handler 边界已稳定；仅将 Query Client 实证写入验收 | 无 |
| §12.5、`DEC-014`：expand-first、feature gate、只读 canary、非破坏回滚 | `REFINE-ADM-001`、`REFINE-ADM-002`、`REFINE-ADM-005`–`REFINE-ADM-008` | 补充发布证据与 failure mode；schema/迁移 owner 仍只有 `002` | 无；资源依赖与并行关系不变 |
| §12.6：旧方案路径 / 目录 / 工期裁决 | `REFINE-ADM-001`、`REFINE-ADM-002`、`REFINE-ADM-003`、`REFINE-ADM-008` | 现有 App Router、`app/lib`、延期 Gateway 与“无工期承诺”边界已覆盖，保留稳定项 | 无 |
| §12.7：happy / failure 证据矩阵 | `REFINE-ADM-001`、`REFINE-ADM-003`、`REFINE-ADM-004`、`REFINE-ADM-008` | 将 Next 反证、422/429、requestId 审计与迁移/canary failure evidence 细化到既有验收 | 无 |
| `DEC-015`、§12.8–§12.9：证据门槛与确认治理 | 全部 `REFINE-ADM-000`–`008` | 不写工期；只以已接受权威 revision 修订；下游仍只由 `@TaskDesignAgent` 消费 | 无；本次仅 Issue 阶段文档修订 |

结论：Issue 数量仍为 9，`REFINE-ADM-000` 至 `REFINE-ADM-008` 的 ID、类型、P0 优先级、唯一主责、前置依赖和推荐推进顺序均不变；变化仅限本矩阵列出的合同、验收和发布证据补强。

| Issue | 与稳定基线的逐项差异 | 本次结论 |
|---|---|---|
| `REFINE-ADM-000` | 增加 `DEC-013` 延期域与 feature flag 不绕过 public blocker 的明确验收 | 已修订；仍是唯一的 IdP / 暴露模型决策 gate |
| `REFINE-ADM-001` | 增加 Node `>=20`、Next 16 build/SSR/navigation/PWA spike 与失败回退证据 | 已修订；仍不实现 auth、资源或迁移 |
| `REFINE-ADM-002` | 增加 401/403 会话语义、加法 migration、flag-off schema-forward 与 staging 证据 | 已修订；仍独占 admin schema / migration |
| `REFINE-ADM-003` | 增加 `{ data, meta.total } → { data, total }`、`requestId`、`HttpError` 和 422/429 映射 | 已修订；仍不实现 resource 业务操作 |
| `REFINE-ADM-004` | 增加错误 `requestId` 与审计 `request_id` 的脱敏可关联证据 | 已修订；仍不拥有 schema 或业务资源 |
| `REFINE-ADM-005` | 既有 admin adapter、RBAC、审计与 no-conversations 边界已覆盖 §12，不需新增字段 | 稳定保留；依赖和范围不变 |
| `REFINE-ADM-006` | 既有 admin adapter、RBAC、审计与 no-multitenancy 边界已覆盖 §12，不需新增字段 | 稳定保留；依赖和范围不变 |
| `REFINE-ADM-007` | 增加最后开放 mutation、secret/Registry 延期与 feature-gated rollback 约束 | 已修订；仍只管理四个既有白名单字段 |
| `REFINE-ADM-008` | 增加运行时、错误/requestId、迁移/canary/rollback 与延期域非验证范围证据 | 已修订；仍是唯一收口 gate |

---

## 2. Issue 总览表

| Issue ID | 标题 | 类型 | 优先级 | 标签 | 前置依赖 | 分发去向 |
|---|---|---|---|---|---|---|
| `REFINE-ADM-000` | 收敛身份提供方与暴露模型交付门槛 | pipeline | P0 | `refine,security,decision,internal-only` | 无 | `@TaskDesignAgent` |
| `REFINE-ADM-001` | 验证 Refine 兼容性并建立隔离路由壳 | tooling | P0 | `refine,nextjs,app-router,routing` | 无 | `@TaskDesignAgent` |
| `REFINE-ADM-002` | 建立管理员身份、RBAC 与受保护布局基础 | shared | P0 | `auth,rbac,drizzle,admin` | `REFINE-ADM-000`、`REFINE-ADM-001` | `@TaskDesignAgent` |
| `REFINE-ADM-003` | 定义 admin API 合同与 Refine providers | shared | P0 | `api,zod,data-provider,refine` | `REFINE-ADM-001` | `@TaskDesignAgent` |
| `REFINE-ADM-004` | 交付不可变 admin 审计资源与写入一致性 | full-stack | P0 | `audit,security,drizzle,admin-api` | `REFINE-ADM-002`、`REFINE-ADM-003` | `@TaskDesignAgent` |
| `REFINE-ADM-005` | 交付 customers 管理资源 | full-stack | P0 | `customers,crud,rbac,admin-api` | `REFINE-ADM-002`、`REFINE-ADM-003`、`REFINE-ADM-004` | `@TaskDesignAgent` |
| `REFINE-ADM-006` | 交付 todos 管理资源 | full-stack | P0 | `todos,crud,rbac,admin-api` | `REFINE-ADM-002`、`REFINE-ADM-003`、`REFINE-ADM-004` | `@TaskDesignAgent` |
| `REFINE-ADM-007` | 交付 system-config 白名单管理资源 | full-stack | P0 | `system-config,security,rbac,audit` | `REFINE-ADM-002`、`REFINE-ADM-003`、`REFINE-ADM-004` | `@TaskDesignAgent` |
| `REFINE-ADM-008` | 收口管理台集成、安全与回归验证 | shared | P0 | `testing,e2e,security,release-gate` | `REFINE-ADM-001` 至 `REFINE-ADM-007` | `@TaskDesignAgent` |

---

## 3. Issue 明细

### REFINE-ADM-000

- 标题：收敛身份提供方与暴露模型交付门槛
- 类型：pipeline
- 优先级：P0
- 标签：`refine,security,decision,internal-only`
- 描述：把设计稿 §7.1 与 §7.2 的两个既有澄清项变成可追踪的前置决定：指定成熟的 Next.js server-session/IdP 方案及回调域名，并确认 MVP 按 `internal-only` 交付。选择 public 不能扩大本期 MVP；它只会触发全服务认证、数据 ownership 和旧 API 加固的独立设计/阻塞链。用户中心、Story、Provider/Model Registry、计费/额度/限流和 Proxy Gateway 继续延期，不得以该决定为由预留 schema 或补入资源。
- 输入：`DESIGN-REFINE-ADMIN-001` §5.4、§5.9、§7.1、§7.2、§12.1、§12.3；`RISK-003`、`RISK-005`；`DEC-007`、`DEC-009`、`DEC-013`。
- 领域与边界：只收敛交付前提和记录决策；不设计密码学、OAuth 流程、外部业务数据或 public 加固方案。
- 允许写入范围：Paperclip Issue 评论与后续 task 文档中的决策引用；不写应用源代码、schema、迁移或设计稿。
- 禁止写入范围：`app/**`、`drizzle/**`、`docs/design/**`、`docs/stage/**`、`docs/exec/**`、`ink-admin-memory-output.xml` 以及外部仓库。
- 验收条件：
  - 记录一个已确认的 IdP/server-session 方案、稳定 `identity_subject` 来源和允许的回调域名；没有选择时明确 production admin route 必须 fail-closed。
  - 记录 `internal-only` 或 `public` 的明确结论；若为 public，创建并前置“全服务认证 + ownership + 旧 API 加固”的独立 blocker，而不将其塞入本 MVP。
  - 决策能被 `REFINE-ADM-002` 和 `REFINE-ADM-008` 直接引用，且未改变延期模块清单。
  - public 结论不得通过 Admin feature flag 绕过全服务安全 blocker；延期域不出现“预留”表、字段、route 或 provider 转发。
- 验证方式：检查 Issue 评论/下游 task 文档已包含三项决策字段；对照设计稿 §7.1、§7.2 与延期范围，无新增 schema/resource。
- 前置依赖：无。
- 关联路径：
  - `docs/design/refine-admin-validated-architecture.md`
  - `docs/issue/ISSUES_refine_admin_mvp.md`
- 分发去向：`@TaskDesignAgent`。
- 主责 Agent：`TaskDesignAgent`（将决定固化为可执行任务前提）。
- 协作 Agent：`CEOOrchestrator` 与产品部署/安全责任人（决策 owner，不直接承担实现）。
- 设计决策引用：`DEC-007`、`DEC-009`、`DEC-013`、`RISK-003`、`RISK-005`。
- 备注：`[CLARIFICATION_NEEDED]`。默认解释是 internal-only；身份提供方选择是 `REFINE-ADM-002` 开始实现的硬前置，不得用自建密码、临时前端开关或 feature flag 绕过安全门槛替代。

### REFINE-ADM-001

- 标题：验证 Refine 兼容性并建立隔离路由壳
- 类型：tooling
- 优先级：P0
- 标签：`refine,nextjs,app-router,routing`
- 描述：锁定 `@refinedev/core` 5.x 与 `@refinedev/nextjs-router` 7.x，完成 Next.js 16 App Router 的 build、SSR、client navigation 和动态 `:id`/`[id]` 路由 spike；建立仅含登录入口与壳层的 `/admin` 命名空间，绝不接管现有 PWA 路由。`next: "*"` 的 peer 声明只表示无已声明冲突，不得在 spike 成功前宣称 Next 16 运行时兼容。
- 输入：设计稿 §2.2–§2.3、§5.1、§6 的 `AC-001`–`AC-003`、§12.1、§12.4–§12.5、§12.7，`RISK-001`、`RISK-002`，`DEC-001`–`DEC-004`、`DEC-012`、`DEC-014`、`DEC-015`。
- 领域与边界：负责依赖兼容、Node `>=20` 部署前提实证与路由隔离，不负责 session/RBAC、resource CRUD、审计或业务数据迁移；spike 失败时只撤销尚未发布的依赖/路由变更，不能默认升级/降级 Next 或重构现有 PWA。
- 允许写入范围：`package.json`、`pnpm-lock.yaml`、`app/(admin)/admin/login/**`、最小 `/admin` 壳层、`app/components/admin/**`、受影响的路由/编译测试。
- 禁止写入范围：`app/(app)/**` 的现有 PWA 布局与页面、`app/api/customers/**`、`app/api/todos/**`、`app/api/system-config/**`、`app/lib/chat-schema.ts`、`app/lib/claude-agent-kit/**`、`drizzle/**`、`ink-admin-memory-output.xml`。
- 验收条件：
  - 依赖被锁定为与验证快照一致的 Refine Core 5.x 与 Next.js Router 7.x，部署 Node 版本满足 `>=20`；未引入 `@refinedev/react-router`、Ant Design 或第二套 UI 框架。
  - `/admin` 使用显式 App Router 页面和独立 route group；`/`、`/customers` 及既有 API 不重定向、不被 catch-all 吞没。
  - 仅在 lockfile 固定后实测通过 Next 16 build、SSR、`/admin` client navigation、一个动态 `[id]` 路由解析和既有 PWA 回归，才可记录“运行时兼容”；官方 `UnsavedChangesNotifier` 不被列为 MVP 验收。
  - failure evidence：若任一 spike 失败，保留 build/SSR/navigation 与现有 PWA 回归证据，停止后续 Admin 发布，并回到设计评审；不得用依赖升级/降级或 PWA 重构静默修复。
- 验证方式：受影响范围 lint；最小 build/SSR/client-navigation/route smoke；现有 customers E2E 路由访问回归；检查 lockfile、依赖树与部署 Node 版本。
- 前置依赖：无。
- 关联路径：
  - `package.json`
  - `pnpm-lock.yaml`
  - `app/(admin)/admin/`
  - `app/components/admin/`
  - `app/(app)/layout.tsx`
  - `tests/e2e/customers-flow.spec.ts`
- 分发去向：`@TaskDesignAgent`。
- 主责 Agent：`TaskDesignAgent`。
- 协作 Agent：`FrontendTaskAgent`（仅在 task 阶段按本 Issue 的 tooling/frontend 范围协作）。
- 设计决策引用：`DEC-001`、`DEC-002`、`DEC-003`、`DEC-004`、`DEC-012`、`DEC-014`、`DEC-015`、`RISK-001`、`RISK-002`。
- 备注：`[CLARIFICATION_NEEDED]` Next.js 16 的 peer 声明不等于运行时兼容，且部署 Node `>=20` 尚须由部署责任人确认；失败时记录验证证据并回退到设计评估，不得偷偷改用 React Router。

### REFINE-ADM-002

- 标题：建立管理员身份、RBAC 与受保护布局基础
- 类型：shared
- 优先级：P0
- 标签：`auth,rbac,drizzle,admin`
- 描述：建立 server-only session 适配、`admin_members` 映射、默认拒绝的纯权限矩阵和 protected layout；同时完成 `admin_audit_logs` 的最小 schema/migration 基座，以避免后续两个 Issue 并行修改同一 schema 与迁移文件。该 Issue 不实现资源级 CRUD 或审计 UI；浏览器 Auth/Access Provider 只能消费此 server-only identity/policy 的结果，不能自行判定成员有效性。
- 输入：设计稿 §5.1、§5.3–§5.5、§5.8、`AC-004`–`AC-008`、`AC-012`、§12.2、§12.5、§12.7，`RISK-005`、`RISK-008`，`DEC-005`、`DEC-007`、`DEC-008`、`DEC-014`。
- 领域与边界：后端负责 session/identity、policy、schema/migration 和每个 admin route 可复用的 guard；前端负责 server protected layout 与安全登录/退出入口。双方只通过 `AdminIdentity` 与 `can(resource, action)` 窄接口协作。
- 允许写入范围：`app/lib/admin/auth.ts`、`app/lib/admin/policy.ts`、必要的 server-only 类型；`app/lib/db/schema.ts`、Drizzle generated migration 与 meta；`app/(admin)/admin/(protected)/layout.tsx`、`app/(admin)/admin/login/**`；认证/RBAC 测试。
- 禁止写入范围：自建密码散列、token 签名或 OAuth 协议；`app/api/customers/**`、`app/api/todos/**`、`app/api/system-config/**` 旧入口；`app/lib/chat-schema.ts`、`app/lib/claude-agent-kit/**`；用户/角色编辑 UI、普通用户/Story/计费/网关 schema；`ink-admin-memory-output.xml`。
- 验收条件：
  - `admin_members` 与 `admin_audit_logs` 是新增 schema 的全部内容，并通过 `pnpm db:generate` 生成相应加法 migration；不向 `ensureInitialized()` 添加 runtime DDL，不改名/删除既有表列，也不预留延期域 schema。
  - 外部稳定 subject 映射到 active `admin | operator | auditor`；未知/disabled/无 session 均 fail-closed，分别获得 403 或 401。
  - policy 对未知 resource/action 默认 deny，并精确实现设计稿的 customers、todos、system-config、admin-audit-logs 权限矩阵。
  - protected layout 先在服务端验证 session，绝不把 session secret 传入客户端；登录入口不被 protected layout 包裹。401 表示无会话，403 表示已登录但无权，后者必须保留 session 给 `REFINE-ADM-003` 的 provider 显示拒绝原因。
  - migration 在 feature flag 关闭时仍兼容新表已存在；为 `REFINE-ADM-008` 提供 staging backup/apply、schema snapshot 和失败停止/从已验证备份恢复所需的可追踪证据。
  - shared 验收分工：后端用单测证明 policy/guard 与 401/403；前端证明角色导航/登录跳转；联调证明 UI 隐藏不影响直调 API 的服务端拒绝。
- 验证方式：Drizzle migration 生成与 schema diff 检查；auth/policy unit tests；protected layout + admin API integration test；三种角色的最小页面 smoke。
- 前置依赖：`REFINE-ADM-000`、`REFINE-ADM-001`。
- 关联路径：
  - `app/lib/db/schema.ts`
  - `app/lib/db.ts`
  - `drizzle/`
  - `app/lib/admin/`
  - `app/(admin)/admin/(protected)/layout.tsx`
  - `app/(admin)/admin/login/page.tsx`
- 分发去向：`@TaskDesignAgent`。
- 主责 Agent：`TaskDesignAgent`（唯一规划主责）。
- 协作 Agent：`BackendTaskAgent`、`FrontendTaskAgent`（仅由 `TaskDesignAgent` 在 task 阶段协调；不构成直接分发）。
- 设计决策引用：`DEC-004`、`DEC-005`、`DEC-007`、`DEC-008`、`DEC-014`、`RISK-005`、`RISK-008`。
- 备注：`[CLARIFICATION_NEEDED]`。必须消费 `REFINE-ADM-000` 的 IdP/callback 结果；无配置时 production admin 路由保持 fail-closed，而不是引入开发旁路。

### REFINE-ADM-003

- 标题：定义 admin API 合同与 Refine providers
- 类型：shared
- 优先级：P0
- 标签：`api,zod,data-provider,refine`
- 描述：建立 `/api/admin/*` 的 resource allowlist、zod 输入/输出合同、分页/排序/过滤白名单、稳定 `code/message/requestId` 错误结构，并实现 custom Data/Auth/Access Control Providers。Admin API 保持 `{ data, meta }`；Data Provider 将 list 的 `meta.total` 适配为 Refine 顶层 `total`，其他首批 CRUD 返回 `{ data }`。此 Issue 只定义可复用协议和 provider 映射，不实现具体资源业务操作。
- 输入：设计稿 §5.2、§5.3、§6 的 `AC-009`–`AC-011`、`AC-013`、§12.2、§12.4、§12.7，`DEC-002`、`DEC-005`、`DEC-007`、`DEC-011`。
- 领域与边界：后端定义 server contracts、response/error/requestId mapping 与 route helper；前端实现 client-side Refine provider、filter/sorter 显式转换及 401/403/404/409/422/429/5xx 体验。`AuthProvider` 仅在 401 登出/重登录，403 保留 session 并显示拒绝原因；`AccessControlProvider` 以与服务端同一纯权限矩阵输入镜像 `can`。任何 authorization 仍由 `REFINE-ADM-002` 的服务端 guard 裁决。
- 允许写入范围：`app/lib/admin/contracts.ts`、`app/lib/admin/` 中单一职责的 response/route helpers、`app/components/admin/AdminProviders.tsx` 与 provider 组件、`app/(admin)/admin/**` 的 provider 挂载、合同/provider 单测。
- 禁止写入范围：具体 customers/todos/system-config/audit route 与页面实现；`app/api/customers/**`、`app/api/todos/**`、`app/api/system-config/**` 旧 API；任何 SQL 直写入 `app/api/**/route.ts`；secrets、`chat-schema.ts`、`claude-agent-kit/**`、第二套 UI 框架。
- 验收条件：
  - 标准资源 `getList/getOne/create/update/deleteOne` 与单例 system-config `getOne/update` 映射严格匹配设计稿 §5.2 的 URL；API list 保持 `{ data, meta: { total } }`，Data Provider list 返回 `{ data, total }`，其他首批 CRUD 返回 `{ data }`。
  - query/body 都有 zod contract；`page >= 1`、`1 <= pageSize <= 100`；未知 resource/action 返回 404，非白名单 sort/filter 与无效 query/body 返回 422，且不能被转发到 SQL。
  - 错误统一为 `{ error: { code, message, requestId, details? } }`，其中 `details` 只允许白名单字段；失败不得包装为 HTTP 200。Data Provider 以 `statusCode` 映射 `HttpError`：401 触发登录、403 保留 session 并显示拒绝、404 显示未找到、409 显示冲突、422 显示可修正校验、429 显示限流、5xx 不泄露内部信息。
  - custom provider 先证明 Admin 位于现有受控 TanStack Query Client 生命周期，再复用它；不创建第二个全局 Query Client，不以 `custom` 暴露任意 URL/header/上游转发，也不把 secret/session 传给浏览器。
  - shared 验收分工：后端 contract/错误映射单测；前端 provider 行为测试；联调以 mock admin API 验证数据与错误闭环。
- 验证方式：zod contract unit tests；Provider API `{ data, meta.total } → { data, total }` 与 `HttpError.statusCode` mapping tests；受影响 lint；基于 mock server 的 401/403/404/409/422/429/5xx UI smoke。
- 前置依赖：`REFINE-ADM-001`。
- 关联路径：
  - `app/lib/admin/contracts.ts`
  - `app/components/admin/AdminProviders.tsx`
  - `app/app/providers.tsx`
  - `app/lib/client.ts`
  - `app/api/`
- 分发去向：`@TaskDesignAgent`。
- 主责 Agent：`TaskDesignAgent`（唯一规划主责）。
- 协作 Agent：`BackendTaskAgent`、`FrontendTaskAgent`（仅由 `TaskDesignAgent` 在 task 阶段协调；不构成直接分发）。
- 设计决策引用：`DEC-002`、`DEC-005`、`DEC-007`、`DEC-011`。
- 备注：该 Issue 可在 `REFINE-ADM-002` 的 IdP 接入实现期间并行，但不得越过它宣称任一 admin route 已受保护；`requestId` 是可关联的稳定错误字段，不得携带 stack、secret 或未过滤 details。

### REFINE-ADM-004

- 标题：交付不可变 admin 审计资源与写入一致性
- 类型：full-stack
- 优先级：P0
- 标签：`audit,security,drizzle,admin-api`
- 描述：基于已创建的 `admin_audit_logs` schema，交付脱敏审计 writer、只读 admin audit API 与 `/admin/audit` list/show 页面；将 create/update/delete 和 system-config update 的允许、拒绝和失败结果按设计约束写入审计。审计的 `request_id` 必须能关联 `REFINE-ADM-003` 稳定错误协议的 `requestId`，但不得复制 response details、敏感值或堆栈。
- 输入：设计稿 §5.1、§5.3、§5.5、§5.7–§5.8，`AC-007`、`AC-008`、`AC-012`–`AC-014`、§12.2、§12.5、§12.7，`RISK-006`、`RISK-007`，`DEC-008`、`DEC-011`、`DEC-014`。
- 领域与边界：负责审计事件和只读资源本身，不拥有 customers/todos/system-config 的领域操作；这些资源 Issue 仅调用其窄 writer 接口。所有角色只能 list/show，永不 expose update/delete。
- 允许写入范围：`app/lib/admin/audit.ts` 与相关类型/查询窄接口、`app/api/admin/audit/**`、`app/(admin)/admin/(protected)/audit/**`、`app/components/admin/**` 中审计专用组件、审计 unit/integration/UI tests。
- 禁止写入范围：`app/lib/db/schema.ts` 与 `drizzle/**`（由 `REFINE-ADM-002` 独占）、现有业务表复制、`app/api/conversations/**`、完整 request body/手机号/邮箱/prompt/secret 的日志持久化、审计 update/delete endpoint、旧无鉴权 API。
- 验收条件：
  - 每次允许的 create/update/delete 或 system-config update 写入 `request_id`、actor、action/resource/resource_id、outcome、changed field names、reason code；不保存敏感值。
  - API failure 中返回的 `requestId` 与相同请求的 `admin_audit_logs.request_id` 可关联；审计证据只记录允许的稳定 metadata，而不透传 `details`、请求体或 stack。
  - denied 与 validation failed 可记录原因码但不能记录完整请求体；浏览器响应、日志和审计均无凭证或 session secret。
  - success 审计与敏感业务变更具有同一事务或等价的“审计失败则变更失败”保证；不能静默提交。
  - `/api/admin/audit` 仅 list/show，三个角色可读；无 update/delete API 或 UI 动作。
  - 审计 list/show 按 `REFINE-ADM-003` 合同返回，并在 `/admin/audit` 中可查看脱敏事件。
- 验证方式：audit writer 单测（success/denied/failed/secret redaction）；route integration test；事务失败模拟；三角色只读 UI/E2E smoke。
- 前置依赖：`REFINE-ADM-002`、`REFINE-ADM-003`。
- 关联路径：
  - `app/lib/admin/audit.ts`
  - `app/api/admin/audit/`
  - `app/(admin)/admin/(protected)/audit/`
  - `app/components/admin/`
  - `app/lib/db/schema.ts`
- 分发去向：`@TaskDesignAgent`。
- 主责 Agent：`TaskDesignAgent`。
- 协作 Agent：`BackendTaskAgent` 与 `FrontendTaskAgent`（task 阶段按本 Issue 的 audit resource 范围协作）。
- 设计决策引用：`DEC-005`、`DEC-007`、`DEC-008`、`DEC-011`、`DEC-014`、`RISK-006`、`RISK-007`。
- 备注：审计 schema 的创建属于 `REFINE-ADM-002`，本 Issue 不得重新生成或手写平行 migration。

### REFINE-ADM-005

- 标题：交付 customers 管理资源
- 类型：full-stack
- 优先级：P0
- 标签：`customers,crud,rbac,admin-api`
- 描述：在受保护 `/api/admin/customers` 与 `/admin/customers` 上交付 customers 的 list/show/create/update，以及仅 admin 的 delete；复用现有领域查询/DB 能力，不改变旧 PWA customers route 或复制业务表。
- 输入：设计稿 §3.1、§5.1、§5.3–§5.5、§6 的 `AC-005`、`AC-009`–`AC-015`，`DEC-005`、`DEC-006`、`DEC-007`。
- 领域与边界：该 Issue 只拥有 customers resource 的 admin adapter/routes/pages/forms；后端通过合同、policy、audit 窄接口调用既有 customers domain，前端用 provider 与现有样式实现页面。conversations 与普通用户数据不在范围内。
- 允许写入范围：`app/api/admin/customers/**`、`app/(admin)/admin/(protected)/customers/**`、`app/components/admin/customers/**`、仅为事务/审计必要的 `app/lib` 窄接口、customers admin tests。
- 禁止写入范围：`app/api/customers/**`、`app/(app)/customers/**`、`app/lib/db/schema.ts`、`drizzle/**`、`conversations` admin UI/API、通用 provider/policy/audit 基础实现、任何 `ink-dream-memory` 或 `story-workspace` 文件。
- 验收条件：
  - admin API 实现 list/show/create/update/delete 并遵守统一分页、sort/filter 白名单、zod 和错误合同；route 不直接堆叠 Drizzle 查询。
  - auditor/operator/admin 都可 list/show；仅 operator/admin 可 create/update；仅 admin 可 delete，其他角色直调 delete 返回 403。
  - `/admin/customers` 有 list/show/create/edit；UI 仅显示允许动作，仍能处理 403/404/409/5xx 且不泄露 PII 以外的敏感服务端信息。
  - 每个允许或拒绝的 mutation 产生 `REFINE-ADM-004` 定义的 sanitized audit 记录；无 audit 成功记录时敏感变更不得静默完成。
- 验证方式：customers admin API integration tests；policy/audit tests；admin happy-path E2E（admin update 后查到 audit）；failure-path E2E/API（operator delete 403）；既有 `tests/e2e/customers-flow.spec.ts` 回归。
- 前置依赖：`REFINE-ADM-002`、`REFINE-ADM-003`、`REFINE-ADM-004`。
- 关联路径：
  - `app/api/admin/customers/`
  - `app/(admin)/admin/(protected)/customers/`
  - `app/components/admin/customers/`
  - `app/lib/db.ts`
  - `app/api/customers/`
  - `tests/e2e/customers-flow.spec.ts`
- 分发去向：`@TaskDesignAgent`。
- 主责 Agent：`TaskDesignAgent`。
- 协作 Agent：`BackendTaskAgent` 与 `FrontendTaskAgent`（task 阶段按本 Issue 的 customers resource 边界协作）。
- 设计决策引用：`DEC-005`、`DEC-006`、`DEC-007`、`RISK-006`。
- 备注：删除没有独立 Refine 页面；它是受 RBAC 约束的 resource action。不得借此 Issue 暴露 conversations 或增加用户 ownership 表。

### REFINE-ADM-006

- 标题：交付 todos 管理资源
- 类型：full-stack
- 优先级：P0
- 标签：`todos,crud,rbac,admin-api`
- 描述：在受保护 `/api/admin/todos` 与 `/admin/todos` 上交付 todos 的 list/show/create/update，以及仅 admin 的 delete；维持既有 PWA todos API/页面的协议和行为。
- 输入：设计稿 §3.1、§5.1、§5.3–§5.5、§6 的 `AC-005`、`AC-009`–`AC-015`，`DEC-005`、`DEC-006`、`DEC-007`。
- 领域与边界：该 Issue 仅拥有 todos resource 的 admin adapter/routes/pages/forms；复用当前 `listTodos/getTodoById/createTodo/updateTodo/deleteTodo` 能力，不能趁机引入批量操作、实时订阅或新的多租户字段。
- 允许写入范围：`app/api/admin/todos/**`、`app/(admin)/admin/(protected)/todos/**`、`app/components/admin/todos/**`、仅为事务/审计必要的 `app/lib` 窄接口、todos admin tests。
- 禁止写入范围：`app/api/todos/**`、`app/(app)/**`、`app/lib/db/schema.ts`、`drizzle/**`、conversations/system-config admin 实现、通用 provider/policy/audit 基础实现、`ink-admin-memory-output.xml`。
- 验收条件：
  - admin API 的 list/show/create/update/delete 遵守统一 zod、pagination/filter/sort allowlist 和错误合同，且不在 route 写 Drizzle 查询。
  - auditor/operator/admin 都可 list/show；仅 operator/admin 可 create/update；仅 admin 可 delete，绕过 UI 的 operator delete 返回 403。
  - `/admin/todos` 提供 list/show/create/edit，客户端权限展示与服务端 matrix 一致并能呈现统一错误。
  - 每个 mutation 通过 shared audit writer 产生脱敏记录；没有 audit 写入成功，不得提交敏感变更。
- 验证方式：todos admin API integration tests；角色 policy/audit tests；admin happy-path 与 operator-deny E2E/API；现有 `tests/e2e/todos-flow.spec.ts` 回归。
- 前置依赖：`REFINE-ADM-002`、`REFINE-ADM-003`、`REFINE-ADM-004`。
- 关联路径：
  - `app/api/admin/todos/`
  - `app/(admin)/admin/(protected)/todos/`
  - `app/components/admin/todos/`
  - `app/lib/db.ts`
  - `app/api/todos/`
  - `tests/e2e/todos-flow.spec.ts`
- 分发去向：`@TaskDesignAgent`。
- 主责 Agent：`TaskDesignAgent`。
- 协作 Agent：`BackendTaskAgent` 与 `FrontendTaskAgent`（task 阶段按本 Issue 的 todos resource 边界协作）。
- 设计决策引用：`DEC-005`、`DEC-006`、`DEC-007`。
- 备注：可与 `REFINE-ADM-005`、`REFINE-ADM-007` 并行，但不得修改它们的 route/page 目录或共享基础模块。

### REFINE-ADM-007

- 标题：交付 system-config 白名单管理资源
- 类型：full-stack
- 优先级：P0
- 标签：`system-config,security,rbac,audit`
- 描述：为单例 `system-config` 交付 `/admin/settings` 的 show/edit 和 `/api/admin/system-config` 的 GET/PUT；所有角色可查看，只有 admin 可更新 `system_prompt`、`model`、`provider`、`workspace_enabled`，并记录审计与确认交互。该 mutation 是发布时最后开放的独立 Resource feature gate，不能以此进入 Provider/Model Registry、密钥或网关数据面。
- 输入：设计稿 §3.1、§5.1–§5.3、§5.5–§5.7、§6 的 `AC-005`、`AC-007`–`AC-015`、§12.3、§12.5、§12.7，`RISK-007`、`DEC-006`、`DEC-010`、`DEC-013`、`DEC-014`。
- 领域与边界：只管理既有单例运行设置的四个白名单字段；不是 Model Registry，不包含定价/密钥轮换，也不暴露 `theme`、`extras` 或任何 secret。任何 Provider API key 只留在部署 secret manager / 环境注入；浏览器、审计和错误 `details` 均不得读取或输出明文。
- 允许写入范围：`app/api/admin/system-config/route.ts`、`app/(admin)/admin/(protected)/settings/**`、`app/components/admin/settings/**`、仅为审计一致性必要的 `app/lib` 窄接口、system-config admin tests。
- 禁止写入范围：`app/api/system-config/route.ts`、`app/lib/db/schema.ts`、`drizzle/**`、provider API keys/环境 secret、`extras` 或 `theme` 的 admin contract/UI、模型注册/计费/网关文件、现有 PWA 设置行为。
- 验收条件：
  - `GET /api/admin/system-config` 返回 id 固定为 `default` 的统一 `{ data }`；`PUT` 只接受四个白名单字段并按统一错误结构拒绝未知字段。
  - auditor/operator/admin 可 show；仅 admin 可 update。operator 直调 PUT 必须 403，客户端隐藏编辑动作不能替代该检查。
  - 更新前有明确确认交互；成功/拒绝/失败按脱敏规则写入审计，且返回、日志、审计不含 secret 或 `extras` 内容。
  - `/admin/settings` 使用单例 Refine mapping，不伪装成通用资源列表，也不增加 create/delete。
  - 发布顺序在只读 canary 后、customers/todos mutation 稳定之后才单独打开 system-config mutation；feature flag 关闭时旧应用可运行，回滚先关闭该 mutation/入口并保留审计数据。
- 验证方式：request contract/policy/audit unit + integration tests；admin PUT happy path；operator PUT deny；断言 `extras`/secret 不在响应、表单和审计事件中。
- 前置依赖：`REFINE-ADM-002`、`REFINE-ADM-003`、`REFINE-ADM-004`。
- 关联路径：
  - `app/api/admin/system-config/route.ts`
  - `app/(admin)/admin/(protected)/settings/`
  - `app/components/admin/settings/`
  - `app/lib/db.ts`
  - `app/api/system-config/route.ts`
- 分发去向：`@TaskDesignAgent`。
- 主责 Agent：`TaskDesignAgent`。
- 协作 Agent：`BackendTaskAgent` 与 `FrontendTaskAgent`（task 阶段按本 Issue 的 settings resource 边界协作）。
- 设计决策引用：`DEC-005`、`DEC-006`、`DEC-007`、`DEC-010`、`DEC-013`、`DEC-014`、`RISK-007`。
- 备注：`[CLARIFICATION_NEEDED]` 若部署方要求 secret rotation、模型 registry 或 Provider 上游调用，必须新建设计/Issue；它们不属于本 resource，不能用 `custom` 或 feature flag 绕过延期边界。

### REFINE-ADM-008

- 标题：收口管理台集成、安全与回归验证
- 类型：shared
- 优先级：P0
- 标签：`testing,e2e,security,release-gate`
- 描述：在所有 MVP resources 稳定后，验证三种角色权限、服务端直调拒绝、审计闭环、secret 边界、Next 16 运行时证据、加法迁移/canary 与现有 PWA 回归，并产出 internal-only 发布标识。它只验证设计合同，不以测试为理由扩大 public 加固或延期资源，也不把证据门槛替换为工期承诺。
- 输入：设计稿 §5.9、§6 的 `AC-001`–`AC-016`、§7 的 `RISK-001`–`RISK-008`、§11、§12.1–§12.7；`DEC-011`–`DEC-015`；以及 `REFINE-ADM-000` 的已确认暴露结论。
- 领域与边界：后端负责 unit/integration、schema/migration/API 验证与 direct-call deny；前端负责 route/error/role UX E2E 及 PWA route regression；联调负责 admin 登录→变更→审计的全链路，并验证 `requestId` 到审计的关联。只验证与发布 gates 相关的现有 resource，不补写任何 resource 功能。
- 允许写入范围：受影响 `*.test.ts(x)`、`*.integration.test.ts`、`tests/e2e/**`、必要的测试 fixtures/Playwright config、internal-only 交付说明；仅为修复已发现且归属明确的测试缺口创建回流 Issue。
- 禁止写入范围：未经设计回退的产品功能、公开发布配置、旧 API 的“顺手”全面重构、用户/Story/计费/模型/网关 schema 或 route、`ink-admin-memory-output.xml`、外部仓库。
- 验收条件：
  - 覆盖完整 happy path：admin 登录、浏览并更新 customers/todos 或 system-config、查看对应 audit record，并证明 list API 的 `meta.total` 被 Provider 映射为 Refine `total`；覆盖 failure path：operator delete 或未登录 admin API 返回 401/403。
  - auditor/operator/admin 的菜单、动作与服务端权限矩阵一致；客户端隐藏按钮之外，绕过 UI 的 API 调用仍被拒绝。
  - 断言分页/filters 合同、稳定 `code/message/requestId`、`HttpError.statusCode` 与 401/403/404/409/422/429/5xx 的不泄密行为、`extras` 排除、无 API key/DB credential/session secret 泄露和审计失败不静默提交；每个需审计的失败可通过 requestId 关联审计 metadata。
  - 受影响范围 lint、Data Provider/RBAC 单测、admin API integration、admin E2E、既有 customers/todos E2E 回归均有可追踪结果。
  - 最终交付明确标示 `internal-only`；若 `REFINE-ADM-000` 结论为 public，则本 Issue 标记 `[BLOCKED]` 并链接独立全服务安全前置工作，不能宣称 public-ready。
  - 发布证据证明：迁移为加法、staging 备份后 apply 成功、feature flag 关闭时旧应用可运行、只读 canary 仅开放 allowlist 管理员，并在逐资源 mutation 中最后开启 system-config。迁移失败时停止发布、从已验证备份恢复且不自动 `DROP TABLE`/`DROP COLUMN`；运行时失败时撤销未发布的依赖/路由变更并回到设计评审。
  - 不创建或验证用户中心、Story、Provider/Model Registry、计费/额度/限流或 Proxy Gateway 的实现；public 路径不得以 Admin feature flag 绕过 `AC-016` 的全服务安全 blocker。
  - 变更集通过引用路径存在性检查与 `git diff --check`。
  - shared 验收分工：后端验证 API/guard/audit；前端验证路由/错误/角色体验；联调验证跨边界 happy/failure path。
- 验证方式：`pnpm lint`（受影响范围或等价 lint）、`pnpm test:run`（受影响测试）、admin API integration、`pnpm test:e2e`（admin + customers/todos 回归）、secret/response assertions、`git diff --check` 与路径存在性脚本。
- 前置依赖：`REFINE-ADM-001`、`REFINE-ADM-002`、`REFINE-ADM-003`、`REFINE-ADM-004`、`REFINE-ADM-005`、`REFINE-ADM-006`、`REFINE-ADM-007`。
- 关联路径：
  - `tests/e2e/`
  - `app/api/**/*.integration.test.ts`
  - `app/lib/**/*.test.ts`
  - `tests/e2e/customers-flow.spec.ts`
  - `tests/e2e/todos-flow.spec.ts`
  - `playwright.config.ts`
  - `docs/issue/ISSUES_refine_admin_mvp.md`
- 分发去向：`@TaskDesignAgent`。
- 主责 Agent：`TaskDesignAgent`（唯一规划主责）。
- 协作 Agent：`BackendTaskAgent`、`FrontendTaskAgent`（仅由 `TaskDesignAgent` 在 task 阶段协调；不构成直接分发）。
- 设计决策引用：`DEC-001`、`DEC-005`、`DEC-006`、`DEC-007`、`DEC-009`、`DEC-010`、`DEC-011`、`DEC-012`、`DEC-013`、`DEC-014`、`DEC-015`。
- 备注：若发现实现与设计冲突，记录冲突、影响、decision owner 与解锁动作后回退到设计；不得在验证 Issue 内静默改合同、给出未经证据支持的工期，或把延期安全域变成“测试范围”。

---

## 4. 共享任务与依赖说明

- `REFINE-ADM-000` 是身份提供方与暴露模型的显式决策 gate。它不制造实现范围；`internal-only` 是当前默认，public 只能生成本清单之外的安全 blocker。
- `REFINE-ADM-001` 与 `REFINE-ADM-000` 可并行。`REFINE-ADM-002` 在两者完成后开始，以确保路由基线与 IdP 前提稳定。
- `REFINE-ADM-003` 仅依赖 `REFINE-ADM-001`，可与 `REFINE-ADM-002` 并行定义合同/provider；但任何真实 admin API 的保护验收必须等 `REFINE-ADM-002`。
- `REFINE-ADM-002` 独占 `app/lib/db/schema.ts` 和 `drizzle/` 的 admin schema/migration 变更；这消除了 member/audit 两条工作流争抢同一 migration 的风险。
- `REFINE-ADM-001` 的 Next 16 runtime spike 是可证伪前置，不是 peer 解析结论；`REFINE-ADM-002` 的 migration 只加不删并支持“flag 关闭 + 新表已存在”，二者在通过证据门槛前不得扩大 Admin 发布。
- `REFINE-ADM-004` 在 auth/RBAC 与 contracts 之后交付 writer/read-only audit resource。`REFINE-ADM-005`、`REFINE-ADM-006`、`REFINE-ADM-007` 必须调用其窄接口，不能各自写审计逻辑。
- `REFINE-ADM-005`、`REFINE-ADM-006`、`REFINE-ADM-007` 的目录、resource contract 和领域数据彼此独立，因此可以在共同依赖完成后并行；它们不得改共享 provider/policy/audit 基础文件。
- `REFINE-ADM-007` 的 mutation 只能在只读 canary 与 customers/todos mutation 稳定后最后逐资源开启；不能借 system-config 增加 Model Registry 或 secret 管理。
- `REFINE-ADM-008` 是唯一收口 gate，必须等待 `REFINE-ADM-001` 至 `REFINE-ADM-007`。它不承担未完成资源功能的实现，并以 build/SSR/navigation、迁移/回滚、canary 和 error/requestId 证据替代工期承诺。
- shared Issue 的唯一规划主责均是 `TaskDesignAgent`；`BackendTaskAgent`/`FrontendTaskAgent` 仅作为 task 阶段的协作角色。前后端责任已在每个 shared Issue 的“领域与边界”和“验收条件”中明确，未通过直接分发绕过 `TaskDesignAgent`。
- 若后续发现任一 Issue 超出 `DEC-006` 的资源清单或要求新的设计决策，必须在当前 Paperclip Issue 评论区标记 `[CLARIFICATION_NEEDED]`，由 `CEOOrchestrator` 判断是否回退 `DesignArchitect`。

并行关系（DAG）：

```text
REFINE-ADM-000 ─┐
                ├─> REFINE-ADM-002 ─┐
REFINE-ADM-001 ─┼─> REFINE-ADM-003 ─┼─> REFINE-ADM-004 ─┬─> REFINE-ADM-005 ─┐
                │                    │                   ├─> REFINE-ADM-006 ─┼─> REFINE-ADM-008
                │                    │                   └─> REFINE-ADM-007 ─┘
                └────────────────────┘
```

---

## 5. 分发去向说明

- `@TaskDesignAgent`：消费本清单的全部 Issue，按 `类型`、`领域与边界`、允许/禁止写入范围和依赖生成 task 文档。`frontend`、`backend`、`full-stack` 与 `shared` 是范围标记，不是直接派发对象。
- `REFINE-ADM-001`：TaskDesignAgent 应产出 tooling/frontend 范围的任务；不得直接分给 `StagePlanner`。
- `REFINE-ADM-002`、`REFINE-ADM-003`、`REFINE-ADM-008`：shared Issue 由 TaskDesignAgent 保持唯一主责，再以已写明的前后端边界规划协作任务；不得形成无 owner 的 shared task。
- `REFINE-ADM-004` 至 `REFINE-ADM-007`：TaskDesignAgent 应按 resource 边界生成完整但不越界的 full-stack tasks，保留各自禁止写入范围。
- `REFINE-ADM-000`：TaskDesignAgent 应建立可追踪的 decision task，并将 CEO/部署/安全责任人的决定作为 `REFINE-ADM-002` 的完成前提；不把决定假设为已完成。
- 所有 Issue：本阶段绝不直接下发 `StagePlanner` 或 `ExecTaskAgent`；后者只能在 task/stage 完成后由 `CEOOrchestrator` 指派。

---

## 6. 推荐推进顺序

1. 并行启动 `REFINE-ADM-000`（决策 gate）与 `REFINE-ADM-001`（兼容性/路由验证）。
2. `REFINE-ADM-001` 完成后，开始 `REFINE-ADM-003`；`REFINE-ADM-000` 与 `REFINE-ADM-001` 都完成后，开始 `REFINE-ADM-002`。
3. `REFINE-ADM-002` + `REFINE-ADM-003` 稳定后，推进 `REFINE-ADM-004`。
4. `REFINE-ADM-004` 完成后，并行推进 `REFINE-ADM-005`、`REFINE-ADM-006`、`REFINE-ADM-007`。
5. `REFINE-ADM-005`、`REFINE-ADM-006` 稳定后，才以独立 feature gate 最后开放 `REFINE-ADM-007` 的 system-config mutation；只读 canary 始终先于任何 mutation。
6. 所有前序 Issue 完成后，使用 `REFINE-ADM-008` 进行安全、集成、迁移/回滚和运行时证据收口；public 目标未满足独立安全 blocker 时不得关闭为 public-ready。

```text
REFINE-ADM-000 + REFINE-ADM-001
  ↓
REFINE-ADM-002 + REFINE-ADM-003
  ↓
REFINE-ADM-004
  ↓
REFINE-ADM-005 / REFINE-ADM-006 / REFINE-ADM-007
  ↓
REFINE-ADM-008
```

---

## 7. 阻塞与澄清记录

### [CLARIFICATION_NEEDED] REFINE-ADM-000 / 身份提供方

- 歧义点：当前仓库没有既有 IdP 或登录方式证据，无法指定 production 的 session 实现和 callback 域名。
- 可能解释 A：采用已有成熟 IdP/server-session 方案，`admin_members.identity_subject` 只映射角色。
- 可能解释 B：没有现成 IdP；由决策 owner 确认成熟库与登录方式后再实现，期间 production admin route fail-closed。
- 默认采用解释：B 的 fail-closed 行为；不自建密码散列、签名令牌或 OAuth 协议。
- 需要确认方：`CEOOrchestrator` / 产品部署责任人。
- 是否阻塞 task 阶段：不阻塞 `REFINE-ADM-001` 和 `REFINE-ADM-003` 的规划；阻塞 `REFINE-ADM-002` 的实际身份接入实现与 `REFINE-ADM-008` 的最终发布断言。

### [CLARIFICATION_NEEDED] REFINE-ADM-000 / 暴露模型

- 歧义点：目标是受控内网 internal-only，还是公网 SaaS。
- 可能解释 A：internal-only，按本清单的受保护 `/api/admin/*` 边界交付并明确旧 API 未被加固。
- 可能解释 B：public；必须新增全服务认证、数据 ownership/行级授权和旧 API 加固的独立 design + blocker。
- 默认采用解释：A，依据 `DEC-009`。
- 需要确认方：`CEOOrchestrator` / 产品安全责任人。
- 是否阻塞 task 阶段：不阻塞 internal-only 任务规划；public 宣称与发布被阻塞，直到独立安全前置完成。

### [CLARIFICATION_NEEDED] REFINE-ADM-001 / 部署 Node 运行时

- 歧义点：官方包 engine 为 Node `>=20`，但当前部署环境的 Node 版本保证尚未被确认；`next: "*"` 也不能证明 Next 16 运行时兼容。
- 可能解释 A：部署环境可保证 Node `>=20`，并在锁定 Refine Core/Router 后执行 build、SSR、client navigation 与现有 PWA 回归 spike。
- 可能解释 B：部署环境无法保证 Node `>=20` 或 spike 失败；停止 Admin 发布，撤销尚未发布的依赖/路由变更并回退设计评审。
- 默认采用解释：不宣称 Next 16 运行时兼容，直至 A 的证据齐全。
- 需要确认方：产品部署责任人确认 Node 运行时；`TaskDesignAgent` 将证据门槛写入 task。
- 是否阻塞 task 阶段：不阻塞 `REFINE-ADM-001` 的规划；阻塞该 Issue 的兼容结论、`REFINE-ADM-002` 后的 Admin 发布与 `REFINE-ADM-008` 的最终收口。

### [BLOCKED] public 发布路径（条件性）

- 阻塞原因：旧 `/api/customers`、`/api/todos`、`/api/system-config` 等既有入口没有生产级 session/RBAC；新增 `/api/admin/*` 不能自动保护它们。
- 影响范围：所有将 MVP 表述或部署为 public SaaS 的任务与验收。
- 当前责任 Agent：`TaskDesignAgent` 记录 blocker；`CEOOrchestrator` / 产品安全责任人确认并发起独立安全工作。
- 需要唤醒的 Agent：`CEOOrchestrator`，必要时回退 `DesignArchitect`。
- 建议处理方式：维持 internal-only，或在本清单外先完成全服务认证、ownership/行级授权和旧 API 加固；Admin feature flag 不得被用作绕过此 blocker 的 public 发布开关。
- 是否需要回退到 design：是；只有在选择 public 时需要。

---

## 8. Issue-First 协作说明

* Issue 是最小调度单元；每条 Issue 都有唯一主责、非空依赖、非空关联路径、验收条件和验证方式。
* shared Issue 的主责为 `TaskDesignAgent`，并明确 task 阶段的协作角色、前端/后端边界和联调验收；不得出现无主责 shared 工作。
* 任何实现范围、依赖、阻塞、回退或评审意见必须在对应 Paperclip Issue 评论区以 `@mention` 记录；不假设 Agent 之间存在隐式共享内存。
* 下游只能由 `@TaskDesignAgent` 消费本文件生成 task；`StagePlanner` 只在 task 产物完成后读取，`ExecTaskAgent` 只在 stage 之后由 `CEOOrchestrator` 指派。
* `REFINE-ADM-000` 的决策、`REFINE-ADM-002` 的身份/RBAC 边界和 `REFINE-ADM-008` 的发布结论是跨 Issue 变更点；任何冲突必须回链到本清单和设计稿相应 DEC/AC/RISK，不得静默扩展 MVP。

## 9. Issue 清单自检

- [x] 已读取并遵循 `ISSUE-LIST-FORMAT.md`。
- [x] 含文档元信息、设计稿关联、覆盖/排除范围和关键约束。
- [x] 每条 Issue 含 ID、标题、类型、优先级、标签、描述、输入、允许/禁止写入范围、验收、验证、依赖、路径、分发、主责、协作和设计引用。
- [x] shared Issue 均有唯一主责、协作角色和前后端/联调职责。
- [x] DAG 与可并行边可供下游 task/stage 分析；未直接分发到 stage/execute。
- [x] 已提供 §12.1–§12.9 到 `REFINE-ADM-000`–`008` 的覆盖 / 差异矩阵；Issue 数量、稳定 ID、主责和依赖未变。
- [x] Next 16 仅作为 runtime spike 待实证、Provider/API 契约、`requestId`/错误映射、internal-only/public 与延期安全域边界均已落入对应 Issue 验收。
- [x] 身份、暴露模型与部署 Node 运行时的不确定性已记录为 `[CLARIFICATION_NEEDED]`；public 路径已记录为条件性 `[BLOCKED]`。
