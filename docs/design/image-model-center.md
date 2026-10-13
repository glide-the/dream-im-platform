<!-- [Sync] 2026-10-12: round30 官方报告用量修订、六项真实图片结算与重开、独立复核修订和精确发布回执；历史及未验收范围保留。 -->
<!-- [Sync] 2026-10-11: round29 两条正常本机图片链路、展示稳定及历史恢复实际通过；unknown usage、原路由与技术故障验证边界单列。 -->
<!-- [Sync] 2026-10-10: 同步Dream模型用途、公开能力与历史索引；本轮验证见专项执行记录。 -->
<!-- [Sync] 2026-10-10: IM conversation preserves image input on the existing text protocol adapters; Images execution remains independent. -->
<!-- [Input] Image 模型中心任务目标、当前源码、独立评审和本轮验收事实。 -->
<!-- [Output] 独立 Image 模型中心的产品交互与技术设计。 -->
<!-- [Pos] 现行正式设计；历史原文与执行回执分开保存。 -->
<!-- [Sync] 2026-10-10: 按任务目标修正独立中心归属、平台定价和完整成功/恢复合同。 -->
<!-- [Sync] 2026-10-10: 移除 Provider 额外摘要，复用 models.dev 快照、审核与平台价格版本。 -->
<!-- [Sync] 2026-10-10: 闭合共享价格同步评审修订及当前隔离回执，不扩张真实模型验收结论。 -->
<!-- [Sync] 2026-10-10: Image 中心仅管理配置，日志与账单回归已有业务模块。 -->
<!-- [Sync] 2026-10-10: 复审修正UTC日期与刷新状态，闭合实际E2E发现的既有报表边界。 -->
# Image 模型中心正式设计

> Dream 模型分工修订前完整原文见[历史稿](image-model-center.history-20261010-dream-model-division.md)。设置、正常与异常业务图以[Dream专项正式稿](/Users/dmeck/project/ink-dream-memory/docs/design/claude-agent/image-model-call-division.md)为准；本节只同步 Admin 公开事实和职责。

## Dream 模型目录和选择增量（2026-10-10）

`capabilities.image_generation/image_edit`继续对应独立 Images 接口。`models.ts`在既有`endpoint_availability.images`之外追加`responses_image`，均包含generation/edit/configured/entitled/callable；后者取独立responses_image_generation/responses_image_edit发布能力，配置按明确Responses、chat/tools、预算、精确image-turn合同及实际角色权限判断，资格使用现有Messages资格。不能把勾选、Provider身份或型号名称当作CLI已经支持内置工具的证据。专项native分支严格接收实际图片终态，原普通Responses分支遇到未声明图片结果仍明确拒绝，不静默丢图。

`modelSupportsConversation`统一目录与`resolveBillableModel`的主对话准入：原文字模型保持兼容；有Images能力的模型只有明确声明chat才进入主对话。新Image表单默认chat:false，旧图片表单未声明chat也不进入AI列表或默认值。独立Images仍按对应操作能力、Provider、价格、预算和Images资格判定，不改变账本与预留算法。

复用`user_preferences.system_config_json`保存独立`image_model`。追加严格`user-system-config.patch-image-model`到既有operation尾部，原AI十字段patch和全部旧descriptor/hash顺序不变。OAuth actor、行锁合并、JSON数字及未知键保留、原写receipt沿用原模块；未知提交只能按这个新操作的原request_id读取receipt，不重发POST、不用旧AI操作冒充回执。缺新操作capability时Dream停止保存，没有本地存储或数据库回退。

Images正常响应的`x-request-id`是实际Gateway请求身份，Dream另存为gatewayRequestId，与CLI toolCallId、broker requestId和幂等标识分开。旧v1工具结果允许缺新字段以恢复历史；新执行缺少符合createPlatformId("req")合同的身份即报错，不发布文件或自动重发。图片正文与凭证仍不进入Admin通用payload日志。

发布时先让Dream接受旧/新目录结构，再让Admin公开新字段；原Dream严格解析器不支持新字段时不能倒置顺序。本轮实现与隔离技术回执见[专项执行记录](/Users/dmeck/project/ink-dream-memory/docs/exec/image-model-call-division-20261010.md)。接入阶段历史：当时主对话内置图片协议与原文件/历史桥接已实现，正常代码及精确合同已受控采用，但指定账户真实图片模型验收尚未完成。当前round30六项正向实际结果与已报告Token结算见本文末节；完整上游图片费用及旧三条缺失分项仍未确认。

> 现行范围：独立 Image 模型中心，内部为 Provider、Models、Pricing 三栏，与 AI 模型中心并列。独立的是管理入口，不是资源、权限或账本。
>
> [更新前完整原文](image-model-center.history-20261010.md)仅作历史证据，旧稿的嵌套导航、来源门禁和未由上游用量协议证明的预算表述已撤回。产品合同见 [PRD](../prd/image-model-center/README.md)，调查、评审和命令回执分别见[调查](../verification/image-model-center-investigation.md)、[评审](../verification/image-model-center-design-review.md)、[验证](../verification/image-model-center-implementation.md)。

> 本次职责归属修正前完整原文见[历史稿](image-model-center.history-20261010-module-boundaries.md)；当前日志/账单修正回执见[验证记录](../verification/image-model-center-module-boundaries-20261010.md)。

> 本次增量更新前的完整原文另存为[价格同步更新前历史稿](image-model-center.history-20261010-pricing-sync.md)。下文既有验收回执属于上轮；本次同步增量的验证单独记录，不以旧回执替代。

## 第一钻石：发现问题，定义交付

### 1. 背景与问题

Admin 已有 Provider、模型目录、授权、Gateway 请求记录、平台价格和账单。此次缺口是：管理员没有独立的图片服务管理入口，图像工具不能通过明确的生成、编辑入口取得图片并完成结算。

将 Image 页面嵌入 AI 模型中心，既没有形成独立的管理对象，也增加了两层相似栏目。将 Image 独立成另一套资源系统，又会重复维护账号、模型和账单。本设计只拆分管理入口，复用既有业务事实。

目标调用关系为：IM 图像工具 → Admin Gateway Images 接口 → Codex 或 OpenAI 图像服务。主对话使用 Responses 与图像工具使用 Images 可以同时成立。

### 2. 目标与边界

管理员获得一套与 AI 模型中心同构的 Image 管理体验，能够配置 Codex/OpenAI 连接、图像模型和平台价格，并查到每次图片调用的结果状态、用量与费用。已授权调用方能够完成图片生成和参考图编辑。

本次包含独立页面、共享管理 API 的必要增量、两条 Images Gateway 入口、两种 Provider 适配、实际用量计量、安全请求记录与必要的 Drizzle 前向迁移。

本次不包含其他提供商、创作画布、图片管理中心、后台生成任务、自动双接口切换、自动 Provider failover、独立账本。Admin 不提供图片创作入口。不改 Claude Code 主循环，不把图片送入文本 Messages/Chat 转换链路。

### 3. 概念与业务规则

