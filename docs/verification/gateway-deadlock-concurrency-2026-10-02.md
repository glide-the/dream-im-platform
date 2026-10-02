<!-- [Input] Current-source patch, Luna command receipts, isolated PostgreSQL/Chrome and user-authorized normal port-3000 model calls. -->
<!-- [Output] Separate technical regression and normal business concurrency evidence without credentials, DSNs or response bodies. -->
<!-- [Pos] Gateway deadlock implementation/acceptance receipt; bounded measurements are not an absolute capacity guarantee. -->
<!-- [Sync] 2026-10-02: track correctness repair, model evidence and read-only empty-response review; distinguish requested Token cap from Codex upstream behavior. -->
<!-- [Sync] 2026-10-02: link the later streaming performance report; preserve this earlier nonstream batch and its unmeasured TTFT. -->

# Gateway 死锁修复与真实模型并发验证

## 变更与边界

用户已授权直接修改当前代码、重启现有 3000，并测试所给 Key 可用的全部启用模型。实施只改现有领域事务：结算限流写入提前到额度前；预留/结算额度改用 `FOR NO KEY UPDATE`；结算窗口显式按 UTC 定位。请求终态守卫、额度条件更新、价格快照、追加账本和事务外模型执行保持同一生产路径。没有 schema/migration、数据库时区配置、额度/限流策略、缓存或新增重试的变更。

依据：[结算顺序与 UTC:402](/Users/dmeck/project/ink-admin-memory/app/lib/billing/repository.ts:402)、[预留额度锁:231](/Users/dmeck/project/ink-admin-memory/app/lib/subscriptions/gateway.ts:231)、[结算额度锁:382](/Users/dmeck/project/ink-admin-memory/app/lib/subscriptions/gateway.ts:382)。设计与四张时序图见 [架构设计](../architecture/gateway-deadlock-analysis-and-design.md)。

## 隔离技术验证

主任务创建并确认自有 loopback PostgreSQL 的 database/data_directory，命名 `ink_gateway_deadlock_test_99d53d389a4c` 与 `_ui`，按既有官方迁移编排器应用全部 73 个不可变迁移。所有 UI、Auth、Admin Control 和 Dream 连接均显式指向隔离库。Provider 使用本机受控 HTTP server，公开 API、Session、DTO、领域函数与生产相同；不消耗真实模型、不修改正常业务记录。

| 命令 | 最终退出码 | 实际结果 |
| --- | --- | --- |
| `node scripts/verify-gateway-deadlock.mjs <private-fixture> core` | 0 | 8/8：同模型/跨模型外键绑定后的预授权、锁下耗尽不超预留、预授权与结算交错、后续锁超时原子回滚、非 UTC 会话窗口结转、重复成功/零用量失败终结各一次。 |
| `pnpm exec vitest run app/lib/billing/repository.test.ts app/lib/subscriptions/gateway.test.ts` | 0 | 2 files、16 tests passed；包括窗口在额度前、已终态无共享写入及写入失败。 |
| `node scripts/verify-gateway-deadlock.mjs <private-fixture> ui` | 0 | 1 passed (18.8s)；8 个并发短回复全部 HTTP 200、每次 reserve=capture+release、合计消费120/预留0、Admin 列表可见。 |

测试源码：[实际 PG 交错](/Users/dmeck/project/ink-admin-memory/app/lib/gateway/deadlock.integration.test.ts:1)、[公开 Gateway/后台回归](/Users/dmeck/project/ink-admin-memory/tests/e2e/gateway-deadlock.spec.ts:1)。8/8不代表全部领域写入、跨日/月边界、历史现金路径或结算证据恢复已验证。并发耗尽只证明不超预留，当前异常映射尚未闭合。

失败历史保留：最初直接 migration runner 被已有 data gate 拒绝，改用既有编排器；fixture 先后缺 Provider URL、订阅 cycle anchor、Allowance period number，均在进入并发断言前失败并修正。首轮 UI 认证状态读取误用了普通认证连接，仅只读且未进入表单写入；随后补齐全部隔离 DSN。旧 Subscription 用例通过相关 Gateway/流水步骤后，因废弃 `cancel_at_period_end` 期待失败；没有改旧生命周期或业务行为。聚焦新用例首次 Chrome context 30秒超时，调整用例/fixture超时后真实执行通过。这些失败不能汇报为当次成功或生产缺陷。

