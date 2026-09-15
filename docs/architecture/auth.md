<!-- [Input] Actual Better Auth composition, explicit legacy mapping and browser/service topology. -->
<!-- [Output] Current authentication architecture, ownership and product interaction contract. -->
<!-- [Pos] Auth domain entry document; complete domain/API state remains in the shared contract. -->
<!-- [Sync] 2026-09-16: bind confirmation Runtime delegation use to the live Admin durable claim. -->
<!-- [Sync] 2026-09-16: bind Deck Plugin management to current OAuth without granting Admin RBAC. -->
<!-- [Sync] 2026-09-15: document the no-log rollback boundary for unknown auth failures. -->

# 统一认证

## 背景与问题

Dream 原本签发用户凭证并访问认证数据库，Admin 使用独立管理 Session。两套身份入口会使账户、权限和撤销状态不同步。本次由 Admin 的 Better Auth 1.7.4 统一 Google、密码注册登录、Session、OAuth 和设备授权。原业务用户主键、历史密码哈希、Google provider_sub 和业务关系保持不变。

## 目标与边界

Admin 负责身份和凭证生命周期。Dream 浏览器通过本方 BFF 使用 HttpOnly handle 和内存 CSRF，服务端持有 OAuth access token；浏览器不存 access/refresh token。Dream 保留产品编排、SSE、Runtime 和共享文件系统，通过具名领域服务访问数据。Admin 的管理权限来自独立 membership/RBAC，普通登录不会自动获得。

当前实现、公开接口及六张拓扑/状态图以[完整契约](admin-dream-auth-data-contract.md)为准。已通过的隔离技术检查与正常业务待验收状态见[验证矩阵](../verification/admin-auth-data-provider-matrix.md)。此文件不代表正常数据库已经迁移或真实 Google 已经验收。

## 概念与规则

| 概念 | 规则 |
| --- | --- |
| Better Auth subject | 独立字符串，显式 subject_links FK 指向原 canonical bigint；API bigint 一律十进制字符串 |
| 管理员 | active admin_subject_links + active admin_users；每次管理请求重新查询 permission |
| 新账户 | Google/credential 来源在同一事务注册 canonical、原 Free/default-model 初始化和显式 link；缺 readiness 则整体失败 |
| 旧账户 | 私有 manifest/source fingerprint/provider_sub 或实际旧密码证据，显式采用并审计；不按邮箱隐式合并或提升 |
| Session | Better Auth HttpOnly cookie；管理 Session 不替代 OAuth resource grant |
| OAuth resource token | 本地受信 JWKS 验证 ES256 at+jwt、issuer、audience、client、scope、expiry，最长300秒；拒 Google/ID/Session token |
| 服务身份 | 独立配置的服务 credential；用户 grant 必须属于该服务的 browser 或明确 device client |
| Runtime delegation | 三种互斥 purpose；实体和权限在创建时绑定，renew 不扩张，解析重新检查 active/owner/key；confirmation 来源还须匹配当前 message/claim 和未过期数据库租约 |

Deck Plugin binding 的四项读取要求当前 OAuth `dream:read`，保存要求 `dream:write`。Admin 从 access token 派生 canonical user 并重新检查 Deck 与 Workspace owner；请求中的 `workspace_id` 只用于定位当前业务实体，不代表主体授权。成功登录或拥有 Dream scope 不授予 Admin 管理页面/RBAC 权限，Device/Runtime purpose token 也不能调用这些 OAuth-only 产品管理操作。

Dream 的登录入口启动 `/api/auth/oauth2/authorize` code/S256 流程。未登录用户进入 Admin `/auth/sign-in`，该页支持密码登录、创建账户和 Google；这些选择保留 provider 签名 OAuth 上下文。没有自定义 `ui_hint` 或从 Dream 直接提交旧密码接口。密码注册保持原六字符 minimum；首次 Admin bootstrap 的十四字符规则和一次性 token 属于独立已有管理设置。

Google 使用内置 provider 和 exact callback，不新增 emailVerified/domain 门槛。邮箱与旧账户发生冲突时提示需要显式身份关联，不能以 Google 登录悄悄提升为管理员。密码兼容旧 canonical bcrypt 与 Admin scrypt；采用保留原哈希，配对两个不同哈希须由私有共同密码实际验证。

退出调用实际 Better Auth sign-out 并撤销 BFF refresh lineage/handle。历史 HMAC cookie 不再签发或接受；旧表由显式采用/撤销治理保留，应用回滚不会复活已撤销凭证。

身份、领域和 Admin control 分别配置显式 PostgreSQL credential，启动不执行 migration。角色、物理 catalog、精确能力、应用输入/输出 hash 和公开 Route 证据互相独立，缺必需条件关闭对应边界。配置和源文件见 `app/lib/auth`、`packages/db/src/schema/auth*`、`drizzle/data/auth-*`；完整权限和旧主体 runner 见共享契约。

Better Auth 的未知插件或 ORM 异常必须抛到 Admin 外层事务边界，由该边界回滚并只返回 `Cache-Control: no-store` 的 `503 {"error":"temporarily_unavailable"}`。服务端不得记录异常对象，避免 SQL 参数携带 device_code、user_code、token 或 secret 进入日志。

独立[设备授权](auth-device.md)只使用注册公有 CLI client；[领域操作](admin-dream-operation-contracts.json)和[委托契约](admin-dream-delegation-contracts.json)来自实际严格 DTO。Runtime 只有对应用途的 opaque bearer，不接收数据库或共享服务密钥。
