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

统一认证与 Dream 数据访问正在实施：Better Auth 1.7.4 为唯一 Google/密码/Session/OAuth/device authority，Admin 管理权限按显式 membership 与 live RBAC；Dream 通过命名领域 DTO API 访问数据。当前技术证据与未闭合领域见[契约](docs/architecture/admin-dream-auth-data-contract.md)、[领域映射](docs/architecture/admin-dream-domain-implementation-map.md)与[回执](docs/verification/admin-auth-data-provider-matrix.md)。0054–0056 仅隔离重放通过，不能据此在正常数据库自动迁移或采用旧账户。

## 技术栈

- Next.js 16 App Router、React 19、TypeScript
- Refine Core 5、Next.js Router、TanStack Query
- 内嵌 PostgreSQL 18.1、Drizzle ORM 与版本化 SQL migrations
- Anthropic SDK、OpenAI SDK
- AWS S3 SDK、Vercel Blob
- Vitest、Playwright、ESLint

## 本地开发

环境要求：Node.js 20+、pnpm 9+。应用本地开发不要求 Docker PostgreSQL。

```bash
pnpm install
pnpm env:setup
pnpm db:migrate
pnpm dev
```

打开 [http://localhost:3000/admin](http://localhost:3000/admin)。根路径 `/` 会跳转到管理后台。

Next.js 的 `turbopack.root` 从 `next.config.js` 的文件位置确定，不依赖启动进程的工作目录，也不让祖先目录的锁文件改变 Admin 的依赖解析边界。Webpack构建会把workspace NodeNext源码中的`.js`说明符解析到对应TypeScript文件，发布后的数据库包仍使用`dist/*.js`。无需删除用户目录或其他项目的锁文件；修改 Next.js 配置后需要重新启动开发服务。

如果根目录修正后重启仍出现 `Can't resolve 'tailwindcss'`，先正常停止开发服务，确认服务进程与 `.next/dev/lock` 已释放，再把原 `.next` 移到独立备份目录后启动，重新生成编译缓存。旧 Turbopack 缓存可能保留此前的 CSS 解析路径；不要向父目录安装依赖，也不要移动数据库目录、环境文件或重新执行初始化/迁移。本机排查已使用相同 Node 24 验证：全新缓存编译成功，复用旧缓存副本会重现父目录解析错误，备份后通过 VSCode 原调试配置重建即可恢复。

启动配置回归检查（不启动数据库或调用模型）：

```bash
node --test scripts/next-config.test.mjs
```

`pnpm env:setup` 会完成以下操作：

- 生成 `.env.local` 和 `docker/.env`，文件权限设为 `0600`；
- 将本地数据库配置为 `@ink-memory/db` 管理的内嵌 PostgreSQL `ink-memory`；
- 自动生成 Session、首次管理员、Gateway pepper、Provider 凭据加密所需的随机密钥；
- 保留已有且格式有效的控制面密钥，清除当前项目不使用的旧环境变量；
- 固定 `FILE_STORAGE_TYPE=disabled`，移除旧 MinIO/S3 凭据；
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

`pnpm docker:up` 先构建单一镜像，再用 one-off container 执行 package migration，
最后启动包含 Admin/Gateway 与内嵌 PostgreSQL 的容器。应用启动不会自动迁移。
停止服务：

```bash
pnpm docker:down
```

生产部署前至少确认公开端口、数据库密码、管理后台 Origin，并将敏感值交由部署平台注入。数据库密码需使用至少 16 位 URL-safe 字符。Compose 会拒绝必需密钥为空。

阿里云 ECS 使用 Admin-owned [`deploy/remote-ssh/deploy.sh`](deploy/remote-ssh/deploy.sh)，
发布单一 Admin/Gateway/内嵌 PostgreSQL 容器与 Artifact volume；Dream frontend/backend
由 Dream 仓库单独发布。首次空目标数据引导、常规发布、单实例 migration、备份、
验证和回滚见 [部署指南](docs/deploy.md)。

AutoDL 直接部署将 embedded PostgreSQL 固定到 Admin 服务用户拥有的
`/root/ink-autodl/data/postgres`，共享 Artifact 仍位于 Dream 数据盘
`/root/autodl-tmp/ink-memory/artifacts`。initializer 会拒绝符号链接和未经确认的旧
cluster 路径切换，不会自动迁移、删除或用空库替代真实数据。

## 环境变量

| 变量 | 用途 | 初始化策略 |
| --- | --- | --- |
| `DATABASE_URL` | PostgreSQL 连接；本机默认 `127.0.0.1:54329/ink-memory` | 自动配置 |
| `INK_DATABASE_MODE` | 明确数据库 topology capability | 本机/容器固定 `embedded-postgres` |
| `EMBEDDED_POSTGRES_*` | 数据目录、端口、shared buffers 与连接数 | 本机自动配置；容器默认 5432/96MB/50 |
| `MIGRATION_DATABASE_URL` | 可选外部 migration 目标；未设置时只允许显式 embedded mode | 生产可由平台注入 |
| `BETTER_AUTH_URL/SECRET` | 唯一认证issuer与Session密钥 | 显式origin + `/api/auth`；secret至少32bytes |
| `AUTH_DATABASE_URL` | 专用auth角色 | 显式PostgreSQL，无fallback |
| `ADMIN_CONTROL_DATABASE_URL` | 一次性bootstrap control角色 | 显式PostgreSQL，无fallback |
| `DREAM_DATA_DATABASE_URL` | Admin Dream领域角色 | 显式PostgreSQL，无Dream DSN注入 |
| `GOOGLE_CLIENT_ID/SECRET` | 内置Google认证注册 | 显式注册与exactcallback |
| `AUTH_TRUSTED_ORIGINS/DREAM_API_RESOURCE` | trusted origins与OAuth resource | exact origins/resource |
| `AUTH_TOKEN_ENCRYPTION_KEY` | BFF/委托恢复密文 | 32bytes AEAD，不能回显 |
| `DREAM_DATA_SERVICE_CLIENTS` | 限定服务身份/redirect/background scopes | 严格JSON；Reflections执行服务需显式包含`reflections:execute`，confirmation dispatcher需显式包含`story-confirmation:dispatch`，均独立于用户Bearer |
| `DREAM_DATA_MAX_BODY_BYTES` | Admin领域请求体技术容量 | 显式正安全整数 |
| `DREAM_WORKSPACE_PLUGIN_POLICY_JSON` | Story Workspace server adapter 数据选择 | 严格JSON；package、marketplace与nullable版本由Admin配置，Dream请求不能覆盖 |
| `DREAM_RUNTIME_ACTIVATION_POLICY_JSON` | Story Workspace Runtime激活placement、creating lease与built-in adapter | 严格JSON；lease为1..300秒，Admin Service读取，Dream请求不能覆盖node、policy或artifact path |
| `DREAM_REFLECTION_REPORT_LIST_MAX_ROWS` | Reflections报告历史单次查询技术容量 | 必填正安全整数；Dream默认仍请求10条 |
| `DREAM_REFLECTIONS_LAUNCH_SNAPSHOT_MAX_BYTES` | Reflections私有启动快照技术容量 | 必填正安全整数；超限在持久化前拒绝 |
| `DREAM_REFLECTIONS_WORKSPACE_ROOT` | Reflections task workspace根目录 | 必填绝对路径；实际locator只追加task ID与`memory` |
| `AUTH_REFLECTIONS_AUTHORITY_TTL_SECONDS/MAX_TTL_SECONDS` | `rta_`短期续期与原最大寿命 | 必填正安全整数，短TTL不得超过最大TTL |
| `DREAM_FRIENDSHIP_POLICY_JSON` | 明确好友邀请码规则及碰撞执行预算 | `{"code_length":6,"lifetime_seconds":604800,"generation_attempts":64}` 的严格JSON；原6字符/7日，预算仅server capacity |
| `DREAM_DOMAIN_CANONICAL_TIMEOUT_MS` | 固定canonical业务codec deadline | 显式正安全整数；失败不输出payload |
| `DREAM_CONFIRMATION_DISPATCH_LEASE_SECONDS` | Story Workspace confirmation delivery租约 | 必填正安全整数；Admin计算deadline；Dream可请求不超过上限的短租约，但不能扩张策略 |
| `INK_WORKFLOW_TOKEN_SECRET` | Admin独占原Workflow pft签发与Run消费摘要 | 显式UTF-8至少32byte；无JWT_SECRET fallback，Dream不持有 |
| `DREAM_PREFLIGHT_TOKEN_TTL_SECONDS` | 原Preflight token TTL | 正安全整数，默认300秒；原回执恢复不刷新expiry |
| `DREAM_PREFLIGHT_MAX_INPUT_BYTES` | canonical Preflight输入技术容量 | 正安全整数，默认65536byte |
| `INK_DECK_HOST_COMPATIBLE` / `INK_CLAUDE_AGENT_CONTRACT_COMPATIBLE` / `INK_STORY_SCHEMA_COMPATIBLE` / `INK_DECK_RUNTIME_CONFIG_COMPATIBLE` | 明确server compatibility capability facts | 原Python strip+lower的1/true/yes/on；缺失fail closed，不按部署名称解锁 |
| `DREAM_WORKFLOW_CONTEXT_MAX_ATTEMPTS` | 完整retry链查询技术容量 | 保留原256默认；与权限独立 |
| `DREAM_CHAT_AUTO_TITLE_MAX_CHARACTERS` | 首条普通user消息自动title容量 | 保留原50默认，Python whitespace/Unicode字符 |
| `AUTH_RUNTIME_DELEGATION_TTL_SECONDS/MAX_TTL_SECONDS` | 窄授权续期与原最大寿命 | 显式正安全整数，renew不能扩张最大寿命 |
| `ADMIN_BOOTSTRAP_TOKEN` | 首次设置页面的一次性初始化授权 | 自动生成，至少 32 bytes；不发送给页面，需手工粘贴 |
| `ADMIN_ORIGIN_ALLOWLIST` | 管理写操作允许的 Origin，逗号分隔 | 本地默认 `http://localhost:3000` |
| `GATEWAY_API_KEY_PEPPER` | Gateway Key HMAC | 自动生成，至少 32 bytes |
| `AI_CREDENTIAL_ENCRYPTION_KEY` | Provider 凭据 AES-256-GCM 密钥 | 自动生成 32-byte Base64 |
| `AI_PROVIDER_HOST_ALLOWLIST` | 自定义上游 Provider 主机名，逗号分隔 | 可选；官方主机已内置 |
| `AI_PROVIDER_ALLOW_INSECURE_LOCALHOST` | 开发环境允许本地 HTTP Provider | 默认 `false` |
| `GATEWAY_MIN_RESERVE_MICROUSD` | 单次请求最低预授权金额 | 默认 `0` |
| `GATEWAY_MAX_BODY_BYTES` | 网关请求体上限 | 默认 `20971520` |
| `GATEWAY_IMAGE_INPUT_TOKEN_ESTIMATE` | 每个协议图片内容块的输入 Token 预留估算，不是模型能力或实际消耗 | 默认 `4784`；正安全整数；文本与请求体上限仍独立检查 |
| `FILE_STORAGE_TYPE` | 文件存储 capability：`disabled`、`vercel-blob` 或 `s3` | 当前固定 `disabled` |
| `FILE_STORAGE_PREFIX` | 对象 Key 前缀 | 默认 `uploads` |

Provider API Key 不属于应用运行环境变量。请在 `/admin/models` 创建 Provider 时录入，系统只保存加密密文并在读取接口中返回指纹。

图片 base64 长度不等于输入 Token 数。公开请求与 Provider 使用相同协议时，Gateway 分别估算图片与文本，
只在估算投影中移除图片编码，发送到 Provider 的原始内容不变。
该配置是可调整的预留估算；Provider 的图像处理规则可能不同，最终消耗仍取实际 `usage`。
现有跨协议转换可能把图片工具结果编码成文本，因此跨协议请求保留原有 JSON 字节估算。
`400 MODEL_CONTEXT_WINDOW_EXCEEDED` 表示上下文检查拒绝，不是 SSE 网络断线；
真实大文本仍需分段读取或压缩历史，不能通过提高 SDK 缓冲区绕过上下文上限。

自定义 OpenAI/Anthropic 兼容域名必须先把**主机名**加入
`AI_PROVIDER_HOST_ALLOWLIST`（逗号分隔，不填写 scheme 或 path），然后重启 Admin。
Provider 没有 `/models` 接口时，在“添加 Provider → 模型目录模式”选择
“无 `/models`，手工配置”并填写上游型号；保存后系统直接打开“添加模型”并预填
Provider、上游型号、alias 和显示名称，不会发起模型目录请求。

## 文件存储

Storage API 与 provider 实现仍保留，但基础 topology 暂停对象存储：

- `GET /api/storage`：读取存储驱动和配置状态；
- `POST /api/storage/upload`：服务端 multipart 上传；
- `POST /api/storage/upload-url`：获取 Vercel Blob 客户端令牌或 S3 Presigned URL；
- `GET /api/storage/file/k64_<key>`：通过安全编码的对象 Key 代理预览或下载。

Storage 的核心接口、驱动实现、Key 校验与内容转换位于 `app/lib/file-storage`。对公网开放上传接口前，应在业务接入层补齐用户鉴权、限流与文件大小策略。

当前 `FILE_STORAGE_TYPE=disabled`，发现接口返回 `FILE_STORAGE_DISABLED`，文件操作
fail closed；没有 MinIO 容器、端口、bucket 或 volume。重新启用必须显式选择
Vercel Blob/外部 S3，并同时恢复部署配置与凭据校验。

## 数据库与迁移

```bash
pnpm db:generate        # 修改 packages/db/src/schema/** 后生成前向 migration
pnpm db:migrate:status  # 只读显示已应用连续前缀和待执行 migration
pnpm db:migrate         # 统一前向迁移入口；需要时编排两个 Provider data gate
pnpm db:migrate:provider-managed-accounts # 同一受控编排的兼容命名入口
pnpm db:migrate:check   # 要求 journal、hash、数据库 receipt 全部 current
```

`packages/db/src/schema/**` 是唯一 TypeScript schema，`drizzle/**` 是不可变 SQL/
journal/snapshot 历史。Dream 启动只检查 capability，不执行 DDL。runner 优先使用
显式 `MIGRATION_DATABASE_URL`；缺少时只在 `INK_DATABASE_MODE=embedded-postgres`
明确存在后启动内嵌目标，绝不回退复用应用 DSN。生产 migration 仍由单实例发布步骤执行。

MCP App 连接设置由前向 migration `0053_rare_lenny_balinger` 扩展：它只在
`dream_mcp_servers` 上增加默认关闭的用户选择与独立 revision，然后发布
`dream.mcp-app-connection-settings.v1`。发布顺序必须是先应用并核对该 Admin
migration，再发布依赖它的 Dream 代码；不需要业务数据回填。

若存量数据库从 0046 升级，根命令 `pnpm db:migrate` 会针对同一个显式或内嵌
migration target 顺序执行 `0047 → managed-account data → 0048 → 0049 →
provider-owned data → 0050 → check`；`pnpm db:migrate:provider-managed-accounts`
保留为同流程的命名入口。第二个 data runner 把旧 effective binding 收敛为“一个
Provider 一个账号”，不复制、不删除、不重加密 token；如果一个 live credential 被多个
Provider 共享或没有唯一 owner，命令会 fail closed，必须先显式断开/重新授权。运行前必须
保留旧 credential encryption key，并配置 `AI_PROVIDER_ACCOUNT_IDENTITY_PEPPER`；active
attempt 或非终态 revoke job 也会阻断 contract migration。

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

本机内嵌数据库由 package 按命令生命周期启动。可使用以下命令确认 migration 与应用：

```bash
pnpm db:migrate:check
pnpm dev
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
│   └── db/              # @ink-memory/db 兼容 facade
└── v1/                  # 模型兼容网关 Route Handlers
packages/db/             # DB client、schema、embedded PG、migration
drizzle/                 # 不可变 PostgreSQL migrations 与可审计 data runners
scripts/                 # 环境初始化与迁移脚本
tests/e2e/               # Playwright 管理后台验收
docker/                  # 单 Admin/embedded-PG 镜像与 Compose
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
