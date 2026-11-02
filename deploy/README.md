<!--
[Input] The agreed Admin SSH runtime and platform-specific deployment contracts.
[Output] Route operators to pnpm local:stable and maintained optional platform resources.
[Pos] Deployment inventory; retired ECS Docker release entrypoints have been removed.
[Sync] 2026-10-25: make native pnpm the Admin SSH deployment entrypoint.
-->
<!-- [Sync] 2026-10-29: link ECS-only service operations; workstation bridges are historical issues. -->
# Admin deployment

Admin 在 SSH 服务器上直接运行 `pnpm local:stable`，由同一 PostgreSQL supervisor 管理 Admin、Gateway 和内嵌 PostgreSQL。默认在服务器构建；本机负责 SSH 和已授权传输，不启动本机 Docker。

完整操作、数据迁移、非 root 运行、资源预算、nginx 与验收要求见[部署指南](../docs/deploy.md)。ECS systemd 的完整配置、创建命令、维护与操作记录见[服务手册](../docs/deploy-services.md)。本次目标为 `root@39.97.252.88`；代码目录、服务账户和端口必须核对当前实际运行配置。

| 路径 | 用途 |
| --- | --- |
| [`nginx/`](nginx/.folder.md) | Admin 反向代理模板，参数来自实际域名和监听配置 |
| [`autodl-ssh/`](autodl-ssh/.folder.md) | 独立 AutoDL/SeetaCloud 平台入口，不替代本次 ECS 的 pnpm 启动方式 |

旧 `remote-ssh` 的 Docker 发布脚本、Compose、配置投影器及其测试已删除。历史 ignored 配置仍受 Git 忽略保护，不作为有效发布入口。`docker/` 只用于明确请求的容器验证。
