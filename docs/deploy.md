<!-- [Sync] 2026-11-08: 当前发布改为GitHub手动Actions，在Linux runner构建完整制品，ECS保持start:embedded与原数据库。 -->
<!--
[Input] The confirmed SSH host, exact Admin source release, private runtime configuration and existing PostgreSQL data.
[Output] Admin-only deployment through pnpm local:stable, with explicit data transfer and service verification.
[Pos] Authoritative Admin deployment guide; container tooling is not the SSH release path.
[Sync] 2026-10-25: remove retired ECS Docker instructions and use the agreed native pnpm entrypoint.
[Sync] 2026-10-29: add the complete service creation, maintenance, logging and usage-record companion.
[Sync] 2026-10-29: scope production operations to ECS; move temporary workstation bridges to an incident record.
[Sync] 2026-10-31: disable swap/zswap and allow systemd to restart Admin after OOM.
[Sync] 2026-11-02: require capacity checks before building and document prebuilt recovery through start:embedded.
-->
# Ink Memory Admin 部署

本指南仅说明线上 ECS 的部署。三个 systemd 服务的完整配置、创建步骤、启停与更新、日志、限速恢复和操作记录，见[Admin 线上服务创建、维护与使用记录](deploy-services.md)。所有运维命令在 ECS 上执行。

线上出口和持久文件应由服务器设施提供，不以个人电脑、桌面代理或用户登录会话为部署前提。当前线上仍有迁移时引入的临时出口和文件复制依赖，尚未完成替换；具体事实与影响见[临时桥接问题记录](verification/ecs-admin-temporary-bridges-20261029.md)。该记录不是生产部署步骤。

## GitHub 手动打包发布（当前入口）

