<!-- [Input] Actual Better Auth composition, explicit legacy mapping and browser/service topology. -->
<!-- [Output] Current authentication architecture, ownership and product interaction contract. -->
<!-- [Pos] Auth domain entry document; complete domain/API state remains in the shared contract. -->
<!-- [Sync] 2026-10-31: add exact account callbacks to the existing Client with required native metadata and original PKCE/service permissions. -->
<!-- [Sync] 2026-09-17: adopt an exact legacy Dream credential through DTO/service/Drizzle while keeping Admin operators separate. -->
<!-- [Sync] 2026-09-17: restore Dream's product login card through exact-origin Admin form ingress without moving credential authority. -->
<!-- [Sync] 2026-09-17: record client-local Dream logout, retained central SSO, and independent Admin management sessions. -->
<!-- [Sync] 2026-09-17: separate Admin operator sessions from Dream OAuth users and define public versus confidential Dream clients. -->
<!-- [Sync] 2026-09-16: record exact provider-sub legacy adoption and successful real Google/Dream login without Admin membership. -->
<!-- [Sync] 2026-09-16: bind confirmation Runtime delegation use to the live Admin durable claim. -->
<!-- [Sync] 2026-09-16: bind Deck Plugin management to current OAuth without granting Admin RBAC. -->
<!-- [Sync] 2026-09-15: document the no-log rollback boundary for unknown auth failures. -->

# 统一认证

## 背景与问题

Dream 原本签发产品用户凭证并访问认证数据库；Admin 同时拥有独立的后台成员、管理密码、Session 和 RBAC。两类用户属于不同业务域。Admin 继续承载两种能力：Better Auth 1.7.4 统一 Dream 的 Google/密码身份、OAuth 和设备授权；Admin 管理认证独立验证 `admin_users` 并签发 `admin_sessions`。原业务主键、密码哈希、Google `provider_sub` 和业务关系保持不变。

## 目标与边界

Admin 是 Dream 的 OAuth Authorization Server 和数据服务端。Dream 浏览器、设备和服务端是三个独立 OAuth client；Dream 用户是用户委托 token 的 `sub`，不是 OAuth client。Dream 浏览器通过本方 BFF 使用 HttpOnly handle 和内存 CSRF，服务端持有 OAuth access token；浏览器不存 access/refresh token。Dream 保留产品编排、SSE、Runtime 和共享文件系统，通过具名领域服务访问数据。Admin operator 只通过独立 Admin Session 和 RBAC 进入管理后台。

角色、ER、兼容顺序和设计评审以[Admin / Dream 认证业务域评审](auth-domain-boundaries-review.md)为准。该评审明确 `admin_users` 与 Dream `users` 无直接关系；相同邮箱不合并业务用户、不共享密码，也不把 Dream 登录转换为 Admin 权限。

当前实现、公开接口及六张拓扑/状态图以[完整契约](admin-dream-auth-data-contract.md)为准。已通过的隔离技术检查与正常业务待验收状态见[验证矩阵](../verification/admin-auth-data-provider-matrix.md)。本机正常数据库已完成 migration/ACL、精确旧 Google 主体采用、真实 Google 返回 Dream、Device 全状态、Dream 客户端级退出/重新登录和独立 Admin operator 登录；自然 Session 到期与完整模型/Workflow 业务旅程仍按独立验收记录判断，不能由本文件代替。

## 概念与规则

