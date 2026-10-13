<!-- [Input] User-authorized correction of configuration, logging and billing ownership; current source and fresh receipts. -->
<!-- [Output] Exact incremental scope, source evidence, independent review and present validation boundaries. -->
<!-- [Pos] Current Image follow-up receipt; historical price-sync and real-model acceptance remain separate. -->
<!-- [Sync] 2026-10-10: close configuration-only ownership, independent review, current regression, real narrow-page evidence and owned cleanup. -->
# Image 模型中心：日志与计费归属修正

## 1. 结论与范围

Image 模型中心只提供 Provider、Models、Pricing 和相关配置操作，删除三栏共同显示的“请求记录”按钮。原 `/admin/image-models/requests` 与 `/admin/models/images?view=requests` 仅跳转到已有 `/admin/gateway/requests`，不再渲染独立记录页面。

图像排障归属“代理网关 → 请求日志”，费用核对归属“Token 计费 → 使用记录”。只补现有页面的调用类型、Provider、状态/时间筛选和图像用量/价格快照展示，修正现有用量聚合/按日报表的UTC日期投影；保留现有请求详情、权限、价格版本、报表与账本。没有新增资源、框架、表或 migration，没有搬迁或修改真实请求/账单。

本次没有部署或正常服务重启、真实模型调用或真实价格变更。配置、日志、计费使用同一份既有事实，移除入口不改变生成、编辑、价格同步或结算合同。

## 2. 源码与文档证据

| 现行能力 | 实际源码 |
| --- | --- |
| 仅三栏的配置中心，无记录链接 | `app/components/admin/ImageModelCenterPage.tsx:8`，`ImageModelCenterPage` |
| 旧书签兼容到现有日志 | `app/(admin)/admin/(workspace)/image-models/requests/page.tsx:8`，`ImageRequestsRedirect`；`app/(admin)/admin/(workspace)/models/images/page.tsx:8`，`LegacyImageModelsPage` |
| 日志生成/编辑、Provider、状态和时间查询 | `app/(admin)/admin/(workspace)/gateway/requests/page.tsx:10`，`GatewayRequestsPage` |
| 计费调用类型与 UTC 日期一致作用于聚合和列表；刷新保持 | `app/components/admin/AdminUsageDashboard.tsx:36/140`，`initialFilters`/`listFilters`；`app/lib/admin/usage-dashboard.ts:14/27/77/143`，`querySchema`/`usageWhere`/UTC bucket/`handleAdminUsageDashboard` |
| 原资源允许日期范围，原权限继续执行 | `app/lib/admin/resources.ts:419/543`，usage/gateway `filterFields`；`:774/791/847`，`handleAdminResourceList`/list/detail guard |
| 按日报表与列表/聚合的UTC日期一致 | `app/lib/admin/billing-report.ts:13/30/41/49`，`handleAdminBillingReport`，原billing.read、UTC日投影/范围及meta |

以上为源码已实现，不把源码存在当作验证通过。日志要求 `gateway.read`，计费列表/详情/聚合要求 `billing.read`；Image payload 仍由服务器无条件拒绝，浏览器不保存图片正文或凭据。

现行 [PRD](../prd/image-model-center/README.md) 与[正式设计](../design/image-model-center.md) 已同步功能描述、完整流程、桌面/窄屏骨架、技术职责和状态图。更新前完整原文保存在 [PRD 历史](../prd/image-model-center/history-20261010-module-boundaries.md) 与[设计历史](../design/image-model-center.history-20261010-module-boundaries.md)，没有改写此前历史稿。

## 3. 当前评审与验证

独立执行者基于实际稿及源码完成复审，指出并关闭以下问题；第二次只读复查确认无残余P0/P1/P2、无新过度设计。

| 问题 | 实际修订 |
| --- | --- |
| P1：聚合与趋势依赖 PostgreSQL session TimeZone，却声明 UTC，可能与列表偏移 | `usageWhere` 显式 UTC 半开日期边界，趋势三参数 `date_trunc(..., 'UTC')`；SQL合同单测和非UTC隔离真实API边界回归 |
| P2：自动刷新写入 URL，但刷新后固定关闭 | 从 URL 严格恢复既有0/15/30/60秒，非法值关闭；E2E验证15秒写入和reload恢复 |
| P2：第二个旧请求书签缺回归，本次验证文档尚未落盘 | 补两条旧URL断言；当前文档实际创建并登记，旧稿完整归档 |

第一轮本次静态检查发现测试代码 `react/no-children-prop`：已将 SSR `createElement` 的 children 改为第三参数，未为通过评审制造功能变化。确定性静态/单元/完整回归/build 与隔离 Chrome 完整流程由 `luna_test_runner` 实际执行；修订后逐次重跑，最终门禁见下表，不采用修订前的22个focused/2327个unit/build结果作为最终通过证据。

