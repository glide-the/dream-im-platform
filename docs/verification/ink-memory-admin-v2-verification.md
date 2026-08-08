# Ink Memory Admin v2 验收记录

日期：2026-08-08（Asia/Shanghai）

## 验收边界

- 管理后台：`/Users/dmeck/project/ink-admin-memory`
- 只读业务源：`/Users/dmeck/project/ink-dream-memory`
- 测试数据库：一次性 Docker PostgreSQL，数据库名 `ink-memory`，宿主端口 `55432`
- 持久化项目数据库端口 `5433` 未被连接、迁移、清空或写入
- 测试结束后删除自有容器 `ink-memory-admin-e2e-round7-20260808`；其中只有可由迁移和 fixture 重建的测试数据

## 静态与构建门禁

| 命令 | 结果 |
|---|---|
| `pnpm env:check` | 通过；只接受指向 PostgreSQL `ink-memory` 的 `DATABASE_URL` |
| `pnpm exec tsc --noEmit` | 通过 |
| `pnpm lint` | 通过，0 error |
| `pnpm test:run` | 通过；27 个测试文件、159/159 项测试 |
| `pnpm build` | 通过；Next.js 16.1.6 生产构建和全部 Admin/API/Gateway 路由生成成功 |
| `pnpm exec drizzle-kit generate --custom --name single_database_comments` | 通过；生成非破坏性 `0008` 注释纠偏迁移与快照 |
| `git diff --check` | 通过；无空白错误 |

## 数据库与 Playwright 验收

1. `ink-admin-playwright-qa` preflight 通过。
2. 在明确自有的一次性 PostgreSQL 中从 `0000` 到 `0008` 应用全部 9 个迁移。
3. 应用 `tests/fixtures/story-source-postgres.sql` 和 `tests/fixtures/control-plane-e2e.sql`。前者只用于测试，按已审计的业务源表名、字段和关系建立 PostgreSQL fixture，不是生产迁移，也不是 SQLite 回退。
4. 聚焦命令 `pnpm exec playwright test tests/e2e/admin-bootstrap-postgres.spec.ts --project=chromium --workers=1`：1/1 通过。
5. Mock Session/Bootstrap 聚焦命令 `pnpm exec playwright test tests/e2e/admin-shell.spec.ts tests/e2e/admin-bootstrap.spec.ts --reporter=line --workers=1`：6/6 通过。
6. 浏览器诊断未发现非预期 5xx、`pageerror`、console error 或 request failure。
7. 测试后置条件：管理员 2 条、审计 20 条（含 2 条 `model_validation`）、目标 Gateway Request 为 `settled`、账本 3 条、目标 Story 已 `confirmed`；迁移表记录 9 条，旧平行表注释已指向单一 `DATABASE_URL`。
8. 视觉轮次发现 Next.js dev 工具按钮会覆盖移动菜单的鼠标点击，最终改用真实键盘 focus + Enter 验证菜单；同时等待 Provider/Model 关系选项加载后再截图。未使用 `force` 绕过应用交互。

覆盖场景：

