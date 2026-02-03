# Repository Guidelines (ai4sales-pwa-app)

本仓库是一个 Next.js（App Router）PWA 应用：页面与 API 在同一仓库内组织。
核心原则：**API 只做接入与编排，通用能力沉淀在 `app/lib`，且 `app/lib` 功能基本不变。**

---

## Project Structure & Module Organization

- App Router 代码在 `app/`
  - `app/(app)/`：业务页面路由（ai-assistant、customers、todo、me 等）
  - `app/api/`：后端接口（Route Handlers），以资源为中心组织（customers/todos/conversations/claude-agent）
  - `app/components/`：可复用 UI 组件（PascalCase.tsx）
  - `app/hooks/`：可复用 hooks（useX.ts）
  - `app/lib/`：✅ 通用能力与领域/基础设施（DB、协议、校验、Agent 封装、类型、查询、工具）
- 数据库迁移：`drizzle/`（drizzle-kit 输出目录）
- 测试：
  - E2E：`tests/e2e/*.spec.ts`（Playwright）
  - 集成测试（如有）：通常在 `app/api/*.integration.test.ts` 或相关目录
- 本地数据库：`docker-compose.yml`

---

## Core Architecture Rules

### 1) API 层（`app/api/**/route.ts`）约束
- 只做：
  - 请求解析（query/path/body）
  - 请求体校验（优先 zod）
  - 调用 `app/lib/**` 完成数据/业务处理
  - 返回统一结构（含错误结构）
- 禁止：
  - 在 `route.ts` 中堆叠复杂领域逻辑
  - 将 DB 细节与查询逻辑散落在多个 route 中（应下沉到 `app/lib`）

### 2) lib 层（`app/lib/**`）约束（重点）
- `app/lib` 是共享能力中心：**尽量保持稳定，不随功能迭代频繁改动结构与职责边界。**
- 新增能力的优先级：
  1) 复用现有 `db.ts / db/schema.ts / queries.ts / types.ts / chat-schema.ts / claude-agent-kit`
  2) 确有必要才新增文件；新增也要保持“单一职责”
- 重要约定：
  - 对话/工具交互协议：统一由 `app/lib/chat-schema.ts` 定义并校验
  - Agent/模型侧封装：放在 `app/lib/claude-agent-kit/**`
  - DB schema：只在 `app/lib/db/schema.ts`（或 `app/lib/db/**`）维护

### 3) UI 层（`app/(app)` + `app/components`）约束
- 页面只负责交互与展示；数据交互统一走 `app/api/**`
- `AIInputDock.tsx` 等输入组件：
  - 必须按 `app/lib/chat-schema.ts` 组装请求体
  - 不要在组件内私自扩展请求字段；需要扩展先改 schema

---

## Build, Test, and Development Commands

- `pnpm dev` — 本地开发（Next dev server）
- `pnpm build` / `pnpm start` — 构建与启动（生产模式）
- `pnpm lint` — ESLint
- `pnpm test` — Vitest（交互/开发）
- `pnpm test:run` — 仅跑单测（排除 integration）
- `pnpm test:coverage` — 单测覆盖率（排除 integration）
- `pnpm test:e2e` — Playwright E2E
- `pnpm test:all` — 单测 + E2E
- DB（Drizzle）：
  - `pnpm db:generate` — 生成迁移文件
  - `pnpm db:migrate` — 推送迁移（push）

---

## Coding Style & Naming Conventions

- TypeScript everywhere（避免 any 漫延；优先显式类型与 zod 推导）
- 文件命名：
  - 组件：`PascalCase.tsx`
  - hooks：`useX.ts`
  - utils：`camelCase.ts`
- 目录职责清晰：
  - `app/api` 不堆逻辑
  - `app/lib` 不做 UI
- 协议与类型：
  - API 输入/输出结构尽量集中定义（优先 zod + inferred types）
  - chat 请求体必须由 `chat-schema.ts` 兜底校验

---

## Testing Guidelines

- 单元测试：Vitest，文件名 `*.test.ts(x)`
- 集成测试：`*.integration.test.ts`（如存在，注意不要被单测脚本误包含）
- E2E：Playwright，`tests/e2e/*.spec.ts`
- 新增功能至少补齐：
  - happy path（成功路径）
  - one failure mode（至少一个失败路径：校验失败/404/权限/DB 失败之一）

---

## Commit & PR Guidelines

- Conventional Commits：`feat:`、`fix:`、`docs:`、`chore:`、`refactor:` 等
- PR 描述应包含：
  - 改动点列表
  - UI 变更截图（如有）
  - 覆盖的测试命令与结果（至少 `pnpm lint` + `pnpm test:run` 或 `pnpm test:all`）

---

## Cursor Rules

本项目使用 Cursor Rules 来约束 AI 编辑行为，规则文件位于 `.cursor/rules/`：

| 文件 | 作用 | 生效范围 |
|------|------|----------|
| `00-overview.mdc` | 项目概览与核心原则 | 全局（alwaysApply） |
| `01-pages.mdc` | 页面层开发规则 | `app/(app)/**` |
| `02-components.mdc` | 组件层开发规则 | `app/components/**` |
| `03-api.mdc` | API 层开发规则 | `app/api/**` |
| `04-lib.mdc` | 通用能力层规则（核心稳定层） | `app/lib/**` |
| `05-chat-protocol.mdc` | AI 对话协议规则（强约束） | chat-schema、claude-agent、AIInputDock |
| `06-database.mdc` | 数据库开发规则（强约束） | db、queries、drizzle |
| `07-testing.mdc` | 测试策略与规则 | `*.test.ts`、`*.spec.ts` |
| `08-code-style.mdc` | 代码风格与命名规范 | 全局 |
| `09-change-guidelines.mdc` | 改动指南与行为准则 | 全局（alwaysApply） |

**规则文件格式**：使用 `.mdc` 扩展名，支持 frontmatter 配置 `globs` 和 `alwaysApply`。

---

## Security & Configuration Tips

- 不提交 secrets（`.env*` 只留 example/模板）
- DB 连接通过 `DATABASE_URL`（或项目约定的同义变量）配置
- 本地 DB 建议用 `docker-compose.yml` 启动
