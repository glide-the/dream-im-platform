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
