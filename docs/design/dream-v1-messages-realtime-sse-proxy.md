# Dream `/v1/messages` 实时 SSE 代理设计

> 状态：已实现
> 日期：2026-08-10（Asia/Shanghai）
> 范围：`app/v1/messages`、`app/lib/gateway`、Gateway focused tests

## 1. 背景与问题

Dream 通过 Claude Code / Anthropic Messages 兼容入口调用本项目的
`POST /v1/messages?beta=true`。现场日志显示一次请求约 4.3 秒、另一次约
12.5 秒，并夹有 `HEAD /api/hello 404`。客户端表现为首个请求没有持续收到
SSE，后续请求或流结束附近才出现数据。

目标是保证首个 Messages 请求在上游事件到达后立即下发，不依赖健康探测、
预热、第二个请求或固定延时，并保证请求隔离、取消传播和有界内存。

## 2. 证据与根因

### 2.1 已证实事实

1. Route Handler 仅调用 `handleAnthropicMessages()`；鉴权、适配、Provider
   transport、SSE parser 和生命周期均位于 `app/lib/gateway/**`。
2. 当前流状态是函数内请求级变量。没有模块级 controller、共享 reader、共享
   `ReadableStream`、单例 emitter 或 12 秒轮询器。
3. `parseSseStream()` 使用增量 `TextDecoder` 和跨 chunk buffer；现有测试已证明
   分片 event、单 chunk 多 event、CRLF 和 EOF 尾帧处理。
4. 流分支不会调用 `response.text()` / `response.json()`；完整读取只存在于预流式
   Provider HTTP 错误和明确的非流式分支。
5. Claude Code 的连通性预检会访问 Anthropic API origin 的 `/api/hello`。本项目
   没有该路由，因此 404 是外部客户端探测，不是 SSE producer 的启动信号。
6. Next 16 自带的 compression middleware 会压缩可压缩响应；只有
   `Cache-Control` 包含 `no-transform` 时才明确跳过压缩。`text/event-stream`
   属于可压缩类型。

### 2.2 可重复实验

使用仓库当前 Next 16 内置 compression middleware，服务端先写一个小 SSE frame，
300ms 后写终帧：

| 响应头 | Content-Encoding | 首个解压事件 | 流完成 |
|---|---|---:|---:|
| `Cache-Control: no-cache` | gzip | 327ms | 328ms |
| `Cache-Control: no-cache, no-transform` | identity | 2ms | 304ms |

实验表明缺少 `no-transform` 会让小事件留在 gzip 缓冲区，直到后续数据或流完成。
现场的 12.5 秒 Next 日志是请求/流完成总时长，不是 TTFB 指标；若整个响应被压缩
缓冲，客户端会把该总时长误认为首事件延迟。

### 2.3 根因结论

直接根因是流响应只有 `no-cache`，未禁止 Next / 反向代理转换，导致 SSE 被 gzip
缓冲。`/api/hello` 404 与流启动没有因果关系；第二个请求也不会唤醒另一个请求的
request-local Web Stream。它们与第一个流结束或产生更多网络活动时间接近，形成了
观察上的相关性。

同时审计发现两个生命周期风险并一并修复：

- 遇到 OpenAI `[DONE]` 时 iterator 未显式结束，reader lock 可能保留到 GC；
- payload capture 使用无限增长的 Promise chain，数据库慢于流时会无界保留事件闭包。

### 2.4 已排除假设

- 不存在跨请求共享流或全局队列；
- producer 不在 consumer 建立前使用共享 controller 发送；
- 流分支不等待完整上游 body；
- 没有 12 秒 debounce、poll、heartbeat 或 batch interval；
- `stream: true`、受限 `beta=true|1` query、Anthropic 兼容 headers 已向上游传播；
- Next 首次编译可能增加路由进入时间，但不能解释一个已开始的 SSE 被整流交付。

## 3. 异常与目标交互

### 3.1 修复前

```text
Dream -> Gateway -> Provider headers -> Provider SSE frame
                              -> Next gzip buffer ... Provider stream ends
Dream <-                    compressed response finally flushes
```

