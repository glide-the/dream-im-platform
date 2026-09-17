<!-- [Input] User-authorized AutoDL deployment, merged Admin/Dream commits, existing direct-host scripts, and task 01a05775-b5b2-7362-b388-fa23be380eab. -->
<!-- [Output] Admin-side deployment plan and append-only evidence for the 2026-09-17 unified auth/data release. -->
<!-- [Pos] Admin AutoDL release receipt; secrets and business payloads are excluded. -->
<!-- [Sync] 2026-09-17: define candidate smoke, candidate-owned migration, atomic activation, pruning, and public acceptance gates. -->
<!-- [Sync] 2026-09-17: record limited-role activation, OAuth catalog provisioning, and the protected capability gate. -->

# Admin AutoDL 发布回执

## Optimized Prompt

将合并后的 Admin `main` 精确 commit 发布为统一认证中心和 Dream 数据接口服务。复用 direct-host AutoDL 脚本与远端持久 PostgreSQL；构建不可变 candidate，在旧 Admin 仍服务且 PostgreSQL 已启动时于 `16008` 隔离验证登录页面。停止旧应用后，以 candidate 自带 Drizzle 和 Provider migration orchestrator 执行唯一前向 migration，再原子切换 `current`。验证本机 `6008`、公网 `/admin/login`、migration journal、capability 与 Dream DTO API。失败时在本轮内恢复旧应用；全部通过后删除旧 release、`previous` 和 `candidate`，不保留长期回滚点，不回滚数据库。

不得合并 Admin 管理员与 Dream 产品用户；不得打印或提交 secret；不得删除 PostgreSQL、Artifact 或 Dream workspace。Dream 发布必须等待本阶段成功。

## Authentication recovery gate

首次只验证公开登录页是不充分的：恢复后的数据库已有 64 个 migration，但缺少配置中的 `ink_auth`、`ink_admin_control`、`ink_dream_data` 登录角色，OAuth catalog 也缺少 browser/device/service clients。因此 token endpoint 返回 `temporarily_unavailable`，Dream 记录 `ADMIN_SERVICE_AUTH_UNAVAILABLE`。

在修改生产 ACL 前，已创建并校验完整 PostgreSQL custom-format 备份。现有、绑定发布 commit 的 access runner 随后完成 dry-run 与显式 production apply：64 migrations、8 required capabilities、144 policy statements，policy SHA 为 `8dd2128cacb1577f4b5b2a9b9d5e358ee1600c66b29c15be2b382840b82f795e`；三个受限登录角色与 Dream no-login/no-connect 角色均通过 credential/权限探针。现有 OAuth catalog DTO/事务 provisioning 创建 browser、device 和 confidential service clients。使用 Basic client authentication 的 `client_credentials` 兑换与受保护 `/api/internal/dream/v1/capabilities` 均返回 HTTP 200，过程中没有输出 credential 或 token。

AutoDL 发布现在在 migration 后同步 OAuth catalog，并在 `verify` 中执行相同的 service-token/capability 探针；ACL 未激活、catalog 缺失或数据库访问失败都会使发布失败，不能再以登录页 200 宣称认证链可用。

## 初始证据

设备重启后服务未运行，但 `/root/ink-autodl/admin/current` 和持久目录仍存在。本段不声明部署成功；实际 commit、migration 数、health 与公开入口结果在执行后追加。

- 首次恢复旧 current 失败：远端历史 `start-admin.sh` 缺少执行位；候选未构建、未切换。启动器改为启动前验证普通文件并幂等修复 `0755`。
- 第二次恢复证明设备重启清除了 `/root` 的服务用户 ACL；将 `setup_host` 提前到旧 current 启动前，先幂等恢复路径穿越权限。候选仍未构建或切换。
- 第三次候选通过隔离端口，但 Next standalone 中已有 `drizzle` 占位目录，复制后形成 `drizzle/drizzle/meta/_journal.json`，迁移器按合同拒绝缺失的根级 journal。同一 commit 重试还暴露了 release ID 不唯一会覆盖 current 目录的问题。发布脚本现以 commit 加 UTC 时间生成不可变 candidate ID，复制前移除占位目录，并在候选落盘前断言根级 journal；该次不作为成功发布回执。
- `7c3719793a26.20260917110115` 完成 64/64 migration 并切换后，未携带凭据的 capability 探针返回 `AUTH_NOT_CONFIGURED`。根因是生成的 `DREAM_DATA_SERVICE_CLIENTS` JSON 未做 shell 编码，启动器 source 后丢失 JSON 引号。生成器与测试现按远端真实 source 语义修复；在 capability 恢复前不推进 Dream 发布。
- 原先以 `suoxya.com` 验证的公网值已按用户指定撤销。当前实例只使用部署变量注入的 SeetaCloud 6008 映射作为 Admin origin，Dream 6006 映射作为 trusted origin/resource/callback；这些实例值只进入 gitignored 配置和本发布回执，不成为脚本默认值。
