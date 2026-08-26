# Admin deployment

Admin 仓库负责发布 Admin/Gateway、内嵌 PostgreSQL 与 Artifact 读取边界。
Dream 仓库只发布 Dream frontend/backend，并通过显式 Docker 网络消费这里发布的
PostgreSQL 与 Admin/Gateway。MinIO 当前关闭，storage capability 显式 disabled。

| 平台 | 入口 | 说明 |
|------|------|------|
| Remote SSH（含阿里云 ECS） | [`remote-ssh/deploy.sh`](remote-ssh/deploy.sh) | 单镜像构建、embedded PG 导入、package migration、nginx、物理备份与回滚 |
| AutoDL SSH | [`autodl-ssh/deploy.sh`](autodl-ssh/deploy.sh) | 直接本机 Node/screen 发布；Admin 监听 `127.0.0.1:6008`，embedded PG 由专用非 root 用户管理，不使用 Docker/nginx |

AutoDL 的 PostgreSQL 默认位于 Admin 服务用户 home 下的 `/var/lib/ink-memory/data/postgres`；共享 Artifact 位于 Dream 数据盘 `/root/autodl-tmp/ink-memory/artifacts`。脚本发现旧 `/root/autodl-tmp/ink-memory/postgres` cluster 且新位置为空时会停止，不会自动迁移或初始化替代数据库。

真实 secret 只保存在对应平台 ignored `.env` 和远端 mode-0640 配置；Remote SSH 使用
[`remote-ssh/prepare-env.sh`](remote-ssh/prepare-env.sh) 从现有 ignored `docker/.env`
生成，AutoDL 使用 [`autodl-ssh/prepare-env.sh`](autodl-ssh/prepare-env.sh) 从 `.env.local`
投影。两条路径都不在命令输出中打印值。
