# Refine 管理后台验证架构设计

> Design ID: `DESIGN-REFINE-ADMIN-001`
> 设计基线: [SUO-340](/SUO/issues/SUO-340)
> 增量校正: [SUO-341](/SUO/issues/SUO-341)
> 上游编排: [SUO-339](/SUO/issues/SUO-339)
> 历史方案: [SUO-337](/SUO/issues/SUO-337)
> 状态: SUO-341 可评审增量；确认前禁止进入 issue/task/stage/execute
> 基线日期: 2026-08-07
> 官方资料访问日期: 2026-08-07
> 验证提交: `5ee4aa673a42e7c044c6664df1d2ee4929aa235f`

## 1. 背景与目标

历史方案把 `ink-admin-memory-output` 描述成独立的管理后台代码项目，并一次性规划用户中心、Story 数据、模型注册、Token 计费、代理网关、权限与审计。该方案明确承认当时无法访问目标仓库，因此其中的目录、依赖、数据表和工期均是待验证假设。

本设计以本次 Issue 正式指定的工作区 `/Users/dmeck/project/ink-admin-memory` 为证据源，目标是：

1. 裁决真实代码基线和 `ink-admin-memory-output` 命名冲突。
2. 给出 Refine 与现有 Next.js App Router 的最小侵入式接入边界。
3. 把 MVP 收敛到当前数据模型能够支撑的内部管理能力。
4. 明确服务端鉴权、RBAC、密钥和审计边界，避免把 Refine 的客户端能力误当安全边界。
5. 为 IssueDispatcher 提供可直接消费的验收口径和建议拆分边界。

### 1.1 基线裁决

当前仓库就是本流水线的目标管理后台代码基线，理由如下：

- [SUO-340](/SUO/issues/SUO-340) 明确指定该工作区并限制仅在此仓库产出设计。
- 当前 Git 分支是 `feat/claude-agent-kit`，远端是 `glide-the/claude-agent-next-kit`；包名为 `ai4sales-pwa-app`，这些名称虽然不一致，但都指向同一份被正式指派的 checkout。
- 工作区不存在 `ink-admin-memory-output/` 目录；`ink-admin-memory-output.xml` 是未跟踪的 Repomix 聚合文件，文件头明确要求只读并修改原始仓库文件。

因此，后续实现中的“只改 `ink-admin-memory-output`”统一解释为：**只修改当前 `ink-admin-memory` checkout 内的原始仓库文件，绝不修改 Repomix XML，也不访问或修改 `ink-dream-memory`、`story-workspace`。**

这是一项流水线代码基线裁决，不代表仓库的产品名或 npm 包名需要在本期重命名。

## 2. 真实仓库证据与差距矩阵

### 2.1 核验命令

本设计使用以下只读命令核验：

```bash
git status --short --branch
git remote -v
git branch --show-current
rg --files app drizzle tests docs/design
rg -n -i 'refine|auth|rbac|billing|ledger|gateway|audit' app package.json drizzle tests
rg -n 'CREATE TABLE|ALTER TABLE' drizzle/*.sql
npm view @refinedev/core version peerDependencies --json
npm view @refinedev/nextjs-router version peerDependencies dependencies --json
```

### 2.2 能力矩阵

| 能力 | 真实证据 | 当前结论 | MVP 处理 |
| --- | --- | --- | --- |
| 前端框架 | `package.json`：Next.js `16.1.6`、React `19.0.0`、App Router | 可承载 Refine，但尚无集成 | 新建隔离的 `/admin` 路由树 |
| Refine | `package.json` 无 `@refinedev/*` | 历史方案未落地 | 仅引入 Core 与 Next.js router，先做编译兼容验证 |
| UI 体系 | Tailwind 4 + 现有自定义组件，无 Ant Design | 历史方案的 `@refinedev/antd` 会引入第二套 UI | MVP 使用 headless Refine Core 和现有样式体系 |
| 查询缓存 | 已有 `@tanstack/react-query ^5.90.20` 和根 `QueryClientProvider` | 与当前 Refine Core peer 范围相容 | 复用现有 Query Client，不制造第二套全局缓存 |
| 页面 | `app/(app)` 只有 customers 页面；根页面是 AI Sales PWA | 没有管理后台路由或布局 | 保留现有页面，新增 `/admin` 命名空间 |
| API | customers/todos 有 CRUD；conversations 为列表与部分更新；system-config 为单例 GET/PUT | 可复用领域查询，但协议不完全统一 | 新增受保护的 `/api/admin/*` 薄适配层 |
| 数据库 | `customers`、`todos`、`conversations`、`system_configs` 四类表 | 没有用户、角色、计费、模型注册、网关或后台审计表 | MVP 只增加管理员成员映射和审计日志所需最小表 |
| 鉴权 | 上传 API 明示生产环境鉴权 TODO；其余业务 API 无 session/RBAC 检查 | 当前服务不具备生产级访问控制 | 管理台必须 fail-closed；公网发布另设全服务安全门槛 |
| 模型配置 | `system_configs` 只有当前 `provider`/`model`/prompt 等单例设置 | 不是 Model Registry，也不含价格或密钥模型 | 仅作为“运行设置”管理，不包装成模型中心 |
| 计费/网关 | 无 schema、route 或 lib 实现 | 历史方案仅是愿景 | 全部延期，不作为 Refine MVP 的隐式依赖 |
| 审计 | `docs/design/security-audit-design.md` 是 Claude 工具安全审计设计，`app/` 无对应实现 | 不能当作后台操作审计能力 | 新增独立、不可变的 admin audit 边界 |
| 外部 Story 数据 | 当前 checkout 未观察到 `ink-dream-memory` 或 `story-workspace` 代码/契约 | 无法设计可执行数据接入 | 延期，等待独立接口与数据所有权协议 |

### 2.3 Refine 兼容性证据

2026-08-07 的 npm 官方 registry 查询结果：

- `@refinedev/core` 为 `5.0.12`，peer 支持 React 18/19、React DOM 18/19、TanStack Query `^5.81.5`，engine 要求 Node.js `>=20`。
- `@refinedev/nextjs-router` 为 `7.0.5`，peer 要求 Refine Core `^5.0.0`、React 18/19，Next 声明为 `*`，engine 要求 Node.js `>=20`。
- 当前仓库为 React `19.0.0`、React DOM `19.0.0`、TanStack Query `^5.90.20`；本次验证环境 Node.js 为 `v24.13.0`，没有已声明 peer/engine 冲突。

