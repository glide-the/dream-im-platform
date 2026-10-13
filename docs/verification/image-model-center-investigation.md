<!-- [Input] Current Admin/Gateway/Billing source, official OpenAI Images documentation, and the local Codex source tree. -->
<!-- [Output] Evidence-tagged Image Model Center investigation and the minimum treatment decision. -->
<!-- [Pos] Pre-implementation evidence for the Image Model Center PRD and formal design; not an implementation or production-acceptance receipt. -->
<!-- [Sync] 2026-10-09: distinguish implemented source, source-backed inference, proposed work, and unverified runtime behavior. -->
<!-- [Sync] 2026-10-09: point pricing evidence at the current official OpenAI developer pricing page. -->
<!-- [Sync] 2026-10-09: append real Codex runtime evidence without rewriting the frozen pre-implementation baseline. -->
<!-- [Sync] 2026-10-09: separate historical Codex transport/usage proof from unverified billing-source evidence. -->
<!-- [Sync] 2026-10-09: require structured evidence that distinguishes API USD from managed USD contracts. -->
<!-- [Sync] 2026-10-09: record why official Image estimates and Codex auto parameters are not auditable reservation upper bounds. -->
<!-- [Sync] 2026-10-10: distinguish Admin platform settlement price from optional upstream price references. -->
# Image 模型中心源码调查与处理判断

> 2026-10-10 当前决策更新：Image 中心为与 AI 中心并列的独立管理入口 `/admin/image-models`，内部 Provider/Models/Pricing 三栏。早期调查中的 `/admin/models/images` 是形成方案时的基线建议，现已由兼容重定向替代；该基线不再代表现行页面归属。资源、权限与账本仍共享。

> 时点说明：本文表格冻结的是实施前调查基线，因此“建议、未实现”只表示当时尚未落地；当前实现状态以[正式设计](../design/image-model-center.md)和最终实现验证回执为准，不据此把建议冒充为调查时已经存在的源码。

## 1. 调查结论

本次应扩展现有 AI 模型中心和 Gateway 生命周期，不应另建 Image 管理系统、独立账本或图片资产库。现有 Provider、稳定模型 alias、RBAC、Gateway Key、Subscription、请求幂等、预留/结算和 append-only ledger 可以直接复用；缺口集中在 Image 能力声明、两条独立公开路由、OpenAI/Codex 两种上游报文、图片 Token 价格、图片用量明细和无正文请求记录。

公开 OpenAI Images API 与 Codex 后台 Images 路由的路径后缀和成功结果接近，但编辑输入与认证合同不同：公开 OpenAI 编辑使用 multipart；Codex 当前源码使用 JSON `images` 引用并复用 ChatGPT/Codex managed account 认证。实现必须分开适配，不能因名称相同而直接共用 Chat/Responses 转换链路。

## 2. 证据状态定义

| 状态 | 含义 |
| --- | --- |
| 源码已实现 | 当前仓库或本机 Codex 源码存在可定位的实现；不代表外部生产环境已验收 |
| 合理推断 | 多项源码共同支持，但未用真实账户抓取线上请求确认 |
| 建议、未实现 | 本设计要求新增或修改，当前源码尚不存在 |
| 尚未验证 | 需要真实 Provider、账户或正常业务入口才能确认 |

## 3. Admin 模型中心

| 判断 | 状态 | 证据 |
| --- | --- | --- |
| 模型中心现有顶层栏目只有 Provider、Models、Pricing，适合增加同级 Images 入口 | 源码已实现 | `app/components/admin/AdminModulePage.tsx` 的 `modelTabs`（38–42） |
| 模型卡已复用 Refine list、Provider/状态筛选、RBAC、配置验证、价格和用量跳转 | 源码已实现 | `app/components/admin/AIModelRegistry.tsx` 的 `AIModelRegistry`（40–68、88–136） |
| 能力标签目前没有生成/编辑，只识别 chat、streaming、tools、vision、json | 源码已实现 | `app/components/admin/AIModelRegistry.tsx` 的 `capabilityLabels`（26–38） |
| Model 的 `capabilities` 已是布尔映射，不需新增 Image 模型表 | 源码已实现 | `app/lib/admin/mutations.ts` 的模型写入 schema（220 附近）；`packages/db/src/schema/index.ts` 的 `aiModels.capabilities`（870 附近） |
| Image 页面应复用模型列表、模型编辑页、价格版本和请求表，只加 Image 过滤/展示 | 建议、未实现 | 当前不存在 `/admin/models/images`；新增独立表会重复现有 alias、Provider 和 RBAC 事实 |

