# Ink Memory 当前计费策略清单

> 文档类型：现状清单，不是目标 PRD，也不代表新增配置需求。  
> 核对日期：2026-08-09  
> 核对范围：Gateway 预授权、Token 限流、模型定价、订阅额度、余额结算和账本。  
> 事实来源：`app/lib/gateway/**`、`app/lib/billing/**`、`app/lib/subscriptions/**`、`app/lib/models/resolver.ts`、`app/lib/db/schema.ts` 与 PostgreSQL 迁移。

## 1. 结论摘要

当前系统同时存在三类概念，不能混为一谈：

| 概念 | 当前作用 | 是否减少本次现金余额扣费 |
|---|---|---|
| 用户／模型／套餐 Token 上限 | 限制某个时间窗口内最多可处理多少 Token；超限返回 429 | 否 |
| 订阅 Token 或金额额度 | 在订阅周期内抵扣 Gateway 用户费用；额度不足时按套餐超额策略处理 | 是，由订阅额度覆盖的部分不扣现金余额 |
| 账户余额 | 无订阅或订阅超额时用于 Gateway 预授权与实际扣费 | 否，实际费用从余额扣除 |

订阅额度抵扣的是应用 markup/discount 后的 Gateway 用户费用；Provider 原始成本仍单独记录在 Request，由平台对上游承担。

最容易误解的当前行为：

- 新 canonical 用户会自动获得一个 USD 计费账户，但初始可用余额是 `0`。
- 新建 `platform_users` 当前默认 `daily_token_limit = 100000`，月上限默认未设置。当前窗口实际按“每用户、每模型、UTC 日”分别计数。
- 每日 `100,000 Token` 是 429 限流上限，不是免费 Token，也不会给账户充值。
- 因此，新用户即使尚未达到每日 Token 上限，只要没有可覆盖本次请求的订阅额度且现金余额不足，Gateway 仍会返回 `402 INSUFFICIENT_BALANCE`。
- 订阅是否发放 Token 额度由已发布套餐版本的 `allowance_tokens` 决定；不是所有订阅都必然有 Token 额度。
- 当前没有“余额达到 10 元／10 美元后享受每日免费 Token”、平台补贴、每日免费 10,000 Token 或免费额度叠加策略。
- 当前计费币种固定为 USD，金额统一存为整数 micro-USD：`1 USD = 1,000,000 micro-USD`；系统没有人民币“10 元”门槛语义。

## 2. 用户与计费账户模块

### 2.1 用户开户

- canonical `users` 创建或更新时，PostgreSQL trigger 会同步内部 `platform_users` 身份。
- 同步过程会幂等创建一条 `billing_accounts`。
- 新计费账户默认值：
  - `currency = USD`
  - `available_microusd = 0`
  - `reserved_microusd = 0`
  - `lifetime_debited_microusd = 0`
- 新用户不会自动获得现金充值、试用金或平台补贴。
- Gateway Key 也不会因为用户开户自动发放；Key 需要单独创建并授予所需 scope。
- 因此，“新用户首次调用返回 402”以用户已经取得有效 Gateway Key，并已通过 scope、Model、Provider 和 Pricing 检查为前提。

### 2.2 用户默认 Token 上限

- 新建 `platform_users` 的每日 Token 上限当前默认是 `100,000`。
- 该数据库变更只设置列默认值，没有回填已存在用户；历史用户可能仍为 `NULL` 或保留人工配置值。
- `NULL` 表示该层不设置上限，`0` 表示该层不允许消费 Token。
- 月 Token 上限默认是 `NULL`。
- 这些字段只参与 429 限流判断，不参与余额或订阅额度计算。

## 3. 模型与价格模块

### 3.1 模型可调用条件

一次请求进入计费前，至少需要满足：

1. 平台用户状态为 `active`。
2. Gateway Key 有效、未过期、未撤销并包含目标 Route 所需 scope。
3. Model 已启用，Provider 状态为 `active`，Provider Credential 可用。
4. 若存在用户—模型权限记录，其 `enabled` 不能为 `false`。
5. 存在请求时刻有效的价格版本。
6. 若用户已有订阅，还必须满足订阅状态、套餐模型权益和订阅 scope 检查。

