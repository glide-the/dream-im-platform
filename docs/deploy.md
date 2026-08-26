# Ink Memory Admin 部署

Admin 仓库拥有 Admin/Gateway、内嵌 PostgreSQL、Artifact volume 与 Drizzle
migration。Dream 只发布 frontend/backend，通过共享网络消费 Admin 和数据库。
独立 PostgreSQL 与 MinIO 服务已经移除，文件存储当前显式禁用。

架构细节见
[数据库 Package 与内嵌 PostgreSQL](architecture/database-package-and-embedded-postgresql.md)。

## AutoDL SSH 直接部署

AutoDL 使用独立的 `deploy/autodl-ssh` 平台，不复用 ECS 的 Docker/nginx 路径。先以明确的 Admin/Dream 公网 origin 生成安全配置，再执行首次 `bootstrap` 或常规 `deploy`：

先将 `deploy/autodl-ssh/platform.env.example` 复制为 gitignored 的 `platform.env` 并填写 SSH、`/root` 路径及 Dream/Admin 公网映射；发布入口会自动读取该文件。

```bash
AUTODL_ADMIN_PUBLIC_ORIGIN=https://admin-tunnel.example.com:8443 \
AUTODL_DREAM_PUBLIC_ORIGIN=https://dream-tunnel.example.com:8443 \
./deploy/autodl-ssh/prepare-env.sh

export AUTODL_SSH_HOST=connect.example.com
export AUTODL_SSH_USER=root
export AUTODL_SSH_PORT=22
export AUTODL_ADMIN_PUBLIC_ORIGIN=https://admin-tunnel.example.com:8443
./deploy/autodl-ssh/deploy.sh check
./deploy/autodl-ssh/deploy.sh bootstrap
```

Admin 固定监听 `127.0.0.1:6008`，SeetaCloud 负责 HTTPS 端口映射。应用与嵌入式 PostgreSQL 以专用非 root 用户运行；代码、配置与版本化 release 在 `/root/ink-autodl/admin`，PostgreSQL 默认在服务用户 home 的 `/var/lib/ink-memory/data/postgres`，共享 Artifact 在 `/root/autodl-tmp/ink-memory/artifacts`。`bootstrap` 对非空目标 fail closed；日常发布运行显式 Drizzle migration 后再启动应用，`rollback` 不回滚数据库。若检测到旧 `/root/autodl-tmp/ink-memory/postgres/PG_VERSION` 且新目录尚无 cluster，initializer 会停止，要求运维先按停机、备份、校验流程处理真实数据；发布脚本不会自行移动或删除它。

## 阿里云 ECS

生产入口是 [`../deploy/remote-ssh/deploy.sh`](../deploy/remote-ssh/deploy.sh)：

```bash
ADMIN_PUBLIC_ORIGIN=https://ink-admin.suoxya.com \
DREAM_PUBLIC_ORIGIN=https://ink-frontend.suoxya.com \
./deploy/remote-ssh/prepare-env.sh

export REMOTE_SSH_HOST=<ecs-host-or-ip>
export REMOTE_SSH_USER=<ssh-user>
export REMOTE_APP_DIR=/srv/ink-admin-memory

./deploy/remote-ssh/deploy.sh check
./deploy/remote-ssh/deploy.sh deploy
```

Compose 只有 `ink-memory-admin`：镜像内 `@ink-memory/db` supervisor 以非 root
运行 PostgreSQL 18.1 与 Next.js。数据分别持久化到
`ink_memory_postgres_data`、`ink_memory_artifact_data`。Admin 使用
`127.0.0.1:5432`；Dream 通过 private network alias
`ink-memory-postgres:5432` 访问；5432 不映射到 ECS host。

### 首次导入现有数据库

首次空目标直接使用 Admin package 管理的本机内嵌 PostgreSQL：

```bash
./deploy/remote-ssh/deploy.sh bootstrap
```

脚本从 mode-0600 `.env.local` 验证 `INK_DATABASE_MODE=embedded-postgres`、绝对数据
目录与 `PG_VERSION`，临时启动该 cluster 后生成 gzip 压缩的纯 SQL dump，并保留一份
到远端 `backups/`，然后调用
`@ink-memory/db` 流式 restore。纯 SQL 避免 `pg_restore` archive 版本不兼容；内嵌目标
已有任意用户表时立即失败、不覆盖，本机数据目录也不删除。MinIO 数据不上传、不初始化。
dump 进程只通过子进程环境接收 `PGPASSWORD`，不会等待交互输入或打印 secret。
需要使用其他源 env 时显式设置
`LOCAL_SOURCE_ENV_FILE`。
若镜像已经成功构建、但首次 dump/import 在后续步骤失败，可执行
`./deploy/remote-ssh/deploy.sh bootstrap-resume`；它先验证现有目标 image，再从空库
guard 继续导入、migration、启动与验证，不重复消耗 ECS 内存构建镜像。
若 dump 已完整上传，额外设置
`REMOTE_BOOTSTRAP_DUMP=/srv/ink-admin-memory/backups/<file>.sql.gz` 可复用远端文件；路径
必须位于当前 `REMOTE_APP_DIR/backups/` 且非空，不会重复传输大体积数据。

