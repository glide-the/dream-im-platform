# Ink Memory Admin 部署

## Docker Compose

```bash
cd docker
cp .env.example .env
# 填写强随机密钥
docker compose up -d --build
docker compose logs -f ink-memory-admin
```

Compose 只包含 `ink-memory-admin` 与 PostgreSQL，不再启动 MinIO、SQLite 挂载或 Agent workspace。

## 必填环境变量

- `DATABASE_URL`：容器内由 Compose 生成，数据库名默认 `ink-memory`
- `ADMIN_SESSION_SECRET`
- `ADMIN_BOOTSTRAP_TOKEN`
- `GATEWAY_API_KEY_PEPPER`
- `AI_CREDENTIAL_ENCRYPTION_KEY`
- `ADMIN_ORIGIN_ALLOWLIST`

生产环境设置 `ADMIN_CONSOLE_ENABLED=true`。默认 `RUN_DB_MIGRATIONS=true` 会在应用启动前通过 `scripts/migrate.mjs` 加锁执行已生成迁移。

## 首次初始化

```bash
curl -X POST http://localhost:3000/api/admin/auth/bootstrap \
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
