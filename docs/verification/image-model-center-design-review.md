<!-- [Input] Image Model Center PRD/design draft, source investigation, and an independent source-backed review. -->
<!-- [Output] Review findings, required corrections, over-design judgment, and implementation gate. -->
<!-- [Pos] Independent design-review receipt; it is not implementation or test evidence. -->
<!-- [Sync] 2026-10-09: record two blocking settlement/reservation defects and the corrected minimum direction. -->
<!-- [Sync] 2026-10-09: record the post-implementation frozen-contract correction found by full regression. -->
<!-- [Sync] 2026-10-09: record the independent completion audit and the source-gated billing correction. -->
<!-- [Sync] 2026-10-09: turn the OpenAI/Codex billing distinction into a server-side invariant. -->
<!-- [Sync] 2026-10-10: correct the review so platform pricing is authoritative and source provenance is optional. -->
<!-- [Sync] 2026-10-10: close the shared pricing-sync incremental review with fresh regression and viewport receipts. -->
# Image 模型中心独立设计评审

## 2026-10-10 Provider 简化与 models.dev 同步增量复审

本轮实际稿及实现独立复审发现价格窗口校验缺失（P0）与相反模型顺序Apply死锁风险（P1）。主执行者复用普通管理写入原函数，抽取 `pricing-windows.ts`，补完整窗口冲突、重复开放版本拒绝和稳定ID锁顺序；补充真实隔离公开Apply与并发屏障回归。审核恢复按钮、空快照复用和未配置输入来源标签三项P2也已修订。最终源码复审与新自动化回执已分别闭合，详见[本次增量记录](image-model-center-pricing-sync-20261010.md)。下文为上轮独立中心交付，不用上轮回执替代新同步增量。

修订后独立源码/设计/测试方案复核通过：没有残余P0/P1/P2，未发现过度设计；源码行号和同快照重复Apply/已应用审核恢复两项证据补齐。测试夹具按生产DTO定义，而不是在Node中导入整套认证模块；生产匹配单测、正常目录发现、真实公开Apply分别证明各边界，不复制业务算法。修订后35/35 focused、2314完整 tests、build、最终tsc/lint均exit0；全新具名隔离Chrome完整流程1passed/53.2s，1440×1000与390×844截图已实际查看，窄屏footer/Apply与无溢出断言通过。这些是技术验证，不是新增真实模型验收。

## 2026-10-10 独立中心复审与修订

基于实际重写稿和源码独立复审，确认 AI/Image 为并列导航，均有 Provider/Models/Pricing；请求记录为辅助入口，不存在第二套资源、权限、账本、表、队列或环境分支。专用 Image parser/transport 与完整图片解码是协议与安全需要，不属过度设计。

| 问题 | 修订 | 验证要求 |
| --- | --- | --- |
| Image 页原来嵌套在 AI 中心且多一层导航 | 独立 `/admin/image-models/**`；三栏和全页表单回链一致，旧 URL 重定向 | Chrome 桌面/窄屏、新增/保存/返回、AI三栏回归 |
| 价格表单隐藏 money 控件后提交字符串而非整数，实际400 | 只隐藏展示 section，保留 money/number 原序列化 | 当前 unit + E2E 价格201，不能用旧结果 |
| nullable 图片价格被写成0 | null显示为空，空串提交null，显式0保留整数0 | null/0双向unit、generation-only页面保存 |
| Image Provider 仍可选择 Anthropic或删除marker | 只提供Codex/OpenAI，OpenAI协议固定；marker不显示于JSON并在共享表单规范化时保留 | 手工generic与preset公开Admin写入、列表可见 |
| 隐藏非Image能力可能丢失共享文本配置 | 只隐藏checkbox展示，不缩减完整序列化选项；保留原text能力和数字字段 | 混合能力/非可见数字回归 |
| 真实Gateway回执与页面验收混在一起 | 本轮00:26正常Codex调用发生于页面修正前；之后公开Admin核对相同请求/快照/ledger；新页面E2E单独重跑 | 不宣称历史记录或HTTP200代表完整验收 |

复审最初将00:26的两条新真实请求误识别为历史基线，已由浏览器调用时间、公共Admin返回与三项Token账本事实纠正。真实Gateway验收不等于独立页面验收；当前两类证据已分别闭合。

