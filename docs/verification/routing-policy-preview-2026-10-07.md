<!-- [Input] Screenshot-driven routing editor follow-up, production routing contracts and independent Luna receipts. -->
<!-- [Output] Reviewable UI/sequence changes, bounded technical evidence and explicit real-business limits. -->
<!-- [Pos] Routing preview verification; complements the original Provider usage/routing report. -->
# 路由策略型号选择与请求链路预览验证（2026-10-07）

## 交付与合同

本轮对应用户截图中的三个要求：说明按序选择的实际请求规则，将“上游型号”从输入改为可用模型下拉框，在保存按钮下显示随编辑变化的预期规则与业务时序。正式设计与 Mermaid 示例位于[现行设计稿](../design/provider-usage-and-routing.md)。原始 Provider 用量、路由与正常0073恢复证据仍保留在[原报告](provider-usage-routing-2026-10-05.md)。

下拉框读取所选 Provider 的已登记、已启用模型，复用生产 `targetSupportsModel` 校验能力和窗口；支持搜索、分页、读取失败重试和空状态。切换 Provider 清空型号。已配置型号不在本页时保留并说明，不能把分页缺失当作实际停用。策略保存继续由现有公开 API 执行 Session、权限、严格 DTO、事务、CAS 和审计。

当前生效规则与未保存的预期规则分别显示。按序取第一个可用项；权重只选择首选，其余保留配置顺序。关闭后备不禁止在候选筛选时跳过不可用项。明确429/502/503/504且无usage/response执行证据才可能后备；超时、执行不明及响应开始后不切换。一次预授权、价格与策略快照、实际 Provider 和已确认用量均沿用生产合同。SVG 时序无外部图表依赖，窄屏在图容器内滚动，保留等价文字规则。

生产变更限于路由编辑组件和展示辅助模块；未变更 API、schema、路由决策、计费或 Runtime。类型检查意外读取忽略目录内的历史源码副本，因此 `tsconfig.json` 排除 `output`/`test-results`，ESLint 同步排除 `output/**`；正式 app/tests/packages 仍纳入检查。另有并发任务模块 `chatScheduledTaskService.ts` 的一处 `let created` 改为 `const`，仅修复 lint，不改其业务逻辑或其他任务实现。

## 验证范围

浏览器技术测试走公开生产入口与实际 DTO：未登录与无权限、Provider 上游用量状态、注册/禁用/不兼容型号、切换 Provider 清空、目录空/失败重试/分页、未保存/保存成功、ordered/weighted/后备/草稿、桌面/390px窄屏、策略 revision/CAS、Gateway 单 Provider兼容/首选/后备/禁止后备/全部失败/无可用候选、Messages/Chat与流式、实际Provider/尝试/用量/价格快照/Token账本和重复请求。

仅目录展示状态注入 Browser GET mock，限定本轮拥有的空 Provider；模拟型号不写入策略。所有管理写入、Gateway、订阅和账本仍走公开生产入口。fake Provider 仅在本机有界技术 harness 内提供可控响应，不调用真实付费模型。

## 实际命令与回执

