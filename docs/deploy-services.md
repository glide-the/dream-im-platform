<!--
[Input] Read-only inspection of the ECS systemd fragments, drop-ins and server-owned data paths.
[Output] Reproducible service creation, operation, update, recovery, logging and dated usage records.
[Pos] Service-management companion to deploy.md; commands do not initialize or migrate a database.
[Sync] 2026-10-29: retain ECS service creation and operations; remove workstation provisioning from production instructions.
[Sync] 2026-10-31: reflect disabled swap/zswap and uncapped OOM restart policy.
[Sync] 2026-11-02: mark historical heap values and require verified-artifact recovery before repeating a failed build.
-->
# Admin 线上服务创建、维护与使用记录

发布与故障恢复先读[构建内存与发布失败恢复](release-build-memory-and-recovery.md)。下文 2048 MiB 堆与服务创建模板保留为既有配置记录；其有效覆盖项和实际入口须实时核对，禁止直接复制到容量不足的主机。`local:stable` 重启会再次构建；已有完整制品恢复沿现有 `start:embedded`，具体入口调整按授权维护流程执行。本次文档修订未修改服务器配置。

本手册与[部署指南](deploy.md)配套。2026-10-28～29 已通过 SSH 核对实际 unit、覆盖项和状态；2026-10-31 按用户要求关闭交换并更新 OOM 重启策略，下面的 Admin unit 和内存配置已同步为当前值。出口上游改为必须填入的线上配置占位符，当前临时配置另存问题记录。日常操作从“日常使用”开始，创建部分用于首次部署或有备份的配置重建，不要在现有服务器上直接整段覆盖执行。

