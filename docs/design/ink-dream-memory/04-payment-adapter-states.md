# 04 · Deferred Payment and Subscription Payment Boundary

> 文档状态：**Deferred**
>
> 当前产品入口：**无**
>
> 文件名因旧链接兼容保留；本文件不是 PaymentAdapter、Webhook 或支付页面实现合同
>
> 返回：[Dream 交互设计索引](README.md)

## 1. 本轮处理判断

订阅套餐是每位用户的月度 Token 规则，不是商品价格或资金账户。当前阶段明确：

- 套餐不包含价格、currency、金额赠送、金额抵扣、余额、充值、退款或金额超额；
- 开通、续费、升级、降级、暂停和取消不触发支付流程；
- `/story-workspace/subscription` 不渲染 checkout、支付方式、应付金额、账单、Payment Intent、Webhook 回执或“待人工授权”；
- Dream BFF 和 Admin 产品订阅 API 不暴露 payment/balance/top-up/refund/reversal 合同；
- Stripe、支付宝、微信支付和任何真实渠道全部 Deferred；Fake/Test Adapter 也不属于本阶段产品体验。

现金按量计费如由平台未来在独立域提供，也不能自动成为订阅 Token 耗尽后的兜底。订阅用户额度不足仍返 402 Token 错误。

## 2. Current、Deferred 与 Release Gate

### Current

- Dream 没有可验证的真实支付渠道、订单、PaymentAdapter 或 Webhook 事件存储。
- 因而任何“付款成功”、“待授权”、“已扣款”、“可充值”或渠道交易号都属于虚构状态。

### Deferred

只有出现新的、明确批准的支付业务需求后，才能另开版本化 PRD、威胁模型、数据模型、交互设计、支付渠道接入与合规评审。未来方案必须独立于 Token-only Subscription，并明确它服务的是哪一种商品或现金按量域。

### 当前 Release Gate

- 订阅页面、模型页和 Usage 页不存在 Payment 区域、金额字段、渠道 logo、跳转、支付按钮或占位 checkout。
- 产品 API schema 对意外出现的支付/金额字段 fail closed：记录安全合同错误并返 503，不渲染为可用功能。
- 旧深链、旧 feature flag、旧本地静态数组和旧测试不能恢复付款 UI。
- 现金/财务域不是 Dream 订阅上线的前置条件；支付 Deferred 不阻塞 Token-only 订阅发布。

## 3. 路由与导航处理

| 场景 | 目标行为 | 不得行为 |
|---|---|---|
| 主导航 | 不出现“支付”、“充值”、“账单”或“付款方式”入口 | 用 Disabled 菜单制造即将上线承诺 |
| 订阅页面 | 不渲染 Payment 分区 | 根据套餐代码本地拼接价格或付款按钮 |
| Usage 页面 | 只显示 Token | 增加金额列、现金余额、预计金额超额或财务 Ledger |
| 旧 payment 深链 | 返回 404 产品空状态或重定向订阅页并说明功能不存在 | 展示假 checkout、测试 Adapter 或旧静态回执 |
| API 返回禁用字段 | 视为 schema contract violation，返安全 503 | 宽松透传 `amount/currency/paymentState` |
| Token 402 | 显示 `availableTokens/requiredTokens/periodEnd` | 导航充值、现金补扣或支付授权 |

没有独立 payment-intents、webhook、refund、reversal 或 subscription-payment 产品路由。本文件不定义这些端点。

## 4. Deferred 状态与产品文案

支付不作为日常页面状态展示。只有用户访问遗留深链、旧书签或实验 flag 时，才使用以下安全状态：

| 内部能力状态 | 用户安全文案 | 页面动作 | 禁止内容 |
|---|---|---|---|
| `not_in_scope` | 当前订阅只管理月度 Token，不包含支付 | 返回订阅 | 金额、渠道、付款成功 |
| `deferred` | 支付能力尚未开放 | 返回安全页面 | 上线日期、倒计时、预约付款 |
| `unsupported_route` | 此页面不存在 | 返回订阅或工作区 | 猜测订单、账户或交易状态 |
| `contract_violation` | 当前服务响应不符合安全合同 | 重试、复制 request ID | 原始 payload、金额、Payment Secret |
| `dependency_unavailable` | 服务暂时不可用 | 按 Retry-After 重试 | 切换 Fake Adapter 或静态成功页 |

不得用 `awaiting_authorization/authorized/captured/refunded` 等看似真实的支付状态，因为当前没有对应业务事实来源。

## 5. 遗留深链空状态设计

遗留 payment URL 的空状态是安全退出页，不是未来支付页预览。

