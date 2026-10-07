<!-- [Input] Independent design/source reviews, Luna raw receipts and primary-owned isolated PostgreSQL lifecycle. -->
<!-- [Output] Exact Admin contract, technical validation evidence and remaining Dream/release gates. -->
<!-- [Pos] Admin dependency receipt; technical validation does not establish normal business recovery or deployment. -->
<!-- [Sync] 2026-10-07: close owned technical evidence and audit three consecutive unresolved normal-release turns; do not infer publication from isolated receipts. -->
# Notion 同步归属验证回执

以下初始回执保留当时源码提交与正常发布状态；本次Git交付验证见文末。初始所列 Admin 与 Dream 隔离技术 lane 通过，整体目标因正常发布门禁未闭合而未完成。实际 consumer 首次失败的凭证 ctime 缺口已由 Dream 作者修复；复测 6 个 consumer 场景和 2 个公开路由/后台 worker 场景通过。来源后端 83 项及取消边界 3 项回归、前端完整 71 项和后续受影响 11 项均有实际 exit 0；当前已记录文件和保存 trace 的源字节已核对，来源正在完成设计稿同步。新的正常 Admin catalog 只读请求成功，但四项 operation 和 schema capability 都未发布，也未交付旧 writer 排空、claims 启用和新机制发布后的正常业务恢复回执，不能宣称永久自动恢复完成。来源聊天未收到本任务发送的消息。

## 交付与所有权

实施聊天：`01a11331-2830-7220-bf91-4a144acfd62f`；来源聊天：`01a10c7f-51ad-7183-8260-00ba2d51c94c`。Git 基线为 `main` / `77935d5`。本轮未提交、未创建 PR。起始已有 Provider/routing 等改动，58 个已修改 tracked 文件的基线 hash 校验没有发现任何无关字节变化；共享 folder contracts 与 journal 只有本轮明确增量。[保护回执](../../output/notion-sync-ownership-20261007/workspace-preservation.json)。

复用原五张 Notion 表、connector config_json、行锁、ReceiptRepository 与同一 UOW。新增四个 operation 共用执行内核，保留旧 221 个完整 descriptor；旧 21 个 Notion wire shape/hash 不改。新 strict light snapshot 接受当前 Dream builder 的实际 metadata，不接受正文、config、额外字段、错身份、不完整数据库索引。当前执行字段不投影到公开 connector config。

代码入口：`notionSyncRunDto.ts`、`notionSyncRunState.ts`、`notionSyncRunRepository.ts`、`notionSyncRunSchema.ts`、`notionLightSnapshotDto.ts`；原 connector Repository/Service/Handler、operation Registry 与 receipt GET 复用。详细边界见 [设计](../design/notion-sync-ownership.md)、[PRD](../prd/notion/sync-ownership.md) 和 [实施所有权](../exec/notion-sync-ownership-20261007.md)。

## 精确发布合同

数据库 capability 为 `dream.notion-sync-ownership.v1`，version `1`，contract SHA-256：

```text
a54b947c69ea0f129d22fd440c3a9f5694026ac0977adef2d5b09a97d7a9e993
```

0074 仅增加 identity actor SHARE-lock 的 SECURITY DEFINER 函数及 capability，不新增业务表/字段，不迁移 legacy 业务数据。函数固定静态查询和 search_path，PUBLIC 撤权，只给唯一 DATA role EXECUTE；DATA 没有身份 UPDATE 权限。owner 必须保持为 identity schema owner。旧历史不可修改；本轮已应用到隔离库的 SQL/snapshot/contract hash 已冻结。[合同及历史校验](../../output/notion-sync-ownership-20261007/contract-preservation.json)。

| Operation | 输入/输出版本 | Wire contract SHA-256 |
| --- | --- | --- |
| `notion.sync-run.request` | 1 / 1 | `d020bdae89d51eef867e1337d6006081f6ba6b7a7560c4a4442b5e1461398fa3` |
| `notion.sync-run.claim` | 1 / 1 | `a2e95601c0dcb2c0c010931bbe7ab2afb4e4f6000847fe0fb92ddb819ce432cc` |
| `notion.sync-run.renew` | 1 / 1 | `f15c16e243d7640fb02401cf21d1fc8584628ef307da3f8814c9a6d445bb1719` |
| `notion.sync-run.finish` | 1 / 1 | `885e17ff0feeb4372e735d988608e9380dd72249892f69753b00165045742877` |