- [ECS 首次创建与配置记录](#ecs-首次创建与配置记录)
- [ECS 日常使用与维护](#ecs-日常使用与维护)
- [创建与使用记录](#创建与使用记录)

## 服务清单与职责

| 所在位置 | 服务 / 标签 | 配置位置 | 职责及正常状态 |
| --- | --- | --- | --- |
| ECS | `ink-memory-admin.service` | `/etc/systemd/system/ink-memory-admin.service` | 运行 `pnpm local:stable`；构建后由 supervisor 启动 Next.js / Gateway / PostgreSQL；就绪后为 `active (running)` |
| ECS | `ink-admin-egress.service` | `/etc/systemd/system/ink-admin-egress.service` | 回环地址上的 Tinyproxy；转发指定域名请求，当前上游见临时问题记录；`active (running)` |
| ECS | `ink-admin-local-ports.service` | `/etc/systemd/system/ink-admin-local-ports.service` | 加载本服务自己的 nftables 表；一次性任务完成后为 `active (exited)` |

本手册的创建与维护命令全部在 ECS 上执行。个人电脑的代理、SSH 隧道和 LaunchAgent 不属于生产部署前提。当前尚存的临时依赖及替换条件见[问题记录](verification/ecs-admin-temporary-bridges-20261029.md)；更新本文不代表运行配置已经切换。

没有单独创建 `postgresql.service`。内嵌 PostgreSQL 属于 Admin supervisor 的生命周期，停止 Admin 会同时关闭它拥有的应用进程组与数据库。

Admin **Requires** 防火墙服务，并要求 Artifact bind mount 可用；对出口服务使用 **Wants**。出口服务故障不触发 Admin 重新构建，外部请求仍按各自边界报错。`Type=simple` 在构建时也会显示 running，必须结合 `Ready` 日志及 HTTP / 鉴权检查判断就绪。

## ECS 首次创建与配置记录

以下命令在 `ssh root@39.97.252.88` 登录后的服务器执行。涉及服务启停的步骤属于维护窗口操作；2026-10-31 的交换策略更新使用 daemon-reload 与在线属性设置，未重启当前服务。

### 1. 服务账户、源码、配置和目录

本次服务账户为 `ink-admin`，home 为 `/var/lib/ink-memory-admin`，shell 为 `/usr/sbin/nologin`。它是 Unix 运行账户，与数据库内的角色不同。

```bash
# 仅当账户不存在时创建；不要修改已有账户的 UID/GID。
getent passwd ink-admin >/dev/null || useradd \
  --system --user-group --create-home \
  --home-dir /var/lib/ink-memory-admin \
  --shell /usr/sbin/nologin ink-admin

# 核对工具链及现有目录的访问权限。
/opt/ink-admin-node/bin/node --version
/opt/ink-admin-node/bin/pnpm --version
runuser -u ink-admin -- test -x /opt/ink-admin-node/bin/pnpm
stat -c '%U:%G %a %n' \
  /srv/ink-admin-releases/20261024T164343Z-ee0497b43115 \
  /var/lib/ink-memory-admin/postgres
```

已部署工具链为 Node `22.23.4`、pnpm `9.15.0`。`/opt/ink-admin-node/bin` 同时提供 node 和 pnpm，unit 的 PATH 使用该目录；服务账户不依赖 root 的 nvm 或交互 shell。

完整源码、开发依赖和私有 `.env.local` 必须先准备好。实际 WorkingDirectory 是 `/srv/ink-admin-releases/20261024T164343Z-ee0497b43115`；`.env.local` 为 `ink-admin` 所有、权限 `0600`，数据库目录为 `0700`。数据必须已完成授权恢复或发布所需的显式迁移。下面创建的是托管配置，不会初始化或迁移数据库，也不能用空目录替换现用 PostgreSQL。

`.env.local` 由项目既有 dotenv 路径加载，包含 JSON；不要 `source` 它，也不要直接写成 systemd `EnvironmentFile=`。普通服务维护不重新运行 `env:setup`，沿用与现用数据匹配的密钥和 DSN。

### 2. 持久 Artifact 挂载与内存配置

`RequiresMountsFor` 使用的 Linux 目录只是 Admin 数据别名，不是 Dream 项目。持久文件记录如下：

| 文件 | 本次内容 / 用途 |
| --- | --- |
| `/etc/fstab` | 仅保留原 Artifact 只读 bind；移除 `/swapfile` 条目 |
| `/etc/sysctl.d/99-zz-ink-admin-memory.conf` | `vm.swappiness = 0`，实际关闭还依靠 swapoff 和 unit 屏蔽 |
| `/etc/tmpfiles.d/ink-admin-zswap.conf` | 开机将 zswap enabled 设为 `N` |

`/etc/fstab` 的相关条目：

```fstab
/var/lib/ink-memory-admin/artifacts /Users/dmeck/project/ink-dream-memory/backend/data/agent-workspace none bind,ro 0 0
```

内存配置文件：

```conf
# /etc/sysctl.d/99-zz-ink-admin-memory.conf
vm.swappiness = 0
```

```conf
# /etc/tmpfiles.d/ink-admin-zswap.conf
w /sys/module/zswap/parameters/enabled - - - - N
```

首次准备挂载前确认源目录、目标目录与其中数据的所有权，再写入不重复的 fstab 条目。维护时检查指定挂载与交换禁用状态：

```bash
findmnt -T /Users/dmeck/project/ink-dream-memory/backend/data/agent-workspace
swapon --show
sysctl vm.swappiness
cat /sys/module/zswap/parameters/enabled
```

Artifact 挂载应包含 `ro`；`swapon --show` 应为空，zswap 应为 `N`。`/swapfile` 文件保留但不启用，`swapfile.swap` 已 masked。创建或恢复配置时保持该 unit 被屏蔽：

```bash
systemctl mask swapfile.swap
systemctl show ink-memory-admin.service -p MemorySwapMax -p MemorySwapCurrent
free -m
```

交换关闭后应显示 `MemorySwapMax=0`、`MemorySwapCurrent=0` 和 Swap 总量 `0`。不要为了启动服务恢复 swap，或执行全局挂载 / 防火墙清理。

### 3. 创建回环端口防火墙服务

先用 `install -d -m 0755 /etc/nftables.d` 准备目录，创建规则文件 `/etc/nftables.d/ink-admin-local.nft`：

```nft
table inet ink_admin_local {
  chain input {
    type filter hook input priority -10; policy accept;
    iifname != "lo" tcp dport { 3000, 54329 } drop
  }
}
```

再以 root 创建 unit：

```bash
cat > /etc/systemd/system/ink-admin-local-ports.service <<'EOF'
[Unit]
Description=Restrict native Admin and PostgreSQL ports to loopback
Before=ink-memory-admin.service
[Service]
Type=oneshot
ExecStart=/usr/sbin/nft -f /etc/nftables.d/ink-admin-local.nft
RemainAfterExit=yes
[Install]
WantedBy=multi-user.target
EOF
chmod 0644 /etc/systemd/system/ink-admin-local-ports.service
```

这个 unit 以 root 加载 nftables，不设置 `User=ink-admin`。它只管理 `inet ink_admin_local` 表，拒绝非回环接口访问 `3000` 和 `54329`；不会把 SSH 或 nginx 端口改成内网专用。

### 4. 创建指定域名的出口服务

先准备 ECS 可独立访问、由线上运维管理的 HTTP 出口，并验证需要访问的域名。以下是新建配置模板，`__ADMIN_EGRESS_HOST__` 和 `__ADMIN_EGRESS_PORT__` 必须替换为实际线上出口后再保存；它们不是已经部署的地址。尚未取得有效出口时不要覆盖现用配置或启动这份模板。当前线上临时配置仅保留在[问题记录](verification/ecs-admin-temporary-bridges-20261029.md)。

本次安装的是 `tinyproxy-bin`，由自己的 unit 托管，不启用另一套默认 tinyproxy 服务。准备专用配置和日志目录：

```bash
apt-get install --no-install-recommends tinyproxy-bin
install -d -o root -g ink-admin -m 0750 /etc/tinyproxy
install -d -o ink-admin -g ink-admin -m 0700 /var/log/tinyproxy
```

将替换占位符后的内容保存为 `/etc/tinyproxy/tinyproxy.conf`：

```conf
# Production egress template: replace the upstream placeholders before installation.
Port 17891
Listen 127.0.0.1
Timeout 3600
MaxClients 100
Allow 127.0.0.1
LogFile "/var/log/tinyproxy/tinyproxy.log"
LogLevel Critical
PidFile "/run/tinyproxy/tinyproxy.pid"
DisableViaHeader Yes
Upstream http __ADMIN_EGRESS_HOST__:__ADMIN_EGRESS_PORT__ ".googleapis.com"
Upstream http __ADMIN_EGRESS_HOST__:__ADMIN_EGRESS_PORT__ ".google.com"

Upstream http __ADMIN_EGRESS_HOST__:__ADMIN_EGRESS_PORT__ "chatgpt.com"

Upstream http __ADMIN_EGRESS_HOST__:__ADMIN_EGRESS_PORT__ "auth.openai.com"
```

文件保存后设置权限；新建日志时由服务账户创建，已有日志不截断：

```bash
chown root:ink-admin /etc/tinyproxy/tinyproxy.conf
chmod 0640 /etc/tinyproxy/tinyproxy.conf
runuser -u ink-admin -- sh -c 'umask 077; touch /var/log/tinyproxy/tinyproxy.log'
cat > /etc/systemd/system/ink-admin-egress.service <<'EOF'
[Unit]
Description=Ink Admin private egress proxy
StartLimitIntervalSec=300
StartLimitBurst=3
After=network-online.target
Wants=network-online.target
[Service]
Type=simple
User=ink-admin
Group=ink-admin
ExecStart=/usr/bin/tinyproxy -d -c /etc/tinyproxy/tinyproxy.conf
ExecReload=/bin/kill -HUP $MAINPID
Restart=always
RestartSec=3
RuntimeDirectory=tinyproxy
RuntimeDirectoryMode=0700
UMask=0077
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=strict
ProtectHome=true
ReadWritePaths=/var/log/tinyproxy/tinyproxy.log
MemoryMax=64M
[Install]
WantedBy=multi-user.target
EOF
chmod 0644 /etc/systemd/system/ink-admin-egress.service
```

配置、日志和 PID 使用 AppArmor 已允许的标准位置。不要把配置改到任意路径后关闭 AppArmor 解决拒绝访问。Google 子域名与两个精确 Codex 域名使用已配置的线上上游，其他域名由 ECS 直连。配置规则见 [Tinyproxy 官方说明](https://github.com/tinyproxy/tinyproxy/blob/master/docs/man5/tinyproxy.conf.txt.in)。

### 5. 创建 Admin 主服务与出口覆盖项

基础 unit 的完整记录（其中 `/Users/...` 是 ECS 上兼容数据库历史路径的挂载别名，不是本机启动步骤）：

```bash
cat > /etc/systemd/system/ink-memory-admin.service <<'EOF'
[Unit]
Description=Ink Memory Admin native pnpm service
StartLimitIntervalSec=0
StartLimitBurst=2
After=network-online.target ink-admin-local-ports.service
Wants=network-online.target
Requires=ink-admin-local-ports.service
RequiresMountsFor=/Users/dmeck/project/ink-dream-memory/backend/data/agent-workspace
[Service]
Type=simple
User=ink-admin
Group=ink-admin
WorkingDirectory=/srv/ink-admin-releases/20261024T164343Z-ee0497b43115
Environment=HOME=/var/lib/ink-memory-admin
Environment=PATH=/opt/ink-admin-node/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin
Environment=PORT=3000
Environment=NODE_ENV=production
Environment=NEXT_TELEMETRY_DISABLED=1
Environment=NEXT_BUILD_CPUS=1
Environment=NEXT_WEBPACK_MEMORY_OPTIMIZATIONS=true
Environment=NODE_OPTIONS=--max-old-space-size=2048
ExecStart=/opt/ink-admin-node/bin/pnpm local:stable
KillMode=control-group
TimeoutStopSec=90
Restart=on-failure
OOMPolicy=stop
RestartSec=10
UMask=0077
MemoryHigh=infinity
MemoryMax=1200M
MemorySwapMax=0
CPUQuota=150%
[Install]
WantedBy=multi-user.target
EOF
chmod 0644 /etc/systemd/system/ink-memory-admin.service
install -d -m 0755 /etc/systemd/system/ink-memory-admin.service.d
cat > /etc/systemd/system/ink-memory-admin.service.d/egress.conf <<'EOF'
[Unit]
Wants=ink-admin-egress.service
After=ink-admin-egress.service
[Service]
Environment="HTTP_PROXY=http://127.0.0.1:17891"
Environment="HTTPS_PROXY=http://127.0.0.1:17891"
Environment="NO_PROXY=localhost,127.0.0.1,::1"
Environment="NODE_OPTIONS=--max-old-space-size=2048 --use-env-proxy"
EOF
chmod 0644 /etc/systemd/system/ink-memory-admin.service.d/egress.conf
```

`KillMode=control-group` 管理本次服务的整个进程组，停止超时为 90 秒。源码目录、服务账户、node/pnpm 路径变更时，先按实际配置调整对应字段，不将本例路径直接套用到其他主机。

基础 unit 的物理内存上限为 `1200M`，当前有效值由持久覆盖项设为 `1328M`。2026-10-31 将 swap 上限改为 `0`：

```bash
systemctl daemon-reload
systemctl set-property ink-memory-admin.service MemoryMax=1328M MemorySwapMax=0
```

这会生成两个由 systemd 管理的覆盖文件：

- `/etc/systemd/system.control/ink-memory-admin.service.d/50-MemoryMax.conf`，有效字节数 `1392508928`。
- `/etc/systemd/system.control/ink-memory-admin.service.d/50-MemorySwapMax.conf`，有效字节数 `0`。

这些覆盖项优先于基础 unit。只改基础文件中的资源值不会覆盖它们；后续使用 `systemctl set-property` 调整，不直接编辑标注 “Do not edit” 的自动生成文件。出口覆盖项同时将 NODE_OPTIONS 扩展为 `--max-old-space-size=2048 --use-env-proxy`。

### 6. 加载、启用、启动与就绪确认

先验证 unit 和防火墙文件语法，再启用服务。已有规则表的主机按下面的防火墙维护章节更新，避免反复追加同一条规则。

```bash
systemd-analyze verify --man=no \
  /etc/systemd/system/ink-memory-admin.service \
  /etc/systemd/system/ink-admin-egress.service \
  /etc/systemd/system/ink-admin-local-ports.service
nft -c -f /etc/nftables.d/ink-admin-local.nft
systemctl daemon-reload
systemctl enable ink-admin-local-ports.service ink-admin-egress.service ink-memory-admin.service
systemctl start ink-admin-local-ports.service
systemctl start ink-admin-egress.service
systemctl start ink-memory-admin.service
```

`enable` 只设置开机启动，`start` 启动当前实例，`enable --now` 才同时做两件事。`daemon-reload` 只让 systemd 重读 unit 定义，不能代替应用重启。应用启动会执行完整构建，active 状态不代表构建已结束：

```bash
systemctl status ink-memory-admin.service --no-pager -l
journalctl -u ink-memory-admin.service -n 100 -f
curl -fsS --max-time 15 http://127.0.0.1:3000/admin/login >/dev/null
```

看到 Next.js `Ready` 且登录页可达后，再按[部署指南](deploy.md#nginx-与验证)核对受限角色、既有凭证及受保护能力，然后验证 nginx 和公网。登录页 `200` 不是完整业务验收。

## ECS 日常使用与维护

### 状态、日志与启停

```bash
# 状态与是否开机启用。
systemctl status ink-memory-admin.service ink-admin-egress.service ink-admin-local-ports.service --no-pager -l
systemctl is-enabled ink-memory-admin.service ink-admin-egress.service ink-admin-local-ports.service

# Admin：构建、Next.js、Gateway 及 supervisor 转发的运行日志。
journalctl -u ink-memory-admin.service -n 100 -f
journalctl -u ink-memory-admin.service --since '1 hour ago' --no-pager
journalctl -u ink-memory-admin.service -b --no-pager

# 出口：托管事件与 Tinyproxy 自身日志。
journalctl -u ink-admin-egress.service -n 100 -f
tail -n 100 -F /var/log/tinyproxy/tinyproxy.log

# 防火墙的一次性加载记录与实际规则。
journalctl -u ink-admin-local-ports.service -b --no-pager
nft list table inet ink_admin_local

# nginx 的错误和访问日志。
tail -n 100 -F /var/log/nginx/ink-memory-admin-error.log
tail -n 100 -F /var/log/nginx/ink-memory-admin-access.log
```

`journalctl -b` 查看本次开机，`--since` 限定时间，`-n` 限定条数，`-f` 持续跟踪。按 Ctrl+C 退出查看，不会停止 unit。Google callback 专用 access log 已关闭，错误文件为 `/var/log/nginx/ink-memory-admin-callback-error.log`，级别为 crit。日志只在私有终端或权限为 `0600` 的文件中查看、导出，分享前去除凭据和正文。

计划维护 Admin 时：

```bash
systemctl stop ink-memory-admin.service
# 确认服务停止、其 PostgreSQL 正常关闭后再处理该服务的数据或配置。
systemctl status ink-memory-admin.service --no-pager -l
systemctl start ink-memory-admin.service
# restart 相当于停止后重新启动，会再次构建并产生中断。
# systemctl restart ink-memory-admin.service
```

普通停服不删除数据；不要用 `killall node`、`pkill postgres` 清理其他服务，也不要同时手动执行第二份 `pnpm local:stable`。只取消开机启动用 `systemctl disable ink-memory-admin.service`；立即停服并取消开机启动用 `systemctl disable --now ink-memory-admin.service`，两者含义不同。

### 修改 unit、资源或发布目录

修改前把具体文件复制到权限为 `0700` 的维护备份目录，包括基础 unit、`.service.d`、`.system.control` 覆盖项及私有运行配置。`systemctl cat` 适合查看合并来源，不应把它的拼接输出当作单个原始 unit 覆盖回去。

```bash
systemctl cat ink-memory-admin.service
systemctl show ink-memory-admin.service \
  -p FragmentPath -p DropInPaths -p WorkingDirectory -p ExecStart \
  -p User -p Group -p MemoryMax -p MemorySwapMax -p Restart
```

修改流程是：备份 → 修改指定文件 → `systemd-analyze verify` → `systemctl daemon-reload` → 计划重启 → 日志与就绪验证。资源变更优先使用 `systemctl set-property`；它会应用到当前 cgroup，不必为了修改资源值重启应用，值必须来自实际容量评估。

发布新源码时，先准备完整新 release、依赖和沿用密钥的私有配置，再通过 `/etc/systemd/system/ink-memory-admin.service.d/release.conf` 指定新的绝对 WorkingDirectory：

```ini
[Service]
WorkingDirectory=/srv/ink-admin-releases/REPLACE_WITH_VERIFIED_RELEASE
```

上面的名称是待替换示例。若还要更换 pnpm 可执行文件，需要先用空的 `ExecStart=` 清除旧命令，再设置完整的新 ExecStart 和一致的 PATH。更新后的 `local:stable` 仍执行完整类型检查与构建。源码回滚可恢复旧 release 指针和其配置，但不自动回滚 schema、覆盖新数据库或把旧源库重新上线；已有 schema 兼容性按正式发布协议判断。

### 出口变更与限速恢复

更改 `/etc/tinyproxy/tinyproxy.conf` 后，只维护出口 unit。该版本在重载后曾正常退出，`Restart=always` 会尝试拉起；重载成功消息不代表端口已恢复。

```bash
systemctl reload ink-admin-egress.service
systemctl status ink-admin-egress.service --no-pager -l
ss -lntp
journalctl -u ink-admin-egress.service --since '10 minutes ago' --no-pager
```

检查 `127.0.0.1:17891` 监听，再用不携带账户凭据的连通探测确认出口。无认证的 HEAD 返回 403/404 可以证明网络连通，不能作为真实模型或 Google 登录验收。只需要重新拉起时可 `systemctl restart ink-admin-egress.service`，不为此重启 Admin。

Admin 当前为 `StartLimitIntervalSec=0`、`OOMPolicy=stop`、`Restart=on-failure`、`RestartSec=10`。OOM 后 systemd 停止服务进程组，再自动启动同一入口；30 分钟两次的旧限制已取消。`StartLimitBurst=2` 在限流区间为 `0` 时不生效。`local:stable` 的恢复仍包括完整构建，禁止通过重新启用交换来绕过内存失败。

出口服务仍保留 5 分钟最多 3 次的限制。若出口出现 `start-limit-hit`，修正失败原因后恢复该服务：

```bash
# 仅在修正对应失败原因后执行。
systemctl reset-failed ink-admin-egress.service
systemctl start ink-admin-egress.service
```

Admin 的 OOM 恢复不需要手动 reset-failed。其他故障仍应通过日志定位原因。

### 防火墙规则更新

现存 unit 只有 ExecStart，没有 ExecStop。停止 unit 不会删除内核中的规则，但由于 Admin Requires 它，停用或重启该 unit 可能影响 Admin。不要用重启它来日常刷新规则；重复执行原始规则文件也可能累积规则。

只替换本项目的表，先对整个 batch 做语法检查，再原子提交，保留其他项目的规则：

```bash
umask 077
if nft list table inet ink_admin_local >/dev/null 2>&1; then
  { printf '%s\n' 'delete table inet ink_admin_local'; cat /etc/nftables.d/ink-admin-local.nft; } > /run/ink-admin-local-update.nft
else
  cp /etc/nftables.d/ink-admin-local.nft /run/ink-admin-local-update.nft
fi
nft -c -f /run/ink-admin-local-update.nft
nft -f /run/ink-admin-local-update.nft
nft list table inet ink_admin_local
rm /run/ink-admin-local-update.nft
```

不要执行全局 `nft flush ruleset`。配置文件仍保留在 `/etc/nftables.d/ink-admin-local.nft`，由该 unit 在下次开机加载。

## 创建与使用记录

| 日期 | 已执行操作 / 核对 | 记录位置与结果 |
| --- | --- | --- |
| 2026-10-25 | 创建专用账户、三个 ECS unit、出口 drop-in、nft 表及只读 bind；配置持久 swap / zswap | `/etc/systemd/system/`、`/etc/nftables.d/`、fstab 和本文完整配置 |
| 2026-10-25 | 为完整构建启用 Webpack worker，并通过 set-property 将内存 / swap 有效上限调整到 1328M / 1800M | 两个 `.system.control` 覆盖文件；保留完整 TypeScript 检查 |
| 2026-10-25 | 恢复最终现用数据、启用 ECS unit、启动 `pnpm local:stable`、验证并重载 nginx | [发布回执](verification/ecs-admin-native-20261025.md)，138 表 / 6,180,336 行；鉴权及公网检查通过 |
| 2026-10-25 | 发现出口重载后退出，设置有界 Restart=always，Admin 对它使用 Wants | 出口与 Admin 独立维护，相关配置见上文 |
| 2026-10-28～29 | 通过 SSH 只读读取三个 unit、覆盖文件及有效属性，补全创建和维护手册 | 三个 unit 都是 enabled；Admin / 出口为 running，防火墙为 active (exited)；Admin 有效内存 1392508928 字节、swap 1887436800 字节 |
| 2026-10-29 | 按线上范围修正文档，移出个人电脑操作，将出口上游改为明确占位的生产模板 | 临时桥接事实另存问题记录；未修改线上服务配置或重启服务 |
| 2026-10-29 | 发布 `deck.catalog` 的四个源码文件与完整 operation JSON，沿既有 `pnpm local:stable` 重建并启动 Admin | [发布回执与只读检查](verification/admin-deck-catalog-ecs-20261029.md)；293 项广告与精确 hash 通过，数据库与运行配置未改 |
| 2026-10-31 | 关闭 swap / zswap，移除 fstab 的 swap 条目并 mask `swapfile.swap`；Admin swap 上限设为 0，取消旧启动限流 | `swapon --show` 为空、SwapTotal=0、zswap=N；Admin 原 PID 1070 保持，未重启；`systemd-analyze verify` 退出 0，登录页 200 |

本次文档补全不代表重新部署或真实模型验收。以后每次维护应追加日期、操作对象、修改文件、执行命令、退出码 / 关键结果、就绪验证和回退情况；不把 DSN、密钥、token、用户正文写进记录。

### 文档校验记录

2026-10-28～29 补全文档时，ECS 三个实际 unit 的 `systemd-analyze verify --man=no` 退出码为 `0`。这属于配置静态校验，不代表重新发布或业务验收。

本次范围修正的静态校验覆盖：7 个文档、104 个本地链接、8 个章节锚点、20 段 bash 示例语法及 5 个 unit / 配置正文核对通过，退出码 `0`；`git diff --check` 退出码 `0`。脚本只做静态检查，不执行示例中的部署命令。出口上游模板和运行中的临时配置分别记录，个人电脑配置的创建和维护已从本手册移除。
