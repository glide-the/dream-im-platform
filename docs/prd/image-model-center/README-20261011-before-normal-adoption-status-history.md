<!-- [Sync] 2026-10-10: 同步Dream模型用途、公开能力与历史索引；本轮验证见专项执行记录。 -->
<!-- [Input] Image Model Center request, current model/Gateway/billing PRDs, and the evidence-tagged source investigation. -->
<!-- [Output] Current product requirements and responsive interaction skeleton for Image model administration. -->
<!-- [Pos] Canonical business PRD for the Image Model Center; protocol and program details are defined by the formal design. -->
<!-- [Sync] 2026-10-09: define the minimum Codex/OpenAI Image model administration and calling experience. -->
<!-- [Sync] 2026-10-10: establish the independent Provider/Models/Pricing center and preserve prior text. -->
<!-- [Sync] 2026-10-10: restructure the PRD with Double Diamond and establish Admin platform pricing as settlement truth. -->
<!-- [Sync] 2026-10-10: align Provider simplification and shared models.dev pricing sync. -->
<!-- [Sync] 2026-10-10: restrict the center to configuration; existing logs and billing own Image request inspection. -->
# Image 模型中心 PRD

> Dream 模型分工更新前的完整原文见[历史稿](history-20261010-dream-model-division.md)。Dream 的设置与调用规则见[专项PRD](/Users/dmeck/project/ink-dream-memory/docs/prd/chat/image-model-call-division.md)。

> 本次更新前的完整原文见 [历史稿](history-20261010.md)。现行信息架构为独立 Image 模型中心，不再嵌套在 AI 模型中心。
> 本次 Provider 摘要移除与价格同步更新前的完整原文见 [增量更新前历史稿](history-20261010-pricing-sync.md)。

> 本次日志与计费归属修正前的完整原文见 [职责修正前历史稿](history-20261010-module-boundaries.md)。

> 历史保留：本 PRD 新增于业务域目录，没有覆盖或删改 `docs/prd/modules/04-model-catalog.md`、`05-gateway.md`、`06-billing.md` 的原文。共享规则仍以这些现行模块规范为基础。

## 第一钻石：发现与定义

### 1. 背景与问题

Ink & Memory 已有统一的 AI Provider、模型 alias、价格版本、调用权限、Gateway 请求和账本，但管理员不能明确管理“生成图片”和“编辑图片”的模型能力，已授权工具也没有独立 Images 入口。若把图片请求塞入 Messages/Chat 转换链路，会混淆主对话与工具调用；若另建一套 Image 控制台和账本，又会重复模型、权限和结算事实。

本次新增与 AI 模型中心并列的独立 Image 模型中心；内部同样提供 Provider、Models、Pricing 三个栏目，继续使用相同的提供商、模型、价格和账单基础。主对话继续使用现有 Responses/Messages/Chat 路径，图像工具使用独立 Images 接口，两类调用共享 Provider、权限、价格版本、请求生命周期和账本。

### 2. 目标与任务边界

### 2.1 目标

- 管理员从独立 Image 模型中心管理 Codex 和 OpenAI 图像服务、模型能力与平台价格，管理方式沿用 AI 模型中心。
- 已授权调用方可以提交描述生成图片，也可以提交参考图和修改要求得到编辑结果。
- 每次调用按上游返回的实际用量和 Admin 平台价格结算，并在请求记录中看到模型、Provider、状态、用量、费用和安全错误。
- 图片正文、提示词与凭证不出现在管理列表、日志或可查看的完整报文中。

### 2.2 本次范围

- Provider：Codex、OpenAI。
- 能力：图片生成、参考图编辑。
- Image 中心管理：仅 Provider 入口、Image 模型和平台价格。
- 日志与账单：在既有代理网关请求日志和 Token 计费使用记录中查看，不设 Image 独立请求页面或入口。
- 调用：同步、非流式 Images 生成和编辑。
- 计费：复用现有 micro-USD、价格版本、预留、结算和账本。

### 2.3 不在范围

- 其他 Provider、创作画布、图片资产管理、历史图库和后台生成任务。
- Claude Code 主循环改造、对话式多轮图片生成或 Messages/Chat 自动转换。
- Provider 间自动切换、两条 Image 接口自动互换、独立计费账本。
- 管理员在控制台直接发起图片创作。

### 3. 概念与业务规则

### 3.1 Image 模型

Image 模型仍是现有模型目录中的稳定 alias。模型可以具备“生成图片”“编辑图片”中的一个或两个能力；没有对应能力的模型不能用于该操作。停用后不再接受新调用，但历史请求和费用保持不变。

