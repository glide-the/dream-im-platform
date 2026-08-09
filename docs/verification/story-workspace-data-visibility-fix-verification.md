# Dream Workspace / Story 数据可见性修复验证报告

> 日期：2026-08-09  
> 范围：`/admin/story/workspaces`、`/admin/story/stories` 及其 Refine/API/Repository 链路  
> 结论：修复完成；生产共享数据库只读，写验证全部在专属 disposable PostgreSQL 中完成。

## 1. 真实根因

数据库迁移和 Dream canonical 数据本身正常。真实根因是 Admin 查询/交互合同的组合缺陷：

1. Story 页面订阅兼容别名 `stories`，正式关系导航、写操作和缓存失效使用 `story-stories`，形成双 API endpoint 和双 React Query cache namespace。
2. “清除筛选”只清组件 state，不清 URL；User→Workspace→Story 关系跳转留下的参数在刷新/返回后重新生效，造成持久假空状态。
3. 请求失败时页头仍显示 `0 条记录`，空 table body 与通用提示继续出现，使 400/401/403/500/503 被误读为数据库零行。
4. Workspace/Story 的状态、关系、更新时间筛选和字段映射不完整，关系输入标签与实际 SQL 条件不一致。

以下候选经证据排除：Admin 连接错误数据库、查询旧平行表、`INNER JOIN platform_users` 过滤、bigint/text 主外键不兼容、API `{data,meta}` 合同错误、Dream 迁移数据 orphan。

## 2. 当前数据库与 schema

Admin `.env.local` 与 Dream `backend/.env` 均指向本机映射端口 5433 的 PostgreSQL 数据库 `ink-memory`；主机写法分别为 `localhost` 与 `127.0.0.1`，逻辑目标相同。服务端只读查询结果：

| 项目 | 结果 |
|---|---|
| `current_database()` | `ink-memory` |
| `current_schema()` | `public` |
| `search_path` | `"$user", public` |
| PostgreSQL 服务端 | 容器地址 `172.18.0.2:5432` |
| canonical 表 | `users`、`story_workspace_workspaces`、`story_workspace_stories` 均存在 |

生产共享库最终复核使用 `BEGIN READ ONLY`，没有创建 Session、执行迁移或写入数据。

## 3. 数据库、API 与 UI 对照

| 数据集 | DB count | API `meta.total` | UI 记录数 | 关系错误 |
|---|---:|---:|---:|---:|
| 生产共享库 Workspace | 12 | 未对共享库创建登录 Session | 未对共享库执行带 Session 浏览器验证 | owner orphan=0 |
| 生产共享库 Story | 4 | 未对共享库创建登录 Session | 未对共享库执行带 Session 浏览器验证 | author/workspace orphan=0 |
| 隔离库 Workspace | 3 | 3 | 3 | 0 |
| 隔离库 Story | 3 | 3 | 3 | 0 |

生产真实状态分布：Workspace `active=12`；Story `draft=3/published=1`、review `pending=3/confirmed=1`、type `outline=2/long=1/script=1`。

隔离验证额外创建一个没有 `platform_users(source='ink-dream')` 投影的 canonical User/Workspace/Story。数据库 count、API total 和 UI 均包含该记录，页面明确显示“未绑定计费身份”。Repository 使用 LEFT JOIN，所以 Billing projection 缺失不会删除 Dream 业务数据。

生产 12/4 是真实共享数据的只读证据；隔离 3/3 是带真实 Session 的完整 API/UI 合同证据，二者没有混用或伪称同一运行结果。

## 4. 实现变更

### Resource、API 与缓存

- 浏览器与 Refine 统一使用 canonical `story-workspaces` / `story-stories`；移除重复 `stories` Resource 注册。
- API 边界把 legacy `stories` 归一化为 `story-stories`，兼容旧调用但不再生成第二套浏览器 cache key。
- 关系导航、写操作完成后的 Workspace/Story/User list 与 detail query 统一失效。

### Repository

- 直接查询 Dream canonical `users`、`story_workspace_workspaces`、`story_workspace_stories`。
- Workspace/Story 主记录保留为查询主体；User、Workspace 和 Billing projection 使用 LEFT JOIN，并返回 `relation_health` 与 `billing_identity_bound`。
- User bigint ID 显式字符串化；Workspace/Story text ID 保持 string；时间字段按 ISO JSON 序列化，settings 仍为 JSONB object。
- 列表/详情 payload 不返回 Story 正文或审核备注，只返回安全长度摘要。
- Workspace/Story 的 data 与 total 复用相同 FROM、WHERE 和参数合同；补齐白名单排序、状态、关系与 `updated_at` 范围筛选。

### 页面与状态

