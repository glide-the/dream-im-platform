<!-- [Input] 0086不可变迁移、正常ECS数据库、Linux CI制品、现有Client回调及Simulator发布回执。 -->
<!-- [Output] 跨端续接的迁移、接口发布、数据保持与分层验收记录。 -->
<!-- [Pos] Admin正常发布证据；Dream端业务结果由关联执行记录所有。 -->
<!-- [Sync] 2026-11-08: 记录0086采用和精确loopback回调发布，手机到Web业务验收进行中。 -->

# 跨端续接发布与数据保持

## 发布范围

用户授权执行0086、发布Admin接口、更新本机Web和mobile，并在iOS Simulator验证手机创建的对话在Web继续。共享历史沿用正常Admin PostgreSQL；保留原Thread、Claude会话、用户、权限、历史和文件。Dream执行记录见[跨端续接](../../../ink-dream-memory/docs/exec/cross-platform-chat-continuation-20261104.md)。

## 迁移与原数据

目标主机为`iZ2ze9gvp834u057cbobbqZ`，服务`ink-memory-admin.service`，运行用户`ink-admin`。数据库`ink-memory`保留`/var/lib/ink-memory-admin/postgres`，inode1056781、0700、原owner保持。私有维护目录`/var/lib/ink-memory-admin/maintenance/chat-continuation-20261104/`保留迁移前备份与回执；`before-0086.dump`为2,829,297,048字节，pg_restore TOC校验通过，权限0600。

既有86条迁移按when/hash对应全部匹配。0086沿原`migrate-provider-managed-accounts.mjs`及已构建db CLI执行，退出0；`packages/db/dist/migrate.js --check`退出0，applied/target/available均87，pending为空。SQL、snapshot、journal历史登记后保持字节。

迁移前后立即核对：users37、chat_thread1647、chat_message4344、gateway_requests20344保持。历史队列两条state_unknown保留。物理capability `dream.chat-continuation.v1` v1、SHA `86bc59653c2f5d68a77cc4d922f1f4ebb670599411af6e4d3a64a93db814c3a8`存在；原DATA角色对来源列的读取／插入和队列phase读取／更新权限通过，未补授权限。

## 制品与采用

ECS约1607MiB物理内存、当前无swap、zswap关闭，service MemoryMax1392508928、MemorySwapMax0。构建使用Linux CI；ECS消费完整源码、Linux构建输出及原Linux依赖，沿`pnpm run start:embedded`与原PostgreSQL supervisor运行。

| 项目 | 首次接口采用 | 当前精确回调采用 |
| --- | --- | --- |
| 源码 | `86606fd4e98d9e9b8cb3a6a6152ad0159bcd43ff` | `a1c9b964fec75a87c86f0b1f5be1e6c8f35b6da8` |
| Linux CI | [41813656438](https://github.com/glide-the/dream-im-platform/actions/runs/41813656438)，通过 | [41832174613](https://github.com/glide-the/dream-im-platform/actions/runs/41832174613)，通过 |
| 制品SHA256 | `d0ee9bcf448b8803770e9b0b17708984d2914ebb3136e1e3b77a9f2b6489a77a` | `ce58c0bc6475fecabefbd9d473e69c624f0d3fd702e1980055f256bf3dd35eaa` |
| BUILD_ID | `lgQR0ME0zwC4PA8Xha4e3` | `4vObRuC3HdgSU0RUcOJ2q` |
| release目录 | `/srv/ink-admin-releases/20261104T-chat-continuation-079c899` | `/srv/ink-admin-releases/20261108T-chat-origin-a1c9b96` |

当前CI两项job：Drizzle migration journal、Deterministic checks均成功，包含单元、lint、完整TypeScript及Next构建。制品Linux x64、Node22.23.4、锁文件与现用依赖一致，922输入／981输出逐项SHA校验，归档路径无越界／链接，无跨机原生库输出。DB workspace依赖闭包显式保留，导入预检退出0。

首次切换缺DB package依赖链接，主执行者停止失败循环、恢复原制品，再补齐依赖后切换。失败日志与原drop-in均保留。当前systemd只修改本轮`zz-chat-continuation-20261104.conf`，WorkingDirectory指向上述当前目录，start:embedded运行；原20261102及20261104目录保留。当前激活active/running、NRestarts0、Result success；direct3000及公网/admin/login均200。

## 模拟器登录回调

App与Mac Web分别使用既有4173与5173监听。包内public origin绑定host-config的4173，原Web源配置保持。Admin配置复用原`ink-dream-local`与`ink-dream-browser-local`，仅在原redirectUris增加`http://127.0.0.1:4173/auth/callback`，trusted origins增加其精确origin。原回调、Client、secret、scope、PKCE、资源及actor归属保持。

配置parser要求额外HTTP回调与原回调均为loopback，pathname精确匹配；requireDreamService仍验证原service token、唯一配置匹配及原Browser Client已发布精确callback。定向34项测试、lint、tsc的会话回执通过，当前完整CI重新覆盖发布源。回调由`provision-dream-oauth-catalog.ts --browser-redirects` dry-run核对单行单callback后，以`--apply`提交；verified=true，其他catalog字段由原planner逐项核对。迁移检查仍87/87。未创建Client或凭证。

## 业务验收状态

Simulator build37启动成功，登录表单恢复可用；Google正常认证流程进行中。Google账户选择后返回App，在原诊断页出现callback阶段错误；主执行者增加无凭据的参数／HTTP失败分类并构建Simulator38定位。真实模型完成数暂为0。手机创建→Web原Thread与原Claude会话续接的最终结论待后续可见操作及持久化证据。

本次发布覆盖Admin与本机Web／Simulator；物理iPhone、App Store、远程Dream部署单列验收。原数据及本轮产生的正常业务记录保持。


## 当前本机正常服务采用

2026-11-08现场重新核对：本机Admin自11-07正常启动于3000，原PostgreSQL54329的数据目录为仓库`.ink-memory/postgres`，当前Web及Simulator38配置均使用localhost issuer。该库与ECS分别保存，业务验收沿用户当前本机正常库执行，退出替换数据源的路径。

本机87条迁移与原continuation capability SHA已存在；只读check退出0、87/87、pending为空，未重复迁移。原DATA库保留users37、Thread1615、消息4294、Gateway20239的初始只读计数，后续业务增量单列。窄callback发布同样仅增加4173，verified=true，原loginntn／mobile／Web回调保留。私有env备份位于`.ink-memory/maintenance/chat-continuation-20261108/`，0600；其他值及原Client字段逐项保持。

原Node24.13.0 supervisor正常退出后，以同一start:embedded入口启动当前已构建制品；原DB目录inode133609098、0700保持，Admin登录200、手机/auth/options200，正常服务读取297操作、continuation_ready=True。首次直接check遇到embedded目录已占用后停止；改为原显式DSN只读check，无DDL执行。当前手机Google认证继续，真实消息验收保持待完成。
