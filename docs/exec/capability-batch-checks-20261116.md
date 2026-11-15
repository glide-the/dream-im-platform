<!-- [Input] 已确认的 Admin/Dream P0 范围、生产目录与事务入口。 -->
<!-- [Output] 实现范围、确定性技术验证与合并证据。 -->
<!-- [Pos] 本次执行记录；领域协议归现有认证与数据合同。 -->
<!-- [Sync] 2026-11-16: 实施请求内批量 ledger 与原事务完整 requirement 去重。 -->
# Capability 批量校验执行记录

## 背景与问题

原 `handleCapabilities` 对 301 个 operation 的 1157 个 requirement 引用及 5 个 delegation requirement 分别调用单项检查。前轮隔离调用计数为 1162 次，联合独立 capability 名称为 34。该证据来自生产 handler 与注入边界，未测量真实数据库或端到端耗时。

## 目标与边界

仅实施目录批量查询、原事务 requirement 批量去重及 Dream 错误归属整理。保留 DTO、operation 顺序、权限、锁、回执、请求 ID 与未知写结果。无全局 ledger 缓存、新服务、表、migration、部署或服务重启。

## 概念与规则

- [capabilitiesHandler.ts](../../app/lib/auth/capabilitiesHandler.ts) 继续从 auth 显式连接读取 physical receipts。operation/delegation 可用性使用独立的实际 data 连接，一次查询所需 ledger，并在请求内比较完整 capability/version/hash。缺失或漂移隐藏相关能力；查询异常沿原入口返回失败。
- [database.ts](../../app/lib/dream/database.ts) 的 `readSchemaCapabilities` 复用 Drizzle，按唯一名称查询。`withDataTransaction` 在原事务内去重完整要求；同名不同 version/hash 拒绝；查询完成且全部匹配后进入原 handler。空要求跳过 ledger 查询，单项调用 API 保持兼容。
- Dream 由 `AdminDataClient` 统一拥有目录状态。四处 request-auth 组合路径只在明确 capability 错误时失效目录；关联 HTTP 错误中的 `AUTH_SCHEMA_NOT_READY`、`DREAM_DATA_SCHEMA_NOT_READY` 同样失效。普通权限、冲突、业务超时或未知写结果保留健康目录。实际获取/解析目录失败保持关闭，下一次按原机制重新获取。

## 验证

全部本地回归使用注入 ledger/HTTP，未触及真实业务数据或真实模型。减少 SQL 调用机会的合同证据独立于真实耗时与生产采用。

Dream 对应记录：[跨仓库执行记录](../../../ink-dream-memory/docs/exec/admin-capability-performance-20261116.md)。

### Admin 命令回执

工作目录为 Admin 仓库，均由 `luna_test_runner` 执行：

| 命令 | 退出码 | 关键输出 |
| --- | ---: | --- |
| `pnpm exec vitest run app/lib/auth/capabilitiesHandler.test.ts app/lib/dream/database.test.ts` | 0 | 2 files、22 tests passed |
| `pnpm exec tsc --noEmit` | 0 | 无错误输出 |
| `python3 /tmp/ink-capability-admin-validation-20261116/lint-tracked.py` | 0 | 1179 个受版本控制源码文件 ESLint 通过 |
| `pnpm exec eslint app/lib/dream/database.test.ts` | 0 | 新增测试文件单独通过 |
| `pnpm test:run` | 0 | 343 files passed、18 skipped；2660 tests passed、37 skipped |
| `pnpm exec playwright test -c tests/capacity-observer.playwright.config.ts` | 0 | 2 项既有 API-only transport tests passed |

原始日志位于 `/tmp/ink-capability-admin-validation-20261116/`。首次事务测试参数数组被测试框架拆成位置参数，已修复测试数据并通过最终 22 项及 TypeScript。首次 `pnpm lint` 退出 1，诊断文件全部属于本机忽略的 `.ink-memory/` 生成物；未清理用户生成物或修改 lint 配置。目录过滤重跑未取得退出码；后续受版本控制源码列表的 ESLint 检查退出 0，完整仓库 lint 由干净 CI 验证。

Dream [PR #106](https://github.com/glide-the/im-dream/pull/106) 的 311 项定向合同通过。扩展已有 Admin-consumer Python 检查出现四项失败，已在修改前 `37a07dab` 复现相同四项；原因均为旧测试的单次只读传输断言与既有有界重试行为不一致，详细命令归 Dream 执行记录。

Admin 拉取请求：[PR #57](https://github.com/glide-the/dream-im-platform/pull/57)。两个拉取请求保留普通分支保护与检查；合并 SHA 和最终默认分支核对结果归最终交付回执。

最终 `python3 /tmp/ink-capability-docs-final-20261116.py` 退出 0：原评审 62 条引用及两份执行记录 11 条引用均有效，目录索引与原分析全文保留检查通过；Mermaid 原文保持。
