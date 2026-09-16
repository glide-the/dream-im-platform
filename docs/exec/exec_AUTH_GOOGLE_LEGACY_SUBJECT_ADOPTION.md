# Google 旧主体接管执行计划

## Optimized Prompt

在 Admin 项目中实现一次受控、可审计、可重复执行的 Google 旧主体接管。已有证据是：真实 Google 登录已完成回调，Admin 以 `LEGACY_SUBJECT_LINK_REQUIRED` 停止；旧 `public.oauth_accounts` 中存在与 canonical Dream user 精确关联的 `provider = google` 与非空 `provider_sub`；Better Auth 身份表仍为空。不得按邮箱推断合并，不得创建 Admin 管理权限，不得修改旧用户、旧 OAuth 行、Runtime、SSE、资源策略或共享文件系统。

采用严格 DTO → domain service → typed Drizzle ORM repository：私有 0600 配置绑定数据库名、端口、数据目录、canonical user ID、legacy Google account ID、两份源行 SHA-256 与证据说明；目标 Better Auth user/account ID 只能由 Admin 根据 Google `provider_sub` 稳定派生。默认 dry-run；正式写入必须同时提供 `--apply --production-approval`。同一事务获取 advisory lock，验证 identity capability、源行状态、精确 FK、规范化邮箱、源指纹和目标空/完整状态，再原子创建 `identity.user`、Google `identity.account`、Dream `identity.subject_links` 与脱敏 audit。任何来源漂移、部分写入、身份冲突或现有 Admin subject link 必须 fail closed。重复执行返回 already-complete，不重复写入；未知提交结果通过同一输入重跑恢复。

输出只包含模式、动作、不可逆向的 subject 摘要、源指纹和布尔边界，不输出邮箱、`provider_sub`、Token、密码哈希、DSN 或 secret。先完成 provider-free DTO/domain tests、TypeScript、focused lint 与 build，再对正常数据库依次执行 inspect、dry-run、apply、repeat apply 和只读核对；随后从 Dream 公开登录入口重跑 Google 登录，验证 Dream 访问成功、Admin 管理接口仍为 403，并继续 Device Flow 与完整业务回归。

## Optional Enhancers

- 若未来需要同时接管 Admin 成员，必须使用独立 DTO、独立证据与独立审计操作，不能扩展本操作按邮箱添加 `admin_subject_links`。
- 若旧 Google 行缺少精确 `provider_sub` 或源指纹变化，保留原数据并转入人工冲突处理，不提供弱化门禁。

## 本轮影响与验收

| 项目 | 责任 | 依赖 | 保持不变 | 验收 |
| --- | --- | --- | --- | --- |
| Admin | DTO、Service、Drizzle Repository、发布 CLI、audit | `identity.better-auth.v1`、旧 Google 精确绑定、migration owner credential | schema/migration、旧 canonical PK、旧 OAuth、Admin RBAC | dry-run/apply/幂等、测试与构建 |
| Dream | 仅重跑现有登录和业务入口 | Admin 接管完成 | 登录 BFF、Runtime、SSE、文件系统 | 登录成功、管理权限 403、业务回归 |

失败处理：配置或数据库目标不匹配时连接前或事务内停止；源行、指纹、邮箱、主体映射或 Admin link 不符合时回滚；唯一约束或连接异常不吞掉，输出固定脱敏错误码；Admin 不可用时 Dream 不回退 PostgreSQL。

## 实际回执

2026-09-16 在 owner-only 正常库配置上依次完成 inspect、dry-run、`--apply --production-approval`、重复 apply 和只读核对。第一次正式执行为 `create`，重复执行为 `already-complete`；Better Auth user、Google account、Dream subject link 和 adoption audit 各一条，Admin subject link 为0，旧 Google绑定行仍为一条且未修改。随后真实 Google callback 与 Admin OAuth consent成功，产生一条 Better Auth Session、一条browser session和一条refresh token lineage，返回Dream Chat；同一浏览器访问Admin管理入口仍停在Admin登录页。

| 命令/入口 | 结果 |
| --- | --- |
| `pnpm exec vitest run app/lib/auth/legacyGoogleAdoptionService.test.ts` | exit 0；8 tests passed |
| `pnpm exec tsc --noEmit` | exit 0 |
| focused `pnpm exec eslint ...` | exit 0 |
| `pnpm build` | exit 0；DB package、Next 16.1.6 TypeScript、19个静态页面与生产路由构建通过 |
| `pnpm test:auth-adoption:contract` | exit 0；全量Admin Drizzle迁移、inspect/dry-run/apply/replay、无Admin membership、旧行不变、invalid-mode脱敏和自有数据库清理通过 |
| 正常库inspect/dry-run/apply/replay/read-only probe | exit 0；精确目标与源指纹通过，重复执行幂等 |
| Dream → Admin → Google → callback → consent → Dream | 浏览器返回 `http://localhost:5173/story-workspace/chat`，产品历史加载；Admin管理入口未授权 |

回执不记录邮箱、Google subject、Token、private manifest、DSN或secret。完整Device、退出/失效、Run/Thread/SSE、文件和模型流程仍由跨项目真实业务验收继续覆盖。
