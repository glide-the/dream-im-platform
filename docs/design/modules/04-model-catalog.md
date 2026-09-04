<!-- [Input] Model Catalog PRD, Provider lifecycle contract, and implemented Admin resource behavior. -->
<!-- [Output] Current Provider, Model, Pricing, discovery, validation, and responsive interaction rules. -->
<!-- [Pos] Module interaction contract for `/admin/models/**`; security details link to the cross-domain auth design. -->
<!-- [Sync] 2026-09-04: add managed post-connect catalog snapshots, retry/apply boundaries, and unsupported-model handling. -->

# 模块交互：Provider、Model 与 Pricing

> 返回：[全局交互规范](../refine-admin-ui-v3-interaction-design.md) · PRD：[模型供应链](../../prd/modules/04-model-catalog.md) · 安全合同：[Provider 认证能力与凭据生命周期](../provider-authentication-capability-and-credential-lifecycle.md)

> 实现状态：核心页面与同步流程已实现；RPM 编辑明确不开放。

## 0. Current / Target / Release Gate

| 分层 | 交互边界 |
|---|---|
| Current / Implemented | Provider/Model/Pricing/Discover/同步页面与 Dream `/api/product/v1/me/model-catalog` allowlist 已实现；用户—模型例外位于 Gateway 限流唯一入口，RPM 编辑未开放。 |
| Release candidate | 无静态模型 fallback；真实外部 Provider canary 仍需验证未定价/未授权 alias 不调用上游。 |
| Release Gate | 历史 Pricing 只读，Secret 无 DOM/回读，未授权/未定价 alias 不进产品 catalog，旧 permissions 路由只跳 Gateway。 |

## 1. Provider

列表采用单列紧凑条目：身份（name/code/protocol）→ managed account label 或 generic Endpoint/Credential → 模型数/请求摘要 → 常显操作。每个 managed Provider 卡片必须直接显示 `账号：label/未连接`；同产品第二个账号通过新建 Provider 表达。筛选 keyword/protocol/status/sync status；不依赖 hover。

新增/编辑为覆盖 Admin Shell 的固定全窗口层：64px Header、可滚动中段、72px Footer。字段：preset/protocol select、code/name text、base URL、Credential password、status、timeout/max retries number、capability 限定的 auth mode/output token param select、未知 config JSON。编辑不回填 Secret，空值表示不轮换。

Provider 卡片和编辑页分别显示 status、credential configured、当前 effective auth revision 与该 revision 的 validation status/time。存量 active/unverified 继续服务但不得伪装为已验证；disabled 新建草稿为 unverified。新 Provider 不允许直接 active 创建，流程固定为 disabled → 登记 Model → enable；此后启用或 credential/base URL/authMode/outputTokenParam 变更（即使仍为 disabled）先同步验证 candidate，成功才原子生效；失败时显示“新配置验证失败，当前生效配置未改变”。验证 Model 由服务端按 `enabled DESC, code, id` 确定选择，不增加 UI selector；模型目录配置和普通运营字段更新不增加 auth revision。

Provider 卡片与设置页常显 `删除 Provider`。确认后，服务端在事务中重复检查 Provider 下所有 Model 及其 Pricing：任一存在即 409，UI 保留对话框并提示先删除 Pricing 和模型，不自动级联。托管账号必须先走现有 disconnect/revoke；进行中授权和未完成 revoke 继续阻断。成功删除表现为 list/detail 不再可见、Gateway 不再可解析，同时用 tombstone 保留 Usage、计费、OAuth 撤销和审计引用；静态 Secret 会立即清除，auth revision/epoch 同步递增以拒绝迟到写入。

`generic` Provider 不显示 OAuth 状态，Bearer 仍只表示静态 credential header 方式。`codex | xai | github_copilot` Provider 在编辑页显示该 Provider 唯一的账号面板：部署 readiness、首次连接/同一账号重新授权、Device 用户码与验证页、等待/取消、账号到期，以及加密 outbox 支持的断开/远端撤销 outcome 与失败恢复；浏览器不接收 device/access/refresh/source token。账号面板不提供账号池、默认账号或跨 Provider 改绑。产品 adapter 只有 registration、集成身份、加密 key、Endpoint policy、可由当前 key 解密且 schema/product 有效的 connected credential、Model/Pricing 与 Provider active 全部就绪时才对 Gateway effective；Codex/xAI 注册资格和 Copilot integration/entitlement 不被 UI 假定为实时或必然可用。WIF 与 Claude Code/Codex runtime 自主管理登录仍属 Deferred。