## 4. Provider、模型选择与路由

| 判断 | 状态 | 证据 |
| --- | --- | --- |
| Provider 已保存 protocol、adapter、base URL、凭据及可用状态；Model 保存稳定 alias、upstream model、能力和启停状态 | 源码已实现 | `packages/db/src/schema/index.ts` 的 `aiProviders`（403–515）与 `aiModels`（870 附近） |
| 现有 Codex provider 能取得 managed account 的 Bearer、Account ID、originator 等资源头 | 源码已实现 | `app/lib/providers/codex.ts` 的 `getResourceContract`（426–464） |
| 当前 Provider resource contract 只覆盖 Responses/Chat，尚无 Images 资源 | 源码已实现 | `app/lib/providers/types.ts` 的 `ProviderResourceContract`；`app/lib/providers/config.ts` 默认 Responses 资源（134–145） |
| 通用 transport 固定拼接 `messages` 或 `chat/completions` 且 JSON 序列化，不能正确发送 OpenAI multipart 编辑 | 源码已实现 | `app/lib/gateway/provider-transport.ts` 的 `endpoint`（63–75）和 `sendProviderRequest`（100 起） |
| Image 解析必须要求 `image_generation` 或 `image_edit` 能力，并只允许 OpenAI generic 与 Codex adapter | 建议、未实现 | 当前 resolver 没有 Image 能力约束；任务边界明确只接 OpenAI、Codex |
| Image 首版不使用同 alias 自动 failover；未知结果不得换 Provider 重发 | 建议、未实现 | 图片结果可能已产生并计费，现有请求幂等只保护进入 Gateway 的重复请求，不能证明上游未执行 |

## 5. Gateway、认证与请求记录

| 判断 | 状态 | 证据 |
| --- | --- | --- |
| 现有公开入口覆盖 Messages、count_tokens、Chat 和 Models，不含 Images | 源码已实现 | `app/v1/**` 目录和 `docs/prd/modules/05-gateway.md` 的现行协议 |
| 请求准备已经串联认证、模型/价格解析、Token 估算、Allowance 预留和 payload 捕获 | 源码已实现 | `app/lib/gateway/prepare.ts` 的 `prepareGatewayRequest`（66–185） |
| `beginGatewayRequest` 已处理幂等冲突、请求/价格快照、Entitlement、限流和预留 | 源码已实现 | `app/lib/gateway/repository.ts` 的 `beginGatewayRequest`（197–461），其中快照写入 241–286、权益 292–345、限流/预留 348–459 |
| Gateway Key、Subscription Entitlement、Product 查询和 Runtime delegation 的 scope 集合均没有 `images:create` | 源码已实现 | `app/lib/subscriptions/contracts.ts`（44–57）、`app/lib/product/contracts.ts`（32–35）、`app/lib/auth/delegationDto.ts`（7–15）、`packages/db/src/schema/auth.ts`（145–149） |
| Image 请求不能写入通用 payload 表，否则会保存 prompt、参考图或 base64 结果 | 建议、未实现 | `gateway_request_payloads`/响应 payload 是完整报文存储；`GatewayRequestDetail` 当前允许二次确认后展示完整报文（`app/components/admin/GatewayRequestDetail.tsx` 91–126） |
| 请求摘要需增加 operation、图片 Token 明细、输出数量/格式和安全错误，且 Image 详情固定显示“按策略未捕获正文” | 建议、未实现 | 当前 `gateway_requests` 只有聚合 Token/文本价格快照，`app/lib/admin/resources.ts` 的 gateway request resource（372–418）也未投影 Image 字段 |

