# cc-switch 模型设置与计费设计接入规范

> 状态：页面实现的强制设计输入。审计日期：2026-08-08。源项目 `/Users/dmeck/project/cc-switch` 只读；允许移植其页面结构、React 交互和纯函数逻辑到 Admin，但不修改源项目、不复制本地数据库或真实凭据。

## 1. 采用范围与证据

模型设置与模型计费直接采用 cc-switch 的信息组织和交互骨架，再使用 Ink & Memory UI Design v2 与 `docs/prd/color_system` 完成品牌化。主要证据如下：

产品语义也采用 cc-switch 的“注册供应商后由代理统一出站”，但落为 PostgreSQL 多用户服务：`Provider → Model alias → Pricing → Gateway Key`。主要调用方是 `ink-dream-memory`；它只调用 Ink Memory 的 Anthropic/OpenAI 兼容入口，不保存上游 Provider Secret、Endpoint 或真实型号。

| cc-switch 证据 | 可复用模式 | Ink Memory 落点 |
|---|---|---|
| `assets/screenshots/main-zh.png`、`ProviderList.tsx`、`ProviderCard.tsx` | Provider 卡片列表突出名称、Endpoint、当前使用、健康/余额摘要和弱化操作 | `/admin/models/providers` 使用同构 Provider 卡片行、协议切换、搜索、健康状态与快捷操作；不再使用通用表格 CRUD 作为主界面 |
| `assets/screenshots/add-zh.png` | 新增 Provider 使用全屏面板，先选预设，再填写分区表单，底部固定取消/新增 | Provider 新增/编辑独立全屏面板；协议预设仅预填字段，不绕过验证 |
| `src/components/common/FullScreenPanel.tsx` | 返回按钮、固定 Header、独立滚动内容、固定 Footer、Escape 与滚动锁定 | `AdminFullScreenForm`；Web 端补充焦点锁定、关闭后焦点归还和未保存确认 |
| `AddProviderDialog.tsx` / `EditProviderDialog.tsx` / `src/components/providers/forms/ProviderForm.tsx` | Provider 表单按预设、基础信息、协议字段、高级配置组织；编辑初值与用户草稿隔离 | `/admin/models/providers/new`、`/[id]/edit` 独立页面；服务端值只在进入时装载一次，重新获取不得覆盖脏表单 |
| `BasicFormFields.tsx` / `ApiKeyInput.tsx` | 名称/备注网格、图标选择、密钥 password 输入与显隐 | 名称/Code/协议/Endpoint/凭据分区；已配置凭据仅显示指纹与“已配置”，不回填 Secret |
| `EndpointField.tsx` / `ModelDropdown.tsx` | Endpoint 与模型不是自由 JSON，而是具名控件与可选项 | Endpoint 使用 URL 输入；模型使用真实 Provider 关系选择与常用型号 Dropdown，并允许受控自定义型号 |
| `docs/user-manual/assets/image-20260108011730105.png` | Usage 顶部时间范围和四类事实指标，趋势图承接概览 | `/admin/billing/usage` 顶部筛选 + 事实摘要 + 趋势；无数据时显示 0 与空态说明，不生成指标 |
| `docs/user-manual/assets/image-20260108011859974.png` | 请求日志、Provider 统计、模型统计页签；应用/Provider/模型/时间筛选 | 使用记录按相同结构组织；筛选映射真实白名单 SQL 字段 |
| `UsageDashboard.tsx` / `UsageHero.tsx` / `UsageTrendChart.tsx` | 全局筛选驱动 Hero、趋势和三个统计页签；刷新频率可控 | 相同联动；管理员可关闭自动刷新，刷新时保持选择与表格页码规则 |
| `RequestLogTable.tsx` / `RequestDetailPanel.tsx` / `ProviderStatsTable.tsx` / `ModelStatsTable.tsx` | 请求、Provider、Model 三页签和请求详情分区 | Gateway/Usage 共享只读详情 Drawer，增加价格快照、结算与账本关联 |
| `PricingConfigPanel.tsx` / `PricingEditModal.tsx` | 定价列表内新增/编辑入口，定价使用全屏表单并按 Token 类型录入 | `/admin/models/pricing` 使用全屏“创建价格版本”；已生效版本只允许结束/停用，不允许改价或删除 |

## 2. 不直接复制的差异

cc-switch 是本地代理配置工具，Ink Memory 是 PostgreSQL 多用户运营控制台。以下差异为硬边界：

