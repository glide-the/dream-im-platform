# Story Artifact 与 PostgreSQL Story 索引同步审计

> 审计日期：2026-08-10
> 范围：`ink-dream-memory`、`ink-admin-memory`、本机 PostgreSQL `5433/ink-memory`
> 阶段性质：只读审计。除本报告和 Prompt Architect 工作记录外，未修改代码、Schema、Migration、Artifact 或共享数据库。

> 后续架构决策（2026-08-10）：本报告第 11、14、15 节保留的是审计当时的跨服务 Gateway 建议。用户随后明确选择 Dream/Admin 共同挂载同一 Artifact Root 的首版方案；该建议已由[共享根目录架构设计](../architecture/story-artifact-index-sync-architecture.md)取代。现行实现是 Dream read-write、Admin OS/runtime read-only，Admin 服务端按数据库资源身份安全读取共享挂载；跨服务 Artifact API、服务 JWT 和远程 Gateway 均为 Deferred。审计事实、根因和文件侧 dry-run 数量不因此改变。

## 1. 处理判断

结论是确定的：当前问题属于 **Dream Episode Artifact 到 `story_workspace_stories` 的 materialization 缔结缺失**，不是 Admin 查询、分页、筛选或数据库分流错误。

- Dream execution 读取 run 绑定的线程文件系统 Artifact；`script.md` 可存在且被安全投影到页面。
- Admin `/admin/story/stories` 只读取同一 PostgreSQL 中的 canonical `story_workspace_stories`。
- Claude Agent 普通 Story JSON bundle 会调用 `store_agent_story_output`；带 `story_workspace_dream_context` 的 Dream turn 在进入解析前直接返回 `None`，因此不会创建 Story 行。
- Episode 文件投影、Episode completion、binding 修复和 workflow action 均未调用新的 Story metadata projector；全仓库不存在 Artifact → canonical Story 的自动 reconcile、backfill 或 materialization service。

目标权威边界应固定为：

```text
线程文件系统 / 未来对象存储 Artifact
= 剧本正文、分集大纲、Storyboard、审阅报告的内容真源

PostgreSQL story_workspace_stories
= Workspace/User/Project/Run 关系、稳定 Story identity、revision、状态、摘要和同步诊断索引
```

推荐采用 **同步触发 + 异步 reconcile 的组合方案**：每次 canonical Artifact completion 后立即幂等 upsert；失败时保留可恢复状态，由启动恢复、定时扫描和显式 dry-run/reconcile 补偿。文件系统与 PostgreSQL 不能共享原子事务，单纯同步写或单纯定时扫描都不足以满足崩溃恢复和及时可见性。

## 2. 审计边界与证据等级

| 证据 | 本轮结果 | 等级 |
|---|---|---|
| 两仓源码、配置、Git 状态 | 已读取 | 当前 |
| Artifact 文件元数据与现有安全 reader 投影 | 已读取；未输出正文 | 当前 |
| PostgreSQL 实时只读 SQL | 5433 有 Docker 端口监听，但 `PGCONNECT_TIMEOUT=3` 握手超时 | blocked |
| 上一轮已落盘只读 SQL/文件证据 | 指定用户 canonical Story/Character/Scene 为 0；4 个 run 中有 2 套非空 Episode Artifact | 历史、不可冒充当前快照 |

因此，本报告对代码断点、配置指向和文件侧数量做确定性判断；对“当前数据库总 Story 数、当前 DB/文件逐行 mismatch 数”明确标为 unknown。上一轮成功证据见 `docs/verification/ink-memory-admin-correction-worklog.md:2417-2424`。

## 3. Dream execution 现有链路

### 3.1 前端 hook 与页面

