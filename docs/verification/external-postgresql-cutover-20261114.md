<!-- [Input] 用户授权的现用 Admin 数据库迁移、两台实例核对及手动发布记录。 -->
<!-- [Output] 外部 PostgreSQL 准备、应用发布、停写同步、切换与验证的分阶段证据。 -->
<!-- [Pos] 2026-11-14 数据库拓扑变更回执；状态以本记录实际完成项为准。 -->
<!-- [Sync] 2026-11-14: 登记应用发布、首次恢复、最终外部数据库切换、发布门禁与浏览器复核。 -->
# Admin 外部 PostgreSQL 迁移

## 目标与当前状态

用户授权将 Admin 的现用 PostgreSQL 从应用服务器迁到指定内网服务器，保留数据、密钥、独立角色与权限。最初目标位于杭州，与北京应用服务器的私网不通；暂停后用户新建北京目标 `172.24.244.97`，本轮以新目标继续。用户随后要求先发布最新代码，并同步修改 GitHub Actions 的数据库拓扑处理。

应用服务器仍为 `39.97.252.88`（私网 `172.24.244.96`）。新目标主机为 `iZ2ze9uoh0q1g8zc22h5xbZ`，运行 Alibaba Cloud Linux 4.0.6、x86_64，核对时内存约 1670MiB、磁盘剩余约 34GiB，没有 PostgreSQL 或其他业务服务。应用、nginx、出口和 Artifact 存储不在本次数据库迁移范围内。

最终已切换到`172.24.244.97:54329/ink-memory`，应用服务器以`INK_DATABASE_MODE=postgres`和`pnpm run start`运行，原源库停用并保留。在线预复制仅作为准备；最终采用第二次正常停写后的同步结果。

## 已完成的准备

- 应用服务器到新目标的 SSH 端口可达，同网段直连；未调整防火墙或安全组。
- 应用服务器 root 生成专用 Ed25519 key，并为新目标配置免密连接。目标公钥限定来源为 `172.24.244.96`，使用 `restrict,pty`；私钥保留在应用服务器，未写入仓库。初始 `restrict` 禁止了用户交互终端，用户反馈后保留来源限制并显式恢复 PTY；`ssh -tt root@172.24.244.97 'test -t 0 ... tty'` 退出码 0，实际终端为 `/dev/pts/0`。
- 新目标安装 rsync，创建独立非 root 账户 `ink-postgres`，准备命名数据目录 `/var/lib/ink-memory-postgresql/data-20261114`。
- 从现用完整制品复制同一 PostgreSQL 18.1 原生运行文件到 `/opt/ink-memory-postgres/18.1`，版本与动态库核对通过。没有初始化空业务库或运行 DDL。
- 新目标的`ink-memory-postgresql.service`已active/running并开机启用；数据库端口沿用`54329`，监听只包含回环和目标私网地址。
- 新目标复查发现启用中的 4GiB `/swapfile`。按仓库无交换策略执行 swapoff、私密备份并移除对应 fstab 条目、mask `swapfile.swap`、持久化 `vm.swappiness=0`；交换文件保留。复核 swap 为空、zswap 为 N，数据库服务 `MemorySwapMax=0`。
- 在线预复制命令退出码 0，共传输 2,251 个普通文件，文件总量 8,598,495,765 bytes。最终切换前仍须停写并执行带 checksum 的最终同步。

## 发布流程修改

