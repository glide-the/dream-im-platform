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
| 订阅 Plan + Bonus Token 额度 | 在用户个人月度周期内覆盖 Gateway Token；不足返回 Token 专用 402 | 有效订阅请求不扣现金 |
| 账户余额 | 仅供显式独立 cash-only Gateway／调账等兼容领域使用 | 只影响独立现金路径，不兜底订阅 Token |

订阅额度抵扣的是应用 markup/discount 后的 Gateway 用户费用；Provider 原始成本仍单独记录在 Request，由平台对上游承担。

最容易误解的当前行为：

- 新 canonical 用户会自动获得一个 USD 计费账户；当默认 Free Plan/Version/Entitlement 已正确发布时，还会幂等开通 Free 月度订阅和本周期 Token Allowance。
- `gateway-default-token-limits-v1` 统一规定 `platform_users.daily_token_limit = 1000000000`、`monthly_token_limit = 10000000000`；新用户由 schema 默认继承，现有用户通过显式数据 runner 回填。当前窗口实际按“每用户、每模型、UTC 日／自然月”分别计数；这些值只决定 429，不发放订阅 Token。
- 每日 `100,000 Token` 是 429 限流上限，不是免费 Token，也不会给账户充值。
- 因此，有效订阅用户即使现金余额为正，只要当前周期 `Plan + Bonus` Token 不足，Gateway 仍返回 `402 SUBSCRIPTION_TOKEN_ALLOWANCE_EXHAUSTED`；现金不兜底。
- 订阅基础额度由已发布套餐版本的 `allowance_tokens` 决定；管理员还可使用独立 `subscriptions.grant` 权限一次性补发当前周期 Bonus Token。
- 当前没有“余额达到 10 元／10 美元后享受每日免费 Token”、平台补贴、每日免费 10,000 Token 或免费额度叠加策略。
- 当前计费币种固定为 USD，金额统一存为整数 micro-USD：`1 USD = 1,000,000 micro-USD`；系统没有人民币“10 元”门槛语义。

## 2. 用户与计费账户模块

### 2.1 用户开户

- canonical `users` 创建或更新时，PostgreSQL trigger 会同步内部 `platform_users` 身份。
- 同步过程会幂等创建一条 `billing_accounts`。
- 默认 Free 产品已经发布且具备默认模型权益时，同一用户创建事务还会幂等建立 Free 月度 Subscription、首周期 Allowance 和 activation event；产品种子未就绪时 provisioner 安全 no-op，不创建半套订阅。
- 新计费账户默认值：
  - `currency = USD`
  - `available_microusd = 0`
  - `reserved_microusd = 0`
  - `lifetime_debited_microusd = 0`
- 新用户不会自动获得现金充值；Free Subscription Token 不是现金，也不能从 Billing Account 提现或折算。
- Gateway Key 也不会因为用户开户自动发放；Key 需要单独创建并授予所需 scope。
- 新用户首次调用若返回 402，应先核对默认 Free Subscription 是否已 provision、当前周期总额与请求预留估算；不能只看现金余额或每日安全上限。

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

当前可发布 Plan Version 固化为个人月度周期，只包含整数 micro-USD 月费、trial/grace 参数和 `allowance_tokens`。`billing_period` 固定为 `monthly`，`allowance_microusd=0`、`overage_policy=deny`、`effective_from=NULL`；发布后不可覆盖，后续套餐变更必须创建新版本并在用户下一个周期边界生效。

### 6.2 订阅资格与现金边界

- Token 订阅与 Billing Account 是两个独立领域。有效 Subscription 的 Gateway 请求只使用 Token Allowance，不因现金余额为正而自动超额调用。
- 付费版本通过 Payment Intent/Webhook 建立或续期；Gateway 不在单次请求中扣基础订阅费。
- 无有效 Subscription 的显式 cash-only Gateway 兼容路径仍可独立存在，但不能作为 Token 套餐耗尽后的 fallback。