1. `storyWorkspaceEpisodeArtifactsEndpoint()` 只接受 `runId`，生成 `/api/story-workspace/workflow-runs/{runId}/episode-artifacts`，不接受路径：`frontend/src/hooks/story-workspace/useStoryWorkspaceEpisodeArtifacts.ts:99-101`。
2. `useStoryWorkspaceEpisodeArtifacts()` 使用 `apiUrl()`、Session/Bearer、`If-None-Match`、AbortController、run-local generation 和轮询读取 authoritative surface：同文件 `:720-766`；fetch 的 ETag/304 合同见 `:441-460`。
3. execution 页面先读取 Dream files 访问事实，只有 `storyWorkspaceCanAccessExecution()` 成立才启用 Episode hook：`frontend/src/pages/story-workspace/StoryWorkspaceExecutionPage.tsx:523-551`。
4. 页面把 Workflow Run 只当标题/完成提示的可选上下文；代码注释明确“Dream files own the access fact”：同文件 `:535-539`。因此 run `completed/queued` 不是 Artifact 可用性的内容真源。

### 3.2 API Route 与 application gateway

1. FastAPI Route `GET /workflow-runs/{workflow_run_id}/episode-artifacts` 从当前用户派生 actor，只向 gateway 传 `runId + actor`，并支持 ETag/304；没有浏览器路径参数：`backend/routers/story_workspace.py:1405-1435`。
2. Route 使用 `StoryWorkflowGateway` Protocol；`get_story_workflow_gateway()` 注入 `StoryWorkflowApplicationGateway`：同文件 `:172-210,308-311`。
3. application gateway 把读取送入 worker thread：`backend/services/deck/story_workflow_gateway.py:821-833`。
4. `_authorized_episode_row()` 先验证 actor、Workspace、Run、Thread、Deck、binding、runtime snapshot/lock 和 source metadata；任一关系不成立都返回 404/403：同文件 `:1582-1615`。
5. `story_workspace_episode_identity` 只能来自已验证 source message metadata，并严格绑定 run、opaque Episode UID、story slug、Episode code：同文件 `:1617-1635`；首次绑定使用 compare-and-swap 更新可信 source message metadata：`backend/libs/claude_agent_kit/server/story_workspace_tool.py:436-509`。
6. gateway 用 server-derived thread ID 解析真实线程目录，再校验 `project.yaml`、run-scoped Episode binding 和 Artifact surface：`backend/services/deck/story_workflow_gateway.py:1637-1685`。

### 3.3 文件读取、安全边界与 revision

`StoryWorkspaceEpisodeArtifactService` 已有可复用的安全读取基础，但目前服务对象是 Dream browser surface，不是 Story index projector。

- Workspace root 必须为真实目录，记录 device/inode；每次读取重新 pin identity：`backend/services/story_workspace/episode_artifact_service.py:264-337`。
- 所有目录与文件使用 `openat`/`dir_fd + O_NOFOLLOW`；拒绝 `.`、`..`、斜杠、反斜杠、symlink、非普通文件和 inode 变化：同文件 `:339-459`。
- 读取前后都限制字节数；Markdown 1 MiB、YAML 2 MiB、auxiliary collection 8 MiB/128 files：`episode_artifact_adapter.py:37-38`、`episode_auxiliary_artifact_adapter.py:50-53`。
- allowlist 根文件为 `episode-outline.md`、`script.md`、`storyboard.yaml`、`review-report.md`，目录仅允许 prompts 的 YAML 与 renders 的 Markdown/JSON：`episode_artifact_service.py:668-816`。
- 每个文件的 `content_revision` 是内容 bytes 的 SHA-256：同文件 `:452-458`。
- `manifest_revision` 是 Artifact availability/revision 与解析后 association payload 的 canonical JSON SHA-256，不是磁盘 manifest 文件：同文件 `:840-859,992-1045`。
- response `etag` 最后还会混入 workflow/action projection：`story_workflow_gateway.py:1705-1722`。Story 索引必须存 `surface.manifest_revision` 与独立 `script_revision`，不能把 response ETag 当内容 revision。

### 3.4 Project manifest 与 Episode manifest 的真实来源

