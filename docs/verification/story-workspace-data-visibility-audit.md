# Dream Workspace / Story 数据可见性审计

> 日期：2026-08-09  
> 范围：`/admin/story/workspaces`、`/admin/story/stories`  
> 方法：Admin 与 Dream 源码只读审计、当前 Admin 环境脱敏解析、共享 PostgreSQL `BEGIN READ ONLY` 元数据/关系/等价查询、未认证 HTTP 边界验证。  
> 安全：未输出密码、password hash、Secret、用户邮箱、Story 正文或 settings 内容；未写入、迁移、清理共享数据库；未修改 `ink-dream-memory`。

## 1. 结论

当前 `ink-memory` 中真实 Dream 数据已经存在，canonical 三表、字段类型和关系完整；Admin 当前 Repository 的等价 SQL 也能返回全部 **12 个 Workspace / 4 个 Story**。因此本故障不是“数据没有迁入”、不是“Admin 仍查旧平行表”、不是 `INNER JOIN platform_users` 过滤，也不是三表 orphan。

已确认的可见性根因位于页面状态与 Resource 合同层：

1. **Resource 映射分裂**：Story 页面在 `AdminResourceViews.tsx:228` 绑定兼容别名 `stories`，但正式关系控件、API 测试和 Story service 使用 `story-stories`。两者分别产生 `/api/admin/stories` 与 `/api/admin/story-stories` 请求及两套 React Query cache key。Repository 虽在 `repository.ts:241` 把两个名称指向同一 SQL，因而“SQL 能查到”仍成立，但写操作/关系控件失效 `story-stories` 时不会可靠失效页面正在订阅的 `stories` cache。这是确定的 Resource/cache 合同错误，不应继续依赖别名掩盖。
2. **残留 URL 筛选会在刷新后复活**：`AdminResourceManager.tsx:703-712` 只在首次挂载从 URL 初始化筛选；`:918` 的“清除”只清 React state，不清 URL。User → Workspace → Story 导航又在 `:642-657` 持续写入 `owner_id`、`author_id`、`name`。因此清筛后刷新/返回页面会重新应用旧筛选，形成可复现的“数据库有数据、页面仍为 0”的假空状态。
3. **错误和空数据在视觉上被压成同一个 0 记录表**：页头 `:914` 在请求失败时仍显示 `0 条记录`；表格继续渲染空 body，只有通用 `数据暂时不可用` 提示。`:927` 又用同一“暂无匹配记录”覆盖真实零行和筛选零行。401/403/400/500/503、数据源不一致均没有专用状态和恢复动作。故 Session/RBAC/数据库错误很容易被使用者理解为“真实数据未显示”。
4. **筛选和字段合同不完整**：Workspace Repository 没有选择/注册 `w.status`；Workspace UI 没有状态与更新时间范围；Story 的“标题、工作区或用户”实际只发送 `title contains`，标签与 SQL 不一致；关系筛选仍是裸 ID 文本而非 canonical User/Workspace 关系查询。该缺口不是 12/4 消失的 SQL 根因，但会持续制造假空、400 和误判。

根因分类：**Resource 映射错误 + Refine cache/刷新问题 + URL 默认/残留筛选问题 + API/RBAC/数据库错误被空状态弱化**。当前证据排除“Admin 连接错误数据库”“仍指向旧表”“platform_users JOIN 过滤”“主外键类型不兼容”“迁移关系缺失”。

## 2. 当前实际数据库

### 2.1 连接与 schema

| 项目 | 脱敏证据 |
|---|---|
| Admin 环境入口 | `.env.local` 的单一 `DATABASE_URL`；客户端 `localhost:5433/ink-memory` |
| Dream 环境入口 | `backend/.env` 的单一 `DATABASE_URL`；客户端 `127.0.0.1:5433/ink-memory` |
| 目标同一性 | `localhost` 与 `127.0.0.1` 均指向同一本机 Docker 映射；数据库名、端口和默认 schema 一致 |
| PostgreSQL 服务端 | `current_database()=ink-memory`；服务端容器地址 `172.18.0.2`、端口 `5432` |
| 当前 schema | `public` |
| `search_path` | `"$user", public`；运行角色无同名个人 schema，三表解析到 `public` |
| Pool | `app/lib/db.ts:62-79` 唯一全局 `pg.Pool`；`app/lib/story-source/db.ts:9-20` 直接复用它 |

Dream `backend/persistence/config.py:17-19,97-136` 只接受 PostgreSQL URL；`backend/database.py:127-143` 创建 PostgreSQL runtime pool。两项目没有 Server/Client 各自读取不同 Story DSN 的运行分支。

