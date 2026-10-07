<!-- [Sync] 2026-10-07: version command evidence; private/local validation outputs remain local paths rather than repository links. -->
<!-- [Input] Primary-owned PostgreSQL migration receipts and luna_test_runner command/browser artifacts. -->
<!-- [Output] Final technical acceptance, failure diagnosis, cleanup and explicit real-account limitations. -->
<!-- [Pos] Verification evidence for Provider account usage, same-model routing and immutable settlement. -->
<!-- [Sync] 2026-10-06: append authorized normal PostgreSQL backup/0073 release, production readiness and existing-session read-only recovery evidence. -->

# Provider 用量与路由验证（2026-10-05）

[交互设计、影响矩阵、源码对照与三个业务时序](../design/provider-usage-and-routing.md)定义验收范围。2026-10-05技术阶段使用公开生产入口、真实 Admin Session/RBAC、具名隔离 PostgreSQL、受控 HTTP Provider；没有部署、发布或迁移正常业务库。2026-10-06用户另行明确授权备份后应用0073，主代理完成正常库迁移和现有Session的只读恢复复核，证据见末节。两个阶段均未调用真实Provider/付费模型；技术流程与真实模型验收继续区分。

## 最终检查回执

主代理负责设计、实现、迁移和最终验收；有界、无真实 Provider 调用的检查由 `luna_test_runner` 执行。命令退出码与时间（本地 `test-results/provider-routing-validation/final-gates.json`）和以下原始日志已逐项读取。

| 命令 | 退出码 / 关键输出 | 范围与证据 |
| --- | --- | --- |
| `pnpm exec tsc --noEmit` | 0；无诊断 | 全工作区 TypeScript（本地 `test-results/provider-routing-validation/tsc-noemit-retry2.log`） |
| `pnpm lint` | 0；无错误/警告 | 全工作区 ESLint（本地 `test-results/provider-routing-validation/pnpm-lint-retry2.log`） |
| `pnpm test:run` | 0；298文件、2229测试通过；17文件/36测试跳过 | 最终全量 unit（本地 `test-results/provider-routing-validation/pnpm-test-run-retry2.log`），含34个 registry、9个 Responses adapter 测试；integration 文件不由该命令冒充执行 |
| `pnpm exec playwright test -c tests/e2e/provider-routing.config.ts --reporter=line --workers=1` | 0；1 passed，20.7s | 完整持久化业务流程（本地 `test-results/provider-routing-validation/focused-playwright-retry2.log`）；使用安装的 Chrome、自有端口、fake HTTP Provider、具名隔离 PostgreSQL |
| `pnpm build` | 0；编译、TypeScript、静态页面20/20、路由优化成功；生成 `/admin/routing` | 最终 build（本地 `test-results/provider-routing-validation/pnpm-build-retry2.log`）；Next标准 `NODE_ENV=production` 与独立 dist，不改变业务合同 |
| `node packages/db/dist/migrate.js` / `--status` | 0 / 0；current，74/74，pending空 | 重跑（本地 `test-results/provider-routing-validation/migration-reapply-retry2.log`）、状态（本地 `test-results/provider-routing-validation/migration-status-retry2.log`）；主代理执行 |
| 旧 Drizzle SQL/snapshot/journal 完整性检查 | 0；131文件无变化，73条旧 journal 与 header 无变化，仅追加0073 | 完整性回执（本地 `test-results/provider-routing-validation/migration-history-integrity.json`） |
| `python3 test-results/provider-routing-validation/verify-markdown.py` | 0；本轮与全库存引用均无缺失文件 | Markdown inventory（本地 `test-results/provider-routing-validation/markdown-inventory.json`）；Paperclip应用路由与本地文件分开解析 |
| `git diff --check` | 0；无输出 | 最终源码和文档空白检查 |