- Artifact Workspace Root 配置由 `AGENT_CWD` 决定；本机配置指向仓库内 `backend/data/agent-workspace`。resolver 的回退才是系统临时目录：`backend/libs/claude_agent_kit/server/workspace.py:353-368`。
- Project identity 的真源是 `stories/<story_slug>/project.yaml` 中唯一 `project_id`，且必须与目录 slug 一致：`backend/services/story_workspace/episode_binding_service.py:369-391`。
- Episode identity manifest 不在 Episode 目录；它是 run-scoped `.dream/runtime/runs/<runId>/episode.json`：v1 绑定一个 EP01，v2 registry 拥有连续 EP01..EP99、active Episode 和 revision：`backend/story_workspace/contracts.py:1422-1489`。
- `script.md` 等内容由 sandboxed Dream Agent 在 thread workspace 内写入；binding/completion tool 只记录受控 identity 与 completion fact。completion 保存的 `manifest_revision` 是当时输入快照证据，不取代当前文件 revision：`backend/story_workspace/contracts.py:895-930`。

## 4. Admin Story 现有链路

1. `/admin/story/stories` 页面渲染 `StoryResourceView kind="stories"`：`app/(admin)/admin/(workspace)/story/stories/page.tsx:1-5`。
2. `StoryResourceView` 配置 resource `story-stories`、列表字段、筛选与 Drawer；当前列表不返回正文，只显示 canonical row：`app/components/admin/AdminResourceViews.tsx:235-244`。
3. `AdminResourceManager` 调用 Refine `useList`，携带 page/pageSize/sort/filter：`app/components/admin/AdminResourceManager.tsx:767-847`。
4. Refine data provider 把 resource 映射为 `/api/admin/story-stories`，并读取 API `meta.total`：`app/components/admin/providers.ts:92-98,168-192`。
5. 动态 Route Handler 只做 resource 编排，GET 进入 `handleAdminResourceList()`：`app/api/admin/[resource]/route.ts:12-31`。
6. `handleAdminResourceList()` 对 Story source 重复验证 server Session + `story.read` permission，然后调用 repository，响应 `no-store`：`app/lib/admin/resources.ts:601-630`。
7. repository 的 `story-stories` 配置直接 `FROM story_workspace_stories AS s`，只 LEFT JOIN canonical `users`、Workspace 和 billing projection；正文只投影 `char_length(content)`：`app/lib/story-source/repository.ts:77-129`。
8. list 和 total 使用同一 FROM/WHERE，分别执行 paged SELECT 与 `COUNT(*)`：同文件 `:316-345,468-479`。若表为 0，Admin total 必然为 0；没有另一个文件扫描或缓存分支。
9. Story repository 与 Admin control plane 共享 `getPool()`、单一 `DATABASE_URL`、同一 `ink-memory`，没有第二 Story connection 或 fallback：`app/lib/story-source/db.ts:1-21`、`app/lib/db.ts:41-79`。

## 5. 两应用数据库与 frontend base URL

### 5.1 数据库

- Admin `.env.local` 与 Dream `backend/.env` 都配置本机 5433、数据库名 `ink-memory`。
- Admin 强制 PostgreSQL 且 database name 必须为 `ink-memory`：`app/lib/db.ts:7-17,41-52`。
- Dream `database.get_db()` 使用 process-wide `PostgresPool.from_env()`；pool 只读取 `DATABASE_URL`：`backend/database.py:127-143,207+`、`backend/persistence/postgres.py:75-87,182-205`。
- 本轮实时只读 SQL 未成功：Docker 仍监听 5433，但 PostgreSQL connection handshake timeout。因此不能把当前 DB Story 总数、冲突数或 orphan 数写成已验证数值。

### 5.2 Dream frontend

- `apiUrl()` 优先 runtime `apiBaseUrl`，其次 `VITE_API_BASE_URL`，为空时使用 same-origin：`frontend/src/lib/apiBase.ts:19-47`。
- 本机未配置显式 Vite API base；Vite dev `/api` 代理到 `http://localhost:8765`：`frontend/vite.config.ts:64-69,111-118`。
- 当前只发现用户原有 Vite 5173 listener；8765 Dream backend 与 3000 Admin 没有 listener。本轮未启动或停止这些服务。

## 6. 身份关系

