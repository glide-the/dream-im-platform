# 模块交互：Dream 剧本数据运营

> 返回：[全局交互规范](../refine-admin-ui-v3-interaction-design.md) · PRD：[Story 运营](../../prd/modules/02-story-operations.md)

> 实现状态：Workspace/Story 交互已实现；Character/Scene 条件开放；`/admin/story/workflow-runs` 当前重定向 Story，不存在 Workflow 列表或 Drawer。

## 0. Current / Target / Release Gate

| 分层 | 交互边界 |
|---|---|
| Current | Workspace/Story 真实表交互；Character/Scene 缺表 503，Workflow 重定向 Story。 |
| Target | Dream 43+5 PostgreSQL cutover 后，Admin 仅对批准领域提供只读/白名单命令；页面永不回退旧平行表或 SQLite。 |
| Release Gate | 48 表演练/cutover 状态可追溯；缺表只返 503，无假数据/通用硬删；现有 Story 回归通过。 |

## 1. 操作者与层级

内容运营按 `平台用户 → Workspace → Story → Character/Scene` 定位真实创作数据。面包屑和详情关联必须保留 Workspace 上下文。

```mermaid
flowchart LR
  U["平台用户"] --> W["Workspace"] --> S["Story"]
  W --> C["Character"]
  W --> N["Scene"]
  S --> C
  S --> N
```

## 2. 列表规范

| 页面 | 主要列 | 筛选/排序 | 行动作 |
|---|---|---|---|
| Workspace | name、owner、story 数、updated | owner/email/name；updated/name | 查看、编辑 name/settings |
| Story | title/identifier、workspace、author、status/review/type、updated | keyword、workspace、author、status/review/type | 查看、编辑白名单、confirm |
| Character | name/identifier、workspace、story_count、review | keyword、workspace、author/review/status | 条件查看/编辑/confirm |
| Scene | name/identifier、story、workspace、order、review | keyword、story/workspace/review | 条件查看/编辑/confirm |

分页 20/50/100；无批量写、创建和删除。扩展实体不在主导航时只能从关联详情进入；缺表显示 503 状态页。

## 3. 详情与编辑

- Workspace：Drawer；`name` text，`settings` JSON Editor，保存时展示 owner 与影响。
- Story：宽 Drawer，正文/关系只读；编辑 title text、description textarea、type select；pending 时显示“确认”命令。
- Character：Drawer；文本字段、avatar URL、tags multiselect/token input、notes textarea。
- Scene：Drawer；name/description、可搜索 Story relation、order integer；变更 Story 显示目标 Workspace/owner 校验摘要。

规划能力（不属于当前页面）：仅在真实 Workflow 表、Repository/API 和权限均存在后，才可增加只读列表与宽 Drawer（provenance/transition/token consumption），且无 retry/cancel。当前路由重定向不能作为该页面已实现的证据。

Confirm 使用 Modal，显示对象、当前 review status、不可撤销影响和 reason（若服务要求）。409 保留层并提供载入最新状态。

## 4. 状态与响应式

- Loading 保留筛选和表头；Filter Empty 提供清筛；System Empty 不提供创建。
- 503 显示缺失表清单和重试，不跳到旧表。
- Desktop 关联数据分区并排；Mobile 改为纵向定义列表，正文和 JSON 自身滚动。
- 表格 caption、aria-sort；confirm 后 live region 播报并归焦该行。

## 5. 交互验收

- UI-STO-01：用户→Workspace→Story 的筛选与返回上下文保持。
- UI-STO-02：当前页面无通用创建/硬删，也不呈现任何 Workflow 操作 UI；直接访问 Workflow 路由按现状返回 Story 列表。
- UI-STO-03：FK/状态 409、缺表 503、无权限 403 都有明确恢复动作。
- UI-STO-04：390×844 下正文/JSON/长 ID 不造成 document 横滚。