清理：自有集群停止，private fixture 与自有 UI dist 删除；正常业务账户、订阅、历史账本和用户已有服务未清理。

## 静态、单元与构建检查

| 命令 | 退出码 | 关键输出 |
| --- | --- | --- |
| `pnpm build` | 0 | DB package编译、Next webpack/TypeScript、静态页20/20与route optimization通过。 |
| `pnpm lint` | 0 | 无lint错误。 |
| `pnpm exec tsc --noEmit --incremental false` | 0 | 无诊断。 |
| `pnpm test:run` | 1 | 290 files/2200 tests passed，3 files/3 tests failed，17 files/36 tests skipped，130.94s。该命令按既有脚本排除integration文件；实际PG8/8另行运行。 |

全量单测的三个其他模块失败：`chat-task-result-schema-contract.test.ts`期望迁移0068、实际0072；`dream-schema-contract.test.ts`期望60表、实际62；`userSystemConfigHandler.test.ts`期望403、实际401。对应文件未修改，本轮不修复无关合同或将全仓库结果写为通过。

## 正常服务与真实模型验证

只读运行检查：正常 PostgreSQL 为 READ COMMITTED、Asia/Shanghai，max_connections=50，应用池默认10。死锁累计14是历史计数，不能直接归于本轮测试。服务恢复为新Next进程5501、supervisor5478、PostgreSQL5480，沿用同目录、正常数据与原生产启动命令。恢复的supervisor实例已占有数据目录；主任务再次启动尝试被所有权检查拒绝，没有绕过检查或另停实例。随后复用现有3000：当前BUILD_ID资产HTTP200，`/v1/models` HTTP200，编译产物包含本次UTC结算SQL。未执行正常数据库迁移。正常服务日志由已有运行任务持有，未清理其进程或日志。

测试前只读快照（UTC12:27:15）：deadlocks=14，stats_reset=NULL；该数值是历史累计。

测试范围：通过正常 `http://localhost:3000/v1/models` 发现11个 Key 可用启用模型；固定非流式 OpenAI Chat Completions、短合成输入、请求`max_tokens=16`（Codex现有适配不向上游投影这个上限，不能解释为实际生成上限）；每模型并发1/2/4/8/16各一批，最多31次网关请求。HTTP异常停止该模型升级；不自动重试客户端请求，不改已有 Provider 策略。测试生成的普通请求/失败/Token记录保留在日常数据库，管理员可按回执请求编号复核。

实际执行UTC 2026-10-02T12:27:22.165738+00:00 至 2026-10-02T12:29:16.072977+00:00（本地UTC+8）。共221次网关请求、217次HTTP200、4次HTTP400，HTTP500/429均为0；有效非空回复20、空HTTP200回复197。四个400均为`UPSTREAM_REQUEST_REJECTED`，单请求阶段停止该模型升级；没有客户端自动重试。

| 模型 | 请求/HTTP200 | 非空（全程） | 最大完整HTTP成功批次 | 最高批次非空 | 最高批次P95 | 结果 |
| --- | --- | --- | --- | --- | --- | --- |
| deepseek-v4-flash-vision-exp | 31/31 | 15 | 16 | 8/16 | 0.98s | HTTP/结算通过；空回复独立统计 |
| gpt-5.4 | 1/0 | 0 | 未取得 | 0/1 | 1.07s | 单请求上游400，停止升级 |
| gpt-5.4-mini | 1/0 | 0 | 未取得 | 0/1 | 1.13s | 单请求上游400，停止升级 |
| gpt-5.5 | 31/31 | 2 | 16 | 1/16 | 4.41s | HTTP/结算通过；空回复独立统计 |
| gpt-5.6-luna | 31/31 | 0 | 16 | 0/16 | 3.11s | HTTP/结算通过；空回复独立统计 |
| gpt-5.6-sol | 31/31 | 0 | 16 | 0/16 | 8.76s | HTTP/结算通过；空回复独立统计 |
| gpt-5.6-terra | 31/31 | 0 | 16 | 0/16 | 3.64s | HTTP/结算通过；空回复独立统计 |
| gpt-6-astra | 1/0 | 0 | 未取得 | 0/1 | 0.51s | 单请求上游400，停止升级 |
| gpt-6-luna | 1/0 | 0 | 未取得 | 0/1 | 0.44s | 单请求上游400，停止升级 |
| gpt-6.1-sol | 31/31 | 0 | 16 | 0/16 | 4.92s | HTTP/结算通过；空回复独立统计 |
| deepseek-v4-pro | 31/31 | 3 | 16 | 1/16 | 1.56s | HTTP/结算通过；空回复独立统计 |