### 3.2 Provider

图像服务沿用现有 Provider 配置和凭据状态。管理员在 Image 中心的 Provider 栏目创建或修复共享连接，不重复维护账号或凭据。只有 Codex 与 OpenAI Provider 可以承载本次 Image 能力。

### 3.2.1 Dream 的两项模型选择

Image 中心的“Images 图像生成”和“Images 图像编辑”仅声明独立图片接口能力，供 Dream 用户明确要求 image_gen 工具时使用。它们不能使主对话获得内置图片能力，也不能让图片专用模型成为 AI 默认模型。图片专用模型仍可保留原稳定别名；普通文字模型的既有使用资格继续保留。

Dream 在 AI 模型下方独立选择 Image 模型，仅影响此后 image_gen 调用。未选择或选择失效时由用户重新选择，不以 AI 模型或其他图片模型代替。目录同时表达图片操作能力、配置准备情况和当前用户调用资格；主对话图片生成、编辑能力另行表达，当前尚未开放。上传或草图只是消息素材，不发起生成或编辑。

本次没有新增主对话能力勾选、订阅规则或数据库结构。主对话内置图片成功路径、意图分工和真实模型验收仍属于 Dream 专项目标，不能以 Image 中心的技术检查代替。

### 3.3 价格版本

每个 Image 模型使用既有价格版本和生效窗口。Admin 平台价格是调用方结算的唯一价格真值，分别覆盖文本输入、图片输入和图片输出 Token。OpenAI API、models.dev、Codex 公开资料或内部定价记录可以作为管理员制定平台价格时的参考，但不是运行时门槛，也不代表上游对该次请求实际收取了同额费用。Codex included usage 不转换为逐请求美元成本，不要求 credit 到美元换算。价格变更创建新版本，历史请求保存实际采用的平台价格快照。结算使用上游实际返回的 Token 明细；不得默认按图片张数收费、虚构 Token，或把缺失用量当作零费用。

配置型事实遵循：

- `default`：模型 alias 关联的默认 Provider 与上游型号。
- `desired`：管理员保存的模型能力、启停和价格版本。
- `effective`：调用时仍满足 Provider、模型、权限与有效价格的配置。
- `revision`：价格版本、Provider 认证和路由分别沿用各自 revision；模型能力修改由现有审计记录，不宣称 capability 本身已有不可变版本。
- 状态转换：草稿/未就绪不能调用；就绪且启用后可调用；停用只阻止新请求。

### 3.4 授权与调用

调用方必须使用具备 Images 权限的 Gateway 身份，并满足当前订阅权益、模型权限和额度。生成与编辑共用一项最小 Images 调用权限；模型能力继续区分具体操作。

### 3.5 请求与隐私

请求记录只保存排障和结算所需的摘要。提示词、参考图、mask、生成图片、Provider 凭据和完整上游正文不进入请求 payload 日志，也不能通过二次确认查看。

### 3.6 重复、失败和恢复

相同幂等标识不会重复调用 Provider。输入错误、权限不足、模型停用和配置缺失应在调用 Provider 前拒绝。Provider 明确失败时释放未使用预留；取消、超时或用量不明时不得盲目重试或按零费用成功结算，管理员可以凭请求 ID 排查，调用方用新的业务意图决定是否再次提交。

## 第二钻石：方案展开与交付定义

### 4. 功能模块

本节只描述用户获得的能力；接口报文、字段校验和程序状态放在正式设计中。

### 4.1 Provider 管理

管理员可以在 Image 模型中心的 Provider 栏目查看可用于图片服务的 Codex/OpenAI 连接状态，新增或修改连接、凭据和启停状态。这样可以复用统一的密钥保护与连通性管理，不需要在图片页面重复录入账户。

### 4.2 图像模型管理

管理员可以在 Models 栏目查看、添加、修改、启用和停用 Image 模型，为稳定 alias 选择 Provider 与上游型号，并声明生成、编辑能力。列表说明 Provider、平台价格、Images 权益、预留预算与启停状态，使管理员知道模型为什么可用或不可用；参考价格来源和预留依据作为非阻断审计信息单独展示。

### 4.3 计费管理

管理员可以在 Pricing 栏目为 Image 模型创建平台价格版本，分别配置文本输入、图片输入和图片输出价格，并查看生效区间。与 AI 模型中心相同，管理员可以使用“models.dev 同步”取得参考价，在审核页比较来源、选择模型、补充平台图片输入价并发布新版本。没有参考价的模型仍可手工定价。管理员也可以记录 OpenAI API 或内部定价记录作为参考依据。请求记录显示实际用量、平台结算金额和结算状态；上游成本没有可靠数据时显示未知，不以平台结算价冒充上游成本。