Codex 默认 wire/catalog 版本同步至0.159.0后，重新运行全部静态/unit/build门禁；新增测试证明实际推理 Header、catalog query、命名覆盖、非法 Header 拒绝和旧 registration fingerprint兼容。既有 generic routing E2E通过之后，其被测生产流程未再修改，无额外浏览器启动检查。

## 完整业务技术流程

[focused spec](../../tests/e2e/provider-routing.spec.ts) 使用生产 API 与严格 DTO，不复制测试专用业务入口：

- 登录/bootstrap Session、匿名401、只读角色查询成功与写入403、非法 usage/策略400、CAS409、保存审计。
- 创建disabled Provider、登记型号后验证启用；上游8.75 USD、合法0 USD、部分数据2 USD、403保留过期成功值、unsupported；查询结果不含上游密钥。
- 独立路由菜单编辑weighted策略，查询effective/revision；ordered、weighted、draft/disabled回到单Provider default；每个新请求保存其策略revision。
- 公开 `/v1/messages` / `/v1/chat/completions`：首选成功、503后备成功、非流/流、关闭后备、全部失败；已接受SSE中断和timeout不切换。
- 最终实际Provider/上游型号、failed→succeeded逐尝试HTTP/错误码、Usage10 input/5 output、价格快照及Token reserve/capture15/release；幂等重放409无上游调用。订阅路径现金扣款为0，不误报为现金账本消费。
- Provider禁用、供给型号停用、无候选503且无上游调用、公开模型目录maintenance；timeout保留既有settlement_failed，不能声称未知执行没有上游费用。
- 浏览器console/page errors为0；主代理检查桌面截图（本地 `test-results/provider-routing/routing-desktop.png`）和390px移动端截图（本地 `test-results/provider-routing/routing-mobile.png`）。编辑字段、状态、候选顺序和保存反馈可读，页面无横向溢出；表格沿用容器滚动。

Provider纯协议测试另外覆盖DeepSeek原币种余额、Codex窗口/reset、Copilot来源Token/不限量、部分或缺失字段、query错误不回显正文、缓存并发合并和认证版本隔离；Responses回归证明空done之后的late arguments在completed前完整保留，不提前结束或重复。

## 隔离与迁移

主代理执行 `node --import tsx scripts/prepare-gateway-deadlock-postgres.mjs`，复用既有内嵌PostgreSQL生命周期及唯一生产migration runner；确认database name、data_directory和loopback监听。

- 本轮cluster中的库为 `ink_gateway_deadlock_test_fcc23360e50f` / `_ui` / `_retry2`；每次浏览器重跑使用明确的空隔离库，不是正常业务库或clone。最终业务流程在 `_retry2` 上通过。
- `pnpm db:generate`退出0，生成新的[0073 SQL](../../drizzle/0073_majestic_ken_ellis.sql)、[snapshot](../../drizzle/meta/0073_snapshot.json)及journal append；不修改旧历史。
- 生产迁移入口执行0000–0073成功，最后隔离库迁移日志（本地 `test-results/provider-routing-validation/migration-retry2.log`）与74/74状态对应；同库再次执行迁移退出0，pending空。
- 凭据/DSN只用于私密manifest和子进程环境；日志、报告、截图、公开DTO不保存它们。正常应用启动只检查capability，正常发布须显式应用0073；2026-10-05技术阶段未对真实业务库执行DDL或db:push，后续授权迁移单独记录在末节。

## 发现的失败与根因处理

