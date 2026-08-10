# Story Artifact 与 PostgreSQL Story 索引架构

> 状态：Accepted for implementation（共享只读文件系统方案）  
> 更新：2026-08-10  
> 审计证据：[`story-artifact-index-sync-audit.md`](../verification/story-artifact-index-sync-audit.md)  
> Admin 交互：[`story-artifact-admin-interaction-design.md`](../design/story-artifact-admin-interaction-design.md)

## 1. 决策

当前问题是 Dream 已写入 Episode Artifact、却没有把 Project 物化为 `story_workspace_stories` 索引行；不是 Admin 列表 SQL 错误。

采用同机/同集群共享挂载的简单架构：

```text
Dream（读写挂载） ──写──> Artifact Workspace Root <──只读挂载── Admin
        │                                               │
        └──幂等 upsert──> story_workspace_stories <──查询┘
```

- 文件系统是 `script.md`、`episode-outline.md`、`storyboard.yaml`、`review-report.md` 的内容真源。
- `story_workspace_stories` 是唯一 Story 元数据索引；不新增平行 Story 表，不复制正文。
- Dream 是 Artifact 与 Story 索引的唯一业务写入方。
- Admin 列表只查 PostgreSQL；详情由 Admin 服务端以数据库中的内部资源引用，在同一只读挂载中受控读取。
- 浏览器只传 Story ID、Episode ID、Artifact kind、offset/limit 和 expected revision；不接触路径。

此前提出的 Admin → Dream 内部 Artifact API、服务 JWT、远程 Gateway、S3 receipt 方案本期 **Deferred**。未来文件系统改为对象存储时，可在 Reader 接口后替换实现，不改变浏览器合同。

## 2. 身份与路径

一条 Dream Artifact Story 使用以下稳定身份：

```text
Workspace + Project = one canonical Story
unique(workspace_id, artifact_source_type, source_project_id)
artifact_source_type = dream_episode
```

Dream 写入以下内部引用：`source_thread_ref`、`source_run_id`、`source_project_id`。Admin 不接受客户端提供这些值，也不在公开 API 返回 `source_thread_ref`。

服务端推导布局：

```text
<ARTIFACT_WORKSPACE_ROOT>/<source_thread_ref>/
  .dream/runtime/runs/<source_run_id>/episode.json
  stories/<source_project_id>/project.yaml
  stories/<source_project_id>/episodes/<EPxx>/
    script.md
    episode-outline.md
    storyboard.yaml
    review-report.md
```

`episode.json` 是 Run → Project/Episode 的绑定凭据；`project.yaml.project_id` 必须与 `source_project_id` 及目录名一致。Admin 只允许 `EP01` 这类注册表中已绑定的 Episode，不扫描任意目录。

## 3. PostgreSQL 索引合同

只扩展 `story_workspace_stories`：

| 字段 | 类型 | 含义 | 公开 |
|---|---|---|---|
| `artifact_source_type` | text nullable | `dream_episode` | 是 |
| `source_run_id` | text nullable | 当前来源 Run | 是 |
| `source_thread_ref` | text nullable | 内部线程引用 | **否** |
| `source_project_id` | text nullable | Project 稳定身份 | 是 |
| `episode_count` | integer nullable | 已绑定 Episode 数 | 是 |
| `artifact_manifest_revision` | text nullable | 当前 manifest revision | 是 |
| `script_revision` | text nullable | 最新成功物化 Episode 的 script revision | 是 |
| `artifact_sync_status` | text nullable | syncing/indexed/stale/missing/failed | 是 |
| `artifact_indexed_at` | timestamptz nullable | 最近成功索引时间 | 是 |
| `artifact_sync_error_code` | text nullable | allowlist 安全错误码 | 是 |
| `script_size_bytes` | bigint nullable | 安全大小摘要 | 是 |
| `artifact_available` | boolean nullable | 最近检查可用性 | 是 |
| `reconcile_version` | integer nullable | projector/reconcile 合同版本 | 是 |
| `reviewed_script_revision` | text nullable | Admin 审核时确认的 revision | 是 |

约束：

- source type 仅 NULL 或 `dream_episode`。
- status 仅 NULL 或 `syncing/indexed/stale/missing/failed`。
- revision 仅 NULL 或 `sha256:<64 lowercase hex>`。
- 数量非负，`reconcile_version >= 1`。
- 部分唯一索引 `(workspace_id, artifact_source_type, source_project_id)`，仅非 NULL 来源参与。

