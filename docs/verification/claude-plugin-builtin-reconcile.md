# Claude Plugin 内置包协调验证

Registry183-184 把 Dream 启动期的 ready installation 查询和 Deck ref 回填迁入 Admin。
输入 DTO 只有平台内置 package spec 或关闭的生命周期事件；Service 从 active binding 的精确
release manifest 派生引用目标；Repository 用 typed Drizzle 执行 installation/binding/release/ref
读写。Dream 后续消费者仍负责真实 CLI、制品和共享文件系统操作。

| 验证 | 工作目录 | 结果 | 关键证据 |
| --- | --- | --- | --- |
| focused Vitest | Admin worktree | exit 0 | 4 files，16 tests passed |
| full provider-free unit | Admin worktree | exit 0 | 271 files passed，17 skipped；2060 tests passed，36 skipped |
| TypeScript | Admin worktree | exit 0 | `pnpm exec tsc --noEmit --incremental false` |
| owned ESLint | Admin worktree | exit 0 | 新增与受影响文件通过 |
| production build | Admin worktree | exit 0 | DB package、Next compile、TypeScript、19 个静态页面及 route inventory 通过 |
| generated registry | Admin worktree | exit 0 | 184 operations；Registry182 prefix SHA 保持不变；Registry184 SHA `f71ac328ad7670298d518e388b2fde89033387f97ac35b91a0ea66da487b40cd` |

断言覆盖 service-only scope、禁止 browser bearer、strict input、已有 ready installation、缺失时
返回 install plan、有效/无关/损坏 manifest 的引用选择、complete source 校验、冲突安全插入与
用户/后台原始回执 actor。此技术门禁不宣称 Dream 启动消费者、真实 CLI 或正常业务验收完成。

<!-- [Sync] 2026-09-16: deterministic Registry183-184 provider evidence. -->