Registry225 紧凑 JSON（保留字段插入顺序）SHA-256：`c588f78a76877f6ad0ab819c35b65e35b806b4d56c0e8cc4dcb034039cadfaf5`；按 canonicalContractJson 排序 keys 的 SHA-256 为 `152c48717171aed517a0f48c299e82dc66946798c5350d84bd346b580856ce8e`。调用走现有 `POST /api/internal/dream/v1/operations/{operation}`，未知结果走原 request ID 的 receipt GET。request 要求 user `dream:write` 与 verified confidential service `connectors:sync`；其余三项为 background `connectors:sync`。scope 在 receipt 恢复前重新验证。

租约/heartbeat/续租预算来自严格 `NOTION_SYNC_EXECUTION_POLICY_JSON`；本轮技术 fixture 使用 3/1/1 秒。`NOTION_SYNC_OWNERSHIP_CLAIMS_ENABLED` 默认关闭。关闭时新 request/claim 拒绝，已有 renew/finish 及原 receipt 恢复仍可工作。配置与 capability 不是旧 writer 排空证明。

## 隔离 PostgreSQL 与迁移证据

首批唯一技术目标：`ink_notion_sync_ownership_test_7692ac78e1`，127.0.0.1，主代理创建并验证 current_database/current_user/host。后续 consumer 新阶段使用另一具名隔离库，下文单列。迁移与故障准备只使用本轮私密凭证，没有写正常账户。

主代理执行 `node scripts/prepare-notion-sync-validation.mjs`：真实 migration runner 完整 replay 至 0073，安装旧角色 ACL，再并发两个 production migrator 应用 0074，之后重复 production migration orchestrator。实际 75/75 migration receipts、精确 capability、旧/fresh DATA ACL、身份 SHARE-lock 阻挡停用直到 commit、停用后拒绝和 DATA identity UPDATE 拒绝均通过。[原始迁移/角色日志](../../output/notion-sync-ownership-20261007/prepare-rerun.log)。准备脚本为持有隔离 cluster 的进程，结束时的退出码及清理证据另列，不将启动输出冒称最终 exit 0。

Luna 不执行迁移、catalog 故障设置、凭证签发或服务清理。API lane 的 Node HTTP transport 直接调用生产 POST/receipt GET/capabilities GET Route Handlers，使用真实 DTO、认证、权限、SQL、状态机与 receipt/audit UOW；无测试专用业务 API。只读 observer 检查持久化结果，不扩大 DATA 的 audit INSERT-only 权限。此 lane 不启动 Next 或浏览器；不涉及 Chromium revision。

## 实际命令与结果

| 命令 | Exit | 关键输出 |
| --- | --- | --- |
| `NOTION_SYNC_VALIDATION_FIXTURE=<primary private fixture> pnpm exec playwright test --config tests/e2e/notion-sync-ownership.config.ts` | 0 | 9/9，11.3 秒 |
| `NOTION_SYNC_BOUNDARY_CHANNEL=<primary private channel> node --import tsx tests/integration/notionSyncReleaseProbe.ts` | 0 | 13/13；故障恢复后 readiness 通过 |
| `pnpm exec tsc --noEmit --incremental false` | 0 | 无诊断 |
| `pnpm lint` | 0 | 无 warning/error |
| `pnpm test:run` | 0 | 300 文件、2238 测试通过；18 文件、37 测试跳过 |
| `NOTION_DREAM_SOURCE_ROOT=/Users/dmeck/project/ink-dream-memory NOTION_DREAM_PYTHON=/Users/dmeck/project/ink-dream-memory/backend/.venv/bin/python pnpm exec vitest run app/lib/dream/notionLightSnapshotDto.test.ts app/lib/dream/chatScheduledTaskRegistration.test.ts` | 0 | 2 文件、3/3；实际 Dream builder oracle 无 skip |
| `INK_ADMIN_E2E_DIST_DIR=.next-e2e-notion-ownership-build-20261007 pnpm build` | 0 | Next 编译、typecheck、静态页面、路由收集通过；构建前自有 dist 不存在 |
| `pnpm exec eslint scripts/prepare-notion-sync-boundaries.mjs scripts/prepare-notion-sync-validation.mjs tests/integration/notionSyncReleaseProbe.ts` | 0 | 无诊断 |

原始日志：[Playwright](../../output/notion-sync-ownership-20261007/final-playwright.log)、[发布边界](../../output/notion-sync-ownership-20261007/boundary-verifier-complete.log)、[主代理恢复证明](../../output/notion-sync-ownership-20261007/boundary-prepare-complete.log)、[typecheck](../../output/notion-sync-ownership-20261007/final-tsc-rerun.log)、[lint](../../output/notion-sync-ownership-20261007/final-lint-rerun.log)、[全量 unit](../../output/notion-sync-ownership-20261007/final-test-run-rerun.log)、[builder oracle](../../output/notion-sync-ownership-20261007/final-focused.log)、[build](../../output/notion-sync-ownership-20261007/final-build.log)。跳过的是已有可选源/集成门禁及默认无跨项目 env 的 oracle；显式 oracle 另行通过。不据跳过结果主张全项目集成完成。

