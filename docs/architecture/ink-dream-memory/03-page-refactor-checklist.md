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
- **Deferred**：全部 Payment/订阅支付页面与未具备 Gateway capability 的 ASR 管理。

## 2. 页面矩阵

| 页面/路由 | Current | Planned 动作 | Release Gate |
|---|---|---|---|
| Story/Character/Scene | SQLite-backed 既有页面 | PG Repository 数据层适配；保持筛选、分页、审阅和显式排序 | JSON/time/total/409 与迁移前合同一致 |
| Dream 工作台、Execution/Review | 既有 Claude Agent/Workflow 调用 | 受控 Gateway canary；保留 deep link、tool confirmation、run/review 状态 | Agent/Workflow 协议与行为回归通过 |
| Chat | 旧 runner，模型字段可由前端提交 | 只发送已授权 alias；服务端重新解析，不信任 provider/model 字符串 | streaming/cancel/usage missing/502 结算确定 |
| Settings / 模型 | `ModelConfigSection.tsx` 静态 Auto/Claude/GPT | `GET /api/product/v1/me/model-catalog` 驱动 alias/label/capability | empty/403/503 不使用静态 fallback；Secret 不展示 |
| `/story-workspace/subscription` | 静态三档数组与“即将开放”，不是真实订阅 | 改为真实月度 Token 计划、用户周期、续费状态、Token Allowance、Usage、模型权限 | 数据只来自 Admin Product API；无 price/currency/金额额度/余额/支付/全局生效日期 |
| Token Usage 详情 | 当前无正式页面 | 订阅页内摘要 + 可访问的明细视图；服务端分页 | input/output/cache/total Tokens 分列；不换算金额或预计超额费用 |
| 生命周期影响预览 | 当前无 | 开通、续费、升级、降级、暂停、恢复、取消的服务端 preview | 确认页显示用户当前/下周期边界、Version 与 Token 影响；无金额 quote |
| Payment/订阅支付 | 当前无 | **Deferred**；不新增页面、状态、Fake test 入口或渠道品牌 | Subscription 完整流程在 Payment 组件不存在时通过 |
| 迁移维护 | 部分通用错误 | 全局维护/只读、409、503 和 request ID 恢复 | 不写回 SQLite、不使用本地假数据 |
| ASR | 未鉴权 WebSocket | release 前禁用或补 canonical 鉴权/Origin/限流/审计 | ASR Gateway 管理仍 Deferred |

## 3. `/story-workspace/subscription` 改造合同

需增量修改并复核：

- `frontend/src/pages/story-workspace/StoryWorkspaceSubscriptionPage.tsx` 与样式。
- `frontend/src/pages/story-workspace/StoryWorkspaceSettingsPage.tsx` 的订阅入口。
- `frontend/src/router/storyWorkspacePath.ts`、`frontend/src/router/story-workspace.tsx`。
- 新增产品 API client/types/hooks，但不在浏览器放服务间凭据。

页面不得再重定向至 About，也不得保留静态 plan array 作为错误 fallback。进入页面后并行读取可发布 Plans 与 `me/subscription-context`；后续加载 Token Usage 可渐进展示，但状态必须来自真实 API。

最低信息层级：

1. 当前订阅状态、Plan Version、周期起止、续费/期末取消状态。
2. 当前用户周期 Token 已授予/预留/已消耗/剩余与 Token burn-rate 耗尽预测。
3. 可用模型/权限摘要与限制。
4. 生命周期命令和影响预览。
5. append-only Token Usage 明细；现金 Ledger 不属于 Subscription 页面。

## 4. 状态与恢复矩阵

| 状态 | 页面行为 | 禁止 |
|---|---|---|
| loading | 骨架保持布局，`aria-busy`，命令按钮不可用 | 先显示静态套餐再替换 |
| empty | 区分“无发布 Plan”“无订阅”“Usage 为空” | 把 API 失败伪装为空 |
| 401 | Session 刷新或登录 | 把 Gateway Key 暴露给浏览器 |
| 402 | 显示当前周期 Token 已耗尽、剩余/所需 Token 与下周期时间，保留用户输入 | 余额、金额、充值、支付或自动 cash fallback |
| 403 | 说明当前状态/权限不允许，保留只读上下文 | 隐藏全部事实或提供绕过入口 |
| 404 | 刷新产品上下文/版本 | 回退硬编码 Plan/model |
| 409 | 拉取当前 version，重算影响预览，再确认 | 盲目重复提交 |
| 429 | 显示 `Retry-After` 倒计时，限制重试 | 自动高频重放 |
| 502 | 标注上游模型失败，允许安全重试 | 误报成功/零用量 |
| 503 | 维护/配置/数据库不可用，保留本地编辑草稿 | 写 SQLite、直接调用 Provider |

## 5. 生命周期交互门禁

所有 create/renew/upgrade/downgrade/pause/resume/cancel/revoke_cancel 命令必须：

1. 从同一 subscription command endpoint 以 `phase=preview` 获取 `previewId/digest/expiresAt` 与当前 `expectedVersion`，不在浏览器自行计算用户周期日期。
2. 显示该用户当前/下周期边界、Plan Version 与 Token Allowance 调整；不显示价格、金额 overage 或平台全局生效日。
3. 用户确认后提交唯一 idempotency key；按钮进入 pending 且防重复。
4. 409 时关闭旧确认态、保留用户意图并重新获取 preview。
5. 只有服务端返回最终 Subscription Event 后才显示成功；开通/续费不等待 Payment，也没有“支付成功”状态。

## 6. Token Usage 与 Secret

- Subscription API 只传 integer Token；input/output/cache/total、request、storage 等单位分栏，不出现金额字段。
- Token Usage 是只读 append-only 事实；无编辑、删除或默认 CRUD action。
- Gateway Key、Provider Secret、System Secret 永不展示；Deferred Payment Secret 不得提前加入。
- request ID、model alias 与 token count 可按产品权限显示；Provider Pricing/micro-USD、原始凭据/响应和内部 stack 不显示在套餐页面。

## 7. 响应式与可访问性

| 视口 | 结构 |
|---|---|
| 1440×1000 | 当前订阅/Token Allowance 主列，计划与操作侧列；Token Usage 使用可排序表格与 sticky header |
| 390×844 | 单列卡片；重要状态/剩余量在首屏；表格转语义化 key-value/list；底部确认区不遮挡焦点 |

- 所有控件有可见 Label；状态不只靠颜色；Token/时间提供读屏友好文本。
- Dialog/Drawer 打开时聚焦标题/首控件，关闭后归焦触发器；Escape 行为一致。
- 错误摘要可聚焦并通过 `aria-describedby` 关联字段；后台刷新不抢焦点。
- loading/empty/error/maintenance 在两个视口无横向溢出，键盘可完成完整生命周期命令。

## 8. 测试清单

- 静态套餐、静态模型、金额/余额/支付字段与 About redirect 均被删除；API failure 无 fallback。
- 1440×1000 与 390×844：loading、empty、401/402/403/404/409/429/502/503、维护、命令 preview/confirm。
- 服务端用户/Token Usage 分页总数稳定，205-user 用例不存在 QA-only 结果。
- Gateway/Provider/System Secret 在 DOM、网络响应、Storage、console 和截图中均不存在；Payment UI/config 为 0。
- Dream/Chat/Workflow/Agent 既有 deep link、streaming、cancel、tool confirmation 和保存行为不回归。