最终只读独立复审通过：没有残余P0/P1。上述四项表单/Provider问题有当前源码、33/33 focused和全新fixture E2E回执支持；typecheck/lint/build全部exit0，全量2302passed/37skipped，完整Chrome流程1passed（53.9s）。两处非阻断文档问题（预算字段行号、状态图数量）已校正。正常Codex两次200/settled、实际usage、平台价格快照、Token reserve/capture/release、零payload与公开Admin可见记录单列；页面修正后协议/计费代码没有变化，不要求重复实际模型调用。真实OpenAI明确未验收，不将fake结果替代。最终过度设计判断：无；可关闭符合当前目标完成条件的Codex目标。

既有0078已应用，不改写。正常库只读复核共有19432条Gateway请求，其中19428条在迁移前已经存在，operation无缺失；这是兼容历史请求类型的固定回填，不是搬迁正文或重建账本。原发布已有custom备份和79/79回执；原迁移锁持有时长未保存，标记为未测，不补造测量或再次运行DDL。后续大规模回填须用显式data runner。

## 1. 结论

首轮评审不通过，必须先修正文档再实现。整体方向正确：复用现有模型中心、Provider、权限、请求事实和账本，不需要 Image 业务表、独立账本、队列、环境分支或 Gateway 重构；Image 专用 transport 是 OpenAI multipart 与 Codex JSON 的真实协议差异导致的必要边界。

修订后评审通过并进入实现。实现后的完整回归又发现一项合同兼容性问题：若 `images:create` 直接进入所有共享 delegation 输出 DTO，会改变三个已登记 Dream operation 的 schema/hash。最终修订把通用 runtime delegation 与冻结 Dream operation 的嵌套输出分离，并保持历史 claim-turn/task-result 自动授权范围不变；完整回归确认既有合同恢复。

实现完成后又进行一次独立源码与交互完成度复核。复核确认不需要新增业务表、控制通道或 Gateway 重构。其后发现评审错误地把 Codex 上游合同证据当作平台结算门槛；该结论已撤销：Admin 自有价格版本决定平台结算，上游资料只作可选参考。

## 1.1 实现后复核修订

| 问题 | 风险 | 修订结果 |
| --- | --- | --- |
| 共享 `delegationOutputDto` 扩展导致 Story claim-turn、task-result claim/claim-next 的冻结合同变化 | 既有 Dream consumer 可能因 schema/hash 漂移而拒绝能力 | 新增专供冻结 Dream operation 的旧 scope 输出 DTO；通用 delegation 继续支持显式 `images:create` |
| task-result claim 自动加入 `images:create` | 未经业务请求静默扩大已有后台流程权限 | 自动授权恢复为三项原 scope；只有通用 create 可显式申请 Image scope |
| 单元夹具没有携带新 Image 价格快照/operation | 完整回归在进入目标断言前失败 | 补齐真实查询列的 null/default 夹具，不放宽生产端 fail-closed 解析 |

## 1.2 独立完成度复核

| 发现 | 级别 | 修订结果 |
| --- | --- | --- |
| Image 已知 usage 的失败路径没有始终要求完整 Token capture | P0 | lifecycle 透传 `requireFullTokenAllowanceCapture`；空图、错误结果和带 usage 的非 2xx 都不得部分扣除后结束 |
| OpenAI Official 预设没有写 Image marker，Image readiness 复用了文本 Provider 判断 | P1 | 预设写 `config.imageApi.kind=openai`；Admin 分别投影 Image Provider、reservation、pricing、`images:create` entitlement readiness |
| dispatch 前 abort 可能仍调用上游；dispatch 后 5xx usage 会丢失 | P1 | transport 增加 dispatch fence/即时 abort；非 2xx 只解析严格可信 usage 并进入已知用量结算 |
| 图片只查 magic bytes，截断或伪造数据可通过；generation JSON 与上游响应可无界缓冲 | P1 | 输入/输出在字节上限与像素上限内由 `sharp` 完整解码，拒绝 animated/malformed；JSON、multipart、Provider response 均按实际 stream bytes 限制 |
| Provider 返回字段直接 passthrough，可能把未审阅字段带给调用方 | P2 | 响应 DTO 改为 allowlist，只返回既定 image/result/usage 字段 |
| 费用未知的 Image 请求在全局使用报表中显示为 `$0` | P1 | SQL 聚合排除未知成本并返回 unknown count；列表/详情显示“未知”，不伪造零值 |
| Provider/时间筛选和 Provider readiness 入口不完整 | P2 | Image 请求记录增加 Provider、起止时间筛选；Image 页增加现有 Provider 资源的 readiness 摘要与跳转 |
| 原评审把 Codex 上游合同、credit→USD 和来源证据误作平台结算前置 | P1 | 撤销运行时来源门槛；runtime 只要求数值 reservation budget 与有效 Admin 平台分项价格，Codex included usage 不换算美元 |
| 参考来源可能被误标为真实上游收费 | P2 | 在既有 `source_metadata` 保存可选 `imagePricingBasis`；与 ref/version 一起填写时校验 Provider 相容，只影响审计标签，不参与 readiness 或 Resolver |
| conservative recovery 写 `settled_at` 后仍显示 `settlement_failed`，已知失败缺 usage marker | P1 | recovery 完成后持久状态转为 `settled` 且保持 `usageKnown=false`；所有已知 usage 失败保存 `usageKnown=true` |
| OpenAI Provider 表单把“无用量查询”提交为空字符串 | P2 | 复用现有 `none` 枚举默认，未增加新的配置分支 |