| 概念 | 规则 |
| --- | --- |
| Better Auth subject | 独立字符串，显式 subject_links FK 指向原 canonical bigint；API bigint 一律十进制字符串 |
| Admin operator | 独立验证 active `admin_users.password_hash`，签发 `admin_sessions`；每次管理请求重新查询 member 状态、role 和 permission |
| 新账户 | Google/credential 来源在同一事务注册 canonical、原 Free/default-model 初始化和显式 link；缺 readiness 则整体失败 |
| 旧账户 | 私有 manifest/source fingerprint/provider_sub 或实际旧密码证据，显式采用并审计；不按邮箱隐式合并或提升 |
| Dream identity Session | Better Auth HttpOnly cookie，只参与 Dream OAuth 授权页；不代表 Admin operator |
| Admin Session | Admin HttpOnly cookie，对应 `admin_sessions`；不签 Dream resource token，不读取 Dream user |
| OAuth resource token | 本地受信 JWKS 验证 ES256 at+jwt、issuer、audience、client、scope、expiry，最长300秒；拒 Google/ID/Session token |
| OAuth client | Browser/Device 为无 secret public client；Dream service 为 confidential client，只有无用户后台操作可使用 `client_credentials` |
| 服务身份 | service token 只有明确 background scope；用户操作仍要求属于 Dream client 的用户委托 token，不能由 service token 推导用户 |
| Runtime delegation | 三种互斥 purpose；实体和权限在创建时绑定，renew 不扩张，解析重新检查 active/owner/key；confirmation 来源还须匹配当前 message/claim 和未过期数据库租约 |

Deck Plugin binding 的四项读取要求当前 OAuth `dream:read`，保存要求 `dream:write`。Admin 从 access token 派生 canonical user 并重新检查 Deck 与 Workspace owner；请求中的 `workspace_id` 只用于定位当前业务实体，不代表主体授权。成功登录或拥有 Dream scope 不授予 Admin 管理页面/RBAC 权限，Device/Runtime purpose token 也不能调用这些 OAuth-only 产品管理操作。

内部接口的凭据位置固定：background operation 使用 `Authorization: Bearer <service token>`；用户 operation 使用 `Authorization: Bearer <user token>`，并由 Dream 服务端增加 `X-Ink-Dream-Service-Authorization: Bearer <service token>`。该私有头不是 Browser API，Dream Next/Python 边界会剥离 Browser 注入；旧 `X-Ink-Dream-Service`/`X-Ink-Dream-Credential` 静态头被拒绝。Admin 分别验证 client 与用户，不从 client ID 推导 Dream user，也不从 Dream user 查 Admin operator。

Dream 页面保留原产品登录卡片、注册切换和 Google 按钮。页面先从本方 `/auth/options` 读取由服务端配置投影的 Admin action；浏览器端 handler 只把当前闭集表单直接 POST 到 Admin `/auth/dream/password` 或 `/auth/dream/google`，Dream Next/Python、日志和持久化不接收密码。Admin 精确校验配置的 Dream `Origin`、闭集字段和相对 `return_to`，在 Admin Drizzle 事务中调用同一个 Better Auth email/sign-up/social API；成功建立 Dream identity Session 后回到 Dream `/auth/start`，再执行注册 browser client 的 code/S256 流程。Google 固定请求账户选择并由 Admin callback 恢复同一个相对产品页面；失败只返回 `credentials|registration|google` 产品错误码，不把上游详情或凭据带入 URL。Dream 密码注册保持原六字符 minimum。Admin `/auth/sign-in` 仍服务直接 OAuth/Device 上下文，Admin 管理登录使用 `/api/admin/auth/login` 和独立管理 Session，两者都不会把 Dream 用户变成 Admin operator。

Google 使用内置 provider 和 exact callback，不新增 emailVerified/domain 门槛。邮箱与旧 Dream 账户发生冲突时提示需要显式身份关联，不能以 Google 登录创建 Admin operator。Dream credential 兼容旧 canonical bcrypt；Admin 管理密码继续使用自己的 scrypt 校验，两类凭据不交叉验证，也不要求由同一明文密码证明。

