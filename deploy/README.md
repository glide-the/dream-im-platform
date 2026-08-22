# Admin deployment

Admin 仓库负责发布 Admin/Gateway、内嵌 PostgreSQL 与 Artifact 持久卷。
Dream 仓库只发布 Dream frontend/backend，并通过显式 Docker 网络消费这里发布的
PostgreSQL 与 Admin/Gateway。MinIO 当前关闭，storage capability 显式 disabled。

| 平台 | 入口 | 说明 |
|------|------|------|
| Remote SSH（含阿里云 ECS） | [`remote-ssh/deploy.sh`](remote-ssh/deploy.sh) | 单镜像构建、embedded PG 导入、package migration、nginx、物理备份与回滚 |

真实 secret 只保存在 ignored `deploy/remote-ssh/.env` 和远端同路径；使用
[`remote-ssh/prepare-env.sh`](remote-ssh/prepare-env.sh) 从现有 ignored `docker/.env`
生成，不在命令输出中打印值。