该结果证明现有 React 19、TanStack Query 和本次 Node 环境不触发已声明的 peer/engine 冲突；它**不能证明** Next.js 16 的运行时行为，也不能证明未来部署环境满足 Node `>=20`。下游第一项实现工作必须锁定版本，显式声明/核验部署 Node 版本，并用实际 App Router 页面完成编译、服务端渲染与导航验证。

Refine 官方 Next.js 指南明确 App Router 使用 `@refinedev/nextjs-router`，`<Refine>` 及 provider 函数需要位于客户端组件中；其 Data Provider、Auth Provider 和 Access Control Provider 分别承担数据适配、会话交互和客户端权限体验。服务端仍必须独立执行授权。

参考：

- <https://refine.dev/core/docs/routing/integrations/next-js/>
- <https://refine.dev/docs/data/data-provider/>
- <https://refine.dev/core/docs/authentication/auth-provider/>
- <https://refine.dev/core/docs/guides-concepts/authorization/>

## 3. 范围界定

### 3.1 MVP 范围

MVP 定位为：**当前服务的内部运营管理台**，不是完整 SaaS 控制面。

包含：

1. `/admin` 独立路由、登录入口、受保护布局和 Refine provider。
2. 管理员会话适配、三档 RBAC、服务端权限检查。
3. `customers` 管理资源：列表、详情、新建、编辑；删除仅 admin。
4. `todos` 管理资源：列表、详情、新建、编辑；删除仅 admin。
5. `system-config` 单例运行设置：查看；仅 admin 可编辑白名单字段。
6. `admin-audit-logs`：记录并只读查询管理台的变更操作。
7. 自定义 Refine Data Provider，适配仓库统一后的 admin API 契约。
8. 最小数据库迁移、单元/集成/E2E 验证及现有 PWA 路由回归。

### 3.2 延期范围

以下内容不进入 MVP：

- 平台普通用户中心、套餐、额度、用户模型权限。
- Story 项目、外部 Story 数据库或 `story-workspace` 读取。
- AI Provider/Model Registry、定价规则和密钥轮换。
- Token usage、余额账户、账务流水、报表。
- Claude/OpenAI 兼容代理网关、限流、用量解析、计费扣款。
- conversations 消息/附件的管理台暴露；其敏感内容需另行设计脱敏和授权。
- 通用权限编辑器、动态角色设计器、多租户和行级权限。
- 实时订阅、批量导入导出、富仪表盘。
- Ant Design/MUI 等第二套组件库。

### 3.3 明确禁止

- 修改 `ink-admin-memory-output.xml`。
- 引入或修改 `ink-dream-memory`、`story-workspace` 业务代码。
- 把 API key、访问令牌或完整密钥返回给浏览器。
- 仅靠 Refine `accessControlProvider` 隐藏按钮来实现授权。
- 在 `app/api/**/route.ts` 堆叠数据库查询或复杂领域逻辑。
- 为接入 Refine 重构 `chat-schema.ts` 或 `claude-agent-kit`。

## 4. 方案摘要

采用“同仓、同部署、路由与协议隔离”的架构：

```mermaid
flowchart LR
    Browser[Admin Browser] --> AdminUI[/admin explicit routes]
    AdminUI --> Refine[Refine Core + Next.js Router]
    Refine --> Provider[Custom Data/Auth/Access Providers]
    Provider --> AdminAPI[/api/admin/*]
    AdminAPI --> Guard[Server Session + RBAC]
    Guard --> Lib[app/lib domain queries]
    Lib --> DB[(Existing PostgreSQL)]
    Guard --> Audit[Immutable Admin Audit Writer]
    Audit --> DB
    LegacyUI[Existing PWA] --> LegacyAPI[/api/customers etc.]
    LegacyAPI --> Lib
```

核心原则：

- Refine 只承担管理台资源编排与交互，不拥有领域数据。
- `/admin` 与现有 PWA 使用不同布局，避免改写现有 `app/(app)/layout.tsx`。
- `/api/admin/*` 是安全与协议适配边界；route 只解析、校验、鉴权、编排。
- 领域数据仍由 `app/lib/db.ts` / `app/lib/db/schema.ts` 拥有；管理台不得复制业务表。
- 管理台变更必须在同一次服务端操作中产生可追踪审计结果。

## 5. 详细设计

### 5.1 路由与布局边界

建议目录形态：

```text
app/
├── (app)/                         # 现有 PWA，保持现状
├── (admin)/
│   └── admin/
│       ├── login/page.tsx         # 不受 protected layout 包裹
│       └── (protected)/
│           ├── layout.tsx         # 服务端 requireAdminSession
│           ├── page.tsx           # 导航入口，不做重仪表盘
│           ├── customers/...
│           ├── todos/...
│           ├── settings/...
│           └── audit/...
├── components/admin/              # 可复用管理台 UI
└── api/admin/                      # 受保护的管理 API
```

约束：

- URL 前缀固定为 `/admin`；route group 不进入 URL。
- protected layout 保持 Server Component，先验证 session，再渲染一个带 `"use client"` 的 `AdminProviders`。
- `AdminProviders` 挂载 `<Refine>`、`routerProvider`、data/auth/accessControl providers；不得把 server-only session 或 secret 传入客户端。
- 使用显式 App Router 页面，不用顶层 `[[...refine]]` catch-all，防止吞掉现有 PWA 路由和 404。
- Refine resource action 使用 `:id` 描述，物理目录继续使用 Next.js `[id]`。
- App Router 下官方 `UnsavedChangesNotifier` 存在限制；MVP 不把它列为可靠验收项。需要脏表单提示时由具体表单页实现。

建议资源声明：

