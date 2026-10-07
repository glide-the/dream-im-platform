<!-- [Input] User authorization for Admin commit/PR/main integration and the existing Provider/Notion implementations. -->
<!-- [Output] Independent source snapshot validation, immutable-history proof, exact technical commands and rollout boundary. -->
<!-- [Pos] Admin Git delivery receipt; deployment and normal PostgreSQL activation remain separate. -->
<!-- [Sync] 2026-10-07: verify both existing work streams in a private checkout without modifying the original workspace. -->

# Admin 源码集成验证 · 2026-10-07

## 提交范围与依据

用户要求 Admin 同样提交、创建 PR、合并并回到主分支。本次先对两组已有工作一起验证：Provider 上游用量／同模型路由及 Notion 同步执行归属。准备期间另一任务已提交 Notion `76aa61113e3425f11cf61751159f1fd42124d3ff` 并创建／合并 Admin PR #32（两项 GitHub checks success，main为`fcfc3f7a2759800d3331a5963678a154acd7b653`）；本轮分支接续该提交，只补交尚未入库的 Provider 运行实现和本回执，保留其最新正式设计／源码交付状态。基线为 `77935d5523e5950558c01edd423cb628580f1bca`，原始候选 121 个文件，随后同步其他任务补齐的根与 capability 文件夹说明；主要新增行来自两个 Drizzle snapshot 和生成的 operation inventory。

独立工作区 `/private/tmp/ink-admin-pr-20261007` 使用冻结 lockfile，通过本机 pnpm store 离线复用依赖。准备和验证期间原仓库文件、暂存区和运行服务保持原样；其他任务已在原工作区暂存／提交 Notion 改动，本轮继续使用独立分支，未覆盖其暂存区。现行业务合同分别见 [Provider 设计](../design/provider-usage-and-routing.md)、[Notion 设计](../design/notion-sync-ownership.md)及[Notion PRD](../prd/notion/sync-ownership.md)；原有技术和正常 0073 回执按原时间保留，不改为本轮执行事实。

## 迁移与接口历史保护

原 73 条 journal 项逐项相等，只追加 `0073_majestic_ken_ellis`、`0074_notion_sync_ownership`；所有旧 SQL 和 snapshot 没有修改。原 221 个 operation descriptor 逐项相等，只追加 `notion.sync-run.request`、`claim`、`renew`、`finish`。0074 SQL SHA-256 为 `135deebab2f82fc35baa2cfdd056f224acf7334656c9208476f3f0751e5a7260`。

具名可删除数据库 `ink_notion_sync_ownership_test_e20b909691` 实际执行旧 0073 到 0074 升级、并发 migration、重复应用、新旧 DATA ACL 与身份锁负向；75/75、pending 空，精确 capability/hash 匹配。另一个自有 cluster 的 `ink_gateway_deadlock_test_9b02812c041d` 和 `_ui` 完成空库 75 条回放。所有测试由原生产 migration runner 和公开 Route/DTO 完成，未读取或迁移正常数据库。

## 当前技术验证

| 命令 | Exit | 实际结果 |
| --- | --- | --- |
| `corepack pnpm install --frozen-lockfile --offline` | 0 | 568 个包复用本机 store，下载 0。 |
| `corepack pnpm test:config` | 0 | 32/32，remote-env 与 AutoDL topology 检查通过。 |
| `corepack pnpm lint` | 0 | 全仓无 error/warning。 |
| `corepack pnpm exec tsc --noEmit --incremental false` | 0 | 无类型诊断。 |
| `INK_ADMIN_E2E_DIST_DIR=.next-e2e-admin-pr-20261007 corepack pnpm build` | 0 | db package、Next 编译、20/20 静态页面及路由收集成功。 |
| `corepack pnpm test:run` | 0 | 300 文件、2238 测试通过；18 文件、37 测试按原可选/集成合同跳过。 |
| `NOTION_SYNC_VALIDATION_FIXTURE=<owned private path> corepack pnpm exec playwright test --config tests/e2e/notion-sync-ownership.config.ts --reporter=line --workers=1` | 0 | 9/9，9.9 秒；真实生产 Route/DTO、认证、权限、事务与原 receipt。 |
| `python3 output/admin-pr-20261007/verify-markdown.py` | 0 | 完整库存256份／516处本地引用，缺失0；相对已合并main的本轮30份改动／67处引用全部通过。 |
| `DEBUG=pw:webserver node output/admin-pr-20261007/run-provider-fresh.mjs <fresh private fixture>` | 0 | 原`tests/e2e/provider-routing.spec.ts`完整1/1，57.5秒；usage、CAS／RBAC、default／weighted／fallback、stream、失败／超时、原价格／Token ledger及console断言全部通过。 |
| `corepack pnpm exec eslint tests/e2e/provider-routing.config.ts --max-warnings 0`／`corepack pnpm exec tsc --noEmit --incremental false` | 0／0 | TTL配置更新后复核，无诊断；无需为该harness配置再次重跑完整unit／build。 |
| `git diff --cached --check` | 0 | 无空白错误。 |