| 身份 | 权威来源 | 关系 |
|---|---|---|
| User | PostgreSQL `users.id` | current Session actor；Workspace owner；Story author |
| Workspace | `story_workspace_workspaces.id` | `owner_id = users.id`；Workflow Run 与 Story 都应引用它 |
| Workflow Run | `workflow_runs.id` | 绑定 Workspace、created_by、source thread、Deck/binding/runtime snapshot |
| Thread | `chat_thread.id` | 属于 User；目录是 `AGENT_CWD/<threadId>`，但路径不进入浏览器合同 |
| Project / Story stable identity | `project.yaml project_id`，当前等于安全 slug | 应在 Workspace scope 内唯一；一个 Project 对应一行 canonical Story |
| Episode | run-scoped `episode.json` 中 opaque UID + EP code | 多 Episode 同属 Project，不创建多个 Story 行 |
| Artifact revision | 单文件内容 SHA-256 | script/outline/storyboard/review 独立 revision |
| Manifest revision | service 对 availability、revisions、associations 的 canonical hash | Project 当前 Artifact 集合版本，不等同 response ETag |

稳定 upsert key 应是 `(workspace_id, artifact_source_type, source_project_id)`；数据库 Story `id` 应由该 identity 确定性派生或首次创建后永久复用。不能以 run ID、thread ID、Episode UID 或随机 UUID 作为重复同步时的新 Story identity。`source_run_id`/thread internal reference 只表示当前 materialized provenance，可随新 revision 更新。

## 7. Story 写入点与缺失同步

### 7.1 Dream 生产写入

- `store_agent_story_output()` 以 `author_id + agent_session_id + title` 查找，缺失时随机创建 Story，存在时更新，并把完整 `payload.content` 写入 PostgreSQL：`backend/services/story_workspace/agent_integration.py:99-182`。
- Claude Agent 普通 turn 的完成路径调用该函数：`backend/claude_agent/service.py:1541-1547,1561-1595`。
- `/api/story-workspace/internal/agent-output` 也调用同一函数：`backend/routers/story_workspace.py:1253-1279`。
- Dream Story PATCH、confirm/reject/archive 会更新现有 canonical row，但不会从 Artifact 创建索引：`backend/routers/story_workspace.py:576-724,911-980,1139+`。

### 7.2 Dream context 为何跳过

`_store_story_workspace_output()` 在解析 assistant full text 之前检查 `story_workspace_dream_context`；非空则无条件 `return None`：`backend/claude_agent/service.py:1561-1573`。这是有意避免把 Dream 的自由文本/文件工作流误当成旧 `StoryWorkspaceAgentStoryPayload` JSON bundle，也避免复制完整 Episode content 到旧关系模型。但该分支没有替代的 metadata materializer，所以形成当前缺口。

正确改法不是恢复旧 JSON 正文复制，而是：继续跳过 `store_agent_story_output`，改为在 Artifact completion 后调用新的 `ArtifactStoryMetadataMaterializer`。

### 7.3 Admin 当前写入

Admin 当前仍允许对白名单 Story 字段 `title/description/type` PATCH，并允许 confirm/reject/archive：`app/lib/story-source/mutations.ts:62-81,155-209,321-389`。这与目标“Admin 不编辑真实文件关系、Dream 是索引唯一业务写入方”尚未完全一致。

设计阶段必须收敛为：

- 禁止 Admin 通用 Story metadata PATCH；标题/project identity/revision/文件状态由 Dream projector 写。
- 保留现有受控审核命令，但把它定义为 Admin 发给 Dream 领域命令，或在双方确认的审核状态边界内执行；不得覆盖 Artifact provenance/revision。
- Admin create/delete 已正确返回 405：`app/lib/story-source/mutations.ts:275-309`。

### 7.4 其他同步/导入

- Admin 有一次性历史三表 import CLI，会 INSERT `story_workspace_stories`，但它是旧 SQLite baseline importer，不是运行时 Artifact reconcile：`scripts/import-ink-dream-story-source.mjs:68-119`。
- 对生产代码的 `reconcile|materialize|backfill|sync` 与 Story SQL 穷举搜索没有发现 Artifact → Story projector。现有同名 materialization/reconcile 全属于 Deck/runtime plugin 或 Gateway settlement，不处理 Story Artifact。

## 8. Workflow Run 与 Artifact 状态一致性

两者目前不是同一状态机，也不能互相推导：

