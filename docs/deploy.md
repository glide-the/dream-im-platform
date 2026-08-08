# Ink Memory Admin 部署

## Docker Compose

```bash
pnpm env:setup
pnpm docker:up
pnpm docker:logs
```

`pnpm env:setup` 会生成 `docker/.env`、安全随机密钥和 PostgreSQL 密码，并删除当前项目不使用的旧变量。Compose 只包含 `ink-memory-admin` 与 PostgreSQL。

## 必填环境变量

- `DATABASE_URL`：容器内由 Compose 生成，数据库名默认 `ink-memory`
- `ADMIN_SESSION_SECRET`
- `ADMIN_BOOTSTRAP_TOKEN`
- `GATEWAY_API_KEY_PEPPER`
- `AI_CREDENTIAL_ENCRYPTION_KEY`
- `ADMIN_ORIGIN_ALLOWLIST`

生产环境设置 `ADMIN_CONSOLE_ENABLED=true`。默认 `RUN_DB_MIGRATIONS=true` 会在应用启动前通过 `scripts/migrate.mjs` 加锁执行已生成迁移。Provider API Key 应在管理后台加密录入，不写入部署环境文件。

## 首次初始化

```bash
set -a
source docker/.env
set +a

curl -X POST http://localhost:3000/api/admin/auth/bootstrap \
  -H "Origin: http://localhost:${APP_PORT}" \
  -H "X-Admin-Bootstrap-Token: $ADMIN_BOOTSTRAP_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"email":"admin@example.com","displayName":"Super Admin","password":"replace-with-a-long-password"}'
```

Bootstrap 只能成功一次。随后通过 `/admin/login` 登录。

## 健康与备份

```bash
docker compose exec postgres pg_isready -U ink_memory -d ink-memory
docker compose exec -T postgres pg_dump -U ink_memory -d ink-memory > ink-memory.sql
```

恢复前必须确认目标实例并安排维护窗口；不要对未知或共享数据库执行迁移、DROP 或 TRUNCATE。
