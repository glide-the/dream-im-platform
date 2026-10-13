<!-- [Input] User authorization to create/merge the pending Admin pull request and switch to main. -->
<!-- [Output] Frozen source scope, validation commands/results and repository integration evidence. -->
<!-- [Pos] Admin source integration receipt; existing product and migration contracts remain authoritative. -->
<!-- [Sync] 2026-10-13: current source validation and disposable migration/E2E passed; normal 400 diagnosis is separate. -->

# Admin 主分支集成

## 授权与执行计划

用户在 Dream PR 收口时明确补充“admin 也需要”，授权 Admin 当前待提交工作创建PR、合并实际主分支并切换当前工作区。本仓库实际 remote 为 glide-the/dream-im-platform，默认分支 main；开始时本地/远端均为077f7a4470242c9b9a8567d9c7169ae1f385639f。

优化提示词：保留当前 Admin 的 Image 模型中心、Images/Responses 传输、图像回执、计费与授权等现有实现及文档；冻结现有244项改动，按仓库合同验证当前完整源代码，原Drizzle历史不可改写。所有验证在具名隔离checkout及自有PostgreSQL进行，不读取正常凭据、不执行正常库迁移、不追加真实模型调用、不启动用户刚要求停止的3000/8765服务。通过确定性检查、正式迁移/隔离公开入口和GitHub CI后精确提交、创建PR、合并main，再切换/快进本地main并核对merge commit。出现实际失败由本轮修复和聚焦复测，不以跳过检查作为成功。

执行顺序：冻结源文件及现行文档 → 隔离安装/类型/lint/unit/build检查 → 自有数据库与公开页面验证 → 提交PR/CI → 合并并切换main → 核对原文件和停止状态。其他仓库不混入同一提交，测试日志及fixture凭据不提交。

## 范围和验证边界

现有范围包含Image模型/Provider/价格管理、Images API和Responses图像适配、图片turn持久化/capability、usage/整数金额及结算、Dream配置/数据操作、精确OAuth Browser callback和运行时images:create授权。产品范围与历史真实模型限制保持现有[实现记录](../verification/image-model-center-implementation.md)和[正式设计](../design/image-model-center.md)，本轮是既有源代码集成，不重新定义产品行为。

历史SQL/snapshot及journal已有条目必须保持与基线一致，仅包含已编写的0078/0079/0080前向新增。正常库不参与技术验证，合并代码不等同部署或正常迁移。正常账户的历史成功/失败、未知usage和未验收Provider不得被本轮技术结果改写。

## 实际回执

原244项源文件及2份本轮执行文档冻结在具名隔离checkout `/tmp/im-repositories-pr-20261013/admin-verification`，未复制env或正常数据库。当前生产源码在本轮没有再改；主执行者回读以下原始日志并查看桌面/390px截图。

| 命令 | Exit | 关键结果 |
| --- | --- | --- |
| `corepack pnpm install --offline --frozen-lockfile --ignore-scripts` | 0 | 568包，下载0；隔离依赖安装 |
| `pnpm --filter @ink-memory/db build` | 0 | 当前数据库包及三个数据CLI构建通过 |
| `pnpm test:config` | 0 | 32项配置测试通过 |
| `pnpm test:run` | 0 | 2550通过、37跳过；328文件通过、18跳过；integration不在此命令中 |
| `pnpm lint` | 0 | 无diagnostics |
| `pnpm exec tsc --noEmit --incremental false` | 0 | 类型通过 |
| `pnpm build` | 0 | Next16.1.6 webpack/类型、静态20/20及路由通过 |
| 现行文档/目录/Drizzle checker | 0 | 现行坏链0；基线78个journal条目及已跟踪SQL/snapshot未改，仅追加78/79/80 |
| `node scripts/verify-image-model-center-e2e.mjs <private fixture>` | 0 | Chrome 1 passed，2.2m；Provider→模型→价格→generation/edit→结算→安全记录，桌面/390px |
| `node /tmp/im-repositories-pr-20261013/validate-migrations.mjs <private fixture>` | 0 | core/UI空库81/81；旧78前缀升级81并保留fixture用户；重复无改动；partial drift拒绝且停在78；双migrator并发最终81 |

原始命令、退出码和截图保存在 `/tmp/im-repositories-pr-20261013/admin-validation/`、`admin-e2e-results/` 与 `migrations/`。迁移只对Primary创建的 `ink_gateway_deadlock_test_7c5c97b46ced` 及其UI/测试子库执行，调用原生产migration工作流，没有复制迁移算法或改写历史。隔离E2E使用fake Provider，真实模型调用0，不代替既有真实验收或真实OpenAI限制。

两次harness前置失败单独保留：offline ignore-scripts安装没有恢复PostgreSQL原生库aliases，原initdb失败；在自有依赖目录执行其既有hydrate脚本后version检查通过。随后fixture migration preflight缺identity pepper而fail closed；显式随机fixture pepper输入后81/81成功。没有为测试添加生产fallback或修改Schema。源码历史截图链接指向被忽略的旧生成物，单独记录可用性；Markdown checker的括号路径解析也已按有效嵌套路径修正，不把它误报成源码缺失。

隔离UI/fake Provider已关闭。Primary仅终止本轮fixture controller并移除其具名cluster/私有manifest；正常数据与服务没有参与清理。PR/CI、merge及分支实际状态由本轮最终聊天和安全Git回执记录，不在合并前写成功。

## 用户新报告的普通对话400

验证期间用户报告正常新对话失败，正常3000/8765已由用户重新启动，监听PID为97366/44514。本轮未重新停止或重启这两个服务。按该请求ID进行一次正常数据库只读事务，读取必要请求元数据，不复制正常env、凭据或历史正文到隔离checkout。

请求 `req_321de19d77e34e608c4face4410a225d` 为text、`gpt-6.1-sol`、Codex主Provider，2026-10-13 10:15:04北京时间派发，约2.6秒后HTTP400，settled/failed、input/output tokens均0。原transport读取并脱敏上游错误，但 `toProviderGatewayError` 把400/404/422映射成统一的 `UPSTREAM_REQUEST_REJECTED`；本请求safe summary只有用量/结算状态，未保留具体上游拒绝内容。不能从现有记录断言哪个参数、权限或账号状态导致拒绝，不能宣称此错误已修复。`resume=False/thread_id=None` 是新CLI会话，不作为故障原因。

只读安全结果为 `/tmp/im-repositories-pr-20261013/normal-request-400.json`。本步骤新增真实模型调用0、正常数据库写入0；历史成功/失败和未知usage均保留。这一诊断与fake E2E、Git集成结果分别记录。