- Workflow Run 状态来自 PostgreSQL run lifecycle。
- Artifact availability/revision 来自每次安全文件读取。
- execution 页面即使 run read 失败也继续以 Dream files/Artifact 为访问事实。
- 上一轮已验证存在 `queued` run 但已有非空 `script.md`；所以“run queued”不等于“文件未生成”，“文件存在”也不等于“Story 已索引”。

目标状态必须返回两个独立事实：`artifact_status` 与 `index_status`。页面禁止将 file success 显示成 index success。

## 9. 当前 Artifact 元数据盘点

盘点使用 `-P`/不跟随 symlink、深度受限 find，以及复用现有 `O_NOFOLLOW + inode` reader；只输出计数、大小和 revision 数，不输出文件正文、run/thread/project ID 或绝对路径。

| 指标 | 当前值 | 解释 |
|---|---:|---|
| 线程目录 | 1,196 | Workspace root 一级真实目录；多数不是 Story run |
| `project.yaml` | 7 | 5 个 identity 合法，2 个合同无效 |
| 无 `project.yaml` 的 project 目录 | 5 | 不可作为 canonical Project |
| 可唯一发现 canonical Project | 5 | 5 个线程各 1 个合法 Project |
| Episode 目录 | 39 | 目录存在不等于 Artifact 完整 |
| 非空 `script.md` | 3 | 最大 12,661 bytes，均低于 1 MiB |
| `episode-outline.md` | 3 | 文件存在数 |
| `storyboard.yaml` | 9 | 文件存在数；部分没有 script |
| `review-report.md` | 3 | 文件存在数 |
| run-scoped `episode.json` | 3 | 均为合法 v1/EP01 binding；暂无 v2 registry |
| 安全 bound surface | 3 | 3/3 可由现有 service 读取 |
| 可用 active script | 3 | 3/3 available，3 个不同 script revision |
| manifest revision | 3 | 3 个不同 current manifest revision |
| canonical 位置 symlink | 0 | Project manifest 与 Episode allowlist 位置未发现 symlink |

严格历史 dry-run 的候选分层应报告：5 个 discoverable Project、39 个 Episode 目录、3 个 run-bound 且 script 可用的可索引 Story、2 个无效 Project manifest、5 个缺 manifest 的 project 目录。不能把 39 个目录冒充 39 个有效 Episode，也不能自动索引未绑定/无脚本的目录。

## 10. PostgreSQL 差异数量

| 差异 | 本轮实时值 | 结论 |
|---|---:|---|
| DB Story 总数 | unknown | 5433 handshake timeout |
| 文件存在但无索引 | unknown current | 文件侧有 3 个严格可索引候选；需 DB 可达后按 Workspace+Project key join |
| 索引存在但文件缺失 | unknown | 需读取 Story provenance 字段；当前 schema 还没有该字段 |
| revision mismatch | unknown | 当前 Story schema 没有 artifact/script revision，无法比较 |
| 一对多/重复 stable identity | unknown | 当前 schema 没有 project identity unique key |
| 缺 Workspace/User/Run 关系 | unknown current | 文件侧无法在 DB 不可达时安全关联 |

上一轮针对指定用户的成功只读证据是：canonical Story/Character/Scene 均为 0，而 4 个 thread workspace 中有 2 套非空 EP01 Artifact。它直接证明至少存在“文件有、索引无”，但不代表本轮全库当前数量。

## 11. `content` 字段处理判断

现有 `content` 来自旧 JSON Story bundle；文件型 Dream projector 不应继续填入完整 `script.md`。

- 保留列以兼容历史行和旧 API，不在本轮破坏性清空。
- 新 Artifact-sourced Story 写 `content = NULL`，或保持既有历史值但绝不随文件 revision 更新正文副本。
- Admin 列表/详情继续只返回 `content_length` 或兼容标志，不返回正文。
- 所有新只读预览通过 Dream Artifact Gateway，按 resource ID + Episode ID + allowlist artifact + revision 读取。

## 12. Schema migration 判断

**需要 migration。** 当前 `app/lib/db/schema.ts:140-224` 只有旧 Story 字段，没有 Project identity、source Run、Artifact revision、同步状态或诊断；仅靠 `agent_session_id` 无法幂等表示 Workspace Project，也无法判断 missing/stale/failed。