## 公开入口旅程

| 旅程 | 结果 |
| --- | --- |
| 两个 worker 并发 claim、manual busy、service/worker/scope/actor 拒绝 | 通过 |
| DB lease 过期接管，fence 前进；旧 renew/成功/失败/取消全部拒绝 | 通过 |
| 来源与授权 A→B→A；最后来源删除清 current identity | 通过 |
| 最新 disabled policy 不被 finish 覆盖；自动跳过，manual 可用 | 通过 |
| 失败/取消保留 LKG；version 不可变；metadata-only 与 strict shape 负向 | 通过 |
| snapshot/receipt/audit 故障全事务回滚；audit 后跨 lease 回滚 | 通过 |
| HTTP 成功响应丢失；原 receipt/replay 恢复且只有一次效果 | 通过 |
| 旧 snapshot/后台 patch/identity 写与 reserved 注入拒绝；legacy marker 不被普通保存清除 | 通过 |
| 实际 capabilities Route 发布精确 capability 与新四项 wire hashes | 通过 |

发布边界独立验证：claims gate 关闭后的新 claim 拒绝、原 claim receipt、renew、finish 和原 finish receipt；actor 锁等待跨 DB lease 后拒绝续租；capability 缺失/错 hash、函数缺失/正文/owner/PUBLIC/其他角色 EXECUTE/DATA EXECUTE 缺失/grant option 漂移均使 operation、receipt GET、只读 readiness fail closed；每项由主代理恢复，最后 readiness 与原已提交 receipt 重新成功。[13 项完整日志](../../output/notion-sync-ownership-20261007/boundary-verifier-complete.log)。

## 失败记录与修复

首次 source typecheck 的 Drizzle clock 查询返回形状错误已改为 tx.execute；旧 Repository source assertions 改为验证复用锁内核。隔离 harness 的地址 `/32` 表示及 observer audit SELECT 权限问题分别修正为 host() 与独立只读 observer。测试 UUID 默认参数推断错误改为显式 string。独立评审指出并修复 ownerless legacy 被普通保存清除、身份锁等待后复活过期租约、宽松 snapshot/索引缺口、函数 owner/ACL 漂移。

全量 unit 首次 exit 1，仅历史注册测试固定总数 221；改为冻结原 scheduled 205–221 区段，完整重跑 exit 0。初次显式 env 未应用的 oracle skipped 不作为兼容证据；随后实际 builder oracle 3/3 通过。

发布 boundary controller 两次 fixture 故障退出：capability 恢复漏 adopted_from、函数故障未保持参数名。对应 verifier 分别通过 4/6 项后 timeout exit 1；产品没有因此改动。主代理恢复本轮隔离 catalog，修复完整行保存和参数名，第三轮 13/13、controller/verifier exit 0。首次失败日志保留：[第一次](../../output/notion-sync-ownership-20261007/boundary-verifier.log)、[第二次](../../output/notion-sync-ownership-20261007/boundary-verifier-final.log)。此前无重定向的 reviewed 9/9 输出没有伪造为存在的日志文件，最终完整 9/9 原始日志已保存。

## 独立评审与剩余门禁

独立 agent `design_review` 先评审设计，再进行 Admin 源码复核，Admin 最终结论为“未发现剩余必需修复”。此结论不等于运行测试；运行证据由 `luna_test_runner` 的 `validation` / `release_validation` 与主代理迁移/故障/清理记录提供。后续 Dream consumer 复核发现下列 P1/P2，均由 Dream 作者修复后经过独立复核与实际限定测试，不将 Admin 源码结论扩大为 Dream 运行证据。

剩余必需门禁：

1. 精确四项 wire 合同、heartbeat、原 receipt 恢复、busy/失效停止已取得源码与 provider-free 技术回执；正常已部署 consumer 和真实 provider 行为尚未验收。browser 不提供执行归属键。
2. 实际 factory、Calendar、Thread 及 cache recovery/旧版本晚写已取得隔离技术回执；版本均绑定完整接受身份。正常运行的消费者/缓存迁移仍需实际发布证据，builder oracle 不代替这些回执。
3. 实际 Dream 公开路由的选择失败→回读→显式重试、禁用→手动同步、busy，以及真实 worker 新页面→Calendar 已取得隔离技术回执；browser OAuth/UI 和真实 provider/正常业务验收仍由来源任务完成。
4. 正式发布顺序为 expand capability → Dream 兼容但暂不 claim → drain 所有旧 Dream writer 与旧 Admin ingress → 全路由证明旧写拒绝 → 开 claims。只读 readiness 不能证明排空。
5. ownerless legacy 的显式修复需独立排空证明与可审计操作；本轮未增加自动修复/按年龄接管，也未改正常 connector。