- 不复制 cc-switch 本地配置存储、Tauri 窗口拖拽区、应用级可删除定价或覆盖式保存。
- Provider、Model、Pricing 继续使用 `ai_providers`、`ai_models`、`ai_pricing_rules`，所有管理写入经 Session、permission、Zod、事务和审计。
- API Key 只写入加密列；读接口只返回 `credential_configured` 与 `api_key_fingerprint`。显隐按钮只显示本次尚未提交的输入，不读取历史明文。
- 金额在数据库/API 中为整数 micro-USD；UI 同时显示 `$x.xxxxxx / 1M tokens` 与精确 micro-USD，提交前转换并回显转换结果。
- 已被请求引用或已开始生效的 Pricing 不原地改价。新价格通过“创建新版本”写入；必要时在同一事务中结束旧规则的 `effective_to`。
- `gateway_requests`、Token Usage、`billing_ledger_entries`、Audit 只读；异常结算是显式、审计化的补偿动作，不是编辑请求或账本。
- cc-switch 的本地代理在本产品中对应 `/v1/messages`、`/v1/messages/count_tokens`、`/v1/chat/completions`、`/v1/models`。外部只提交 Gateway Key 与 `ai_models.code`，服务端才解密 Provider Secret 并替换为 `upstream_model`。
- cc-switch 的卡片数量摘要仅在真实聚合 API 可用时呈现；无真实聚合不显示装饰性或估算指标。
- cc-switch 的 Tauri command、Rust 代理 server、配置文件接管、热切换和本地 SQLite/状态库不可直接复制；其协议转换、模型映射、usage 解析和错误分类语义必须移植到 `app/lib/gateway/**`，持久化统一使用同一个 `DATABASE_URL` 指向的 PostgreSQL `ink-memory`。

## 2.1 代码移植边界

| cc-switch 源码 | Admin 对应实现 | 移植方式 |
|---|---|---|
| `ProviderList` / `ProviderCard` / `ProviderActions` / `ProviderHealthBadge` | Provider 注册表、行内启停、测试、编辑、监控入口 | 复用组件分层和交互顺序；数据改由 Refine/API 获取，拖拽排序在没有持久化优先级前不呈现 |
| `ProviderPresetSelector` / `ProviderForm` / `ApiKeySection` / `EndpointField` / `ModelDropdown` | Provider/Model 独立配置页 | 复用预设驱动和具名控件；Secret 只写加密，模型下拉来自当前 Provider/受控内置 catalog |
| `ProxyPanel` / `ProxyToggle` / `FailoverToggle` | Gateway 运行状态与路由健康 | 不复制桌面代理开关；改为展示 Next.js 兼容端点、Provider active 状态、最近请求和可审计的启停命令 |
| Rust `proxy/providers/*`、`model_mapper`、`usage/parser`、`error_mapper` | `app/lib/gateway/**`、`app/lib/billing/**` | 按现有 Anthropic/OpenAI handler 逐项对齐协议、流式事件、Token、错误和模型 alias；不得引入 Rust/Tauri runtime |
| `UsageDashboard` 及其 Hero/Trend/Table/Detail | `/admin/billing/usage` | 复用筛选联动、三页签、Drawer 详情和刷新规则；SQL 聚合只读取 `gateway_requests` |
| `PricingConfigPanel` / `PricingEditModal` | `/admin/models/pricing`、`/new` | 复用四类 Token 录入和模型选择；保存语义改为 PostgreSQL 价格版本，不覆盖历史 |

## 3. 页面容器决策

| 操作 | 容器 | 原因与行为 |
|---|---|---|
| Provider 创建/编辑/凭据轮换 | 独立路由全屏页 `/admin/models/providers/new`、`/[id]/edit` | 字段跨基础、连接、凭据和运行策略多个分区；固定底部操作；关闭脏表单需确认 |
| Model 创建/编辑 | 独立路由全屏页 `/admin/models/models/new`、`/[id]/edit` | 与 cc-switch Provider 设置保持同一配置语言；包含 Provider 关系、Model Dropdown、Token 上限、能力与启用影响 |
| Pricing 新版本 | 独立路由全屏页 `/admin/models/pricing/new` | 财务高风险；必须展示旧版本、重叠检测、金额换算和影响摘要 |
| Provider 停用、Model 停用、Pricing 结束生效 | 确认 Modal | 展示关联对象数量、影响范围、权限要求和不可逆/可恢复说明 |
| Usage/Gateway Request 详情 | 右侧 Drawer；390px 变全屏 | 只读核对，在列表筛选上下文中快速返回；支持复制请求 ID 与跳转账本 |
| Provider/Model 统计详情 | Drawer | 保持 Usage 仪表盘筛选与时间范围，不重置上下文 |
| 定价删除 | 不提供 | 历史安全边界；仅未生效且未被引用的错误记录可走受控后台兼容流程，不开放通用 UI |

