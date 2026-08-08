# Refine Admin UI v3 — Gateway Request 完整报文交互

## 1. 入口与层级

`/admin/gateway/requests` 保持高密度只读表。点击“查看”打开详情：桌面右侧 Drawer，移动端占满 viewport。列表数据仅来自 `gateway_requests` 及轻量 joins；进入 Drawer 也不自动请求 payload。

## 2. Drawer 信息架构

| 区域 | 控件 | 行为 |
|---|---|---|
| Summary | definition grid + status tag | 显示 protocol/status/outcome/HTTP/model |
| Identity | mono fields | User、email、Gateway Key 名称/prefix、Provider/Model |
| Billing | mono numbers + links | Usage、价格快照、Ledger 链接 |
| Performance | mono tabular | TTFT、总延迟、开始/完成/结算时间 |
| Error | danger notice | error code/message、中断状态 |
| Full payload gate | warning panel + primary button | 显示权限与隐私说明，默认关闭 |

## 3. 二次确认

点击“二次确认并查看完整报文”显示确认文案：“完整报文可能包含个人内容和 Prompt；本次查看将写入不可变审计。”取消不发请求；确认后请求必须带 `x-gateway-payload-confirmation: reveal`。401/403/428/5xx 显示在 gate 内，不关闭 Drawer。

## 4. Viewer

- Headers：格式化 JSON，只读，服务端返回已脱敏值。
- JSON：格式化 `<pre>`，保留 Unicode，最大高度 320px，内部纵横滚动。
- Raw Body/Raw SSE：等宽、只读、`white-space: pre-wrap`，长 token 可断行。
- SSE：按 sequence 升序；列为 Sequence、Event Type、Elapsed、Bytes、Time、Raw Data。Raw Data 单元格内部滚动。
- Copy：只写浏览器 clipboard，带 `data-no-analytics=true`，不得触发埋点或网络请求。

## 5. Responsive 与无障碍

- 1440×1000：Drawer 最大 860px，背景遮罩，header sticky。
- 390×844：Drawer `width:100%`，不露背景边缘；表格区域自己横向滚动，document `scrollWidth === clientWidth`。
- Dialog 使用 `role=dialog`、`aria-modal`、标题关联；Escape、遮罩和关闭按钮均可关闭。
- 交互目标不小于 44px；状态不能只依赖颜色；时间和金额使用 tabular numerals。

## 6. 状态矩阵

| 状态 | 展示 |
|---|---|
| 未加载 | 权限/隐私说明 + 确认按钮 |
| 加载中 | 按钮禁用、“正在读取…” |
| 无 payload | 捕获为空状态，不把 null 当 `{}` |
| 历史 pending | 明确标记为旧版未捕获，不伪装成空 JSON；新产生的预授权拒绝必须显示完整请求与 JSON 错误响应 |
| 捕获失败 | 显示 completion/capture_error，不影响摘要 |
| 429/402/409 拒绝 | Error 区显示 code、HTTP、limit/current 或余额信息；完整报文区显示脱敏 Request 与协议正确 Response，不显示 SSE Viewer |
| 429 限额诊断 | 列表显示错误码与可读原因；详情在报文权限门之前显示中文诊断卡，包含当前、本次预留、上限、剩余、超出量，并说明尚未调用 Provider；Token 429 的主按钮导航到带用户筛选的“用户默认 Token 上限”，RPM 导航到模型授权矩阵，另提供模型覆盖与套餐权益检查入口 |
| 流成功 | timeline + Raw SSE + usage |
| 流中断 | 已持久化事件仍按序展示，状态为 interrupted/cancelled |
| 无权限 | 403 alert，不展示任何 body 片段 |

## 7. 视觉验收脚本重点

Playwright 在打开 Drawer 前断言 payload API 未被调用；确认后断言请求 Header、审计产生且 auth secret 不出现在 DOM/截图。429 场景还需点击配置按钮，验证导航 URL 携带 `email`、`model_code` 并按计量类型定位可编辑区；Token 场景必须实际提高用户默认上限并以同一个 Gateway Key 重试成功。桌面与移动均验证 Header sticky、大内容局部滚动、SSE 顺序、无页面级横向溢出、Escape 关闭及复制无 analytics request。
