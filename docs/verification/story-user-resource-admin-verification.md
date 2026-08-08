# Story / User / Resource Admin 验收记录

日期：2026-08-08（Asia/Shanghai）

## 1. 验收边界

- 仓库：`/Users/dmeck/project/ink-admin-memory`
- 业务参考：`/Users/dmeck/project/ink-dream-memory`，全程只读，未修改
- 运行时数据源：唯一 `DATABASE_URL` PostgreSQL
- 持久化测试：自有一次性容器 `ink-memory-admin-story-user-e2e-20260808`，宿主端口 `55434`，库名 `ink-memory`
- 共享持久化 PostgreSQL `localhost:5433/ink-memory` 未迁移、清理或写入
- 验收结束后已删除上述一次性容器；端口 55434 已释放

## 2. 迁移验证

在全新 PostgreSQL 16 中从 `0000` 连续应用到 `0012`，共 13 条迁移记录，全部成功：

- `0010_story_source_canonical.sql`：创建 `users`、`story_workspace_workspaces`、`story_workspace_stories`、外键、初始检查约束与索引。
- `0011_nappy_prodigy.sql`：把 Workspace settings 规范为 JSONB，补 User/Workspace 状态、NOT NULL、复合筛选索引和计数检查。
- `0012_storage_admin_permissions.sql`：增加 `storage.read`、`storage.write`、`storage.delete` 并为内置角色建立最小授权。

最终关系：

```text
users.id (bigint)
  └── story_workspace_workspaces.owner_id (RESTRICT)
        └── story_workspace_stories.workspace_id (RESTRICT)

users.id
  └── story_workspace_stories.author_id (RESTRICT)
```

## 3. 静态与自动化门禁

| 命令 | 结果 |
|---|---|
| `pnpm env:check` | 通过 |
| `pnpm exec tsc --noEmit` | 通过 |
| `pnpm lint` | 通过，0 error |
| `pnpm test:run` | 31 files、177/177 通过 |
| Story/User/Storage focused unit | 3 files、14/14 通过 |
| `pnpm build` | 通过；Next.js 16.1.6 编译、类型与路由生成成功 |
| `git diff --check` | 通过 |
| QA preflight | 通过；Chromium 可用，3000 空闲，5433 仅识别未操作 |

## 4. PostgreSQL 与浏览器验收

| Lane | 结果 | 覆盖 |
|---|---|---|
| `admin-bootstrap-postgres.spec.ts` | 1/1 通过，2.1 分钟 | 真实 Session、401/403、User 查询/停用/恢复、Workspace 创建/归档与 Owner 409、Story 查询/更新/确认、Dashboard、RBAC、Storage read/403、审计、模型/计费/网关回归 |
| `admin-shell.spec.ts` + `admin-bootstrap.spec.ts` | 6/6 通过 | 登录、首次初始化、窄屏、根跳转、已移除 PWA 路由 404 |
| `story-user-resource-visual.spec.ts` | 1/1 通过 | User、Workspace、Story、Storage 桌面截图；Story 与模块导航移动截图；无 document 级横向溢出；无非预期 console/pageerror/request failure/5xx |

隔离 E2E 最终事实：13 条迁移、27 条审计、2 个 canonical User、3 个 Workspace（含测试创建并归档）、2 个 Story。测试未调用真实模型 Provider；仅使用本机 mock 上游和开发态显式 localhost opt-in。

Storage 成功上传、精确 Key 删除、权限拒绝和审计由单元测试覆盖；浏览器 E2E 只读验证真实 S3/MinIO 配置与列表能力，并验证 auditor 删除为 403，未向共享对象存储制造测试对象。

## 5. 视觉证据

- `test-results/story-user-resource-visual-3e733-in-at-both-target-viewports-chromium/platform-users-desktop-1440x1000.png`
- `test-results/story-user-resource-visual-3e733-in-at-both-target-viewports-chromium/story-workspaces-desktop-1440x1000.png`
- `test-results/story-user-resource-visual-3e733-in-at-both-target-viewports-chromium/stories-desktop-1440x1000.png`
- `test-results/story-user-resource-visual-3e733-in-at-both-target-viewports-chromium/storage-desktop-1440x1000.png`
- `test-results/story-user-resource-visual-3e733-in-at-both-target-viewports-chromium/stories-mobile-390x844.png`
- `test-results/story-user-resource-visual-3e733-in-at-both-target-viewports-chromium/module-navigation-mobile-390x844.png`

人工检查结果：暖纸张视觉、衬线标题、等宽事实标签与低饱和状态色符合设计稿；桌面表格只在容器内横滚；390×844 使用可键盘打开的 Drawer；筛选器单列重排；Storage 异步完成后显示 S3 可用、列表支持和真实空状态。

## 6. 安全与范围确认

- User API 的 SELECT/审计快照均排除 `password_hash`；未返回 Token、Session 或 Provider Key。
- User、Workspace、Story 写操作执行 Admin Session、server permission、Origin、strict Zod、参数化 SQL、同库事务与审计。
- Storage Admin facade 执行独立 `storage.read/write/delete`；上传限制 25 MB 与 MIME allowlist；删除要求完整对象 Key；上传审计失败时补偿删除对象。
- Permission 只读；内置角色和最后 active super_admin 继续由服务端保护。
- Ledger 与 Audit 继续 append-only/只读。
- 旧 Story 平行表未删除；本轮导航和新 API 已停止依赖，废弃计划见审计报告。

## 7. 已知限制

- S3/Vercel 列表为最多 1000 个对象的有界管理视图；超过上限返回 `truncated` 提示，需要后续增加驱动 continuation token 才能覆盖超大 bucket。
- Vercel Blob list 响应不包含 MIME，列表阶段根据对象文件名推断；单对象详情仍通过 head 获取真实 MIME。
- 对象存储与 PostgreSQL 不支持分布式事务。上传在审计失败时可补偿删除；删除在对象成功移除后写审计，若数据库随后不可用无法恢复对象，属于底层存储固有限制。
- 旧 `/api/storage/**` 业务兼容入口被保留且不再被 Admin UI 使用；本轮新增的管理入口全部位于 `/api/admin/storage-resources/**` 并受管理员权限保护。
- deprecated 角色、场景、工作流旧页面仍保留直接 URL，以满足“不直接删除错误平行表/现有代码”；本轮菜单已隐藏，后续按废弃计划另行移除。

## 8. 明确确认

- 未创建或运行 `ink-dream-memory → ink-memory` 数据迁移、同步、ETL 或定时任务。
- 未增加第二数据库连接；应用运行时只有单一 PostgreSQL `DATABASE_URL`。
- 未引入 SQLite、JSON DB 或内存数据库回退。
- 未修改 `/Users/dmeck/project/ink-dream-memory`。
- 未删除模型、网关、计费、权限或 Storage 底层实现。
- 未恢复 `app/(app)`。