维护镜像同时固定 `postgresql-client-18`，与 embedded server major 一致；dump/restore
命令不会退回 Debian 默认的旧 major 客户端。

### 发布顺序

`deploy` 顺序固定为：preflight → nginx → rsync → shared network → image snapshot →
single image build → package migration → migration check → Admin start → PostgreSQL/
Admin/nginx verify。

面向当前 2 GiB ECS，Dockerfile 先完成 Next.js builder，再安装 runner 的系统包，借由
stage dependency 阻止 BuildKit 同时运行 Next 编译与 `apt`。远端默认只启用 1 个 Next
worker，并把每个 Node 进程的 V8 old-space 上限设为 `640MB`；该限制只影响镜像构建。
生成的阿里云 env 同时把 Debian、Debian Security 与 PGDG build mirror 指向 ECS VPC
镜像地址；Dockerfile 的默认值仍是上游官方源，因此其他平台不继承阿里云网络假设。
部署脚本、文档、`backups/` 与 SQL dump 不进入 image build context，发布编排调整不会
使 Next builder 缓存失效，数据库备份也不会进入 BuildKit cache。

镜像固定 `RUN_DB_MIGRATIONS=false`，入口遇到 `true` 会失败。业务启动和重启都不会
执行 DDL。migration 保留 38 个历史 receipt 的连续前缀和 hash 校验。

## 本机与 Docker

本机默认完全不需要 PostgreSQL 容器：

```bash
pnpm install
pnpm env:setup
pnpm db:migrate
pnpm dev
```

`.env.local` 明确配置 `INK_DATABASE_MODE=embedded-postgres`，默认数据目录
`.ink-memory/postgres`、端口 `54329`。`pnpm dev` 由 package supervisor 同时管理
PG 与 Next.js；停止开发进程会干净关闭 PG，数据目录保留。

需要容器 parity 时：

```bash
pnpm env:setup
pnpm docker:up
pnpm docker:logs
```

本地 Compose 仍只有一个 Admin service，并将其内嵌 PG 绑定到
`127.0.0.1:5433` 供本机工具访问。`pnpm docker:up` 先用 one-off container 执行
migration，再启动常驻容器。

## 配置合同

- `INK_DATABASE_MODE=embedded-postgres`
- `POSTGRES_USER`、`POSTGRES_PASSWORD`、`POSTGRES_DB`
- `EMBEDDED_POSTGRES_DATA_DIR`、`EMBEDDED_POSTGRES_PORT`
- AutoDL `AUTODL_ADMIN_HOME`（必须位于 Dream `AUTODL_DATA_ROOT` 之外）
- `EMBEDDED_POSTGRES_SHARED_BUFFERS`（ECS 默认 `96MB`）
- `EMBEDDED_POSTGRES_MAX_CONNECTIONS`（ECS 默认 `50`）
- `NEXT_BUILD_CPUS`、`NEXT_BUILD_MAX_OLD_SPACE_MB`（只约束镜像 build，ECS 为 `1`/`640`）
- `DEBIAN_MIRROR`、`DEBIAN_SECURITY_MIRROR`、`PGDG_MIRROR`（只约束镜像 build）
- Admin、Gateway、Provider 加密和 Product API secrets
- `FILE_STORAGE_TYPE=disabled`
- `RUN_DB_MIGRATIONS=false`

`prepare-env.sh` 从 mode-0600 `docker/.env` 保留 PostgreSQL 和控制面 secret，删除
MinIO/S3/AWS 字段并生成 ECS origin/topology。两个 env 文件都不得提交或打印。

## 健康、日志、备份与回滚

```bash
./deploy/remote-ssh/deploy.sh verify
./deploy/remote-ssh/deploy.sh ps
./deploy/remote-ssh/deploy.sh logs
./deploy/remote-ssh/deploy.sh backup
./deploy/remote-ssh/deploy.sh rollback
```

`verify` 在运行容器内执行 DB identity query，再验证 `/admin/login` 和 nginx。
`backup` 短暂停止 Admin，对关闭的 cluster volume 生成物理 `tar.gz`，随后立即启动并
复验。物理备份只能恢复到相同 embedded PostgreSQL major/runtime；恢复必须人工确认
目标 volume。`rollback` 只换应用镜像，不回滚或删除 PG volume。

## 文件存储

当前没有 MinIO、bucket、storage volume 或端口。`GET /api/storage` 返回
`FILE_STORAGE_DISABLED`；上传、下载和 Admin storage resource fail closed。
恢复对象存储必须显式选择 Vercel Blob 或外部 S3，并同步恢复凭据、部署变量和验收。