## Dream consumer 实际集成补充

来源聊天“实现日历互斥页签与今日文档”及其 backend worker 在本轮观察时仍运行。本轮早期观察时 Dream integration proposal 中“仅方案/未实现”描述已落后于代码，实际 DTO/store/factory/scheduler/version cache 和 Calendar/Thread gate 已存在。主代理仅只读 Dream，不编辑其源文件，不发送聊天消息。Dream 保存的 Admin artifact provenance 与当前五个 Admin 文件 bytes、四项 operation hashes 单独校验；源码存在不能代替部署。[artifact 校验及正常 catalog 观察](../../output/notion-sync-ownership-20261007/dream-artifact-verification.json)。

新增 `tests/integration/notionDreamConsumerProbe.py` 导入实际 Dream client/DTO/store/factory/cache，连主代理另建的具名隔离 `ink_notion_sync_ownership_test_97ee8258fb` 和 loopback production-route HTTP harness。只有 Notion metadata provider、成功后丢 HTTP 响应和有限 ACK 延迟通过显式 injection 控制；没有复制 Admin 状态机。正常数据库、真实 provider、正常 Dream 服务未参与。新隔离 preparation 的 75/75、exact capability 和 ACL 原始输出见 [consumer prepare](../../output/notion-sync-ownership-20261007/dream-consumer-prepare.log)，仅用于该新增跨项目阶段。

| 命令 | Exit | 实际结果 |
| --- | --- | --- |
| `<Dream .venv Python> tests/integration/notionDreamConsumerProbe.py <owned fixture> <Dream source> <owned runtime>` | 1 | 首个 selection→sync 抛 NotionCredentialError/NotionSelectionSyncError，0 个完整 case；后续全部未执行 |
| 同一 probe，独立 private runtime，追加 `--renewal-only` | 0 | 明确跳过其他 cases；真实 renew ACK 延迟 1.25 秒、预算 1 秒，取消 cleanup 后 0 个新 finish；前后六文件 source hash 稳定 |
| 主代理独立只读 observer 回查首次同步 | 0 | authenticated、sources=1、current_snapshot_version=null、snapshots=0、run=running |
| 修复后同一 probe，独立 private runtime，完整 consumer lane | 0 | 6/6；首次分页/Calendar/Thread、busy/LKG、上游失败、真实丢 finish 响应/原 receipt/cache restart/旧版本晚写、凭证变化、取消迟到 renew；11 文件指纹稳定 |
| probe `--public-only` 首次 | 1 | 首个公开 case 在 Calendar 返回 NOTION_TIMEZONE_UNAVAILABLE；fixture 缺少时区，worker 未执行；12 文件指纹稳定 |
| 补齐时区后的 probe `--public-only`，独立明确 clock injection transport/runtime | 0 | 2/2；选择失败/回读/显式重试/禁用后手动/busy/Calendar，真实后台 worker 将索引 1 页刷新为 2 页并由公开 Calendar 读取；12 文件指纹稳定 |

原始日志：[首次失败](../../output/notion-sync-ownership-20261007/dream-consumer-probe.log)、[限定续租取消](../../output/notion-sync-ownership-20261007/dream-renewal-cancellation.log)、[实际持久化回读](../../output/notion-sync-ownership-20261007/dream-first-sync-persistence.json)。首次完整 lane 在记录 fingerprint 前失败，不能为它补造前后 hash。observer 诊断最初两条 SQL 因 text→jsonb 与旧字段名称报错，修正只读查询后 exit 0；不是产品写故障。

**P1 历史失败，已修复**：Dream `credentials._read_private_file` 每次读取都 chmod(0600)，`effective_home` 调用它；原 `factory._credential_identity` 包含 ctime_ns，两次检查之间的正常读取改变 ctime，导致首次同步误判授权变化。主代理独立调用实际 effective_home，inode/size/mtime 相同而 ctime 变化；首次实际 consumer 失败和 PG 回读印证其影响。独立 reviewer 确认该缺口。Dream 作者随后改为 dev/ino/size/mtime 与有界读取 payload SHA-256 摘要比较，摘要只留内存，不投影/日志/落库；源码独立复核认可。完整 consumer 复测验证正常首次同步/缓存读取/thread 与真实凭证变化拒绝。[post-fix 完整原始回执](../../output/notion-sync-ownership-20261007/dream-consumer-postfix.log)。本 Admin 任务没有编辑 Dream 修复。