| 命令 | 退出码 | 实际结果 |
| --- | --- | --- |
| `pnpm --filter @ink-memory/db build` | 0 | 既有数据库 package 编译成功，为隔离 fixture 使用唯一生产迁移入口提供构建产物 |
| `node --import tsx scripts/prepare-gateway-deadlock-postgres.mjs` | 复跑生命周期0 | 两次创建本轮拥有的临时 PostgreSQL；生产迁移入口完成初始化。第二次完成测试后正常关闭并清理 |
| `pnpm --filter @ink-memory/db migrate:status` | 0 | 仅本轮隔离 UI 库：current、78/78、pendingTags=[] |
| `pnpm exec tsc --noEmit` | 首次2；最终0 | 首次只因 output 中历史源码副本引用失败；排除生成目录后正式源码检查通过 |
| `pnpm lint` | 首次1；最终0 | 首次仅并发 scheduled-task 模块 prefer-const；保留失败日志，修正一行后全仓库通过 |
| `pnpm exec vitest run app/components/admin/routingPreview.test.ts app/lib/models/routing-policy.test.ts app/lib/gateway/routing.test.ts` | 0 | 3文件、11测试通过 |
| `node test-results/provider-routing-preview-2026-10-07/run-e2e.mjs` | 首次1；复跑0 | 调用 `pnpm exec playwright test -c tests/e2e/provider-routing.config.ts --reporter=line --workers=1`，Chrome完整公开入口流程1/1通过，54.1秒 |
| `pnpm test:run` | 前两次完整1；最终0 | 当前源码304文件、2259测试通过，18文件/37测试skip，285.26秒。首次2255通过、第二次2258通过及各自唯一失败独立保留 |
| `python3 test-results/provider-routing-validation/verify-markdown.py` | 0 | 最终稿本地引用无缺失；完整清单和计数见最终回执 |
| `git diff --check` | 0 | 最终共享工作区diff无空白错误，不改写其他任务修改 |

原始日志：[首次类型检查](../../test-results/provider-routing-preview-2026-10-07/tsc-noemit.log)、[类型检查复跑](../../test-results/provider-routing-preview-2026-10-07/tsc-noemit-rerun.log)、[首次全仓库 lint](../../test-results/provider-routing-preview-2026-10-07/lint-final.log)、[相关11测试](../../test-results/provider-routing-preview-2026-10-07/routing-preview-unit-rerun.log)、[隔离数据库当前版本](../../test-results/provider-routing-preview-2026-10-07/migration-status.log)、[Chrome唯一轻量启动检查](../../test-results/provider-routing-preview-2026-10-07/chrome-preflight.json)。

首次浏览器失败发生在编辑界面之前的首个公开 `/v1/messages` 请求：客户端30秒等待超时，Next日志仍处于该路由冷编译。保留[首次回执](../../test-results/provider-routing-preview-2026-10-07/playwright-run-1.log)及[编译日志](../../test-results/provider-routing-preview-2026-10-07/next-run-1.log)，不据此判定产品缺陷。仅调整客户端冷编译等待为120秒、完整流程预算为360秒，Provider实际执行超时仍为1000ms，并以全新具名隔离库重新执行同一完整流程。实际[复跑回执](../../test-results/provider-routing-preview-2026-10-07/playwright-run-2.json)与[完整输出](../../test-results/provider-routing-preview-2026-10-07/playwright-run-2.log)均为exit0；没有放宽断言。此前全量unit执行被中断且没有退出码，只保留部分日志，不计为通过。

最终[类型检查](../../test-results/provider-routing-preview-2026-10-07/tsc-final.log)与[全仓库lint](../../test-results/provider-routing-preview-2026-10-07/lint-final-rerun.log)均有实际EXIT_CODE=0。主代理目视复核了[规则/时序区域](routing-policy-preview-20261007.png)、[桌面完整页面](routing-policy-preview-20261007-desktop.png)和[390px手机页面](routing-policy-preview-20261007-mobile.png)；图在容器内横向滚动，页面没有横向溢出，型号字段为下拉框。

第一次完整全量unit的[实际exit1](../../test-results/provider-routing-preview-2026-10-07/unit-full-final.log)唯一失败为 `notionSyncRunRegistration.test.ts` 假定Notion四操作永远是全表最后四项。当前并发任务扩展后，tail含两个scheduled-task Thread读操作。主代理先独立对比Git HEAD的225项与当前261项：[保留证据](../../test-results/provider-routing-preview-2026-10-07/notion-registration-preservation.json)证明旧221完整descriptor相同、Notion四项完整descriptor/count/order相同；公开路由仍按operation name分派。本轮未改Registry、inventory或其他任务业务实现，只将测试定位改为精确四名称，并增加连续区段断言，保留原全部scope、capability、hash、strict DTO与迁移函数断言。此为全表tail假设修正，不删除业务约束，完整重跑仍必须取得exit0才计为通过。