- Image 模型：现有模型目录中的稳定别名，具备生成、编辑中的一项或两项能力。
- Provider：同一连接可供文本和图片模型使用；在任一中心修改共享连接，都会影响其关联模型。图片服务只接入 Codex 和明确配置为 OpenAI Image API 的连接。
- 平台价格：Admin 管理员制定并发布的价格版本，是调用方结算的唯一价格真值。
- 参考价格：OpenAI API、models.dev、Codex 公开资料或内部记录可供制定平台价格时参考。参考来源不是调用门槛，也不代表上游本次实际收费。Codex included usage 不转换为逐请求美元成本。
- 实际用量：由 Provider 返回的文本输入、图片输入和图片输出 Token 明细。图片数量只用于请求选项与调用前预算，不作为默认价格单位。
- 预留预算：调用前保护额度的配置，与实际用量和最终费用分开；预算依据记录可选，不能将估算冒充已核验的上游最大用量。
- 历史事实：调价创建新版本；请求保存当时采用的价格和路由快照。停用不改变历史结算。
- 隐私：管理后台和日志不保存或查看提示词、参考图、mask、生成图与完整上游正文。图片结果只交给已授权调用方，不进入通用模型上下文。

### 4. 功能描述

本节只说明用户获得的能力。报文、校验和程序状态在技术设计中定义。

#### 4.1 提供商管理

管理员在 Image 中心的 Provider 栏目查看 Codex/OpenAI 图像服务连接、账号状态和启停情况，新增或修改连接，修复失效授权。连接复用已有提供商管理，避免重复录入凭据和维护账号。

#### 4.2 图像模型管理

管理员在 Models 栏目查看、添加、修改、启用和停用图像模型，设置模型名称、别名、提供商、上游型号以及生成和编辑能力。列表展示使用准备情况和缺失配置，帮助管理员判断模型能否提供服务。

#### 4.3 计费管理

管理员在 Pricing 栏目配置图像模型的平台价格、用户层级和生效时间，创建新价格版本或结束旧版本。管理员可以使用 models.dev 同步参考价，在共享审核页选择来源、保留或补充平台图片输入价后发布新版本；无参考价的模型仍可手工定价。管理员可记录参考价格来源，并在请求记录与已有账单中查看实际用量、平台金额和结算结果。

#### 4.4 图像生成

已授权调用方提交图片描述并选择图像模型，得到完整图片结果。调用记录可以与用量和账单对应，便于排查失败及核对费用。

#### 4.5 图像编辑

已授权调用方提交参考图片和修改要求，得到完整编辑结果。所选服务不支持的选项会明确提示，避免修改要求被忽略。

#### 4.6 日志与账单（既有系统）

管理员在已有代理网关请求日志中筛选图像生成或编辑，按模型、提供商、状态和时间排查调用。在已有 Token 计费使用记录中核对实际用量、图像价格快照、平台金额和结算状态。Image 中心没有请求记录或账单入口，两处仍引用同一请求事实，不提供图片或提示词正文查看能力。

## 第二钻石：展开方案，确定交互与交付

### 5. 选定方案与取舍

选择“独立导航、共享资源”的最小方案：

- 新增独立 `/admin/image-models` 管理入口和三个同构栏目。
- 复用 `AIProviderRegistry`、`AIModelRegistry`、`AIPricingTimeline` 及统一全页表单。
- 复用既有 Provider、model alias、RBAC、Gateway Key、订阅权益、Allowance、价格版本、请求生命周期和 append-only ledger。
- 保留必要的 Images 专用解析和 HTTP transport，处理 OpenAI multipart 与 Codex JSON 的真实差异。

没有选择嵌套在 AI 栏目中的 Image 页面；也没有选择复制管理 API、账本或数据库模型。当前页面与协议能力已经落地；本次 Provider 简化与共享价格同步经过独立复审和新隔离验证，详见[增量回执](../verification/image-model-center-pricing-sync-20261010.md)。实际模型验收与文档检查、隔离技术验证分别记录，不由源码存在推断。

### 6. 管理员完整流程

1. 在侧栏“Image 模型中心”进入 Provider，选择已有 Codex/OpenAI 连接，或新增并完成连接配置。
2. 进入 Models，添加稳定别名，选择 Provider 与上游型号，声明生成和/或编辑能力，填写调用前预算。
3. 进入 Pricing，手工发布平台价格，或通过 models.dev 同步进入审核，选择来源、补充平台图片输入价和生效时间后应用新版本。同步不直接改价。
4. 检查模型准备情况并启用。账号连接、配置准备和真实模型可调用是不同事实，不能互相替代。
5. 在既有 Gateway Key、订阅及模型权限入口授予调用资格。
6. IM 图像工具通过独立 Images 接口生成图片或提交参考图编辑。
7. 从侧栏“代理网关 → 请求日志”核对状态与安全错误，从“Token 计费 → 使用记录”核对实际用量、价格快照和结算结果。调用类型筛选区分文本、图像生成与图像编辑。
8. 调价创建新版本；服务停止使用时停用模型或 Provider。历史请求保留。

### 7. 页面归属与骨架

#### 7.1 桌面

~~~text
┌ Admin 侧栏 ────────────┬ Image 模型中心 ──────────────────────────┐
│ AI 模型中心             │ Provider | Models | Pricing              │
│   Provider              ├────────────────────────────────────────┤
│   Models                │ Provider：筛选、账号卡、设置             │
│   Pricing               │           [添加 Provider] [添加模型]   │
│                         │ Models：筛选、图像模型卡、启停与准备情况 │
│ Image 模型中心           │         [添加模型] [设置] [添加定价]    │
│   Provider              │ Pricing：平台价格版本表、有效窗口        │
│   Models                │          [models.dev同步] [新版本][结束]     │
│   Pricing               │                                        │
└─────────────────────────┴────────────────────────────────────────┘
~~~

三个栏目一一对应独立 URL，只提供 Provider、Models、Pricing 配置，不挂请求记录、账单或辅助入口。新增、编辑与调价使用既有全页表单，保存或返回均留在 Image 中心。请求排查归属代理网关，使用与费用查询归属 Token 计费，管理员从现有侧栏进入。

侧栏和主内容沿用既有独立纵向滚动范围。列表表格只在自身容器内横向滚动。全页表单固定标题和操作区，字段区域纵向滚动；详情与结束价格弹窗固定标题/操作，正文在弹窗内滚动。普通保存不新增确认弹窗；停用、断开账号和删除沿用已有风险交互。

#### 7.2 窄屏

~~~text
┌ 顶栏 / 导航菜单 ─────────────────┐
│ Image 模型中心                   │
│ Provider | Models | Pricing  →   │  栏目可横向滚动
├──────────────────────────────────┤
│ [添加] [筛选]                    │  操作换行
│ Provider / 模型卡：单列           │
│ 价格表：容器内横向滚动             │
│ 全页编辑：字段单列、正文纵向滚动   │
└──────────────────────────────────┘
~~~

窄屏不产生整页横向溢出，不增加悬浮创作操作。沿用 AI 模型中心的间距、卡片、筛选、分页、按钮和视觉 Token，不引入新的设计体系。

#### 7.3 页面和弹窗关系

