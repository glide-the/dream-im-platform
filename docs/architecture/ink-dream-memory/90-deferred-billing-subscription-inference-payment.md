# 延期入口：Payment/订阅支付与 ASR Gateway

> 文档状态：**Deferred**（Payment/订阅支付、ASR Gateway）/ **Superseded**（Round 24–28 全面延期历史）
> 返回：[总索引](README.md)
> 当前 Planned：[Token-only Subscription/Gateway](06-billing-subscription-gateway-integration.md) · [Dream 集成](07-dream-subscription-and-inference-integration.md)
> Deferred 细则：[Payment/订阅支付](08-payment-adapter-and-webhook-boundary.md)
> 主要读者：产品、架构、发布负责人、历史审计

## 1. 范围变更

Round 24–28 曾把 Billing、Subscription、Gateway、新推理链与支付全部标为 Deferred。Round 29 的证据化审计与 Round 30 范围重启已经替代该决定：

| 能力 | 当前状态 | 说明 |
|---|---|---|
| Dream 43+5 PostgreSQL 全量迁移 | **Planned** | Dream-owned Alembic/Repository/迁移/validator；PG-only runtime |
| canonical 用户与内部投影 | **Planned**（现有 projection 为 Partial） | 所有 `users` 天然是订阅主体；无“计费用户”名册/开户流程 |
| Token Plan/Version/Entitlement/Subscription | **Planned end-to-end**（Admin workspace 已完成 Token-only Partial，隔离 PG/E2E 待验证） | 固定用户月度 Token 规则；无套餐价格、金额额度、cash overage、全局 effective window |
| Token Allowance/Gateway/Usage | **Planned end-to-end**（Admin workspace 已完成 Token-only resolver/settlement Partial） | 完成隔离 PG 的严格资格、并发 Token reserve/capture/release 与终态门禁；耗尽不自动切现金 |
| Provider Pricing/现金 Billing/Ledger | **独立 Current/Partial** | 保留独立历史/按量域；不是套餐权益或 Token fallback，本轮不扩展支付能力 |
| Dream 真实订阅/用量/模型体验 | **Planned** | 删除静态套餐与模型 fallback，只显示用户周期、Token 与模型权限 |
| 文本及已声明 capability 的推理 Gateway | **Planned** | PolyAgent、Claude Agent/Chat、Dream/Workflow 分批 canary |
| PaymentAdapter/Webhook/Fake/订阅支付 | **Deferred** | 当前不创建接口、表、路由、环境变量、测试支付或 UI |
| 真实第三方支付渠道 | **Deferred** | Stripe/支付宝/微信/银行等均未指定 |
| ASR Gateway | **Deferred** | Gateway 尚无 streaming-audio capability、计量与结算合同 |

因此，本文件不能再被引用为“Token-only Subscription/Gateway 全部延期”的依据；同时也不能把 PaymentAdapter 误列为当前 Planned 或 Subscription release dependency。

## 2. 当前 Deferred：Payment、订阅支付与真实渠道

本轮不实现或调用：

- 渠道无关 `PaymentAdapter`、capability、intent/refund/reversal contract、Webhook event store/幂等与 Fake test adapter。
- Stripe、支付宝、微信支付、银行或其他真实 Adapter/API/SDK。
- 生产商户开户、收银台、真实二维码/卡号输入、真实 Webhook endpoint 配置。
- 渠道特定对账、税务、发票、争议/chargeback 自动化和生产退款网络。
- 使用真实或 Fake 支付流程开通/续费 Token Subscription。

本轮不以“预留边界”为由创建空 Adapter、表、Route 或 Fake。Token-only Subscription 不等待支付、不扣款、不进入 `past_due`，其开通与月度周期推进必须在 Payment 组件完全不存在时工作。完整边界见 [08](08-payment-adapter-and-webhook-boundary.md)。

### 转 Planned 的最低条件

