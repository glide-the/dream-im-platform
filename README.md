# Ink Memory Admin

基于 Next.js 与 Refine 的 Ink Memory 运营控制台。一个项目内提供剧本数据运营、平台用户管理、AI Provider 与模型配置、Token 计费、Claude/OpenAI 兼容网关、RBAC、系统设置和审计能力，所有持久化数据统一存储在 PostgreSQL `ink-memory`。

## 核心能力

| 模块 | 管理内容 | 入口 |
| --- | --- | --- |
| 运营总览 | 用户、模型、Token、网关请求与待核对结算指标 | `/admin` |
| 剧本数据 | 工作区、项目、角色、场景、工作流运行 | `/admin/story` |
| 平台用户 | 用户状态、模型权限、额度、余额、Gateway Key | `/admin/users` |
| 模型中心 | Provider、上游凭据、模型别名、上下文与分层定价 | `/admin/models` |
| Token 计费 | 计费账户、用量记录、不可变交易账本 | `/admin/billing` |
| 代理网关 | 请求日志、错误、限流窗口、失败结算核对 | `/admin/gateway` |
| 权限管理 | 管理员、角色、权限与角色授权 | `/admin/access` |
| 系统治理 | 系统设置与管理操作审计 | `/admin/system`、`/admin/audit` |

模型网关提供 Anthropic `POST /v1/messages`、`POST /v1/messages/count_tokens`，以及 OpenAI `POST /v1/chat/completions`、`GET /v1/models` 兼容接口。

## 技术栈

- Next.js 16 App Router、React 19、TypeScript
- Refine Core 5、Next.js Router、TanStack Query
- PostgreSQL 16、Drizzle ORM 与版本化 SQL migrations
- Anthropic SDK、OpenAI SDK
- Vitest、Playwright、ESLint

## 本地开发

环境要求：Node.js 20+、pnpm 9+、Docker Desktop 或兼容的 Docker Engine。

```bash
pnpm install
pnpm env:setup
docker compose up -d postgres
pnpm db:migrate
pnpm dev
```

