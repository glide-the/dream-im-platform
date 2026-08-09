# Ink Memory 模型目录、默认 Free Subscription 与三套餐最终报告

日期：2026-08-09  
审计范围：Admin `/Users/dmeck/project/ink-admin-memory`、Dream `/Users/dmeck/project/ink-dream-memory`、本机专用 PostgreSQL `ink-memory`

## 结论与发布状态

| 状态 | 结论 |
| --- | --- |
| 已完成 | 原 `GATEWAY_MODEL_NOT_AVAILABLE` 根因已证明并修复；目录可见性与推理资格已分离；全部 30 个 canonical 用户有 Billing Account 和有效 Subscription；Free 真实 Gateway/SSE/Token Ledger 闭环及双视口无 mock E2E 已通过。 |
| 有意 deferred | Dream/is-dreaming 的价格、支付、checkout/webhook、退款和真实升级/降级；两 Plan 仅为正式 identity + draft v1，页面明确暂不可开通。 |
| 商业配置阻断 | `hy-preview` 虽 enabled，但缺 active Pricing 和 published Plan Entitlement，真实状态只能是 `maintenance`，不能安全宣称高级模型 `upgrade_required`。代码路径已有合同测试，真实商业验收需先发布可信 Pricing/Plan Version/Entitlement。 |

因此：代码、数据和 Free 用户真实调用闭环已完成；“真实高级模型需要升级”的商业环境验收尚未完成，不能把整个商业发布标记为完全通过。

## 根因与处理判断

原错误不是 Admin listener、Gateway Key、issuer/audience、保存 alias 失效或单纯 Provider 故障。真实根因是：

1. Admin 旧 `GET /v1/models` 从 Subscription/Entitlement/Allowance 资格链起表，把“是否能调用”误当成“是否能看到”。
2. 29 个历史 canonical 用户中，27 个没有有效 Subscription；因此他们得到空目录。
3. Dream 又把空目录统一映射为 `GATEWAY_MODEL_NOT_AVAILABLE`，丢失了“未订阅/缺权益/额度不足/维护”等业务原因。
4. 当时只有 2 个用户具备 callable Subscription，造成“似乎只有测试用户能用”的现场表现。

修复后，enabled model 决定目录行是否可见；用户级资格只决定 `callable` 和 `availability`。无匹配订阅是正常业务状态，目录仍返回 200；只有 Admin 不可达或服务身份错误才返回 503。

## 新合同：Visible 与 Callable

Dream BFF 对已认证 canonical 用户公开的模型字段仅包括：platform alias、显示名、协议、能力、context/output 限制、enabled、callable、availability、required Plan code 和可选升级提示。禁止字段包括 Provider ID/route/credential、upstream model、Pricing/成本规则、Gateway Key/prefix 和任何 Secret。

资格检查仍在每次 Gateway inference 实时执行：

- canonical user 与 platform projection；
- Subscription 状态；
- published Plan Version；
- enabled Entitlement 与 `messages:create`；
- Model Permission；
- RPM、daily/monthly Token limit；
- 当前周期 Token Allowance；
- Provider credential、Pricing 和模型 readiness。

HTTP 语义：目录正常无订阅为 `200 + availability metadata`；Allowance 不足为 402；模型权限/可见但不可调用的保存为 403；保存 alias 已停用/不存在为 409；速率限制为 429；上游/合同异常为 502；Admin 或服务身份不可用为 503。

Claude Agent alias 顺序为：用户保存且仍 callable 的 alias → Admin 当前 Free default alias → 结构化业务错误。不再以环境中的 Claude/OpenAI 型号静态兜底，也不绕过 Gateway 资格校验。

## PostgreSQL 最终结果

