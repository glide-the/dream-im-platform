# AGENTS Instructions Guidelines (ink-memory-admin)


本仓库是 Ink Memory 的 Next.js + Refine 管理控制台，使用单一 PostgreSQL 数据库。不存在 `app/(app)` 业务前台，也不存在 SQLite 回退。

## 目录职责

- `app/(admin)/admin/**`：Refine 管理页面与受保护布局
- `app/components/admin/**`：管理后台组件与 Refine providers
- `app/api/admin/**`：管理 API Route Handlers，只做请求编排
- `app/v1/**`：Anthropic/OpenAI 兼容网关入口
- `app/lib/admin/**`：认证、RBAC、资源查询、写操作、审计
- `app/lib/gateway/**`：协议适配、鉴权、请求生命周期
- `app/lib/billing/**`：定价、预授权、结算与账本
- `packages/db/src/schema/**`：唯一 Drizzle schema 来源；`app/lib/db/schema*` 仅兼容导出
- `packages/db/src/migrate.ts`：显式 migration runner 与内嵌 PostgreSQL 生命周期
- `drizzle/**`：必须提交且不可变的 PostgreSQL SQL/journal/snapshot 历史
## Vibe Contract
- Any functional, architectural, or coding-style change must update affected folder docs and file headers before session end.
- Prefer reuse-first refactor: search existing modules/components before adding new implementations.
- Avoid hard-coded business IDs, thresholds, hosts, paths, or policy values; resolve to env/config/policy first.

## Source Of Truth
- Root pointer: `CLAUDE.md`
- Folder contracts: `**/.folder.md`
- Rules index: `docs/rules/README.md`
- Cursor rules: `.cursor/rules/*.mdc`

## Validation
- Run requested validation commands after meaningful changes.
- When touching docs, verify Markdown inventory and referenced paths remain valid.
- Report concrete evidence (`command`, exit code, key output) in the final summary.

### 浏览器 E2E 前置检查

- 浏览器 E2E 优先复用本机已安装的 Chrome；只做一次能否启动的轻量检查，不要求重复下载 Playwright Chromium revision。
- 仅当本机没有兼容浏览器时才安装浏览器依赖。浏览器或 runner 无法启动属于 harness 前置失败，不能据此判断页面或 API 有缺陷。
- E2E 结束后只清理本轮明确命名的隔离数据库、端口、进程和生成物，不得停止或修改用户已有服务。


## 强约束

1. 只支持 PostgreSQL；禁止新增 SQLite、better-sqlite3、本地 JSON DB 或隐式内存回退。
2. Route Handler 不承载复杂业务逻辑；校验、SQL 和事务留在 `app/lib/**`。
3. 所有管理 API 在服务端重复验证 Session 与 permission；Refine 按钮隐藏不是授权边界。
4. 管理写操作必须使用严格 Zod schema、事务和审计。
5. 金额统一为整数 micro-USD；历史计费必须保存价格快照，账本只追加。
6. Provider 密钥和 Gateway Key 不得明文落库或回显。
7. Story 表属于本项目 PostgreSQL 控制面，修改 schema 必须生成 Drizzle 迁移。

## 统一数据库版本协议

- `drizzle/**` 是共享 PostgreSQL 唯一 Schema/DDL 版本历史。
- Dream、Admin、Gateway、Billing 等领域不得建立第二套 Alembic、runtime DDL 或自动建表机制。
- 已进入 journal 或已应用的 SQL、snapshot、tag、when 和 hash 永久不可修改；修复必须新增前向 migration。
- Schema 变更必须使用 expand → application compatibility → backfill → validate → contract。
- Schema migration 不承载大规模业务数据搬迁；数据迁移必须使用 `drizzle/data/**` 的显式、可审计 runner。
- 非一次性隔离数据库禁止 `db:push`。
- 应用启动只检查 capability，不执行 migration。
- migration、回填、破坏性测试和可重复执行的持久化自动化测试必须证明目标是明确命名、可删除的隔离 PostgreSQL；真实业务测试按下方“本机真实业务测试协议”执行。

## 常用命令

```bash
pnpm dev
pnpm build
pnpm lint
pnpm test:run
pnpm test:e2e
pnpm db:generate
pnpm db:migrate
```

## 测试要求

- API/领域变更至少覆盖成功路径与一个失败路径。
- 关键管理交互使用 `tests/e2e/*.spec.ts`。
- migration、回填、破坏性和可重复持久化 E2E 必须使用明确的隔离 PostgreSQL，禁止迁移或清理未知数据库；用户明确要求的真实业务 E2E 使用本机真实数据。
- 提交前至少通过 typecheck、lint、unit 与 focused Playwright；高风险改动再跑 build。

## 单一运行路径与 Harness 协议

- 本项目禁止按 `development`、`test`、`production`、`unknown` 等部署环境名称实现多套业务或数据库行为；设计、应用代码、Gateway、Drizzle schema 与 migration 不得使用环境名称解锁功能、改变状态机、选择 Agent runtime、跳过账本/持久化或降低授权。
- Dream/Admin/Gateway 在所有部署中必须执行同一条生产合同。运行位置与能力使用明确 topology/capability 表达，不得把测试环境名称写成 runtime 或 DDL capability。
- 测试 harness 的差异只能存在于 `tests/**` 或明确命名的验证脚本中，并通过依赖注入、明确命名的隔离 PostgreSQL、fake/real provider 选择、显式 capability、显式 secret 与可控 clock 配置；禁止在生产模块中放置 test-only fallback、固定测试密钥或“非测试环境直接 return”的分支。
- Harness 必须调用公开生产入口和真实 DTO/协议，不得复制测试专用 API、Gateway、migration runner、状态机或 Agent runtime。真实 provider 测试必须显式限定模型与调用次数，保护正文、凭证和 DSN，并清理自有进程、端口、容器、volume 与临时目录。
- 缺少 migration credential、schema capability、provider entitlement、账本余额或权限时，由对应边界 fail closed；不得通过笼统环境标签推断这些事实。

## 本机真实业务测试协议

- 凡用户要求或任务标记为“真实业务测试”“真实数据测试”或“真实模型验收”，必须使用本机正常运行的 Admin、Gateway、Dream 和当前本机真实 PostgreSQL 数据，全部业务步骤走公开生产入口。
- 必须使用用户指定的现有真实账户和已有业务实体；禁止用数据库 clone/snapshot、影子账户、clone-only Deck、临时订阅、隔离账本、随机端口 Admin 或替代 Gateway 冒充真实业务链路。
- 测试产生的 Dream Run、Thread、Gateway request、Token 结算和失败记录必须写入正常业务数据库，并能在用户日常使用的 Admin 后台中查询；不可见于正常 Admin 的隔离回执不能作为真实业务验收证据。
- 真实业务测试只执行与普通用户相同的可见操作和必要业务写入。除非用户明确要求清理，否则保留本轮 Run 与日志供复核；不得修改无关账户、历史正文、订阅或账本。
- 隔离数据库仅用于 migration、回填、破坏性、故障注入和可重复的 Provider-free 技术合同测试；此类结果必须明确标注为技术验证，禁止汇报为真实业务测试或真实模型验收。

## 命名与提交

- TypeScript；避免 `any` 扩散，输入优先 Zod 推导。
- 组件 `PascalCase.tsx`，工具函数 `camelCase.ts`。
- Conventional Commits：`feat:`、`fix:`、`docs:`、`chore:`、`refactor:`、`test:`。