此前 **P2**：renew waiter 被取消后可能等待超预算 ACK 再发 terminal。Dream 作者当前已增加 monotonic deadline/completed_at 和 cleanup 超预算检查，独立源码复核认可；限定实际 lane exit 0 关闭该交叉行为。没有把这一个通过场景替代首次同步、Calendar/Thread、LKG、未知 finish 响应与缓存乱序验收。

公开路由首次失败分类为 fixture 未设置真实时区，保留 [exit 1 原日志](../../output/notion-sync-ownership-20261007/dream-public-worker.log)。后续使用现有 preferences.save 的真实 DTO/route 配置 UTC；主代理仅重签本轮 synthetic service/user credentials，未读取正常凭证、SQL 写 0。新 loopback harness 的明确 `clockShiftAllowed` 只对具名隔离 DB 开启，AsyncLocalStorage 以请求级偏移推进真实 Repository DB clock，偏移取实际 effective interval + 1 秒，UOW/DTO/租约/SQL 保持原入口；不修改产品策略或历史业务时间。[public/worker 最终日志](../../output/notion-sync-ownership-20261007/dream-public-worker-rerun.log)、[synthetic credential 准备](../../output/notion-sync-ownership-20261007/dream-public-credential-refresh.json)。

FastAPI lane 明确注入已认证 AdminRequestActor 和真实 AdminRequestAuth，生产 Admin 每个操作仍重新验证真实 JWT/身份/权限；ASGI 不启动 app lifespan、正常 scheduler 或浏览器。两条成功 lane 分别绑定各自的源码指纹，不宣称是一份相同时间的单次 8 case；它们是 provider-free 技术集成，不是正常业务或真实模型/Notion 验收。

来源保存的正常 Admin catalog 只读回执显示四项 operations 均 present=false、schema present=false；claims 状态无法由 catalog 推断。未对正常数据库执行 0074、未排空旧 writer、未开启 claims。release 仍须由来源所有者完成并提供实际证据。

## 文档与清理

