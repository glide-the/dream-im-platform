<!--
[Input] User request for one Provider-page switch governing all Provider requests and price synchronization.
[Output] Revisioned network policy, UI states, transport ownership and deployment configuration contract.
[Pos] Current application design; historical ECS connectivity evidence remains in its maintenance receipt.
-->
# 模型中心本机 Docker NAT 代理

## 背景与问题

价格目录同步曾因服务器出口超时失败，随后复用了服务器已有 Docker NAT 代理，见[维护回执](../verification/ecs-pricing-catalog-egress-20261108.md)。管理员需要在 AI 模型中心的供应商页面统一选择，是否让各供应商请求和价格同步使用该代理。

## 目标与边界

供应商列表顶部提供一个开关，保存后影响后续请求，无需重启应用。AI 与 Image 供应商列表共享同一设置。范围包括 Gateway 文本/图片调用及已有认证续期、供应商连通检查、模型验证、目录获取、上游用量、托管产品授权/轮询/续期/撤销以及两个模型中心的价格目录同步。

“本机”指 Admin 进程所在主机。应用只选择已存在的 HTTP 代理，不启动 Docker，不改 Tinyproxy、systemd、SSH 或容器，不影响其他系统出口。切换不取消已派发的流式请求，不修改模型、价格、账户或账本规则。

## 概念与规则

| 配置 | 规则 |
| --- | --- |
| default | 关闭显式 Docker NAT 覆盖，沿用原有 fetch 网络设置；原系统代理可能仍生效，关闭不等于强制直连 |
| desired | `system_settings` 的 `model_network/docker_nat_proxy` 专用 JSONB：`{ enabled, revision }`，缺行使用默认值 |
| effective | 每次新请求在派发前读取已提交的 desired，读取也遵守原取消和超时；启用且本实例代理地址有效时选择该代理。这里表示网络选择，不代表远端连通探测成功 |
| revision | 初始为 null，首次保存为 1，后续递增；PATCH 必须携带 expectedRevision，过期返回 409 |
| capability | 服务端 `MODEL_EGRESS_PROXY_URL` 提供已有回环 HTTP 代理地址，只接受本机地址、显式端口、根路径，不接受凭据、query 或 fragment |
| 状态 | 关闭、启用、期望启用但本实例配置不可用；浏览器另外显示读取、保存与失败状态 |

地址未配置或无效时不可启用；若已保存启用而地址后来不可用，新请求失败关闭，不静默恢复原出口。关闭操作仍可保存，以恢复原网络。数据库不可读或策略损坏时也不得绕过策略发送请求。

开关默认保留已有网络行为。服务器原先通过 HTTP_PROXY、HTTPS_PROXY 或 Tinyproxy 走代理的请求不会因新增代码而被强制直连。需要真正关闭这类原系统代理时，由独立运维变更处理。

GET `/api/admin/model-egress` 要求 `providers.read`；PATCH 要求 `providers.write`、同源 Origin、严格 body、事务锁和 revision 比较，并将设置与审计原子提交。响应只含安全状态，不回显地址、凭据或网络错误正文。不新增数据库 DDL，不在启动时迁移。

## 配置与使用

运维先核对现有 Docker NAT 的实际监听，将地址配置到 Admin 的 `MODEL_EGRESS_PROXY_URL`，随后正常发布或重启以加载进程配置。历史端口仅供上方维护回执追溯，不能据此假设当前监听。

管理员打开 AI 模型中心 → 供应商 → 本机 Docker NAT 代理，点击开关即保存。只读管理员可查看状态。保存失败保留原状态；版本冲突后通过“重新读取设置”获取最新值，再执行需要的切换。多个 Admin 实例共享同一 desired，各实例均需配置自己的有效回环入口。

## 验证边界

`app/lib/model-egress.test.ts` 使用受控 PostgreSQL 返回值和真实本地 CONNECT 代理验证请求路径、关闭恢复、取消及无配置失败；Admin handler 单测覆盖权限、Origin、输入、版本与审计。`tests/e2e/model-egress.spec.ts` 直接渲染生产供应商组件与样式，验证桌面和窄屏操作；受控接口响应不作为正常数据库持久化、线上代理或真实模型验收。