| 页面/操作 | 实际入口及去向 |
| --- | --- |
| 默认入口 | `/admin/image-models` → `/admin/image-models/models` |
| Provider | `/admin/image-models/providers`，只显示 Codex/明确标记的 OpenAI Image 连接 |
| 新增/设置 Provider | 本中心 `providers/new`、`providers/[id]/edit`；托管授权成功留在本中心，不跳文本目录确认 |
| Models | `/admin/image-models/models`，仅列图像能力模型；Provider 筛选可通过 URL 预选 |
| 新增/设置模型 | 本中心 `models/new`、`models/[id]/edit`；Provider 选择限定图片连接，隐藏无关 Claude Runtime 区域 |
| Pricing | `/admin/image-models/pricing`，仅列图像模型价格 |
| 创建/替换价格 | 本中心 `pricing/new`；预选模型/旧版本；返回本中心 Pricing |
| 同步参考价格 | 本中心 `pricing/sync/[snapshotId]`；共享 `PricingSyncReview imageOnly`；重新同步留在本中心，应用/取消返回 Pricing |
| 结束价格 | 复用 `PricingEndDialog`，不新建版本控制框架 |
| 代理网关 / 请求日志 | `/admin/gateway/requests`；调用类型、Provider、状态与时间筛选；复用 `GatewayRequestDetail` |
| Token 计费 / 使用记录 | `/admin/billing/usage`；调用类型筛选同步到聚合、列表与 URL；既有详情增加图像用量及两类图片价格快照 |
| 旧 Image 请求书签 | `/admin/image-models/requests` 和 `/admin/models/images?view=requests` 仅重定向到现有 Gateway 日志，不保留独立页面 |
| 旧书签 | `/admin/models/images?view=...` 只做相应兼容重定向，AI 主导航不再包含 Image 子栏目 |

栏目切换由 URL 明确选择页面。仅当前 URL 上的筛选可以分享；不宣称已经实现跨栏目自动保留所有筛选。

### 8. 配置交互与状态归属

Provider 页面直接使用共享连接列表，不额外展示就绪汇总；使用既有连接表单与单账号面板。Image 新增只提供 Codex、OpenAI 两种入口；静态凭据只写服务器加密列，保存后不回填。账号已连接与 Provider 已启用分开展示。原有文本连通性验证不是图片生成验收，图片 entitlement 以实际 Images 调用为准。

Models 使用共享别名和型号字段，新增默认停用，默认声明生成与编辑，管理员可调整。每图输入/输出预算必须为正整数；生成需要输出预算，编辑还需要输入预算。预算依据可空。模型别名与 Provider 关系沿用创建后只读合同。

Pricing 配置文本输入、图片输入、图片输出的 USD / 1M Token，在服务器转换为整数 micro-USD；不显示与直接 Images 无关的文本输出/缓存编辑控件。生成模型需要图片输出价格，编辑模型还需要图片输入价格。零价格是合法平台定价，未配置与零不能混淆。

可选来源类型、引用、版本可全部省略；填写时要求三项完整且来源类型与 Provider 相容。这是写入一致性校验，不是启用或调用门槛。

| 配置事实 | 归属 |
| --- | --- |
| default | 模型别名关联的默认 Provider 与上游型号；不是全局固定图片模型 |
| desired | 管理员编辑草稿和拟发布的模型能力、启停、平台价格 |
| effective | 已提交的配置，以及请求开始时实际满足的 Provider、价格、授权与额度 |
| revision | Provider 认证 revision、路由 revision、价格版本沿用各自既有合同 |
| 模型能力历史 | 现有管理审计；不虚构独立不可变 capability revision |
| 列表“准备就绪” | 全局配置投影；不是对任意调用方的授权或余额证明 |

## 技术设计

### 8.1 models.dev 同步合同（增量已实现，验证另计）