该定位修正后的[7项注册测试](../../test-results/provider-routing-preview-2026-10-07/notion-registration-rerun.log)exit0。[第二次完整全量](../../test-results/provider-routing-preview-2026-10-07/unit-full-rerun.log)exit1，唯一失败转为新加入的v3 authority无效bearer检查。进程22:02:40启动，authority源码和test由并发任务在22:05:16一起更新；失败返回旧allowlist的403，但当前源码已包含v3并应走bearer校验401。主代理未改该模块或断言；这份运行中发生源码更新的回执不作为当前源码验收。[当前源码独立鉴权4测试](../../test-results/provider-routing-preview-2026-10-07/authority-current.log)已实际exit0，另启动新的完整unit并核对问题相关三文件的运行前后指纹。

注册修正后的[类型检查](../../test-results/provider-routing-preview-2026-10-07/tsc-post-registration.log)、[全仓库lint](../../test-results/provider-routing-preview-2026-10-07/lint-post-registration.log)、[Markdown](../../test-results/provider-routing-preview-2026-10-07/markdown-post-registration.log)与[diff](../../test-results/provider-routing-preview-2026-10-07/diff-post-registration.log)均实际exit0。最终文稿的[Markdown引用回执](../../test-results/provider-routing-preview-2026-10-07/markdown-closed.log)与[diff回执](../../test-results/provider-routing-preview-2026-10-07/diff-closed.log)独立保留。

最终[全量unit原始输出](../../test-results/provider-routing-preview-2026-10-07/unit-current-final.log)有实际EXIT_CODE=0：304文件/2259测试通过，18文件/37测试skip。对应[源码指纹证据](../../test-results/provider-routing-preview-2026-10-07/source-fingerprint-current.json)显示 `chatScheduledTaskAuthority.ts`、其test及 `operationRegistry.ts` 三个相关文件在运行前后完全相同，stable=true；此一致性范围明确限于这三个文件，不宣称冻结了整个共享工作区。

## 技术验证与真实业务边界

明确命名的隔离库第一次为 `ink_gateway_deadlock_test_cffac41f8db2_ui`，成功复跑为 `ink_gateway_deadlock_test_13aeda89a62c_ui`，生命周期由主代理拥有，分别使用运行目录 `ink-gateway-deadlock-test-tVYjK8`/`ink-gateway-deadlock-test-6hqlIr`。测试端口62915/61683不是用户正常3000服务。fixture凭据仅位于私密manifest，文本回执脱敏DSN及自动化失败输出中的fixture key/session；失败trace仅包含隔离凭据并保留供诊断。本轮未对正常数据库迁移、保存用户策略、改动真实账本或重启用户服务。78/78只描述本轮当前共享源码的隔离迁移结果，不代表正常库升级，也不为并发任务新增migration提供发布授权。

浏览器结果属于公开生产入口的可重复技术验证；没有真实账户/真实模型验收，用户截图的实际后备开关未从截图推断。既有正常0073备份与恢复不在本轮清理范围内。

## 清理与最终状态

第一次fixture父进程与PG已不在运行、原端口拒绝连接后，主代理核对唯一manifest/dataDir并清理自有残留，见[第一次清理](../../test-results/provider-routing-preview-2026-10-07/cleanup-run1.json)。第二次fixture通过stdin正常关闭，生命周期exit0，[setup/cleanup日志](../../test-results/provider-routing-preview-2026-10-07/fixture-setup-run2.log)确认数据库关闭与私密manifest/root移除；[第二次清理](../../test-results/provider-routing-preview-2026-10-07/cleanup-run2.json)确认自有Next进程和dist均已移除。两个集群包含的core/UI库均随本轮生命周期删除；保留测试回执、失败trace和审查截图，正常服务与0073历史备份未修改。

必要代码、设计、业务时序、目录/文件头同步和技术验证已完成。失败证据独立保留，不以修改断言掩盖实现错误。本轮只改UI和测试harness，不涉及高风险生产领域变更，未重新运行生产Next build；原始路由功能的build证据保留在原报告。没有尚待修复的本轮产品失败；真实账户/模型验收未执行。
