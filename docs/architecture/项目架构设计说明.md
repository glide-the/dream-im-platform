# 项目架构设计说明

本项目已不再使用工作流/Step 类框架，当前采用 **Next.js（App Router）** 作为唯一应用框架：**页面 + API 同仓组织**，以 `app/(app)`（前端路由段）与 `app/api`（后端 Route Handlers）为边界，通用能力集中在 `app/lib`，并配套 `drizzle + pg` 访问 PostgreSQL。

---

# 参考问题

* [AI Model 会话流程图](docs/AI Model 会话流程图.md)
* [Claude Agent SDK 交互式工具时序图](docs/Claude Agent SDK 交互式工具时序图.md)
* [Cursor 架构改动规则（目录职责、协议一致性）](.cursor/rules/architecture.mdx)
* [AI 对话协议规则（强约束：chat-schema 是唯一入口）](.cursor/rules/05-chat-protocol.mdc)
* [API/页面/组件约束规则汇总](.cursor/rules/00-overview.mdc)

---

# Mottia 框架示例

> 本节仅保留为“框架使用范式示例”的位置；当前项目框架为 **Next.js**，以下示例全部基于本仓库代码路径。

## Next.js 页面与 API 的典型落点

* **页面路由（PWA 主界面）**：`app/(app)/**`

  * AI 助手页：`app/(app)/ai-assistant/page.tsx`
  * 客户：`app/(app)/customers/page.tsx`、`app/(app)/customers/[id]/page.tsx`
  * Todo：`app/(app)/todo/page.tsx`
* **API（Route Handlers）**：`app/api/**/route.ts`

  * AI 流式对话：`app/api/claude-agent/route.ts`
  * Agent 搜索客户：`app/api/agent/search-customer/route.ts`
  * Customers CRUD：`app/api/customers/route.ts`、`app/api/customers/[id]/route.ts`
  * Conversations：`app/api/conversations/route.ts`、`app/api/conversations/[id]/route.ts`、`app/api/conversations/by-customer/[customerId]/route.ts`
  * Todos CRUD：`app/api/todos/route.ts`、`app/api/todos/[id]/route.ts`

## AI 对话协议与工具交互的示例入口

* **对话请求体 Schema（唯一权威）**：`app/lib/chat-schema.ts`
* **Claude Agent SDK 封装（消息类型/组装/会话）**：`app/lib/claude-agent-kit/**`

  * 消息类型：`app/lib/claude-agent-kit/messages/types/**`
  * 服务端 runner：`app/lib/claude-agent-kit/server/server/agent-runner.ts`
  * 会话落盘工具：`app/lib/claude-agent-kit/server/utils/session-files.ts`

---

# 架构设计

### 公共模块

> 当前项目不使用 `src/*` 分层；通用能力集中在 `app/lib`，页面与接口分别在 `app/(app)` 与 `app/api`。

| 模块                                        | 用途                                                 |
| ----------------------------------------- | -------------------------------------------------- |
| `app/lib/db.ts`                           | PostgreSQL 连接池（`pg`）+ Drizzle 初始化 + 常用数据访问封装       |
| `app/lib/db/schema.ts`                    | Drizzle 表结构定义（customers / conversations / todos 等） |
| `drizzle/` + `drizzle.config.ts`          | Drizzle 生成/迁移相关产物与配置                               |
| `app/lib/types.ts`                        | 领域类型：Customer / Conversation / Todo 等              |
| `app/lib/db-mappers*.ts`                  | DB Shape ↔ 领域类型 的映射与适配（含测试）                        |
| `app/lib/queries.ts` / `app/lib/query.ts` | 复用查询与查询构建工具（含测试）                                   |
| `app/lib/chat-schema.ts`                  | **AI 对话协议唯一入口**：zod 校验 + types                     |
| `app/lib/claude-agent-kit/**`             | Claude Agent SDK 适配层：消息结构、session、server runner 等  |
| `app/lib/client.ts`                       | 前端请求封装（对 `app/api/**`）                             |
| `app/lib/format.ts` / `app/lib/id.ts`     | 格式化与 ID 生成工具（含测试）                                  |
| `app/hooks/useDebounce.ts`                | 通用 hooks                                           |
| `app/components/*`                        | 可复用 UI 组件（如 Modal/Toast，输入组件也应在此域内演进）              |

---

### 基础业务模块说明

> 当前业务域以“页面路由段 + API 路由 + lib 领域类型/查询”组成闭环。

**核心业务域**：AI 助手、客户、会话、待办

| 业务域           | 页面（UI）                     | API（后端）                         | 领域/存储（lib）                                                                     |
| ------------- | -------------------------- | ------------------------------- | ------------------------------------------------------------------------------ |
| AI Assistant  | `app/(app)/ai-assistant/*` | `app/api/claude-agent/route.ts` | `app/lib/chat-schema.ts`、`app/lib/claude-agent-kit/**`                         |
| Customers     | `app/(app)/customers/*`    | `app/api/customers/**`          | `app/lib/db.ts`、`app/lib/db/schema.ts`、`app/lib/types.ts`、`app/lib/queries.ts` |
| Conversations | （由 AI/客户页联动展示）             | `app/api/conversations/**`      | 同上（conversation 表 + mapper/query）                                              |
| Todos         | `app/(app)/todo/page.tsx`  | `app/api/todos/**`              | 同上（todo 表 + mapper/query）                                                      |

---

### 认证中间件模块

> **当前项目：未引入登录鉴权**（API 默认面向受控环境/内网或上游网关）。因此不存在 `auth.middleware.ts` 等模块。
> 若后续需要接入鉴权，建议按 Next.js 约定新增以下落点（仅作为“将来扩展位”的说明，不影响当前实现）：

