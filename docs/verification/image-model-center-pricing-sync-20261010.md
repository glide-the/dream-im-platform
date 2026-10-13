<!-- [Input] Requested Image Provider simplification/pricing sync, current source, independent review and fresh validation receipts. -->
<!-- [Output] Incremental implementation scope, corrections, command evidence and honest acceptance boundary. -->
<!-- [Pos] Current follow-up receipt; prior Image delivery and real-model acceptance are separate historical evidence. -->
<!-- [Sync] 2026-10-10: close the requested shared sync implementation with fresh command, browser and cleanup receipts. -->
# Image 模型中心：Provider 简化与价格同步

> 后续已落实“Image 只配置、日志/计费各归原模块”的修正，见[职责归属回执](image-model-center-module-boundaries-20261010.md)。下文是价格同步阶段的实际回执；其截图中的请求入口不再代表现行页面。

## 1. 本次范围

Image Provider 移除额外就绪汇总及无人引用的 `ImageProviderReadiness`，直接复用原连接列表。Image Pricing 新增 AI Pricing 同款 models.dev 同步按钮，复用服务器发现、不可变快照、来源审核、权限、审计与价格版本；新增本中心审核薄路由，不建立平行管理或计费系统，不增加表/迁移。

审核展示文本输入/图片输出目录参考价，图片输入保留既有平台价或明确配置。目录缺失或未匹配不写成零价；零平台价仍合法。应用只写既有 default 层新版本，不改变其他层级、历史账单和已有文本/缓存分项，不折算 Codex credits。

源码：[时间线](../../app/components/admin/AIPricingTimeline.tsx)、[共享审核](../../app/components/admin/PricingSyncReview.tsx)、[服务器同步](../../app/lib/admin/pricing-sync.ts)、[共用窗口校验](../../app/lib/admin/pricing-windows.ts)、[Image Provider 页面](../../app/(admin)/admin/(workspace)/image-models/providers/page.tsx)。本次未处理请求记录入口归属或其他新业务范围。

## 2. 实际评审与修订

独立执行者检查已落盘设计和实际代码，不仅评审计划：

| 问题 | 修订 | 必需新证据 |
| --- | --- | --- |
| P0：同步未检查有界/未来价格窗口，可能提交重叠版本；重复开放版本未拒绝 | 从普通管理写入抽取原 `pricing-windows.ts` 共用锁/窗口校验；LIMIT2拒绝重复开放行，冲突事务回滚；从有界前序继承其他价格维度但不改其窗口 | 单测及隔离公开 Apply409、历史不变、快照仍ready |
| P1：不同快照按相反模型顺序应用可能形成死锁 | 在获取任何模型/价格锁前按稳定模型ID排序 | 单测锁序及隔离屏障下两个真实并发Apply均200、仅两条新版本 |
| P2：错误/过期审核缺少就地重新同步 | 共享审核提供恢复按钮，Image范围与返回路径保持 | 当前源码及浏览器回归 |
| P2：空匹配Image快照可能被复用为文本 | 空快照不参与缓存复用，不新增scope表/列 | 查询与回归 |
| P2：未配置图片输入被审计成沿用旧版本 | 来源改为not_configured，保留显式0和真实旧版本区别 | 当前来源序列化 |

复用已有合同的函数抽取用于修复真实风险，不为通过评审制造代码变化。无新增表、自动调价、后台队列、环境分支、独立账本或外部控制通道。

## 3. 本轮命令回执

### 3.1 最终通过证据

确定性检查由 `luna_test_runner` 实际执行。表中 unit/build 均发生于窗口与锁序修订后；其后仅修正测试夹具、变量和视口断言，没有修改应用源码。最终 typecheck、lint 和完整 E2E 在这些测试修正后再次运行，不以修订前结果替代。

