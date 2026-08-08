# Ink Memory Admin UI v3 — 全局交互规范

> 版本：3.0  
> 更新：2026-08-08  
> 平台 PRD：[`ink-memory-admin-prd-v3.md`](../prd/ink-memory-admin-prd-v3.md)  
> 模块交互：[`docs/design/modules/`](modules/)  
> 视觉依据：`Ink & Memory UI Design v2.pdf`、`docs/prd/color_system/**`

## 1. 设计方向

Admin 使用“暖纸张上的专业运营工具”语言：高信息密度、平面列表、清晰规则线、小面积状态色。不得退化为默认 Refine/Ant Design CRUD、卡片墙、Landing Page 或装饰性指标。

- 页面画布：亮色 `#f8f0e6` / 暗色 `#1f1b16`。
- 主纸面：亮色 `#fffef9` / 暗色 `#2a251e`。
- 主文字：亮色 `#2c2c2c` / 暗色 `#f3eee6`。
- 纸面边框：亮色 `#d0c4b0` / 暗色 `#5a4d3d`。
- 链接：亮色 `#4a90e2` / 暗色 `#81b7d2`。
- 成功、警告、错误、危险必须使用既有语义 Token，并配文字/图标，不能只依赖颜色。

完整 Token 继续以 [`admin-ui-visual-specification.md`](admin-ui-visual-specification.md) 和 `docs/prd/color_system/` 为唯一值来源；模块文档不复制颜色表。

## 2. 排版、几何与密度

| 语义 | Desktop | Mobile |
|---|---:|---:|
| H1 | 32px Noto Serif SC 600 | 28px |
| H2 | 20px Noto Serif SC 600 | 19px |
| 正文/控件 | 15px / 14px Noto Sans SC | 同 Desktop |
| ID/金额/Token/时间 | 12px IBM Plex Mono、tabular nums | 同 Desktop |
| Paper 内距 | 32px | 16px |
| Table header/row | 44px / 52–60px | 44px / 56–64px |
| 交互命中区 | 至少 44×44px | 至少 44×44px |

基础间距为 4px，常用 8/12/16/20/24/32/40/48。常驻区域无 shadow；Popover、Dialog、Drawer 可用浮层阴影。页面只允许一处 1px dashed Paper 外边界，内部分隔和控件使用 solid border。

## 3. Admin Shell

### 3.1 Desktop 1440×1000

- 248px 固定侧栏；主区持有唯一页面纵滚动。
- 顶栏显示菜单上下文、面包屑、必要的数据源健康与管理员菜单。
- 内容 Paper 填满可用宽度；表格在自身壳层横向滚动，document 不横滚。
- 当前导航使用文字权重、2px 左线和小面积 Memory Yellow，不整行深色填充。

### 3.2 Mobile 390×844

- 侧栏进入 modal navigation drawer，打开后锁焦；Escape、遮罩与关闭按钮可关闭并归焦菜单按钮。
- 顶栏仅保留菜单、页面标题和最高优先动作。
- Drawer/复杂详情占满 viewport；表格可局部横滚，主要识别列 sticky。
- 底部操作区考虑 safe area；不得遮挡错误摘要或最后一个字段。

## 4. 通用页面结构

页面顺序固定为：Breadcrumb → H1/说明/主动作 → Query Bar → 状态摘要 → Data/Detail → Pagination/Action receipt。

| 场景 | 默认容器 |
|---|---|
| 简单、低风险、少于 8 个字段 | Drawer；Mobile 全屏 |
| Provider、Model、Pricing、Plan Version 等复杂配置 | 独立页面或固定全窗口层 |
| 只读 Request/User/Subscription 详情 | 宽 Drawer；Mobile 全屏 |
| 生命周期、高风险确认 | Modal；Mobile bottom/full-screen sheet |
| 一次性 Secret 回执 | 阻断式回执层，关闭后不可恢复明文 |

每个模块的具体选择见模块文档。

## 5. 列表、筛选与分页

- API 返回 `{data, meta:{total,page,pageSize}}`；分页、排序和白名单筛选均由服务端执行。
- Query Bar 依次为关键词、主要关系、状态、时间、清筛、刷新；移动端次要筛选进入 Filter Sheet。
- 表头使用 `scope=col` 和 `aria-sort`；分页说明当前范围与总数。
- 行主识别信息是链接；常用动作常显，破坏性/次动作进入 More menu，但不能只在 hover 出现。
- ID、code、Key prefix、金额、Token、时间用 mono/tabular；长值截断且可复制，复制按钮有 accessible name。
- Filter Empty 明确显示筛选条件和“清除筛选”；System Empty 解释为何无数据，只在允许创建的模块显示创建按钮。

## 6. 表单与字段控件

