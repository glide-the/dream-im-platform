# Admin Story Artifact 交互设计

> 状态：Accepted for implementation  
> 更新：2026-08-10  
> 架构合同：[`story-artifact-index-sync-architecture.md`](../architecture/story-artifact-index-sync-architecture.md)

## 1. 体验目标

Admin 是只读运营入口。列表回答“PostgreSQL 里有哪些 canonical Story”，详情同时回答两件不能混为一谈的事实：

1. PostgreSQL 索引当前记录了什么。
2. 共享只读 Artifact 挂载中当前实际能读取什么。

视觉沿用现有暖纸色、编辑部式运营后台；Story 的识别性元素是“PostgreSQL 索引 / Artifact 内容”双轨状态条，不另造设计系统。

## 2. 列表

显示：标题、Story ID、Workspace、作者、Project identity、Episode 数、Artifact 状态、Script revision、索引时间、审核状态、业务状态、更新时间。

筛选：标题、Workspace、作者、Project identity、Artifact 状态、Artifact 可用性、审核状态、业务状态、更新时间。排序至少支持 updated、indexed、title、episode count、artifact status；`meta.total` 必须等于相同 PostgreSQL 条件的 count。

状态文案：

| 数据 | 表现 |
|---|---|
| 查询成功且 0 行 | “PostgreSQL 中尚无 Story 索引” |
| 筛选后 0 行 | “没有匹配当前筛选的记录”，可清筛 |
| `indexed` | 已索引 |
| `syncing` | 索引同步中 |
| `stale` | Revision 已变化 |
| `missing` | 索引存在，文件缺失 |
| `failed` | Artifact 索引失败，显示安全错误码 |
| NULL | 旧 Story / 未接入 Artifact 管理 |

列表不访问文件系统，因此 Artifact 挂载失败不改变 total，也不把数据库行隐藏。

## 3. Detail Drawer

桌面从右侧打开；390×844 使用全屏 Drawer。DB detail 先加载并立即展示，Artifact surface 作为独立请求懒加载。

### 3.1 双轨事实条

```text
PostgreSQL 索引                         Artifact 内容
indexed · sha256:a28f…                  可读取 · sha256:a28f…
2026-08-10 14:20                        EP01 · script.md · 128 KB
```

revision 不同显示明确 409 诊断，不使用“已同步”。文件不可用时左轨仍完整显示。

### 3.2 PostgreSQL 元数据

显示安全字段、真实 Workspace/User 关系、同步状态、错误码、revision、Episode 数、审核/业务状态、时间；不显示 `source_thread_ref`、`content`、绝对路径或异常堆栈。

### 3.3 Artifact 逻辑树与预览

- Episode selector 只来自受控 surface。
- 文件 Tab 只含：剧本、Episode 大纲、Storyboard、Review report。
- 逻辑树显示 Project / Episode / 文件名、大小、更新时间、revision、availability；没有磁盘路径。
- 首次只取有界 chunk；“加载下一段”按 `nextOffset` 继续，不默认下载完整文件。
- 预览只读、保留换行、可复制；无 editor、路径框、文件上传或任意下载。
- 使用 ETag/If-None-Match；304 保留现有内容。

## 4. 错误与恢复

| 状态 | PostgreSQL 区 | Artifact 区 | 操作 |
|---|---|---|---|
| Loading | 等高骨架 | 独立骨架 | 不清空另一轨 |
| 401 | 清除保护内容 | 清除 | 重新登录 |
| 403 | 显示所需权限 | 不探测文件 | 返回列表 |
| 404 Story | 不显示 | 不读取 | 返回列表 |
| 404 Artifact | 保留 | 文件缺失 | 切换 Episode/文件 |
| 409 | 保留 | Revision 已变化，清旧预览 | 刷新 surface |
| 413 | 保留 | 文件/片段超限 | 缩小片段 |
| 422 | 保留 | registry/manifest/UTF-8 合同无效 | 复制 request ID |
| 500 | 保留已加载事实 | 安全通用错误 | 重试 |
| 503 DB | 无索引详情 | 不以客户端路径绕过 DB | 稍后重试 |
| 503 Artifact root | 保留 | 共享文件系统不可用 | 重试 Artifact |

## 5. 审核交互

Story 不显示通用“编辑”。若当前记录可审核，命令区显示当前 `script_revision`；确认请求携带 `expectedScriptRevision`。服务端 409 时关闭成功假象，提示正文已变化并要求先刷新预览。审核不写 Artifact，也不修改来源字段。

## 6. 响应式与可访问性

- 1440×1000：列表容器内部可横向滚动，页面本身不溢出；Drawer 宽度约 720–820px。
- 390×844：Drawer 占满可视区，头部与操作区固定，内容纵向滚动；表格仍只在面板内部横向滚动。
- 状态不只依赖颜色；按钮最小高度 44px；Drawer 有标题、focus return、Esc 关闭和 loading/error live region。
- 关键测试标识：`story-index-rail`、`story-artifact-rail`、`story-artifact-tree`、`story-artifact-preview`、`story-artifact-error-*`。

## 7. 非目标

- Admin 不扫描 Artifact root 来生成列表。
- Admin 不写/重命名/删除文件，不接收路径。
- 本期不实现 Admin → Dream 服务 JWT 或远程 Artifact API；该方案 Deferred。
- 本期不执行生产历史回填。