### 4.4 图像生成

已授权调用方可以提交图片描述、选择已启用且具备生成能力的模型，并在单次响应中得到完整图片结果。调用记录与普通 Gateway 请求使用同一个请求 ID 和结算链路。

### 4.5 图像编辑

已授权调用方可以提交一张或多张参考图片及修改要求，选择具备编辑能力的模型，并得到完整编辑结果。不被所选 Provider 支持的编辑选项会明确拒绝，不会被静默忽略。

### 4.6 日志与账单（既有系统）

管理员在代理网关的请求日志中查找图像生成和编辑调用，按模型、Provider、状态和时间排查安全错误。在 Token 计费的使用记录中核对实际用量、价格快照、平台金额和结算状态。两处使用同一个请求 ID；Image 中心只维护配置，不提供请求记录入口。图片正文未被捕获，有完整报文权限也不能读取提示词或图片内容。

### 5. 管理员完整使用流程

1. 从侧栏“Image 模型中心”进入独立中心的 Provider、Models 或 Pricing。
2. 在 Provider 查看连接准备情况；需要时新增或修复 Codex/OpenAI 连接，保存后仍留在 Image 中心。
3. 在 Models 栏目添加稳定 alias，选择 Provider 与上游型号，勾选生成和/或编辑能力。
4. 在 Pricing 栏目手工创建平台价格版本，或使用 models.dev 同步进入价格审核。审核参考来源与文本输入、图片输出价格，保留或补充平台图片输入价，选择生效时间后发布；同步本身不直接调价。
5. 确认模型卡显示 Provider、价格和能力均就绪，再启用模型。
6. 在既有 Gateway Key/订阅权益中授予 Images 调用权限和模型资格。
7. 调用方通过独立 Images 生成或编辑入口发起请求并得到图片。
8. 从侧栏“代理网关 → 请求日志”排查调用，从“Token 计费 → 使用记录”核对用量和费用；选择调用类型即可查找生成或编辑，不接触正文或凭据。
9. 调价时创建新版本；停止服务时停用模型或 Provider，历史记录不改变。

### 6. 页面与交互骨架

### 6.1 桌面

~~~text
┌ Admin 侧栏 ────────────┬ Image 模型中心 ─────────────────────────────┐
│ AI 模型中心             │ Provider | Models | Pricing                │
│   Provider              ├───────────────────────────────────────────┤
│   Models                │ Provider：账号卡、[新增][设置]              │
│   Pricing               │ Models：筛选、图像模型卡、[新增][设置][定价]│
│ Image 模型中心           │ Pricing：版本表、[models.dev同步][新版本]    │
│   Provider              │                                           │
│   Models                │                                           │
│   Pricing               │                                           │
└─────────────────────────┴───────────────────────────────────────────┘
~~~

- Image 中心是侧栏独立分组，不是 AI 中心的子栏目。
- 内部只有 Provider、Models、Pricing 三个栏目和相关配置操作，不显示请求记录或账单入口。
- 图像日志与账单分别归属侧栏的代理网关和 Token 计费，沿用现有页面与详情弹窗。
- 三个栏目分别对应 URL，可以分享当前页面及 URL 上已有的筛选；不承诺跨栏目自动保存全部筛选。
- 模型、Provider 和价格编辑复用现有全页表单，保存、取消和返回都保持 Image 上下文。结束价格复用现有弹窗；请求详情只在日志与计费模块打开。
- Provider 不显示额外就绪汇总。价格同步使用与 AI 中心相同的全页审核；审核表与价格表各自在容器内横向滚动，操作可以换行，不额外增加确认弹窗。
- 普通保存不新增确认；风险操作沿用现有确认方式。
- 侧栏与主内容独立纵向滚动；表格只在其容器内横向滚动。全页表单标题/操作固定，字段区域滚动。

### 6.2 窄屏

~~~text
┌ 顶栏 / 导航菜单 ───────────────────┐
│ Image 模型中心                     │
│ Provider | Models | Pricing   →    │  栏目横向滚动
├────────────────────────────────────┤
│ [添加] [筛选]                      │  按钮可换行
│ 连接卡 / 模型卡：单列               │
│ 价格表：容器内横向滚动              │
│ 编辑字段：单列、纵向滚动            │
└────────────────────────────────────┘
~~~