| Resource | List | Create | Show | Edit | Delete |
| --- | --- | --- | --- | --- | --- |
| `customers` | `/admin/customers` | `/admin/customers/create` | `/admin/customers/show/:id` | `/admin/customers/edit/:id` | 权限动作，无独立页面 |
| `todos` | `/admin/todos` | `/admin/todos/create` | `/admin/todos/show/:id` | `/admin/todos/edit/:id` | 权限动作，无独立页面 |
| `system-config` | 不使用普通列表 | 不允许 | `/admin/settings` | `/admin/settings/edit` | 不允许 |
| `admin-audit-logs` | `/admin/audit` | 不允许 | `/admin/audit/show/:id` | 不允许 | 不允许 |

### 5.2 Provider 边界

#### Data Provider

实现自定义 Data Provider，不直接采用 `simple-rest`，因为现有 API 使用 `page/pageSize/search/sort/order` 和 `{data, meta}`，且单例配置、错误结构、删除响应都不是通用 simple-rest 约定。

映射规则：

| Refine 方法 | Admin API | Admin API 响应 | Data Provider 返回 |
| --- | --- | --- | --- |
| `getList` | `GET /api/admin/{resource}` | `{ data: T[], meta: { page, pageSize, total, totalPages } }` | `{ data: T[], total: meta.total }` |
| `getOne` | `GET /api/admin/{resource}/{id}` | `{ data: T }` | `{ data: T }` |
| `create` | `POST /api/admin/{resource}` | `{ data: T }` | `{ data: T }` |
| `update` | `PATCH /api/admin/{resource}/{id}` | `{ data: T }` | `{ data: T }` |
| `deleteOne` | `DELETE /api/admin/{resource}/{id}` | `{ data: { id } }` | `{ data: { id } }` |
| system config `getOne` | `GET /api/admin/system-config` | `{ data: SystemConfig }`，id 固定为 `default` | `{ data: SystemConfig & { id: "default" } }` |
| system config `update` | `PUT /api/admin/system-config` | `{ data: SystemConfig }` | `{ data: SystemConfig & { id: "default" } }` |

公共约束：

- API 错误统一为 `{ error: { code, message, details?, requestId } }`；Data Provider 必须转换成 Refine `HttpError`（至少含 `message`、`statusCode`，可附带稳定 `code`），不得把服务端堆栈或原始敏感 details 透传给 UI。
- `page >= 1`；`1 <= pageSize <= 100`；sort/filter 只允许各资源声明的字段。
- Refine filters/sorters 必须显式翻译，禁止把任意客户端字段拼进 SQL 或转发到通用代理。
- 未知 resource、action、sort 或 filter 返回 400/404，fail closed。
- 所有请求携带 same-origin cookie；客户端不得持有数据库凭证或 provider secret。
- 401 触发登录流程，403 保留在当前页并显示权限错误，409 显示冲突提示，5xx 使用通用错误文案。

#### Auth Provider

Refine `authProvider` 只封装登录、退出、`check`、`getIdentity` 和错误后的导航。真实 session 验证必须发生在 protected server layout 与每个 admin API route。

#### Access Control Provider

`accessControlProvider.can({ resource, action })` 镜像服务端权限矩阵，用于菜单、按钮和页面体验。即使客户端返回 `can: true`，服务端策略仍是最终裁决者。

### 5.3 管理 API 与 `app/lib` 分层

建议边界：

```text
app/api/admin/**/route.ts
  request parse -> zod -> require session -> require permission
  -> call app/lib existing query/domain function
  -> write sanitized audit outcome -> uniform response

app/lib/admin/
  auth.ts       # server-only session -> AdminIdentity
  policy.ts     # pure RBAC matrix
  contracts.ts  # zod input/query/output contracts
  audit.ts      # immutable sanitized audit writer
```

`app/lib/admin` 是新增但稳定的单一领域子模块。不得把 Refine hook、React 组件或路由对象放入其中。

复用策略：

- customers/todos 继续调用现有 `list/get/create/update/delete` 数据函数。
- system-config 继续调用 `getSystemConfig` / `upsertSystemConfig`，但 admin contract 只开放白名单字段。
- 需要事务性审计或更严格更新条件时，在 `app/lib` 内增加窄接口；不得在 route 中直接操作 Drizzle。
- 不改 chat 请求体和 Claude Agent 协议。

### 5.4 认证与 RBAC

生产会话采用 server-side、HttpOnly、Secure、SameSite cookie；管理员身份由外部身份 subject 映射到本库成员，不在本设计中自建密码学实现。

最小成员模型：

```text
admin_members
- id
- identity_subject     # 外部身份提供方稳定 subject，唯一
- email                # 展示/审计，不作为唯一授权依据
- role                 # admin | operator | auditor
- status               # active | disabled
- created_at
- updated_at
```

最小权限矩阵：

| Resource/action | auditor | operator | admin |
| --- | --- | --- | --- |
| customers list/show | allow | allow | allow |
| customers create/update | deny | allow | allow |
| customers delete | deny | deny | allow |
| todos list/show | allow | allow | allow |
| todos create/update | deny | allow | allow |
| todos delete | deny | deny | allow |
| system-config show | allow | allow | allow |
| system-config update | deny | deny | allow |
| admin-audit-logs list/show | allow | allow | allow |
| admin member/role administration | deny | deny | 延期，不在 UI 暴露 |

返回语义：

- 无有效 session：401。
- 成员不存在、disabled 或 role 不允许：403。
- 权限判断默认 deny；新 resource/action 未进入矩阵时不得自动开放。

### 5.5 数据所有权与最小 schema 变化

| 数据 | 所有者 | MVP 管理能力 | 说明 |
| --- | --- | --- | --- |
| `customers` | 当前应用数据库 | list/show/create/update，admin delete | 复用现有表，不复制 |
| `todos` | 当前应用数据库 | list/show/create/update，admin delete | 复用现有表，不复制 |
| `system_configs` | 当前应用数据库 | show，admin update | 仅单例运行设置，不等于模型注册中心 |
| `conversations` | 当前应用数据库 | 不暴露 | 消息、附件与 AI 输出需要另行脱敏设计 |
| `admin_members` | 管理安全域 | session subject 到 role 映射 | 新增最小表 |
| `admin_audit_logs` | 管理安全域 | 只写、list/show | 新增最小表，不支持 UI 修改/删除 |
| 用户/Story/计费/网关数据 | 当前仓库不存在 | 无 | 延期，禁止先造镜像表 |

