<!-- [Input] 原ECS实例、正常Admin数据库、精确capability及本轮Actions回执。 -->
<!-- [Output] 0086、接口／制品采用、数据保持与分层验收状态。 -->
<!-- [Pos] Admin跨端续接发布验证记录；现行操作归deploy.md。 -->
<!-- [Sync] 2026-11-08: 手动Actions、公网检查及原数据保持分别记录，真实模型验收待完成。 -->
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


## 2026-11-08 后续采用与恢复检查

本机原start:embedded采用合并源 `825b9422fc14636ba6c3152662b6876c335e00d5` 的Mac制品，BUILD_ID `-ziAoTgO_iMMgzuEq0Rds`。922项运行输入匹配，完整类型检查／Next构建退出0，前一完整`.next`在原维护目录保留；原PostgreSQL目录inode133609098和0700保持。Gateway下游取消映射CLIENT_CANCELLED／499，已知／未知用量定向13项、eslint、tsc退出0；历史502与结算记录保留。

Linux CI [42452463519](https://github.com/glide-the/dream-im-platform/actions/runs/42452463519)成功；对应制品SHA `91c919bde507be715c8b6a4da6fc0bef1b2bb97a6f228b9862aaeb934c6e6583`、BUILD_ID `0trGoNTZ0eoEEnSMDXOP2`。ECS候选`/srv/ink-admin-releases/20261108T-chat-cancel-825b942`已上传，目录准备完成与依赖预检未取得回执，服务切换未执行。最后成功检查的服务仍为前表a1c9b96，active、NRestarts0、内存约482MB、无swap。

准备新备份期间SSH banner exchange和公网检查超时；已终止本轮三条自有SSH连接，远端备份／准备进程状态待控制台核对。0086旧备份路径本次未读到文件，上文为迁移当时回执，当前可恢复性待核对。当前无内核／cgroup OOM证据，无主机重启、数据恢复或重复迁移。阿里云备用入口需要本人登录，恢复时先检查原实例并停止本轮具名备份，再核对原服务和数据库。

Simulator39覆盖安装及原产品Session通过；手机Google主体与Web原主体不同，当前模型发送0，等待原账户登录后完成同Thread／Claude会话验收。原数据和未知队列状态保留。


### 手动Actions采用准备与ECS恢复补充（2026-11-08）

用户指定参考`-Ink-Memory/.github/workflows`，要求后续发布在GitHub主动点击触发，并授权自动设置专用SSH key。当前workflow仅`workflow_dispatch`及main分支，独立build/deploy job；push／PR继续原CI检查。原test.yml的临时制品打包已移入手动workflow，原自动检查合同保留。当前代码与[发布指南](../../../ink-admin-memory/docs/deploy.md)对应，首次完整手动发布回执后续追加。

阿里云本人登录后，云助手`t-bj072guiil578xs`安全检查退出0、14秒：原service active/running、NRestarts0，本机HTTP200，数据库目录inode1056781、0700、ink-admin保持；无swap。停止本轮具名备份后SSH恢复，进程核对pg_dump为0，公网再次200。内核OOM检索无匹配回执，故障归因保留待核实；无主机重启或数据恢复。当前新dump为2,535,784,448字节，完整性未确认，保留私有文件并退出恢复依据。

专用Actions key以`restrict`和固定receiver command附加到原authorized_keys，原公钥字节前缀保持。GitHub admin-production环境仅允许main，原个人私钥未上传。受限key preflight退出0（原实例、Node22.23.4、x86_64、service active），普通uname命令退出1、固定白名单反馈。root所有的接收脚本SHA `b0cf45d73401a646ae9fc1b350f8b7c9ed4933b7329fb13889546c6080b52d10`。代码打包3项、接收器9项、eslint、Python compile和YAML解析退出0；9项覆盖实际合成激活／回滚及原env/data inode保持。actionlint未安装，未声明通过。

Simulator40 Next来源579项、完整Next与Xcode构建退出0；覆盖安装退出0，前后偏好摘要一致，原Bundle ID保持。可见Chat页配置错误消失，原Session保持；空／部分可选配置沿用既有workspace开启和手动确认默认，已保存错误类型保持拒绝。native setup技术fixture10项、生产源lint及完整tsc退出0；spec合并lint保留27项any检查失败回执。正常Web5173曾无监听，已沿原任务参数重新启动，Web200、backend8765 health200、Admin3000保持。

手机产品主体与Web原主体仍不同，原账户本人登录待完成；本轮真实模型发送0，退出跨端业务通过声明。指定历史回归对话的state_unknown保留，退出自动消息重放范围。


### 首次GitHub手动发布回执与公网探测修订

PR [44](https://github.com/glide-the/dream-im-platform/pull/44)通过最终CI [42455551924](https://github.com/glide-the/dream-im-platform/actions/runs/42455551924)后合并，main `998f76c7780506883b716753f75f5d103c92b868`。主执行者在GitHub页面实际选择main并点击Run workflow，运行[42456107493](https://github.com/glide-the/dream-im-platform/actions/runs/42456107493)。build job通过；完整Linux artifact为311,940,781字节，artifact digest `dbf1834b91b840e5df242c2f8668834ac7b35a819574c45abf3a6946cfde4270`。

deploy的受限SSH preflight和Publish步骤通过。服务启用`/srv/ink-admin-releases/actions-42456107493-998f76c77805/app`、BUILD_ID `BGzVS0iFjKkdHsitL-Mr7`，原release仍保留，原data inode1056781，active/running、NRestarts0。workflow最终状态failure来自GitHub runner的末尾公网curl403；制品激活步骤为success，未回滚正常服务。

同URL从Mac取得Cloudflare200；ECS curl取得Cloudflare200，完整body读取10s超时；ECS Python urllib取得200。runner的具体403策略项待核对。当前修订把固定公网URL门禁放入ECS receiver preflight／激活后，失败复用原回滚；runner状态写入独立网络诊断，403原值保持。WAF、认证、IP策略与所有secrets保持。接收器12项技术合同、Python compile及YAML手动触发合同退出0；root receiver SHA `7444c14e7675fc9175ee74aea0d0ddd283dfdc843ae8299d213416614c70a825`，原配置备份0600，待下一次修订后的完整手动运行回执。

Safari使用手机已登录的现有Google账户尝试正常登录，在Google出现本人验证／reCAPTCHA，停止在该验证页。原Chrome账户与历史保留，模型发送0；同一账户的真实跨端续接仍依赖本人完成Web验证。


### 公网门禁第二次回执与失败分类（2026-11-08）

PR [45](https://github.com/glide-the/dream-im-platform/pull/45)合并至 `01139a32191b7e445df6fbab7a8f899dbacfa6e0` 后，显式workflow_dispatch运行 [42476219452](https://github.com/glide-the/dream-im-platform/actions/runs/42476219452)。build通过，Linux artifact为311,921,771字节、ZIP digest `06ad12be7e240ab6bed6cc05de34dae8fc995b111c8236980dd278ca0302141a`。deploy在受限preflight的公网检查处失败，Publish未运行，候选目录未创建；现用首次Actions制品保持，原库inode1056781、active、NRestarts0。

后续只读检查：受限key preflight取得publicHttp200；ECS公网urllib样本约3秒、origin约0.03秒，个人SSH配置无转发。旧失败仅返回固定Published route分类，具体HTTP状态／超时类型未保存，原因保持待核实。PR [46](https://github.com/glide-the/dream-im-platform/pull/46)为固定公网探测增加服务器显式20秒预算，以及仅含异常类型／HTTP状态的失败记录；HTTP200门禁、入口策略、回滚和本机健康期限保持。receiver unittest 15项、Python compile、两仓库diff check均退出0；18文档／211本地链接检查通过。该修订的合并、root receiver采用和部署重跑回执后续追加。

本机正常服务在无代理loopback检查中Web localhost5173 HTTP200、backend8765 HTTP200、Admin3000 HTTP200。原Google验证页和手机／Web不同主体保持，真实模型发送0。


### 手动Actions最终采用与数据读回（2026-11-08 20:02后）

PR [46](https://github.com/glide-the/dream-im-platform/pull/46)的CI [42477563762](https://github.com/glide-the/dream-im-platform/actions/runs/42477563762)两项job全部成功，包含provider-free tests、eslint、完整TypeScript、Next构建和不可变迁移检查；合并main为 `46309115767fc50cce2b1e165ede0af6264ba984`。服务器root receiver采用SHA `e27d5b5f10cc14e4a7a178c7501f3e2d00a99cb8295204515139b91689b0f5cf`，公网期限20秒；原配置字段逐项保持，旧receiver／配置私有备份保留。受限专用key preflight退出0、publicHttp200。

确认旧失败尚未创建候选后，仅重跑 [42476219452](https://github.com/glide-the/dream-im-platform/actions/runs/42476219452/attempts/2) 的失败deploy，复用同次已验证build／artifact；整体 `completed/success`。preflight、Publish、本机和ECS公网HTTP200门禁通过。应用source为 `01139a32191b7e445df6fbab7a8f899dbacfa6e0`，BUILD_ID `8j55EPjZRN3tSoqU4Ydtl`，当前目录 `/srv/ink-admin-releases/actions-42476219452-01139a32191b/app`；main4630911的后续差异为发布receiver／测试／文档，应用制品仍准确登记01139a3。

部署回执artifact `13616158390`（372字节，30天），ZIP digest `938d23539d521e32f28a8011b8ea6c8663731ac48e967fcdbb40a51b2880f411`。正常服务active/running、NRestarts0、内存约437MB；旧完整Actions制品保留。前后只读数据：users37、Thread1647、消息4344、Gateway20344、迁移87均相同；原数据库54329及inode1056781、私有env字节、精确capability与摘要均保持。前后读回存于原私有维护目录的 `actions-before-rerun-42476219452.json`／`actions-after-rerun-42476219452.json`，无重复迁移或数据恢复。

发布门禁成功后，一次独立公网复查发生TimeoutError，本机HTTP保持200。后续分阶段诊断：DNS约0.07秒、TLS连接累计2.03秒、HTTP200累计5.5秒，未使用HTTP代理；公网访问存在间歇波动，具体网络原因待核实。入口策略、HTTP200门禁及回滚规则保持。首次runner403与这次TimeoutError分别记录；workflow成功归发布采用证据，真实账户和模型验收单列。

本机正常Web localhost5173、backend8765、Admin3000最终直连均200。Simulator40、原偏好和登录保持；正常同账户的跨端模型验收受Google本人验证阻挡，本轮真实模型发送0。指定旧Thread的state_unknown保留，历史队列回执核实未完成。

后续发布入口为 [Build and deploy Admin (manual)](https://github.com/glide-the/dream-im-platform/actions/workflows/deploy-admin.yml)，在GitHub点击Run workflow并选择main。push／PR仅执行原CI，不自动发布；专用受限SSH key与GitHub环境已设置。技术验证命令 `python3 -m unittest discover -s scripts -p test_admin_action_deploy.py -v` 退出0、15项通过；源码／发布完成与真实业务完成分别判定。


### 发布合同与项目文档同步（2026-11-08，本地验证完成）

新增根命令`pnpm test:release-receiver`复用现有Python unittest。Admin普通`test.yml`准备Python3.12并执行该命令，手动`deploy-admin.yml`调用同一入口；Node packer合同继续归`test:config`。手动workflow保留唯一workflow_dispatch／main守卫、原环境、专用ECS key及原发布／回滚协议。应用、receiver和packer的生产逻辑保持本轮已验证版本。

Admin同步package、两workflow、GitHub／scripts／根目录合同、AGENTS、README、发布指南、服务手册、内存恢复手册和本回执。服务手册以当前start:embedded／zzzz-github-actions.conf为日常入口，旧基础unit和源码目录维护原文保留为历史；失败重试按preflight未创建候选与Publish已开始分别定义。Dream同步阿里云分流、部署索引及内存恢复说明，原Compose正文8544字节完整保留，SHA256 `d894b00c2c2ed3fc7e5adedaa081b19016e1c71f47ef769249649585063b0f54`。旧Admin容器bootstrap、PG alias及swap步骤退出当前发布流程，Dream现有配置和数据源保持。

验证：`corepack pnpm test:release-receiver`退出0、15项通过；`node --test scripts/package-admin-release.test.mjs`退出0、3项通过。两workflow YAML结构检查退出0；20文档／231本地链接／25锚点、50段仅bash -n检查、569行新增用语检查及两仓库diff check均通过。技术证据位于Dream `frontend/output/chat-continuation-20261104/sync-release-contract-20261108/validation.log`。

Admin发布合同实现提交为`2873473dd7f6fc4cc3717a2745b201d4409b11e4`，包含14个明确文件；后续校验回执作为追加文档保存，原两仓库工作树与其他Agent改动保留。GitHub main在本次同步开始时为4630911；连接器写权限拒绝，当前gh OAuth授权缺少workflow scope。按用户已有SSH自动设置授权尝试单仓库临时deploy key推送后，GitHub仍拒绝workflow写入；临时key169173183已撤销、本机临时私钥已删除。已登录页面提交受到当前浏览器控制中断，本轮workflow同步尚未推送／合并，完整本地提交作为待提交交付物保留。

现用已成功发布的运行42476219452 attempt2及应用01139a3保持；本轮同步无新生产发布、服务重启、数据库或模型操作。普通CI接入新增receiver测试的GitHub采用状态保持待提交；本地YAML与合同验证单列，当前GitHub主分支未取得本次同步的新CI回执。
