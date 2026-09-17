<!-- [Input] One locked-out independent Admin operator, the current auth-domain contract and local control credential. -->
<!-- [Output] Recovery design, implementation boundary, safe operator command and deterministic validation receipt. -->
<!-- [Pos] Current Admin lockout recovery execution record; it contains no password, hash, token or database DSN. -->
<!-- [Sync] 2026-09-17: record implementation, normal-database apply, Session revocation, and public login/logout acceptance. -->

# Admin 独立密码恢复

## 背景与问题

现有管理员记录存在、状态为active并具有`super_admin`角色，但用户提供的Dream密码不匹配`admin_users.password_hash`。Admin与Dream身份必须继续分离；不能通过相同邮箱接受Dream credential，也不能直接改表而遗漏Session撤销和审计。

## 目标与边界

### Optimized Prompt:

Implement a local, fail-closed password recovery path for an existing independent Admin operator. Preserve the separation between `admin_users/admin_sessions/RBAC` and Dream Better Auth/canonical users. The command must default to a read-only plan, require explicit `--apply`, accept only the Admin email in argv, read a 14–256 character password twice from a hidden interactive TTY, and never emit or persist plaintext/password hashes. Use the configured Admin control credential and exact identity capability. In one typed Drizzle transaction, lock one active Admin member, replace its scrypt password hash, revoke all existing Admin Sessions, and append a redacted audit record. Return a safe receipt, update repository contracts and operator documentation, and validate DTO/service behavior, typecheck, lint, dry-run against the normal local database, and real login only after the operator enters the new secret locally.

USER REQUIREMENT:

Explain and provide the correct way to reset the locked-out Admin password without merging it with the Dream user.

## 概念与规则

- Dream密码、Better Auth account、OAuth subject及产品权限不参与恢复。
- 默认命令只读取并验证一个active Admin member；没有`--apply`不写数据库。
- apply只从本机TTY读取两次密码，不接受password参数或环境变量。
- 密码替换、旧Session撤销和`admin.password.recovery`审计共用一个事务；任一步失败全部回滚。
- 回执只包含邮箱、操作模式、是否修改及撤销Session数量。

## 验收

- Provider-free单元测试覆盖dry-run、active校验、最短长度、hash调用、Session撤销及脱敏回执。
- TypeScript与ESLint通过。
- 正常本机数据库dry-run识别目标Admin但不改变password、Session或audit。
- apply后新密码通过公开`/api/admin/auth/login`，测试Session可正常退出；真实密码不进入argv、环境变量、日志或本回执。

## 验证回执

| 验证 | 结果 |
| --- | --- |
| `pnpm exec vitest run app/lib/auth/adminPasswordRecovery.test.ts app/lib/auth/adminAuthService.test.ts app/lib/admin/password.test.ts` | exit 0；3 files、11 tests通过 |
| `pnpm test:run` | exit 0；285 files通过、17 skipped；2143 tests通过、36 skipped |
| `pnpm exec tsc --noEmit` | exit 0 |
| 聚焦ESLint | exit 0 |
| `pnpm auth:reset-admin-password --email <admin-email>` | exit 0；正常数据库返回active目标、`willRevokeAdminSessions=true`、`dreamIdentityChanged=false`，未写数据库；回执不保存真实邮箱 |
| 非TTY执行`--apply` | 按设计exit 1并返回`ADMIN_PASSWORD_RECOVERY_REQUIRES_TTY`；没有数据库事务 |
| 传入未支持的`--password`参数 | 按设计exit 1并只输出usage；密码不能进入argv |
| `git diff --check`与Markdown相对路径检查 | exit 0 |
| `pnpm build` | exit 0；DB package编译、Next production compile、TypeScript、19个静态页面和完整route trace通过 |

## 正常数据库应用回执

在用户已明确要求初始化密码后，`pnpm auth:reset-admin-password --email <admin-email> --apply` 通过隐藏TTY完成两次输入。命令返回`passwordChanged=true`、`sessionsRevoked=21`、`dreamIdentityChanged=false`；密码替换、Session撤销与审计共用一个事务。随后公开`/api/admin/auth/login`返回200并设置独立Admin Session，logout返回200。未读取、创建或修改Dream credential、Better Auth Dream subject、canonical用户或业务权限。