1. 指定渠道、商户主体、结算货币/地区、税务/发票、退款/争议与客服责任。
2. 完成渠道 SDK/API、安全、隐私、数据驻留、Webhook、reconciliation 与 SLA 评审。
3. 该渠道 Adapter capability 与平台核心模型映射明确，不把第三方字段提升为平台必填真值。
4. 隔离 sandbox、密钥轮换、生产审批、监控和 rollback runbook 可执行。
5. 产品明确 Payment 服务的独立商品/现金域；若要改变 Token-only Subscription 的无价格决策，必须另开版本化 PRD 与迁移。

## 3. 当前真正 Deferred：ASR Gateway

ASR 仍 Deferred 只指“通过计费 Gateway 路由/计量/结算 streaming audio”，不表示当前匿名 endpoint 可以继续发布。

### 当前 P0 处置（不是 Deferred）

- `backend/speech_recognition.py` 的已提交 Provider credential 必须由密钥所有者吊销/轮换、从代码移除并通过 secret scan；本文不复述该值。
- `/ws/speech-recognition` 在发布前默认禁用，或完成 canonical Session 鉴权、WebSocket Origin allowlist、连接/RPM/时长限制、取消与审计。
- server-side Secret 不得进入浏览器、普通数据库字段、响应或日志。

### ASR Gateway 转 Planned 的最低条件

1. Gateway capability registry 明确支持 streaming audio/ASR。
2. 输入时长/字节/音频 token、输出 token/字符等计量单位和 pricing snapshot 合同确定。
3. reserve/capture/release、断线、partial transcript、Provider usage 缺失和重连幂等语义确定。
4. WebSocket/SSE 协议、backpressure、cancel、rate limit、retention 与隐私评审完成。
5. entitlement/model permission/allowance/ledger 与错误合同可自动测试。

在这些条件满足前，“endpoint 已鉴权”也不能被标为“ASR Gateway Implemented”。

## 4. 仍然禁止的伪实现

- 静态套餐、套餐价格、金额额度、假余额、默认 model array 或 503 时的本地真值 fallback。
- 浏览器持有 Gateway Key、Provider Secret、Payment Secret 或服务间凭据。
- 显示支付、充值、自动续费扣款、正式第三方账单或测试支付入口。
- 在本轮实现 PaymentAdapter、Webhook event store、Fake Adapter 或渠道 SDK。
- 把现有 Token metadata 当作已经结算的 Token Usage，或把 Token 换算成金额 allowance/Ledger。
- 为了回滚 Gateway 而绕过资格直接调用 Provider，或在 Token 耗尽时自动进入现金按量。
- 在未具备 audio capability 前把匿名/鉴权 ASR 请求记成 Gateway 结算成功。

## 5. 历史资料的使用方式

[旧 Dream 订阅改造清单](../ink-dream-subscription-integration-change-list.md) 与旧 Gateway/PG 混合文档只是历史输入。当前实施必须从以下入口进入：

- [PG 全量迁移](04-postgresql-migration-plan.md)
- [Token-only Subscription/Gateway 架构](06-billing-subscription-gateway-integration.md)
- [Dream 产品与推理集成](07-dream-subscription-and-inference-integration.md)
- [Deferred Payment/订阅支付](08-payment-adapter-and-webhook-boundary.md)
- [发布与回滚](05-release-rollout-and-rollback.md)

历史 API 名、环境变量、页面与上线顺序若与当前入口冲突，以当前入口和代码事实为准。

## 6. Deferred 验收

- PaymentAdapter/Webhook/Fake/真实渠道的依赖、表、Route、环境变量、网络调用和 UI 均为 0。
- Subscription Plan/Version/Context 不含 price/currency/micro-USD allowance/cash overage/payment/effective window。
- ASR Gateway 没有被列入 Planned/Implemented；P0 credential/匿名 endpoint 安全处置仍是当前 release gate。
- Token-only Subscription、独立 Pricing/Billing、文本/受支持媒体 Gateway 与 Dream 产品 API 不被误标为 Deferred；Payment/订阅支付保持 Deferred。