用户—模型权限记录不存在时，cash-only 兼容路径不会仅因“缺少显式权限记录”拒绝模型；但已有订阅的用户仍必须有该套餐版本对应的启用 Entitlement。

### 3.2 价格版本选择

- 价格按 `model_id`、用户 `tier`、状态和生效时间解析。
- 同一模型优先选择与用户 tier 精确匹配的价格；没有时使用 `default` tier。
- 同一优先级选择 `effective_from` 最新且当前仍有效的版本。
- 请求创建时保存以下不可变价格快照，后续调价不会改写历史请求：
  - input price
  - output price
  - cache read price
  - cache write price
  - markup bps
  - discount bps
- 找不到有效价格时返回 `503 MODEL_PRICING_UNAVAILABLE`，不会调用 Provider。

### 3.3 计价公式

四类 Token 分别按“每百万 Token 的整数 micro-USD 单价”计费，每个分项使用向上取整：

```text
provider_cost = input_cost + output_cost + cache_read_cost + cache_write_cost
marked_up     = ceil(provider_cost × (10000 + markup_bps) / 10000)
charged       = ceil(marked_up × (10000 - discount_bps) / 10000)
```

- `provider_cost_microusd` 表示按 Provider 价格快照计算的成本。
- `charged_microusd` 表示应用 markup 和 discount 后的用户费用。
- Anthropic input usage 采用 fresh input 语义，cache read/write 另计。
- OpenAI input usage 采用包含 cached input 的 total 语义，计价时会从普通 input 中扣除 cache bucket，避免重复收费。

## 4. Gateway 预授权模块

### 4.1 预估 Token

请求在调用 Provider 前计算：

```text
estimated_tokens = estimated_input_tokens + effective_max_output_tokens × output_choices
```

- `effective_max_output_tokens` 不能超过模型配置的最大输出 Token。
- OpenAI 多 choice 请求会按 choice 数量放大输出预估。
- Token 上限检查与订阅额度预留均使用该预估值，不等待实际 Usage。

### 4.2 预估金额

现金预授权金额使用预估 input、最大 output 和当前价格快照计算：

```text
reservation = max(estimated_charge, GATEWAY_MIN_RESERVE_MICROUSD)
```

- `GATEWAY_MIN_RESERVE_MICROUSD` 默认是 `0`。
- 若最终需要现金覆盖且 `available_microusd < reservation`，返回 `402 INSUFFICIENT_BALANCE`。
- 402 在调用 Provider 前产生，因此不会产生 Provider 成本。
- 如果最终现金预授权为 `0`，零余额本身不会阻止请求。

### 4.3 当前判断顺序

当前主要顺序如下：

```text
Gateway 鉴权
→ Model / Provider / Pricing 解析
→ 创建 gateway_requests 与价格快照
→ 解析订阅及其额度覆盖方式
→ 检查 Token / RPM 窗口
→ 预留订阅额度
→ 预留仍需现金覆盖的余额
→ 调用 Provider
→ 按可靠 Usage 结算
```

这会产生两个重要结果：

- 无订阅用户通常先检查限流，再做现金预授权；未超限但余额为 0 时返回 402。
- 已订阅用户若套餐 `overage_policy = deny` 且订阅额度无法覆盖预估请求，会在限流检查前返回 `402 SUBSCRIPTION_ALLOWANCE_EXHAUSTED`。

## 5. Token 限流模块

### 5.1 生效值

Runtime 会对以下已存在的限额取最小值：

- 用户默认 daily/monthly Token limit。
- 用户—模型权限覆盖的 daily/monthly Token limit。
- 当前订阅模型 Entitlement 的 daily/monthly Token limit。

未设置的层不参与取最小值。达到有效上限时：

