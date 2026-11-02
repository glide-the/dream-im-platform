<!--
[Input] Authorized Admin-only migration from the current Mac database to ECS 39.97.252.88.
[Output] Native service, final data snapshot, ingress activation and bounded readiness evidence.
[Pos] Historical native cutover receipt; independent production egress/storage remain incomplete.
[Sync] 2026-10-25: publish through pnpm local:stable and replace the former Admin relay with loopback nginx.
[Sync] 2026-10-29: qualify remaining temporary bridges; do not treat cutover as independent production topology.
-->
# ECS Admin 原生部署回执（2026-10-25）

Admin 已迁到 ECS，公网入口为 `https://ink-admin.suoxya.com`。服务器通过专用用户 `ink-admin` 运行 `pnpm local:stable`；nginx 已重载并代理 `http://127.0.0.1:3000`。

## 发布与数据

| 项目 | 回执 |
| --- | --- |
| 源码基线 | `ee0497b43115cac760abb02e11bf53ec4c6a222b`，加本轮 Webpack worker 配置与部署文档修订 |
| 源码目录 | `/srv/ink-admin-releases/20261024T164343Z-ee0497b43115`，完整依赖，不使用 standalone 启动器 |
| 启动入口 | `ink-memory-admin.service` → `/opt/ink-admin-node/bin/pnpm local:stable` |
| 工具链 | Node.js `22.23.4`、pnpm `9.15.0`、内嵌 PostgreSQL `18.1` |
| 数据目录 | `/var/lib/ink-memory-admin/postgres`，由现有 supervisor 管理 |
| 最终一致快照 | `2026-10-24T19:17:51.460Z`，源服务停写后导出，导出进程正常关闭数据库 |
| 恢复结果 | **138 张表、6,180,336 行**；结构、索引、约束、所有者、角色、权限与迁移记录无差异 |
| 迁移检查 | 86 条已应用，未执行额外 migration；启动不执行 DDL |
| 最终备份 | `/var/lib/ink-memory-admin/migration-final2`，含完整数据库、角色、授权、私有运行配置与校验回执 |

完整备份为 2,492,194,779 字节，分片及整体 SHA、所有清单文件均核对通过。恢复使用完整对象所有权；ACL 依照 `acldefault` 展开后比较实际权限。恢复成功回执为最终备份目录中的 `restore-native-success.json`。

原始 Mac PostgreSQL 已停止并保留，旧 ECS Admin 数据卷保留。旧中间快照已在 Mac 私有的 `~/Library/Application Support/InkMemoryAdminMigration/` 中完整归档并核验摘要，再移除 ECS 上的重复数据库 gzip 和未完成传输文件，释放 2,878,039,681 字节。ECS 保留最终完整备份；被退役的中间目录有 `baseline-retired.json` 标记。

## 启动与入口

最终发布再次执行了完整 `pnpm local:stable` 构建，包含 TypeScript 检查、静态页面生成和文件追踪，随后 Next.js 正常启动。应用与出口服务已启用开机启动，应用发布期间无自动重启。

`/etc/nginx/sites-available/ink-memory-admin` 已改为本机 `3000`，保留 HTTPS 转发、SSE、WebSocket 和 Google callback 的私有日志策略。公网探测返回 `200`，同一探测标记记录在 ECS 的专属 nginx access log 中，确认请求到达该虚拟主机。

旧 ECS Dream 项目、其三个容器、相关服务镜像、代理缓存卷和旧镜像备份已删除。Docker、Docker socket 和 containerd 已停止且禁用；现有外部 Dream 的 nginx 转发不等于在 ECS 运行 Dream。

## 验证结果

| 验证命令或入口 | 退出码 / 关键结果 |
| --- | --- |
| 最终源导出、`gzip -t` 与传输摘要核对 | `0`，完整一致快照 |
| Production `database-io.js restore-sql-gzip`、数据库授权恢复 | `0` |
| `verify-target.mjs`、production `migrate.js --check` | `0`，`mismatches=[]` |
| `pnpm local:stable` 的构建链 | 构建成功后进入正常 Next.js 服务，完整类型检查通过 |
| ECS 原生就绪探针 | `0`，3 个受限角色均非 superuser / createdb / createrole；38 项 capability |
| Mac `127.0.0.1:3000` 转发就绪探针 | `0`，既有服务 OAuth 与受保护能力成功 |
| 公网 HTTPS 就绪探针 | `0`，登录页 `200`、未授权 API `401`、既有服务 OAuth `200`、292 项操作可用 |
| `nginx -t`、`systemctl reload nginx` | `0` |
| `pnpm test:config` | `0`，32 项 Node 测试及 AutoDL 配置合同通过 |

就绪探针只输出状态、数量和角色权限，不输出 token、正文、凭据或连接串。上述结果属于数据恢复、配置、鉴权与连通性验证，不替代真实账户的付费模型验收或浏览器 Google 登录验收。

## 尚未解除的临时依赖

Mac 上的 `com.ink-memory.admin-ecs-relay` 保留原有 `127.0.0.1:3000` 入口并转发至 ECS，因此没有重启或重新部署 Dream。原有 issuer、客户端注册与加密密钥保持一致。

ECS 直连 Codex 资源域名与认证域名超时，已与 Google 一并使用现有 Mac 出口；两个实际通用 Provider 和 Notion 均可直连。专用出口探测收到 Codex 的 `403`、Google token 端点的 `404`，证明 TCP/TLS 连通；探测没有携带上游账户凭据或发起模型调用。出口服务重载退出的问题已通过独立托管与有界自动拉起修正，Admin 不依赖出口进程的退出状态重建自身。

Artifact 两端 **3,118 个文件、175,333,494 字节的完整文件摘要一致**。Mac 的 `com.ink-memory.admin-artifacts-sync` 每 15 秒复制指定三类目录，Admin 通过只读 bind 读取。复制存在一个调度周期加传输时间的延迟；严格版本校验仍生效。

Google / Codex 出口及新增 Artifact 同步依赖现有 Mac 在线；ECS 已有数据和其他域名的直连独立保留。这些是迁移时的临时方案，不属于正式部署前提，也不能据此宣称生产拓扑已独立完成。2026-10-29 的修正及替换条件见[临时桥接问题记录](ecs-admin-temporary-bridges-20261029.md)；服务器维护见[部署指南](../deploy.md)。