受影响文件头、folder contracts、PRD 骨架、正常/失败时序及状态图已同步。`node output/notion-sync-ownership-20261007/check-docs.mjs` exit 0：Markdown inventory 250，5 个本轮文档、11 个本轮 folder 增量、25 个本地引用有效；3 个 Mermaid 图使用本机 Chrome 一次启动及官方 ESM 模块实际 parse/render 成功，无依赖安装。[图示及文档日志](../../output/notion-sync-ownership-20261007/docs-gate.log)。ESM 使用方式依据 [Mermaid 官方文档](https://mermaid.js.org/config/usage.html)。收尾新增证据链接后只复查引用，不重复启动 Chrome。

构建改写的 `next-env.d.ts` 已恢复构建前原字节，SHA-256 `7b550dda9686c16f36a17bf9051d5dbf31e98555b30d114ac49fc49a1e712651`。主代理确认所有具名自有进程退出、PG 日志为 database system is shut down 后删除整个隔离 cluster/私密 fixture、自有 build 和 Playwright 生成目录；保留不含凭证的日志。正常 `.next`、正常数据库与用户服务没有清理或迁移。[实际 cleanup](../../output/notion-sync-ownership-20261007/cleanup.json)。

本轮 prepare 持有进程结束为 exit 143：embedded-postgres 的 signal exit hook 在 cluster shutdown 后先结束 Node，未完成目录移除。此事实没有伪写为脚本 cleanup exit 0；主代理随后明确校验自有 PID 全部不存在，手动清理具名目录的 command exit 0。准备脚本现提供 `stop-owned-validation` stdin 指令并直接处理自有 child 异常，避免把内部收尾交给竞争的 signal hook；该收尾改动按独立静态检查验证，不追加一次无关 migration replay。最终引用/diff、工作区保护及冻结合同检查另存收尾日志。

最终 `--references-only` exit 0：27 个本地引用、0 缺失，3 图内容不变、0 次新增 browser launch；清理脚本 ESLint 与 `git diff --check` 均 exit 0。最终保护校验为 74 条旧 journal、221 个旧 operation descriptor、冻结的 0074 三文件及 58 个起始 dirty 文件无无关变化，HEAD 保持 `77935d5523e5950558c01edd423cb628580f1bca`。

后续 consumer 阶段收尾：`pnpm exec tsc --noEmit --incremental false` 与 `pnpm exec eslint tests/integration/notionSyncHttpHarness.ts scripts/prepare-notion-sync-validation.mjs` 均 exit 0，未重复已通过全量 unit/build。[typecheck](../../output/notion-sync-ownership-20261007/dream-consumer-final-tsc.log)、[harness lint](../../output/notion-sync-ownership-20261007/dream-consumer-final-eslint.log)。独立 final reviewer 确认当前 12 文件与 public rerun 指纹一致，源码复核关闭。

本轮 preparation 起始 exec 没有分配交互 stdin，`stop-owned-validation` 写入返回 stdin closed；使用已核实的自有 parent SIGTERM，preparation exit 143。独立 public clock harness exit 0。主代理随后核实全部四个自有 PID 退出、PG 明确 shutdown、三个自有端口无 listener，再删除整个具名 private directory、两个 fixture 与全部 private runtimes；删除与核实命令 exit 0。[实际 consumer cleanup](../../output/notion-sync-ownership-20261007/dream-consumer-cleanup.json)。未来通过 tool 启动 preparation 时需 `tty:true` 才能使用 stdin shutdown；本轮不声称已验证此关停路径。

收尾 Registry 校验最初错误地把 key-sorted canonical hash 与之前紧凑 JSON hash 比较，exit 1；没有业务或合同改动。改用同一序列化方式比较并分别记录两种 hash 后 exit 0，runtime Registry225 与保存 inventory 完全一致；58 个 baseline 的无关文件、74 条旧 journal、冻结 0074 和 HEAD 保持。[最终保护](../../output/notion-sync-ownership-20261007/dream-final-preservation.json)。文档中原先将紧凑 JSON hash 称为 canonical 的表述同时更正。

本次最后的文档引用检查 exit 0：40 个本地引用、缺失 0、3 图不变、未再次启动浏览器；diff check exit 0。来源聊天仍 active，其最后观察为 Calendar 7 项异常刷新复测通过，任务导航取消与旧设置入口仍在检查；backend worker 的最后回执仍等待来源 Luna 完整首批/取消测试，不能将本任务 6+2 技术 lane 扩大为来源全部回归完成。

## 后续来源回归与当前发布审计

主代理读取来源的实际 command/output/exit receipts，并复制原字节到本任务非凭证 evidence 目录，没有再次运行已通过测试。来源 Luna 首批正确命令在 Dream `backend/` 执行：

```text
.venv/bin/python -m pytest -q tests/test_notion_sync_ownership.py tests/test_admin_notion_connector_data.py tests/test_notion_store.py tests/test_notion_connector_router_flow.py tests/test_notion_snapshot_store.py tests/test_notion_snapshot_contract.py tests/test_notion_sync_scheduler.py tests/test_notion_today.py
.venv/bin/python -m pytest -q tests/test_notion_sync_cancellation_edges.py
```

实际分别 exit 0、83 passed/16 subtests passed/6.90s 与 3 passed/2.94s；扩展 compileall exit 0。19 个 source/test SHA-256 均仍与当前文件匹配。[当前 hash 与原日志 byte 复制证明](../../output/notion-sync-ownership-20261007/dream-backend-current-receipt.json)、[核心原始日志](../../output/notion-sync-ownership-20261007/source-backend-core-rerun-20261007.log)、[取消原始日志](../../output/notion-sync-ownership-20261007/source-cancellation-edges-rerun-20261007.log)、[来源完整历史回执](../../output/notion-sync-ownership-20261007/source-backend-validation-receipt-20261007.md)。来源此前 root/backend 相对路径 exit 127、Bearer 测试期望/fixture 两项失败、取消文件 sibling 导入 collection exit 2，以及诊断 PYTHONPATH 后 3 passed 均在该历史回执保留；正确 package import 和真实 service Bearer 断言修正后，精确原命令通过。ruff 环境前置 exit 127 仍不算 lint pass，不安装工具或改变 source 环境。

主代理检查现有 `read_normal_admin_notion_capabilities.py`，确认只调用正常 Admin confidential auth/capabilities 读取、输出受保护的 presence/hash 状态，没有业务操作。实际命令：

```text
PYTHONDONTWRITEBYTECODE=1 /Users/dmeck/project/ink-dream-memory/backend/.venv/bin/python /Users/dmeck/project/ink-dream-memory/output/notion-sync-ownership-dream-20261007/read_normal_admin_notion_capabilities.py
```

exit 0：read_succeeded=true；request/claim/renew/finish 均 present=false/exact=false，schema_present=false/schema_exact=false，business_writes=0。`claims_enabled` 明确为 not_verified_by_read_only_catalog，不从缺 capability 推断 server gate 值。[本轮新的正常读取原始结果](../../output/notion-sync-ownership-20261007/normal-capabilities-read-audit.log)。没有 migration、Admin/Dream 发布、服务启停、claim、finish、正常业务数据或 legacy 状态写入。

来源前端实际完整命令在具名隔离 `frontend-build` 执行 `corepack pnpm exec playwright test e2e/calendar-right-panel-tabs.spec.ts e2e/scheduled-task-calendar.spec.ts e2e/calendar-auth-context.spec.ts e2e/notion-settings-save-recovery.spec.ts --workers=1 --trace=on`，退出码 0、71 passed（2.4m）；后续受影响 Scheduled 全旅程 11 passed、旧 Settings 自包含复跑脚本 1 passed，均 exit 0。原 command/output/exit bytes 和来源清理日志已复制：[完整命令](../../output/notion-sync-ownership-20261007/source-frontend-full71-handoff.command.log)、[完整日志](../../output/notion-sync-ownership-20261007/source-frontend-full71-handoff.log)、[后续 11 项](../../output/notion-sync-ownership-20261007/source-frontend-scheduled-final.log)、[复跑脚本](../../output/notion-sync-ownership-20261007/source-frontend-old-settings-vite-script-run4.log)。这是 provider-free 前端技术验证，不是正常业务验收。

首次只比较阶段 manifest 时，9 个已记录文件中有两个测试 hash 不匹配；未将旧 hash 说成当前一致。最终 Scheduled hash 与后续 11 个 trace 内测试源字节匹配当前文件；Settings 当前测试源字节在完整 71 轮的 8 个 trace 中均精确匹配。其余 7 个已记录文件 hash 与当前文件一致，共证明该 9 文件范围，不推断已清理副本的所有 bundle 字节。[原 manifest、后续回归及解决说明](../../output/notion-sync-ownership-20261007/dream-frontend-current-receipt.json)、[19 个保存 trace 的源字节比较](../../output/notion-sync-ownership-20261007/dream-frontend-trace-source-proof.json)。来源前端清理仅针对自有副本/端口，正常服务保留；本任务没有运行或清理来源资源。

逐项完成审计如下，技术验证与正常发布分别裁决：

| 必需要求 | 当前直接证据 | 裁决 |
| --- | --- | --- |
| 最小 Admin contract：复用五表、单一 UOW、严格 DTO/权限/审计 | 当前源码、独立 review、9/9 public API 与 2238 unit | 隔离技术完成 |
| 运行归属与条件提交：fence、lease、DB clock、身份锁、来源/授权 ABA | 9/9 public API、13/13 boundary，实际 DATA/actor SHARE-lock receipts | 隔离技术完成 |
| 成功/失败/取消/未知提交及 receipt 恢复，LKG 和不可变 version | public API/事务故障、consumer 6/6、来源 83+3 | 隔离技术完成 |
| 精确 Drizzle capability/function/owner/ACL，迁移并发/replay/repeat | 75/75 isolated receipts、13/13 exact physical drift checks | 隔离技术完成；未证明正常安装 |
| 旧 221 descriptors、旧 21 Notion wire、旧 74 journal 与冻结 0074 | 最终 preservation 与 artifact byte/hash comparison | 完成保护 |
| Dream keeper、server-only worker、busy/not_due、期限后停止 | 当前 source review、consumer/public-worker、83+3 当前 source/test receipts | 隔离技术完成 |
| 先接受 finish 后 version cache，Calendar/Thread 完整身份/凭证/当前范围校验 | 6/6 actual consumer 与 2/2 real router/worker，稳定 source hashes | 隔离技术完成 |
| 选择/分页、失败回读显式重试、禁用仍 manual、新页面后台进入 Calendar | real public router/worker 2/2、fake Notion provider、显式 harness clock | 隔离技术完成；非正常 provider/business |
| 必需 Admin typecheck/lint/unit/focused API/build；文档/图/paths/清理 | 对应 raw exit 0 与实际 named cleanup；来源 UI 71、后续 11 和复跑 1 exit 0，失败原日志保留 | 本任务完成；来源最终设计稿同步单独等待 |
| 正常实例发布四项 operation 与精确 schema capability | 新 normal catalog 请求的四项/schema 均 absent | 未完成 |
| Dream compatible publication，排空所有旧 Dream writer 与旧 Admin ingress | 没有目标 topology/实例发布和 drain receipts | 未完成；不能由源码或单实例拒写推断 |
| 正常全入口 legacy-write enforcement 与 claims activation | 没有发布后所有入口证明；catalog 不公开 gate | 未完成 |
| 如存在 ownerless legacy：排空后明确、可审计修复，保留 fail closed | 技术 fixture 证明 unresolved 不自动清除；没有正常修复回执 | 不能宣称 affected legacy 已恢复 |
| 正常已部署 consumer/真实业务恢复 | 没有新机制发布后的普通用户公开业务回执；旧账户今日文档曾恢复不能替代 | 未完成 |

原依赖任务明确要求“不停用户服务，不部署/变更正常业务schema作为测试”，验收部分再次要求“勿停正常Admin/Dream/Gateway或改正常真实账户”。这是技术验证的授权边界；不能扩大解释为已经授权正常发布，也不能包装为永久禁止所有未来正常发布。本审计没有扩大授权。下一步必须取得实际正常发布与旧 writer 排空的外部回执，不能重复技术测试或把文档状态改为完成来替代它们。来源主聊天仍确认 active，已报告复跑脚本通过，正在保留旧稿并同步设计图示。复制的来源历史回执及其相对链接目标保留原始 bytes，本地引用另行验证。

## 连续发布阻塞审计

三个已结束的目标轮次 `01a11331-35e6-7951-be8c-c8f9cc0650a5`、`01a1135c-1704-7410-bab6-41fa60db10ef`、`01a1136c-0591-7df1-8679-3e0a7611cd15` 均记录同一项未闭合的正常发布/旧 writer 排空门禁。此前各轮确有独立技术进展；上一轮完成来源实际回执和 trace 字节核对，本轮按真实 handle 确认来源文档任务仍在执行，没有把观察 timeout 当成停止。

本轮重新执行上述正常 catalog 只读命令，exit 0；四项 operation 与 schema capability 仍全部 absent，business_writes=0，claims 状态继续不可由 catalog 验证。[阻塞审计时的正常读取](../../output/notion-sync-ownership-20261007/normal-capabilities-blocked-audit.log)。来源独立集成复核同样明确没有正常切换、drain 或 claims 回执，且其结论不授权正常 DDL、遗留强制重置或停止用户服务。

本任务可执行的实现、独立评审、具名隔离验证、集成回执、保护和清理均已完成。来源正在进行的 Calendar 文档校验不授权本任务修改正常实例；剩余门禁需要正常发布所有者提供实际回执，或用户明确授权新的正常发布与服务切换阶段。当前已无可代替这些事实的技术动作，阻塞审计达到连续三轮及实际无法继续推进的门槛，整体目标不能标为 complete。[原任务边界、连续轮次和实时观察依据](../../output/notion-sync-ownership-20261007/goal-blocked-audit.json)。

## 源码 Git 交付验证（2026-10-07）

源码基线 `77935d5523e5950558c01edd423cb628580f1bca`；实际验证tree为 `cd7edeb9b467eb00cbd5855017ca2ac1f63145b0`。后续只调整本段、执行记录和正式稿状态说明，代码、migration、DTO与三幅图体不变。58个提交路径包含Notion与必要0073迁移历史前置，不包含其他Provider运行/UI改动。

| 实际命令 | Exit | 结果 |
| --- | --- | --- |
| `pnpm --filter @ink-memory/db build` | 0 | 隔离源码package构建通过 |
| `pnpm test:config` | 0 | Node配置与部署投影合同通过 |
| `pnpm exec tsc --noEmit --incremental false` | 0 | 无类型诊断 |
| `pnpm lint` | 0 | 无lint诊断 |
| `pnpm test:run` | 0 | 296文件/2217测试通过；18文件/37测试skip |
| 显式Dream source/interpreter的Notion DTO与scheduled registration vitest | 0 | 2文件/3测试通过，无oracle skip |
| `pnpm build` | 0 | package/Next/type/页面与路由构建通过 |
| `node scripts/prepare-notion-sync-validation.mjs` | 0 | 具名隔离库75迁移、并发/重复、精确capability、ACL与actor锁；stdin关闭后exit0 |
| 私密fixture的 `pnpm exec playwright test --config tests/e2e/notion-sync-ownership.config.ts` | 0 | 9/9公开生产接口旅程，28.7秒 |
| frozen-tree文档/合同checker及 `git diff --cached --check` | 0 | 旧221/21Notion合同保留，前73 journal保留，58路径身份；76引用无当前缺口；3图体身份保持 |

技术数据库 `ink_notion_sync_ownership_test_6d11492d05`、HTTP服务、私密fixture和自建目录已清理，两处自建端口60337/60243关闭，正常服务未触碰。文档checker首次因未规范化 `..` 路径误报51条，exit1保留；仅修checker后exit0，非产品缺陷。显式oracle首次测试3项已通过，但包装脚本使用zsh只读status变量使退出记录失败；仅修包装后3项及实际exit0重新确认，原日志保留。Mermaid复用先前实际3图解析/渲染回执并验证图体身份，不冒称重跑浏览器。原发布边界13项与Dream consumer6/public-worker2历史回执不重复，保持原实际范围。

本轮详细原始日志位于本地忽略目录 `output/notion-sync-ownership-pr-20261007/{static-validation,api-validation,doc-validation}/`，另存prepare/cleanup/工作区保护和Git回执；这些本地日志不是随源码发布的云端文件。正常0074迁移、兼容实例发布、所有旧writer排空、claims activation及新机制真实业务验收仍待独立发布阶段。