初轮具名 fixture：`ink_gateway_deadlock_test_bff1cfa329ab`、`ink_gateway_deadlock_test_bff1cfa329ab_ui`；主执行者显式准备79/79前向迁移，私密 manifest 位于 `/var/folders/bn/m6tkvhx160d9nx6v6rkkkrj80000gn/T/ink-gateway-deadlock-test-Hl7gsz/fixture.json`。PG端口59148、自有session99714；本轮失败后已通过原生stdin清理，仅移除自有隔离库/manifest，不迁移或初始化正常3000/54329服务。

主执行者使用 Node/pg 读取上述0600私密manifest，验证 loopback、精确数据库名及 `current_database()` 后执行 `ALTER DATABASE "ink_gateway_deadlock_test_bff1cfa329ab_ui" SET TimeZone TO 'Asia/Shanghai'`。命令退出码0，新连接实际 `SHOW TimeZone` 返回 `Asia/Shanghai`，没有输出DSN/凭证；仅为本轮具名可删除fixture的SQL边界故障注入，正常PG未修改。E2E在所有普通业务检查后只将本轮三个请求置于 UTC 月末前一微秒、月初和次日边界，经公开列表/聚合检验日期一致，不修改账本或价格快照。

覆盖要求：原完整 Provider→模型→价格→授权→生成→编辑→结果→用量/费用→安全日志流程和失败/取消/恢复/重复/同步；新增三栏无记录入口、旧书签到日志、真实日志操作/时间过滤、既有计费聚合/列表一致、Image详情、刷新保持与文本筛选，以及1440×1000/390×844页面。新截图使用 `test-results/image-model-center-boundary`，保留上轮价格同步产物。

### 实际失败、修订与全新回归

首轮修订后 `tsc/lint` 均exit0，focused5文件23项exit0，完整unit315文件2328项通过/18文件37项跳过exit0，独立build exit0。随后完整E2E exit1：浏览器/runner正常启动，`image-model-center.spec.ts:317–319` 的已知金额600172、未知用量2条按日报表断言得到空数组。上游、生成/编辑与结算已执行，但流程未到最终UI/边界断言，不算完整通过。

主定位既有 `billing-report.ts` 的隐式date范围在Asia/Shanghai会话中过早结束，修正同一只读报表的UTC过滤/日分组/排序及timezone元数据，补5个报告unit及同一非UTC数据库中列表/聚合/报表交叉断言。独立复审再次通过，无价格计算、账本写入、Schema、资源或运行环境分支变化。

失败截图/video/trace完整保留在 `test-results/image-model-center-boundary-failed-nonutc-report-20261010`，不会被重跑覆盖。第二轮使用全新具名 `ink_gateway_deadlock_test_ad633868aa23` / `ink_gateway_deadlock_test_ad633868aa23_ui`，私密manifest `/var/folders/bn/m6tkvhx160d9nx6v6rkkkrj80000gn/T/ink-gateway-deadlock-test-5yRCOB/fixture.json`，PG62370、自有session93962。主执行者实际完成79/79迁移、精确配置/新连接核对Asia/Shanghai，setup命令exit0；该源码版本实际回执如下，首轮结果不替代最终验证。

第二轮最终应用源码的 `tsc/lint` 均exit0，focused6文件28项exit0（824ms），完整unit316文件2333项通过/18文件37项跳过exit0（128.66s），独立build exit0且自有build目录已删除。该次E2E exit1，已通过原报表600172/未知2条断言及价格同步，进入现有日志UI；`image-model-center.spec.ts:531` 在 `getByLabel("调用类型", { exact:true })` 选择下拉时30秒超时。实际error-context已有 `combobox "调用类型"` 和所有选项，无额外console/pageerror/5xx报告；这是测试精确label文本匹配问题，不是缺控件、浏览器无法启动或产品故障。

主仅将此类select定位改为观测到的 `getByRole("combobox", {name, exact:true})`，没有改变产品实现来迎合测试。第二轮失败产物完整保留在 `test-results/image-model-center-boundary-failed-log-selector-20261010`。旧62370 PG已由主验证PID/父进程后SIGTERM停止（退出143），原生stdin关闭导致目录未被自动移除；主再次验证精确fixture、端口无监听后只删除自有5yRCOB目录/私密manifest（exit0）。不能把该退出143写为原生清理exit0。