本轮修订没有增加 Image 表、独立账本、后台队列、自动 Provider 切换、环境分支或通用 Secret 编辑器。新增 `sharp` 仅用于完整图片解码校验，来源字段复用已有 JSON/source 列，因此仍属于实现安全与审计合同所需的最小范围。

## 2. P0 与修订

| 问题 | 源码证据 | 修订结果 |
| --- | --- | --- |
| Image `settlement_failed` 不能把 reservation 写成实际图片用量 | `app/lib/gateway/settlement-worker.ts` 的 candidate/保守 capture；`app/lib/gateway/lifecycle.ts` 的已知 usage 失败没有持久化 usage | 设计改为：Image usage known 时先持久化四类 usage 与安全摘要，再由专用幂等路径按实际 usage 恢复；Image usage unknown 在可信全上界 reservation 建立后沿用 grace worker 关闭冻结，但只消费 Token allowance，保持 usage/provider cost 未知，不把 reservation 写成实际明细 |
| 原预留忽略参考图 Token、`n` 和真实额度不足行为，不是可保护额度的上界 | `app/lib/subscriptions/gateway.ts` 的结算会取当前可用量最小值；现有 `max_output_tokens` 是文本输出字段 | 设计增加模型级、可审计的每图输入/输出 Token reservation policy；预留为 prompt + 输入图片数 × input budget + n × output budget；Image 要求完整 Token allowance capture，不足则事务失败并扣留图片 |

## 3. P1 与修订

| 问题 | 修订结果 |
| --- | --- |
| `generic + openai` 不能证明是 OpenAI official | 使用现有 Provider `config.imageApi.kind=openai` 显式标记，OpenAI preset 写入；服务端和每个 routing candidate 严格校验，不靠名称/code/hostname猜测 |
| Codex contract 只有精确 Responses URL，不能裁剪成 Image base | Provider registry 增加 owned generations/edits endpoint 与 headers；默认值和部署 override 都由 Codex config 管理 |
| `images:create` 影响面遗漏 | 正式设计列出 auth scopes、key rotation、delegation DTO/service、Subscription、Product query/service/repository 和 UI |
| `/v1/models` 固定文本 entitlement，Image-only 发现会污染 callable/default | 保留现有文本 callable/default；增加 endpoint capability/availability，不让 Image-only 成为文本默认模型 |
| 仅隐藏 payload 按钮不是安全边界 | request 建立时写 policy-disabled；Admin payload API 服务端按 operation 拒绝，并加直接 API 回归 |
| OpenAI output token details 可选 | input details 仍必需；output details 缺失时按官方直接 Images 语义归一为 image output，存在时严格校验 |
| migration 未落实阶段协议 | 正式设计拆成 expand → compatibility → backfill → validate → contract/capability，并说明 rolling compatibility |
| 状态图混合模型与请求 | 当前稿以独立页面/模型派生状态图说明交互，另由异常恢复时序说明Gateway失败与结算；不虚构新增数据库状态，满足三类Mermaid要求 |

## 4. P2 与修订

- generation-only 模型只要求 output Image 价；edit 模型要求 input/output Image 价。任何实际出现而未配置的类别仍 fail closed。
- 统一 Image request policy 同时限制上传、`n` 和完整 JSON/base64 响应内存；限制是服务器资源保护，不作为产品权益。
- multipart 上传在 magic bytes/MIME 校验后使用中性服务端文件名，不转发用户原文件名。
- PRD 的 revision 改为各自真实所有权：价格版本、Provider auth revision、routing revision 和模型审计，不宣称 capability 已版本化。
- Direct Images 的 output text 必须为零；可选 output details 缺失时只把 output total 归为图片输出，不套用文本 output 价格。

## 5. 实施门禁

修订后的正式设计必须再次对照本表，无未处理 P0/P1 才能进入实现。实现后仍需由确定性测试、隔离 PostgreSQL 和浏览器 E2E 证明这些修订实际落地；本评审本身不构成验证通过。