- Chrome preflight及唯一一次launch/close退出0，`chrome_launch=ok/chrome_close=ok`，未安装浏览器。
- 第一轮focused退出1：标题定位同时命中sidebar h2和page h1；修为明确page level1。第二轮退出1：getByLabel exact未定位选择框，失败页面已出现真实表单/combobox；按其实际可访问角色定位。保留首次日志（本地 `test-results/provider-routing-validation/focused-playwright.log`）、第二次日志（本地 `test-results/provider-routing-validation/focused-playwright-retry1.log`）及失败trace。没有删除业务断言。
- 早期unit发现过期schema断言及测试seam：0068不应被要求永久是journal末项；Dream表清单漏了已发布0069的scheduled relations；SystemConfig delegated get的旧测试只mock OAuth，未mock真实DelegationService。修为固定不可变0068条目、明确表名和真实delegation seam，并覆盖非法delegation401；生产鉴权未改。最终全量通过。
- 初次typecheck退出2：新增测试的ProcessEnv缺少必需NODE_ENV字段，已在测试输入补齐。初次lint退出1的1706错误/630警告全部来自`.next-e2e-*`生成bundle；与既有`.next`一样排除具名产物，所有源码仍被检查。最终两项退出0。
- 初次build退出1：沿用E2E的NODE_ENV=development，`/_not-found`预渲染报null/useState；Next CLI只在未设NODE_ENV时补默认构建值。使用标准production构建环境后通过，无产品prerender fallback或环境业务分支；Codex同步后再次build退出0。

## 清理与限制

清理回执（本地 `test-results/provider-routing-validation/cleanup.json`）记录本轮自有cluster、私密manifest和具名dist清理。stdin已关闭，主代理核对wrapper PID和PostgreSQL data_directory后发送SIGTERM；数据库正常停止，wrapper退出143。随后确认数据库进程已退出，再移除其遗留的自有目录。用户已有服务未停止；日志、失败trace与截图保留供复核。

- Codex/Copilot非公开账号接口只做协议/所有权/安全projection验证；真实注册、entitlement、账户指标和长期稳定性未实测。OpenRouter/DeepSeek实际账号亦未查询，语义和HTTP失败由注入fetch/本地Provider证明。
- Copilot不支持stop的情形仍明确拒绝；未移植cc-switch的静默删除参数。原生Codex Responses/第三方compaction/跨模型Auto Router不在本次入口合同内；详细证据见设计对照。
- 没有分布式usage cache/自动轮询、健康熔断冷却或价格加权；采用能力筛选、每请求实际错误和显式ordered/weighted配置。上游未知执行费用保留事实，不宣称没有收费。
- AGENTS指向的`CLAUDE.md`和`docs/rules/README.md`在本次仓库不存在；实际读取AGENTS、适用Cursor rules及相关folder contracts。
- 2229项通过不包含36项明确跳过的测试；隔离迁移和完整公开入口持久化流程单独列证。后续正常Admin只读恢复复核不代表真实Provider用量查询、模型消费或Dream生成流程验收，不用隔离回执替代它们。

