<!-- [Input] Writing suggestion HTTP409, the exact linked subscription and the active ECS Admin release. -->
<!-- [Output] Incident cause, scoped current-period recovery and automatic scheduler delivery evidence. -->
<!-- [Pos] Project execution record for the 2026-11-12 subscription period recovery. -->
<!-- [Sync] 2026-11-12: distinguish current-period recovery, scheduler activation and model acceptance. -->
# 订阅周期恢复记录

## 范围与故障依据

写作建议返回 HTTP 409，前端原传输丢弃结构化错误码。按用户提供的建议 Cell ID 定位其 Session、Thread 和账户后，只读核对当前订阅、套餐版本、模型目录及待处理消息。核对事务使用 `default_transaction_read_only=on` 和 `statement_timeout=5000`，目标身份为现用 `ink-memory:54329`。

该 Thread 无已保存消息和待处理队列。已选模型存在且启用，Provider 和价格就绪。当前套餐 `code=free`，版本 `base_price_microusd=0`，`renewal_enabled=true`；原周期于北京时间 2026-11-11 16:51:14 结束，订阅状态仍为 active。Gateway 目录按周期边界将其判为 subscription_inactive，Dream 模型选择因此触发 `GATEWAY_MODEL_SELECTION_STALE`。

线上缺少订阅周期 timer，HTTP worker secret 尚未配置。原 `advanceDueSubscriptions`、`advanceSubscriptionPeriodOnClient` 与月度锚点逻辑已经存在。

## 已完成的当前周期恢复

通过现用 release 的原生产订阅服务执行单账户恢复。事务内再次校验数据库、账户归属、套餐标识、价格 0、自动续期已开启、无待生效版本和原周期已到期；调用原 `advanceSubscriptionPeriodOnClient`，使用原 `subscription-period:<subscription>:<next-period>:<boundary>` 幂等键。

结果 `outcome=renewed`、period 0 → 1、version 1 → 2，下一周期结束时间为北京时间 2026-12-11 16:51:14。新额度和 `period_boundary` 事件由原 service 写入。该恢复保留原月度锚点、套餐版本和历史记录。

## 自动任务交付

- 新入口：[run-subscription-period-worker.sh](../../scripts/run-subscription-period-worker.sh)。
- 主机模板：[service](../../deploy/systemd/ink-memory-subscription-periods.service.template)、[timer](../../deploy/systemd/ink-memory-subscription-periods.timer.template)。
- 当前 Admin：`ink-memory-admin.service`，运行账户 `ink-admin`，现用入口 `pnpm run start:embedded`。
- 任务每次从主服务读取当前 release，以同一运行账户执行原 worker 并关闭自有连接池；主服务保持原进程。
- 主机安装位置：`/usr/local/libexec/ink-memory-admin-subscription-periods` 与 `/etc/systemd/system/ink-memory-subscription-periods.{service,timer}`。
- 本次主机配置：检查间隔 60 秒，单次执行期限 120 秒。模板参数由运维配置持有，订阅周期继续采用原业务锚点。
- 安装时物理可用内存约 522 MiB，Swap 为 0；本次无构建、migration、Admin重启或数据恢复。
- `systemd-analyze verify --man=no` 退出 0；系统既有 xfs unit 的 CPUAccounting 提示不影响本任务校验。

`systemctl enable --now ink-memory-subscription-periods.timer` 已完成。北京时间 01:37:16 首次自动触发，01:37:20 成功结束：`processed=37`，原服务按既有规则完成 36 次零价套餐续期及 1 次已申请的期末取消。执行峰值内存 101.3 MiB。

北京时间 01:38:23 自动再次触发，01:38:29 成功结束：`processed=0`；原周期边界未重复发放额度。当前账户的新周期 allowance 数量为 1，`period_boundary` 审计数量为 1。timer 保持 active，Admin 原 PID 1064 保持。

使用现用 release 的 `listAvailableGatewayModels` 在只读连接上核对当前账户，已选模型返回 `callable=true`、`availability=included`、`messages_callable=true`。

## 验收边界

`sh -n scripts/run-subscription-period-worker.sh` 退出 0。隔离命令夹具分别验证未配置和主服务停止时退出，active 时读取当前 WorkingDirectory 并传递 `.env.local`、tsx 及原 worker 入口。

`corepack pnpm exec vitest run app/lib/subscriptions/cycle.test.ts app/lib/subscriptions/service.test.ts --exclude '**/*.integration.test.ts'` 退出 0，2 files、12 tests passed。相关 Markdown 相对链接检查 77 个，缺失 0，目录清单存在。

当前周期恢复属于真实业务修复。原模型的实时调用资格、自动任务的审计和重复触发结果分别核对。真实模型建议生成尚未执行。前端 HTTP 错误恢复由 Dream 仓库的独立技术回归验证。