打开 [http://localhost:3000/admin](http://localhost:3000/admin)。根路径 `/` 会跳转到管理后台。

`pnpm env:setup` 会完成以下操作：

- 生成 `.env.local` 和 `docker/.env`，文件权限设为 `0600`；
- 将本地数据库统一配置为 PostgreSQL `ink-memory`；
- 自动生成 Session、首次管理员、Gateway pepper、Provider 凭据加密所需的随机密钥；
- 保留已有且格式有效的控制面密钥，清除当前项目不使用的旧环境变量；
- 不生成或写入 Anthropic、OpenAI 等上游 Provider API Key。

可重复执行初始化；使用下面的命令检查两套环境文件是否完整有效：

```bash
pnpm env:check
```

如果生产数据库已经保存 Provider 凭据或 Gateway Key，不要删除环境文件后重新生成 `AI_CREDENTIAL_ENCRYPTION_KEY` 或 `GATEWAY_API_KEY_PEPPER`。生产环境应把这些值持久化到 Secret Manager，并在部署前设置正确的 `ADMIN_ORIGIN_ALLOWLIST`。

## 创建首个管理员

先启动应用，再从自动生成的 `.env.local` 加载 Bootstrap Token：

```bash
set -a
source .env.local
set +a

curl -X POST http://localhost:3000/api/admin/auth/bootstrap \
  -H "Origin: http://localhost:3000" \
  -H "X-Admin-Bootstrap-Token: $ADMIN_BOOTSTRAP_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"email":"admin@example.com","displayName":"Super Admin","password":"replace-with-at-least-14-characters"}'
```

Bootstrap 只允许成功一次。之后通过 `/admin/login` 登录并在权限管理中维护其他管理员。

## Docker 部署

环境初始化会同时生成 `docker/.env`，所以无需手工复制或填写随机密钥：

```bash
pnpm env:setup
pnpm docker:up
pnpm docker:logs
```

容器启动时默认执行数据库迁移。停止服务：

```bash
pnpm docker:down
```

生产部署前至少修改 `docker/.env` 中的公开端口、数据库密码、管理后台 Origin，并将敏感值交由部署平台的 Secret Manager 注入。数据库密码需使用至少 16 位的 URL-safe 字符。Compose 会拒绝在必需密钥为空时启动。

## 环境变量

| 变量 | 用途 | 初始化策略 |
| --- | --- | --- |
| `DATABASE_URL` | PostgreSQL 连接；本地默认连接 `localhost:5433/ink-memory` | 自动配置 |
| `ADMIN_SESSION_SECRET` | 管理员 Session HMAC | 自动生成，至少 32 bytes |
| `ADMIN_BOOTSTRAP_TOKEN` | 首个管理员一次性初始化授权 | 自动生成，至少 32 bytes |
| `ADMIN_ORIGIN_ALLOWLIST` | 管理写操作允许的 Origin，逗号分隔 | 本地默认 `http://localhost:3000` |
| `GATEWAY_API_KEY_PEPPER` | Gateway Key HMAC | 自动生成，至少 32 bytes |
| `AI_CREDENTIAL_ENCRYPTION_KEY` | Provider 凭据 AES-256-GCM 密钥 | 自动生成 32-byte Base64 |
| `AI_PROVIDER_HOST_ALLOWLIST` | 自定义上游 Provider 主机名，逗号分隔 | 可选；官方主机已内置 |
| `AI_PROVIDER_ALLOW_INSECURE_LOCALHOST` | 开发环境允许本地 HTTP Provider | 默认 `false` |
| `GATEWAY_MIN_RESERVE_MICROUSD` | 单次请求最低预授权金额 | 默认 `0` |
| `GATEWAY_MAX_BODY_BYTES` | 网关请求体上限 | 默认 `20971520` |

Provider API Key 不属于应用运行环境变量。请在 `/admin/models` 创建 Provider 时录入，系统只保存加密密文并在读取接口中返回指纹。

## 数据库与迁移

```bash
pnpm db:generate  # 修改 app/lib/db/schema.ts 后生成迁移
pnpm db:migrate   # 按 journal 顺序执行尚未应用的 SQL migration
pnpm db:push      # 仅限明确的本地开发场景
```

应用没有嵌入式数据库回退。启动数据库容器后，可使用以下命令确认状态：

```bash
docker compose exec postgres pg_isready -U ink_memory -d ink-memory
```

## 项目结构

```text
app/
├── (admin)/admin/       # Refine 管理页面、登录与工作区布局
├── api/admin/           # 管理 API：鉴权、资源 CRUD、充值与结算核对
├── components/admin/    # Refine Provider 与管理端交互组件
├── lib/
│   ├── admin/           # Session、RBAC、审计与资源编排
│   ├── billing/         # 定价、余额预授权、结算与账本
│   ├── gateway/         # Anthropic/OpenAI 代理生命周期
│   ├── models/          # 模型解析
│   ├── security/        # Provider 凭据加密
│   └── db/              # PostgreSQL schema
└── v1/                  # 模型兼容网关 Route Handlers
drizzle/                 # 版本化 PostgreSQL migrations
scripts/                 # 环境初始化与迁移脚本
tests/e2e/               # Playwright 管理后台验收
docker/                  # 应用 + PostgreSQL 生产化 Compose
```

## 质量检查

```bash
pnpm env:check
pnpm exec tsc --noEmit
pnpm lint
pnpm test:run
pnpm test:e2e
pnpm build
```

浏览器与隔离数据库验收流程见 [ink-admin-playwright-qa](./.agents/skills/ink-admin-playwright-qa/SKILL.md)。更完整的架构、部署与业务接入说明见 [文档索引](./docs/README.md)。

## 安全约束

- Gateway API Key 明文只在创建时返回一次，数据库只保存带 pepper 的哈希。
- Provider 凭据使用 AES-256-GCM 加密保存，管理 API 不回传明文。
- 管理写操作同时校验 Session、RBAC 与 Origin，并写入审计日志。
- 计费金额使用整数 micro-USD；交易账本只追加，异常结算进入人工核对。
- 不要提交 `.env.local`、`docker/.env`、数据库备份、Provider Key 或 Gateway Key。