旧行全部兼容 nullable。既有 `content` 不迁移、不清空；Dream 新 Artifact Story 不写完整正文。

## 4. 写入与一致性

Dream 在文件安全落盘后计算 revision、读取 manifest、提取有界 metadata，然后对同一 Workspace + Project 幂等 upsert：

1. 相同 revision：no-op，不插入重复 Story。
2. 新 revision：更新来源、revision、Episode 数、可用性与诊断，保留审核/发布历史。
3. 多 Episode：仍是一条 Project Story；`episode_count` 来自注册表实际 entry 数。
4. 文件成功、DB 失败：Dream 标记可恢复失败并由其 reconcile 重试。

文件与 PostgreSQL 不宣称原子事务。Admin 不承担 reconcile，也不以目录扫描补写数据库。

## 5. Admin 安全 Reader

Reader 位于 `app/lib/**`，Route Handler 仅负责 Session/RBAC、Zod 和响应编排。

### 5.1 根目录

- 只读取单一显式环境变量 `ARTIFACT_WORKSPACE_ROOT`。
- 部署必须把该根以 OS/container read-only 方式挂载给 Admin。
- 根必须存在、是目录且不是 symlink；启动/首次读取解析 canonical realpath。
- 未配置或不可访问返回 503；绝不回退其他目录或数据库。

### 5.2 解析与打开

- Story 内部引用只能来自 PostgreSQL Repository。
- 每段资源 ID 使用严格字符/长度合同，拒绝分隔符、`.`、`..`、NUL 和编码绕过。
- 逐段 `lstat`，拒绝 symlink 与特殊文件；`realpath` 必须保持在 canonical root 内。
- 最终文件以 `O_RDONLY | O_NOFOLLOW` 打开。
- 打开前后比较 `dev/ino/size/mtime`，读取后再验证目录与文件，变化即拒绝。
- Node.js 没有通用 `openat`/目录 fd 链，本实现明确保留“并发替换中间目录”的平台残余风险；OS 只读挂载、逐段校验和 fail-closed 是本期补偿控制，不宣称与 Dream Python `openat` 等价。

### 5.3 有界读取

- allowlist 只含四种 Artifact。
- manifest、registry 和 project metadata 使用独立小上限；正文按 offset/limit 分块读取。
- 默认不读取完整大文件；超出单文件或片段上限返回 413。
- 对 bytes 计算 SHA-256，ETag 使用带引号的 revision；`If-None-Match` 命中返回 304。
- UTF-8、manifest/registry 合同或绑定无效返回 422。

## 6. Admin API

```text
GET /api/admin/story-stories/:storyId/artifact-surface
GET /api/admin/story-stories/:storyId/artifacts
    ?episodeId=EP01&kind=script&offset=0&limit=65536&revision=sha256:...
```

`artifact-surface` 返回 Project/Episode/Artifact 的安全逻辑树、大小、mtime、revision、availability，不返回真实路径。`artifacts` 返回一个 UTF-8 有界预览 chunk、offset/nextOffset/totalBytes/truncated、revision 和 ETag。

状态：401/403 为 Session/RBAC；404 为 Story 或文件不存在；409 为 expected revision 冲突；413 为大小/范围超限；422 为 Artifact 合同错误；503 为挂载不可用。错误只含安全 code、message、request ID。

## 7. Admin 审核边界

Admin 不提供 Story 通用 PATCH，不编辑标题、正文、类型、来源或 Artifact。保留审核命令时必须携带 `expectedScriptRevision`，事务内锁定 Story 并比较 `script_revision`；确认成功写 `reviewed_script_revision` 与审核字段并记录 Audit。revision 已变化返回 409，防止审核旧正文。

## 8. 发布与回填

1. 先部署 nullable migration。
2. 部署 Dream projector/reconcile，再部署 Admin Reader/UI。
3. 在隔离 PostgreSQL 与临时 Artifact root 完成写测试。
4. 历史处理先执行 Dream dry-run；生产 apply 仍需用户单独批准。
5. 回滚 Admin Reader/UI 不影响 Dream 文件；数据库列保持向前兼容，不执行破坏性回滚。

当前只读文件盘点为 5 个有效 Project manifest、39 个 Episode 目录、3 个严格候选；数据库连接当时超时，因此新增/更新/冲突数未知。本文不授权操作共享真实数据。