- canonical users：30；Dream platform projections：30；对应 Billing Accounts：30；无有效 Subscription：0。
- 历史 backfill：27；本任务命名测试新用户 trigger：1；最终受管 active Free v2：28。其余 2 个用户保留原有有效付费资格。
- `free`：正式 identity；v1 published/10,000 Token 保留为历史；v2 published/100,000 Token 为当前版本。两版都以动态审计得到的 `deepseek-v4-flash` 为唯一 default Entitlement，scope 为 `messages:create`、`models:list`。
- `dream`：正式 identity + draft v1，正式 eyebrow/note/details 已入库，商业值不可用。
- `is-dreaming`：正式 identity + draft v1，正式 eyebrow/note/details 已入库，商业值不可用。
- v1 managed Free Subscription：28 cancelled，28 条旧 Allowance 保留，未写 Usage/Ledger。
- v2 managed Free Subscription：28 active，28 条当前 Allowance；总 granted 2,800,000，最终 consumed 30,709，reserved 0。
- 默认 Plan seed 再次 apply 与 dry-run 均为 `backfilledSubscriptions=0`、`transitionedFreeSubscriptions=0`。
- 受保护的既有 Subscription/Allowance/Event 指纹在首次 backfill 后保持原值；Usage、金额 Ledger、Audit、orphan 财务历史未重写或删除。

初始 10,000 Token 在真实 Claude Agent 的 71,971 Token reserve 前正确返回 402，说明该默认值无法满足一次实际调用。修复没有放松资格，而是发布不可变 v2 100,000 并只前向 transition `sub_free_*` 受管 active Free；v1 及其 Allowance/Event 全保留。

## 实现清单

### Admin

- Schema/Migration：`app/lib/db/schema.ts`、`drizzle/0025_fancy_shadowcat.sql`、Drizzle snapshot/journal。新增 Plan display 字段、default Entitlement 唯一约束、Free provisioning function 和新 user trigger。
- Seed/Provision：`scripts/seed-default-dream-plans.mjs`、`scripts/provision-local-dream-product.mjs`、`scripts/provision-local-dream-gateway.mjs`、`scripts/setup-env.mjs`、`package.json`。
- Gateway Catalog：`app/lib/gateway/models.ts` 及测试。
- Product/Subscription：`app/lib/product/{repository,service,types}.ts`、`app/lib/subscriptions/{contracts,repository,service}.ts` 及测试。
- Admin UI：`app/components/admin/AIModelRegistry.tsx`、`SubscriptionResourceViews.tsx`、`app/lib/admin/resources.ts`。Registry 仍由 Admin Session 和 `models.read/write` RBAC 保护。
- 文档：根因证据、设计 06、Subscription/Model/Gateway PRD、Dream 集成架构、设计索引与工作日志。

### Dream

- FastAPI/Service：`backend/services/admin_gateway/models.py`、`backend/services/admin_product/models.py`、`backend/routers/{gateway_models,system_config,claude_agent}.py`。
- 验证脚本：`backend/script/verify_gateway_e2e.py`。
- 前端合同/UI：`frontend/src/api/{gatewayModelsApi,productApi}.ts`、`ModelConfigSection.tsx`、`Sidebar.tsx`、`StoryWorkspaceSubscriptionPage.tsx/.css`。
- 测试：五个 backend Gateway/System Config/Claude Agent test modules、frontend API/source tests、mocked regression specs 与 `frontend/e2e/model-settings-gateway-real.spec.ts`。

## API、真实 E2E 与持久化证据

命名本机测试用户使用禁用登录密码，只通过本机测试 token；没有使用真实用户 token。

| 路径/行为 | 结果 |
| --- | --- |
| Admin public catalog | HTTP 200，2 models |
| Dream `/api/gateway/models` | HTTP 200；`deepseek-v4-flash=included/callable`，`hy-preview=maintenance/not callable` |
| Settings 保存 Free alias | HTTP 200 |
| Product plans/context/usage | HTTP 200/200/200 |
| Claude Agent SSE | HTTP 200；终态 `finish`；成功 receipt 无 error frame |
| Dream bearer → Admin Registry API | HTTP 401 |
| 成功调用持久化 | Gateway Request +1、settled +1、Token Ledger +3（reserve/capture/release） |

阶段总计数：Gateway Request `172 → 175`，Token Ledger `6 → 9`。除成功调用外，两条新增 Request 是 Free v1 额度校准和成功后重复完整 reserve 的结构化 402，均未新增 Ledger。

