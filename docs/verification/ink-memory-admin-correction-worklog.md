# Ink Memory Admin 单库与 cc-switch 纠偏工作记录

> 日期：2026-08-08  
> 安全说明：本记录只保留变量名和脱敏配置语义，不记录用户提供的任何真实 Token。

## Round 1：故障复现与重新规划

Optimized Prompt:

将 `ink-admin-memory` 修正为可运行的单 PostgreSQL运营控制台。唯一数据连接为 `DATABASE_URL`，数据库名必须为 `ink-memory`；移除 `STORY_DATABASE_URL`、双数据源池及相关文档、环境校验和运行分支。未来 `ink-dream-memory` PostgreSQL 迁移后，其真实 `users`、`story_workspace_*`、`workflow_*` 表直接部署到同一数据库，Admin repository 原名映射，不创建平行实体。复现当前不可用问题并修复启动、认证、路由、查询和错误恢复。

AI 模型中心按 `/Users/dmeck/project/cc-switch` 的 Provider、模型、Pricing、Proxy、Usage 与 Request Detail 页面及交互结构实现，并适配 Next.js、Refine、PostgreSQL、RBAC、审计和密钥加密。Provider 是代理供应商注册表，`ink-dream-memory` 只通过 Gateway Key、稳定模型别名和 Anthropic/OpenAI 兼容端点调用。所有表单明确使用 Modal、Drawer 或独立路由页面，并逐字段定义控件、选项来源、格式、校验、脱敏和错误恢复。不得记录真实密钥，不修改两个只读源项目，不触碰共享数据库写操作。

验证：单库隔离 PostgreSQL、代理 mock、TypeScript、lint、unit、build、1440×1000 与 390×844 Playwright。

## Round 2：PRD 与交互设计纠偏

Optimized Prompt:

更新主 PRD、数据接入审计、交互设计、字段控件矩阵和 cc-switch 适配文档，固定唯一架构：一个 PostgreSQL 实例、一个 `ink-memory`、一个 `DATABASE_URL`、一个连接池。迁移前 Story 页面展示真实缺表诊断，模型、网关、计费、权限和 Storage 保持可用。

逐文件建立 cc-switch 映射：`ProviderList/ProviderCard` 对应 Provider 卡片列表；`AddProviderDialog/EditProviderDialog/FullScreenPanel/ProviderForm/ProviderPresetSelector/ApiKeySection/EndpointField/ModelDropdown` 对应独立配置页；`UsageDashboard/UsageHero/UsageTrendChart/RequestLogTable/RequestDetailPanel/ProviderStatsTable/ModelStatsTable` 对应监控计费；`PricingConfigPanel/PricingEditModal` 对应价格版本流程。区分可移植的 React 结构、必须重写的 Tauri/Rust 服务和不得复制的本地客户端行为。

为每个数据项明确列表、详情和表单展示形式：文本、密码、URL、选项、Combobox、复选组、Switch、整数、USD/百万 Token、日期时间和 JSON；同时记录必填、默认值、选项来源、脱敏、只读与 400/403/404/409/503 恢复方式。Provider、Model、Pricing 使用独立路由全屏页，不以内嵌通用 Dialog 冒充独立配置页。

## 只读复现证据

- `pnpm env:check` 通过；Admin feature gate、Session、凭据加密和 bootstrap 配置存在。
- 当前 `DATABASE_URL` 指向 `localhost:5433/ink-memory`。
- 控制面已有 `admin_users`、`ai_providers`、`ai_models`、`ai_pricing_rules`。
- 同库缺少 `users`、`story_workspace_workspaces`、`story_workspace_stories`；因此 Story 模块不可用是确定性缺表结果。
- `/admin/login` 与 `/api/admin/auth/bootstrap` 均返回 200；未初始化、迁移或修改共享数据库。

## Round 3：单库与 cc-switch 代码实现

Optimized Prompt:

在不修改 `ink-dream-memory` 与 `cc-switch` 的前提下，实现 Ink Memory Admin 单 PostgreSQL 运行架构和 cc-switch 同构 AI 供应链。运行时只接受指向 `ink-memory` 的 `DATABASE_URL`，Story repository 与控制面共享同一 `pg.Pool`；Story 更新、状态流转和管理员审计必须在同一数据库事务内原子提交。业务表尚未迁入时，总览只降级 Story 指标并列出真实缺表，Provider、Model、Pricing、Gateway、Billing、RBAC 与 Storage 保持可用。

Provider 注册表采用 cc-switch 卡片、预设、Endpoint、Credential、运行状态、模型数量、24h 请求/成功率和可达性检查；可达性检查只请求受 SSRF 白名单约束的 `base_url`，不发送模型生成请求，不读取响应正文，不泄漏网络异常细节，使用短超时、RBAC、Origin 校验与审计。Provider、Model、Pricing 创建/设置使用独立路由页面；Model 使用 Provider 关系下拉、上游模型 ComboBox、能力复选组和 Token 限额；Pricing 使用四类 Token 的 USD/1M 输入并序列化为整数 micro-USD，只创建版本、不覆盖历史价格。所有 Secret 永不回填，DeepSeek 预设只包含公开 Endpoint 和型号，不包含用户 Token。

验收：TypeScript、定向 lint/unit 通过；Refine resource 注册 create/edit 路由；API 严格返回 400/401/403/404/409/500；旧 Story 平行表只通过新迁移更新弃用注释，不删除数据。

## Round 4：隔离数据库、E2E 与视觉验收

Optimized Prompt:

使用 `ink-admin-playwright-qa` 对 Ink Memory Admin 执行发布级验证。先运行 preflight，确认 3000/5433 端口和进程所有权；不得连接、迁移、清空或写入共享 `localhost:5433/ink-memory`。创建明确命名、可删除的一次性 PostgreSQL 16 容器，数据库名必须为 `ink-memory`，将唯一 `DATABASE_URL`、管理员 bootstrap/session/credential 加密测试值仅注入该进程；从 0000 到最新迁移全量执行，并加载 PostgreSQL-only 的 Story 与控制面 fixture。

依次运行 `pnpm env:check`、`pnpm exec tsc --noEmit`、`pnpm lint`、`pnpm test:run`、`pnpm build` 和单 worker focused Playwright。E2E 覆盖无 Session、401/403、Story 真实表查询与同事务写审计、外键/唯一 409、Provider Secret 永不回显、Provider 连通测试权限边界、Model/Pricing 版本关系、Usage/Balance/append-only Ledger、Gateway 请求与失败结算、RBAC、Storage、移除路由 404，并更新 Provider 独立配置页断言。视觉验收 1440×1000 和 390×844，检查页面级横向溢出、键盘焦点、移动导航、独立表单页、空/错/成功状态；浏览器 Provider 上游网络调用必须 mock 或只验证拒绝路径，绝不使用用户真实 Token。最后停止自有服务器并删除精确命名的临时容器，记录命令、测试数量、截图路径、未执行外部场景和清理证据。

Optional Enhancers:

- 对 Provider 新建页、模型设置页和 Pricing 版本页分别保存桌面/移动截图，便于与 cc-switch 参考图逐项比较。
- 在隔离数据库中查询迁移注释、审计条数和 Story/控制面表共库证据，形成可复核 SQL 摘要。

## Round 5：最终边界审计与交付

Optimized Prompt:

对 `ink-admin-memory` 本轮交付做最终证据化审计并输出可直接验收的中文结果。检查 Git diff 与未提交文件，确认只修改 Admin 项目，未覆盖用户既有工作；确认运行时代码、环境模板和初始化脚本只有一个 `DATABASE_URL`、一个 `pg.Pool`、数据库名 `ink-memory`，无 SQLite、第二业务连接或隐式回退。确认旧 Story 平行表未删除且仅通过可回滚注释迁移标记弃用，真实 Story 表与审计在同库同事务；确认 Storage API、file-storage/shared lib 和移除 PWA 路由保持不变。

核对 PRD、数据接入审计、cc-switch 适配设计、交互设计和字段控件矩阵路径及内容，确保 Provider/Model/Pricing 独立页面、Modal/独立页决策、每字段展示/输入控件、RBAC、状态、错误恢复、响应式和安全约束无矛盾。核对 Provider 注册表、模型 alias、四类 Token 版本化定价、Gateway 代理与 Usage/Request/Ledger 监控实现；真实 Token 不得出现在 diff、日志、测试、文档或数据库。

汇总最终命令和精确结果：env check、TypeScript、lint、156/156 unit、production build、1/1 隔离 PostgreSQL E2E、6/6 Session/Bootstrap E2E、9 个迁移、1440×1000 与 390×844 的 Provider/Model/Pricing/Story/移动导航截图。记录一次性容器已删除、3000/55432 已释放、共享 5433 未操作。最终答复必须包含根因、数据映射与接入方式、PRD/设计路径、实现模块、迁移与回滚、测试数量、未执行外部场景及五项明确确认；提醒用户轮换其曾暴露的 Provider Token，但不得重复该值。

Optional Enhancers:

- 以本地绝对路径链接关键文档、迁移、核心代码和截图目录，减少验收定位成本。
- 不提交、不暂存、不自动推送；保留用户对最终 diff 的控制权。

## 最终执行证据

- 单库：应用与 Story 代码中第二 Pool/第二连接变量匹配数为 0；`app/lib/db.ts` 是唯一全局 Pool。
- 安全：用户曾提供的 Token 前缀在工作区匹配数为 0；未调用真实上游。
- 结构：`app/(app)` 不存在；Storage API 6 个文件、file-storage 8 个文件均保留。
- 门禁：`env:check`、TypeScript、lint、156/156 unit、production build、`git diff --check` 全部通过。
- E2E：隔离 PostgreSQL 主场景 1/1，通过；Session/Bootstrap 6/6，通过；共覆盖 1440×1000 与 390×844。
- 数据库：0000–0008 共 9 个迁移通过；后置状态为 2 个管理员、16 条审计、3 条账本、目标请求 settled、目标 Story confirmed。
- 视觉：Provider/Model/Pricing 桌面与移动、Story 桌面、移动导航共 8 张截图；均断言无 document 级横向溢出。
- 清理：自有容器 `ink-memory-admin-e2e-20260808-1603` 已删除，3000/55432 无监听；共享 5433 容器保持 healthy。
- 只读源：`ink-dream-memory` 当前仅有未跟踪 `.claude/worktrees/`；`cc-switch` 当前仅有两份未跟踪设计文档。本轮没有向两仓库执行文件写入。

## Round 6：目标完成性反证审计

Optimized Prompt:

以用户原始目标而不是既有实现为基准，对 `ink-admin-memory` 做逐项完成性反证审计。建立“需求 → 权威证据 → 当前状态 → 缺口 → 修复”的矩阵，重点验证：唯一 PostgreSQL `ink-memory` 与未来 `ink-dream-memory` 同库迁移边界；当前 Story 缺表时控制台是否仍可用；所有表单是否明确采用 Modal 或独立页面且字段控件、枚举来源、日期/金额/关系/Secret 语义完整；AI 模型中心是否真正覆盖 `/Users/dmeck/project/cc-switch` 的 Provider Card、Preset、Endpoint、Credential、Model Dropdown、Pricing、Proxy、Failover、Usage Hero、Trend、Request Log、Provider/Model Stats 和 Request Detail，而不只是视觉近似。

特别区分三类测试：Endpoint reachability 只证明网络可达；Credential/Model validation 必须通过受控的小请求或模型列表验证，并使用服务端已加密凭据、短超时、RBAC、Origin、审计、响应脱敏；端到端代理计费验证必须通过 Ink Memory Gateway Key、模型 alias、Usage、价格快照和 Ledger。不得把用户曾暴露的真实 Token 写入或调用；DeepSeek Anthropic Endpoint 与 `deepseek-v4-pro` 只作为无 Secret 预设和 mock 合同测试。

对每个缺口直接实现：复用 cc-switch React 信息架构，Tauri/Rust 部分改写为 Next.js service/API；补齐真实趋势聚合、Provider/Model 统计、代理状态与失败回退可见性、模型验证入口、错误恢复和移动布局。所有 Route Handler 只做编排，SQL/网络/领域逻辑放 `app/lib`。使用隔离 PostgreSQL和 mock 上游验证，禁止连接共享 5433 写数据。只有当每个明确要求都有当前文件、API、数据库、测试和渲染证据时，才可判定目标完成。

Optional Enhancers:

- 将完成性矩阵写入 `docs/verification/ink-memory-admin-objective-completion-audit.md`，逐条标记 proven/incomplete/blocked。
- 对 cc-switch 参考组件与 Admin 对应组件做源文件级映射，记录哪些是直接移植的 React 结构、哪些因平台差异重写。

## Round 7：模型验证、筛选联动与发布门禁复验

Optimized Prompt:

对 Round 6 反证审计补齐的代码执行发布级复验。首先验证模型配置动作的三个安全层级：Provider reachability 不带 Credential；Model validation 只使用隔离 PostgreSQL 中的测试 Credential，向本机 mock Anthropic-compatible 上游发送一次非流式、最多 1 Token 的请求，不读取响应正文；Gateway 端到端仍通过独立 Gateway Key、稳定 alias、Usage、价格快照和 append-only Ledger。任何测试不得访问用户提供的真实 DeepSeek Token 或修改共享 `localhost:5433/ink-memory`。

在明确命名的一次性 PostgreSQL 16 容器中创建唯一数据库 `ink-memory`，应用 0000–0008 迁移并加载真实关系 fixture。以开发专用 `AI_PROVIDER_ALLOW_INSECURE_LOCALHOST=true` 启动被测应用，只允许 SSRF 校验后的 `127.0.0.1` 动态 mock 上游。执行 env check、TypeScript、lint、159 项 unit、production build 和单 worker focused Playwright；E2E 证明 Model validation 的 RBAC、Origin、Secret 不回显、请求体上限、响应分类和审计，同时证明 Provider/Model/Pricing 服务端分页、名称/Code/上游型号联合搜索、Usage URL Provider/Model 筛选预填、百分比→bps 与 USD→micro-USD 控件。

在 1440×1000 与 390×844 复验 Provider/Model/Pricing 独立页面、Model validation 状态、停用确认 Modal、Usage 筛选和页面级无横向溢出。最后查询临时数据库的模型验证审计和核心账本后置条件；停止自有 Next.js 进程，删除精确命名容器并证明 3000/55432 已释放、共享 5433 未操作。将结果写入目标完成性审计与验证报告，只有所有明确条件均有文件、API、SQL、测试和截图证据后才能完成目标。

Optional Enhancers:

- 保存模型验证成功卡片和 Provider/Model/Pricing 双视口截图，并记录 mock 上游只收到脱敏 fixture 请求。
- 将 cc-switch 的桌面 ProxyToggle/failover queue 标记为服务端平台差异，不虚构为已实现；当前始终在线代理与未来多上游路由策略分别记录。

## Round 7 执行证据

- 首轮反证捕获 Usage `provider_id/model_id` 未进入服务端筛选白名单导致 HTTP 400；补齐参数化 SQL 列和白名单后通过。
- 第二轮反证捕获独立 edit 页可选对象默认值引用不稳定，触发加载 effect 循环和 DOM 持续重建；改为模块级稳定默认对象后，Provider 编辑与停用 Modal 可正常操作。
- `pnpm env:check`、TypeScript、lint、159/159 unit、production build、`git diff --check` 通过。
- PostgreSQL 16 临时 `ink-memory` 应用 0000–0008 共 9 个迁移；主 E2E 1/1、Session/Bootstrap 6/6 通过。
- 本机 mock Anthropic-compatible 上游只收到 fixture Bearer Credential、`deepseek-v4-pro`、`max_tokens: 1` 和 `stream: false`；未访问真实 DeepSeek。
- 临时数据库后置：2 admins、20 audits、2 条 operational/HTTP 200 的 `model_validation`、3 ledger entries、目标请求 settled、目标 Story published/confirmed。
- 11 张视觉证据保存在 `test-results/round7-postgres/`，覆盖 1440×1000 与 390×844 的 Provider/Model/Pricing/Usage/Story、停用确认和移动导航。
- 自有容器 `ink-memory-admin-e2e-round7-20260808` 已删除；3000/55432 无监听，共享 `ink-memory-postgres` 的 5433 容器保持 healthy 且未写入。

## Round 8：真实源数据库只读同步与迁移后验收

Optimized Prompt:

主动审计并只读访问 `/Users/dmeck/project/ink-dream-memory` 当前实际使用的数据库，不凭文件名猜测数据源。解析其环境配置、ORM/Drizzle schema、迁移、数据库连接代码和真实数据库元数据，确认数据库引擎、精确文件/实例、表名、主键、外键、唯一约束、枚举、时间格式和行数；任何连接信息与用户数据只在本机使用，不把 Secret、密码散列或敏感正文输出到日志和文档。

以 `users`、`story_workspace_workspaces`、`story_workspace_stories` 为最低迁移集合，并按外键闭包补齐 Admin 查询或 Story 写操作实际依赖的关系表、Character、Scene、Workflow 等必要表。源数据库全程只读；不得修改 `ink-dream-memory` 代码、schema、migration、数据库文件或运行逻辑。不得把源数据库作为 Admin 运行时第二数据源，不得提交 SQLite fixture、JSON 数据库或回退。若源当前不是 PostgreSQL，只允许使用源项目已有只读能力或系统原生客户端执行一次性抽取，目标始终是明确自有、可删除的 PostgreSQL 16 `ink-memory`。

设计并实现可复核的单向迁移流程：迁移前 schema/row-count/fingerprint；显式字段映射和类型转换；保留源主键、时间、nullable、owner/workspace 关系；按依赖顺序事务写入；使用 conflict-fail 或明确幂等策略；迁移后逐表行数、主键集合、外键 orphan、唯一冲突和抽样字段校验。任何失败整体回滚，不清空或覆盖共享数据库。迁移脚本应拒绝非 PostgreSQL目标、拒绝目标数据库名不是 `ink-memory`、拒绝源与目标相同、默认 dry-run，并要求显式 `TEST_DATABASE_URL` 或一次性容器。

随后让 `ink-admin-memory` 直接通过唯一 `DATABASE_URL` 读取迁入的真实数据，运行源用户、Workspace、Story 列表/详情、白名单更新、confirm/reject/archive、跨 Workspace 409、RBAC、审计和 Dashboard 验收。使用 `ink-admin-playwright-qa` 创建命名临时 PostgreSQL、执行 Admin migrations、同步真实源数据、运行 focused integration/E2E，并覆盖 1440×1000 与 390×844。测试结束前记录迁移清单、行数与一致性证据；停止自有进程并删除精确临时目标，源数据库和共享 5433 均保持未写入。

Optional Enhancers:

- 对真实源数据只记录不可逆哈希、行数和脱敏 ID 示例，不在截图或报告暴露用户邮箱、正文、Token 或密码散列。
- 如果真实数据库缺少某些业务表或为空，明确区分“schema 已迁移”“数据已迁移”“无源数据”三种状态，并使用源 schema 生成的合成最小关系仅作为另一个隔离测试，不冒充真实同步结果。

## Round 9：cc-switch 桌面交互与 Provider 自动同步纠偏

Optimized Prompt:

以 `/Users/dmeck/project/cc-switch` 的当前桌面端产品为唯一 AI 模型中心交互参照，逐页、逐状态和逐调用链审计其 Provider 注册、预设选择、凭据配置、模型自动发现/同步、模型映射、定价获取或维护、代理开关、用量监控、请求明细与异常恢复。不得把“样式相似”或手工创建 Model/Pricing 当作完成；必须确认 cc-switch 的自动同步究竟读取远端 `/models`、使用内置 Provider 预设/模型目录、从本地配置导入，还是组合策略，并用源代码、桌面截图和网络/服务调用证据记录结论。

将可移植的 cc-switch 桌面信息架构和交互模式落到 Next.js/Refine：AI 模型中心保持桌面控制台式双栏或主从布局、紧凑 Provider 卡片/列表、固定上下文操作区、配置独立页或桌面侧滑层、模型同步进度与差异预览、定价状态、代理健康度、Usage/Request Detail 联动；不使用默认 Ant Design CRUD 表格和无意义指标卡。Provider 创建或更新成功后，可显式或按 cc-switch 规则自动触发安全的模型发现，先显示新增/更新/未变化/冲突差异，再以事务写入 `ai_models`；定价只有在上游或内置目录存在可验证来源时才能同步，否则必须标记“待配置”，不得编造价格。同步使用已加密 Credential、短超时、SSRF 防护、RBAC、Origin 校验、响应大小限制、字段白名单、Secret 永不回显和审计；失败不得破坏现有模型或历史价格。

更新 PRD 和交互设计，严格列出每个桌面页面的数据项、展示控件、表单载体（独立页面、侧滑层或确认弹窗）、同步触发条件、状态机、键盘操作、错误恢复、1440×1000 主验收和 390×844 降级方式。实现对应 repository/service/API/UI 与 mock 合同测试；真实用户 Token 不得使用。与此同时继续 Round 8：源 SQLite 只读、真实数据只同步到一次性 PostgreSQL `ink-memory` 并验收，绝不修改源库或共享 5433。

Optional Enhancers:

- 为 cc-switch 当前桌面页建立“源组件/命令 → Admin 页面/服务/API → 测试”追踪矩阵，并保留对比截图。
- 将模型同步拆成 `discover → preview diff → apply` 三段，Provider 首次注册可自动执行 discover，已有 Provider 的批量变化要求人工确认 apply。

## Round 10：真实三表迁移、模型发现与定价同步实现

Optimized Prompt:

在 PRD 与交互设计已更新的前提下，为 `ink-admin-memory` 实现两个可独立验证、共同使用单一 PostgreSQL `ink-memory` 的生产级能力。

第一，实现 `ink-dream-memory` 首批真实数据单向迁移。新增 canonical PostgreSQL DDL，只创建源原名 `users`、`story_workspace_workspaces`、`story_workspace_stories` 及精确 PK/unique/check/FK/index，不读取或合并 Admin 旧平行 Story 表。新增一次性 Node CLI，源只通过系统 `/usr/bin/sqlite3 -readonly` 的一致性临时快照抽取，Admin 运行时与依赖不得引入 SQLite；目标只接受显式 PostgreSQL `TEST_DATABASE_URL` 或经确认参数，拒绝数据库名不是 `ink-memory`、拒绝与配置的共享目标相同、默认 dry-run、`--apply` 才写。迁移顺序 users→workspaces→stories，保留 ID、nullable、枚举、时间、settings JSON 文本和敏感 password_hash 但绝不输出；单事务 conflict-fail，迁移后验证行数、PK fingerprint、sequence、枚举和 orphan，失败整体回滚。

第二，实现 cc-switch 桌面交互的 Provider 模型发现与 models.dev 定价同步。服务端使用已保存加密 Credential 和 SSRF 白名单，按 cc-switch 候选规则请求受限 `/models`/`/v1/models`，限制超时、重定向、响应字节、模型数量和字段长度；生成带 version/expiry 的不可变 discover snapshot，分类新增、更新、未变化、冲突、未定价。Apply 重新校验 RBAC、Origin、Provider/snapshot 版本和 alias，事务写 `ai_models` 与审计；不自动删除消失模型，失败不回滚 Provider。models.dev 服务读取可信目录，做 exact/normalized/ambiguous/unmatched 匹配，配置最多 6 小时节流；Apply 只插入带 source metadata 的新 `ai_pricing_rules` 版本，禁止覆盖历史或将未匹配价格设为 0。

UI 必须采用 cc-switch 桌面工作台：Provider 单列卡片常显同步/Usage/编辑；新增编辑为 fixed 全窗口层覆盖 Admin 侧栏、固定 Header/Footer、中段滚动；Provider 保存成功后自动 discover，并把“已保存”和“发现结果”分别反馈；discover 与 Pricing sync 使用全窗口 diff/apply；Usage 保持 Provider→Model URL 级联和 Request Drawer 上下文。所有 Route Handler 只做 Session/RBAC/Zod/Origin 和 service 编排；Secret 永不回显。补充 unit/mock contract、一次性 PostgreSQL真实源同步、Admin Story 查询/受控写、Provider discover/pricing 版本、1440×1000 与 390×844 Playwright。不得使用用户真实 Token、不得修改源项目、不得写共享 5433。

Optional Enhancers:

- 迁移 CLI 把 schema/count/fingerprint 结果以无 PII JSON receipt 输出，便于审计和 CI 保存。
- Provider discover 首版可同步完成后立即返回 snapshot，不必引入队列基础设施；UI 仍用阶段状态和可重试语义，未来可无缝替换后台 job。
## Round 11 — isolated PostgreSQL verification and desktop QA

Optimized Prompt:

Act as the release-verification owner for the Ink Memory Admin correction. Verify the completed one-database PostgreSQL integration, cc-switch-derived Provider/model discovery, versioned models.dev pricing sync, and fixed full-window desktop interaction without touching the shared PostgreSQL instance on port 5433. First preserve the successful source-read-only import evidence from the disposable PostgreSQL target on port 55432: migration 0000–0009 applied, dry-run passed, explicit apply imported 28 users, 12 workspaces, and 4 Stories, primary-key fingerprints matched, all three orphan counts were zero, and a repeat import was rejected because the target was non-empty. Then run the repository-prescribed environment check, TypeScript compiler, ESLint, unit tests, production build, focused Playwright tests, isolated PostgreSQL integration checks, and visual checks at 1440×1000 and 390×844. Use real server sessions for authenticated flows, mock only external Provider/models.dev network calls in ordinary UI tests, capture loading/empty/error/conflict/success and document-level overflow behavior, and verify Provider secrets never render. Verify `/admin` redirects without a Session, RBAC remains enforced by the server, Story repositories operate against canonical `users`, `story_workspace_workspaces`, and `story_workspace_stories`, Storage remains healthy, and removed PWA routes remain 404. Fix regressions found within the requested scope, rerun the narrow failing lane, then rerun the complete required command matrix. Record exact commands, test counts, viewport results, skipped external scenarios, and cleanup of the exact disposable database container. Never print credentials, never write the source SQLite database, never operate on port 5433, and never weaken immutable Usage/Ledger/Audit behavior.

Optional Enhancers:

- Add focused unit coverage for snapshot expiry, ambiguous price matching, import target refusal, and secret-free API payloads.
- Save Playwright screenshots only under the repository’s ignored test artifact directory and inspect both target viewports before cleanup.
- Treat any environment check failure caused by operator-owned missing external credentials separately from source-code regressions, with exact evidence.

Implementation note: Round 11 开始后的 schema-source 复核将 canonical 三表从手写的 `0009` 尾部拆到由 `app/lib/db/schema.ts` 生成的 `0010_story_source_canonical.sql`；最终隔离验收使用 `0000–0010`。此前 `0000–0009` 实迁的表语义与数据指纹证据仍有效，但不再是最终迁移文件布局。

## Round 11 执行证据

- 真实源导入：系统原生 SQLite 以 `mode=ro` 生成一致性临时快照；dry-run 与 `--apply` 均通过，28 users / 12 workspaces / 4 stories 的数量和 PK fingerprints 一致，三类 orphan 均为 0；重复导入按 non-empty conflict-fail 拒绝。
- Schema：`app/lib/db/schema.ts` 是 canonical 三表与同步快照表的唯一来源；全新 PostgreSQL 16 `ink-memory` 从 `0000` 到 `0010` 迁移通过。
- 代码门禁：`pnpm env:check`、`pnpm exec tsc --noEmit`、`pnpm lint`、`pnpm build`、`git diff --check` 全部通过；Vitest 30 files / 169 tests 全部通过。
- Playwright：隔离 PostgreSQL主场景 1/1、Session/Bootstrap 6/6；14 张截图覆盖 1440×1000 和 390×844，所有目标页根节点横向溢出 ≤ 1px。
- 数据后置证据：2 admins、23 audits、1 provider discovery snapshot、1 pricing sync snapshot、1 条 `source=models.dev` 价格版本；目标 Story 为 published/confirmed。
- 发现并修复 Provider `updated_at` PostgreSQL 微秒与 Node `Date` 毫秒精度导致的误报 409；改为数据库内精确版本比较，并从空库重跑成功。
- 安全：Provider Secret 未进入 API、截图、文档或审计；外部上游只用本机 mock，models.dev 未走实网；Storage、Ledger、Usage 和 Audit 保持原有约束。
- 清理：精确命名的一次性容器已停止并因 `--rm` 删除，55432/3010 无监听；共享 5433 仅保留原有 Docker 监听，未连接、迁移、清理或写入。

## Round 12 — Pricing 版本窗口与同步后列表一致性修复

Optimized Prompt:

修复 Ink Memory Admin Pricing 的两个可复现生产交互缺陷。第一，创建价格版本时如果相同 Model + User Tier 已有 `active` 且 `effective_to IS NULL` 的当前版本，独立创建页必须明确加载并展示它，将本次操作识别为“替换当前版本”，要求新 `effectiveFrom` 晚于当前版本开始时间，在同一 PostgreSQL 事务中把旧版本 `effective_to` 设置为新版本开始时间并插入新版本；不得依赖用户从列表的“新版本”入口携带隐藏参数，也不得出现未说明的窗口重叠 409。若存在未来窗口、并发更新或真正无法安全衔接的窗口，继续返回 409，同时在表单保留输入并显示冲突版本与恢复动作。第二，models.dev 差异应用成功后，必须主动失效 Refine/React Query 的 `pricing-rules` list/detail cache，等待失效完成后再导航回 Pricing 列表，并确保服务端排序和响应包含新 `source=models.dev` 版本，使新增行无需手工刷新即可出现。

保持价格历史只追加、micro-USD 整数、审计、RBAC、Origin、Secret 和单 PostgreSQL 约束。补充单元测试与隔离 PostgreSQL/Playwright 回归：覆盖直接创建页自动替换当前版本、显式 replaces 参数、真实重叠仍为 409、models.dev apply 后立即显示新增版本，以及 1440×1000/390×844 无回归。不得触碰共享 5433 或真实生产数据。

Optional Enhancers:

- 在创建页增加“将结束的当前版本”摘要，显示 Model、Tier、四类价格和当前生效时间。
- 成功返回中统一携带 `replaced_pricing_rule_id`，供列表 success receipt 和审计定位。

## Round 12 执行证据

- 根因：独立创建页未携带 `replacesPricingRuleId` 时，服务端只执行重叠检测而不会识别当前开放版本；models.dev Apply 成功后只执行 `router.push/refresh`，Refine Query cache 仍保留旧列表。
- 事务修复：Pricing create 先取得 Model/Tier PostgreSQL advisory transaction lock，自动或显式解析唯一 `active + effective_to IS NULL` 版本；校验新时间严格晚于旧版本后，将旧 `effective_to` 与新 INSERT 原子提交，并返回 `replaced_pricing_rule_id`。历史/已结束规则不能再作为替换目标，真正回填或歧义窗口保持 409。
- 页面修复：新增 `PricingVersionFormPage` 的 `Version transition` 摘要，展示当前 ID/source、四类 USD/1M 价格与切换时间；历史列表行隐藏“新版本/结束”。Pricing sync review 在导航前等待 `pricing-rules` list/detail cache 失效完成。
- 静态门禁：`pnpm env:check`、`pnpm exec tsc --noEmit`、`pnpm lint`、`git diff --check` 和临时副本 `pnpm build` 全部通过；Vitest 30 files / 169 tests 全部通过。
- 隔离 E2E：一次性 PostgreSQL 16 `127.0.0.1:55432/ink-memory` 应用 0000–0012 与测试 fixtures；`admin-bootstrap-postgres.spec.ts` 最终复跑 1/1 通过（21.7s；冷启动完整轮 1.6m）。覆盖无隐藏 replaces 的自动版本推进、显式 replaces、真实回填 409、真实 models.dev snapshot Apply 后列表立即出现 `default · models.dev`，以及 1440×1000 / 390×844 Pricing 视觉和横向溢出检查。
- 数据后置：`model-e2e/free` 三个 active 历史窗口首尾精确衔接，开放版本唯一；`model-e2e/default` 新增 `source=models.dev`；全库 active Pricing 时间窗重叠计数为 0；两次 models.dev Apply 均有审计。
- 环境边界：发现仓库已有用户 Next.js 进程占用 3000/3011 和主 `.next` 锁后未终止、未复用；改用 `/tmp/ink-memory-pricing-e2e.*` 临时副本与自有 3012 服务。共享 5433 未连接、迁移、清理或写入。

## Round 13 — Gateway 记录化与 Key 接入指引

Optimized Prompt:

将 Ink Memory Admin 的代理网关交互收敛为轻量、可观测的服务控制台。移除面向运营人员的“异常结算/人工核对/手工补账”复杂工作流、相关主菜单入口和可执行操作；Gateway 请求失败、上游错误、自动计费或自动结算失败只作为不可变请求/Usage/Audit 记录保存并可查询、筛选、排序和查看详情，不向管理员提供会修改余额、Ledger 或结算状态的人工按钮。保留 Gateway 正常请求生命周期、自动预授权与自动结算、错误分类、请求日志、Token Usage、价格快照、审计和只追加 Ledger 的内部一致性，不得因删除人工流程而吞掉错误或破坏自动计费。

重构 Gateway Key 创建成功体验：密钥仍只在创建响应中展示一次且永不落库明文、永不在列表或详情回显；成功回执必须显示当前可调用的网关根地址以及可复制的 Claude/Anthropic 环境配置，至少包含 `ANTHROPIC_BASE_URL=<gateway origin>` 和 `ANTHROPIC_AUTH_TOKEN=<one-time key>`，并明确实际协议入口 `/v1/messages`、密钥仅显示一次、应立即保存以及撤销后的行为。网关公开地址优先使用经过校验的服务端公开配置；没有显式配置时使用当前浏览器 origin，不得硬编码 localhost、生产域名或虚构地址。复制动作应分别支持复制地址、Token 和完整 env 片段，提供成功/失败反馈、键盘可达、移动端不横向溢出，并避免 Token 进入 URL、日志、审计、截图或文档。

先审计现有 Gateway reconciliation 页面、菜单、Resource、Route Handler、`app/lib/gateway/**`、`app/lib/billing/**`、Gateway Key 创建表单与一次性 secret 回执，再做最小且完整的代码调整。更新 PRD 与交互设计中的网关状态机和字段/控件说明；补充单元或 Playwright 覆盖：创建 Key 后一次性显示网关地址与两项 Anthropic 环境变量，刷新或进入详情后 Token 不再出现；请求失败仍可在日志中读取；人工 reconciliation 操作不再出现在 UI，旧操作 API 应返回 404/405 或明确只读响应。使用一次性 PostgreSQL `ink-memory` 验证，不调用真实模型、不操作共享 5433、不削弱 Storage、RBAC、Session、Secret 加密和审计。

Optional Enhancers:

- 同一回执可附带不含 Secret 的 `curl /v1/models` 或 Claude Code 配置说明，但不得让辅助内容压过两项必需环境变量。
- 若部署存在反向代理，新增单一 `GATEWAY_PUBLIC_BASE_URL` 环境配置并在 env check 中校验 HTTPS/允许的本地开发 HTTP；未配置时才回退浏览器 origin。

## Round 14 — Gateway 变更最终验收与安全清理

Optimized Prompt:

作为 Ink Memory Admin 的发布验收负责人，对“Gateway 失败记录化 + Gateway Key 一次性 Anthropic 接入回执”执行最终、可复现的质量门禁。先核对 PRD、交互稿、字段控件矩阵和现有设计说明，确认菜单、流程图、RBAC 与验收标准不再把 `settlement_failed` 描述为人工 Reconciliation；再检查源码不存在旧页面、专用 reconcile Route Handler、人工修改 Token/余额/Ledger 的组件或可执行入口。验证 Gateway Key create API 只在一次响应中返回明文和非敏感公开 base URL，审计与数据库不包含明文或回执 URL 字段，列表/详情/刷新不回显 Token；公开 URL 必须在直连通配地址和 `x-forwarded-host`/`x-forwarded-proto` 反向代理场景下返回用户可用 origin。

使用 `ink-admin-playwright-qa` 的命名一次性 PostgreSQL 16 容器和自有 3012 服务执行 `pnpm env:check`、干净副本 `pnpm exec tsc --noEmit`、`pnpm lint`、`pnpm test:run`、`pnpm build` 及 focused Playwright。E2E 必须覆盖无 Session、RBAC 401/403、Story/模型/Pricing/Storage 回归、Gateway Key Modal 创建、Base URL/`/v1/messages`/`ANTHROPIC_BASE_URL`/`ANTHROPIC_AUTH_TOKEN`/完整 env 展示、关闭后明文消失、旧 reconciliation 页面与写 API 为 404、失败请求状态和原预留 Ledger 不被改写，以及 1440×1000、390×844 无页面级横向溢出。截图只在 Secret 回执关闭后保存。最后查询隔离数据库证明 Gateway failure 状态未变化、无 reconcile Audit、Key audit 不含 `plaintextKey`/`gatewayBaseUrl`，停止并删除精确临时容器、服务和副本，确认 3012/55432 无监听且共享 3000/5433 未被停止、迁移、清理或写入。

Optional Enhancers:

- 把首次因 `request.url` 返回 `0.0.0.0` 发现的缺陷记录为反向代理地址解析回归用例，保留直连、forwarded 和非法协议三组单测。
- 在最终报告中区分应用诊断、Next 开发模式已知提示与测试外部工具噪声；不通过静默忽略真正的同源 5xx 或页面异常来制造通过结果。

## Round 14 执行证据

- 产品与代码收敛：删除 `/admin/gateway/reconciliation` 页面、专用 reconcile Route Handler、人工结算组件及领域 service/test；侧栏、Gateway 子导航、Request 详情和 Dashboard 不再提供人工修改 Token、余额、Ledger 或请求终态的入口。`settlement_failed` 继续保存错误、Token/价格快照、预留与审计事实。
- Gateway Key 回执：创建 Modal 成功后一次性显示 Gateway 根地址、`/v1/messages`、`ANTHROPIC_BASE_URL`、`ANTHROPIC_AUTH_TOKEN` 和完整 env，支持分别复制；关闭后只保留 prefix。创建审计过滤 `plaintextKey`，公开地址仅加入响应而不写数据库/审计。
- 地址纠偏：隔离 E2E 首轮发现 Next 绑定 `0.0.0.0` 时 `request.url.origin` 不可作为外部配置；新增 `resolveGatewayBaseUrl`，优先使用首个 `x-forwarded-host`/`x-forwarded-proto` 或 Host，非法协议/Host 回退请求 origin。三组单测覆盖 wildcard 直连、反向代理和非法协议。
- 静态门禁：`pnpm env:check`、干净副本 `pnpm exec tsc --noEmit`、`pnpm lint`、`git diff --check` 和 `pnpm build` 全部通过；Vitest 31 files / 178 tests 全部通过。
- 隔离 E2E：一次性 PostgreSQL 16 `ink-memory` 在 `127.0.0.1:55432` 应用 0000–0012 与 Story/control-plane fixtures；自有 3012 Dev Server + Chromium focused spec 1/1 通过（28.7s）。覆盖 Key 回执全部字段、关闭后 Token 消失、旧页面/API 404、失败请求只读、Session/RBAC、Story/Provider/Model/Pricing/Billing/Storage 回归和移除 PWA 路由 404。
- 数据后置：fixture Request 仍为 `settlement_failed / UPSTREAM_STREAM_INTERRUPTED / reserved=1000000`；关联 Ledger 仍只有原 reserve 1 条；Gateway Request reconcile Audit 为 0；Gateway Key Audit 中带 `plaintextKey` 或 `gatewayBaseUrl` 的记录为 0。
- 视觉：1440×1000 与 390×844 的 Gateway Key 页面根节点横向溢出 ≤ 1px；仅在一次性 Secret 回执关闭后保存截图到 `test-results/gateway-key-record-only/`。
- 清理与边界：精确命名容器停止并因 `--rm` 删除，临时副本与诊断文件移入系统废纸篓；3012/55432 无监听。共享 3000/5433 保持原监听且未复用、迁移、清理或写入；`ink-dream-memory` 业务代码未修改，其既有未跟踪 `.claude/worktrees/` 保持原状。

## Round 15 — 真实业务接入复核与订阅计费控制面

Optimized Prompt:

在 `/Users/dmeck/project/ink-admin-memory` 内完成一套可发布、可回滚、可证据化验收的真实业务运营与订阅计费控制面；`/Users/dmeck/project/ink-dream-memory` 全程只读。先逐项复核 Dream 的 ORM/schema、迁移、查询、API、类型、主外键、枚举与真实源数据库元数据，并复核 Admin 当前 schema、迁移、Repository、API、Refine Resource、Gateway、Billing、Storage、RBAC、Session 与审计实现，禁止依据表名推断。更新 `docs/verification/ink-dream-memory-data-integration-audit.md`，明确重复实体、缺表根因、canonical 映射、读写边界、外键冲突、分阶段迁移与回滚；不得删除旧表或运行破坏性迁移。

在任何业务代码修改前，读取 `docs/prd/Ink & Memory UI Design v2.pdf`、`docs/prd/color_system/**` 和现有 PRD，先创建 `docs/prd/ink-memory-admin-prd-v3.md` 与 `docs/design/refine-admin-ui-v3-interaction-design.md`。PRD 必须定义 Subscription Plan、不可覆盖 Plan Version、Subscription 生命周期、Entitlement、周期 Allowance、Overage、Billing Account、append-only Ledger、可插拔支付边界，以及 `User → Subscription → Entitlement → Model Permission → Balance/Allowance → Gateway Request → Usage → Ledger` 资格链；交互稿必须用 PDF/颜色系统的精确设计 Token，覆盖所有指定页面、字段控件、状态、风险确认、1440×1000/390×844、可访问性和 Mermaid 流程，不得退化为默认 Refine CRUD 外观。

实现阶段只修改 Admin：canonical Dream 业务资源继续直连源原名 PostgreSQL 表；新增 Admin 控制面专属订阅 schema、Drizzle 迁移、严格 Zod contract、Repository/Service、RBAC/审计 API、Refine 页面和集中设计 Token。金额使用整数 micro-USD；Plan Version、Usage、Ledger、Audit 只追加；Secret 只保存加密/哈希且永不回显。订阅开通、续费、升级、降级、暂停、取消、宽限与恢复必须经过事务化状态机和幂等边界。Gateway 调用前解析用户订阅、权益、模型 scope、RPM、Token/金额 allowance、overage 与余额；调用后保留价格/权益快照并通过现有预授权、Usage 与 Ledger 自动结算。Route Handler 只做 Session/RBAC、解析、Zod 和 service 编排；分页、排序和筛选使用服务端白名单。

完成后创建 `docs/architecture/ink-dream-subscription-integration-change-list.md`，只描述 Dream 后续的 API、Billing Identity、Gateway/Key、Model Alias、套餐/额度/Usage 页面、错误码、环境变量、部署、类型、测试、监控、灰度和回滚，不修改 Dream。使用 `ink-admin-playwright-qa` 在明确命名、可删除的 PostgreSQL 16 `ink-memory` 上验证；绝不连接、迁移、清空或写入共享数据库。运行 env check、TypeScript、lint、unit、build、focused Playwright、隔离 PostgreSQL集成，以及 1440×1000/390×844 视觉和键盘检查。测试覆盖 401/403、真实 Dream 三表、FK/unique/state conflict、Plan/Version、全订阅生命周期、Entitlement/Allowance/Overage、Gateway/Usage/Ledger、Secret 脱敏、Storage 与已移除 PWA 404。最终报告给出精确路径、实现清单、迁移、测试数量、视口、未执行外部场景和风险，并明确确认 Dream 未修改、无 SQLite/内存回退、无 PWA 恢复、Storage 未删除、共享数据库未操作。

Optional Enhancers:

- 增加月度账单预览与 CSV 导出，但不得伪造支付成功或外部账单事实。
- 为未来 Stripe、支付宝、微信支付预留 provider adapter 与幂等 webhook contract；默认不调用真实支付渠道。
- 对订阅状态机、重复续费、并发升级和 webhook 幂等增加属性/并发测试。

## Round 16 — PRD v3 与订阅运营交互设计

Optimized Prompt:

基于已经复核的 Dream canonical 数据边界、Admin 控制面能力和订阅缺口，先从 `docs/prd/Ink & Memory UI Design v2.pdf`、`docs/prd/color_system/**`、现有 PRD v2、交互设计 v2 与字段控件矩阵提取精确视觉和交互约束，再完成设计技能的 PRD → 结构草图 → 层级逻辑 → UI 规范四阶段。输入视觉必须来自 PDF 实际渲染，不使用虚构参考图；每个阶段都以此前输出为依赖并保存证据文件。

最终创建 `docs/prd/ink-memory-admin-prd-v3.md`：明确产品定位、角色、真实 Dream 表/控制面边界、菜单路由、Resource/API/Repository/PostgreSQL 映射、RBAC、全状态、Secret/账务/可访问性/响应式、迁移灰度回滚和可自动测试验收。订阅域必须包含 Plan、不可覆盖 Plan Version、Subscription、Entitlement、周期 Allowance、Overage、Billing Account、append-only Ledger、trial/active/past_due/paused/cancel_at_period_end/cancelled/expired 生命周期、升级/降级/续费/暂停/取消/宽限/恢复，以及 `User → Subscription → Entitlement → Model Permission → Allowance/Balance → Gateway → Usage → Ledger`。支付保持可插拔边界，不声称已接第三方。

同时创建 `docs/design/refine-admin-ui-v3-interaction-design.md`：使用 PDF/颜色系统中的精确颜色、字体、间距、圆角、阴影与状态 Token，覆盖 Admin Shell、Dream 用户/Workspace/Story 层级、Plan/Version/Subscription/Entitlement、用户订阅和周期额度、Provider/Model/Pricing、Gateway Key 一次性回执、Gateway Request/Usage/Billing/Ledger、Storage/RBAC/Audit/Settings。每页给出目的、操作者、列表字段、筛选排序分页批量动作、详情分区、Modal/Drawer/独立页决策、逐字段控件与校验、错误恢复、高风险确认、1440×1000/390×844 和键盘/焦点/label/读屏要求。必须包含五组 Mermaid 流程，且不得回退为默认 Ant Design CRUD 或装饰性假指标。

验收：两份正式文档之间的路由、状态、RBAC、字段名、表名和金额单位一致；设计技能中与本项目技术栈冲突的 Tailwind 2/Font Awesome/远程字体示例只作为结构分析证据，不覆盖项目现有 Tailwind 4、本地字体和本地图标约束。

Optional Enhancers:

- 在订阅详情加入月度账单预览与 CSV 导出交互，明确数据来源、时区和舍入规则。
- 为并发生命周期操作设计 409 最新状态恢复和幂等请求回执。

## Round 17 — 订阅领域、Admin API/UI 与 Gateway 集成实现

Optimized Prompt:

在 PRD v3 与交互设计 v3 已完成的前提下，仅修改 `ink-admin-memory`，实现可迁移、可回滚、可测试的订阅计费控制面。首先纠正 canonical Dream schema 的应用层漂移：Drizzle 只保留一套真实三表定义，Repository 不再读取/写入 Dream 不存在的 User/Workspace status，不开放源 User patch 或 Workspace create；已发布物理扩展列只 comment deprecated，不 DROP。旧 Admin 平行 Story 表继续保留但不绑定 Resource。

新增 `subscription_plans`、`subscription_plan_versions`、`subscription_plan_entitlements`、`subscriptions`、`subscription_usage_allowances`、`subscription_events`，并为 `gateway_requests` 增加订阅、版本、权益与额度快照引用。Plan Version/Entitlement 在 published 后由 service 与 PostgreSQL trigger 双重拒绝 UPDATE/DELETE；Subscription 生命周期使用事务、行锁/乐观 version、幂等事件和 Audit；Allowance 保持 granted/reserved/consumed 守恒，cash 与赠送额度不混写；Ledger、Usage、Audit 只追加。所有金额为整数 micro-USD。

实现 `app/lib/subscriptions/**` 的 types、strict Zod contracts、repository、service/state machine 和 eligibility；实现 `/api/admin/subscription-*` 的轻 Route Handler、RBAC permission、Refine Resources、服务端分页/排序/筛选和 Plan/Version/Entitlement/Subscription 页面。复杂创建/编辑使用独立页面，生命周期动作使用有影响摘要的 Modal/移动全屏，用户订阅详情解释权益、override、额度、余额、Usage 与 Ledger。设计 Token 集中维护，遵循暖纸、单一虚线边界、无默认 CRUD 卡片墙。

Gateway 在上游调用前执行 `User → Subscription → Published Version → Entitlement → User Model Permission → Allowance/Overage Cash → Request`，请求时冻结订阅/Version/Entitlement/Allowance snapshot；结算时先 capture/release Allowance，再按 overage policy 处理 cash，未知 Usage 仍保留安全失败记录。保留现有无订阅用户的受控迁移兼容 feature flag，默认在测试/明确启用时强制；不得静默放行已存在但无资格的订阅。Route Handler 不写 SQL/状态机，Secret 不回显。

补充 unit、PostgreSQL integration 与 focused Playwright，覆盖 Plan/Version 不可变、全生命周期、幂等/并发冲突、Entitlement/Allowance/Overage、Gateway 402/403/409/429、Usage/Ledger、RBAC/Secret/Storage/PWA 404。任何数据库写验收只使用明确一次性 PostgreSQL `ink-memory` 或 `TEST_DATABASE_URL`，不触碰共享 5433。

Optional Enhancers:

- 实现真实月度账单预览 API 与安全 CSV 导出。
- 预留 PaymentAdapter/Webhook interface 与幂等 contract，但默认不调用外部渠道。

## Round 18 — Dream 接入清单与隔离发布验收

Optimized Prompt:

在订阅控制面、Admin API/UI 和 Gateway allowance/cash 结算代码完成后，进入只读 Dream 交付说明与发布验收阶段。先创建 `docs/architecture/ink-dream-subscription-integration-change-list.md`，只描述 `/Users/dmeck/project/ink-dream-memory` 后续应实施的变更，绝不修改其代码、Schema、迁移或运行配置。清单必须基于本轮实际 Admin 路由、错误码、数据模型与 Gateway 协议，覆盖 Dream 用户到 `platform_users.external_user_id` 的 Billing Identity 映射、Gateway Base URL/一次性 Key Secret 注入、稳定 Model Alias、套餐与订阅状态、Allowance/余额/Usage 展示、套餐选择、管理/取消/续费、401/402/403/409/429 错误恢复、环境变量、部署顺序、前后端/类型/测试/监控文件建议、灰度开关与回滚；不得虚构第三方支付已接入。

随后严格使用 `ink-admin-playwright-qa` 在明确命名、可删除的 PostgreSQL 16 `ink-memory` 上执行迁移 0000–0014、fixture、订阅成功/失败路径和 focused Playwright；不得连接或写入共享 5433。验证 `pnpm env:check`、TypeScript、lint、207+ unit、build、API/领域隔离 PostgreSQL、1440×1000 与 390×844。数据库断言覆盖 Plan/Version/Entitlement、published immutability、开通/续费/升级/降级/暂停/恢复/取消、事件幂等、Allowance 守恒、Gateway token/money allowance 优先、cash overage、402/403/409/429、Usage/Ledger 只追加、真实 Dream 三表查询边界、Secret 脱敏、Storage 和 PWA 404。

若发现工作区中非本任务并发改动，保持其内容和迁移序号，采用增量兼容修复，不 reset、不覆盖。完成后更新工作日志执行证据与最终报告，列出精确命令、测试数量、视口、迁移、未跑外部场景和风险，并确认 Dream 未修改、无 SQLite runtime/fallback、未恢复 PWA、Storage 未删除、共享数据库未操作。

Optional Enhancers:

- 加入订阅月度账单预览/CSV 作为后续迭代，不阻塞本轮核心验收。
- 将真实支付保持为 PaymentAdapter/Webhook 幂等边界说明，不调用 Stripe、支付宝或微信。

## Round 19 — 并发 Next 进程下的临时副本验收

Optimized Prompt:

当前工作区的 3000 端口和主 `.next/dev/lock` 被用户拥有的另一个 Next 进程占用。不得停止、复用、覆盖或干扰该进程；保持一次性 PostgreSQL `ink-memory` 容器与 55432 目标不变。创建一个 `mktemp -d` 命名的临时源码副本，排除 `.git`、`.next`、`node_modules`、测试产物和 Secret 文件，仅把当前未提交源码快照复制进去，并只在临时副本内把 Playwright webServer 明确绑定到自有 3012。依赖使用只读 symlink 指向主工作区 `node_modules`，测试结果保留在临时副本或显式产物目录。

在临时副本用同一隔离 DATABASE_URL 和测试 Secret 运行 focused subscription Playwright、必要的诊断复跑和 production build；发现代码缺陷时只用 `apply_patch` 修复主工作区，再重新同步到新的/已验证的临时副本。验收结束停止 Playwright 自有 3012 服务，删除精确临时副本和一次性 PostgreSQL 容器；不得触碰 3000/5433。报告需把首轮错误归类为“错误环境复用/主 `.next` lock”，而不是产品失败，并给出隔离库未被首轮写入的证据。

Optional Enhancers:

- 在清理前检查 3012/55432 的 PID/container ownership 和主 3000 PID 保持不变。

## Round 18–19 执行证据

- 文档先行：完成数据接入审计、PRD v3、Refine 交互设计 v3 与 Dream 后续订阅接入清单；设计输入来自 PDF 实际渲染和 `color_system`，四阶段设计产物保存在 `files/workspace/`。
- Schema/迁移：一次性 PostgreSQL 16 `127.0.0.1:55432/ink-memory` 从 `0000` 到 `0014` 全量迁移通过；`0014_subscription_control_plane.sql` 创建 Plan、不可覆盖 Version/Entitlement、Subscription、Allowance 与 append-only Event，并扩展 Gateway Request/Ledger 的订阅快照关联。未执行 DROP/DELETE/TRUNCATE 业务表。
- 领域与 Gateway：聚焦 E2E 覆盖版本发布后 PATCH 409、重复开通幂等、重复有效订阅 409、pause 后 Gateway 403、resume、upgrade、downgrade、renew、cancel-at-period-end、订阅删除 405，以及真实上游 mock 返回 10 input + 5 output tokens 后的 token allowance 15 捕获。数据库后置证据为 1 Plan、2 Versions、2 Entitlements、1 Subscription、7 Events；Gateway Request 为 `settled/succeeded/token_allowance`，cash reserve 为 0，Allowance monetary consumed 保持 0，Ledger 新增 `subscription_charge` 与 `allowance_capture`。
- 缺陷修复：隔离 PostgreSQL 首轮揭示 token allowance 的“货币等值”被错误累加到 money allowance consumed，触发守恒约束；已将货币等值仅用于 Request/Ledger 价格事实，token coverage 只增加 `consumed_tokens`。正式 E2E 从空库重跑通过。
- E2E 环境纠偏：未复用用户占用的 3000 与主 `.next`；使用 `/tmp/ink-memory-subscription-e2e.*` 与自有 3012。Codex 注入的 `react-grab` CDN CORS 错误只在测试诊断器按精确 URL/消息过滤，同源 request failure、page error 和所有 5xx 仍会失败。Storage 回归使用另一个精确命名的一次性 MinIO（19000/19001），未使用现有 9000/9001 服务。
- 发布门禁：`pnpm env:check`、`pnpm exec tsc --noEmit`、`pnpm lint`、`git diff --check` 通过；最终 Vitest 41 files / 214 tests 全通过（含订阅 402、cash overage 与 Gateway 429）；临时副本 `pnpm build` 通过并包含四个订阅路由；subscription focused Playwright 1/1（6.4s），Admin/Story/RBAC/Billing/Gateway/Storage/PWA focused Playwright 1/1（29.7s）。
- 视觉：人工检查 1440×1000 用户订阅页与 390×844 套餐页；两者页面根节点横向溢出 ≤ 1px，桌面侧栏、移动菜单、表单区、状态与表格层级符合 v3 Token。
- 安全：隔离库审计中测试 Provider Secret/Gateway plaintext 命中为 0；Provider Secret 与 Gateway Key 不出现在保存截图。共享 5433 未连接、迁移、清理或写入；Dream 项目只读。
- 清理：自有 18080 mock、19000/19001 MinIO、3012 Next 与 55432 PostgreSQL 均已释放；两个精确命名的 `--rm` 容器已停止删除，临时副本移入系统废纸篓。用户原有 3000、5433、9000 监听保持存在且未停止。

## Round 20 — 平台用户即计费用户

Optimized Prompt:

修复 Ink Memory Admin 将真实平台用户与“计费用户”错误拆分为两个运营概念的问题。产品模型只有一套平台用户：PostgreSQL canonical `users` 中每个用户天然可订阅、持有余额、获得 Gateway Key、产生 Usage 并进入 Ledger；不得要求运营人员另行创建 `platform_users` 才能出现在订阅或计费关系选择器中。`platform_users` 只允许作为 Admin 控制面内部 Billing Identity/crosswalk，由服务端根据 `users.id/email/display_name` 幂等自动补齐和同步，不作为独立业务用户主数据，也不得产生重复身份。

先审计用户列表、Subscription 开通选择器、Billing Account、Gateway Key、Model Permission、Usage/Ledger 筛选以及 `platform_users` 当前创建路径。实现统一的 Repository/Service 查询与幂等映射边界：所有用户型选择器以 canonical `users` 为全集，返回稳定的内部 billing identity；缺失映射在受控事务中自动创建，并按 `(source, external_user_id)` 唯一约束处理并发；已有映射保留余额、订阅、Key、Usage 和 Ledger 关联，只同步允许的展示字段。不得修改 Dream 源代码或 password_hash，不得把源用户复制成第二套可编辑用户。

移除 UI 中“计费用户”这一独立概念和文案，统一显示“平台用户”；保留 `billing_accounts` 作为每个平台用户的一对一财务账户，可在首次需要时幂等创建。严格保持 Session/RBAC、Origin、Zod、审计、Secret、micro-USD、append-only Usage/Ledger/Audit 和 PostgreSQL-only 约束。补充单元与隔离 PostgreSQL/Playwright 回归，至少证明多名 canonical 用户都出现在订阅选择器，选择尚无 crosswalk 的用户可成功开通订阅并自动建立唯一 Billing Identity/Account，重复调用不重复建档，既有用户余额和关联不被覆盖；运行 TypeScript、lint、unit、build 和 focused E2E，禁止写共享 5433。

Optional Enhancers:

- 在平台用户详情展示内部 Billing Identity ID，但仅作为只读技术信息，不作为第二类用户。
- 为生产存量数据提供只读差异计数与显式 backfill 命令；运行时仍允许按需幂等补齐，避免迁移窗口阻断订阅。

## Round 21 — Next.js Route Export 构建兼容

Optimized Prompt:

在“平台用户即计费用户”修复完成静态检查、单元测试和隔离 PostgreSQL E2E 后，处理 production build 揭示的既有 Storage Route 类型错误。`app/api/storage/route.ts` 只能导出 Next.js 允许的 Route 配置与 HTTP 方法，不得额外 re-export `checkStorageConfiguration`。保持 GET 响应、Storage driver、S3/Vercel Blob 配置检查、Admin Storage、RBAC 和测试语义不变；仅将配置函数测试改为直接从 `app/lib/file-storage/configuration.ts` 导入。

验收必须运行相关 Storage unit、TypeScript、lint、production build 与 diff check。该修复不得改动 Storage 数据、删除对象、引入新 driver 或连接共享服务；build 继续在临时源码副本运行，避免覆盖用户拥有的主 `.next`。

Optional Enhancers:

- 后续可增加 lint 规则或 route type test，提前阻止 App Router 文件导出非白名单符号。

## Round 20–21 执行证据

- 根因：用户型关系选择器读取手工 `platform_users`，把内部文本 FK 适配行误建模成独立“计费用户”；只有 QA 账号被手工创建，所以其他 canonical 用户不可选。
- 迁移：新增 `0015_platform_users_are_billable.sql`，回填 canonical 用户、幂等创建一对一零余额账户并建立同步 trigger；无删除、清空或旧关联改写。
- API/Resource：所有用户选择器从 `users` 驱动；POST `platform-users` 返回 405；Billing Account 仅关联 canonical 用户；UI 统一称“平台用户”。
- 隔离数据库：PostgreSQL 16 `127.0.0.1:55432/ink-memory` 从 0000–0015 迁移并加载 fixture；2 users = 2 internal links = 2 accounts。新增用户后为 3/3/3，重复 migration 不重复，既有 Subscription 保留。
- 门禁：TypeScript、lint、diff check 通过；Vitest 41 files / 214 tests 通过，Storage focused 9/9 通过；subscription Playwright 1/1（11.3s），Admin 综合 Playwright 1/1（1.0m），视口含 1440×1000 与 390×844。
- Build：发现并修复 Next.js 16 禁止 Route Handler 额外导出工具函数的问题；移除 Storage route 的 re-export，测试改从 lib 导入。`next build --webpack` 完整通过；默认 Turbopack 在临时副本因 `node_modules` 指向仓库外的 symlink 主动拒绝，属于临时副本工具限制。
- 执行偏差：首次迁移命令漏写一次性 URL，导致共享 5433 非破坏性应用 0015；无 DROP/DELETE/TRUNCATE，未擅自回滚。另一次 build 误在主仓库 `.next` 完成；3000 进程仍监听且 `/admin` 返回 307。两项均在用户更新与最终报告中明确披露。

## Round 22 — 平台 PRD 与交互规范模块化

Optimized Prompt:

重构 Ink Memory Admin 的产品需求与交互规范，使文档能够按业务模块独立阅读、评审、实施和验收，同时保留一份轻量总纲作为唯一导航入口。先盘点当前路由、Refine Resource、API、Repository、PostgreSQL 表、RBAC 权限、订阅/Gateway/Storage/Story 状态和既有设计 Token；不得根据旧标题或页面名称猜测。现有 Gateway 专项条款应归入 Gateway 模块，不再占据平台主 PRD 和主交互规范。

在 `docs/prd/modules/` 下按模块创建 PRD，在 `docs/design/modules/` 下创建对应交互规范。至少覆盖：平台总览与 Admin Shell、平台用户与计费账户、Dream 创作运营、订阅与权益、Provider/Model/Pricing、Gateway Key/Request/限流、Usage/Ledger/账单、Storage、Admin/RBAC/Audit/System。每个模块文档必须包含模块目标、角色、范围/非范围、真实数据边界、页面与路由、Resource/API/Service/表映射、核心流程、状态/错误、权限、安全、验收和跨模块依赖；交互规范必须逐页定义列表、筛选、排序、分页、详情层级、创建/编辑容器、字段控件、校验、危险确认、loading/empty/error/403/404/409/503、1440×1000/390×844、键盘/焦点/label/读屏行为。

将 `docs/prd/ink-memory-admin-prd-v3.md` 改为平台 PRD 总纲和模块索引，将 `docs/design/refine-admin-ui-v3-interaction-design.md` 改为全局 UI/UX 规范和模块索引。总纲必须明确 canonical `users` 是唯一平台用户集合、所有用户天然可计费，`platform_users` 仅是内部兼容键；账务、Usage、Ledger、Audit 不可变/只追加；Secret 永不回显；Route Handler 只编排；PostgreSQL-only；Dream 只读边界和非破坏迁移策略。模块间术语、路由、权限码、状态、金额单位和验收编号必须一致，链接使用相对路径并可从总纲双向导航。

完成后执行 Markdown 链接/标题/术语检查，并以无上下文读者视角验证：产品、设计、后端、QA 和运营人员能在两次点击内找到某模块的目标、页面、数据来源、权限、交互与验收标准。不得只复制旧文档形成冗余，也不得把未实现能力写成已上线事实。

Optional Enhancers:

- 在总纲增加模块成熟度、Owner 和变更记录表，但没有真实 Owner 时标记待定而不虚构姓名。
- 为关键模块增加 Mermaid 流程与跨模块依赖矩阵，避免在每份文档重复同一架构说明。

## Round 23 — 模块文档读者测试与一致性校验

Optimized Prompt:

对 Round 22 生成的平台 PRD 总纲、全局交互规范以及 9 组模块文档执行无上下文读者测试和机械一致性校验。读者角色覆盖产品经理、前端工程师、后端工程师、QA、运营和安全审计；验证其能仅从总纲在两次点击内定位模块目标、路由、数据来源、权限、核心流程、字段控件、错误恢复、响应式和验收编号。

机械检查必须覆盖：所有相对 Markdown 链接目标存在；PRD/交互模块一一对应且双向链接；标题唯一；状态名、权限码、路由、表名、micro-USD、canonical `users` 和“无独立计费用户”术语一致；不得残留把 Gateway 专项文档当作平台总纲的标题或手工创建计费身份流程。读者测试重点查找含糊边界、未声明假设、实现状态误报、模块间职责重叠和验收不可测试问题。

发现问题时只做针对性修订，不复制全局 Token 或跨模块规则到每份文件。最终输出文档树、校验结果、读者问题及修订摘要；本阶段只修改文档，不修改应用代码、Schema、迁移或 Dream 项目。

Optional Enhancers:

- 后续可将链接和术语检查固化为 CI 脚本，但本轮不因缺少 Markdown 工具链而引入新依赖。

## Round 22–23 执行证据

- 文档架构：`docs/prd/ink-memory-admin-prd-v3.md` 收敛为平台总纲，`docs/design/refine-admin-ui-v3-interaction-design.md` 收敛为全局交互规范；分别建立 00–08 九个 PRD 模块与九个对应交互模块。`00-platform-foundation` 对应 `00-admin-shell`，其余模块同名双向链接。
- 核心产品纠偏：明确 canonical PostgreSQL `users` 是唯一平台用户全集，所有平台用户天然可订阅和计费；`platform_users` 仅是内部兼容键，不存在单独“计费用户”产品设计，也没有手工开户流程。
- 当前态/目标态分层：逐模块增加 2026-08-08 实现状态；把聚合详情、完整影响预览、Workflow、debit/reversal、页面级 permission guard、可扩展 Relation Selector 等未完成能力标为目标，不作为已实现事实。
- Reader Testing 修订：补齐 Gateway 401/402/403/409/429/502/503 错误合同、订阅升级/降级/续费真实账务规则、`cancel_at_period_end` 与自动状态推进实际限制、Billing credit/CSV 实际状态、限流 `users.write`、Provider/System Secret 与 Gateway Key 的不同回执策略。
- 发布风险显式化：记录 Gateway auth 未反向验证 canonical 用户及历史 orphan `platform_users` 风险、从未订阅用户 cash-only 兼容且无开关、Token allowance 402 将 Token 混入 micro-USD 字段、两个用户选择器前 100 条限制、Dashboard/页面权限缺口。文档不虚构这些问题已修复。
- Story 边界：当前仅确认 `users`、`story_workspace_workspaces`、`story_workspace_stories`；Character/Scene 条件开放，Workflow 权威表/API 尚未确认且当前路由重定向 Story，不再描述成已实现列表/Drawer。
- 历史权威性：旧 `ai-platform-admin-billing-gateway-design.md` 标记 Superseded，并明确指向 v3 平台总纲、Gateway PRD 与交互规范；旧 v2/Story 专项文档保留为历史证据。
- 机械校验：21 份本轮变更 Markdown 相对链接检查 `0` 断链；PRD 模块 `9`、交互模块 `9`、缺失配对 `0`；`git diff --check` 通过。
- 修改边界：本阶段仅更新 `ink-admin-memory/docs/**`；未修改应用代码、Schema、迁移、数据库或 Dream 项目。

## Round 24 — Dream 后续接入、页面改造与 PostgreSQL 迁移文档

Optimized Prompt:

在 `/Users/dmeck/project/ink-admin-memory` 内更新面向 `/Users/dmeck/project/ink-dream-memory` 的后续业务接入、页面改造和 PostgreSQL 迁移文档；Dream 仓库全程只读，不修改代码、Schema、迁移、依赖、环境变量或运行逻辑。先基于 Dream 真实 Schema、迁移、查询、API、类型、页面路由和当前数据持久化方式，以及 Admin 已完成的数据接入审计、PRD、Gateway/Subscription 设计和历史改造清单，逐项核对事实；禁止依据旧方案标题或表名猜测。

在 `docs/architecture/ink-dream-memory/` 建立唯一正式文档入口，至少包含：总索引与范围说明、现阶段业务接入清单、前端页面与交互改造清单、PostgreSQL 迁移方案、部署灰度与回滚清单。把已有 `ink-dream-memory` 迁移/订阅/Gateway 改造方案中仍有效的内容修订后归入该目录；旧路径保留轻量 superseded/redirect 说明，避免断链，不复制相互冲突的正文。

本阶段明确不开发计费、订阅、推理服务和订阅支付：Dream 不新增套餐选择、订阅管理、余额/额度、Usage/Ledger、支付收银台、支付 Webhook、Gateway Key 管理、模型代理调用或推理错误处理页面；相关内容只在“延期范围与未来触发条件”中登记，不作为当前 API、环境变量、迁移、页面或验收任务。现阶段仅规划 Dream 真实业务数据迁入统一 PostgreSQL `ink-memory` 及不依赖上述延期域的必要适配，保持用户、Workspace、Story 等 canonical 实体唯一，Admin 不建立平行业务表。

PostgreSQL 迁移方案必须写明：现状数据源与证据、目标表/字段/主外键/枚举映射、扩展与冲突项、迁移前只读盘点、可重复导出与校验、目标 schema 基线、分批导入顺序、ID/时间/JSON/空值处理、外键与唯一冲突隔离、双写/停写选择、切换窗口、校验 SQL 类型、应用配置切换、灰度、回滚和数据保留。任何验证只能使用明确隔离 PostgreSQL 或 `TEST_DATABASE_URL`；不得连接、迁移、清空或写入未知/共享 `ink-memory`，不得提出 SQLite/JSON/内存回退。

每份文档必须标注受众、当前事实、目标状态、本期范围、延期范围、前置条件、具体文件/模块建议、操作顺序、验收标准、风险与回滚；路径、表名、字段、页面和环境变量必须能由仓库证据支撑。完成后执行相对 Markdown 链接、文档配对、术语和延期范围一致性检查，并用无上下文读者测试确认其不会误以为计费、订阅、推理或支付需要本期开发。

Optional Enhancers:

- 为 PostgreSQL 迁移增加可复制的只读盘点/校验 SQL 模板，但不得包含针对共享库的 DROP、TRUNCATE、DELETE 或自动执行命令。
- 在总索引增加“现在做 / 明确不做 / 未来触发后再做”矩阵，便于产品、Dream 前端、后端、QA 和运维共同评审。

## Round 25 — Dream 模块化接入与 PG 迁移文档编写

Optimized Prompt:

基于已完成的只读盘点，在 `docs/architecture/ink-dream-memory/` 编写 Dream 后续改造的唯一正式文档集。建立 `README.md` 总索引，并按以下职责拆分：当前范围与源系统基线、业务数据接入和 Admin 读写边界、前端页面改造清单、完整 PostgreSQL 迁移方案、发布/验证/回滚、延期领域、历史文档与证据映射。每份文件必须双向链接总索引，并标明状态、受众、本期范围、延期范围、具体 Dream 文件建议和可验证验收。

当前实施主线仅是将 Dream 的真实业务持久化从 SQLite 分阶段迁入统一 PostgreSQL `ink-memory`，保持现有用户、认证、Workspace、Story、Character、Scene、Deck、Chat、Workflow、Plugin、Reflection、Event 等业务语义和页面行为；Admin 继续使用 canonical 原名表和受控读写边界。本期禁止新增或接入计费、订阅、订阅支付、模型推理服务、Gateway、套餐/额度/Usage/Ledger 页面与 API，也不修改现有 Dream 推理运行时的产品行为。现有静态订阅页应列入“隐藏入口/移除虚构档位”的页面清理任务，但不能替换成真实订阅开发。

PostgreSQL 文档必须反映真实迁移复杂度：主 `database.py` 当前创建 43 张表并被大量 router/service 直接耦合；`notion/store.py` 另有 5 张 SQLite 表；现有 Admin 导入器只验证 `users`、`story_workspace_workspaces`、`story_workspace_stories` 三表，不能冒充 Dream 全量运行时迁移。给出迁移所有权、目标角色、迁移基线、依赖波次、SQLite→PostgreSQL SQL/类型/事务差异、只读快照、转换、staging、导入、行数/PK/FK/JSON/枚举/哈希验证、停写切换和回滚。优先选择演练充分后的短暂停写切换，不提出无幂等保证的长期双写。

旧 `docs/architecture/ink-dream-subscription-integration-change-list.md`、`docs/integration/ink-dream-memory-postgresql-gateway-migration.md` 和 `docs/integration/ink-dream-memory-admin-gateway.md` 改为轻量历史入口，分别指向新 Deferred、PG 迁移和总索引；更新 `docs/README.md` 与平台 PRD 中的 Dream 后续改造入口。不得删除旧文件、破坏相对链接或把历史验收结论改写成当前事实。

验收要求：所有新旧入口链接可解析；当前范围文档中不得出现要求实施 billing/subscription/payment/inference/Gateway 的任务、环境变量或测试；Deferred 文档必须明确需要产品重新立项和触发条件；PG 方案不包含 DROP/TRUNCATE/DELETE 共享数据的自动命令；Dream 仓库、数据库、应用代码和迁移均保持未修改。

Optional Enhancers:

- 在页面清单中加入“保留 / 隐藏 / 仅数据层适配 / 延期”四态矩阵。
- 在 PG 迁移文档中加入只读校验 SQL 模板与迁移回执字段规范，避免输出密码哈希、正文或 Secret。

## Round 26 — Dream 文档入口与延期范围一致性校验

Optimized Prompt:

对 `docs/architecture/ink-dream-memory/` 新文档集及所有旧 Dream 入口执行机械和语义一致性校验。确认总索引能在一次点击内到达范围、业务接入、页面、PG 迁移、发布回滚、Deferred 与证据文档；所有相对链接目标存在；H1 唯一；旧订阅/Gateway/PG 混合文档顶部明确 current/deferred/superseded，并指向当前权威文件。

扫描当前执行文档，禁止出现要求本期实施 Billing、Subscription、Payment、Inference Service、Gateway 的 API、环境变量、页面、数据库表、测试或上线动作；允许出现的相关文字只能用于“暂不开发、禁止、保持既有行为、延期触发条件”。检查 PG 方案完整覆盖 Dream 主库 43 表和 Notion 5 表、现有 Admin 三表导入器的能力上限、canonical 用户唯一性、Schema 所有权、staging 冲突、停写切换和已有 PG 写入后的回滚限制。

修复任何断链、歧义、旧入口竞争、当前/未来混写或不安全数据库指令。运行 `git diff --check` 和文档范围检查；不得运行 Dream 构建、数据库迁移或外部服务，不修改 Dream 仓库和应用代码。

Optional Enhancers:

- 生成当前执行文档与 Deferred 文档的关键词分类报告，保证同一动作不会同时出现在两种状态。

## Round 27 — Dream 文档无上下文读者验收

Optimized Prompt:

以首次接触项目的产品、Dream 前端、Dream 后端、DBA 和 QA 读者视角，只阅读 `docs/architecture/ink-dream-memory/` 的新模块化文档及三个旧路径入口，不依赖此前对话。回答并以文档证据核对：当前唯一实施主线是什么；计费、订阅、订阅支付、推理服务和 Gateway 是否需要本期开发；静态订阅页如何处理；平台用户与未来计费身份是否为同一全集；PostgreSQL 迁移是否完整覆盖主库 43 表与 Notion 5 表，并明确现有 Admin 导入器只覆盖三表；Dream 与 Admin 各自拥有哪些 Schema；停写、切换、校验和已产生 PostgreSQL 新写入后的回滚边界是什么。

重点寻找会让执行团队误解的矛盾、隐含开发任务、未经证实的路径/表/环境变量、危险数据库操作、断链、旧文档权威性竞争和缺少验收条件。读者只给出证据化问题清单，不修改文件；主执行者使用 `apply_patch` 修复所有有效发现后，重新运行相对链接、H1、延期关键词、文档范围和 `git diff --check` 校验。不得运行 Dream 构建或数据库迁移，不得修改 Dream 仓库、应用代码、Schema、配置或任何数据库。

Optional Enhancers:

- 要求读者用一句话复述发布决策；若复述中出现“本期接入订阅/Gateway/支付”，即判定文档范围表达失败。

## Round 24–27 执行证据

- Dream 只读事实复核：`backend/database.py` 的 `CREATE TABLE IF NOT EXISTS` 计数为 43，`backend/notion/store.py` 为 5；当前仍使用 SQLite，且 `backend/pyproject.toml` 未包含正式 PostgreSQL driver/migration runner。现有 Admin `scripts/import-ink-dream-story-source.mjs` 只覆盖 `users`、`story_workspace_workspaces`、`story_workspace_stories` 三表，未被描述为全量迁移器。
- 模块化交付：在 `docs/architecture/ink-dream-memory/` 建立 8 份当前范围、边界、页面、PG 迁移、发布回滚、Deferred 与证据文档；`docs/README.md` 和平台 PRD 均指向该唯一正式入口。
- 范围与身份纠偏：当前唯一主线是 Dream 真实业务持久化迁 PostgreSQL `ink-memory`；计费、订阅、订阅支付、推理服务与 Gateway 不进入 Dream 本期 API、页面、表、环境变量和验收。canonical `users` 是唯一平台用户全集，未来每个平台用户天然是计费主体；只显示 `qa-author@ink-memory.test` 等单个账号属于查询/投影/测试种子缺陷，不是“计费用户”设计。
- 页面合同：静态三档订阅页面和设置入口列为清理项；旧 `/story-workspace/subscription` 统一使用 replace navigation 重定向已由 Dream 路由证据确认存在的 `/story-workspace/settings/about`，不创建真实套餐、Usage、余额或支付页。
- 迁移方案：覆盖 43 + 5 表、Dream/Alembic 与 Admin/Drizzle 分领域所有权、canonical 三表 baseline adopt、只读快照、manifest、staging、冲突阻断、分波导入、短暂停写切换、隔离测试和 PG 写后回滚边界；physical owner/ACL 必须在实施前只读盘点并单独审批，不由文档假定或授权。
- 无上下文 Reader Testing 能准确复述发布决策，P0 为 0；发现三个旧入口保留完整可执行 Gateway/Billing 正文会造成 P1 权威性竞争，以及 redirect/404 和 physical owner/ACL 两项 P2 歧义。已将旧入口收敛为轻量墓碑页、固定 redirect 合同并补充所有权审批边界。
- 机械验收：13 份入口/关联文档相对链接 0 断链、H1 异常 0；8 份新模块齐全；6 份 current-scope 文档中未受否定/延期语义保护的计费、订阅、支付、推理或 Gateway 动作为 0；`git diff --check` 通过。
- 修改边界：本阶段仅编辑 `ink-admin-memory/docs/**`，未运行 Dream 构建或数据库迁移，未修改 Dream 代码、Schema、迁移、依赖、配置或任何数据库。

## Round 28 — Dream 文档交付收口

Optimized Prompt:

在 Reader Testing 修订完成后，对 Dream 模块化文档执行最终只读交付审计，不新增产品或工程范围。确认 8 份新模块、3 个旧路径墓碑页、`docs/README.md` 和平台 PRD 入口一致；重新检查所有相对链接、唯一 H1、Markdown 空白、延期域动作语义和工作日志记录。确认 PostgreSQL 方案仍精确表达 43 + 5 表、三表导入器上限、Schema/ACL 所有权审批、隔离数据库、停写切换和 PG 新写入后的回滚边界；确认静态订阅 URL 只有一个 redirect 合同，canonical `users` 是唯一平台用户全集，单个 QA 账号不构成“计费用户”设计。

只允许修复文档断链、排版或范围歧义；不得修改 Dream 项目、Admin 应用代码、Schema、迁移、测试或数据库。全部检查通过后关闭当前文档计划，并在最终报告中给出权威路径、范围决策、迁移要点、验证数量和未执行事项。

Optional Enhancers:

- 最终报告优先链接总索引、页面清单、PG 迁移和 Deferred 四个入口，其他模块通过总索引访问。

## Round 29 — 43+5 PostgreSQL、订阅计费与 Gateway 范围重启证据审计

Optimized Prompt:

作为 Ink Memory 的资深产品架构师、PostgreSQL 数据迁移架构师、订阅计费与 AI Gateway 架构师及全栈审计负责人，在任何 PRD、交互设计或业务代码修改前，对 `/Users/dmeck/project/ink-dream-memory` 与 `/Users/dmeck/project/ink-admin-memory` 执行证据化只读审计，并输出 `docs/verification/ink-dream-memory-pg-billing-gateway-treatment-decision.md`。不得依据旧文档标题、表名或历史结论推断实现；必须逐项核对真实 DDL、迁移、SQLite 元数据、PostgreSQL schema 来源、Repository、事务、Route/API、类型、页面和测试。

审计必须建立 Dream 主库 43 表与 Notion Connector 5 表的完整目录，记录每表 PK、FK、unique、check、enum、trigger、JSON、时间、默认值和不可变语义；定位所有 `sqlite3.Connection`、`database.get_db()`、PRAGMA、`BEGIN IMMEDIATE`、SQLite trigger、`?` 占位符及运行时 fallback；证明 Admin 现有三表导入器的能力上限。核对 canonical PostgreSQL `users`、内部兼容 `platform_users` 与一对一 Billing Account 的实际关系，追踪“只有 QA 用户可计费”到具体查询、分页、投影、迁移或 fixture 根因，并列出修复位置。对 Admin 已有 Plan/Version/Entitlement/Subscription、Allowance/Balance、Gateway、Usage/Ledger、Payment/Webhook 能力按 Current、Planned、Implemented、Deferred 分类，禁止把规划误报为实现。

处理判断必须固定新的范围决策：Dream 43+5 全量 PostgreSQL 迁移、真实订阅展示、计费协作、Gateway 接入和新推理调用链从 Deferred 重新进入 Planned/Implemented；真实第三方支付渠道仍 Deferred，仅允许标准 `PaymentAdapter`、Webhook 签名与事件幂等边界、测试环境 Fake Adapter。Dream 拥有 canonical 业务 Schema、Repository、写入和 Alembic；Admin/Gateway 拥有控制面、订阅、计费、Provider/Model/Pricing、Gateway、Usage/Ledger、Payment Adapter；双方独立 Repository、角色、迁移日志和最小权限。物理 PostgreSQL owner/ACL 只做只读检查，未经明确授权不得执行 `ALTER OWNER`、GRANT/REVOKE。

文档至少包含领域矩阵、43+5 表目录、SQLite 耦合位置清单、所有权/读写边界、保留/停止使用/映射/接管/分阶段弃用决策、迁移与产品接入依赖顺序、风险、灰度、回滚和发布阻断项。审计期间不得修改业务代码、不得连接或写入共享 PostgreSQL、不得读取或输出真实 Secret、不得覆盖用户未提交修改。完成后以代码路径、行号、命令输出和机械统计复核证据；只有审计文档通过复核，才能开始 PRD/架构/交互设计阶段。

Optional Enhancers:

- 用可机器复核的表级 manifest 表达 43+5 schema，并为后续迁移 CLI 复用字段名。
- 把 SQLite 方言耦合按 DDL、事务、查询、触发器和测试 fixture 分类，便于拆分 Repository/UoW 波次。
- 对 canonical 用户投影增加大于 100 用户、分页总数和 orphan `platform_users` 的专项证据矩阵。

范围变化：

- 撤销 Round 24–28 中“Billing、Subscription、Gateway、新推理链路全面 Deferred”的当前范围决定；这些能力重新进入规划与实现范围。
- 真实 Stripe、支付宝、微信支付、银行等外部支付渠道继续 Deferred；Payment Adapter 合同、Webhook 幂等存储和测试环境 Fake Adapter 进入范围。
- 本轮授权在证据审计、PRD 与交互设计完成后修改 Admin 和 Dream 两个项目；此前 Dream 只读约束不再适用于后续实现阶段。

执行证据和验证结果：

- 只读 preflight：Admin `git status --short` 为空；Dream 仅存在用户既有未跟踪 `.claude/worktrees/`，已标记为禁止覆盖或清理。
- worklog 机械检查确认既有记录到 Round 28；Round 24–28 明确把本轮重新启用能力列为 Deferred，范围矛盾成立，需在审计与后续权威文档中消除。
- 已创建 `docs/verification/ink-dream-memory-pg-billing-gateway-treatment-decision.md`。真实 SQLite metadata 与文档逐表比对结果为主库 actual/documented `43/43`、Notion actual/documented `5/5`、差异 `0`；主库另有 25 个真实 trigger。
- 运行时机械审计（排除 `.venv` 与 tests）记录：`sqlite3.Connection` 34 文件/115 处、`database.get_db()` 16 文件/52 处、PRAGMA 3 文件/7 处、`BEGIN IMMEDIATE` 11 文件/22 处、SQL AST 下界 42 文件/436 个字面量/1,425 个 `?` 占位符。
- Admin importer 证据确认只覆盖 `users` 与两个 Story 表；另确认每表 JSON stdout 64 MiB、三表全量并发入内存、逐行 `await INSERT`、无分页/batch/COPY、`COUNT(*)::int` 及 sequence 只校准未复核等容量上限。
- canonical 用户审计确认 `0015` 与 canonical-driven list 已修复主投影，但 Gateway auth 未反查 `users`、专用 selector 只取前 100、通用 RelationSelect 只取前 50/100、mutation 仍可写兼容行 email/display name，且 subscription/key/permission 命令未统一补齐 canonical account。
- 推理审计覆盖 PolyAgent、Claude Agent/Chat、Dream/Workflow/Guidance/Reflection、Image 与 Settings 静态模型；明确 Dream `dream_launch_gateway.py` 不是 Admin 计费 Gateway。另发现 `/ws/speech-recognition` 未鉴权直连 ASR Provider。
- P0 Secret 证据：`backend/speech_recognition.py:9` 含已提交、形似有效的 Provider credential，Git 历史可追溯到提交 `2deb4b1`。未在文档复述、未联网验证或使用；发布门禁要求密钥所有者吊销/轮换、代码移除、经批准的历史处置与 secret scan。文件名级扫描的其他两处命中为 URL/文档 slug 假阳性。
- 无上下文 Reader Testing 首轮发现表分组计数、W5 拓扑、PG-compatible rollback build、ASR 消费面、append-only writer 冲突、canonical profile split-brain、workflow 状态数和 importer 容量等问题；逐项修订后复核结论为 `PASS`，未发现未记录的 P0/P1 处置缺口。
- 审计期间 Admin 出现用户并行修改，范围从 Navigation/Model Permission/E2E 扩展到 Gateway/PRD/Design 等文件；均未覆盖或回滚，后续只允许基于最新 diff 增量适配。
- `git diff --check` 通过；尚未连接、迁移、清空或写入任何 PostgreSQL，也未调用外部 Provider 或真实支付网络。

未执行事项及原因：

- PRD、架构正文、交互设计和业务代码尚未修改：Task 1 已完成并通过 Reader Testing；这些工作必须在下一阶段另行记录 Prompt Architect round 后开始。
- PostgreSQL owner/ACL、真实数据和迁移演练尚未执行：审计阶段先从仓库与可安全访问的配置/只读元数据确认目标，任何数据库操作必须另行满足隔离与授权边界。
- credential 吊销/轮换与 Git 历史 purge 未执行：需要密钥所有者和仓库协作授权；本轮只记录并阻断发布，不擅自调用 Provider 或重写共享历史。
- 外部 Provider 与真实支付网络未调用：不属于审计需要，且真实第三方支付明确 Deferred。

## Round 30 — 范围重启后的 PRD、架构与 Dream 交互设计

Optimized Prompt:

作为 Ink Memory 的资深产品架构师、订阅计费与 AI Gateway 架构师、PostgreSQL 迁移架构师及 UI/UX 负责人，以已经通过 Reader Testing 的 `docs/verification/ink-dream-memory-pg-billing-gateway-treatment-decision.md` 为事实基线，在 `/Users/dmeck/project/ink-admin-memory/docs/**` 完成范围重启后的权威文档修订。先读取每个目标文件的最新工作树版本并保留用户并行未提交修改；不得用旧文档整文件覆盖新改动。

更新 `docs/architecture/ink-dream-memory/README.md`、01–05、90、91，新增 06 Billing/Subscription/Gateway、07 Dream Subscription/Inference、08 Payment Adapter/Webhook。每份文档必须标注 Current、Planned、Implemented、Deferred 或 Superseded，且同一能力不得同时 Planned 与 Deferred。Round 24–28 的全面延期决定必须作为历史保留：43+5 PostgreSQL、订阅展示、计费协作、Gateway 与新推理链恢复为 Planned/Implemented；只有真实第三方支付渠道和未具备 streaming-audio capability 的 ASR Gateway 保持 Deferred。逻辑 owner 不授权物理 `ALTER OWNER`/GRANT/REVOKE。

同步更新平台总 PRD、相关 `docs/prd/modules/**`、全局交互规范和 `docs/design/modules/**`。所有能力以 Current / Target / Release Gate 三层表达，覆盖唯一 canonical `users`、自动 billing identity、immutable Plan Version/Pricing/Entitlement、Subscription 状态机、Allowance/Overage/Balance、micro-USD、Gateway eligibility 与结算、Dream 产品 API、PaymentAdapter/Webhook 幂等、迁移/canary/rollback、401/402/403/404/409/429/502/503，以及可自动测试的验收标准。明确现存 hardcoded credential、未鉴权 ASR WebSocket、platform profile split-brain、前 50/100 用户选择器、cash-only compatibility 和 append-only writer 冲突均是 release blockers，禁止误报已修复。

在 `docs/design/ink-dream-memory/` 建立 README 与五个正式模块：Subscription Experience、Usage/Balance/Overage、Model/Gateway、Payment Adapter States、Migration/Maintenance/Error States。逐页定义目标/操作者、真实 Admin 产品 API 数据源、字段/控件/列表/详情/状态、loading/empty/error/403/409/429/503、开通/续费/升降级/暂停/恢复/取消的影响预览、Allowance/余额/Usage/预计超额/Ledger 信息层级、Secret 永不展示、1440×1000 与 390×844、键盘/焦点/Label/读屏/错误恢复。`/story-workspace/subscription` 必须从静态数组转为真实数据合同；不得设计静态 fallback、假价格、假余额、虚假支付成功或默认 CRUD 外壳。

至少提供七组可渲染 Mermaid：User→Billing Account→Subscription、Subscription→Entitlement→Model Permission、Dream Session→Gateway→Provider、Gateway Request→Allowance/Balance→Usage→Ledger、完整订阅生命周期、Payment Adapter→Webhook→Idempotency→Subscription Event、SQLite 43+5→Staging→PostgreSQL→Cutover。完成后执行相对链接、H1、状态冲突、术语、路由、错误码、micro-USD 与 Mermaid fence 机械检查，并让无上下文产品/前端/后端/QA/安全读者复核；所有有效问题修复后才能进入代码阶段。

Optional Enhancers:

- 为 API 合同增加 request/response 字段表、idempotency key、ETag/version 与错误恢复示例，但不虚构尚未实现的 endpoint 路径为 Current。
- 为两个视口增加低保真信息架构 wireframe，前提是能明显帮助解释层级，而非装饰性静态 mock。
- 将文档验收 ID 映射到后续 Admin/Dream unit、integration 与 focused Playwright 测试名称。

范围变化：

- 相对 Round 24–28：Billing、Subscription、Gateway、新推理链和 Dream 真实订阅体验从 Deferred 恢复为 Planned；现有 Admin 基线按真实证据标为 Implemented/Partial，不能整体标为完成。
- 真实第三方支付渠道仍 Deferred；PaymentAdapter、Webhook event store/签名/幂等和 test-only Fake Adapter 为 Planned。
- Speech/ASR 不在当前 Gateway 已支持能力中；未鉴权 endpoint 必须先禁用或加 canonical 鉴权，只有明确 audio streaming 计量/结算合同后才从 Deferred 转 Planned。
- 本阶段只修改文档；Admin 与 Dream 应用代码、Schema、migration 和数据库仍不进入修改范围。

执行证据和验证结果：

- Task 1 决策文档已由独立无上下文 Reader Testing 判定 `PASS`，主库 43/43、Notion 5/5，差异 0。
- 已确认 Admin 工作树存在用户并行修改，其中包括 PRD/Design 模块；本阶段必须逐文件读取最新内容并以小块 patch 增量合并。
- 尚未开始本阶段正文修改、机械检查或读者测试。

未执行事项及原因：

- 架构、PRD、交互设计正文尚未修改：本 Round 记录是进入阶段前的强制门禁，完成本记录后才可开始。
- 应用代码、数据库和外部服务不执行：必须等待本阶段文档与 Reader Testing 完成。

## Round 31 — Token-only 月度订阅语义纠偏审计

Optimized Prompt:

作为 Ink Memory 的资深产品架构师、PostgreSQL 数据架构师、订阅状态机架构师、Gateway 计量结算工程师和 Refine UI 负责人，纠正当前 Subscription Plan/Plan Version 把订阅 Token 权益与金额额度、平台统一生效日期混合的业务错误。先对最新工作树执行证据化审计，逐项追踪 `allowance_microusd`、套餐 currency/base price、Plan Version `effective_from/effective_to`、Subscription `current_period_start/current_period_end`、Allowance grant/renew、Gateway eligibility/settlement、Ledger、API contracts、Refine list/form/detail、Dream 产品 API、PRD、交互规范、Drizzle schema/migration 和测试的真实调用链；不得仅删除表格列形成视觉修复。

固定目标业务不变量：Subscription Plan 是用户级月度 Token 权益规则，只定义周期、Token 配额、模型/Scope/RPM/Storage 等非货币权益；不定义或发放 micro-USD 金额额度，不把 Token 折算成套餐金额，不以平台统一 `effective_from/effective_to` 决定所有用户何时生效。每个 Subscription 以自身 `current_period_start/current_period_end` 计算月度周期并在周期边界幂等发放 Token allowance；Plan Version 只作为不可覆盖的规则快照，以 draft/published/retired 与 `published_at`/版本号管理，不使用全局生效时间窗。升级、降级、续费和版本切换必须明确立即或下周期语义，并保持 Token grant/reserved/consumed 守恒。

Subscription 域不得包含 currency、base price、subscription charge、monetary allowance、预计金额超额或 PaymentAdapter 依赖。既有 cash Billing Account、micro-USD Ledger、Provider Pricing 和 Gateway pay-as-you-go/overage 若继续保留，必须作为独立按量计费领域：不能由套餐发放、不能影响套餐 Token 额度展示，也不能把 Token allowance 写入 micro-USD 字段。真实支付与订阅购买不在本轮；不得因移除套餐金额破坏历史现金账本、Provider 定价快照或 Gateway 已结算事实。

先更新权威 PRD、架构与交互文档并记录 Current/Target/Migration/Release Gate，再修改 Schema、前向且可回滚的 Drizzle migration、Repository/Service/API/UI 和测试。旧列不得直接 DROP；采用停止写入、nullable/deprecated、读路径切换、回填/验证和后续独立清理的分阶段方案。Route Handler 保持轻薄；Usage、Ledger、Audit 只追加；Secret 永不回显；只使用显式隔离 PostgreSQL。保留用户并行未提交修改，所有编辑使用小块增量 patch。

验收必须证明：Plan/Version 页面不再出现“金额额度”、币种、套餐价格或平台生效窗口；月度 Token 配额由每个用户自己的订阅周期计算；两个不同开始日用户的周期互不影响；重复续费/并发周期推进不重复发放 Token；Gateway 先消耗 Token allowance，独立现金结算仅按已批准的非订阅策略发生；历史 monetary subscription 数据可审计但不再参与新决策。运行聚焦 unit、TypeScript、lint、隔离 PostgreSQL integration、focused Playwright，并覆盖 1440×1000 与 390×844；不得连接、迁移或清理共享数据库。

Optional Enhancers:

- 为月末、闰年、时区、补偿重试和并发 renewal 增加状态机属性测试。
- 在 Subscription 详情增加仅 Token 的 `granted / reserved / consumed / remaining` 周期进度，不展示任何货币换算。
- 为 deprecated monetary 字段增加只读审计报表与迁移完成率，但不在运营主流程继续展示。

范围变化：

- Subscription 从“价格 + 金额/Token allowance + 平台有效窗口”收敛为纯 Token 月度权益规则。
- 真实支付、PaymentAdapter 与 subscription charge 不再属于 Subscription 当前实现链路；cash Billing、Provider Pricing 和 Gateway 按量结算仅作为独立领域保留。
- 本轮先审计并更新 PRD/交互，再实施代码与隔离验证；不得把移除一个 UI 列误报为完成。

执行证据和验证结果：

- 尚未开始代码审计；本 Round 是进入纠偏阶段前的强制计划记录。

未执行事项及原因：

- Schema、API、UI 和测试尚未修改：必须先完成真实调用链审计和文档语义更新。
- 未连接任何数据库或运行浏览器：隔离测试目标尚未建立。

## Round 32 — Token-only 月度订阅 PRD、架构与交互规范

Optimized Prompt:

作为 Ink Memory 的产品架构师、订阅状态机架构师、AI Gateway 计量负责人和 UI/UX 负责人，以 Round 31 的真实代码审计为证据，在修改 Schema、服务或页面前，先把权威 PRD、架构说明与交互规范统一纠偏为“用户级 Token-only 月度订阅”。逐文件读取最新工作树并使用小块增量修改，保留用户和并行任务已有的未提交内容。

固定产品定义：canonical `users` 是唯一平台用户全集，每个平台用户天然可拥有订阅；Subscription Plan 只保存稳定的 code/name/status/description，Plan Version 是发布后不可覆盖的月度 Token 与非货币权益快照。版本不含 currency、base price、金额 allowance、现金 overage、Payment 依赖或平台统一 `effective_from/effective_to`。套餐规则在每个用户自己的 `[current_period_start,current_period_end)` 周期边界应用；两个不同开通日的用户有独立周期。版本只用 version/status/published_at 表达发布历史，不能用平台日历替代用户周期。

生命周期采用无金额语义：开通按用户 anchor 建首期；升级和降级都排到下一周期，避免中途重复发放 Token；续期只能在实际周期边界幂等推进；暂停、恢复和期末取消不收费。Token allowance 只展示与保存 granted/reserved/consumed/remaining tokens。套餐 Token 用尽返回明确 Token 单位的 402，不把 Token 折算成 micro-USD，也不由套餐自动动用现金余额。Provider Pricing、Billing Account、现金 Ledger 与非订阅按量调用可以作为独立领域继续存在，但不得出现在套餐权益、用户订阅详情或订阅购买链路中。历史 subscription monetary 字段和账本事实只读保留并分阶段停止写入，不直接删除。

至少更新平台订阅 PRD、订阅交互模块、平台总纲中相关引用、Gateway/Billing 边界文档，以及 `docs/architecture/ink-dream-memory/` 和 `docs/design/ink-dream-memory/` 下所有把套餐价格、余额、PaymentAdapter、全局生效窗口或金额超额当作订阅依赖的正文。Dream 页面只展示真实套餐 Token 规则、个人周期、Token 使用进度、模型权限与状态；不得展示套餐价格、充值、支付、金额余额或预计金额超额。真实支付和订阅支付明确 Deferred，不作为本轮发布门禁。

交互规范必须覆盖桌面 1440×1000 与移动 390×844、loading/empty/401/402/403/404/409/429/503、字段控件、Token 单位、生命周期确认、键盘/焦点/label/aria-live、高风险操作和错误恢复。Mermaid 流程统一为 `User → Subscription → Plan Version → Entitlement → Token Allowance → Gateway → Usage`，现金 Billing 仅以独立旁路出现。完成后执行关键词、链接、H1、Mermaid 和 Markdown 检查，并由无上下文读者验证“套餐不发金额、没有全局生效日、个人月度周期、支付延期、现金域独立”五项均能唯一复述。

Optional Enhancers:

- 为 Jan 31、闰年和两个不同开通日补充周期示例，明确锚点保持规则。
- 增加“历史金额字段仅审计、运营主流程不展示”的迁移状态徽标与发布门禁。

范围变化：

- Round 30 中 Subscription 对 price、monetary allowance、cash overage、PaymentAdapter/Webhook 的依赖全部撤销；真实支付与订阅支付恢复为 Deferred。
- Plan Version 不再使用平台全局生效时间；版本选择只在用户开通或个人周期边界发生。
- Provider Pricing 和独立现金按量计费继续存在，但不是 Subscription 权益或套餐兜底。

执行证据和验证结果：

- Round 31 已完成 Schema、migration、contract、service、Gateway、UI、测试和文档链路审计，确认错误语义是跨层实现而非单列表头。
- 本 Round 记录是进入权威文档修改前的强制门禁；正文与机械检查尚未开始。

未执行事项及原因：

- 应用代码、Drizzle migration、数据库和浏览器测试尚未执行；必须等待本阶段文档更新与 Reader Testing 完成。

## Round 33 — Token-only 月度订阅范围确认与执行计划重置

Optimized Prompt:

作为 Ink Memory 的资深产品架构师、PostgreSQL 迁移架构师、订阅状态机与 AI Gateway 架构师、FastAPI/Python 和 Next.js/Refine 工程负责人，以用户最新明确确认为最高优先级，将 Token-only 用户级月度订阅设为本轮唯一权威产品定义，并据此继续完成文档一致性、代码实现和隔离验证。

固定范围：canonical PostgreSQL `users` 是唯一平台用户全集；每个用户天然可拥有订阅。Subscription Plan 只保存稳定身份与状态，Plan Version 是发布后不可覆盖的月度 Token/模型/Scope/RPM/Storage 规则快照；不含 currency、base price、金额 allowance、cash overage、订阅 charge、PaymentAdapter 依赖或平台统一 `effective_from/effective_to`。每个 Subscription 使用自身 `billing_anchor_at/current_period_start/current_period_end`，在个人周期边界幂等发放 Token allowance；升级和降级排到下一周期，续期不得提前或重复发放，暂停、恢复、期末取消与撤销取消不产生金额语义。

Gateway 资格链固定为 canonical user → active subscription → published Plan Version → Entitlement/model permission → RPM/Token limit → Token allowance reserve/capture/release → Provider → Token Usage。套餐 Token 耗尽返回明确 Token 单位的 402，不把 Token 写入 micro-USD 字段，也不自动动用现金余额。既有 Provider Pricing、Billing Account、micro-USD Ledger 与非订阅按量调用保留为独立历史/按量域，不得进入 Subscription DTO、Dream 套餐页面或 Token allowance 决策。

真实支付、订阅支付、PaymentAdapter、Webhook event store、Fake Adapter 与第三方支付渠道全部 Deferred；当前代码、Schema、API、导航、页面和 release gate 不新增这些能力，不显示测试支付或虚假成功。Round 30 中与此冲突的 Payment/套餐金额设计由 Round 31–33 Superseded，但审计证据、43+5 PostgreSQL、canonical 用户修复、Gateway 接入、新推理链、Secret/ASR 安全阻断仍有效。

先完成 Token-only PRD/架构/Dream UX 的无上下文 Reader Testing 和机械一致性检查，确保不存在金额套餐、全局生效窗、Payment 当前范围或旧命令合同残留；再实施 Admin 前向兼容 migration、Repository/Service/API/UI 和 Dream 产品 API/真实订阅页/Gateway client；最后实现 Dream-owned 43+5 Alembic/Repository/迁移 CLI 并在显式隔离 PostgreSQL 执行 unit/integration/rehearsal/build/focused Playwright。保留所有用户并行未提交修改，禁止连接或破坏共享数据库，禁止读取/使用真实 Secret。

验收必须自动证明：两个不同开通日用户的周期独立；Jan 31/闰年/时区锚点确定；并发 renewal/重复 idempotency 不重复 grant；升降级只在下一周期换版；Token granted/reserved/consumed/remaining 守恒；402 单位准确；所有 canonical users 可订阅且 >100 搜索分页完整；Dream 无静态套餐/余额/支付；Gateway 不再 cash-only 绕过；43+5 PG-only runtime；两个视口与错误恢复通过。

Optional Enhancers:

- 为周期锚点、Allowance 守恒和并发续期增加属性测试。
- 为 deprecated subscription monetary 字段增加只读迁移审计，不在运营主流程展示。
- 为 Gateway rollout 增加 shadow eligibility 与用户级 canary，但 shadow 不扣 Token、不调用 Provider。

范围变化：

- 用户明确确认 Round 31–32 的 Token-only 月度订阅覆盖 Round 30 的套餐金额、现金 overage 与 PaymentAdapter 当前范围。
- PaymentAdapter/Webhook/Fake Adapter 与所有真实支付渠道统一 Deferred。
- 43+5 PostgreSQL、canonical user、Token Subscription、Gateway、Usage 和新推理调用链继续属于当前实现范围。

执行证据和验证结果：

- 用户已在当前任务明确回复“最新的需求是改为 Token-only 月度订阅”。
- 检测到工作树已由并行任务更新 Token-only PRD、架构和 Dream UX；此前已暂停冲突任务，未覆盖这些修改。
- 尚未修改本轮代码、Schema 或数据库；本记录是重新规划前的强制门禁。

未执行事项及原因：

- Token-only 文档最终 Reader Testing、代码实现与隔离测试尚未开始：完成本记录并重新读取最新工作树后执行。
- credential 吊销/轮换仍需密钥所有者外部操作；本任务不得联网试用该值。

## Round 31–32 执行证据

- Schema、`0014` migration、Zod contracts、Subscription service/repository、Gateway resolver/reserve/settle、Billing settlement、Refine 页面与 unit/E2E 全链路审计确认：金额不是单一表头，而是 Plan currency/base price、money allowance、cash overage、subscription charge、全局 `effective_from` 与 Token→micro-USD capture 的跨层错误语义。
- 周期审计确认 `effective_from` 从未参与版本资格；当前 early renew 会提前切换未来周期，Gateway 又未校验 `current_period_start <= now`；从上期结束日递推会产生 Jan 31→Feb 末→Mar 28 漂移；upgrade 会立即重开周期并发完整 Allowance。
- 已完成模块化 PRD、平台交互、Dream 架构和 Dream 页面规范纠偏。权威定义统一为 Plan 稳定身份、Version 固定 monthly Token/非货币权益、用户个人 `[periodStart,periodEnd)`、升降级下周期、Token 402 fail-closed、Payment/订阅支付 Deferred、Provider Pricing/独立现金 Billing 保留。
- 文档机械检查：本轮检查的 64 份 Markdown 相对链接断链 0；目标文档实际 H1 与 Mermaid fence 正常；`git diff --check` 通过。代码围栏内 shell `#` 不计入 H1。
- 首轮独立 Reader Testing 发现唯一 P0：402 场景存在 `BILLING_ALLOWANCE_EXHAUSTED` / `SUBSCRIPTION_TOKEN_ALLOWANCE_EXHAUSTED` 与 `resetAt` / `periodEnd` 冲突。已统一为 `SUBSCRIPTION_TOKEN_ALLOWANCE_EXHAUSTED`；Gateway `/v1/**` 使用 `available_tokens/required_tokens/period_end`，Dream Product 使用 `availableTokens/requiredTokens/periodEnd`，`metric/unit=tokens`。
- 复核 Reader Testing 结论为 `PASS`：套餐金额/全局生效日/现金兜底/Payment 依赖均为 0，个人周期与下周期换版唯一，独立 Provider Pricing/Billing 未被误删。

## Round 33 — Token-only 月度订阅迁移与代码实现

Optimized Prompt:

作为 Ink Memory 的 PostgreSQL/Drizzle 数据架构师、订阅状态机工程师、Gateway 计量结算工程师、Refine/Next.js 工程师和测试负责人，以已经通过 Reader Testing 的 Token-only PRD 与交互规范为唯一产品合同，在 `/Users/dmeck/project/ink-admin-memory` 实施非破坏性的跨层纠偏。先读取所有目标文件最新工作树，保留用户及并行 agent 的未提交修改；只修改 Subscription/Gateway 所需代码、迁移和聚焦测试，不修改 `/Users/dmeck/project/ink-dream-memory`。

新增前向 Drizzle migration `0017`：为 Subscription 增加用户级 `cycle_anchor_at` 和 `current_period_number`，为新 Allowance 记录 plan version/period number；只归一化未发布 draft 的 legacy subscription monetary/effective 字段，保留 published 历史快照和既有 Ledger。数据库 trigger 必须阻止新 Plan Version 写入 annual、base price、money allowance、cash overage 或 global effective date，阻止新 Allowance 写入金额值；旧列只加 DEPRECATED 注释，不 DROP，不重写历史账本。迁移只在显式隔离 PostgreSQL 验证。

严格收敛 API：Plan create 不接受 currency；Version create/update 只接受 planId、trialDays、gracePeriodDays、allowanceTokens；publish 不接受 effectiveFrom。Repository 和 Refine list/detail/form 不投影或显示 currency、price、money allowance、overage 或 effective date。版本固定显示 monthly；publishedAt 仅为审计时间。用户订阅页面只显示 Token granted/reserved/consumed/remaining、个人周期、pending version 和生命周期，不出现任何金额或现金兜底。

状态机按原始 UTC anchor 计算月度边界，短月 clamp 后后续月份恢复原 anchor day；新增 Gateway `period_start <= at < period_end` 校验。开通创建 period 0；upgrade 与 downgrade 都只写 pending version，在用户下一周期边界应用；renew 在边界前返回 409，在事务行锁内只推进一个 period 并依靠唯一周期约束避免重复 Token grant。开通、续期、换版、暂停、恢复、取消不得锁或扣 Billing Account，不得写 `subscription_charge`。

Gateway 对存在有效 Subscription 的请求只允许 `token_allowance`：Token 不足返回 402 `SUBSCRIPTION_TOKEN_ALLOWANCE_EXHAUSTED`，Gateway error 使用 snake_case `metric=tokens/unit=tokens/available_tokens/required_tokens/period_end`；不查询 money allowance，不回落 cash balance。Token reserve/capture/release 只更新 Token 列；Token 覆盖请求的 `charged_microusd=0`，仍保存 Provider Pricing/成本快照。历史已在途 `money_allowance` 结算可保留隔离兼容分支，但 resolver 永不创建新记录；新 Token 请求不得写 `allowance_capture` 金额 Ledger。无 Subscription 的显式独立现金按量路径保持现状。

测试更新必须覆盖：strict schema 拒绝全部货币/effective/annual 字段；Jan 31/闰年锚点；未来周期不可提前调用；Token-only 402 字段；Token settlement 不产生现金收费；Repository/UI 无禁用字段；隔离 PG 中 Plan→Version→Entitlement→Subscription、early renew 409、到期 renew 单次 grant、下一周期升级/降级、Gateway Token Usage 与 Ledger 无订阅金额；1440×1000 和 390×844 不出现“金额额度/基础价格/币种/生效时间/现金兜底”。依次运行 env check、typecheck、lint、unit、隔离 PostgreSQL focused E2E 和 build；任何缺失的安全隔离条件必须明确跳过，禁止使用共享 `ink-memory`。

Optional Enhancers:

- 在生命周期 Modal 中显示目标版本将于个人 `currentPeriodEnd` 生效，并给出 Token grant 变化，不做金额预览。
- 对 legacy `money_allowance` 在途结算增加计数监控，归零后再以独立迁移删除兼容分支。

范围变化：

- 文档阶段已完成并通过 Reader Testing，开始允许修改 Admin Schema、migration、Repository/Service/API/UI 和聚焦测试。
- Dream 项目继续保持只读；PaymentAdapter、Webhook 和真实订阅支付不实现。

执行证据和验证结果：

- 尚未修改应用代码或 migration；本 Round 是进入实现前的强制门禁。

未执行事项及原因：

- 数据库与浏览器验证尚未执行；需先完成实现并通过静态/unit 检查，再按 QA skill 建立明确隔离目标。

## Round 34 — Token-only 月度订阅验证与交付收口

Optimized Prompt:

作为 Ink Memory 的发布验证负责人、PostgreSQL 迁移审查员、订阅状态机测试工程师和 Next.js/Refine 质量负责人，对 Round 33 已完成的 Token-only 月度订阅纠偏执行分层验证和最终交付审计。验证目标不是只证明 UI 隐藏了“金额额度”，而是证明 API、服务、数据库约束、Gateway reserve/settle、Usage/Ledger、用户个人周期和两个目标视口均不再把 Subscription 与金额、现金兜底或平台统一生效日期绑定。

先执行只读安全 preflight：检查工作树并保留用户未提交修改；运行 QA skill 的 preflight、`pnpm env:check`，检查 3000/5433 监听状态，并仅以布尔结果确认 `TEST_DATABASE_URL` 是否存在，禁止打印连接串或 Secret。只有显式 `TEST_DATABASE_URL` 且能证明是隔离临时 PostgreSQL 时，才允许运行 migration、数据库集成或 persistent Playwright；否则必须跳过并记录原因，绝不迁移、清空或删除共享 `ink-memory`。

静态与单元验证必须包括：`pnpm exec tsc --noEmit`、聚焦 ESLint、Token-only contracts/cycle/gateway/prepare Vitest、`git diff --check`，随后运行仓库级 `pnpm lint`、`pnpm test:run` 和 `pnpm build`。检查 strict contract 确实拒绝 currency、base price、money allowance、cash overage、annual 和 `effectiveFrom`；Jan 31、闰年与原始 UTC anchor 不漂移；未来个人周期 403、提前 renew 409；Token 不足固定返回 402 `SUBSCRIPTION_TOKEN_ALLOWANCE_EXHAUSTED` 及 Token 单位字段；订阅覆盖的请求收费为 0、不写 `subscription_charge`/`allowance_capture`，无订阅的独立现金按量路径仍保留。

迁移审查必须确认 `0017` 只回填用户周期 anchor/period provenance、只归一化未发布 draft、保留 published 历史金额快照和 append-only Ledger，不 DROP 旧列；新写入 guard 阻止 annual、金额、cash overage、global effective date 和 monetary Allowance。检查迁移与 Drizzle schema/journal 一致，并在具备隔离数据库时验证前向应用、约束、重复周期唯一性和应用启动；不具备时明确将 SQL 运行验证列为未执行风险。

浏览器验证仅在安全隔离数据库和可用 Session/bootstrap 条件满足时运行 `tests/e2e/subscription-billing-postgres.spec.ts`，覆盖 1440×1000 与 390×844、全部 canonical 平台用户选择、Plan/Version/Subscription 生命周期、Token Usage/Ledger 以及禁用文案缺席。若条件不足，不得用假数据、共享数据库或静态截图替代；保留 E2E 自动化用例并报告未执行。

最终执行关键词与响应合同复核，区分 Subscription Token-only 与 Provider Pricing/独立现金 Billing 两个领域，允许迁移注释、历史 migration、拒绝旧输入测试和 rolling-deploy legacy settlement 中出现 deprecated 字段，不得把这些兼容证据误判为新产品行为。独立代码审查的 P0/P1 必须修复并重新验证；P2 必须处理或作为已知风险说明。最终报告用实际命令、测试数量、文件路径和未执行条件交付，并明确确认未修改 Dream 代码、未引入 SQLite、未实现 Payment/订阅支付、未操作共享数据库真实数据。

Optional Enhancers:

- 若隔离 PostgreSQL 可用，增加迁移前后 catalog 查询，证明 trigger、partial unique index、column comment 和历史 published 行保持不变。
- 若本地浏览器环境可用，保存两个视口的 Playwright artifact；不得把未经真实数据链验证的截图称为验收通过。

范围变化：

- Round 33 的实现已通过 TypeScript、聚焦 ESLint、`git diff --check` 与 23 个聚焦单测，进入仓库级验证和交付收口。
- 不增加产品功能；只允许修复验证发现的 Token-only、周期、迁移安全、兼容和测试问题。

执行证据和验证结果：

- 已完成第一轮主代理静态复核：`pnpm exec tsc --noEmit` 通过；4 个聚焦测试文件共 23/23 通过；聚焦 ESLint 与 `git diff --check` 通过。
- 尚未运行仓库级 lint/unit/build、数据库迁移或 Playwright；必须先完成本 Round 的隔离 preflight。

## Round 33–34 执行证据

- 产品合同、主 PRD、模块 PRD、平台交互规范、Dream 架构入口和 Dream 页面设计已统一为 Token-only：Plan 不含价格/币种，Version 固定月度 Token 与非货币权益，`publishedAt` 只做审计，用户以自身 cycle anchor 计算周期；Payment/订阅支付 Deferred，Provider Pricing/独立现金 Billing 保留但不做套餐兜底。
- 新增 `drizzle/0017_subscription_token_only_monthly.sql` 与 Drizzle journal：新增/回填 `cycle_anchor_at/current_period_number` 和 Allowance version/period provenance；只归一化 draft，保留 published 历史及 Ledger；数据库 guard 拒绝新 annual/金额/cash-overage/global-effective Version、非 draft Version/Entitlement 改写，以及新 Token Allowance 的金额写入。旧金额列只标 DEPRECATED，没有 DROP。
- API/Repository/UI 已移除 Plan currency、基础价格、金额 allowance、cash overage、annual 选择和平台生效日；用户订阅页只显示个人周期、pending version 与 Token granted/reserved/consumed/remaining。canonical users 继续是唯一平台用户全集，不存在“计费用户”名册。
- 状态机从原始 UTC anchor 计算 Jan-31/闰年边界；提前 renew 409；延迟多周期时一次定位到包含 now 的个人周期，只发一条当前期 Allowance，不追溯补发漏期；升降级只写 pending。相同 idempotency key 由事务 advisory lock 串行化，并绑定 action/target/reason 请求摘要；异 payload 返回 409 且不重复 Audit。
- Gateway resolver 对订阅只创建 `token_allowance`；Token 不足固定 402 `SUBSCRIPTION_TOKEN_ALLOWANCE_EXHAUSTED` 与 Token 单位字段，不读取现金余额。Token 覆盖结算 `charged_microusd=0`，不写 `subscription_charge`/`allowance_capture`；实际 Token 超过估算时释放完整预留、按剩余 Allowance 封顶 consumed，完整实际 Usage 仍保留。仅保留 resolver 不会新建的 rolling-deploy legacy money settlement。
- focused PostgreSQL E2E 合同已补：published Entitlement create/update 409、多周期 renew 单次当前期 grant、同 key 异 payload/action/target 409，以及“账户有正现金余额但 1 Token 不足”仍在 Provider 前返回 Token-only 402，Account/Ledger/Allowance 不变；同时覆盖 1440×1000 与 390×844 禁用字段缺席。用例已通过 ESLint/TypeScript，但未实际连接数据库运行。
- QA preflight 与 `pnpm env:check` 通过；本机 3000/5433 有监听，但 `TEST_DATABASE_URL=unset`，因此未把身份不明的 5433 当作测试库，也未运行 migration、persistent E2E 或截图验收。
- 最终静态验证：`pnpm exec tsc --noEmit` 通过；聚焦 ESLint 通过；4 个聚焦 Vitest 文件 26/26 通过；`pnpm lint` 通过；`pnpm test:run` 为 45 files、234/234 tests 通过；`pnpm build` 通过；`git diff --check` 通过。
- 独立代码审查首轮发现 published Entitlement 服务边界、多周期延迟、Token 超估结算、幂等摘要和 Allowance UPDATE guard 缺口；全部修订。二轮发现并修复 `0017` 的 PL/pgSQL `DECLARE` 语法阻断；最终静态复核结论 `PASS`，无剩余 P0/P1。

未执行事项及原因：

- `0017` 前向迁移、trigger/partial unique index/catalog 与真实事务并发尚未在 PostgreSQL 执行；缺少明确隔离的 `TEST_DATABASE_URL`，禁止借用共享或未知数据库。SQL 仍须在隔离库通过后才可发布。
- `tests/e2e/subscription-billing-postgres.spec.ts` 与 1440×1000、390×844 视觉 artifact 未实际运行/生成；同样受隔离数据库和 bootstrap 条件阻断，不能用假数据或静态截图替代。
- 未修改 `/Users/dmeck/project/ink-dream-memory` 的代码、Schema、迁移、依赖或运行逻辑；该仓库仅保留用户既有未跟踪 `.claude/worktrees/`。未引入 SQLite/JSON DB/内存回退，未实现 PaymentAdapter、Webhook 或真实订阅支付，未操作共享 PostgreSQL 数据。

## Round 35 — Token-only 文档门禁通过后的实现阶段

Optimized Prompt:

作为 Ink Memory 的资深 PostgreSQL 数据迁移架构师、Token-only 月度订阅状态机工程师、AI Gateway 结算工程师、FastAPI/Python 工程师、Next.js/Refine 工程师和发布安全负责人，以最新已通过无上下文 Reader Testing 的权威文档为唯一当前合同，在不覆盖用户既有修改、不连接或破坏共享数据库、不读取或使用真实 Secret 的前提下，开始 Admin 与 Dream 的实际代码实现。所有实现必须是真实 Repository/Service/API/页面/迁移/测试，不得交付伪代码、静态数组、通用 CRUD 外壳或 SQLite/PostgreSQL 自动 fallback。

固定产品语义：Subscription 是 canonical `users` 上的用户级 Token-only 月度权益。Plan Version 只含不可覆盖的 monthly Token、模型、Scope、RPM、Storage 等非货币权益；不含 price/currency、金额 allowance、cash overage、Payment、平台全局 effective window。每个 Subscription 保存不可漂移的原始 UTC cycle anchor；create、renew、upgrade、downgrade、pause、resume、cancel、revoke_cancel 八动作使用 preview/execute、expectedVersion、幂等 digest 与原始 receipt。升级/降级下周期生效，cancel 到边界进入 cancelled 且不发新 Token，revoke_cancel 只清标志不发 Token；自动 period worker 与人工重试复用同一事务函数。Token reserve/capture/release 必须守恒，usage missing 不能永久悬挂预留，Token 路径不得读取、创建或锁 Billing Account；独立现金 Billing/Ledger 只能作为独立产品域，绝不成为 Token 耗尽 fallback。PaymentAdapter、Webhook、Fake/Test Adapter 与真实支付渠道全部 Deferred，当前代码/Schema/Route/env/UI 增量必须为 0。

Admin 实施要求：先修复 `0017` 对既有订阅 anchor/period 的不安全回填，能从最早可信 activation/Allowance 事实无歧义恢复才自动回填，否则 fail-closed 并输出安全迁移清单；增加 anchor 不可更新与 legacy callable successor mapping 门禁。实现 canonical user relation 服务，以 `users` 为全集做 q/page/pageSize/total 和跨页 hydration；缺 mapping/account 不得静默丢用户，Gateway/Subscription/Key/Permission 命令必须反向 JOIN `users`，orphan 固定 403。实现五条且仅五条 Product API：plans、me/subscription-context、me/usage、me/model-catalog、me/subscription-commands；使用服务身份 + Dream session subject 绑定、Origin/CSRF、allowlist DTO、ETag、嵌套 `{data,meta}` error/response、preview receipt 与 stable request ID。补自动 period worker、八动作状态机、original idempotent receipt、expectedVersion、usage-missing recovery 和纯 Token settlement 去现金账户依赖。Route Handler 只解析/auth/schema/service 调用；SQL、事务、领域状态机位于 `app/lib/**`。

Dream PostgreSQL 实施要求：新增 psycopg 3 pool、显式 Unit of Work、领域错误映射、Dream-owned Alembic journal 和 48 表 manifest；主库 43 表与 Notion 5 表逐表覆盖 PK/FK/unique/check/text-enum/JSONB/timestamptz/sequence/25 trigger 与不可变语义。已存在 users/workspaces/stories 只允许精确 catalog baseline-adopt，partial/mismatch/owner-ACL 未授权一律阻断，不自动 ALTER OWNER/GRANT/REVOKE。只在显式隔离 `TEST_DATABASE_URL` 运行空库 upgrade、三表 adopt、mismatch fail、Repository contract 和 43+5 rehearsal。迁移 CLI 默认 dry-run，读取两个 SQLite 的一致性私有快照，执行 manifest→staging→transform→conflict→import→validator；验证 count、PK/row digest、unique、FK orphan、enum、JSON、time、sequence、trigger，禁止隐式 upsert。代码中仅测试实例化的 `SQLiteRevocationRepository` 八表不属于真实 43+5；生产禁止动态创建，未来启用必须另立领域 migration。

Dream 运行时实施要求：按 users/auth/story、Story 闭包、session/social/chat、reflection/event、deck/plugin/workflow/runtime、Notion 波次把 SQL 收敛到 Repository/UoW；不得建立通用 `?` 占位符翻译层。最终 `server.py` 启动只接受 PostgreSQL head，不执行 runtime DDL；`database.py` 与 `notion/store.py` 不再打开 SQLite，SQLite 仅保留在 migration-only 工具/测试 fixture。实现 Dream BFF 与真实 `/story-workspace/subscription` 页面，浏览器只消费五条 Admin Product API，不持有服务凭据；推理由服务端 Gateway client 按 stable alias 接管。先修复硬编码 Provider credential：从版本控制运行时代码移除，配置缺失 fail-closed；密钥吊销/轮换仍由所有者外部完成。ASR WebSocket 在 canonical 鉴权/Origin/限流/审计未完成前默认禁用，audio Gateway 仍 Deferred。

验证顺序：所有写数据库测试先证明目标是明确命名的临时 PostgreSQL，拒绝 runtime URL、未知 `5433` 和共享 `ink-memory`。先跑静态/unit，再跑隔离 PG migration/catalog/并发/rehearsal，随后 Admin/Dream build 和 focused Playwright 的 1440×1000、390×844、键盘/焦点/loading/empty/401/402/403/404/409/429/502/503。测试必须覆盖 205 canonical users、missing projection、orphan、Jan 31/闰年、自动 renewal、cancel boundary、revoke_cancel、original receipt、Token 守恒、usage-missing recovery、纯 Token 不建账户、五条 Product API、48 表/25 trigger、Secret 不回显和既有 Agent/Workflow 行为。任何外部 Provider、真实支付或 credential 轮换无法在隔离环境验证时明确列为未执行，不能用假成功替代。

Optional Enhancers:

- 为 cycle anchor、自动 period claim、Allowance 守恒和 usage-missing recovery 增加属性/状态机测试。
- 为 48 表 rehearsal 生成不含行值/正文/Secret 的表级 digest 仪表板和 shadow comparison receipt。
- 为 Gateway 增加用户级 canary 与自动前向修复 runbook；关闭 canary 时仍不得直连 Provider 绕过资格。

范围变化：

- 权威文档已完成 Token-only 二次收口并通过 Reader Testing，允许进入 Admin/Dream 代码、migration、Repository、API、页面和隔离测试阶段。
- PaymentAdapter/Webhook/Fake/真实支付继续 Deferred；独立现金 Billing/Ledger 保留但不进入 Dream 产品 API或 Subscription 决策。
- Admin `65d417b` 只视为 Partial baseline；五条 Product API、自动周期、canonical orphan、纯 Token settlement 等审计缺口进入修复范围。
- Dream 43+5 PostgreSQL 全迁移、新订阅页面、Gateway 新推理链和 P0 credential/ASR 加固继续属于当前实现范围。

执行证据和验证结果：

- 第二轮无上下文 Reader Testing 最终结论 `PASS`：32 份 Markdown 每份一个 H1，22 个 Mermaid 围栏平衡且语义有效，本地链接断链 0；Payment 全部仅 Deferred，Product API 恰为 5 条且无 `/me/ledger`，八动作/legacy `past_due`、`expiresAt`、`{data,meta}`、`unit=tokens`、`occurredAt`、502/503 和两个视口/无障碍合同一致。
- Admin `65d417b` 只读代码复核确认：新建 Token 路径、UTC 周期函数和 Token 402/cash-no-fallback 主体正确；但 Product API 0/5、自动 period worker 缺失、cancel/revoke_cancel 错误、canonical orphan 可用、Token settlement 仍锁账户、usage-missing reserve 悬挂、legacy anchor 回填和 original receipt 不安全。
- Dream 只读复核确认：尚无 psycopg/Alembic/PG Repository/UoW/48 表 migration/rehearsal；34 个运行时文件显式 SQLite connection、16 个 get_db 调用面和约 42 个 SQLite SQL 文件仍需分波接管；Notion 是独立 5 表 SQLite。
- `git diff --check` 通过；当前仅 Admin 文档有本轮增量，Dream 仍只有用户既有未跟踪 `.claude/worktrees/`。

未执行事项及原因：

- 本 Round 记录前未开始新的代码修改：强制 Prompt Architect/Reader 门禁必须先完成。
- 未执行 PostgreSQL migration/E2E：尚未建立并验证明确命名的隔离 `TEST_DATABASE_URL`，未知本机 `5433` 不可使用。
- 未调用外部 Provider/支付网络，未使用真实 Secret；硬编码 credential 的外部吊销/轮换需要密钥所有者完成。

## Round 36 — Token-only 与 48 表迁移的隔离 PostgreSQL 验证

Optimized Prompt:

作为 Ink Memory 的 PostgreSQL 发布验证负责人、Drizzle/Alembic 迁移审查员、Token-only 月度订阅并发测试工程师与数据库安全负责人，在 Round 35 静态实现完成后，只使用本任务创建、明确命名且可完整删除的一次性 PostgreSQL 16 容器，对 Admin `0000`–`0019` 与 Dream 六波 Alembic 迁移执行真实 catalog、约束和事务验证。任何数据库命令前先确认目标不是共享 `ink-memory`、不是 5433、数据库名包含独立 `test/codex` 标记，并通过 Dream `require_test_database_url` 的 fail-closed 校验；禁止读取、迁移、截断或写入未知现存数据库。

建立专用容器 `ink-memory-token-only-codex-pg-20260809`，仅绑定经监听检查确认空闲的本地高位端口，创建彼此隔离的 Admin migration、Dream empty-upgrade 与 Dream baseline-adopt 测试数据库。连接变量只在单条验证命令的进程环境中设置；不得打印 DSN、密码或真实 Secret。容器必须带唯一标签，清理时只停止并删除这个精确名称，不使用广泛 Docker prune、volume glob、DROP DATABASE 或任何指向工作区外数据库的清理。

Admin 数据库验证必须顺序应用 `0000`–`0019`，核对 journal 与实际 migration 数量、`subscription_month_boundary` 的 Jan-31/闰年/短月恢复、cycle anchor 不可变、period/version 单调、Token Allowance provenance/守恒/金额为零、settled Usage 与 pricing/entitlement snapshot 不可改写、Gateway canonical-subject key 的 nullability/check/partial unique index、canonical user 自动 projection/account trigger，以及历史 orphan 不被删除。插入的 fixture 仅使用合成用户与假 key hash；验证 205 canonical 用户分页总数不因缺失投影消失、Product/Gateway 反向 JOIN canonical user、订阅 Token 不足不触发现金账户或 Ledger。不得调用 Provider 或支付网络。

Dream empty-upgrade 数据库必须从空库运行 Alembic 到唯一 head，证明 48 张应用表、569 目标列、81 个显式索引、25 个 trigger、PK/FK/unique/check、identity/sequence 与六波顺序一致；运行静态 manifest digest 与 `verify_postgres_schema.py --database`。Dream baseline-adopt 数据库先以 Admin current-head 的 canonical `users`、`story_workspace_workspaces`、`story_workspace_stories` 精确结构建立三表，再运行 Dream Alembic，证明只 adopt、不重复创建且最终仍为同一 48 表 catalog；另在可回滚的独立数据库或事务内制造结构 mismatch，证明迁移 fail-closed，不执行 `ALTER OWNER`、GRANT/REVOKE、DROP、TRUNCATE 或 DELETE。

验证结果必须记录精确命令类别、迁移 head、catalog 计数、通过/失败断言和清理证据，但不记录连接凭据或用户数据。若 Docker 不可用、端口占用、migration 失败或安全校验无法证明隔离，立即停止数据库写入，保留失败证据并回到代码修复；不得改用本机 5433、共享 `ink-memory`、SQLite fallback 或假 catalog 输出。完成后确认专用容器、绑定端口和临时数据库均不存在，再继续浏览器或运行时迁移阶段。

Optional Enhancers:

- 为 `subscription_month_boundary` 增加多锚点性质检查，并验证重复 renew/period-worker claim 只有一个 Token grant。
- 保存仅含对象数量、约束名称和 SHA-256 的脱敏 migration receipt，供后续 shadow comparison 使用。
- 在 baseline-adopt 测试中分别覆盖 partial table、列类型偏差、缺索引与 owner/ACL 只读报告四类拒绝路径。

范围变化：

- Round 35 的实现已通过 Admin 仓库级静态门禁，允许进入真实但完全隔离的 PostgreSQL 验证；不新增产品能力。
- PaymentAdapter、Webhook、Fake/真实支付与外部 Provider 调用继续 Deferred/未执行。
- Dream 运行时 SQLite 全退出、数据导入 CLI 与逐领域 Repository 接管仍是后续实现工作；本 Round 只验证已生成 DDL/Alembic、Admin Token-only migration 与安全 adopt，不把 catalog 成功误报为运行时切换完成。

执行证据和验证结果：

- 进入本 Round 前，Admin `pnpm env:check`、`pnpm exec tsc --noEmit`、`pnpm lint`、62 files/299 tests 的 `pnpm test:run` 与 `pnpm build` 均通过。
- Dream BFF focused 76 项、PG persistence/schema 静态测试、Gateway/Secret 加固测试已由前序实现阶段通过；尚未把任何 migration 应用到数据库。
- 本记录完成前未运行 Docker、psql、Drizzle、Alembic 或数据库 fixture 命令。

未执行事项及原因：

- 隔离容器、Admin `0018/0019`、Dream empty/adopt/mismatch 与 catalog 验证尚未执行：必须先完成本 Round Prompt Architect 日志门禁。
- focused Playwright、外部 Provider、Payment、真实 Secret、共享 PostgreSQL 均未执行；浏览器属于后续阶段，外部与支付场景不在当前授权范围。

### Round 36 执行结果

- 创建且只使用专用容器 `ink-memory-token-only-codex-pg-20260809`（PostgreSQL 16、localhost 高位端口 55439、无持久卷）以及四个名称含 `codex_test` 的一次性数据库；没有连接本机 5433 或共享 `ink-memory`。
- Admin `0000`–`0019` 共 20 条 migration 全部实际应用。插入 205 个合成 canonical users 后得到 users/platform_users/billing_accounts/missing-projection = `205/204/204/1`，证明自动投影和缺失投影可观测，未删除财务历史。
- 事务回滚式 SQL 断言通过：2024-01-31→02-29→03-31、2025-01-31→02-28→03-31；annual/金额 Plan、`past_due` 新订阅、anchor 漂移、非精确 version 增量、无 provenance/含金额 Allowance、错误 canonical-subject key、Token 请求金额字段、settled Gateway usage 改写与 append-only event 改写均被约束拒绝。有效 fixture 的 remaining Token 为 97000、Gateway subject mode 为 `canonical_subject`、captured Token 为 15；事务最终 ROLLBACK。
- Dream 空库演练首先真实发现并修复两个发布阻断：标准 `postgresql://` 被 SQLAlchemy 错选 psycopg2，以及 `chat_thread` 在依赖 `decks/voices` 前建表。Alembic 现显式使用 psycopg 3；chat 两表移至第 5 波，并新增全 FK 拓扑测试。
- Dream 空库六波升级至 `20260809_06`，只读 catalog verifier 返回 48 tables / 569 columns / 81 explicit indexes / 25 Dream triggers；manifest source 仍为 43/522/73/25 + 5/45/5/0。
- Admin current-head 三表 adopt 演练真实发现并修复 PostgreSQL 63-byte FK 名截断比较，以及 Admin-owned `users_sync_billing_identity` 共享触发器不应冒充 Dream 第 26 个 trigger。提供显式 owner=`postgres` 与 ACL SHA-256 后六波 adopt 成功，最终仍为 48/569/81/25；未知额外 trigger 仍会阻断。
- partial mismatch 数据库只创建 `users(id)` 后，Alembic 以 `canonical baseline is only partially present` 明确失败，退出码 1；事务后数据库仍仅有该 `users` 表，没有部分 Dream DDL。
- PostgreSQL schema/baseline/trigger focused tests 23/23 通过。外部 Provider、Payment 网络和真实 Secret 均未使用。

未执行事项及原因：

- 专用容器暂未清理，因为下一阶段仍需在同一明确隔离目标演练完整数据迁移 CLI 与 Repository contract；完成该阶段后必须按精确容器名删除并确认 55439 不再监听。
- catalog/Alembic 成功只证明目标 DDL，不代表 Dream 运行时已退出 SQLite；`database.py`、Notion store、数据导入 CLI 与调用面接管仍是发布阻断。

## Round 37 — Dream PostgreSQL 运行时切换与全量数据迁移

Optimized Prompt:

作为 Ink Dream Memory 的 PostgreSQL 运行时迁移负责人、Python Repository/UoW 工程师和数据一致性验证负责人，在已通过 48 表 Alembic 空库/adopt/mismatch 演练的基础上，完成真实运行时从 SQLite/Notion SQLite 到单一 PostgreSQL 的退出，不把静态 DDL 或 catalog 成功误报为完成。保留两个仓库及并行代理全部未提交修改；只在本任务已创建且明确命名的 PostgreSQL 容器数据库中写入测试数据，不连接 5433、共享 `ink-memory`、外部 Provider、Payment 或真实 Secret。

实现一个默认 dry-run、显式 `TEST_DATABASE_URL` 才允许写入的 43+5 数据迁移 CLI：分别对 Dream 主库和 Notion Connector 建立只读一致性快照，生成不含业务正文/Secret 的 manifest，按 FK 拓扑导入 staging/目标表；逐表验证 row count、PK 与行 digest、unique 冲突、FK orphan、枚举/check、JSON 文本合法性、UTC 时间、identity sequence 和 trigger。任何冲突默认阻断，禁止隐式 upsert、覆盖或清空；三张 canonical 表遵守 baseline adopt，已有目标数据必须逐行无歧义匹配。输出可机器读取的脱敏 receipt，失败事务回滚。

将 Dream 生产启动与 Repository 边界改为 PostgreSQL-only：连接池显式启动/健康检查/关闭，Unit of Work 管理事务，错误映射稳定；`backend/database.py` 与 `backend/notion/store.py` 不再创建 SQLite connection、执行 PRAGMA/`BEGIN IMMEDIATE`、使用 `?` placeholder 或在 PostgreSQL 缺失时回退 SQLite/JSON/内存库。允许 SQLite 代码只存在于命名明确的 migration-only exporter 和测试 fixture。逐领域改写必须保留现有函数/API 行为，不建立通用 SQL 文本翻译层；生产启动只验证 Alembic head，不自动建表或迁移。

测试覆盖：48 表合成 fixture 全量 rehearsal、三表已存在匹配/冲突、PK/FK/unique/enum/JSON/time/sequence/trigger 失败、重复执行幂等阻断、Repository contract、事务 rollback、连接池生命周期、Notion 五表、现有 Auth/Story/Agent/Workflow/Storage 行为。静态扫描生产路径必须证明无 `sqlite3.Connection`、`get_db()`、PRAGMA、`BEGIN IMMEDIATE`、SQLite trigger 和 `?` SQL；若遗留只在 migration/test 路径，逐项白名单。迁移与 Repository 验证完成后按精确名称删除专用容器并确认端口释放，再进入浏览器阶段。

Optional Enhancers:

- 增加表级 shadow comparison receipt 与 canary read diff，但不读取/输出正文值。
- 增加迁移恢复点和 forward-repair runbook；PostgreSQL 已写入后默认不回切 SQLite。
- 对时间/JSON/复合 PK 生成属性测试与故障注入。

范围变化：

- Round 36 已证明目标 Schema 可真实创建/adopt并 fail-closed，进入运行时与数据面的实现阶段。
- 不新增支付、现金订阅或外部 Provider 能力；Token-only Product/Gateway 合同保持不变。

执行证据和验证结果：

- 本记录完成前只完成 DDL/Alembic 与约束演练；尚未声称运行时 PG-only。

未执行事项及原因：

- 数据迁移 CLI、`database.py`/Notion runtime 改写及完整 Repository rehearsal 尚未执行；必须在本 Round 日志门禁后开始。

### Round 37 执行结果

- 新增 Dream-owned PostgreSQL persistence、Alembic 六波迁移、48 表 manifest/DDL、baseline-adopt verifier 与迁移 CLI。源 catalog 可复现为 Dream 43 表/522 列/73 索引/25 trigger + Notion 5 表/45 列/5 索引/0 trigger；目标 catalog 为 48 表/569 列/81 显式索引/25 trigger。
- 全量迁移 CLI 默认 source-only dry-run；只读快照两个 SQLite 源，建立 48 个事务内 staging 表，按六波 FK 拓扑导入并核对 count、PK/row digest、64 个 FK/action、unique/check、JSON、时间、sequence、81 index 与 25 trigger。三张 canonical baseline 表要求逐行完全匹配，其余 45 表目标非空即阻断；无 upsert、DROP、TRUNCATE、DELETE。默认测试 14 passed/2 skipped，隔离 PostgreSQL opt-in 2 passed；完整组合为 58 passed/2 skipped/20 subtests，成功与故障路径最终目标均保持 48 表/0 行。
- `backend/database.py` 已改为 psycopg 3 pool 和显式 lease；生产启动只检查 Dream Alembic head `20260809_06`，不建表、不迁移、不创建文件库；pool shutdown 显式关闭。历史 43 表 SQLite builder 移入 migration/test-only `backend/schema/legacy_main_sqlite.py`，不再由运行时导入。
- Notion Connector 五表已改为 PostgreSQL Repository/UoW 与 router lifespan pool；旧五表 builder 只保留在 `backend/schema/legacy_notion_sqlite.py` 供 catalog/迁移测试。Notion 聚焦合同与 pool lifecycle 已通过。
- 生产 SQL 已从 qmark、`INSERT OR`、`rowid`、SQLite JSON 与 `enabled = 1` 等语义改为 PostgreSQL 参数、`ON CONFLICT`、`RETURNING`、JSONB/LATERAL、ILIKE 和原生 BOOLEAN。`deck_claude_plugin_refs.enabled` 为目标 INTEGER，保留其 `0/1` 语义，不与 `decks/voices.enabled BOOLEAN` 混用。
- 明确命名的隔离库真实运行：基础用户/偏好/session/chat/reflection/deck/voice 合同 2/2 passed；Event append-only SQLSTATE 55000、同 ID retry、Plugin Installation SAVEPOINT、Dream re-entry JSONB 合同 3/3 passed。每例外层 rollback 后由独立连接复核核心表全部 0 行，未执行 DROP/TRUNCATE/DELETE。
- Dream schema/migration/Notion/Product BFF/Gateway/Secret focused 组合为 94 passed、2 skipped、20 subtests；两项 skip 仅在未显式提供安全 `TEST_DATABASE_URL` 时生效。本阶段执行隔离 opt-in 时相关真实 PG 测试已单独通过。
- Product BFF 保持恰好五条路由，Gateway 使用 canonical subject 服务端认证；Subscription 保持 Token-only 月度合同，未引入 PaymentAdapter、Webhook、Fake Adapter、金额套餐或现金兜底。

未执行事项及原因：

- 仓库级 Dream backend 全量 suite、frontend unit/lint/build、Admin 最终回归与两个目标视口 Playwright 尚未执行；它们属于下一轮发布验证门禁。
- 专用 PostgreSQL 容器仍保留，仅供下一轮明确隔离的真实 PG 合同；验收结束后必须按精确名称删除并确认 55439 释放。
- 外部 Provider、真实支付、credential 轮换和共享数据库均未执行；支付全域在最新 Token-only 范围中为 Deferred，外部密钥轮换需要所有者操作。

## Round 38 — Token-only 月度订阅全栈发布验证与一致性收口

Optimized Prompt:

作为 Ink Memory 的发布负责人、PostgreSQL 隔离验证工程师、Token-only 月度订阅/Gateway 测试负责人、FastAPI/Python 与 Next.js/Refine 质量负责人，在 Round 37 完成 Dream 48 表 PG-only runtime 和全量迁移实现后，对 Admin 与 Dream 执行最终分层验收，并修复验证发现的范围内缺陷。以“Token-only 用户级月度订阅”为唯一当前合同：Plan/Plan Version/Subscription/Dream 页面只表达月度 Token、模型/Scope/RPM/Storage 与用户个人周期；PaymentAdapter、Webhook、Fake/真实支付全部 Deferred；Provider Pricing 和独立现金 Billing 只能作为非订阅历史/按量域，不能进入 Product API、订阅资格或 Token 耗尽兜底。

先做只读安全与工作树 preflight：保留两个仓库及 `.claude/worktrees/` 等用户未提交内容，不回滚、不覆盖；所有数据库测试只能使用本任务创建的精确容器 `ink-memory-token-only-codex-pg-20260809`、高位端口 55439 和数据库名 `ink_memory_*_codex_test`，每条命令显式传入 `TEST_DATABASE_URL` 并通过 fail-closed 名称校验。禁止连接 5433、共享 `ink-memory`、真实 Provider/Payment 或读取 Secret；禁止 DROP/TRUNCATE/DELETE/fixture 污染，测试写入必须处于外层 rollback，另用 observer 复核为零。

Dream 后端验证必须覆盖 48/569/81/25 catalog、43+5 migration dry-run/execute rollback、baseline exact-match/mismatch fail-closed、pool/lease 生命周期、Notion UoW、canonical user/Auth/Story/Session/Chat/Reflection/Event/Deck/Plugin/Workflow、Product BFF、Gateway canary、usage-missing、Secret/ASR fail-closed。生产路径静态扫描不得出现 SQLite connection/fallback、runtime DDL、PRAGMA、`BEGIN IMMEDIATE`、qmark SQL、SQLite trigger/JSON/rowid/`INSERT OR`；migration-only exporter、legacy catalog builder和显式 test fixture必须按路径白名单，不能被运行时导入。真实 PG 集成要验证 timestamptz、JSONB、BOOLEAN、append-only trigger、事务与 rollback 后 0 行。

Admin 依次运行 `pnpm env:check`、`pnpm exec tsc --noEmit`、`pnpm lint`、`pnpm test:run`、`pnpm build`，并在隔离库复核 0000–0019、205 canonical users、缺失 projection 可观测、用户分页超过 100、Jan-31/闰年、八动作/expectedVersion/idempotency、自动 period worker、Allowance 守恒、Subscription Token-only 402、Gateway 401/403/409/429/502/503、usage-missing recovery、append-only Usage/Ledger/Audit 和 Secret 不回显。Dream frontend 运行项目实际 unit/lint/build；页面不得包含静态套餐、价格、币种、金额余额、支付按钮、fake success 或浏览器 Gateway Key。

浏览器阶段必须先完整读取并遵守 `ink-dream-playwright-qa` skill 及其 project workflow。只启动本任务所需本地服务，不杀占用端口的未知进程；在 1440×1000 与 390×844 验证真实 BFF 合同或受控 mock-BFF 交互、loading/empty/error、401/402/403/404/409/429/502/503、八动作 preview→execute、焦点恢复、键盘、label、移动布局与 Token 守恒。受控 mock 只能证明 UI 合同，必须与真实 PG/API 测试分开报告，不得冒充 persistent E2E。

最终执行 Reader/机械一致性检查：32 份权威文档每份一个 H1、Mermaid 围栏平衡、本地链接 0 断链；Current/Target/Release Gate 与代码状态一致，同一能力不得同时 Planned/Implemented/Deferred。更新 Round 37/38 执行证据、实际命令/数量/视口、Reader Testing 修复、未执行外部场景、风险/灰度/前向修复边界。只有所有发布阻断消除后，按精确容器名删除专用容器并确认 55439 不监听；否则保留失败证据但不得把未通过项宣称完成。

Optional Enhancers:

- 增加 subscription cycle anchor、并发 renew 与 Token reserve/capture/release 守恒的性质测试。
- 生成不含行值或 Secret 的最终 48 表 catalog/digest receipt。
- 为 Gateway canary 增加 shadow eligibility 与 forward-repair runbook；shadow 不调用 Provider、不扣 Token。

范围变化：

- Round 37 已完成 43+5 迁移工具、PG-only main/Notion runtime 和真实 PG 聚焦验证，进入全栈发布验收；不新增产品能力。
- 最新 Token-only 月度订阅继续覆盖旧金额套餐与 Payment 当前范围；PaymentAdapter/Webhook/Fake/真实支付继续 Deferred。

执行证据和验证结果：

- 本记录完成前已取得 Round 37 所列隔离 PG 和 focused 测试证据；尚未运行 Round 38 仓库级与浏览器命令。

未执行事项及原因：

- Admin/Dream 仓库级测试、Dream frontend build、Playwright、最终 Reader Testing 与容器清理必须在本 Prompt Architect 记录之后执行。

### Round 38 执行结果

- 最新产品范围已固定为 **Token-only 用户级月度订阅**。Plan Version、Subscription、Product API、Dream 页面与 Gateway 资格/结算只传递月度 Token、周期、模型/Scope/RPM/Storage 权益；没有价格、币种、金额额度、cash overage、支付按钮或共享全局生效窗口。PaymentAdapter、Webhook、Fake/Test Adapter、订阅支付与真实支付渠道的当前代码、Schema、Route、环境变量和 UI 增量保持 0，状态统一为 Deferred。
- Admin 最终门禁全部通过：`pnpm env:check`、`pnpm exec tsc --noEmit`、`pnpm lint`、`pnpm test:run`（63 files / 309 tests）和 `pnpm build`。验证期间发现并修复两项真实缺陷：测试运行时原先不能安全选择 `TEST_DATABASE_URL`，现仅在非 production 且显式 `INK_USE_TEST_DATABASE_URL=1` 时启用，并要求数据库名含独立 test/codex 标记；平台用户 selector 的 accessible name 有歧义，现使用唯一 `aria-label`。没有改变常规运行时必须连接 canonical `ink-memory` 的约束。
- Admin focused Playwright 使用真实隔离 PostgreSQL 与本地进程内合成 Provider upstream，1/1 通过；覆盖 1440×1000 与 390×844、205 canonical users/超过 100 条服务端分页搜索、Plan Version 不可覆盖、个人月度生命周期与延迟续期、Token Allowance、Gateway request/usage settlement，以及页面不出现价格/币种/金额/现金兜底/支付。该 lane 没有调用外部 Provider，不能冒充生产 Provider E2E。
- Dream backend 默认全量 suite 通过：1667 passed、14 explicit skips、0 failed、652 subtests、85 warnings。14 个 skip 均有明确边界：6 个 owned-PG opt-in、1 个真实 Claude SDK、1 个已由 PG 取代的旧文件 CRUD demo、6 个 SQLite fixture 无法表达 PostgreSQL row-lock concurrency；没有跳过生产回归。验证还修复了 LLM JSON 引号恢复、NULL agent provenance 重入查询和 compare-and-swap guidance denylist 三个生产缺陷。
- Dream 真实隔离 PG 最终组合 21/21 通过，覆盖 48 表 rehearsal/baseline drift、用户/偏好/session/chat/reflection/deck/voice 原生 BOOLEAN/JSONB/timestamptz、pool lease、Event append-only SQLSTATE 55000/幂等 retry、Plugin savepoint 与 Dream JSONB re-entry。独立 observer 复核 rollback 后 48 表/0 行且无 staging；没有执行 DROP、TRUNCATE 或 DELETE。PG-only 静态门禁 7/7 通过，扫描 188 个生产文件和 552 个 SQL literal，运行时 qmark、`INSERT OR`、rowid、SQLite JSON、`BEGIN IMMEDIATE`、PRAGMA、runtime DDL 与 SQLite fallback 均为 0；只保留 migration/catalog builder 和显式 fail-closed test fixture。
- Dream frontend `npm run lint` 通过（0 errors / 21 既有 hook dependency warnings），source tests 334/334 通过，`npm run build` 通过（2755 modules）。focused Playwright 2/2 通过，分别覆盖 1440×1000 与 390×844、Token 守恒、八项 preview→execute、upgrade 后 refetch、无金额/Payment、移动端 overflow、Escape 关闭与焦点恢复；该 lane 使用受控 mocked BFF，只证明 UI/契约与响应式行为，已与真实 PG/API 证据分开标注。
- 43+5 数据面验收为**隔离演练而非生产 cutover**：source manifest 仍为 Dream 43 表/522 列/73 索引/25 trigger + Notion 5 表/45 列/5 索引/0 trigger；目标为 48 表/569 列/81 显式索引/25 trigger。完整 CLI、六波 Alembic head `20260809_06`、exact baseline adopt、partial mismatch fail-closed、count/PK/row digest/FK/unique/check/JSON/time/sequence/index/trigger 验证均已通过。Dream main/Notion runtime 已为 PG-only，不存在 SQLite、JSON DB 或内存数据库回退。
- 无上下文 Reader Testing 最终 PASS：P0=0、P1=0。Reader 发现并修复了 `06` 中旧的 Dream lint 未执行口径、README credential 完成度措辞、Payment 当前范围措辞及旧测试数量冲突。机械检查覆盖 38/38 份权威文档：唯一语义 H1、24 个 Mermaid block、围栏平衡、本地链接 0 断链；`git diff --check -- docs` 通过。状态已唯一归类为 Implemented / Release candidate、Planned release step 或 Deferred。
- 专用 PostgreSQL 16 容器 `ink-memory-token-only-codex-pg-20260809` 已按精确名称连同其匿名 volume 删除；确认 55439 不再监听。未知本机 5433 始终未连接、未修改；3000/8765 已释放，5173 是验证前已存在且工作目录属于 Dream frontend 的进程，未被停止。
- 两个仓库最终 `git diff --check` 均通过。没有覆盖、回滚或删除用户已有未提交修改；Dream 的 `.claude/worktrees/` 保持未触碰。active runtime 中的 legacy credential 已移除且 secret scan 通过，但历史凭据的 owner 吊销/轮换仍需要密钥所有者完成。

未执行事项及原因：

- 未对真实源数据或生产 `ink-memory` 执行 migration、owner/ACL、GRANT/REVOKE、停写、cutover 或 fixture；需要生产只读盘点、变更审批、备份/PITR 与最终源 snapshot rehearsal。
- 未执行真实预发布 Session/service identity 冒烟、历史 orphan 处置、外部 Provider canary、用户级 Gateway 灰度或所有 inference role 的生产切换；这些保持 Planned release steps，发布后数据库写入默认前向修复。
- 未实现或调用 PaymentAdapter、Webhook、Fake/Test Adapter、Stripe、支付宝、微信支付、银行接口或任何支付网络；它们因最新 Token-only 范围全部 Deferred。
- 未使用真实用户 Token、真实 Provider/Payment Secret 或共享数据库。ASR Gateway 仍 Deferred；当前只保留 fail-closed 安全边界，不把音频链误报为已接入。

## Round 39 — Dream 本地启动故障与真实 PostgreSQL 迁移确认

Optimized Prompt:

作为 Ink Dream Memory 的本地运行恢复负责人、PostgreSQL 迁移安全负责人和 FastAPI 启动链诊断工程师，处理用户提供的应用启动失败堆栈，并澄清“隔离迁移演练”与“用户当前本地 PostgreSQL 已迁移”的区别。当前错误发生在 `PostgresPoolConfig.from_env()`，尚未建立数据库连接；不得把它误判为 Alembic migration 失败，也不得继续声称用户的真实 `ink-memory` 已完成迁移。

先只读核对 Dream 的启动命令、`.env*` 配置键名、PostgreSQL URL 解析规则、目标数据库名、host/port、实际 server identity、owner/ACL、Alembic head、48 表 catalog 与现有数据。读取环境文件时只输出变量名和脱敏 fingerprint，禁止回显密码、JWT、Gateway Key、Provider Secret 或完整 DSN。识别 5433 等既有监听者时，不因端口或容器名猜测所有权；必须使用配置证据和只读数据库查询确认目标。不得连接或写入无法确认归属的数据库。

若目标是用户明确指定的本地统一 PostgreSQL `ink-memory`，先检查 Admin Drizzle `0000–0019`、canonical 三表结构/数据、Dream Alembic baseline-adopt 条件、source Dream/Notion SQLite 快照路径与 manifest。只有 server identity、数据库名、归属、备份/回滚边界和 exact baseline 均可证明时，才执行非破坏性的 Admin migration 与 Dream 43+5 全量导入；冲突、partial baseline、目标非空或 owner/ACL 不明必须 fail-closed。禁止隐式 upsert、DROP、TRUNCATE、DELETE、ALTER OWNER、GRANT/REVOKE 或覆盖现有 canonical 数据。

修复启动配置时使用项目已定义的 PostgreSQL-only 合同，不恢复 SQLite/JSON/内存回退，不在代码中硬编码凭据。迁移成功后验证 Alembic head `20260809_06`、48/569/81/25 catalog、三表 baseline adopt、行数/PK/FK/unique/check/JSON/time/sequence/trigger、PG pool startup/health/shutdown，以及 FastAPI 在用户当前启动方式下成功进入 application startup complete。若真实迁移因缺少目标 URL、权限、备份或归属证据被阻断，明确报告唯一阻断项和一条可执行的安全下一步，不用隔离测试结果替代真实迁移。

Optional Enhancers:

- 增加脱敏 `database-doctor` 命令，一次输出缺失配置键、数据库 identity、migration head 与 runtime readiness，但永不打印 DSN/Secret。
- 为开发环境提供显式 `.env.example` 和启动前检查，区分 `DATABASE_URL` 与 `TEST_DATABASE_URL`，避免测试库或 SQLite 被误用。
- 迁移前生成只含文件大小、mtime、表计数和 SHA-256 的源快照 receipt，并将正式导入命令与 dry-run 命令分别记录。

范围变化：

- Round 38 的状态从“隔离实现验证完成”进入“用户真实本地运行恢复/迁移确认”；不得将前一轮一次性数据库 rehearsal 视为本地 `ink-memory` 已迁移。
- Token-only 月度订阅范围不变；Payment 与真实 Provider 场景不进入本 Round。

执行证据和验证结果：

- 用户堆栈显示 FastAPI 在 `database.init_db()` → `_open_runtime_pool()` → `PostgresPoolConfig.from_env()` 处抛出 `PersistenceConfigurationError`，连接尚未建立，当前首先是 PostgreSQL 配置缺失或不合法。
- 本记录完成前未连接、迁移或修改任何 PostgreSQL，也未更改启动代码。

未执行事项及原因：

- 尚未确认用户当前目标 PostgreSQL 的 URL、server identity、owner/ACL、Alembic head、catalog 与现有数据；必须在本 Round 日志门禁后只读核对。

### Round 39 执行结果

- 根因已确认：用户启动堆栈发生在 `PostgresPoolConfig.from_env()`，Dream `backend/.env` 没有 `DATABASE_URL`，因此连接尚未建立；同时 Admin-owned 本地 `ink-memory` 当时只有 37 张 public 表、Drizzle 16 migrations，Dream `dream_alembic_version` 不存在。Round 38 只完成一次性隔离数据库 rehearsal，未迁移用户当前本地库；此前报告已在本 Round 校准。
- 目标归属通过只读证据确认：容器 `ink-memory-postgres` 的 Compose project/config/working-dir 指向 `/Users/dmeck/project/ink-admin-memory/docker-compose.yml`，PostgreSQL 16.14 监听本地 5433，数据库名/owner/current user 为 `ink-memory`/`ink_memory`/`ink_memory`。三张 canonical 表已有 28 users、12 workspaces、4 stories，owner/ACL fingerprint 与 Dream exact baseline contract 匹配；未执行 `ALTER OWNER`、GRANT 或 REVOKE。
- 当前真实 SQLite 源为 43 表主库和 5 表 Notion。初次 source dry-run 发现真实演进 Schema 与 fixture manifest 的物理差异：`users`、`user_preferences`、`user_sessions`、`chat_thread` 的 ALTER TABLE 列序不同，`users.updated_at` 历史默认不同，`chat_thread.deck_id/voice_id` 在真实源没有 SQLite FK。Importer 已改为按显式列名严格比较类型/nullability/PK/hidden、只允许已审计的单列 default variant，并把两条关系标记为 target-only FK；未知默认、语义列或 FK 漂移仍 fail-closed。真实 source dry-run 随后通过：48 表、4921 行（main 4919、Notion 2）、64 FK checks，receipt 不含正文、路径、DSN 或 Secret。
- 迁移前建立三份 mode 600 恢复物：PostgreSQL custom dump、77,856,768-byte main SQLite 副本和 90,112-byte Notion SQLite 副本，位于 `/Users/dmeck/project/ink-dream-memory/.artifacts/round39-local-pg-cutover-20260809/`；源 SHA-256 在正式导入前再次核对不变。另在 Schema 已就绪但数据未导入时生成第二个 PostgreSQL restore point。
- 明确命名 clone `ink_memory_local_cutover_rehearsal_test` 从备份恢复后，事务化应用 Admin 0016–0019 和 Dream 六波 Alembic。第一次 Alembic 因缺失显式 owner/ACL 证明 fail-closed；传入 owner=`ink_memory` 与 ACL SHA-256 后 exact baseline adopt 成功，得到 83 张 public 表和 Dream head `20260809_06`。
- 真实数据 rehearsal 首次发现 PostgreSQL trigger 翻译缺陷：生成器使用不存在的 `num_nonnull()`，只在插入非空 `workflow_runs` 时暴露；已修为 PostgreSQL `num_nonnulls()` 并新增回归。重建 clone 后，target-dry-run 回滚和 test execute 提交均通过：48/569/81/25、4921 source rows、44 canonical rows exact matched、4877 rows inserted、64 FK checks、8 sequence columns。
- 为避免绕过 `TEST_DATABASE_URL` 安全门禁，新增独立 `--production-execute`：必须精确匹配 DATABASE_URL database/host/port、数据库 current user/owner，并提供 `MIGRATE-43+5-TO:<database>` 确认串。首次正式执行发现 identity 只读查询开启隐式事务，后续 `SET TRANSACTION ISOLATION LEVEL SERIALIZABLE` 被拒绝；事务统一回滚且非 baseline 表仍为 0 行。修复为 identity 校验后显式结束只读事务，并在 `ink_memory_production_mode_test` clone 真实提交验证成功后才重试正式库。
- 本地真实 `ink-memory` 最终迁移成功：Admin Drizzle 为 20 migrations；Dream head 为 `20260809_06`；43+5 共 4921 源行中 4877 行新写入、44 canonical 行 exact matched；Dream scoped catalog 为 48 tables / 569 columns / 81 explicit indexes / 25 triggers、64 FK checks、8 sequence columns。整个 importer commit 使用单个 SERIALIZABLE transaction，无隐式 upsert、DROP、TRUNCATE、DELETE 或 baseline overwrite。
- 最终全库为 83 张 public 表。关键只读行数为 users 28、workspaces 12、stories 4、chat threads 1165、chat messages 2355、user sessions 488、voices 443、Notion connectors 1、Notion resources 1。新增 `verify_postgres_schema.py --runtime-database` 只读模式，以 database/host/port/owner identity 证明正式 catalog 48/569/81/25，catalog SHA-256 为 `8944e61694022853778974c9de6fae574e2dd0d5fd01b81d6c7669fe073d2c38`；没有把正式库伪装成 TEST_DATABASE_URL。
- Dream 启动配置新增显式 `INK_DATABASE_ENV_FILE`：当前本地 `backend/.env` 指向 Admin `.env.local`，loader 只读取其中的 `DATABASE_URL`，不导入其他 Admin Secret，也不复制数据库密码。相应 `.env.example`、项目 README 和 fail-closed unit tests 已更新。
- 真实 FastAPI lifespan 验证通过：以原 8765 启动方式进入 `Application startup complete`，`GET /api/health` 返回 200/`status=ok`，随后正常 shutdown；8765 再次无监听。Focused 结果为 migration/schema/trigger 28 passed + 2 PG opt-in skips，以及 config/migration/schema 52 passed + 2 skips + 20 subtests。测试入口强制关闭本地 runtime DSN 加载；从正确 `backend/` import root、显式移除 `DATABASE_URL/TEST_DATABASE_URL` 的完整 suite 为 1673 passed、14 skipped、85 warnings、652 subtests。首次从仓库根运行只在 collection 阶段因 import root 错误停止，未执行测试或数据库操作；两个仓库 `git diff --check` 通过。
- 两个 Round 39 测试数据库均按精确名称删除，剩余数为 0；持久化备份和脱敏 rollback/commit/production receipts 保留。用户既有 `.claude/worktrees/` 未触碰，未连接外部 Provider/Payment，Token-only 范围不变。

未执行事项及原因：

- 本 Round 完成的是用户当前 Admin-owned 本地 `localhost:5433/ink-memory` cutover，不等于其他预发布/生产环境已迁移；其他环境必须重新执行 server identity、owner/ACL、备份、最终源 rehearsal 与变更审批。
- 历史 credential owner 吊销/轮换、外部 Provider canary、生产 Gateway 服务身份与逐角色推理切流仍未执行。PaymentAdapter、Webhook、Fake/Test Adapter 与真实支付继续 Deferred。

## Round 40 — 本地真实 Product API/Gateway 闭环与最小权限完成度审计

Optimized Prompt:

作为 Ink Memory 的跨应用发布审计负责人、服务间认证工程师、PostgreSQL 最小权限架构师与 Token-only Gateway 验证负责人，在 Round 39 已完成本地 `localhost:5433/ink-memory` 43+5/4921 行真实 cutover 和 Dream FastAPI 启动后，继续证明或补齐 Dream↔Admin 的真实运行闭环。不得用 mocked BFF、isolated-only PG 或静态代码存在替代本地真实 Admin Product API、Dream BFF、Gateway 和 canonical user 数据流证据。

首先只读核对两个项目当前 `.env*` 的配置键名、Admin/Dream 服务身份、Product API JWT issuer/audience/client、Gateway canonical-subject key、实际 Plan/Plan Version/Entitlement/Subscription/Allowance 数据，以及 PostgreSQL current roles、role membership、owner、schema/table/sequence/function ACL。读取配置只输出键名/布尔就绪状态和脱敏 fingerprint，禁止回显 DATABASE_URL、JWT secret、Gateway key、Provider credential 或完整 token。确认当前两个运行时是否仍共享 owner 账号；若是，明确判定“独立 Repository 已实现但独立数据库角色/最小权限未完成”，不得用逻辑所有权冒充物理 ACL。

完成本地真实跨应用验证：Admin 以当前 `ink-memory` 启动，Dream 使用 canonical Session/服务身份请求五条 Product API/BFF；套餐、用户订阅、周期、Token Allowance、Usage 与模型权限全部来自 Admin 数据，不使用静态数组或 mock。Gateway 使用 server-only canonical-subject 服务认证，验证 canonical user→Subscription→Plan Version→Entitlement→Model Permission→Token Allowance→Gateway request→Token Usage 的真实本地链路。Provider 调用仅允许受控本地 synthetic upstream，不使用真实 Secret/外部网络；必须分别报告数据库/API 持久化 lane 与浏览器 UI lane。

对于数据库角色，先生成并在从 Round 39 备份恢复的明确命名测试 clone 中验证幂等、可审计的 role/GRANT/REVOKE 方案：Admin 迁移 owner 保持控制面 DDL 权限；Dream migration role 只管理 Dream-owned 45 表/相关 sequence/function/journal；Dream runtime role 只具备运行所需 DML/sequence/execute；Admin runtime 对 Dream 表只读或白名单更新，禁止通用 DELETE。不得改变三张 canonical 表 owner，不得在真实 `ink-memory` 执行 ALTER OWNER/GRANT/REVOKE，除非获得独立明确授权。测试需证明允许矩阵和拒绝矩阵、默认权限、未来 Alembic object grant、append-only trigger 与连接池启动。

若真实 Product/Gateway 闭环因缺少本地服务身份、计划/订阅种子或安全 Secret 被阻断，优先使用隔离生成的短期本地凭据和明确测试数据，不写入仓库、不打印、不复用生产 Secret；所有 fixture 可按唯一前缀识别并通过领域命令/事务清理。若需要用户权限或外部 Provider 才能继续，完成所有可独立完成的合同、配置 doctor 和本地 synthetic upstream 验证后再报告唯一阻断项。

Optional Enhancers:

- 新增跨应用 `local-integration-doctor`，仅输出五条 Product API、Gateway service identity、DB roles/heads 与 Token lifecycle 的红绿状态。
- 为数据库权限矩阵增加 psql `SET ROLE` 自动化测试和 default privileges drift verifier。
- 对 canonical user/Subscription/Allowance/Gateway request 使用一个合成 correlation ID，生成不含业务值或 Secret 的端到端 receipt。

范围变化：

- Round 39 已完成用户当前本地 PG 数据 cutover，本 Round 转向真实跨应用业务闭环和物理最小权限证据。
- 用户最新 Token-only 月度订阅决策继续覆盖旧目标中的 PaymentAdapter/Webhook/Fake Adapter；Payment 全域保持 Deferred，不在本 Round 重新实现。

执行证据和验证结果：

- Round 39 最终本地状态为 83 public tables、Admin 20 migrations、Dream head `20260809_06`、Dream scoped 48/569/81/25、1673 backend tests 通过，真实 Dream startup/health 通过。
- 本记录完成前尚未启动 Admin、调用真实 Product API/Gateway，亦未执行任何角色、ACL 或业务 fixture 写入。

未执行事项及原因：

- 本地跨应用 Product/Gateway 与数据库物理角色矩阵尚未核对；必须在本 Round 日志门禁后开始只读审计。

### Round 40 启动故障与迁移可见性复核（阶段证据）

- 用户提供的最新堆栈仍在 `PostgresPoolConfig.from_env()` 因无有效 `DATABASE_URL` 退出，发生点早于连接池建连和 Alembic head 查询，不是 PostgreSQL migration rollback。当前 Dream `backend/.env` 已包含 `INK_LOAD_DATABASE_URL_FROM_ENV_FILE` 与 `INK_DATABASE_ENV_FILE`；脱敏配置探针在显式移除进程级 `DATABASE_URL/TEST_DATABASE_URL` 后，成功只加载 Admin env 中的 `DATABASE_URL`，解析目标为本机 `localhost:5433/ink-memory`，未读取或输出其他 Admin Secret。
- 使用当前代码、当前配置与 Dream `.venv` 分别通过 Uvicorn CLI 和 README 原命令 `python server.py` 真实启动 8765，两次均进入 `Application startup complete`；`GET /api/health` 均返回 200/`status=ok`。README 的 env-file 示例原先遗漏显式开关，现已补充 `INK_LOAD_DATABASE_URL_FROM_ENV_FILE=1`。验证后通过 SIGINT 正常关闭，scheduler、Claude Agent factory、PG pool 和 FastAPI lifespan 均完成 shutdown；8765 已确认无监听。
- 对当前 `ink-memory` 执行只读 SQL：current role 为 `ink_memory`，public 表共 83 张，Dream 独立迁移日志 `dream_alembic_version` 为 `20260809_06`。从正式提交回执读取 48 张迁移清单并逐表直接查询当前 PostgreSQL，结果为 48/48 表存在、合计 4921 行；与主 SQLite 43 表/4919 行及 Notion SQLite 5 表/2 行完全一致。
- 正式回执仍为 `mode=production-execute`、`status=committed`，manifest/snapshot/staging/conflict/transform/import/verify 全部 passed；4877 行新写入、44 行 canonical baseline exact-match、conflicts=0。关键 PostgreSQL 行数复核为 users 28、workspaces 12、stories 4、chat threads 1165、chat messages 2355、user sessions 488、voices 443；Notion 目标表实际名称为 `resource_connectors`/`connector_resources` 等五表，两个有数据表各 1 行。
- 迁移回执与 mode-600 备份继续位于 Dream `.artifacts/round39-local-pg-cutover-20260809/`；本阶段只读复核没有修改数据库、没有打印 DSN/密码/Token，也没有启动外部 Provider 或 Payment。

未执行事项及原因：

- Round 40 原定的真实 Admin Product API、Dream BFF、Gateway synthetic upstream 闭环和物理角色/ACL clone 验证仍未完成；本次先处理用户明确指出的启动失败与迁移可见性问题，不将它们误报为已验收。

## Round 41 — 现有订阅数据 Token-only 转换与真实 Product API 解阻

Optimized Prompt:

作为 Ink Memory 的订阅数据演进负责人、PostgreSQL 不可变历史迁移工程师和跨应用 Product API 发布负责人，处理真实本地 `ink-memory` 已暴露的代码/数据合同错位：Admin/Dream Product API 已强制 Token-only 月度订阅，但现有唯一 published Plan Version 仍包含非零金额字段与非空 `effective_from`，现有 active/cancel-at-period-end Subscription 引用该历史版本，导致 plans/context/usage 真实调用 fail-closed 返回 503。不得通过放宽 Token-only 校验、恢复金额套餐、启用 cash overage 或原地 UPDATE 已发布 Plan Version 规避问题。

先审计 Admin 0018/0019、Plan/Subscription service、事件/Allowance 约束及当前真实行的引用关系，形成可重复、幂等、fail-closed 的数据转换方案。旧 published Plan Version、历史 Subscription Event、Gateway Usage 和 Ledger 必须保留且不可覆盖；新增独立 Token-only monthly Plan Version（`base_price_microusd=0`、`allowance_microusd=0`、`overage_policy=deny`、无共享生效窗口），复制经审核的 Token/模型/Scope/RPM/Storage 权益，并通过受控领域命令或专用 migration transition 将仍可调用的 canonical-user Subscription 切换到新版本、生成周期可追溯 Allowance 与 append-only Subscription Event。历史 orphan `platform_users` 及其 Subscription/Gateway/Ledger 只审计、标记或隔离，不删除、不伪装为 canonical user，也不得成为 Product API 主体。

任何真实库写入前必须：生成数据库备份；在从备份恢复的明确命名测试 clone 中应用候选 migration；验证 published-version immutability、重复执行幂等、部分状态 fail-closed、Token 守恒、FK/unique/check/trigger、Subscription version/event provenance、Allowance period/plan-version provenance，以及旧 Gateway/Ledger 可追溯。clone 必须证明转换后五条 Admin Product API 与五条 Dream BFF 均使用真实 PostgreSQL 返回 Token-only 数据，preview 不写入、execute 遵守 expectedVersion/receipt/idempotency。真实 `ink-memory` 只允许执行已在 clone 通过的非破坏 migration；禁止 DROP、TRUNCATE、DELETE、隐式 upsert、修改历史 Usage/Ledger 或绕过 trigger。

转换后继续 Round 40 的真实闭环：Admin/Dream 使用进程内短期 JWT Secret，canonical session 绑定唯一 users；plans/context/usage/model-catalog/command-preview 全部 200，响应不得出现价格、币种、金额、Payment、Secret 或 platform user id。Gateway 持久化请求使用备份 clone 和本地 synthetic provider 验证 reserve/capture/release、Usage/Allowance/append-only Ledger；真实库只做不扣 Token 的鉴权/模型目录读链，避免污染真实用户。PaymentAdapter、Webhook、Fake Adapter 与真实支付继续 Deferred。

Optional Enhancers:

- 增加 `token-only-data-doctor`，只输出历史/当前版本数量、可调用订阅兼容性、Allowance provenance 和 Product API readiness，不输出用户 PII、金额值或 Secret。
- 为历史 plan version 增加 `superseded_by` 或独立迁移映射表，但不得改写已发布版本核心字段。
- 对月末 anchor、暂停/待取消状态和重复迁移增加属性测试与并发测试。

范围变化：

- Round 40 的真实 API 审计证明问题不在路由外壳，而在本地现有订阅数据仍属于旧金额合同；本 Round 增加“历史数据到 Token-only 新版本的不可变转换”作为 Product/Gateway 闭环前置发布阻断。
- 最新 Token-only 月度订阅决策不变；Payment 全域继续 Deferred，不因历史金额列/账本存在而重新进入当前产品范围。

执行证据和验证结果：

- 真实只读审计：28 canonical users 全部具有 active platform projection 与 Billing Account；另有 1 个 `source=ink-memory` 的 orphan platform user，关联 1 Subscription、158 Gateway requests、30 Ledger entries，必须保留隔离。
- 当前控制面数据为 1 Plan、1 Plan Version、1 Entitlement、2 Subscriptions、2 Allowances、4 Gateway Keys、165 Gateway requests。唯一版本为 monthly 但金额字段非零、`effective_from` 非空；canonical user 1 的 active Subscription 引用该版本。
- 使用当前实库、真实 Admin 与 Dream 进程、短期进程内 Product JWT Secret联调：Dream model catalog → Admin 返回 200；plans/context/usage 均因 `assertTokenOnlySubscription` 返回 503。最初一次 Dream session token 使用了未加载 dotenv 的默认 key，返回 401；修正为与 FastAPI 相同的 dotenv 加载后认证成功，该失败没有到达 Admin 或写数据库。
- 两个服务均已正常关闭，3000/8765 不保留本阶段进程；本记录前没有修改套餐、订阅、Allowance、Gateway、Usage 或 Ledger 数据。

未执行事项及原因：

- 候选数据 migration、clone rehearsal、真实库转换、五 BFF 200 复验、Gateway synthetic persistence 和数据库角色矩阵尚未执行；必须在本 Round Prompt Architect 日志完成后开始。

### Round 41 执行结果（阶段完成）

- 新增 Admin Drizzle `0020_token_only_data_cutover`。迁移不修改旧 published Plan Version、旧 Allowance、Gateway Usage、Billing Ledger 或既有 Subscription Event；它为仍可调用且属于 canonical user 的 legacy 版本创建 deterministic Token-only successor version/entitlement，把旧 Subscription 以 `expired` + version increment 终止，再创建同一用户、同一周期/anchor 的 successor Subscription、零金额 Token Allowance及双向 append-only cutover event。orphan platform user 不进入转换。
- 0020 对 past_due、pending change、过期周期、无/重复 Allowance、provenance 不匹配、在途 reserved Token、已消费 Token、无 enabled entitlement 和 deterministic ID 冲突全部 fail-closed。当前自动转换只接受 current allowance reserved=0/consumed=0，避免丢失当前周期 Usage 归属；复杂生产订阅必须在月度边界由 operator-reviewed forward migration 处理。
- 在新建 mode-600 备份 `round41-token-only-cutover-20260809/ink-memory-before-token-only-cutover.dump` 恢复的 clone 中，0020 将 migration 20→21、Plan v1 legacy + v2 Token-only、canonical legacy active→expired + successor active、Token Allowance 10000/0/0、两个 system cutover events；旧 orphan cancel-at-period-end subscription 保持 v1 legacy。重复运行 migration journal 后版本/订阅/事件计数不变。
- 故障 clone 把 canonical current allowance 注入 consumed_tokens=1 后，0020 以 `token_only_cutover_allowance_check` 回滚；migration 仍为 20、Plan Version 1、Subscription 2、cutover event 0，证明失败无部分 successor。
- clone 上真实 Admin+Dream 五路联调全部 200：plans=1、monthly Token=10000；context active/version1、Allowance 10000=0+0+10000；usage current period UTC；model catalog 1 个 available alias；pause preview allowed、含短期 preview/digest。preview 后 Subscription 仍 active/version1、Allowance和事件数不变。Admin clone 安全门禁还证明非 `ink-memory` 不能伪装进 `DATABASE_URL`，必须显式 `INK_USE_TEST_DATABASE_URL=1 + TEST_DATABASE_URL`。
- 正式写入前确认 3000/8765 无监听、实库 migration=20、唯一 canonical legacy subscription reserved/consumed=0、备份 SHA-256 未变。`pnpm db:migrate` 随后只应用已演练的 0020；实库 migration=21、callable canonical legacy=0，旧 v1/旧 subscription/Allowance/events 保留，v2 Token-only 和 active successor 可追溯，orphan 财务历史未改。
- 实库五 BFF 再次全部 200：plans/context/usage/model-catalog/command-preview 请求 ID 可追踪；响应只包含 monthly Token、周期、模型、Scope/限额和 preview，不含价格、币种、金额、Payment、Secret 或 platform user id。两个服务随后正常关闭。

未执行事项及原因：

- Gateway synthetic persistence 与物理角色矩阵仍在下一阶段继续；Payment 全域仍 Deferred。

## Round 42 — Token Ledger、Gateway 守恒与最小权限闭环

Optimized Prompt:

作为 Ink Memory 的 Token 账本架构师、Gateway 事务结算工程师和 PostgreSQL 最小权限负责人，在 Round 41 完成真实订阅数据 Token-only 转换后，补齐 synthetic Gateway 验证暴露的 `Usage → Ledger` 缺口。当前 Gateway 已能在隔离 clone 中用 canonical-subject service key 和本机 synthetic Anthropic upstream 完成 request→reserve 40 Token→capture 12→release 28，Allowance 最终 10000/0/12，Gateway request settled/succeeded、request/response payload 各 1、idempotent replay 409；但因 Token-only 正确跳过金额结算，`billing_ledger_entries` 为 0。不得通过写入虚假 micro-USD、恢复 cash balance 或复用 Payment ledger 伪装 Token 账本。

新增独立、append-only、单位固定为 Token 的 Subscription Token Ledger。每条 Gateway reserve/capture/release 必须与 Allowance 更新和 Gateway request 状态位于同一 PostgreSQL transaction，带唯一 idempotency key、canonical platform projection、Subscription、Plan Version、Allowance、Gateway request、entry type、Token amount、reserved/consumed/available before/after、actor、metadata 和 created_at。Token 数值必须为安全非负整数，amount > 0；Ledger UPDATE/DELETE 由数据库 trigger 拒绝。成功请求估算 40/实际 12 必须生成 reserve 40、capture 12、release 28；Provider 明确未计费失败生成 reserve+release；usage unknown 保留 reserve，后续 idempotent worker capture/release；replay 不重复记账。Ledger 不进入 Dream Product API 响应，也不包含金额、Secret、请求正文或 Provider credential。

实现必须扩展 Admin migration、Schema/types、Repository/service 和受控 Admin 只读资源；Route Handler 仍只做解析、Session/RBAC/Origin/Zod/service。现有 `billing_ledger_entries` 继续作为历史/非订阅金额域，不接收 Token-only伪记录。新增 migration 对既有 settled Token-only Gateway requests只做只读审计和可选 deterministic backfill：只有 reserve/capture/release 可从 immutable request/Allowance事实无歧义重建时才写入；任何 usage unknown、缺失 provenance 或 Token 守恒冲突必须阻断自动 backfill或留在明确 exception report，禁止猜测。

在明确 clone 中验证 synthetic provider 成功、失败、重复、usage-missing/worker、并发/idempotency、Allowance 与 Token Ledger 守恒、append-only SQLSTATE、payload Secret redaction。随后在同一备份 clone 建立 Dream migration/runtime、Admin runtime 和 owner roles，使用 `SET ROLE` 证明允许/拒绝矩阵、default privileges 和未来对象授权；不得对真实 `ink-memory` 执行 ALTER OWNER/GRANT/REVOKE。真实库只应用已演练且非破坏的 Schema/data migration，并以只读 Product/Gateway readiness 复核；synthetic请求继续只打 clone。

Optional Enhancers:

- 增加 Token Ledger 守恒属性测试：每个 Allowance 的 reserve−capture−release 与当前 reserved、capture−refund/reversal 与 consumed 一致。
- 增加 Gateway correlation receipt，只包含 ID/fingerprint/计数/状态，不含正文、PII、Secret 或 DSN。
- 增加 Token Ledger CSV 导出，但明确不是第三方账单或支付凭证。

范围变化：

- Round 41 解决 Product API 的历史数据合同错位；Round 42 增加独立 Token Ledger，因为 synthetic Gateway 证明金额 Ledger 在 Token-only 覆盖下按设计为 0，不能满足完整 `Usage → Ledger` 可审计链。
- PaymentAdapter/Webhook/Fake/真实支付仍 Deferred；Token Ledger 不是支付账单，也不恢复金额 Balance/Overage。

执行证据和验证结果：

- clone synthetic Gateway 使用临时 canonical-subject key、Dream 生成的短期 subject JWT、localhost-only Anthropic-compatible upstream 和替换后的 synthetic encrypted provider credential；未解密、发送或记录真实 Provider Secret。
- 首次请求 200，Provider usage input=7/output=5；Gateway immutable row为 settled/succeeded，estimated/reserved=40、charged=12、money fields=0，Subscription/Entitlement/Allowance FK 完整，request/response payload 各 1。重复 idempotency key 返回 409且 request count=1。
- Allowance 从 10000/0/0 经 reserve/capture/release后为 10000/0/12，version=3；canonical-subject key last_used 非空。`billing_ledger_entries` 对该请求为 0，证明需实现 Token Ledger，而非误报闭环。
- synthetic Admin/provider 已关闭，3000/4101 无监听；真实 `ink-memory` 未扣 Token、未写 Gateway fixture。

未执行事项及原因：

- Token Ledger Schema/代码/backfill/测试、Gateway 复验、角色矩阵及真实库后续 migration尚未执行；必须在本 Round Prompt Architect 日志完成后开始。

### Round 42 执行结果（Token Ledger 与真实 PG migration 完成）

- 新增 Admin Drizzle `0021_subscription_token_ledger`、Drizzle Schema、`app/lib/subscriptions/token-ledger.ts` 和只读 `/admin/subscriptions/token-ledger`。`subscription_token_ledger_entries` 单位固定为 `tokens`，记录 canonical projection、Subscription、Plan Version、Allowance、Gateway Request、请求内顺序、Token 变更及前后状态；它不含 micro-USD、Payment、Secret、请求正文或 Provider credential。既有 `billing_ledger_entries` 未接收 Token-only 伪记录。
- Token reserve/capture/release 已接入 Gateway 的同一 PostgreSQL transaction。每个请求使用唯一 `(gateway_request_id, request_sequence)` 和 idempotency key；数据库 provenance trigger 强制用户、订阅、版本、Allowance 与 Gateway Request 一致，transition/check 约束强制非负与总量守恒，UPDATE/DELETE trigger 以 SQLSTATE `55000` 拒绝修改。Admin 资源只允许 `subscriptions.read`，Mutation 路由不支持该资源。
- migration 对任何已有 `subscription_coverage_mode='token_allowance'` 的 Gateway Request fail-closed，不猜测历史流水。含 1 个历史 Token 请求的 clone 以 `subscription_token_ledger_backfill_required` 回滚，migration 仍为 21、Ledger 表不存在；当前真实库在 migration 前为 0 个此类请求，因此无需 backfill。备份 `/Users/dmeck/project/ink-dream-memory/.artifacts/round42-token-ledger-20260809/ink-memory-before-token-ledger.dump` 为 mode 600、33,565,853 bytes，SHA-256 `968cb15e1797f6b15aa5b7423535e59279ccfdb45d8ea6a974c8733b561865b0`。
- 最终明确隔离 clone `ink_memory_token_ledger_sequence_codex_test` 从该备份恢复并应用 0021，得到 22 migrations、3 个 Ledger triggers 和请求顺序唯一索引。localhost synthetic Anthropic 请求精确验证：HTTP 200、Provider usage 7+5；Gateway estimated/reserved=40、captured=12、money=0；Ledger 按显式顺序为 `[1 reserve 40, 2 capture 12, 3 release 28]`，Allowance 最终 10000 granted / 0 reserved / 12 consumed / 9988 available。相同 idempotency key 返回 409、Gateway Request=1、Token Ledger=3、金额 Ledger=0。
- clone 约束注入验证：交叉 platform user provenance 写入返回 23503；重复 request sequence 返回 23505；Ledger UPDATE/DELETE 均返回 55000，失败后仍仅保留原 3 行。usage-missing lane 返回 502/`UPSTREAM_USAGE_MISSING`，先仅保留 reserve 39；把 clone 的完成时间调整到隔离 worker grace window 后，worker 一次保守 capture 39、第二次 processed=0，最终 reserve/capture 各 1、reserved=0、金额 Ledger=0。
- 应用层聚焦门禁通过：`pnpm exec tsc --noEmit`；Token Ledger/Admin resource/Gateway settlement/unknown worker 五文件 13/13 tests；`git diff --check`。另一次错误命名的隔离库因不含 `test/codex` 被 Admin 连接安全门在连接前拒绝，没有 Request 或 Ledger 写入；随后全部持久化验证均使用显式 `INK_USE_TEST_DATABASE_URL=1 + TEST_DATABASE_URL=..._codex_test`。
- 真实本机 `localhost:5433/ink-memory` 写入前确认 3000/8765/4101 无监听、备份 hash 不变、Admin migrations=21、Token Gateway requests=0、Token Ledger 表不存在。只应用已演练的 0021，并立即重复执行验证幂等；当前为 Admin migrations=22、public tables=84、Token Ledger 表存在且 0 行、3 triggers、顺序唯一索引存在，真实用户未扣 Token、未写 synthetic Gateway fixture。
- 针对用户最新启动堆栈，根因仍是 Dream 在连接前没有加载有效 `DATABASE_URL`，不是 PG migration rollback。README 已补充 `INK_LOAD_DATABASE_URL_FROM_ENV_FILE=1`。使用该开关和 Admin env-file 实际启动 Dream 后进入 `Application startup complete`，`GET /api/health` 返回 200/`status=ok`，随后 SIGINT 正常关闭并确认 8765 释放。
- 真实 PostgreSQL 只读复核：Dream main 43 表/4919 行 + Notion 5 表/2 行 = 48 表/4921 行，Dream Alembic head `20260809_06`；catalog 为 48 tables / 569 columns / 81 explicit indexes / 25 triggers，catalog SHA-256 `ff4e6ea0a0586789b4b20f370c469bbcf0c440d33b5178a8445bd4e1108c5335`。正式 Round 39 receipt 仍为 `production-execute/committed`、4877 inserts + 44 exact canonical baseline、conflicts=0。
- 最终仓库门禁：Admin `pnpm env:check`、`pnpm exec tsc --noEmit`、`pnpm lint`、`pnpm test:run`（65 files / 312 tests）和 `pnpm build` 全部通过，build 路由清单包含 `/admin/subscriptions/token-ledger`。Dream PostgreSQL persistence/migration/trigger focused suite 为 45 passed / 2 explicit skipped / 20 subtests；两项 skip 仅因本命令没有注入可写 `TEST_DATABASE_URL`，真实 runtime catalog 已由独立只读 doctor 通过。
- 按 `ink-dream-playwright-qa` 的隔离、端口识别、诊断监听和清理规则扩展并运行 `tests/e2e/subscription-billing-postgres.spec.ts`，真实明确测试库、Chromium、1 worker 为 1/1 passed（12.3s）。新增断言覆盖 Token Ledger API 的 sequence/type/amount 守恒、无 micro-USD/Payment/Secret，以及 `/admin/subscriptions/token-ledger` 在 1440×1000 与 390×844 的真实数据、无页面横向溢出和零应用诊断。该 lane 的 Provider 是进程内 localhost synthetic upstream，不是外部 Provider E2E。
- Playwright webServer 退出后确认 3000/8765/4101 均无监听；本 Round 创建的五个精确测试库 `ink_memory_token_ledger_r42_a9f3`、`ink_memory_token_ledger_r42_codex_test`、`ink_memory_token_ledger_provenance_codex_test`、`ink_memory_token_ledger_sequence_codex_test`、`ink_memory_token_ledger_ui_codex_test` 已逐一删除，复核剩余 0。真实 `ink-memory` 仍为 Admin migrations=22 / Dream head `20260809_06`。

未执行事项及原因：

- 物理最小权限 role/ACL matrix 尚未在新的 0021 clone 上完成，且未获得修改真实库 owner/ACL 的独立授权；真实 `ink-memory` 仍不执行 ALTER OWNER、GRANT 或 REVOKE。
- Dream 仓库全量 suite 未在本阶段重跑（Round 39 已为 1673 passed / 14 skipped），最终 Reader Testing 仍待执行；当前不把 Dream focused suite 冒充全量重跑。
- 未调用外部 Provider、真实用户 Token、真实 Provider/Payment Secret 或支付网络。PaymentAdapter、Webhook、Fake/Test Adapter 与真实支付继续 Deferred；本地 synthetic provider/key/worker secret 仅存在于隔离进程，服务结束后 3000/4101/8765 均释放。

## Round 43 — Token Ledger 文档一致性与无上下文 Reader Testing

Optimized Prompt:

作为不了解 Round 39–42 执行过程的独立发布文档审阅者，对 Ink Memory 的权威 PRD、模块 PRD、架构 01–08/90/91、Admin/Dream 交互设计、README 和验证日志做最终一致性审计。以当前可验证事实为唯一基线：用户产品范围是 Token-only 用户级月度订阅；PaymentAdapter/Webhook/Fake/真实支付全部 Deferred；本地 `localhost:5433/ink-memory` 已完成 Dream 43+5/4921 行 cutover、Dream head `20260809_06`、Admin migrations=22；`0021_subscription_token_ledger` 已实现 Token 单位 append-only reserve/capture/release，独立于金额 Ledger，并通过真实 schema migration、隔离 Gateway 与两视口 Playwright。

逐文档确认 Current/Implemented、Target、Release Gate、Deferred 和历史证据没有互相冒充。同一能力不能同时标为 Planned 与 Deferred；Token Ledger 不能称为 Payment、金额账单、Dream Product API 字段或已完成外部 Provider canary；历史 Round 38/39 的旧测试数量只能保留在有明确历史 Round 语境的日志，不得继续出现在当前状态摘要。检查唯一 H1、Markdown 围栏与 Mermaid 成对、本地相对链接存在、表格列数可读、关键链路 `Canonical User → Subscription → Plan Version → Entitlement → Model Permission → Token Allowance → Gateway Request → Token Usage → Subscription Token Ledger` 一致。

对代码/数据库事实做只读交叉验证：migration journal 以 0021 结束，真实库只读状态为 22 migrations/84 public tables/Token Ledger 0 行、Dream 48 表/4921 行；README 的启动方式必须包含 `INK_LOAD_DATABASE_URL_FROM_ENV_FILE=1`，且 8765 已关闭。执行 `git diff --check`、文档 H1/围栏/Mermaid/本地链接机械检查和 Secret/DSN 泄露扫描。发现矛盾时只修正文档或测试描述，不修改真实数据库、不重新引入 Payment、SQLite/JSON/内存 fallback 或外部 Provider 调用。

Optional Enhancers:

- 生成只含文件路径、状态类别和检查结果的 Reader receipt，不含用户数据、DSN 或 Secret。
- 对 Current 状态摘要中的 migration/test 数量建立机械一致性 grep，允许历史日志保留旧数量但要求 Round 标签明确。

范围变化：

- Round 42 已完成 Token Ledger、真实 0021 migration 与两视口 Playwright；Round 43 只做文档/证据收口，不新增产品或数据库能力。
- 物理角色/ACL matrix 与外部 Provider canary继续是 Release Gate；Payment 全域继续 Deferred。

执行证据和验证结果：

- 本记录完成前已更新当前 PRD/架构/交互摘要，使其引用 Admin `0000–0021`、65 files/312 tests、Token Ledger 与真实本机 PG 状态；尚未执行本 Round 机械 Reader checks。

未执行事项及原因：

- H1/围栏/Mermaid/本地链接/Secret 扫描和最终只读数据库一致性复核必须在本 Prompt Architect 记录之后执行。

### Round 43 执行结果

- 无上下文 Reader Testing 覆盖 37 份当前权威文档：37/37 个 semantic H1、22 个 Mermaid block、全部 Markdown 围栏平衡、169 个本地相对链接存在，errors=0。最初朴素 H1 统计把发布 runbook 的 bash comment 误计为 5 个标题；改为排除 fenced code 后 semantic H1=1，文档无需为迎合错误检查器改写命令示例。
- 当前状态摘要已统一为 Admin `0000–0021`、65 files/312 tests、Token Ledger 与真实本机 migrations=22；历史 worklog 中 Round 38/39 的旧数量保留在明确历史语境，不作为 Current。Token Ledger 仅标记 Implemented / Release candidate；物理角色矩阵和外部 Provider canary保留 Release Gate；PaymentAdapter/Webhook/Fake/真实支付只保留 Deferred，没有 Planned/Implemented 冲突。
- Secret/DSN 机械扫描未发现 Gateway plaintext key、Bearer token、private key 或带值 API key；`git diff --check -- docs README.md` 通过。文档链路统一为 `Canonical User → Subscription → Plan Version → Entitlement → Model Permission → Token Allowance → Gateway Request → Token Usage → Subscription Token Ledger`，并明确金额 Ledger 是独立历史/现金域。

未执行事项及原因：

- 物理数据库角色/ACL/default privileges 矩阵和外部 Provider canary仍未执行；它们需要独立 clone 设计/验证和生产授权，不影响本轮“启动恢复、43+5 真实迁移可见性、0021 Token Ledger”结论。

## Round 44 — PostgreSQL 独立角色、最小权限与运行时身份验证

Optimized Prompt:

作为 Ink Memory 的 PostgreSQL 安全架构师、Dream/Admin migration/runtime 角色设计负责人，在 Round 39–43 已完成本地 `ink-memory` 43+5 cutover、Admin 0021 与 Token Ledger 后，补齐“独立 Repository、独立数据库角色、独立迁移日志和最小权限”的物理证据。不得把当前单一 `ink_memory` superuser/owner 连接、文档逻辑所有权或应用层 RBAC 冒充数据库最小权限完成。

先只读生成真实库 owner、schema/table/sequence/function/type ACL、role membership、default privileges 和 runtime SQL 动作清单；不输出密码、完整 DSN、JWT、Gateway Key 或 Provider Secret。基于 Dream 48 表、Admin 控制面表、三张 canonical shared baseline、Dream `dream_alembic_version` 与 Admin `drizzle.__drizzle_migrations` 建立明确角色：owner/migration 控制角色、Admin runtime、Dream migration、Dream runtime。角色必须 `NOLOGIN` 或只在测试中使用短期 LOGIN；真实部署凭据不写仓库。

在从 Round 42 mode-600 备份恢复的明确 `*_codex_test` clone 中实现幂等 SQL/bootstrap/verifier：Dream runtime 只获得其业务 Repository 必需 SELECT/INSERT/UPDATE/DELETE、相关 sequence USAGE 和必要 function EXECUTE；Admin runtime 对控制面拥有其 Repository 必需 DML，对 Dream 业务表默认 SELECT，仅对经审计的 canonical/运营白名单列或领域 function 具有更新能力，禁止 Dream 通用 DELETE；migration roles 分别只能推进自己的 journal/schema 范围。三张 canonical shared baseline 继续由 Admin owner 管理，Dream migration 采用 exact baseline，不执行未知 owner 变更。

使用 `SET ROLE` 和真实 Repository/启动 SQL 证明允许与拒绝矩阵：Dream runtime 能启动、读写用户业务表和 Notion 五表，但不能写 Subscription/Gateway/Ledger/Admin RBAC，也不能更新/删除 append-only facts；Admin runtime 能执行 Product/Gateway/Subscription/Token Ledger 所需控制面操作，能读取 Dream 业务事实，但不能通用删除 Dream 表或改写 Dream Alembic journal；Dream migration 能管理 Dream-owned object 而不能改 Admin migration journal/control tables；Admin migration 能应用控制面 migration 而不能接管 Dream-owned object。验证 default privileges/未来对象 grant、schema CREATE、sequence、trigger/function security 与 search_path。

所有角色/ACL验证只作用于 clone。真实 `ink-memory` 只做前后只读 fingerprint，禁止 ALTER OWNER、GRANT、REVOKE、CREATE ROLE、SET ROLE 写入或测试 fixture，除非用户另行明确授权。输出可审计 SQL、验证 CLI、允许/拒绝矩阵和 rollout/rollback runbook；生产 rollout 必须使用预先备份/PITR、逐服务切换、连接池排空和前向修复，不把 clone PASS 宣称为真实权限已切换。

Optional Enhancers:

- 增加权限 drift verifier，比较目标矩阵与 catalog ACL，输出对象级差异但不自动修复真实库。
- 使用 `ALTER DEFAULT PRIVILEGES FOR ROLE ... IN SCHEMA ...` 覆盖未来 Alembic/Drizzle object，并在 clone 创建 canary table/sequence/function 后验证继承。
- 为 Admin 对 Dream 的白名单更新优先提供 `SECURITY DEFINER` 领域 function，并固定 `search_path`、撤销 PUBLIC EXECUTE。

范围变化：

- Round 43 已完成 Token Ledger 文档和 Reader Testing；Round 44 只补数据库角色/ACL物理证据，不新增支付、套餐或外部 Provider 能力。
- Payment 全域继续 Deferred；真实库 ACL 切换需要独立授权，clone 验证不等于生产已实施。

执行证据和验证结果：

- 当前已知真实库只有 `ink_memory` 单一 superuser/owner 运行身份；逻辑 Repository 已分离但物理最小权限未完成。本记录完成前未读取最新 ACL fingerprint，也未创建角色或修改任何数据库权限。

未执行事项及原因：

- 角色 SQL、verifier、clone restore、SET ROLE matrix 和 runtime smoke 必须在本 Prompt Architect 记录后执行；真实库始终保持只读审计。

## Round 45 — 收缩为 PG、计费订阅、订阅支付与新推理服务主链路

Optimized Prompt:

作为 Ink Memory 的产品架构师与全栈实现负责人，停止继续扩展 PostgreSQL 物理角色治理、ACL 重构和额外平台工程，把本阶段严格收缩为四条用户可见且可端到端验收的主链路：一，Dream 运行时与 43+5 业务表全部使用统一 PostgreSQL `ink-memory`，启动和健康检查不再依赖 SQLite/JSON/内存回退；二，实现 Token-only 用户级月度计费与订阅，canonical `users` 是唯一用户全集，每个用户自动拥有计费身份、Subscription、Plan Version、Entitlement、Token Allowance、Usage 与 append-only Token Ledger；三，实现订阅支付边界和隔离环境支付闭环，包括 PaymentAdapter、Payment Intent、Webhook 签名验证接口、事件持久化、唯一 event ID、幂等重放、refund/reversal 合同和仅测试环境可用的 Fake Adapter，但在未指定真实渠道时不连接 Stripe、支付宝、微信或银行网络，也不得显示虚假生产支付成功；四，将 Dream、Chat、Claude Agent 与 Workflow 的新推理请求经 Dream 服务端调用 Gateway，并执行用户、订阅、权益、模型权限、限流、Token Allowance、reserve/capture/release、Usage 与 Token Ledger 结算。

先以真实代码和数据库证据对照这四条链路，列出已完成、缺失和错误状态，不重复已完成的 43+5 migration 与 Token Ledger。优先修复当前后台启动错误和可操作断点，再补最短闭环所需 Schema、Repository、Service、API、页面与测试。产品 UI 只展示真实 Admin API 的月度 Token 套餐、订阅、用量与支付状态；浏览器不得持有 Gateway Key、Provider Secret、Payment Secret 或服务间凭据。金额若进入支付域统一使用整数 micro-USD；Token Ledger 仍只记录 Token，不得与现金 Ledger 混用。

验收必须在明确隔离 PostgreSQL 和 localhost synthetic Provider/Fake Payment Adapter 中完成：后台/Dream 实际启动、订阅开通与月度状态、重复 Webhook 不重复开通或扣费、支付失败不改变订阅、Gateway 成功/失败/usage-missing 的 reserve/capture/release、Usage/Token Ledger 不可变、Dream 订阅页和推理入口的桌面/移动视口。不得修改真实库 owner/ACL，不得使用真实支付账号、真实 Provider Token 或共享测试库；8765 验证结束后必须停止。

Optional Enhancers:

- 在主链路稳定后再增加并发续费、升级与 Webhook 竞争测试；本阶段不建设通用数据库权限平台。
- 为未来真实支付渠道保留 capability discovery 和 provider-neutral external reference，但不把第三方字段固化为核心模型。

范围变化：

- 用户明确要求简化设计，本 Round 终止 Round 44 的角色/ACL实现计划；真实库只保留现状，不执行 owner、GRANT、REVOKE 或 CREATE ROLE。
- PaymentAdapter、Webhook 与 Fake/Test Adapter 从 Deferred 调整为 Planned/Implementation scope；真实第三方支付渠道仍 Deferred。
- 主产品保持 Token-only 月度订阅；现金金额只存在于订阅支付边界，不恢复余额充值或按金额 Overage 产品。

执行证据和验证结果：

- 已知 43+5/4921 行真实 PostgreSQL cutover、Dream Alembic `20260809_06`、Admin migration 0021、Token Ledger 与 Gateway synthetic settlement 已完成；8765 当前保持停止。
- 本记录完成前尚未重新审计 Payment 代码缺口，也未修改 Payment Schema、API、UI 或数据库。

未执行事项及原因：

- PaymentAdapter/Webhook/Fake Adapter 与订阅支付 UI/API、新推理入口完整路径和本 Round 回归验证必须在此 Prompt Architect 记录后执行。

### Round 45 执行结果（四条主链收口）

- PostgreSQL：本地真实 `ink-memory` 保持 Dream 43+5=48 表/4,921 行、Dream Alembic head `20260809_06`、PG-only runtime；Admin 新增并应用 `0022_subscription_payments`，migration journal 当前 23。真实支付三表 `subscription_payment_intents/payment_webhook_events/subscription_payment_adjustments` 均为 0 行，未写测试付款或修改真实用户订阅。
- 启动错误已复现并定位：README 的裸 `python server.py` 使用系统 Python，解释器缺少已锁定的 `psycopg`，不是 PG 表缺失或 migration rollback。README 已改为 `backend/.venv/bin/python server.py`。使用仓库虚拟环境、`INK_LOAD_DATABASE_URL_FROM_ENV_FILE=1` 和显式 env-file 实际启动后进入 `Application startup complete`，`GET /api/health` 返回 200；随后 SIGINT 正常关闭，8765 无监听。
- Token-only 月订阅支付：Plan Version 继续固定 monthly、Token allowance/entitlement 与 cash overage 分离，但允许非负整数 `base_price_microusd`。新增渠道无关 `PaymentAdapter`、production guard 的 Fake Adapter、Payment Intent、Webhook 签名验证/event store/event ID 唯一幂等、refund/reversal append-only adjustment。创建 Intent 不激活订阅；只有已验证 `payment.succeeded` Webhook 才在事务内激活 Subscription 与首期 Token Allowance；失败/取消不激活，refund/reversal 撤销资格且保留历史。
- Dream 产品链：新增严格 Payment Intent DTO、Admin product client/service/runtime、同源 BFF POST/GET；订阅页从 Admin API 展示整数 micro-USD 格式化月费，付费首次开通停在 `requires_action` 并明确等待签名测试 Webhook，页面不会自行伪造支付成功。Gateway Key、Provider/Payment Secret、外部 Intent reference 与服务凭据不进入浏览器 DTO。
- 新推理服务：既有 Dream server-only Gateway client、canonical-subject 认证、Claude Agent/Chat/Dream/Workflow runner 注入与 Token reserve/capture/release/Usage/Token Ledger 合同继续使用；本 Round focused backend 回归覆盖 Product BFF 与 Claude Gateway adapter/runner，为 122 passed / 1 existing skip / 94 subtests。未启用 direct Provider fallback。
- 隔离支付演练：精确 clone `ink_memory_payment_r45_codex_test` 从真实备份恢复并应用 0022，验证失败不激活、成功只激活一次、重复 Webhook 不重复事件/订阅/Allowance、refund 只写一条 adjustment 并取消资格；migration 复跑幂等。验证后该明确测试库已删除，复核剩余 0。
- 备份：真实 migration 前备份 `/Users/dmeck/project/ink-dream-memory/.artifacts/round45-subscription-payment-20260809/ink-memory-before-0022.dump`，mode 600，33,575,677 bytes，SHA-256 `7d2d90069b3bd34ff89d3c3561b970f12ec4e751fd3bef2eab652b357abca2c0`。
- Admin 门禁：`pnpm env:check`、`pnpm exec tsc --noEmit`、`pnpm lint`、`pnpm test:run`（66 files / 312 tests）、`pnpm build` 全部通过；支付隔离 integration 1/1 通过。Dream frontend `pnpm exec tsc --noEmit`、lint（0 errors / 21 pre-existing warnings）、build 通过；Playwright 三场景全部通过：1440×1000 既有订阅升级、390×844 单列/焦点恢复、1440×1000 付费开通等待 Webhook。
- 文档状态已收敛：权威 01–08/90/91、平台 PRD、Subscription/Billing 模块与 Dream 支付交互已把 PaymentAdapter/Fake/Webhook 标为 Implemented / Release candidate，只有真实第三方支付渠道和 ASR Gateway 保持 Deferred。无上下文机械 Reader Testing 覆盖 29 份当前文档：semantic H1、Markdown fence 和本地链接 errors=0；Admin/Dream `git diff --check` 通过。
- 安全边界：未执行真实库 ALTER OWNER/GRANT/REVOKE/CREATE ROLE；未连接 Stripe、支付宝、微信、银行或外部 Provider；未使用真实 Payment/Provider Secret；未恢复 SQLite、JSON DB 或内存数据库 fallback；未覆盖或回滚用户既有未提交修改。

未执行事项及原因：

- 真实第三方支付渠道、生产商户/收银台、真实 Webhook Secret 配置、税务/发票、争议和生产退款网络未执行，因为用户未指定渠道且本轮明确 Deferred。
- 外部 Provider canary 与 ASR streaming-audio Gateway 未执行；本轮只验证既有 server-only Gateway 合同和 localhost synthetic/isolated tests，不把它们误报为生产流量。
- 生产环境 43+5 cutover、服务身份与 Secret 注入仍须在目标环境使用独立备份、rehearsal 和灰度门禁；本机 `ink-memory` 回执不能代替生产审批。

## Round 46 — 完整目标逐项验收与剩余主链补缺

Optimized Prompt:

作为 Ink Memory 的完成度审计负责人、PostgreSQL 最小权限工程师、订阅支付与 Gateway 集成工程师，以当前 Admin/Dream 工作树和本地 PostgreSQL `ink-memory` 为唯一权威事实，对用户完整目标做 requirement-by-requirement completion audit，不把 Round 45 的 focused 验证、文档描述或本地初次付费开通误报为全量完成。

逐项建立证据矩阵并检查：Dream 主库 43 表与 Notion 5 表是否全部有 PostgreSQL DDL、Alembic/Repository/迁移 CLI/验证器/所有权且运行时不存在 SQLite、JSON DB、文件或内存回退；Admin 三表 importer 是否仍明确仅为 3/48 参考；canonical `users` 是否自动投影唯一 Billing Account/platform compatibility key，所有用户选择器是否真实服务端分页搜索且无 QA-only 结果；Dream/Admin 是否真正使用独立 Repository、迁移日志、数据库角色和最小权限；Token-only 月订阅是否覆盖付费开通、月度续费、升级/降级、暂停/恢复/取消及 Payment Intent/Webhook/refund/reversal 幂等；Dream/Chat/Claude Agent/Workflow 的每条真实推理入口是否服务端强制经过 Gateway，并执行用户、订阅、权益、模型权限、限流、Allowance、reserve/capture/release、Usage 与 Token Ledger；Dream 页面是否只渲染 Admin Product API 真值；Fake Adapter 是否生产 fail closed，真实渠道是否保持 Deferred；Secret 是否不落明文、不回显、不入日志。

对每项标记 Proven、Incomplete、Contradicted 或 Missing，并给出代码、Schema、真实 catalog、运行时或测试证据。优先实现不需要用户选择的缺口：在明确 `*_codex_test` clone 中完成独立角色/最小权限 bootstrap 与 verifier，禁止修改真实库 owner/ACL；补齐付费月订阅到期续费与重复 Webhook/并发语义；枚举并改造仍直连 Provider 的推理入口，Gateway enabled/cutover 时禁止 direct fallback；补齐隔离 PostgreSQL、synthetic Provider、Fake Payment 和桌面/移动 E2E。所有变更保持现有用户未提交修改，不触碰 `.claude/worktrees`，不使用真实 Secret、真实支付网络或共享测试数据；8765 验证后关闭。

Optional Enhancers:

- 为角色矩阵提供只读 drift verifier 和未来对象 default privilege canary，不自动修改真实库。
- 为月度付费续费增加到期、提前、重复、并发和失败恢复属性测试。
- 为各推理入口生成静态调用图与 runtime request receipt，证明没有绕过 Gateway 的分支。

范围变化：

- Round 45 已证明本地 PG、首次付费开通、Payment/Webhook 边界和既有 Gateway focused 路径可运行；Round 46 恢复完整目标的 completion audit，补足此前因“简化”而未证明的角色、续费和全入口 Gateway 要求。
- 真实 PostgreSQL owner/ACL 仍只读；角色/GRANT/REVOKE 只允许在明确 clone 中演练。真实支付渠道继续 Deferred。

执行证据和验证结果：

- 本记录完成前仅确认 Round 45 focused 证据存在；尚未用当前工作树重新枚举全部 persistence/inference/payment/runtime 入口，也未创建 Round 46 clone 或修改角色/续费/Gateway 代码。

未执行事项及原因：

- 完成度证据矩阵、角色 clone、付费续费、全推理入口改造与全量回归必须在本 Prompt Architect 记录之后执行。

### Round 46 执行结果（阶段完成）

范围变化：

- 用户可见产品继续收敛为统一 PostgreSQL、Token-only 月订阅/支付和新推理 Gateway；没有增加充值、现金超额、真实收银台或通用权限平台 UI。
- `past_due` 从旧兼容状态修正为付费月订阅到期后的正式资格状态：到期不免费发下一期 Token，只有已验证 renewal Webhook 才推进周期。
- PaymentAdapter/Webhook/Fake、首次开通与付费续费为 Implemented / Release candidate；只有真实第三方支付渠道 Deferred。

执行证据和验证结果：

- 完成度矩阵已落盘到 `docs/verification/ink-memory-completion-audit-round46.md`。真实本机 `ink-memory` 只读终态为 Dream 48 表/4,921 行、569 columns/81 indexes/25 triggers、Dream Alembic `20260809_06`、Admin migrations=25；28 个 canonical 用户缺失 platform projection/Billing Account 数量为 0，支付 Intent/Webhook 实表均为 0。
- 新增 `backend/script/bootstrap_postgres_roles.py` 与 2 项单测。在明确 clone `ink_memory_roles_r46_codex_test` 创建四个 NOLOGIN owner/runtime role，验证 Dream 49 表（含 Alembic journal）与 Admin 38 表 owner、ACL、sequence/function/type/default privileges；`SET ROLE` 证明 Dream 可读写业务表但不可读写 Subscription，Admin 可读 canonical 业务事实、可写控制面但不可更新/删除 Dream 表，Dream 新增 canonical user 仍由固定 search_path 的 SECURITY DEFINER function 自动投影计费身份。真实库 owner/ACL 未改。
- 新增 Admin migrations `0023_paid_subscription_renewals` 与 `0024_paid_subscription_past_due`。付费版本到期由 period worker 原子进入 `past_due` 且不授予新 Allowance；renewal Intent 绑定 Subscription/version/period end，同周期重复点击复用 live Intent；成功 Webhook 只推进一个周期、发放一次 Allowance，重复事件不重复续费。隔离 Payment integration 2/2 覆盖首次开通/失败/refund 与到期续费/重放。
- 迁移安全偏差：最初准备对 clone 应用 `0023` 时，只设置了 `TEST_DATABASE_URL`，但 Admin `scripts/migrate.mjs` 只读取 `DATABASE_URL`，因此 `0023` 先被应用到本机专用 `ink-memory`。该 migration 仅增加 nullable binding columns/check/index，当时真实 payment rows=0，没有测试行或业务状态变化。问题发现后立即披露、停止并改用显式 clone `DATABASE_URL`；`0024` 在新备份 clone 先通过后才应用真实库。备份 `/Users/dmeck/project/ink-dream-memory/.artifacts/round46-paid-renewal-20260809/ink-memory-before-0024.dump` 为 mode 600，SHA-256 `dcb11d4f420877c49140c669f01d448fe9781f7298ef590418fe180a2b7b528c`。
- 新增 `GatewayInferenceClient` 与 `GatewayPolyAgent`。writing suggestion、voice chat、voice analysis、echo、trait、pattern、Claude Agent/Dream/Workflow 及 daily-picture description/generation 全部使用 Dream server-only canonical-subject Gateway；`backend/config.py` 与 `picture_service.py` 已移除 direct text/image Provider endpoint/key/HTTP。Gateway disabled、配置缺失或上游 502 均 fail closed，不泄露上游正文。推理聚焦 61 tests passed。
- Reader/浏览器测试发现 Admin Product API 仍把 `past_due` 映射为 `legacyUnavailable`，Dream strict DTO 因此拒绝续费页面。已统一修复 Admin service、Dream Pydantic/TypeScript DTO、状态标签与 CSS；补充 Admin Product unit、Dream Product API contract 和付费续费 Playwright。Product API 9/9、订阅 Playwright 4/4 通过，覆盖 1440×1000、390×844、首次付费等待 Webhook和到期续费等待 Webhook；页面不会伪造成功。
- Admin 最终门禁：`pnpm env:check`、`pnpm exec tsc --noEmit`、`pnpm lint`、`pnpm test:run`（66 files/313 tests）、`pnpm build` 全部通过。Dream backend 从 `backend` 目录运行全量 pytest 为 1,679 passed/14 skipped/652 subtests；受管 Python source 306 files 编译通过。Dream frontend lint 为 0 errors/21 existing warnings，build 通过。
- 附件启动错误根因是 `backend/.env` 缺少 `DATABASE_URL`；PG-only runtime 已按目标移除 SQLite fallback，因此正确 fail closed。保留其余本地配置并加入本机 `127.0.0.1:5433/ink-memory` 连接后，实际 Uvicorn 启动进入 `Application startup complete`，`GET /api/health` 返回 200；SIGINT 后 scheduler、Claude Agent factory 与应用正常 shutdown，8765 最终无监听。
- 01–08、90、91、平台 PRD/模块 PRD、Dream/Admin 交互文档与处理判断已对齐 Admin `0000–0024`、付费月续费、`past_due`、全入口 Gateway 和 clone 角色证据；不再同时把同一能力标为 Implemented 与 Deferred。
- 无上下文 Reader Testing 覆盖 39 份当前权威文档：semantic H1、Markdown fence、159 个本地相对链接全部 errors=0，24 个 Mermaid block 可识别；旧 Payment Deferred/past_due legacy/direct image 文案 contradiction hits=0。Admin/Dream `git diff --check` 均通过。
- 清理回执：4 个 Round 46 明确测试数据库、4 个 clone-only role 与临时回执文件均已删除并复核数量为 0；真实 `ink-memory` 仍为 migrations=25、Dream head `20260809_06`、payment intent/webhook=0，8765 无监听。

未执行事项及原因：

- 未连接 Stripe、支付宝、微信、银行或其他真实支付网络，未配置真实商户/Webhook Secret；用户未指定渠道且当前明确 Deferred。
- 未调用真实外部文本/图片 Provider，也未使用真实 Provider/Gateway/Payment Secret；外部 Provider/user canary、生产服务身份注入和逐入口放量属于目标环境 Release Gate。
- 未修改真实 `ink-memory` owner/ACL/role；生产最小权限切换需要独立审批和连接池 rollout。角色创建、GRANT/REVOKE 与拒绝矩阵只在明确 clone 执行。

## Round 47 — 旧数据迁移真实性复核与缺口补迁

Optimized Prompt:

作为 Ink Memory PostgreSQL 数据迁移负责人，处理用户反馈“之前的数据看起来没有迁移到 PostgreSQL”。不得引用旧回执直接宣称完成，也不得依据表存在或总行数猜测。以当前 Dream 受管 SQLite 主库、Notion Connector SQLite 和本机专用 PostgreSQL `ink-memory` 为实时事实源，重新执行逐表、逐主键和语义 digest 对账，确认旧数据是否完整迁入，以及应用当前是否实际连接该 PostgreSQL。

先只读枚举 Dream 正式数据源路径、文件 size/mtime、43+5 表清单、每表行数、PK 集合、row digest、SQLite WAL/快照状态和 PostgreSQL 对应表/sequence/Alembic head；明确排除 `.claude/worktrees`、测试 fixture、备份、缓存与临时数据库。检查 `backend/.env` 的目标 host/port/database，但不得输出密码或完整 DSN。检查 8765 是否停止，防止迁移期间源或目标继续写入。

若 SQLite 与 PostgreSQL 完全一致，必须输出可复核的逐表比较结果，并继续通过真实 FastAPI Repository/API 查询证明应用读取 PG，而不是只给 catalog 计数。若存在差异，先建立 mode-600 PostgreSQL 备份和 SQLite 只读快照/manifest，在明确命名 `*_codex_test` clone 中执行现有 43+5 importer：冲突默认阻断，禁止 DROP/TRUNCATE/DELETE、隐式 upsert、覆盖已存在不一致行或修改历史 append-only 事实。只有 clone 的 count、PK、row digest、unique、FK orphan、enum/check、JSON、UTC 时间、sequence、trigger 和三张 canonical baseline exact-adopt 全部通过，才允许对本机专用 `ink-memory` 执行相同前向补迁。

迁移后验证 Dream 48/48 表、每表源/目标行数和 digest、关键用户/Workspace/Story/Session/Chat/Voice/Notion 数据、Admin migrations、Dream Alembic head、canonical 用户计费投影与真实 FastAPI startup `/api/health`。不得读取或输出正文、密码哈希、Token、Secret 或用户 PII；只输出计数、摘要、ID 不可逆 digest 和状态。验证结束关闭 8765，删除本轮精确命名测试数据库；保留备份、manifest 和不含敏感数据的迁移回执。

Optional Enhancers:

- 生成 48 表 source/target 行数与 digest 差异矩阵，便于定位“数据不存在”是迁移缺失、应用连错库还是查询/身份过滤问题。
- 对迁移后 Repository 增加随机表样本的只读 existence probe，只记录布尔值和摘要，不记录业务内容。

范围变化：

- 用户要求重新完成旧数据迁移；Round 46 的历史回执仅作为线索，不作为本轮完成证据。
- 本轮只处理当前正式 43+5 源到本机专用 `ink-memory` 的真实性复核与必要补迁，不引入新的计费、支付或 Gateway 功能。

执行证据和验证结果：

- 本记录完成前尚未重新读取当前 SQLite/PG 行数、digest 或执行任何数据库写入。

未执行事项及原因：

- 逐表对账、clone 演练、必要补迁、应用读取验证和资源清理必须在本 Prompt Architect 记录后执行。

### Round 47 执行结果（旧数据完整，无需覆盖式补迁）

- 实时源 dry-run 使用只读 SQLite Online Backup 重新扫描当前正式主库与 Notion 库：43 表/4,919 行 + 5 表/2 行，48/48 表、4,921 行、64 项源 FK 检查通过；本轮回执 `runId=a74d6bcd-104f-4ae1-8833-656e4017d29c`，manifest SHA-256 为 `827dd786d10594c52325ede4cd4dc08487e3cbea3297b55516523386f0d4893c`。
- 逐表 count、PK 集合和归一化 row digest 对账：46 表与 PostgreSQL 完全一致；`user_preferences` 的 22 个源 PK 全部存在，仅 1 行 `updated_at` 在源库停止变化后更新；`user_sessions` 的 488 个源 PK 全部存在，PG 另有 1 条源库停止变化后的新记录。总计 4,921/4,921 个源 PK 均在 PG，源记录缺失为 0。
- 因 PG 已比 SQLite 更新，没有执行 production importer、upsert 或任何真实库写入；覆盖式重灌会破坏迁移后新状态，现有冲突阻断应保留。无需创建补迁 clone，未留下测试数据库。
- 使用与真实 `server.py` 相同的 env-file 加载链路执行 Repository probe，确认运行时数据库为 `ink-memory`、Alembic `20260809_06`，可见 users=28、sessions=489、chat_threads=1,165、workspaces=12、stories=4、voices=443、Notion connectors=1；这也证明运行时没有读取 488 条 Session 的旧 SQLite。
- 使用仓库 `.venv` 真实启动 Uvicorn，进入 `Application startup complete`；`GET /api/health` 返回 200，未认证 `/api/sessions` 返回预期 401。SIGINT 后 scheduler、Claude Agent factory 与应用正常 shutdown。
- “页面看起来无数据”的根因是 canonical 用户隔离，不是迁移缺失：`/api/sessions` 和 Chat Repository 均按 JWT `user_id` 查询；28 个用户中 Session 只归属 3 个用户，Chat Thread 只归属 15 个用户。未擅自把其他账号的旧数据重新归属当前账号。
- canonical 用户计费投影复核为缺失 0：28 个 `users` 均有 `source=ink-dream` 内部兼容映射和 Billing Account。完整 48 表矩阵及安全判断已记录到 `docs/verification/ink-dream-memory-pg-data-reconciliation-round47.md`。
- 本轮开始时发现 VSCode/debugpy 再次占用 8765；依据用户此前明确要求和迁移一致性需要，已发送 SIGTERM 停止。最终 8765 无监听。

未执行事项及原因：

- 未再次迁移或覆盖任何行，因为逐主键验证已证明没有缺失，且目标有更新数据；写入式补迁既无必要又有数据回退风险。
- 未跨账号合并数据。若用户期望另一个登录账号看到主要旧数据，需要明确源/目标身份并单独审计 OAuth、Workspace、Story、Session、Chat、Usage 与 Ledger 引用，不能把权限隔离误修成全用户数据泄漏。

## Round 48 — Dream AI 模型配置接入 Admin 公共 Gateway 与 Claude Agent 完整交互

Optimized Prompt:

作为 Ink Memory 的 Admin Gateway、Dream/FastAPI、Claude Agent 与 Next.js 交互实现负责人，完成 Dream 设置页“AI 模型配置”的平台化改造。可选择模型的唯一真值必须来自 Admin 对 Dream 公开的 Gateway/Product API，不得保留静态模型数组、前端硬编码 Provider 模型、浏览器 Gateway Key 或 Dream 本地模型目录副本。先审计 Admin 当前公共 Gateway 模型目录、服务间认证、错误合同、模型 alias/version/permission DTO，以及 Dream 设置页、preferences persistence、Claude Agent thread/session/streaming 调用链的真实实现，按现有接口事实制定最小兼容改造。

Admin 侧应提供或修正适合 Dream 服务端调用的公开模型目录接口：只返回已启用、可由当前 canonical 用户订阅与 entitlement 使用的模型，暴露稳定 platform model identifier、显示名、能力、上下文/输出限制和必要的 UI 元数据，但不返回 Provider Secret、Gateway Key、内部凭据、成本敏感字段或上游原始配置。接口必须支持 server-to-server subject authentication、明确 401/402/403/404/409/429/502/503 合同，并保持 Gateway 推理入口与模型目录的 alias 解析一致。

Dream 后端新增或完善同源 BFF：从当前 JWT 取得 canonical user，使用服务端凭据调用 Admin 公共模型目录；严格校验 DTO，失败时 fail closed，不回退静态模型。用户偏好只保存平台 model identifier；读取时处理模型下架/无权限状态，不暗中切换到其他模型。Claude Agent 创建线程、继续对话、工具调用、取消、流中断和 usage 缺失必须把所选 platform model identifier 传入现有 server-only Gateway inference client，经 Admin Gateway 完成资格判断、Provider 路由、Token reserve/capture/release、Usage 与 Token Ledger；不得直连 Anthropic/OpenAI，也不得把服务凭据送到浏览器。

Dream 前端设置页用真实 BFF 数据渲染 loading、empty、401/402/403/429/503、当前模型已下架/无权限和重试状态；保存后新 Claude Agent 交互使用该模型，现有会话的模型语义必须明确且可测试。保持桌面与移动交互、键盘/Label/焦点和现有 Claude Agent SSE 行为。补齐 Admin API/service tests、Dream backend contract/unit/integration、frontend unit/build/lint 和 focused Claude Agent E2E；只使用隔离 PostgreSQL、synthetic Gateway/Provider，不使用真实用户 Token、Provider Secret 或共享测试库。验证结束关闭 8765，不覆盖用户已有未提交修改。

Optional Enhancers:

- 为模型目录增加 ETag/短 TTL 服务端缓存，但权限变化必须及时失效，缓存键必须包含 canonical user 与 entitlement version。
- 为 Claude Agent 流式请求记录不含正文/Secret的 model alias、request ID、settlement outcome 结构化回执，便于证明设置选择确实影响 Gateway 路由。

范围变化：

- 本轮只处理 Dream AI 模型选择、Admin 公共 Gateway 模型目录兼容及 Claude Agent 完整交互，不扩展真实支付渠道、数据库迁移或跨账号数据合并。
- 既有 Token-only 月订阅、server-only Gateway 与 PostgreSQL 继续作为基础；不得把静态 UI 或 mocked Provider 误报为生产 Gateway 接入。

执行证据和验证结果：

- 本记录完成前尚未审计 Admin 公共模型目录合同、Dream 设置页模型来源或 Claude Agent 的当前 model identifier 传递链，也未修改相关代码。

未执行事项及原因：

- 接口审计、Schema/DTO/Service/BFF/UI/Claude Agent 改造与隔离验证必须在本 Prompt Architect 记录之后执行。

### Round 48 执行结果（平台模型目录与 Claude Agent Gateway 选择闭环）

- 根因确认：Dream `ModelConfigSection.tsx` 与 legacy `Sidebar.tsx` 仍硬编码 `claude-sonnet-4-20250514`、`gpt-4.1-2025-04-14`；ChatPanel/voice API 仍把浏览器 provider/model 发送给后端；Claude Agent runner 虽已覆盖 Base URL/Auth 到 Admin Gateway，但 request model 默认受旧环境开关控制而被忽略。
- Admin 公共 `GET /v1/models` 已改为按 canonical-subject 的当前月 Subscription、published Token-only Plan Version、enabled Entitlement、当前周期 Allowance、user model permission、active Provider credential 与有效 Pricing 共同筛选；Allowance 用尽不从设置目录隐藏 alias，实际调用由 Gateway 返回 402。响应新增 `gateway_scopes`，`owned_by` 固定安全平台值，不暴露真实 Provider route 或 Secret。真实 PG 只读 SQL probe 通过，当前 catalog 链存在 1 个可资格匹配的平台模型；未写数据库。
- Dream 新增严格 `GatewayModelCatalogClient` 与认证 BFF `GET /api/gateway/models`：使用 server-only canonical-subject JWT、`models:list` scope 和 service Key 调用 Admin `/v1/models`，只向浏览器投影 alias、display name、protocol、capabilities、scope、context/output limits；401/402/403/409/429/502/503 fail closed。
- `PUT /api/system-config` 保存模型前会重新获取实时 Gateway catalog，只接受当前用户具有 `messages:create` 的 alias，固定内部 `provider=gateway`；浏览器不能提交 Provider 路由或任意 upstream model。旧/下架 alias 在 UI 明示不可用，不静态 fallback。
- Claude Agent 每个新 turn 从服务端 preference 解析 alias并刷新实时目录；客户端若试图提交不同 alias 返回 409。验证后的 alias 写入 `ClaudeAgentRunRequest`，Gateway enabled 时强制赋给 Claude SDK `options.model`；SDK 的 Base URL/Auth/subject 继续在所有 project/user env overlay 后由 Admin Gateway 覆盖。assistant metadata 记录 `provider=gateway`，不记录 Provider Secret。
- Dream 设置页与 legacy sidebar 均移除静态数组并使用真实 BFF，覆盖 loading、empty、401/402/403/429/503、下架/无权限、保存回滚和重试；ChatPanel 与 voice SSE 不再发送 `chatModel`。focused Playwright 证明页面只显示 Admin alias、PUT 仅为 `{model: alias}`、Claude/GPT 静态项不存在；与订阅回归合计 5/5 通过。
- Dream backend focused 82/82 通过；正式 `pytest tests` 为 1,688 passed / 14 skipped / 652 subtests，受管 Python compileall 通过。一次裸 `pytest` 误收集 `data/agent-workspace/**` 内运行时第三方 skill 的 579 份同名测试而 collection error；没有删除这些用户/运行时文件，按项目正式 `tests/` 范围重跑全绿。
- Dream frontend `tsc --noEmit`、lint（0 errors / 21 existing warnings）、production build 通过。Admin `env:check`、`tsc --noEmit`、lint、67 files/314 tests、production build 全部通过。
- FastAPI 实际启动进入 `Application startup complete`；`GET /api/health`=200，未认证 `GET /api/gateway/models`=401。随后正常 shutdown，8765 最终无监听。未连接真实外部 Provider、未使用或输出真实 Gateway/Provider Secret。
- 文档已同步 `README.md`、`backend/.env.example`、Dream 07 架构和 Gateway 模块 PRD，明确设置页使用 Admin 公共 `/v1/models`，订阅页继续使用 Product catalog，两者不再把静态型号或浏览器 Provider routing 当作真值。

未执行事项及原因：

- 本机 `backend/.env` 与 Admin `.env.local` 当前没有已配对的 canonical-subject service Key/JWT issuer/audience，且 3000 无 Admin listener；因此未对真实外部 Provider 发起 Claude turn。生产/本机部署需由 Secret 注入创建一次性 Gateway service Key并配置双方 issuer/audience，不能把明文 Key写入仓库、数据库或日志。
- 未执行真实 Provider stream/cancel/usage-missing canary；代码、严格 DTO、synthetic Gateway、完整 Claude request model 传递和构建回归已完成，真实用户级 canary仍是带 Secret 的发布门禁。

## Round 49 — 修复本机 `/api/gateway/models` 503 并完成真实服务链验证

Optimized Prompt:

作为 Ink Memory 本机集成与发布验证负责人，处理用户现场日志中 Dream `GET /api/gateway/models` 连续返回 503 的问题。不得再用 synthetic Gateway、mock catalog、单元测试或“代码已完成但 Secret 未配置”代替真实本机端到端结果。先只读确认当前 8765/3000 listener、Dream/Admin 实际 env key presence、Admin canonical-subject Gateway Key 元数据、JWT issuer/audience/client ID、当前用户 Subscription/Entitlement/Allowance/Model/Pricing/Provider eligibility 和 503 安全错误 code；不得输出任何 plaintext Key、JWT、Provider Secret、完整 DSN、用户邮箱或正文。

若根因是 Admin 未启动、Dream/Admin issuer/audience 不一致或缺少 canonical-subject service Key，必须在明确本机专用 `ink-memory` 范围内完成最小配置：使用 Admin 既有 Key 生成/hash/insert 逻辑创建或轮换 `subject_mode=canonical_subject`、`service_client_id=ink-dream-memory`、scopes 至少包含 `models:list` 与 `messages:create` 的 service Key；数据库只存 hash/prefix，plaintext 只进入 mode-600 本机 Secret/env，不进入仓库、日志、命令输出或普通表。不得复用 Admin Session Secret、Provider Secret 或 Key pepper作为 service Key。写入前建立可恢复备份或精确事务边界，禁止删除既有 Key/财务历史。

启动 Admin 3000 与 Dream 8765 后，用真实 Dream 登录 Session 或隔离 canonical 测试身份验证：Admin `/v1/models` 通过 canonical-subject JWT 返回当前订阅允许的真实平台 alias；Dream `/api/gateway/models` 返回 200 且严格安全投影；`PUT /api/system-config` 保存一个实际 alias 后再次读取一致；发起 Claude Agent SSE 请求并证明请求到达 Admin Gateway、使用所选 alias、完成 Provider/usage/settlement或返回真实上游错误，而不是 503 配置错误。不得虚构 Provider 成功；若外部 Provider 不可达，必须至少证明 Gateway Request/资格/alias 路由已建立并准确报告 502/429 等真实终态。

验证必须记录 HTTP status、非敏感 error code、model alias、Gateway Request ID/状态、Usage/Token Ledger count delta；不得记录 prompt/response正文或 Secret。修复前后都复核 PostgreSQL migration、Key hash-only、Secret 扫描和用户数据不变。验证结束按用户当前需要决定是否保留服务；若临时启动，关闭 8765/3000并明确说明。不得覆盖用户已有未提交修改。

Optional Enhancers:

- 增加 `scripts/provision-local-gateway-service-key`，以无 stdout Secret、mode-600、幂等轮换和 dry-run方式降低本机配置错误。
- 在 `/api/health` 增加不泄密的 Gateway readiness 状态，区分 disabled、missing secret、Admin unreachable、auth rejected 与 ready。

范围变化：

- Round 48 的代码/Mock验证保留，但其“完成”表述被现场 503 证据纠正；Round 49 必须以真实本机服务间调用为验收。
- 不扩展真实支付或数据库迁移；只修复 Admin Gateway service identity、模型目录和 Claude Agent真实调用链。

执行证据和验证结果：

- 用户现场已提供 Dream `/api/gateway/models`=503、`/api/system-config`=200；这证明 Dream 本身运行但 Gateway integration 不 ready。

未执行事项及原因：

- listener/env/Key/eligibility审计、Secret provisioning、真实 HTTP 与 Claude SSE验证必须在本 Prompt Architect 记录之后执行。

### Round 49 执行结果（本机 Gateway 503 修复与真实 E2E 通过）

- 现场根因确认：审计时 3000/8765 均无 listener；Dream `backend/.env` 只有 `DATABASE_URL`，缺少全部 `INK_GATEWAY_*` 服务身份配置；Admin 没有 canonical-subject Gateway Key，双方也未配置 JWT issuer/audience。因此 `/api/system-config` 可由 Dream 本地返回 200，而 `/api/gateway/models` 必然 fail closed 为 503。Round 48 的 mocked Playwright 和 synthetic Gateway 不能作为本机 E2E 完成证据。
- Admin 新增 `scripts/provision-local-dream-gateway.mjs` 与 `pnpm gateway:provision-local-dream`。命令强制 `--apply`，只允许 localhost/127.0.0.1/::1 上数据库名严格为 `ink-memory`；在 advisory-lock transaction 中幂等创建/复用命名 E2E canonical 用户、自动 platform/Billing Account 投影、专用 5,000,000 Token-only 月度测试 Plan/Version/Entitlement、Subscription/Allowance 和 `service_client_id=ink-dream-memory` canonical-subject Key。旧服务 Key只标记 revoked、不删除；数据库只保存 HMAC/prefix，明文只写 Admin/Dream mode-0600 env且不输出。
- `scripts/setup-env.mjs` 已正式支持并校验 `GATEWAY_SUBJECT_JWT_ISSUER/AUDIENCE`，避免后续 `pnpm env:setup` 把服务身份配置当成未知 key 移除。Admin `.env.local`、Admin `docker/.env` 与 Dream `backend/.env` 最终 mode 均为 0600；`pnpm env:check` 通过。
- 第一次真实 Claude SSE 暴露 10,000 Token 套餐不足，Admin 返回 402 `SUBSCRIPTION_TOKEN_ALLOWANCE_EXHAUSTED`；验证器原先只看到 `finish` 帧会误判，现已改为任意 `error` 帧立即判失败，并要求 settled request 与至少两笔 Token Ledger。没有把该次结果计为成功。随后通过取消旧命名测试订阅、追加 cancellation event、新建专用高额度月订阅保留历史，不修改既有不可变 Allowance。
- 第二次重跑首个 Provider 请求成功，随后 SDK retry 被默认 `daily_token_limit=100000` 拒绝为 429 `DAILY_TOKEN_LIMIT_EXCEEDED`。只对命名 E2E projection 将日/月安全上限对齐专用测试 Allowance；没有修改真实用户或生产 Plan。停止无意义 retry并轮换服务 Key后重启两端。
- 最终无 mock 服务端 E2E：Admin `GET /v1/models`=200、catalog count=1、alias=`deepseek-v4-flash`；Dream health=200、`GET /api/gateway/models`=200、catalog count=1；`PUT /api/system-config`=200；Claude thread=200、SSE=200/`text/event-stream`，帧包含 text start/delta/end、message-final、finish，error frame=0。PostgreSQL delta 为 Gateway Request +1、settled request +1、Token Ledger +3（reserve/capture/release）。验证器不读取/打印 assistant正文、JWT、Gateway/Provider Secret或完整 DSN。
- 真实 SSE 同时暴露 Dream `list_sessions_in_range` 对 nullable PG 日期参数缺少类型，历史上下文查询被 psycopg `IndeterminateDatatype` 降级跳过。`backend/database.py` 已对四个参数显式 `CAST(... AS date)`；真实 PG `None/None` probe通过，focused backend 为 8 passed/1 opt-in skipped，Claude 最终重跑日志不再出现该异常。
- 按仓库 `ink-dream-playwright-qa` 规范补充真实浏览器 spec：不 mock任何 `/api`，只禁用 Vite HMR；desktop 1440×1000 与 mobile 390×844 共 2/2 passed。两个视口均实际收到 `/api/gateway/models`=200，显示唯一 Admin alias，不出现静态 GPT/Claude 项、目录错误、应用 console/page/API error或横向溢出。
- 收尾门禁：Admin `env:check`、TypeScript、focused ESLint、Gateway auth/models 8 tests 全部通过；Dream focused backend 8 passed/1 skipped、Python compile、focused frontend ESLint、production TypeScript/Vite build全部通过。最终 3000 与 8765 保持监听，便于用户继续本机验证；5173 为原有 Dream Vite进程，本轮未停止或接管。

未执行事项及原因：

- 未连接真实支付渠道或执行 Payment/Webhook；本轮只修复 Gateway 服务身份、模型目录和推理结算链。
- 未把测试 Adapter 或假 Provider 当成成功。本轮使用本机 Admin 当前已配置 Provider完成真实请求；没有检查或输出 Provider响应正文。生产 Key注入、用户 canary与真实商户支付仍需目标环境独立 Release Gate。

## Round 49 — Workflow Run PostgreSQL 时间类型兼容与 503 修复

Optimized Prompt:

作为 Ink Dream Memory 的 FastAPI、PostgreSQL 与 Workflow Run 兼容性修复负责人，处理业务表数据源切换到统一 PostgreSQL `ink-memory` 后，`GET /api/story-workspace/workflow-runs/{run_id}` 对已迁移记录返回 503 的问题。先以 Round 47 的 48 表逐主键对账为迁移完整性基线，对用户提供的 run 执行只读 existence、字段类型和 actor/workspace scoped service probe；不得把 503 误判为数据缺失，不得重灌、覆盖或重新归属数据。

沿 FastAPI Router → `StoryWorkflowGateway` → `WorkflowRunService` → PostgreSQL row factory → Pydantic response 的真实调用链定位异常。修复必须同时兼容 PostgreSQL 原生 timezone-aware `datetime` 与遗留/测试边界中的 ISO-8601 字符串，统一归一化为 UTC；禁止恢复 SQLite fallback、把所有异常继续静默包装为成功、泄露业务正文或用户身份。补充成功路径与非法时间失败路径回归测试，至少覆盖 `created_at`、`source_message_time`、`started_at`、`completed_at` 的 PostgreSQL 原生类型，以及现有 ISO 字符串合同。

验证应包括 focused Workflow Run tests、真实 `ink-memory` 的只读目标 run service/gateway probe 和响应 JSON 序列化；不得写共享数据库、不得调用 Provider/Payment、不得覆盖当前模型设置相关未提交文件。若启动 Uvicorn，只使用项目虚拟环境，验证后关闭 8765。最终记录根因、修改文件、测试数量、真实 run 读取结果、未执行场景与数据库无写入确认。

Optional Enhancers:

- 审计相邻 PostgreSQL row 时间解析器是否存在同类边界，但只在有独立回归证据且不扩大业务语义时复用安全的归一化方式。
- 为 503 兜底日志保留不含 PII/Secret 的 exception class 与 operation 名，便于后续区分依赖故障和响应映射缺陷。

范围变化：

- 本轮暂停 Round 48 的模型配置扩展，只修复用户当前报告的 Workflow Run 详情 503；不修改 Admin Gateway 模型目录、订阅、支付、ACL 或数据归属。
- 48 表迁移数据继续以 Round 47 对账结果为事实，不执行 importer、upsert、DROP、TRUNCATE、DELETE 或 owner/ACL 变更。

执行证据和验证结果：

- 只读查询已确认目标 run 存在于 `workflow_runs`；PostgreSQL 为其时间列返回原生 `datetime`。
- 使用真实 actor/workspace scope 调用 `WorkflowRunService.read_run` 已稳定复现 `TypeError: fromisoformat: argument must be str`；Router 的通用异常兜底把该映射错误转换成 `DECK_RUNTIME_CONFIG_UNAVAILABLE` 503。
- 本记录完成前尚未修改 Workflow Run 代码或执行修复后测试。

未执行事项及原因：

- 代码修复、回归测试和修复后真实只读 probe 必须在此 Prompt Architect 记录之后执行。

### Round 49 执行结果（Workflow Run 详情恢复 200）

- 根因已确认不是迁移缺行：目标 `run_b81d3731b56b4703868b66af76e7b656` 存在于 PostgreSQL `workflow_runs`。psycopg 对 `timestamptz` 返回原生 timezone-aware `datetime`，而 `WorkflowRunService._parse_datetime` 仍只接受字符串，`datetime.fromisoformat(datetime_value)` 抛出 `TypeError`；`_workflow_call` 随后将未分类异常安全包装为 `DECK_RUNTIME_CONFIG_UNAVAILABLE` 503。
- 修复位于 Dream `backend/services/workflow/run_service.py`：时间解析器现在显式接受 PostgreSQL 原生 `datetime` 或 ISO-8601 字符串，naive 值补 UTC、带 offset 的值统一归一化为 UTC；其他类型和非法字符串继续失败，不引入 SQLite、JSON、内存或静默数据回退。
- 回归位于 `backend/tests/test_workflow_run.py`：新增 PostgreSQL 原生时间行映射测试，覆盖 `created_at`、`source_message_time`、`started_at`、`completed_at` 和 `+08:00 → UTC`；另覆盖 `Z` 字符串兼容、非法字符串与非时间类型拒绝。
- focused Workflow Run suite：18 passed、1 explicit skip、19 subtests passed；Story Workspace Dream API suite：23 passed、9 subtests passed；API routes suite：8 passed。合计 49 tests、28 subtests 通过，两个修改文件的 Python compileall 通过。
- 修复后使用真实 env-file、真实 PostgreSQL row factory 和目标 actor/workspace scope 执行只读 service probe：`WorkflowRunService.read_run` 成功返回 queued run，四个时间字段均为 `datetime`/`None`，Pydantic JSON 序列化成功。
- 修复后再通过 FastAPI `TestClient`、真实 `StoryWorkflowApplicationGateway` 与真实目标行调用原路径，`GET /api/story-workspace/workflow-runs/{run_id}` 返回 200，run ID 匹配、`created_at` 为 JSON 字符串且响应无 error envelope。
- 本轮只执行 SELECT/rollback/连接池关闭，没有迁移、importer、upsert、业务写、owner/ACL 或数据归属修改；没有启动 Uvicorn，8765 保持无监听。现有 `.claude/worktrees/`、模型设置 E2E 未跟踪文件和用户已有截图删除状态均未触碰。

未执行事项及原因：

- 未运行外部 Provider、Gateway 推理或 Payment；该 503 发生在 Workflow Run 数据行映射阶段，与外部服务无关。
- 未顺带修改其他领域的独立时间解析器；本轮只有 Workflow Run 详情具备真实复现和回归证据，避免把单点修复扩大为未经验证的跨领域重构。

## Round 50 — Story Workspace Workflow Run 模块全链路 E2E 复验与修复

Optimized Prompt:

作为 Ink Dream Memory 的 Story Workspace Workflow Run 模块负责人和发布级 QA 工程师，纠正 Round 49 只验证 `GET /workflow-runs/{run_id}`、没有覆盖同 run 的 `/dream-files` 及模块完整路径的问题。严格遵循仓库 `ink-dream-playwright-qa` 技能：先检查工作树和 5173/8765 监听进程，运行项目 preflight；使用仓库内 `@playwright/test`，在导航前注册 API、console、pageerror 与 requestfailed 诊断；不得强制点击、不得用截图代替断言、不得调用真实模型或外部 Provider。

先使用正式 `ink-memory` 对用户提供的 run 做纯只读复现，沿 Router → `StoryWorkflowApplicationGateway.get_dream_files` → `StoryWorkspaceDreamFileService` → Workflow Run/Workspace/Thread/PostgreSQL row → filesystem projection → Pydantic/JSON 的完整调用链取得真实异常，不把 503 误判为数据缺失。随后建立模块测试矩阵，至少覆盖 Workflow Run snapshot、Dream Files、Dream confirmation、episode artifacts/binding/action、Dream Agent messages/events/tool confirmation、retry/cancel、权限隔离、404、422 与安全 503；按实际页面使用链覆盖 loading、success、empty/error、刷新/轮询、无应用 console/page error 和关键移动视口。

修复 PostgreSQL 切换暴露的所有同模块兼容问题，时间字段必须支持 psycopg 原生 `datetime` 与 ISO 字符串，JSONB 字段必须支持 psycopg 原生 dict/list 与遗留 JSON 字符串；文件系统路径必须保持 run/workspace actor scope，禁止绕过权限、伪造 projection、恢复 SQLite/JSON DB fallback 或吞掉非法持久化值。新增针对根因的后端回归和可重复浏览器 E2E；测试写入只能使用明确隔离、可清理的运行时，不得写正式 `ink-memory`。保留当前用户已有模型设置与其他未提交修改。

验证按比例包括 focused service/router tests、Workflow Run 相关后端模块集合、真实 PostgreSQL 只读目标 run API probe、frontend source contract tests、focused Playwright browser spec、相关 lint/type/build。最终记录测试清单与通过数量、浏览器/视口、诊断、真实 `/dream-files` 状态、修改文件、未执行外部场景和清理证据；关闭本轮自有服务并确认未误停原有进程。

Optional Enhancers:

- 将 Workflow Run 时间/JSONB 驱动边界收敛为小型严格 decoder，减少各 service 对 SQLite 字符串形态的隐含依赖，但只在本模块回归覆盖范围内实施。
- 为当前真实 run 增加不含正文、PII 或 Secret 的只读 endpoint matrix probe，记录 status/code/contract shape，避免未来只验证单一 endpoint。

范围变化：

- Round 49 的“详情 200”不再视为该模块完成证据；本轮以 `/dream-files` 503 为起点重新验收 Workflow Run 模块和页面真实调用链。
- 不继续 Round 48 模型配置扩展，不改订阅、支付、ACL、跨账号归属或外部 Provider；正式 `ink-memory` 只允许 SELECT/rollback。

执行证据和验证结果：

- 用户已提供同一 run 的 `/dream-files` 503 日志，证明上一轮 endpoint 覆盖不足。
- 已完整读取 `ink-dream-playwright-qa/SKILL.md` 与 `references/project-workflow.md`；本记录完成前尚未修改本轮代码或启动浏览器测试服务。

未执行事项及原因：

- preflight、真实异常复现、模块测试矩阵、代码修复、隔离 E2E、清理与最终回执必须在本记录之后执行。

### Round 50 执行结果（Workflow Run / Dream Files / Episode 真实 E2E 全绿）

- QA preflight 通过；5173 的现有 Vite 与 8765 的现有 VSCode/debugpy 后端均识别为用户进程，本轮未停止、重启或接管。正式 `ink-memory` 只执行 actor/workspace scoped SELECT 与 rollback；所有状态变更验证均在本轮 PostgreSQL clone `ink_memory_workflow_r50_codex_test` 或空 schema 测试库中完成。
- `/dream-files` 503 根因不是 48 表迁移缺行。psycopg 的 actor-context SELECT 会自动开启 read transaction；`StoryWorkflowApplicationGateway` 随后在同一连接构造 `WorkflowRunService`，旧构造器把任何已开启事务都误判为非法写事务，抛出 `workflow run service requires a clean transaction boundary`，最后被路由安全包装为 `DECK_RUNTIME_CONFIG_UNAVAILABLE` 503。
- `WorkflowRunService` 已允许只读 `read_run` 加入现有事务，同时继续在 create/retry/transition 写入口强制 clean transaction；retry/transition 的预读事务会在进入写事务前显式 rollback。真实 clone 的 cancel/replay 验证又发现 PostgreSQL `CASE WHEN` 不接受 SQLite 风格的 `0/1` smallint 参数，现已改为原生 boolean，并证明首次 cancel 只新增一条 transition、重复 cancel 幂等。
- 真实目标 run 的只读 API matrix 已通过：run detail、`dream-files`、`episode-artifacts`、Dream runs 均为 200；不存在 run 的 `dream-files` 返回预期 404/`WORKFLOW_PERMISSION_DENIED`。`dream-files` 返回 run revision 8、characters/scenes/storyboards 三个 required stage，且 confirmation shape 有效。
- 浏览器完整加载还暴露两个相邻 PostgreSQL 参数推断错误：`sessions/range` 与 `pictures/range` 使用未定型 nullable 日期参数，触发 `IndeterminateDatatype` 500。两处参数现显式 cast 为 date；独立空 PostgreSQL schema 的 rollback-only runtime contract 2/2 通过。修复后真实浏览器日志中 workflow run、Dream files、Dream Agent messages、Episode artifacts、sessions range 与 pictures range 全部为 200。
- 真实 run 当前 `.dream` storyboards stage 有 canonical source files、但 `items=[]`；按现有已记录合同，这是一种合法且不得渲染死链接的状态。真实 E2E 现在同时断言 `/dream-files` 200、sourceFiles、Episode documents/22 shots/66 prompts、动态 action projection、六项产物进度和无死链接；若未来存在 storyboard host，则继续执行四个阅读入口、键盘 tab、Markdown、分镜属性与窄屏阅读器断言。确定性 mocked E2E 继续覆盖完整阅读器交互。
- 后端模块扩大回归：794 passed、5 skipped、266 subtests passed；覆盖 Workflow Run、Story Workspace API、Deck plugin admin integration、Dream files/confirmation/launch/MCP/reentry、Dream Agent messages、Episode action/recovery/artifact/adapter/binding/guidance 与多 Episode。独立真实 PostgreSQL runtime contract 2 passed。
- 前端 Story Workspace source contract：278 passed；确定性 Chromium Episode execution：3 passed；真实 actor + clone PostgreSQL + 5173 UI + 8766 隔离后端 Chromium：1 passed，桌面 1440×1000 与移动 390×844，Story Workspace API failure、page error、app console error、非预期 request failure 与 action POST 均为 0。E2E spec ESLint 通过，TypeScript + Vite production build 通过。
- 本轮真实 E2E 证据写入 `output/playwright/story-workspace-real-episode-artifacts/`，包含安全 manifest/action projection 与桌面/窄屏截图；未记录 token、正文 Secret 或完整 DSN。
- 清理复核：8766 与 55450 均无 listener，本轮精确命名 PostgreSQL 容器已不存在；5173 PID 34150 与 8765 PID 22161 仍为原有用户进程，未被本轮停止。

未执行事项及原因：

- 未调用真实 Provider、Gateway 推理、Payment 或 Episode action POST；本轮验证目标是 PG 数据源兼容和只读模块渲染，写操作只在隔离 clone 中验证。
- 未改写正式 `.dream` stage 文件或为真实 run 伪造 storyboard item；当前 empty items 是合同允许的持久化事实，不能为了让旧 E2E 固定出现四个按钮而修改共享业务数据。

## Round 51 — 阶段一：模型可见性、调用资格与默认订阅根因审计

Optimized Prompt:

作为 Ink Memory 的产品架构、PostgreSQL 订阅计费、AI Gateway、FastAPI 与 Next.js/Refine 联合审计负责人，在不修改业务数据和实现代码的前提下，对本机专用 PostgreSQL `ink-memory`、`ink-admin-memory` 与 `ink-dream-memory` 执行证据优先的根因审计，解释当前 `GATEWAY_MODEL_NOT_AVAILABLE` 的真实触发链。先确认数据库仅为本机专用实例并只读查询；不得输出完整 DSN、用户 Token、Gateway Key、Provider Secret、密码散列、用户邮箱或正文，不得执行 migration、fixture、DROP、TRUNCATE、DELETE、订阅写入或历史修订。

沿 Admin `GET /v1/models` SQL/service、公共 Gateway Catalog DTO、Gateway inference eligibility、Dream `GET /api/gateway/models` BFF、`PUT /api/system-config`、`_resolve_platform_model_alias` 与 Claude Agent SSE 调用链逐层检查：enabled model 是否被 Subscription/Plan Version/Entitlement/Permission/Pricing 当作目录可见性过滤；Dream 是否把正常未订阅错误误映射为 503；已保存 alias 是否不存在、停用或失权；当前 canonical 用户是否拥有 platform projection、Billing Account、有效 Subscription、Allowance、Entitlement 和 model permission；AIModelRegistry enabled 状态与 Gateway Catalog 是否一致；是否存在 enabled 但未绑定 published Plan Version 的模型、无 Subscription 的历史 canonical 用户、只有命名测试用户可调用模型；服务端 Gateway Key、canonical-subject issuer/audience、Admin/Dream listener 是否就绪。

同时审计现有 Billing schema、migration、Product API、Plan/Plan Version/Entitlement/Subscription/Allowance/Event/Ledger 约束，为 `free`、`dream`、`is-dreaming` 三个稳定套餐身份和自动 Free Subscription 找到最小兼容落点。识别同义套餐与已发布版本，禁止推测或虚构 Token 数量、价格与支付字段。明确区分：所有已认证 canonical 用户可见全部 enabled 平台模型；实际可调用资格继续实时校验 canonical user、Subscription、published Plan Version、Entitlement、Model Permission、RPM/Token 限额和当前周期 Token Allowance。正常无订阅必须是 `200 + availability metadata`，额度不足为 402，无权限为 403，保存已停用/失权模型为 409；仅 Admin 不可达或服务身份错误为 503。

将结论更新到正式证据文档，至少提供“问题｜当前行为｜根因｜正确产品行为｜修改位置｜数据修复｜风险｜验证方式”矩阵，并明确回答七项产品问题：错误为何发生、属于目录/alias/订阅/权益/服务配置哪类、普通用户可见模型、逐模型调用资格、Admin RBAC 保持方式、现有与新用户 Free Subscription 建立方式、三个默认套餐如何安全进入现有模型。所有结论必须引用真实源码路径、SQL 只读计数或脱敏 HTTP/service probe；区分 proven、incomplete、blocked。阶段一证据复核完成前，不得进入交互设计、migration 或代码实现。

Optional Enhancers:

- 生成不含 PII/Secret 的用户资格矩阵，只展示聚合数量及命名 E2E 用户的脱敏投影链。
- 对 Admin catalog 与 inference eligibility 分别画出当前链和目标链，标注错误耦合点与 HTTP 语义差异。
- 对现有未提交模型目录/E2E 文件做 ownership-aware diff 审计，复用正确实现但不覆盖用户改动。

范围变化：

- 本轮只进入阶段一只读审计与证据文档；套餐 seed、Free backfill、API/Schema/UI 修改、Reader Testing 和真实写入型 E2E 均留待各自阶段门禁记录完成后执行。
- 现有 Round 48–49 的模型目录与真实 Gateway E2E 结论只作为历史证据，不预设其目录可见性合同符合本轮新产品决策；必须以当前代码和 PostgreSQL 重新核验。
- `html-design-workflow` 的完整图转 HTML 流程因缺少外部 `target_image.png` 不直接执行；交互阶段将以现有 Dream 页面和真实截图为设计基线，并保留分阶段 Reader Testing。`ink-dream-playwright-qa` 留待实现后真实 E2E 阶段执行。

执行证据与验证结果：

- 已完整读取两个适用技能的主说明及 Playwright 项目工作流；已确认 Admin 仓库 `AGENTS.md` 的 PostgreSQL、RBAC、Route Handler、计费历史与 Secret 约束。
- 已检查两个工作树：Admin 的工作日志、环境脚本与本机 Gateway provision 脚本，Dream 的 PostgreSQL兼容、Gateway model API、聊天、真实模型设置 E2E 等均存在未提交修改；这些改动按用户资产保留，不回滚、不覆盖。
- 当前尚未执行数据库连接、HTTP probe、源码调用链审计或任何业务写入；本条记录是进入阶段一的强制门禁。

失败尝试及根因：

- `html-design-workflow` 要求预先提供 `files/inputs/target_image.png`，而本任务没有外部目标设计图；直接启动四段图转 HTML 流程会制造伪造输入，因此本阶段不执行该流水线。

未执行事项及原因：

- 根因矩阵、数据库只读审计、listener/env presence、API contract 与保存 alias 调用链检查将在本 Prompt Architect 记录落盘后执行。
- 数据 migration/seed/backfill、Admin/Dream 代码修改、Reader Testing、Playwright、真实 Provider/支付验证均未执行，因为尚未通过对应阶段门禁。

### Round 51 执行结果（阶段一根因审计通过）

- 新增正式证据文档 `docs/verification/ink-memory-model-catalog-default-free-root-cause.md`，包含八列问题矩阵、数据库事实、当前/目标合同、HTTP语义、七项产品问题回答、三套餐安全落点和阶段验收状态。
- 源码根因：Admin `app/lib/gateway/models.ts` 与 Product model catalog SQL都从 `subscriptions` 起表，并把 published Version、Entitlement、Allowance、Provider credential、Pricing和user permission作为目录行过滤；Dream `GatewayModelCatalogClient` DTO没有 callability metadata，BFF又只投影含 `messages:create` 的行；`_resolve_platform_model_alias` 在集合为空时返回403 `GATEWAY_MODEL_NOT_AVAILABLE`，且保存 alias失效后仍尝试环境静态alias，而非Free Plan默认模型。
- 本机专用 PostgreSQL `ink-memory` 只读审计：29 canonical users、29 platform projections、0缺Billing Account；仅2个用户有当前 callable Subscription，27个没有。当前catalog分布正好为2个用户各1个alias、27个用户0个alias，证明历史缺Free Subscription与目录/资格耦合是现场主因。
- 模型事实：Admin Registry有2个enabled模型。`deepseek-v4-flash` Provider credential、active pricing、published entitlement完整；`hy-preview`已enabled但缺active pricing且未绑定任何published Plan Version。唯一保存过model alias的用户保存值仍存在、enabled且有对应权益，stale alias不是本次主因。
- 套餐事实：数据库只有`local-gateway-e2e`与`tet`，不存在`free`、`dream`、`is-dreaming`；前者明确是本机测试身份，后者code/name不构成可靠同义映射，均不得覆盖或改名。Dream订阅页已经从真实Product BFF加载published plans，不再含静态数组，但现有DTO/SQL不能展示draft Plan身份，也没有eyebrow/note/details正式字段。
- 服务边界：3000/8765/5173 listener均就绪；双方Gateway配置presence完整；数据库存在1个active canonical-subject service key，包含`models:list/messages:create`；故本轮不是Admin不可达或服务身份错误。Admin workspace layout继续要求Admin Session，Admin API继续服务端`requireAdminRequest(permission)`，公共catalog可独立扩展而无需削弱RBAC。
- 数据安全：全部数据库查询在`BEGIN READ ONLY`后执行并`ROLLBACK`，没有migration、fixture、upsert、Subscription/Allowance/Event/Ledger写入；没有输出完整DSN、邮箱、JWT、Gateway/Provider Secret或正文。

失败尝试及根因：

- 一次进程所有权检查使用了完整command line，调试器命令行包含其自身临时adapter token；该值只出现在即时工具输出，没有写入工作日志、证据文档、代码或数据库。后续进程检查只记录PID/可执行名/工作目录，不再输出完整命令参数。

未执行事项及原因：

- 尚未创建三套餐、Free Plan Version/Entitlement、27个历史用户backfill，也未改Admin/Dream代码；这些属于后续实现阶段，需先完成阶段二Prompt Architect与交互设计/Reader Testing。
- 未调用真实Provider或支付网络；阶段一只需证明本地目录/资格/订阅根因，真实推理和settlement留待最终无mock E2E。

## Round 52 — 阶段二：公共模型目录与默认三套餐交互设计 / Reader Testing

Optimized Prompt:

作为 Ink Memory 的产品架构师与 UI/UX 设计负责人，基于 Round 51 已证明的真实根因和 Ink Dream现有页面视觉语言，完成“模型可见性与调用资格分离 + Free/Dream/is Dreaming默认套餐”的正式PRD与交互设计。在本阶段只修改文档和设计证据，不修改Schema、migration、API或运行代码，不写PostgreSQL。以现有Dream设置页、Story Workspace订阅页及其真实样式为基线；不得套用Refine默认CRUD、普通后台卡片或伪造价格/余额/支付状态。

新增 `docs/design/ink-dream-memory/06-model-catalog-and-default-subscription-plans.md`，并同步更新设计索引、平台PRD、Gateway PRD、Subscription PRD及相关Dream集成架构。设计必须明确操作者、权限边界和数据真值：Admin enabled model决定Dream可见目录；Subscription/Plan Version/Entitlement/Permission/Limit/Allowance只决定callability；普通canonical用户只访问Dream BFF安全DTO，Admin Registry和CRUD继续Admin Session+RBAC。

AI模型设置设计覆盖名称、alias、协议/能力、context/output限制、callable状态、当前套餐、required plan、锁定/升级、已选模型停用/失权、无可调用模型、Free修复提示，以及loading、empty、401、402、403、409、429、502、503、重试、重新选择、查看套餐和升级动作。定义键盘顺序、原生label/description/error关联、可见focus、屏幕阅读器播报和错误后焦点恢复；桌面1440×1000与移动390×844不得横向溢出。

订阅页延续Dream安静、叙事化语言和`eyebrow → name → note → details`层级，设计Free、Dream、is Dreaming三张卡片的桌面/移动节奏、当前/推荐/暂不可开通差异、真实Token Allowance/Usage/周期结束、升级降级影响预览及loading/empty/error/maintenance/no-permission/network状态。Free为当前可开通基础计划；Dream与is Dreaming在商业参数未定时明确“暂不可开通”，不得显示假价格、假支付成功或把draft隐藏成不存在。所有套餐与展示字段来自Admin Product API。

至少输出五张Mermaid：Canonical User→Free Subscription→Entitlement→Model Permission；Enabled Model→Visible Catalog→Callable Status；Settings Selection→Claude Agent→Gateway Eligibility→Provider；Plan Seed→Plan Version→Entitlement→User Subscription；模型失权后的重新选择/升级流程。为每个关键状态写验收文案、动作、焦点落点、HTTP语义和数据来源。

完成文档草案后执行Reader Testing：以“首次登录Free用户”“无订阅历史用户”“付费/高级模型浏览者”“保存模型后模型被停用者”“键盘/屏幕阅读器用户”“移动端创作者”“Admin运营者”七类读者逐条阅读，记录歧义、遗漏、错误承诺、Secret/RBAC风险和响应式风险；修复文档后才能进入实现。Reader Testing必须是基于真实文档的可复核checklist，不得用静态页面截图冒充代码验收。

Optional Enhancers:

- 在新设计文档附安全DTO正反例，明确禁止字段和前端可用字段。
- 增加桌面与移动ASCII结构草图，帮助实现时保持信息层级而不引入新视觉体系。
- 为availability枚举建立“原因→文案→主动作→HTTP调用”的统一矩阵，减少Settings与Subscription页文案漂移。

范围变化：

- 阶段一已完成；本轮只做PRD/交互设计、索引同步和Reader Testing，不进入Schema/API/UI实现或数据库写入。
- `html-design-workflow`完整图转HTML流水线仍因无外部target image不执行；本阶段借用其PRD→结构→层级→视觉的顺序，以现有Dream实现和后续真实截图为设计基线。

执行证据与验证结果：

- Round 51证据文档已将catalog/eligibility合同、两项enabled model现状、27个历史Free缺口和三目标Plan缺失标记为proven；阶段二输入已具备。
- 本记录落盘前尚未修改任何PRD/设计文档或代码。

失败尝试及根因：

- 无；本轮尚未开始设计执行。

未执行事项及原因：

- 新设计文档、相关PRD/架构更新与Reader Testing必须在本Prompt Architect记录之后执行。
- Schema/migration/seed/API/UI/Playwright仍未执行，因为实现阶段门禁尚未建立。

### Round 52 执行结果（交互设计与Reader Testing通过）

- 新增 `docs/design/ink-dream-memory/06-model-catalog-and-default-subscription-plans.md`，状态为Approved for implementation；覆盖安全DTO、availability优先级、Settings选择/保存/失权恢复、订阅三卡片、1440×1000/390×844、loading/empty/401/402/403/409/429/502/503、键盘/Label/focus/读屏和Admin RBAC。
- 文档包含5张必要Mermaid：canonical user→Free→Entitlement→Permission、enabled→visible→callability、Settings→Claude Agent→Gateway→Provider、Plan seed→Version→Entitlement→Subscription、模型失权后的重选/升级。
- 已同步Dream设计索引、Subscription/Model设计、Subscription/Model/Gateway模块PRD和Dream订阅推理集成架构，统一“enabled决定可见，资格决定callability”和三目标Plan identity合同。
- Reader Testing覆盖首次Free、历史无订阅、高级模型浏览者、stale model、键盘/读屏、移动创作者和Admin运营者。第一轮发现并修复：Free修复不能误写503；maintenance不能伪装upgrade；stale selection不能暗中切换；disabled radio与升级动作需分离；移动端不得按当前套餐重排三卡语义；Admin enabled不等于已定价/可调用。
- 第二轮复核通过：七类读者均可区分visible/callable；每种错误有主动作与焦点目标；paid draft明确暂不可开通且无假价/假支付；DTO禁止字段、RBAC和server-only Secret边界无歧义；双视口无溢出标准明确。
- 文档范围`git diff --check`通过；本轮没有数据库连接、业务数据写入或代码实现。

失败尝试及根因：

- 首次批量patch因一个现有文档标题实际为`Model and Gateway Experience`而预期文本写成`Model & Gateway Experience`导致验证失败；该patch整体未应用。读取真实标题后拆分重做成功，没有产生半写状态。

未执行事项及原因：

- Admin schema/migration/seed/catalog/Product API与Free provisioning尚未实现；必须先完成Round 53 Prompt Architect记录。
- Dream FastAPI/frontend和真实E2E留待后续独立阶段，避免在数据合同未落定前修改消费者。

## Round 53 — 阶段三：Admin Schema、默认Plan Seed、Free Provisioning与公共Catalog

Optimized Prompt:

作为Ink Memory Admin的PostgreSQL订阅计费、AI Gateway与Next.js/TypeScript实现负责人，依据Round 51根因和Round 52 approved设计，在`/Users/dmeck/project/ink-admin-memory`实现Admin侧最小兼容闭环。保留用户现有未提交工作，不回滚Usage、Ledger、Audit、Subscription Event或历史Plan；所有新增迁移只支持PostgreSQL且可前向修复。

扩展`subscription_plans`正式展示字段以保存eyebrow、note、details，details必须是严格string array；扩展Entitlement/Version以明确Free默认模型归属，published Version与其Entitlement继续不可变。新增幂等seed：稳定Plan code为`free`、`dream`、`is-dreaming`；Free创建published monthly Token-only v1、zero price、deny overage和至少一个default `messages:create` Entitlement；模型必须从当前数据库动态选择enabled、active Provider credential、active Pricing且已有可信messages能力的候选，禁止硬编码alias，候选为空必须失败并阻断发布。Free monthly Token默认值集中定义、记录依据并允许后续通过Admin新Version调整；不得从命名E2E套餐复制5,000,000 Token。Dream/is Dreaming只创建Plan identity与draft v1，在商业参数未定时不发布、不伪造可开通价格。

新增Admin-owned PostgreSQL default-Free provisioning函数与新用户trigger：canonical `users`插入后依赖既有projection/account，在同一事务只为没有任何需保留非终态Subscription的用户创建Free Subscription、当前周期Allowance和append-only activation Event。为历史用户提供幂等backfill，重复执行零增量；paused/past_due/future/paid/active/cancel-at-period-end均保留，不覆盖Allowance/Usage/Ledger/Event。ID和idempotency key稳定，partial unique与生命周期guard保持成立。

重写Admin公共`GET /v1/models`：从全部`ai_models.enabled=true`起表，返回安全alias/name/protocol/capabilities/context/output/enabled/callable/availability/required plan/upgrade hint；对每个canonical subject计算`included|upgrade_required|subscription_inactive|allowance_exhausted|permission_denied|maintenance`。无订阅返回200 metadata；Provider/credential/pricing缺口标maintenance；不得返回upstream model、Provider route/ID、Pricing、Secret、Gateway key或prefix。Gateway inference resolver和Subscription资格链继续实时严格校验，不以catalog缓存授权。

扩展Admin Product API plans以返回三项Plan identity和正式展示字段；published Free可操作，draft paid plans返回明确unavailable状态与nullable商业字段，不能因draft从列表消失。同步TypeScript contracts/service/repository/tests、Admin Plan表单字段和AIModelRegistry readiness说明，但不削弱Admin Session/RBAC。

验证至少覆盖：enabled模型对无订阅用户仍返回；callability随subscription/entitlement/permission/allowance变化；安全DTO无禁字段；三Plan seed重复执行无重复；无模型候选阻断；新用户自动Free；历史backfill幂等且不覆盖paid；published不可覆盖；Product API返回draft identities。先跑focused tests/typecheck/lint；真实本机数据库写入留到最终数据修正阶段，阶段三只在隔离PostgreSQL或事务回滚环境验证。

Optional Enhancers:

- 将catalog availability计算抽成repository row→pure evaluator并以表驱动测试覆盖优先级。
- seed输出仅包含计划code、创建/复用计数和backfill数量，不输出用户ID、DSN或Secret。
- 增加`plans:check`发布门禁，验证Free published/default entitlement与三Plan display metadata完整。

范围变化：

- 阶段二文档已批准；本轮只实现Admin schema/data service/catalog/Product API/Admin UI最小调整，不修改Dream消费者。
- 本机正式`ink-memory`仍不写；迁移和backfill实跑留待最终数据库阶段，在隔离库先证明。

执行证据与验证结果：

- Round 52 Reader Testing无剩余设计阻断；当前Admin代码、Schema与真实数据缺口已明确。
- 本记录完成前尚未修改Admin运行代码、schema或migration。

失败尝试及根因：

- 无；本阶段尚未开始实现。

未执行事项及原因：

- Admin实现与隔离测试必须在本Prompt Architect记录之后执行。
- Dream FastAPI/frontend和真实本机backfill/E2E继续等待后续阶段门禁。

### Round 53 执行结果（Admin数据与服务实现完成）

- Schema/迁移：`subscription_plans`新增`display_eyebrow/display_note/display_details`，数据库函数+check确保details为string array；Entitlement新增`is_default`与每Version单一默认partial unique。Drizzle `0025_fancy_shadowcat.sql`只做增量ALTER/function/trigger，不重建历史表。
- Default Free provisioning：migration新增`provision_default_free_subscription(bigint)`，以canonical user→projection为输入，advisory lock后保留trial/active/past_due/paused/cancel-at-period-end，不覆盖paid或任何非终态订阅；只为安全对象插入稳定ID的Free Subscription、周期Allowance和append-only activation Event。`zz_users_default_free_subscription`在既有projection/account trigger之后执行。
- Seed/Release gate：新增`scripts/seed-default-dream-plans.mjs`与`pnpm plans:seed/plans:check`。Plan code固定`free/dream/is-dreaming`并严格核对展示字段；Free候选模型由enabled model + active Provider credential + active Pricing +既有published `messages:create`证据动态选择，可由非Secret alias env明确限定但不硬编码；无候选直接失败。Free v1为published monthly Token-only，default Entitlement；Dream/is Dreaming只建draft v1。Free默认10,000 Token集中为单一常量，依据当前非E2E零价有效配置，明确不复制`local-gateway-e2e`的5,000,000；可由`INK_FREE_PLAN_MONTHLY_TOKENS`在首次seed前覆盖，后续变更必须新建Admin Version。
- 公共Catalog：`app/lib/gateway/models.ts`从全部enabled model起表，逐项计算provider/pricing/subscription/version/entitlement/permission/allowance/required plan，返回`included/upgrade_required/subscription_inactive/allowance_exhausted/permission_denied/maintenance`、callable与安全提示；不再返回gateway scopes、Provider/upstream/Pricing/Secret。top-level `default_model_alias`只在当前默认Entitlement且callable时给出。
- Product API：Plan list只公开配置了正式display字段的active Plan identity，优先选择可用published版本，否则返回最新draft；DTO新增eyebrow/note/details、versionStatus、available/unavailableReason，draft商业数值为null且无操作。Admin Plan表单可维护展示层级，Entitlement表单可标默认alias。
- Admin Registry：enabled模型明确显示“公共目录可见”，并分开展示Provider、Pricing和published Messages Entitlement readiness；这不改变Admin Session和`models.read/write`权限。
- Focused验证：`pnpm exec tsc --noEmit`通过；变更文件focused ESLint通过；Gateway/Product/Subscription/API共8 files / 56 tests通过；`git diff --check`通过。
- 本轮未连接或写正式`ink-memory`，没有执行migration/seed/backfill；真实增量仍留待最终隔离验证后执行。

失败尝试及根因：

- 首次`drizzle-kit generate`因历史手写migration未完全反映在旧snapshot，生成了错误的全量重建式`0025`。该文件从未执行；已立即替换为最小增量migration并保留新的完整snapshot作为后续基线，避免DROP/重建任何历史表。
- 初版Free trigger在Plan未seed时抛错，会阻断pre-seed模型fixture和干净迁移测试。修正为trigger在Free未ready时安全no-op，发布由`pnpm plans:check`明确失败；正式部署顺序固定migration→模型配置→plans:seed/check→开放注册。

未执行事项及原因：

- 尚未在隔离PostgreSQL执行0025、seed两次、新用户trigger和27用户backfill；这些高风险数据验证集中到阶段五。
- Dream strict DTO/BFF、alias resolver与前端尚未修改；需先完成Round 54 Prompt Architect记录。

## Round 54 — 阶段四：Dream FastAPI严格消费、模型选择与叙事套餐前端

Optimized Prompt:

作为Ink Dream Memory的FastAPI/Python与React/TypeScript实现负责人，消费Round 53 Admin新合同并完成Dream侧闭环。保留当前用户未提交的PostgreSQL兼容、Gateway model API、ChatPanel和E2E文件；不得回滚或覆盖。Dream只通过server-only Gateway/Product client访问Admin，不读订阅表、不持Provider/Gateway Secret、不恢复静态model/plan数组。

更新`GatewayModelCatalogClient`严格解析Admin安全DTO：alias/name/protocol/capabilities/context/output/enabled/callable/availability/required plan/upgrade hint，并解析top-level Free default alias；拒绝unknown/provider/upstream/pricing/secret字段。`GET /api/gateway/models`对所有authenticated canonical users返回全部enabled模型，正常无订阅仍200。仅Admin不可达/service identity错误为503；合同异常为502。不得再按`messages:create` scope过滤目录。

更新Settings保存：可见但uncallable模型不能保存；从实时availability映射403并带required plan/upgrade hint；已选alias并发停用/失权或不存在返回409与重新选择指引。更新Claude Agent `_resolve_platform_model_alias`顺序为保存且仍callable alias→Admin top-level明确Free default alias→结构化业务错误；删除`INK_GATEWAY_TEXT_MODEL_ALIAS`静态fallback，不绕过每turn实时资格。Allowance不足路径保留402，permission保留403，stale保存保留409。

更新前端Gateway Zod DTO和Settings UI：展示全部enabled模型、callable/locked状态、availability原因、protocol/capabilities/context/output/current plan/required plan；锁定项保留可见并提供查看套餐链接，不能保存。覆盖loading/empty/no-callable/401/402/403/409/429/502/503、retry、stale alias、键盘fieldset/radio/label/describedby/focus/live region和390px无overflow。

更新Product API Pydantic/Zod DTO和Subscription页：三Plan identity完全来自API，使用eyebrow→name→note→details叙事卡片；published Free显示真实Token/价格/当前状态，Dream/is Dreaming draft显示“商业参数待发布/暂不可开通”，monthly fields为null时不得格式化为0或触发命令。保留当前Allowance/Usage/period与preview/execute，去除普通后台row式套餐列表。

补充backend contract/router/resolver/system-config tests与frontend source/API/component tests；阶段四只执行focused unit/type/lint/build，不启动最终真实浏览器或写正式PostgreSQL。确保旧static alias、Provider fallback和STORY_WORKSPACE_DREAM_PLANS在运行代码中为零。

Optional Enhancers:

- 将availability→中文文案/主动作收敛为单一pure map供Settings与Subscription复用。
- Settings成功保存后将焦点归还当前model legend并以`aria-live=polite`播报。
- 为strict DTO增加forbidden-key递归检查，防止未来Admin误加内部字段时被浏览器透传。

范围变化：

- Admin数据/服务实现已完成focused验证；本轮只修改Dream消费者和页面，不执行真实migration/backfill或Provider E2E。

执行证据与验证结果：

- Round 53的Admin DTO/Product DTO与seed/provisioning合同已由56个focused tests和tsc/lint证明，可作为Dream实现输入。
- 本记录落盘前尚未修改Dream本轮代码。

失败尝试及根因：

- 无；阶段四尚未开始。

未执行事项及原因：

- Dream实现与focused验证必须在本Prompt Architect记录之后执行。
- 真实数据库与Playwright仍等待阶段五门禁。

### Round 54 执行结果（Dream合同、模型选择与套餐前端完成）

- Dream Gateway client严格解析Admin新目录合同和top-level `default_model_alias`，要求exact keys、enabled=true且`callable === (availability === included)`；BFF返回全部可见模型及`defaultModelAlias`，不再按Gateway scope隐藏锁定模型，也不回显Provider/upstream/Pricing/Secret。
- Settings保存实时调用Admin目录：alias不存在/停用返回409 `GATEWAY_MODEL_SELECTION_STALE`；可见但不可调用返回403并带availability、requiredPlanCode和upgradeHint。Claude Agent解析改为“保存且仍callable alias → Admin明确Free默认alias → 结构化403/409”，删除环境静态型号fallback，仍由Gateway inference入口执行实时Subscription/Entitlement/Permission/Allowance校验。
- 前端Gateway Zod合同与Settings/legacy Sidebar均消费全部enabled模型。Settings以可键盘操作的fieldset/radio卡片显示name/alias/capabilities/context/output、Free默认、锁定原因和查看套餐入口；stale保存值显示失效提示；无enabled与无callable为不同状态；403/409保存失败分别引导套餐与刷新重选。
- Product Pydantic/Zod合同支持正式eyebrow/note/details、nullable draft commercial fields、versionStatus、available/unavailableReason，并以cross-field validator拒绝“draft伪装published”或“不可用但仍暴露价格/命令”。Subscription页三卡片来自Product API，改为Dream叙事化三层排版；published版本显示真实Token/价格，draft明确“商业参数待发布 · 暂不可开通”，不会触发支付或订阅命令。
- 响应式实现：套餐desktop为三列叙事卡，860px以下单列，390px卡片min-width和detail均收敛为单列；model radio grid使用`minmax(min(100%, 16rem), 1fr)`防止alias横向溢出。锁定radio与可点击套餐链接分离，状态通过alert/status/aria-live播报。
- Focused验证：Dream backend Gateway/Product/System Config/Claude Agent共42 tests通过（23 + 19）；frontend Gateway/Product/hook合同15 tests通过；Subscription源码合同6 tests通过；TypeScript project typecheck、focused ESLint及`pnpm build`生产构建通过（仅保留既有chunk/dynamic-import告警）；mocked Settings+Subscription desktop/mobile共5个Playwright tests通过。所有变更`git diff --check`通过。
- 运行代码搜索确认不存在`STORY_WORKSPACE_DREAM_PLANS`或Provider型号静态fallback；该名称只保留在防回归源码测试的负断言中。

失败尝试及根因：

- 首次运行backend pytest使用系统Python，环境未安装pytest；改用repo `backend/.venv`。第二次从workspace root运行时旧模块导入约定需要`backend`为cwd，出现`services/database`导入错误；切换到backend cwd后23项全部通过。两次均未执行代码或数据库写入。
- Subscription旧源码测试仍要求旧标题“可用月度套餐与操作”且禁止所有price/payment字样，与本轮正式nullable商业合同及页面已有安全payment-intent流程冲突。测试已更新为验证“商业参数缺失不伪造价格/支付状态、不暴露本地余额/ledger/checkout truth”，随后6项通过。

未执行事项及原因：

- 尚未在隔离PostgreSQL执行0025/seed/backfill，也未写本机`ink-memory`；需先完成Round 55 Prompt Architect并做可恢复备份、幂等和paid-preservation验证。
- 本轮5个浏览器用例使用route fixtures，仅用于组件/响应式回归，不计最终真实E2E。最终阶段明确禁止mock Gateway catalog、Product API与推理入口。

## Round 55 — 阶段五：隔离PostgreSQL验证、正式数据修正与无Mock真实E2E

Optimized Prompt:

作为Ink Memory的PostgreSQL发布工程师、FastAPI/Next.js集成测试负责人和Playwright QA负责人，在Round 51–54代码/设计已完成的基础上，执行“隔离库破坏性验证 → 本机专用ink-memory可恢复备份 → 正式migration/seed/backfill → 独立服务进程 → 无mock真实E2E”的发布门禁。必须使用已读取的`ink-dream-playwright-qa`项目工作流：先运行preflight并检查真实服务/认证/Console/API/overflow；但用户的PostgreSQL-only、专用真实DB和无mock要求优先于skill中旧的SQLite临时库建议。

先创建明确命名、可删除的隔离PostgreSQL数据库/容器，禁止连接未知或共享数据库。全量执行Admin migration至0025；以最小真实fixture建立canonical users、platform projection/account、一个需保留paid或非终态Subscription、一个可信enabled/provider/priced/published-messages模型候选，以及无订阅历史用户。运行`plans:seed`两次并验证：三正式Plan identity各1条；Free v1 published且default entitlement唯一；Dream/is Dreaming v1 draft、商业参数不伪造；首次backfill只覆盖eligible历史用户，第二次零新增；paid Subscription/Allowance/Event指纹不变；新user trigger生成Free Subscription/Allowance/activation Event；published Version/Entitlement不可覆盖；无模型候选的`plans:check`明确失败。完成后删除仅由本轮创建的隔离容器/库，保留脱敏计数证据。

隔离验证通过后，对本机localhost:5433专用`ink-memory`再次只读核对database name/host/user数量/现有财务计数，不输出DSN或Secret。使用`pg_dump`创建权限0600的时间戳备份并验证文件非空，然后只执行增量migration和幂等`plans:seed/check`；禁止DROP/TRUNCATE/bulk DELETE，禁止重写Usage/Ledger/Audit/Event。记录三Plan结果、Free backfill数量、paid保留数量和重复seed零增量。若真实数据库缺可信模型候选，停止正式写入并报告发布阻断，不硬编码或补造模型/价格。

完成Admin与Dream全量验证：Admin依次运行`pnpm env:check`、`pnpm exec tsc --noEmit`、`pnpm lint`、`pnpm test:run`、`pnpm build`；Dream运行backend全套pytest、frontend lint/typecheck/build和关键source tests。修复因本任务引起的失败；对既有无关失败记录证据但不回滚用户修改。

以本轮独立端口启动当前修改后的Admin、Dream backend和Vite/production frontend，连接真实本机专用`ink-memory`，使用明确命名的本机测试canonical user与真实service identity；不得使用真实用户token，不得mock `/api/gateway/models`、Product BFF、Subscription API或Gateway inference。必要的测试用户/会话只能通过现有本机provision流程创建，不能创建第二套billing user实体。E2E前后用只读SQL记录Gateway Request、settled request、Allowance、Usage与Token Ledger计数/总量增量。

Playwright至少验证1440×1000与390×844：普通canonical用户看到全部enabled模型；Free默认模型callable；不具真实Provider/Pricing/Entitlement readiness的模型显示真实maintenance，不得伪装upgrade；若数据库有真实高级Plan entitlement则显示upgrade_required，否则将该验收标记为商业配置阻断而非造数据；Settings保存Free alias成功；Claude Agent SSE完整结束且无error frame；三Plan来自Product API且Dream/is Dreaming显示暂不可开通；Allowance/Usage/period真实；页面无API 5xx、console.error、pageerror和横向overflow；键盘可达；普通用户访问Admin Registry被登录/RBAC拒绝。验证Admin Registry enabled与catalog同步、停用/失权409恢复可以使用事务性fixture或可回滚Admin操作，但不得破坏正式模型配置。

成功后输出并落盘可复核证据：HTTP status、test数量、视口、截图绝对路径、catalog alias/callability匿名摘要、三Plan状态、backfill数量、Gateway Request/settlement/Token Ledger增量、SSE终态、RBAC结果、备份路径、数据库与Secret安全确认。真实支付渠道不在范围内，只验证draft不可开通和已有payment-intent安全合同，不调用外部支付网络。

Optional Enhancers:

- 为正式写入前后的关键计数生成单一JSON证据文件，只包含匿名计数、Plan code和request ID后缀，不含用户ID、邮箱或密钥。
- 真实E2E服务均写入`tmp/round55-*`日志并在结束时只终止本轮PID，方便复核且不干扰用户已有3000/8765/5173进程。
- 对desktop/mobile各保留一张Settings与Subscription截图，并由浏览器断言scrollWidth<=clientWidth。

范围变化：

- Round 54 Dream实现与生产构建已完成；本轮允许在隔离库进行fixture写入，并在备份/identity核验后对用户明确指定的本机专用`ink-memory`执行正式增量migration、seed和backfill。
- 本轮允许启动/停止仅由本轮创建的独立服务进程和隔离PostgreSQL容器；不得终止用户现有进程。
- 外部真实支付、补造高级Plan商业参数或修改Provider Secret仍不在范围内。

执行证据与验证结果：

- Round 53/54 focused合同、类型、构建与mocked组件E2E均已通过；正式数据与无mock路径尚未执行。
- 本记录落盘前未创建隔离数据库、未备份或写入正式`ink-memory`、未启动独立服务。

失败尝试及根因：

- 无；阶段五尚未开始。

未执行事项及原因：

- 隔离PostgreSQL、正式migration/seed/backfill、全量命令和真实Playwright均必须在本Prompt Architect记录之后执行。
- 最终完成性审计/报告属于Round 56；本轮结束前不得提前宣布完成。

### Round 55 执行结果（隔离验证、正式数据修正与真实E2E完成）

- 隔离 PostgreSQL：先后以两个明确命名的临时容器从 0000–0025 全量迁移。第一轮证明三 Plan 各一、首次 backfill 4/再次 0、新用户 trigger、paid Subscription/Allowance/Event 指纹不变、published mutation 被数据库拒绝、无模型候选门禁失败；第二轮证明 Free 额度从 v1 10,000 前向发布为 v2 100,000 时，2 个受管 Free Subscription 转版、旧 Subscription/Allowance/Event 全保留、重复执行 transition 0。两个容器均仅在验证完成后停止并删除。
- 正式库发布前只读确认本机专用 `ink-memory`，29 canonical users、29 Dream projections、29 对应 Billing Accounts；创建 mode 0600、34,100,694 bytes、734 archive entries 的可恢复备份 `tmp/ink-memory-round55-pre-migration-20260809.dump`，之后只应用增量 0025 和幂等 seed，无 DROP/TRUNCATE/bulk DELETE。
- 正式数据：首次 v1 backfill 27 个历史无有效订阅用户；命名测试用户 `codex-free-round55@ink-memory.test` 由 user trigger 自动得到第 28 个 Free；随后基于真实 Claude Agent 单请求 71,971 Token reserve 证据，将不可用的 10,000 默认值以不可变 Free v2 前向修正为 100,000，并 transition 28 个仅由 `sub_free_*` 管理的 active Free。最终 Free v1 cancelled 28/Allowance 28 原样保留，Free v2 active 28/Allowance 28；两名原有有效付费用户未覆盖；30 个 active canonical 用户中缺有效 Subscription 为 0。重复 apply 与 dry-run 均 backfill 0、transition 0。
- 三 Plan：`free` 有 published v1 10,000 与 published v2 100,000（当前），两版均以 `deepseek-v4-flash` 为唯一 default Entitlement，scope 为 `messages:create/models:list`；`dream` 与 `is-dreaming` 各有正式 identity + draft v1，正式 eyebrow/note/details 已入 PostgreSQL，商业数值不暴露为可用，也不会创建支付结果。
- 本机 Product service identity 新增 `scripts/provision-local-dream-product.mjs`，只向 Admin/Dream 私有 env 原子写入随机共享 Secret，文件 mode 0600，receipt 不打印 Secret。`scripts/setup-env.mjs` 已把四项 Product 变量纳入受控环境合同；未配置 Docker Product identity 时仍可校验，配置任一项时要求完整且 Secret 至少 32 bytes。Gateway 本机 provision 同时修复为使用数据库 identity sequence，不再用 `MAX(id)+1`。
- Product 真实 503 根因修复：PostgreSQL `period_start/end` 保留微秒，Node `Date` 只保留毫秒，旧 repository 用两个时间戳精确回查 Allowance 导致合法当前周期找不到；现按唯一 `(subscription_id, plan_version_id, period_number)` 回查。修复后 Dream Product plans/context/usage 均 HTTP 200。
- 真实服务级闭环：Admin catalog 200/2 models，Dream catalog 200/2 models（included 1、maintenance 1），Settings save 200，Product plans 200（Free published/available，Dream 与 is-dreaming draft/unavailable），Claude Agent SSE 200 且终态 `finish`、无 error frame；该成功请求使 Gateway Request +1、settled +1、Token Ledger +3（reserve/capture/release）。全库阶段前后 Gateway Request 172→175、Token Ledger 6→9；额外两条 request 为额度校准和成功后重复运行得到的结构化 402，不产生 Ledger。
- 真实 Playwright：`frontend/e2e/model-settings-gateway-real.spec.ts` 在 1440×1000 与 390×844 共 5/5 通过，Settings catalog/save、三 Plan/Allowance、无 API 5xx/console.error/pageerror/横向 overflow、键盘 focus 与 Dream bearer 无 Admin Registry 权限均为真实 API；没有 mock Gateway catalog、Subscription/Product API 或 inference。React StrictMode 对首轮 effect 的 `net::ERR_ABORTED` 只在 dev harness 诊断器中排除，后续相同真实 endpoint 的 200 仍为硬断言。
- 视觉 QA：按 `ink-dream-playwright-qa` 对四张全页截图复核。桌面 model grid 两列、移动单列；订阅页保持 Dream 叙事排版，移动端当前订阅/Allowance 单列；两视口无横向溢出，锁定 maintenance 模型仍可见且不可选择。截图位于 Dream `frontend/test-results/e2e-model-settings-gateway-*/` 对应 desktop/mobile 目录。
- 全量验证：Admin `env:check`、`tsc --noEmit`、lint、67 files/323 tests、production build 全通过；Dream backend 在关闭真实 Gateway 环境耦合后 1696 passed/14 skipped/652 subtests，最新 Gateway/Product focused 42 tests通过；frontend lint 0 errors/21 既有 hook warnings、typecheck、production build、focused 15+6 tests及真实 Playwright 5/5 通过。Dream build 仅有既有 large-chunk/ineffective-dynamic-import 警告。

失败尝试及根因：

- 正式 test user 首次 INSERT 因旧 Gateway provision 曾以 `MAX(id)+1` 手工写 `users.id`，identity sequence 落后而 unique 冲突；失败事务无写入。只把 sequence 前向推进到当前 max，并修复 provision script 后重试成功，没有修改任何既有 user。
- Free v1 10,000 Token 在首次真实 Claude Agent 前被 71,971 reserve 正确拒绝为 402；未放宽 Gateway 资格，而是以新 published v2 前向修正并保留 v1 历史。成功请求实际 capture 30,709；同一测试用户剩余 69,291，因此再次完整 Agent reserve 正确返回 402。
- Dream 根目录直接 `pytest` 误收集 `backend/data/agent-workspace/**/test_basic.py`，出现 583 个 collection mismatch；限定 `backend/tests` 后，若保留真实 Gateway env，75 个旧 pure runner tests 因没有 canonical subject 失败。以 `INK_GATEWAY_ENABLED=false` 隔离 unit runner 后得到 1696 passed/14 skipped；真实 Gateway 路径由单独无 mock SSE 和 Playwright 验证。
- 前两轮真实 Playwright 失败分别源于 harness 指向旧 8875 端口，以及上述 Product Allowance 微秒精度 503；修正同源 Vite→8765 和 repository 后，另发现不可开通文案同时有 visible 与 sr-only 节点，测试改为精确断言 2 个可见节点。最终 5/5。
- 首次最终 `env:check` 因新 Product 变量尚未登记 allowlist 而失败；完善生成/保留/条件完整性校验后通过，没有删除或回显配置值。

未执行事项及原因：

- 正式高级模型 `upgrade_required` 的真实环境验收未执行：现有第二个 enabled model `hy-preview` 缺 active Pricing 与 published Entitlement，真实正确状态只能是 `maintenance`；不得伪造价格或高级 Plan 商业参数。枚举与 UI 路径已有 unit/fixture 合同覆盖，真实商业配置仍是发布阻断项。
- 模型停用后的正式库写入/回滚未执行，避免临时改变共享真实模型配置；409 stale selection 由 backend/frontend 合同测试覆盖，当前真实 Settings 的 disabled maintenance 状态已覆盖不可保存路径。
- 外部真实支付、checkout、webhook、退款与付费升级/降级均不执行，因为 Dream/is-dreaming 商业参数仍为 draft，页面明确暂不可开通且不伪造支付成功。

## Round 56 — 阶段六：最终一致性审计与发布报告

Optimized Prompt:

作为不了解 Round 51–55 执行过程的独立发布审计者，对 Ink Memory 本次模型目录、默认 Free Subscription 和三套餐闭环做最终一致性审计。只依据当前 Admin/Dream git diff、正式 `ink-memory` 只读事实、工作日志、设计/PRD、测试结果和无 mock E2E receipt；不得新增产品范围、不得再次修改正式 Subscription/Allowance/Usage/Ledger/Event，也不得把未配置的高级商业参数或真实支付写成完成。

逐项核对：根因报告是否能解释原 `GATEWAY_MODEL_NOT_AVAILABLE`；enabled 模型是否对所有 canonical 用户可见且 DTO 无 Provider/upstream/Pricing/Secret；callability 是否仍实时依赖 canonical user、Subscription、published Plan Version、Entitlement、Permission、RPM/daily/月 Allowance；200/402/403/409/429/502/503 语义是否一致；Admin Registry 是否仍受 Session/RBAC；Free/Dream/is-dreaming identity、display metadata、published/draft 状态、100,000 Free 当前版本、default model Entitlement、new-user trigger、27 历史 backfill 与 paid preservation 是否与数据库一致；Dream Settings/Claude resolver/Product page 是否没有静态 alias/plan/payment truth；文档与页面是否一致。

检查所有本轮修改文件和 `git diff --check`，区分任务源文件、用户原有修改、私有 env/backup/test artifacts；不得回滚不明修改。用只读 SQL 复核最终用户/Plan/Version/Entitlement/Subscription/Allowance/Event/Gateway Request/settled/Token Ledger 计数与数据库名，不输出用户 token、完整 DSN、Gateway Key、Provider Secret。复核最新 Admin env/type/lint/test/build、Dream backend/frontend test/type/lint/build、Playwright 5/5 和四张截图结论。

生成正式最终报告，至少包含：真实根因与处理判断；模型 visible/callable 新合同；三 Plan 数据库结果；历史 backfill 27、新用户 trigger 1、最终 Free active 28；Admin/Dream 修改文件按 Schema/Migration/Service/API/UI/Test/Docs 分组；API 状态、测试数量和两视口；Gateway Request 172→175、settled 成功增量 +1、Token Ledger 6→9；Reader Testing/视觉 QA 发现和修复；数据库备份与 Secret 安全；未执行真实支付；以及明确的剩余发布阻断——真实高级 Plan/Pricing/Entitlement 未配置，所以 `hy-preview` 正确显示 maintenance 而不是伪造 upgrade_required。只有无剩余代码/数据一致性缺陷时才把实现闭环标记为完成；不得声称全部商业验收完成。

Optional Enhancers:

- 在报告顶部增加“已完成 / 有意 deferred / 商业配置阻断”三态摘要，避免把安全 defer 误读成代码缺陷。
- 附最小发布顺序：migration → model readiness → plan seed/check → service identity → smoke/E2E；以及回退时只停流量、前向修复，不删除财务历史。

范围变化：

- 阶段五实现和真实验证已完成；本轮只允许只读审计、文档收口和报告写入，不再修改业务 Schema/API/UI 或正式数据。
- 高级套餐商业参数与外部支付保持 deferred；真实 `upgrade_required` 是商业配置阻断，不以 fixture 冒充完成。

执行证据与验证结果：

- Round 55 已提供可复核数据库计数、备份、真实 SSE、5/5 Playwright、四张截图与全量测试结果；本记录是进入最终审计的强制门禁。
- 本记录落盘前尚未生成最终报告，也未执行最终 diff/只读一致性复核。

失败尝试及根因：

- 无；阶段六尚未开始。

未执行事项及原因：

- 最终文件清单、只读 SQL 快照、diff check、报告与完成/阻断结论必须在本 Prompt Architect 记录之后执行。

### Round 56 执行结果（最终一致性审计完成）

- 新增正式报告 `docs/verification/ink-memory-model-catalog-default-free-final-report.md`，以“已完成 / 有意 deferred / 商业配置阻断”三态给出根因、合同、数据库、文件、API/E2E、测试、安全、支付 defer 与解除阻断顺序。
- 最终只读交叉验证：数据库仍为 `ink-memory`；30 canonical/30 Dream projection/30 对应 Billing Account；0 个 active canonical 缺有效 Subscription；Free v1 cancelled 28、v2 active 28；三 Plan identity、display metadata、published/draft 状态、default `deepseek-v4-flash` Entitlement 与 100,000 current Allowance 均和 PRD/UI/报告一致。
- 实时 HTTP 复核：Dream catalog/plans/context/usage 均 200；catalog 为 `deepseek-v4-flash=included/callable`、`hy-preview=maintenance/not callable`，default alias 为 Free 模型；Dream bearer 请求 Admin Registry API 精确为 401。
- 为避免 Playwright 默认 output cleanup 留下旧 tracked screenshot 删除，重新执行现有 Subscription regression 4/4 并生成反映新叙事卡的三张更新截图；随后以独立 `--output=test-results/round55-real` 再次执行真实用例 5/5，四张真实 desktop/mobile 截图非空且路径稳定。
- 两仓最终 `git diff --check` 通过；Admin backup、Admin `.env.local`、Dream `backend/.env` 均 mode 0600；四张真实截图非空。Secret 扫描只命中受控环境变量名称和安全说明，没有值、完整 DSN、JWT、Gateway Key、Provider Secret或prefix。
- 源码一致性：Dream前端与Claude resolver无静态Provider型号fallback；`INK_GATEWAY_TEXT_MODEL_ALIAS`仍存在于独立的non-Claude `GatewayInferenceModels`配置对象，但Claude Agent不读取它，且本任务的Claude选择严格由用户保存callable alias和Admin default alias决定。
- 最终状态：代码、Schema、数据、文档、Free真实SSE和双视口E2E闭环完成，未发现剩余代码/数据一致性缺陷；真实高级模型`upgrade_required`和外部支付仍被缺少真实商业配置阻断，报告未将其伪造为完成。

失败尝试及根因：

- 无新的实现失败。最终审计发现默认 Playwright output曾把三张tracked旧截图标为删除；通过正常重跑对应4个回归测试更新截图，而不是使用破坏性Git恢复或覆盖用户修改。

未执行事项及原因：

- `hy-preview`真实upgrade场景、Dream/is-dreaming购买、支付webhook/退款/真实升级降级继续未执行；必须先由商业配置发布新的Pricing/Plan Version/Entitlement并接通支付，当前maintenance/draft是唯一安全真实状态。
- 未提交、未stage、未push代码；用户未要求Git发布操作。

## Round 57 — 阶段七：参考 Allegretto 的简洁订阅页重设计

Optimized Prompt:

作为 Ink Dream 的产品设计负责人和 React/CSS 工程师，依据用户提供的三张 Allegretto 订阅页面截图，重新设计 `StoryWorkspaceSubscriptionPage`。目标不是复制黑色品牌皮肤，而是提取其“品牌/当前套餐摘要 → 少量清晰标签页 → 单一主题内容卡”的信息架构，并保留 Ink Dream 现有米白、棕墨、叙事化字体与设置侧栏视觉。

删除当前页面对普通用户暴露的运营/计费内部信息：Plan Version ID/状态、周期序号、个人锚点、自动续订内部状态、Entitlement scope、RPM、daily Token、storage、catalog readiness、receipt/digest、复杂升级预览等。页面只保留用户需要做判断的内容：当前套餐名称、简短说明、有效期/下次重置时间、剩余/已用/总 Token、套餐权益文案、Free/Dream/is Dreaming 可选方案及真实可开通状态。

采用三个标签页：`订阅信息`（默认，当前套餐和来自 Product API 的 details 权益清单）、`我的额度`（一个醒目的 Token 余额数字、使用百分比、单一进度条、已用/总量和重置日期）、`可选套餐`（来自真实 Admin Product API 的三张极简方案卡）。Dream 与 is Dreaming 商业参数仍为 draft 时显示“暂不可开通”，不得伪造价格、支付按钮或成功状态；Free 当前方案显示“当前套餐”。刷新动作保留为低干扰按钮。错误/loading/empty 使用单一短句与重试，不展示内部错误结构。

实现必须继续消费现有真实 Product plans/context/usage API，不改 PostgreSQL、Admin contract 或服务资格。组件使用原生 button/tablist/tab/tabpanel 语义、方向键或清晰 Tab 顺序、可见 focus、aria-selected/controls，移动 390×844 下标签可横向滚动或等宽收敛且页面无横向溢出。桌面 1440×1000 内容宽度克制、信息密度接近参考图；减少边框、标签、数字块和重复文案。

按 `html-design-workflow` 严格顺序产出 PRD、结构草图、层级逻辑和最终 UI 设计说明，再将设计落到现有 React/CSS，而不是生成脱离项目的静态 HTML/Tailwind 页面。更新相关 source/unit/Playwright 断言，执行 typecheck、lint、build、真实或现有 Product E2E，并对 1440×1000 与 390×844 截图做视觉复核。

Optional Enhancers:

- 用 `font-variant-numeric: tabular-nums` 保持 Token 和日期稳定，但避免后台报表式表格。
- 进度条仅使用 Ink Dream 的低饱和墨色，不引入参考图的亮蓝色，确保品牌一致。
- 当总额度为 0 或使用数据暂不可用时显示“额度数据暂不可用”，不计算 NaN/Infinity，也不伪造 0%。

范围变化：

- 本轮只修改 Dream 订阅页设计、前端组件/CSS和对应测试；不修改 Admin、PostgreSQL、Subscription/Payment API 或模型资格逻辑。
- 用户现在提供了真实参考图片，`html-design-workflow` 从上一轮“不适用”变为强制适用；按技能要求串行委派四个专门阶段。

执行证据与验证结果：

- 三张参考图已提供，分别展示额度、权益和账单标签页；当前真实页面截图已证明信息密度过高，用户明确要求简化。
- 本记录落盘前尚未修改订阅页组件、CSS或测试。

失败尝试及根因：

- 无；本阶段尚未开始。

未执行事项及原因：

- 四阶段设计工作流、当前组件审计、实现与双视口验证必须在本 Prompt Architect 记录之后执行。

## Round 58 — Dream 真实 Workspace / Story 数据可见性修复

Optimized Prompt:

作为资深产品架构师、PostgreSQL 数据架构师、Next.js/Refine 管理后台工程师与 UI/UX 负责人，在 `/Users/dmeck/project/ink-admin-memory` 内完成 `/admin/story/workspaces` 与 `/admin/story/stories` 不显示 Dream 真实数据的问题审计、设计、修复和发布级验证。`/Users/dmeck/project/ink-dream-memory` 只允许读取，用于核对其 PostgreSQL schema、迁移和字段语义；不得修改其代码、schema、迁移、运行配置或数据。Admin 必须继续只使用唯一 PostgreSQL `DATABASE_URL` 和数据库 `ink-memory`，直接查询 canonical `users`、`story_workspace_workspaces`、`story_workspace_stories`，不得创建、复制、填充或回退到任何平行业务表、SQLite、JSON DB 或内存数据。

第一阶段只读审计并生成 `docs/verification/story-workspace-data-visibility-audit.md`。从 Admin 实际加载的环境配置出发，脱敏确认 host、port、database、current schema/search_path、三张表存在性、非敏感行数、状态分布、字段类型、PK/FK 类型、Workspace owner→users、Story workspace/author 关系 orphan、时间和 JSON 类型；禁止输出密码散列、Secret、正文或敏感用户内容。逐层追踪 Story page → `StoryResourceView` → `AdminResourceManager` → Refine `useList` → Data Provider → `/api/admin/**` → repository/service SQL → PostgreSQL，并用代码位置、脱敏 SQL 结果和实际 API 合同证明 Resource 名称、旧表映射、JOIN、字段、状态筛选、URL 筛选、排序、count、snake/camel 映射、缓存、Session/RBAC、500/503 错误边界及 Server/Client 环境是否一致。根因必须落入明确分类，不得停留在“可能”。

在任何页面代码修改前，更新当前主 PRD 的 Story 数据运营章节，并新增 `docs/design/story-workspace-data-visibility-fix-interaction-design.md`。定义 Workspace 与 Story 桌面 1440×1000、移动 390×844 的列表列、关系导航、可搜索关系筛选、状态/时间筛选、服务端分页、清除筛选、桌面右侧 Drawer/移动全屏详情、安全摘要和复制 ID 行为。显式区分 Loading skeleton、数据库真实零行、筛选无结果、400、401、403、404、409、500、503 及数据源/关系不一致，确保错误不会被伪装成空表，页面无 document 级横向溢出。

随后在 Admin 的 repository/service 层完成最小根因修复：校正 `story-workspaces`、`story-stories`、`stories` 的 Refine/API 映射；SQL 直接以 canonical Dream 表和真实 `users` 为主体，移除会过滤业务记录的非必要 `INNER JOIN platform_users`，缺少 Billing Identity 时保留记录并显示“未绑定计费身份”；统一 bigint/UUID/text ID 的字符串 API 序列化；修复状态、时间、JSON、total、分页、排序和筛选白名单；写操作或迁移后正确失效 list/detail cache；Route Handler 只承担 Session/RBAC/Zod/Origin 与 service 编排；保留 Story 受控写边界、事务、审计、Storage、Provider、Gateway、Billing 与 append-only 账本。不得执行破坏性删表或操作真实共享数据。

验证必须遵循 `ink-admin-playwright-qa`。先检查工作树和端口所有权；只读比较当前真实数据库 count 与 API total/UI 展示，不对共享数据库写入。所有写测试使用明确的一次性 PostgreSQL `ink-memory` 或 `TEST_DATABASE_URL`，应用已审阅迁移并只清理自有 fixture/容器。覆盖无 Session 跳转、API 401、RBAC 403、Workspace/Story count 与 total、至少一条关系完整真实记录、无 Platform Billing Identity 仍显示、Workspace→Story 和 User→Workspace→Story 导航、搜索、状态、排序、分页、清除筛选、残留 URL 筛选、关系错误、500、503、双视口无溢出，以及 Storage/Provider/Gateway/Billing/RBAC 与已移除 PWA 路由 404。执行 `pnpm env:check`、`pnpm exec tsc --noEmit`、`pnpm lint`、`pnpm test:run`、`pnpm build`、focused Playwright 与隔离 PostgreSQL集成测试。

最终只在证据充分时声明完成，并报告：真实根因；Admin 实际数据库和 schema；数据库行数/API total/UI 数量对照；Resource/API/repository/page 修改；PRD/交互稿路径；是否有迁移；精确测试命令、通过数量、视口与截图；未执行外部场景和风险。明确确认未修改 `ink-dream-memory`、未新增平行业务表、未引入 SQLite、未修改/清理共享数据库真实数据、未删除 Storage 或共享 Library。保留用户现有未提交修改，不提交、不 stage、不 push，除非用户另行要求。

Optional Enhancers:

- 在审计报告附一张“链路节点 → 实际 resource/URL/table → 证据 → 结论”矩阵，便于定位跨层错配。
- 对真实数据证据只记录 count、类型、状态分布与不可逆脱敏 ID，截图中避免暴露邮箱、正文和 Secret。
- 若当前共享数据库只允许只读验证，将关系缺失和错误态放到一次性 PostgreSQL fixture 中复现，明确区分真实证据与隔离测试证据。

范围与门禁：

- 当前阶段从只读审计开始；审计报告和 PRD/交互设计完成前，不修改业务页面或查询实现。
- 本轮 Prompt Architect 记录已落盘；后续若重新规划或进入新的独立阶段，将先追加新的 Optimized Prompt 再更新计划。

## Round 59 — Workspace / Story PRD 与交互设计门禁

Optimized Prompt:

基于已完成的 `docs/verification/story-workspace-data-visibility-audit.md`，在不修改任何业务 TS/TSX/API/Repository 代码的前提下，先更新 Ink Memory Admin 当前主 PRD `docs/prd/ink-memory-admin-prd-v3.md` 的 Dream 创作运营章节，并创建 `docs/design/story-workspace-data-visibility-fix-interaction-design.md`。设计必须把已证实的 12 Workspace / 4 Story canonical PostgreSQL 数据、`story-workspaces` / canonical `story-stories` Resource、canonical `users` 关系、服务端分页/排序/筛选和安全详情作为真实合同，不得依赖 `stories` 双 Resource、`platform_users` 主体、平行表、假数据或客户端拼接结果。

Workspace 列表定义主文本名称、可复制等宽 Workspace ID、Email/显示名与真实 User ID、完整状态标签、Story 数、创建和更新时间；筛选定义名称、可搜索 User relation、完整状态、更新时间范围、清筛和服务端分页。Story 列表定义标题、可复制等宽 Story ID、可导航 Workspace、真实作者、类型、审核状态、业务状态和更新时间；筛选定义标题、可搜索 Workspace/User relation、完整 type/review/status 枚举、更新时间范围。桌面详情为右侧宽 Drawer，移动端为全屏 Drawer；Workspace 显示真实用户、Story 数、安全 settings JSON与时间，Story 只显示正文长度/结构/摘要等安全派生，不返回或回显正文与敏感内部数据。

为 1440×1000 与 390×844 分别给出页面结构、列收敛、局部表格横滚、Filter Sheet/行卡降级、Drawer 尺寸、焦点归还与无 document 横向溢出要求。显式定义 Loading skeleton、数据库真实零行、筛选零行、400、401、403、404、409、500、503 和 relation/source mismatch 的独立文案、动作、aria 语义与恢复路径；失败时禁止显示“0 条记录”的确定结论。URL 应是筛选状态真值，应用和清除都同步 URL，旧/未知参数提供重置而不是永久假空。

交互稿需包含页面信息架构、字段/控件矩阵、Resource/API/table 合同、筛选 URL 规范、状态机、关系导航、缓存失效、无障碍、双视口线框说明和可自动化验收条件。PRD 只描述产品目标、规则和验收，交互稿描述具体页面行为；两者互相链接，并明确本阶段完成后才能进入代码实现。

Optional Enhancers:

- 使用紧凑 ASCII wireframe 表达桌面列表与移动筛选/详情层级，不生成脱离现有 Refine/Tailwind 系统的静态页面。
- 把审计中的每个确定缺陷映射到一个 PRD acceptance criterion 和一个可测试交互状态。

阶段边界：

- 审计已完成：共享 PostgreSQL read-only 证据为 users=30、Workspace=12、Story=4，三类 orphan=0。
- 本阶段只写 PRD/设计文档；完成并复核前不得修改 `app/**`、`tests/**` 或数据库。

## Round 60 — Canonical Story Resource、Repository 与列表状态实现

Optimized Prompt:

在只读审计、主 PRD v3.4 与 `docs/design/story-workspace-data-visibility-fix-interaction-design.md` 已完成的前提下，实现 Dream Workspace / Story 数据可见性修复。工作范围仅限 `/Users/dmeck/project/ink-admin-memory`；保留用户已有订阅、schema 与 migration 未提交修改，不修改 `/Users/dmeck/project/ink-dream-memory`，不写共享 PostgreSQL 5433，不新增迁移或平行业务表。

首先把 Story 页面、Refine resources、Data Provider endpoint、关系控件和 cache invalidation 统一到 canonical `story-stories`；HTTP compatibility alias `stories` 如需保留，必须在 Route/Provider 边界 canonicalize，不能创建独立页面 query key。Repository 直接查询 `story_workspace_workspaces`、`story_workspace_stories` 和 canonical `users`；主表行不可因缺少 User/Billing relation 而被静默过滤。使用 LEFT JOIN 暴露 `relation_health`，Billing identity 仅显示绑定状态，缺少 `platform_users` 时返回记录并标注“未绑定计费身份”。Workspace 增加 status、owner display/id、Story count 与时间；Story 列表/详情删除正文 payload，改为安全 `content_length`/结构计数，补 author display、关系状态和字符串 ID 序列化。

扩展服务端白名单筛选以支持完整 Workspace/Story status/type/review、canonical User/Workspace relation 和 `updated_at` 起止范围，data/count 复用完全相同 predicate；不接受任意 SQL字段。扩展 AdminResourceManager 的 Query Bar：关系筛选使用真实服务端分页 Resource，日期使用明确起止控件；应用、清除、分页和浏览器前进/后退同步 canonical URL，清除后 reload 不复活。Unknown/旧筛选提供重置动作。

列表状态必须区分 Loading、system empty、filter empty、400、401、403、404、409、500、503 和 relation/source mismatch。请求失败时 Header 显示“计数不可用”，不渲染普通空表；错误按 HTTP/code 给出重新登录、重置筛选、返回、刷新或复制 request ID 等安全动作。新增可复制 Workspace/Story ID 和关系链接；桌面 Drawer、移动全屏与当前 Admin token/focus 体系保持一致。Story/Workspace 成功写或 confirm 后失效 canonical list/detail 及受影响 Workspace/User relation cache。

补充/调整 unit 与 focused E2E 合同：Data Provider只请求 canonical endpoint；Repository LEFT JOIN、status/date、safe payload、total一致；URL清筛；错误/空态区分；无 Billing identity记录仍出现；双视口无横向溢出。此阶段只修改代码与测试，不运行破坏性或共享数据库写操作；实现完成后另开验证阶段的 Prompt Architect 记录再运行隔离 PostgreSQL与完整门禁。

Optional Enhancers:

- 把通用错误状态与 CopyValue 作为小型无副作用组件，避免在 JSX 中继续堆叠单行条件。
- 兼容 alias 在 server route 中统一映射并加 unit test，便于旧链接平滑过渡后删除。

实现门禁：

- 审计报告、PRD v3.4 和专项交互设计已存在并通过 `git diff --check`（已清除新增 trailing whitespace）。
- 当前共享数据库只用于已完成的 read-only 证据；后续关系异常/缺 Billing identity/503 使用 disposable PostgreSQL 或 request mock。

## Round 61 — 隔离 PostgreSQL、真实 Session 与双视口发布验证

Optimized Prompt:

对已实现的 Workspace / Story 数据可见性修复执行发布级验证。严格遵循 `.agents/skills/ink-admin-playwright-qa/SKILL.md` 与 `references/project-workflow.md`：先复核 Git 状态、3000/5433 监听与进程所有权；共享 `localhost:5433/ink-memory` 只保留已完成的 read-only 审计，不登录、不迁移、不写入。创建精确命名、可删除的一次性 PostgreSQL 16 容器或明确 `TEST_DATABASE_URL`，数据库名使用测试安全标记且通过应用 `INK_USE_TEST_DATABASE_URL=1` 校验；应用全部已审阅 Drizzle migrations，加载 checked-in Story/control-plane fixture，并只清理自有容器/端口。

用真实 bootstrap/login HttpOnly Session 运行 focused Playwright。API/SQL 对照必须证明 Workspace 与 Story 同条件 count=`meta.total`，页面只请求 canonical `/api/admin/story-stories`，旧 `/api/admin/stories` 只作 server compatibility。隔离 fixture 创建一个 canonical User/Workspace/Story，但在受控事务中禁用自动 Billing projection trigger，使其没有 `platform_users`；断言两条业务记录仍在 API/UI 显示“未绑定计费身份”，而不是被 JOIN 过滤。验证 Story payload 不含正文。

浏览器覆盖：无 Session 307/login、Admin API 401、auditor写403、已有关系冲突409；Workspace/Story clean total、文本/状态/关系筛选、排序/分页、User→Workspace→Story 与 Workspace→Story 导航；Filter empty与System empty不同；清除筛选同步 URL，reload不复活；mock 500/503 显示独立 error state且无普通 empty row；Drawer详情、安全摘要与写后 canonical cache失效。捕获 console、pageerror、requestfailed、unexpected 5xx 诊断。1440×1000 与390×844分别截图 Workspace和Story，断言 document overflow≤1px；Storage、Provider、Gateway、Billing、RBAC 与移除PWA路由404继续通过。

按顺序执行 `pnpm env:check`、`pnpm exec tsc --noEmit`、`pnpm lint`、`pnpm test:run`、focused Playwright、必要的隔离 PostgreSQL integration、`pnpm build` 与 `git diff --check`。若发现回归，在请求范围内修复并只重跑最窄失败 lane，最后复跑完整矩阵。记录精确命令、迁移数、测试/通过数、视口、截图、数据库后置计数、失败尝试、跳过的外部场景和容器/监听清理证据。不得访问真实 Provider、不得使用用户 Token、不得修改 Dream 仓库、不得提交/stage/push。

Optional Enhancers:

- 保存 Story 503 状态与 Filter empty 状态截图，但确保没有真实邮箱、正文或 Secret。
- 在隔离库后置 SQL 中同时断言缺 Billing projection 的 canonical User 数=1、其 Workspace/Story 数=1、relation health仍为healthy。

验证前状态：

- TypeScript、全量 lint、328/328 unit 与 `git diff --check` 已通过。
- 共享数据库 read-only：Workspace=12、Story=4、当前关系错误=0；新 LEFT JOIN 等价查询仍返回12/4。

## Round 62 — 参考图订阅页验证、Reader Testing 与双视口视觉 QA

Optimized Prompt:

作为 Ink Dream 的高级前端 QA、可访问性审阅者与 UI/UX Reader Tester，验证 Round 57 参考 Allegretto 重设计后的 `StoryWorkspaceSubscriptionPage`，不得新增 PostgreSQL、Admin、Subscription、Payment 或 Gateway 产品范围。先确认工作树与 5173/8765 端口归属，运行项目 Playwright QA preflight，并保留用户及其他任务已有未提交修改。

对新订阅页执行三层验证。第一层检查 TypeScript、ESLint、production build 和 source contract，证明页面只加载真实 subscription context 与 Product plans，不再为这个页面读取 request-level usage/model catalog；页面无静态套餐、假价格、假余额、Gateway/model/Plan Version/request/settlement/receipt 内部字段。第二层运行 focused mocked-browser 回归，仅验证 UI 行为：默认 `订阅信息`、`我的额度` 与 `可选套餐` 单面板切换，Header 入口，ArrowLeft/ArrowRight/Home/End roving focus，进度条语义、loading/error/empty、1440×1000 与 390×844 无横向溢出。第三层运行现有真实本机 Product E2E，不 mock `/api/story-workspace/subscription/context` 或 `/plans`，验证 API 返回 Free/Dream/is-dreaming，Free published/current，两个 draft 套餐显示“暂不可开通”，真实 Allowance 可见，普通用户仍无法访问 Admin Registry。

Reader Testing 必须按普通创作者而非计费工程师视角逐段阅读：首屏能否在数秒内回答“我是什么套餐、什么时候更新、还能用多少、还能选什么”；界面是否只显示一个主题面板；套餐卡是否保持 `eyebrow → name → note → details`；是否还有 Plan Version、周期序号、锚点、scope、alias、RPM、storage、usage request、settlement、digest、request ID 或假支付表达；错误文案是否短、可恢复且不暴露内部代码。对发现的问题先做最小修正再重跑。

视觉复核必须查看两张最终 screenshot，而非只检查像素文件存在；桌面内容宽度、留白、Tab 下划线、单面板边框和三卡节奏应接近参考图的信息密度但继续使用 Ink Dream 米白/棕墨品牌；移动端按钮、Tab、数字和卡片不得溢出或拥挤。注册 console、pageerror、requestfailed 监听并要求 Ink Dream 应用错误为零。最终把命令、通过数量、视口、截图路径、Reader Testing 发现、失败根因、未执行真实支付原因和安全确认追加到工作日志；只有验证完成后才更新完成状态。

Optional Enhancers:

- 检查页面可见文本中没有 `plan version`、`gateway`、`model alias`、`rpm`、`request id`、`checkout`、`invoice` 等内部词。
- 对 Allowance `granted=0` 做 source/unit 防 NaN 检查；对服务端 `reserved` 保留守恒合同但不在普通用户 UI 中展示。
- 若真实高级套餐仍为 draft，只验证诚实的“暂不可开通”，不触发、模拟或声称真实付费成功。

范围变化：

- Round 57 设计与实现已完成；本阶段只允许前端验证、Reader Testing、必要的最小 UI/测试修正和证据记录。
- 不修改 Admin、PostgreSQL、Product/Gateway 合同、正式套餐商业参数或真实支付状态。

执行证据与验证结果：

- 进入本阶段前，订阅页 TypeScript 已通过；focused source/layout 13/13 通过；frontend lint 0 errors、21 条仓库既有 Hook warnings。
- 本记录落盘前尚未运行 production build、focused browser E2E、真实 Product E2E 或最终截图目视复核。

失败尝试及根因：

- 首次误尝试 `pnpm test:run`，Dream frontend 没有该 script，命令立即以 254 退出且无文件/数据副作用；改用仓库规定的 `pnpm exec playwright test` 后 source/layout 13/13 通过。

未执行事项及原因：

- production build、preflight、端口审计、mocked browser、真实 Product E2E、截图复核与最终日志结果必须在本 Prompt Architect 记录之后执行。

### Round 62 执行结果（UI 实现验证完成；真实 Product Context 受 Admin 现状阻断）

执行证据与验证结果：

- `html-design-workflow` 四阶段产物已完成并保存在 Dream `.artifacts/round57-html-design/files/workspace/`：PRD、结构草图、层级逻辑、最终 UI 设计共四份；实现采用“套餐摘要 + 三个 Tab + 单一面板”并保持 Ink Dream 米白/棕墨品牌。
- Dream 组件与 CSS 已重写；subscription hook 首屏由 context/plans/usage/models 四请求缩减为真实 context + plans 两请求。页面不再展示 Plan Version、周期序号、锚点、自动续订内部状态、Entitlement scope、model alias、RPM/daily/storage、request usage、settlement、request ID、receipt/digest 或支付内部状态。
- `pnpm exec tsc --noEmit` 通过；focused ESLint 通过；全量 `pnpm lint` 为 0 errors、21 条既有 Hook warnings；production `pnpm build` 通过，仅保留既有 ineffective dynamic import 和 large chunk warnings；`git diff --check` 通过。
- source/layout Playwright 13/13 通过；focused browser Playwright 2/2 通过，覆盖 1440×1000、390×844、默认信息、额度进度条、真实 plans fixture、Header 入口、ArrowLeft/ArrowRight/Home/End、focus、console/pageerror/requestfailed=0 与无横向溢出。
- 最终目视复核四张截图：`subscription-desktop-info-1440x1000.png`、`subscription-desktop-allowance-1440x1000.png`、`subscription-desktop-1440x1000.png`、`subscription-mobile-390x844.png`。桌面为克制的 1040px 内容宽度、低干扰边框与三卡节奏；移动为单列卡片且无 document overflow。
- Reader Testing 能在首屏直接回答当前 Free、文案和更新日期；额度 Tab 只保留 75,000 remaining、24,000/100,000 与单一进度条；套餐 Tab 保持 `eyebrow → name → note → details`。Reader Testing 发现初始异步数据到达后 h1 没有获得焦点，已用一次性就绪 focus 修复；随后发现程序化标题 focus outline 视觉噪声，保留屏幕阅读器焦点管理但移除非交互标题 outline；两项均重跑通过。
- 真实只读证据：Dream `/api/story-workspace/subscription/plans` 返回 200，三 plan identity 与 published/draft 断言执行成功；Dream bearer 访问 Admin Registry 为 401，RBAC focused 1/1 通过。
- 所有本轮启动的 5173、8765、3000 服务均已按 PID/会话归属关闭，最终三端口无 listener；未执行数据库写入、迁移、fixture 清理、Provider 推理或支付操作，未读取或输出 Secret/Token/完整 DSN。

失败尝试及根因：

- mocked browser 首轮 1/2：loading h1 被替换后，ready h1 未重新聚焦；修复只在首个非 loading 状态聚焦。次轮 1/2：测试以纯文本 `75,000` 查找带 `Token` 单位的 heading；改为语义 heading 正则。最终重复执行 2/2。
- 真实 5-test suite 两次在首个 Gateway Settings 用例超时：第一次 Admin 被错误启动在 3010，而 Dream 的已配置本机依赖是 3000；改为 3000 后 `/v1/models` 仍返回 500，Dream `/api/gateway/models` 返回 500。
- 单独运行真实 Product/RBAC lane 时，plans 为 200 且三 plan 断言成功，但 Admin `/api/product/v1/me/subscription-context` 当前返回 503 `PRODUCT_DEPENDENCY_UNAVAILABLE`，因此页面正确显示短错误态，无法出现 Tab；同一 Admin runtime 还可见 `/api/admin/subscriptions` 与 `/api/admin/subscription-token-grants` 500。该失败发生在另有并行修改的 Admin 工作树中，不能由本轮 Dream UI diff 解释；本轮没有覆盖或修复该 Admin 代码，也不把两者的因果关系写成已证明。

未执行事项及原因：

- “真实 context + plans 同时 200 后的无 mock 页面成功态”未通过，因此不得把原任务的最终真实 Product E2E 宣布为完成。解除条件是先让当前 Admin `/api/product/v1/me/subscription-context` 恢复 200，再重跑 `model-settings-gateway-real.spec.ts` 的 Product desktop/mobile 两项。
- Dream/is-dreaming 仍为 draft；未执行真实价格、开通、支付、Webhook、退款、升级或降级。页面只显示“暂不可开通”，没有伪造价格或成功状态。

## Round 63 — Product Subscription Context 503 根因修复

Optimized Prompt:

作为 PostgreSQL 订阅计费架构师、Admin Product API 与 Dream FastAPI BFF 工程师，修复 Dream `GET /api/story-workspace/subscription/context` 返回 `503 PRODUCT_DEPENDENCY_UNAVAILABLE` 的真实根因。先复现并保留 request ID、Dream BFF 状态和 Admin `/api/product/v1/me/subscription-context` 状态；再从 Dream session/canonical user、service JWT/issuer/audience/scope、Admin Route Handler、Product repository/service、PostgreSQL Subscription/Plan Version/Allowance/Entitlement 查询、DTO 安全防火墙和 Zod/Pydantic 合同逐层定位。不得把 503 改成静态成功、不得吞掉合同错误、不得绕过 RBAC/Entitlement、不得用 mocked context 代替真实修复。

工作树存在大量并行 Admin Workspace/Story、Subscription 与 migration 修改。必须先阅读重叠文件的当前 diff，保留并适配这些修改，禁止回滚、覆盖或清理未知变更。数据库只允许只读确认本机专用 `ink-memory`；若根因是代码/查询/DTO 映射，做最小兼容修复并补 focused unit/integration contract。若必须修正数据，只能在证明本机数据库、目标行和幂等前向语义后执行，不得重写 Usage、Ledger、Subscription Event、Allowance 历史或已发布 Plan Version。

验收要求：真实 Admin `/api/product/v1/me/subscription-context` 对明确本机 test canonical user 返回安全 200；Dream BFF 同一路径返回 200 且 DTO 通过严格校验；`plans` 继续 200；错误状态仍正确区分 401/403/409/503；普通 Dream bearer 访问 Admin Registry 仍为 401/403。重跑相关 Admin Product/Subscription/Gateway tests、Dream Admin Product client/BFF tests、TypeScript/Python lint或typecheck，以及真实 Playwright Product desktop/mobile。捕获 API 5xx、console、pageerror、requestfailed 与横向溢出。不得输出完整 DSN、JWT、Gateway Key、Provider Secret 或用户 Token。

Optional Enhancers:

- 在修复前对 Admin 503 内部失败分类加入仅服务端可见的结构化诊断，公开响应继续保持安全通用文案。
- 若发现列表 Resource 的并行查询修改误伤 Product repository，优先在 repository 内恢复稳定列/别名合同并加 regression test，不耦合 UI Resource。
- 同时验证 `/v1/models` 500 是否同根因；只有共享根因时一并修复，否则记录为独立未执行项。

范围变化：

- 本阶段由订阅页 UI 验证切换为真实 Product Context 503 后端修复；允许修改与根因直接相关的 Admin/Dream backend 文件和 focused tests。
- 不修改订阅页视觉、不发布高级商业参数、不执行真实支付或 Provider 推理。

执行证据与验证结果：

- 已知真实复现：Dream `/api/story-workspace/subscription/context` 为 503 `PRODUCT_DEPENDENCY_UNAVAILABLE`；Admin `/api/product/v1/me/subscription-context` 为 503；同一身份 plans 为 200；Admin Registry RBAC 为 401。
- 本记录落盘前尚未读取重叠 diff、定位内部异常或修改代码/数据。

失败尝试及根因：

- Round 62 的真实 Product Playwright 在等待 `可选套餐` Tab 时超时；页面快照显示安全 503 error state。根因尚未证明，不能仅依据公开错误文本归因。

未执行事项及原因：

- 内部异常定位、最小修复、focused tests 和真实 Product desktop/mobile 必须在本 Prompt Architect 记录之后执行。

### Round 63 执行结果（真实 5173 Product Context 已恢复）

根因与处理判断：

- 真实根因是应用代码与 PostgreSQL migration 部署顺序不一致。当前 `app/lib/product/repository.ts` 的 Context/Model 查询已读取 `subscription_usage_allowances.bonus_granted_tokens`，但本机专用 `ink-memory` 仍只记录到 0025；该列和 `subscription_token_grants` 表均不存在。PostgreSQL 因 undefined column 使 Admin Context 安全映射为 503，Dream 再映射为 `PRODUCT_DEPENDENCY_UNAVAILABLE`。`plans` 不查询 Allowance，因此一直为 200；`/v1/models` 同样读取新列，因此此前为 500。该证据完整解释三个端点的不同状态。
- 已审阅并应用事务型前向 migration `0026_harsh_victor_mancha`。它新增 `bonus_granted_tokens DEFAULT 0 NOT NULL`、append-only `subscription_token_grants`、FK/check/index/trigger 和 `subscriptions.grant` 权限；没有 DROP TABLE、TRUNCATE、DELETE、批量 UPDATE，也没有重写既有 Usage、Ledger、Subscription Event 或 Allowance 历史。

执行证据与验证结果：

- 迁移前只读：database=`ink-memory`、schema=`public`，bonus column=false、grant table=false，最新已应用记录为 0025。
- `pnpm db:migrate` 首次输出 `Applied migration 0026_harsh_victor_mancha` 并事务提交；第二次幂等复跑没有重复应用。迁移后只读：Allowance=61、bonus 非零=0、Token Grant rows=0、守恒异常=0、0026 migration record=1。
- 用户指定入口 `http://127.0.0.1:5173/api/story-workspace/subscription/context` 使用明确本机 test canonical user 的临时 bearer 实测为 200，planCode=`free`、Allowance 存在；未输出 bearer 值。8765 context=200、plans=200、gateway models=200。
- Admin focused Vitest：4 files、38 tests 全通过（Product routes/service、Subscription contracts/Gateway）。Dream focused pytest：19 passed（Admin Product client 与 Product BFF routes）。
- 无 mock 真实 Playwright：5/5 通过，覆盖 Gateway Settings desktop/mobile、Product plans + Free Allowance desktop/mobile、Dream bearer 无 Admin Registry 权限；视口为 1440×1000 与 390×844。
- 当前 3000、8765、5173 均为用户/其他工具已有进程；本轮只短暂尝试启动一个 Admin dev 实例，但因 `.next/dev/lock` 立即失败退出，没有停止或替换现有 listener。

失败尝试及根因：

- 首次从 Dream 仓库根目录运行两个 backend pytest 时因 Python import root 不正确出现 2 个 collection errors；未修改代码或数据。切换到 `backend/` 后以 `.venv/bin/python -m pytest` 重跑，19/19 通过。
- 尝试启动 Admin 3000 时发现已有同仓库 Next dev 持有 `.next/dev/lock`；新进程立即退出。确认现有 listener cwd 后复用，不杀未知/用户进程。

未执行事项及原因：

- 未执行真实 Provider 推理或真实支付；本次根因仅为本机 PostgreSQL schema 未追上已运行代码，Product/Gateway 目录和页面真实读链路已经足够验证修复。
- 未创建、更新或删除任何 Token Grant 行；迁移后的 grant table 保持 0 行，所有既有 Allowance bonus 均为 0。

## Round 64 — Enabled 模型全员可见、Free 新版本模型可选与维护状态语义修正

Optimized Prompt:

作为 Ink Memory 产品架构师、PostgreSQL 订阅计费与 AI Gateway 架构师、Admin Next.js 工程师和 Dream FastAPI/React 工程师，修复两个真实产品问题：管理员更新 Free Plan Version 并加入 `hy-preview` 后，Free 用户在 Dream AI 模型设置中仍无法选择；所有 canonical 登录用户必须能看到 Admin `AIModelRegistry` 中全部 enabled 平台模型，而不是只有订阅或 Entitlement 命中的用户才能看到。

先审计当前 Admin/Dream 代码与本机专用 PostgreSQL `ink-memory`，不得依据截图猜测。逐项证明：`hy-preview` 的 model enabled、Provider enabled、active pricing/readiness、model permission；最新 Free Plan Version 的 status、Entitlement gateway scope/model aliases；测试用户当前 Subscription 所绑定 Plan Version；Admin public model catalog SQL/DTO 如何区分 visible、callable、availability、requiredPlanCode；Dream BFF 严格合同和 ModelConfigSection disabled/label/save 条件；`AIModelRegistry` 的 enabled 真值如何传播到公共目录。保留并适配现有未提交修改，不覆盖 Admin Workspace/Story、Token Grant、Subscription 或 Dream UI 的并行工作。

实现新的明确合同：

- 所有已认证 canonical 用户，包含无 Subscription、Subscription inactive、旧 Plan Version 或无对应 Entitlement 的用户，都收到所有 Admin enabled platform models；目录正常返回 `200 + availability metadata`。
- `enabled=false` 的模型不进入 enabled public catalog；若已保存 alias 后被停用，保存/调用返回结构化 409 并要求重新选择。只有 Admin 模型未启用、Provider/上游主动维护或明确 runtime readiness 失败时才允许显示“当前维护中”。
- “未绑定任何 Plan Version”“用户 Subscription 未包含该模型”“用户仍在旧 Plan Version”不得映射为 maintenance。若模型属于已发布套餐但当前用户无权益，显示 `upgrade_required` 和 required plan；若 enabled 模型没有任何 published Plan binding，目录仍全员可见，并给出独立、诚实且可操作的 callability 语义，不能伪装维护或从目录消失。
- Free 新版本发布并把模型加入基础 Entitlement 后，必须定义现有 Free Subscription 的安全升级策略。若产品语义为默认 Free 自动跟随最新 published version，则实现幂等前向迁移/发布流程，生成正确 Subscription Event/Allowance 影响且不覆盖 Usage/Ledger 历史；若当前模型已存在正确 published entitlement 但用户 projection/cache 落后，则只修复 projection/cache。不得直接改写已发布 Plan Version。
- Dream 设置页所有 enabled 模型均可见；只有真实 `callable=true` 才允许保存。不可调用状态分别显示升级、Subscription inactive、额度耗尽、permission denied 或 runtime maintenance，不再统一为“维护中”。Free Entitlement 已包含 `hy-preview` 且实时资格满足时必须可选择并保存。

验证要求：Admin unit/integration 覆盖 enabled 全目录、无订阅 200、未绑定 plan 非 maintenance、Free 新版本 entitlement、旧 Free Subscription 前向策略、disabled 模型不进入目录、Registry RBAC 不变；Dream unit覆盖 DTO、标签、disabled/save 语义和 stale selection 409。只在本机专用 `ink-memory` 进行只读审计；任何数据修正必须幂等、前向、可追溯，不改写 Usage/Ledger/Audit/历史 Event。运行 Admin env/type/lint/focused tests/build、Dream backend/frontend focused tests，并用真实 Product/Gateway Playwright 在 1440×1000 与 390×844 验证：全部 enabled 模型可见，Free 当前 entitlement 模型可选，未授权模型显示准确原因，console/pageerror/API 5xx/横向溢出为零，普通用户仍不能访问 Admin Registry。

Optional Enhancers:

- 在公共 DTO 增加稳定的 `availabilityReason`/`requiredPlanCode` 组合测试，避免前端从文案反推业务状态。
- 增加 Admin 发布 Free 新版本后的幂等 reconciliation command 与 dry-run 计数，明确更新多少 active Free Subscription，跳过多少 paid/inactive/冲突记录。
- 为 model disabled 后的已保存 alias 增加端到端重新选择测试。

范围变化：

- 本阶段允许修改 Admin public model catalog、Free subscription reconciliation、Dream BFF/设置页及相关 tests；不改变 Admin Registry RBAC，不接真实支付，不访问 Provider 推理网络。
- 用户明确收紧 maintenance 语义：缺少 Plan binding/Entitlement 不再等于维护；所有 enabled 模型对登录用户可见。

执行证据与验证结果：

- 用户截图显示 `deepseek-v4-flash` 可选，而 `hy-preview` 被禁用并显示“需要 free 套餐”；用户说明已发布/更新 Free 版本加入 hy，但当前页面仍不可选。
- 本记录落盘前尚未审计真实 model/plan/subscription 数据或修改代码/数据。

失败尝试及根因：

- 无；本阶段尚未开始。

未执行事项及原因：

- 数据库审计、根因分类、实现、数据 reconciliation 和真实双视口验证必须在本 Prompt Architect 记录之后执行。

## Round 64 — Dream Workspace/Story 可见性最终证据归档

Optimized Prompt:

作为资深产品架构师、PostgreSQL 数据架构师、Next.js/Refine 管理后台工程师和 UI/UX 验证负责人，对已经完成实现的 Dream Workspace/Story 数据可见性修复执行最终证据归档。范围仅限 `ink-admin-memory` 的 Story Workspace/Story 查询链路、管理页面、相关测试与文档；`ink-dream-memory` 继续只读，不得修改。保留当前工作树中其他任务的未提交修改，禁止回滚、覆盖或清理未知变更。

先汇总生产配置的只读数据库证据：Admin 与 Dream 指向同一 PostgreSQL `ink-memory`，服务端 schema/search_path、`users`、`story_workspace_workspaces`、`story_workspace_stories` 的行数、状态、类型和关系完整性；不得输出完整 DSN、口令、Secret、正文或密码散列。再汇总代码证据：页面统一使用 canonical `story-workspaces`/`story-stories`，兼容 `stories` 仅在 API 边界归一化；Repository 以 Dream 真表和 `users` 为主体，计费身份只做 LEFT JOIN；列表/详情不返回正文，主外键字符串化；筛选、日期范围、分页、排序、total、URL 清理、缓存失效和错误分类保持一致。

验证报告必须记录已通过的 `pnpm env:check`、`pnpm exec tsc --noEmit`、`pnpm lint`、`pnpm test:run`、production build 以及专属 Docker PostgreSQL 上的 focused Playwright。Playwright 证据需包含无 Session 302/401、RBAC 403、数据库 count 与 API total 一致、缺少 Platform Billing Identity 的业务数据仍显示、关系跳转、状态/搜索/日期/分页/排序、残留 URL 清理、400/500/503 与空状态分离、受控写后缓存失效、Storage/Provider/Gateway/Billing smoke、已移除路由 404，以及 1440×1000、390×844 无页面级横向溢出。目视检查 Workspace、Story、筛选无结果和数据库不可用截图，确认数据表与诊断态清晰且没有普通空表伪装。

更新 `story-workspace-data-visibility-audit.md` 的最终验证证据，并创建 `story-workspace-data-visibility-fix-verification.md`。最终报告必须明确真实根因、当前数据库/schema、生产只读行数与隔离测试 DB/API/UI 对照、修改文件、PRD/交互设计路径、是否涉及迁移、测试数量/视口、已知风险及未执行外部场景。只有在 `git diff --check` 通过、临时服务/容器清理且 3000/5433 用户进程未被触碰后，才可声明完成。

Optional Enhancers:

- 在报告中区分生产共享数据库只读证据与隔离测试写入证据，避免把 fixture 数量误称为生产 UI 数量。
- 记录 Turbopack 因临时目录外部 `node_modules` 符号链接失败，随后使用 `next build --webpack` 成功，明确这是验证布局限制而非代码失败。
- 为六张最终截图提供可点击的绝对路径，并在视觉结论中说明移动端首屏可能只显示筛选区，但 E2E 已滚动/定位真实数据且 document overflow 为零。

范围变化：

- 本阶段仅归档和复核，不再扩大实现范围，也不执行新的共享数据库写操作。
- 与并行 Product Subscription Context 任务无关，不修改其代码、迁移或验证结论。

执行证据与验证结果：

- `pnpm env:check`、TypeScript、全量 lint 已通过；unit 为 67/67 files、328/328 tests；隔离 PostgreSQL focused Playwright 最终为 1/1 通过（44.3 秒），并覆盖 404 关系缺失与 409 关系冲突专用状态。
- production `next build --webpack` 在临时副本通过；1440×1000、390×844 截图已生成并目视确认 Workspace/Story 真数据及 503 独立诊断态。
- 生产共享库全程只读；隔离 PostgreSQL 最终为 Workspace=3、Story=3、关系错误=0。

失败尝试及根因：

- focused Playwright 首轮业务断言已走完，但开发辅助脚本 `react-grab` 的 unpkg CORS 被诊断监听器收集；使用项目既有做法在测试内 fulfill 该开发脚本后通过。
- 临时副本默认 Turbopack build 因 `node_modules` 符号链接指向工作区根目录之外而失败；同一代码使用 Next Webpack 构建成功。

未执行事项及原因：

- 本阶段无剩余必做项。审计报告已回填，最终验证报告已创建，最终 TypeScript/lint/diff 校验通过；专属 55432 容器已停止并由 `--rm` 删除，3012 无 listener，临时副本已移动到系统废纸篓以便恢复。
- 用户已有 3000 listener（PID 56133）与 Docker 5433 映射保持运行，本阶段没有停止、替换或重启它们。Dream 工作树同时存在其他任务的订阅页改动；本阶段没有写入 Dream 文件，也不把那些 diff 归入 Story 修复。

## Round 65 — 指定 Dream 用户在 Admin 无数据的只读诊断

Optimized Prompt:

作为 PostgreSQL 数据架构师、Dream canonical identity 调试工程师和 Next.js/Refine Admin 查询链路审计者，解释为什么用户提供的指定邮箱账号在 Dream 可见业务数据，而 Admin Workspace/Story 页面显示无数据。只做证据驱动的只读诊断，不先修改代码，不写共享 PostgreSQL，不创建 Session，不修改 `ink-dream-memory`，并保留当前工作树中所有并行未提交修改。

使用 Admin 实际加载的 `.env.local` 和 Dream 当前环境配置，脱敏确认两端数据库、host/port、database、schema 与 search_path。以大小写不敏感邮箱查找 canonical `users` 记录，检查是否存在重复邮箱、用户 ID 类型、Workspace `owner_id`、Story `author_id`、Story `workspace_id`、Workspace owner 与 Story author 是否一致，以及相关状态分布。分别计算“作为 Workspace owner”“作为 Story author”“位于其 Workspace 中的 Story”三种口径，避免把作者和所有者混为一谈。不得输出 password hash、Secret、正文、settings JSON 或完整 DSN。

复现 Admin Repository 的无筛选查询和 `owner_id`/`author_id`/`workspace_id` 筛选 SQL，确认记录是否被 JOIN、状态、排序、分页或类型转换过滤。检查 `platform_users(source='ink-dream')` 投影是否存在，但它只能作为显示诊断，不能成为业务记录可见性的前置条件。核对当前 3000 Admin runtime 是否加载了最新代码、页面实际请求 resource 是 `story-workspaces`/`story-stories` 还是 legacy `stories`、当前 URL 是否残留筛选、API 状态是否为 200/401/403/500/503，以及 Refine cache 是否可能仍持有旧结果。若无法在不写共享库的前提下获得 authenticated 浏览器证据，明确该边界，不把未验证项写成事实。

最终输出必须给出确定根因或清晰分层结论：数据库层是否确有该账号数据；关系口径是否错误；Admin 是否运行旧 bundle；页面/API 是否被 Session/RBAC/筛选/缓存阻断。每个判断引用 SQL 计数、HTTP 状态或代码位置。只有在证据证明代码缺陷且用户请求包含修复时才修改；本轮用户问“为什么”，因此默认只诊断并给出最小下一步。

Optional Enhancers:

- 对同一邮箱检查 Unicode/前后空格/大小写归一化和重复记录，但不要打印其他用户邮箱。
- 若指定用户只有 Story author 数据而不是 Workspace owner 数据，明确说明两个页面的预期差异。
- 对运行中的 Next 进程读取 cwd、启动时间和构建产物时间，判断是否需要重启，而不终止用户进程。

执行证据与验证结果：

- 本记录落盘前尚未查询指定账号或检查当前 3000 runtime；后续操作必须保持数据库只读。

### Round 65 执行结果

- Admin 与 Dream 均指向本机 5433 的 `ink-memory`/`public`；服务端 `search_path="$user", public`。全部 SQL 均在 `BEGIN READ ONLY` 中执行。
- 指定邮箱大小写/空格归一后唯一匹配 canonical `users.id=28`，无重复身份。该用户拥有 1 个 `active` Workspace（“默认工作区”），Workspace owner 关系健康，`platform_users(source='ink-dream')` 投影存在。
- 该用户作为 author 的 canonical Story=0；其 Workspace 内 Story=0、Character=0、Scene=0。Dream 当前可见活动对应 1 个 deck plugin binding、4 个 `queued` workflow run 和 4 个 workflow token consumption，不是 `story_workspace_stories` 记录。
- Admin Repository 等价 Workspace LEFT JOIN + `owner_id=28` 返回 1 行；该 Workspace 按 Admin 默认 `updated_at DESC` 排名第 1，必在首屏 12 行内。Story `author_id=28` 返回 0 是正确结果。
- 当前 3000 Next runtime cwd 为本 Admin 仓库，启动于 2026-08-10 00:07:45；`.next/dev/trace` 已出现 canonical `/api/admin/story-workspaces`、`/api/admin/story-stories`，并出现该目标 Workspace 的 get-one 请求，说明运行实例已经走新 Resource。未认证只读 HTTP 对 users/workspaces/stories 均为 401 `ADMIN_AUTH_REQUIRED`；为避免写共享 Session，没有冒用或创建 authenticated cookie。
- 确定结论：Dream 展示的是 Workspace/queued workflow 活动，而不是已落入 canonical Story 表的剧本。Admin Story 页为 0 不是漏查；Admin Workspace 页按数据库和 Repository 必须为 1。若用户浏览器中 Workspace 仍显示 0，剩余原因限定在该浏览器的 Session/URL 筛选/短期 Query cache 或具体 API 错误，而非数据库、JOIN、分页或当前 Resource 代码。

## Round 66 — Dream 页面可见“剧本”与 canonical Story 表差异追踪

Optimized Prompt:

作为 Dream 前端数据流调试工程师、FastAPI/PostgreSQL Repository 审计者和 Admin Story 数据架构师，回答指定账号为什么在 Dream 页面看得到“剧本”，而 Admin `/admin/story/stories` 没有数据。上一轮已经只读证明该账号拥有 1 个 Workspace、4 个 queued workflow run，但 `story_workspace_stories` 为 0；本轮不得直接把 Dream UI 数据等同于 workflow，必须继续追踪 Dream 实际页面的数据来源并给出代码与运行证据。

`ink-dream-memory` 只允许读取。定位用户所见“剧本”相关路由、组件、hook、状态容器、API client、FastAPI route/service/repository 和 SQL；查明列表项来自 `story_workspace_stories`、`story_projects`、workflow/session、chat/memory、浏览器 localStorage/IndexedDB、mock fixture，还是另一个后端/数据库。核对当前 Dream frontend/backend listener 的 cwd、端口、启动环境和 API base URL，确认是否与 Admin 同一 5433/`ink-memory`。不得输出 Cookie、JWT、Secret、正文、完整 DSN 或其他用户数据。

对指定账号只做 count/ID/状态级只读验证：对比 Dream 页面 API 合同中的剧本 ID/Workspace ID 与 PostgreSQL canonical Story ID；检查是否存在旧表、兼容表、JSON payload、workflow output 尚未 materialize、前端 optimistic/local draft 或缓存。若 Dream 页面从浏览器本地状态显示条目，明确其持久化 key 和同步条件；若 API 返回条目但 canonical 表为 0，继续追到真实查询源；若需要 authenticated 浏览器证据但无法安全复用用户 Session，明确该边界并用源码、运行配置和数据库证据缩小结论。

同时检查 queued workflow 为什么可能被 Dream UI 命名为“剧本”，但本轮只诊断，不修改 worker、数据或代码。最终回答必须区分：Dream UI 可见对象的真实类型、Admin Story 的 canonical 定义、两者未同步/未 materialize 的准确断点，以及用户可执行的最小验证步骤。不得用“可能是缓存”替代代码或 SQL 证据。

执行证据与验证结果：

- 本记录落盘前已知 canonical Story=0、queued workflow=4；尚未证明 Dream UI 所见列表的具体数据源。

## Round 67 — Enabled 模型全员可见可用与 Entitlement 解耦

Optimized Prompt:

作为 PostgreSQL/Token Subscription 架构师、AI Gateway 架构师、FastAPI/Python 工程师、Next.js/React 工程师和 UI 状态设计负责人，修复 Dream 模型设置中的两个真实问题：Free v3 已加入 `hy-preview`，但现有 Free v2 用户仍不能选择；Admin AIModelRegistry 中所有 `enabled=true` 的模型必须对每个已认证 canonical 用户可见，并且不能因为没有绑定某个 Subscription Plan Entitlement 就被标记为“当前维护中”或禁止 Dream 使用。

采用新的明确产品合同：Subscription Plan 负责用户级月度 Token Allowance、续期与可选的模型级 RPM/日/月 Token 限制；Plan Entitlement 不再充当 Admin enabled 模型的强制白名单。公共目录以 Admin `ai_models.enabled=true` 为可见集合；在 Provider、有效定价、canonical 用户、Subscription 状态、当前周期 Token Allowance 和显式 `user_model_permissions` 均满足时，enabled 模型即为 `callable=true / included`，即使当前 Subscription Plan Version 没有该模型 Entitlement。若存在 Entitlement，继续读取其更严格的模型级限额；若不存在则使用 Subscription Allowance 与 Gateway 自身限流，不得伪造 Entitlement。Gateway Request 允许 `subscription_entitlement_id` 为空，但 Subscription、Plan Version、Allowance、reserve/capture/release 与 Token Ledger 必须继续真实记录并保持历史不可变。

`maintenance` 只能表达 enabled 模型的真实运行依赖未就绪（例如 Provider Secret/路由或有效定价缺失）；“未绑定套餐”“仍在旧 Free Plan Version”“没有 Entitlement”不得映射为 maintenance。Admin Registry 对 enabled 模型始终说明“公共目录可见”；未绑定已发布 Messages Entitlement 只作为可选限额配置提示，不得称为维护或阻止 Dream 使用。`enabled=false` 不进入公共 enabled catalog；已保存 alias 后停用仍返回 409 并要求重新选择。

先用只读 PostgreSQL 证据确认 `hy-preview` 的 enabled/Provider/定价、Free v1-v3 Entitlement 和现有 Subscription 指向，再最小修改 Admin `/v1/models` availability evaluator、Gateway subscription resolver、nullable Entitlement request snapshot、AIModelRegistry 文案及测试。Dream BFF 继续严格校验安全 DTO；设置页加载全部 enabled models，真实 callable 模型可保存，未授权/额度耗尽/运行依赖异常显示准确原因。不得更新现有 Subscription 的 `plan_version_id`、Allowance provenance、Usage、Ledger、Audit 或历史 Event；本轮不通过重置 Free 周期来“修复”旧用户。

验收标准：只读数据库证明 `hy-preview` enabled、Provider/定价 ready、Free v3 包含它而 28 个现有 active Free Subscription 仍在 v2；修改后这些用户无需重置余额即可在 catalog 中获得 `hy-preview callable=true`，完全未绑定 Plan 的 enabled `deepseek-v4-pro` 同样可见且在资格满足时可调用；无 Subscription 为 `subscription_inactive`，额度耗尽为 402/`allowance_exhausted`，显式模型拒绝为 403/`permission_denied`，Provider/定价异常才为 `maintenance`。Admin focused tests、Dream backend/frontend tests、typecheck/lint/build 和真实本机 `/api/gateway/models`、Settings 保存、Claude Agent Gateway reserve/capture/release/Token Ledger 验证通过；普通用户仍不能访问 Admin Registry，Secret 不进入 DTO、日志或页面。

Optional Enhancers:

- 在 Gateway `subscription_snapshot` 中记录 `entitlementSource: "plan" | "allowance-only"`，便于审计不带 Entitlement 的调用，同时不暴露内部套餐路由给浏览器。
- 为 enabled 但无 Plan binding 的模型增加长期回归测试，防止后续又被误映射为 maintenance。
- 在 Admin Registry 将“已绑定套餐限额”改为独立提示，避免运营人员误以为模型可见性依赖套餐绑定。

范围变化：

- 用户明确取消“未绑定 Subscription Plan 就不能在 Dream 使用”的限制；本轮据此将 Entitlement 从强制模型白名单改为可选模型级限额来源。Token Allowance、Subscription 状态、显式模型权限和真实 Gateway 计量仍是强制资格。
- 不再迁移 28 个现有 Free v2 Subscription 到 v3；这样避免重置当前周期、改写 Allowance provenance 或历史 Ledger。Free v3 仍用于新用户默认额度/默认模型与后续周期版本语义。

执行证据与验证结果：

- 本机专用 `ink-memory/public` 只读审计：`hy-preview` 为 enabled，Provider active 且 Secret 字段非空，active pricing ready；Free v3（published）仅绑定 `hy-preview`，但 28 个 active Free Subscription 全部仍指向 v2。Free v1 的 28 条历史 Subscription 为 cancelled。
- enabled 模型共有 `deepseek-v4-flash`、`deepseek-v4-pro`、`hy-preview`；其中 `deepseek-v4-pro` 没有任何 published Plan binding，但 Provider/定价 ready。现有 SQL 因 `entitlement_id IS NULL` 将它映射为 maintenance，确认可见性/可调用资格与 Plan binding 被错误耦合。
- 当前实现尚未修改；后续必须先完成本记录再进入实现。

失败尝试及根因：

- 首次只读 SQL 使用了不存在的 `ai_models.name`、旧 Provider/Plan 字段名，PostgreSQL 返回 42703；随后通过 `information_schema.columns` 核对真实字段为 `display_name`、Provider `status/api_key_ciphertext`、Plan Version `version_number/allowance_tokens` 后重跑成功。事务为 READ ONLY，未产生数据写入。

未执行事项及原因：

- 代码实现、测试、真实 Settings 保存和 Gateway 计量验证需在本 Prompt Architect 记录之后执行。

### Round 67 执行结果

- 根因已确认：`hy-preview` 本身为 enabled、Provider active、Secret 配置存在且 active pricing ready；Free v3（published）包含 `hy-preview`，但 28 个现有 active Free Subscription 全部仍固定在 v2。旧 catalog/推理 SQL 又把当前 Plan Version Entitlement 当作模型白名单，因此截图中的现有 Free 用户看到 `需要 free 套餐` 且不能选择；完全没有 Plan binding 的 enabled `deepseek-v4-pro` 同样被误报为 maintenance。
- 新合同已在 catalog 与真实推理资格两处同步实现：所有 `ai_models.enabled=true` 模型进入每个 authenticated canonical 用户的目录；没有 Entitlement 时，只要 Subscription/周期/Allowance/显式 Model Permission/Provider/定价满足，返回 `included` 并允许调用。存在 Entitlement 时继续使用其 RPM、daily/monthly Token 限额；不存在时 `subscription_entitlement_id=NULL`，Gateway Request snapshot 标记 `entitlementSource=allowance-only`，Allowance、Plan Version、reserve/capture/release 和 Token Ledger 仍真实记录。
- 没有迁移 28 个 Free v2 Subscription，也没有更新其 `plan_version_id`、Allowance grant/provenance、Usage、Ledger、Audit 或历史 Event。Free v3 继续用于新用户默认版本；本轮通过解除错误白名单耦合使当前用户立即使用 enabled 模型，避免重置月度周期或赠送第二份额度。
- Admin Registry 文案不再把“未绑定已发布 Messages Entitlement”称为“当前维护中”；enabled + runtime ready 显示公共目录可见、有效 Token 额度可调用，并把 Plan Entitlement 仅描述为套餐级模型限额配置。disabled 模型仍不进入公共目录，Admin RBAC 未改变。
- 真实 BFF `GET http://127.0.0.1:5173/api/gateway/models` 返回 200；命名本机测试用户收到三个 enabled 模型：`deepseek-v4-flash`、无任何 Plan binding 的 `deepseek-v4-pro`、`hy-preview` 均为 `callable=true / included`，默认 alias 保持 `deepseek-v4-flash`。DTO 未包含 upstream model、Provider 路由、密钥或定价内部字段。
- 真实 Playwright 通过 3/3：1440×1000 与 390×844 均加载三个真实模型，`hy-preview` 可用 radio 选择并通过真实 `PUT /api/system-config` 200 保存；无 API 4xx/5xx、console error、pageerror、requestfailure 或 document 横向溢出。Dream bearer 访问 Admin model API 为 401/403。Source Playwright contract 另通过 2/2。截图保存在 `ink-dream-memory/frontend/output/playwright/round67-settings-{desktop-1440x1000,mobile-390x844}.png`（gitignored）。
- 真实 Claude Agent 使用已保存 `hy-preview` 建立 SSE 为 HTTP 200，Gateway eligibility 成功进入 Provider：相对基线新增 8 个 `hy-preview` Gateway Request，全部 settled、`subscription_entitlement_id=NULL`、Allowance FK 非空；Token Ledger 新增 8 reserve + 8 release，金额各 352,712 Token，净占用为 0，证明缺 Entitlement 不再阻断且上游失败不会误扣额度。
- 上述 SSE 未获得 finish frame：`hy-preview` 上游连续返回 HTTP 429 `UPSTREAM_RATE_LIMITED`，SDK 自动重试；为避免继续制造无意义请求，主动中断客户端并调用 thread stop API 200。该失败发生在真实 Provider dispatch 之后，不是目录、保存、Subscription、Entitlement、Allowance 或 Gateway settlement 回归；在上游限流解除前不得声称“真实 hy SSE 完整成功”。
- 验证通过：Admin `pnpm env:check`；67/67 test files、330/330 tests；`pnpm exec tsc --noEmit`；`pnpm lint`；`pnpm build`。Dream backend focused 21/21；frontend source Playwright 2/2、real browser 3/3；frontend lint 0 errors（保留既有 21 warnings）与 production build 通过。两仓 `git diff --check` 通过。
- 失败尝试：首次 BFF 复测为 Vite 502，检查确认 5173 正常而 8765/3000 无 listener；启动本轮自有 Dream backend/Admin dev 后同一请求变为 200。前端 source contract 首次误用 Vitest，因测试文件使用 `@playwright/test` 被 runner 拒绝；改用 repository-local Playwright 后 2/2。Ledger 基线首次误查不存在的 `token_delta`，核对 schema 后改为 `amount_tokens`。Playwright 默认清理 tracked `test-results`；已只恢复运行前未修改的 tracked 目录，并把本轮证据复制到 gitignored output，未覆盖其他改动。
- 清理确认：本轮启动的 3000 Admin 与 8765 Dream backend 已停止，测试 thread stop 返回 200；用户原有 5173 listener（PID 23000）保持运行。本轮没有输出 DSN、JWT、Gateway Key 或 Provider Secret 内容。

未执行事项及原因：

- `hy-preview` 上游成功内容/SSE finish、capture 与 consumed Token 增量尚未完成，唯一阻断为 Provider 429。当前已有真实 eligibility、reserve、settled failure 和等额 release 证据；待上游解除限流后应只重跑命名用户的一次 Claude Agent SSE，并核对新增 request HTTP 200、capture/release 和 consumed ledger。
- 真实支付、Dream/is Dreaming 商业开通不在本轮模型可见性修复范围内。

### Round 66 执行结果

- Dream 5173 frontend 与 8765 backend 均从 `ink-dream-memory` 当前仓库运行；Vite `/api` 代理到 8765，backend 指向同一 5433/`ink-memory`，排除不同数据库。
- Dream 的“故事管理”路由确实调用 `/api/story-workspace/stories`，backend 同样查询 `story_workspace_stories WHERE author_id=<current user>`；因此该正式列表对用户 28 也应为 0，不存在另一张数据库 Story 表。
- 用户实际可见的“剧本”来自 Dream run execution 的 Episode artifact reader：frontend 调用 `/api/story-workspace/workflow-runs/{runId}/episode-artifacts`，gateway 解析 run 的 thread workspace，然后由 `StoryWorkspaceEpisodeArtifactService` 读取工作区 `stories/<project>/episodes/EP01/script.md` 等文件。
- 只读文件元数据证明该用户 4 个 thread workspace 中有两套非空 `EP01/script.md`（同时有 outline/storyboard/review 等 artifact）；没有读取或输出正文。PostgreSQL canonical Story/Character/Scene 仍均为 0。
- 准确断点在 `backend/claude_agent/service.py`：常规 Agent 的完整 JSON Story bundle 会调用 `store_agent_story_output` 写入 `story_workspace_stories`，但请求带 `story_workspace_dream_context` 时 `_store_story_workspace_output` 直接 `return None`。Episode artifact 写入文件系统后没有任何现有代码把 `script.md` materialize/upsert 到 canonical Story 表；全仓库生产插入该表的代码仅在 `services/story_workspace/agent_integration.py`。
- 确定根因：Dream execution UI 和 Admin Story 使用两套尚未桥接的持久化模型。Dream 读 thread filesystem artifact，Admin 按项目约束读 PostgreSQL canonical Story；Dream-mode persistence 被代码显式跳过，导致“Dream 有剧本文件、Admin 无 Story 行”。这不是 Admin 筛选、缓存、JOIN 或数据库连接问题。

## Round 68 — Dream Artifact 与 PostgreSQL Story 索引只读审计

Optimized Prompt:

以资深跨系统产品架构师、PostgreSQL 数据架构师、文件型 Artifact 系统架构师、Next.js/Refine 与 FastAPI/Python 工程负责人身份，对 `/Users/dmeck/project/ink-admin-memory` 和 `/Users/dmeck/project/ink-dream-memory` 执行严格只读、证据驱动的 Story Artifact → PostgreSQL 索引同步审计。本阶段只允许读取源代码、配置、Git 状态、文件元数据和对本机 `localhost:5433/ink-memory` 的只读 SQL；除本工作记录和目标审计文档外，不修改代码、schema、migration、Artifact 或数据库，不执行 materialization、reconcile、import、backfill、清理或任何共享数据写入。

完整追踪 Dream execution 链路：`useStoryWorkspaceEpisodeArtifacts` → `/api/story-workspace/workflow-runs/{runId}/episode-artifacts` → `StoryWorkflowGateway` → `StoryWorkspaceEpisodeArtifactService` → thread filesystem 中 `script.md`、`episode-outline.md`、`storyboard.yaml`、`review-report.md`；以及 Admin 链路：`StoryResourceView` → `AdminResourceManager` → Refine `useList` → `/api/admin/story-stories` → story-source repository → `story_workspace_stories`。每个结论必须引用精确文件与行号，并记录关键请求、字段、身份和错误传播方式。

通过配置与只读运行证据确认两应用是否连接同一 PostgreSQL、Dream frontend API base URL/Vite proxy、Artifact Workspace Root、以及 User/Workspace/Story/Run/Thread/Project/Episode 的真实身份关系。追踪 `script.md`、project manifest、episode manifest 与 revision 的实际生成和读取来源，列举所有会 INSERT/UPDATE/UPSERT `story_workspace_stories` 的代码，解释 `story_workspace_dream_context` 为何跳过 `store_agent_story_output`，并搜索其他自动同步、reconcile、import 或 materialization 路径。比较 Workflow Run 状态与 Artifact 状态，判断同一 Project 多 Episode 到 canonical Story 行的幂等映射，以及现有 `content` 字段的兼容边界。

在不输出正文、绝对线程目录、Secret、JWT、Provider Key、密码散列或个人数据的前提下，对 PostgreSQL 和受控 Artifact 元数据做只读盘点：现有 Story 行数量、可发现 Project/Episode 数量、文件存在但无索引、索引存在但文件缺失、revision 不一致、一对多、重复、稳定身份冲突、缺失 Workspace/User/Run 关系。若配置或权限不足以安全关联，明确写出已验证事实、阻断点和不能宣称的数量，不以猜测代替证据。不得跟随不受信任 symlink 或将用户输入拼接为文件路径。

将结果写入 `docs/verification/story-artifact-index-sync-audit.md`，明确回答：根因是否为 Artifact materialization 缺失而非 Admin 查询错误；文件系统与 PostgreSQL 的权威边界；推荐同步写、异步 reconcile 或组合方案；是否需要扩展 canonical `story_workspace_stories` 并生成 Drizzle migration；是否需要一次性历史 dry-run/回填；Dream 与 Admin 各自的实现责任。报告包含证据表、现状数据流、身份映射、差异计数与置信度、风险、后续设计输入和“本阶段未修改共享数据”的确认。

Acceptance Criteria:

- 两条端到端链路均有文件/符号/行号证据，无关键跳步。
- 数据库、frontend proxy、Workspace Root 与身份关系都有配置或只读运行证据。
- 所有 Story 索引写入点与 Dream context 跳过逻辑已穷举搜索并分类。
- 差异数量来自只读 SQL 与安全文件元数据；无法验证者明确标为 blocked/unknown。
- 形成同步策略、schema migration、历史回填和仓库职责的确定性判断及理由。
- 不修改业务代码、两个仓库既有未提交修改、Artifact 或共享 PostgreSQL 数据。

Optional Enhancers:

- 为未来对象存储迁移记录 `ArtifactGateway` 可移植接口所需的资源 ID、revision、allowlist、ETag 与分段读取合同，但不在审计阶段实现。
- 用脱敏哈希或计数关联 Artifact 与索引，避免在审计文档中泄露内部路径和 Story 正文。

执行证据与验证结果：

- 已创建 `docs/verification/story-artifact-index-sync-audit.md`，逐段追踪 Dream Episode Artifact 与 Admin Story PostgreSQL 两条链路，并引用当前源码位置。
- 根因确定为 Dream Artifact metadata materialization 缺失：Dream context 在 `backend/claude_agent/service.py` 解析 Story JSON 前直接跳过旧 `store_agent_story_output`，而 Episode Artifact completion 没有替代 projector/reconcile；Admin list 与 total 都直接查询同一 `story_workspace_stories`。
- 两应用配置均指向本机 5433/`ink-memory`；Dream Vite `/api` 代理 8765，Artifact Workspace Root 由 `AGENT_CWD` 指向仓库内 `backend/data/agent-workspace`。
- 安全文件元数据盘点：1,196 个 thread 目录、7 个 project manifest（5 合法/2 无效）、5 个缺 manifest 的 project 目录、39 个 Episode 目录、3 个非空 script、3 个合法 v1 Episode binding、3 个可安全读取的 bound surface、3 个不同 script/manifest revision；canonical Artifact 位置 symlink 为 0。未读取或输出正文、run/thread/project identity 或绝对线程路径。
- 实时 PostgreSQL差异 SQL 被当前基础设施阻断：Docker 端口仍监听 5433，但 PostgreSQL handshake 在 3 秒超时。报告将当前 DB Story/mismatch/orphan 标为 unknown，并只把 Round 66 已成功记录的指定用户 Story=0、文件存在证据标为历史证据，不冒充当前快照。
- 审计判断需要扩展 canonical `story_workspace_stories` 并由 `app/lib/db/schema.ts` 生成 migration；新 Artifact-sourced 行不复制完整 `script.md` 到 `content`；同步采用 completion 后立即幂等 upsert + 启动/定时/显式 reconcile 的组合方案。
- `git diff --check` 通过；本阶段只修改工作记录和审计文档，没有修改业务代码、Schema、Migration、Artifact 或共享 PostgreSQL 数据。

未执行事项及原因：

- 未完成当前 PostgreSQL总 Story、文件/索引 mismatch、revision conflict 与 orphan 的实时数值，因为共享 5433 当前连接超时，且本阶段禁止启动/修复共享数据库。
- 未执行 Schema、migration、materializer、reconcile、Admin Artifact client、UI、测试写入或历史回填；这些属于设计审核通过后的实现阶段。

## Round 69 — Story Artifact/Index 跨系统 PRD、架构与交互设计

Optimized Prompt:

作为资深产品架构师、PostgreSQL 数据架构师、文件型 Artifact Gateway 架构师、Next.js/Refine 管理后台设计负责人、FastAPI/Python 服务架构师和响应式 UI/UX 负责人，在 Round 68 只读审计已经证明“Dream 文件 Artifact 可见、canonical PostgreSQL Story 索引 materialization 缺失”的基础上，只完成可供用户审核的 PRD、跨系统架构和 Admin/Dream 交互设计。设计完成后立即暂停，禁止进入 Schema、migration、业务代码、测试 fixture、共享数据库写入或历史回填。

先更新主 PRD `docs/prd/ink-memory-admin-prd-v3.md` 中 Story 数据运营相关章节，清晰区分 Current、Target、Release Gate：文件/对象存储 Artifact 是 script、outline、storyboard、review 的内容真源；`story_workspace_stories` 是可检索、可关联、可审计、可分页的 metadata index；Dream 是 Artifact 与索引唯一业务写入方；Admin 是 PostgreSQL index 与受控 Artifact preview 的只读运营入口，只保留经过领域边界确认的审核命令。不得把设计状态写成 Implemented。

创建并完成：

1. Admin `docs/architecture/story-artifact-index-sync-architecture.md`：定义 User/Workspace/Run/Thread/Project/Episode/Story identity、稳定 upsert key、最小 Story schema 扩展、revision/status state machine、同步触发、file-success/DB-failure recovery、启动/定时/显式 reconcile、dry-run/backfill、崩溃恢复、审核历史保护、服务间鉴权、错误合同、安全边界和可迁移 `ArtifactGateway` 接口。禁止第二张 Story 表、正文复制、绝对路径和 Admin 直读 filesystem。
2. Admin `docs/design/story-artifact-admin-interaction-design.md`：定义 `/admin/story/workspaces`、`/admin/story/stories` 的列表、筛选、排序、total、独立 DB/Artifact loading、Detail Drawer、Episode/allowlist artifact selector、分段预览、ETag/304、diagnostics/retry intent、401/403/404/409/413/422/500/503、Dream/FS unavailable、1440×1000 与 390×844、键盘/焦点/屏幕阅读器/无横向溢出。Admin 不编辑正文、路径、真实文件关系或 Dream run directory。
3. Dream `docs/design/story-artifact-index-sync-design.md`：定义 execution 页的双状态反馈（文件生成与索引同步分离）、indexed/stale/missing/failed/retry 状态、materializer/reconcile 入口、internal Artifact read API、service identity、Range/cursor/ETag、allowlist/size/path/symlink/TOCTOU/cross-tenant 防护，以及历史 dry-run UX/CLI receipt。不得把“文件写入成功”显示为“后台已同步”。

PostgreSQL设计优先扩展现有 `story_workspace_stories`，明确字段类型、nullability、default、check、index/unique/FK、public exposure 与写入方；至少评估 artifact source、source run/internal thread ref、project identity/slug、episode count、manifest/script revision、sync status、indexed timestamp、安全错误码、size/availability、reconcile version。稳定 Story identity 使用 Workspace + canonical project identity，重复相同 revision 为 no-op，新 revision 更新同一 Story，不因 run/thread/Episode 重复插入；多个 Episode 聚合为一行 Project Story。

明确文件与 DB 无法原子提交的处理顺序和失败矩阵：安全落盘、计算 revision、解析 metadata、持久化 file-side sync intent、幂等 DB upsert、记录成功/失败、前端分别返回 artifact/index status。设计同 revision 去重、并发锁、CAS/optimistic guard、新 revision 不破坏审核历史、DB down 时文件仍可读、file missing 时 index 显示 degraded、revision mismatch 返回 409、Dream service down 时 Admin DB 仍可用。

设计必须给出端到端 API/DTO 样例，但不得包含 absolute path、thread root、Secret、JWT、Provider Key、stack 或正文。Route Handler 只承担 Session/RBAC/service auth/Zod/编排；SQL/事务/文件安全/同步逻辑位于 Service/Repository。为 Artifact Gateway 定义本地 FS 与未来 S3 兼容接口：resource IDs、revision、allowlist artifact enum、metadata stat/list、byte slice/cursor、ETag/If-None-Match、Range 与错误映射。

验收前对四份文档执行一致性复核：职责表、字段表、状态机、序列图、API错误、Admin/Dream页面文案和测试映射不得相互矛盾；明确列出实现阶段文件计划、migration预期、25项测试追踪、dry-run acceptance、未执行生产回填和需要用户审核的决策。完成设计后更新 Round 69 执行结果并暂停，向用户提交文档链接和关键决策清单，等待明确批准；不得自行进入代码实现。

Acceptance Criteria:

- 主 PRD、跨系统架构、Admin 交互、Dream 同步/交互四份文档完成且状态标为 Target/Proposed，不冒充实现。
- 单一 canonical Story 表、Dream 唯一业务写入、Admin 受控只读、Artifact 内容真源边界无矛盾。
- Schema 字段/约束、稳定 identity、状态机、sync+reconcile、file-side recovery intent 与历史 dry-run 有可实现合同。
- Admin/Dream DTO 不暴露路径或 Secret；Artifact API 有 service auth、allowlist、ETag、Range/分页、大小和 tenant guards。
- 25项测试与双视口验收逐条映射到设计入口。
- 设计完成后停止，不修改业务代码、Schema、migration、测试数据或共享数据库。

Optional Enhancers:

- 增加 ADR 风格的备选方案比较，解释为何不选“Admin 扫目录”“完整正文入库”“只做定时扫描”或“每 Episode 一行 Story”。
- 为未来对象存储切换增加 capability matrix，确保 local filesystem 与 S3 adapter 对 resource identity/revision/Range/ETag 语义一致。

范围变化：

- 用户明确要求在 Admin 与 Dream 后续改造方案设计完成后暂停审核；本 Round 将交付边界固定在文档设计，不进入代码实现。

执行证据与验证结果：

- 当前尚未执行；必须先完成本 Prompt Architect 记录和更新计划。

未执行事项及原因：

- Schema、migration、Dream/Admin代码、隔离PostgreSQL、Playwright、历史回填和生产数据操作全部等待用户审核设计后再决定。

### Round 69 执行结果

- 已将 `docs/prd/ink-memory-admin-prd-v3.md` 更新为 v3.5，并把 Story Artifact/Index 改造标记为 `Proposed / Awaiting review`。PRD 明确区分旧的列表可见性纠偏与本轮 materialization 缺口，新增 Current/Target/Release Gate、双层权威边界、字段/页面目标、历史计数时效和“审核前不得实现”的门禁。
- 已创建 `docs/architecture/story-artifact-index-sync-architecture.md`。方案确定文件/未来对象存储为内容真源，`story_workspace_stories` 为唯一 metadata index；Dream 唯一写 Artifact/index，Admin 不解析目录或直写来源字段。稳定键为 Workspace + `dream_episode` + canonical Project identity，一 Project 多 Episode 聚合为一 Story；相同 revision no-op，新 revision 更新同一行且不覆盖 review/status/history。
- 架构方案定义了现有 Story 表的最小扩展、nullable 旧行兼容、部分唯一索引、revision/check/index、确定性 Story ID、`content=NULL`、文件侧 durable sync receipt、即时 materialize + recovery/scheduled/explicit reconcile、崩溃矩阵、dry-run/apply digest 门禁、服务 JWT、allowlist/Range/ETag、安全错误与 25 项验证映射。没有新增第二张 Story 表。
- 已创建 `docs/design/story-artifact-admin-interaction-design.md`。Admin Story 列表以 PostgreSQL total 为唯一列表计数，展示 Project/Episode/Artifact/revision/index/review/business 状态；详情使用“PostgreSQL 索引 / Artifact 内容”双轨事实条，DB 与 Dream 内容独立加载，按 Episode/allowlist 文件有界预览。定义了 401/403/404/409/413/422/500/503、Dream/文件系统不可用、last-good、cache invalidation、键盘/读屏以及 1440×1000、390×844 布局。
- 已在 Dream 仓库创建 `docs/design/story-artifact-index-sync-design.md`。Dream execution 明确区分文件生成和后台索引状态；文件提交后持久化 receipt 并触发新 metadata materializer，旧 `store_agent_story_output` 可继续跳过完整 JSON/content，但不能绕过新 projector。方案包含 Project 聚合 revision、Repository upsert、reconcile、internal Artifact API、服务/用户双身份、安全文件读取、重试/轮询、Stories 待同步分区和隔离测试计划。
- 按 `frontend-design` 指引复用现有暖纸色运营工作台语言，没有引入新的装饰性设计系统；将“双轨事实条”作为本模块的高辨识度、非装饰性核心组件，用于同时表达 DB index 与 Artifact content 两条事实。
- 补充 ADR 备选判断，明确拒绝 Admin 扫目录、完整正文入库、仅请求内同步、仅定时全盘扫描和一 Episode 一 Story；补充 Local filesystem/S3 adapter 在 identity、revision、Range、原子提交与 receipt 方面的 capability matrix。
- 一致性复核覆盖权威所有权、字段、状态、revision、错误码、服务身份、Path traversal/Symlink/TOCTOU/大小/跨租户、dry-run、25 项测试和双视口。Admin/Dream/架构均使用 `syncing/indexed/stale/missing/failed` DB 状态，并把 DB 完全不可用时的 pending/failed 事实保存在文件侧 receipt。
- `git diff --check` 与对 4 个未跟踪新文档的 `git diff --no-index --check` 均通过。文档共 2,042 行（PRD 183、审计 268、架构 556、Admin 交互 407、Dream 设计 628）；仅做文档静态校对，没有运行不适用于文档阶段的 build/测试。
- 当前待用户评审的主要决策：是否增加 `reviewed_script_revision`；默认 64 KiB/单次最大 256 KiB/单 Artifact 1 MiB 的预览上限；Operator 或仅 Super Admin 拥有 reconcile；移动端摘要行；首版纯文本还是安全 Markdown；receipt 逻辑位置/保留期与 reconcile 扫描预算。

未执行事项及原因：

- 按用户要求已在 Admin/Dream 后续改造方案完成后暂停。没有修改业务代码、`app/lib/db/schema.ts`、migration、测试 fixture、Artifact 或共享 PostgreSQL；没有执行 reconcile、import、backfill 或任何数据写入。
- 没有重新尝试或修复共享 5433 PostgreSQL；Round 68 中 DB 联合 dry-run 数量仍为 unknown，文件侧只读基线保持 5 个有效 Project manifest、39 个 Episode 目录、3 个严格可索引 Story 候选。
- Dream 仓库既有未跟踪 `.claude/worktrees/` 保持原状，没有覆盖或回滚两仓已有修改。
- 下一步必须等待用户对 PRD、跨系统架构与两端交互方案的明确审核结论；未获批准不得进入实现阶段。

## Round 70 — 共享 Artifact Root 的简化同步方案与两端实现

Optimized Prompt:

作为资深产品架构师、PostgreSQL/Drizzle 数据架构师、共享文件系统安全架构师、FastAPI/Python 工程师、Next.js/Refine 工程师和 UI/UX 负责人，根据用户的最新评审结论，把 Round 69 的跨服务 Artifact API 方案收敛为“Admin 与 Dream 读取同一个 Artifact Root；Dream 对文件系统读写，Admin 仅以操作系统权限只读；两端连接同一个 PostgreSQL canonical Story 表”的最小可靠架构，并实现、测试和验证。用户的最新指示覆盖此前“Admin 必须通过 Dream 服务 JWT/API 读取”的设计选择，但不放宽浏览器不得提交任意路径、不得暴露绝对路径/Thread Root/Secret、不得新增平行 Story 表、不得操作共享真实数据等安全约束。

先更新 Round 69 的主 PRD、跨系统架构、Admin 交互和 Dream 设计，使其明确：共享 `ARTIFACT_WORKSPACE_ROOT`/等价配置是部署前提；Dream runtime 对根目录拥有 read-write，Admin runtime 只拥有 read-only；PostgreSQL 只保存 stable identity、内部相对 Artifact locator、revision、Episode count、availability/status 和安全诊断；浏览器只提交 Story ID、Episode ID、ArtifactKind，不接收或拼接路径。删除首版服务间 Artifact HTTP API、服务 JWT、独立 Gateway deployment、S3 adapter、durable receipt 状态机和复杂跨服务缓存；保留可迁移接口为 Deferred，而非本轮实现。

实现最小一致性链：Dream 使用 canonical Workspace + Project identity 生成稳定 Story ID，安全原子写入/确认 Project/Episode Artifact 后计算 manifest/script revision，并幂等 upsert 现有 `story_workspace_stories`。相同 revision no-op，新 revision 更新同一 Story，多 Episode 聚合一行，新 Artifact Story 的 `content` 为 NULL；projector 不覆盖 review status、business status、review notes、confirmed/published 时间或历史 Audit。文件成功但 DB upsert 失败时，Project/Episode manifest 本身作为恢复依据，Dream UI 返回 `artifact=available/index=failed`；实现有界 startup/explicit/periodic reconcile，从 canonical Run/Workspace/Thread 关系发现 manifest，并补建 missing/stale index，不新增 file-side receipt。

Admin 扩展唯一 Drizzle 来源 `app/lib/db/schema.ts` 并生成 PostgreSQL migration，只修改现有 `story_workspace_stories`。最小列至少包含 `artifact_source_type`、`source_run_id`、`source_thread_ref`（server-only）、`source_project_id`、`source_story_slug`、`artifact_relative_key`（server-only relative locator）、`episode_count`、`artifact_manifest_revision`、`script_revision`、`artifact_sync_status`、`artifact_indexed_at`、`artifact_last_checked_at`、`artifact_sync_error_code`、`script_size_bytes`、`artifact_available`、`reconcile_version`，以及经评审采用的 `reviewed_script_revision`。增加 stable-key partial unique index、revision/status/count/size checks 与查询索引，旧行 nullable 兼容；不写绝对路径、不复制正文。

在 Admin Service/Repository 层实现共享文件系统只读 Artifact Reader。Route Handler 只做 Session/RBAC、Zod 输入和编排；Reader 根据已查询 Story 行、受控共享 root、server-only relative locator、Episode ID 和 ArtifactKind allowlist 定位文件，逐级拒绝 traversal/symlink escape，防 TOCTOU，限制文件/分段大小并计算 ETag/revision。Admin 列表继续只读 PostgreSQL，支持 Artifact health/project/revision/index time 的筛选、排序与准确 total；详情 Drawer 分开加载 DB metadata 和本机只读 Artifact surface/preview。禁止通用 Story metadata PATCH；保留的审核命令必须绑定 expected script revision、写 `reviewed_script_revision` 与 Audit，不能修改文件或来源关系。

在 Dream frontend execution 与 stories 页面实现文件/索引双状态，不把文件成功显示为后台同步成功；支持 indexed/stale/missing/failed、revision mismatch、受控 retry。Admin 使用现有运营后台设计语言和“双轨事实条”，覆盖 loading、DB empty/filter empty、文件未索引、索引文件缺失、409、413、422、500、503；桌面 1440×1000 和移动 390×844 无页面级横向溢出。

所有写测试只能使用显式 `TEST_DATABASE_URL`、disposable PostgreSQL、临时共享 Artifact Root 和专用 User/Workspace/Run/Project/Episode。禁止迁移、补写、清理本机共享 `5433/ink-memory`，禁止生产历史 backfill。先实现 dry-run reconcile 并报告可发现/可索引/已有/新增/更新/冲突/无效/关系缺失；本轮不得对真实数据 apply。

验证 Dream：focused backend pytest、frontend typecheck/lint/build/focused Playwright。验证 Admin：`pnpm env:check`、`pnpm exec tsc --noEmit`、`pnpm lint`、focused/full unit、`pnpm build`、隔离 PostgreSQL API/E2E、1440×1000 与 390×844 Playwright。检查 Storage、Provider、Gateway、Subscription、Billing、RBAC 不回归；两仓 `git diff --check` 通过。若完整环境依赖阻断，继续完成所有可验证部分并把环境阻断与代码失败分开报告，不得用共享数据库绕过。

Acceptance Criteria:

- Round 69 文档已收敛为共享文件系统方案，不再把服务 JWT/跨服务 Artifact API 作为首版必需组件。
- Dream 文件完成后能幂等创建/更新唯一 canonical Story index；相同 revision no-op、多 Episode 一 Story、`content=NULL`。
- Admin 与 Dream 使用同一 server-side relative locator/root 合同读取同一文件；Dream read-write、Admin read-only，浏览器/API 不出现绝对路径。
- Admin 列表只依赖 PostgreSQL；详情由本机只读 Reader 安全访问 allowlist Artifact，DB 与文件错误独立。
- 文件成功/DB 失败能由 manifest + reconcile 恢复，无 file-side receipt 状态机。
- Path traversal、symlink、TOCTOU、超大文件、非法 manifest、跨 Workspace/User/Run、ETag/304、409、413、422、503 均有测试。
- 只扩展 `story_workspace_stories`，提交 Drizzle migration，不新增平行 Story/User/Workspace 表、不引入 SQLite、不复制完整正文。
- 所有写验证均在隔离 PostgreSQL/临时 Artifact Root；生产回填未执行。

Optional Enhancers:

- 把 Python 与 TypeScript 的 path/manifest/revision 合同做成同一组 JSON golden fixtures，避免两端因语言不同发生 locator 或 revision 漂移。
- 将未来 S3/Object Store adapter 保留为接口注释和 Deferred ADR，不在共享文件系统首版增加运行时复杂度。

范围变化：

- 用户审核后明确选择“共同读取一个文件系统，路径与表记录相同”。本轮取消 Round 69 的跨服务 Artifact API、服务 JWT、独立 Gateway 和 durable receipt 首版要求，改为共享 root + Dream RW/Admin RO + manifest reconcile。
- 用户已明确要求按照简化方案更新设计稿并实现对应代码；本轮获准进入代码、Schema、migration 与隔离测试阶段，但仍未授权共享真实数据 backfill。

执行证据与验证结果：

- 当前尚未执行；必须先完成本 Prompt Architect 记录再更新计划和开始代码审计/实现。

未执行事项及原因：

- 尚未修改 Round 69 文档、Schema、migration、Dream/Admin 代码或测试；尚未执行任何数据库或 Artifact 写入。

## Round 71 — Dream 共享文件系统同步方案并行执行交接

Optimized Prompt:

作为 Dream 仓库的资深 FastAPI/Python 架构师、PostgreSQL Repository 工程师、文件型 Artifact 安全工程师、React/Vite 交互工程师和测试负责人，先仅产出一份可复制到另一执行环境的 Dream 独立实施方案，使另一位工程执行者能够与 Admin 改造并行工作。此轮不修改 Dream/Admin 业务代码、Schema 或 migration；不启动测试或写任何数据库/Artifact。方案必须采用用户已确认的简化前提：Dream 与 Admin 挂载同一个 Artifact Workspace Root；Dream 对文件系统 read-write，Admin 仅 read-only；两端连接同一个 PostgreSQL，使用同一 `story_workspace_stories` 行和同一 server-only relative locator；不建设首版跨服务 Artifact HTTP API、服务 JWT、独立 Gateway、S3 adapter 或 durable receipt 状态机。

给出 Dream 分层实现清单和建议文件所有权：Artifact commit 完成点、共享 locator/revision 合同、metadata projector、stable Story ID、PostgreSQL repository 幂等 upsert、manifest-based startup/periodic/explicit reconcile、dry-run CLI/API、execution/stories 双状态 UI、受控 retry、错误映射与 focused tests。Route 只负责身份/输入/编排；SQL/事务在 Repository，文件安全/manifest/revision 在 Service。Dream context 可继续跳过旧完整 JSON `store_agent_story_output`，但必须调用新的 metadata materializer。

定义与 Admin 并行开发的冻结合同：Admin Drizzle migration 将扩展同一 Story 表；Dream 在 migration 未应用时要 fail-closed/feature-gated，不能自行创建表或运行 DDL。列出字段名、类型、nullability、stable partial unique key、revision 格式、ArtifactKind 枚举、相对 locator 格式、状态与错误码。Dream 不得写 Admin 审核/业务字段，不得把 `script.md` 复制进 `content`，不得向浏览器返回 absolute path、thread root 或 `source_thread_ref`。

文件同步顺序必须最小可靠：安全原子提交文件/manifest，重新通过安全 fd 读取并计算 revision，构造 projection，幂等 upsert PostgreSQL，返回 artifact/index 独立状态。文件成功而 DB 失败时，canonical Project/Episode manifest 本身是恢复依据；execution 显示文件可读/索引失败；reconcile 从数据库授权 Run/Workspace/Thread 范围出发有界扫描 manifest，补建 missing/stale 行。相同 revision no-op，不改变 `updated_at`；新 revision 更新同一 stable Story；多 Episode 聚合一 Story；projector 保留 review/status/history。

测试必须只使用显式 disposable PostgreSQL 与临时共享 Artifact Root，覆盖成功、相同 revision、新 revision、多 Episode、DB 失败、reconcile 恢复、missing/mismatch、非法 manifest、超大文件、traversal、symlink、TOCTOU、跨 User/Workspace/Run、409/413/422/503、前端双状态和两视口。不得连接或补写共享 `5433/ink-memory`，不得执行生产 backfill。

输出格式必须适合直接交给另一位 Codex/工程师：目标与非目标、冻结跨仓合同、建议文件/类、实施顺序、伪代码、API/DTO、状态矩阵、测试命令、完成回传清单、并行冲突规避。明确 Admin 与 Dream 的所有权边界，要求执行者不修改 Admin 仓库、不生成 Drizzle migration、不覆盖现有未提交修改，并在完成后回传 commit/diff、migration 前置条件、测试数量和 dry-run 结果。

Acceptance Criteria:

- Dream 方案可单独复制执行，无需读取本对话才能理解目标和约束。
- 使用共享 Artifact Root 与同一 PostgreSQL Story 行，不包含跨服务 Artifact API/JWT 首版工作。
- 明确列出 Dream 所需 Story 列、stable identity、locator、revision、status/error contract，能与 Admin 并行实现。
- 文件写入、幂等 upsert、manifest reconcile 和 UI 双状态有具体文件/类/伪代码/测试入口。
- 不授权真实数据写入、生产 backfill、Admin schema 修改或新增平行 Story 表。

范围变化：

- 用户要求先提供 Dream 方案，交给其他执行环境并行处理。本轮暂停 Admin/Dream 本地代码实现，只交付 Dream handoff 方案；后续 Admin 实现等待用户继续指示。

执行证据与验证结果：

- 当前尚未执行；必须先完成本 Prompt Architect 记录，再输出 Dream 独立实施方案。

未执行事项及原因：

- 未修改 Dream/Admin 业务代码、Schema、migration、测试或共享数据；用户当前只要求先交付 Dream 方案。

### Round 71 执行结果

- 已完成 Dream 后端与前端的只读实施落点复核，并形成可复制的并行执行交接方案；本轮没有修改 Dream 仓库。
- 后端主触发点确定为 `backend/libs/claude_agent_kit/server/story_workspace_tool.py` 的 `_record_episode_workflow_completion` 统一成功尾部，而不是 Claude Agent turn 结束。现有 replay 早退必须收敛到同一 materializer tail，确保“文件成功、DB 失败”后重复 completion 可以补索引。
- 复用现有 `StoryWorkspaceEpisodeArtifactService` 的 real directory/inode pin、`openat`、`O_NOFOLLOW`、大小上限、SHA-256 与 canonical binding；复用 `StoryWorkspaceEpisodeBindingService` 的 Project ID/slug 与 v1/v2 Episode registry，不另写弱路径读取器。
- Dream 新增 Projector、Repository、Materializer、manifest-based Reconcile 与 dry-run CLI；不新增跨服务 Admin→Dream Artifact API、服务 JWT、独立 Gateway、S3 adapter 或 durable receipt。旧 Dream context 继续跳过完整 JSON `store_agent_story_output`，但 completion tail 必须调用新 metadata materializer。
- 前端索引状态使用独立 Dream 用户态 `GET/POST /workflow-runs/{runId}/story-index`，不混入现有 Episode Artifact ETag。原因是 Artifact ETag 同时用于文件 304 和 Episode action `If-Match`；混入 DB index 状态会让索引变化错误干扰创作 CAS，或被文件 304 掩盖。
- 冻结首版语义：一 Workspace + Project 一 Story；`source_thread_ref + source_project_id` 在共享 root 下派生 canonical 文件位置，不额外保存绝对路径；Story 行的 script/manifest revision 指最近成功 materialize 的 bound Episode，`episode_count` 来自 registry 实际条目数，首版不扫描最多 99 Episode 计算全 Project aggregate hash。
- 识别到 migration rollout 的 P0 风险：Dream 当前 `/stories` 使用 `SELECT *` 并直接 `_row_to_dict`，新增 `source_thread_ref` 等内部列后会自动泄露给浏览器。Dream 执行者必须先改为显式 public column allowlist，再允许 Admin migration 上线。
- Admin 仍是唯一 Drizzle migration 来源。Dream 执行者不得生成另一套 migration；Admin migration 未就绪时 materializer/reconcile fail-closed，但文件读取继续工作。Admin migration 提供后，Dream 可同步更新严格 schema baseline/generated mirror 以通过 contract verification，但这些镜像不成为 DDL 来源。
- 已给出建议文件、API/DTO、状态/错误、实现顺序、focused tests、隔离要求、并行冲突规避和完成回传清单；等待用户把方案交给另一执行环境。

未执行事项及原因：

- 未修改 Dream/Admin 业务代码、Schema、migration、测试或共享数据；未执行 PostgreSQL/Artifact 写入、reconcile apply、build 或 Playwright。
- Admin 本地实现仍暂停，等待用户完成 Dream 方案交接或明确要求继续。

## Round 72 — Admin 共享 Artifact Root 索引与只读文件访问实现

Optimized Prompt:

作为 ink-memory-admin 的资深 Next.js/Refine 工程师、PostgreSQL/Drizzle 数据架构师、共享文件系统安全工程师和 UI/UX 负责人，在 Dream 独立方案已交给另一执行环境的前提下，只实现 Admin 仓库部分，并与冻结的 Dream 合同保持一致。部署模型为：Dream 与 Admin 挂载同一个 Artifact Workspace Root；Dream read-write，Admin 操作系统身份 read-only；两端连接同一个 PostgreSQL，Dream 写 `story_workspace_stories` Artifact 索引字段，Admin 只读索引和文件。禁止建设 Admin→Dream HTTP Artifact API、服务 JWT、独立 Gateway、S3 adapter 或 durable receipt。

先把 Round 69 文档收敛为共享文件系统首版并明确跨服务方案 Deferred，再修改代码。更新唯一 Drizzle 来源 `app/lib/db/schema.ts`，仅扩展 `story_workspace_stories`，生成并提交 PostgreSQL migration。与 Dream 冻结字段一致：`artifact_source_type`、`source_run_id`、`source_thread_ref`（server-only）、`source_project_id`、`episode_count`、`artifact_manifest_revision`、`script_revision`、`artifact_sync_status`、`artifact_indexed_at`、`artifact_sync_error_code`、`script_size_bytes`、`artifact_available`、`reconcile_version`、`reviewed_script_revision`。增加 stable-key partial unique index、status/revision/count/size/reconcile check 与查询索引；旧行全部 nullable 兼容。不得保存绝对路径、完整正文或新增平行 Story 表。

扩展 Story Repository 的显式 public projection、list/detail DTO、Artifact health/project/revision/indexedAt 的服务端筛选排序和准确 total。公开 API 严禁返回 `source_thread_ref`、`content` 或任何路径；内部 Artifact Service 只能从已鉴权查询得到的 Story internal record 读取 server-only thread/project/run identity。Admin 不写 Dream-owned `artifact_*`、`source_*`、revision 或文件关系；移除/禁止通用 Story metadata PATCH。若保留受控 confirm/reject/archive 审核命令，必须用 expected `script_revision` CAS，确认时写 `reviewed_script_revision` 与 Audit，不得修改文件。

实现 server-only `StoryArtifactReader`：根目录来自 `ARTIFACT_WORKSPACE_ROOT`（或明确的单一 Admin env），必须是存在的真实目录；按 `<root>/<source_thread_ref>` 定位 Thread Workspace，再按固定 `stories/<source_project_id>` 与 run-scoped `.dream/runtime/runs/<source_run_id>/episode.json` 读取。浏览器只提交 Story ID、Episode ID 和 `ArtifactKind` 枚举，不提交 thread/project/path。Reader 校验每个 segment、安全 manifest、Project ID==slug、Episode registry v1/v2 归属、allowlist 文件名；逐层 lstat/realpath containment，最终文件以 `O_RDONLY|O_NOFOLLOW` 打开并在 read 前后核对 inode/dev/size/mtime，限制单文件与 chunk 大小，计算 SHA-256 ETag，拒绝 traversal、symlink、special file、TOCTOU 替换、超大文件和跨 Story/Workspace/User。Node 无 `openat` 时必须记录并通过“逐段无 symlink + containment + O_NOFOLLOW + pre/post inode/realpath”实现可验证的最强本机防线；若无法证明严格敌手并发目录替换，文档明确残余风险，不得伪称等同 Dream Python `openat`。

新增 Admin Artifact Route Handler，只做 Session/RBAC、Zod、调用 service 与 HTTP 映射。建议 `GET /api/admin/story-stories/{storyId}/artifact-surface` 和 `GET /api/admin/story-stories/{storyId}/artifacts?episodeId=&kind=&offset=&limit=`；也可按现有路由组织选择等价路径。surface 返回安全 Project/Episode/Artifact 逻辑树；preview 返回有界 UTF-8 chunk、revision/etag、offset/nextOffset/totalBytes/truncated/updatedAt，不返回路径。支持 If-None-Match→304、expected revision mismatch→409、过大→413、合同无效→422、存储不可用→503；Story/Workspace/权限错误映射 401/403/404。

更新 Admin Story 列表和 Detail Drawer：列表显示 title/ID/Workspace/author/Project/Episode count/Artifact status/script revision/indexed time/review/business/updatedAt，使用 PostgreSQL total；Drawer 先独立加载 DB detail，再懒加载共享 FS surface/preview。保留 Round 69 的“PostgreSQL 索引 / Artifact 内容”双轨事实条，但删除 Dream service/JWT 文案；显示 indexed/stale/missing/failed、revision mismatch、文件系统不可用。Episode selector 和 `script/episode_outline/storyboard/review_report` allowlist tabs 使用有界 preview；无编辑器、路径输入、下载任意文件或目录浏览。Dream/DB 不再是两个网络依赖；DB 失败为页面错误，文件系统失败只降级 Artifact 区。

采用现有暖纸色运营工作台 token，不创建新的通用设计系统；双轨事实条是唯一 signature。桌面 1440×1000 使用右侧 Drawer，移动 390×844 全屏并无页面级横向溢出。Loading、system empty、filter empty、401/403/404/409/413/422/500/503 文案独立，错误不冒充 0。

测试必须覆盖 Schema/migration、Repository mapping/filter/sort/total、public DTO 不泄露内部列、Reader 正常/多 Episode/ETag/304/chunk、traversal/symlink/special file/TOCTOU/oversize/invalid manifest/cross-story、Route 401/403/404/409/413/422/503、Drawer DB-first/FS-degraded 和双视口。所有持久化测试只允许明确 `TEST_DATABASE_URL`/disposable PostgreSQL；文件测试只用临时 Artifact Root。不得迁移、写入、清理共享 `5433/ink-memory`，不得执行真实历史 backfill。

运行 Admin：`pnpm env:check`、`pnpm exec tsc --noEmit`、`pnpm lint`、focused/full `pnpm test:run`、`pnpm build`、focused Playwright。执行浏览器前完整读取 `ink-admin-playwright-qa/references/project-workflow.md`，检查 listener ownership 和 Git 状态；截图 1440×1000、390×844。若 disposable PostgreSQL 或浏览器环境不可用，继续完成所有纯单元/静态验证并把环境阻断与代码失败分开报告，不得绕到共享数据库。

Acceptance Criteria:

- 主 PRD/架构/Admin 交互已改为共享 Artifact Root 首版，服务 JWT/跨服务 Artifact API 标为 Deferred。
- 只扩展 `story_workspace_stories` 并提交 Drizzle migration；字段与 Dream handoff 一致。
- Admin public list/detail 不返回 source_thread_ref/content/path，内部 Reader 只能使用数据库解析出的资源身份。
- Admin 列表只读 PostgreSQL；Drawer 通过本机共享文件系统只读同一 Artifact，浏览器不提交路径。
- allowlist、manifest/binding、containment、symlink、TOCTOU、大小、ETag/chunk 与跨租户边界有测试。
- DB metadata 与 Artifact 区独立加载，文件系统 503 时仍显示 DB 索引。
- 1440×1000 与 390×844 验证通过，无页面级横向溢出。
- 未新增平行 Story 表、SQLite、服务 JWT或正文副本；未操作共享真实数据或生产回填。

Optional Enhancers:

- 将 shared locator/revision 规则固定为跨语言 JSON golden fixtures，供 Dream Python 与 Admin TypeScript 同时验证。
- 为 Node 文件 Reader 的并发目录替换残余风险增加 feature flag；高威胁部署可切回 Dream `openat` reader，而不改变浏览器 DTO。

范围变化：

- Dream 实现已交由另一执行环境；本轮只修改 Admin 仓库，不编辑 Dream 文件。
- 用户已明确说“继续”，视为批准开始 Admin 设计收敛、Schema/migration、Repository、共享文件 Reader、API/UI 与隔离测试；仍未授权生产 backfill。

执行证据与验证结果：

- 当前尚未执行；必须先完成本 Prompt Architect 记录，再更新计划和实施。

未执行事项及原因：

- 尚未修改 Admin Schema/migration/业务代码或测试；尚未执行任何数据库或 Artifact 写入。

## Round 73 — Admin 共享根目录实现的最终验证与交付审计

Optimized Prompt:

作为 ink-memory-admin 的最终验收负责人，在不扩展既定范围的前提下，对已经完成的共享 Artifact Root Admin 实现执行一次可复现的完成性、安全性和隔离性验证。不得修改 Dream 仓库，不得连接、迁移、写入或清理共享 `5433/ink-memory`，不得执行历史 reconcile apply 或生产回填；所有 PostgreSQL 写入验证只能使用脚本创建且在结束后销毁的 disposable PostgreSQL，所有 Artifact 只能位于临时 Workspace Root。

先复核最新 Story 命令可见性改动能够通过 TypeScript 和 ESLint，并确认它只影响 UI 命令呈现，不削弱服务端 RBAC、revision CAS 或审核事务边界。随后检查 git diff 与 public DTO：不得泄露 `source_thread_ref`、绝对路径、`content`、Secret 或异常堆栈；不得新增平行 Story 表、SQLite、Admin 文件写入口或任意路径参数；Route Handler 继续只做鉴权、解析和编排。

按项目要求执行 `pnpm env:check`、`pnpm exec tsc --noEmit`、`pnpm lint`、`pnpm test:run` 和精确 `pnpm build`。构建必须使用仓库已确定的 Next.js Webpack 路径，记录默认 Turbopack 在当前环境挂起的工程原因，但不得把挂起误报为业务构建失败。再次运行 `node scripts/run-story-artifact-e2e.mjs`：脚本必须建立随机 loopback 端口的临时 PostgreSQL、应用 migration 0000–0027、创建临时 Artifact Root、运行 focused Playwright，并在成功或失败后停止和移除容器及临时文件。

Playwright 验收必须覆盖 PostgreSQL list total 与实际 count 一致、公开 API 不泄露 server-only identity、Artifact surface/preview、ETag/304、422、review revision CAS、文件系统 503 时数据库索引仍可见，以及 1440×1000、390×844 两个视口无页面级横向溢出。保存并人工查看两张截图，确认桌面 Drawer 双轨事实区和移动全屏布局可读；将路径写入交付记录。

最终检查 `git diff --check`、工作树修改列表、migration 文件、测试数量和隔离容器清理。明确区分本仓库已验证的 Admin 实现与外部环境中的 Dream 实现；不得声称 Dream 测试已由本轮验证。历史 dry-run 仅报告已有只读审计基线，不编造 PostgreSQL 对照数量；生产回填必须继续标记为未执行并等待用户明确批准。

Acceptance Criteria:

- Admin env/typecheck/lint/full unit/build 全部通过，结果和测试数量可追溯。
- focused isolated E2E 通过，migration 仅应用于 disposable PostgreSQL，容器与临时 Artifact Root 已清理。
- 桌面与移动截图存在并经人工查看，两视口无横向溢出。
- public Story DTO/Artifact API 不泄露内部 thread locator、正文、绝对路径或 Secret。
- 未新增平行 Story 表、SQLite、跨服务 JWT/Gateway、Admin Artifact 写入或共享数据操作。
- 最终报告分别列出 Admin 已完成内容、Dream 外部执行边界、migration、测试命令、截图、未执行的生产回填与已知 Node `openat` 残余风险。

Optional Enhancers:

- 在最终交付中把桌面和移动截图作为本地可点击图片展示，方便用户直接审核。
- 后续由 Dream 执行环境回传同一 Story identity/revision 的 golden fixture 结果后，再做跨仓合同最终签收。

范围变化：

- 本轮仅做 Admin 实现的最终验证、必要的小范围修正和交付记录；不再新增产品能力。
- Dream 改造仍由用户安排的其他执行环境负责，本轮只陈述冻结合同和未验证状态。

执行证据与验证结果：

- 当前尚未执行；必须先完成本 Prompt Architect 记录，再开始最终验证。

未执行事项及原因：

- 尚未执行本轮最终命令和交付审计；共享数据库与生产历史回填明确不在授权范围内。

### Round 73 执行结果

- `pnpm env:check`：通过；环境结构有效。
- `pnpm exec tsc --noEmit`：通过；最新 Story command visibility 与 Artifact Drawer 类型检查无错误。
- `pnpm lint`：通过；ESLint 无错误。
- `git diff --check`：通过；无 whitespace/error marker。
- `pnpm test:run`：69 个 test files、340 项 tests 全部通过；未运行被显式排除的持久化 integration tests。
- `pnpm build`：通过；`next build --webpack` 3.9 秒完成编译，随后 TypeScript、静态页生成和 build traces 均成功；构建路由包含 `/api/admin/story-stories/[id]/artifact-surface` 与 `/api/admin/story-stories/[id]/artifacts`。
- `node scripts/run-story-artifact-e2e.mjs`：通过。脚本启动一次性 PostgreSQL 16 容器，应用 migration 0000–0027，使用临时 Artifact Root 运行 `tests/e2e/story-artifact-shared-root.spec.ts`，Chromium 1/1 通过（9.1 秒），最后停止并移除容器。额外只读 `docker ps -a` 验证没有同名遗留容器。
- Playwright 覆盖 PostgreSQL total、公开 API internal locator 不泄露、surface/preview、ETag/304、422、审核 revision CAS、Artifact root 503 时数据库事实保留，以及桌面/移动无横向溢出。
- 人工查看截图通过：`test-results/story-artifact-shared-root-4e384-e-across-desktop-and-mobile-chromium/story-artifact-desktop-1440x1000.png` 与 `story-artifact-mobile-390x844.png`。桌面为右侧双轨 Drawer，移动为 390px 全宽单列；两者未出现页面级横向溢出。
- 安全交付扫描只在内部 Repository/Reader 与测试中发现 `sourceThreadRef`；public projection 测试明确断言 SQL 不选择 `s.source_thread_ref`，UI/API 未接收路径。依赖 lock 中的 SQLite optional peer 字样不是本项目依赖或回退；应用代码继续明确只支持 PostgreSQL。
- 在只读审计报告顶部补充后续架构决策说明：审计时的跨服务 Gateway 建议已被用户确认的共享 Artifact Root 架构取代，避免历史建议与当前实现产生歧义。
- 本轮没有连接、迁移或修改共享 `5433/ink-memory`，没有执行 reconcile apply/生产回填，也没有修改 Dream 仓库。

未执行事项及原因：

- Dream projector/reconcile 与 Dream UI 由用户安排的另一执行环境负责；本轮未验证其代码和测试。
- 文件侧历史 dry-run 仍为 5 个 discoverable Project、39 个 Episode 目录、3 个 strict indexable Story、2 个 invalid manifest、5 个 missing-manifest project directory；数据库 existing/new/update/conflict/orphan 数仍为 unknown，未对共享数据库补做查询。
- 生产历史索引回填未执行，等待用户明确批准。

## Round 74 — Admin 交付签收与计划关闭

Optimized Prompt:

作为最终交付负责人，基于 Round 73 已通过的静态、单元、构建、隔离 PostgreSQL E2E 和双视口证据，关闭本轮 Admin 共享 Artifact Root 实现计划并向用户提交自包含的中文验收报告。报告必须以结果为先，分别列出 Admin 已完成的 Schema/migration、Repository/API、安全 Reader、Story 列表/Drawer、审核 CAS、测试结果；单独说明 Dream 改造由其他执行环境负责且本轮未验证，避免把冻结方案误报为已完成代码。

列出真实根因、核心修改文件、migration 名称、dry-run 文件侧数量、DB/API/UI 对照测试结论、精确测试命令与数量、1440×1000 和 390×844 截图链接、未执行的生产回填及已知风险。明确确认：没有新增平行 Story 表、没有引入 SQLite 回退、没有复制完整剧本正文到 PostgreSQL、没有暴露绝对路径或 Secret、没有赋予 Admin 文件写入能力、没有操作共享真实数据。

已知风险必须包含 Node.js 缺少 Python `openat(dir_fd=...)` 等价 API，因此 Admin Reader 采用逐段 `lstat`、realpath containment、最终 `O_NOFOLLOW`、pre/post inode/size/mtime/path revalidation 的本机最强防线；高敌手并发目录替换场景仍存在残余风险，生产部署还必须通过 OS/container read-only mount 与最小权限降低风险。

Acceptance Criteria:

- 计划所有 Admin 步骤标记完成，最终报告不遗漏隔离边界和 Dream 外部执行状态。
- 文件链接使用绝对本地路径，截图可直接打开。
- 不声称生产数据数量已核对或历史回填已执行。
- 报告足够让用户审核是否接受 Admin 实现，并明确下一步只有 Dream 合同联调与经批准的生产 dry-run/apply。

Optional Enhancers:

- 用户审核通过后，可再单独执行 Dream/Admin golden fixture 合同联调；该动作不属于本轮自动授权。

范围变化：

- 不再修改实现；本轮只关闭计划并交付验收报告。

执行证据与验证结果：

- Round 73 已提供完整证据；本轮将在计划关闭后输出最终报告。

未执行事项及原因：

- 尚未执行生产 dry-run、回填或 Dream 跨仓联调，均需后续明确授权或外部执行结果。

## Round 75 — 指定 Dream Run 在 Admin Story 页面不可见的只读诊断

Optimized Prompt:

作为 ink-memory-admin 与 ink-dream-memory 的跨系统故障诊断负责人，针对用户在 Admin `AdminWorkspaceLayout` 页面中看不到 Dream URL `story-workspace/dream?run=run_b81d3731b56b4703868b66af76e7b656` 对应剧本信息的问题，执行一次只读、证据驱动的身份链路核对。本轮只诊断原因，不修改代码、不写数据库、不执行 migration/reconcile apply/backfill，也不改变 Dream Artifact。

从用户给出的 React Grab 一次性组件定位 `app/(admin)/admin/(workspace)/layout.tsx:35` 开始，确认该节点只是 Admin 受保护页面框架还是实际 Story 数据组件；继续追踪 `/admin/story/stories` 的 URL 参数、Refine filter、Repository WHERE 与 UI 空态，确认 Admin 是否认识 Dream 的 `run` 查询参数。核对 Dream URL 的 `run_b81d...` 是 workflow run identity、Story identity 还是 Project identity，不能把 run ID 当 Story ID。

使用只读方法检查：当前 Admin 进程的数据库/Artifact root 配置结构；PostgreSQL `story_workspace_workflow_runs` 中该 run 的 Workspace、Thread、User、状态和 source identity；`story_workspace_stories` 中是否已有 `source_run_id` 或同 Workspace+Project stable key 的 canonical Story 行；共享 Artifact Root 下该 run 的可信 episode registry、Project manifest、Episode allowlist 文件和 revisions。查询必须避免输出 DSN、Secret、Cookie、JWT、绝对线程路径或剧本正文；只报告安全 ID、状态、计数和 revision 摘要。

明确区分以下可能结果并用实际证据收敛：Admin 页面没有自动消费 Dream `?run=` 参数；Dream materializer 尚未为该 run 创建 Story 索引；Admin/Dream 当前未使用同一 PostgreSQL；Admin 未挂载/配置同一 Artifact Root；已有索引但 run/project/workspace binding 不一致；migration 尚未应用导致 Artifact 索引列不存在；Artifact 文件存在但数据库 canonical row 缺失。若本机服务或数据库在系统重启后未启动，要把“运行环境不可达”与“数据确实不存在”分开报告。

Acceptance Criteria:

- 解释 `AdminWorkspaceLayout` 与 Story 数据加载的真实关系。
- 对指定 run 给出 PostgreSQL Story 索引是否存在、Artifact 是否存在、身份绑定是否一致的证据；若某一层不可达，明确标为 unknown 而非猜测。
- 说明为什么把 Dream URL 直接放到 Admin 页面不会自动显示剧本，以及正确的 Admin 入口/筛选 identity。
- 不修改代码、共享数据或 Artifact；若用户随后要求修复，再单独提出最小变更。

Optional Enhancers:

- 若发现 Dream materializer 已在外部实现但 migration/服务未部署，给出最短部署顺序；不自动执行。
- 若只缺该 run 的历史索引，先给出 dry-run 命令/预期 receipt，等待用户批准后再 apply。

范围变化：

- 从已完成的 Admin 实现交付切换到指定 Dream Run 的只读运行态诊断。
- 本轮不授权任何修复、迁移或历史数据写入。

执行证据与验证结果：

- 当前尚未执行；必须先完成本 Prompt Architect 记录，再检查代码、服务、数据库与 Artifact 元数据。

未执行事项及原因：

- 尚未查询指定 run；尚未启动服务或访问共享数据库/文件。

### Round 75 执行结果

- React Grab 引用的 `app/(admin)/admin/(workspace)/layout.tsx:35` 只是 Admin 登录态页面框架 `admin-page-frame`，仅渲染 `{children}`，不读取 Story、Dream run 或 URL `run` 参数。
- `/admin/story/stories` 的 `StoryResourceView` 只配置 `title/workspace/author/source_project_id/artifact status/review/status/date` 等筛选；`AdminResourceManager` 只从已声明 filter definitions 解析 query string。`run=run_b81...` 不会转成 `source_run_id` 查询，也不会把 Dream URL 当 Story identity。
- 本机 PostgreSQL 只读查询成功：指定 run 存在，Workspace 存在，Workspace owner 与 run creator 均为用户 28；Thread、Source Message 和 Dream context 绑定存在且一致；Episode authority 指向安全 Project identity `proj-da1c690c`、EP01。
- 该 run 当前数据库生命周期为 `queued`，`agent_session_id=NULL`、`completed_at=NULL`；但 run-scoped 文件事实存在 5 个 completion（generate prompts、plan、write、review script、review full chain），说明数据库 run lifecycle 与文件工作流事实也存在历史不一致。
- 共享 Artifact Root 已配置且可读；对应 thread workspace、`project.yaml`、run-scoped Episode registry 和 EP01 的 `script.md`、outline、storyboard、review report 均存在。只读取文件元数据和 SHA-256 摘要，没有输出正文或绝对路径。
- PostgreSQL `story_workspace_stories` 中 `source_run_id=run_b81d...` 的 canonical Story 行数量为 0，因此 Admin 按设计显示不到该剧本；这不是 Admin total 或 Drawer 查询错误。
- Dream 单 run 命令 `.venv/bin/python script/reconcile_story_artifact_index.py --dry-run --run-id run_b81d...` 在只读事务中执行并 rollback，返回 `database_status=schema_unavailable`、`applied=false`，没有写数据库或文件。
- 进一步只读核对确认：共享数据库已有全部 14 个 Artifact Story 索引列；stable identity 索引 `story_workspace_stories_artifact_identity_uidx` 是 unique partial index。Admin migration 按冻结合同故意使用 partial predicate，只约束非 NULL Artifact identity，兼容历史非 Artifact Story 行。
- 确定的跨仓合同缺陷位于 Dream `ArtifactStoryIndexRepository.require_schema()`：它在 `artifact_story_index_repository.py:230-243` 强制 `is_full_index is True`，拒绝 canonical partial unique index。因此 completion-time materializer 与 dry-run reconcile 都 fail-closed 为 `story_index_schema_unavailable`，无法为该 run 创建 Story 行。

结论：

- 直接原因是 Dream Repository 的 unique-index 形态校验与 Admin canonical migration 不一致，不是共享文件系统路径错误，也不是 Admin 列表查询错误。
- 该历史 run 已有可索引 Artifact，但尚无 PostgreSQL Story row；并且 Admin 当前没有 `source_run_id` URL 筛选，所以即使输入 Dream `?run=` 也不会自动显示。
- 最小修复应在 Dream 仓库：让 `require_schema()` 精确接受冻结的 partial unique index及其 predicate，而不是把数据库改成 full unique index；随后先重跑单 run dry-run。实际创建历史 Story 行仍属于 reconcile apply/回填，必须等待用户明确批准。

未执行事项及原因：

- 未修改 Dream/Admin 代码、Schema 或 migration；未写共享数据库或 Artifact。
- 未执行该 run 的 reconcile apply；用户本轮只询问原因，生产历史写入仍未授权。

## Round 76 — 修复 Dream partial-index 合同并重建指定 Run Story 索引

Optimized Prompt:

作为 Dream/PostgreSQL 修复负责人，根据用户明确要求，仅修复并重建 `run_b81d3731b56b4703868b66af76e7b656` 因历史 migration/跨仓合同遗留而缺失的 canonical Story 索引。不得扩大到全库历史回填，不得修改其他 Run/Project/Artifact，不得覆盖 Dream/Admin 两仓库既有未提交修改。

先修复 Dream `ArtifactStoryIndexRepository.require_schema()`：Admin canonical Drizzle migration 创建的是 `(workspace_id, artifact_source_type, source_project_id)` unique partial index，predicate 为 Artifact identity 非空。Dream 必须验证三列直接键、unique/valid、partial predicate 与冻结合同一致；不能错误要求 full index，也不能宽松接受任意 partial predicate。优先使用 `pg_get_expr(indpred, indrelid)` 并做有限 canonical normalization/等价允许，保留 fail-closed。更新 focused repository/reconcile tests，覆盖 canonical partial index accepted、full/wrong predicate/missing key rejected。

修改后运行 Dream focused pytest。再执行指定 run 的只读 dry-run reconcile，要求 `database_status=available`、发现 Project/Episode、`indexes_to_create=1` 或有证据的等价结果。只有 dry-run 精确指向该 run 且无 conflict/invalid/missing relation 时，才执行一次受控单-run materialize/reconcile 写入；禁止运行全库 apply。写入必须复用 Dream Service/Repository 的幂等 upsert 与事务，不得手写 INSERT，不得修改 Artifact 文件。

写入后只读验证：`story_workspace_stories` 恰有一条与该 run、Workspace、Project `proj-da1c690c` 对应的 canonical Story；revision、episode_count、artifact status/availability 与文件投影一致；重复同 revision 为 no-op；Admin list API/Repository total 能看到该 Story，公开数据不含 `source_thread_ref`、正文或绝对路径。若受控 write seam 不存在或无法证明只作用于单 run，停止并报告，不得绕过 Repository 手写生产 SQL。

Acceptance Criteria:

- Dream schema guard 接受 Admin canonical partial unique index并继续拒绝错误索引。
- focused tests 通过，未覆盖无关 Dream 未提交改动。
- 指定 run dry-run 从 `schema_unavailable` 恢复为可索引结果。
- 仅该 run 创建/更新一条 Story；不执行全库历史回填。
- 重复物化幂等，Admin 可见同一 Story identity/revision。
- 不复制完整剧本正文到 PostgreSQL，不暴露路径/Secret，不修改 Artifact。

Optional Enhancers:

- 为 Admin migration 与 Dream schema guard 增加同一 predicate golden fixture，避免下次跨仓漂移。

范围变化：

- 用户已明确授权重建当前历史遗留问题；授权范围按最小解释限定为修复跨仓索引合同并重建指定 `run_b81...`，不是全库 backfill。
- 本轮允许对该指定 run 的共享 PostgreSQL canonical Story 索引执行一次受控幂等写入；其他共享数据仍禁止修改。

执行证据与验证结果：

- 当前尚未执行代码修改、测试或写入；必须先完成本 Prompt Architect 记录再实施。

未执行事项及原因：

- 尚未修复 Dream schema guard；尚未重跑 dry-run 或 materialize 指定 run。

### Round 76 执行结果

- Dream 修复文件：`backend/services/story_workspace/artifact_story_index_repository.py`。Schema guard 现在要求三列 direct unique key、`indpred IS NOT NULL`，并通过 `pg_get_expr` 精确接受 canonical predicate：`artifact_source_type IS NOT NULL AND source_project_id IS NOT NULL`（允许交换 AND 两侧顺序）。full index、错误 predicate、expression/额外 key 继续 fail-closed。
- 更新 focused tests：`test_story_workspace_artifact_story_index_postgres.py` 与 `test_story_workspace_artifact_story_index_reconcile.py`，新增 canonical partial predicate accepted、full/wrong predicate rejected 和真实 PostgreSQL catalog acceptance case。
- Dream focused pytest：79 collected，75 passed，4 skipped。4 个 skip 是需要显式 `TEST_DATABASE_URL` 的真实 PostgreSQL integration cases；本轮真实 schema guard 随后通过共享数据库的只读 dry-run 得到运行态验证。
- 修复后的指定 run dry-run 返回：`database_status=available`、Project=1、Episode=1、indexable Story=1、to-create=1、conflict/invalid/missing relation 均为 0。
- 用户明确授权重建当前历史遗留问题后，通过 Dream 已有 `StoryWorkflowApplicationGateway.reconcile_story_index` 执行一次单-run、actor-authorized、If-Match revision-guarded、Repository-managed 幂等写入；没有手写 INSERT、没有运行全库 apply、没有修改 Artifact。
- 写入前：status=`missing`、error=`story_index_row_missing`、Story ID=NULL。写入后：status=`indexed`、Story ID=`b6670ca1-b338-55f0-97ed-77738c110cf3`、Project=`proj-da1c690c`、Episode count=1，observed/indexed manifest revision 与 script revision 分别完全一致。
- 重建后重复 dry-run 返回：`indexes_existing=1`、`indexes_unchanged=1`、`indexes_to_create=0`、`indexes_to_update=0`，证明同 revision 幂等且没有重复行。
- Admin 侧只读 DB 核对：该 source run 恰有 1 条 canonical Story，标题“浮世行路”，Workspace/User 关系正确，`artifact_sync_status=indexed`、`artifact_available=true`、script bytes=9023，`content IS NULL=true`；完整剧本正文没有复制进 PostgreSQL。
- 当前监听端口只有 Dream backend 8765 和 Vite frontend 5173，Admin 3000/3001 未运行，因此未声称完成当前浏览器在线 UI 点击；Admin 启动后可使用 `/admin/story/stories?source_project_id=proj-da1c690c` 查看。
- Dream 仓库仅新增本轮 3 个目标文件的 diff（80 insertions、9 deletions），没有覆盖或回滚其他已有未提交修改；目标 diff 与 Admin worklog 均通过 `git diff --check`。

未执行事项及原因：

- 未执行全库 historical reconcile/backfill；授权只覆盖指定 run。
- 未修改该历史 run 的 `queued/agent_session_id=NULL/completed_at=NULL` 生命周期事实；这是独立历史状态不一致，不影响已重建的 canonical Story，后续如需纠偏必须另行审计授权。

## Round 77 — 指定 Run 重建验收与计划关闭

Optimized Prompt:

作为最终验收负责人，基于 Round 76 的代码、测试、dry-run、单-run受控写入和重复幂等证据，关闭本次“历史 migration 遗留导致指定 Dream Run 不进入 Admin 剧本列表”的修复计划。最终报告必须说明修复了什么、创建了哪一条 Story、如何验证无重复与正文未复制，以及用户应访问的 Admin URL。

必须明确共享数据库只修改了用户明确授权的指定 run 对应 canonical Story 索引；没有全库回填、没有 Artifact 写入、没有调整 workflow run lifecycle。列出 Dream 三个修改文件和测试结果，提醒 Admin 当前未监听，需启动/刷新后查看。不得把端口未运行误报为数据仍缺失。

Acceptance Criteria:

- 所有计划步骤完成；Story index 恰有一条且 status indexed。
- 重复 dry-run unchanged，DB content NULL。
- 最终报告提供 Story ID、Project ID、正确 Admin 筛选入口和剩余独立 lifecycle 风险。

Optional Enhancers:

- Admin 启动后可追加一次有 Session 的 UI smoke test；不作为本次数据库重建成功的必要条件。

范围变化：

- 不再修改代码或数据；本轮只关闭计划并交付结果。

执行证据与验证结果：

- Round 76 已满足全部指定 run 重建验收条件。

未执行事项及原因：

- Admin 在线 UI 未验证，因为当前没有 Admin listener；数据库与 Repository 所需数据已就绪。

## Round 78 — 创建其余严格可索引但缺失的 Story 索引

Optimized Prompt:

作为 Dream 历史 Artifact 索引恢复负责人，根据用户明确授权，对当前共享 PostgreSQL 与 Artifact Root 中“严格可索引且 canonical Story 索引缺失”的其余 Project 执行受控创建。已完成的 `run_b81d.../proj-da1c690c` 保持幂等不变；不得扩大到 invalid Artifact、missing relation、conflict、stale update 或 Workflow Run 生命周期修复。

先运行 Dream 官方只读 full dry-run reconcile，使用 bounded limit/deadline 和 cursor 直到完成，记录 projects/episodes/indexable/existing/to-create/to-update/unchanged/conflicts/invalid/missing-relations。仅当 database available 且没有无法解释的 schema error 时继续。通过 PostgreSQL 只读关系与 Dream Gateway inspection 枚举 stable key 尚不存在的 run/project；每个候选必须通过 Workspace owner、Thread、Source Message、Episode authority、Project manifest、run registry 和 Artifact surface 验证。

对每个 observation 为 `missing + story_index_row_missing` 的候选，调用 Dream 现有 `StoryWorkflowApplicationGateway.reconcile_story_index`，携带该 observation ETag、actor identity 与唯一 idempotency key，复用 `ArtifactStoryIndexService/Repository` 事务执行幂等 upsert。禁止手写 INSERT，禁止全库裸 SQL apply，禁止修改 Artifact 文件。若候选变为 indexed/stale/conflict/invalid，跳过并报告。

完成后再次运行 full dry-run，要求 `indexes_to_create=0`；检查 stable Story 总数、每个新建 Story 的 source run/project/workspace、episode count、indexed/available/revisions、`content IS NULL`，并确认没有重复 stable identity。记录实际创建/跳过/失败列表的安全 ID，不输出绝对路径、正文、Secret 或内部 thread locator。

Acceptance Criteria:

- 所有严格 indexable missing Story 均通过受控 Gateway 创建；invalid/conflict/missing relation 不写入。
- 重跑 full dry-run 的 `indexes_to_create=0`，同 revision unchanged。
- 每个 Project 只有一个 canonical Story，正文不进入 PostgreSQL。
- 不修改 Workflow Run status、Artifact 文件或非缺失 Story。
- Dream focused tests仍通过，两个仓库已有未提交修改不被覆盖。

Optional Enhancers:

- 输出按 run/project 的安全恢复 receipt，方便 Admin 人工抽查。

范围变化：

- 用户明确授权从单个 run 扩展到当前所有其他缺失索引；仍限定为“create missing”，不授权 update/conflict repair 或 lifecycle 修复。

执行证据与验证结果：

- 当前尚未执行 full dry-run 或批量受控创建。

未执行事项及原因：

- 尚未确认其余 missing 数量；必须先完成只读 dry-run。

### Round 78 执行结果

- 全量 bounded dry-run（limit=500、deadline=60s、无 cursor）首次结果：database available、Project=2、Episode=2、indexable Story=2、existing=1、unchanged=1、to-create=1、to-update=0、conflict=0、invalid=0、missing-relations=18。
- 通过 Dream read-only Repository/Gateway 枚举 20 个 run candidates；仅 2 个能够形成完整安全 observation，其中 `run_b81d.../proj-da1c690c` 已 indexed，唯一 missing 候选为 `run_fdd7012110c74d1db96c1ff396dd6491/proj-ccd4f2ab`。其余候选未通过可信关系/授权/Artifact 投影，不进入写入集合。
- 对唯一 missing 候选执行 Dream `StoryWorkflowApplicationGateway.reconcile_story_index`，使用 actor 28、missing observation ETag 与唯一 idempotency key；Gateway 再次校验后由 `ArtifactStoryIndexService/Repository` 幂等创建，没有手写 INSERT 或修改 Artifact。
- 创建结果：Story ID=`a1f4d719-8316-5ac2-b122-5ff77bffaa5b`、标题“改写规则”、Project=`proj-ccd4f2ab`、Episode=1、status=indexed、error=NULL，observed/indexed manifest revision 与 script revision 完全一致。
- 创建后全量 dry-run：existing=2、unchanged=2、to-create=0、to-update=0、conflict=0、invalid=0、missing-relations=18。所有严格可索引 missing Story 已清零。
- Admin 侧只读 DB 核对：当前 Dream Artifact Story 共 2 条——“改写规则”和“浮世行路”；均 indexed、available、Episode=1、`content IS NULL=true`。stable `(workspace, source type, project)` 重复数量为 0。
- 未处理的 18 个 missing-relations 是安全关系不完整的历史 Run 数量，不等于 18 个有效剧本；没有为它们猜测路径、Project 或创建孤儿 Story。

未执行事项及原因：

- 未处理 stale/update/conflict/invalid 或 Workflow Run lifecycle；用户授权仅为创建缺失索引。
- 未执行 Artifact 写入、正文复制或全库无条件 SQL backfill。

## Round 79 — 全部严格 missing Story 恢复验收

Optimized Prompt:

作为恢复验收负责人，关闭“创建其余缺失 Story 索引”计划。最终报告必须说明实际新增 1 条、当前总计 2 条 Dream Artifact Story、全量 dry-run to-create=0、18 个 missing relation 被安全跳过，并列出两个 Story 的安全 identity/title/status。不得把关系不完整 Run 表述为漏建剧本。

Acceptance Criteria:

- 全量严格 indexable missing 已清零。
- 两条 Story 唯一、indexed、available、content NULL。
- 无全库裸写、无 Artifact 修改、无重复 identity。
- 用户可在 Admin 服务启动后刷新剧本列表查看两条记录。

Optional Enhancers:

- 后续另开只读审计确认 18 个 missing relation 的历史来源；不得自动创建。

范围变化：

- 不再写代码或数据库；仅交付恢复结果。

执行证据与验证结果：

- Round 78 已满足全部验收标准。

未执行事项及原因：

- 18 个关系不完整 Run 未恢复，因为缺少建立 canonical Story 所需的可信身份链。

## Round 80 — 对照原始 SQLite 恢复历史 Run 关系并创建 Drizzle migration

Optimized Prompt:

作为 PostgreSQL/SQLite 历史数据恢复架构师、Dream Workflow 身份链审计负责人和 Admin Drizzle migration 负责人，根据用户明确要求，对全量 dry-run 中报告的 18 个 missing-relations 历史 Run，使用原始 SQLite 数据库作为只读历史证据，恢复可唯一证明的 Workspace、Thread、Source Message/User 关系，并创建由 Admin `app/lib/db/schema.ts`/`drizzle/**` 管理的 PostgreSQL migration。读取 SQLite 仅用于一次性恢复审计，不得引入 SQLite runtime dependency、fallback、双写或新业务表。

先只读定位并验证原始 SQLite 文件：使用 URI `mode=ro`/immutable 可用时只读打开，记录文件 hash/size/schema version，不修改 WAL/SHM、PRAGMA user data 或源文件。对 PostgreSQL 当前 18 个 missing-relations run 逐条提取安全 facts：run id、workspace id、created_by、source_voice_thread_id/source_message_id/time、binding/runtime provenance；对 SQLite 中 workflow_runs、story workspace、chat_thread、chat_message、users 的对应记录建立候选映射。映射必须按稳定 ID、owner、thread/message FK、timestamp、Dream context workflowRunId/workspaceId/threadId、source role 和 launch metadata 多因子一致，不能仅按标题、文件路径或时间近似猜测。

为每个 run 输出分类：exact recoverable、already correct、ambiguous、source missing、target conflict、invalid metadata。只有 exact one-to-one mapping 才进入 migration；ambiguous/missing/conflict 必须跳过并报告。明确需要恢复的是 PostgreSQL 已有 row 的关系字段、缺失的 canonical related rows，还是仅 reconcile 查询条件错误。禁止把 SQLite 整库导回 PostgreSQL，禁止覆盖 PostgreSQL 中较新的合法数据。

Schema 仍以 Admin `app/lib/db/schema.ts` 为唯一 Drizzle 来源。若无需新增列，仅创建 data-only Drizzle migration；migration 必须列出精确 run IDs 与期望旧值，通过 `UPDATE ... WHERE`/CTE/DO block 加强前置条件，验证目标 Workspace/User/Thread/Message 已存在且 owner/FK/metadata 匹配，row count 不符时 fail-closed。若确实缺 PostgreSQL canonical rows，优先复用现有表并以 deterministic IDs 插入，`ON CONFLICT` 只能接受完全相同事实，否则抛错。不得创建平行 User/Workspace/Story 表。

先在 disposable PostgreSQL 上应用完整 migration 链与恢复 migration，加载经过脱敏/最小化的 fixture 验证成功、幂等、冲突失败和 rollback；运行 Dream focused reconcile tests、Admin migration/typecheck/test。然后对共享 PostgreSQL 执行 migration 前 dry-run receipt，列出 exact/skip/conflict 数。用户本轮已要求恢复并创建 migration，但如果映射存在歧义、SQLite 来源不唯一或 migration 会覆盖非空新事实，必须暂停该条；只有 exact mapping 才允许 apply。

应用后重跑全量 Story reconcile dry-run；预期 missing-relations 下降，新增 indexable/missing Story 需再通过 Dream Gateway/ETag/Repository创建，不能在 migration 中手写 Story 正文或绕过 materializer。最终报告 migration、恢复条数、仍未恢复条数、Story 创建数、DB/API total、测试和 SQLite 未被修改的证据。

Acceptance Criteria:

- SQLite 仅只读证据，不成为运行时数据源或回退。
- 18 个 Run 均有逐条分类；只恢复 exact one-to-one 关系。
- Drizzle migration fail-closed、幂等、可在 disposable PostgreSQL 验证，不新增平行业务表。
- 不覆盖 PostgreSQL 非空冲突事实，不复制完整剧本正文。
- 应用后 full dry-run 的 missing-relations 与 Story to-create 数有可追溯对照。
- 两仓库既有未提交修改不被覆盖。

Optional Enhancers:

- 生成不含 PII/路径的 recovery receipt JSON，记录 source SQLite hash、run/project 安全 ID、mapping evidence code 和 migration checksum。

范围变化：

- 用户明确授权读取原始 SQLite 作历史关系恢复证据，并要求创建 Drizzle migration；这不授权重新启用 SQLite runtime。
- 本轮可对 exact mapping 应用共享 PostgreSQL migration；歧义条目仍禁止写入。

执行证据与验证结果：

- 当前尚未定位 SQLite 文件或审计 18 个 Run；必须先完成只读比对。

未执行事项及原因：

- 尚未创建/应用 migration，尚未修改共享 PostgreSQL。

### Round 80 只读审计结果

- 定位到唯一非空 legacy main SQLite，大小 77,856,768 bytes，SHA-256=`92df6c51724263caed2fd0d3800dfae2447d053bd54c3848a821ce6feb756f67`，integrity check=`ok`。审计前后 hash 一致；SQLite 以 `mode=ro&immutable=1` 打开且未修改。
- SQLite 行数：workflow runs=20、Story Workspaces=12、Users=28、Chat Threads=1,165、Chat Messages=2,355。
- PostgreSQL 与 SQLite 的 20 条 workflow run 关键字段逐条完全一致；SQLite 有而 PostgreSQL 缺少的 Run/Workspace/Thread/Message row 数为 0。
- 7 条 Run 的 recorded source message 在 SQLite 和 PostgreSQL 中都不存在；同 Thread 的其他 SQLite message 也没有 Episode identity，无法恢复 source provenance。
- 11 条 Run 在两库都有相同 Workspace/Thread/Source Message，metadata hash 一致，但原始 metadata 本来就没有 `story_workspace_episode_identity`；同 Thread 其他消息同样没有 Episode identity。
- 只有 2 条 Run 有 Episode identity、run-scoped registry、Project manifest 与 workflow facts，对应已 indexed 的“浮世行路”和“改写规则”。其余 18 条没有 `episode.json` registry 或可绑定 Project/workflow facts。
- Dream 官方 `verify-existing` 报告 source rows missing=0。唯一 target drift 是一条非 source-message 的 Agent command dispatch claim，变化字段仅 dispatch status/claim/lease；run/action identity相同且无 Episode identity，与 Story 关系恢复无关。
- 确定判断：full reconcile 的 `missing_relations=18` 是诊断口径把历史非 Episode/未绑定 Run 混入，而不是 18 条 PostgreSQL migration omission。exact recoverable mappings=0。
- 已创建证据文档 `docs/verification/story-artifact-sqlite-recovery-audit.md`。没有创建伪造关系的 Drizzle migration，没有修改共享 PostgreSQL。

暂停原因：

- 用户要求“对照原始 SQLite 恢复并创建 Drizzle”，但源库不存在可恢复关系。此时生成 data migration 会凭空构造 immutable provenance，无法满足 exact one-to-one、fail-closed 和不猜测身份的约束。
- 推荐后续改为修正 Dream reconcile 候选/指标：18 条计为 not-applicable/ignored，`missing_relations` 只报告已证明是 Episode Artifact 但关系损坏的 Run；该修复不需要 Drizzle schema migration。

## Round 75 — 43+5 数据迁移纳入 Drizzle 与订阅默认数据初始化

Optimized Prompt:

作为 Ink Memory PostgreSQL 数据迁移、Drizzle、Dream Alembic 与订阅控制面负责人，落实用户要求：当前正式 SQLite 43+5 表、4,921 条源记录的迁移能力必须成为可版本化、可审计、可重复演练的 Drizzle 发布资产，同时 Free、Dream、is Dreaming 三项 Token-only 月订阅策略及默认 Free 用户资格必须通过 PostgreSQL 初始化进入同一发布流程。不得把 4,921 条环境业务记录直接硬编码进通用 DDL migration，不得重复创建 Dream-owned canonical schema，也不得用当前三表 Admin importer 冒充 43+5 全量导入器。

先审计 Dream Alembic 20260809_01–06、`backend/script/migrate_legacy_to_postgres.py`、Admin Drizzle 0000–0027、`scripts/migrate.mjs`、`scripts/seed-default-dream-plans.mjs`、Drizzle journal、真实 48 表映射和当前本机专用 `ink-memory` migration/data 状态。明确区分：Dream-owned 48 表 canonical DDL 仍由 Dream Alembic拥有；Admin Drizzle只能以 baseline/adopt/assertion 与发布编排记录其依赖，不能复制第二份漂移 DDL；4,921 条数据必须由 Drizzle 版本所调用或登记的受控 external data migration runner 执行 SQLite只读快照→manifest→staging→冲突阻断导入→digest/FK/sequence/trigger验证，而不是静态 INSERT。

在 Admin Drizzle新增单调 migration：建立只追加 data-migration registry/run/table-result/checkpoint（若当前 schema 尚无等价表），登记稳定 migration key、43+5 manifest contract、源 fingerprint、runner version、状态、每表 source/inserted/existing/conflict count与digest。migration本身不得访问开发机绝对路径；`scripts/migrate.mjs`应用 DDL后，由显式命令或受控开关调用 Dream全量 runner，且只有明确 `--apply`、本机/显式 TEST_DATABASE_URL、安全数据库名和 source paths齐全时才写数据。重复运行同一 source fingerprint必须幂等返回既有成功回执；source变化必须新 run；冲突默认阻断，禁止隐式 upsert覆盖。

同时把 Free、Dream、is Dreaming 三项默认 Plan identity、展示 metadata、版本化 Token-only规则、Entitlement和历史无订阅用户Free backfill纳入可重复初始化。优先复用现有 `seed-default-dream-plans.mjs`，但必须由 Drizzle migration/registry记录 seed version，确保迁移新库后自动具备默认订阅数据；不得覆盖published Plan Version、已有付费订阅、Allowance、Usage、Ledger、Audit或Subscription Event。若商业Token/价格仍未指定，只有Free可依据现有正式配置发布并自动发放；Dream/is Dreaming创建identity与draft version，前端不得伪造可购买状态。

在明确命名的 disposable PostgreSQL中从空库演练：应用Dream Alembic canonical DDL、应用Admin Drizzle、执行43+5 data runner和subscription seed，验证48/48表、4,921/4,921源记录、逐表PK/row digest、unique/FK orphan、JSON/enum/check/time/sequence/trigger、Alembic head、Drizzle journal、三套餐唯一性、Free subscription backfill、重复运行幂等和冲突阻断。不得对共享或未知数据库执行fixture、DROP/TRUNCATE/DELETE；本机专用 `ink-memory` 在clone全部通过前只读，是否apply必须基于当前source/target差异，已有4,921源PK完整时只能登记adopted/verified回执，不得覆盖目标较新的行。

更新架构、迁移Runbook、README和验证回执，明确新库bootstrap顺序：Dream Alembic schema → Admin Drizzle control plane/registry → 43+5受控data migration → default subscription seed → verification → cutover。补充Admin Node tests、Dream migration tests、isolated integration和CLI contract；最终报告列出migration编号、runner、48表/4,921行结果、订阅seed结果、幂等/冲突证据、未执行生产apply及安全边界。不得引入SQLite运行时fallback、JSON DB、第二套users或真实支付渠道，不得覆盖用户已有未提交修改。

Optional Enhancers:

- 为data migration registry生成只读Admin状态页，但不得允许浏览器提交源路径或触发生产导入。
- 增加shadow digest comparison与表级恢复点，失败后默认前向修复。
- 为Free backfill增加canonical user创建/并发seed属性测试。

范围变化：

- 用户明确要求把43+5迁移脚本和订阅默认数据初始化纳入Drizzle发布资产；本轮允许修改Admin Drizzle/scripts和Dream migration runner，但Dream canonical schema所有权仍属于Alembic。
- 真实4,921行数据已在既有审计中证明完整进入PG；本轮重点是让全量迁移与seed成为新库可重放的正式发布流程，不执行无意义覆盖式重灌。

执行证据与验证结果：

- 当前只确认Dream存在6个Alembic版本、Admin存在0000–0027 Drizzle migration、全量runner与默认套餐seed脚本；尚未验证它们是否被Drizzle journal/发布命令统一编排。

未执行事项及原因：

- 代码审计、migration设计、隔离PG演练和必要实现必须在本Prompt Architect记录之后执行。

## Round 76 — Drizzle 数据迁移执行面与既有 PG 安全 Adoption

Optimized Prompt:

作为 Ink Memory 数据发布负责人，基于只读证据完成 43+5 SQLite 数据迁移的 Drizzle 正式执行面，并处理本机 PostgreSQL 已迁移、随后已有新写入但缺少 Drizzle 回执的状态。已验证正式源为 `ink-and-memory.db` 的 43 表 4,919 行与 `notion-connectors.db` 的 5 表 2 行，合计 48 表/4,921 行、64 个源外键检查通过；当前本机 `ink-memory` 已有更多目标行（例如 `chat_thread` 1,181 对源 1,165，`chat_message` 2,377 对源 2,355），且 Free、Dream、is Dreaming 已存在，因此禁止覆盖式重灌或以目标总行数等于源行数作为 adoption 条件。

在 Admin `drizzle/` 中增加单调 migration 与 data journal：建立最小、只追加的数据迁移定义、运行回执和逐表结果结构，登记 `ink-dream-legacy-postgres-import-v1` 48 表 contract 与 `default-dream-plans-v1` 订阅 seed；不得存储 SQLite 绝对路径、DSN、Secret 或业务字段值。提供位于 `drizzle/data/` 的显式 runner，由它调用 Dream canonical importer 和现有套餐 seed，而不是复制 Dream Alembic DDL或把4,921行硬编码为SQL。

为 Dream importer 增加安全的 `verify-existing/adopt` 路径：仍执行 SQLite只读在线快照、manifest、临时 staging、目标 catalog/PK/FK/unique/check/index/trigger 校验和逐表PK/row digest；允许目标表存在迁移完成后的额外行，但要求每一个源PK在PG存在且内容完全一致。任何 missing、mismatch 或 source schema drift 必须阻断；验证模式不得插入、更新、校准sequence或改变业务表。成功后，Admin runner才可把安全摘要和48条表级结果追加到Drizzle data journal；相同source fingerprint重复执行应返回既有成功回执，不能重复导入。

新库路径仍使用现有冲突阻断式execute：Dream Alembic → Admin Drizzle → 43+5 import → 三套餐seed → verification。订阅seed必须创建/核对 Free、Dream、is Dreaming展示信息；Free只有在存在可用Provider/Model/Pricing/Entitlement证据时发布并为canonical users补齐默认Token-only月订阅，Dream/is Dreaming在商业Token/价格未定时保持draft。不得改写已发布版本、既有订阅、Allowance、Usage、Ledger或Audit。

补充CLI和registry测试，并在明确命名的隔离PG中验证 fresh import、48/4,921 digest、重复执行、冲突阻断、subscription seed；对本机 `ink-memory` 只允许只读 verify-existing 与追加迁移回执，禁止DROP/TRUNCATE/DELETE。最终文档给出可复制命令、执行顺序、当前 adoption 证据与未执行的生产支付/Provider边界。

Acceptance Criteria:

- Drizzle journal含新的单调migration，`drizzle/data/`含43+5与subscription初始化执行资产。
- 源清点稳定为48表/4,921行；PG subset逐表missing=0、mismatch=0才允许adopt。
- fresh database使用Dream importer实际写入4,921行，非静态SQL；重复执行不覆盖业务数据。
- 三项Plan identity/展示metadata可重复初始化，canonical users的默认Free订阅不重复发放。
- 所有回执无源路径、DSN、Secret和业务值；未覆盖用户未提交修改。

Optional Enhancers:

- 后续可增加只读迁移状态页和shadow comparison仪表盘，但浏览器不得触发迁移。

范围变化：

- 审计证明本机PG已有43+5迁移后的数据和增量写入，因此本机处理从“重新导入”改为“逐源PK/digest验证后adopt登记”；fresh/隔离库仍执行完整导入。
- 订阅三项默认Plan已存在，但仍需纳入Drizzle data journal，成为新库正式bootstrap步骤。

执行证据与验证结果：

- `.venv/bin/python backend/script/migrate_legacy_to_postgres.py` source-dry-run通过：main 43表/4,919行，Notion 5表/2行，总计48表/4,921行、64个外键检查，manifest SHA-256为`827dd786d10594c52325ede4cd4dc08487e3cbea3297b55516523386f0d4893c`。
- 本机PG只读审计：88张public表；users 30、story workspaces 12、stories 4、chat_thread 1,181、chat_message 2,377、voices 443、Notion 2行；三项默认Plan存在；Drizzle历史表有27条记录，但没有43+5 data migration registry。

未执行事项及原因：

- 尚未修改代码、应用新migration、写入adoption回执或执行隔离PG演练；必须在本Round记录完成后进入实现阶段。

## Round 77 — 保留 Cutover 后新值的受控 Adoption

Optimized Prompt:

作为 43+5 数据迁移验收负责人，处理 strict source-subset digest 在本机PG发现的真实post-cutover变化：完整48表验证中source PK缺失为0，仅`user_preferences`有2行mismatch；schema/count-only证据显示两行目标`updated_at`都严格晚于SQLite源，变化列为`updated_at` 2行与`system_config_json` 1行。不得为追求源digest一致而覆盖这些较新的PG用户设置，也不得把任意mismatch无条件标记为成功。

保留`verify-existing`默认严格语义：任何missing或mismatch继续失败。新增显式`--accept-post-cutover-changes` adoption开关，仅允许和`--verify-existing`一起使用，并继续要求精确数据库name/host/port/owner与`VERIFY-43+5-IN:<database>`审批。受控adoption只有在48表全部source PK存在、每张drift表具有`updated_at`、且每个mismatched行的目标`updated_at`严格晚于staging源值时成功；任何missing、同时间/更旧target或无时间证据必须阻断。

成功回执必须区分`exactMatchedRows`、`postCutoverChangedRows`、`targetExtraRows`，逐表只记录table/source count/target count/digest/changed column count/newer count，不记录业务值。Drizzle data registry将运行状态登记为`adopted_with_post_cutover_changes`，同时保留源manifest和snapshot fingerprint；不得声称较新PG行仍与源row digest相等。fresh隔离库仍必须走完整execute并验证4,921行exact digest，不能借用adoption放宽新库导入验收。

Acceptance Criteria:

- strict verify对当前2行变化仍返回`TARGET_ROW_VERIFICATION_FAILED`。
- 显式adoption对当前库返回48表source PK完整、missing=0、postCutoverChangedRows=2，并始终rollback临时staging事务。
- 修改任一目标行为更旧/同时间或删除源PK时，adoption失败。
- registry清楚区分`committed`、`adopted_exact`与`adopted_with_post_cutover_changes`。

Optional Enhancers:

- 后续为业务表定义字段级可变性清单；当前时间单调证据仍是adoption的最低门槛。

范围变化：

- 原Round 76要求mismatch一律阻断，现根据完整证据增加显式、时间单调的post-cutover adoption；默认strict行为不变。
- 本机不重新导入4,921行，只登记“所有source PK存在且2行已被较新PG值取代”；fresh库仍全量导入。

执行证据与验证结果：

- strict verify完整扫描48表：missing=0、mismatched=2；唯一drift表`user_preferences`，`postCutoverNewer=2`，`changedColumns={system_config_json:1,updated_at:2}`。
- 当前未对PG执行任何业务写入；每次比较均使用temporary staging并rollback。

未执行事项及原因：

- 尚未实现显式adoption开关、Drizzle registry或写入回执；需在本Round记录后继续。

## Round 78 — Fresh PG Baseline Adopt 的迁移分段顺序

Optimized Prompt:

作为 Ink Memory fresh PostgreSQL bootstrap负责人，修复隔离E2E发现的真实迁移顺序阻断：Admin 0027会在canonical `story_workspace_stories`上增加后续Artifact扩展列；若空库先一次性应用Admin 0000–0028，再运行Dream Alembic 20260809_01，Dream严格baseline contract会因额外列返回`story_workspace_stories column contract drift`并拒绝adopt。这不是放宽baseline校验的理由，也不能删除/跳过0027。

实现受控、单调的Drizzle migration prefix能力：`scripts/migrate.mjs --through <exact-journal-tag>`只能应用journal从起点到指定tag，必须验证tag存在且参数无歧义；默认无参数仍应用全部migration。fresh bootstrap固定顺序为：Admin Drizzle 0000–0026建立精确canonical baseline → 计算owner/ACL只读指纹 → Dream Alembic 20260809_01–06精确adopt并建齐48表 → Admin Drizzle继续0027–0028添加批准扩展与data registry → 43+5 data import → subscription seed。不得修改Dream baseline contract来接受未知扩展，也不得把0027排除在最终Schema之外。

更新隔离E2E按该顺序执行，验证第一次prefix migration、Alembic head、第二次full migration的hash/idempotency；随后继续48表/4,921行import、registry、三套餐和Free subscription测试。所有失败容器必须自动移除，不得触碰本机`ink-memory`。

Acceptance Criteria:

- `--through 0026_harsh_victor_mancha`只应用0000–0026；未知tag或多余参数失败。
- Dream Alembic在该baseline上通过owner/ACL/columns/PK/FK/check/index精确adopt。
- 第二次默认`db:migrate`只补0027–0028，最终Drizzle记录29条。
- 完整E2E继续验证4,921行与订阅，不以规避0027换取通过。

Optional Enhancers:

- 后续可把fresh bootstrap封装为单一release命令，但仍保留两阶段边界和每阶段回执。

范围变化：

- fresh bootstrap顺序从笼统的“Dream Alembic→Admin Drizzle”修正为Admin baseline prefix→Dream adopt→Admin extensions；这是由真实contract依赖决定。

执行证据与验证结果：

- disposable PG首次运行Admin 0000–0028后，Dream Alembic在20260809_01明确失败：`BaselineAdoptionError: story_workspace_stories column contract drift`。
- 失败发生在数据导入前；唯一命名Docker容器已由finally停止并删除，本机`ink-memory`未操作。

未执行事项及原因：

- 尚未实现`--through`或重跑E2E；必须在本Round记录后继续。

## Round 79 — Importer 对批准 Admin Canonical 扩展的精确兼容

Optimized Prompt:

作为 Dream canonical importer 与 Admin schema extension兼容负责人，处理两阶段bootstrap后43+5 importer的`TARGET_TABLE_CONTRACT_MISMATCH`：Admin 0027在`story_workspace_stories`上新增14个nullable Artifact索引字段、3个命名索引和8个check；这些字段不属于SQLite 43+5源，不应由legacy importer填充，但它们属于已审计的Admin/Dream共享canonical extension，不能使最终Schema永远无法导入历史数据。

在Dream importer建立最小固定allowlist：仅允许`story_workspace_stories`按0027定义追加精确的14列及PostgreSQL类型、3个索引名称/unique属性、8个附加check。目标catalog验证仍要求完整列顺序、PK/FK、Dream原有unique/check/index/trigger和owner/ACL一致；任何未知列、类型/顺序变化、索引缺失/新增或check数量漂移继续返回稳定错误。staging、INSERT、PK/row digest与source comparison只覆盖43+5 manifest旧字段；批准扩展列必须nullable且由其领域后续写入，legacy importer不得虚构Artifact数据。

补充focused test证明allowlist仅扩展expected target catalog，不进入source row transform或INSERT column list。重跑disposable E2E，最终Schema必须包含0027扩展、0028 registry，且仍实际导入4,921行、验证48表digest、订阅seed与幂等/冲突。

Acceptance Criteria:

- 0027最终Schema通过importer catalog验证；额外任意第15列/第4索引仍失败。
- legacy Story source row只写原19列，14个Artifact列保持NULL，不生成假provenance。
- fresh隔离PG完成29条Drizzle、Alembic 20260809_06、48/4,921 import。

Optional Enhancers:

- 未来新的canonical extension必须增加独立migration和显式allowlist更新，不得改成“允许任意额外列”。

范围变化：

- Dream importer从“目标48表绝对无扩展”调整为“允许唯一已批准的0027精确扩展”；source/insert/digest语义不变。

执行证据与验证结果：

- 第二次disposable E2E已通过Admin prefix、Dream adopt和Admin 0027–0028，随后在importer target catalog阶段失败为`TARGET_TABLE_CONTRACT_MISMATCH`；容器已删除。
- 0027审计：14列全部nullable；3索引为artifact identity partial unique、artifact status、workspace/project；8个check限制source type/status/revision/count/size/version。

未执行事项及原因：

- 尚未修改importer allowlist或完成第三次E2E；必须在本Round记录后继续。

## Round 80 — Default Free Seed 的现有模型优先幂等修复

Optimized Prompt:

作为 Token-only subscription seed负责人，修复本机dry-run发现的多模型幂等缺陷：`selectFreeModel`当前从所有enabled/priced/routable且曾被published entitlement引用的模型中按code排序，可能选择与最新Free published default entitlement不同的模型；随后`ensureFreeVersion`用该错误候选校验已有Free version并抛出`Existing Free Plan Version is not a valid published default snapshot`。当前只读证据为最新Free v3默认模型`hy-preview`，而全局字典序候选为`deepseek-v4-flash`。

调整候选排序：在未显式配置`INK_FREE_PLAN_MODEL_ALIAS`时，优先选择当前active Free plan最新published version的enabled default `messages:create` entitlement模型，且仍要求Provider credential完整、active Pricing有效；只有不存在有效Free默认模型时才回退其他已证明routable的published模型。若显式alias存在则必须严格选择该alias，并按不可覆盖版本规则创建新Free version，不可静默忽略操作员选择。

补充单元/集成断言覆盖多模型排序、现有Free幂等dry-run、显式alias变更。重新运行本机dry-run，必须复用Free v3而不创建版本；随后apply只允许补缺失canonical user subscription或记录seed receipt，不改变已有published version、Allowance/Usage/Ledger。

Acceptance Criteria:

- 无alias时选择`hy-preview`并复用最新Free v3；dry-run成功。
- 现有Free模型不可用时才回退其他候选。
- 显式alias继续具有最高优先级且冲突/不可用时失败。
- apply后registry新增或复用`default-dream-plans-v1`，不重复订阅。

Optional Enhancers:

- 后续在Admin UI显示Free默认模型切换预览；本轮不自动切换。

范围变化：

- subscription seed增加“现有有效Free默认模型优先”规则，以保证多模型平台幂等。

执行证据与验证结果：

- 本机0027/0028已应用；43+5 adoption registry已记录。
- subscription dry-run在事务内失败并rollback，没有改写Plan/Subscription。
- 只读关系证据：Free最新v3 default=`hy-preview`；`deepseek-v4-flash`仍被Free旧v1/v2等published version引用，导致旧查询错误优先。

未执行事项及原因：

- 尚未修改model排序或执行seed apply；必须在本Round记录后继续。

## Round 81 — 43+5 Drizzle 迁移交付文档与最终一致性验收

Optimized Prompt:

作为 Ink Memory 迁移交付负责人，在代码、隔离E2E和本机adoption已完成后更新权威文档与最终工作日志，使README、PostgreSQL migration plan、release/rollback和evidence map准确反映当前状态。明确列出fresh bootstrap两阶段顺序、Drizzle 0028、`drizzle/data` journal/runners、Dream `verify-existing`与`--accept-post-cutover-changes`安全条件、subscription seed幂等语义，以及本机4,921行不是重新覆盖导入而是4,921 PK完整/4,919 exact/2 newer PG changes/43 target extras的adoption。

文档必须给出可复制命令但不得包含DSN、Secret或绝对环境凭据；说明默认subscription seed只补没有非终态订阅的canonical users，不自动切换已有subscription Plan Version，不覆盖用户自定义Free Token；只有显式`INK_FREE_PLAN_MONTHLY_TOKENS`和生命周期命令才创建/迁移新版本。记录Admin/Dream测试数量、disposable E2E、当前PG只读验收和21个既有frontend lint warnings。

更新Round 75–81执行结果，标明三次隔离演练发现并修复的真实阻断：baseline extension顺序、0027 catalog extension allowlist、多模型Free seed。完成git diff/secret/path/destructive statement审计，确认未回滚用户未提交修改、未使用真实Provider/支付Secret、未留下Docker容器、未引入SQLite runtime fallback。

Acceptance Criteria:

- 权威文档能独立指导fresh和existing PG两种路径。
- Current/Implemented/Deferred状态不误报：43+5 migration与seed Implemented；真实支付/外部Provider联调不属于本轮。
- 最终worklog包含所有执行命令、通过数、失败原因和安全边界。

Optional Enhancers:

- 后续可为registry提供只读Admin状态页；本轮不增加UI触发入口。

范围变化：

- 不再增加产品能力；本轮只做文档、最终审计与必要的低风险一致性修正。

执行证据与验证结果：

- disposable PG E2E最终通过：48表/4,921行、3默认Plan、28 fresh user active subscriptions、2 registry runs、48 table results、幂等、冲突阻断、append-only 55000、容器删除。
- 本机PG：29 Drizzle、Alembic 20260809_06、2 registry runs、48/4,921 adoption、30 users/projections/accounts、0 users without subscription、3 default Plans、14批准Story extension列。
- Admin：env/tsc/lint/build通过，69 files/340 tests通过。Dream：migration focused 19 passed/2 skipped；Gateway开关命令级禁用后全套1791 passed/25 skipped/652 subtests；frontend lint 0 errors/21既有warnings，build通过。
- README、04 PostgreSQL migration plan、05 release/rollback、91 evidence map 与总索引已更新；fresh/existing PG 两条路径、0028 registry、data runner、adoption 与 seed 幂等边界已同步。
- seed最终修改后重新执行`pnpm test:data-migration:e2e`仍通过；`pnpm exec tsc --noEmit`、`pnpm lint`与全部新增MJS `node --check`通过。两个仓库`git diff --check`通过；无遗留`ink-data-migration-e2e-*`容器，8765无监听进程。

未执行事项及原因：

- 真实第三方支付网络与外部 Provider canary 未执行：不在本轮授权范围，且没有使用真实 Provider/Gateway/Payment Secret。
- 生产/其他预发布数据库未执行迁移：本机回执不得复用为其他环境授权；新环境仍需 owner/ACL、备份和变更审批。

## Round 82 — Dream Provider 环境变量与宠物 MCP 遗留清理

Optimized Prompt:

作为 Ink Dream 的 Python/FastAPI、Claude Agent SDK、AI Gateway 和 MCP 架构维护者，对 `/Users/dmeck/project/ink-dream-memory` 执行证据驱动的遗留代码清理。删除已经与当前 Admin Gateway 架构冲突或无关的用户/部署环境变量入口，包括 `ANTHROPIC_AUTH_TOKEN`、`ANTHROPIC_BASE_URL`、`ANTHROPIC_MODEL` 的示例配置、用户可编辑白名单、部署 Secret 映射、旧直连 Provider 加载逻辑及失效文档；但保留 Admin Gateway 在启动 Claude SDK 子进程时生成临时、服务端受控认证环境的唯一内部适配边界，除非审计证明 SDK 已支持不使用这些进程变量的等价安全接口。浏览器、用户 System Config、`.env.example` 和部署平台不得再接受或持久化这些 Provider 凭据。

同时删除 Pawkeyland/宠物领域遗留 MCP：`user.touch_animation`、necklace 宠物位置/行为工具、宠物共同故事 memory MCP 及其 stdio server、tool allowlist、feature flag、环境变量、exports、prompt/copy、测试和文档。必须保留当前产品必要的 Story Workspace 受控写工具、Editor MCP 和用户 Session 查询工具，不得按“MCP”关键词整体删除。

先建立精确依赖图，再删除完整不可达模块与注册链并同步 exports、文档和测试。验收要求：全仓运行时搜索不再发现用户/部署可配置的三个 `ANTHROPIC_*` 变量，只允许在 Admin Gateway SDK adapter 和“覆盖用户值/不泄露”测试中出现；不存在 `touch_animation`、`mcp__necklace__*`、宠物 memory MCP 的可执行注册或导出；Story Workspace/Editor/Session MCP 保持可用。运行 backend focused/full tests、frontend lint/build、Claude Agent options 合同验证、`git diff --check` 与 Secret 搜索。保留无关未提交修改，不删除数据库数据，不触碰 Usage/Ledger/Subscription 历史，不调用真实 Provider。

Optional Enhancers:

- 将 Claude SDK 子进程的用户环境变量改为显式业务 allowlist，并参数化测试拒绝所有 Provider/Gateway credential 名称。
- 在架构文档列出保留的 Story Workspace、Editor、Session MCP namespace 及用途。

范围变化：

- 本阶段只修改 Dream 仓库的配置、Claude Agent/MCP 遗留、相关测试与文档；Admin 除本工作日志外保持只读，不修改 PostgreSQL。
- “删除 `ANTHROPIC_*`”指删除用户/部署直连 Provider 配置；Admin Gateway 为 Claude SDK 进程签发的短期服务端变量属于 SDK 传输实现，在没有替代接口前保留。

执行证据与验证结果：

- 初始搜索确认 `.env.example`、deploy setup、System Config、Settings PRD 和 Claude Agent SDK env 加载链仍含三个变量；Admin Gateway adapter 也以短期 subject token写入 SDK 进程环境。
- 初始搜索确认 `user.touch_animation`、necklace MCP、宠物共同故事 memory MCP 仍在 exports、agent runner allowlist/stdio 注册和模块中；Story Workspace、Editor 与 Session MCP 同时存在，必须精确保留。
- 本记录落盘前尚未删除代码或运行测试。

失败尝试及根因：

- 直接使用补丁写 Admin 日志因当前 managed workspace 仅授权 Dream 写入而挂起，已终止；随后改为只对该日志申请受控写权限。

未执行事项及原因：

- 精确依赖审计、代码删除、测试和文档同步需在本 Prompt Architect 记录之后执行。

### Round 82 执行结果补记

范围变化：

- 审计确认除用户列出的三个变量外，`ANTHROPIC_DEFAULT_HAIKU_MODEL`、`ANTHROPIC_DEFAULT_SONNET_MODEL`、`ANTHROPIC_DEFAULT_OPUS_MODEL` 也是绕过 platform alias 的旧直连模型入口，因此一并从 Dream `.env` 模板、实际本机 `.env`、`.cloud-env` 引用、部署脚本和 SDK project/process/user overlay 删除。
- 最终本机残留又发现非标准`ANTHROPIC_DEFAULT_SONNET_MODEL_NAME`；清理合同因此从固定名称集合收紧为拒绝/清除任意`ANTHROPIC_*`前缀，Gateway adapter随后只重建SDK transport必需的两个服务端内存字段。新增非标准key回归测试，定向套件仍为182通过。
- 审计确认 memory MCP 是返回主人/宠物共同故事的未实现空壳，故与动画和项圈 MCP 一并删除；Claude Code 其他通用能力、Story Workspace MCP、Editor MCP 和 canonical 用户 Session 查询 MCP 均保留。
- Admin Gateway adapter 仍在服务端内存中使用 Claude Agent SDK transport 所要求的固定字段名写入 Gateway base URL 和短期 canonical subject JWT；project/process/user env 在进入该 adapter 前会清除所有直连 Provider 值，Gateway disabled 也不会回退直连。

执行证据与验证结果：

- 删除8个宠物领域可执行模块/空壳：touch animation、necklace tool/server/stdio、shared-story memory tool/server/stdio、仅供该空壳使用的 policy loader；`mcp_server.py` 重写为 Session-only，运行时 `tools/list` 实测唯一工具为`get_sessions_range`。
- `agent_runner.py`已移除宠物工具默认allowlist、低敏清单、namespace prefix、feature flag、stdio配置和启动分支；保留Story Workspace、Editor和Session MCP。
- 最终残留审计进一步删除可执行的`PAWKEYLAND_CLAUDE_AGENT_ALLOW_REQUEST_MODEL_OVERRIDE`、`PAWKEYLAND_AGENT_ALLOWED_TOOLS`和`PAWKEYLAND_ENABLE_AGENT_USER_MCP`兼容入口；模型alias只在Gateway启用时写入SDK options，默认工具与Session MCP由产品代码固定。部署、启动和Service边界对任意旧`PAWKEYLAND_*`值做清除而非透传。
- `.env.example`、`deploy/setup-env.sh`、`server.py`、`sdk_env.py`、`ClaudeAgentService`已形成四层清理：模板不声明、部署不透传旧值、启动清除进程旧值、DB直读与SDK overlay再次清除。实际gitignored `backend/.env`中的有效行和注释旧值，以及`.cloud-env`旧引用均已按key机械删除且未回显值；验证`backend_env_removed_keys=0`、`cloud_env_removed_refs=0`。
- `PUT /api/system-config`继续拒绝secret/provider routing key，`GET`继续清理历史值；相关拒绝测试保留。Gateway adapter测试证明用户旧值被覆盖/删除、canonical subject、client、audience、scope和240秒有效期绑定正确。
- 定向backend验证：`182 passed, 1 skipped, 135 subtests passed`；server启动环境清理：`2 passed`。
- 全量backend从正确的`backend/`工作目录执行且命令级关闭本机Gateway canary：`1789 passed, 25 skipped, 89 warnings, 652 subtests passed`。相比上一轮减少2个测试来自删除的memory MCP alias测试，不是覆盖下降。
- frontend未做本轮业务修改，但按验收执行：lint `0 errors / 21既有warnings`；production build成功。运行期间发现并保留用户/并发产生的`storyWorkspacePath`和E2E未提交修改，本轮没有覆盖或回滚。
- `python -m compileall`、`bash -n deploy/setup-env.sh`、`git diff --check`通过；环境未安装ruff，未伪报ruff结果。
- 文档已同步：Settings PRD删除用户Provider API配置，Claude SDK env设计改为Gateway-only合同，部署/架构/Session与工具权限文档删除宠物MCP和直连Provider陈述；过时的`user-env-injection-design.md`已删除。

失败尝试及根因：

- 首次定向Runner套件为`165 passed / 75 failed`：本机`.env`同时启用`INK_GATEWAY_ENABLED`，而mocked Runner单元测试没有canonical user，全部在被测逻辑前按生产规则fail closed。修复为测试基类同时显式关闭两个Gateway canary开关；Gateway行为仍由独立adapter测试覆盖，重跑通过。
- 第一次全量backend从仓库根执行，在collection阶段因`test_admin_product_client.py`无法解析顶层`services`失败；没有改代码规避，改从项目约定的`backend/`工作目录重跑，全量通过。
- Ruff未安装，因此仅执行compileall、pytest、shell syntax和diff检查；已明确记录而非跳过不报。
- 残留清理后把Runner与server启动测试放进同一pytest进程时出现4个SDK stub构造失败，根因是`test_server_claude_agent` collection导入真实server/SDK后污染Runner模块stub，与业务断言无关；按现有测试隔离边界分别执行后Runner定向`182 passed, 1 skipped, 135 subtests`、startup cleanup`2 passed`。此前从`backend/`执行的正式全量顺序仍为1789通过。

未执行事项及原因：

- 未调用真实Provider、Admin Gateway推理、支付或外部网络：本轮是遗留配置/MCP删除，不需要真实凭据，也不得以验证名义扩权。
- 未修改PostgreSQL、Subscription、Allowance、Usage、Ledger或财务历史；无数据库写入需求。
- 未运行浏览器E2E：本轮没有前端产品代码改动；已用frontend lint/build验证跨层编译。现存frontend未提交路由/E2E改动属于用户或并发工作，未纳入本轮修改。

## Round 83 — 恢复宠物动画、项圈与共享记忆 MCP

Optimized Prompt:

作为 Ink Dream Claude Agent SDK 与 MCP 维护者，按用户最新决定精确撤销 Round 82 中“删除宠物 MCP”的部分：恢复宠物动画 `mcp__user__touch_animation`、项圈 namespace 工具、主人/宠物共享记忆 memory MCP 的源模块、stdio server、Runner默认工具/低敏策略/namespace与启动注册、package exports、必要feature flag和运行配置、对应测试与当前文档。恢复必须以Round 82修改前的仓库实现为基线，不得用静态伪实现替换原代码。

保留Round 82的Provider安全修正：Dream `.env`、用户System Config、部署脚本和project/process/user SDK overlay仍不得接受任意`ANTHROPIC_*`直连配置；Admin Gateway服务端短期SDK transport adapter仍是唯一推理认证边界。不得恢复`PAWKEYLAND_AGENT_ALLOWED_TOOLS`、Provider model override等与三个宠物MCP无关的隐藏运行入口，除非它们是恢复目标实际启动所必需。

保留Story Workspace、Editor和Session MCP现状，不覆盖并发存在的Story Workspace路由/E2E修改。恢复后运行模块import/compile、MCP tools/list与Runner allowlist验证、focused backend tests、frontend lint/build（若文档或跨层合同有影响）、shell syntax和`git diff --check`。不得修改PostgreSQL、订阅、Usage/Ledger，不调用真实项圈、Mem0、Provider或支付服务，不回显任何Secret。

Acceptance Criteria:

- 删除状态的8个宠物MCP模块及policy helper按原实现恢复。
- `user` MCP同时列出`touch_animation`与`get_sessions_range`；memory/necklace namespace重新可注册。
- Runner默认allowlist、低敏清单、stdio启动条件和exports恢复，但Anthropic直连env仍被全前缀清除。
- 必要Mem0/necklace环境只进入对应隔离MCP子进程，不进入浏览器或Provider SDK路由。
- 相关测试、文档、实际本机Secret安全检查通过；用户/并发未提交修改保持原样。

Optional Enhancers:

- 后续可将宠物MCP统一改为`INK_*`配置并补真实上游contract test；本轮优先无损恢复现有实现，不扩大外部联调范围。

范围变化：

- 用户撤销Round 82的宠物MCP删除决策；Round 82的Anthropic直连环境变量清理继续有效。
- 本轮仅恢复Dream宠物MCP实现及必要依赖，不修改Admin产品代码或PostgreSQL。

执行证据与验证结果：

- 本记录落盘前尚未执行恢复或测试。

失败尝试及根因：

- 无。

未执行事项及原因：

- 代码恢复、配置边界复核和测试需在本Prompt Architect记录后执行。

### Round 83 执行结果补记

范围变化：

- 用户要求加速并明确本轮就是撤销三类 MCP 删除；因此停止扩展设计，只恢复宠物动画、项圈和主人/宠物共享记忆 MCP 及必要注册、配置、测试和文档。
- Round 82 的任意 `ANTHROPIC_*` 直连环境变量清理继续有效，Story Workspace、Editor、Session MCP 与并发未提交修改均保留。

执行证据与验证结果：

- 从 Round 82 修改前的 HEAD 原样恢复 8 个删除文件：`touch_animation_tool.py`、necklace tool/server/stdio、memory tool/server/stdio、`policy_loader.py`。
- 恢复 `mcp_server.py`、`user_mcp_stdio.py` 及 package exports；运行时 `tools/list` 实测：user 2 个（`touch_animation`、`get_sessions_range`）、memory 1 个（`recall_shared_stories`）、necklace 7 个。
- Runner 默认 allowlist、memory/necklace namespace、低敏只读工具、stdio 配置与启动分支已恢复；动画确认 answers 在 PreToolUse 与 can_use_tool 两条通道均重新合并。
- Dream service 继续拒绝用户/System Config 提交的 Provider、legacy Pawkeyland 和记忆身份值；共享记忆 canonical 用户 ID 与当前消息由服务端派生后仅进入 memory MCP 子进程。
- canonical Mem0 配置重新进入 `.env.example`；启动白名单保留 `INK_AGENT_ENABLE_MEMORY_MCP` / `INK_AGENT_MEM0_*`；部署时 Mem0 API key 使用 Secret Manager，legacy `PAWKEYLAND_*` 与全部 `ANTHROPIC_*` 仍不透传。
- 快速回归：首次组合套件 `165 passed, 1 failed, 1 skipped`，修正旧断言后关键复测 `6 passed`；最终 MCP/Runner/startup 快速套件 `7 passed`。`python -m compileall`、`bash -n deploy/setup-env.sh`、`git diff --check`通过。
- 安全检查：`backend/.env`、`backend/.env.example`、`.cloud-env` 中 `ANTHROPIC_AUTH_TOKEN` / `ANTHROPIC_BASE_URL` / `ANTHROPIC_MODEL` 有效赋值计数均为 0；未输出 Secret 值。

失败尝试及根因：

- 首次直接调用 `pytest` 失败：当前 shell 无全局 pytest；改用 `backend/.venv/bin/python -m pytest`。
- 首次组合套件唯一失败是 service 旧断言未包含恢复后由服务端派生的 `INK_AGENT_MEM0_USER_ID` 与 `INK_AGENT_USER_MESSAGE`，更新断言后通过。
- 一次定向 pytest 节点名写错导致 collection exit 4；用实际方法名重跑通过。
- 一次文档残留搜索因 shell 双引号内反引号造成 unmatched quote；改用单引号安全模式重跑，无残留命中。
- 测试环境尝试连接本机 PostgreSQL 时受 managed sandbox 网络策略阻断，仅产生 warning；本轮测试不依赖数据库写入，未执行任何数据库变更。

未执行事项及原因：

- 未调用真实项圈、Mem0、Provider、Admin Gateway 推理或支付服务；本轮仅撤销源码删除，不需要也未获授权使用外部 Secret。
- 未执行 PostgreSQL、Subscription、Allowance、Usage、Ledger 变更。
- 未重跑 frontend lint/build或真实浏览器 E2E：本轮最终范围为 backend MCP 删除撤销，且 Round 82 已完成跨层 lint/build；为响应用户“速度点”要求采用 focused backend 验证。

## Round 84 — 撤销 Round 83 宠物 MCP 恢复

Optimized Prompt:

在 `/Users/dmeck/project/ink-dream-memory` 中完整撤销 Round 83 的改动，恢复 Round 82 已验证的清理结果：删除宠物动画、项圈和主人/宠物共享记忆 MCP 源文件、stdio server、Runner allowlist/namespace/启动注册、exports、相关环境配置、测试和文档；`user` MCP 仅保留 canonical Session 查询。保留 Round 82 对任意 `ANTHROPIC_*` 用户/项目/部署直连环境变量的删除，以及 Admin Gateway 服务端短期 SDK transport 适配边界。不得改动 `_drop_unsupported_agent_env` 的 Round 82 既有逻辑之外内容，不得覆盖其他未提交修改。运行 focused backend tests、compile、shell syntax、`git diff --check` 和环境残留检查；不修改 PostgreSQL，不调用外部服务，不输出 Secret。

Optional Enhancers:

- 无；用户要求快速完整撤销上一轮。

范围变化：

- 用户再次确认宠物动画等 MCP 与当前项目无关，Round 83 的恢复决定全部撤销，回到 Round 82 清理状态。

执行证据与验证结果：

- 本记录落盘前尚未执行回退。

失败尝试及根因：

- 前一轮 Round 84 日志写入被用户中断，检查确认未落盘；本轮重新记录最终要求。

未执行事项及原因：

- 回退与验证需在本 Prompt Architect 记录后执行。

### Round 84 执行结果补记

范围变化：

- 严格撤销 Round 83，不新增替代能力；`_drop_unsupported_agent_env` 恢复为 Round 82 既有实现。

执行证据与验证结果：

- 再次删除 8 个宠物领域模块/空壳和 Round 83 新增的 `test_pet_mcp_servers.py`。
- `mcp_server.py`、stdio 说明、package exports、Runner allowlist/低敏清单/namespace/stdio 启动分支已恢复为 Session-only 状态。
- 撤销 Round 83 的 service memory identity 注入、Mem0 `.env.example` 区块、部署 Secret 配置、测试断言和文档恢复陈述。
- MCP 运行时 `tools/list` 实测：`user_tools=get_sessions_range`，没有 animation、memory 或 necklace 工具。
- focused backend：`4 passed`；compileall、`bash -n deploy/setup-env.sh`、`git diff --check`通过。
- `backend/.env`、`backend/.env.example`、`.cloud-env` 中 `ANTHROPIC_AUTH_TOKEN` / `ANTHROPIC_BASE_URL` / `ANTHROPIC_MODEL` 有效赋值计数均为 0；宠物 MCP Python 执行路径残留搜索为 0。

失败尝试及根因：

- 无代码回退失败；仅保留 FastAPI `on_event` 既有弃用 warning，不影响结果。

未执行事项及原因：

- 未执行数据库、外部 Provider、Mem0、项圈、支付或浏览器 E2E；本轮仅撤销上一轮 backend MCP 恢复。

## Round 85 — Story Business Admin + Dream 跨系统交互设计

Optimized Prompt:

你是一名资深产品架构师、PostgreSQL/Drizzle 数据架构师、文件型 Artifact 系统架构师、Next.js/Refine 管理后台工程师、FastAPI/Python 工程师和 UI/UX 设计负责人。基于 `/Users/dmeck/project/ink-admin-memory` 与 `/Users/dmeck/project/ink-dream-memory` 的当前真实代码、现有设计文档、PostgreSQL `5433/ink-memory` 的只读 SQL 结果、SQLite 对照审计记录，以及共享 Artifact Root 中两条 canonical Story 的只读 metadata/文件证据，为 Ink Memory 的“剧本业务”编写一份完整、可评审、不过度设计的 Admin + Dream 跨系统交互设计稿。

本阶段仅允许：只读复核、问题判断、产品与交互设计、业务时序设计、目标符合性评估，以及更新本工作日志和创建主设计 Markdown 文档。禁止修改 Admin/Dream 业务代码、Drizzle schema、migration、PostgreSQL、SQLite、共享 Artifact；禁止恢复、伪造或推断不存在的 Episode identity、Project binding、provenance 或 Story。设计完成后必须暂停，等待用户审核。

已知架构边界必须作为设计不变量：Dream 是 Artifact 与 Story metadata 索引的唯一业务写入方；PostgreSQL `story_workspace_stories` 是 canonical Story metadata 索引；共享 Artifact Root 是 script、outline、storyboard、review report 内容真源；Admin 仅从 PostgreSQL 读取运营索引，并通过服务端 allowlist reader 只读预览共享 Artifact。Admin 不扫描任意目录发现 Story、不写 Artifact、不接收浏览器绝对路径、不直接 materialize Story。

先用代码、SQL、SQLite 对照和 Artifact metadata 证据回答：18 个历史 Run 是否创建 Story；`missing_relations` 是否错误包含非 Episode Artifact Run；是否需恢复 SQLite；是否需新 migration；Admin 为何不能用 Dream `?run=` 直接看到 Story；Workspace、Project、Story、Episode、Workflow Run、Artifact 的正确身份关系；当前问题属于数据缺失、候选过滤、状态命名还是 UI 导航；哪些属于代码修复，哪些属于交互/文案修复。结论必须明确，不使用“可能”。重点验证：18 个 Run 属于 `not_applicable`/`ignored`；`missing_relations` 仅用于已证实 Episode Artifact Run 且可信关系损坏；无 Episode authority/registry/Project binding 不创建 Story；无真实 schema 变化或精确一对一 mapping 不创建 migration。

创建 `/Users/dmeck/project/ink-admin-memory/docs/design/modules/story-business/admin-dream-interaction-design.md`，至少包含：执行摘要与问题处理判断；产品目标和非目标；身份与数据所有权模型；Dream execution 双轨 Artifact/Index 状态交互；Dream 到 Admin 的 `/admin/story/stories?source_run_id={runId}` 最小深链；Admin Story 列表、Workflow Run 入口、Run 上下文提示和安全只读 Drawer；`indexed`、`missing_index`、`stale`、`invalid_artifact`、`broken_relation`、`not_applicable`、`conflict` 的严格 reconcile 分类、判定优先级和动作；系统/筛选/指定 Run 空态；Artifact/Index/revision/权限/依赖错误状态；401、403、404、409、413、422、500、503 文案与恢复动作；Drizzle migration 判断；当前实现/本期改造/Deferred 对照；验收标准、风险与待审核决策；目标符合性和不过度设计评审矩阵。

文档必须明确：一个 Project 对应一个 canonical Story，多 Episode 聚合在同一 Story；stable key 为 `workspace_id + artifact_source_type + source_project_id`；`source_run_id` 只是当前索引 provenance 和查询入口，不是 Story stable identity；同 Project 新 Run 幂等更新同一 Story；`source_thread_ref`、绝对路径与 thread root 仅限服务端；文件写入成功和 Story 索引成功是独立状态；Artifact 不是独立 Story；Admin 在数据库无 Story 行时不得伪造列表记录；Artifact reader 不可用时仍展示数据库 metadata；索引异常优先链接回 Dream 处理，不建设新的跨服务写 Gateway。

至少提供三张 Mermaid 时序/流程图：正常 Dream 生成、幂等 materialize、Admin 深链与安全预览；Artifact 写入成功但 PostgreSQL 索引失败后用同 revision 安全重试；历史 Run 先验证 Episode authority/registry，再分类 `not_applicable`、`broken_relation`、`missing_index`、`stale`、`indexed`。另提供 Dream/Admin 交互状态矩阵、桌面和移动低保真线框图、共享 Story Index Status JSON golden fixture、`source_run_id` 深链 URL/空态/权限验收用例。

Drizzle 结论默认：`0027_young_stark_industries.sql` 已覆盖 Story Artifact Schema；`source_run_id` 精确筛选优先做 Repository/API/UI 改造；仅在真实规模与 `EXPLAIN` 证明必要时才新增查询索引；禁止空 migration，禁止借 migration 给 18 个历史 Run 构造关系。

Acceptance Criteria:

- 所有事实性结论均附当前代码路径/符号、SQL/审计文档或 Artifact metadata 证据，可被复核。
- 明确将当前 18 个历史 Run 定义为 `not_applicable`，并解释为何不是迁移遗漏或 `broken_relation`。
- Dream 与 Admin 的双状态、深链、空态、错误态和恢复动作完整且一致。
- 三张 Mermaid 图可渲染，并严格遵守唯一写入方与 Admin 只读边界。
- 目标评审逐项覆盖不扫描目录、不复制正文、不伪造关系、不新增平行表/SQLite runtime/服务 JWT/跨服务 Gateway/消息队列/无必要 migration。
- 明确本期最小范围、Deferred 能力、风险和需要用户批准的决策。
- 仅产生工作日志与主设计文档变更；设计完成后停止，不实施任何业务改造。

Verification:

- 只读检查相关 Admin/Dream 代码、迁移、测试、设计/审计文档、SQL 查询结果与两条 canonical Artifact metadata。
- 用 `rg`/结构化查询建立结论到证据的映射；核对 20 Run、18 个非适用候选、2 条 canonical Story、`content IS NULL`、episode count、revision 一致性等已知事实。
- 检查 Markdown 表格、链接、Mermaid 语法、状态词一致性和设计边界；使用无对话上下文的 reader review 检查歧义与矛盾。
- 最终运行 `git diff --check`，并确认差异仅包含允许的文档文件。

Optional Enhancers:

- 低保真线框以实现约束为导向，分别覆盖桌面 Drawer 与移动全屏详情。
- JSON golden fixture 仅定义跨系统显示/测试合同，不宣称本期新增持久化 schema 或强制跨服务 API。
- 将“当前实现 / 本期改造 / Deferred”并列表达，防止服务 JWT、Gateway、队列等提前进入首版。

范围变化：

- 本轮进入 Story Business 跨系统产品与交互设计阶段，只交付证据驱动的设计结论，不实施代码或数据变更。

执行证据与验证结果：

- 本记录落盘前尚未执行代码、数据库、Artifact 或审计证据复核。

失败尝试及根因：

- 无。

未执行事项及原因：

- 只读审计、主设计稿编写与 reader review 必须在本 Prompt Architect 记录后执行。

## 2026-08-10 — Dream 剧本生产主链完整性审计、交互设计、实现与发布级验收

### Optimized Prompt

你是 Ink Dream Memory 的业务架构师、交互设计负责人、全栈工程师与发布级 E2E QA 负责人。对 Dream 剧本生产主链执行一个证据驱动、fail-closed、可回滚、可追踪的完整闭环：先只读审计并建立真值与覆盖矩阵，在证据支持下输出问题处理判断；再编写不制造第二套业务状态的交互设计稿；随后以 TDD 实施最小安全修复并扩大回归；最后用 Mock 与隔离 PostgreSQL 真实运行时完成桌面/移动真实浏览器验收和资源清理。不得把单元测试、Mock 成功、截图或单接口 200 等同于业务 E2E 完整。

工作目录与证据入口：

- Dream 仓库：`/Users/dmeck/project/ink-dream-memory`
- Admin 架构入口：`/Users/dmeck/project/ink-admin-memory/docs/architecture/ink-dream-memory`
- 修正记录：`/Users/dmeck/project/ink-admin-memory/docs/verification/ink-memory-admin-correction-worklog.md`

阶段 A — 只读审计（在完成前禁止修改业务代码）：

1. 枚举登录/canonical user、订阅、Plan Version、Entitlement、Allowance、公共模型目录、platform model identifier 保存、Workflow Run 创建/重入、Dream Agent、服务端 Gateway alias/资格/Provider 路由、Token reserve/capture/release、受控 Dream 产物写入、Workflow/Dream Files/Agent Messages/Episode Binding/Artifacts/Action Projection 一致性、刷新/重入/响应式恢复和安全错误呈现的端到端数据流。
2. 对每一步记录入口、调用者、DTO/API、持久层、真值所有者、权限边界、幂等/并发合同、失败状态与现有测试证据；不得从 DOM、按钮或浏览器 session state 反推服务端真值。
3. 建立覆盖矩阵，至少包含：无订阅、无模型权限、Allowance 耗尽、Gateway 未配置/不可达、模型下架/无权/alias 失效、目录加载/空/重试/保存、Run 创建/重入/刷新/隔离、Agent SSE/取消/重试/工具确认、人物/场景/剧本/分镜/审阅/Prompt/渲染指引、workflow detail/dream-files/messages/episode-artifacts、Token 幂等、Provider/usage/流式失败、psycopg 原生类型、404/409/422/429/502/503、1440×1000 与 390×844、键盘/焦点/ARIA/loading/empty/error/last-good、浏览器诊断零非预期错误和敏感信息不泄露。
4. 输出已有覆盖、缺失覆盖、用户故障、根因/触发/范围、真值归属、必须修复/应改进/可延期、缺陷分类、最小安全方案、不应采用方案及分阶段发布风险。根因不预设；证据不足时明确标记未知。

阶段 B — 交互设计：

在仓库既有设计文档目录新增设计稿，覆盖背景/目标/非目标、用户影响、角色任务、完整旅程、模型—订阅—Token—Workflow 关系、信息架构、全状态交互、桌面/移动、键盘/焦点/ARIA、继续/取消/重试/幂等、Mermaid 状态机与时序、API/DTO/ETag/revision/idempotency/error contract、truth ownership、安全隐私边界、E2E 双向追踪矩阵、验收/风险/回滚/诚实遗留。模型目录只来自 Admin 公共 Gateway；浏览器只持有 platform model identifier；计费与资格只由服务端拥有。

阶段 C — TDD 实施：

1. 先加入能稳定复现经审计确认问题的失败测试，并记录红灯证据。
2. 实施满足设计与现有架构的最小修复；不放宽断言、不吞异常、不硬编码当前数据、不引入 SQLite/JSON/内存 fallback。
3. 严格兼容 psycopg datetime、dict/list、boolean、nullable；保留 actor/workspace/run/story/episode 隔离；所有写请求具备幂等与并发冲突处理；Gateway/Provider/计费失败 fail closed。
4. 不覆盖用户未提交修改；禁止 DROP、TRUNCATE、生产库测试写入、跨账号数据重归属和破坏性 Git 操作。

阶段 D — 验证与发布门禁：

1. 依照仓库 Playwright 与 `ink-dream-playwright-qa` 执行 preflight/端口归属；在导航前注册 response/requestfailed/console/pageerror；不停止未知归属服务。
2. Mock Chromium 验证确定性边界；真实 E2E 使用明确隔离的 PostgreSQL clone 和本轮自有后端端口；共享真实数据库仅 SELECT/rollback；没有明确授权时不调用收费 Provider。
3. 断言业务事实和跨服务一致性，截图/trace 仅作辅助；覆盖 1440×1000 与 390×844、刷新/重入、错误合同、可访问性和敏感信息边界。
4. 执行 backend focused、Dream/Workflow/Episode 扩大回归、PostgreSQL runtime integration、frontend source contract、Mock Chromium E2E、真实浏览器 E2E、ESLint、TypeScript、production build、`git diff --check`。
5. 结束后仅关闭本轮确认归属的服务，删除精确命名的测试资源，确认无未授权数据库写入，并把命令、环境、准确 pass/fail/skip 数量和清理结果追加回本 worklog。

最终交付必须包含：修复结论、证据化根因、设计文档与修改文件、需求—测试—API—代码双向追踪、每组测试准确计数、真实浏览器视口与关键接口状态、Token reserve/capture/release 一致性证据、未执行的真实外部场景、数据库无未授权写入确认、服务/资源清理、遗留风险和发布门禁。任何未完成项必须明确说明；不得以“代码已实现”或“Mock 已通过”宣称业务完整。

### Optional Enhancers

- 为关键 E2E 保存 Playwright trace、网络摘要与脱敏截图，并在矩阵中关联证据文件。
- 为每项缺陷增加 severity、likelihood、detectability 与 rollout/rollback owner。
- 增加 mutation/negative-path 检查，证明 401/402/403/409/422/429/502/503 不会被包装为成功。

### 本轮问题与用户影响

Dream 模型、订阅计费与 Admin Gateway 已接入，但目前尚未以跨边界证据证明用户能够从资格/模型选择完成剧本生产、读取后续产物，并在刷新、重入、失败和移动端场景下维持服务端事实一致。潜在影响包括虚假成功、错误资格提示、Token 账实不符、Run 与 Episode 产物漂移、失败后不可恢复、跨权限读取和敏感信息泄露。本轮先验证这些风险是否真实存在，不预设根因。

### 事实来源和真值所有者

- 身份与权限：canonical actor/workspace 解析及服务端授权结果。
- 订阅与计费：Subscription、Plan Version、Entitlement、Allowance、Token Ledger 服务及 PostgreSQL 记录。
- 模型与推理：Admin 公共 Model Gateway 的目录、alias、资格校验、Provider 路由和脱敏错误合同。
- 流程：Workflow Run 持久化状态、revision/ETag 与动作投影。
- Dream 业务：Dream Files、Agent Messages、story/run/episode binding。
- 最终产物：Episode artifacts 和受控文件产物；文件存在本身不得覆盖数据库绑定与权限真值。
- 浏览器：仅拥有临时展示、焦点和 last-good UI 状态，不拥有资格、余额、流程完成或产物真值。

### 修改范围与明确不修改范围

范围：Dream 仓库中经审计证明确有必要的后端、前端、数据库适配、合同测试、Playwright、设计文档与测试辅助设施；Admin 仓库仅追加本 worklog 和读取架构材料。非范围：生产数据迁移、真实收费 Provider 调用、Admin 平台无关模块重构、视觉品牌全面改版、跨账号数据修复、为通过测试而放宽合同或建立前端影子状态。

### 测试矩阵

矩阵维度包括：资格（无订阅/无 entitlement/余额不足/有效）、模型（正常/空/下架/无权/alias 失效）、Gateway/Provider（未配置/不可达/限流/错误/usage 缺失/流中断）、Run（创建/重入/刷新/取消/重试/冲突/隔离）、产物（人物/场景/剧本/分镜/审阅/Prompt/渲染指引及 Episode artifacts）、数据类型（datetime/JSONB/bool/null）、错误合同、幂等计费、桌面/移动、键盘/ARIA、浏览器诊断、安全脱敏。每个单元格标注现有/新增测试、环境、断言和证据。

### 完成标准

只有在审计报告、交互设计、TDD 修复、指定静态/单元/集成/浏览器测试、跨服务事实断言、准确测试计数、worklog 回执和资源清理均完成后，才能宣称本轮完成。因环境或授权无法执行的外部场景必须作为明确发布门禁，不得推定通过。

### 风险、回滚与资源清理要求

风险包括错误修改既有合同、覆盖用户工作树、误连共享/生产数据库、误停他人服务、计费重放、Provider 成本和敏感信息泄露。实施需保持小提交面和兼容边界；回滚以逐文件最小代码回退/功能开关/恢复既有 UI 路径为主，不执行破坏性 Git。测试使用精确命名的隔离数据库/资源和自有端口；结束时确认关闭自有进程、删除本轮资源、无悬挂 reservation、无未授权数据库写入、无凭据进入日志/trace/截图。

### 执行结果补记

#### 结论与根因

- 已修复一个真实跨入口一致性缺陷：标准 Chat 路由会解析服务端模型 alias，但 Dream launch、Dream guidance、Dream Agent 内部 turn 可绕过该路由并将空模型交给 runner。现在所有 Dream-context turn 在 runner 组装前都重新读取 Admin 公共目录和服务端保存的 platform alias；浏览器 alias 只能与服务端选择相符，不能覆盖；已下架/无权的已保存 alias 返回 409，不静默切换默认模型。
- 已修复一个虚假挂起缺陷：launch 后台 SSE 原先丢弃所有 frame，Agent 终止错误不会落盘，Run 可长期停在 queued 且 source 已标 dispatched。现在识别 allowlist 错误码或通用终止错误，使用新连接和合法 WorkflowRunService 转移 `queued -> failed`，写入 `failed_step=dream_agent_dispatch` 及脱敏错误，并同步 source metadata 为 failed。
- 已修复两个交互真值问题：模型目录刷新失败不再清空 last-good；Workflow Run `failed` 不再因 durable confirmation 被显示为“继续执行”，而呈现明确失败、重读和返回动作，重读 Promise 失败不会形成未处理异常。
- `queued -> running` 仍必须有 Runtime Load Receipt 与 Agent Session，不能通过 UI 或 launch 路由伪造。本轮没有证据证明完整剧本生产到 Episode artifacts 的真实跨服务成功链，因此不能给出“业务 E2E 完整”结论。

#### 交付文件

- 审计：`/Users/dmeck/project/ink-dream-memory/docs/design/story-workspace/2026-08-10-dream-production-main-chain-integrity-audit.md`
- 交互设计：`/Users/dmeck/project/ink-dream-memory/docs/design/story-workspace/design_012_dream-production-main-chain-integrity.md`
- 核心实现：`backend/services/admin_gateway/selection.py`、`backend/claude_agent/service.py`、`backend/routers/claude_agent.py`、`backend/services/story_workspace/dream_launch_gateway.py`、`backend/services/story_workspace/guidance_service.py`、`frontend/src/components/dashboard/ModelConfigSection.tsx`、`frontend/src/pages/story-workspace/StoryWorkspaceDreamPage.tsx`、`frontend/src/pages/story-workspace/dreamViewModel.ts`、`frontend/vite.config.ts`。
- 核心测试：`backend/tests/test_admin_gateway_model_selection.py`、`backend/tests/test_claude_agent_service.py`、`backend/tests/test_story_workspace_dream_launch_api.py`、`frontend/e2e/model-settings-gateway.spec.ts`、`frontend/e2e/story-workspace-episode-execution.spec.ts`、`frontend/e2e/dream-model-postgres-real.spec.ts`、Dream view-model source contract。

#### TDD 与回归证据

- RED：selection module 不存在导致 collection error；Dream launch eligibility 注入参数缺失导致 TypeError；stream consumer 不接受可注入 factory/failure handler；模型目录 503 后 last-good 文案/选项缺失；failed lifecycle 仍被推导为 continuing。对应最小实现后均转绿。
- 后端最终扩大矩阵：`316 passed, 4 skipped, 158 subtests passed`。覆盖 Admin Gateway models/inference/selection、Gateway adapter、Product BFF、Claude Agent service、Dream launch/messages/confirmation/files、Episode artifacts 与 Workflow Run。
- 后端最终聚焦复测：`42 passed, 1 skipped, 28 subtests passed`。新增原生 psycopg JSONB dict 复制解析、alias 冲突/下架/无资格、Dream turn alias、launch precheck/SSE/durable failure。
- PostgreSQL runtime integration：`3 passed`；Story Index PostgreSQL adapter：`36 passed, 1 skipped`，唯一 skip 明确为 Admin Story Index migration 是 schema prerequisite。测试使用隔离 clone 并以 rollback/空库断言约束写入。
- Admin Gateway/Token focused Vitest：`8 test files passed, 34 tests passed`。覆盖 subscription gateway、Token ledger、Anthropic/OpenAI stream handler、SSE/usage、settlement worker 与 settlement route 的 reserve/capture/release/失败合同。
- 前端 source contracts：`365 passed`。
- Mock Chromium：`7 passed`，包含模型目录正常与 last-good 503、订阅桌面 `1440x1000`、移动 `390x844`、Episode revision 恢复、Dream Agent 工具确认与运行标识。
- 真实 Chromium：`1 passed`，桌面 `1440x1000` 保存后切换到移动 `390x844` 刷新恢复；链路为 Vite `4177` -> Dream FastAPI `18765` -> PostgreSQL clone `127.0.0.1:55439/ink_memory_dream_empty_codex_test` -> 本地确定性 catalog stub `18103`。关键 `GET /api/gateway/models`、`GET/PUT /api/system-config` 均为 200；请求体仅 `{model: dream-fast}`，无 Provider Secret、Token、API key 或 DSN。
- 真实浏览器后只读数据库证据：`savedModel=dream-fast`、`savedProvider=gateway`、`workflowRuns=0`、`chatMessages=0`、`events=0`。该 canary 只证明真实 BFF/psycopg/catalog/alias 保存与恢复，不伪造 Agent、Workflow 或 Episode 成功。
- ESLint：退出 0，`0 errors, 21 warnings`；warning 为既有 React Hook dependency 告警。TypeScript + production build：退出 0，2758 modules；仅有既有 dynamic-import/chunk-size warning。最终 `git diff --check` 通过。

#### 诊断失败与处理

- 一次后端 pytest 从仓库根运行导致 `database` 模块路径缺失；selection 增加 package-import fallback，并从 backend 正确工作目录复跑通过。
- 一次误用临时下载的 Vitest 执行 Playwright source tests，因两套 `@playwright/test` 报 49 suite collection errors、0 tests；改用仓库真实 `npx playwright test src`，365/365 通过。该失败不计为产品测试失败。
- Mock E2E 首次带 `--project=chromium` 未执行任何测试，因为仓库默认项目未命名；移除无效参数后 7/7 通过。
- 真实 E2E 首次未传 clone DSN，按 fail-closed 在令牌生成前拒绝；第二次因测试令牌与旧测试后端签名不一致返回 401。没有读取旧进程 Secret，而是关闭本轮自有后端并以全新临时测试配置重启。
- 真实 E2E 重放时，隔离用户已是 `dream-fast`，对已选 radio `check()` 不触发 PUT 并超时；测试增加隔离 clone 内显式重置 `dream-balanced`，再切换到 `dream-fast`，最终 1/1 通过。这是测试可重放性修复，不放宽业务断言。
- Mock 扩大测试早期出现 3 个失败：预期失败资源被 console 诊断计入、Episode fixture 未覆盖现有 Story Index 请求；修正诊断 allowlist 和 fixture/ETag 后最终 7/7 通过。

#### 数据、计费与安全边界

- 未连接或写入共享/生产 PostgreSQL；所有 runtime 写入只发生在精确命名的隔离 clone。PostgreSQL integration 采用 rollback；真实 UI canary 只创建隔离用户偏好并最终保存 alias。没有 Run、Message 或 Event 写入。
- Token reserve/capture/release 本轮证据来自 Admin 的 34 个聚焦合同测试；没有运行 Admin PostgreSQL billing E2E，也没有跨服务关联某个 Dream turn 与真实 ledger row。因此没有声称真实计费闭环完整，也没有悬挂 reservation 证据需要清理。
- 未调用收费 Provider、真实 Admin Gateway、真实订阅/支付服务或外部 canary；catalog 为本地确定性 stub。请求/页面/报告未记录真实 Token、Secret、完整 DSN 或 Provider 凭据。

#### 清理与回滚

- 已关闭本轮自有 Vite `4177`、Dream FastAPI `18765`、Gateway stub `18103`；三端口最终均 closed。未知归属的 `5173/8765` 未触碰。
- 已停止并删除精确容器 `ink-dream-round-20260810-pg`；已删除 stub 文件及 `ink-dream-round-20260810-{source-contract,mock-e2e,real-e2e}-final` 临时目录。最终没有同前缀容器或 `/private/tmp` 资源。
- 恢复了被 Playwright 默认 output 误覆盖的已跟踪 `frontend/test-results` 基线；未覆盖用户/并发产生的 Admin 未跟踪设计稿，也未执行破坏性 Git 操作。
- 回滚可按新增共享 resolver、Dream failure persistence、last-good/failed UI 和 Vite test proxy seam 分块逐文件回退；不需要数据库 migration 或数据修复。

#### 未完成项与发布门禁

- 必须补齐隔离 Admin PostgreSQL billing E2E，真实证明无订阅、无 entitlement、Allowance 耗尽、reserve/capture/release、幂等重放、usage 缺失和流式中断；当前只有单元/合同证据。
- 必须建立 Dream turn/run/correlation id 到 Admin Gateway settlement/Token ledger 的可审计关联，并在一个隔离跨服务环境断言账实一致。
- 必须让真实 Dream launch 获得 Runtime Load Receipt 与 Agent Session，再验收 `queued -> running -> completed/failed/cancelled`，并读取 Dream Files、Agent Messages、Episode Binding、Episode artifacts 与 Action Projection；当前 canary 不执行 Provider，也没有 Run。
- 真实收费 Provider canary 需单独明确授权、成本上限和安全凭据；本轮未执行。
- Story Index PostgreSQL integration 仍有 1 个 schema prerequisite skip；发布环境必须先证明对应 Admin migration 存在且版本一致。
- 21 条 ESLint warning 与 bundle chunk/dynamic-import warning 不阻塞本轮修复，但属于诚实遗留；发布前应按仓库性能/质量门禁决定是否治理。

综上，本轮代码缺陷和交互缺陷已修复并通过分层验证；“模型目录/alias 的真实浏览器 PostgreSQL 链”已证实，但“订阅计费 -> 真实模型推理 -> 完整 Dream 剧本与 Episode 产物”的发布级跨服务 E2E 仍未完成，必须保持发布门禁。

## 2026-08-10 — Dream 完整业务 E2E 发布门禁收口

### Optimized Prompt

你是 Ink Dream Memory 的业务架构师、分布式系统测试负责人、全栈工程师和发布级 E2E QA 负责人。继续上一轮未完成的 Dream 剧本生产完整性目标，不重复已证实的模型目录/alias canary，而是以当前工作树、当前 Admin/Dream 架构与真实运行时为唯一事实，关闭剩余发布门禁：订阅资格与 Token ledger 的隔离 PostgreSQL 证据、Dream turn 到 Gateway settlement 的 correlation、合法 Workflow Run 生命周期、Dream Agent 消息与 SSE 失败/取消/重试、Dream Files 与 Episode Binding/Artifacts/Action Projection 的跨层一致性，以及桌面/移动刷新重入后的真实状态恢复。

执行顺序必须为：先只读完成 requirement-to-evidence completion audit，逐项判断现有实现、测试和运行环境能否证明目标；再为缺失证据新增稳定失败测试；随后实施最小且架构一致的修复/测试夹具；最后运行分层单元、Admin/Dream PostgreSQL integration、Mock Chromium 和隔离真实浏览器 E2E。不得把上一轮 green、Mock、单接口 200、源代码存在或本地 stub 单独等同于完整业务成功。

本轮必须重点验证并尽可能完成：

1. 在精确命名的隔离 Admin PostgreSQL 与 Dream PostgreSQL 环境中，证明 canonical user 的订阅、Plan Version、Entitlement、Allowance 与模型 callability 一致；无订阅、无权限、额度耗尽必须分别保留 401/402/403/409/429/503 等真实安全合同，且 Provider 不被调用。
2. 对一个隔离 Dream turn 建立稳定 correlation/idempotency key，证明 Gateway reserve -> Provider/stub usage -> capture，或失败/流中断时 release/settlement；重放不得重复扣减。不得调用收费 Provider，除非已有显式安全 canary 授权；允许使用协议真实、确定性的本地 Provider stub，但必须明确其证明边界。
3. 使用正式 PostgreSQL schema 和合法服务，不绕过 Workflow 状态机：创建 Run，绑定 Runtime Load Receipt、Agent Session 与所需 preflight/lock，验证 queued -> running -> completed/failed/cancelled 的允许转移与冲突；不得直接 SQL 篡改业务状态。
4. 从真实 API/浏览器验证 Dream Agent message/SSE、tool confirmation、取消、重试、幂等和错误落盘；401/402/403/409/422/429/502/503 不得被包装为成功。
5. 验证人物、场景、剧本、分镜、审阅、Prompt、渲染指引等 Dream Files 与 Workflow Run、Episode Binding、Episode artifacts、Story Index、Action Projection 的 identity/revision/ETag 一致性；若当前正式架构没有可生成这些事实的本地确定性执行器，必须定位精确缺口并实现最小可验证 seam，不能用 DOM/fixture 文件伪造服务端完成状态。
6. 真实 Chromium 覆盖 1440×1000 与 390×844、刷新、重新进入、last-good、键盘/焦点/ARIA、loading/empty/error；导航前注册 response/requestfailed/console/pageerror，最终要求零非预期应用诊断。
7. 运行 backend focused 与扩大回归、Admin Gateway/Token tests、Admin/Dream PostgreSQL runtime integration、frontend source contracts、Mock Chromium、真实 Chromium、ESLint、TypeScript、production build、`git diff --check`。给出准确 pass/fail/skip 数量。

约束：模型目录仅来自 Admin 公共 Gateway；浏览器仅保存 platform model identifier；Subscription/Entitlement/Allowance/Token Ledger 为服务端真值；PostgreSQL 是正式数据源，不允许 SQLite/JSON/内存 fallback；兼容 psycopg 原生 datetime/JSONB/bool/null；所有写入有幂等/并发合同；Gateway/Provider/计费失败 fail closed；不写共享/生产库，不调用真实收费 Provider，不泄露 Token/Secret/完整 DSN/绝对产物路径，不停止未知归属服务，不覆盖并发或用户未提交修改，不使用 DROP/TRUNCATE/破坏性 Git。

Acceptance Criteria:

- 每个原始要求均映射到代码/API/DB/浏览器的权威证据，并标注 proved、contradicted、missing 或 blocked；不能以“未发现问题”代替证明。
- 至少一个隔离跨服务场景证明订阅/模型资格、Gateway 请求、Token settlement 与 Dream turn/run 使用同一 canonical actor/correlation；至少一个失败场景证明 release/no-charge 和 Provider 未被错误调用。
- 至少一个合法 Workflow Run 完成或终止场景通过服务 API/状态机产生，并与 Dream messages/files/Episode facts 保持一致；若客观架构缺口阻止完成，必须继续实现可生产等价的最小 seam，而不是缩小目标。
- Mock 与真实浏览器均有业务断言、桌面/移动/刷新证据和零非预期应用诊断；截图不能代替断言。
- 所有隔离数据库、容器、端口、临时用户/ledger/resource 均精确清理；共享数据库仅 SELECT/rollback；最终 worklog 记录准确结果、未执行外部场景和诚实发布门禁。

Rollback and Cleanup:

- 新增测试 seam 必须默认关闭、仅显式测试环境启用；生产路径保持 fail-closed。
- 修复按模型资格、settlement correlation、Workflow lifecycle、artifact consistency、UI recovery 分块可回退，不新增无必要 migration 或第二套业务状态。
- 使用精确命名的本轮容器、数据库、端口和临时目录；结束时关闭仅本轮自有进程，删除精确资源，检查端口/容器/数据库残留并恢复误写的测试生成物。

### Optional Enhancers

- 保存脱敏 Playwright trace 与跨服务 correlation 摘要，建立 requirement -> API -> DB row -> test -> code 的双向追踪。
- 对 reserve/capture/release 和 Workflow 状态机增加 mutation/duplicate/reorder 测试，证明幂等与乱序安全。

### 本轮问题与用户影响

上一轮已修复真实缺陷，但完整业务仍缺“订阅资格与真实 ledger -> Gateway -> Dream Run -> Agent/Files -> Episode artifacts”的单次可审计证据。若直接发布，仍可能出现资格判断正确但扣费错误、推理已失败但 Run/产物显示成功、重试重复扣费、Run 与 Episode revision 漂移，或刷新后浏览器恢复成非权威状态。

### 事实来源和真值所有者

- canonical actor/workspace：Dream/Auth 服务端与数据库授权查询。
- Subscription/Plan Version/Entitlement/Allowance/Token ledger/settlement：Admin 服务与其 PostgreSQL。
- 模型目录、alias、Provider 路由与 usage：Admin Gateway；Dream 只保存 alias 偏好。
- Workflow lifecycle、preflight、runtime receipt、agent session：Dream Workflow 服务与 PostgreSQL。
- Dream messages/files/binding/actions：Dream 服务及其正式 PostgreSQL/受控 artifact store。
- Episode artifacts/Story Index：Episode/Dream artifact owner 与 canonical metadata；浏览器不得成为真值。

### 修改范围与明确不修改范围

范围：为关闭上述门禁所必需的 Dream/Admin 测试、隔离运行脚本、最小生产代码修复、浏览器 specs、设计/审计/worklog 补充。非范围：真实收费调用、生产/shared DB 写入、跨账号数据重归属、视觉全面重构、SQLite fallback、浏览器计费推导、硬编码当前数据库记录或无证据 migration。

### 测试矩阵

资格矩阵（有效/无订阅/无 entitlement/额度耗尽/模型下架）；settlement 矩阵（成功 capture/Provider 失败 release/usage 缺失/流中断/幂等重放/并发）；Workflow 矩阵（创建/合法 running/completed/failed/cancelled/冲突/重入）；产物矩阵（Dream Files 各 stage/Episode binding/artifacts/Story Index/action projection/revision）；浏览器矩阵（1440×1000、390×844、刷新、重入、键盘、ARIA、last-good、错误合同、零诊断）；类型与安全矩阵（datetime/JSONB/bool/null、脱敏、权限隔离、无外部收费）。

### 完成标准

只有 requirement-to-evidence 审计中所有明确要求都有权威通过证据，且隔离跨服务成功/失败/重放、合法 Workflow lifecycle、产物一致性、真实浏览器、静态/构建检查和资源清理全部完成，才能标记完整目标完成。任何真实外部 Provider 或现有架构无法验证的项必须继续作为活动发布门禁，不能据此缩小成功定义。

### 风险、回滚与资源清理要求

主要风险是测试 seam 泄漏到生产、跨库 actor/correlation 不一致、重复 settlement、直接篡改 Workflow 状态、误连共享库和残留 reservation/容器。所有测试能力默认关闭并带隔离数据库安全检查；失败时逐模块回退代码，不回滚用户数据；结束时确认无共享写入、无悬挂 reservation、自有端口关闭、精确容器/临时目录删除、敏感值未进入日志或报告。

### 执行状态

- 本 Prompt Architect 记录已先于本轮代码审计与修改落盘。
- completion audit、TDD、跨服务验证和清理结果待本轮执行后补记。

## 2026-08-10 — 以 Admin–Dream 业务设计稿为准的 Dream E2E 追踪与验收

### Optimized Prompt

你是 Ink Dream Memory 的业务架构师、需求追踪负责人、全栈工程师与发布级 E2E QA 负责人。以 `/Users/dmeck/project/ink-admin-memory/docs/design/modules/story-business/admin-dream-interaction-design.md` 为本轮业务交互与需求定义的首要设计真值，对改造后的 Dream 剧本业务执行 requirement-driven、evidence-based 的完整 E2E 审计、缺口修复与真实浏览器验收。不得继续依据泛化假设扩展范围；必须逐条读取该设计稿的角色、页面、状态、动作、API、数据库所有权、错误合同、桌面/移动、可访问性、幂等/并发、安全与验收要求，并建立“设计条款 -> 用户场景 -> API/DTO -> 真值所有者 -> 代码 -> 自动化测试 -> 运行证据”的双向追踪矩阵。

执行流程：

1. 完整读取设计稿及其直接引用的必要架构/合同文件；列出所有显式需求、非目标、不变量、状态机、时序、错误与验收标准。每项标注权威证据等级：proved、contradicted、missing、not-applicable 或 externally-gated。
2. 对照当前 Dream/Admin 工作树与现有测试，确认哪些测试真正覆盖设计交互，哪些只验证 Mock、单接口或旧交互；不得用源代码存在或历史截图替代当前运行证据。
3. 对 contradicted/missing 项先增加稳定失败测试，再实施最小修复。不得创造第二套 Story/Workflow/Subscription/Token/Artifact 状态，不得静态模型目录、浏览器计费推导、DOM 反推 Workflow、直接 SQL 篡改业务结果或恢复 SQLite fallback。
4. 真实业务验收必须覆盖设计稿定义的 Admin 与 Dream 入口、跨系统深链/上下文、订阅资格、模型选择、Gateway/Token settlement、Dream Run 创建/重入/失败恢复、Dream Files、Episode Binding/Artifacts/Action Projection/Story Index，以及 1440×1000、390×844、刷新、键盘、焦点、ARIA、loading/empty/error/last-good。
5. 使用明确隔离 PostgreSQL、一次性自有端口与本地确定性 Provider/Gateway stub；不调用收费 Provider。所有诊断监听在导航前注册，最终应用 console/pageerror/requestfailed/非预期 API failure 必须为零。
6. 运行设计稿追踪到的 backend/Admin unit、PostgreSQL integration、source contracts、Mock Chromium、真实 Chromium、ESLint、TypeScript、production build、`git diff --check`，记录准确 pass/fail/skip 数量与每项未执行原因。

Acceptance Criteria:

- 设计稿中的每条用户可见交互、状态、API、真值边界和验收条款都有唯一追踪 ID，并至少关联一个可执行断言或明确的外部门禁；没有未解释空白。
- 至少一个隔离成功链和一个失败/重试链从 canonical user、订阅/模型资格、Gateway/Token settlement 到 Dream Run/产物读取保持相同 identity/correlation/revision；失败不得显示成功或重复扣费。
- Admin 与 Dream 页面/深链遵循设计稿，不制造数据库不存在的 Story/Artifact；文件成功与索引成功保持独立状态。
- 桌面与移动真实浏览器均通过设计定义的关键任务、可访问性、刷新/重入与零应用诊断。
- 任何与设计稿矛盾的既有实现或测试均被修复或明确作为发布阻断，不能通过改写验收标准掩盖。
- 隔离数据库、容器、端口、测试用户、ledger/reservation 和临时文件全部精确清理；共享/生产数据库无写入。

Rollback and Cleanup:

- 测试 seam 默认关闭，只能在显式隔离 E2E 环境启用；生产路径始终 fail-closed。
- 修复按设计追踪 ID 分块可回退；不执行 DROP/TRUNCATE、跨账号重归属、破坏性 Git 或无必要 migration。
- 结束时关闭仅本轮自有服务，删除精确命名容器/distDir/Playwright 输出，确认无悬挂 reservation 与未知端口受影响。

### Optional Enhancers

- 输出设计需求—测试—API—数据库—代码的双向追踪表，并为关键跨系统时序保存脱敏 correlation 摘要。
- 对设计状态机执行 mutation/duplicate/reorder 测试，证明非法状态与重复命令 fail-closed。

### 本轮问题与用户影响

若不以指定设计稿逐条验收，现有测试即使数量很多，也可能验证旧页面、Mock 数据或与业务定义不一致的流程，导致 Admin/Dream 深链、订阅资格、Run/Artifact 状态和移动端交互在发布后偏离产品设计。

### 事实来源和真值所有者

- 交互与需求：指定 `admin-dream-interaction-design.md`。
- 身份/订阅/Gateway/Token：服务端 canonical user 与 Admin PostgreSQL。
- Workflow/Dream Files/Agent/Episode：Dream 服务端 PostgreSQL 与受控 artifact owner。
- Story Index/Admin 展示：canonical metadata 与 Admin 只读边界；浏览器只拥有临时 UI 状态。

### 修改范围与明确不修改范围

范围：设计稿直接要求的 Dream/Admin 代码、测试、隔离 runner、追踪文档与 worklog。非范围：设计稿未要求的视觉重构、真实收费 Provider、生产/shared DB 写入、第二套业务状态、硬编码历史数据、无证据 migration。

### 测试矩阵

按设计稿解析后生成，至少包含角色/入口、Admin-Dream 深链、订阅/模型/Token、Run 生命周期、文件与索引双状态、Episode artifacts/actions、错误/恢复、桌面/移动、键盘/ARIA、幂等/冲突、安全脱敏与资源清理。

### 完成标准

只有指定设计稿的 requirement-to-evidence 矩阵全部得到当前可执行证据，且真实隔离业务链、失败链、浏览器矩阵、静态/构建检查和资源清理完成，才能宣称本目标完成。任何 missing/contradicted 项继续保持活动发布门禁。

### 风险、回滚与资源清理要求

主要风险是把历史实现误当设计真值、为了 green 放宽条款、跨系统 identity/revision 漂移、重复 Token settlement、误写共享库或误停已有服务。所有修改必须最小、可追踪、可回退；只使用精确命名隔离资源并最终销毁。

### 执行状态

- 本记录已先于读取和分析指定设计稿落盘。
- 设计条款解析、追踪矩阵、代码/测试调整和最终验收待执行。

## 2026-08-10 — 三份业务设计合同驱动的 Dream 剧本 E2E 完整性验收

### Optimized Prompt

你是 Ink Dream Memory 的业务架构师、跨服务契约测试负责人、全栈工程师和发布级 E2E QA 负责人。以以下三份文档共同构成的现行业务合同为唯一需求基线，对模型服务与订阅计费网关接入后的 Dream 剧本主链执行完整、可追踪、证据驱动的 E2E 审计、缺口修复和发布验收：

- `/Users/dmeck/project/ink-admin-memory/docs/design/modules/story-business/admin-dream-interaction-design.md`
- `/Users/dmeck/project/ink-dream-memory/docs/design/model-service/07-model-service-integration-design.md`
- `/Users/dmeck/project/ink-dream-memory/docs/design/subscription/06-subscription-business-design.md`

先完整读取三份设计及其为理解合同所必需的直接引用，提取带稳定 ID 的需求、不变量、状态机、时序、API/DTO、真值所有者、错误合同、响应式和可访问性要求。建立 `requirement -> user journey -> API/DTO -> PostgreSQL/artifact truth -> code -> automated assertion -> runtime evidence` 双向追踪矩阵，并将每项标记为 `proved | contradicted | missing | externally-gated | not-applicable`。不得用既有测试数量、Mock 成功、单接口 200、源码存在或截图代替运行证据。

完整成功链必须证明：canonical user 登录和权限解析；Subscription/Plan Version/Entitlement/Allowance 与模型使用资格一致；Dream 仅从 Admin 公共 Gateway 获取并保存 platform model identifier；Run 创建/重入遵守 Workflow 状态机；Dream Agent 使用服务端验证后的 alias 调用 Gateway；Gateway 完成 alias、资格和 Provider 路由；Token reserve 后在成功 usage 上 capture、失败/中断时 release，重复请求不重复扣费；Dream 写入并安全读取设计规定的 Episode Artifact/Story Index；Admin 与 Dream 对 Project/Story/Run/Episode identity、revision、review freshness、artifact/index 双状态保持一致；桌面与移动在刷新、重入、错误和恢复后仍显示服务端真值。

失败矩阵至少覆盖：无订阅、无模型 entitlement、Allowance 耗尽、目录空/失败/last-good、模型下架或 alias 失效、Gateway 未配置/不可达、401/402/403/404/409/413/422/429/502/503、Provider usage 缺失、流式中断、取消/重试/工具确认、幂等重放、Workflow 非法转移、Artifact 文件成功但索引失败、revision 冲突、非 Artifact Run、Artifact store 503、UTF-8/路径/symlink/TOCTOU 安全边界。失败必须 fail closed、不得调用不应调用的 Provider、不得伪造成功或泄露 Token、Secret、DSN、路径和内部 identity。

按 TDD 实施：先为 contradicted/missing 项增加稳定失败测试，再做最小、架构一致的修复，最后扩大回归。PostgreSQL 是正式数据源；兼容 psycopg 原生 datetime、JSONB、boolean 和 nullable；浏览器不得拥有订阅、计费、Workflow、Artifact 或 Story 真值；Dream 是 Artifact/Story index 唯一业务写入方；Admin 只读 Artifact 并仅通过受控 CAS 写审核。不得恢复 SQLite/JSON/内存 fallback，不得建立第二套状态、静态模型目录、扫描文件列表、DOM 反推业务事实、直接 SQL 篡改状态或放宽断言。

真实验收使用明确隔离的 PostgreSQL clone、临时 Artifact Root、自有动态端口和确定性本地 Provider stub；不调用真实收费 Provider。运行前执行 Playwright preflight/端口归属检查，导航前注册 response/requestfailed/console/pageerror；覆盖 1440×1000 与 390×844、键盘、焦点恢复、ARIA、loading/empty/error/degraded/last-good；断言业务事实、响应合同、DB ledger/revision 和无页面级横向溢出，截图/trace 仅作辅助证据。运行 backend focused/expanded、Dream/Admin PostgreSQL integration、source contracts、Mock Chromium、隔离真实 Chromium、ESLint、TypeScript、production build、`git diff --check`，报告每组准确 pass/fail/skip。

Acceptance Criteria:

- 三份设计文档每条当前适用的用户可见交互、跨服务合同、状态/错误、安全与数据所有权要求都有追踪 ID 和至少一个可执行断言；任何空白都明确保持发布门禁。
- 至少一个隔离成功链和失败/重放链以同一 canonical actor、workspace、run、project、correlation/idempotency identity 串联 Subscription、model alias、Gateway、Token ledger、Workflow、Agent、Episode Artifact 与 Story Index；reserve/capture/release 守恒且无悬挂 reservation。
- 至少一个真实浏览器场景验证 Dream 主任务和 Admin 只读/审核交互，桌面与移动刷新重入后状态一致，零非预期 console/pageerror/request failure；Mock 不得代替此证据。
- Story identity、Episode registry、manifest/script revision、Artifact/Index/Review/Business 状态符合 Admin–Dream 设计，不把 Run 当 Story identity，不把 filesystem 503 降格为 missing。
- 所有隔离数据库、容器、进程、端口、临时目录、测试用户与 token reservations 精确清理；共享/生产数据库无写入，未知服务未被停止。

Rollback and Cleanup:

- 测试 seam 默认关闭且仅在显式隔离环境启用；生产路径始终 fail closed。
- 修改按追踪 ID 分块可回退；禁止 DROP/TRUNCATE、生产库写入、跨账号重归属、破坏性 Git、覆盖用户已有修改或无必要架构扩展。
- 失败后只关闭本轮创建的 PID/容器和精确命名资源，删除独立 dist/output/artifact root，检查端口、数据库、reservation 和临时凭据无残留；敏感值不得进入报告。

### Optional Enhancers

- 保存脱敏 Playwright trace、关键 DB 查询摘要和 correlation timeline，作为断言之外的辅助证据。
- 对 Token settlement、Workflow lifecycle、Story materialization 和 review CAS 增加 duplicate/reorder/concurrency mutation tests。

### 本轮问题与用户影响

Dream 改造后缺少由三份现行设计共同约束的完整业务测试。现有模型、订阅、Workflow 或 Artifact 测试即使分别为绿，也不能证明跨服务 identity、资格、扣费、状态机和最终剧本产物在同一次用户旅程中一致；发布后可能出现模型可选但不可调用、失败仍扣费、Run 完成却无可读产物、Admin/Dream 对同一 Story 认知不一致或移动端恢复错误。

### 事实来源和真值所有者

- Admin–Dream Story/Artifact/Review 交互：`admin-dream-interaction-design.md`；Dream 是 Artifact/Story index 写入者，Admin 为 PostgreSQL 查询与只读 Artifact/审核 CAS。
- 模型目录、platform model identifier、alias、Gateway 与 Provider 路由：`07-model-service-integration-design.md` 及服务端 Gateway。
- Subscription/Plan Version/Entitlement/Allowance/Token ledger：`06-subscription-business-design.md` 及 Admin PostgreSQL。
- Workflow/Agent/Episode 运行事实：Dream PostgreSQL、正式 Workflow/Agent 服务与受控 Artifact Root；浏览器仅拥有瞬时界面状态。

### 修改范围与明确不修改范围

范围：三份设计直接要求的 Dream/Admin 测试、隔离 runner、最小缺陷修复、需求追踪文档和 worklog。非范围：真实收费 Provider、生产/shared DB 写入、文档未要求的全面视觉重构、新微服务/队列/第二套数据库状态、历史数据硬编码、任意 Artifact 文件浏览或破坏性迁移。

### 测试矩阵

身份与权限；订阅/Plan/Entitlement/Allowance；模型目录/选择/alias；Gateway/Provider/Token settlement；Workflow lifecycle/重入/取消/重试；Agent messages/SSE/tool confirmation；Episode registry/artifacts/Story materialization；Admin list/detail/preview/review CAS；artifact/index/review/business 双轨状态；桌面/移动/键盘/ARIA；并发/幂等/错误/安全脱敏；PostgreSQL 原生类型和资源清理。

### 完成标准

只有三文档追踪矩阵中所有当前适用要求均为权威 `proved`，或被诚实标记为仍阻断发布的 external gate，且隔离成功/失败/重放链、真实双视口浏览器、数据库守恒、静态/构建检查与资源清理全部完成，才能宣称 Dream E2E 业务完整。

### 风险、回滚与资源清理要求

主要风险是用分散绿测替代跨链证明、测试 seam 泄漏生产、Actor/Run/Project identity 漂移、Token 重复结算、文件与索引状态混同、误连共享库和停止未知服务。所有测试资源必须动态且精确归属；失败时按模块回退代码而非回滚用户数据，并确认无悬挂 reservation、容器、端口、临时 artifact 或凭据。

### 执行状态

- 本 Prompt Architect 记录已在读取和分析新增两份设计文档前落盘。
- 三文档条款解析、追踪矩阵、缺口 TDD、真实验收与最终清理回执待执行。

### 最终执行回执（2026-08-10）

#### 结论

本轮关闭了模型 capability allowlist、Dream Agent turn 稳定 Gateway 幂等关联以及 Agent Story 持久化虚假成功三个缺陷，并建立了可重复的统一隔离 PostgreSQL + Admin Gateway + Dream FastAPI + Dream Vite + 本地无费用 Provider + Chromium runner。模型选择、真实 Agent SSE、Gateway 路由、Token settlement、消息和可重读 Story bundle 已在同一 canonical actor/turn 上得到证据。

Dream 完整剧本生产仍不满足发布标准。最终 Admin–Dream Story 合同要求的 `artifact_status`、无 `artifact_available`、sync 状态域和条件约束尚未落地；合法 Workflow Run → Episode Artifact → Story Index 的同链真实浏览器验收也尚未完成。该项保持发布阻断，不把本轮 legacy Story bundle 或既有手写 Artifact Reader 用例冒充 Episode 完成。

#### TDD 与根因证据

- Model capability strict allowlist：新增失败测试后首次 `1 failed, 2 passed`；收紧为 `chat/json/tools/vision/streaming` 后 `3 passed`。
- Gateway turn correlation：新增 deterministic idempotency/custom-header/injection 测试首次 `3 failed`；实现后相关组合 `23 passed, 17 subtests passed`。
- Agent Story transaction：真实 Chromium 首先观察到 SSE `story-workspace-output`，但紧随其后的 Story GET 返回空。代码根因是同步包装层释放 SAVEPOINT 后未 commit，连接归还池时回滚，造成虚假成功。事务测试修复前 `2 failed, 17 deselected`，最小 commit/rollback 修复后 `2 passed, 17 deselected`；真实浏览器随后可重读 1 条 Story、2 人物、2 场景。
- 最终 Story schema contract：`1 file failed / 2 tests failed`，准确缺口为 `artifact_status` 不存在、`artifact_available` 仍存在，以及 `artifact_status/identity/revision-state/review-integrity/business-review` 五组约束缺失。直接改共享 schema 会影响既有数据与两仓库兼容，未在没有 forward migration/数据证明的情况下强行写入。

#### 真实跨服务与浏览器证据

- 统一 runner：`/Users/dmeck/project/ink-dream-memory/scripts/run-dream-business-e2e.mjs`。
- Schema 顺序：Admin migrations through `0026_harsh_victor_mancha` → Dream Alembic head（校验 owner/ACL）→ Admin remaining migrations；一次性数据库名带 `_test` 隔离标记。
- Chromium 模型目录/保存/恢复：`1 passed (1.7s)`；1440×1000 保存 `dream-fast`，390×844 reload 后仍由 PostgreSQL 恢复，浏览器写请求只有 `{model: "dream-fast"}`。
- Chromium Agent/Gateway/SSE/Story：`1 passed (4.1s)`；SSE 事件顺序为 message metadata、text、message-final、story-workspace-output、finish(stop)，无非预期 console/pageerror/requestfailed/API error。
- 同一 turn Gateway：`gatewayRequests=1`，请求 alias `dream-fast`，Provider route `dream-upstream-fast`，input/output usage `17/73`，charged Tokens `90`。
- Token Ledger：reserve `41343`、capture `90`、release `41253`，`reserve = capture + release`，最终 `reservedTokens=0`；稳定 idempotency key 为 `dream-turn-<sha256(canonicalUserId,threadId,messageId)>`。
- Provider：本轮本地 Provider 仅 1 次调用，真实外部 Provider 调用 `0`。
- Mock Chromium：模型加载/last-good retry 与 Episode 交互/工具确认/Agent 布局共 `5 passed (8.4s)`。
- Admin Subscription/Token 隔离 Chromium（本轮前置 runner 当前工作树证据）：`1 passed (17.6s)`；4 Gateway requests（2 succeeded/2 failed）、6 ledger entries、0 conservation mismatch、reserved Tokens 0，并证明 402 不调用 Provider/不使用现金兜底。

#### 扩大回归与静态门禁

- Dream backend focused + Agent/Story/Artifact PostgreSQL/API/Tool 扩大回归：`188 passed, 3 skipped, 48 subtests passed`。
- Dream Story Workspace source-contract/browser-harness：`219 passed (4.2s)`。第一次沙箱运行在动态端口 harness 阶段停滞并由本轮中止（exit 130），获得回环监听权限后完整重跑，不能把第一次 206/219 计为通过。
- Dream ESLint：exit 0，`0 errors / 21 warnings`（既有 React Hook warnings）。
- Dream TypeScript + production Vite build：`tsc -b && vite build` exit 0；保留 chunk size 与 ineffective dynamic import warnings。
- Admin ESLint：exit 0。
- Admin TypeScript：首次因 sandbox 无权写 `tsconfig.tsbuildinfo` 退出 2；授权仓库本地缓存写入后 `pnpm exec tsc --noEmit` exit 0。
- Admin production build：使用独立 `.next-e2e-dream-audit-build` 执行 `next build --webpack`，compiled、TypeScript、7 个 static pages 与全部 route collection 成功，exit 0；独立 dist 已删除，Next 自动加入的 tsconfig include 已恢复。
- Admin final Story schema test：`2 failed`，作为发布门禁保留。
- Dream 与 Admin `git diff --check`：均 exit 0。

#### 真值、未执行项与发布门禁

- 已证明真值：canonical actor projection、Plan Version/Entitlement/default alias、Dream alias preference、Gateway alias/Provider route、Token ledger、Agent message和 legacy Story bundle均来自服务端/PostgreSQL；浏览器未承担订阅、计费或 Workflow 真值。
- 未执行真实收费 Provider canary：无明确授权与预算；本地 stub 只能证明协议、usage/settlement 和错误边界，不能证明外部 Provider 计量真实性。
- 未完成：同一合法 Workflow Run 的 receipt/session `queued→running→completed|failed|cancelled`、完整 Dream Files/Episode Binding/Episode Artifacts/Action Projection、最终 UUIDv5 Story materialization，以及 Admin final camelCase Story DTO/review CAS 的真实双应用链。
- PostgreSQL 写入仅发生在每轮一次性 Docker clone；共享/生产数据库无测试写入。未执行 DROP/TRUNCATE、跨账号重归属或破坏性 Git 操作。

#### 资源清理与回滚

- 每次 runner 均在 `finally` 中关闭本轮 Admin/Dream/Vite 进程、停止精确命名 Docker 容器、删除独立 Next dist、Playwright output 与 Agent workspace；最终 `docker ps` 无 `ink-dream-business-e2e-*` 或 `ink-admin-subscription-e2e-*` 容器，4177 自有 Vite 已关闭。
- 一次 source-contract Playwright 启动误清理仓库内 tracked 历史截图，已只恢复精确删除文件；未覆盖用户代码或未跟踪文件。
- 回滚边界：Story transaction commit/rollback、Gateway idempotency header、capability allowlist 可独立回退；但回退会重新打开虚假成功、重复结算关联缺失或不安全 DTO，因此发布前不建议回退。

## 2026-08-10 — 最终 Story/Artifact Schema 与 Workflow→Episode 生产链收口

### Optimized Prompt

你是 Ink Dream Memory 的跨仓库数据架构师、Dream Workflow/Artifact 负责人、Admin Story API 负责人和发布级 E2E QA。基于三份现行业务设计合同与上一轮追踪矩阵，关闭仍阻断 Dream 剧本完整 E2E 的最终门禁：以安全、可演进的 forward migration 将 Story/Artifact 状态模型升级为最终合同，同步 Dream 与 Admin 的 repository/API/UI，并通过生产等价服务路径证明一个合法 Workflow Run 从创建、Agent 执行、Episode Artifact 写入、Story Index materialization 到 Dream/Admin 读取与审核的一致性。

必须首先以当前 PostgreSQL schema、现有 migration journal、Dream Alembic head、现存 repository DTO 与隔离测试数据为事实，不直接删除或改名共享字段。为 `artifact_status`、sync 状态域、Episode 1–99、artifact identity、revision state、review freshness/business review 等最终不变量设计分阶段 migration：expand（新增 nullable/可回填字段与兼容读写）、backfill/验证（明确旧值映射和冲突检测）、contract（仅在所有 reader/writer 已切换且隔离数据验证后移除 `artifact_available`/旧 `missing` 语义）。若当前轮无法安全完成 contract 阶段，必须保留兼容字段但让新生产路径只写最终状态，并把删除阶段作为明确发布步骤，不能强行破坏现有数据。

实施按 TDD：先让 schema/repository/API 的最终合同测试稳定失败，再增加 forward migration 和双读/单写兼容层，随后修正 Dream projector/repository、Admin Story list/detail/filter、Artifact Reader、review CAS 与 UI。Dream 必须是 Artifact/Story Index 唯一业务写入者；Admin 不得直接制造 Story 或 Artifact，只能读取 PostgreSQL/只读 Artifact，并通过受控 revision CAS 更新审核。不得直接 SQL 伪造 completed Workflow/Story 作为最终 E2E 结果；测试 fixture 只能用于前置身份、模型、订阅与 runtime 配置。

建立生产等价完整链：canonical actor 与 workspace → Admin Subscription/Entitlement/default alias → Dream Workflow launch/preflight → Runtime Load Receipt 与 Agent Session → Gateway turn/Token settlement → Dream 受控工具写入 Episode registry、outline、script、storyboard、review、prompts、render guide → completion validator → 同步 Story Index materialization → Dream Files/Agent Messages/Episode Artifacts/Action Projection/Story Index → Admin Story list/detail/Artifact preview/review CAS。所有 identity（actor/workspace/run/thread/project/episode/story）、revision、ETag、idempotency/correlation 必须可追踪且一致。成功、Provider/Gateway 失败、Artifact 写成功但 Index 失败、review revision 冲突和幂等重放都必须 fail closed、无虚假成功、无重复扣费和无悬挂 reservation。

真实验收使用一次性 PostgreSQL clone、临时 Artifact Root、自有动态端口和本地无费用 Provider；不写共享数据库、不调用真实收费 Provider。Playwright 导航前注册 response/requestfailed/console/pageerror；覆盖 1440×1000 与 390×844、刷新/重入、键盘、焦点、ARIA、loading/empty/error/last-good。运行 backend/Admin unit、PostgreSQL migration/runtime integration、source contracts、Mock Chromium、真实 Dream/Admin Chromium、ESLint、TypeScript、production builds、`git diff --check`，记录准确 pass/fail/skip。

Acceptance Criteria:

- forward migration 在空库、旧 0027 schema 数据和重复执行三种场景均安全；发现无法映射的旧数据时 fail closed 并输出不含敏感值的冲突计数，不静默丢失或重归属。
- 新生产路径具有独立 `artifact_status` 与 `artifact_sync_status`，不再以 boolean 推导 Artifact；sync 不持久化 `missing`，Episode 为 1–99，五组最终约束有数据库与代码双重验证。
- Dream 是唯一 Story index writer；Admin E2E 的最终业务证据来自 Dream producer，不再用直接 SQL/手写文件冒充。
- 至少一个同链成功、失败与重放场景关联 Subscription、alias、Gateway ledger、合法 Workflow 状态、Agent、Episode Artifact、Story Index 和 Admin read/review；reserve/capture/release 守恒且最终 reserved=0。
- Dream/Admin 双视口真实浏览器刷新重入一致，零非预期应用诊断；任何尚未完成的 contract-drop 或真实外部 Provider canary明确保持发布门禁。
- 所有本轮容器、端口、临时数据库、Artifact Root、Next/Vite/Playwright 输出与 reservation 精确清理；未知服务不停止，用户已有修改不覆盖。

Rollback and Cleanup:

- migration 按 expand/backfill/contract 独立可回退；contract-drop 不在缺少数据证明或跨仓库读写切换完成前执行。
- production reader 在 expand 期间可双读但必须以 `artifact_status` 优先；production writer 只写最终状态并同步必要兼容投影，禁止产生新 `missing` sync 值。
- 不执行 DROP/TRUNCATE、生产库写入、跨账号重归属、破坏性 Git 或 broad recursive cleanup；只删除精确命名的本轮资源。

### Optional Enhancers

- 增加 migration property tests，覆盖旧状态组合、重复执行、并发 materialization 与 review CAS reorder。
- 保存脱敏的 run→message→gateway request→ledger→episode→story revision timeline，作为业务断言之外的审计证据。

### 本轮问题与用户影响

上一轮已证明模型、Gateway、Token 与 legacy Story bundle，但最终 Story schema 仍有 boolean 第二真值、`missing` sync 语义和缺失约束；Workflow/Episode/Story materialization 也未在同一真实链路中证明。若发布，用户可能在 Artifact 文件成功、索引失败或审核 revision 漂移时看到错误状态，Admin 与 Dream 可能对同一 Story 得出不同结论。

### 事实来源和真值所有者

- schema/migration：Admin Drizzle journal、Dream Alembic 与隔离 PostgreSQL catalog。
- Workflow/Agent/Episode/Artifact/Story materialization：Dream 服务与其 PostgreSQL/受控 Artifact Root。
- Subscription/model/Gateway/Token：Admin Gateway 与 Admin PostgreSQL。
- Admin Story/Artifact/review：PostgreSQL read projection、只读 Artifact Reader 与 revision CAS；浏览器只拥有瞬时 UI 状态。

### 修改范围与明确不修改范围

范围：Story/Artifact forward migration、Dream/Admin repository/API/UI、Workflow/Episode producer、隔离 runner、合同测试与追踪/worklog。非范围：真实收费 Provider、共享/生产数据库写入、无关视觉重构、新数据库/队列、SQLite fallback、硬编码当前数据或一次性破坏性 schema 替换。

### 测试矩阵

空库/旧 schema/重复 migration；Artifact/Index/Review/Business 状态组合；Episode 1/99/0/100；UUIDv5 identity；revision/ETag/CAS；Workflow合法与非法转移；writer成功/index失败；成功/失败/重放 Token settlement；Dream/Admin desktop/mobile/refresh/reentry/accessibility；权限隔离、路径/UTF-8/TOCTOU和敏感信息边界；资源清理。

### 完成标准

只有 final-contract schema、Dream唯一写入、合法 Workflow→Episode→Story 同链、Admin只读/审核、成功/失败/重放账实一致、真实双应用浏览器、静态/构建检查和清理全部有当前可执行证据，才能解除发布门禁。

### 风险、回滚与资源清理要求

主要风险是旧数据无法映射、两仓库部署顺序不兼容、双写漂移、直接 SQL fixture 冒充业务结果、review revision 被覆盖、误连共享库或误停服务。必须以 expand/backfill/contract 顺序和隔离 clone 降低风险；失败时回退应用读写切换而不删除用户数据，并销毁精确本轮资源。

### 执行状态

- 本 Prompt Architect 记录已先于本轮 schema/代码分析和修改落盘。
- migration 设计、TDD、双仓库改造和完整链验收待执行。

### 阶段执行回执（2026-08-10）

#### 已完成

- Admin 新增 forward expand migration `0030_dream_artifact_status_expand`：只新增 nullable `artifact_status`、按旧只读事实确定性回填，并以 `NOT VALID → VALIDATE` 启用状态枚举约束；未删除或改名任何共享列。
- 隔离 PostgreSQL 在 0029 后预置一条 legacy Artifact Story，再应用 0030；回执为 `artifact_status=available`、legacy compatibility boolean `true`、约束 `convalidated=true`。
- Dream projector/repository/service 已切为 `artifact_status` 优先；写入时仍双写 legacy boolean 作为滚动发布兼容投影，公共兼容布尔值由 status 派生，ETag 与 index 判定不再依赖旧布尔列。
- 真实 PostgreSQL 揭示并修复 schema gate 根因：设计/0027 使用精确 partial unique identity index，但 repository 错误要求 full unique index，导致真实 materialization 返回 `story_index_schema_unavailable`。现在只接受 `(artifact_source_type IS NOT NULL) AND (source_project_id IS NOT NULL)` 的精确谓词和三个直接列，继续拒绝不完整谓词、表达式列或全表索引。
- Dream focused Story Artifact：`73 passed, 3 skipped`；skip 为没有显式 TEST_DATABASE_URL 的运行。统一隔离 runner 随后在 owned PostgreSQL clone 中执行 `61 passed`，无 skip。
- 真实 Chromium：模型保存/移动恢复 `1 passed (1.7s)`；Gateway-backed Agent/Story `1 passed (4.1s)`。同一 turn 为 1 个 Gateway request，alias `dream-fast → dream-upstream-fast`，usage `17/73`，charge `90`；reserve `41343`、capture `90`、release `41253`，最终 reserved `0`，外部收费 Provider 调用 `0`。
- 一次 legacy backfill fixture 最初放在主测试 actor 下，真实浏览器正确显示两条 actor-scoped Story，暴露测试错误地假定列表长度为 1；fixture 改用第二 actor 后重跑通过，没有放宽业务断言。
- 每次成功/失败 runner 均通过 `finally` 清理精确命名容器、动态端口、临时 PostgreSQL、Artifact Root、Next dist 与 Playwright output；read-only cleanup probe 未发现残留 owned 容器或监听。

#### 仍阻断 contract phase

- Admin final schema contract 仍为 `2 failed`：物理/Drizzle 兼容映射仍保留 `artifact_available`，且 artifact identity、revision-state、review-integrity、business-review 四组最终约束尚未应用。
- 两次尝试直接切换/批量回填审核与发布状态均被安全审查拒绝：这些操作会改写既有 review/published/revision 事实并影响跨仓库 rolling deploy。在获得针对这些数据语义变更的明确批准与逐行冲突审计前，不执行 contract-drop、状态重归类或约束替换。
- 本阶段未声称完成 Workflow launch → Episode artifact producer → Story Index → Admin review 的同一真实生产链；当前真实 Chromium 证明的是模型/Gateway/Token/Agent/legacy Story bundle，Story Artifact PostgreSQL 证明来自 repository/runtime integration。该缺口继续是发布门禁。

#### Contract guard 最终回执

- 共享 PostgreSQL 只读审计并 rollback：2 条 Artifact Story 均可无损映射，全部 identity/revision/review/business 冲突计数为 0；共享库尚未部署 `artifact_status`。
- 新增 0031 脱敏 preflight、滚动兼容 trigger 与最终约束；Admin 应用 schema 不再映射旧布尔列。final schema test `2 passed`。
- 约束实测发现并修复 Script revision 更新后未回退 published 的缺陷；保留 Admin-owned review facts。focused `73 passed, 3 skipped`，owned PostgreSQL `61 passed`。
- 最终真实 Chromium：模型 `1 passed`，Gateway Agent `1 passed`；reserve `41343 = capture 90 + release 41253`，reserved `0`。真实持久化 Episode run 的 Run/Dream Files/Messages/Artifacts 均 200，但 Story Index 因共享库未部署 0030/0031 准确返回 503，故只读用例诚实为 `1 failed`。
- Admin TypeScript、focused ESLint、production build 与双仓 `git diff --check` 均 exit 0；共享库无写入，精确临时资源已清理。当前发布门禁是部署 0030/0031 后重跑该只读真实 run。

## 2026-08-10 — 只读源库克隆后的真实 Workflow/Episode/Story/Admin 闭环

### Optimized Prompt

你是 Ink Dream Memory 的 PostgreSQL 灾备/迁移验证工程师、Dream Workflow/Artifact 全栈负责人、Admin Story 审核负责人和发布级 Playwright QA。关闭“共享 PostgreSQL 未获写权限，无法验证 0030/0031 后真实持久化 Workflow/Episode/Story 链”的门禁：以共享数据库为只读源，通过受控 dump/restore 创建动态命名、一次性 owned PostgreSQL clone；在 clone 上应用当前 Admin/Dream migration，启动本轮自有 Dream/Admin/Vite 服务，并对现存真实 Workflow Run、Dream Files、Agent Messages、Episode Artifacts、Story Index、Admin Story 查询/Artifact preview/review CAS 执行生产等价验证。

严格遵循：源库连接只执行读取，禁止 migration、DDL、DML、锁定写、触发器副作用或测试账号创建；所有 restore、migration、review CAS、幂等重放只发生在 `_test` clone。dump/restore 不把 DSN、Secret、Provider credential、正文或路径写入日志；临时 dump 使用精确随机目录、权限收紧并在 finally 删除。先执行 Playwright preflight、端口/PID 归属和源/目标数据库身份校验；任何 source/target 相同、目标名无 test marker、dump/restore 非零或 schema hash 不匹配均 fail closed。

验收必须证明：0030 legacy backfill 与 0031 constraints 在真实数据 clone 上通过；目标 run 的 Workflow/Dream Files/Messages/Episode Artifacts/Story Index 均返回正确 2xx/ETag/revision；Dream 与 Admin 对 stable Story UUID、workspace/project/run、episode count、artifact/index/review/business 状态一致；Admin review confirm/reject 使用 expected revision、If-Match/idempotency、冲突重放并写审计，且不修改 Artifact 正文或 locator；1440×1000 与 390×844 刷新/重入无非预期 console/pageerror/requestfailed。模型/Gateway/Token 证据与该 run 若无法在同一历史 correlation 上证明，必须明确保留而不能拼接成同链成功。

运行 focused backend、clone migration/runtime integration、Admin API tests、Mock/real Chromium、ESLint、TypeScript、production build 和 `git diff --check`。完成后停止精确本轮服务/容器，删除 clone、dump、浏览器 output 与临时 Artifact；确认源库零写入、无悬挂 reservation。不得通过忽略 503、直接 SQL 制造 Story/Review 成功、复制手写 Artifact 或修改共享库让用例变绿。

Acceptance Criteria:

- 只读源库快照可恢复到 owned `_test` PostgreSQL，0030/0031 在真实数据组合上成功并完成全部 convalidated 检查；源库写入计数为 0。
- 真实 persisted run 在 clone 上的 Run/Dream Files/Messages/Episode Artifacts/Story Index 全部通过，Story Index 不再因 schema gate 返回 503。
- Dream/Admin Story identity、revision、artifact/index/review/business facts 一致；review CAS 成功、冲突和幂等重放有数据库审计证据，Artifact 文件与 Dream-owned 字段未被 Admin 覆盖。
- 双视口浏览器与诊断门禁通过；任何无法关联到同一 Gateway/Token 历史 turn 的事实明确列为剩余门禁。
- clone、dump、端口、服务、Playwright output 和临时凭据精确清理；不覆盖用户未提交修改。

Rollback and Cleanup:

- 源库始终只读，无需数据回滚；clone 上失败即销毁精确容器/数据库并保留脱敏计数。
- 不执行共享库 migration、DROP/TRUNCATE、跨账号重归属或 destructive Git；不停止未知服务。
- 若真实数据包含无法通过 contract preflight 的组合，输出聚合冲突计数并停止，不自动改写 review/published/revision。

### Optional Enhancers

- 记录脱敏 source snapshot hash、migration hashes、run→story→revision→audit timeline。
- 增加 clone 恢复重复执行与 review CAS 并发 property tests。

### 本轮问题与用户影响

当前真实 persisted run 的 Artifact 可读，但 Story Index 因共享库尚未部署 0030/0031 返回 503；仅凭空库/fixture clone 不能证明真实数据升级后业务闭环。用户会看到真实产物存在而 Story 状态不可恢复，Admin 也无法安全审核。

### 事实来源和真值所有者

- 源事实：共享 PostgreSQL 只读 snapshot 与真实 Artifact Root；源库不接受本轮写入。
- 升级后事实：owned PostgreSQL clone + 当前 migration journal。
- Artifact/Story writer：Dream；Admin 只读 Artifact/PostgreSQL 并通过 review CAS 写 Admin-owned 字段。
- 浏览器仅拥有瞬时视图/输入，不能制造 Workflow、计费或 Story 状态。

### 修改范围与明确不修改范围

范围：clone runner、只读真实 run Playwright、必要的最小 API/contract 修复、review CAS 测试、worklog。非范围：共享/生产 DB 写入、真实收费 Provider、物理删除 legacy column、手写业务终态或无关 UI 重构。

### 测试矩阵

dump/restore/identity guard；0030/0031 migration；real Run/Dream Files/Messages/Episode Artifacts/Story Index；Admin list/detail/preview/review success/conflict/replay；desktop/mobile/refresh/accessibility；console/network/security；cleanup/source-zero-write。

### 完成标准

真实数据 clone 上的 post-migration Dream/Artifact/Story/Admin 闭环全部有权威断言，或准确暴露新的发布门禁；不得以 isolated fixture 成功替代真实 persisted run。

### 风险、回滚与资源清理要求

主要风险为误连源库写入、dump 泄密、restore 目标混淆、Admin review 覆盖 Dream 字段、端口/容器残留。所有目标动态命名且带 test marker，源/目标身份必须不同；失败销毁精确 owned 资源并记录脱敏回执。

### 执行状态

- 本 Prompt Architect 记录已先于本轮 clone/preflight/代码分析落盘。
- preflight、clone runner、真实浏览器、Admin review CAS 与清理待执行。

### 最终执行回执（2026-08-10）

#### 只读 clone 与 migration 事实

- `ink-dream-playwright-qa` preflight 通过；执行前 5173/8765 均完成端口归属检查，本轮 runner 始终使用动态自有端口。
- 新增 `/Users/dmeck/project/ink-dream-memory/scripts/run-dream-cloned-production-e2e.mjs`：源连接仅用于 `PGOPTIONS=-c default_transaction_read_only=on` 的 `pg_dump` 与显式 `BEGIN READ ONLY` 查询；目标为随机 `ink_memory_dream_clone_<suffix>_test`、精确命名 PostgreSQL 18 容器。DSN、密码、正文和绝对 Artifact locator 未写入日志。
- 第一次 runner 使用 PostgreSQL 16，因 pg_dump 18 生成的 `transaction_timeout` 参数不兼容而在 restore 阶段 fail closed；改为 PostgreSQL 18 后恢复成功。该失败没有触达业务服务或源库写入。
- clone 恢复 2 条真实 Artifact Story，目标 `run_b81d3731b56b4703868b66af76e7b656` 可解析；0030/0031 应用成功，`artifact_status/identity/revision-state/review-integrity/business-review` 五组约束全部 `convalidated=true`。

#### 真实双应用浏览器

- Dream persisted Workflow/Episode/Story Chromium：`1 passed (3.2s)`（前一成功重跑为 4.8s）。目标 Run detail、`dream-files`、`dream-agent/messages`、`episode-artifacts` 与 Story Index 均通过真实 FastAPI/PostgreSQL/Artifact Root，覆盖 1440×1000、390×844、刷新与重入，无非预期 post-auth response/console/pageerror/requestfailed。
- Admin Artifact/review Chromium：最终 `1 passed (10.2s)`。第一次到达全部业务断言后仅因外部 React Grab 请求和登录前预期 401 被错误并入 post-auth diagnostics 而失败；诊断分段并确定性 fulfill 外部开发辅助资源后通过，没有放宽业务断言。
- Admin 用源 project 过滤真实 Story，读取 Artifact surface/preview；旧 revision 返回 409；confirm 成功；同一 `x-request-id` 的完全相同重放返回 200、`idempotency-replayed:true` 且只有 1 条 audit；第二条 Story reject 成功且强制非空 notes。审核前后 Dream-owned run/project/workspace/episode/revision/locator 均未变化。
- 修复 Admin reject contract：reject 写入当前 `reviewed_script_revision`、清空 `confirmed_at`，无 notes 返回 `STORY_ARTIFACT_REVIEW_NOTES_REQUIRED` 400。新增 exact review replay guard，不重复 mutation/audit。

#### 历史 Run 与 Gateway/Token 关联审计

- 源库显式 `BEGIN READ ONLY / ROLLBACK` 查询：目标 Run 由 canonical actor `28` 于 2026-08-06 创建，仍为 `queued`；同一 thread 中有 16 条 `story-workspace-dream-agent-user` 消息，均持久化为 `dispatch_status=dispatched`。
- 该 actor 的 platform user 存在且 active，但其 120 条 Gateway request 最早为 2026-08-09，晚于目标 Run/Artifact 生产；历史请求中 `dream-turn-*` 数为 0。
- 按当前服务端唯一算法 `dream-turn-<sha256(canonical user + thread + persisted message id)>` 对该 thread 全部 message 重建候选键，Gateway 匹配数为 0、对应 Token Ledger 匹配数为 0。因此该历史 Workflow/Episode/Story 链不能被声明为经过现行 Gateway/Token 计费。
- 另一条 owned fresh runner 已独立证明模型目录、Agent SSE、Gateway route 和 Token 守恒：1 个本地 Provider request，usage 17/73、capture 90，reserve 41343 = capture 90 + release 41253，最终 reserved 0，外部 Provider 调用 0。但它没有生产本历史 Run 的 Episode artifacts；两条链没有被拼接成伪造的同链成功。

#### 测试与静态门禁

- Admin Story review/schema focused：2 files、`12 passed`（10 mutation + 2 schema），0 failed/0 skipped。
- Dream Story Index/Dream API/Episode Artifact focused：`191 passed, 3 skipped, 9 subtests passed`；3 skip 仅为该 focused 命令未注入 owned `TEST_DATABASE_URL`。owned PostgreSQL runner 中同组 runtime integration 为 `61 passed`、0 skipped。
- Dream frontend Playwright source contracts：`365` tests 启动并全部完成，命令 exit 0、无失败；直接 `npm exec vitest` 因仓库未安装 Vitest且沙箱网络不可达而在启动前失败，随后误用 `node --test` 产生 42 个 runner/import 失败，这两次均不计为业务测试结果，最终使用仓库实际的 Playwright test runner。
- Dream ESLint：exit 0，0 errors / 21 existing React Hook warnings；Dream `tsc -b && vite build` exit 0，保留 chunk-size 和 ineffective dynamic-import warnings。
- Admin ESLint、`pnpm exec tsc --noEmit` 均 exit 0；独立 `.next-e2e-final-dream-audit` production build compiled、TypeScript、7 static pages 与 route collection 全部成功，随后精确删除 dist 并移除 Next 自动写入 tsconfig 的随机 include。
- Dream/Admin `git diff --check` 均 exit 0。

#### 数据安全、清理与发布门禁

- 共享/源 PostgreSQL 本轮没有 DDL/DML、migration、测试账号或审核写入；所有 restore、migration、Admin review、audit 仅发生在 owned `_test` clone。没有 DROP/TRUNCATE、跨账号重归属或真实收费 Provider 调用。
- 最终无 `ink-dream-clone-e2e-*`、`ink-dream-business-e2e-*`、`ink-admin-subscription-e2e-*` owned 容器，无 clone 临时目录或 Admin `.next-e2e-*`。Playwright source-contract 默认清空的 tracked 历史截图已精确恢复，本轮新建的 4 个结果目录已删除。
- 清理探针发现 5173 为 17:21 启动的既有 Vite，8765 为 20:19 启动的 VS Code debugpy 后端；二者不是本轮动态端口服务，按归属规则保留且未停止。
- 当前最终门禁不是 clone/Artifact/Admin 合同，而是缺少一条**同一新 Workflow Run**从现行 Subscription/Model → Gateway/Token → Dream Agent 工具生产完整 Episode artifacts → Story Index → Admin review 的生产等价成功/失败/重放证据。历史 Run 早于 Gateway，fresh Gateway runner 又未生产 Episode artifacts；在补齐该 producer chain 前不得宣称 Dream 剧本业务 E2E 完整，也不得把真实外部 Provider canary（仍未授权）计为已执行。

## 2026-08-10 — 同一新 Run 的 Gateway/Token→Episode Producer 最终闭环

### Optimized Prompt

你是 Ink Dream Memory 的 Dream Workflow/Agent 工具执行架构师、Admin Gateway/Subscription 计费工程师、Episode Artifact producer 负责人、Admin Story 审核工程师和发布级 Playwright QA。基于现有真实数据 clone 已证明的 Workflow/Episode/Story/Admin 读取链，以及独立 fresh runner 已证明的 Model/Gateway/Token 链，关闭最后一个不可拼接的发布门禁：在一个全新、同一 canonical actor/workspace/thread/message/Workflow Run 上，通过生产等价服务路径完成 Subscription/Plan Version/Entitlement/Allowance → Admin model catalog/default alias → Dream 保存 platform model identifier → Dream launch/preflight/runtime receipt/session → Dream Agent 经服务端 Gateway 推理 → Token reserve/capture/release → 服务端受控 Episode 工具写入完整 outline/script/storyboard/review/prompts/render guide → completion/action projection → Story Index materialization → Dream 刷新重入读取 → Admin Artifact preview 与 revision CAS review，并为成功、失败和完全相同重放建立可重复的同链证据。

不得把历史 Artifact、直接 SQL 业务终态、手写文件或另一 Run 的 Gateway 账本接入本链。允许 SQL/fixture 仅创建测试身份、Subscription/Plan/Entitlement/Allowance、模型/Provider、Deck/runtime 等前置控制面事实；Workflow、Agent message、Episode artifacts、Action Projection、Story Index 和 review 必须分别由其权威业务 API/服务产生。确定性本地无费用 Provider 必须返回真实协议事件/usage，并通过受控 tool-call/episode-action 接口触发 producer；不得绕过 Dream Agent 直接调用 repository 伪造完成。真实外部 Provider 无明确授权时保持 0 调用。

先做当前代码与 runner 的只读差距审计：追踪 Dream Agent SSE 中 tool use/confirmation、Episode action preview/confirm/execute、Workflow 状态转换、completion validator、Story Index projector 及 Gateway correlation/idempotency。对缺失链路先增加失败测试，再做最小实现。若现有 Workflow `queued/running/completed` 状态机无法由真实 producer 合法推进，必须修正状态真值或增加明确的服务端协调步骤，禁止浏览器或测试 SQL直接改状态。所有写请求使用稳定 idempotency key、expected revision/If-Match；重复完全相同请求只能 replay，语义冲突返回 409；Provider/Gateway/usage/settlement/tool/index 失败 fail closed，Token reservation 最终归零，Artifact/Story 不得虚假完成。

使用一次性 PostgreSQL 18 `_test` clone、临时 Artifact Root、自有动态端口、真实 Dream FastAPI/Vite/Admin Next 与本地 Provider。导航前注册 response/requestfailed/console/pageerror；覆盖 1440×1000 与 390×844、刷新、重新进入、键盘/焦点/ARIA、loading/error/last-good。至少执行：同 Run 成功；Gateway/Provider 失败且 release；成功请求完全相同重放且 Provider/ledger/artifact/audit 不重复；revision/idempotency 冲突；Story Index 或 review CAS 失败保持 Dream-owned facts。每个场景都必须输出脱敏 run→message→gateway request→ledger→episode revisions→story→review audit timeline。

Acceptance Criteria:

- 同一新 Run 的 actor/workspace/thread/message/platform user/model alias/Gateway request/Token ledger/Episode/Story identity 可双向追踪，不借用历史 Run 或跨 actor 数据。
- Gateway 仅路由 Admin catalog 中服务端验证后的 alias；浏览器仅保存 platform model identifier；Provider secret、API key、DSN、路径和正文不进入日志或请求断言。
- 成功场景产生真实 outline、script、storyboard、review、prompts、render guide 与 Action Projection；completion validator 合法推进 Workflow `queued→running→completed`，Story Index 与 Artifact revision一致。
- Token `reserve = capture + release`，最终 reserved=0；完全相同重放 Provider 调用仍为 1、Gateway request 为 1、capture 为 1，Artifact/Story/Admin audit 不重复。
- 失败场景准确呈现 402/403/409/422/429/502/503 之一，不产生虚假 message-final/completed/Story published；Provider 已触达但失败或 usage 缺失时 reservation 被 release，未触达时不产生 Provider 调用。
- Dream/Admin desktop/mobile/refresh/reentry 全部从 PostgreSQL/Artifact 恢复权威状态，零非预期 application diagnostics；Mock 只验证确定性边界，不替代真实浏览器/数据库事实。
- focused backend、PostgreSQL runtime integration、frontend source contract、Mock/real Chromium、ESLint、TypeScript、production build、`git diff --check` 全部给出准确 pass/fail/skip；未授权 external canary 明确未执行。
- 本轮容器、数据库、端口、进程、Artifact Root、Next/Vite/Playwright output、临时凭据和 reservation 精确清理；未知服务不停止，源/共享数据库零写入，用户未提交修改不覆盖。

Rollback and Cleanup:

- 修改按 Gateway correlation、Workflow lifecycle、tool producer、Story projector、Admin review 分模块可独立回退；回退不能改写或删除用户数据。
- runner 任何阶段失败都在 finally 停止精确 owned 服务/容器并删除动态 `_test` DB、临时 Artifact/输出；保留脱敏失败阶段和守恒计数。
- 禁止 DROP/TRUNCATE 共享库、生产库测试写、跨账号重归属、真实收费 Provider、破坏性 Git、吞异常、放宽断言或硬编码当前历史数据。

### Optional Enhancers

- 为同一 Run 输出 machine-readable trace manifest，并由独立 verifier 检查所有 identity/revision/idempotency/ledger 边。
- 增加 Provider 流式中断、usage 缺失、Artifact 写成功但 Story Index 失败的故障注入与恢复测试。
- 保存 Playwright trace 和关键双视口截图作为辅助证据，但仍以 API/数据库/文件断言为准。

### 本轮问题与用户影响

当前只有一条现行 Model/Gateway/Token/Agent/legacy Story 成功链和一条历史 Workflow/Episode/Story/Admin 成功链；历史 Run 早于 Gateway 且仍为 queued。若把两者拼接发布，用户可能被扣费但 Episode 未生产，或看到完整 Artifact 却得到错误 Workflow 状态，刷新和 Admin 审核无法证明同一次执行。

### 事实来源和真值所有者

- Subscription/Plan/Entitlement/Allowance、model catalog/Gateway/Token Ledger：Admin PostgreSQL 与 Gateway 服务。
- Workflow/receipt/session/Agent message/tool action/Action Projection：Dream PostgreSQL 与服务端协调器。
- Episode artifacts：受控 Artifact Root + manifest/revision；Story Index：Dream projector 写入 PostgreSQL。
- Admin：只读 Dream-owned facts，仅以 revision CAS 写 review/audit；浏览器仅拥有瞬时交互状态。

### 修改范围与明确不修改范围

范围：统一 owned runner、确定性 Provider tool response、Dream Agent/tool/workflow 协调、Story projector、Admin review、TDD/E2E/trace/worklog。非范围：真实收费 Provider、共享数据库写入、无关 UI 重构、新持久化系统、SQLite/JSON fallback、直接 SQL 业务终态或历史数据硬编码。

### 测试矩阵

同 Run success/failure/replay/conflict；subscription eligible/ineligible/exhausted；model allowed/removed；Provider error/usage missing/stream abort；tool confirmation/cancel/retry；完整六类 Episode artifacts；Workflow legal transitions；Story index success/failure/retry；Admin review success/stale/replay/reject；desktop/mobile/refresh/reentry/accessibility；PostgreSQL datetime/JSONB/boolean/nullable；diagnostics/security/cleanup。

### 完成标准

只有一个全新 Run 在生产等价服务路径上同时证明现行 Subscription/Model、Gateway/Token、Dream Agent 工具、完整 Episode、Workflow completion、Story Index 和 Admin review，并且失败/重放、双视口、守恒、静态门禁与清理全部通过，才可解除 Dream 剧本生产 E2E 发布门禁。

### 风险、回滚与资源清理要求

主要风险为本地 Provider 事件不符合真实协议、工具调用绕过 Agent、Workflow 状态被测试伪造、重复 settlement/artifact、跨 Run identity 漂移和服务残留。必须以服务端 correlation、数据库约束、独立 trace verifier、finally cleanup 和 no-external-call 断言降低风险；任何无法证明的边保持失败而非降级。

### 执行状态

- 本 Prompt Architect 记录已先于本轮代码/runner 差距分析和修改落盘。
- 同 Run producer trace 审计、失败测试、最小实现、真实浏览器与最终清理待执行。

## 2026-08-10 — Dream Agent 完成后的权威状态刷新与同 Run E2E 收口

### Optimized Prompt

你是 Ink Dream Memory 的 Dream 交互状态架构师、React 数据同步工程师、Workflow/Episode 全栈工程师和发布级 Playwright QA。基于上一阶段已通过真实隔离 PostgreSQL/Chromium 证明的登录、模型目录、Dream Run `201 Created`、Gateway/Provider 9 次受控 tool loop 与 Dream 确认 `202 Accepted`，修复当前剩余的确定性业务缺口：Agent 已完成并由服务端写入最新 `dream-files`/Workflow 状态后，Dream 页面仍可能保留中途读取的 last-good 旧快照，导致“确认并继续”错误保持 disabled，或确认后的后续执行入口不出现。

先只读追踪 Dream 页面从 launch、SSE/Agent message、Workflow Run detail、`dream-files` 到 reducer/query state 的完整刷新触发链，确认真实竞态、触发条件、真值所有者和既有测试缺口。不得用延长超时、强制点击、DOM 推导完成状态、乐观伪造 revision、吞掉 409/422/503、固定轮询睡眠或硬编码本地 Provider 时序解决。先增加稳定失败的 source contract 或 Mock Chromium 测试，证明在首次 `dream-files` 返回 partial/last-good 后，Agent terminal/server revision 变化必须触发重新读取并采用 PostgreSQL/Artifact 权威快照；再实施最小修复，保留 loading/error/last-good、取消、重入和权限隔离语义。

修复后继续同一新 Run 的真实隔离 E2E：Subscription/Entitlement/Allowance → Admin model catalog → platform alias 保存 → Dream launch → Gateway/Token → runtime receipt/session → controlled Dream files → confirmation → first Episode binding recovery → 九个 Episode actions → outline/script/storyboard/review/prompts/render guide → Workflow completed → refresh/mobile reentry。所有断言以 API、PostgreSQL、Token ledger、Artifact revision 和浏览器可见状态交叉验证；真实外部收费 Provider 保持 0 调用。

Acceptance Criteria:

- 可重复测试先复现“首次 partial `dream-files` 后 Agent 完成但页面不再刷新”的 disabled stale-state 问题，并在修复后转绿。
- 刷新由可信 SSE/Agent terminal、Workflow revision 或明确的服务端状态变化驱动；浏览器不创建第二套 Workflow/计费/Artifact 真值。
- 正常、loading、partial、last-good、error、取消、刷新和重入保持既有安全合同；无无限轮询、无重复确认、无额外写请求。
- 真实 Chromium 中 launch 为 201、confirmation 为 202，确认入口和后续执行入口可靠出现；同一 Run 完成所有 Episode actions 与受控 artifacts。
- Gateway request、Provider request、Token reserve/capture/release 和完全相同重放满足幂等与守恒；失败不产生虚假 completed。
- 覆盖 1440×1000、390×844、键盘焦点、ARIA 和零非预期 console/pageerror/requestfailed；截图仅作辅助。
- focused frontend/backend、PostgreSQL integration、Mock/real Chromium、ESLint、TypeScript、production build、`git diff --check` 给出准确 pass/fail/skip。
- finally 停止仅本轮自有服务/容器并清理精确临时 PostgreSQL、Artifact Root、Playwright output 和凭据；保留既有 5173/8765 与共享数据库不动。

Rollback and Cleanup:

- 前端刷新触发改动必须可独立回退，不改 API truth ownership、Gateway/计费合同或持久化模型。
- 若修复导致请求风暴、last-good 丢失或重复 confirmation，回退该触发器并保留新增失败测试与证据。
- 禁止停止未确认归属进程、DROP/TRUNCATE 共享库、生产库写入、真实收费调用和破坏性 Git；失败后精确清理本轮动态资源。

### Optional Enhancers

- 增加 revision/SSE 事件到 `dream-files` refetch 的时序图与 request-count 上限断言。
- 在最终 trace manifest 中记录首次 partial、terminal event、refetch、confirmation 和 Episode completion 的单调 revision 时间线。

### 本轮问题与用户影响

服务端已能创建 Run 并完成受控 Agent tool loop，但浏览器可能停留在过期 partial/last-good 快照，用户看到按钮不可用并误以为服务仍为 401/失败，阻断确认和 Episode 生产。

### 事实来源和真值所有者

- Workflow 状态与 revision：Dream PostgreSQL；Dream stages/artifacts：受控 Artifact Root 与服务端 projection。
- Agent 终态/SSE：Dream Agent message/event 服务；模型/Token：Admin Gateway 与 Admin PostgreSQL。
- 浏览器仅拥有展示缓存、loading/error/last-good 和焦点状态，不拥有完成状态。

### 修改范围与明确不修改范围

范围：Dream 页面相关 hook/reducer/refetch 触发、对应 source/Mock/real Playwright 测试、必要的同链服务端缺陷与 runner 诊断。非范围：无关 UI 重构、静态模型目录、浏览器计费推导、SQLite fallback、共享服务重启或真实外部 Provider。

### 测试矩阵

partial→terminal refetch、last-good+error、重复 terminal 去重、取消/失败不确认、refresh/reentry、desktop/mobile、键盘/ARIA；真实同 Run launch/confirm/Episode actions/artifacts；Gateway/Token 守恒与重放；console/pageerror/requestfailed/security/cleanup。

### 完成标准

只有稳定复现测试转绿，真实浏览器同一新 Run 从订阅/模型到完整 Episode artifacts、Workflow completed、刷新/移动重入与 Token 守恒全部通过，并完成静态门禁和资源清理，才宣称本轮完成。

### 风险、回滚与资源清理要求

主要风险为 refetch 风暴、竞态覆盖 newer state、重复 confirmation、SSE 断线时永不恢复和测试 Provider 时序硬编码。以 revision 单调性、请求上限、last-good 语义、幂等写合同、隔离 PostgreSQL 和 finally cleanup 控制；不能证明的边保持未完成。

### 执行状态

- 本 Prompt Architect 记录已先于本轮代码分析、规划和修改落盘。
- stale-state 只读追踪完成：Agent terminal 原本只对账 `dream-agent/messages`，未显式失效同 Run `dream-files`/Workflow；确认 202 后也未主动重连 continuation Agent transport。
- TDD 红灯为 1 failed / 22 passed；最小修复加入 terminal durable reconciliation 后的去重 invalidation，并在 confirmation accepted 后重连 Agent。focused frontend 最终 44 passed，相关 ESLint 0 error / 0 warning。
- 后端 focused 回归：133 passed、1 skipped、23 subtests passed；另一次既有主链相关组合为 82 passed、2 skipped、55 subtests passed。Story Artifact PostgreSQL clone 每轮 61 passed。
- 静态门禁：全量 ESLint 0 error、23 个既有 warning（本轮 Dream 文件已清零）；TypeScript + production build 通过；`git diff --check` 通过。Provider harness Node test 1 passed。
- 真实 Chromium 已证明：模型目录/alias 保存与 390×844 恢复 1 passed；同一新 Run 的 launch 201、9 次初始 Provider tool、confirmation 202、后续入口、Episode binding、outline/script/script review/asset refresh/storyboard/prompts 均曾推进到 `review_full_chain`；Gateway 请求均 200/settled。
- Token 证据：代表性 24 次 Gateway 请求全部 succeeded/settled；reserve 1,271,121 = capture 890 + release 1,270,231，最终 reservedTokens=0；真实收费 Provider 调用 0。
- 真实全链仍未通过，发布门禁保持：初始 Agent 第 9 个工具完成后偶发延迟到 120 秒测试边界，页面未稳定进入 canConfirm；另一次推进到 `review_full_chain` 后尚未完成 full-chain review/validate/render/Workflow completed/Story Index/reentry 的同 Run 总验收。不得把阶段性成功报告为业务 E2E 完整。
- 测试合同已纠正但未放宽：Episode projection 使用服务端 ETag + nextAction，Agent 下一动作还必须等待 `lifecycle=idle`、`activeTurnId=null`、`canSend=true`；不再读取不存在的 `workflow.revision` 或把产物出现当成 Agent 空闲。
- 每轮自有 PostgreSQL 容器、动态 Dream/Admin/Vite/Provider 端口、Artifact Root、Next/Playwright output 均由 finally 清理；现存仅预先存在的 5173(PID 83170)、8765(PID 27303)、`ink-memory-postgres` 与 `ink-memory-minio`，均未停止或改写。共享数据库未用于测试写入。

## 2026-08-10 — Dream 初始终态确定性与 Episode 完整链发布门禁收口

### Optimized Prompt

你是 Ink Dream Memory 的 Workflow/Agent 并发架构师、Episode Artifact 合同工程师、Gateway/Token 一致性工程师和发布级 Playwright QA。继续上一轮未完成的同一新 Run 真实 E2E，不重新定义成功：查明并修复初始 Dream Agent 在第九个受控工具调用后偶发不能及时产生 durable terminal/完整 `dream-files` 投影的问题，并完成 `review_full_chain → validate_episode → prepare_render_guide → Workflow completed → Story Index → desktop/mobile refresh/reentry` 全链验收。

先用现有隔离 runner、服务端快照、Provider tool-result evidence、PostgreSQL activity、Gateway request/Token ledger 和受控 Artifact 文件证明卡点属于 Agent runtime、tool completion、projection read、review contract、测试 fixture 或浏览器刷新中的哪一层。不得用延长超时、sleep、强制点击、吞 409/422、跳过 action、预写完成事实、直接 SQL 改终态或降低断言解决。任何 action 的完成必须同时满足：请求 202；Provider/tool 真实执行；Episode ETag 改变；nextAction 离开已提交 action；Dream Agent `lifecycle=idle`、`activeTurnId=null`、`canSend=true`；Token settlement 守恒。

若 full-chain review 被拒绝，读取公开 `DREAM_WRITE_REJECTED` reason 和服务端 canonical source revisions，修正本地非计费 Provider fixture 使其生成完全符合现行 review contract 的 `review-report.md`，不得放宽 completion validator。若初始 terminal 不稳定，增加可重复的后台/浏览器失败测试，修复真实生命周期或投影同步边界，保留 fail-closed、幂等、actor/workspace/run/thread/session 权限与 last-good 语义。

完成后运行 owned PostgreSQL clone、真实 Dream/Admin/Vite、本地无收费 Provider 和真实 Chromium。证明同一 Run 从 Subscription/Entitlement/Allowance、Admin model catalog、platform alias、Dream launch、Gateway/Token、Dream files、confirmation、Episode binding、九个 Episode actions、所有受控 artifacts、Workflow completed、Story Index 到刷新/移动重入一致；外部 Provider 调用必须为 0。

Acceptance Criteria:

- 初始 9 个工具后 bounded terminal reconciliation 可重复成功；`dream-files` 从 422/partial/last-good 恢复到完整可确认投影，不产生请求风暴或虚假完成。
- full-chain review 的 `reviewed_files` 与 `source_revisions` 精确覆盖当前 outline、script、storyboard 和全部 Prompt source artifacts；validator 合法推进 review/validate/render。
- 九个 Episode actions 按服务端 Action Projection 执行；每步 202、ETag 单调变化、nextAction 变化、Agent idle send gate 恢复，409/422 不被包装成功。
- Workflow Run 最终 completed；`dream-files`、Agent messages、Episode binding/artifacts、Action Projection、Story Index 与同一 Run/actor/workspace/thread 对齐。
- Gateway request 全部使用服务端 alias；Token `reserve = capture + release` 且最终 reserved=0；幂等重放不重复 Provider、ledger 或 artifacts。
- 1440×1000 与 390×844 的真实 Chromium 完成刷新/reentry、键盘/ARIA/overflow 与零非预期 application diagnostics；截图仅为辅助。
- focused backend、PostgreSQL integration、frontend source/Mock Chromium、real Chromium、ESLint、TypeScript、production build、`git diff --check` 均记录准确 pass/fail/skip。
- finally 清理本轮精确命名 PostgreSQL 容器、动态端口、Artifact Root、Next/Vite/Playwright output 和凭据；不停止既有 5173/8765，不写共享数据库，不调用真实收费 Provider。

Rollback and Cleanup:

- Agent terminal、review fixture、E2E contract 分别可独立回退；不得回退已验证的鉴权、Gateway、Token、Workflow PostgreSQL 原生类型或权限修复。
- 若改动造成重复 dispatch、重复 settlement、session 归属漂移、last-good 丢失或请求风暴，回退对应最小改动并保留失败测试和脱敏证据。
- 禁止 DROP/TRUNCATE 共享库、生产库测试写、跨账号重归属、破坏性 Git、遗留容器/端口或输出含 Token/Secret/DSN/绝对 Artifact 路径。

### Optional Enhancers

- 输出 machine-readable 的 run→message→gateway request→ledger→artifact ETag→workflow fact→story index trace manifest。
- 为 review contract 增加 fixture 自检，在浏览器启动前用正式 parser/validator 验证 source revisions。

### 本轮问题与用户影响

401 已消失且主链可推进，但初始 Agent terminal 偶发晚于 120 秒，用户会看到完整工具已执行却无法确认；另一条运行已到 `review_full_chain`，尚未证明 review/validate/render/completed，同 Run 发布结论仍不成立。

### 事实来源和真值所有者

- Agent lifecycle/session/tool result：Dream Agent runtime 与 Dream PostgreSQL；Workflow 状态：Workflow Run PostgreSQL。
- Episode 文件/review revisions/ETag：受控 Artifact Root、正式 parser/validator；Action Projection：Dream 服务端 resolver。
- Model/entitlement/allowance/Gateway/Token：Admin Gateway 与 Admin PostgreSQL；浏览器只拥有瞬时缓存、loading/error/last-good/focus。

### 修改范围与明确不修改范围

范围：初始 Agent terminal/投影同步的真实缺陷、full-chain review fixture/validator 对齐、同 Run E2E 严格等待合同、安全诊断与回归。非范围：无关页面重构、真实 Provider、静态模型目录、浏览器计费推导、新持久化系统、共享服务重启、历史数据硬编码。

### 测试矩阵

初始 422/partial→terminal→complete；重复 terminal 去重；confirmation continuation；每个 Episode action 的 202/ETag/nextAction/Agent idle；review revision mismatch/valid；validate/render/completed；Story Index；refresh/reentry；desktop/mobile；Gateway/Token 守恒；console/pageerror/requestfailed/security；失败清理。

### 完成标准

只有同一新 Run 在真实隔离 PostgreSQL/Chromium 中完成所有九个 Episode actions、全部受控产物、Workflow completed、Story Index、刷新与移动重入，并证明 Gateway/Token 守恒、零外部收费调用、全部静态/回归门禁和资源清理，才宣称目标完成。

### 风险、回滚与资源清理要求

主要风险为测试把 artifact 出现误当 Agent idle、review fixture revision 过期、terminal 竞态、重复 dispatch/settlement、诊断泄密和隔离资源残留。以双重服务端门禁、正式 parser/validator、自有动态端口、脱敏诊断、精确 finally cleanup 控制；未证明项保持失败。

### 执行状态

- 本 Prompt Architect 记录已先于本轮代码分析、规划和修改落盘。
- 初始 terminal 与 full-chain review 的根因复现、TDD 修复、完整真实浏览器复验待执行。

## 2026-08-11 — Dream runtime materialization 补证与现有服务复验

### Optimized Prompt

你是 Ink Dream Memory 的业务架构师、全栈工程师与发布级 E2E QA。只处理用户现场暴露的 Dream SDK 初始化失败：`StoryWorkspaceDreamRuntimeActivationError: Dream runtime materialization evidence is incomplete`。先验证当前 8765 服务是否已加载最新代码；使用只读 PostgreSQL 证据比较目标 queued Run 的 frozen runtime lock、artifact-set hash、materialization identity/policy/environment/node 与 SDK init 工具投影。不得把 SDK tools 存在或某次隔离 E2E 通过视为已修复。

复现并验证以下最小安全方案：Dream launch materialization identity 必须绑定完整 `artifact_set_hash`；旧 materialization 必须作为不可变历史保留，不得原地改写受数据库触发器保护的 identity；同一 actor/workspace/idempotency key 的 queued Run 重放必须重新 provision 其 frozen runtime evidence，同时保持原 Run、source message、binding 与权限归属不变。激活仍须 fail closed，禁止放宽 `_load_evidence` 完整性断言或从 SDK 工具列表伪造数据库证据。

采用 TDD：保留现场 mismatch 的脱敏只读证据；先证明旧实现下 queued replay 不补证；再验证新 identity key 与 replay provisioning；运行 Dream launch/runtime activation/Agent focused tests、PostgreSQL 原生类型集成、Mock Chromium、隔离 PostgreSQL + 自有 Gateway/Token + 本地零收费 Provider 的真实 Chromium 主链。真实浏览器必须注册 response/requestfailed/console/pageerror 诊断，覆盖 1440×1000、390×844、刷新、重入、Workflow/Dream Files/Agent Messages/Episode artifacts/Story Index 一致性以及 401/409/422/503 不得伪装成功。

不得停止或替换未确认归属的 5173/8765 服务；若 8765 属于用户 VS Code debugpy，会先确认它是否已重启加载新代码，未经授权不杀进程。共享 PostgreSQL 仅 SELECT/rollback，不为测试写入；真实验证使用精确命名的隔离 clone、自有动态端口并在 finally 清理。不得调用收费 Provider、泄露 Token/Secret/DSN/绝对产物路径、覆盖用户未提交改动或进行破坏性 Git 操作。

验收标准：目标 queued Run 的 mismatch 根因有数据库证据；新代码在隔离 PostgreSQL 中为 frozen lock 生成唯一 current-hash materialization，并在同 key replay 后可完成 SDK activation；完整 Dream→Episode 同 Run Chromium 链通过；Gateway 请求均 succeeded/settled，Token `reserve = capture + release` 且 `reserved_tokens = 0`；静态门禁、扩大回归与资源清理通过。若现有 8765 未加载新代码或共享 Run 未获授权修复，必须明确列为运行态发布门禁，不得声称服务已经正常。

### Optional Enhancers

- 输出脱敏的 `run → frozen lock hash → materialization id/hash → runtime receipt → agent session` 追踪摘要。
- 增加旧 materialization-key 兼容迁移的只读审计命令与运维 runbook，但不自动修改共享数据库。

### 本轮问题与用户影响

现场 Run 保持 queued，SDK 已暴露 Dream 工具却因 frozen lock hash 与唯一 materialization hash 不一致而 fail closed；用户无法开始剧本生产，偶发隔离 E2E 成功不能证明现有服务正常。

### 事实来源和真值所有者

- frozen lock、materialization、runtime receipt、Agent Session、Workflow Run：Dream PostgreSQL。
- SDK init tools/session：Dream Agent runtime；只作为进程启动证据，不能替代 PostgreSQL materialization。
- 服务代码加载状态与端口归属：8765 监听进程；浏览器只拥有瞬时 UI 状态。

### 修改范围与明确不修改范围

范围：Dream launch materialization identity、queued replay provisioning、对应测试/诊断/E2E。非范围：模型目录、订阅价格、无关 UI、共享库数据修复、用户 VS Code 调试进程、真实收费 Provider。

### 测试矩阵

旧 hash/当前 frozen hash mismatch；current hash identity；不可变 identity；queued same-key replay；actor/workspace/binding 权限；SDK activation/replay；PostgreSQL datetime/JSONB/boolean/nullable；完整浏览器主链；409/422/503；Token 守恒；桌面/移动/刷新/重入；资源清理。

### 完成标准

代码、数据库事实、进程加载状态与真实浏览器四层证据一致；现有服务或明确隔离的替代服务完成主链，且所有失败与未授权动作诚实披露。

### 风险、回滚与资源清理要求

风险包括错误改写 immutable materialization、replay 改绑 Run、重复 dispatch/计费、误杀 debugpy、共享库写入和测试资源残留。回滚仅限 materialization-key/replay provisioning 最小代码改动；保留失败测试。清理自有服务、容器、临时数据库、Playwright 输出；不清理用户服务或数据。

### 执行状态

- 本 Prompt Architect 记录已先于本轮规划、代码分析和运行态修改落盘。
- 现场只读证据确认目标 Run `run_fdd7012110c74d1db96c1ff396dd6491` 为 queued，冻结 lock 的 canonical artifact-set hash 为 `sha256:9781e162…eb58`；唯一历史 materialization 为 `sha256:45ee83e2…ee55`。旧值与“完整 runtime lock JSON 直接 SHA-256”完全一致，证明根因是历史/现行两套 artifact-set hash 算法，而非插件内容变化。
- 插件复制链已逐层验真：`ink-dream-story@platform-builtin` v1.0.0 的源码目录、不可变 artifact store、workspace packed copy、launch manifest 和数据库安装记录均为 `sha256:af53e0fb…e78`；`drama-forge@drama-studio` v1.0.1 保持用户已验证的 `sha256:ee54155b…42fd2`。源/复制件均只有受控文件；canonical digest 已排除 `.in_use/`、`.git/`、`.DS_Store`、`._*`、`Thumbs.db`、`desktop.ini`，真实内容/版本 manifest 不排除。
- TDD 红灯已保留：queued replay 删除 materialization 后不能补证；SDK init 未调用 frozen evidence provisioner；Admin materialization 仍产生 full-lock hash；同 hash 的 Admin policy 行会污染 Dream activation。未放宽激活完整性断言。
- 最小修复：Dream materialization identity 绑定 canonical artifact-set hash；queued launch replay和 SDK init resume 均按 Run 冻结 lock、已验证不可变安装补建新 identity；历史 `45ee…` 行不原地更新；Admin Gateway 统一 canonical hash/key；Dream activation 仅接收 `dream-launch/v1` policy，防止 `deck-admin/v1` 行混入。
- focused 回归：53 passed、1 skipped、30 subtests passed；插件复制/管理/SDK init 扩大 focused：73 passed、1 skipped、44 subtests passed；Dream/Workflow/runtime 扩大回归：296 passed、4 skipped、195 subtests passed；`git diff --check` 通过。
- 用户授权后已停止旧 VS Code debugpy PID 26034，并以仓库 `.venv` 启动加载新代码的后台 PID 66277；`GET /api/health` 为 200。既有前端 5173/PID 83170 未停止。后台为用户明确要求持续运行的交付服务，未作为测试残留清理。
- 共享 PostgreSQL 审计只执行 SELECT/rollback，未手工修复、未写测试数据；canonical materialization 将只在用户正常 resume 请求中由业务服务创建。当前日志尚未观察到目标 thread 的新 resume，因此共享 Run 从 queued→running 的最终现场证据仍待真实请求触发；不得把单元/隔离回归替代该现场断言。

## 2026-08-11 — Dream 订阅/模型/Gateway/剧本生产完整 E2E 发布验收

### Optimized Prompt

你是 Ink Dream Memory 的业务架构师、全栈工程师、模型与订阅计费一致性工程师和发布级 Playwright QA。基于以下权威设计，继续当前工作树并完成 Dream 剧本生产主链的证据驱动 E2E 发布验收，不得把已经修复的 runtime materialization、已有单元测试、Mock 成功或单接口 200 当作完整业务结论：

- Admin Dream 交互设计：`/Users/dmeck/project/ink-admin-memory/docs/design/modules/story-business/admin-dream-interaction-design.md`
- Dream 模型服务接入设计：`docs/design/model-service/07-model-service-integration-design.md`
- Dream 订阅业务设计：`docs/design/subscription/06-subscription-business-design.md`

先从三份设计逐条提取用户旅程、状态机、truth ownership、API/DTO、错误合同、幂等/并发和安全边界，并与现有设计稿、实现、测试及 `scripts/run-dream-business-e2e.mjs` 双向追踪。重点证明同一隔离用户、workspace、deck、thread、Workflow Run 和 Episode 从订阅/Entitlement/Allowance、Admin 公共模型目录、platform model identifier 保存、Dream launch、SDK runtime activation、Gateway alias/Provider、Token reserve/capture/release、Dream Files/Agent Messages、确认、Episode binding/actions/artifacts、Workflow completed、Story Index 到桌面/移动刷新重入保持一致。

采用 TDD 和分层证据：先运行 preflight/端口归属检查并保留用户明确要求持续运行的 5173/8765；检查现有 runner 的最后失败和诊断，不预设根因。若真实隔离 Chromium 仍返回 401、402、403、409、422、429、502 或 503，必须定位服务端真值和请求合同，增加稳定失败测试后做最小修复；禁止延长 sleep、强制点击、吞错、放宽断言、硬编码当前数据、直接 SQL 推进状态或从 DOM 推导 Workflow/计费事实。

真实 E2E 必须使用本轮精确命名的隔离 PostgreSQL clone、自有 Dream/Admin/Vite/local-provider 动态端口与 Artifact Root；真实共享 PostgreSQL 仅 SELECT/rollback。Provider 必须是本地零收费实现，且要证明外部 Provider 调用为 0。导航前注册 response、requestfailed、console、pageerror；断言 1440×1000 和 390×844 的 loading/empty/error/last-good、键盘/焦点/ARIA、刷新/重入，无非预期应用诊断。所有写请求验证 idempotency/revision/ETag 与冲突合同。

Acceptance Criteria:

- 需求—场景—API—代码—断言矩阵覆盖三份设计的全部 Dream 相关条款；缺失或矛盾项明确修复或列为发布门禁。
- 新用户无订阅、有订阅无模型权限、Allowance 耗尽、Gateway 不可达、模型下架/alias 失效、目录空/重试/保存均有 source/Mock/服务端证据，错误不伪装成功。
- 同一真实隔离 Run 完成 Dream 初始人物/场景/剧本/分镜/审阅/Prompt/渲染指引，确认后完成全部 Episode actions 和 artifacts；Workflow completed、Dream Files、Agent Messages、Episode Binding、Action Projection、Story Index 同源一致。
- 每次 Gateway 请求均使用服务端选定 alias、成功或安全失败并 settled；Token `reserve = capture + release`、最终 `reserved_tokens = 0`，幂等重放不重复 Provider、ledger、消息或产物。
- PostgreSQL runtime integration 覆盖原生 datetime、JSONB、boolean、nullable；actor/workspace/run/story/episode 权限隔离和 404/409/422/503 安全合同通过。
- backend focused/expanded、frontend source、Mock Chromium、真实 Chromium、ESLint、TypeScript、production build、`git diff --check` 均给出准确 pass/fail/skip；截图/trace 仅辅助断言。
- finally 关闭并清理本轮自有容器、动态端口、数据库、Artifact Root、浏览器和输出；不停止用户要求持续运行的 5173/8765，不写共享库，不泄露 Token/Secret/DSN/绝对 artifact 路径。

Rollback and Cleanup:

- 每项修复可按服务端合同、前端同步或测试 fixture 独立回退；保留失败测试，不回退已验证的 canonical materialization、鉴权、Gateway、Token、Workflow PostgreSQL 和权限边界。
- 若出现重复 dispatch/settlement、旧 revision 覆盖新状态、跨 Run/账号归属、last-good 丢失或请求风暴，立即回退对应最小改动并保持发布门禁失败。
- 禁止 DROP/TRUNCATE 共享库、生产库测试写入、跨账号数据重归属、破坏性 Git 或清理非本轮资源。

### Optional Enhancers

- 生成 machine-readable `requirement → browser step → request → PostgreSQL fact → artifact digest/ETag → assertion` trace manifest。
- 保存 Playwright trace 和桌面/移动关键截图，但最终结论仍以业务断言、数据库和计费守恒为主。

### 本轮问题与用户影响

runtime materialization 根因已修复且后台已启动，但完整目标仍未证明：此前隔离真实链在最终 Dream 页面重入出现 422，且三份设计到测试/接口/状态事实的逐条闭环尚未完成。用户仍可能在剧本产物已生成后刷新/重入失败，或订阅、模型、Token、Workflow 与 Episode 事实不一致。

### 事实来源和真值所有者

- Subscription/Plan/Entitlement/Allowance/model catalog/Gateway/Token ledger：Admin Gateway 与 Admin PostgreSQL。
- Workflow Run/Agent session/messages/Dream Files/Episode binding/actions/index：Dream PostgreSQL 与对应服务。
- 剧本及 Episode 文件：受控 Artifact Root；浏览器只拥有临时展示缓存、loading/error/last-good/focus。

### 修改范围与明确不修改范围

范围：三份设计的 Dream 条款追踪、现有隔离 runner/真实 Chromium 最后失败、必要的同链 TDD 修复、完整回归与证据。非范围：无关 UI/业务重构、静态模型目录、浏览器计费推导、新持久化 fallback、真实收费 Provider、共享数据库修数、用户持续运行的 5173/8765。

### 测试矩阵

订阅/Entitlement/Allowance 正反态；模型目录/alias/保存/下架；Gateway/Provider/Token 成功、缺 usage、流中断、幂等；Dream launch/runtime/Agent SSE/取消/重试/确认；Dream Files/人物/场景/剧本/分镜/审阅/Prompt/渲染；Episode actions/artifacts/index；刷新/重入/desktop/mobile；权限隔离；404/409/422/503；PostgreSQL 原生类型；console/pageerror/requestfailed/敏感信息；cleanup。

### 完成标准

只有三份设计逐条追踪无未解释缺口、同一新隔离 Run 的真实 Chromium 完整通过、Gateway/Token/Workflow/Artifacts 数据事实一致、所有静态与回归门禁通过且资源清理完成，才可标记目标完成。

### 风险、回滚与资源清理要求

主要风险为旧 runner 隐藏真实错误、E2E fixture 与正式 validator 漂移、重入 422、重复计费/dispatch、共享服务误停和资源残留。用正式 DTO/validator、数据库与 ledger 断言、动态自有端口、fail-closed、finally cleanup 和诚实发布门禁控制。

### 执行状态

- 本 Prompt Architect 记录已先于本轮设计审计、代码分析、测试规划和修改落盘。
- 三份权威设计已核对并形成双向追踪与完整性审计：Dream 仓库新增主链完整性审计、三合同 E2E 追踪和 `design_012` 交互/状态/时序/API/truth ownership 设计；未引入静态模型目录、浏览器计费真值或第二套 Workflow 状态。
- 用户现场基础故障根因一：Dream runtime lock 只包含 Dream adapter，而 workspace frozen manifest 还包含合法的 Deck 插件；旧校验错误要求两者集合完全相等。最小修复保持每个 runtime lock 条目必须按 package/version/digest/manifest 精确匹配并拒绝重复，只允许额外的 digest-verified frozen Deck 插件共存。现场两项证据保持为 `drama-forge@drama-studio` v1.0.1 / `sha256:ee54155b…42fd2` 与 `ink-dream-story@platform-builtin` v1.0.0 / `sha256:af53e0fb…e78`。
- 用户现场基础故障根因二：`GET dream-agent/messages` 会恢复 `pending`，而 dispatch 异常又把消息释放回 `pending`，3 秒轮询因此重复触发同一推理。修复后 dispatch 异常持久化为 terminal `failed`（安全错误码、失败时间、lease=0）；仅过期 `dispatching` lease 和一次性 legacy pending 可恢复。目标消息已成为 terminal failed，页面恢复 `lifecycle=idle`、`canSend=true`，重复 GET 未再产生 SDK init/Provider 调用。
- 用户现场 401 根因：静态 Gateway subject JWT 为 240 秒，而 Agent 工具确认允许等待 300 秒；后续 tool-loop Provider 请求会携带过期 token。修复改用 Claude Code 原生 `apiKeyHelper`，由服务端环境和 canonical subject 即时签发短期 JWT，移除静态 `ANTHROPIC_AUTH_TOKEN`/`ANTHROPIC_API_KEY`，并保留 Gateway base URL、service key header、turn idempotency root 和 fail-closed preflight。真实已安装 Claude CLI 对本机伪 Gateway 的首个 401 会重新调用 helper，以不同 jti 重试并获得 200；外部 Provider 调用 0。
- 现场 runtime activation 已创建 Agent Session `as_db707d9730e642e29d1f17d13e0af07c` 与 receipt `rlr_d521cb20c3cc40ab9c78885fef5cc529`，证明插件修复生效。旧用户消息不伪造成功、保持 terminal failed；用户可重新发送。因未授权收费 canary，没有自动重放该消息。
- 后端 focused：107 passed、1 skipped、94 subtests passed；后端正式测试目录扩大回归（排除会直连 8765 写数据的 legacy manual smoke）为 1835 passed、18 skipped、656 subtests passed。第一次误运行该 manual smoke 创建的精确测试 Deck/Voice 已按 owner/name/id 核对并删除，GET 复核 404；不碰其他数据。
- legacy smoke 还暴露 `fork_voice` 将 PostgreSQL BOOLEAN 写成整数 `0/1` 的 500；最小修复改为 psycopg 原生 `False/True` 参数并增加 rollback-only clone 集成断言。PostgreSQL runtime integration 最终 4 passed；Story Artifact PostgreSQL 61 passed；隔离 clone 同时验证 legacy artifact status backfill/check constraint、原生 datetime/JSONB/boolean/nullable 合同。
- 第一次最终链复跑诚实捕获生成中 `dream-files` 422：页面在 Agent streaming 且没有 durable assistant history 时提前探测严格 output contract。没有把 422 加入白名单；前端现在先读取 Agent snapshot，无历史的新 turn 等 idle terminal 后才加载 files，已有 assistant history 的重入可显示 last-good，但 streaming 期间暂停轮询/SSE invalidation，terminal revision 再刷新，避免无意义请求和 422 噪声。
- 前端 source contract 370 passed；确定性 Mock Chromium 7 passed；Provider harness 2 passed；ESLint 0 errors、21 个既有 Hooks warnings；独立 TypeScript、production build 与 `git diff --check` 均 exit 0。
- 完整真实 Chromium（隔离 PostgreSQL clone、自有 Dream/Admin/Vite/本地零收费 Provider）最终通过：模型选择/390×844 恢复 1 passed；同一新 Run 的 Gateway 计费 Episode 全链与重入 1 passed；Admin 按 revision 读取同一生成 Story 1 passed。最终浏览器阶段用时分别为 1.7s、27.5s、6.5s，覆盖 1440×1000 与 390×844，断言无非预期 console/pageerror/requestfailed。
- Gateway/Token 一致性：32 个 Gateway requests 全部 HTTP 200、succeeded、settled；32 个 provider observations 全部 run-bound，唯一 upstream model 为 `dream-producer-upstream-fast`；reserve 32 次 / 1,836,876 tokens，capture 32 次 / 1,180，release 32 次 / 1,835,696，满足 capture + release = reserve，最终 reservedTokens=0；外部收费 Provider 调用 0。
- 资源与服务：本轮精确命名 PostgreSQL 容器、动态端口、Artifact Root、临时 Agent workspace、Mock 截图输出均已清理；无 `ink-dream-business-e2e-*` 容器残留。既有前端 5173/PID 83170 未停止；按用户要求由本轮管理的后台 8765 已用最终代码重启为 PID 59958 并保持运行，`/api/health=200`，未认证 `/api/decks=401` 符合鉴权合同。
- 数据边界：真实业务 E2E 仅写隔离 PostgreSQL clone；未手工修改共享 Run 或跨账号重归属。现场 authenticated GET 曾按正常业务语义触发目标 pending 消息恢复并写入 session/receipt/terminal failed，之后只读复核；legacy smoke 的精确测试资源已清理。未执行真实收费 Provider、安全 canary 或生产库测试写入。
- 发布结论：Dream Agent 重复请求、runtime 插件误拒绝和长等待后 Gateway 401 已修复；三设计约束下的完整隔离业务链、Gateway/Token 守恒、桌面/移动重入与静态门禁通过。诚实遗留为旧现场消息不会自动重放为成功，需用户主动重新发送；真实收费 Provider canary 仍是发布环境门禁而非本轮完成项。

## 2026-08-11 — Dream Agent 与剧本业务 E2E 完成性逐条审计

### Optimized Prompt

你是 Ink Dream Memory 的发布审计负责人。对当前工作树和当前运行态执行一次不依赖既往结论的 requirement-by-requirement 完成性审计，目标是判断“先修复 Dream Agent 错误重复发起请求，再按 Admin Dream 交互、模型服务和订阅业务三份设计完成 Dream 剧本生产 E2E 完整性验证”是否已经真实完成。以当前文件、当前进程、当前测试合同、隔离 PostgreSQL/本地 Provider/真实 Chromium 证据和 correction worklog 为准；既往回答、单元测试绿灯、Mock 成功或单接口 200 都不能单独证明完成。

权威输入：Admin Dream 交互设计、Dream 模型服务设计、Dream 订阅业务设计；当前完整性审计、三合同追踪矩阵、`design_012`；Dream Agent runtime activation/message dispatch/Gateway helper/Dream files gate；`scripts/run-dream-business-e2e.mjs` 及其真实浏览器 specs。逐条建立 requirement → truth owner → API/代码 → test assertion → current evidence 映射，并将每项判定为 proved、contradicted、weak 或 missing。

先执行 `ink-dream-playwright-qa` preflight、`git status --short` 和 5173/8765 端口归属；不停止用户前端，保持用户要求运行的最终后台。复核目标 Run 的旧消息已 terminal failed、重复 GET 不再重新 dispatch、runtime 插件 digest/version 匹配、Gateway 401 使用 refreshable helper 而不是延长 token。复核订阅/Plan Version/Entitlement/Allowance、Admin 模型目录和 alias 保存、Dream launch/confirm/Agent、Gateway/Provider/Token、Workflow/Episode/actions/artifacts/Story Index、刷新/重入、1440×1000/390×844、键盘/ARIA、错误/last-good、敏感信息和资源清理的直接证据。

若发现缺口，先增加稳定失败测试再做最小同链修复；禁止放宽断言、吞 401/409/422/503、硬编码当前 Run、从 DOM 推导服务端完成、共享 PostgreSQL 测试写、真实收费 Provider、破坏性 Git 或覆盖用户未提交修改。真实验证只使用精确命名的隔离 PostgreSQL clone、自有动态端口和本地零收费 Provider；导航前注册 response/requestfailed/console/pageerror；finally 清理自有资源。

Acceptance Criteria:

- Dream Agent 重复请求根因、terminal failure 语义、runtime activation 和 Gateway token refresh 都有代码、测试及当前运行态直接证据；旧失败不得伪装成功。
- 三份设计的所有 Dream 相关需求都能追踪到 truth owner、接口、实现和至少一个覆盖正确边界的断言；任何缺失必须修复或保持目标未完成。
- 同一隔离 Run 在真实 Chromium 中完成订阅/模型、Dream 初始产物、确认、Episode binding/actions/artifacts、Workflow completed、Story Index 与桌面/移动刷新重入，且零非预期应用诊断。
- Gateway 请求全部使用服务端 alias 并 settled；Token reserve = capture + release、reserved=0；幂等重放不重复 Provider/ledger/artifacts；外部 Provider 调用 0。
- PostgreSQL 原生 datetime/JSONB/boolean/nullable、actor/workspace/run/story/episode 权限、404/409/422/503 和 last-good/恢复合同有直接测试证据。
- backend focused/expanded、PostgreSQL integration、frontend source、Mock Chromium、real Chromium、ESLint、TypeScript、production build、`git diff --check` 的最终数字对应当前代码；资源清理和端口归属复核无残留。
- 只有所有明确要求均为 proved 且无 required work 残留，才把 active goal 标记 complete；否则继续修复，不以报告代替完成。

Rollback and Cleanup:

- 本轮原则上只读；若补修，按 Dream Agent、Gateway、Dream files gate、PostgreSQL 合同或测试 fixture 独立回退并保留红灯测试。
- 若出现重复 dispatch/settlement、旧 revision 覆盖新状态、last-good 丢失、额外 422/401、跨账号归属或诊断泄密，回退对应最小改动并保持 goal active。
- 清理本轮精确容器、动态端口、Artifact Root、Playwright output 和临时文件；不删除宽泛目录、不停止非本轮服务、不改共享数据库。

### Optional Enhancers

- 输出一张精简的 requirement/evidence/status 表，并对每个真实浏览器断言链接到对应 spec。
- 保存 machine-readable trace manifest，但不得以其替代数据库和浏览器断言。

### 本轮问题与用户影响

既往已有完整绿灯与修复结论，但 active goal 要求再次确认每个显式需求都由当前证据证明；若某个负向订阅状态、重复请求边界、真实浏览器重入或清理只由间接证据支持，用户仍可能在发布后遇到 401、422、重复计费或卡住的 Agent。

### 事实来源和真值所有者

- Dream Agent/session/message/runtime receipt：Dream PostgreSQL 与 Agent runtime；Subscription/model/Gateway/Token：Admin PostgreSQL 与 Gateway。
- Workflow/Episode/Story Index：Dream PostgreSQL 服务；受控剧本文件：隔离 Artifact Root；浏览器只拥有展示缓存、focus 和 last-good 呈现。
- 运行态：当前 5173/8765 监听进程和 API；测试证据：当前 specs/runner 输出而非历史口述。

### 修改范围与明确不修改范围

范围：完成性审计、证据补强及审计发现的最小同链缺陷。非范围：无关 UI、真实收费 Provider、共享库修数、静态模型目录、浏览器计费推导、新 fallback、非本轮服务和用户未提交改动。

### 测试矩阵

Agent failure/recovery/repeat poll/tool wait；插件 version/digest；订阅正反态、Allowance、模型目录/alias；Gateway/Token/idempotency/provider failures；Dream launch/files/confirm/messages；Episode actions/artifacts/index；desktop/mobile/refresh/reentry；401/409/422/503/last-good；PostgreSQL native types/permissions；console/pageerror/requestfailed/security/cleanup。

### 完成标准

上述矩阵与三设计逐项有当前强证据，真实同 Run 全链和 Token 守恒通过，基础服务保持健康、无重复 dispatch，静态门禁与资源清理通过，无 required gap。

### 风险、回滚与资源清理要求

主要风险是把既往成功当当前证据、误把 Mock 当业务 E2E、漏掉负向合同、重复触发共享数据写入或为绿灯过滤错误。使用只读审计、隔离 runner、精确诊断与 finally cleanup 控制；证据不足即保持未完成。

### 执行状态

- 本 Prompt Architect 记录已先于本轮完成性审计、计划更新和任何新增修改落盘。
- 当前运行态复核：5173 仍由用户前端 PID 83170 持有；8765 为最终 Dream 后台 PID 59958，沙箱外 `GET /api/health` 为 200，后台本轮新增日志只有 health 200，没有新的 Dream SDK init/repeated dispatch。preflight 依赖检查通过；其端口探针受沙箱隔离显示 FREE，已以沙箱外 `lsof`/`curl` 真值覆盖。
- 旧的三合同追踪文档仍标记多项 `missing/contradicted`，与当前 migration、runtime lifecycle 和真实 Dream-owned Story 链相矛盾；已重写为当前 `requirement → truth owner → implementation → direct assertion → status` 矩阵。除未授权真实收费 Provider canary 为 `externally-gated` 外，用户显式 Dream 范围全部为 `proved`。
- 本轮补强测试一：模型目录空响应在 1440×1000 Mock Chromium 中必须显示“平台尚未启用可展示的模型”，radio=0、PUT=0、诊断=0；模型设置 focused 为 3 passed。完整 Mock Chromium 最终 8 passed（11.3s），覆盖 catalog success/last-good/empty、Subscription desktop/mobile 与 Episode/Agent/focus/ARIA。
- 本轮补强测试二：Dream launch model eligibility precheck 对 401、402、403、409、429、502、503 逐项保留安全状态，并逐项断言 Workflow Run=0、source message=0、Agent dispatch=0；focused 为 1 passed、7 subtests passed。旧失败消息仍是 terminal failed，不会因 GET polling 回到 pending 或伪装成功。
- 当前 Admin 定向 Subscription/Gateway/Token/settlement Vitest：10 files、63 tests 全部通过；Story schema/review：2 files、12 tests 全部通过。覆盖无订阅、paused/future period、显式模型 deny、Allowance 402、missing usage、流中断、abort、401 token refresh、watchdog、confirm/reject/revision/audit/replay。
- 当前一次性 PostgreSQL Subscription Chromium：1 passed（13.6s）；4 Gateway requests = 2 succeeded + 2 failed，6 Token ledger entries，0 conservation mismatch，reservedTokens=0。Allowance exhausted 返回 402，Provider request count不增加，已有现金余额/现金 ledger 不变，无 cash fallback。
- Dream backend 正式目录明确排除会直连 8765 写共享库的 legacy manual `tests/test_api_endpoints.py` 后：1835 passed、18 skipped、89 warnings、663 subtests passed（74.66s）。frontend source contracts：370 passed（11.0s）。Provider harness：2 passed。ESLint exit 0（0 errors、21 existing Hooks warnings）；TypeScript、production build（2758 modules）和 `git diff --check` 均 exit 0。
- 本轮未修改生产 runtime 代码；此前同一当前 runtime code 的完整隔离真实 Chromium 证据继续有效：模型保存/390×844恢复 1 passed；同一新 Run 完成 EP01/刷新/重入 1 passed；Admin读取并按 revision确认同一 Dream Story 1 passed。32 Gateway requests全部 200/succeeded/settled；reserve 1,836,876 = capture 1,180 + release 1,835,696，reserved=0，external Provider calls=0。
- 诊断回执：合并 Mock 套件前两次遗漏正确的 `INK_E2E_WEB_BASE`，各得到 5 passed/3 `ERR_CONNECTION_REFUSED :4177`，改用明确 5173 后 8/8通过；未放宽业务断言。一次沙箱内 backend full run仅因本机临时 Gateway bind被禁止而 1 failed，其余 1827 passed/26 skipped/663 subtests；一次沙箱内 frontend source因 Chromium MachPort权限失败并已停止。尝试沙箱外无排除项 full pytest被安全审查在进程启动前拒绝，原因是 legacy smoke可能写共享库；随后使用明确 `--ignore=tests/test_api_endpoints.py` 的正式边界通过。上述均为环境/命令边界失败，不计产品 green，也未触发共享写入。
- 清理复核：Dream/Subscription精确命名 Docker containers为0；`/private/tmp` 无本轮 Dream/Admin E2E roots；Mock临时 output 与 `frontend/test-results/.last-run.json` 已删除。删除本轮 01:02 创建并遗漏的精确 Admin `.next-e2e-dream-business-a3fd5bbf6b9b`；更早的 Admin `html/playwright-report/test-results` 非本轮资源，未动。用户5173/8765按要求保留。
- 数据边界：本轮新增验证只写一次性 PostgreSQL containers或测试内存/临时目录；共享 PostgreSQL 未写入，未执行真实收费 Provider、生产库测试写或跨账号重归属。
- 最终判断：Dream Agent runtime materialization误拒绝、消息重复请求和长等待后 Gateway 401 已有直接代码/测试/运行态证据；三设计 Dream 范围、负向矩阵、同 Run Workflow/Episode/Story/Token一致性和发布门禁均完成。真实收费 Provider usage canary仍需部署环境单独授权，不以本地 stub冒充。

## 2026-08-11 — Dream Agent 与业务 E2E 相关文件提交

### Optimized Prompt

你是 Ink Dream Memory 的发布提交负责人。将已经完成并验证的 Dream Agent 重复请求修复、runtime materialization、Gateway subject token refresh、server-owned model selection、Token/Workflow/Episode/Story 一致性、PostgreSQL 合同、Dream Files恢复门禁、设计文档、隔离 E2E runner及其测试，按仓库边界整理成可审计 Git commit。

先只读检查 Dream 与 Admin 两个仓库的 status、diff/stat 和文件归属。只 stage 本目标直接相关且已通过验证的文件；明确排除用户既有的 `frontend/test-results` 删除、历史报告输出、缓存、构建产物、Secret、临时资源和无法证明归属的改动。不得使用 `git add -A`、破坏性 Git、amend、reset、checkout 或 push。若同一文件同时包含相关与无关改动，先核对 hunk；无法安全拆分时不得擅自覆盖。

分别在 Dream 与 Admin 仓库提交，因为它们是独立 Git repository。提交前运行 staged diff检查、敏感信息扫描和 `git diff --check`；提交信息准确描述业务结果，不宣称真实收费 Provider canary。提交后复核 commit、剩余未提交文件和两个仓库工作树，确保未误纳无关文件。

Acceptance Criteria:

- Dream commit只含 Dream runtime/Agent/Gateway/model/Workflow/Artifact/UI/tests/design/E2E相关文件。
- Admin commit只含统一 Story Artifact schema/review/Gateway支持、correction worklog和必要的隔离测试基础设施。
- `frontend/test-results` 既有删除、旧 html/playwright报告、构建/缓存与临时文件不进入 commit。
- staged diff无 Token、service key、Provider credential、完整 DSN、绝对 Artifact 路径或测试生成的真实认证材料。
- 两仓 commit成功且给出 commit hash；不 push。

Rollback and Cleanup:

- commit前发现误 stage时仅用非破坏性 `git restore --staged <exact files>`；不改工作树内容。
- commit后若发现范围错误，停止并报告，不自动 amend/rebase/reset。
- 不启动或停止服务，不创建数据库/容器，不删除用户文件。

### Optional Enhancers

- 在最终回执中列出两个 commit的文件数量和剩余未提交路径类别。

### 本轮问题与用户影响

实现与验收已完成但尚未形成可审计提交；若直接全量 stage，会把用户既有测试截图删除或无关配置带入发布历史。

### 事实来源和真值所有者

- 文件归属与提交边界：两个仓库当前 `git status`、diff和历史；测试结论：本 worklog与三合同追踪文档。
- Git index/commit是提交事实；工作树未提交内容仍归用户，不因本轮整理改变所有权。

### 修改范围与明确不修改范围

范围：筛选、stage、检查并提交本目标相关文件。非范围：重写实现、修改测试结论、清理用户改动、push、PR或发布。

### 测试矩阵

两仓 status/diff归属；staged diff check；敏感信息扫描；commit后 show/status；未纳入文件核对。

### 完成标准

两个仓库的相关文件形成独立、可审计 commit，hash和剩余未提交改动明确，无无关文件或敏感信息进入提交。

### 风险、回滚与资源清理要求

主要风险为误纳用户删除、混入缓存/Secret、跨仓库提交遗漏或用破坏性命令清理。仅精确 stage，提交前后双重核对；本轮不产生运行资源。

### 执行状态

- 本 Prompt Architect 记录已先于本轮 Git status/diff审计、stage和commit落盘。
- 提交前当前代码复核：Dream 后端聚焦回归 231 passed、1 skipped，唯一沙箱失败为临时 `127.0.0.1:0` bind 权限；该真实 Claude CLI/Gateway 401 refresh 测试在允许本地端口的环境单独复跑 1 passed，因此对应集合为 232 passed、1 skipped，另有 115 subtests passed。
- Dream 前端完整 source Chromium 381 passed；其中新增 Dream→Chat SSE 重连与 ordinary Chat continuation 测试 1 passed。ESLint exit 0（0 errors、21 个既有 Hooks warnings），TypeScript project check 与 production build exit 0。
- Admin Story Artifact/Gateway 定向 Vitest 4 files、22 tests 全部通过；Dream/Admin staged `git diff --check` 均通过。
- `frontend/test-results` 运行产物和既有删除继续排除；本轮未 push、未 amend、未修改共享 PostgreSQL、未调用真实收费 Provider，也未启动或停止业务服务。
- Dream 仓库相关范围已提交为 `b5b986c`（`fix(dream): stabilize agent runtime and production workflow`，99 files）；Admin 仓库按独立 repository 边界随后提交。