| 区域 | 内容/控件 | 规则 |
|---|---|---|
| H1 | “此功能当前不可用” | 不使用“即将上线支付” |
| 说明 | “订阅仅管理每月 Token 与模型权益，不涉及资金” | 文字明确，不只靠图标 |
| 主动作 | “返回订阅” link/button | 回到 `/story-workspace/subscription` |
| 次动作 | “返回工作区” link | 不提供联系客服付款 |
| 支持信息 | 安全 request ID（仅错误时） | 可复制；无 transaction/order ID |

页面不显示金额 skeleton、渠道 logo、卡号输入、二维码、支付倒计时、人工收款说明、Webhook 状态或账务时间线。

## 6. Loading、Empty 与错误恢复

| 状态 | 行为 |
|---|---|
| Loading | 仅在确认遗留路由处理结果时显示稳定标题 skeleton；不得先渲染 checkout 外壳 |
| Empty/Deferred | 显示“订阅只包含月度 Token”与返回动作 |
| 401 | 不渲染任何用户上下文；登录后返回安全订阅路由 |
| 402 | 仅在原请求为 Gateway Token 耗尽时显示 Token details；不渲染支付恢复动作 |
| 403 | 隐藏受保护信息，返回当前用户可用页面 |
| 404 | 旧 payment 路由标准终态；不创建本地支付对象 |
| 409 | 若旧客户端提交 payment 字段，拒绝并要求刷新至新合同；不接受兼容写入 |
| 429 | 按 Retry-After 停止重复请求；不启动多 timer |
| 503 | schema violation 或依赖不可用；显示 request ID，绝不 fallback 到静态/Fake Payment |
| 网络结果未知 | 不显示支付成功或失败；返回订阅 refetch 真实 Token 状态 |

## 7. 未来重新启动的准入条件

以下条件必须全部具备，才可把本文件从 Deferred 改为新设计入口：

1. 产品负责人确认独立商品/现金域、支付主体、地区、币种、税务与退款政策；
2. 明确真实渠道和 sandbox/production 隔离，不以 Fake Adapter 代替产品事实；
3. 另建 PaymentAdapter、Order/Intent、Webhook 幂等、签名验证、reconciliation 与 append-only 财务模型；
4. 完成 PCI/隐私/合规、安全日志、密钥轮换、失败与争议处理评审；
5. 另写可测试 PRD 与交互设计，不能把金额字段重新塞回 Subscription Plan Version 或 Token Allowance；
6. 明确与现金按量域的关系；默认不得在 Token 402 后静默扣款。

这些准入条件只记录未来治理边界，不授权当前代码创建 Adapter、表、API 或页面。

## 8. Secret 与数据最小化

- 当前 Dream 浏览器、BFF 响应、普通日志、截图和 analytics 均不应出现 Payment Secret、Webhook signature、adapter credential、card/wallet 数据或 raw payment payload。
- 遗留请求若携带 `amount/currency/paymentState/provider` 等字段，服务端不回显值，只返回安全 code/request ID。
- Gateway Key、Provider Secret 与服务身份同样不得因错误页或调试信息泄露。

## 9. 响应式与无障碍

### 1440×1000

- Deferred 空状态最大宽度约 640px，位于内容主栏；不使用 checkout 大页、渠道 logo 墙或装饰性付款插图。
- H1、说明、主次动作和 request ID 顺序稳定；页面无空白假账单表格。

### 390×844

- 单列：标题→说明→返回订阅→返回工作区→request ID。
- 按钮至少 44×44，考虑 safe area；长 request ID 可换行且无横向溢出。

### 键盘、焦点、Label 与读屏

- 旧路由加载完成后 H1 可程序聚焦；主动作具有清晰 accessible name。
- 503 使用 `role=alert`，Deferred/404 使用普通状态语义，不制造紧急感。
- 返回后焦点落到订阅页 H1；状态不用颜色或动画单独表达。
- 200% zoom、仅键盘、reduced motion 和屏幕阅读器下可完成退出。

## 10. 可自动化验收

- `DREAM-DEF-01`：订阅/Usage/模型路由的 DOM、Network schema 和文案无 price/currency/micro-USD/balance/top-up/payment/checkout/refund。
- `DREAM-DEF-02`：旧 payment 深链返回安全 404/Deferred 空状态，只提供返回订阅/工作区动作。
- `DREAM-DEF-03`：意外的 payment/amount 字段触发安全 503 合同错误，不透传、不渲染、不写入订阅对象。
- `DREAM-DEF-04`：Token 402 只显示 `availableTokens/requiredTokens/periodEnd`，不出现充值、付款或现金兜底。
- `DREAM-DEF-05`：production/dev/test 都不能通过旧 flag、Fake Adapter 或静态 fixture 显示付款成功。
- `DREAM-DEF-06`：loading/empty/401/402/403/404/409/429/503 与网络结果未知均准确恢复且不产生支付事实。
- `DREAM-DEF-07`：1440×1000 与 390×844 无 document overflow；H1 焦点、按钮 label、错误 alert、焦点归还和 200% zoom 通过。