- Workspace 展示名称、可复制 ID、真实用户/ID、状态、计费映射、Story 数、创建/更新时间；Story 展示标题、可复制 ID、真实 Workspace、作者、类型、审核/业务状态、更新时间。
- 关系筛选改为可搜索的 canonical User/Workspace 下拉；更新时间支持 `gte/lte` 服务端范围。
- URL 成为筛选真值；应用、清除、前进/后退和 reload 同步，清除后残留参数不会复活。
- Loading 使用 skeleton；真实零行、筛选零行、400、401、403、404、409、500、503、关系不一致分别渲染，错误时不再显示虚假的“0 条记录”。
- 详情 Drawer 只展示安全字段与结构摘要，未开放 Story 正文写入；已有 RBAC、Zod、事务与 Audit 写边界不变。

## 5. 文档交付

- 主 PRD：`docs/prd/ink-memory-admin-prd-v3.md`（v3.4，Story 数据运营章节）
- 交互设计：`docs/design/story-workspace-data-visibility-fix-interaction-design.md`
- 根因审计：`docs/verification/story-workspace-data-visibility-audit.md`
- Prompt Architect 工作日志：`docs/verification/ink-memory-admin-correction-worklog.md`

本修复不涉及 schema 变化，因此没有新增 Drizzle migration。工作树中已有的 `0026` migration 属于其他并行任务，本修复未创建、修改或执行它到共享数据库；它仅随仓库全部迁移一起应用到 disposable 测试库。

## 6. 验证结果

| 命令/验证 | 结果 |
|---|---|
| `pnpm env:check` | 通过 |
| `pnpm exec tsc --noEmit` | 通过 |
| `pnpm lint` | 通过 |
| `pnpm test:run` | 67/67 files，328/328 tests 通过 |
| `pnpm build --webpack` | 临时副本 production build 通过；TypeScript、静态页和 route collection 完成 |
| focused Playwright | 1/1 通过，Chromium，单 worker，44.3 秒（最终覆盖轮） |
| SQL 关系复核 | 生产 12/4 且 orphan=0；隔离 3/3 且 relation error=0 |
| `git diff --check` | 通过 |

focused Playwright 覆盖：无 Session 页面跳转登录、API 401、RBAC 403、非法筛选 400、DB count=API total、缺 Billing identity 仍显示、Workspace→Story 与 User→Workspace→Story、状态/文本/日期/排序/分页、URL 清筛/reload、真实空数据/筛选空数据、404 关联缺失、409 关系冲突、500/503、受控确认写与 cache、Storage/Provider/Gateway/Billing smoke、PWA 已移除路由 404。

视口：1440×1000、390×844；两个视口均断言 `documentElement.scrollWidth - clientWidth <= 1`。最终目视复核截图：

- `test-results/story-data-visibility-final/story-data-desktop-1440x1000.png`
- `test-results/story-data-visibility-final/story-data-mobile-390x844.png`
- `test-results/story-data-visibility-final/story-workspaces-desktop-1440x1000.png`
- `test-results/story-data-visibility-final/story-workspaces-mobile-390x844.png`
- `test-results/story-data-visibility-final/story-filter-empty-desktop-1440x1000.png`
- `test-results/story-data-visibility-final/story-database-unavailable-desktop-1440x1000.png`

首次 focused E2E 的业务断言已全部执行，但本地开发辅助脚本 `react-grab` 的 unpkg CORS 被诊断监听器当成应用错误；沿用仓库既有策略在测试内 fulfill 该开发脚本后通过。临时副本默认 Turbopack build 因 `node_modules` 符号链接指向副本根目录外失败；同一代码通过 `pnpm build --webpack`。两项失败均未修改数据库或产品运行配置。

## 7. 未执行场景与风险

- 没有对共享 5433 创建 Admin Session，因此生产真实 12/4 没有做带 Session 的 200 API/UI 截图；这是“不写共享真实数据”约束下的刻意边界。生产查询与关系用只读 SQL证明，完整 authenticated 链路由相同 schema 的 disposable PostgreSQL 证明。
- 没有制造生产 orphan、断开生产数据库或触发真实 Provider 推理/支付；404/409、500/503 使用浏览器 route 注入验证 UI合同，数据库不可用的公开错误不泄露内部信息。
- 移动 390×844 首屏因筛选项较多，数据表位于纵向滚动区域；E2E 已定位真实记录并断言 document 无横向溢出。
- 当前工作树包含其他 Subscription/Product/Gateway 任务的未提交修改；本修复保留并适配它们，最终结果不宣称验证这些并行修改的全部外部业务场景。

## 8. 安全与范围确认

- 未由本任务修改 `ink-dream-memory` 业务代码、schema、迁移或运行逻辑。
- 未新增 User、Workspace 或 Story 平行业务表。
- 未引入 SQLite、JSON DB 或内存回退。
- 未修改、清理、迁移或登录写入共享数据库真实数据。
- 未删除 Storage 能力或共享 Library；Storage、Provider、Gateway、Billing 和 RBAC smoke 均通过。
- 未回显密码散列、Secret、Story 正文、Provider Key 或 Gateway Key。
- 专属 55432 PostgreSQL 容器已停止并自动删除，3012 已释放；临时副本已移动到系统废纸篓。用户已有的 3000 与 5433 listener 未被停止或替换。