### 2.2 表、行数与状态

全部查询包在 `BEGIN READ ONLY` 中。

| 表 | 是否存在 | 行数 |
|---|---:|---:|
| `users` | 是 | 30 |
| `story_workspace_workspaces` | 是 | 12 |
| `story_workspace_stories` | 是 | 4 |

| 字段 | 实际分布 |
|---|---|
| Workspace status | `active=12` |
| Story status | `draft=3`、`published=1` |
| Story review_status | `pending=3`、`confirmed=1` |
| Story type | `outline=2`、`long=1`、`script=1` |

没有默认状态筛选；因此真实现有枚举不会被默认排除。UI 当前状态选项少了 Workspace `archived`、Story `archived`、review `rejected`，需修正以匹配数据库 check 约束。

### 2.3 类型与关系

| 关系/字段 | PostgreSQL 类型 | 结论 |
|---|---|---|
| `users.id` | `bigint` | canonical User PK |
| `workspace.owner_id` | `bigint` | 与 `users.id` 一致 |
| `story.author_id` | `bigint` | 与 `users.id` 一致 |
| Workspace/Story id | `text` | API 应稳定序列化为 string |
| `story.workspace_id` | `text` | 与 Workspace id 一致 |
| created/updated | `timestamptz` | Node/JSON 可序列化为 ISO 时间 |
| Workspace settings | `jsonb NOT NULL` | `pg` 返回 object；UI 只读详情可安全格式化 |
| Story content | `text nullable` | 列表不应返回正文；详情只能返回安全摘要 |

关系审计结果：Workspace owner orphan=0、Story author orphan=0、Story workspace orphan=0、Story author 与 Workspace owner 不一致=0。三个 FK 均实际存在并指向 canonical 三表。

审计时当前 canonical 用户缺 `platform_users(source='ink-dream')` 投影=0；即使将来存在缺映射用户，Story Repository 也不得以内连接投影表过滤。修复前 Workspace/Story SQL 没有引用 `platform_users`；修复后仅用 `LEFT JOIN` 计算 `billing_identity_bound`，不参与过滤。

## 3. 查询链路

| 链路节点 | 实际值/位置 | 证据与判断 |
|---|---|---|
| Page | `story/workspaces/page.tsx:5`、`story/stories/page.tsx:5` | 分别渲染 `StoryResourceView kind=workspaces/stories` |
| View | `AdminResourceViews.tsx:223-228` | Workspace=`story-workspaces`；Story 错用兼容别名=`stories` |
| List hook | `AdminResourceManager.tsx:726-731` | `useList({resource,pageSize,sorters,filters})` |
| Data Provider | `providers.ts:159-183` | resource 原样拼成 `/api/admin/${resource}`，返回 `{data,total:meta.total}` |
| API Route | `app/api/admin/[resource]/route.ts:20-29` | 进入 `handleAdminResourceList`；未 canonicalize Story alias |
| Auth/RBAC | `admin/resources.ts:601-629` | Server 端 `requireAdminRequest(story.read)`；错误通过统一 AdminError 返回 |
| Repository | `story-source/repository.ts:51-110,447-458` | 直接查询真实 Workspace/Story/users；两个 Story resource 共用 config |
| Pool | `story-source/db.ts:9-20` → `db.ts:62-79` | 与 Admin 控制面同一 Pool/DB |

Repository 等价 SQL 在当前数据库的结果：Workspace count=12、首屏返回=12；Story count=4、首屏返回=4。Data 与 count 复用同一 `FROM`、同一 `whereSql`，count 参数只移除 LIMIT/OFFSET，因此当前无筛选条件下 total 与数据条件一致。

生产样式 HTTP 边界用当前 `.env.local` 启动自有 dev server 后验证：两个保护页面均 `307 → /admin/login`；`/api/admin/story-workspaces`、`/api/admin/stories`、`/api/admin/story-stories` 均返回 401 `ADMIN_AUTH_REQUIRED`。没有为读取共享数据而创建 Session，因为登录会写 session/last-login。带真实 Session 的 200/total/UI 对照将在明确隔离 PostgreSQL lane 中验证并回填本报告。

## 4. 分项判断

