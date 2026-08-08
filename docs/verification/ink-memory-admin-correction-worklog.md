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
