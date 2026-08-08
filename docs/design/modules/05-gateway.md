# 模块交互：Gateway Key、Request、Payload 与限流

> 返回：[全局交互规范](../refine-admin-ui-v3-interaction-design.md) · PRD：[Gateway](../../prd/modules/05-gateway.md)

## 1. Gateway Key

列表字段：name、平台用户、prefix、scopes、status、expires、last used、created；筛选 user/status/scope/key prefix，默认 created desc。创建使用 Drawer：平台用户 Relation Select、name text、scopes multiselect、expires datetime。

成功进入一次性回执层，显示明文 Key、Gateway Base URL、Anthropic/OpenAI Header 和 model alias 示例；每项独立 Copy。关闭前提示不可再次查看；详情只显示 prefix/fingerprint。Revoke 使用危险 Modal，显示关联和影响，不删除历史。

## 2. Request 列表与详情

列表列 request ID、user、protocol、provider/model、status/outcome、Token/charged、HTTP/error、latency/TTFT、created；筛选 user/provider/model/subscription/protocol/status/outcome/error/time；只读无批量写。

详情桌面右侧最大 860px Drawer，移动全屏。顺序：Summary → Identity/Key → Routing → Subscription/Entitlement → Token/Price/Ledger → Performance → Error/Limit diagnosis → Protected Payload → Audit links。

429 诊断显示 limit/current/reserve/remaining/exceeded 和未调用 Provider 说明；Token 按钮跳用户默认上限，RPM 跳模型权限，附带 user/model 筛选。实时窗口只读。

## 3. 完整 Payload 权限门

详情默认不请求 Payload。点击“确认并查看完整报文”打开二次确认，说明可能含个人内容/Prompt且会写 Audit；确认请求带 reveal header。Headers/JSON/Raw/SSE 只读、脱敏、局部滚动；事件按 sequence 显示 time/elapsed/type/bytes/raw。

无权限 403 留在 gate 内，不显示 body 片段；428/5xx 可重试。Copy 仅 clipboard 且不触发 analytics。

## 4. 限流页面

分区：用户默认 Token 上限（可编辑）→ 用户—模型 override（可编辑）→ 实时 rate-limit windows（只读）。每区独立说明最终限制取值；筛选通过 URL 保持。

## 5. 响应式、无障碍与验收

- Drawer header sticky，大内容自身滚动；document 无横滚。
- SSE/JSON Viewer 有 accessible label；Dialog 锁焦；Copy 有成功 live message。
- UI-GTW-01：创建 Key 明文仅出现一次，刷新后不可恢复。
- UI-GTW-02：打开 Request Drawer 前 Payload API 调用数为 0；确认后有 Audit。
- UI-GTW-03：429 能导航到实际配置并保持 user/model context。
- UI-GTW-04：390×844 下 Request、JSON、Raw SSE 和回执可完整操作。