测试后只读复核：本轮221个唯一幂等键全部匹配正常Gateway记录，221条`settled_at`非空；各请求Token reserve/capture/release与请求快照一致，重复效果0、计数不一致0，合计capture7369 Token。正常数据库deadlocks=14→14，stats_reset保持NULL。本轮零新增死锁计数支持未再出现已识别故障，但不能证明其他业务/未来交错都无死锁。现有历史计数没有重置、历史限流/账本没有回填。

完整脱敏阶段/请求编号/计数回执见[真实模型结果JSON](gateway-deadlock-real-model-2026-10-02.json)。后台按请求编号与本轮时间、模型过滤即可复核；回执不含Key、Provider凭据、DSN或响应正文。221条业务记录保留，不清理。

**可支持的结论**：7个模型的HTTP+结算路径在本次短输入条件下全部完成16并发，16并发批次P95约0.98–8.76秒；该批次完成速率约1.83–16.23请求/秒，不能当作长期RPS。**尚不支持的结论**：有效回复的16并发保证、绝对容量上限、长上下文/长输出/流式或多用户持续负载容量。没有一批16并发取得全部非空回复；4个单请求400模型无法评价并发能力。

空回复同时包含`length`与`stop`结束，尚未确认属于输出预算、Provider、协议转换还是其他原因；不将其归于死锁，也不因空回复重复发出模型调用。正常机器另有已有运行任务，未隔离或停止；延迟数据包含当时共享机器与上游条件。没有修复前同条件对照，不能据此给出吞吐改善百分比。

已删除本轮私有Key临时文件、临时执行器及自有失败启动日志；正常3000实例保持运行，自有技术测试数据库/dist已清理。


## 文档与最后服务检查

最终`git diff --check`退出0；Markdown inventory239，6份受影响文档的136个链接逐一核对（JSON只检查存在），LINK_ERRORS=0；四张Mermaid围栏均闭合、RECT_BACKGROUND_COUNT=0。原始源码引用随后按当前函数/SQL位置修正。正常`/admin/login` HTTP200，3000继续由新Next进程5501监听。源码修复未提交，保留在当前工作区供审查。


## 0/16 空回复的只读复核

0/16统计的是非空`choices[0].message.content`，HTTP成功仍为16/16。gpt-5.6-luna/sol/terra与gpt-6.1-sol的16并发批次全部`finish_reason=stop`，每次usage均为prompt10/completion5/total15；正常记录的正文为NULL、没有reasoning_content或tool_calls。这些请求使用Codex adapter。现有Codex请求转换不发送`max_output_tokens`，因此不能把这些空回复解释为16 Token截断；先前“输出上限16”的描述已更正为请求参数。

[非流式SSE读取](/Users/dmeck/project/ink-admin-memory/app/lib/gateway/proxy-handler.ts:125)只取得终态response、不累积output_text.delta；[Responses转Chat](/Users/dmeck/project/ink-admin-memory/app/lib/gateway/responses-adapter.ts:197)只提取终态output内message/output_text，没有内容时输出NULL。这构成转换丢正文的候选路径，但没有本轮原始上游SSE回执，尚不能证明上游发过正文或将全部0/16归为转换缺陷。本轮仅只读复核，没有新增模型调用或修改业务代码。

## 后续流式性能报告

后续在21:19–21:29（UTC+8）另行通过正常入口采集831次流式短数列请求：827次完整有效正文、4次上游400，TTFT有实际客户端采样，追加流水与死锁数已只读复核。它使用不同协议、提示词和请求参数，不替换上面的221次历史批次，也不能据此认定旧非流式空回复的根因已修复。各模型/并发等级的QPS、输入/输出/总TPS与TTFT/E2E分位数见[模型服务性能报告](gateway-model-service-performance-2026-10-02.md)。