选择器修订后的完整流程使用全新 `ink_gateway_deadlock_test_bc6fe14d0496` / `ink_gateway_deadlock_test_bc6fe14d0496_ui`，manifest `/var/folders/bn/m6tkvhx160d9nx6v6rkkkrj80000gn/T/ink-gateway-deadlock-test-FJZTPM/fixture.json`，PG63884、main TTY session78668。79/79迁移及精确数据库新连接Asia/Shanghai核对成功；应用源码不变，修订后的tsc/lint/focused28均exit0，完整E2E exit0、1 passed(1.0m)，安全诊断数组为空。第二轮unit/build证明最终应用源码，没有采用旧浏览器结果。

主执行者截图复核发现上述390×844日志/账单产物拍到了打开的筛选抽屉，记录表的窄屏视觉证据仍不足。已保留此通过产物至 `test-results/image-model-center-boundary-before-mobile-records-20261010`，并只补测试：分别保留抽屉截图，关闭抽屉后核对实际记录、表格局部滚动及页面无横向溢出，记录页另截图；没有修改产品或增加无意义代码。

窄屏证据补充回归使用第四个全新具名 `ink_gateway_deadlock_test_84ca203cd8be` / `ink_gateway_deadlock_test_84ca203cd8be_ui`，私密manifest `/var/folders/bn/m6tkvhx160d9nx6v6rkkkrj80000gn/T/ink-gateway-deadlock-test-zYzmJj/fixture.json`，PG64783、main TTY session6044。主准备79/79迁移；最初时区probe exit1实际返回UTC，随后显式ALTER此精确可删除UI DB并用新连接核对Asia/Shanghai exit0。该probe属于故障注入前置配置，不是产品缺陷。tsc/lint/focused28 exit0，E2E exit1：按钮显示“关闭”，实际aria-label为“关闭筛选”，精确“关闭”选择器超时。按error-context及 `AdminListChrome.tsx:181` 修两处测试定位，所有断言保留，失败产物存 `test-results/image-model-center-boundary-failed-filter-close-20261010`。

最终完整复跑使用第五个全新具名 `ink_gateway_deadlock_test_e5b0a5515523` / `ink_gateway_deadlock_test_e5b0a5515523_ui`，私密manifest `/var/folders/bn/m6tkvhx160d9nx6v6rkkkrj80000gn/T/ink-gateway-deadlock-test-1deLKz/fixture.json`，PG49446、main TTY session84019。主准备79/79迁移，精确ALTER此可删除UI DB并用新连接核对Asia/Shanghai exit0。应用源码没有在后续选择器/截图修订中改变，最新完整流程exit0，1 passed(1.1m)，包括关闭筛选抽屉后的真实窄屏记录页。

### 最终实际命令与结果

| 命令 | 退出码 | 关键输出与范围 |
| --- | --- | --- |
| `pnpm exec tsc --noEmit` | 0 | 全仓TS；最后一次浏览器spec修订后实际重跑 |
| `pnpm lint` | 0 | 全仓lint；先前SSR测试规则失败已修并重跑 |
| 下方focused Vitest命令 | 0 | 6/6文件、28/28 tests passed，832ms；三栏、operation/date/UTC、RBAC、payload禁读 |
| `pnpm test:run` | 0 | 最终应用源码316文件/2333测试通过，18文件/37测试跳过，128.66s；后续只有E2E定位与截图断言变化，应用源码/单测未变 |
| `INK_ADMIN_E2E_DIST_DIR=.next-e2e-image-boundary-build pnpm build` | 0 | 最终应用源码Image、Gateway、Billing路由生成，自有build已删除；不替代浏览器流程 |
| 下方最终E2E命令 | 0 | Playwright 1 passed(1.1m)，`.last-run.json` 为passed且failedTests为空；真实生产入口＋本地fake＋具名隔离PG，不是实际模型验收 |

~~~bash
pnpm exec vitest run app/components/admin/AdminModulePage.test.ts app/lib/admin/usage-dashboard.test.ts app/lib/admin/request-resources.test.ts app/lib/admin/list-query.test.ts app/lib/admin/gateway-payloads.test.ts app/lib/admin/billing-report.test.ts
node scripts/verify-image-model-center-e2e.mjs /var/folders/bn/m6tkvhx160d9nx6v6rkkkrj80000gn/T/ink-gateway-deadlock-test-1deLKz/fixture.json
~~~

完整流程覆盖Provider配置→模型/能力→平台价格/套餐授权→Gateway Key→生成→参考图及mask编辑→完整结果→实际用量/平台金额/Token结算→安全日志/计费详情。负向及恢复覆盖权限拒绝、停用、无效输入、上游失败、无图、未知用量、过量用量、重复请求、取消、可信/未知用量恢复与再请求；共享文本定价/同步、歧义候选、有界价格冲突、重复开放版本和相反模型顺序并发亦回归。

