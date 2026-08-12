# Ink Memory Admin

基于 Next.js 与 Refine 的 Ink Memory 运营控制台。一个项目内提供剧本数据运营、平台用户管理、AI Provider 与模型配置、Token 计费、Claude/OpenAI 兼容网关、文件存储、RBAC、系统设置和审计能力，结构化数据统一存储在 PostgreSQL `ink-memory`。

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
| 文件存储 | 服务端上传、直传 URL、文件代理预览与下载 | `/api/storage/*` |

模型网关提供 Anthropic `POST /v1/messages`、`POST /v1/messages/count_tokens`，以及 OpenAI `POST /v1/chat/completions`、`GET /v1/models` 兼容接口。

## 技术栈

- Next.js 16 App Router、React 19、TypeScript
- Refine Core 5、Next.js Router、TanStack Query
- PostgreSQL 16、Drizzle ORM 与版本化 SQL migrations
- Anthropic SDK、OpenAI SDK
- AWS S3 SDK、Vercel Blob
- Vitest、Playwright、ESLint

## 本地开发

环境要求：Node.js 20+、pnpm 9+、Docker Desktop 或兼容的 Docker Engine。

```bash
pnpm install
pnpm env:setup
docker compose --env-file .env.local up -d postgres minio minio-init
pnpm db:migrate
pnpm dev
```

