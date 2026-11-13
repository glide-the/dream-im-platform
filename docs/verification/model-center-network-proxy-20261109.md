<!--
[Input] User-confirmed global Provider/price-sync switch and final source/browser/build command receipts.
[Output] Implementation scope, exact verification results and remaining deployment configuration.
[Pos] Provider-free implementation receipt; not a production release or real-model acceptance.
-->
# 模型中心 Docker NAT 开关验证回执（2026-11-09）

## 交付结果

AI 模型中心与 Image 模型中心共享的供应商列表顶部增加“本机 Docker NAT 代理”开关，统一控制所有供应商请求和价格目录同步。配置复用 PostgreSQL `system_settings`，支持权限、Origin、严格输入、版本冲突与同事务审计。未新增 schema 或 migration。

关闭时恢复服务器原有网络设置；开启时使用运维配置的回环 HTTP 代理。代理未配置时禁止启用，已启用但配置丢失时失败关闭。Gateway 在读取策略后才标记派发，策略读取也遵守原取消/超时；切换不取消已派发流。详细规则见[设计](../design/model-center-network-proxy.md)。

## 验证命令与结果

| 命令 | 退出码 | 证据 |
| --- | --- | --- |
| `pnpm exec tsc --noEmit` | 0 | 完整类型检查通过 |
| `pnpm lint --ignore-pattern '.ink-memory/maintenance/**'` | 0 | 全部源码通过；仅排除已有旧制品归档 |
| `pnpm test:run` | 0 | 338 文件、2634 项通过；18 文件、37 项按原配置跳过，110.21 秒 |
| `pnpm exec vitest run app/lib/model-egress.test.ts app/lib/gateway/provider-transport.test.ts app/lib/gateway/image-transport.test.ts --reporter=dot` | 0 | 最终 3 文件、35 项通过，包含最后新增的策略读取期间取消回归 |
| `pnpm exec playwright test --config tests/e2e/model-egress.config.ts --reporter=line` | 0 | 最终版本 3 项通过，4.5 秒；系统 Chrome，桌面与窄屏，无意外诊断错误 |
| `pnpm build`，使用下方独立构建参数 | 0 | 约 44 秒；Webpack 编译 22.2 秒，单 worker 完成全部静态页面，包含 `/api/admin/model-egress` |

最终全量单测与构建显式指定不存在的本机数据库入口 `127.0.0.1:1`，数据库名分别为 `ink_model_egress_unit_unreachable`、`ink_model_egress_build_unreachable`，并设置 `PG_CONNECTION_TIMEOUT_MS=1000`，避免未注入的验证代码访问正常数据库。持久化与授权合同由受控单测验证，没有使用正常业务数据创建设置。

首次直接执行 `pnpm lint` 返回 1，原因是 `.ink-memory/maintenance/**` 既有构建归档被扫描，产生 6360 个错误和 12314 个警告。没有为此删除归档或修改公共 lint 配置；上述带明确排除项的全源码检查退出 0。实现期间发现的类型与旧单测依赖边界问题已修复，最终命令如表所示。

构建参数：

```sh
INK_ADMIN_E2E_DIST_DIR=.next-e2e-model-egress-build \
NEXT_BUILD_CPUS=1 NEXT_WEBPACK_MEMORY_OPTIMIZATIONS=true \
NODE_OPTIONS=--max-old-space-size=2048 pnpm build
```

本机物理内存 16 GiB，检查时可用比例约 33%；单 worker、2 GiB 堆另留 native/父进程及运行服务余量，240 秒期限内完成，没有并发构建或重试。验证制品位于 `.next-e2e-model-egress-build`，约 549 MB，BUILD_ID 为 `gNkO5g6Vv5ClPowfJF2yH`。保留该目录及 Next 自动生成的 `next-env.d.ts` 引用供本地复核，均不作为提交内容或发布动作。

浏览器直接渲染生产供应商组件与真实样式，用受控 DTO 验证开关保存投影、刷新、409 恢复、键盘操作、只读、未配置以及 1440px/390px 布局。测试使用自有回环服务器和浏览器，结束后退出，不启动 Admin 或数据库。共享 transport 单测另使用真实本地 CONNECT 验证代理路径及关闭后恢复原出口。上述组件响应不作为真实数据库持久化或线上网络验收。

本地诊断保存在 `/tmp/ink-model-egress-validation-*.log`，四张启用/关闭截图保存在 `test-results/model-egress/`。用户已有服务和工作区改动保留。最终 Markdown 清单检查覆盖 13 份文档、94 个本地链接，缺失路径为 0；具名变更的 `git diff --check` 退出 0。

## 发布边界

源码与验证已完成，尚未执行 GitHub 手动发布、服务重启或正常业务数据库写入。启用前需要运维核对已有 Docker NAT 监听，并将 `MODEL_EGRESS_PROXY_URL` 配置到应用进程；该地址不在页面输入或回显。线上真实供应商、价格目录和真实模型验收仍需在发布后分别执行。

后续发布已完成，提交、Actions和运行状态见[发布回执](model-center-network-proxy-release-20261109.md)；上述“尚未发布”描述保留为原实现阶段的历史范围。