## 6. 计费与幂等

| 判断 | 状态 | 证据 |
| --- | --- | --- |
| 现有价格是 versioned micro-USD / million tokens，保存四类文本/cache Token 单价 | 源码已实现 | `packages/db/src/schema/index.ts` 的 `aiPricingRules`（952 起）；`app/lib/billing/types.ts` 的 `PricingSnapshot`（15–22） |
| 现有费用公式使用整数向上取整，并应用 markup/discount | 源码已实现 | `app/lib/billing/money.ts` 的 `tokenComponent`（28–38）和 `calculateCharge`（78–135） |
| 现有 `TokenUsage` 只有 input/output/cache 聚合，无法按 OpenAI 图片文本输入、图片输入、图片输出分别计价 | 源码已实现 | `app/lib/billing/types.ts` 的 `TokenUsage`（5–13） |
| Image 价格应新增 image-input 与 image-output 单价；文本 prompt 继续使用 input 单价；直接 Images 不使用 cache 价 | 建议、未实现 | OpenAI 官方 Image API 用量提供 input 文本/图片明细与 output 图片明细；不得虚构按张价格或把总量全部套用文本价格 |
| 上游用量或必需明细缺失时进入 `settlement_failed`，不能按零成功结算或返回未结算图片 | 建议、未实现 | 现有 Gateway 已将未知 usage 当结算失败；Image 必须保持相同 fail-closed 原则 |
| 同一 idempotency key 不应再次调用上游 | 源码已实现，可复用 | `beginGatewayRequest` 的幂等锁与终态冲突；当前产品映射为 409，不缓存或重放大体积响应 |

## 7. OpenAI Image API 核实