打开 [http://localhost:3000/admin](http://localhost:3000/admin)。根路径 `/` 会跳转到管理后台。

`pnpm env:setup` 会完成以下操作：

- 生成 `.env.local` 和 `docker/.env`，文件权限设为 `0600`；
- 将本地数据库统一配置为 PostgreSQL `ink-memory`；
- 自动生成 Session、首次管理员、Gateway pepper、Provider 凭据加密所需的随机密钥；
- 保留已有且格式有效的控制面密钥，清除当前项目不使用的旧环境变量；
- 保留 Storage/S3/Vercel Blob 配置，并为本地 MinIO 自动生成独立凭据；
- 不生成或写入 Anthropic、OpenAI 等上游 Provider API Key。

可重复执行初始化；使用下面的命令检查两套环境文件是否完整有效：

```bash
pnpm env:check
```

如果生产数据库已经保存 Provider 凭据或 Gateway Key，不要删除环境文件后重新生成 `AI_CREDENTIAL_ENCRYPTION_KEY` 或 `GATEWAY_API_KEY_PEPPER`。生产环境应把这些值持久化到 Secret Manager，并在部署前设置正确的 `ADMIN_ORIGIN_ALLOWLIST`。

## 首次启动设置

第一次打开 `/admin` 时，系统先检查 PostgreSQL 中是否存在管理员。若数据库为空，登录入口会自动弹出“设置首位管理员”页面，不再要求手工调用 Bootstrap API。

页面默认填写：

- 管理员邮箱：`dmeck@suoxya.com`
- 初始密码：`test123456`

将 `.env.local` 中由 `pnpm env:setup` 自动生成的 `ADMIN_BOOTSTRAP_TOKEN` 粘贴到“首次启动密钥”，然后点击“创建管理员并进入控制台”。初始化会在同一事务中创建超级管理员、内置角色、权限和审计记录，并立即建立管理 Session。

Bootstrap 只允许成功一次；已有管理员时 `/admin/login` 只显示正常登录。默认密码仅用于本地首次设置，生产环境应在提交前改成独立强密码。

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

生产部署前至少修改 `docker/.env` 中的公开端口、数据库密码、MinIO 密码、管理后台 Origin，并将敏感值交由部署平台的 Secret Manager 注入。数据库与 MinIO 密码需使用至少 16 位的 URL-safe 字符。Compose 会拒绝在必需密钥为空时启动。

## 环境变量

| 变量 | 用途 | 初始化策略 |
| --- | --- | --- |
| `DATABASE_URL` | PostgreSQL 连接；本地默认连接 `localhost:5433/ink-memory` | 自动配置 |
| `MIGRATION_DATABASE_URL` | 唯一 Schema runner 的显式连接；生产必须使用专用 migrator 账户 | 本地自动配置；生产由 Secret Manager 注入 |
| `ADMIN_SESSION_SECRET` | 管理员 Session HMAC | 自动生成，至少 32 bytes |
| `ADMIN_BOOTSTRAP_TOKEN` | 首次设置页面的一次性初始化授权 | 自动生成，至少 32 bytes；不发送给页面，需手工粘贴 |
| `ADMIN_ORIGIN_ALLOWLIST` | 管理写操作允许的 Origin，逗号分隔 | 本地默认 `http://localhost:3000` |
| `GATEWAY_API_KEY_PEPPER` | Gateway Key HMAC | 自动生成，至少 32 bytes |
| `AI_CREDENTIAL_ENCRYPTION_KEY` | Provider 凭据 AES-256-GCM 密钥 | 自动生成 32-byte Base64 |
| `AI_PROVIDER_HOST_ALLOWLIST` | 自定义上游 Provider 主机名，逗号分隔 | 可选；官方主机已内置 |
| `AI_PROVIDER_ALLOW_INSECURE_LOCALHOST` | 开发环境允许本地 HTTP Provider | 默认 `false` |
| `GATEWAY_MIN_RESERVE_MICROUSD` | 单次请求最低预授权金额 | 默认 `0` |
| `GATEWAY_MAX_BODY_BYTES` | 网关请求体上限 | 默认 `20971520` |
| `FILE_STORAGE_TYPE` | 文件存储驱动：`vercel-blob` 或 `s3` | 默认 `vercel-blob` |
| `FILE_STORAGE_PREFIX` | 对象 Key 前缀 | 默认 `uploads` |
| `BLOB_READ_WRITE_TOKEN` | Vercel Blob 凭据 | 使用 Vercel Blob 时配置 |
| `FILE_STORAGE_S3_*` | Bucket、Region、Endpoint、公开 URL 与 Path Style | 使用 S3 时配置 |
| `AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY` | S3 访问凭据 | 使用需要静态凭据的 S3 时配置 |
| `MINIO_USER` / `MINIO_PASSWORD` | 内置 MinIO 管理凭据 | 本地自动生成/配置 |
| `MINIO_API_PORT` / `MINIO_CONSOLE_PORT` | MinIO S3 API 与控制台端口 | 默认 `9000` / `9001` |

Provider API Key 不属于应用运行环境变量。请在 `/admin/models` 创建 Provider 时录入，系统只保存加密密文并在读取接口中返回指纹。

自定义 OpenAI/Anthropic 兼容域名必须先把**主机名**加入
`AI_PROVIDER_HOST_ALLOWLIST`（逗号分隔，不填写 scheme 或 path），然后重启 Admin。
Provider 没有 `/models` 接口时，在“添加 Provider → 模型目录模式”选择
“无 `/models`，手工配置”并填写上游型号；保存后系统直接打开“添加模型”并预填
Provider、上游型号、alias 和显示名称，不会发起模型目录请求。

## 文件存储

Storage 业务和共享 lib 保留在当前项目中，支持 Vercel Blob、AWS S3 及兼容 S3 协议的对象存储：

- `GET /api/storage`：读取存储驱动和配置状态；
- `POST /api/storage/upload`：服务端 multipart 上传；
- `POST /api/storage/upload-url`：获取 Vercel Blob 客户端令牌或 S3 Presigned URL；
- `GET /api/storage/file/k64_<key>`：通过安全编码的对象 Key 代理预览或下载。

Storage 的核心接口、驱动实现、Key 校验与内容转换位于 `app/lib/file-storage`。对公网开放上传接口前，应在业务接入层补齐用户鉴权、限流与文件大小策略。

本地默认使用 S3 驱动连接 Compose 中的 MinIO。控制台地址为 [http://localhost:9001](http://localhost:9001)，登录凭据保存在 ignored 的 `.env.local` 中。切换到 Vercel Blob 或外部 S3 时，修改相应 Storage 变量后重新运行 `pnpm env:check`。

## 数据库与迁移

```bash
pnpm db:generate        # 修改 app/lib/db/schema/** 后生成前向 migration
pnpm db:migrate:status  # 只读显示已应用连续前缀和待执行 migration
pnpm db:migrate         # 唯一 Schema/DDL 迁移入口
pnpm db:migrate:check   # 要求 journal、hash、数据库 receipt 全部 current
```

`drizzle/**` 是共享 PostgreSQL 表、字段、索引、约束、函数和触发器的唯一版本历史。Dream 启动只检查 `drizzle.schema_capabilities`，不执行 Alembic 或 runtime DDL。`MIGRATION_DATABASE_URL` 必须显式提供；runner 不会回退复用 `DATABASE_URL`。生产应将 migration 连接配置为专用账户，并由单实例发布步骤执行。

Dream 的 43+5 张 SQLite 表不是静态 SQL seed。`drizzle/data/` 只在 Schema 已具备 `dream.schema.unified.v1` 后运行可审计的数据迁移；快照、staging、转换和业务完整性验证仍由 Dream 领域 importer 负责。全新数据库只需一个 Schema 命令：

```bash
pnpm db:migrate
pnpm db:migrate:check
pnpm db:data:legacy -- \
  --main-sqlite /absolute/path/to/ink-and-memory.db \
  --notion-sqlite /absolute/path/to/notion-connectors.db \
  --mode execute --record
pnpm db:data:subscriptions -- --apply
```

`0032_dream_schema_authority_cutover` 在同一事务内完成 preflight、DDL/adoption、完整 catalog postflight、capability 与 migration receipt。它支持全新三表 baseline，以及经精确验证的历史 Dream Alembic `20260809_06`/`20260811_07`；部分表、未知 head 或对象漂移会原子失败。已发布的 Alembic 与 Drizzle 历史均不重写。

Dream 仓库不再包含 Alembic runner、revision 或 PostgreSQL DDL 生成器。
原 `20260809_01–20260811_07` revision 文本冻结在
`drizzle/legacy/dream-alembic/`，只用于审计和旧库状态解释，不可执行；
`20260811_07` 的业务要求由 0032 与
`dream.workflow.thread-lookup.v1` 正式承接。

对已经承载 Dream 写入的 PostgreSQL，不得重新覆盖导入。先以 `--mode verify-existing` 严格核对；只有全部源 PK 都存在，且差异行的 PostgreSQL `updated_at` 严格晚于源 SQLite 时，才可显式加 `--accept-post-cutover-changes --record` 采纳现状。两个 runner 的回执登记在 append-only 的 `drizzle.data_migration_*` 表中，只保存表级 count/digest 和状态，不保存 SQLite 路径、DSN、Secret 或业务正文。

默认订阅 runner 初始化 `Free`、`Dream`、`is Dreaming` 三个 Plan 及展示元数据；每个 canonical User 的 Free Subscription 由既有投影逻辑自动补齐。它不会默认切换已有 Subscription 的 Plan Version，也不会覆盖已经发布的 Free Token 额度。真实 43+5 源数据、重复运行、冲突阻断和 append-only 验证使用一次性 PostgreSQL：

```bash
pnpm test:data-migration:e2e
```

完整接管合同、发布顺序和回滚边界见 [统一数据库 Schema 权威](docs/architecture/database-schema-authority.md)。`db:push` 仅允许显式命名的一次性本地数据库，并要求 `ALLOW_EPHEMERAL_DB_PUSH=1`；共享、集成和生产数据库禁止使用。

应用没有嵌入式数据库回退。启动数据库容器后，可使用以下命令确认状态：

```bash
docker compose exec postgres pg_isready -U ink_memory -d ink-memory
curl -f http://localhost:9000/minio/health/ready
```

## 项目结构

```text
app/
├── (admin)/admin/       # Refine 管理页面、登录与工作区布局
├── api/admin/           # 管理 API：鉴权、资源 CRUD、充值与结算核对
├── api/storage/         # 文件上传、直传与代理下载 API
├── components/admin/    # Refine Provider 与管理端交互组件
├── lib/
│   ├── admin/           # Session、RBAC、审计与资源编排
│   ├── billing/         # 定价、余额预授权、结算与账本
│   ├── gateway/         # Anthropic/OpenAI 代理生命周期
│   ├── file-storage/    # Vercel Blob / S3 存储抽象与实现
│   ├── models/          # 模型解析
│   ├── security/        # Provider 凭据加密
│   └── db/              # PostgreSQL schema
└── v1/                  # 模型兼容网关 Route Handlers
drizzle/                 # 版本化 PostgreSQL migrations 与可审计 data runners
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
- 不要提交 Blob Token、AWS/S3 凭据；生产环境通过 Secret Manager 注入。
