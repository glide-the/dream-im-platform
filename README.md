# Ink Memory Admin

Ink Memory 的 Refine 运营控制台。项目只承担管理后台、AI 模型供应链、Token 计费、Claude/OpenAI 兼容网关、RBAC 与审计，不再包含原 ai4sales PWA 页面或 SQLite 数据路径。

## 技术栈

- Next.js 16 App Router + React 19
- Refine Core 5 + Next.js Router
- PostgreSQL 16 + Drizzle migrations
- Zod、Vitest、Playwright
- Anthropic SDK、OpenAI SDK

## 功能入口

- `/admin`：运营总览
- `/admin/story`：工作区、剧本、角色、场景、工作流 CRUD
- `/admin/users`：平台用户、配额、余额与 Gateway API Key
- `/admin/models`：Provider、模型注册、分层定价
- `/admin/billing`：账户、Token 用量与不可变账本
- `/admin/gateway`：Claude/OpenAI 请求、错误与人工结算
- `/admin/access`：管理员、角色与权限
- `/admin/system`：结构化系统设置
- `/admin/audit`：管理操作审计
- `/v1/messages`、`/v1/chat/completions`、`/v1/models`：模型兼容网关

根路径 `/` 会跳转到 `/admin`。旧 `/customers`、`/todos`、`/api/claude-agent` 等 PWA 路径已移除。

## 本地启动

```bash
cp .env.local.example .env.local
docker compose up -d postgres
pnpm install
pnpm db:migrate
pnpm dev
```

默认本地连接串：

```text
postgres://ink_memory:ink_memory@localhost:5433/ink-memory
```

首次管理员通过 `POST /api/admin/auth/bootstrap` 创建，请携带 `X-Admin-Bootstrap-Token: $ADMIN_BOOTSTRAP_TOKEN`，请求体包含 `email`、`displayName` 和至少 14 位的 `password`。创建完成后使用 `/admin/login` 登录。

## 数据库

应用没有 SQLite 或内存数据库回退。`DATABASE_URL`（或完整 PG* 变量）缺失时会直接失败。

```bash
pnpm db:generate   # schema 变更后生成迁移
pnpm db:migrate    # 按 drizzle journal 应用迁移文件
pnpm db:push       # 仅供明确的开发期 schema push
```

迁移 `0006` 创建 PostgreSQL Story/System 表并删除历史 `customers`、`todos`、`conversations`、`system_configs` 表。

## 验证

```bash
pnpm exec tsc --noEmit
pnpm lint
pnpm test:run
pnpm test:e2e
pnpm build
```

浏览器验收应遵循 [ink-admin-playwright-qa](.agents/skills/ink-admin-playwright-qa/SKILL.md)。

## 安全约束

- Provider 密钥加密保存，读取 API 只返回指纹。
- Gateway API Key 只保存带 pepper 的哈希，明文仅创建时返回一次。
- 管理写操作要求真实 Session、RBAC 和同源校验，并写入审计日志。
- 计费金额使用整数 micro-USD；账本只追加，结算异常显式进入人工核对。
- 敏感系统设置读取时强制脱敏。