- 无 Session 页面重定向与 API 401
- Auditor 写操作 403
- 真实源表用户安全查询（不返回 `password_hash`）
- Story 查询、白名单更新、确认发布、禁止创建、跨工作区外键冲突 409
- 平台用户映射唯一冲突 409
- Provider 凭据加密与永不回显
- Provider 注册表、cc-switch 式预设/端点/认证/出参 Token 参数配置，以及面向 `ink-dream-memory` 的 Anthropic/OpenAI 代理契约
- Provider 连通测试的 `providers.write` 权限拒绝路径；reachability 的任意 HTTP 状态/网络失败/慢响应由单元测试覆盖，未调用真实上游
- Model validation 的 `models.write`、Origin、已加密 Credential、1 Token 上限、200/401/429/网络失败分类、不读取响应正文和脱敏审计；E2E 只调用本机 mock 上游
- Provider/Model 服务端分页、名称/Code/上游型号联合搜索、Usage URL 的 Provider/Model 筛选预填和 API ID 白名单
- Provider/Model 停用影响确认 Modal；独立编辑页稳定加载，不再发生 effect 循环和 DOM 重建
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
| 1440×1000 | `test-results/round7-postgres/**/admin-provider-page-desktop-1440x1000.png` | cc-switch 式 Provider 独立配置页包含预设、Endpoint、Credential、运行策略与代理发布侧栏；固定操作区且无页面级横向溢出 |
| 390×844 | `test-results/round7-postgres/**/admin-provider-page-mobile-390x844.png` | Provider 独立页单列重排，预设局部横向滚动，Secret 与底部操作保持可用 |
| 1440×1000 | `test-results/round7-postgres/**/admin-provider-disable-confirm-desktop-1440x1000.png` | 停用确认 Modal 展示关联启用模型、24h 请求和历史计费不受影响的恢复说明 |
| 1440×1000 | `test-results/round7-postgres/**/admin-model-page-desktop-1440x1000.png` | Provider 关系、稳定 alias、Model Dropdown、Token 上限、能力复选组与启用策略完整呈现 |
| 390×844 | `test-results/round7-postgres/**/admin-model-page-mobile-390x844.png` | 真实 Provider 选项加载后截图；表单单列且固定提交区可达 |
| 1440×1000 | `test-results/round7-postgres/**/admin-model-validation-desktop-1440x1000.png` | Model 卡片展示 mock 上游验证成功、耗时与 HTTP 200，不展示 Secret 或响应内容 |
| 1440×1000 | `test-results/round7-postgres/**/admin-pricing-page-desktop-1440x1000.png` | Model/Tier、四类 Token USD/1M、micro-USD 辅助值、百分比/bps 与生效窗口采用版本化独立页 |
| 390×844 | `test-results/round7-postgres/**/admin-pricing-page-mobile-390x844.png` | 真实 Model 关系已选中；四类价格和版本动作按单列继续滚动，无页面级横向溢出 |
| 1440×1000 | `test-results/round7-postgres/**/admin-story-desktop-1440x1000.png` | 侧栏、模块导航、筛选器、表格与 Story 安全编辑区层级清晰，无页面级横向溢出 |
| 390×844 | `test-results/round7-postgres/**/admin-usage-mobile-390x844.png` | Model URL 筛选真实预填；统计筛选单列重排，无页面级横向溢出 |
| 390×844 | `test-results/round7-postgres/**/admin-mobile-menu-390x844.png` | 图片实际像素为 390×844；移动抽屉、遮罩、分组、当前项和触控布局正常 |

截图中的黑色 `N` 为 Next.js 开发模式指示器，不属于应用 UI，生产构建不会呈现。

## 迁移与安全检查

- `drizzle/0007_curvy_sabretooth.sql` 只为五张错误平行表添加弃用注释，不包含 `DROP TABLE`、`DELETE` 或 `TRUNCATE`。
- `drizzle/0008_single_database_comments.sql` 只把上述注释从旧双连接说明纠正为同库 `DATABASE_URL`，不创建、复制、更新或删除业务数据。
- Canonical Drizzle schema 已停止声明错误 Story 平行表；Admin 运行时也不再读写这些表。
- 应用运行时代码没有 SQLite、文件数据库、JSON 数据库或内存数据库回退。
- Dashboard 在业务表尚未迁入时只降级 Story 指标并列出缺表；Story repository 本身 fail closed 为可诊断 503，其他控制面模块继续可用。
- Story 更新/状态流转与管理员审计在同一个 PostgreSQL 事务内提交，审计失败整体回滚。
- Provider Secret、Gateway Key、系统 Secret 与源用户密码散列均不回显。

## 未执行的外部场景与剩余风险

- `ink-dream-memory` 当前真实运行数据仍来自其既有 SQLite 文件。根据“不修改源项目”和“Admin 运行时仅 PostgreSQL”的约束，生产接入前必须由数据所有者把审计报告列出的真实业务表迁入同一个 `DATABASE_URL` 指向的 `ink-memory`。迁入前 Story 页面明确报告缺表；Admin 不复制同步数据，也不读取 SQLite。
- 未使用用户提供的真实 Provider 密钥调用外部模型；该密钥未写入文件、日志、fixture 或数据库。未向真实对象存储上传文件、未执行真实财务扣款；这些外部场景需要轮换后的专用沙箱凭据和明确授权。模型别名替换、Anthropic/OpenAI 协议适配、Gateway Key scope、凭据边界、Usage/Settlement、Storage 实现及计费事务已由单元和隔离 E2E 覆盖。
- 业务源仓库已有未跟踪目录 `.claude/worktrees/`；本轮未创建、修改或删除该目录，也未改动源项目业务代码、schema 或迁移。

## 明确确认

- 未修改 `ink-dream-memory` 业务代码、Schema、迁移或运行逻辑。
- 未引入 SQLite 或任何数据库回退。
- 未恢复 `app/(app)`。
- 未删除或弱化 `app/api/storage`、`app/lib/file-storage` 及相关共享库。
- 未操作共享数据库中的真实数据。
