<!-- [Input] Installed OAuth Device Authorization routes and Admin device UI. -->
<!-- [Output] Actual device interaction/state/credential boundaries and pending protocol proof. -->
<!-- [Pos] Device domain document linked from unified auth architecture. -->
<!-- [Sync] 2026-09-15: define generic rollback handling without protocol credential logs. -->

# 设备授权

## 背景与问题

CLI 不能持有服务端 OAuth client secret，也不能读取 Dream 的用户数据库。设备授权由 Admin 唯一认证中心提供，用户在浏览器确认已注册客户端及权限，CLI 在同一 resource 上换取用户 grant。

## 目标与边界

保留 CLI→浏览器确认→OAuth token 的正常交互，全部账户/决定/轮询/撤销持久化由 Admin 处理。CLI 不内置 client_secret，不签发 JWT，不用 user_id 申请新身份凭证。来源依据实际安装的 Better Auth/oauth-provider1.7.4；当前源码与unit通过，完整设备并发/浏览器/真实用户协议验收仍见[验证矩阵](../verification/admin-auth-data-provider-matrix.md)。

## 概念与规则

| 入口 | 交互 |
| --- | --- |
| POST `/api/auth/device/code` | 注册公有 device client 申请 device_code/user_code、verification URI 和轮询 interval |
| `/auth/device?user_code=…` | 登录后显示已注册客户端/resource/scope，用户批准或拒绝 |
| GET `/api/auth/device?user_code=…` | 实际 provider 设备review；同UOW锁定决定对应记录 |
| POST `/api/auth/device/approve`、`device/deny` | 实际请求字段 `userCode`，Session与决定重复验证 |
| POST `/api/auth/oauth2/token` | grant_type=device_code的OAuthresource token，使用已注册client/resource/scope |

`/api/auth/device/token` 的 Session token 通道被关闭。OAuth resource token 仍执行统一 ES256 at+jwt 与主体/client/scope验证；Google/ID/Session token 不能替代它。

pending 返回 authorization_pending；过快轮询返回 slow_down 并增加5秒间隔，这是实际协议要求。expiry/denial优先于轮询状态；批准和兑换在同一Admin事务锁定设备记录，并发只允许原决定完成一次，consumed/expired不会复活。用户不需要第二套 Dream 批准页面或本地决定存储。

device_code、user_code、access/refresh token 不进入公开日志或浏览器存储。未知插件或 ORM 异常必须触发事务回滚，由统一边界返回 no-store 的 `temporarily_unavailable` 503，服务端不得记录包含 SQL 参数或协议凭证的异常对象。到期或拒绝由 CLI 重新启动用户可见授权；配置、mapping、scope、client或能力缺失分别在对应边界失败，不通过部署名称猜测事实。长turn创建目的受限委托后仍需在expiry前由持有该bearer的keeper续期，CLI Gateway和Editor stdio使用不同授权。

状态图、刷新lineage、服务身份、用户权限、迁移及回滚见[完整契约](admin-dream-auth-data-contract.md)；实际密码/Google入口见[统一认证](auth.md)。