所有 schema 变更只进入 `app/lib/db/schema.ts`（或既有 `app/lib/db/**` 约定位置），迁移由 `pnpm db:generate` 生成并提交到 `drizzle/`。不得手写一份与 schema 不一致的平行数据模型。当前 `app/lib/db.ts` 的 `ensureInitialized()` 仍包含既有 runtime DDL；新的 `admin_members` / `admin_audit_logs` 不得再复制到该路径，Drizzle migration 是后台新增 schema 的唯一来源。

### 5.6 System Config 白名单

管理台可以读取配置，但只向 admin 更新以下字段：

- `system_prompt`
- `model`
- `provider`
- `workspace_enabled`

`theme` 是现有 PWA 用户体验偏好，不作为管理台运行控制项；`extras` 是开放 JSON，MVP 不允许在管理台读写，以免未知敏感字段泄漏或被任意覆盖。

### 5.7 密钥边界

- Provider API key、数据库凭证、session signing secret 只存在于部署 secret manager / 环境注入。
- `system_configs` 只保存非秘密标识，不保存明文 key。
- Data Provider、Refine 页面、浏览器日志、审计日志均不得包含 secret。
- 若未来需要密钥轮换，应设计 write-only secret endpoint，只返回掩码和版本元数据；不复用 system-config 通用 JSON。

### 5.8 审计边界

最小审计模型：

```text
admin_audit_logs
- id
- request_id
- actor_member_id
- action
- resource
- resource_id
- outcome              # success | denied | failed
- changed_fields       # 字段名列表，不保存敏感值
- reason_code
- created_at
```

要求：

- create/update/delete 和 system-config update 必须记录 actor、资源、结果和 request id。
- denied/validation failed 可以记录原因码，但不记录完整请求体、手机号、邮箱、prompt 或 secret。
- 审计日志对所有角色只读；应用路由不提供 update/delete。
- 业务变更与 success 审计应尽可能处于同一事务。若审计写入失败，敏感变更默认失败；若采用 outbox，必须由下游另行明确一致性保证。

### 5.9 既有无鉴权 API 的发布约束

当前 `/api/customers`、`/api/todos`、`/api/system-config` 等路由没有生产级 session/RBAC。新增受保护的 `/api/admin/*` **不会自动保护同一数据的旧入口**。

因此：

- MVP 默认运行模型是内网/受控网络中的内部运营台。
- 公网生产发布前，必须完成全服务认证、普通用户数据所有权/行级授权和旧 API 加固，或通过可信网关完全阻断未认证访问。
- E2E 中“admin API 未授权返回 401/403”只证明 admin 边界有效，不能被表述为整个 PWA 已安全。

这是发布门槛，不允许用隐藏菜单、前端路由保护或 `/api/admin` 前缀替代。

## 6. 验收标准

### 基线与边界

- `AC-001`：所有实现只修改当前 `ink-admin-memory` checkout 的原始文件；`ink-admin-memory-output.xml`、`ink-dream-memory`、`story-workspace` 均无改动。
- `AC-002`：`/admin` 使用独立布局；现有 `/`、`/customers` 及既有 API 路径行为没有由 Refine 路由接管或重定向。
- `AC-003`：依赖使用 `@refinedev/core` 5.x 与 `@refinedev/nextjs-router` 7.x 的锁定版本；不引入 `@refinedev/react-router` 或 Ant Design。

### 安全

- `AC-004`：未登录访问 protected admin 页面时跳转登录；未登录直调 admin API 返回 401。
- `AC-005`：RBAC 在服务端按本设计矩阵执行；至少验证一次“客户端隐藏按钮”和一次“绕过 UI 直调 API 仍返回 403”。
- `AC-006`：disabled/未知成员默认拒绝；未知 resource/action 默认拒绝。
- `AC-007`：浏览器响应、日志和审计中不出现 API key、数据库凭证、session secret；`extras` 不在 admin system-config contract 中。
- `AC-008`：每次允许的管理变更产生 sanitized audit 记录；审计写入失败时不会静默完成敏感变更。

### 数据与协议

- `AC-009`：Data Provider 完成 customers/todos 标准方法与 system-config 单例方法映射，正确返回 `data` 和分页 `meta`。
- `AC-010`：admin API 对 query/body 使用 zod；分页有上下界，sort/filter 有字段白名单，错误结构统一。
- `AC-011`：customers、todos、system-config 继续由当前领域/DB 层拥有；route 中没有复制查询或直接堆叠 Drizzle 逻辑。
- `AC-012`：新增 schema 只包含管理成员映射和后台审计的最小数据；没有提前创建用户套餐、Story、模型价格、账务或网关表。

### UI 与验证

- `AC-013`：auditor、operator、admin 三种身份看到的资源和动作与权限矩阵一致；403/404/409/5xx 有明确但不泄密的反馈。
- `AC-014`：至少覆盖一个完整 happy path（admin 登录、浏览并更新资源、看到审计记录）和一个 failure path（operator 删除或未登录 API 被拒绝）。
- `AC-015`：实现提交至少通过受影响范围 lint、Data Provider/RBAC 单测、admin API 集成测试、admin E2E 和现有 customers E2E 回归。
- `AC-016`：若目标为公网发布，必须另有全服务认证与旧 API 加固验收证据；否则交付说明必须明确标注 internal-only。

## 7. 风险与依赖

| ID | 风险/依赖 | 影响 | 缓解/门槛 |
| --- | --- | --- | --- |
| `RISK-001` | Next.js 16 仅被 router package 以 `next: "*"` 声明接受 | peer 无冲突仍可能有运行时差异 | 先完成实际编译、导航、动态路由 spike |
| `RISK-002` | App Router 的部分 Refine 辅助组件有限制 | 脏表单提示/标题能力可能不可用 | 不纳入 MVP 基线，页面级处理 |
| `RISK-003` | 现有业务 API 无鉴权 | `/api/admin` 安全不等于全服务安全 | internal-only；公网前完成全服务加固 |
| `RISK-004` | 当前数据无 owner/user 外键 | 无法实现普通用户行级权限 | 不宣称多租户/公网 SaaS，另行设计所有权迁移 |
| `RISK-005` | 身份提供方尚未由上游明确 | session 实现与部署配置不确定 | 见下方默认假设；auth 工作流进入实现前确认 |
| `RISK-006` | customers 含联系方式，conversations 含消息/附件 | PII 泄漏 | 最小角色授权、审计脱敏；conversations 延期 |
| `RISK-007` | system-config 是现有 PWA 运行设置 | 错误修改可影响 AI 行为 | admin-only 更新、字段白名单、审计、确认提示 |
| `RISK-008` | `app/lib` 是稳定层 | 大规模重构会提高回归风险 | 仅加窄接口和 `app/lib/admin` 单职责子模块 |

