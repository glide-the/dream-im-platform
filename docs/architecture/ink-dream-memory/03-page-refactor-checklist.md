# Dream 页面与交互改造清单

> 文档状态：**Planned**  
> 返回：[总索引](README.md)  
> 依赖：[业务边界](02-business-integration-and-admin-boundary.md) · [Dream 产品与推理集成](07-dream-subscription-and-inference-integration.md)  
> 详细交互：[Dream 交互设计](../../design/ink-dream-memory/README.md)  
> 主要读者：产品、Dream 前端、Dream 后端、QA

## 1. 页面状态定义

- **保留/回归**：主要产品行为不变，只适配 PostgreSQL 与 Gateway 错误。
- **数据层改造**：路由/信息架构不变，真实数据源或模型目录发生改变。
- **真实能力改造**：删除静态/虚构事实，改接 Admin 产品 API。
- **Deferred**：当前仅真实第三方支付渠道页面和未具备 Gateway capability 的 ASR 管理。

## 2. 页面矩阵

| 页面/路由 | Current | Planned 动作 | Release Gate |
|---|---|---|---|
| Story/Character/Scene | SQLite-backed 既有页面 | PG Repository 数据层适配；保持筛选、分页、审阅和显式排序 | JSON/time/total/409 与迁移前合同一致 |
| Dream 工作台、Execution/Review | 既有 Claude Agent/Workflow 调用 | 受控 Gateway canary；保留 deep link、tool confirmation、run/review 状态 | Agent/Workflow 协议与行为回归通过 |
| Chat | 旧 runner，模型字段可由前端提交 | 只发送已授权 alias；服务端重新解析，不信任 provider/model 字符串 | streaming/cancel/usage missing/502 结算确定 |
| Settings / 模型 | `ModelConfigSection.tsx` 静态 Auto/Claude/GPT | `GET /api/product/v1/me/model-catalog` 驱动 alias/label/capability | empty/403/503 不使用静态 fallback；Secret 不展示 |
| `/story-workspace/subscription` | 静态三档数组与“即将开放”，不是真实订阅 | 改为真实计划、当前订阅、周期、续费状态、Allowance、余额、Usage、预计超额入口 | 数据只来自 Admin Product API；无假价格/余额/成功 |
| Usage / Ledger 详情 | 当前无正式页面 | 订阅页内摘要 + 可访问的明细视图；服务端分页 | 金额以 micro-USD string/int 传输，UI 格式化但不回传浮点 |
| 生命周期影响预览 | 当前无 | 开通、续费、升级、降级、暂停、恢复、取消的服务端 quote/preview | 确认页显示生效时间、版本、额度/余额影响与冲突恢复 |
| Payment 状态 | 当前无 | 只展示平台返回的 pending/authorized/failed/refunded/reversed；test-only 环境明确标识 | 无真实渠道时不显示“支付成功”或第三方品牌 |
| 迁移维护 | 部分通用错误 | 全局维护/只读、409、503 和 request ID 恢复 | 不写回 SQLite、不使用本地假数据 |
| ASR | 未鉴权 WebSocket | release 前禁用或补 canonical 鉴权/Origin/限流/审计 | ASR Gateway 管理仍 Deferred |

## 3. `/story-workspace/subscription` 改造合同

需增量修改并复核：

- `frontend/src/pages/story-workspace/StoryWorkspaceSubscriptionPage.tsx` 与样式。
- `frontend/src/pages/story-workspace/StoryWorkspaceSettingsPage.tsx` 的订阅入口。
- `frontend/src/router/storyWorkspacePath.ts`、`frontend/src/router/story-workspace.tsx`。
- 新增产品 API client/types/hooks，但不在浏览器放服务间凭据。

页面不得再重定向至 About，也不得保留静态 plan array 作为错误 fallback。进入页面后并行读取可发布 Plans 与 `me/subscription-context`；后续加载 Usage/Ledger 可渐进展示，但状态必须来自真实 API。

最低信息层级：