- 日 Token：`429 DAILY_TOKEN_LIMIT_EXCEEDED`
- 月 Token：`429 MONTHLY_TOKEN_LIMIT_EXCEEDED`
- 分钟请求数：`429 REQUEST_RATE_LIMIT_EXCEEDED`

429 客户端响应会返回 `limit`、`current`、`requested`、`remaining`、`exceeded_by`、窗口和指标；同一组诊断也会写入对应 `gateway_requests.response_summary`，并在 Request 详情中展示。该路径不会调用 Provider。

### 5.2 窗口和计数口径

- 窗口使用 UTC：分钟、UTC 自然日、UTC 自然月。
- 数据按 `platform_user_id + model_id + window_type + window_start` 保存。
- 因此，即使数字来自“用户默认上限”，当前实际计数仍是“每用户、每模型”窗口，不是跨全部模型聚合的用户总量。
- 预授权时先按 `estimated_tokens` 占用日/月计数。
- 获得可靠 Usage 后，再以 `actual_tokens - estimated_tokens` 修正计数。
- Anthropic 的实际总量为 fresh input、cache read、cache write 与 output 之和。
- OpenAI 的实际总量为已包含 cache 的 input 加 output，不重复累加 cache。

### 5.3 RPM 当前边界

- 数据模型与 Runtime 仍支持用户—模型权限和订阅 Entitlement 中已存在的 `requests_per_minute` 值。
- RPM 未设置时不创建分钟限流约束。
- 当前 Admin 不开放 RPM 业务字段配置；实时窗口只读，不能通过修改计数解除 429。
- 本文不新增 RPM 产品设计或配置入口。

## 6. 订阅模块

### 6.1 套餐版本包含的计费字段

已发布 Plan Version 固化：

- billing period：monthly 或 annual
- base price
- trial days / grace period days
- allowance tokens
- allowance micro-USD
- overage policy：`deny` 或 `cash_balance`

Plan Version 发布后作为历史快照使用；后续变更应创建新版本。

### 6.2 基础订阅费

- 非试用激活会立即从计费账户扣除 base price。
- 试用激活不会立即扣除 base price。
- renew 和 upgrade 动作会按目标版本扣除 base price。
- 基础费余额不足时返回 `402 SUBSCRIPTION_BALANCE_INSUFFICIENT`，事务不完成。
- 当前代码中的 renew 是显式生命周期动作；本文不把它描述为已经存在的自动续费调度器。

### 6.3 周期额度发放

- 激活、renew 或 upgrade 创建当前周期 `subscription_usage_allowances`。
- `granted_tokens` 来自 Plan Version 的 `allowance_tokens`。
- `granted_microusd` 来自 Plan Version 的 `allowance_microusd`。
- 额度分别维护 `granted / reserved / consumed`，并通过数据库约束保证不会超发。
- Token 额度和金额额度是两套不同的量纲，不互相改写。
- 一条额度记录属于“订阅 + 当前 period”，不是按 Model 或 Entitlement 分池；同一订阅下所有获准模型共享该周期额度。
- monthly 版本的额度覆盖一个月度 period，annual 版本覆盖一个年度 period；当前没有把 annual 额度再按月重置的逻辑。
- upgrade 会从操作时刻开始一个目标版本的新 period 并创建新额度，不做按比例折算；旧额度行保留为历史事实。downgrade 只写入 pending version，待后续 renew 时生效。

所以“订阅会不会发 Token 额度”的准确答案是：只有该订阅绑定的已发布 Plan Version 配置了大于 0 的 `allowance_tokens` 时才会发放。

### 6.4 Gateway 覆盖优先级

订阅请求当前按以下顺序选择覆盖方式：

1. 若 Token 额度大于 0，且剩余 Token 足以覆盖整个 `estimated_tokens`，使用 `token_allowance`，本次不预留现金。
2. 否则，若金额额度大于 0 且还有剩余，使用 `money_allowance`；金额额度可覆盖一部分，其余部分按超额策略处理。
3. 否则使用 `cash_only`。

Token 额度不足以覆盖整个预估请求时，不会局部消耗该 Token 额度；系统会继续尝试金额额度或现金路径。

