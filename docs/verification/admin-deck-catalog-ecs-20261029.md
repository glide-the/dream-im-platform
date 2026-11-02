<!--
[Input] Frozen deck.catalog source overlay and authenticated ECS deployment checks.
[Output] Bounded release identity, changed files, production capability hash and repeatable read-only checks.
[Pos] Admin-only release evidence; PR, merge and workstation branch changes belong to the originating task.
[Sync] 2026-10-29: publish deck.catalog through the existing native pnpm/systemd service without migration.
-->
# Admin deck.catalog ECS 发布回执（2026-10-29）

Admin 已更新并恢复就绪，核验时间为 2026-10-29 04:29:22（Asia/Shanghai）。本次只发布目录读取能力，未执行 Git PR、合并或分支切换。

## 发布身份与文件

| 项目 | 实际值 |
| --- | --- |
| 服务器 | `root@39.97.252.88` |
| 发布标识 | `20261029-deck-catalog-9c1f93a22825` |
| 源码基线 | `ee0497b43115cac760abb02e11bf53ec4c6a222b` |
| 文件覆盖清单 SHA-256 | `9c1f93a228258efccc4a1db36e135744b3a04432884b43ad7868ac7affdd84a6` |
| 实际源码目录 | `/srv/ink-admin-releases/20261024T164343Z-ee0497b43115` |
| 服务 / 运行账户 | `ink-memory-admin.service` / `ink-admin` |
| 启动命令 | `/opt/ink-admin-node/bin/pnpm local:stable` |

功能发布载荷为以下五个文件；文件摘要在服务器 `/var/lib/ink-memory-admin/release-history/20261029-deck-catalog-9c1f93a22825/manifest.json` 中记录。工作区其余未提交改动没有随本次发布同步。

- [`app/lib/dream/deckVoiceDto.ts`](../../app/lib/dream/deckVoiceDto.ts)
- [`app/lib/dream/deckVoiceRepository.ts`](../../app/lib/dream/deckVoiceRepository.ts)
- [`app/lib/dream/deckVoiceService.ts`](../../app/lib/dream/deckVoiceService.ts)
- [`app/lib/dream/operationRegistry.ts`](../../app/lib/dream/operationRegistry.ts)
- [`docs/architecture/admin-dream-operation-contracts.json`](../../docs/architecture/admin-dream-operation-contracts.json)

本页与[服务使用记录](../deploy-services.md)、[文档总索引](../README.md)、[验证索引](.folder.md)另行同步。

四个源码文件只增加空输入、现有 OAuth + `dream:read` 约束的 `deck.catalog` 聚合读取与分发；完整 JSON 清单仅在原 292 项后追加新描述，原描述保持。

## 验证结果

| 检查 | 实际结果 |
| --- | --- |
| 服务器构建 / 类型检查 | 现有 `pnpm local:stable` 完成完整构建后进入 Next.js Ready；构建 ID `RM2AZBEZB_OYHGL5eTYCa` |
| 运行服务 | `active (running)`，账户 `ink-admin`，`NRestarts=0` |
| 新增 capability | `deck.catalog`，`kind=read`，`user_scope=dream:read`，输入/输出版本均为 `1` |
| 精确 contract SHA-256 | `0c53861e1a635742e37f7b26ab954a57af1f550261d3ddc1ea5dbfb17f574a5e` |
| API operation 广告 | `293` 项；前 `292` 项与发布前逐项相同 |
| 物理数据库 | `ink-memory` / `54329`，集群 ID `7700293320822264408`；目录 inode 未变 |
| migration / schema ledger | `86` 条 migration、`38` 项 capability，前后内容摘要均相同 |
| 公网与回环登录页 | 均为 `200` |
| 认证边界 | 未认证 capabilities 为 `401`；既有服务 OAuth 为 `200`；受保护 capabilities 为 `200` |
| 保留范围 | `11` 份运行配置摘要未变；出口与 nginx 服务的主进程及启动时间未变 |
| 定向单元测试 | 4 个文件、29 项测试通过，退出码 `0` |
| 定向 ESLint | 四个源码文件检查通过，退出码 `0` |
| 发布后只读探针 | 精确 capability、数据库身份、原描述、ledger 与配置比对通过，退出码 `0` |


公开入口为 `https://ink-admin.suoxya.com`。本次检查通过现有服务凭据取得短期 OAuth token，再读取受保护的 capability 广告；不输出 token、密钥、DSN、用户或 Deck 正文。检查没有调用模型，也没有代替当前用户执行完整目录业务链路，因此不作为 Dream 前后端或真实模型验收。

## 可重复的只读验证

以下命令在 ECS shell 执行，使用当前服务自己的私有配置。脚本只读业务数据和接口广告，并正常签发短期服务 token；不执行 migration、业务写操作或服务启停。输出为状态码、数量、数据库身份与 capability hash；本次执行退出码 `0`。

```bash
cd /srv/ink-admin-releases/20261024T164343Z-ee0497b43115
runuser -u ink-admin -- /opt/ink-admin-node/bin/node \
  --env-file=.env.local \
  /var/lib/ink-memory-admin/release-history/20261029-deck-catalog-9c1f93a22825/verify-release.mjs \
  operations=293 \
  baseline=/var/lib/ink-memory-admin/release-history/20261029-deck-catalog-9c1f93a22825/before.json \
  receipt=/var/lib/ink-memory-admin/release-history/20261029-deck-catalog-9c1f93a22825/recheck.json
```

服务状态与日志：

```bash
systemctl status ink-memory-admin.service --no-pager -l
journalctl -u ink-memory-admin.service -n 100 -f
```

完整服务创建、维护与回滚原则仍见[线上服务手册](../deploy-services.md)。

## 保留与范围

- 私有发布回执：`/var/lib/ink-memory-admin/release-history/20261029-deck-catalog-9c1f93a22825/completion.json`；前后检查为 `before.json`、`after.json`，均保留在该目录。
- 旧源码为 `/var/lib/ink-memory-admin/release-history/20261029-deck-catalog-9c1f93a22825/previous-source`，旧构建为 `/var/lib/ink-memory-admin/release-history/20261029-deck-catalog-9c1f93a22825/previous-next`。源码回退不恢复或替换数据库；服务仍沿用 `pnpm local:stable`。
- 保留现用数据库、配置、密钥、角色与权限；不执行 migration，不部署或重启 Dream，不修改代理、同步、nginx 或防火墙配置。
