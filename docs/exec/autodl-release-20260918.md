<!-- [Input] User-authorized AutoDL target, merged Admin main, and the direct-host release contract. -->
<!-- [Output] Sanitized Admin release, migration, OAuth catalog, capability and public verification evidence. -->
<!-- [Pos] Admin-side 2026-09-18 AutoDL release receipt; secrets and tokens are excluded. -->
<!-- [Sync] 2026-09-18: record the new-instance origin cutover and activated Admin release. -->

# Admin AutoDL 发布回执（2026-09-18）

## Optimized Prompt

从当前 AutoDL 实例动态读取 Admin 6008 与 Dream 6006 HTTPS origin，更新 gitignored platform 配置和 Dream service-client origin/callback。构建不可变 Admin candidate，在 16008 验证，再执行 Admin Drizzle 唯一前向 migration、OAuth catalog 协调与原子切换。最后用真实 confidential `client_credentials` token 调用受保护 capability，并验证本机 6008 与公网 Admin 登录页。成功后删除旧应用 release 和临时链接，不删除 PostgreSQL、Artifact 或 Dream workspace。

## 发布门禁修正

Provider-free topology fixture 原先会读取 operator `platform.env`，使合成 origin 被当前实例覆盖。PR [#25](https://github.com/glide-the/dream-im-platform/pull/25) 让 fixture 显式选择 `/dev/null` platform file；正常发布仍读取 gitignored operator 配置。Drizzle migration journal 与 Deterministic checks 均通过后合并到 `main`。

## 结果

- Commit：`3e7a04596088e0f9430467fc3307da26d830fe8c`
- Release：`/root/ink-autodl/admin/releases/3e7a04596088.20260918043804`
- `current` 精确指向该 release；release 目录只保留这一版。
- PostgreSQL migration：64/64 current；latest `0063_smiling_microbe`。
- OAuth catalog：Dream browser/service client 更新到当前实例；当前 Dream resource link 创建，旧实例 link 删除；device client 本身 unchanged。
- Auth/data gate：service token HTTP 200；受保护 capability HTTP 200；输出已脱敏。
- Listener：Admin 127.0.0.1:6008 与 PostgreSQL 54329 运行；公网 WebUI-6008 `/admin/login` HTTP 200。

Dream 产品用户与 Admin operator 没有合并。本次没有重置账号密码、修改业务用户或执行真实 Google/模型验收。数据库与共享业务数据保持；应用 rollback 不反向 migration。