- 不产生整页横向溢出，不增加创作画布或遮挡正文的悬浮操作区。
- 表单沿用 AI 模型中心布局，字段与关联错误就近显示。
- 弹窗限制在视口内，标题与操作固定，正文独立滚动。

### 7. 页面关系

| 起点 | 操作 | 目标 |
| --- | --- | --- |
| Image / Models | 配置 Provider | 本中心 `/admin/image-models/providers`，复用已有 Provider 管理 |
| Images / 模型 | 添加或设置模型 | 本中心模型创建/编辑页，复用共享表单并保留 Image 返回路径 |
| Images / 模型 | 添加价格 | 本中心价格创建页，预选模型并返回本中心 Pricing |
| Image / Pricing | 结束版本 | 现有价格结束对话框 |
| Image / Pricing | models.dev 同步 | 本中心价格审核页；重新同步保持本中心，应用或取消返回本中心 Pricing |
| 代理网关 / 请求日志 | 筛选生成、编辑并查看请求 | 现有 Gateway 请求详情的安全摘要模式 |
| Token 计费 / 使用记录 | 筛选调用类型并查看费用 | 现有使用记录、图像用量与价格快照详情 |
| 请求详情 | 查看完整报文 | Image 请求不可用，并说明正文按安全策略未捕获 |

### 8. 验收要求

- IMG-01：Image 模型中心与 AI 模型中心为并列的独立管理中心，内部均为 Provider、Models、Pricing 三栏；Image 中心没有请求记录或账单入口。新增、编辑、调价与返回不跳回 AI 中心；日志与账单使用已有模块、权限和视觉规范。
- IMG-02：仅 Codex/OpenAI 可配置为 Image Provider；凭据不进入浏览器回显、请求日志或图片结果。
- IMG-03：模型可独立声明生成/编辑能力；停用、缺 Provider、缺数值预留预算、缺有效平台价格或缺权限时在上游前拒绝；缺参考来源不阻断调用。
- IMG-04：价格按文本输入、图片输入、图片输出的实际上游 Token 用量和 Admin 平台价格结算，历史版本和请求价格快照保持不变；上游参考价格不替代平台价格。
- IMG-05：生成返回完整图片结果；编辑接受参考图并返回完整图片结果；不支持的字段明确报错。
- IMG-06：重复请求不重复调用或扣费；取消、超时、用量缺失不会按零成功结算或自动跨 Provider 重试。
- IMG-07：管理员在已有请求日志中查看模型、Provider、操作、状态和安全错误，在已有计费使用记录中查看 Token 明细、价格快照和费用；调用类型筛选区分生成、编辑与文本，旧 Image 请求书签跳转到日志。
- IMG-08：任何角色和确认流程都不能从 Admin 请求记录读取 prompt、参考图、mask、生成图片或凭据。
- IMG-09：现有 Messages、Chat、Models、Provider、文本价格和账本回归通过，没有新增环境分支或第二套持久化体系。
- IMG-10：桌面与 390px 窄屏均可完成 Provider 跳转、模型/价格配置和请求查看，栏目及局部表格滚动互不干扰。
- IMG-11：Image Pricing 提供与 AI Pricing 同款 models.dev 同步；管理员审核后发布平台新版本。保留或显式配置图片输入价，不把未匹配或缺失分项当作零价，不改历史费用，也不影响文本价格同步。

## 文本模型兼容

Image中心的加入应保持原有文字模型访问。Messages/Chat目录沿用现有订阅和通用Token allowance规则，不能仅因为缺少独立模型plan entitlement就关闭原可调用的文字模型。Images继续使用图片能力、图片价格和独立图片授权。当前目录的endpoint `entitled`表示实际端点资格，也包含已有allowance-only文字资格，不能当作独立plan行存在的证明。此修订不修改订阅、权限、Schema或账本。

## 主对话接口选择补充（2026-10-10）

同一通用OpenAI连接可在原Provider表单选择上游实际支持的Chat或Responses主对话接口。旧配置默认Chat，该选择不替换Image模型，也不启用主对话内置图片。独立Images生成/编辑沿用原连接与能力设置。停用创建后先登记模型再激活；切换接口经过同一接口的最小验证，失败保留原配置，版本冲突保留草稿并重新核对。托管连接不提供这个覆盖入口。

正文中的图片能力标记仍指独立Images；主对话图片能力的开放条件及正常、异常图见[专项正式稿](/Users/dmeck/project/ink-dream-memory/docs/design/claude-agent/image-model-call-division.md)。