Provider 卡片的 Endpoint Speed Test 被适配为纯 reachability；Model 卡片另提供 Credential/Model validation。前者不带 Secret，后者使用服务端加密 Secret 发送 1 Token 上限请求且不读取响应内容。cc-switch 的桌面“接管本机配置”ProxyToggle 不复制：Ink Memory Gateway 是部署后始终提供 `/v1/*` 的服务端代理，是否开放由部署环境、Gateway Key 与路由健康决定，而不是浏览器内开关。cc-switch 的本地 failover queue 也不能直接套用到当前唯一 alias→Provider 结算快照；若未来引入多上游候选，必须先新增版本化路由策略、逐尝试请求审计与费用归属，而不能在客户端静默切换。

## 4. Provider 字段与控件

| 数据项 | 列表/详情展示 | 创建/编辑控件 | 数据源与校验 | 安全/状态 |
|---|---|---|---|---|
| `id` | 详情等宽文本 + 复制 | 不可编辑 | 服务端生成 | 不作为人工输入 |
| `code` | 主标识徽标 | 创建时文本；编辑只读 | `^[a-z0-9][a-z0-9._-]*$`，2–80，唯一 | 409 显示占用对象；不静默改名 |
| `name` | 主标题文本 | 单行文本 | 1–120 | 必填，行内错误 |
| `protocol` | Anthropic/OpenAI 标签 | 创建时预设/下拉选项；编辑只读 | `anthropic` / `openai` | 改协议等价新 Provider |
| `base_url` | 可截断 URL + 外链 | URL 输入 | 合法 URL，最长 2000；预设可填充 | 保存前显示解析后的最终 Endpoint；不自动探测写库 |
| Provider credential | “已配置/未配置” + 指纹尾部 | password + 显隐 + 清空草稿 | 8–8000；启用时必须存在 | 历史 Secret 永不回填；轮换须二次确认和审计 |
| `status` | 状态徽标 | active/disabled 下拉 | active / disabled | 启用前校验凭据；停用需说明依赖模型/近期请求影响 |
| `timeout_ms` | `120 s` 数值 | 数字输入 + 秒/毫秒说明 | 1000–900000 整数 | 默认 120000 |
| `max_retries` | 数字 | Stepper | 0–5 整数 | 与超时并列 |
| `config.authMode` | 详情键值 | 下拉 | `x-api-key` / `bearer` | 非 JSON 自由编辑 |
| `config.outputTokenParam` | 详情键值 | 下拉 | `max_tokens` / `max_completion_tokens` | 只在适用协议显示 |
| `config` 其他键 | 折叠 JSON 预览 | “高级配置”JSON 编辑器 | 必须为 object；保留受管键 | 只有未知扩展键使用 JSON；Secret 键拒绝提交 |
| `created_at` / `updated_at` | 本地化日期时间 | 不可编辑 | 服务端 | 详情审计区 |

## 5. Model 字段与控件

| 数据项 | 列表/详情展示 | 创建/编辑控件 | 数据源与校验 |
|---|---|---|---|
| `provider_id` / `provider_code` | Provider 链接 + 协议标签 | 可搜索 Provider 下拉；编辑只读 | 真实 `/api/admin/providers`；只显示可读且非删除对象；FK 409 |
| `code` | 主标识等宽文本 | 创建文本；编辑只读 | 2–80、code regex、全局唯一 |
| `upstream_model` | 等宽文本 | 常用型号 Dropdown + 可自定义单行输入 | 1–200；实际可用性以上游 Provider 为准 |
| `display_name` | 主标题 | 单行文本 | 1–160 |
| `context_window` | 千分位整数 + tokens | 数字输入 | 正整数或空 |
| `max_output_tokens` | 千分位整数 + tokens | 数字输入 | 正整数或空；不得明显高于 context window，客户端提示、服务端为准 |
| `capabilities` | Chat/Streaming/Tools 等标签 | 复选组，不使用 JSON | 已知能力白名单；未知扩展在详情显示但不破坏 |
| `enabled` | 状态徽标 | 开关 | 启用前要求 Provider active；失败 409 提供 Provider 跳转 |
| 时间字段 | 日期时间 | 只读 | 服务端 |