真实 Playwright 在 1440×1000 和 390×844 共 5/5 通过：全量 enabled 模型可见、Free 模型 callable、maintenance 模型保留且锁定、Settings 保存、三套餐来自 API、真实 Allowance/周期、无 API 5xx/console.error/pageerror/横向溢出、键盘 focus，以及普通用户不能访问 Admin Registry。目标 API 和 inference 未 mock；测试只为 Settings 组件提供 Vite 宿主页。

截图：

- Dream `frontend/test-results/round55-real/e2e-model-settings-gateway-be4fc-isible-in-Settings-desktop-/settings-desktop-1440x1000.png`
- Dream `frontend/test-results/round55-real/e2e-model-settings-gateway-9836a-visible-in-Settings-mobile-/settings-mobile-390x844.png`
- Dream `frontend/test-results/round55-real/e2e-model-settings-gateway-3cf9f-nder-without-mocks-desktop-/subscription-desktop-1440x1000.png`
- Dream `frontend/test-results/round55-real/e2e-model-settings-gateway-957a0-ender-without-mocks-mobile-/subscription-mobile-390x844.png`

## Reader Testing 与视觉 QA

Reader Testing 的第一轮发现并修复：Free 修复不能误写 503；maintenance 不能伪装 upgrade；stale alias 不能静默换模型；disabled radio 与套餐动作必须分离；移动端三 Plan 不得按当前套餐重排；Admin enabled 不等于已定价或可调用。第二轮七类读者复核通过。

真实截图复核确认：Settings 桌面两列/移动单列，当前 Free/default 和 maintenance 锁定状态清晰；订阅页延续 Dream 的安静叙事层级，桌面内容有留白、移动内容单列；两视口均无横向溢出。Product 页面首次真实 503 又暴露出 Allowance 时间精度问题，已改为按稳定唯一键回查并以 context/usage 200 复验。

## 测试与构建

- Admin：`env:check`、`tsc --noEmit`、lint、67 files/323 tests、production build 全通过。
- Dream backend：限定项目 tests 且关闭真实 Gateway 环境耦合后 1696 passed、14 skipped、652 subtests；最新 Gateway/Product/System Config/Claude resolver focused 42 tests通过。
- Dream frontend：lint 0 errors/21 既有 hook warnings；typecheck、production build通过；Gateway/Product API/hook 15 tests、Subscription source 6 tests、mocked subscription 4 tests、真实 Playwright 5/5 通过。build 只有既有 large-chunk 与 ineffective dynamic import 警告。
- 两仓 `git diff --check` 通过。

## 数据库、备份与 Secret 安全

- 正式写入前备份：`/Users/dmeck/project/ink-admin-memory/tmp/ink-memory-round55-pre-migration-20260809.dump`，mode 0600，34,100,694 bytes，734 archive entries。
- 正式库只执行增量 migration、幂等 insert/forward transition；未执行 DROP、TRUNCATE、bulk DELETE，未删除 orphan 财务历史。
- Product/Gateway service identity 只保存在 server-only private env；文件原子写入且 mode 0600。浏览器 DTO、receipt、日志和本文均未输出完整 DSN、JWT、Gateway Key、Provider Secret 或密钥前缀。
- AIModelRegistry 仍在 Admin RBAC 下；公共 Catalog 是独立安全 DTO，不授予普通用户 Admin 页面访问权。

## 未执行场景与解除阻断

未调用外部支付网络，也未验证 checkout/webhook/refund 或真实付费升级/降级。Dream 与 is-dreaming 必须在商业参数确定后由 Admin 创建新的 Plan Version，再发布 Pricing、Entitlement 和 upgrade policy；不能覆盖当前 draft/published 历史。

若要解除高级模型真实验收阻断，最小发布顺序为：

1. 为真实高级模型配置 active Provider credential 和 Pricing。
2. 以新的 paid Plan Version 配置并发布 `messages:create` Entitlement 和 Model Permission。
3. 运行 `plans:check` 与 catalog smoke，确认 Free 用户对该模型得到真实 `upgrade_required`。
4. 再执行真实升级/支付 E2E；未接支付前继续保持“暂不可开通”。

常规部署顺序：migration → model readiness → `plans:seed`/`plans:check` → server-only service identity → smoke/真实 E2E。回退只停止新流量并做前向修复，不删除 Subscription、Allowance、Usage、Ledger、Audit 或 Event 历史。