| 候选根因 | 判断 | 证据 |
|---|---|---|
| Admin 连接错误数据库 | 排除（当前环境） | Admin/Dream 均为本机 5433/`ink-memory`，服务端 current_database 一致 |
| 数据存在但查询旧表 | 排除 | Repository 直接使用 canonical 三表；等价 SQL 12/4 |
| Resource 映射错误 | **确认** | Story 页面=`stories`；正式链路=`story-stories`；形成双 endpoint/cache namespace |
| JOIN 过滤真实数据 | 当前数据排除；设计风险已加回归守护 | 主记录以 Dream canonical 表为主体；关系与 `platform_users` 均为 LEFT JOIN；orphans=0 |
| 默认筛选/状态不兼容 | **确认交互缺陷** | URL 筛选刷新复活；状态选项缺归档/拒绝；无真正默认状态过滤 |
| 字段/主外键类型不兼容 | 排除主链；需统一序列化 | bigint FK类型一致，text FK类型一致；SQL显式 `::text` 输出用户 ID |
| API 返回合同错误 | 当前代码排除 | API `{data,meta}`；Data Provider映射为 Refine `{data,total}`；隔离 HTTP待复验 |
| Refine cache/刷新 | **确认** | `stories`/`story-stories` 双 cache；清筛不改 URL；无跨 alias invalidation |
| RBAC/Session/500 被空状态掩盖 | **确认 UI 缺陷** | 失败时页头仍显示0，错误未按 status 分类，空表框架持续存在 |
| 迁移数据关系缺失 | 排除 | 三类 orphan与 author-owner mismatch均0 |

## 5. 修复边界

1. 页面、关系控件、Data Provider 和写后失效统一 canonical `story-stories`；`stories` 仅保留兼容 API 时必须 canonicalize 到同一 cache key，不能继续作为页面 Resource。
2. Repository 继续以 canonical `users` 为主体；Workspace 使用 `LEFT JOIN users` 并暴露 relation health，可让异常关系显示为诊断而不是静默丢行。Story 同理保留 Story 主记录，关系缺失返回明确 health/404/409 语义。
3. 新增 Workspace status、关系、时间筛选；Story 新增 Workspace/User relation、完整枚举和更新时间范围；关系搜索走真实 Resource。
4. URL 是筛选真值：应用/清除筛选都更新 URL；忽略未知旧参数或以 400 诊断并提供“一键重置”，不得刷新复活。
5. 把系统零行、筛选零行、400、401、403、404、409、500、503、关系/数据源不一致分开渲染；失败时不显示“0 条记录”结论。
6. 列表不返回 Story `content`；详情只返回长度/结构等安全摘要，不回显正文。

## 6. 审计期间的失败尝试

- 尝试用 `pnpm exec tsx` 直接调用真实 Repository；仓库未安装 `tsx`，命令 fail-closed，未修改文件或数据库。随后改用 `BEGIN READ ONLY` 的 Repository 等价 SQL取得相同查询证据。
- 首次 zsh HTTP 循环误用只读变量名 `status`；未产生请求副作用，改用 `http_code` 后完成 307/401 验证。

## 7. 最终验证回填

2026-08-09 在专属 Docker PostgreSQL `127.0.0.1:55432/ink-memory` 上从零应用 0000–0026 共 27 个迁移并加载专用 Story/control-plane fixture；所有写入仅发生在该 disposable 实例。共享 5433 始终使用 `BEGIN READ ONLY`，最终复核仍为 User=30、Workspace=12、Story=4，三类 orphan=0。

隔离 lane 的最终对照：数据库 Workspace=3、Story=3；带真实 Admin Session 的 `/api/admin/story-workspaces` 和 canonical `/api/admin/story-stories` 分别返回 `meta.total=3`；1440×1000 页面分别显示 `3 条记录`。额外插入一个没有 `platform_users` 投影的 canonical User/Workspace/Story，API payload 返回 `billing_identity_bound=false`，两个页面显示“未绑定计费身份”，记录没有消失。兼容 `/api/admin/stories` 仍可读取，但浏览器请求与 Refine cache 只使用 `story-stories`。

focused Playwright 1/1 通过，覆盖 401、页面登录跳转、RBAC 403、400 非法筛选、状态/文本/日期/排序/分页、User→Workspace→Story 和 Workspace→Story 导航、清筛后 URL/刷新恢复、系统零行与筛选零行分离、404 关联缺失、409 关系冲突、500/503 独立诊断、受控确认写入后的 cache 刷新、Storage/Provider/Gateway/Billing smoke，以及已移除 PWA 路由 404。1440×1000 与 390×844 均断言 document overflow≤1px；截图已目视复核。

完整验证结果见 `docs/verification/story-workspace-data-visibility-fix-verification.md`。因此第 7 节原待验证项均已在隔离 lane 完成；没有为了验证而登录、写入或迁移共享数据库。
