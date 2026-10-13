<!-- [Input] Image Model Center product request, current Admin/Gateway/Billing source, official OpenAI Images documentation, and the local Codex source tree. -->
<!-- [Output] One execution contract for research, product/design documents, independent review, implementation, and tiered validation. -->
<!-- [Pos] Current Image Model Center task record; it does not replace historical AI model, Gateway, or Billing documents. -->
<!-- [Sync] 2026-10-09: create the four-stage execution contract before product or code changes. -->
<!-- [Sync] 2026-10-09: record completed design/implementation/normal rollout and the remaining real-provider acceptance gates. -->
<!-- [Sync] 2026-10-09: close real Codex acceptance and retain only the external official-OpenAI prerequisite. -->
<!-- [Sync] 2026-10-09: reopen final Codex billing acceptance behind the audited reserve/price-source gate. -->
<!-- [Sync] 2026-10-09: make the OpenAI API versus Codex managed billing basis machine-verifiable. -->
<!-- [Sync] 2026-10-09: close the final evidence audit without converting Image estimates into reservation contracts. -->
<!-- [Sync] 2026-10-09: mark the persistent external acceptance gates blocked after the required repeated audit. -->
<!-- [Sync] 2026-10-10: resume the goal, correct platform-versus-upstream pricing semantics, and adopt Double Diamond. -->
<!-- [Sync] 2026-10-10: track configuration-only center ownership and fresh logs/billing regression as a follow-up, not a duplicate goal. -->
# Image 模型中心执行计划

> 最终程序状态：既有Codex任务 `01a120ae-3bb0-7432-88a2-4755ecb4275a` 的目标已由目标工具更新为 `complete`；没有创建重复任务。真实OpenAI仍明确未验收，其缺凭据边界不被模拟结果替代。

> 最新职责修正属于当前任务后续增量，不创建任务或重设目标：Image中心只保留Provider/Models/Pricing；日志归已有Gateway请求日志，费用归已有Token计费。2026-10-10目标工具查询当前返回 `goal:null`；旧complete记录不能代替此增量验收。实际修订、独立评审、失败修复及当前验证状态见[本轮回执](../verification/image-model-center-module-boundaries-20261010.md)。本次没有新增规划提示词。

## 2026-10-10 当前执行修订（非新增任务）

沿用当前Codex目标，不创建重复任务。最新用户明确Image必须是与AI并列的独立中心，内部Provider/Models/Pricing；本轮直接修正页面归属和设计稿，没有生成新的规划提示词。共享Provider、模型、价格、权限、Gateway与账本不变。设计/PRD更新前全文分别归档，实际稿独立复审后修复表单序列化、nullable价格和Image Provider范围。最终独立复审通过、当前验证和文档检查均已闭合，完成条件已经满足；程序状态以目标工具最终回执为准。

## Codex Goal 程序定义

### Objective

在 `/Users/dmeck/project/ink-admin-memory` 中完成 Image 模型中心的调查、产品与交互设计、独立评审、最小实现和分层验收。最终状态必须使管理员能够在与 AI 模型中心并列的独立 Image 模型中心，通过 Provider、Models、Pricing 三个栏目管理 Codex 与 OpenAI 图像服务、图像模型、生成/编辑能力、Admin 平台价格，并查看安全请求记录；两个中心共享现有资源、权限与账单基础。使具备授权、权益和额度的调用方能够通过 `POST /v1/images/generations` 与 `POST /v1/images/edits` 获得完整图像结果；使每次可结算请求按照 Provider 返回的实际 Token 用量和请求采用的 Admin 版本化 micro-USD 价格完成预留、结算、失败释放、账本记录和请求追踪。

### Required outcomes

