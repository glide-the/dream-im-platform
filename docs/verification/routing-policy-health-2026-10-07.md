<!-- [Input] Independent read/edit requirement, OpenRouter reference, production Gateway records and bounded Luna receipts. -->
<!-- [Output] Reviewable health UI, metric definitions, command evidence and technical-acceptance boundaries. -->
<!-- [Pos] Routing health follow-up; complements the earlier editor-preview and Provider routing verification. -->
# 路由策略查看与链路健康验证（2026-10-07）

## 交付与指标合同

列表将“查看 / 编辑”拆成两个按钮。查看打开只读可用性与性能面板；编辑保留已有型号下拉框、请求规则/时序预览和CAS保存。正式交互、影响矩阵与查看/刷新Mermaid时序同步在[现行设计稿](../design/provider-usage-and-routing.md)。此前[型号选择和请求预览验证](routing-policy-preview-2026-10-07.md)与[初始Provider用量/路由验证](provider-usage-routing-2026-10-05.md)分别保留。

参考[OpenRouter Uptime](https://openrouter.ai/openai/gpt-6-luna-decisions#uptime)与[Performance](https://openrouter.ai/openai/gpt-6-luna-decisions#performance)，访问日期2026-10-07。采用概览、小时状态条、分位数曲线和Provider对比结构；本项目没有持续探测，展示实际Gateway请求样本成功率，不能等同于时间在线率或SLA。

- 窗口为最近24小时/3天/7天，默认3天；小时粒度、默认窗口及Provider分页统一在[展示政策](../../config/routing-health-policy.ts)。打开、切换范围和手动刷新读取，不轮询或调用上游。
- 只纳入已开始上游执行的请求。成功为`settled`且`outcome=succeeded`；失败进入完成分母，取消和进行中独立列出。流式HTTP200不等同于最终成功。
- 每个Provider按实际尝试分别计数；后备恢复为多次尝试后最终成功。当前候选与窗口内历史执行链路分别标明，窗口跨历史策略版本，当前规则显示其revision。
- 性能为成功请求的Gateway执行耗时P50/P95，包含后备时间；首Token只使用成功流式请求的已有时间记录。没有样本或缺少某项时间时显示“无数据”，不填0、不连接曲线缺口。
- [健康API](../../app/api/admin/routing-policies/[id]/health/route.ts)只编排，[领域模块](../../app/lib/admin/routing-health.ts)重复检查Session、`models.read`和`gateway.read`，严格校验path/window/page及未知或重复参数。返回聚合与安全名称，不返回正文、用户、Key、凭据或原始错误。
- 查看无写入，不修改策略revision、Gateway请求、价格、结算、账本或审计；编辑仍由原生产写入口鉴权、校验、事务、CAS和审计。没有schema或migration变更。

只读账户不再读取编辑所需的Provider目录；因此只有`models.read`和`gateway.read`即可查看。缺少Gateway权限显示明确说明，`models.write`仍决定是否可编辑。刷新失败保留上次数据并标记未更新，可重试。

## 验证范围

有界自动化由`luna_test_runner`执行，主代理读取原始回执并目视复核截图。健康领域12测试覆盖401/403、严格参数、非法路径、404、默认窗口、数据库时钟和安全响应。相关路由/预览单元回归共4文件23测试。

Chrome完整流程调用公开生产管理API、真实DTO、`/v1/messages`及`/v1/chat/completions`，使用明确具名隔离PostgreSQL与fake Provider。覆盖：

- 独立查看/编辑、查看不出现保存表单、从查看进入现有编辑、旧型号选择和规则/时序预览。
- 首选成功、后备成功、禁止后备、全部失败、无可用候选、超时和流式输出后失败；请求、尝试、用量、价格快照、结算及账本回归。
- 将健康聚合与公开Gateway记录独立核对，确认请求成功/失败、后备恢复、各Provider尝试归属、时间桶和首Token样本；无执行记录的策略与未观测Provider显示空指标。
- 未登录、缺少Gateway读取权限、只读角色可查看但无法保存；非法/未知/重复参数失败，安全响应不含请求正文、Key或用户标识。
- 切换24小时/3天、性能指标切换、手动刷新、限定健康GET的503注入与恢复、1440px桌面和390px手机无页面横向溢出。注入仅在浏览器读取响应，不替代管理写入、Gateway或结算业务。

## 实际命令与回执

| 命令 | 退出码 | 实际结果 |
| --- | --- | --- |
| `node --import tsx scripts/prepare-gateway-deadlock-postgres.mjs` | 初始化成功；关闭143 | 主代理创建本轮具名隔离PG，唯一生产迁移入口完成78/78初始化；关闭使用精确自有PID的SIGTERM，PG正常shutdown，见清理说明 |
| `pnpm exec vitest run app/lib/admin/routing-health.test.ts app/components/admin/routingPreview.test.ts app/lib/models/routing-policy.test.ts app/lib/gateway/routing.test.ts` | 0 | 4文件、23测试通过，606ms |
| `pnpm exec playwright test -c tests/e2e/provider-routing.config.ts --reporter=line --workers=1 --output=…/browser-run-1` | 0 | 安装好的本机Chrome，完整公开入口流程1/1通过，3.0分钟 |
| `pnpm build` | 0 | Next生产构建成功，独立输出目录，含健康API路由 |
| `pnpm test:run` | 0 | 305文件、2271测试通过；18文件/37测试按原配置skip，703.94秒 |
| `pnpm exec tsc --noEmit` / `pnpm lint` | 首轮0；最终0 | 图表响应式调整与自有输出清理、生成配置恢复后的最终静态检查均通过 |
| `python3 test-results/provider-routing-validation/verify-markdown.py` / `git diff --check` | 0 / 0 | Markdown本地引用无缺失，共享工作区diff无空白错误 |

原始证据：[领域/路由23测试](../../test-results/routing-health-2026-10-07/focused-unit.log)、[Chrome唯一轻量启动检查](../../test-results/routing-health-2026-10-07/chrome-preflight.json)、[Chrome退出回执](../../test-results/routing-health-2026-10-07/e2e-run-1.json)、[完整Chrome输出](../../test-results/routing-health-2026-10-07/e2e-run-1.log)、[构建退出回执](../../test-results/routing-health-2026-10-07/build-run-1.json)、[构建输出](../../test-results/routing-health-2026-10-07/build-run-1.log)。

主代理实际读取[全量unit输出](../../test-results/routing-health-2026-10-07/unit-full.log)、[最终类型检查](../../test-results/routing-health-2026-10-07/tsc-final.log)和[最终lint](../../test-results/routing-health-2026-10-07/lint-final.log)中的`EXIT_CODE=0`，不以部分日志或口头汇总替代回执。[运行前后指纹](../../test-results/routing-health-2026-10-07/source-fingerprint-current.json)的四个相关文件均一致、stable=true；一致性范围限于Manager、HealthView、Chart和健康领域模块，不宣称冻结整个共享工作区。

[Markdown门禁](../../test-results/routing-health-2026-10-07/markdown-final.log)与[diff门禁](../../test-results/routing-health-2026-10-07/diff-final.log)均有真实exit0，检查包括本验证文稿的本地引用。

## 截图与人工复核

主代理目视检查[健康查看区域](routing-policy-health-20261007.png)、[桌面完整页面](routing-policy-health-20261007-desktop.png)和[390px手机页面](routing-policy-health-20261007-mobile.png)。小时条无样本时灰色，曲线仅绘实际点，图表随容器宽度调整，Provider表在自身容器内滚动。

这些是隔离fake Provider流程的合成观测示例。示例24小时有10次成功/4次失败，成功率71.43%、4次后备恢复；两候选分别保留其实际尝试结果。候选在故障测试后停用，因此截图也如实显示“停用”。这些数字不是正常账户的业务指标。

## 技术验证与真实业务边界

本轮UI库为`ink_gateway_deadlock_test_99388a6d1508_ui`，隔离fixture同时拥有同前缀core库；应用端口49662。生命周期由主代理管理，凭据仅在私密manifest与进程内使用，日志脱敏。公开入口技术验证使用生产业务模块，fake Provider不调用真实付费模型。

本轮没有对正常端口3000、用户服务、真实数据库、策略或账本做写入，也没有执行真实账户/真实模型验收。既有备份及此前授权的0073恢复不属于本轮操作。正常数据上的长期统计、持续探测在线率、吞吐量和单次上游尝试延迟均不作为本轮已验证能力。

清理时原非TTY执行会话stdin已关闭，无法用换行触发生命周期结束。主代理通过本轮fixture日志的唯一写进程和预期命令核实PID37902，对其发送SIGTERM，原会话实际exit143；[fixture日志](../../test-results/routing-health-2026-10-07/fixture-setup.log)确认PostgreSQL完成shutdown。首次等待目录自动删除没有成功，未将其报告为生命周期exit0。

随后主代理核实私密manifest中的两个具名库、精确dataDir、postmaster.pid已消失、PG及应用端口不监听、无自有进程后，显式删除本轮私密目录和两个自有Next输出目录。Next自动生成的`next-env.d.ts`恢复到保存的启动前入口；tsconfig没有本轮新增目录条目。该清理命令实际exit0，[清理回执](../../test-results/routing-health-2026-10-07/fixture-cleanup.json)保留SIGTERM143与最终成功状态。其他任务的源码、数据库、进程、Next目录和输出未清理。