### 6.5 超额策略

- `deny`：只要预估仍需要现金覆盖，就返回 `402 SUBSCRIPTION_ALLOWANCE_EXHAUSTED`。
- `cash_balance`：订阅额度覆盖一部分后，对剩余预估金额执行账户余额预授权；余额不足则返回 `402 INSUFFICIENT_BALANCE`。
- 没有任何订阅记录的用户进入现有 cash-only 兼容路径。
- 已存在但 paused、cancelled、expired 等不可调用订阅不会回退到 cash-only，而是返回对应 403。
- Gateway 当前只解析该用户按创建时间排序的最新一条订阅；不会跳过最新的不可调用订阅去寻找更早订阅。

## 7. 结算与账本模块

### 7.1 有可靠 Usage

获得可靠最终 Usage 后，系统在事务中：

1. 使用请求创建时的价格快照计算 Provider 成本与用户费用。
2. 将已预留的订阅额度转为 consumed。
3. 从现金预授权中 capture 实际现金收费。
4. release 未使用的现金预授权。
5. 将日/月 Token 计数从预估值修正为实际值。
6. 写回四类 Token、Provider cost、charged、状态、延迟和上游 request ID。
7. 写入幂等、只追加 Ledger。

常见 Ledger 类型包括 `credit`、`reserve`、`capture`、`release`、`allowance_capture` 和 `subscription_charge`。账本记录变更前后可用／预留余额；不通过更新或删除历史条目纠错。

如果实际现金收费超过预授权，额外差额仍会被记为账户扣款。账户可能变成负余额；出现 overdraft 时，活跃平台用户会被置为 `suspended`，从而阻止后续 Gateway 调用。

### 7.2 Usage 不可靠或缺失

- 流或非流响应缺少可靠 Usage 时，不会把 Usage 猜成 0。
- Request 标记为 `settlement_failed`，保留错误和当前预授权，供人工调查或未来恢复实现处理；本文不假定已有自动恢复 worker。
- 当前实现不会在该路径自动释放现金预授权、订阅预留或已占用的预估 Token 计数。
- 已确认“没有产生计费”的 Provider 拒绝错误会使用零 Usage 正常结算并释放预授权；当前明确包含上游限流、请求拒绝和凭据拒绝。
- 已经获得部分或最终可计费 Usage 的失败／取消请求，会按已知 Usage 结算，而不是免费处理。

## 8. 错误与业务含义

| HTTP | 典型错误码 | 当前业务含义 | Provider 是否已调用 |
|---|---|---|---|
| 401 | `GATEWAY_API_KEY_REQUIRED` / `GATEWAY_API_KEY_INVALID` | Gateway Key 缺失、无效、过期或已撤销 | 否 |
| 402 | `INSUFFICIENT_BALANCE` | 需要现金预授权，但可用余额不足 | 否 |
| 402 | `SUBSCRIPTION_ALLOWANCE_EXHAUSTED` | 订阅额度无法覆盖预估请求，且 overage 为 deny | 否 |
| 402 | `SUBSCRIPTION_BALANCE_INSUFFICIENT` | 激活／续订／升级的基础订阅费余额不足 | 不适用 |
| 403 | `SUBSCRIPTION_*` / `MODEL_PERMISSION_DENIED` | 订阅状态、模型权益、scope 或模型授权不允许调用 | 否 |
| 409 | `SUBSCRIPTION_ALLOWANCE_NOT_READY` / `SUBSCRIPTION_ALLOWANCE_CONFLICT` | 周期额度未建立或并发预留冲突 | 否 |
| 429 | `DAILY_TOKEN_LIMIT_EXCEEDED` / `MONTHLY_TOKEN_LIMIT_EXCEEDED` / `REQUEST_RATE_LIMIT_EXCEEDED` | 已配置的 Token/RPM 窗口不足以容纳本次预估请求 | 否 |
| 502 | `UPSTREAM_USAGE_MISSING` | Provider 响应或流结束，但没有可靠最终 Usage | 是，Request 保持 settlement_failed |
| 503 | `MODEL_PRICING_UNAVAILABLE` / `BILLING_SETTLEMENT_UNAVAILABLE` | 定价配置缺失或结算不可用 | 视阶段而定 |