* `app/middleware.ts`：做全局请求拦截（如鉴权、Header 规范化、灰度开关）
* `app/api/**/route.ts`：在具体接口内做细粒度校验（结合 zod schema 与角色/权限逻辑）
* `app/lib/auth/*`：沉淀 token 校验、权限模型、用户会话等通用实现（避免散落在 route 内）

---

### Step消息中间件模块

> 当前项目以 **Next.js Route Handlers** 承载“消息处理与流式输出”，对应关系为：
> “一次对话请求” = “一次 `/api/claude-agent` 调用” = “一次流式响应生命周期”。

#### Handler Context Message

在本项目中，处理函数（Route Handler / Agent Runner）应显式携带并贯穿以下上下文（实现位置以 `app/api/claude-agent/route.ts` 与 `app/lib/claude-agent-kit/server/**` 为主）：

| Property              | 功能用途                                                                |
| --------------------- | ------------------------------------------------------------------- |
| logger（约定）            | 结构化日志字段统一（建议包含 `traceId` / `route` / `durationMs`）                  |
| traceId/requestId（约定） | 一次请求的链路标识；流式回包与错误也应携带同一标识                                           |
| abortSignal           | 客户端中断/stop 时及时取消 Agent 运行与下游请求                                      |
| db（按需）                | 访问 PostgreSQL（customers/conversations/todos）                        |
| stream（Response）      | 使用 Web Streams/ReadableStream 输出增量内容（AI 流式响应）                       |
| session（按需）           | 会话信息/落盘（见 `app/lib/claude-agent-kit/server/utils/session-files.ts`） |

#### Handles Adapter Types

本项目的“适配”主要体现在 **环境与运行方式**（而非工作流引擎适配）：

| Type              | 本地开发（默认）                                      | 线上/部署（建议）                 |
| ----------------- | --------------------------------------------- | ------------------------- |
| DB                | 本地/测试 PostgreSQL                              | 生产 PostgreSQL（连接池参数更严格）   |
| AI Provider       | `@anthropic-ai/claude-agent-sdk`（按环境变量注入 Key） | 同上（配额、超时、重试策略更严格）         |
| Session/Artifacts | 文件系统落盘（jsonl 等）                               | 仍可落盘或迁移到对象存储/DB（看合规与可观测性） |
| Streaming         | Next.js Route Handler 直接返回流                   | 同上（注意 CDN/反代对流式的影响）       |

---

### 业务架构模块

```plain
.
├── app/
│   ├── (app)/                           ← 页面路由段（PWA UI）
│   │   ├── ai-assistant/
│   │   ├── customers/
│   │   ├── todo/
│   │   ├── me/
│   │   └── layout.tsx
│   │
│   ├── api/                             ← Route Handlers（后端 API）
│   │   ├── claude-agent/route.ts        ← AI 流式对话
│   │   ├── agent/search-customer/route.ts
│   │   ├── customers/**/route.ts
│   │   ├── conversations/**/route.ts
│   │   └── todos/**/route.ts
│   │
│   ├── components/                      ← 复用组件（Modal/Toast/输入组件等）
│   ├── hooks/                           ← React hooks
│   └── lib/                             ← 通用能力（DB/查询/协议/AI SDK 适配）
│       ├── claude-agent-kit/
│       ├── db/
│       ├── chat-schema.ts
│       ├── db.ts
│       ├── queries.ts
│       └── types.ts
│
├── docs/                                ← 设计文档与时序图
├── drizzle/                             ← drizzle 产物
├── tests/                               ← e2e 与测试资源
├── vitest.config.ts
├── playwright.config.ts
├── next.config.js
└── package.json
```

---

### Technologies 🌐 技术栈

#### Runtime & Framework

* **Next.js 16.1.6（App Router）**：统一承载页面与 API
* **React 19**：UI 渲染
* **TypeScript 5.5.4**：类型约束与工程化

#### AI & Streaming

* `@anthropic-ai/claude-agent-sdk ^0.2.20`：Claude Agent SDK
* `ai ^6.0.62`、`@ai-sdk/react ^3.0.64`：前端/流式交互相关能力
* 协议入口：`app/lib/chat-schema.ts`（zod 校验）

#### Database

* **PostgreSQL**
* `drizzle-orm ^0.45.1` + `pg ^8.13.3`
* 迁移：`drizzle-kit ^0.31.8`（脚本见 `package.json`：`db:generate` / `db:migrate`）


#### File Storage（文件存储 / 对象存储抽象）

- 统一接口：`FileStorage`（upload / download / delete / exists / metadata / sourceUrl / downloadUrl / createUploadUrl）。
- 多后端驱动：
  - **Vercel** **Blob**（默认，便于快速上线与 CDN）
  - **Amazon S3**（企业标准）
  - **MinIO**（私有化自托管，S3 兼容）
- 关键实现库：
  - `@vercel/blob ^2.0.0`
  - `@aws-sdk/client-s3 ^3.940.0`
  - `@aws-sdk/s3-request-presigner ^3.940.0`
  - `minio ^8.0.5`

- 基础设施: `src/lib/file-storage/` 实现依赖具体存储厂商业务代码。
- 服务层使用方式：`src/service/file-storage/` 只面向统一接口编排“上传→生成引用→落库→供 AI 使用”，避免业务代码直接依赖具体存储厂商。

#### Validation

* `zod ^4.3.6`：请求体与协议校验（尤其是对话协议与 API 输入）

#### UI & Tooling

* `@tanstack/react-query ^5.90.20`：数据请求与缓存
* `tailwindcss 4.1.18` + `postcss`：样式体系

#### Testing

* `vitest ^4.0.18`：单测（默认排除 `*.integration.test.ts`）
* `@playwright/test ^1.58.0`：E2E 测试

---