最小扩展建议（最终命名在架构文档固定）：

- `artifact_source_type`
- `source_run_id`
- `source_thread_ref`（内部字段，禁止 public API 返回）
- `source_project_id`
- `source_story_slug`
- `episode_count`
- `artifact_manifest_revision`
- `script_revision`
- `artifact_status`：`syncing/indexed/stale/missing/failed`
- `artifact_available`
- `script_size_bytes`
- `last_indexed_at`
- `last_sync_error_code`（安全码，无 stack/path）
- `reconcile_version`

必须增加 `(workspace_id, artifact_source_type, source_project_id)` 唯一约束与 revision/status check；如果 `source_run_id` 在 canonical schema 中可表达，应建立受控 FK。禁止保存 absolute path、thread root、异常 stack 或完整正文。

Schema 仍以 Admin `app/lib/db/schema.ts` 为唯一 Drizzle 来源，生成并提交 PostgreSQL migration；Dream repository 只消费该合同，不创建第二张 Story 表。

## 13. 历史回填判断

需要一次性历史处理，但必须分两步：

1. 默认 dry-run，只扫描合法 Workspace/Run/Thread/Project/Episode 关系并输出无 PII count receipt。
2. 用户明确批准后才 apply；本任务当前不得对共享真实数据执行回填。

本轮文件侧 dry-run 基线为：5 discoverable Project、39 Episode 目录、3 strict indexable Story、2 invalid manifest、5 missing manifest project directory。DB-side existing/new/update/conflict/orphan 数仍待 PostgreSQL 恢复可达后在只读事务中补齐。

## 14. 仓库职责

| 能力 | Dream | Admin |
|---|---|---|
| Artifact 写入/解析 | 唯一实现与唯一写入方 | 禁止 |
| Story metadata index upsert | 唯一业务写入方 | 禁止通用 PATCH/create/delete |
| 同步触发/状态机/reconcile | 实现 | 展示诊断；可发受控 retry 命令 |
| Story 搜索/分页 | 可读 | PostgreSQL 只读运营入口 |
| Artifact 内容读取 | 受控本地/对象存储 reader | service identity 调 Dream internal API |
| 审核 | 按既有领域边界协作 | 保留受控审核命令，不改 provenance/revision |
| 路径 | server-internal | API/UI 永不接收或返回 |
| Schema/Migration | 消费 canonical Story 合同 | `app/lib/db/schema.ts` 唯一 Drizzle 来源并生成 migration |

## 15. 后续实现输入

1. 在 Dream 建立 provider-neutral `ArtifactGateway`：`authorize(resource IDs) → stat/list/readSlice`，本地 FS 与未来 S3 共享 resource ID、revision、ETag、allowlist、byte range 合同。
2. 建立 `ArtifactStoryMetadataMaterializer`，输入必须是 server-derived actor/workspace/run/thread/project/registry，不接受路径。
3. 完成顺序：安全文件落盘 → 计算 file/manifest revisions → metadata parse → 幂等 upsert → 写 sync result → 独立返回 file/index status。
4. 在 Episode completion tool 成功记录后触发同步；在进程启动/定时任务/显式 CLI 做 reconcile。
5. 文件成功、DB 失败时把待同步事实保存在文件侧 run-scoped sync receipt/intent；不能只写 DB `failed`，因为 DB 正是失败面。
6. Admin 新建 server-only Artifact client；浏览器只传 Story/Episode/artifact enum/revision/cursor，不传路径。
7. Admin DB list/detail 与 Artifact preview 分别加载；Dream 503 时仍显示 DB index。

## 16. 本阶段未执行事项

- 未修改两个仓库的业务代码、Schema 或 Migration。
- 未执行 PostgreSQL migration、INSERT、UPDATE、DELETE、reconcile 或 backfill。
- 未启动/停止共享 PostgreSQL、Dream backend、Admin 或用户原有 Vite listener。
- 未读取或输出剧本正文、绝对线程目录、Cookie、JWT、Gateway Key、Provider Secret、密码散列或 DSN 凭据。
- 未覆盖 Dream 仓库既有未跟踪 `.claude/worktrees/`。