### 3.2 修复后

```text
Dream -> Gateway auth/reservation -> Provider headers -> request-local parser
Dream <- SSE headers (identity) <- first complete event <- upstream bytes
Dream <- next event           <- next complete event  <- upstream bytes
```

## 4. 业务交互时序

### 4.1 完整功能交互

```mermaid
sequenceDiagram
  autonumber
  actor U as 业务用户
  participant D as Dream / Claude Code
  participant G as Ink Gateway<br/>/v1/messages
  participant C as PostgreSQL 控制面<br/>认证·订阅·模型·额度
  participant P as AI Provider
  participant B as PostgreSQL 账务与审计<br/>预留·事件·结算

  opt Claude Code 独立连通性探测
    D->>G: HEAD /api/hello
    G-->>D: 404（不属于 Gateway 协议）
    Note over D,G: 探测不创建流、不预热、不唤醒 Messages 请求
  end

  U->>D: 发起生成 / 对话 / 工具任务
  D->>G: POST /v1/messages?beta=true<br/>Gateway Key + 模型别名 + stream=true
  G->>C: 校验 Key、Scope、用户状态
  C->>C: 解析订阅权益、模型、Provider、价格与 Token 上限

  alt Gateway Key 或 Scope 无效
    C-->>G: 认证或授权失败
    G-->>D: 401 / 403 兼容错误<br/>不调用 Provider
    D-->>U: 显示认证或权限错误
  else 订阅、额度或余额不足
    C->>B: 保存 rejected 请求与脱敏报文
    C-->>G: 402 / 403 / 429 + request_id
    G-->>D: Anthropic 兼容 JSON 错误<br/>不调用 Provider
    D-->>U: 显示订阅或额度提示
  else 校验通过
    C->>B: 创建 request_id<br/>保存价格快照并预留 Token
    C-->>G: reserved + Provider 配置
    G->>P: 请求上游模型<br/>独立 AbortSignal + stream=true

    alt Provider 在流开始前拒绝或返回非 SSE
      P-->>G: 4xx / 5xx / 非 text/event-stream
      G->>B: 标记 failed，释放或结算预留
      G-->>D: 非 200 Anthropic 兼容 JSON 错误
      D-->>U: 显示上游服务错误
    else Provider 建立 SSE
      P-->>G: 200 text/event-stream
      G->>B: 状态 reserved → streaming
      G-->>D: 200 SSE headers<br/>no-transform + no buffering

      loop 每个完整 Provider SSE 事件
        P-->>G: 网络 chunk
        G->>G: UTF-8 解码、SSE 组帧、协议适配
        par 下游实时交付
          G-->>D: 立即发送兼容事件<br/>message_start / delta / tool_use
          D-->>U: 增量展示文本、思考或工具状态
        and 有界异步审计
          G->>B: 按 request_id + sequence 保存事件<br/>最多 32 个待处理任务
        end
      end

      alt 正常完成
        P-->>G: message_delta + usage + message_stop
        G->>B: capture / release Token<br/>追加账本并标记 succeeded
        G-->>D: message_stop / [DONE]，关闭流
        D-->>U: 展示完成结果
      else 用户主动取消
        U-xD: 停止生成
        D-xG: 取消下游读取
        G-xP: Abort fetch + cancel reader
        G->>B: 标记 cancelled，结算已知 Usage
        D-->>U: 展示已停止
      else 上游在流中异常
        P-xG: 断连 / 非法帧 / 提前关闭
        G-->>D: 已开始的 200 流内发送 error event
        G->>B: 标记 interrupted<br/>按可靠 Usage 结算或进入待恢复状态
        D-->>U: 保留已显示内容并提示生成失败
      end
    end
  end
```

业务上以 `request_id` 贯穿一次调用。Dream 只持有 Gateway Key 和模型别名；Provider
密钥、实际模型、价格快照、订阅额度和账务状态均留在服务端。首个完整上游事件一旦
完成组帧就立即交付 Dream，报文审计在有界队列中异步进行，不要求 `/api/hello`、预热
或第二次请求。

