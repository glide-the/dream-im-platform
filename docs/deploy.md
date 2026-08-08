# Ink Memory Admin 部署

## Docker Compose

```bash
pnpm env:setup
pnpm docker:up
pnpm docker:logs
```

`pnpm env:setup` 会生成 `docker/.env`、安全随机密钥、PostgreSQL 密码和 MinIO 凭据，并保留 Storage/S3/Vercel Blob 配置。Compose 包含 `ink-memory-admin`、PostgreSQL、MinIO 与一次性 Bucket 初始化服务。

## 必填环境变量

- `DATABASE_URL`：容器内由 Compose 生成，数据库名默认 `ink-memory`
- `ADMIN_SESSION_SECRET`
- `ADMIN_BOOTSTRAP_TOKEN`
- `GATEWAY_API_KEY_PEPPER`
- `AI_CREDENTIAL_ENCRYPTION_KEY`
- `ADMIN_ORIGIN_ALLOWLIST`

文件存储默认连接 Compose 内置 MinIO；也可按驱动补充 `BLOB_READ_WRITE_TOKEN`，或外部 `FILE_STORAGE_S3_BUCKET`、Region 与 AWS/S3 凭据。`pnpm env:setup` 会保留外部配置，不会伪造云平台凭据。

生产环境设置 `ADMIN_CONSOLE_ENABLED=true`。默认 `RUN_DB_MIGRATIONS=true` 会在应用启动前通过 `scripts/migrate.mjs` 加锁执行已生成迁移。Provider API Key 应在管理后台加密录入，不写入部署环境文件。

## 首次初始化

Compose 完成迁移并启动应用后，第一次打开 `/admin` 会自动显示首次设置页。默认邮箱为 `dmeck@suoxya.com`，默认密码为 `test123456`；生产部署必须在提交前换成独立强密码。

把 `docker/.env` 中自动生成的 `ADMIN_BOOTSTRAP_TOKEN` 粘贴到“首次启动密钥”，点击“创建管理员并进入控制台”。Token 不会被服务端渲染到 HTML，也不会由浏览器自动读取。Bootstrap 只能成功一次；已有管理员时入口自动切换为登录页。

## 健康与备份

```bash
docker compose exec postgres pg_isready -U ink_memory -d ink-memory
docker compose exec minio curl -f http://localhost:9000/minio/health/ready
docker compose exec -T postgres pg_dump -U ink_memory -d ink-memory > ink-memory.sql
```

恢复前必须确认目标实例并安排维护窗口；不要对未知或共享数据库执行迁移、DROP 或 TRUNCATE。
