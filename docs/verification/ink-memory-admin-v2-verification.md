# Ink Memory Admin v2 验收记录

日期：2026-08-08（Asia/Shanghai）

## 验收边界

- 管理后台：`/Users/dmeck/project/ink-admin-memory`
- 只读业务源：`/Users/dmeck/project/ink-dream-memory`
- 测试数据库：一次性 Docker PostgreSQL，数据库名 `ink-memory`，宿主端口 `55432`
- 持久化项目数据库端口 `5433` 未被连接、迁移、清空或写入
- 测试结束后已删除容器 `ink-memory-e2e-codex-20260808`；其中只有可由迁移和 fixture 重建的测试数据

## 静态与构建门禁

| 命令 | 结果 |
|---|---|
| `pnpm env:check` | 通过；环境结构有效，支持可选 `STORY_DATABASE_URL` |
| `pnpm exec tsc --noEmit` | 通过 |
| `pnpm lint` | 通过，0 error |
| `pnpm test:run` | 通过；24 个测试文件、151/151 项测试 |
| `pnpm build` | 通过；Next.js 16.1.6 生产构建和全部 Admin/API/Gateway 路由生成成功 |
| `pnpm db:generate` | 通过；18 个控制面表，无 schema drift、无新迁移 |
| `git diff --check` | 通过；无空白错误 |

## 数据库与 Playwright 验收

1. `ink-admin-playwright-qa` preflight 通过。
2. 在明确自有的一次性 PostgreSQL 中从 `0000` 到 `0007` 应用全部迁移。
3. 应用 `tests/fixtures/story-source-postgres.sql` 和 `tests/fixtures/control-plane-e2e.sql`。前者只用于测试，按已审计的业务源表名、字段和关系建立 PostgreSQL fixture，不是生产迁移，也不是 SQLite 回退。
4. 聚焦命令 `pnpm exec playwright test tests/e2e/admin-bootstrap-postgres.spec.ts --project=chromium --workers=1`：1/1 通过。
5. Mock Session/Bootstrap 聚焦命令 `pnpm exec playwright test tests/e2e/admin-shell.spec.ts tests/e2e/admin-bootstrap.spec.ts --reporter=line --workers=1`：6/6 通过。
6. 浏览器诊断未发现非预期 5xx、`pageerror`、console error 或 request failure。
7. 测试后置条件：管理员 2 条、审计 16 条、目标 Gateway Request 为 `settled`、账本 3 条、系统 Secret 仍保持 `is_secret=true`。
8. 隔离 E2E 首轮发现 PATCH Zod schema 从 Create schema 继承默认值，导致未提交字段被错误重置；已改为显式 optional Update schema，并通过重建、重新播种及全场景复验确认修复。该缺陷与修复仅发生在一次性测试库，未连接共享数据库。

覆盖场景：

- 无 Session 页面重定向与 API 401
- Auditor 写操作 403
- 真实源表用户安全查询（不返回 `password_hash`）
- Story 查询、白名单更新、确认发布、禁止创建、跨工作区外键冲突 409
- 平台用户映射唯一冲突 409
- Provider 凭据加密与永不回显
- Provider 注册表、cc-switch 式预设/端点/认证/出参 Token 参数配置，以及面向 `ink-dream-memory` 的 Anthropic/OpenAI 代理契约
- Gateway Key 对模型代理端点的 scope 校验、模型别名解析、吊销后拒绝访问
- 系统 Secret 脱敏
- Gateway Key 仅创建时返回一次明文
- Model、Pricing、模型权限与限流读取
- Usage、账户、不可变 Ledger 与日报读取
- Gateway 失败结算人工核对、审计与账本联动
- Storage 配置 API 与既有共享实现未回归
- 已移除 PWA 页面和 API 继续返回 404
- 首位管理员一次性初始化与二次初始化 409
- 桌面/移动页面无 document 级横向溢出

## 视觉验收

| 视口 | 证据 | 结果 |
|---|---|---|
| 1440×1000 | `test-results/admin-bootstrap-postgres-R-68c61--billing-and-both-viewports-chromium/admin-provider-dialog-desktop-1440x1000.png` | cc-switch 式 Provider 全屏配置层包含预设、端点、认证、模型能力与代理发布入口；操作区固定且无 document 级横向溢出 |
| 390×844 | `test-results/admin-bootstrap-postgres-R-68c61--billing-and-both-viewports-chromium/admin-provider-dialog-mobile-390x844.png` | Provider 全屏配置在移动端按单列重排，字段标签、Secret 显隐和底部操作保持可用 |
| 1440×1000 | `test-results/admin-bootstrap-postgres-R-68c61--billing-and-both-viewports-chromium/admin-story-desktop-1440x1000.png` | 侧栏、模块导航、筛选器、表格与 Story 安全编辑区层级清晰，无页面级横向溢出 |
| 390×844 | `test-results/admin-bootstrap-postgres-R-68c61--billing-and-both-viewports-chromium/admin-mobile-menu-390x844.png` | 图片实际像素为 390×844；移动抽屉、遮罩、分组、当前项和触控布局正常 |

截图中的黑色 `N` 为 Next.js 开发模式指示器，不属于应用 UI，生产构建不会呈现。

## 迁移与安全检查

- `drizzle/0007_curvy_sabretooth.sql` 只为五张错误平行表添加弃用注释，不包含 `DROP TABLE`、`DELETE` 或 `TRUNCATE`。
- Canonical Drizzle schema 已停止声明错误 Story 平行表；Admin 运行时也不再读写这些表。
- 应用运行时代码没有 SQLite、文件数据库、JSON 数据库或内存数据库回退。
- Source repository 在数据库不可用或表未部署时 fail closed，并返回可诊断的 503。
- Provider Secret、Gateway Key、系统 Secret 与源用户密码散列均不回显。

## 未执行的外部场景与剩余风险

- `ink-dream-memory` 当前真实运行数据仍来自其既有 SQLite 文件。根据“不修改源项目”和“Admin 只允许 PostgreSQL”的约束，生产接入前必须由数据所有者把审计报告列出的真实业务表原样提供到数据库名为 `ink-memory` 的 PostgreSQL；可以与控制面共库，也可以通过 `STORY_DATABASE_URL` 使用第二 PostgreSQL。Admin 不会复制同步数据，也不会读取 SQLite。
- 未使用真实 Provider 密钥调用外部模型，未向真实对象存储上传文件，未执行真实财务扣款；这些场景需要专用沙箱凭据和明确授权。模型别名替换、Anthropic/OpenAI 协议适配、Gateway Key scope、凭据边界、Usage/Settlement、Storage 实现及计费事务已由单元和隔离 E2E 覆盖。
- 业务源仓库已有未跟踪目录 `.claude/worktrees/`；本轮未创建、修改或删除该目录，也未改动源项目业务代码、schema 或迁移。

## 明确确认

- 未修改 `ink-dream-memory` 业务代码、Schema、迁移或运行逻辑。
- 未引入 SQLite 或任何数据库回退。
- 未恢复 `app/(app)`。
- 未删除或弱化 `app/api/storage`、`app/lib/file-storage` 及相关共享库。
- 未操作共享数据库中的真实数据。