Model 卡片的“验证配置”不是表单字段：按钮需 `models.write`，调用 `POST /api/admin/models/:id/validate`。服务端使用已加密 Credential 发送一次非流式、最多 1 Token 的上游请求，不读取或记录响应正文；结果只显示 operational/degraded/failed、HTTP 状态和耗时。该动作验证 Credential、协议和 `upstream_model`，与 Provider 的纯网络 reachability、外部 Gateway 的真实计费调用是三个不同验收层级。

## 6. Pricing 字段与控件

| 数据项 | 列表/详情展示 | 新版本控件 | 校验与财务边界 |
|---|---|---|---|
| `model_id` / `model_code` | 模型链接 | 可搜索模型下拉 | 真实 `/api/admin/models`；从模型详情发起时预选，提交后关系不可改 |
| `user_tier` | Tier 标签 | 可搜索/可创建枚举输入 | code regex；必须与重叠检测维度一致 |
| 四类 `*_price_microusd_per_million` | `$ / 1M` 主值 + micro-USD 辅助 | 十进制 USD 数字输入，UI 转换为整数 micro-USD | 非负、最多 6 位 USD 小数；提交前显示精确转换；不接受浮点 API 值 |
| `markup_bps` | 百分比 + bps | 百分比数字输入，辅助显示 bps | 0–100000 bps |
| `discount_bps` | 百分比 + bps | 百分比数字输入 | 0–10000 bps；与 markup 同时存在时显示计价公式 |
| `effective_from` | 日期时间 | 日期时间选择器 | ISO datetime；默认下一可用边界，不用固定假日期 |
| `effective_to` | 日期时间/“持续有效” | 可清空日期时间 | 必须晚于 from；重叠返回 409 并高亮冲突版本 |
| `status` | active/disabled/expired 语义状态 | 新版本单选；旧版本只允许结束/停用 | 已生效价格不可原地编辑金额 |
| 影响摘要 | 关联请求数、旧/新价格差、时间窗 | 只读确认区 | 仅展示真实查询；未知显示“暂不可计算”，不虚构 |

## 7. Usage 与 Gateway Request 展示规范

顶部全局筛选直接采用 cc-switch 结构：协议分段选项、Provider 下拉、Model 下拉、时间范围、刷新频率。筛选同时驱动事实摘要、趋势、请求日志、Provider 统计和模型统计；请求日志可以额外筛选状态/结果/错误码。

| 数据项 | 展示形式 | 交互 |
|---|---|---|
| 请求、用户、Provider、Model | 具名文本 + 辅助等宽 ID | 可复制；有权限时跳转关联详情 |
| 状态/结果/HTTP 状态 | 语义徽标 | 失败状态附错误恢复或人工核对入口 |
| Input/Output/Cache read/Cache write | 千分位整数，四类分列或紧凑双行 | 表头说明口径；不把缓存 Token 混入 fresh input |
| Provider cost / charged | 精确 micro-USD 转美元 | 详情展示价格快照、markup/discount 与结算差额 |
| 延迟/首 Token | `ms`/`s` tabular nums | 趋势与分位数仅来自真实聚合 |
| 时间 | 本地化日期时间 | 时间范围由服务端 UTC 边界查询，UI 标明时区 |
| 错误 | 错误码徽标 + 摘要 | 展开详情显示脱敏 message；不得泄漏请求 Secret |
| Ledger 关联 | 交易条目时间线 | 只读，跳转保留 `gateway_request_id` 筛选 |

请求详情 Drawer 分为：基本信息、路由与模型解析、Token 用量、价格快照与成本、结算/账本、性能、错误与响应摘要。`response_summary` 使用只读 JSON Viewer；不显示完整请求 Body 或凭据。

## 8. 状态、响应式与验收

- Loading 使用与最终结构同高的骨架；Empty 保留当前筛选并提供清除筛选；Error 分别处理 400、401、403、404、409、500/503。
- 全屏面板与 Drawer 初始焦点落在标题或首个错误字段；Tab 焦点锁定；Escape 遵循内层 Select/Dialog 优先；关闭后焦点回到触发按钮。
- 390×844 下 Provider/Model/Pricing 独立页全屏，底部操作区安全区固定；列表采用列优先级与局部横向滚动，不允许页面级横向溢出。
- 1440×1000 下 Provider 表单最大内容宽度 1120px；详情/Usage 保持密集信息层级，禁止无来源装饰性大卡片。
- light/dark 均使用 Ink Memory Token；不复制 cc-switch 的硬编码蓝色、灰色或默认 Radix/Shadcn 视觉。
- 自动化至少覆盖：Provider 新增/编辑/密钥不回显、Provider 停用影响确认、Model 关系选择、Pricing 新版本与 409 重叠、Usage 全局筛选、请求详情、移动端焦点与无溢出。