1. 调查现有 AI 模型中心、Provider、模型目录、权限、Gateway 请求生命周期、请求记录和 Billing，给出带文件、符号、行号与证据状态的复用/缺口判断；分别核实公开 OpenAI Images API 与本机 Codex Image 后台路由的 URL、认证、生成、编辑、响应和 usage 合同。
2. 在 `docs/prd/image-model-center/` 维护按双钻石组织的现行 PRD。功能模块只描述用户能力、问题和边界；报文、校验、状态机与实现细节不得混入业务功能描述。正文必须包含管理员流程、桌面/窄屏骨架、页面关系和验收要求。
3. 维护正式交互与技术设计，说明选定方案及源码依据、职责边界、两个公开接口、认证授权、模型资格、字段校验、Provider 转换、调用关联、结果转换、计费、幂等、失败、取消与恢复；包含正常时序、异常恢复和状态转换 Mermaid，以及验收矩阵和实施顺序。
4. 基于实际设计执行独立评审，核对目标完整性、现有管理体验复用、生成/编辑成功与恢复路径、平台计费语义、必要性和过度设计；修正评审发现后再确认实现范围。
5. 复用现有 Provider、model alias、RBAC、Gateway Key、subscription entitlement、allowance、pricing revision、request lifecycle、append-only ledger 和 Admin 请求详情；只补充 Image 所需的页面、管理字段、两条 Gateway 路由、Codex/OpenAI transport、usage 明细和必要 schema/migration/capability。
6. Admin 平台价格是面向调用方结算的唯一价格真值。OpenAI API、models.dev、Codex 公开资料或内部记录只是可选参考；缺少参考来源不得阻断模型启用或调用。Codex included usage 不转换成逐请求美元成本。结算必须使用上游实际 Token 明细，不得按张虚构费用或把缺失 usage 当作零。
7. Provider 密钥只留在服务器；提示词、参考图、mask、生成图和完整上游正文不得进入 Admin payload 日志、模型上下文或通用回执。管理详情只展示安全摘要、usage、平台价格快照、费用、状态和经过处理的错误。
8. Schema 仅由 Admin Drizzle 管理。任何数据库变化都提交不可变的前向 PostgreSQL migration 与精确 capability；不得引入 runtime DDL、SQLite、JSON DB、内存回退、第二账本、后台图片任务、自动 Provider failover 或环境名称业务分支。
9. 确定性 typecheck、lint、单元、集成、回归、build 和隔离 PostgreSQL/Chrome E2E 由 `luna_test_runner` 执行并返回本轮命令、退出码和关键输出。主执行者负责代码修订、正常数据库边界、真实账户和真实模型验收。
10. 真实 Codex generation 与 edit 必须经过本机正常 Admin、Gateway、现有真实账户、模型、订阅和 PostgreSQL，形成可在日常 Admin 中查看的 request、usage、价格快照、结算和 ledger 证据。OpenAI 真实验收只有在现有官方 OpenAI Provider 与服务器凭据可用时执行；fake Provider 只能证明隔离技术合同。

### Completion predicate

只有同时满足以下条件才允许把 Goal 标记为 complete：PRD、正式设计、调查证据和独立评审已经按修正后的平台计费语义更新；代码与 migration 实现完整；受影响的确定性验证获得本轮通过回执；隔离 E2E 覆盖配置到请求记录的完整业务链；真实 Codex 生成与编辑均获得当前实现的成功回执并核对正常数据库中的 usage、平台费用、allowance、ledger 和无正文记录；所有已发现错误已修订并重跑相关检查；未验证的真实 OpenAI 行为被准确标记且没有被模拟结果替代。

### Non-completion conditions

任务创建、派发、检查仍在运行、旧测试结果、仅有文档、仅有 mock、仅有 transport 成功、仅有 HTTP 200、仅有技术验证、缺少结算证据或把平台价格误写成上游成本，都不构成完成。缺少 OpenAI 真实凭据只影响 OpenAI 真实模型验收的状态，不得再次被用作阻断 Codex 实现、平台计费或 Codex 真实验收的理由。

## 历史 Prompt Architect（已被当前目标修订替代）

以下保留早期任务记录，不作为当前页面归属依据。当前执行没有再次优化提示词；“AI中心为唯一入口”已经由独立Image中心目标撤销。

Optimized Prompt:

在 `ink-admin-memory` 中以现有 AI 模型中心为唯一管理入口，增加仅支持 Codex 与 OpenAI 的 Image 模型能力。先以实际源码、现行文档、OpenAI 官方 Image API 和本机 `/Users/dmeck/project/codex` 为证据，区分公开 OpenAI API 与 Codex 后台路由的 URL、认证、生成、编辑、结果和用量合同；所有关键结论标记为源码已实现、合理推断、建议未实现或尚未验证，并给出文件、符号与行号。复用现有 provider、model、permission、Gateway API key、request lifecycle、pricing revision、预授权、结算、append-only ledger 和审计，不创建第二套管理系统、账本、图片资产中心、后台任务或文本协议转换链路。

先保存现行文档原文并新增业务域 PRD 与正式设计。文档按双钻石组织：发现阶段收集用户问题与源码证据，定义阶段收敛目的和边界，发展阶段比较最小方案，交付阶段固定交互、技术合同和验收。PRD 只描述管理员和调用方获得的能力、业务概念、流程、桌面与窄屏骨架及验收；正式设计定义公开 `POST /v1/images/generations`、`POST /v1/images/edits` 合同、Codex/OpenAI 适配、前端/Admin/Gateway/Provider/数据库职责、认证授权、字段校验、调用关联、结果转换、真实用量计价、失败/取消/重复/重试行为、对既有文本模型和计费的影响，并内嵌正常、异常恢复和状态转换 Mermaid。Admin 平台价格是结算真值，OpenAI API、models.dev 或 Codex 公开资料仅可作为定价参考；图片正文、提示词和凭证不得进入前端、模型上下文、请求日志或通用回执。

设计完成后执行独立评审，检查目标完整性、现有管理体验复用、生成与编辑闭环、用量与价格可核验、状态恢复、建议/现状标记及过度设计；修订通过后才实现。实现保持 Route Handler 薄、严格 Zod、服务端 Session/permission 重验、事务与审计、PostgreSQL 唯一 schema、不可变 Drizzle 历史和前向 migration/capability。模型与价格不硬编码；Image 请求不进入 Messages/Chat 转换链路。重复请求不得重复调用上游；取消或未知上游结果不得盲目重试或零费用结算。

验证按影响面覆盖提供商配置、图像模型与价格、授权、生成、参考图编辑、结果、用量/费用、请求记录，以及权限拒绝、模型停用、无效输入、上游失败、无图/错误结果、用量缺失、重复、取消和相关重试，并回归文本模型与计费。确定性的 typecheck、lint、unit/integration/regression、隔离 PostgreSQL 和 focused Chrome E2E 交给 `luna_test_runner`，主执行者负责修复、迁移所有权、真实账户/模型验收和生产入口。文档检查、隔离技术验证与真实业务验收分别报告；缺少用户指定的真实账户、现有业务实体或可用模型时不以 fixture 冒充。只有文档、评审修订、实现和必需验证全部完成，目标才可完成。

Optional Enhancers:

- 在不保存图片正文的前提下，为请求记录增加可审计的输入图片数量、媒体类型、字节数和上游请求标识。
- 若真实上游同时提供总 Token 与文本/图片 Token 明细，增加总量一致性校验，避免错误价格快照进入账本。

## 阶段与门禁

| 阶段 | 产出 | 进入下一阶段的条件 |
| --- | --- | --- |
| 1. 调研 | 源码与协议证据、复用/缺口和最小改动判断 | OpenAI 与 Codex 合同已分开，关键判断有状态和行号 |
| 2. 产品与设计 | 现行 PRD、正式设计、页面骨架、Mermaid、验收矩阵 | 业务描述与技术合同分层，历史原文仍可访问 |
| 3. 独立评审 | 目标符合度、范围、恢复路径、计费依据和过度设计结论 | 评审问题已修订，不以计划代替实际设计评审 |
| 4. 实现与验证 | 页面、Admin/Gateway/Provider/Billing/schema、自动化与分层回执 | 受影响检查重跑通过；真实验收状态单独说明 |

## 所有权与限制

- 主执行者拥有设计修订、生产代码、Drizzle migration、真实业务验收和最终状态判断。
- `luna_test_runner` 只执行用户指定的确定性、隔离、可重复验证，不操作真实账户、真实模型或生产数据。
- 仅清理本轮明确命名的隔离数据库、端口、进程和生成物；不停止或修改用户已有服务。
- Goal 在交付、修订和必需验证结束前保持 active；技术验证通过不代表真实模型验收通过。