### 6.3 周期额度发放

- 激活和实际个人周期边界（包括合法 renew/续费推进）创建当前周期 `subscription_usage_allowances`；upgrade/downgrade 只排队到下周期。
- `granted_tokens` 来自 Plan Version 的 `allowance_tokens`，在该周期内不可变。
- `bonus_granted_tokens` 只来自管理员“补发本周期 Token”命令，单调增加且不继承到下周期。
- 可用总额为 `granted_tokens + bonus_granted_tokens`；额度维护 `reserved / consumed`，数据库约束保证 `reserved + consumed` 不超过可用总额。
- 补发必须使用 `subscriptions.grant`、正整数数量、原因、幂等键和 Allowance optimistic version，并同时产生不可变 `subscription_token_grants`、Subscription Event 与 Admin Audit。
- `granted_microusd/reserved_microusd/consumed_microusd` 仅为历史兼容列，新 Token-only 流程固定为 0。
- 一条额度记录属于“订阅 + 当前 period”，不是按 Model 或 Entitlement 分池；同一订阅下所有获准模型共享该周期额度。
- 额度覆盖用户自己的月度 period。upgrade/downgrade 都只写 pending version，到下个个人周期边界生效；不会重开当前周期或补发 Token。

所以“订阅会不会发 Token 额度”的准确答案是：只有该订阅绑定的已发布 Plan Version 配置了大于 0 的 `allowance_tokens` 时才会发放。

### 6.4 Gateway 覆盖优先级

订阅请求当前按以下顺序选择覆盖方式：

1. 有可调用 Subscription 时，验证 Plan Version、Model Entitlement、Gateway scope 与当前个人周期。
2. 计算 `available = granted_tokens + bonus_granted_tokens - reserved_tokens - consumed_tokens`。
3. `available >= estimated_tokens` 时原子预留完整估算 Token；Provider 返回可靠 Usage 后 capture 实际 Token 并 release 差额。
4. 不足时返回 402 `SUBSCRIPTION_TOKEN_ALLOWANCE_EXHAUSTED`，包含 `available_tokens/required_tokens/period_end`，不调用 Provider、不预留现金。

`estimated_tokens` 是请求输入估算加允许的最大输出，因此可能高于最终实际 Usage。这是防止超发的预授权规则；运营若决定承担本周期额外 Provider 成本，应使用明确的补发动作，调高每日/每月限流不会增加订阅额度。

### 6.5 402 与 429 的配置边界

- 402 `SUBSCRIPTION_TOKEN_ALLOWANCE_EXHAUSTED`：当前周期订阅 Token 不足。唯一额度写入口是“订阅 → 用户订阅 → 更多操作 → 补发本周期 Token”；限流页用户行提供携带邮箱的直达导航，但不会在限流资源上写额度。也可等待个人周期重置或安排下周期版本。
- 429：RPM、每日 Token 或月度安全窗口达到阈值。唯一配置入口是“Gateway → 限流策略”；这些字段不是免费 Token 发放。
- 现金余额为正不会解除 402；补发 Token 也不会抬高 429 限流窗口。
- paused、cancelled、expired 等不可调用订阅返回对应 403，不回退现金路径。

## 7. 结算与账本模块

### 7.1 有可靠 Usage

获得可靠最终 Usage 后，系统在事务中：

1. 使用请求创建时的价格快照计算 Provider 成本；订阅 Token 覆盖请求的用户现金收费固定为 0。
2. 将已预留的订阅 Token 按可靠实际 Usage 转为 consumed。
3. release 预留与实际 Usage 的 Token 差额。
4. 只有显式独立 cash-only 请求才 capture/release 现金预授权。
5. 将日/月 Token 计数从预估值修正为实际值。
6. 写回四类 Token、Provider cost、charged、状态、延迟和上游 request ID。
7. 写入幂等、只追加的 Token Ledger；现金 Ledger 仅属于独立现金路径。

