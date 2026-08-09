# 模块交互：Gateway Key、Request、Payload 与限流

> 返回：[全局交互规范](../refine-admin-ui-v3-interaction-design.md) · PRD：[Gateway](../../prd/modules/05-gateway.md)

> 实现状态：**Implemented / Release candidate**；Key、Request/Payload/限流、canonical 反查、402 Token 单位、cash-only 禁回退、终态 guard 与 Dream server-only client 已验证。Subscription/Entitlement/Allowance 富详情分区仍是后续增强；外部 Provider canary 未执行。

## 0. Current / Target / Release Gate

| 分层 | 交互边界 |
|---|---|
| Current / Implemented | Key/Request/Payload/限流页面与 Dream server-only 链路；canonical user→Subscription→Entitlement→Permission→limit→Token Allowance、402 单位、无 cash fallback 与 settled guard 已落地。 |
| Planned enhancement | Request Drawer 的 Subscription/Entitlement/Allowance 富详情；不影响 strict Gateway 资格链。 |
| Release Gate | orphan/cash-only fail-closed、401/402/403/404/409/429/502/503、流取消/usage 缺失、无浏览器 Key/Secret 与两视口 Payload 权限测试通过。 |

## 1. Gateway Key

列表字段：name、平台用户、prefix、scopes、status、expires、last used、created；筛选 user/status/scope/key prefix，默认 created desc。创建使用 Drawer：平台用户 Relation Select、name text、scopes multiselect、expires datetime。

成功进入一次性回执层，显示明文 Key、Gateway Base URL、Anthropic/OpenAI Header 和 model alias 示例；每项独立 Copy。关闭前提示不可再次查看；详情只显示 prefix/fingerprint。Revoke 使用危险 Modal，显示关联和影响，不删除历史。

Target 轮换从旧 Key 详情发起，预览新 scope/到期和旧 Key 撤销时点；成功后只在新回执显示一次新明文，旧明文不恢复。Request Drawer 显示请求时 key fingerprint/scope/version 快照，不用当前 Key 配置回算历史。Current 尚无完整版本轮换合同，因此不得显示该动作。

Dream 的生产凭据只由服务端 secret provider 注入，不通过本 Admin 页复制到浏览器，不放入用户偏好 JSON/普通表/日志。Key 绑定最小 scope 和 canonical user context，不提供全平台浏览器共享 Key。

错误显示已统一：missing/invalid/revoked 为 401 `GATEWAY_AUTH_REQUIRED`；只有 Key 有效但 canonical mapping 为 orphan 时显示 403 `CANONICAL_USER_REQUIRED`。生产历史 orphan 处置仍需回执，UI 不提供破坏性“修复”。

## 2. Request 列表与详情

列表列 request ID、user、protocol、provider/model、status/outcome、Token/charged、HTTP/error、latency/TTFT、created；筛选 user/provider/model/subscription/protocol/status/outcome/error/time；只读无批量写。

详情桌面右侧最大 860px Drawer，移动全屏。顺序：Summary → Identity/Key → Routing → Subscription/Entitlement/Token Allowance → 独立 Price/Cost/Ledger（若该请求适用）→ Performance → Error/Limit diagnosis → Protected Payload → Audit links。两个分区不得使用同一个“额度/余额”标题。

429 诊断显示 limit/current/reserve/remaining/exceeded 和未调用 Provider 说明。402 按已实现的 `metric/unit` 分域：Subscription Token 只显示 `availableTokens/requiredTokens/periodEnd`、个人周期结束时间和下期换版入口，不提供现金继续调用；只有显式独立现金模式才格式化 micro-USD。Token 限额提供用户默认上限与模型覆盖检查入口；编辑要求 `users.write`。RPM 当前只显示“请求频率策略暂未在 Admin 开放”和 user/model 上下文，不承诺可编辑入口。实时窗口只读。

404 `GATEWAY_MODEL_NOT_FOUND` 显示下线/不存在 alias 并导航到真实 model catalog；409 显示原 idempotent Request 或进行中状态；502 `GATEWAY_PROVIDER_UPSTREAM_FAILURE` 区分上游 retryable/non-retryable，不混用 Payment Adapter code；503 显示 Gateway/定价/密钥配置不可用。客户取消、流中断或 usage 缺失均显示 release/capture/settlement_failed 的真实终态，不显示 0 费用成功。

Dream BFF 不把 Gateway `/v1` 的 snake_case 诊断原样透传给产品页；它通过 allowlist 转为 `{error:{code,message,details?},meta:{requestId,retryAfterSeconds?}}` 与 camelCase `availableTokens/requiredTokens/availableMicrousd/requiredMicrousd`，未知字段丢弃并记安全诊断。

## 3. 完整 Payload 权限门

详情默认不请求 Payload。点击“确认并查看完整报文”打开二次确认，说明可能含个人内容/Prompt且会写 Audit；确认请求带 reveal header。Headers/JSON/Raw/SSE 只读、脱敏、局部滚动；事件按 sequence 显示 time/elapsed/type/bytes/raw。

无权限 403 留在 gate 内，不显示 body 片段；428/5xx 可重试。Copy 仅 clipboard 且不触发 analytics。

## 4. 限流页面

分区：用户默认 Token 上限（可编辑）→ 用户—模型例外限制（可编辑）→ 套餐权益提示（跳转订阅中心）→ 实时用量窗口（只读）。每区独立说明最终限制取值；筛选通过 URL 保持。

这是限制策略的唯一入口。模型中心不再显示“模型权限”Tab 或侧边导航；历史 `/admin/models/permissions` 永久跳转到本页 `#user-model-permissions-manager`，不得维护第二套重复页面。

## 5. 响应式、无障碍与验收

- Drawer header sticky，大内容自身滚动；document 无横滚。
- SSE/JSON Viewer 有 accessible label；Dialog 锁焦；Copy 有成功 live message。
- UI-GTW-01：创建 Key 明文仅出现一次，刷新后不可恢复。
- UI-GTW-02：打开 Request Drawer 前 Payload API 调用数为 0；确认后有 Audit。
- UI-GTW-03：429 能导航到实际配置并保持 user/model context。
- UI-GTW-04：390×844 下 Request、JSON、Raw SSE 和回执可完整操作。
- UI-GTW-05（Implemented / release candidate）：orphan 兼容身份无法创建/使用 Key；402 诊断的字段名、数值和单位一致。
- UI-GTW-06（Target release gate）：Request Drawer 能追溯 canonical user→Subscription→Version→Entitlement→Permission→current-period Token Allowance→Usage；独立 Pricing/Cost/Ledger 另区显示，且每个快照是请求时版本，不被新配置重算。
- UI-GTW-07（Target release gate）：Subscription Token 用尽只显示 Token 402，不继续扣 cash；cash-only canary 关闭后无 Subscription 显示真实 403/开通路径。ASR 在 streaming-audio 合同完成前不出现为可选 Gateway capability。
- UI-GTW-08（Target release gate）：轮换新 Key 只显示一次，旧 Key 保留 revoked 历史；转动前后 Request 快照均可追溯且无明文回读。