仅当发布人员以 canonical Dream user ID、正常数据库身份和该行精确 SHA-256 指纹确认目标后，release-only credential adoption 才可把原 `public.users.password_hash` 原样写入同一 Dream subject 的 Better Auth `identity.account(providerId='credential')`。入口是严格 Zod DTO，随后进入领域服务、typed Drizzle Repository 和单一事务；调用方不能选择 auth user ID、account ID、Admin user、SQL、表列或事务。操作默认 dry-run，正式执行必须同时给出 `--apply --production-approval`，并在创建 `identity.user`、credential account、`identity.subject_links` 和脱敏 audit 前锁定并复核源行。旧 canonical 行及密码哈希保持不变；完整映射重复执行返回 `already-complete`，源指纹漂移、部分目标、邮箱冲突、Admin subject link 或不支持的哈希格式均整笔失败。该兼容路径不读取 `admin_users`，也不创建 `admin_sessions`、RBAC 或 `identity.admin_subject_links`。

本机正常目标的旧 Google 主体采用只接受已有 `public.oauth_accounts(provider='google', provider_sub)` 到 canonical user 的精确绑定。发布命令读取 owner-only `0600` DTO，校验数据库名、端口、data directory、canonical/Google 行指纹与现有目标状态；Better Auth user/account ID 由 `provider_sub` 在服务端稳定派生。默认 dry-run，正式写入要求 `--apply --production-approval`，同一 Drizzle 事务创建 Better Auth user、Google account、Dream subject link 和脱敏 audit；旧行保持不变，重复执行返回 `already-complete`。该操作永不创建 `admin_subject_links`。

实际 Google callback 已在上述采用后成功恢复同一 OAuth 上下文，创建 Better Auth Session 和 browser-session/refresh lineage，并返回 Dream 原业务页面。Dream 产品历史可读；同一浏览器访问 Admin 管理入口仍进入 Admin 登录页。实际 access token 为 ES256 `at+jwt`，`aud` 含 Dream resource 与 issuer userinfo endpoint；Dream 只允许这两个配置派生的受众并要求 Dream resource 存在，不能据此接受任意额外 resource。

Dream 退出只撤销当前 Dream browser client 的 OAuth refresh grant/lineage和BFF handle，成功后清 Dream host-only cookie；它不结束 Admin origin 上用于 Dream OAuth 授权页的 Better Auth SSO Session，也不撤销其他browser/device client。用户再次从Dream发起登录时，如中央Session仍有效且原授权仍可用，可以直接完成code/PKCE并返回Dream；中央Session失效或账户被禁用时才要求重新认证。Admin 管理退出独立撤销 `admin_sessions` 并清管理cookie；Dream SSO或退出都不创建、撤销或授予Admin管理Session。旧的 Better Auth Admin 管理兼容路径已停止读取和签发；`identity.admin_subject_links` 只保留 migration 历史，待确认无旧消费者后按 contract 阶段移除。

身份、领域和 Admin control 分别配置显式 PostgreSQL credential，启动不执行 migration。角色、物理 catalog、精确能力、应用输入/输出 hash 和公开 Route 证据互相独立，缺必需条件关闭对应边界。配置和源文件见 `app/lib/auth`、`packages/db/src/schema/auth*`、`drizzle/data/auth-*`；完整权限和旧主体 runner 见共享契约。

Better Auth 的未知插件或 ORM 异常必须抛到 Admin 外层事务边界，由该边界回滚并只返回 `Cache-Control: no-store` 的 `503 {"error":"temporarily_unavailable"}`。服务端不得记录异常对象，避免 SQL 参数携带 device_code、user_code、token 或 secret 进入日志。

独立[设备授权](auth-device.md)只使用注册公有 CLI client；[领域操作](admin-dream-operation-contracts.json)和[委托契约](admin-dream-delegation-contracts.json)来自实际严格 DTO。Runtime 只有对应用途的 opaque bearer，不接收数据库或共享服务密钥。

## 端侧账号精确回调兼容

目标：iOS的系统授权回到原App后，继续使用Dream原Client ID、S256、交易Cookie、Browser Session及用户权限。原Google→Admin回调、Web登录表单、原HTTP(S)回调、主体绑定和现有API保持。源码适配限定配置校验、现有OAuth目录及原exchange；新增客户端身份、账户、scope、grant、业务API和schema均为0。