Token Ledger 的新请求类型为 `reserve/capture/release`，保存请求内 sequence 和 available/reserved/consumed 前后快照；补发记录单独保存在 `subscription_token_grants`。历史金额 Ledger 保留，不把旧 `allowance_capture/subscription_charge` 继续写入新 Token-only 订阅请求。

### 7.2 Usage 不可靠或缺失

- 流或非流响应缺少可靠 Usage 时，不会把 Usage 猜成 0。
- Request 标记为 `settlement_failed`，保留错误和当前预授权，供人工调查或未来恢复实现处理；本文不假定已有自动恢复 worker。
- 当前实现不会把缺失 Usage 猜成零结算；预留保持为失败事实，交由明确的 settlement/reconciliation 路径处理。
- 已确认“没有产生计费”的 Provider 拒绝错误会使用零 Usage 正常结算并释放预授权；当前明确包含上游限流、请求拒绝和凭据拒绝。
- 已经获得部分或最终可计费 Usage 的失败／取消请求，会按已知 Usage 结算，而不是免费处理。

## 8. 错误与业务含义

| HTTP | 典型错误码 | 当前业务含义 | Provider 是否已调用 |
|---|---|---|---|
| 401 | `GATEWAY_API_KEY_REQUIRED` / `GATEWAY_API_KEY_INVALID` | Gateway Key 缺失、无效、过期或已撤销 | 否 |
| 402 | `INSUFFICIENT_BALANCE` | 需要现金预授权，但可用余额不足 | 否 |
| 402 | `SUBSCRIPTION_TOKEN_ALLOWANCE_EXHAUSTED` | 当前个人周期 Plan + Bonus Token 无法覆盖完整预估请求 | 否 |
| 403 | `SUBSCRIPTION_*` / `MODEL_PERMISSION_DENIED` | 订阅状态、模型权益、scope 或模型授权不允许调用 | 否 |
| 409 | `SUBSCRIPTION_ALLOWANCE_NOT_READY` / `SUBSCRIPTION_ALLOWANCE_VERSION_CONFLICT` | 周期额度未建立，或补发/预留时额度已并发变化 | 否 |
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
| 用户—模型 Token 覆盖 | `/admin/gateway/rate-limits#user-model-permissions-manager` | 用户—模型例外禁用和 daily/monthly Token 收紧；RPM 字段不开放 |
| 套餐与版本 | `/admin/subscriptions/plans`、`/admin/subscriptions/versions` | 管理月费快照与每周期 Plan Token；不配置 money allowance/cash overage |
| 套餐模型权益 | `/admin/subscriptions/entitlements` | 配置 scope、daily/monthly Token 与 Storage 上限；RPM 字段不开放 |
| 用户订阅生命周期与补发 | `/admin/subscriptions/users` | 生命周期动作；有 `subscriptions.grant` 时可补发当前周期 Bonus Token |
| Token 流水 | `/admin/subscriptions/token-ledger` | 查看不可变补发记录及 Gateway reserve/capture/release 流水 |
| 账户余额 | `/admin/billing/accounts` | 查看 available/reserved/lifetime debited；受控调账写 Ledger |
| 使用与费用 | `/admin/billing/usage` | 查看 Request、Usage、Provider 成本与用户收费 |
| 不可变账本 | `/admin/billing/ledger` | 查询 reserve/capture/release/allowance/subscription 链路 |
| 429 实时窗口 | `/admin/gateway/rate-limits` | 查看分钟／日／月窗口计数，不允许直接编辑或清零 |

## 10. 明确未实现的策略

为避免运营、开发和客服把讨论方案误认为线上事实，当前系统**没有**以下行为：

- 基于余额为 0/正数自动发放免费 Token 的条件策略。
- 每日免费 10,000 Token 或其他平台赞助日额度。
- 余额达到“10 元”或“10 美元”后自动解锁免费 Token。
- 自动的每日免费额度与订阅额度叠加；当前只有明确的本周期人工 Bonus grant。
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