| 实际命令 | 退出码 | 关键输出与覆盖 |
| --- | --- | --- |
| `pnpm exec tsc --noEmit` | 0 | 当前应用和最终 E2E spec 类型检查通过 |
| `pnpm lint` | 0 | 当前完整工作树 ESLint 通过 |
| `pnpm exec vitest run app/lib/admin/pricing-sync.test.ts app/lib/admin/pricing-sync-handlers.test.ts app/components/admin/AdminModulePage.test.ts app/components/admin/AdminResourceManager.test.ts` | 0 | 4 文件，35/35 tests；目录解析/匹配、金额维度、严格 DTO、权限、窗口、锁序和共享管理回归 |
| `pnpm test:run` | 0 | 313 文件通过、18 跳过；2314 tests 通过、37 跳过；130.24s。跳过项目不计通过 |
| `INK_ADMIN_E2E_DIST_DIR=.next-e2e-image-sync-build pnpm build` | 0 | 独立 build 成功，包含 Image 审核与 Images 路由；仅自有构建目录已清理 |
| `node scripts/verify-image-model-center-e2e.mjs /var/folders/bn/m6tkvhx160d9nx6v6rkkkrj80000gn/T/ink-gateway-deadlock-test-nm1Gl3/fixture.json` | 0 | Playwright `1 passed`，53.2s；当前完整流程及桌面/窄屏断言通过 |

最终 E2E 使用全新具名 `ink_gateway_deadlock_test_bc7b4de9ee89` 和 `ink_gateway_deadlock_test_bc7b4de9ee89_ui`，主执行者显式准备，79/79 前向迁移。测试调用生产页面与公开 Admin/Gateway API，Provider 为受控 fake；未使用正常账户、正常账本或生产模块测试分支。浏览器使用已安装 Chrome，未重复下载或初始化浏览器。

### 3.2 完整流程与视觉证据

实际覆盖 Provider 配置 → Image 模型配置 → 平台价格 → 授权 → 生成 → 参考图及 mask 编辑 → 完整结果 → 实际用量与费用结算 → 安全请求记录。包含权限拒绝、模型停用、非法输入、上游失败、无图/错误结果、用量缺失、大用量、重复请求、停止、已知/未知用量恢复及相关重试，并回归 AI 三栏、文本价格同步和共享计费。

新增同步专项实际覆盖：按钮和本中心审核路由；平台图片输入价保留；六个价格维度正确持久化；未授权和越界输入拒绝；同快照再次 Apply409 且版本数不变；已应用审核可重新同步；文本歧义候选人工选择；有界价格窗口冲突409且历史不变；重复开放价格409；两个相反模型顺序的并发 Apply 在真实 PostgreSQL 锁屏障下均200且仅创建两条新版本。最终无未预期浏览器 console/pageerror/5xx 诊断。

主执行者已查看本轮实际截图：

- [Image Pricing 同步按钮及新版本，1440×1000](../../test-results/image-model-center/image-model-center-Image-p-98c08-→-settlement-→-safe-records-chromium/image-pricing-sync-1440x1000.png)。
- [价格复核桌面，1440×1000](../../test-results/image-model-center/image-model-center-Image-p-98c08-→-settlement-→-safe-records-chromium/image-pricing-review-1440x1000.png)。
- [价格复核窄屏，390×844](../../test-results/image-model-center/image-model-center-Image-p-98c08-→-settlement-→-safe-records-chromium/image-pricing-review-390x844.png)。

窄屏实际通过 Apply `toBeInViewport`、footer `top >= 0` / `bottom <= viewportHeight` / `width <= viewportWidth` 和 document 无横向溢出断言。`testInfo.attach("image-pricing-review-footer.json")` 未被当前 wrapper reporter 物化成独立文件，不提供未保存的具体 rect 数值；截图与断言回执可复核。

### 3.3 中间失败与修订历史

以下均为本轮实际失败，不计最终通过：