## 独立评审后的实现调整

Prompt Architect 补充约束：Image reservation 使用模型级每图输入/输出 Token budget，按 prompt + 输入图数量 × input budget + n × output budget 预留；不得复用文本 `max_output_tokens` 或按文件字节推算，来源说明为可选审计信息。usage known 结算失败先保存四类真实明细，再只重做幂等结算；usage unknown 在 grace 后只保守消费 reservation，保持实际用量和平台费用未知。OpenAI Provider 使用显式 `config.imageApi.kind=openai`，Codex Image endpoint/headers 由 Provider registry 拥有。Direct Images 的 output text 必须为零。payload 在写入和 Admin 读取两侧都 fail closed。

完成度复核纠正：运行时只要求已配置正数预留预算和有效的 Admin 平台 Image 分项价格。预留依据、参考价格来源和版本是可选审计信息，不是启用或调用门槛。历史真实调用证明 transport、usage 与平台结算链路；平台结算金额不得描述为 Provider 实际账单。

计费语义纠正：上游实际 Token 用量用于计量，Admin 版本化 micro-USD 价格用于面向平台调用方结算。OpenAI API 美元价或 models.dev 数据可被管理员采用为参考价；Codex included usage 没有逐请求美元成本，不做 credit→USD 换算，也不因此把模型标记为未就绪。

审计字段保留为可选三元组：`source_ref`、`source_version` 与 `source_metadata.imagePricingBasis` 要么同时提供，要么全部省略；提供时校验其标签与 Provider 相容，避免把参考价误写为上游实际收费。该校验不参与 runtime readiness，不新增 migration、价格表或控制通道。

实施顺序调整为：schema/migration/capability → billing/settlement → scope/provider contracts → Images routes/transports → Admin views/safe payload → deterministic/isolated validation → 条件满足时真实模型验收。独立评审结论与修订见 `docs/verification/image-model-center-design-review.md`。Sync 2026-10-09.

## 当前执行状态

| 门禁 | 当前证据 | 状态 |
| --- | --- | --- |
| 调研与最小方案 | `docs/verification/image-model-center-investigation.md` | 完成 |
| 现行 PRD 与正式设计 | `docs/prd/image-model-center/README.md`、`docs/design/image-model-center.md` | 完成 |
| 独立评审与修订 | `docs/verification/image-model-center-design-review.md`；本轮实际稿/源码最终复审通过，残余P0/P1为0，P2文档行号/图数量已校正，无过度设计 | 完成 |
| 实现与确定性验证 | 独立Image中心、两条Images route、Admin/Provider/Billing/schema；最新Luna：typecheck/lint exit0、4files/33focused、312passed/18skipped files与2302passed/37skipped tests、独立build exit0、隔离Chrome `1 passed (53.9s)` | 完成 |
| 正常数据库与配置发布 | `0078` 后 `79/79 current`；Codex Image 模型/价格和 Free v7 五项权益已发布 | 完成 |
| 真实 Codex generation/edit | 本轮00:26正常账户/已有模型/订阅各一次HTTP200；实际usage531/2066、平台基础金额7765/13884microUSD、Token capture531/2066、release119521/122792；新中心公开Admin已核对，两请求payload为0 | 完成；不替代新页面隔离E2E |
| 真实 OpenAI generation/edit | 没有官方 OpenAI Image Provider/服务器侧凭据；现有同名 Provider 实际指向腾讯服务，禁止挪用 | 缺外部前置 |
| 文档、归档与清理 | 当前28个Markdown/81本地引用missing0、两份完整历史归档存在、diff检查0；本轮自有PG/端口/进程/dist清理，正常服务/真实记录保留 | 完成 |

Goal 已于 2026-10-10 恢复执行。先前把 Codex 上游价格合同和 credit→USD 换算当作 Admin 平台结算前置，属于错误建模，现已撤销。官方 OpenAI Provider/凭据仍只影响 OpenAI 真实模型验收，不影响 Codex 运行、平台计费或 Codex 真实验收。隔离 fake OpenAI 只作为技术合同证据，不能替代真实 OpenAI 结果。
