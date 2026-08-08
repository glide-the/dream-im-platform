# Ink Memory Admin 与模型网关接入

## 边界

管理后台和网关共享 PostgreSQL `ink-memory`。不再读取 Story SQLite，也不需要挂载 `ink-dream-memory` 或 `story-workspace` 文件目录。业务调用方只通过稳定 HTTP 接口接入。

`ink-dream-memory` 当前仍使用 SQLite，本文件描述的是目标接入边界，不代表两边数据已经自动同步。业务侧的 PostgreSQL 数据迁移、真实 Story 表映射和网关环境变量建议见 [ink-dream-memory PostgreSQL 与计费网关接入建议](./ink-dream-memory-postgresql-gateway-migration.md)。

## 调用入口

- Anthropic：`POST /v1/messages`、`POST /v1/messages/count_tokens`
- OpenAI：`POST /v1/chat/completions`
- 模型发现：`GET /v1/models`

调用方携带在管理后台创建的 Gateway API Key。网关将客户端模型别名解析为已启用的 Provider/上游模型，校验用户权限和配额，再完成预授权与结算。

## 管理流程

1. 在“平台用户”创建计费身份并充值。
2. 在“模型中心”创建 Provider，保存加密凭据。
3. 创建模型别名和有效定价时间窗。
4. 为用户创建带 scope 的 Gateway API Key。
5. 配置用户—模型权限及 RPM/日/月 Token 限额。
6. 调用 `/v1` 接口，在“Token 计费”和“代理网关”查看请求与限流窗口。

## Story 数据

“剧本数据运营中心”直接管理以下 PostgreSQL 资源：

- `story-workspaces`
- `story-projects`
- `story-characters`
- `story-scenes`
- `story-workflow-runs`

每项资源都有 Refine list/get/create/update/delete 能力、`story.read`/`story.write` 权限和审计。外键依赖会阻止不安全删除，项目删除会级联其角色和场景，工作流的项目引用会置空。

## 失败语义

- 无效/过期 Key：401
- 模型无权限、用户停用：403
- 余额或额度不足：402/429（按错误类型）
- Provider 请求失败：记录失败结果并释放可确定的预授权
- 流中断且用量未知：`settlement_failed`，由后台人工核对
