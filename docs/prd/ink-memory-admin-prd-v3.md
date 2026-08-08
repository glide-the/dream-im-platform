# Ink Memory Admin PRD v3 — Gateway 协议与完整报文纠偏

## 1. 产品目标

在不破坏 Gateway Key、Subscription、计费、Storage、RBAC 和 Story 的前提下，使 `/v1/messages` 与 `/v1/chat/completions` 成为可由官方 SDK 消费、可审计、可计费的真实增量 Gateway。v3 追加并覆盖 v2 中与 Gateway 日志、协议和流式有关的条款。

## 2. 功能需求

### 2.1 协议

- 支持 Anthropic/Anthropic、OpenAI/OpenAI 安全透传。
- 支持 Anthropic/OpenAI、OpenAI/Anthropic 显式 Adapter。
- Adapter 必须有请求 schema、请求/非流响应转换、流状态机、Usage、tool、stop/finish 与错误映射测试。
- `/v1/messages/count_tokens` 对 Anthropic Provider 调原生 API；对 OpenAI Provider 返回一致的 Gateway 输入估算，不伪造 Provider 精确计数。

### 2.2 流

- 首个有效上游 Event 可用后立即输出；不得等完整响应。
- 支持任意网络 Chunk 边界、backpressure、客户端 cancel、Provider timeout。
- 首字节前错误返回非 200 JSON；流开始后错误使用外部协议的 SSE error。
- Anthropic named event 与 OpenAI data-only chunk 严格隔离。

### 2.3 完整报文

- 主表只保留热查询摘要；完整请求、响应、事件存独立 PostgreSQL 表。
- 请求保留原始 JSON 文本及 JSONB；非流响应保留完整 JSON/文本；流响应按 sequence 保留完整下游 event。
- 保存字节数、SHA-256、Content-Type、白名单 Headers、Provider request ID、TTFT、总延迟和完成/中断状态。
- 已建立 `gateway_requests` 主行的预授权拒绝（限额、余额、订阅并发）也必须保存完整脱敏请求和协议正确的完整 JSON 错误响应，不能停在 `pending`。
- 429 限额拒绝必须在主表摘要保存窗口、计量单位、当前占用、本次预留、上限、请求前剩余和超出量；请求列表与详情默认可见，不得要求读取完整 Prompt。
- 429 诊断卡必须提供可实际解除拒绝的配置入口：Token 限额优先导航到 `/admin/gateway/rate-limits#platform-users-manager` 的用户默认 Token 上限，RPM 导航到用户—模型授权矩阵，并携带当前用户邮箱和模型筛选；同时提供模型覆盖与套餐权益检查入口。实时窗口是自动累加的用量事实，必须只读，不能通过篡改计数解除 429。
- Idempotency replay 不得覆盖第一次请求的原始报文；重放尝试只返回关联 Request ID。
- 捕获失败不得中断已开始的代理流，必须留下 capture failure 状态。

### 2.4 安全与隐私

- 认证、Cookie、Gateway/Provider secret 在持久化前固定脱敏。
- 完整报文读取需要 `gateway.payloads.read`，默认不加载并二次确认。
- 每次读取写不可变 Admin Audit，Audit 不复制内容。
- Copy 不触发 analytics；普通列表和 dashboard 不 join payload 表。
- 默认在线保留目标为 30 天。长期保存必须经过隐私、删除请求、归档加密和访问审计评审。

## 3. 管理端详情需求

请求详情桌面为右侧 Drawer（最大 860px），390×844 为全屏。内容顺序：

1. Request Summary。
2. User、Gateway Key prefix、Provider、Model。
3. Token、价格快照、Ledger。
4. 延迟、TTFT、错误和中断。
5. 受保护的完整报文入口。
6. 脱敏 Headers、请求 JSON/Raw Body。
7. 非流响应 JSON/Raw Body。
8. SSE sequence 时间线/表格与 Raw SSE。
9. Ledger/Audit 链接。

所有大内容局部滚动；document 不产生横向溢出。JSON/Raw SSE 使用只读等宽 Viewer，时间/bytes/sequence 使用 tabular mono，event type 使用状态标签。

## 4. 数据与权限

迁移新增 `gateway_request_payloads`、`gateway_response_payloads`、`gateway_response_events`，均以 `gateway_requests.id` 为真实 FK。事件唯一键为 `(gateway_request_id, sequence)`。

`gateway.payloads.read` 默认赋予 `super_admin` 与 `auditor`；`operator` 默认不授予。权限变更走现有 Access RBAC 与审计。

## 5. 计费规则

- 价格仍以 request 创建时 snapshot 为准，micro-USD，Ledger append-only。
- 仅可靠 final Usage 可完成结算。
- 首字节前明确未产生 Usage 的 4xx/429 可以释放预授权。
- 流中断且 Usage 未知时标记 `settlement_failed`，禁止按 0 自动成功结算。
- Payload persistence 与 billing transaction 解耦；payload 失败不能篡改 Usage 或账本。

## 6. 监控（增强项）

按 endpoint、外部协议、Provider 协议和模型采集 TTFT、P50/P95 event gap、stream interruption rate、client cancellation rate、protocol conversion failure rate、payload capture failure rate；标签不得含 Prompt、response 或完整 key。

## 7. 验收

验收以 `gateway-protocol-streaming-audit.md` 的命令证据为准。必须覆盖官方 Anthropic/OpenAI SDK contract、原生 fetch reader、`curl -N`、Mock Provider、隔离 PostgreSQL、预授权拒绝报文还原和 1440×1000/390×844 Playwright；真实外部 Provider 明确列为未执行，不能用 Mock 结果冒充。