### 4.2 技术执行时序

```mermaid
sequenceDiagram
  participant D as Dream / Claude Code
  participant R as Next Route
  participant G as Gateway lifecycle
  participant P as Provider
  participant DB as PostgreSQL control plane

  D->>R: POST /v1/messages?beta=true, stream=true
  R->>G: handleAnthropicMessages(request)
  G->>DB: auth, model/price resolve, reservation, request capture
  DB-->>G: request_id + resolved provider
  G->>P: fetch with request-local AbortSignal
  P-->>G: 200 text/event-stream headers
  G-->>D: 200 SSE headers, no-transform, X-Accel-Buffering=no
  P-->>G: first bytes / first complete SSE event
  G-->>D: first compatible SSE event immediately
  par ordered streaming
    P-->>G: subsequent chunks/events
    G-->>D: converted events in the same order
  and bounded capture
    G-->>DB: ordered event capture (max 32 pending tasks)
  end

  alt normal completion
    P-->>G: terminal event / EOF
    G->>DB: usage settlement + capture completion
    G-->>D: protocol terminal + close
  else Dream cancels
    D-xG: downstream cancel
    G-xP: abort fetch + cancel reader
    G->>DB: cancelled lifecycle/settlement state
  else upstream fails after headers
    P-xG: network/invalid frame/premature close
    G-->>D: protocol-compatible error event, then close
    G->>DB: interrupted lifecycle state
  end

  Note over D,G: /api/hello is not part of this sequence
```

## 5. 请求级状态与生命周期

每个 `proxyStreaming()` 调用独立创建：

- Provider `Response`、linked `AbortController` 和 timeout；
- SSE async iterator、`TextDecoder`、跨 chunk buffer；
- protocol adapter 状态；
- usage accumulator、sequence、response hash 和 terminal/cancelled flags；
- 下游 `ReadableStream` controller；
- 容量为 32 的顺序 payload capture queue。

状态转换为：`reserved -> streaming -> succeeded | failed | cancelled`。上游响应头和
Content-Type 在返回 200 SSE 前校验；首字节前错误仍可返回非 200 JSON。流开始后的错误
只能以兼容协议 error event 表达，并将数据库状态标记为 interrupted。

parser 只在读到空行后产生完整 SSE event。一个 event 可跨任意 chunk，单 chunk 可含
多个 event；增量 decoder 保留跨 chunk UTF-8 字节。CRLF 规范化为 LF。终止标记、取消
或 abort 都会退出 iterator，并取消/释放 reader。

## 6. 背压与内存边界

下游 stream 使用 `pull()`：只有 consumer 请求数据时才继续读取上游 event。一个
Provider event 最多产生协议 adapter 的有限个输出，不整流缓存。

报文持久化与下游写入解耦，以免 PostgreSQL 延迟阻塞首事件；但异步捕获不是无界的。
`BoundedTaskQueue(32)` 保持事件顺序，达到上限后暂停下一轮上游读取，直到释放一个
slot。这样把最大保留量限制为 32 个捕获任务，并把持续过载转化为可控背压。捕获失败
会脱敏记录失败状态，但不撤回已成功写给 Dream 的 SSE。

## 7. 超时、心跳、重试与断线

- Provider timeout 使用模型 Provider 的 `timeoutMs`，与 downstream request signal 联结；
- 客户端取消立即 abort Provider、退出 iterator、取消 reader，并完成 cancelled 结算；
- Gateway 不在请求内部自动重试流，避免重复事件和重复计费；重试由客户端以新的请求
  或幂等契约发起；
- 本修复不增加固定 12 秒 timer；
- 当前不注入 heartbeat。若部署环境存在空闲连接超时，应使用 SSE comment heartbeat，
  但必须是请求级 timer、在所有终态清理，且不能代替业务事件 flush。

## 8. Headers、兼容错误与非流式行为

流响应固定包含：