| 数据 | 控件 | 全局规则 |
|---|---|---|
| 名称/code/邮箱 | text/email | code 创建后只读；trim；显示长度限制 |
| 整数/Token/RPM | number | `step=1`；显示单位；禁止负数或按领域下限 |
| micro-USD | integer input + USD preview | 传输/保存只用整数，不回写浮点 |
| 状态/协议/周期 | select/radio | 使用领域枚举，不接受自由文本 |
| 关系 | 可搜索 select/combobox | 加载真实 Resource；显示主标签+辅助标识；不提交浏览器伪造身份 |
| 日期/时间 | date/datetime | 显示时区；服务端验证有效窗口 |
| 布尔 | Switch | label 说明生效影响；危险状态不用单独 Switch |
| JSON | JSON Editor | 仅未知扩展字段；格式化、schema、行列错误、恢复草稿 |
| Secret | password/secret | 创建草稿可显隐；历史值永不加载；空值表示不轮换 |
| ID/状态/快照 | 只读 code/status tag | 可复制；状态同时有文字 |

所有字段使用稳定 `label/description/error/required` 关联。提交失败保留草稿并聚焦首错；离开脏表单前确认。

## 7. 状态、反馈与错误恢复

| 状态 | 交互要求 |
|---|---|
| Loading | 页头/筛选稳定，等高 skeleton，`aria-busy=true` |
| Empty | 区分无数据/无匹配，提供唯一合理下一步 |
| 401 | 不渲染保护数据；登录后安全返回 |
| 403 | `role=alert`，显示所需权限和返回动作 |
| 404 | 返回对应列表，保留安全 request ID |
| 409 | 保留输入，展示服务器最新状态和刷新/重载动作 |
| 500 | 安全错误摘要 + request ID；不显示 SQL、stack 或 Secret |
| 503 | 说明具体依赖；提供重试；禁止回退假数据 |
| Success | polite live region；刷新缓存；回执包含实际对象和审计/幂等结果 |

Toast 使用不透明 surface，最多两条且不抢焦点。网络结果未知时不显示成功；先通过幂等键查询结果。

## 8. 高风险与 Secret 交互

- 停用 Provider、撤销 Gateway Key、余额调整、订阅暂停/取消、管理员停用、Role 删除、Secret 覆盖必须显示对象、当前状态、影响、before/after、reason 与 request/idempotency 信息。
- 最高风险动作要求输入对象 code 或确认短语；提交中禁止重复。
- 409 不关闭确认层，焦点移到冲突摘要。
- Secret 创建回执显示一次；Copy 仅写 clipboard，不触发 analytics；离开前提示不可再次查看。
- Ledger、Usage、Audit、Request 历史、已发布 Plan Version/Entitlement 不提供删除或直接编辑入口。

## 9. 模块交互索引

| 模块 | 交互规范 |
|---|---|
| Shell 与总览 | [00-admin-shell](modules/00-admin-shell.md) |
| 平台用户 | [01-platform-users](modules/01-platform-users.md) |
| Dream 创作运营 | [02-story-operations](modules/02-story-operations.md) |
| 订阅与权益 | [03-subscriptions](modules/03-subscriptions.md) |
| Provider / Model / Pricing | [04-model-catalog](modules/04-model-catalog.md) |
| Gateway | [05-gateway](modules/05-gateway.md) |
| Usage / Account / Ledger | [06-billing](modules/06-billing.md) |
| Storage | [07-storage](modules/07-storage.md) |
| RBAC / Audit / Settings | [08-governance](modules/08-governance.md) |

## 10. 键盘、焦点与读屏

- 首个 Tab 到 skip link；随后导航、页头、筛选、数据、分页和操作区。
- 所有 focusable 保留 2px outline + 2px offset；禁止只靠 shadow。
- Dialog/Drawer/Sheet 锁焦，Escape 关闭并归焦触发器。
- Popover 用方向键移动，Escape 归焦本行按钮；图标按钮必须有 accessible name。
- 表格有 caption；局部滚动容器可聚焦并说明可滚动。
- 后台刷新、成功与关键状态进入单一 `aria-live=polite`；错误摘要使用 `role=alert`。
- 文字放大 200% 和 `prefers-reduced-motion` 下仍能完成任务；关键动作不依赖 hover。

## 11. 全局视觉验收

- 1440×1000 与 390×844 的 document 横向溢出 ≤1px。
- Light/Dark 只使用集中 Token；无远程字体、Font Awesome、渐变、glow 或装饰性持续动效。
- 每个页面具备 loading、empty、error、403/404/409/503 中适用状态和恢复动作。
- 表单控件、危险确认、Secret 回执、Drawer/Modal 均能仅用键盘完成。
- 状态不只靠颜色；ID、金额、Token、时间对齐且可复制；移动端长值不撑破页面。
- 模块规范中的页面、字段和动作必须有真实 API/Repository 支持；未实现能力明确标为后续，不画可点击假入口。

## 12. 文档维护规则

全局 Token、Shell、状态和无障碍规则只在本文件维护；模块文件只描述差异。新增页面进入对应模块交互文档，并同时更新同名 PRD。Gateway Payload、Provider 同步等专项细节可保留附录，但模块文档必须给出正式入口和验收摘要。