本次增量另覆盖三栏无记录入口、两条旧书签重定向、生成/编辑/Provider/模型/时间筛选、账单列表/聚合相同过滤、图像用量与冻结价格、15秒刷新状态reload保持、文本筛选，以及Asia/Shanghai session中的UTC月末前1微秒/月初/次日边界的列表＋统计＋按日报表一致。诊断断言无console error/pageerror/非预期5xx；仅有 `NO_COLOR`/`FORCE_COLOR` 工具警告。

主执行者已实际查看本轮截图，抽屉与记录页面分开；尺寸由Luna核对。

- [Image三栏窄屏，390×844](../../test-results/image-model-center-boundary/image-model-center-Image-p-98c08-→-settlement-→-safe-records-chromium/image-model-center-390x844.png)
- [Image Pricing 同步按钮，1440×1000](../../test-results/image-model-center-boundary/image-model-center-Image-p-98c08-→-settlement-→-safe-records-chromium/image-pricing-sync-1440x1000.png)
- [既有Gateway日志，1440×1000](../../test-results/image-model-center-boundary/image-model-center-Image-p-98c08-→-settlement-→-safe-records-chromium/gateway-image-logs-1440x1000.png)
- [关闭筛选后的真实日志，390×844](../../test-results/image-model-center-boundary/image-model-center-Image-p-98c08-→-settlement-→-safe-records-chromium/gateway-image-logs-390x844.png)
- [既有账单图像详情，1440×1000](../../test-results/image-model-center-boundary/image-model-center-Image-p-98c08-→-settlement-→-safe-records-chromium/billing-image-detail-1440x1000.png)
- [关闭筛选后的真实使用记录，390×844](../../test-results/image-model-center-boundary/image-model-center-Image-p-98c08-→-settlement-→-safe-records-chromium/billing-image-usage-390x844.png)

### 文档检查

Luna独立执行 `git diff --check`，exit0；执行 inline Node Markdown inventory/link scanner，exit0。扫描35个清单文件、206个本地引用，清单缺失0、引用失效0；本轮6个截图目标全部存在，相关7份当前/历史文档全部存在，14份产品/设计/验证/任务文档文件头均存在。受影响 `.folder.md`、README及模块合同已纳入检查。

正式设计包含3个Mermaid围栏，正常业务、异常恢复、状态转换图均存在；本次只检查围栏和引用，未执行Mermaid parser/render验收。临时扫描器未识别 `~~~mermaid` 的问题已修正，最终上述回执为修正后实际执行结果。

## 4. 验收与清理边界

主执行者使用正常 Chrome 与现有登录 Session 只读核对 `http://localhost:3000`：Image Pricing 的三栏仍为 Provider/Models/Pricing、请求链接数量0、models.dev同步按钮仍存在；正常 Gateway 日志及 Token计费使用记录均有文本/图像生成/图像编辑筛选，没有 Image 子导航。没有点击同步、保存、生成、编辑或任何账单操作。这是正常页面只读验收，不是新增真实模型调用或结算验收。只读检查中的 exact按钮选择器和错误origin等待曾失败；读取真实DOM/URL后已纠正，页面最终状态核对成功，不据此判定产品缺陷。

文档检查、隔离 fake Provider 技术验证与真实账户/模型验收分别记录。本次是界面和只读查询修正，不重跑真实上游或修改真实账本；之前 Codex/OpenAI 的验收状态不会因本次技术测试改变。

清理只针对本轮五个自有PG/私密manifest及对应Next/fake/dist。最终session84019原生stdin退出0，输出 `owned PostgreSQL cluster and private fixture removed`；其余清理方式/非零退出已按历史记录，不混写为0。Luna确认其五个 `.next-e2e-deadlock-*` 精确dist及 `.next-e2e-image-boundary-build` 均不存在，Next进程退出；保留最终和失败/上次价格同步验证产物。

主最终Node只读核对命令exit0：五个具名临时root及59148/62370/63884/64783/49446监听均不存在，六个自有dist不存在；正常Admin端口3000仍PID19557、正常PG54329仍PID19495。没有移除真实业务数据；删除的隔离库/fixture不保留恢复副本，回执与截图仍可复核。

Codex任务沿用 `01a120ae-3bb0-7432-88a2-4755ecb4275a` 的历史任务记录，不创建重复任务或重设目标。此会话目标工具实际查询 `goal:null`；先前目标complete不替代此增量的独立评审、当前回归和文档检查，也不会因本次fake技术验证扩大真实OpenAI验收结论。