- `AIPricingTimeline` 复用原按钮、加载反馈和权限控制。`POST /api/admin/pricing-sync` 的 strict DTO 增加可选 `imageOnly:boolean`；Image 请求传 `true`，原文本请求仍走原路径。源地址仍是既有 `MODELS_DEV_API_URL`，不新增网络控制通道。
- Image discovery 只匹配本次 Codex/OpenAI Image-capable 模型；目录必须声明 image 输出并同时提供 `cost.input/output`，缺价条目不作为可应用候选。金额依旧转换为整数 micro-USD / 1M Token；不按图片数、不伪造用量、不折算 credits。
- [models.dev schema](https://github.com/anomalyco/models.dev/blob/dev/packages/core/src/schema.ts) 的成本字段没有独立图片输入价。图像条目的 input/output 作为文本输入/图片输出参考值展示，不宣称是某次上游账单。图片输入采用现有 default 层平台价，可在审核页显式修改，零与未填写分开；编辑模型没有该平台价时拒绝应用。
- 使用既有 `ai_pricing_sync_snapshots` JSONB 保存完整候选、kind、平台输入价预览和必要标记，无新表/迁移。快照复用按文本/Image区分，原过期窗口不变。审核页列出文本输入、平台图片输入、图片输出；歧义候选必须选定，不能默选。未匹配行不可应用，可以回平台价格表单手工定价。
- Apply 沿用 `pricing.write`、Origin、strict DTO、事务、快照行锁与 model/default advisory lock；新增 `imageInputPrices` 只接受已选择的 Image 模型及非负安全整数，不允许覆盖目录价格。锁定实际模型/Provider 后复验能力、连接种类与上游型号；只创建平台 default 层价格版本，保留 markup/discount 和不适用的文本输出/缓存价，不改其他层级或历史账单。
- 普通表单与同步共用 `pricing-windows.ts` 的 scope lock/窗口重叠检查；应用前拒绝重复开放版本，结束被替换版本后重新检查所有 active 窗口，冲突整事务回滚。批量模型按稳定 ID 顺序锁定，客户端提交顺序不影响锁顺序；有界前序版本未被替换时保留原窗口，从该版本继承不适用的价格维度。
- 原文本 Apply 仍接受原 DTO，安装 Image 扩展时保留已有图片分项，未安装时继续原文本合同；Image 路径缺 capability 则 fail closed。审核页拒绝跨中心快照；服务端权限始终重验。
- 发现失败不创建成功快照；重新同步仍回本中心。非法候选、缺图片输入价、过期/已应用、模型变更或价格窗口冲突均拒绝且事务回滚；保留审核页面和安全错误，允许修正输入或重新同步。取消只返回 Pricing，不改价；重复 Apply 返回409，不重复创建版本。
- 加载失败、应用错误或过期/已应用快照提供“重新同步”恢复入口；只重新发现参考价，不自动应用。空匹配快照不复用，避免被误识别为另一中心。

本次未引入独立计费系统、模型来源框架、自动调价或额外确认。新增的图片输入编辑仅补齐目录未提供而编辑结算必须使用的平台分项。


### 8.2 日志与计费归属（已实现）

`ImageModelCenterPage` 只渲染三栏及配置内容，不渲染请求链接。两个旧请求 URL 只执行 `redirect("/admin/gateway/requests")`，不复制列表、权限或数据。

现有 `GatewayRequestsPage` 在 `gateway-requests` 资源上按 operation（text/images.generations/images.edits）、Provider、状态与 created_at 范围查询；列表显示调用类型、用量状态和平台费用，Image 明细继续由既有 `GatewayRequestDetail` 展示，payload 入口仍永久拒绝。`resources.ts` 只将已注册的 created_at 列加入两个既有资源的筛选白名单。

现有 `AdminUsageDashboard` 将同一 operation 和 UTC 日期范围用于 `usage` 列表及 `/api/admin/usage-dashboard` 聚合，筛选保存于当前 URL，刷新保持。聚合 DTO 严格校验可选 operation，在所有统计查询中使用参数化等值条件；没有 operation 时保留原文本/图像混合合同。已有账单详情展示图像输入/输出 Token、对应价格快照和结算状态；用量未知保持未知，不展示为零。

日期范围不依赖 PostgreSQL session TimeZone：聚合在 `usageWhere` 显式使用 UTC 半开日期边界，趋势通过三参数 `date_trunc(..., 'UTC')` 分桶；列表使用对应 UTC 起点至末尾微秒。既有自动刷新选项仅接受0/15/30/60秒，从 URL 恢复，非法值恢复关闭。本轮非 UTC 隔离 PostgreSQL 实际验证覆盖 UTC 月末前一微秒、月初与次日边界的列表/聚合一致，完整流程exit0；不为测试增加生产环境分支。

本轮完整 E2E 实际发现既有 `handleAdminBillingReport` 的日期边界同样依赖 session 时区，导致 UTC 当天晚间记录被默认范围排除。最小修订是该只读报表的 UTC 半开范围、UTC日分组/排序与 `meta.timezone="UTC"`；不增加报表资源或修改计价、结算、账本。独立复审确认范围合理；当前回归在同一非UTC隔离库交叉核对列表、聚合和按日报表，最终通过状态以本次回执为准。

日志 API 仍要求 `gateway.read`，使用记录/聚合仍要求 `billing.read`；UI 入口移除不替代服务端授权。此修正不改变生成/编辑协议、上游调用、价格解析、预留、结算、重试或 append-only ledger，不迁移历史请求或真实账单。

### 9. 源码依据与当前状态

| 判断 | 文件、符号和行号 | 状态 |
| --- | --- | --- |
| 两个中心共享页面框架，但导航分离 | `app/components/admin/AdminModulePage.tsx`，`modelTabs`/`imageModelTabs`，39/45；`ImageModelCenterPage.tsx`，9 | 源码已实现；本轮页面验证另计 |
| 图像模型和价格复用现有注册表 | `AIModelRegistry.tsx`，44；`AIPricingTimeline.tsx`，95 | 源码已实现 |
| 管理写操作复用严格 schema/事务/审计 | `app/lib/admin/mutations.ts`，模型预算字段312–313，来源三元组808，Provider相容检查820 | 源码已实现 |
| 两个中心共享目录审核及窗口安全 | `app/lib/admin/pricing-sync.ts`，`handlePricingSyncApply`430、完整窗口检查493；`pricing-windows.ts` 的原管理校验；`PricingSyncReview.tsx`54 | 本次增量已实现；最终回执另计 |
| Image 中心不再挂请求记录，已有日志/账单拥有查看能力 | `app/components/admin/ImageModelCenterPage.tsx:8`；`app/(admin)/admin/(workspace)/gateway/requests/page.tsx:10`；`AdminUsageDashboard.tsx:82/140`；`usage-dashboard.ts:14/27/77`；`resources.ts:419/543` | 本次职责修正已实现；当前验收见职责修正回执，不用旧截图替代 |
| 列表、聚合与按日报表使用相同UTC日期边界 | `app/lib/admin/billing-report.ts:30/41/49`，`handleAdminBillingReport`；`usage-dashboard.ts:27/77` | 源码已修正；当前非UTC隔离验证另计，不修改价格或账本 |
| Image 实际能力与平台价格由 Resolver 判断 | `app/lib/models/resolver.ts`，`resolveBillableModel`，246 | 源码已实现；来源不参与门禁 |
| Images 独立于文本转换 | `app/lib/gateway/image-handler.ts`，`handleImageGeneration`391、`handleImageEdit`419 | 源码已实现 |
| 严格请求解析及完整图片解码 | `image-protocols.ts`，generation schema30、edit parser155、`decodedImageMime`81 | 源码已实现 |
| Provider 认证与两种编码分开 | `image-transport.ts`，`sendImageProviderRequest`122；`app/lib/providers/codex.ts`，`getImageResourceContract`472 | 源码已实现 |
| 预留、幂等及结算复用既有事实 | `app/lib/gateway/repository.ts`，`beginGatewayRequest`198；`app/lib/billing/money.ts`，`calculateCharge`103 | 源码已实现 |
| 未知用量不伪造实际 Token | `app/lib/gateway/settlement-worker.ts`，`resolveUnknownGatewayUsageOnClient`54 | 源码已实现 |
| 正常 Codex 模型可生成/编辑 | 2026-10-10 00:26 本轮正常请求 `req_9df2e7bce8d74fd1a5a0940ae457aab4`、`req_5299301c0ae74404866d78cf412a035c` | 实际 Gateway 验收：200、settled、正文捕获关闭；发生于页面归属修正前，不替代新页面 E2E |
| 真实 OpenAI 可用性 | 当前没有已完成的官方账号/模型验收回执 | 尚未验证；fake 不替代 |
| 新框架/表/自动切换的必要性 | 当前需求由上述共享能力覆盖 | 合理推断：无业务必要；不实施 |

以上行号对应本轮源码检查；详细调查保留形成设计时的基线与判定，不将旧稿建议冒充当前实现。本轮评审和验证发现的错误仍须修复与复验，不能因没有额外业务提案宣称完成；任何后续扩展必须标记“建议、未实现”。

### 10. 分层职责

| 边界 | 职责 |
| --- | --- |
| 前端 | 页面归属、筛选、表单草稿、状态反馈、安全摘要；不持有 Provider Secret，不发起图片创作 |
| Admin API | Session 与 permission 双重验证、严格 DTO、事务与审计；Route Handler 只编排 |
| Gateway | 调用身份、scope、订阅与模型授权、模型/价格解析、请求幂等、预留、结果校验、结算及安全错误 |
| Provider | 上游 URL、认证、账号 revision/续期、JSON/multipart 编码；不确定平台价格 |
| PostgreSQL | Provider/模型/价格版本、请求快照、实际用量、Allowance、追加账本和管理审计 |
| IM 图像工具 | 使用授权身份提交描述/参考图，接收完整图片；本任务不修改 Claude 主循环 |

### 11. 公开 Images 接口合同

两条路由都使用稳定模型别名。响应为非流式 JSON，只有完成结果验证和平台结算后才返回图片。

身份认证复用 `authenticateGatewayRequest`：现有 fixed-user Gateway Key、canonical service Key 配合 Admin 签发的 subject JWT、或绑定服务 Key 的 opaque runtime delegation。均须具备 `images:create`，并满足实际用户的订阅权益、模型授权和额度。opaque delegation 自身绑定原 Key，不额外创造图片认证通道。管理员 Session 不是 Gateway 调用身份。

幂等使用既有 `Idempotency-Key` 解析和同主体请求登记。重复请求返回已有请求关联的冲突/状态，不再次调用 Provider。由于不存图片正文，不支持从历史请求重放图片结果。

#### 11.1 生成

`POST /v1/images/generations`，`Content-Type: application/json`。

必填：`model`、非空 `prompt`。可选：`n`（默认1）、`quality`、`size`、`background`、`output_format`、`output_compression`、`moderation`。

生成 DTO 使用 `z.strictObject`；不接受 stream、远程图 URL 或文本接口字段。枚举和请求体/图片数量限制来自 `config/image-api-policy.ts`，属于服务器资源保护，不包装成套餐权益。

Codex 不支持 output_format、output_compression、moderation；在登记和派发前返回 `CODEX_IMAGE_OPTION_UNSUPPORTED`，不静默丢弃。

#### 11.2 编辑

`POST /v1/images/edits`，`Content-Type: multipart/form-data`。

必填文本字段：`model`、`prompt`。输入图片使用 `image` 或 `image[]`，不能混用；可提交一张或多张。可选文本字段为 n、quality、size、background、output_format、output_compression，可选 PNG mask。

标量不允许重复；未知字段拒绝。每张图片须具备一致的 MIME、文件魔数和完整可解码内容，支持 PNG/JPEG/WebP；mask 为 PNG。上传总字节数、单图字节数和解码像素数均受集中 policy 限制，不采信 Content-Length 为唯一保护。

Codex 不支持 mask、output_format、output_compression，调用前明确拒绝。此处不新增下载外部 URL 的能力。

#### 11.3 返回与用量

成功响应保留白名单字段：created、data（b64_json、可选 revised_prompt/generation_id）、usage 及安全的格式/尺寸/质量字段。生成图须完整解码，数量、格式与用量必须符合合同；只返回图片 URL 或无图的结果不能冒充成功。

必需用量：total_tokens、input_tokens、output_tokens，以及 input_tokens_details.text_tokens/image_tokens。输出分项可省略，此时按直接 Images 的输出语义归入 image output；提供分项时校验和总数一致。文本输出必须为零，不套用文本 output 价。缓存用量不参与直接 Images 结算。

错误沿用 Gateway envelope 与请求 ID；派发前拒绝可能尚未产生持久化请求。上游错误正文不原样回传或捕获。

### 12. OpenAI 与 Codex 的实际区别

| 项目 | OpenAI 公开 API | Codex 后台路由 |
| --- | --- | --- |
| 官方 URL | https://api.openai.com/v1/images/generations；https://api.openai.com/v1/images/edits | https://chatgpt.com/backend-api/codex/images/generations；https://chatgpt.com/backend-api/codex/images/edits |
| URL 归属 | 既有 Provider base URL 配置与 endpoint policy | Codex registry/config 明确提供两条 endpoint，可配置覆盖；不从 Responses URL 裁剪 |
| 认证 | 服务器静态 API Key；官方连接使用 Bearer | 已连接的 ChatGPT managed account 与 registry-owned headers |
| 生成输入 | JSON | JSON |
| 编辑输入 | multipart，真实文件/mask | JSON，images 数组中 image_url 为服务器临时编码的 data URL；不支持 mask |
| 请求关联 | 安全的上游 request ID | 另带 x-codex-image-turn-id=Gateway request ID |
| 用量和价格 | 实际 usage + Admin 平台价格 | 实际 usage + Admin 平台价格；没有 credits→USD 要求 |

官方接口资料与本地 Codex 源码分别核实，不能只凭字段同名认定全兼容。具体证据见调查稿的 `/Users/dmeck/project/codex/codex-rs/codex-api/src/images.rs` 及 endpoint 实现。Provider 声明兼容不等于真实账号已经验收。

### 13. 请求、计费、失败与恢复

1. 鉴权、解析、模型与平台价格检查在派发前完成；所需 schema capability 缺失时 fail closed。
2. `beginGatewayRequest` 在共享事务中登记请求、执行幂等/限流/订阅授权并预留额度。冻结模型、价格、路由和账号 revision；一次请求只选一个 Provider，不走文本 failover。
3. 预算为描述预算 + 参考图/mask数量×输入预算 + n×输出预算。预算按平台价格估算金额；不记录为实际用量或收费单位。
4. transport 在取得凭据后再次检查 AbortSignal；派发标记用于区分本地取消与可能已经产生上游用量。
5. 已知实际用量按冻结的平台价格分项计价，沿用 markup/discount 和取整规则。Image 要求完整 Token capture，额度不足不能部分结算后交付图片。
6. 结算成功才返回完整图片。不存结果正文，因此网络断开后的结果找回不在本次边界。

| 情形 | 实际处理 |
| --- | --- |
| 权限不足、停用、无效字段/图片、缺平台价 | 派发前拒绝，不产生第二次计费或替代调用 |
| 未派发即取消 | 本地可确认没有上游用量，释放未使用预留 |
| 明确未计费的上游拒绝 | 复用既有失败释放，保存安全错误 |
| 无图/坏图/错误结果，但 usage 通过imageUsageSchema和分项求和检查 | 按上游返回且通过检查的用量结算，outcome 为失败，图片不交付 |
| 非2xx且 usage 通过imageUsageSchema和分项求和检查 | 按实际用量完整结算失败请求；不能因 HTTP 失败当作零用量 |
| 已派发后取消、超时或 usage 缺失 | 标记 usageKnown=false 与 settlement_failed，保留预留，不按零成功结算 |
| usage 通过imageUsageSchema和分项求和检查，但本地结算失败 | 持久化上游返回的四类 Token 和快照，由 `reconcileKnownImageUsageOnClient` 幂等重算 |
| 未知用量达到既有恢复窗口 | 只对满足现有 Token-only 条件的请求保守消费已预留 Allowance；仍标记未知，不虚构实际 usage 或上游成本 |
| 重复请求 | 原请求关联的状态/冲突；不重放图片、不再次派发或追加结算 |
| 自动重试 | Codex 401 仅按现有托管凭据合同进行一次受控续期重试；不对超时/5xx/无图自动重做图片任务 |
| 调用方重新提交 | 明确的新业务请求使用新幂等键，可能再次消耗额度；不承诺免费重试 |

请求、使用报表和按日报表将历史 `provider_cost_microusd` 展示为“平台基础金额”，并非已核验上游账单。调用方收费还受订阅覆盖影响，零收费不代表零用量。未知用量/金额单列，聚合只展示已知小计。

### 14. 可渲染业务图

正常时序（参与者使用真实模块名称）：

~~~mermaid
sequenceDiagram
    participant Tool as IM 图像工具
    participant Handler as image-handler
    participant Auth as authenticateGatewayRequest
    participant Resolver as resolveBillableModel
    participant Repo as beginGatewayRequest
    participant Transport as sendImageProviderRequest
    participant Provider as Codex 或 OpenAI
    participant Billing as finalizeKnownUsage
    Tool->>Handler: generation JSON 或 edit multipart
    Handler->>Auth: 验证现有身份及 images:create
    Handler->>Resolver: 解析能力、Provider、平台价格
    Handler->>Repo: 幂等、授权、冻结快照、预留
    Repo-->>Handler: request ID
    Handler->>Transport: Image 专用请求
    Transport->>Provider: JSON 或 multipart
    Provider-->>Handler: 完整图像及真实 usage
    Handler->>Handler: 白名单、完整解码、用量一致性
    Handler->>Billing: 实际用量与冻结价格
    Billing-->>Handler: 原账本完成结算
    Handler-->>Tool: 完整图片结果
~~~

异常与恢复：

~~~mermaid
sequenceDiagram
    participant Tool as IM 图像工具
    participant Handler as image-handler
    participant Life as lifecycle
    participant DB as PostgreSQL
    participant Worker as settlement-worker
    Tool->>Handler: 请求或取消
    alt 派发前可确认未调用
        Handler->>Life: 已知零用量失败
        Life->>DB: 释放预留，安全错误
    else 派发后结果不可交付，usage通过schema与分项检查
        Handler->>Life: 实际 usage 与失败 outcome
        alt 结算成功
            Life->>DB: 完整结算，不交付图片
        else 结算失败
            Life->>DB: 保存实际明细与 settlement_failed
            Worker->>DB: reconcileKnownImageUsageOnClient
        end
    else 派发后用量未知
        Handler->>Life: usageKnown=false
        Life->>DB: settlement_failed，保留预留
        Worker->>DB: 恢复窗口后按既有 Token-only 合同关闭冻结
        Note over DB: 用量和金额仍未知，不伪造实际 Token
    end
    Handler-->>Tool: 安全错误及可用请求关联
~~~

页面状态图（“准备就绪”是 UI 派生状态，不是新增数据库 enum）：

~~~mermaid
stateDiagram-v2
    [*] --> Provider
    Provider --> ProviderForm: 新增或设置
    ProviderForm --> Provider: 保存或返回
    Provider --> Models: 配置模型
    Models --> ModelForm: 新增或设置
    ModelForm --> Models: 保存或返回
    Models --> Pricing: 配置平台价格
    Pricing --> PriceForm: 创建新版本
    PriceForm --> Pricing: 保存或返回
    Pricing --> PricingSyncReview: models.dev同步
    PricingSyncReview --> PricingSyncReview: 来源选择/补充输入价/错误修正/重新同步
    PricingSyncReview --> Pricing: 应用成功或取消
    Pricing --> EndDialog: 结束版本
    EndDialog --> Pricing: 成功或取消
    [*] --> GatewayLogs: 代理网关侧栏入口
    GatewayLogs --> RequestDetail: 查看安全日志详情
    RequestDetail --> GatewayLogs: 关闭
    [*] --> BillingUsage: Token计费侧栏入口
    BillingUsage --> UsageDetail: 查看用量与费用
    UsageDetail --> BillingUsage: 关闭
    state Models {
        [*] --> Disabled
        Disabled --> EnabledPending: 启用但配置有缺口
        EnabledPending --> Ready: 补齐现有运行配置
        Ready --> EnabledPending: 配置失效
        Ready --> Disabled: 停用
    }
~~~

### 15. 数据库、兼容与影响范围

使用 `packages/db/src/schema/**` 作为唯一 schema。既有前向 migration `0078_absent_puppet_master.sql` 增加：

- `ai_models` 两项 nullable integer 每图预算，约束为非空时 >0。
- `ai_pricing_rules` 两项 nullable bigint 图片 Token 价，约束为非空时 >=0。
- `gateway_requests` operation、四类 bigint Token 分项、两类 bigint 价格快照。
- 既有 delegation purpose 允许 `images:create`，最后登记 `gateway.images.v1` capability。

迁移按扩展、兼容、历史文本 operation 回填、校验、约束收紧实施。运行时只检查 capability，不执行 DDL，不新增 Image 表，不改旧 migration。当前页面归属、models.dev 同步和日志/账单归属修正均不需要新 migration。

文本路由、文本默认模型和账单入口保持原有合同。Image-only 不能成为文本默认可调用模型；公开模型目录保留分开的 endpoint availability。原有权限体系新增的是明确 scope/权益，不自动扩大既有调用方权限。

风险影响面：共享 Provider/form 导航、管理资源筛选、模型配置、价格快照、Gateway 生命周期、Allowance/账本、报表与请求安全边界。必须同时覆盖原有 AI 管理页面、文本调用与计费回归，不能只测新页面截图。

### 16. 验收矩阵与实施顺序

> 下表的53.9s、2302项和00:26真实模型记录属于此前独立中心交付的历史阶段。新增价格同步证据见其增量回执；本次只配置中心与日志/账单归属修正的当前命令、完整流程和未验证边界单独记录在[本次回执](../verification/image-model-center-module-boundaries-20261010.md)，不能由旧通过推断新实现通过。

| 验收项 | 必需证据 | 本轮状态 |
| --- | --- | --- |
| 独立中心与三栏、操作/保存/返回路径 | 桌面/390窄屏隔离 Chrome E2E，AI三栏回归，旧链接重定向 | 本轮Chrome全链exit0；正常Admin也已展示独立导航 |
| Provider→模型→平台价→授权→生成→参考图编辑→结算→请求详情 | 公开生产入口的隔离 PostgreSQL/fake 全链，安全记录和账本断言 | 本轮全链1 passed（53.9s）；仅技术验证 |
| 权限/停用/无效输入/上游失败/坏图/无图/usage缺失 | 确定性单元及隔离集成/E2E | 本轮完整unit和E2E通过；integration suites不在unit脚本内 |
| 重复、取消、恢复、受控重试 | Provider调用次数、预留释放/保留、完整capture和幂等账本 | 本轮unit/E2E通过；真实上游故障注入不在范围 |
| 来源可空、零价合法、金额未知 | source-free全链、写入一致性拒绝、known subtotal断言 | 本轮null/0单测、generation-only价格和source-free全链通过 |
| 静态与回归 | typecheck、lint、unit、focused E2E、build 的本次退出码 | 最新全部exit0；4files/33focused、2302passed/37skipped、独立build通过 |
| 真实 Codex | 正常Admin/Gateway、已有账户/模型/订阅的生成和编辑；后台实际usage/平台快照/ledger | 本轮00:26 Gateway两次200且settled，页面修正后再次查到实际快照/Token账本；不替代新页面E2E |
| 真实 OpenAI | 已有官方Provider及服务器凭据、真实模型授权和同样证据 | 尚未验证 |

顺序为：调查与定义 → 产品和正式设计 → 基于实际稿独立评审并修订 → 最小实现 → 影响面验证 → 实际错误修复与重跑 → 完成审计。独立评审发现的导航归属错误已纳入本次修正，不能只修改文档不改变页面。

所有必需交付、修订与当前验证完成后才能完成 Codex 目标。技术验证、旧回执、单独 HTTP 200 或创建任务都不是完成。真实 OpenAI 缺失的前置准确列为未验证，不伪造通过。

## IM 会话接入补充（2026-10-10）

IM 主对话中的上传图片与 Read 图片结果由原 `protocol-adapters.ts` / `responses-adapter.ts` 保留为模型视觉输入；调用 ID、文字工具结果和原执行语义保持。明确要求image_gen的生成/编辑由IM原工具调用本稿独立Images入口；普通图片需求通过专项selector决定后使用所选AI已支持且可调用的Responses内置 `image_generation`。显式image_gen不注册内置工具，两路互斥。

本补充仅修订协议转换器，不改变 Image 中心页面、提供商、定价、Drizzle 或 Gateway 图片计费流程。IM 本轮独立适配器验证记录在 `/Users/dmeck/project/ink-dream-memory/docs/exec/image-tool-validation-20261010.md`；它不替代本中心既有真实 Gateway 验收，也不表示 IM 正常账户/模型已验收。

## 文本模型兼容

Image中心的加入应保持原有文字模型访问。Messages/Chat目录沿用现有订阅和通用Token allowance规则，不能仅因为缺少独立模型plan entitlement就关闭原可调用的文字模型。Images继续使用图片能力、图片价格和独立图片授权。当前目录的endpoint `entitled`表示实际端点资格，也包含已有allowance-only文字资格，不能当作独立plan行存在的证明。此修订不修改订阅、权限、Schema或账本。

## 通用OpenAI主对话协议前提（2026-10-10）

`provider-fields.ts`在原Provider表单提供`openaiApi`选择，保存为既有`config.openaiApi`闭集`chat|responses`。缺省Chat；Anthropic和托管产品拒绝覆盖。API方言与独立`imageApi`分别所有，不按型号或Key猜测。共享`provider-endpoint.ts`解析API和固定路径，验证与transport复用；完整Endpoint与选项矛盾直接失败，不追加第二路径。标准Responses请求使用`store=false`，Codex专有默认值不扩散。

`routing.ts`将每个实际候选的冻结config传给请求、JSON与SSE转换，保留原前置拒绝failover；已接受或执行未知后不切换。原auth revision CAS保护敏感切换；非敏感预读后出现并发API变化，在原行锁内返回409且不写回旧config。停用创建不发验证；激活/敏感修改必须有原选择的验证模型，否则保留原状态并要求先登记Model。

源码已实现，完整序列图、恢复图和本轮回执以[专项正式稿](/Users/dmeck/project/ink-dream-memory/docs/design/claude-agent/image-model-call-division.md)和[执行记录](/Users/dmeck/project/ink-dream-memory/docs/exec/image-model-call-division-20261010.md)为准。HTTP最小验证仅证明协议请求被上游接受，不证明内置图片工具兼容；内置操作按精确合同、配置与资格开放；正常实例代码与精确合同已受控采用，当时真实图片模型验收尚未完成（阶段历史，当前见末节）。没有新增表、Provider类型或部署环境分支。

### 2026-10-10 专项接入修订

原能力勾选分为Responses生成/编辑和Images生成/编辑，目录能力、配置与资格分别表达。图片执行复用原account→turn→idempotency顺序及原请求/Token预留事务，仅追加执行认领和安全摘要。内置用量不完整时保留unknown，不能套Images价或计为零；图片正文和提示词不进入通用payload日志。正常、异常与状态图及当前验收矩阵见[专项正式设计](/Users/dmeck/project/ink-dream-memory/docs/design/claude-agent/image-model-call-division.md)。

2026-10-11兼容性修订：编辑原Provider时未设置的主对话API值沿用现有空值省略规则；明确选择Responses仍保存。完整registry验证允许图片操作尾追加，原scheduled Thread-read位置、权限及输入合同保持不变。本轮全套单测首次两项失败保留为修订依据，修订后的测试/build资格单独记录。


## 2026-10-11 round29 Codex 内置生成能力核实（源码与正常生成核实通过，主对话另验）

当前指定账户已通过原管理登录、取消旧Free v6并正常开通既有已发布Free v7取得Images资格，真实事件和原额度保留；这是新月度业务周期，不修改共享已发布权益。此事实不开放Codex Responses能力。

在原AI模型卡片增加“核实Responses图片生成”，扩展原validate入口的严格可选validationKind，默认空请求仍执行现有文字核实。复用Origin/models.write/原Provider-owned credentials与模型Header，一次固定单图需求和hosted声明，不接受任意body/endpoint/Headers，不切模型、不回退Images、不自动发布能力。仅当前Codex或明确generic OpenAI Responses连接适用；使用Provider已有timeout、原Images字节/解码边界和Responses state重建。Codex采用原stream/store/include及字符串auto，不添加未证实的action/choice对象/max_tool_calls。

只有完整completed、一个真实image_generation_call与完整可解码图片才给出本次生成通过。2xx仅有文字、空结果、无terminal、损坏或多图仍失败；保留原配置，显示服务器固定失败分类与恢复说明及闭集安全code/type；不返回Provider自由文本message/detail/text或原始解码异常。返回和同事务Admin审计仅含本次validationKind、HTTP/状态/耗时及真实response/call ID、字节/SHA，不保存正文或伪造Gateway request。正常模型核实不计Dream真实E2E，也不证明编辑。实际稿、正常/异常恢复/状态图及增量矩阵归[专项正式稿](/Users/dmeck/project/ink-dream-memory/docs/design/claude-agent/image-model-call-division.md)。成功后才评审Codex native最小补充与真实Chat验收；失败只说明本次配置/模型/声明未接受，保留四能力的准确区分。

## 2026-10-11 正常采用与当前恢复边界

正常Admin目录与原OAuth客户端已通过受控发布：dream.image-turn.v1精确version/hash/原角色权限及三项operations ready=true，images:create=true。两条已登记callback定向追加到原Browser clients，其他scopes/secret/PKCE/DPoP/resources/links未变。单实例本机和NATAPP按实际请求地址选同client已发布callback，原issuer和后台transport稳定。正常/auth/options本机与公开各200返回对应原中心；公开静态脚本502/HTTP2错误尚阻止可见登录，不声明公网完整验收。

正常既有Thread真实重发观察marker-position-and-binding；CLI恢复前缀兼容修订只定位唯一直接user frame中的完整独立当前marker。prefix不授权图片；仅其后原绑定数量image/exact URI-label pairs参与规范化，native原过滤历史后只加selection子集，重复/拼接/嵌套marker、tail tool_result及坏图仍拒绝。原scope/capability/资格/认领/结算、Runtime/SSE/恢复/停止不改变。此修订已通过本轮31项聚焦、2456项全单测及副本构建，正常采用后同账户既有Thread恢复文字成功，详见Dream专项正式稿的实际时序、状态与回执。

round27/28历史：当时账户Free没有Images entitlement、正常目录所有native flags/configured均false，真实普通生成/编辑、显式Images生成/编辑及返回新图的完整流程不能据技术fixture宣称通过；现行目标仍未完成。[状态同步前完整原文](image-model-center-20261011-before-normal-adoption-status-history.md)保留所有旧设计图与历史验收。

round29首次Images返回时的阶段历史：round29当前状态：指定现有账户已通过原Admin正常流程开通既有Free v7 Images权益；新订阅及旧allowance/其他订阅保留核对记录见专项执行记录。公开Images模型生成/编辑可调用，首次真实生成已返回图；展示闪烁、后续完整编辑/历史验收待执行。主对话Codex native仍未开放，新核实入口仅验证实际hosted结果，不自动勾选或发布能力。

round29独立源码复审修订：核实操作只显示固定失败分类与闭集安全上游类型，实际Response/图片call/HTTP身份须排除Provider凭据反射；SSE调用ID与output_index双向唯一并核对terminal，完整解码后仍需未超时。原文字验证不变，源码完成不代表Codex内置能力或完整Chat验收通过。

### round29 Codex Responses bridge 最小扩展（当时实现规则，当前资格见末节）

正常模型验证已核实原 gpt-6.1-sol 的 hosted Responses image_generation 单张完整图片，真实Response/call身份保存于原Admin审计；验证未修改任何能力。模型保存、目录就绪及native执行门将一致支持明确声明Responses生成/编辑的Codex聊天/工具模型，原默认false、冻结AI、非路由、输入/输出预留和Messages资格保持。Codex采用已核实的工具声明/string auto与原stream/store/include，未核实action/强制对象/max_tool_calls不进入该adapter。Generic OpenAI原声明保持。编辑仍须当前参考图，返回action存在时匹配、缺失保留null；真实编辑/图片语义由DreamE2E核对。单请求、单完整结果、未知图片用量状态、无重试/回退/独立Images调用保持。

独立评审已修订两项native结果边界：仅Codex有body且缺Content-Type复用原SSE解析规则；观察added+done的call ID/output_index双向唯一并核对唯一terminal，防止额外调用被遗漏。CLI投影index与Provider index各保留用途；不改普通SSE生命周期。编辑未核实不能宣称已验收。

原预留表单帮助同步说明：预算只保护调用前额度；完整图片用量未报告时保留“用量未知”状态，不能按预留值推算实际用量。仅修改现有帮助文本，不新增字段或配置；明确预算与实际用量的不同用途。

源码复审修订：done-only已校验图片call在失败fallback摘要保留Provider真实身份，不只读取added的CLI投影Map；失败结算与不重放规则保持。


### round29 默认 Provider 快照边界修订（r5技术资格、正常采用与实际验收完成）

`resolveBillableModel` 即使没有有效路由也提供 `routing` 快照；其 `default` 策略、`allowFallbacks=false`、snapshot 与 execution 均只有一个候选、excluded 为空，候选 Provider 和 upstreamModel 与 resolved 实体一致，表示原默认 Provider，并非多来源路由。native admission 必须识别此原形状；对象存在本身不能判定不可用。`ordered`、`weighted`、fallback、多个候选或身份不一致仍拒绝。目录 SQL effective IS NULL 与这个执行条件一致；不删除 resolver snapshot，不改默认文本路由、预留、SSE或重试。不匹配仍反馈选择可调用 AI 后重新发送。已补真实resolver形状的11项Provider-free回归，r5最终资格构建、正常采用和主对话真实验收均完成；原旧fixture和核实按钮不代替这些回执。

## round29 当前源码与正常验收

2026-10-11 round29：两条图片链路已在指定现有账户、本机正常 Dream/Admin/Gateway/PostgreSQL 上完成实际生成、编辑、查看、下载、后续引用及历史重开；草图实际绘制并完成理解和内置编辑，显式 image_gen 在支持内置图片的 AI 下仍仅执行所选 Image 模型。闪烁修复后同图持续39秒稳定，后续真实SSE更新保持原Blob。最终AI恢复 gpt-6.1-sol，Image保留 codex-gpt-image-2；原多来源路由保持不可调用，用户自行选择已核实的非路由AI后才能执行内置图片。内置交付成功，但完整图片用量未报告，保留 RESPONSES_IMAGE_USAGE_UNKNOWN，不能称实际费用已知。故障注入与37项既有跳过的边界见执行记录；独立复核与文档、图示检查已通过；真实故障、跳过和未知用量的边界保持单列。

最终资格为134项聚焦、2510项全Admin测试及tsc/定向lint/build exit0；18文件37测试保留原跳过。默认Provider快照11项真实resolver回归关闭执行门P1；严格ID/index、缺header Codex SSE及done-only失败摘要关闭P2。最终正常采用Build `Y-FUvVlfmQX52_mp077xs`，不会用先前r3资格替代r5。模型预算依据已通过正常Admin表单更新为实际生成/上传编辑/草图编辑观察，预留数值保持原4784/120000，仅用于调用前保护。

## 2026-10-11 官方 Responses 报告用量修订（round30，独立评审及技术资格通过，本机已采用，用户取消后正向真实重验完成，限制见末段）

原先Gateway对native图片固定标记用量未知是实现缺口，不能据此断言Provider没有返回顶层usage。按[OpenAI成本说明](https://developers.openai.com/api/docs/guides/image-generation#cost-and-latency)与[ResponseUsage定义](https://github.com/openai/openai-python/blob/main/src/openai/types/responses/response_usage.py)，本次有效的input/output/total及缓存、推理分项进入原平台AI模型价格快照与订阅Token结算，缓存包含在input、推理包含在output，不重复相加。此平台金额不表示完整OpenAI图片USD账单；图片引擎、图片缓存和完整费用明细未报告仍单独未知。独立Images的严格text/image分项合同不改。

Gateway固定摘要区分`billingScope=responses_reported_tokens`、`usageKnown`与`imageBillingDetailsKnown=false`，不修改原image-turn.result DTO或capability/hash。native详情复用原抽屉，显示范围说明并永久关闭payload；统计summary/Provider/Model/trend共用服务端处理Token小计。请求失败或取消若已收到有效计数（包括0）仍记录；结算失败沿原pending事实恢复，同scope保留full allowance要求、不重放Provider。数据库整体不可用而未成功保存pending时不能保证跨重启恢复。缺失/非法计数不填0为实际、不推算补账。旧三条缺完整原始usage及缓存分项（CLI已恢复reported总163709，未补结），不拿新请求或大额预留回填。

详细正常/异常/状态图、既有设置骨架及验收矩阵沿[Dream专项正式稿](/Users/dmeck/project/ink-dream-memory/docs/design/claude-agent/image-model-call-division.md)和[专项PRD](/Users/dmeck/project/ink-dream-memory/docs/prd/chat/image-model-call-division.md)。本修订已独立设计评审，源码和本轮真实回执状态见[执行记录](/Users/dmeck/project/ink-dream-memory/docs/exec/image-model-call-division-20261010.md)，不能用历史round29结果替代。

## Responses 已报告用量的 pending 恢复补充（已实现、技术资格与正常采用完成）

直接native结算按官方包含缓存的input总量处理。外层Claude Messages创建记录的历史input_token_semantics=fresh不代表上游Responses计数语义。仅服务器固定billingScope=responses_reported_tokens且requireFullTokenAllowanceCapture=true的已知用量行，在原resolveKnownGatewayUsageOnClient恢复时选total_including_cache；同一条件维持原完整额度捕获要求。原source字段/表结构、普通文字与Images协议、权限/幂等/事务/轮询均保持。原三条usageKnown=false仍不能进入该恢复门，不按CLI默认cache0写回。验收：fresh+cache>0的native known-pending提交inclusive语义并只捕获input+output；其余scope继续原语义和原资格失败反馈。


2026-10-11 round30当前正常采用：known-pending专项75与Admin2546通过/37既有skip、tsc/eslint/build均exit0；资格构建JNChgmNH863ze6IvUWrnH与正常910制品完全匹配、正常Admin75238及PG75173保持。Runtime0.1.12精确公开并正常Dream采用后，本轮五项新图片执行均HTTP200/succeeded/settled：native生成13911、上传编辑17581、草图编辑14191，Images生成567、编辑2102 Token均为原流水capture。正常Dmeck SUPER_ADMIN既有本机Chrome会话已逐项可见核对三条reserve/capture/release；native详情明确报告Token与完整图费用未知，payload仍关闭。冷浏览器使用普通Dream密码被拒绝不代表管理服务不可用，未新建账户或变更认证。最终引用/控制/重开状态以专项执行记录为准，故障注入不算正常实体验收。

2026-10-12 round30最终可执行本机验收：指定现有账户/Thread的新native生成、上传编辑、实际草图编辑和Images生成/编辑共五项成功结算48,352 Token，额外更换AI后的恢复生成29,605 Token；正常Admin原管理会话可见六次reserve/capture/release及真实native/Images详情。原13+新6=19图刷新重开，6新图重新下载SHA一致，唯一Compacted保存；AI恢复gpt-6.1-sol/Image保留codex-gpt-image-2。uploads/sketch只添加不执行、明确工具互斥、名称讨论与普通Bash/文字保持。完整上游图片USD及旧三条缓存/金额未知不变；普通running停止与重试通过，不把提交到running间竞态或未执行的图片in-flight取消列为通过。最新独立复核、命令/退出、精确发布交付状态见Dream专项执行记录；未增加Schema/权限/配置或替代业务身份。


2026-10-12 停止专项：原Images Request.signal在strict解析usage后再次检查，已报告有效用量（包括合法0和结果损坏交集）沿known cancelled结算；原结算await后再拦截成功图片响应，已提交结算不回滚。Host在原turn关闭时取消所持HTTP socket，不增加控制接口。平台价格沿现有models.dev同步/审核/发布合同；供应商实际账单未公开，按用户指示排除验收。当前真实取消与重试状态见Dream专项执行记录，不能用静态/隔离测试称真实通过。