Provider 主写入与 Discover 是两个可区分结果。Ink 现有 generic Provider 在新建成功后自动 Discover 一次，并保留卡片手动重试；静态 credential 后续验证/普通保存不建立周期同步。`codex | xai | github_copilot` 则在 managed credential/account 事务提交后，以该 Provider 唯一账号自动执行一次 model discovery：Codex 使用账号 ID 调 ChatGPT Codex models，xAI 调 `/v1/models`，Copilot 调账号级 `/models` 并保留 vendor/model-picker/capabilities。该动作不是定时任务，失败也不回滚已连接账号；账号页显示安全错误并允许 `POST /api/admin/providers/:id/discover` 手动重试。

成功 Discover 只保存可审查 snapshot，不直接写 Model 或 Pricing。Diff 固定为 `new | existing | conflict | unsupported`；Copilot 中 `vendor=openai` 或只能走 Responses、与当前 `openai_chat` Gateway 不兼容的模型属于 `unsupported`，不可勾选。Apply 才创建所选新 Model，且初始 `disabled`；已有 Model 只刷新安全 catalog 元数据，本次缺失的本地 Model 不改变，Pricing 始终由独立版本流程管理。

Discovery generation 至少固定 adapter/产品合同版本、Provider auth epoch、account ID/account epoch、credential revision 与 registration fingerprint；generation 与规范化 models 共同生成 catalog hash。相同 Provider + catalog hash 通过 PostgreSQL transaction advisory lock 收敛并发，并可复用 Provider 未变化的未过期 ready snapshot；Apply 重新检查当前 generation/models hash 与 Provider 更新时间，stale 时返回 409 并要求重新发现。

## 2. Model 与 Pricing

Model 列表列 provider、alias、upstream model、capabilities、context/output、enabled、updated。独立表单使用 Provider combobox、alias text、候选 upstream model combobox + 受控自定义、capability checkboxes、整数窗口、enabled switch。

Pricing 列表列 model/tier、四类价格、markup/discount、source/status/effective window。新版本独立页：Model/Tier relation → 当前版本 → 四类 micro-USD integer → markup/discount → effective time → before/after diff。历史行只读；无直接编辑窗口。

目录同步页显示 catalog version/hash、exact/normalized/ambiguous/unmatched 证据；只有 exact 默认选。

## 3. 模块边界

模型中心顶部只显示 Provider、Models、Pricing。用户—模型例外限制属于 Gateway 限流执行策略，统一在 `/admin/gateway/rate-limits#user-model-permissions-manager` 管理；旧 `/admin/models/permissions` 仅保留兼容跳转，不再渲染重复页面。

## 4. 状态、响应式与验收

- Credential、连接、Discover、Pricing 覆盖分别显示，不能合并成一个“健康”。
- Desktop Provider 操作常显；Mobile 条目改为纵向，主动作仍在首屏，配置层全屏。
- JSON/URL/alias 长值局部换行；价格使用 mono/tabular。
- UI-MOD-01：历史 Secret 不进入 DOM；一次草稿显隐不持久化。
- UI-MOD-02：Discover 失败不显示 Provider 保存失败；stale Apply 可恢复。
- UI-MOD-03：价格单位、旧/新版本和生效时间同时可见。
- UI-MOD-04：模型中心不存在“模型权限”Tab 或侧边导航；旧路径跳转到限流策略的用户—模型例外限制区。
- UI-MOD-05（Target release gate）：产品 catalog empty/403/503 显示真实空集或不可用，不插入 Auto/Claude/GPT 静态选项；新 Pricing 生效不改历史 Request 快照。
- UI-MOD-06（Target release gate）：active Provider 的认证相关 candidate 验证成功后才切换 effective revision；失败、超时或 stale 409 保持旧 effective，所有响应和 DOM 均无 Secret。
- UI-MOD-07：一个 managed Provider 最多显示一个账号；同产品双账号必须显示为两个可区分 Provider，分别授权、调用和断开。
- UI-MOD-08：Provider 删除只有一次确认；Model/Pricing 未清空时明确 409 且记录不变，零依赖时从列表消失、详情 404，历史请求与账本仍可查询。
- UI-MOD-09：managed auth 成功但自动 Discover 失败时，poll 仍返回 connected account 与安全 `catalogSync.failed`；页面不宣称认证失败，手动重试可生成 ready snapshot，响应/DOM 均无 Secret。
- UI-MOD-10：自动或手动 Discover 成功只进入 review；Apply 后新 Model 为 disabled、已有 Model 只刷新 catalog 元数据、缺失 Model 不变，且没有 Pricing 行被隐式创建或修改。
- UI-MOD-11：Copilot catalog 中与当前 Gateway dialect 不兼容的 OpenAI/Responses 模型显示为 unsupported 且不可选择；上游隐藏模型不进入可应用候选。
