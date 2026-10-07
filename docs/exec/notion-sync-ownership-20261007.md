<!-- [Input] Dream dependency draft, current Notion DTO/Repository/UOW and dirty workspace inventory. -->
<!-- [Output] Impact assessment, file ownership and dated implementation/validation/release evidence. -->
<!-- [Pos] Admin dependency receipt; does not claim normal business recovery or Dream integration. -->
<!-- [Sync] 2026-10-07: owned technical delivery is closed; exact normal-release blocker has met the consecutive-turn audit threshold. -->
# Notion 同步归属执行记录

## 影响评估与文件所有权

本轮保护开始时已有 Provider/routing 等未提交改动。只负责 `app/lib/dream/notionConnector{Dto,Service,Repository,Handler}.ts`、新增 `notionSyncRun*.ts` 及对应测试；只追加 operationRegistry、生成 operation inventory、Drizzle journal 的本轮增量。新增 config/notion-sync-policy.ts、0074 custom capability migration、contract JSON、具名隔离验证脚本与本轮文档。共享 `.folder.md` 只追加本轮说明。不修改其他业务实现、正常账户、当前正常服务或 Dream 源码。

现有五张 Notion 表、connector config_json、行锁、ReceiptRepository 和 UOW 足够。无业务表/字段改动；前向 migration 增加受控身份锁函数并登记精确 capability，保持旧 migration/snapshot 不变。现有 chat schedule 不承载 Notion，复用其数据库时钟/租约思路。新四 operation 的理由是 user/background 不同权限入口及独立 heartbeat/finish；不是新增四套内核。

## 设计门禁

正式设计见 [合同设计](../design/notion-sync-ownership.md)，产品边界见 [PRD](../prd/notion/sync-ownership.md)。独立设计评审已通过最小架构方向，实施包含保留字段覆盖创建/授权/patch、删除最后来源清identity、scope在receipt前验证及receipt/audit后租约复查。Dream consumer/缓存乱序隔离技术验证现已通过；正常发布、legacy drain 与真实业务验收尚未完成。

## 初始技术回执（保留当时提交与发布状态）

独立源码复核最终通过。实际具名隔离 PostgreSQL：`ink_notion_sync_ownership_test_7692ac78e1`；Luna 公开生产入口 9/9、发布边界 13/13、全量 unit 2238 passed、typecheck/lint/build exit 0，当前 Dream builder oracle 实际通过。精确 capability、wire hashes、失败分类与完整日志见 [验证回执](../verification/notion-sync-ownership-20261007.md)。未提交/部署；整体目标未完成，不能以 Admin 技术结果代替 Dream cache/完整旅程/排空证明。

后续使用另一个主代理具名隔离库 `ink_notion_sync_ownership_test_97ee8258fb` 导入实际 Dream consumer，通过生产 Admin HTTP routes 执行新增跨项目 gate。首次 lane exit 1：凭证 read 自改 ctime 被误拒绝，快照 0；独立 review 确认 P1。Dream 作者修复 P1/P2 后，完整 consumer 6 case exit 0、公开路由/真实 worker 2 case exit 0；各 lane 指纹稳定。公开路由首次缺时区的 fixture exit 1 单独保留；补实际 preferences DTO 与明确 harness clock 后通过。不修改 Dream 源、不向来源聊天发送消息；正常发布、drain、claims 与真实业务门禁尚未完成。

后续审计取得来源精确后端首批 83 passed/16 subtests、取消边界 3 passed 与 compileall exit 0；19 个 source/test hashes 与当前源一致，原 command/output/exit bytes 已保存到 Admin evidence。新的正常 Admin catalog 读取 exit 0、business_writes=0；四项 operation 和 schema capability 仍 absent，gate 值未由 catalog 推断。完整逐项完成审计见验证回执；不能以新增文档或重复已有技术 tests 代替正常 publication/drain/claims。

来源前端完整 71、后续受影响 Scheduled 11、旧 Settings 自包含复跑 1 均有原命令、日志和 exit 0；阶段 manifest 的两处旧测试 hash 没有冒称当前一致，保存 trace 的测试源字节及最终 Scheduled hash 证明相应当前文件。9 个已记录文件范围已核对，不推断整个已清理 bundle。来源仍在同步最终设计稿；正常发布与排空门禁保持未完成。

当前阻塞审计重新核对原依赖任务授权、三个连续目标轮次及正常 catalog：本任务不能停止正常服务或将正常部署当成技术测试；正常四项 operation/schema 仍 absent，claims/drain/切换没有实际回执。所有本任务授权技术工作已完成，继续需要正常发布所有者/用户的外部动作或扩展授权，符合连续三轮阻塞门槛。详见验证回执“连续发布阻塞审计”，不将来源正在执行的文档任务误称停止。

## 源码 Git 交付验证（2026-10-07）

用户授权本项目 commit、创建PR、合并main及切回main。本阶段基线为 `77935d5523e5950558c01edd423cb628580f1bca`，只提交58个具名路径。0074严格接续已有0073，因此保留原0073 SQL/snapshot/journal及匹配schema；Provider页面、用量和路由运行实现继续留在工作区。三个已有纯测试fixture修正分别允许不可变旧journal之后追加迁移、包含既有scheduled表、mock实际scheduled delegation分支；不改变生产业务。原始历史回执、首次失败和正常发布阻塞均保留。

实际提交源码副本通过2217个unit（37个可选测试skip，显式Dream builder另测）、9个公开production API旅程、config/type/lint/build，命令均exit0；迁移75条、并发/重复/ACL/身份锁通过。私密fixture、隔离PG与HTTP已由主代理清理。文档路径及三幅既有Mermaid图体另行核对。详细命令见[验证记录](../verification/notion-sync-ownership-20261007.md#源码-git-交付验证2026-10-07)。本节只关闭源码交付验证；不关闭正常0074发布、旧writer排空、claims和真实业务门禁。
