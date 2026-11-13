<!-- [Sync] 2026-11-08: 出口上游已核对为ECS现有Docker NAT代理，原Mac隧道记录保留为历史。 -->
<!--
[Input] The 2026-10-25 migration receipt and 2026-10-29 read-only ECS service/config inspection.
[Output] Temporary workstation dependencies, operational impact and the conditions for replacing them.
[Pos] Historical incident and remaining-work record; not production deployment instructions.
[Sync] 2026-10-29: remove workstation bridges from the production handbook without hiding live dependencies.
-->
# ECS Admin 临时桥接问题记录（2026-10-29）

## 2026-11-08出口复核

本次实际读取Tinyproxy配置，上游已为ECS回环`127.0.0.1:17892`，由已运行的Docker容器`ink-admin-egress-tun-proxy-1`提供。用户授权将`models.dev`加入同一出口后，应用相同Node配置完整下载目录成功，见[价格目录出口回执](ecs-pricing-catalog-egress-20261108.md)。以下Mac反向转发及17890配置属于2026-10-29的历史观察；本次未重新验收Artifact复制或其他历史任务。

## 问题与当前状态

迁移时为恢复部分外网访问及沿用已有文件路径，引入了个人 Mac 的代理转发和文件周期复制。此前又把这些操作写入生产部署步骤，这是部署处理和文档范围的错误。正式线上部署应使用服务器可独立访问的出口与持久存储。

2026-10-29 通过 SSH 只读核对：`ink-memory-admin.service` 与 `ink-admin-egress.service` 均为 `active (running)`；出口配置仍含 `127.0.0.1:17890` 上游。文档修正没有修改运行配置、重启服务或解除这些依赖，不能据此宣称线上已独立运行。

| 临时项 | 迁移时的实际设置 | 影响 |
| --- | --- | --- |
| Admin 访问转发 | `com.ink-memory.admin-ecs-relay` 将 Mac `127.0.0.1:3000` 转到 ECS `127.0.0.1:3000` | 保留外部 Dream 当时使用的入口；不是 ECS Admin 的启动方式 |
| 外网出口反向转发 | 同一 SSH 会话将 ECS `127.0.0.1:17890` 转到 Mac `127.0.0.1:7890`；ECS Tinyproxy 监听 `127.0.0.1:17891` | Google / Codex 指定域名依赖 Mac 在线；其他域名保持 ECS 直连 |
| Artifact 周期复制 | `com.ink-memory.admin-artifacts-sync` 每 15 秒复制 workspace 下的 `stories`、`.dream`、`memory` 到 `/var/lib/ink-memory-admin/artifacts` | 新产物有调度及传输延迟，Mac 离线后不再复制；不是 POSIX 共享存储 |
| 历史路径别名 | ECS 将 Artifact 目录只读 bind 到 `/Users/dmeck/project/ink-dream-memory/backend/data/agent-workspace` | 仅兼容数据库既有路径；Linux 上没有因此部署 Dream |

原始数据库、密钥和权限的迁移结果仍以[原发布回执](ecs-admin-native-20261025.md)为准；旧源 PostgreSQL 保留且停用，不得重新上线形成两个可写数据源。

## 临时出口配置留档

以下是此前部署的配置留档，用于识别现有依赖；不能作为新生产部署的配置模板。新的服务器出口模板见[线上服务手册](../deploy-services.md#4-创建指定域名的出口服务)。

```conf
# Admin native egress: Google and the two active Codex endpoints use the existing private Mac tunnel; other hosts connect directly.
Port 17891
Listen 127.0.0.1
Timeout 3600
MaxClients 100
Allow 127.0.0.1
LogFile "/var/log/tinyproxy/tinyproxy.log"
LogLevel Critical
PidFile "/run/tinyproxy/tinyproxy.pid"
DisableViaHeader Yes
Upstream http 127.0.0.1:17890 ".googleapis.com"
Upstream http 127.0.0.1:17890 ".google.com"

Upstream http 127.0.0.1:17890 "chatgpt.com"

Upstream http 127.0.0.1:17890 "auth.openai.com"
```

当时 ECS 直连 Google / Codex 相关端点超时；通用 Provider 与 Notion 的直连探测成功。经临时出口收到的 403 / 404 只证明 TCP/TLS 可达，不代表认证登录或模型调用成功。

## 替换完成条件

1. 准备并验证由线上运维管理、ECS 可独立访问的出口，替换 Tinyproxy 上游后检查指定域名连通及对应认证业务。
2. 为 Artifact 接通符合现有 Reader 目录、版本和 hash 合同的生产持久存储，验证已有内容与新增产物；未经验证的路径重写或一次复制不能替代该接入。
3. 将外部调用方改为其可访问的正式 Admin/Gateway 地址，保留既有 issuer、客户端注册、密钥和权限并验证调用。
4. 上述依赖逐项替换并核验后，再停用对应的临时任务，确认线上在个人电脑离线时仍可正常工作。

截至2026-10-29尚未记录可直接替换的已验证服务器出口和生产文件共享接入。出口的后续观察以上方2026-11-08回执为准，文件共享的完成状态仍须独立核对。本记录不提供重建个人电脑代理或同步任务的安装步骤。

## 既有临时任务定位

两个历史 plist 位于个人电脑的 `~/Library/LaunchAgents/`，标签为 `com.ink-memory.admin-ecs-relay` 与 `com.ink-memory.admin-artifacts-sync`，日志位于 `~/Library/Logs/InkMemoryAdminRelay/`。这里只保留排查位置；这些任务不属于 ECS 的正式部署步骤，替换前停用会影响上表对应能力。