[PR54](https://github.com/glide-the/dream-im-platform/pull/54) 已通过完整 CI 并合并为 `7cd999efef57b97c20723e56427e8cda677762d0`。工作流在 preflight 与 deploy 中传递 `ADMIN_DATABASE_MODE` 断言。root receiver 的实际配置拥有拓扑决定权，工作流变量不能替换数据库目标。

已手动触发 [Actions 43462851337](https://github.com/glide-the/dream-im-platform/actions/runs/43462851337)，来源为上述 main 提交，采用 90 分钟上传与激活期限。attempt 2 已 completed/success，build 与 deploy 均成功。现用完整制品为 `/srv/ink-admin-releases/actions-43462851337-7cd999efef57/app`，BUILD_ID 为 `OjXS6AYL5vlX7khoH2gms`。发布后原 env 字节保持、数据目录 inode 仍为 `1056781`，check-only migration 为 88/88、pending 为空，swap 为空且 zswap 为 N。

首次 build 成功，完整制品约 312MB；deploy 在公网 preflight 的 `URLError` 处停止，未创建候选目录、未上传制品或切换服务。核对显示直连的 Cloudflare 地址存在超时，原 `127.0.0.1:17892` 出口访问同一 HTTPS 登录 URL 返回 200（1.35秒），而 `17891` 仍超时。原接收器以该 HTTPS proxy 执行相同 `preflight embedded-postgres` 后退出码 0，公网为 200。

已私密备份 authorized_keys，并只为原专用发布 key 的固定 command 增加 `HTTPS_PROXY=http://127.0.0.1:17892` 与回环 `NO_PROXY`；`restrict`、固定 Python 接收器、已登记 key、host key、证书校验、URL 与期限保持。应用服务和模型网络策略保持原配置。由于首次失败发生在创建候选之前，本轮仅重跑失败的 deploy job，复用同一次成功 build 的完整制品。

`embedded-postgres` 保持原目录、所有权和 inode 检查。`postgres` 核对五个角色连接的同一目标以及 PostgreSQL cluster/database 身份，使用已有 `pnpm run start`；应用回滚保留同一外部数据库。root receiver 已备份并独立更新，文件 SHA-256 为 `c97e58055fb5dd52013c07e48236197a5d9247b72fe808817e30169e11e4a1f1`。更新后的 `preflight embedded-postgres` 退出码 0；一次公网回查超时后，本机应用、nginx 和后续公网预检均为 200，没有修改健康检查合同。

| 验证命令 | 结果 |
| --- | --- |
| `pnpm test:release-receiver` | 退出码 0，22 项通过。 |
| `pnpm test:config` | 退出码 0，35 项 Node 测试及 topology contract 通过。 |
| `pnpm exec tsc --noEmit` | 退出码 0。 |
| `pnpm test:run` | 退出码 0，340 个文件、2,641 项通过，37 项跳过。 |
| `pnpm lint` | 退出码 1，既有 `.ink-memory/maintenance` 下的历史生成 bundle 被扫描；原归档保留。 |
| `pnpm lint --ignore-pattern '.ink-memory/**'` | 退出码 0，authored source 检查通过。 |
| `pnpm exec playwright test --config=/tmp/ink-admin-db-move-20261114.ANssB7/public-smoke.config.cjs`（发布前） | 退出码 0，1 项通过；正常服务的登录页面、匿名 API 401 与旧路由 404 均通过。 |
| 同一 Playwright 命令（最新制品发布后） | 退出码 0，1 项通过，登录页面和匿名授权边界保持。 |
| 文档相对路径检查与 `git diff --check` | 退出码 0。 |

浏览器沿用已安装的 Chrome，没有下载 Chromium。首轮默认 30 秒导航期限耗尽，trace 显示登录 HTML 和已完成的静态资源均返回 200，页面仍在启动状态检查。将本轮具名 harness 总期限设为 180 秒、导航等待改为 DOM 就绪后，检查于 37.5 秒通过；未修改应用实现或数据库行为。该结果属于发布前的只读边界检查，发布后与数据库切换后分别复核。

## 切换执行与最终验收

首次停写后 PostgreSQL 记录正常关闭，最终 checksum 同步与无差异复查已完成；后续调用目标原生包未包含的 `pg_controldata` 返回 127，流程在启动目标或接入业务写入前停止，并自动恢复同一最新应用制品及原数据库。该失败属于维护工具前置条件，未执行 DDL、未切换数据源，恢复后本机登录 HTTP 为 200。

后续检查改为核对本次停止期间 PostgreSQL 自身的正常关闭 journal，完整文件 checksum 复查和目标 SQL cluster/database 身份核验仍保留。目标原生文件统一为 root 所有；修正可执行文件权限后，以 `ink-postgres` 实测 PostgreSQL 18.1、目标 data_directory 与 hba_file 配置均成功。第二次操作使用独立私有维护目录及 systemd unit，重新从当前源库采集并同步，不复用首次停止后已变旧的快照作为最终数据。

第二次unit`ink-admin-db-cutover-20261114-attempt2.service`退出码0、Result=success，2026-11-14 01:01:53（上海时间）完成。正常关闭源库后，最终`rsync --checksum --fsync`及完整checksum dry-run均成功，差异0；源与目标的角色、关系对象及ACL、schema、函数定义与权限、数据库属性、扩展和88条migration记录摘要完全一致。核对包含21个数据库角色、607个关系对象、5个schema、52个函数定义和1个扩展。

目标服务通过SQL核对同一cluster/database身份，五类DSN全部连接成功。只修改`INK_DATABASE_MODE`和五个数据库URL的主机，独立比对确认其余配置值保持；应用以原账户`ink-admin`执行`pnpm run start`，目标数据库以`ink-postgres`独立运行。源`postmaster.pid`不存在，旧源库没有自动重启。原订阅周期timer已恢复。

GitHub `admin-production`的`ADMIN_DATABASE_MODE`已设置并回读为`postgres`，`ADMIN_SSH_HOST`仍为应用服务器`39.97.252.88`。用原受限发布key实际执行`preflight postgres`，退出码0，返回`databaseMode=postgres`与`publicHttp=200`；已安装receiver对现用release的外部身份检查也通过。先前完整Actions发布使用切换前的内嵌模式；切换后的真实外部门禁与运行状态在此单独记录，没有将二者混写。

| 最终验证 | 结果 |
| --- | --- |
| 第二次cutover unit | `ExecMainStatus=0`，`Result=success`，正常停写已确认，文件checksum差异0。 |
| 五类真实角色连接 | 全部成功；原app/migration、auth、admin-control、Dream-data角色身份保持。 |
| `migrate.js --check` | 退出码0，88/88，pending为空；未执行DDL。 |
| `preflight postgres`（实际受限发布key） | 退出码0，模式为postgres，公网200。 |
| 现用receiver `database_state` | 退出码0，外部主机、端口、库名与cluster/database身份匹配。 |
| 同一Playwright命令（数据库切换后） | 退出码0，1项通过：登录页正常，匿名管理API为401，旧API为404。 |
| 应用与数据库托管 | 两者active/running；数据库enabled，源库已停止；两机MemorySwapMax=0、swap为空、zswap为N。 |

完整私密配置、首次恢复及第二次操作回执保留在应用主机`/root/ink-admin-db-move-20261114/`，最终成功回执为其`attempt2/cutover-receipt.json`。本机Actions回执为`/tmp/ink-admin-db-move-20261114.ANssB7/deployment-receipt/deployment-receipt.json`，三次浏览器运行的产物分别保留在同一具名临时目录。

上述准备和技术检查不代表真实用户或真实模型业务验收。

## SSH 登录提示

应用服务器 SSH 客户端为 OpenSSH 10.2，目标 sshd 当前有效的 KexAlgorithms 不包含后量子算法，因此会显示 post-quantum warning。根据 [OpenSSH 官方说明](https://www.openssh.org/pq.html)，该提示指向会话密钥交换，不是公钥认证失败；本轮没有屏蔽警告、重生成登录公钥或执行系统升级。目标系统的安全更新摘要属于登录维护提示，更新状态与数据库迁移结果分别核对。