| 失败 | 回执与修订 |
| --- | --- |
| 第一次动态加载完整 Admin 同步模块，认证 JSON import 缺 Node ESM 属性 | E2E exit1，已完成生成/编辑/结算等前半段但同步 Apply 未运行；普通 Node 重跑仍 exit1。改为仅类型导入生产 `ModelsDevEntry/PricingSyncMatch` 的受控快照 DTO，不复制匹配算法或改变生产认证加载。生产目录解析/匹配由单测与正常 Admin 发现证明；公开 Apply 由本轮 E2E 证明。失败产物分别保留 `test-results/image-sync-loader-failure-20261010`、`test-results/image-sync-json-loader-failure-20261010` |
| 测试新增变量与原用例重复声明 `duplicate` | tsc exit2、E2E 编译 exit1，未进入该轮浏览器业务；改名 `duplicateWindowReply`。产物保留 `test-results/image-sync-spec-duplicate-20261010` |
| 测试模型复用 Provider/upstream 唯一组合 | E2E exit1，模型创建期望201实际409；每个夹具模型改用独立上游型号，保持生产唯一约束。产物保留 `test-results/image-sync-duplicate-upstream-409-20261010` |
| 桌面截图文件名1440×1000但实际默认1280×720 | 完整流程曾1passed/52.8s，不能作为正确桌面尺寸证据；显式设置视口并补 footer/窄屏断言，最终全新 fixture 1passed/53.2s |
| 主执行者误写 `pnpm typecheck` | exit254，项目无此 script；更正并实际执行 `pnpm exec tsc --noEmit` exit0，不判为产品缺陷 |

修订前33/33 focused、2312完整 tests的结果保留为历史，不作为本次最终证据。各已写入业务数据的隔离 fixture 都由主执行者原生关闭，随后使用全新具名数据库；未用部分成功替代完整回执。

### 3.4 自有资源清理

最终 fixture runner session9214 输入换行，exit0，输出 `owned PostgreSQL cluster and private fixture removed`。删除的仅为本轮隔离 PostgreSQL、私密 manifest 与临时目录；正常业务记录未清理。失败诊断和最终截图保留。

| 清理核对命令 | 退出码 | 结果 |
| --- | --- | --- |
| `test ! -e /var/folders/bn/m6tkvhx160d9nx6v6rkkkrj80000gn/T/ink-gateway-deadlock-test-nm1Gl3` | 0 | 最终自有临时目录已不存在 |
| `test ! -e .next-e2e-image-sync-build` | 0 | 自有 build 目录已不存在 |
| `lsof -nP -iTCP:56455 -sTCP:LISTEN` | 1 | 无输出，最终自有 PG 端口无监听；这里1表示无匹配，不是产品失败 |
| `lsof -nP -iTCP:3000 -iTCP:54329 -sTCP:LISTEN` | 0 | 正常 Admin PID19557、正常 PG PID19495 保持不变 |

### 3.5 最终文档检查

Luna 实际执行只读 `node` stdin inventory/link scanner，exit0。输入范围为 `git status --short -- docs` 的14个变更Markdown、递归docs的14个README/.folder，以及15个显式必检路径；去重后实际读取30个文件，检查175个本地Markdown引用，缺失文件0、缺失引用0。引用解析支持路径内嵌括号；源码/截图路径确实存在，不把命令中的已清理临时路径当作现行引用。

显式范围包括Image PRD及两份完整历史、正式设计及两份完整历史、调查/评审/上轮实现/本次回执、任务记录，和Image页面、共享组件、Admin领域、E2E四处目录合同。首次只遍历docs目录的24文件/174引用检查不足以证明PRD历史正文和app合同，已用上述显式范围补跑，最终以30文件/175引用为准。

`git diff --check` exit0。最终回填仅增加本段命令、计数和覆盖文字，不改变已检查的引用路径。

## 4. 正常 Admin 检查与未验证边界

主执行者在已登录的正常Admin/Chrome点击Image Pricing的实际按钮，取得真实models.dev目录并进入 `/admin/image-models/pricing/sync/pricing_sync_4e21c595544048788dc266cd43191554`。现有 `codex-gpt-image-2` 为歧义匹配，展开全部五个参考来源，选OpenAI后平台图片输入仍为现有值。点击“稍后处理”返回本中心，原manual平台价格未改变。本轮只新增发现快照与审计，不应用真实账户价格，也不调用真实模型。

该正常检查证明实际目录网络发现与页面交互；隔离技术验证另外证明价格应用、授权、持久化、窗口和并发。上轮真实Codex生成/编辑仍在正常后台保留，但不是本次重新验收；真实OpenAI仍未验收。不得把本次fake模型或目录网络成功称为真实模型验收。

本次为既有 Image 交付的后续增量，没有创建重复 Codex 任务或重设目标；原任务完成记录见[上轮交付回执](image-model-center-implementation.md)。本次功能、评审修订和必需隔离验证已闭合，真实模型验收仍遵守上述独立边界。