- `Content-Type: text/event-stream; charset=utf-8`
- `Cache-Control: no-cache, no-transform`
- `Connection: keep-alive`
- `X-Accel-Buffering: no`
- `X-Request-Id: <gateway request id>`

Anthropic 下游使用 named event + JSON data；OpenAI 使用 `data:`，成功时只有一个
`[DONE]`。非法 JSON frame、上游中断和 Usage 缺失映射为现有协议错误体。非流式分支
继续完整读取 JSON、适配、结算并返回 `application/json`，本次不改变其行为。

## 9. 可观测性与安全

以 `X-Request-Id` 关联以下已有持久化时间点：

- `gateway_requests.created_at`：通过前置控制面后的请求生命周期起点；
- `gateway_response_payloads.started_at`：上游 headers 可用、下游 SSE 建立；
- `gateway_response_payloads.first_event_at` 与首条 event `elapsed_ms`：首个下游 event；
- `gateway_response_payloads.completed_at`：完成/中断/取消；
- `gateway_response_events` 数量和 sequence：下游事件数与顺序；
- `gateway_requests.first_token_ms` / latency：首 token 与总时长。

诊断必须比较 `time_to_upstream_headers`、首 event 和 completion，不能只使用 Next 的
请求完成日志。认证 header、Gateway Key、Provider secret、Cookie 不进入日志或响应；
payload header 按 allowlist 保存，敏感字段固定为 `[REDACTED]`。Provider secret 只在
内存中解密并重建上游认证 header。

## 10. 测试矩阵

| 场景 | 证据 |
|---|---|
| 首个 `/v1/messages` 在 Provider 结束前收到首事件 | focused HTTP/Playwright mock Provider |
| 不需要 `/api/hello` 或第二请求 | 首事件断言发生在任何 hello/后续请求前；随后 HEAD 仍为 404 |
| Next 不压缩 SSE | `no-transform`、无 `Content-Encoding` |
| event 跨 chunk / 单 chunk 多 event | parser unit tests |
| CRLF、multiline、UTF-8 跨 chunk | parser unit tests |
| 两个并发请求严格隔离 | proxy concurrency unit test |
| downstream cancel / signal abort / `[DONE]` | reader/fetch cancel unit tests |
| 上游首字节前错误 / 流中错误 / 非 SSE | proxy error tests |
| 鉴权失败 | gateway auth/handler tests |
| 非流式回归与双向协议适配 | proxy + focused E2E |
| 捕获慢或失败 | 首事件不等待 capture；有界队列和 failure-continuation tests |

时间测试使用“首事件发生时 Provider 尚未结束”的因果断言，不依赖 CI 中脆弱的绝对
毫秒阈值。

## 11. 发布、回滚与风险

发布顺序：相关 unit -> typecheck/lint -> focused Gateway E2E -> build -> staging 使用
`curl -N` / Dream SDK 观察首事件 -> 逐步发布。反向代理仍需保留
`X-Accel-Buffering: no` 并尊重 `no-transform`。

回滚只需回退应用代码，无 schema 或 migration。若回滚 `no-transform`，压缩缓冲会立即
复现，因此优先回滚其他变更并保留该 header。主要风险是禁用 SSE 压缩增加带宽；这是
为低延迟事件交付有意接受的权衡。32-task capture 上限可能在数据库极慢时降低上游读取
速率，但不会无界增长内存或跨请求污染。

## 12. 为什么不需要 `/api/hello` 或第二次请求

`/api/hello` 是 Claude Code 面向 Anthropic 服务的连通性探测，本 Gateway 不把它当成
初始化、健康状态或流开关。每次 `/v1/messages` 在同一请求内完成鉴权、上游连接、parser
和 controller 创建；上游完整 event 到达后直接 enqueue 给该请求的 consumer。

修复后 Next 不再压缩变换 SSE，因此第一个小 event 自身就能越过 HTTP 边界。另一个
HTTP 请求既不共享 controller，也不参与 queue 或 flush；第二请求不可能、也不再需要
“唤醒”第一请求。
