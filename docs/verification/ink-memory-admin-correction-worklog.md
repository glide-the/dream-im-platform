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