参考用户指定的`-Ink-Memory/.github/workflows/deploy-pages.yml`，构建与发布采用独立job。Admin使用[deploy-admin.yml](../.github/workflows/deploy-admin.yml)，仅注册`workflow_dispatch`，运行分支限定`main`。push、PR、合并和定时任务均无部署动作；原test.yml继续执行CI检查。[GitHub workflow语法](https://docs.github.com/en/actions/reference/workflows-and-actions/workflow-syntax)定义手动事件和并发规则。

1. 打开GitHub仓库Actions，选择 **Build and deploy Admin (manual)**。
2. 点击 **Run workflow**，选择`main`并运行。build job执行锁定依赖安装、配置／单元／lint／完整类型检查和Next构建，打包完整Linux源码、依赖闭包与构建输出。
3. deploy job从同一次运行读取制品，使用`admin-production`环境的专用SSH key，严格核对已登记host key；受限入口校验主机、摘要、Node版本、磁盘、内存、原完整制品、配置和数据库目录。
4. check-only迁移检查通过后，切换原systemd到候选，继续`pnpm run start:embedded`。健康失败恢复前一drop-in及原完整制品；成功输出source SHA、BUILD_ID、前后release路径和数据库inode。登录页200属于HTTP检查，真实账户、业务与模型验收单列。

构建预算只作用于GitHub runner。ECS无构建、依赖安装、全库备份或自动DDL；存在pending migration、身份／配置／依赖／摘要差异时，在服务切换前停止。前向schema发布沿原Admin显式迁移流程单独执行，0086已发布能力由迁移记录核对。所有发布共享一个并发组，`cancel-in-progress=false`，主机再使用文件锁；重复执行以新手动运行建立独立release目录。

仓库变量：`ADMIN_NODE_VERSION`。环境变量：`ADMIN_SSH_HOST`、`ADMIN_SSH_PORT`、`ADMIN_SSH_USER`、`ADMIN_PUBLIC_ORIGIN`。环境secrets：`ADMIN_DEPLOY_SSH_KEY`与`ADMIN_DEPLOY_KNOWN_HOSTS`。专用公钥保留现有authorized_keys，仅附加带`restrict`和固定command的发布入口；原个人SSH key保持在原位置。`admin-production`仅允许main，部署执行无需新增人工确认。

接收脚本[admin-action-deploy.py](../scripts/admin-action-deploy.py)安装为root所有，配置保存在服务器`/etc/ink-memory-admin/github-deploy.json`，权限0600。配置明确原实例、service、运行用户、Node/pnpm、release根、现用PostgreSQL根、健康URL及本机预算；脚本只接受`preflight`或四段具名deploy命令，退出任意shell／scp／端口转发路径。制品由[package-admin-release.mjs](../scripts/package-admin-release.mjs)生成，私有env保留在ECS，从原release复制并校验字节，不进入GitHub制品。

当前流程取代下文历史的服务器原地源码构建步骤。手动诊断、服务恢复及原迁移权限继续沿既有运维合同。

## 历史源码部署方式与范围

源码发布入口为 `pnpm local:stable`，执行 `pnpm build && pnpm run start:embedded`，由现有 PostgreSQL supervisor 启动 Admin、Gateway 和内嵌 PostgreSQL。目标服务器构建须先通过[构建内存与发布失败恢复手册](release-build-memory-and-recovery.md)的容量与恢复检查；资源不足时优先评估兼容主机准备完整候选。完整制品的运行与恢复复用已有 `pnpm run start:embedded`。本轮仅修订文档，实际 unit 与发布方式按维护时核对结果处理，不启动本机 Docker。

本次约定的 SSH 目标为 `root@39.97.252.88`，Admin 公网入口为 `https://ink-admin.suoxya.com`。SSH 登录身份与运行身份不同：内嵌 PostgreSQL 拒绝 root，应用和数据库必须使用专用非 root 服务账户。代码目录、服务名称、端口和数据目录以实际运行配置为准。

只部署 Admin 不包含发布 Dream。服务器上的旧 Dream 项目、遗留镜像或已退出容器不能作为当前部署方式的证据；Dream 数据表由 Admin PostgreSQL 持有，删除 Dream 项目不等于删除这些业务数据。

旧 `deploy/remote-ssh` Docker 发布入口、Compose 和配置投影器已移除。可复用的反向代理模板保留在 [`deploy/nginx/ink-memory-admin.conf.template`](../deploy/nginx/ink-memory-admin.conf.template)。`docker/` 仅用于明确请求的容器验证，不参与本流程。

## 发布前核对

构建前必须确认物理可用内存、有效 cgroup 限额、Node 实际堆选项、所有 worker 预算及原完整制品。512 MiB 堆与 900 MiB 构建限额属于单次事故参数；检查步骤、失败判断和恢复条件见[专项手册](release-build-memory-and-recovery.md)。容量不足时停止发布，禁止并行构建或反复 restart 重试。

先通过 SSH 确认实际服务进程、服务管理器、源码提交、监听端口和数据库目录，再准备候选代码。不要覆盖其他任务的未提交修改，也不要把过期配置、旧备份或旧数据卷默认为当前数据源。

服务器需要与 `package.json` 匹配的 Node.js 和 `pnpm@9.15.0`，并安装完整依赖：

```bash
pnpm install --frozen-lockfile
```

`local:stable` 使用源码、TypeScript、esbuild 和 tsx，不能使用 `--prod` 安装或用 standalone `server.js` 目录代替完整项目。普通部署不在本机另起服务、不安装本机容器运行时。

服务器禁用 swap 与 zswap，Admin 设置 `MemorySwapMax=0`。构建前核对物理内存与磁盘，资源预算以实际物理容量为准。现有构建配置支持以下显式资源选项：

```bash
export NEXT_BUILD_CPUS=1
export NEXT_WEBPACK_MEMORY_OPTIMIZATIONS=true
```

共享 Next.js 配置显式启用 `experimental.webpackBuildWorker`，使自定义 extension alias 不再关闭独立编译 worker，避免编译进程与后续类型检查叠加占用内存。此方式来自 [Next.js 内存优化说明](https://nextjs.org/docs/app/guides/memory-usage#webpack-build-worker)，保留完整 TypeScript 检查。

这些选项只控制构建资源。Node heap 上限通过 `NODE_OPTIONS` 按物理内存预算设置，并为其他进程和 native 内存预留空间；V8 heap 上限不等于进程总内存。通过 systemd 的物理内存上限、`MemoryHigh` 与 OOM 计数判断资源状态。OOM 后由 systemd 自动重启 Admin，不启用交换作为构建或恢复手段。

## 运行配置与数据

运行配置保存在项目根目录的 `.env.local`，权限为 `0600`，归运行服务账户所有。沿用与现有数据匹配的密钥、OAuth 注册、Gateway binding 和业务策略，不能通过重新生成配置替换已有加密密钥。

必须确认：

- `INK_DATABASE_MODE=embedded-postgres`，`RUN_DB_MIGRATIONS=false`。
- `EMBEDDED_POSTGRES_DATA_DIR` 是明确的持久化目录，由服务账户拥有，权限为 `0700`。
- `DATABASE_URL`、`MIGRATION_DATABASE_URL` 和三个受限角色连接指向同一个目标数据库及端口，各角色凭据仍保持独立。
- issuer、trusted origins、service callbacks 与实际 Admin/Dream 公网入口一致，保留仍在使用的现有客户端注册。
- `FILE_STORAGE_TYPE=disabled`；Artifact 和 Reflections 的目录合同保持一致，已有绝对路径不能被随意重写。

普通 dotenv 中含 JSON，不要把 `.env.local` 当 shell 脚本 `source`。Next.js 与数据库 package 使用已有配置加载路径；独立维护命令可使用支持 `--env-file` 的 Node.js 显式加载文件，secret 不进入命令行参数或日志。

原生 `next start` 从 `PORT` 读取端口，不依靠 `HOSTNAME` 环境变量限制监听地址；内嵌 PostgreSQL 当前默认监听所有接口。以实际监听结果和服务器防火墙、安全组保护应用及数据库端口，只将 nginx 入口对外开放。

### 迁入现用数据

数据迁移必须有明确授权，并先确认现用源库及其配置。切换前停止源写入，导出最终一致快照；若源服务重新启动，先前快照不能直接作为最终切换数据。

使用 PostgreSQL 兼容客户端导出完整数据库、角色和权限，并校验备份摘要。`--no-owner` 只在确认所有对象仍属于同一数据库所有者时使用；不能用 `--no-privileges` 丢弃受限角色的对象或数据库级授权。备份、SQL、密码哈希和正文保持私有，不在控制台打印。

只向明确命名、验证为空的新目标恢复。保留源数据和旧目标，不覆盖未知数据库，不以空库初始化代替恢复。Artifact 复制保持相对目录和已有路径合同，向 Admin Reader 提供只读挂载；跨主机部署还需确认 Dream 后续产物的共享方式，单次复制不会形成持续共享。

恢复后在应用启动前比对表行数、schema、索引、约束、角色、对象所有者、权限和 Drizzle receipt。只有迁移历史确有缺项时，才按已授权发布步骤运行现有前向迁移编排；启动命令不执行 DDL。

权限核对应比较实际授权。`pg_dump` 可能将冗余的所有者 ACL 还原成 `NULL` 默认 ACL；按 PostgreSQL [`acldefault`](https://www.postgresql.org/docs/18/functions-info.html) 展开后，逐项比较授权者、被授权者、权限和 grant option，同时独立比较对象所有者与数据库级授权。不要因原始 ACL 表示不同而补授额外权限。

## 启动与进程托管

以专用非 root 服务账户，在确认的项目根目录执行：

```bash
pnpm local:stable
```

该入口先构建，再启动 PostgreSQL 和 `next start`。代码变化后重新执行同一入口生成新构建。不要同时启动第二个 supervisor 争用同一数据库目录。

正式运行使用服务器已有进程管理器托管，设置实际的项目目录、服务账户、`PORT`、资源配置和持久日志。systemd 的 `WorkingDirectory` 必须为完整项目目录，`ExecStart` 指向实际 pnpm 绝对路径；源码构建入口为 `local:stable`，已构建运行及故障恢复入口为 `run start:embedded`。入口切换按专项手册保留完整依赖和原配置，停止时管理整个进程组。配置只由原有 dotenv 路径读取，不把 `.env.local` 直接放入 shell 启动器。

本次 `ink-memory-admin.service`、出口服务、防火墙服务及 drop-in 的完整创建配置，见[服务手册的 ECS 创建章节](deploy-services.md#ecs-首次创建与配置记录)。已有服务的日志、发布目录切换、回滚与 `start-limit-hit` 处理，见[日常使用与维护](deploy-services.md#ecs-日常使用与维护)。

发布前记录原服务和日志归属。构建、恢复或启动失败时，只处理本轮明确拥有的进程；不能清理别人的服务或源数据库。`local:stable` 中断后须确认 PostgreSQL 正常关闭。

## nginx 与验证

按实际域名、绑定地址、端口和转发协议渲染[Admin nginx 模板](../deploy/nginx/ink-memory-admin.conf.template)，放入 nginx 的 HTTP include（如 `sites-available`/`sites-enabled`）。`__ADMIN_FORWARDED_PROTO__` 在本次上游终止 TLS 的拓扑中使用 `https`；由 nginx 自身终止 TLS 时可使用 `$scheme`。模板包含独立的 WebSocket upgrade map，并对 Google callback 关闭携带授权码的请求日志与 upstream 重试。

本次主机配置为 `/etc/nginx/sites-available/ink-memory-admin`，上游为 `http://127.0.0.1:3000`。先保留现有 Admin 配置，确认候选应用和最终源数据通过验证，再执行 `nginx -t` 并平滑 reload。只修改文件而未 reload 时，现有 worker 仍使用旧配置，不能据此宣称公网已切换。

先验证数据库身份与完整迁移记录，再验证本机端口、nginx 域名路由和公网入口：

```bash
curl -fsS http://127.0.0.1:<admin-port>/admin/login >/dev/null
curl -fsS -H 'Host: <admin-domain>' http://127.0.0.1/admin/login >/dev/null
curl -fsS https://<admin-domain>/admin/login >/dev/null
```

登录页返回 `200` 只证明路由可达。还要用既有受限角色验证数据库访问，并按当前业务范围验证认证和受保护能力。最终回执记录源码提交、启动命令、运行身份、服务状态、数据校验和各验证命令的退出码；文档更新本身不代表远端已经部署完成。

## 本次 ECS 的服务拓扑与维护

下表保留既有 ECS 部署记录；实时 `WorkingDirectory`、`ExecStart`、堆选项与资源覆盖项须在每次维护时核对。2048 MiB 堆属于已记录的容量风险，禁止直接复制为新构建预算。历史创建参数与修订后的操作要求分别由[服务手册](deploy-services.md)及[专项手册](release-build-memory-and-recovery.md)承载。

| 项目 | 实际配置 |
| --- | --- |
| Admin 服务 | `ink-memory-admin.service`，用户 `ink-admin`，执行 `/opt/ink-admin-node/bin/pnpm local:stable` |
| 完整源码 | `/srv/ink-admin-releases/20261024T164343Z-ee0497b43115` |
| PostgreSQL | `/var/lib/ink-memory-admin/postgres`，本机端口 `54329` |
| Admin 监听 | 端口 `3000`，主机防火墙拒绝来自非回环接口的 `3000`、`54329` 访问 |
| nginx | `/etc/nginx/sites-available/ink-memory-admin` → `http://127.0.0.1:3000` |
| Artifact 数据目录 | `/var/lib/ink-memory-admin/artifacts`，只读 bind 到数据库已有的 workspace 绝对路径；持续存储接入仍有临时依赖 |
| 指定域名出口 | `ink-admin-egress.service`，Tinyproxy 只监听 `127.0.0.1:17891`；当前上游仍有临时依赖 |
| 当前资源配置 | 1 worker、原有 2048 MiB V8 heap 上限、1328 MiB 物理内存上限；`MemorySwapMax=0`，主机 swap / zswap 均关闭 |

实际资源限制通过 `systemctl show ink-memory-admin.service` 核对，包括 `/etc/systemd/system.control/` 中的资源覆盖项。2026-10-31 已从 fstab 移除 `/swapfile` 条目，屏蔽 `swapfile.swap`，将 tmpfiles 的 zswap 开机设置改为 `N`，并将 `vm.swappiness` 设为 `0`。`swappiness=0` 本身不等于禁用交换，必须同时确认 `swapon --show` 为空、`SwapTotal=0` 和服务 `MemorySwapMax=0`。

Linux 上沿用的 `/Users/dmeck/project/ink-dream-memory/backend/data/agent-workspace` 是 ECS 内已有的只读挂载别名，用于兼容数据库中的历史路径，不要求在该目录部署 Dream。调整路径前必须处理现有数据绑定，不能只改 unit 中的目录。

需要代理的域名应使用 ECS 可独立访问、由线上运维管理的出口。Admin 通过 systemd 覆盖项读取回环代理地址及 Node `--use-env-proxy`；Tinyproxy 的上游按实际线上出口配置，其他可直连域名保持直连。创建配置见[服务手册](deploy-services.md#4-创建指定域名的出口服务)，其中上游占位符必须先替换为已验证的线上配置。

应用使用 `OOMPolicy=stop` 与 `Restart=on-failure`：发生 OOM 时停止服务进程组，10 秒后重启 Admin；`StartLimitIntervalSec=0` 取消原启动次数限制。现有 `pnpm local:stable` 在重启时仍会执行构建，内存不足造成的构建失败也遵循该重启策略。出口使用 `Restart=always`，5 分钟内最多启动三次。实际观察到出口重载会正常退出，因此依靠托管策略重新拉起；修改后要核对监听端口并做连通探测。应用通过 `Wants` 启动出口服务，出口故障不会触发 Admin 重新构建。

Artifact 的持续来源必须符合现有 Reader 的只读目录、版本和 hash 合同。一次迁移复制或周期副本均不能证明生产共享存储已经接通。

最终切换后的旧源 PostgreSQL 保留且停用，不能为恢复其他入口而重新上线，形成两个可写数据源。恢复与回滚均以当前 ECS 数据及已核验备份为依据。

服务器上分别检查应用、出口和防火墙服务，再检查 nginx：

```bash
systemctl status ink-memory-admin.service ink-admin-egress.service ink-admin-local-ports.service
journalctl -u ink-memory-admin.service --since '10 minutes ago'
nginx -t
```

日志可能含业务诊断，只在私有终端查看并按范围脱敏。旧 Docker、Docker socket 和 containerd 已停止并禁用；旧 Admin 数据卷保留，不能以清理构建空间为由删除。

## AutoDL 与可选容器工具

AutoDL/SeetaCloud 的独立平台配置和专用打包流程仍在 [`deploy/autodl-ssh`](../deploy/autodl-ssh/.folder.md)。其端口映射、目录和 standalone 启动器只适用于该平台，不能套用到本次 ECS 的 `pnpm local:stable` 服务。

[`docker/`](../docker/.folder.md) 保留显式容器验证工具。没有明确的容器需求时，不运行 `pnpm docker:*`、Docker Desktop 或旧 Compose 发布命令。