### 7.1 [CLARIFICATION_NEEDED] 生产身份提供方

上游没有提供既有 IdP 或登录方式。默认假设为：

- 采用一个成熟的 Next.js server session 方案，通过 HttpOnly cookie 返回稳定 identity subject；
- 同库 `admin_members` 只做 subject 到角色的映射，不自建密码散列、令牌签名或 OAuth 流程；
- 未配置身份提供方时，production admin 路由 fail closed。

Unblock owner：CEOOrchestrator / 产品部署责任人。

Unblock action：在 auth 实现工作开始前指定现有 IdP/会话方案及回调域名；若没有现成 IdP，确认一个成熟库与登录方式。该选择不改变本文路由、RBAC、Data Provider 或数据所有权边界。

### 7.2 [CLARIFICATION_NEEDED] 暴露模型

默认按 internal-only 交付。若目标是公网 SaaS，必须把“全服务认证 + 业务数据 ownership + 旧 API 加固”作为 Refine 资源上线前的一等 blocker，不能在 UI 完成后补记为非阻塞风险。

Unblock owner：CEOOrchestrator / 产品安全责任人。

Unblock action：明确 internal-only 或 public；public 时创建并前置完整安全基础工作。

## 8. 关键决策记录

### `DEC-001` 当前 checkout 是目标代码基线

- 决策：当前 `/Users/dmeck/project/ink-admin-memory` 是本流水线唯一可修改代码基线。
- 原因：正式 Issue 指定、原始文件完整；`ink-admin-memory-output.xml` 只是只读聚合产物。
- 影响：下游不得创建或寻找同名 output 代码目录。

### `DEC-002` 使用 Refine Core + Next.js Router

- 决策：使用 `@refinedev/core` 与 `@refinedev/nextjs-router`。
- 原因：与当前 App Router 匹配；历史方案的 React Router 包不适用此路由基线。
- 影响：先做 Next 16 实编译验证。

### `DEC-003` 不引入第二套 UI 框架

- 决策：MVP 使用 headless Refine 和现有 Tailwind/组件。
- 原因：降低依赖、样式冲突和迁移面积。
- 影响：CRUD 页面需要项目内组件，不依赖 Ant Design 自动生成体验。

### `DEC-004` `/admin` 与现有 PWA 隔离

- 决策：显式 `/admin` App Router 路由树和 protected layout。
- 原因：避免侵入现有 PWA 布局、导航和会话上下文。

### `DEC-005` 新建受保护的 admin API 适配层

- 决策：Refine 只调用 `/api/admin/*`，由其统一协议、鉴权和审计。
- 原因：现有 API 协议不一致且无 RBAC；直接适配会混淆安全边界。
- 限制：旧 API 仍需单独加固，见 `DEC-009`。

### `DEC-006` MVP 只管理现存业务资源

- 决策：customers、todos、system-config 入 MVP；conversations、用户/Story/计费/网关延期。
- 原因：只为真实数据与接口设计，不提前制造愿景表。

### `DEC-007` 服务端授权是唯一安全裁决

- 决策：Refine auth/access providers 只改善客户端体验，server layout/API 每次独立验证 session 和 permission。
- 原因：客户端状态可伪造、可绕过。

### `DEC-008` 管理审计独立于 Claude 工具审计

- 决策：新增 admin audit 数据边界，不复用未实现的 Claude security audit 设计。
- 原因：事件主体、敏感字段和一致性要求不同。

### `DEC-009` MVP 默认为 internal-only

- 决策：未完成全服务认证和数据 ownership 前，不宣称公网生产就绪。
- 原因：旧业务 API 仍可绕过 `/api/admin`。

### `DEC-010` system-config 不是模型注册中心

- 决策：仅管理当前 provider/model/prompt/workspace 开关，隐藏 `extras` 与所有 secret。
- 原因：真实 schema 是单例运行设置，不包含 registry、价格或密钥生命周期。

## 9. IssueDispatcher Handoff

本节只描述未来可采用的设计边界，不代表已授权创建 Issue、Task 或 Stage。必须等待 [SUO-341](/SUO/issues/SUO-341) 的 plan revision 获得结构化确认，随后仍由 CEOOrchestrator 按固定流水线另行调度；DesignArchitect 不执行拆解或分发。

建议按以下工作边界拆分，具体 Issue、Task 和 Stage 由对应下游 Agent 生成：

1. **兼容性与路由壳层**：锁定 Refine 依赖，验证 Next 16 App Router、显式路由和现有 PWA 回归。
2. **认证/RBAC 与发布门槛**：实现 server session adapter、admin_members、纯策略矩阵、protected layout；先收敛身份提供方和 internal/public 决策。
3. **Admin API 契约与 Data Provider**：统一 zod、分页/排序/过滤、错误映射和 resource allowlist。
4. **审计基础设施**：schema/migration、sanitized writer、敏感变更一致性和只读查询。
5. **Customers 资源**：按角色实现 list/show/create/update/delete 与 API/UI 测试。
6. **Todos 资源**：按角色实现 list/show/create/update/delete 与 API/UI 测试。
7. **System Config 资源**：单例 show/update、字段白名单、确认与审计。
8. **集成与安全验证**：三角色 E2E、直调 API deny、secret 检查、现有 customers 回归及 internal-only/public 交付标记。

依赖建议：

- 认证/RBAC 是所有受保护 API 和资源验收的前置。
- API 契约/Data Provider 可以与审计 schema 设计并行，但资源 mutation 必须等待两者可用。
- Customers、Todos 在公共 provider 和权限测试基座完成后可并行。
- System Config 必须等待审计与 admin-only 策略完成。
- 集成与安全验证在全部 MVP 资源之后收口；public 模式还必须等待旧 API 加固。

