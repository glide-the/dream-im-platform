<!-- [Input] User-authorized AutoDL deployment, merged Admin/Dream commits, existing direct-host scripts, and task 01a05775-b5b2-7362-b388-fa23be380eab. -->
<!-- [Output] Admin-side deployment plan and append-only evidence for the 2026-09-17 unified auth/data release. -->
<!-- [Pos] Admin AutoDL release receipt; secrets and business payloads are excluded. -->
<!-- [Sync] 2026-09-17: define candidate smoke, candidate-owned migration, atomic activation, pruning, and public acceptance gates. -->

# Admin AutoDL 发布回执

## Optimized Prompt

将合并后的 Admin `main` 精确 commit 发布为统一认证中心和 Dream 数据接口服务。复用 direct-host AutoDL 脚本与远端持久 PostgreSQL；构建不可变 candidate，在旧 Admin 仍服务且 PostgreSQL 已启动时于 `16008` 隔离验证登录页面。停止旧应用后，以 candidate 自带 Drizzle 和 Provider migration orchestrator 执行唯一前向 migration，再原子切换 `current`。验证本机 `6008`、公网 `/admin/login`、migration journal、capability 与 Dream DTO API。失败时在本轮内恢复旧应用；全部通过后删除旧 release、`previous` 和 `candidate`，不保留长期回滚点，不回滚数据库。

不得合并 Admin 管理员与 Dream 产品用户；不得打印或提交 secret；不得删除 PostgreSQL、Artifact 或 Dream workspace。Dream 发布必须等待本阶段成功。

## 初始证据

设备重启后服务未运行，但 `/root/ink-autodl/admin/current` 和持久目录仍存在。本段不声明部署成功；实际 commit、migration 数、health 与公开入口结果在执行后追加。
