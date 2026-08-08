# 模块 PRD：Dream 剧本数据运营

> 返回：[平台 PRD 总纲](../ink-memory-admin-prd-v3.md) · 交互：[Story 运营](../../design/modules/02-story-operations.md)

## 1. 目标与边界

内容运营在 Admin 中查询并受控维护 Dream 真实 Workspace、Story 及可用的扩展创作实体。Admin 不修改 Dream 仓库，不以旧 `story_*` 平行表或假数据替代真实表。

当前主导航只开放 Workspace 与 Story。Character、Scene、Workflow 路由代码保留为条件能力：真实表未迁入时返回 503，不读取 deprecated 表。

## 2. 页面

| 对象 | 路由 | 主要能力 |
|---|---|---|
| Workspace | `/admin/story/workspaces` | 列表、详情、更新 name/settings；禁止创建/删除 |
| Story | `/admin/story/stories` | 列表、详情、更新白名单字段、pending→confirm；禁止通用创建/删除 |
| Character | `/admin/story/characters` | 条件读取/受控更新与 confirm |
| Scene | `/admin/story/scenes` | 条件读取/受控更新与 confirm；移动 Story 时校验同 owner/workspace |
| Workflow | `/admin/story/workflow-runs` | 条件只读；无人工 retry/cancel |

## 3. 数据与服务

权威表为 `users`、`story_workspace_workspaces`、`story_workspace_stories` 及经审计后迁入的 `story_workspace_characters/scenes`、关系表、`workflow_runs/**`。Repository 位于 `app/lib/story-source/**`，复用唯一 PostgreSQL Pool。

列表 API 使用 `story-*` Resources，提供服务端分页、总数、白名单筛选和排序。所有写入经过严格 Zod、事务、FK/owner/workspace 校验和 Admin Audit。

## 4. 状态与安全

- 缺表：503 + missing table list；Provider/Billing 等模块继续可用。
- 不存在：404；FK/同 Workspace 规则、状态竞态：409。
- Story 正文、Agent provenance 和用户资料按最小必要披露；列表不返回大正文。
- 禁止硬删除、通用创建、修改 owner/author/password_hash 或绕过业务状态机。

## 5. 验收

- STO-01：Workspace/Story 查询来自真实原名表，旧平行表即使有数据也不被读取。
- STO-02：Workspace 仅 name/settings 可写；Story/Character/Scene 仅白名单字段及 confirm 命令可写。
- STO-03：FK、唯一键、跨 owner/workspace 和状态冲突返回 409，不产生部分写入。
- STO-04：缺扩展表时对应页面 503，其他模块无回归。
- STO-05：Dream 项目代码、Schema、迁移和运行配置保持未修改。