1. 当前订阅状态、Plan Version、周期起止、续费/期末取消状态。
2. Allowance 已授予/预留/已消耗/剩余，余额与预计超额。
3. 可用模型/权限摘要与限制。
4. 生命周期命令和影响预览。
5. Usage 明细和 append-only Ledger 只读入口。

## 4. 状态与恢复矩阵

| 状态 | 页面行为 | 禁止 |
|---|---|---|
| loading | 骨架保持布局，`aria-busy`，命令按钮不可用 | 先显示静态套餐再替换 |
| empty | 区分“无发布 Plan”“无订阅”“Usage 为空” | 把 API 失败伪装为空 |
| 401 | Session 刷新或登录 | 把 Gateway Key 暴露给浏览器 |
| 402 | 显示额度/余额不足及单位、保留用户输入 | 虚构充值/支付成功 |
| 403 | 说明当前状态/权限不允许，保留只读上下文 | 隐藏全部事实或提供绕过入口 |
| 404 | 刷新产品上下文/版本 | 回退硬编码 Plan/model |
| 409 | 拉取当前 version，重算影响预览，再确认 | 盲目重复提交 |
| 429 | 显示 `Retry-After` 倒计时，限制重试 | 自动高频重放 |
| 502 | 标注上游模型失败，允许安全重试 | 误报成功/零用量 |
| 503 | 维护/配置/数据库不可用，保留本地编辑草稿 | 写 SQLite、直接调用 Provider |

## 5. 生命周期交互门禁

所有 create/renew/upgrade/downgrade/pause/resume/cancel 命令必须：

1. 从服务端获取影响预览与 `expected_version`，不在浏览器自行计算价格或日期。
2. 显示立即/下周期生效、Plan Version、Allowance 调整、是否产生 overage 与不可逆影响。
3. 用户确认后提交唯一 idempotency key；按钮进入 pending 且防重复。
4. 409 时关闭旧确认态、保留用户意图并重新获取 preview。
5. 只有服务端返回最终 Subscription Event 后才显示成功；Payment pending 不能显示订阅已支付成功。

## 6. 金额、Usage 与 Secret

- API 金额以整数 micro-USD 的 JSON string 或安全 integer contract 传输；前端只在显示层格式化，不以 float 回传。
- Token、request、storage 等不同单位分栏，不能塞入金额字段。
- Ledger/Usage 是只读 append-only 事实；无编辑、删除或默认 CRUD action。
- Gateway Key、Provider Secret、Payment Secret、System Secret 永不展示；不能提供“再次查看”或复制已存在 Secret。
- request ID、model alias、token count、micro-USD 可按产品权限显示；Provider 原始凭据/响应、内部 stack 不显示。

## 7. 响应式与可访问性

| 视口 | 结构 |
|---|---|
| 1440×1000 | 当前订阅/Allowance 主列，计划与操作侧列；Usage/Ledger 使用可排序表格与 sticky header |
| 390×844 | 单列卡片；重要状态/剩余量在首屏；表格转语义化 key-value/list；底部确认区不遮挡焦点 |

- 所有控件有可见 Label；状态不只靠颜色；金额/时间提供读屏友好文本。
- Dialog/Drawer 打开时聚焦标题/首控件，关闭后归焦触发器；Escape 行为一致。
- 错误摘要可聚焦并通过 `aria-describedby` 关联字段；后台刷新不抢焦点。
- loading/empty/error/maintenance 在两个视口无横向溢出，键盘可完成完整生命周期命令。

## 8. 测试清单

- 静态套餐、静态模型、假余额与 About redirect 均被删除；API failure 无 fallback。
- 1440×1000 与 390×844：loading、empty、401/402/403/404/409/429/502/503、维护、命令 preview/confirm。
- 服务端用户/Usage/Ledger 分页总数稳定，205-user 用例不存在 QA-only 结果。
- Gateway/Provider/Payment/System Secret 在 DOM、网络响应、Storage、console 和截图中均不存在。
- Dream/Chat/Workflow/Agent 既有 deep link、streaming、cancel、tool confirmation 和保存行为不回归。