| 配置或状态 | 定义 |
| --- | --- |
| default | `DREAM_DATA_SERVICE_CLIENTS`原`redirectUri`为当前service主Web地址，省略可选数组时保留既有行为 |
| desired | 同一service的可选`redirectUris`提供额外精确地址，规范化集合始终保留主回调；App URI从目标Info.plist确定 |
| effective | 已发布OAuth Client行的精确redirectUris与applicationType，实际code/token/exchange仍执行各自原校验 |
| revision | 已有源码版本、配置摘要及发布回执标识该次配置，行变更继续沿原updatedAt；本次沿既有schema |
| 状态转换 | 源码验证 → 兼容代码采用 → 配置desired → dry-run核对 → 显式发布 → 读回verified → App既有env映射 → 真实账号验收 |

主回调继续HTTP(S)同源；额外Web回调继续同一service来源。私有账号URI限定规范反向域名`.auth:/auth/callback`、HTTP精确loopback service来源、无authority/query/hash或路径变体。规范URI示例为`com.example.ink.auth:/auth/callback`，实际值使用目标应用标识。服务密钥、原Client ID、主Web回调及后台scope均保持原配置；新增配置只表达该Client的回调集合。`AUTH_TRUSTED_ORIGINS`继续原HTTP(S)来源，账号URI由OAuth精确登记管理。

原应用主Web回调集合继续既有目录规则；新增额外URI只加入配置它的Client。存在私有账号URI的同一公开Client使用既有`applicationType=native`，`tokenEndpointAuthMethod=none`、`requirePKCE=true`、原grant/scope及subject规则保持。实际安装的Better Auth `validateClientRedirectUri`允许native登记非loopback HTTPS、精确HTTP loopback及反向域名私有URI，拒绝HTTPS loopback；保留集合出现该冲突时目录生成关闭，原Web配置默认行为保持。

原发布入口`pnpm auth:provision-dream-oauth --browser-redirects`默认dry-run。现有行只有在新增规范App账号URI且其他字段全部一致时，允许同时把`applicationType`从web推进native；写入字段限定`redirectUris`、该必要元数据及`updatedAt`。Client ID、secret hash、认证方式、requirePKCE、grant、scope、主体、资源绑定与DPoP漂移继续拒绝；回调缩小和无新增账号URI的类型变化继续拒绝。原行锁、事务、逐字段读回与幂等核对保持，`--apply`沿原显式发布流程。

原`BrowserSessionService.exchange`接受当前已认证service的精确集合；额外URI不会进入其他service的交换许可。交易指纹继续包含redirect_uri，同交易更换URI返回原冲突，未知交换结果恢复原加密handle；OAuth code/S256、Client及active subject校验保持。

当前状态：源码与8文件53项Provider-free合同、类型和lint通过，Dream BFF/Admin实际函数29项跨仓库探针通过；隔离目录的正常构建通过，兼容代码已采用到本机正常Admin。原supervisor完成必要重启，原PostgreSQL数据目录inode保持，现Admin46563/PG46507继续端口3000/54329。现有loopback service只增加`com.inkmemory.loginntn.auth:/auth/callback`与`com.inkmemory.mobile.auth:/auth/callback`，原Client及Web地址保持。原发布入口apply verified=true，随后真实read-only事务dry-run为0差异，数据库/端口/认证主体匹配。普通Simulator已采用，原密码表单→App回调→exchange/session→关闭及一项真实Chat通过；系统会话进入原Admin并取消返回。完整Google账户与真机继续实施，技术、配置发布及真实账号业务按各自范围验收。

采用顺序保留原Web与当前会话：先验证兼容代码，再设置同Client的精确URI并按原发布入口扩展目录，核对Client/权限字段保持后采用App配置。回退优先保留已发布的兼容地址与服务端支持，通过修复版本恢复；缺少本次集合校验的旧Admin代码会影响新App重新认证，需要在回退范围中保留兼容实现。源码、运行配置、已注册状态、App采用和真实授权分别验收。