来源为 OpenAI 官方 [Image generation guide](https://developers.openai.com/api/docs/guides/image-generation)、[Images API reference](https://developers.openai.com/api/reference/resources/images) 和 [API pricing](https://developers.openai.com/api/docs/pricing)。

| 项目 | 核实结果 | 状态 |
| --- | --- | --- |
| 生成 URL/认证 | `POST https://api.openai.com/v1/images/generations`，Bearer；JSON 请求 | 官方资料已核实，真实账户尚未验证 |
| 编辑 URL/认证 | `POST https://api.openai.com/v1/images/edits`，Bearer；multipart，`image`/`image[]`，可选 `mask` | 官方资料已核实，真实账户尚未验证 |
| 结果 | GPT Image 默认在 `data[].b64_json` 返回完整图片；响应还可含 created、background、quality、size、format | 官方资料已核实，真实账户尚未验证 |
| 用量 | `input_tokens`、`input_tokens_details.image_tokens/text_tokens`、`output_tokens`、`output_tokens_details.image_tokens/text_tokens`、`total_tokens` | 官方资料已核实，真实账户尚未验证 |
| 计价 | `gpt-image-2` 当前公开 API 标准价格为文本输入 `$2.50/M`、图片输入 `$4/M`、图片输出 `$15/M` Token；直接 Images API 不应用 Responses 图像工具的 cached-input 折扣，也不能仅按图片张数计费 | OpenAI 官方 pricing 与 Image guide 于 2026-10-09 复核；价格来源版本必须保存检索日期或 Provider 发布版本 |
| 预估边界 | 官方 guide 说明图像 Token 会随模型、质量和尺寸变化，且 `auto` 的结果由实际生成内容决定；官方计算器要求选择显式尺寸/质量并只给估算值，不承诺 managed Codex 的逐请求 Token 上界 | 官方资料已核实；不能把估算器结果硬编码为 allowance reservation 上界 |
| 产品定位 | Image API 适合单次生成/编辑；Responses 的图像工具适合对话式多步流程，两者可并存 | 官方资料已核实 |

## 8. Codex Images 源码核实

Codex managed account 的计费来源还包括 OpenAI 官方 [ChatGPT Work / Codex pricing](https://learn.chatgpt.com/docs/pricing)。该页面明确区分 subscription/credits 与 API Key：前者按 plan usage/credits，后者才应用 API pricing。

调研后的实现判断：`source_ref/source_version/source_metadata.imagePricingBasis` 只提供可选审计线索，不决定 Admin 平台价格是否生效。三项全部提供时，服务端校验标签与 Provider 相容；全部省略时使用平台手工价。该审计合同复用既有 JSONB，不需要 schema migration。

| 项目 | 核实结果 | 状态与证据 |
| --- | --- | --- |
| 生成输入 | JSON `{prompt, model, background?, n?, quality?, size?}` | 源码已实现：`/Users/dmeck/project/codex/codex-rs/codex-api/src/images.rs` 的 `ImageGenerationRequest`（5–17） |
| 编辑输入 | JSON `{images:[ImageReference], prompt, model, background?, n?, quality?, size?}`；当前类型无 mask | 源码已实现：同文件 `ImageEditRequest`（19–32） |
| 路径 | 活动 Provider base 下的 `images/generations` 与 `images/edits` | 源码已实现：`codex-api/src/endpoint/images.rs` 的 `generate`/`edit`（62–83） |
| 生产 base | Codex 默认 base 常量是 `https://chatgpt.com/backend-api/codex`，因此默认完整路径推断为该 base 下两条 Images 路径 | 合理推断：`codex-rs/model-provider-info/src/lib.rs` 的 `CHATGPT_CODEX_BASE_URL`（77–81）及 backend 动态取 active provider（`ext/image-generation/src/backend.rs` 78–96）；未抓取真实流量 |
| 测试地址不是生产证据 | `https://example.com/api/codex` 仅是 endpoint 单测的可配置 Provider base | 源码已实现：`codex-api/src/endpoint/images.rs`（181–195、278–292、365–377） |
| 认证 | 复用 active provider auth；managed account 使用 Bearer、ChatGPT Account ID，客户端还带 originator/User-Agent；Image 增加 turn header | 源码已实现：`ext/image-generation/src/backend.rs`（78–139）、`model-provider/src/auth.rs`（306–324）、`login/src/auth/default_client.rs`（456–468） |
| 成功结果 | `data[].b64_json`、可选 `generation_id`、created/background/quality/size；endpoint 读取 `x-codex-imagegen-request-id` | 源码已实现：`codex-api/src/images.rs`（51–68）、`codex-api/src/endpoint/images.rs`（17、101–115） |
| 用量 | 测试 fixture 含与 OpenAI 相同的文本/图片 Token 明细，但 Rust `ImageResponse` 当前忽略 usage | 源码已实现：fixture 在 `codex-api/src/endpoint/images.rs`（198–219），类型在 `images.rs`（51–68） |
| 请求质量与尺寸 | 本机 Codex image-generation extension 对 generation 和 edit 都显式发送 `quality: auto`、`size: auto` | 源码已实现：`/Users/dmeck/project/codex/codex-rs/ext/image-generation/src/tool.rs`（432–439、475–483）；实际 Token 预算不能从固定尺寸/质量表反推 |
| 价格与预留预算 | 官方 Codex Standard rate 对 GPT-Image-2 公布为 text input `125` credits/M、image input `200` credits/M、image output `750` credits/M；included usage 不提供逐请求美元成本。Codex Image endpoint、DTO、extension 与 app-server 测试也没有 monetary price 或固定每图 Token 上界；extension 使用 `auto` 质量/尺寸。Admin 因此独立配置平台 micro-USD 结算价和并发保护 budget，可参考 OpenAI API、models.dev 或内部定价，但不得把平台金额称作 Codex 上游实际扣款，也不得把 budget 当作实际 usage | 2026-10-09 官方 Codex pricing、Image guide 与本机 `codex-api/src/endpoint/images.rs`、`ext/image-generation/**`、`app-server/tests/suite/v2/imagegen_extension.rs` 只读复核；2026-10-10 按 Admin 自有账单语义修正结论 |
| mask | 当前 Codex 编辑 DTO 不支持 mask；Gateway 必须明确拒绝，不能静默丢弃 | 源码已实现的限制；真实后台是否另有未公开能力尚未验证 |

## 9. 最小改动范围

### 直接复用

- Provider 配置、加密凭据、managed Codex account 与连接状态。
- Model alias、启停、用户模型权限、Subscription Entitlement 和 Gateway Key。
- Pricing revision、生效窗口、价格快照、micro-USD 算术和 append-only ledger。
- Gateway request id、幂等锁、资格检查、预留、结算、失败释放和 Admin 请求查询。
- Refine 管理布局、列表/表单、RBAC、审计和窄屏样式。

### 必须补充

- `image_generation`、`image_edit` 模型能力和 `images:create` scope。
- 显式 OpenAI Image provider marker、Codex registry-owned Image endpoints，以及模型级输入/输出每图 reservation policy。
- Image 中心入口与按模型/价格/请求的业务视图。
- 严格的 generation JSON 与 edit multipart 入口、两个 Provider adapter。
- 图片 Token 明细、图片输入/输出价格、请求 operation 和安全摘要的前向 migration/capability。
- Image 专用 prepare/transport/usage parser；复用生命周期但禁止 payload capture。
- Image usage known 的幂等结算恢复与 unknown usage 的保守 worker 排除，禁止用 reservation 冒充实际上游用量。
- 成功、失败、幂等、取消、usage 缺失和文本回归测试。

### 明确不做

- 不改 Claude Code 主循环，不把 Image 请求转成 Messages/Chat/Responses。
- 不增加其他 Provider、图片资产库、创作画布、异步后台任务、自动双接口切换或第二套账本。
- 不引入按张虚构费用、运行时 DDL、SQLite/JSON/in-memory 回退或部署环境分支。

## 10. 尚未验证

- 本机真实 Codex managed account 是否已获 Image entitlement、真实 base 是否被配置覆盖、生产响应是否始终提供完整 usage。
- 指定 OpenAI API key 对所选图像模型的权限、真实 edit multipart 限制与响应字段。
- 正常 Admin 当前账户、已有模型实体和真实账本中的端到端生成/编辑结果。

这些项目只能在用户指定真实账户、已有业务实体和正常入口后验收；隔离 fake Provider 或单元测试不得替代。

> 后续验收更新（2026-10-09）：现有真实 Codex managed account 曾通过正常 Gateway 各完成一次 generation/edit，返回完整四类 usage，并在正常数据库形成 settled request、按 Admin 手工价格快照计算的平台金额、Token allowance reserve/capture/release 和无 payload Admin 详情；这闭合了真实 transport、usage 与平台结算验证。平台金额不代表 Codex 上游逐请求账单。官方 OpenAI Provider/服务器侧凭据仍不存在，因此 OpenAI runtime 项继续保持未验证。精确 request/usage/费用边界见[实现与验证回执](image-model-center-implementation.md)。

> 计费语义修正（2026-10-10）：只读查询中的 `imageReservationSource=0` 和 `provider_contract=0` 只是审计元数据缺失，不是 Codex readiness 门禁。Codex included plan 没有逐请求美元成本，也无需 credit→USD；Admin 继续按自己的有效价格版本和上游实际 usage 结算。官方 OpenAI Provider/凭据为 `0/0` 只影响 OpenAI 真实验收。

> 预留依据复核（2026-10-10）：官方 Image guide 把尺寸/质量对应 Token 表述为估算，本机 Codex generation/edit 使用 `quality:auto`、`size:auto`。这些事实适合作为管理员配置 reservation budget 的参考，而不是实际 usage。`imageReservationSource` 可以留空；完整 allowance capture 与实际上游 usage 仍是结算边界。