下游不得把延期模块混入上述 Issue 以“顺手预留”schema、route 或 secret 字段。

## 10. 增量变更说明

### 2026-08-07 / 初始验证版

- 以真实工作区替代历史方案中的不可访问仓库假设。
- 将 `ink-admin-memory-output` 从“代码目录”纠正为只读 Repomix 文件语义。
- 将 Refine 路由包从 React Router 修正为 Next.js Router。
- 将 Ant Design 与大而全 SaaS 模块移出 MVP。
- 增加 `/admin` 路由隔离、admin API 契约、服务端 RBAC、密钥与审计边界。
- 明确旧 API 无鉴权导致的 internal-only 发布门槛。
- 给出身份提供方与暴露模型的默认假设、owner 和 unblock action。

### 2026-08-07 / SUO-341 增量校正版

- 以当前 Refine v5 官方文档、官方 GitHub release 和 npm 官方 registry 重新核验 App Router、Provider 契约、React 19/Next 16 兼容性，并记录访问日期与证据强度。
- 修正 `DataProvider.getList` 返回契约：Admin API 的分页 `meta` 必须被适配为 Refine 的顶层 `total`。
- 补充 Story 只读、密钥加密/脱敏，以及延期计费、额度、限流、Proxy Gateway 的安全先决条件；这些约束不扩大 MVP。
- 增加 additive migration、渐进发布、兼容和非破坏回滚策略。
- 对原稿的数据库命名、`src/router.tsx`、独立 `backend`、工期估算和 Proxy Gateway 逐项裁决。
- 建立确认门禁：确认前不得创建实现任务或进入下游阶段。

## 11. 阻塞或澄清说明

本设计已达到可评审状态，当前没有阻止设计阶段交付的证据缺口；但在 [SUO-341](/SUO/issues/SUO-341) 的最新 plan revision 获得确认前，禁止下游拆解或实现。两个 `[CLARIFICATION_NEEDED]` 均已有默认假设和明确 owner/action：

- internal-only 路径可继续拆解和实现；
- public 路径必须在资源上线前增加全服务安全 blocker；
- 身份提供方选择必须在 auth 实现工作开始前收敛，未配置时 production fail closed。

任何后续新证据若改变 `DEC-001`、`DEC-005`、`DEC-006` 或 `DEC-009`，应增量更新本文，并在对应 Issue 评论中交叉引用决策 ID；不得另建冲突主文档。

## 12. SUO-341 增量校正包

本节只记录相对 [SUO-340](/SUO/issues/SUO-340) 的新增或变化项。未在本节变更的 `DEC-001` 至 `DEC-010`、`AC-001` 至 `AC-016` 及正文边界继续有效。

### 12.1 官方验证快照与证据强度

访问日期均为 `2026-08-07`；以下六个链接在最小验证中均返回 HTTP 200：