完整日志与诊断保留于原仓库本地 `output/admin-pr-20261007/`，不纳入 Git。两份新验证回执的本地日志链接改为明确本地路径，保存原命令、退出码与历史失败；仓库链接继续指向可随 checkout 复核的源码与合同。

## 历史失败与恢复

Provider 隔离 preparation 首轮 exit 1：该独立 checkout 没有正常 env 文件，而旧 harness 未显式提供 `AI_PROVIDER_ACCOUNT_IDENTITY_PEPPER`。生产 migration 配置边界按原规则拒绝，原 cluster 已正常关停并删除。主代理仅在本轮 launcher 注入临时随机测试值，使用新具名 cluster 重跑，75/75 通过；没有修改产品配置或降低校验。失败日志单独保留。

Provider focused 首轮 exit 1：自有 Next 首个匿名 `POST /api/admin/providers/missing/usage` 在 30 秒请求超时内未返回，尚未进入登录／Provider／路由业务步骤。保留 trace/video 和原日志。主代理使用相同 fixture 与公开 API 复核：GET routing-policies 返回 401／460ms，POST usage 返回 401／1141ms，Next 显示 compile 1125ms、render 6ms；该首次超时没有复现，未据此修改产品或放宽 30 秒断言。

第二轮诊断发现 focused harness 没有明确配置 `PROVIDER_USAGE_CACHE_TTL_SECONDS`：用例首次查询后立即切换 fake upstream 为 partial，但服务沿用生产默认 60 秒缓存，第二次 POST 在 22ms 返回原缓存，无法满足用例的即时状态断言。本轮仅在 `tests/e2e/provider-routing.config.ts` 设置既有策略为 0 秒，使 synthetic 上游状态切换独立于 ambient env／过期等待；产品默认值、端点与断言不变。该诊断流程主动中断，实际 exit 130；保留日志、trace/video 和失败截图。TTL=0 的后续 dev 流程已通过指标切换与策略保存，但机器 load 达到52，Gateway 请求耗时31秒，超过该API默认30秒期限；超过240秒后实际中断exit130，不报告通过。

尝试复用已完成生产构建降低现场编译：Next成功启动，但首次 Provider 创建返回500，focused实际exit1。主代理定位现有 `packages/db/src/client.ts` 明确禁止 production 搭配 `INK_USE_TEST_DATABASE_URL`，这是既有隔离 harness 条件；未修改该边界或改接正常库。返回原dev配置，主机load降至7.48，隔离PG只读检查无阻塞；通过匿名公开路由预编译后继续原用例。该复跑沿用了此前部分流程已创建订阅的fixture，正常订阅唯一性校验返回409，未作为产品失败。主代理改建全新具名`ink_gateway_deadlock_test_63b3475a5685`／`_ui`，重新通过75/75并运行原完整用例；仅复用自己checkout的编译缓存，不复用业务行。旧fixture复跑实际中断exit130；新fixture最终exit0、1/1通过，不覆盖此前结果。该临时preflight在无效`/v1/messages`得到400后因通用401诊断断言exit1，400来自输入校验，不是完整业务结果；原测试断言不变。

## 自有资源清理

Notion preparer使用显式stdin命令退出0，数据库／HTTP harness／私密fixture均删除。两个Provider cluster使用确认PID、父进程与cwd的SIGTERM关停，preparer实际exit143；PG日志均显示shutdown，原生exit hook未删除的私密目录由主代理验证端口关闭／postmaster.pid消失后精确删除。清理检查exit0：自有PG与应用端口56348、56414、58384、57726关闭，三个私密fixture目录不存在；原服务5173／8765／3000没有操作。完整清理结果保留本地`output/admin-pr-20261007/cleanup.json`。

## 交互复核

[桌面截图](../verification/provider-routing-pr-20261007-desktop.png)与[390px 窄屏截图](../verification/provider-routing-pr-20261007-mobile.png)来自本轮 synthetic 路由策略。主代理查看实际像素：候选、状态、有效版本及保存反馈可读，窄屏无页面横向溢出；表格沿原容器横向滚动。截图不作为正常账户／模型验收。

## 发布边界

本次 Git 主分支为 `main`。合并源码不等于应用部署、正常 0074 数据库迁移、旧 writer/ingress 排空或 claims 开启；Notion 正式设计的 expand → 兼容但不 claim → drain → 验证旧写拒绝 → 开 claims 顺序继续有效。本轮使用 fake Provider 和 synthetic 用户，未调用真实 Provider／模型，不作为真实业务或模型验收。
