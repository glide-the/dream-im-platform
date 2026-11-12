<!-- [Input] 本次Admin分享源码、隔离验证回执和线上原实例。 -->
<!-- [Output] 发布目标、技术证据、迁移、制品采用与部署后检查状态。 -->
<!-- [Pos] 2026-11-12 Admin外部分享发布记录；真实账户验收单列。 -->
<!-- [Sync] 2026-11-12: 登记88条正常迁移、完整制品采用与部署后接口/权限回执。 -->
# Admin外部分享发布

用户要求部署Admin并验证。运维采用GitHub手动Actions完整制品流程，Dream服务保持原状态。luna-test-stage继续暂停，本轮由主Agent执行技术检查。

## 源码与CI

从远程main建立独立发布工作树，只提交统一AI/笔记分享、0087、相关文档及技术规格，原Admin与Dream工作区其他未提交改动保留。

| 交付 | 来源与结果 |
| --- | --- |
| 分享实现 | [PR50](https://github.com/glide-the/dream-im-platform/pull/50)已合并，main为`6f77f8ab5787766f9163af21175a3e2147d7a556`。 |
| 按次发布期限 | [PR51](https://github.com/glide-the/dream-im-platform/pull/51)增加20/40/60分钟选择；[PR52](https://github.com/glide-the/dream-im-platform/pull/52)增加90分钟。默认保持20分钟。 |
| 本轮制品来源 | `be88fc368e2e9c2db70422e645a415b64cf9d4f2`；应用、package与Drizzle源码相对PR50合并点无变化。 |
| 精确操作合同 | 原297项前缀保持，追加四个操作至301项；Dream生成摘要与Admin逐项匹配。 |
| CI | PR50最终run43167927987、PR51 run43171921898、PR52 run43174268946均通过完整检查、构建与隔离迁移job。 |

CI首轮发现生成目录和Schema清单仍为旧数量，已同步301项目录、新表清单及原297项摘要保护。历史迁移与原操作前缀保持。

## 技术验证

| 命令或入口 | 退出码 | 结果与范围 |
| --- | --- | --- |
| `pnpm --filter @ink-memory/db build` | 0 | 数据库package构建完成。 |
| `pnpm exec tsc --noEmit --pretty false`、`pnpm lint` | 0 | 完整类型与lint通过。 |
| `pnpm test:config`、`pnpm test:release-receiver` | 0 | 35项配置与15项接收器规格通过。 |
| Node20 `node node_modules/vitest/vitest.mjs run --exclude '**/*.integration.test.ts' --reporter=dot` | 0 | 2641 passed、37 skipped。 |
| `pnpm exec tsx scripts/validate-external-share-contract.mjs` | 0 | 具名隔离PG完整88条迁移、并发/重复/漂移/ACL、归属/回执/列表/快照/失效/能力失败关闭通过；原Next公开API的4项Playwright请求通过。 |
| Dream backend `.venv/bin/python -m pytest tests/test_note_shares.py tests/test_external_shares.py -q` | 0 | 16 passed，Provider-free技术验证。 |
| Dream frontend `pnpm exec playwright test --config /tmp/ink-external-share-unit-20261112.config.cjs` | 0 | 现有ExternalShareApi四项source/unit规格通过，无浏览器、模型或服务。临时配置与结果目录已清理。 |
| Markdown引用/索引脚本及本机Chrome内Mermaid parse | 0 | 收尾9份现行稿、29项相对引用、两节发布指南引用与目录索引通过；9幅Mermaid已在Chrome解析，收尾核对图示正文保持；属于文档结构与语法检查。 |

本机Node26完整单元首轮2640 passed、37 skipped，一项原有model-egress CONNECT因undici dispatcher协议差异失败；对应main生产代码保持。Node24定向检查、Node20完整单元及Actions Node22完整检查通过。

隔离分享harness首轮使用JSON属性顺序比较导致断言失败，改为结构比较后通过。隔离数据库、端口、Next进程与临时目录均已清理。正常库未写入合成分享fixture。

## 线上目标与原制品

主机`iZ2ze9gvp834u057cbobbqZ`，服务`ink-memory-admin.service`，运行用户ink-admin。原完整release为`/srv/ink-admin-releases/actions-42503997227-3e35e0ebf766/app`，BUILD_ID为`djDxAslGhYehozy9oY6Z3`，启动沿`pnpm run start:embedded`。公网为`https://ink-admin.suoxya.com`。

原数据库ink-memory、端口54329，目录`/var/lib/ink-memory-admin/postgres`，inode1056781、0700。私有配置0600，SHA-256为`a9cc810ed6d9b46babc1ca5572c3f81303e62b92aa3d76055ea26058d01d30df`。

物理内存1685958656字节，发布前可用约530MB，Admin有效MemoryMax1392508928、MemorySwapMax0，主机swap为空、zswap为N。构建沿GitHub Linux runner及原Node22.23.4、构建worker/堆预算，ECS消费完整制品并保留原完整版本。

## 正常Schema采用

原87条迁移及share表/能力缺失已核对。通过原编译`packages/db/dist/migrate.js`、显式迁移连接和核对后的Drizzle历史仅应用0087，完成88/88、pending为空。前缀记录保持，能力为`dream.external-share.v1`版本1，合同SHA-256：

`14414d3204886c46eb0f38b1afa49acc6870822dcb93a6f4924b910a7857f8ba`

有限DATA角色拥有external_shares的SELECT/INSERT/UPDATE，DELETE保持关闭。迁移前后users/threads/messages计数为37/1655/4363，新增分享0条，私有配置指纹与数据目录inode保持。

备份位于服务账户私有目录`/var/lib/ink-memory-admin/external-share-maintenance-20261112-6f77f8ab5787`，目录0700、文件0600，含before.json及migration-receipt.json。

| 备份 | 字节 | SHA-256 |
| --- | --- | --- |
| before-schema.dump | 596286 | e5eb0687b4758265e1c47f7a6eee6f53cd6c926e9788ee1262b8398046f369c0 |
| before-migration-metadata.dump | 10140 | 9077998a958daf96e0ec7a26559940f8c5076e0debd95fd348fd1e354d3ec447 |

两份归档均由已有PostgreSQL18客户端生成并验证目录。迁移前预检曾遇到原root私有目录的访问限制、历史迁移时间戳排序与客户端位置差异；采用新服务账户私有目录、原migrationStatus及已有系统PG18客户端后通过。这些预检尝试未执行DDL。

## Actions发布记录

| 运行 | 按次期限 | 结果 |
| --- | --- | --- |
| [43169612223](https://github.com/glide-the/dream-im-platform/actions/runs/43169612223) | 20分钟 | Node22完整检查与构建通过。312MB上传约180KB/s，切换前取消；本轮不完整上传已清理，原服务继续运行。 |
| [43172651863](https://github.com/glide-the/dream-im-platform/actions/runs/43172651863) | 40分钟 | 完整检查与构建通过。链路实测约90KB/s，切换前取消，发布锁已释放；不完整文件保留。 |
| [43175197174](https://github.com/glide-the/dream-im-platform/actions/runs/43175197174) | 90分钟 | 完整检查与构建通过，08:28:30 UTC完成部署；本机与ECS检查通过。 |

上传、摘要/清单/平台校验、check-only迁移、原systemd切换、健康检查和失败恢复继续沿原receiver。普通应用发布不执行DDL。

## 部署后检查与验收范围

Actions于2026-11-12 08:28:30 UTC完成，build与deploy均success。运行版本为`be88fc368e2e9c2db70422e645a415b64cf9d4f2`，BUILD_ID为`d2OpEL3UKUbpKAIoDrkCq`，Node为v22.23.4，当前目录为`/srv/ink-admin-releases/actions-43175197174-be88fc368e2e/app`。原完整release保留，服务active/running、Result=success、NRestarts=0。

`python3 /tmp/ink-admin-external-share-postcheck-run-20261112.py be88fc368e2e9c2db70422e645a415b64cf9d4f2`退出码0、status=passed。正常Schema为88/88、pending为空；四个操作逐项匹配生成合同；精确share能力版本/hash匹配，DATA权限为read/create/update=true、delete=false；分享记录0条。

| 线上检查 | 结果 |
| --- | --- |
| 真实服务OAuth与capabilities目录 | 200，301项operation及四个分享操作。 |
| 缺失与非法公开token | 均404，统一SHARE_UNAVAILABLE；no-store、noindex/nofollow、no-referrer。 |
| 匿名内部目录 | 401。 |
| 有服务身份、缺少用户身份的external-share.list | 403。 |
| ECS及本机公网登录 | 200。 |
| 本机公网非法分享 | curl退出码0，404。 |
| 原私有配置与持久化目录 | SHA-256保持原值、inode1056781、原owner/mode保持。 |
| swap与zswap | 继续禁用。 |

临时综合脚本首轮未收集结构化失败输出；补充阶段诊断与有界清单头部读取后，定位到user_scope请求连接的ETIMEDOUT。最终轮使用完整响应读取和每个连接至多一次传输重试，共2次连接重试后通过；HTTP状态与业务断言均保留。应用源码、权限及数据库保持本轮已发布版本。

Actions部署回执下载到`/tmp/ink-admin-release-receipt-43175197174/deployment-receipt.json`，综合检查回执为`/tmp/ink-admin-external-share-postcheck-proof-20261112.json`，服务器私有维护目录保留`postcheck-receipt.json`。回执仅含版本、合同、计数、权限、状态码和配置指纹。

真实用户的创建分享→外部阅读→主动失效、Dream制品采用、Web/Native完整交互与实体设备系统分享保持独立验收范围。上述隔离技术规格与线上只读检查分别记录。