| 来源 | 已验证内容 | 证据结论 |
| --- | --- | --- |
| [Refine Next.js integration](https://refine.dev/core/docs/routing/integrations/next-js/) | App Router 使用 `@refinedev/nextjs-router`；Resource 路径由 App Router 页面承载；`<Refine>` 与函数型 providers 位于 client boundary；页面级 auth/access 推荐服务端检查；App Router 不支持官方 `UnsavedChangesNotifier` | 已验证官方契约 |
| [Refine Data Provider](https://refine.dev/core/docs/data/data-provider/) | `getList/create/update/deleteOne/getOne/getApiUrl` 等方法契约；`getList` 返回 `{ data, total }`；错误转换为 `HttpError` | 已验证官方契约 |
| [Refine Auth Provider](https://refine.dev/core/docs/authentication/auth-provider/) | `login`、`logout`、`check`、`onError`、`getIdentity`/`getPermissions` 的异步响应边界 | 已验证官方契约 |
| [Refine authorization](https://refine.dev/core/docs/guides-concepts/authorization/) | `accessControlProvider.can({ resource, action, params }) -> { can, reason? }`；UI 集成负责可见性体验 | 已验证官方契约；不是服务端授权替代品 |
| [Refine Core 5.0.12 release](https://github.com/refinedev/refine/releases/tag/%40refinedev%2Fcore%405.0.12) | 当前 Core release 版本 | 已验证官方 release |
| [Next.js Router 7.0.5 release](https://github.com/refinedev/refine/releases/tag/%40refinedev%2Fnextjs-router%407.0.5) | 当前 Next.js Router release 版本 | 已验证官方 release |

证据分类：

| 分类 | 内容 |
| --- | --- |
| 已验证事实 | 当前仓库使用 Next `16.1.6`、React/React DOM `19.0.0`、TanStack Query `^5.90.20`；无 `@refinedev/*`。Core `5.0.12` 的 peers 接受 React 19 与 Query `^5.81.5`；Next.js Router `7.0.5` 的 peers 接受 React 19、Core `^5.0.0`，并把 Next 声明为 `*`；两包 engine 均为 Node `>=20`。 |
| 受限推论 | 依赖解析层面没有已声明 peer 冲突；`next: "*"` 只表示包未限制 Next 主版本，不能视为 Next 16 运行时认证。 |
| 默认假设 | MVP 继续使用显式 `/admin` App Router 页面、同源 cookie 和当前 Query Client；不采用 catch-all 路由或第二套 UI 框架。 |
| 待决策项 | 生产 IdP/会话方案、internal-only/public 暴露模式、部署 Node 版本保证。Next 16 运行时结论必须由锁定依赖后的 build/SSR/navigation spike 给出，不由设计文档预判。 |

### 12.2 Provider 契约增量

- `DataProvider`：浏览器只调用同源 `/api/admin/*`。`getList` 将 API `{ data, meta.total }` 转换为 Refine `{ data, total }`；其他 CRUD 返回 `{ data }`。只实现首批 Resources 所需的标准方法，不以 `custom` 暴露任意 URL、header 或转发能力。
- `AuthProvider`：实现 `login`、`logout`、`check`、`onError`、`getIdentity`，并按需实现 `getPermissions`；401 才触发登出/重登录，403 保留 session 并显示拒绝原因，避免把“已登录但无权”误处理为退出。客户端 provider 不读取签名 secret、不自行判定成员有效性。
- `AccessControlProvider`：`can` 镜像纯 RBAC 策略以控制菜单/按钮；服务端 layout 和每个 Route Handler 再次调用 server-only identity/policy，二者策略测试必须共享同一权限矩阵输入，默认 deny。
- `RouterProvider`：使用 `@refinedev/nextjs-router`，Resource action 采用 `:id`，磁盘路由采用 `[id]`。不创建通用 `src/router.tsx`，不让 Refine catch-all 接管现有 PWA。
- 错误协议：服务端只返回稳定 `code/message/requestId` 与经白名单过滤的 `details`；Data Provider 映射 `statusCode`。401、403、404、409、422、429、5xx 的 UI 行为必须分别测试，不用 HTTP 200 包裹失败。

### 12.3 分期与高风险安全边界

| 能力 | 分期裁决 | 强制安全边界 |
| --- | --- | --- |
| Refine 壳、customers、todos、system-config、admin audit | MVP | 仅受保护 `/admin` 与 `/api/admin/*`；服务端 RBAC；internal-only 默认；变更审计 |
| 用户中心/普通用户权限 | 后续独立设计 | 先建立用户 ownership、租户/行级授权、生命周期与隐私规则；不得复用 `admin_members` 代表平台用户 |
| Story 数据 | 后续只读集成候选 | 只经 Story 所有方批准并版本化的 Read API；禁止直连 Story DB、复制业务表或写入；最小字段、分页、超时、缓存边界、审计；接口缺失时资源不可见且 fail closed |
| Provider/Model Registry | 后续独立设计 | 非秘密元数据与 secret 分离；secret 优先进入部署 secret manager/KMS；如业务必须持久化密文，采用 envelope encryption、每条密文随机 nonce、密钥版本和可轮换引用；只提供 write-only 更新，读接口仅返回掩码/版本/更新时间，日志与审计永不记录明文 |
| 计费、账户、额度 | 后续独立财务域 | 使用不可变 usage/ledger，金额用定点/最小货币单位；`provider_request_id`/`idempotency_key` 唯一；扣费、额度预留/结算与审计需事务或有证明的 outbox；重试不得重复扣费；服务端额度为权威，客户端展示不是控制点 |
| Proxy Gateway | 后续独立服务决策 | 数据面与管理台控制面分离；网关自行认证、模型 allowlist、超时、熔断、流式取消、请求体/响应脱敏、usage 对账；按用户/租户/模型/IP 组合限流并返回 429；不得通过 Refine Data Provider 提供任意上游代理 |

Admin 专属数据库仍只允许 `admin_members`、`admin_audit_logs` 两个 MVP 表。延期域的表名、字段与迁移不得以“预留”方式进入本期 schema。

### 12.4 仓库映射补充

| 责任 | 真实位置 | 增量约束 |
| --- | --- | --- |
| 现有业务壳 | `app/(app)/layout.tsx` | 不嵌入 Refine，不改变现有导航/Workspace session 行为 |
| Admin 路由/布局 | `app/(admin)/admin/**` | protected Server Layout + client `AdminProviders`；显式页面 |
| Admin UI | `app/components/admin/**` | 复用项目 Tailwind/交互模式，不引入 Ant Design |
| Admin 接口 | `app/api/admin/**/route.ts` | 仅解析、zod 校验、identity/policy 编排、调用 `app/lib`、统一响应；不放 Drizzle 查询或计费/网关逻辑 |
| 稳定共享层 | `app/lib/admin/**` 与既有 queries/schema | 只新增窄的 auth/policy/contracts/audit 单职责能力；不重构 chat-schema 或 Claude Agent Kit |
| Query Client | `app/app/providers.tsx` | 先以实际组件树证明 Admin 是否位于现有 Provider 下；全应用只能有一个受控 QueryClient 生命周期，不创建互相隔离且无法失效的缓存 |

### 12.5 数据库迁移、发布与回滚

采用 expand-first、feature-gated 发布，不做破坏性 down migration：

1. **兼容 spike**：锁定 Core/Router 版本和 Node `>=20`，只建立不可导航或仅开发可见的 `/admin` 壳；通过 build、SSR、client navigation、现有 PWA 回归后才继续。
2. **加法迁移**：由 `app/lib/db/schema.ts` 定义 `admin_members`、`admin_audit_logs`，用 `pnpm db:generate` 生成迁移；先备份并在 staging 演练 apply。禁止改名/删除现有表列，禁止在 `ensureInitialized()` 复制 DDL。
3. **暗发布**：默认关闭 Admin feature flag/入口；迁移先行，应用代码同时兼容“功能关闭 + 新表已存在”。健康检查不依赖尚未配置的管理员。
4. **只读 canary**：只对明确 allowlist 管理员开放 list/show/audit；验证 401/403、脱敏、查询上界、审计与可观测性。
5. **逐资源开放 mutation**：customers、todos、system-config 分别开关；system-config 最后开放，且仅 admin、白名单字段、确认提示、审计成功后才算完成。
6. **扩大范围**：internal-only 验收后再扩大管理员；public 模式必须先满足 `AC-016`，不得用 feature flag 绕过全服务安全 blocker。

兼容/回滚规则：

- `/api/admin/*` 与 `/admin` 均为新增路径；现有 PWA/API 契约不在本期修改。新 admin contract 需要版本变化时优先加字段，客户端必须忽略未知字段。
- 运行时回滚先关闭资源 mutation/入口，再回退应用版本；保留新增表与审计数据，避免丢失取证链。回退版本不得引用新列即满足 schema-forward compatibility。
- 迁移失败立即停止发布并从已验证备份恢复；不自动执行 DROP TABLE/DROP COLUMN。真正清理结构必须是后续独立、已确认且有保留期的 contract migration。
- 若 Refine/Next 运行时 spike 失败，撤销尚未发布的依赖/路由变更即可；不能以升级/降级 Next 或重构现有 PWA 作为本 Issue 默认修复路径，需回到设计评审。

### 12.6 原稿逐项裁决

| 原稿项 | 裁决 | 证据与替代结论 |
| --- | --- | --- |
| `admin_`/`ai_`/`billing_`/`proxy_`/`system_` 数据库命名族 | **修订** | 当前 schema 只有 `customers`、`todos`、`conversations`、`system_configs`。MVP 仅新增复数 snake_case 的 `admin_members`、`admin_audit_logs`；保留“按领域命名”的意图，否决一次性创建其余前缀表和重复 `system_configs`。 |
| `frontend/src/admin`、`src/refine.tsx`、通用 `src/router.tsx` | **否决** | 真实项目为 Next.js App Router，无通用 `src` 路由入口。改用 `app/(admin)/admin/**`、`app/components/admin/**` 与 client `AdminProviders`。 |
| 独立 `backend/modules/**` | **否决（MVP）** | 真实项目页面和 Route Handlers 同仓；MVP 后端入口为 `app/api/admin/**`，领域能力在稳定 `app/lib`。未来 Gateway 是否独立部署是新设计决策，不能先造目录。 |
| Phase 1~4 的 `3-5/5-7/7-10/10-15 天` | **否决** | 原估算发生在仓库不可访问且范围混合时，没有团队容量、依赖 spike、IdP 或安全门槛证据。改用 12.5 的证据门槛；工期只能由下游在确认范围、责任人和依赖后估算，本文不伪造日期。 |
| Proxy Gateway 作为 admin backend 模块并进入主链路 | **修订** | 保留“统一模型调用可观测/计量”的长期意图；否决进入 MVP、否决把数据面塞进 Refine/Data Provider。未来必须先完成独立数据面契约、幂等计费、额度、限流、密钥和流式故障设计。 |
| Story Workspace DB 只读访问 | **修订** | 保留只读运营视角；否决直连外部 DB。只有 Story 所有方提供批准的版本化 Read API 后才可成为 Resource，当前无接口即延期。 |

### 12.7 验收与证据矩阵

| 验证层 | Happy path | Failure mode / 反证 | 必须留存的证据 |
| --- | --- | --- | --- |
| 设计与依赖 | 官方六个链接可访问；版本/peer/engine 与仓库版本相容 | Next 16 不能仅凭 `next: "*"` 宣称可运行 | 来源、访问日期、registry 摘要、决策 `DEC-012` |
| 路由壳 | admin 登录后访问 customers list；现有 `/customers` 不变 | 未登录 protected page 重定向；Refine 不接管未知 PWA 路由 | build 输出、路由测试、两条 E2E 截图/trace |
| Provider/API | 列表把 `meta.total` 映射到 Refine `total`；admin 更新成功并写审计 | 非白名单 sort/filter 422；401、403、409、429、5xx 映射正确且不泄密 | Provider 单测、Route integration test、requestId 关联审计 |
| RBAC | admin 更新、auditor 只读 | operator 直调 delete API 返回 403；disabled member fail closed | policy matrix 单测 + 绕过 UI 集成测试 |
| 迁移/发布 | staging 备份后成功 apply，加表不影响旧 PWA | 迁移失败停止部署；feature flag 关闭时旧应用可运行 | migration SQL review、staging apply/rollback drill、schema snapshot |
| 密钥/审计 | UI 只见掩码/元数据（未来域）；MVP 无 secret 表 | 响应、日志、审计扫描不含明文；审计失败使敏感 mutation 失败 | secret-pattern scan、审计一致性 failure test |
| 计费/额度/限流（未来域） | 同一请求重试只产生一次 usage/ledger 结果 | 重复 idempotency key、额度不足、超限返回稳定冲突/拒绝；无重复扣费 | 并发/重放测试、账本对账、429 与 retry policy 证据 |

当前设计交付的最小验证为：本节覆盖矩阵完整、六个官方链接 HTTP 200、仓库文档 `git diff --check` 通过、Paperclip 最新 plan revision 与 confirmation target 完全一致。实现级 build/test 不在 design 阶段执行。

### 12.8 新增关键决策

#### `DEC-011` 分离 Admin API 与 Refine Provider 返回契约

- 决策：Admin API 保留 `{ data, meta }`；Data Provider 将 list 映射为 Refine `{ data, total }`，错误映射为 `HttpError`。
- 原因：避免把现有 API contract 与 Refine 内部接口误当同一协议。

#### `DEC-012` Next 16 兼容性属于待实证结论

- 决策：React 19/Query/Node peer 相容记为已验证；Next 16 只记“无已声明 peer 冲突”，必须经运行 spike 才能升级为兼容事实。
- 原因：router package 的 `next: "*"` 没有提供版本级运行保证。

#### `DEC-013` 高风险域延期且不得预留 schema

- 决策：用户中心、Story、模型注册、计费、额度、限流和 Proxy Gateway 不进入 MVP；正文只定义未来安全门槛。
- 原因：当前仓库没有真实数据模型、接口、所有权或安全基础。

#### `DEC-014` 发布采用加法迁移与可关闭 canary

- 决策：schema 先加不删、入口默认关闭、先只读后 mutation、按 Resource 扩大；回滚保留审计数据。
- 原因：把 Refine 接入与现有 PWA 风险隔离，并保持可恢复性。

#### `DEC-015` 用证据门槛替代原始工期承诺

- 决策：设计阶段不保留 `3-5/5-7/7-10/10-15 天`估算；下游只能在确认范围、依赖与责任人后估算。
- 原因：原估算没有真实仓库、兼容 spike、IdP、发布模式或团队容量证据。

### 12.9 确认门禁

- [SUO-341](/SUO/issues/SUO-341) 的 `plan` issue document 是本次增量评审权威；仓库文件是下游共享设计真相源，两者必须引用同一 `DESIGN-REFINE-ADMIN-001` 与 `DEC-011` 至 `DEC-015`。
- 只有绑定最新 plan revision 的 `request_confirmation` 被接受后，CEOOrchestrator 才能治理收口本设计阶段并决定是否唤醒下游。
- 确认前，DesignArchitect 不创建 Issue/Task/Stage、不修改应用/依赖/schema/migration，也不调用下游 Agent。
- 任一用户评论使确认卡 supersede，或计划被拒绝时，只更新同一 plan 与本文增量章节，并基于新 revision 创建新确认卡；不得另建冲突主稿。
