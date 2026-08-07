# 建立管理员身份、RBAC 与受保护布局基础

## 1. 关联 Issue 与任务元数据

- Task ID：`TASK-REFINE-ADM-002`
- 关联 Issue：`REFINE-ADM-002`
- 当前增量同步：[SUO-346](/SUO/issues/SUO-346)
- 权威增量：[`SUO-341 plan revision 1`](/SUO/issues/SUO-341#document-plan)；Issue 合同：
  [SUO-345](/SUO/issues/SUO-345)
- 设计来源：`DESIGN-REFINE-ADMIN-001` §5.1、§5.3–§5.5、§5.8
- domain：`shared`
- 上游类型：`shared`
- 优先级：P0
- 标签：`auth`、`rbac`、`drizzle`、`admin`
- 唯一规划主责：`TaskDesignAgent`
- 后续执行 owner：由 StagePlanner 唯一绑定；本 task 不直接派发。
- 独占所有权：本 task 是 admin schema/migration 的唯一 owner。
- Requirement：[TASK-REQUIREMENT-task_002_shared_admin_auth_rbac.md](./TASK-REQUIREMENT-task_002_shared_admin_auth_rbac.md)

## 2. 任务目标

建立 server-only 管理员身份适配、默认拒绝的三档 RBAC、可复用 route guard 与
protected server layout，并以唯一一次 additive Drizzle 变更创建
`admin_members`、`admin_audit_logs` 基座。

## 3. 输入与输出

### 输入与硬前置

- `TASK-REFINE-ADM-000`：IdP/server-session、subject、callback 域名决策。
- `TASK-REFINE-ADM-001`：已验证的 `/admin` 壳与 `AdminProviders` seam。
- 当前 schema：`app/lib/db/schema.ts`；当前 `ensureInitialized()`：`app/lib/db.ts`。
- 权限矩阵：设计 §5.4；审计字段：设计 §5.8。

IdP 仍未配置时可以完成纯 policy、schema 与 fail-closed adapter，但不得以 mock 身份
宣称 production 认证完成；生产路由必须拒绝访问。

### 输入/输出合同

- `requireAdminIdentity(request/context) -> AdminIdentity | 401/403`：只接受 server
  session 的稳定 subject，查询 active member，绝不向客户端返回 secret。
- `AdminIdentity` 至少含 member id、稳定 subject 的内部引用、展示 email、
  `admin | operator | auditor` role；不含 cookie/session secret。
- `can(resource, action, identity) -> allow/deny`：纯函数、未知 resource/action 默认
  deny。
- protected layout：无 session 跳转 `/admin/login`；未知/disabled member fail
  closed；登录页不被该 layout 包裹。
- schema 输出仅为 `admin_members`、`admin_audit_logs` 及 generated migration/meta。

## 4. 实现步骤

### 后端

1. 校验 `000` 决策；为已确认 IdP 建立 server-only session adapter。未配置时实现
   显式 production fail-closed 分支，不引入开发旁路。
2. 定义 `AdminIdentity` 与 active member lookup 窄接口；email 仅展示/审计，不作为
   唯一授权依据。
3. 定义纯 RBAC 矩阵，精确覆盖 customers、todos、system-config、
   admin-audit-logs；未知 resource/action deny。
4. 建立 route 可复用的 session/permission guard，区分 401 与 403；不得依赖客户端
   provider 结果。
5. 在 `app/lib/db/schema.ts` 一次性增加 `admin_members` 与
   `admin_audit_logs`；字段与设计 §5.4、§5.8 对齐，禁止预留延期域字段。
6. 用 `pnpm db:generate` 生成 additive migration/meta；检查没有 DROP/rename、没有
   业务表变更，也没有向 `ensureInitialized()` 添加 admin DDL。
7. 验证新表先行且 Admin feature flag 关闭时旧应用仍可运行；为 staging 留存备份、
   apply、schema snapshot、失败停止与从已验证备份恢复的证据，不自动执行破坏性 down。
8. 增加 auth、member mapping、policy、guard 与 migration schema 级测试。

### 前端

9. 在 `/admin/(protected)` 建立 Server Component layout；先验证身份，再渲染
   `TASK-REFINE-ADM-001` 约定的 `AdminProviders`/children seam。
10. 登录/退出入口只调用已确认 session 流程；不把 session、signing secret 或
   server-only identity 原文传入客户端。
11. 依据同一 RBAC 矩阵准备三角色导航输入；UI 隐藏只改善体验，不作为安全证明。

### 联调与验收

12. 联调 server layout 与 route guard：未登录页面跳转、未登录 API 401、
    unknown/disabled/无权限 403。
13. 验证客户端即使伪造 `can: true` 或直调 API，服务端仍拒绝。

## 5. 涉及文件路径与修改边界

### 允许修改

- `app/lib/admin/auth.ts`、`app/lib/admin/policy.ts` 及必要的 server-only 单职责类型
  （预期新增）。
- `app/lib/db/schema.ts`、`drizzle/` generated migration/meta（本 task 独占）。
- `app/(admin)/admin/(protected)/layout.tsx`（预期新增）。
- `app/(admin)/admin/login/**`（在 `001` 壳基础上接入真实流程）。
- auth/RBAC/schema 相关 `*.test.ts(x)`、必要的 admin API integration test。

### 只读参考或兼容性保护

- `app/lib/db.ts` 中 `ensureInitialized()`；只用于确认未增加 runtime DDL。
- `app/components/admin/AdminProviders.tsx`；接口由 `001/003` 拥有，本 task 只消费。

### 禁止修改

- `app/api/customers/**`、`app/api/todos/**`、`app/api/system-config/**` 旧入口。
- 具体 admin resource CRUD、通用合同/provider/audit 实现。
- 用户/角色编辑 UI，自建密码散列、token 签名、OAuth 协议。
- `chat-schema.ts`、`claude-agent-kit/**`、延期域 schema、外部仓库与 XML。

## 6. 依赖项与 DAG

- 前置：`TASK-REFINE-ADM-000`、`TASK-REFINE-ADM-001`。
- 可与 `TASK-REFINE-ADM-003` 的合同/provider 主体并行；双方通过
  `AdminProviders(children)` 与 server guard 窄接口协作。
- 与 `003` 共同解锁 `TASK-REFINE-ADM-004`。
- schema/migration 所有权不向 `004`–`007` 下放。

## 7. 前端 / 后端 / 联调边界

- 后端：session adapter、member lookup、policy、guard、两张表与唯一 migration。
- 前端：protected server layout、登录/退出入口与基于角色的导航输入。
- 联调：页面重定向、API 401/403、直调拒绝；客户端状态不影响服务端裁决。
- 验收：后端证明 policy/guard/schema；前端证明导航与跳转；联调证明 fail-closed。

## 8. 测试策略

### Happy path

- 已确认 subject 映射到 active admin/operator/auditor；protected page 可进入；策略对
  允许动作返回 allow；migration 只新增两张表。

### Failure path

- 无 session 返回 401/页面跳转；未知或 disabled member、无权限 action 返回 403；
  未知 resource/action 默认 deny；伪造客户端权限无法绕过 API。
- 模拟 IdP 未配置，production admin route 始终 fail-closed。

### 最小验证命令/方式

- `pnpm db:generate`，随后 review generated SQL/meta 与 schema diff。
- `rg -n "DROP TABLE|DROP COLUMN|ALTER TABLE .* DROP|RENAME" drizzle`（预期无本次破坏性命中）。
- `pnpm test:run -- app/lib/admin/auth.test.ts app/lib/admin/policy.test.ts`，并单独运行
  admin guard integration test。
- protected layout 三角色 smoke；验证 feature flag 关闭 + 新表已存在时旧 PWA 可运行。
- 断言 `ensureInitialized()` 无新增 admin DDL；`git diff --check -- app drizzle`。

## 9. 完成标志

- [ ] IdP gate 已消费；未配置分支明确 fail-closed。
- [ ] 401/403、unknown/disabled、未知 resource/action 均有测试证据。
- [ ] protected server layout 不包裹 login，且不泄露 server secret。
- [ ] schema/migration 仅新增两张 admin 表，无 runtime DDL 或破坏性 SQL。
- [ ] staging backup/apply/schema snapshot 与失败恢复证据齐全；flag-off schema-forward
  兼容已验证。
- [ ] 三角色矩阵与设计完全一致。
- [ ] 完成信号包含 migration 文件、测试结果和给 `004` 的 guard/policy 接口。

## 10. 非目标

- 资源 CRUD、audit writer/UI、动态角色管理、多租户/行级权限。
- public 全服务安全加固、旧 API 改造或普通用户认证。
- 扩展 schema 到用户、Story、模型、计费或网关。

## 11. 风险、阻塞与回退

- 硬门槛：IdP/callback 未确认。Owner：`CEOOrchestrator / 产品部署责任人`；action：
  完成 `000` 决策。未解锁时仅允许 fail-closed 基础，不得宣称生产认证完成。
- 风险：`app/lib` 稳定层被过度重构。Owner：后续执行 owner；action：只加
  `app/lib/admin` 单职责窄接口。
- 回退：迁移失败时停止发布并从已验证备份恢复；不自动 DROP。身份决策若推翻
  `DEC-007`，回到设计阶段，不在此 task 内改协议。