`/v1/messages?beta=true` 的 query 本身不改变上述计费或限流策略。出现 429 时，应以该 Request 保存的 `error_code` 和 limit/current/requested/remaining 明细判断是日 Token、月 Token 还是已有 RPM 策略，而不是从 URL 推断原因。

## 9. 当前 Admin 查询入口

以下入口用于查看或维护已经存在的计费事实与产品配置，不代表新增免费策略：

| 目的 | Admin 路径 | 当前能力 |
|---|---|---|
| 模型价格版本 | `/admin/models/pricing` | 创建／结束版本化四类 Token 价格 |
| 用户默认 Token 上限 | `/admin/gateway/rate-limits` | 查看并进入用户默认 daily/monthly Token 上限；实时计数只读 |
| 用户—模型 Token 覆盖 | `/admin/models/permissions` | 模型启停和 daily/monthly Token 覆盖；RPM 字段不开放 |
| 套餐与版本 | `/admin/subscriptions/plans`、`/admin/subscriptions/versions` | 管理 base price、周期额度与 overage policy |
| 套餐模型权益 | `/admin/subscriptions/entitlements` | 配置 scope、daily/monthly Token 与 Storage 上限；RPM 字段不开放 |
| 用户订阅生命周期 | `/admin/subscriptions/users` | 激活、renew、upgrade、downgrade、pause、resume、cancel |
| 账户余额 | `/admin/billing/accounts` | 查看 available/reserved/lifetime debited；受控调账写 Ledger |
| 使用与费用 | `/admin/billing/usage` | 查看 Request、Usage、Provider 成本与用户收费 |
| 不可变账本 | `/admin/billing/ledger` | 查询 reserve/capture/release/allowance/subscription 链路 |
| 429 实时窗口 | `/admin/gateway/rate-limits` | 查看分钟／日／月窗口计数，不允许直接编辑或清零 |

## 10. 明确未实现的策略

为避免运营、开发和客服把讨论方案误认为线上事实，当前系统**没有**以下行为：

- 余额为 0 时由平台承担 Provider 成本。
- 每日免费 10,000 Token 或其他平台赞助日额度。
- 余额达到“10 元”或“10 美元”后自动解锁免费 Token。
- 免费日额度与订阅额度叠加。
- 达到免费额度后专门返回一类“赞助额度 429”。
- 新用户自动充值或自动发 Gateway Key。
- 通过修改实时 `gateway_rate_limits` 计数解除限流。
- Admin 中的 RPM 业务字段配置入口。

这些方案不属于本文现状范围；不能把 `daily_token_limit` 解释成或直接复用为免费额度。

## 11. 代码事实索引

- 用户与计费账户 schema：`app/lib/db/schema.ts`
- canonical 用户自动开户：`drizzle/0015_platform_users_are_billable.sql`
- 新用户每日 Token 默认值：`drizzle/0016_default_new_user_daily_tokens.sql`
- Gateway 鉴权与用户上限：`app/lib/gateway/auth.ts`
- 模型权限与定价解析：`app/lib/models/resolver.ts`
- 预估与请求准备：`app/lib/gateway/prepare.ts`
- 限流、订阅与现金预留顺序：`app/lib/gateway/repository.ts`
- 四类 Token 计价：`app/lib/billing/money.ts`
- 账户预授权和结算：`app/lib/billing/accounting.ts`、`app/lib/billing/repository.ts`
- 订阅覆盖选择与额度结算：`app/lib/subscriptions/gateway.ts`
- 订阅激活、续订和周期额度：`app/lib/subscriptions/service.ts`
- Usage 解析与计数语义：`app/lib/gateway/usage.ts`
- 缺失 Usage 的处理：`app/lib/gateway/lifecycle.ts`、`app/lib/gateway/proxy-handler.ts`