任务为当前专用[Codex聊天](codex://threads/01a10c99-ef52-7a63-9949-78d2c7d52295)，没有递归创建任务。完成标准所需源码、设计/时序、历史文档和技术门禁已交付；目标在主代理最终核对后标记complete，无token预算。

## 2026-10-06 正常 VS Code 启动故障

用户启动正常服务后所有Admin业务显示通用500。主代理读取启动链`.vscode/launch.json`→`pnpm dev`→DB supervisor→Next，确认它只启动服务、不迁移；只读查询本机正常`ink-memory`（127.0.0.1:54329）发现两张route表及Gateway routing两列均缺失。生产runner的只读状态（本地 `test-results/provider-routing-validation/local-startup-status-2026-10-06.json`）显示73/74，latestApplied0072，唯一pending0073。

根因为新应用共享`assertPlatformSchema`已要求0073，旧真实库不满足；`adminErrorResponse`此前将typed schema异常丢弃为`ADMIN_INTERNAL_ERROR`500。隔离测试使用已迁移数据库，不能证明旧正常库可以直接运行新代码，也不能把单Provider数据兼容等同于旧schema运行兼容。

已修错误边界：缺少capability保持fail closed，返回`PLATFORM_SCHEMA_NOT_READY`/503和数据库升级提示；未知异常仍脱敏500。真实库只读production helper诊断（本地 `test-results/provider-routing-validation/local-startup-error-probe-2026-10-06.json`）证明确切异常和安全503，没有写入、迁移或重启正常服务。新增单元覆盖该503及未知Secret消息不回显；luna执行`pnpm exec vitest run app/lib/admin/errors.test.ts app/lib/admin/guard.test.ts`退出0，2文件/9测试通过（日志（本地 `test-results/provider-routing-validation/local-startup-error-tests-2026-10-06.log`））；`pnpm exec tsc --noEmit`、两源码文件ESLint及`git diff --check`均退出0（类型检查（本地 `test-results/provider-routing-validation/local-startup-typecheck-2026-10-06.log`）、lint（本地 `test-results/provider-routing-validation/local-startup-lint-2026-10-06.log`））。

诊断时恢复业务仍需要显式应用0073；它新增两表/两列，无业务数据搬迁或账本改写。当时尚未获得正常库升级授权，因此只读状态检查和错误提示修复不作为业务恢复证据。随后用户明确回复“备份后应用0073并复核”，以下操作均在该授权范围内完成。

### 授权备份、迁移与恢复复核

- 完整备份：备份回执（本地 `test-results/provider-routing-validation/normal-0073-backup-2026-10-06.json`）。`pg_dump --format=custom`退出0，`pg_restore --list`退出0；文件1,278,723,406 bytes，权限0600，目录0700，SHA-256记录于回执。备份保存在项目私有`.ink-memory/backups/0073-20261006002218/ink-memory-before-0073.dump`，保留供用户恢复，未安排删除。归档目录校验不是完整还原演练。
- 主代理再次确认Admin与migration指向同一127.0.0.1:54329/ink-memory及正常data_directory；只允许唯一pending `0073_majestic_ken_ellis`，通过显式`MIGRATION_DATABASE_URL`调用`pnpm db:migrate`，避免runner接管/停止用户已有PostgreSQL。命令日志（本地 `test-results/provider-routing-validation/normal-0073-migration-2026-10-06.log`）与退出回执（本地 `test-results/provider-routing-validation/normal-0073-migration-2026-10-06.json`）：退出0，仅应用0073，最终current、74/74、pending空。没有db:push、业务回填、旧SQL修改或服务重启。
- 迁移后只读检查（本地 `test-results/provider-routing-validation/normal-0073-postcheck-2026-10-06.json`）：生产`assertPlatformSchema`通过；模型16、Provider4、Gateway请求19256、现金账本49，与备份前一致。新policy/target均0条；历史请求routing snapshot均NULL、attempts均[]，保留既有单Provider默认配置。该检查不读取正文或凭据。
- 复用本机正常localhost:3000和用户已登录的Dmeck SUPER_ADMIN Session；主代理只读查看首页、Provider、模型、价格、剧本、订阅、Token流水、用量、账本及Gateway等菜单。浏览器复核记录（本地 `test-results/provider-routing-validation/normal-admin-recovery-2026-10-06.json`）和正常首页截图（本地 `test-results/provider-routing-validation/normal-admin-recovery-2026-10-06.png`）记录现场事实：首页37名用户、16个工作区、24份剧本；Provider卡片恢复；路由菜单正常显示空策略，未擅自创建策略。观察到Provider、模型、routing policies、usage、ledger等公开管理API返回200。
- 浏览器网络空闲等待在usage/report页超时，但随后真实数据及200响应均出现；事件缓存有截断，部分跨页快照处于加载中，不能将该记录当作所有请求的完整HTTP追踪。文件存储显示明确的`FILE_STORAGE_DISABLED`配置状态，未替用户开启存储。以上限制不再表现为共享schema导致的通用500。
- 用户随后确认“看起来可以了”“这些服务看起来没问题了”。本轮没有Provider刷新、模型生成、策略保存或无关业务写入；没有真实模型验收。恢复检查使用真实正常服务，先前故障注入/持久化自动化仍仅使用隔离库。
