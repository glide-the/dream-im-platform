# Ink Memory 完整目标完成度审计（Round 46）

> 审计时间：2026-08-09  
> 事实来源：当前 Admin/Dream 工作树、本地 `ink-memory` catalog、已执行测试回执  
> 状态词：`Proven`、`Incomplete`、`Contradicted`、`Missing`

## 1. 要求与证据矩阵

| 要求 | 状态 | 当前权威证据 | 剩余动作 |
|---|---|---|---|
| Dream 主库 43 表 + Notion 5 表全部进入单一 PostgreSQL | Proven（本地） | Dream manifest=43+5，Alembic `20260809_06`；真实本地 catalog=48 表/4,921 行；migration receipt conflicts=0 | 其他部署环境仍需各自 rehearsal/cutover |
| 48 表均有 DDL、依赖顺序、导入与验证 | Proven | `backend/schema/postgres_schema.sql`、manifest、六波 Alembic、只读 snapshot/import/validator CLI；48/569/81/25 真实 catalog receipt | 无本地实现缺口 |
| Admin 三表 importer 不能冒充全量迁移器 | Proven | 文档与 CLI 明确 baseline-adopt 仅为 `users/workspaces/stories` 3/48；Dream importer 才加载完整 manifest | 保持回归测试 |
| Dream runtime 无 SQLite/JSON/内存数据库回退 | Proven，含限定 | `database.get_db()` 只打开 `PostgresPool` 并校验 Alembic head；runtime 无 sqlite connection factory。SQLite 仅存在于 legacy manifest/import tooling 与显式 `allow_test_fixture=True` 的 deferred revocation test fixture | 后续新增 runtime repository 必须继续 fail closed |
| canonical `users` 是唯一用户全集，所有用户自动具备计费身份 | Proven（当前 Schema） | Admin `0015_platform_users_are_billable` 回填并用 trigger 自动创建一对一 `platform_users` 与零余额 `billing_accounts`；Admin user resource 从 canonical `users` LEFT JOIN 投影，不以内部映射过滤 | 生产历史 orphan 仍需隔离回执，不得删除财务历史 |
| 用户选择器服务端分页/搜索，不能只取前 100 | Proven by current Admin contracts/tests | canonical resource 使用服务端 filter/page/total；205 用户与 QA-only 回归已有测试回执 | 生产大数据冒烟仍是发布 gate |
| Dream/Admin 独立 Repository 与迁移日志 | Proven | Dream psycopg Repository/Alembic `dream_alembic_version`；Admin pg Repository/Drizzle `drizzle.__drizzle_migrations` | 无 |
| Dream/Admin 独立数据库角色与最小权限 | Proven in isolated clone / production rollout gated | `backend/script/bootstrap_postgres_roles.py` 在 `ink_memory_roles_r46_codex_test` 创建四个 NOLOGIN owner/runtime 角色，按 Dream 49（含 Alembic journal）与 Admin 38 表配置 owner、ACL、sequence/function/type/default privileges；`SET ROLE` 允许/拒绝矩阵和 canonical user 自动计费投影全部通过 | 真实库 owner/ACL 保持只读现状；生产切换仍需独立审批 |
| Token-only 月订阅、权益、Allowance、Usage、Token Ledger | Proven（本地 RC） | Admin `0017–0021`、Product API、Gateway Token reserve/capture/release、append-only Token Ledger；真实/隔离测试已通过 | 外部 Provider canary仍开放 |
| 订阅支付 Adapter/Intent/Webhook/Fake/refund/reversal | Proven for activation and renewal | Admin `0022–0024` 与 `app/lib/payments/**`；隔离 PG 已证明失败不激活、成功一次、重放幂等、refund 撤销，以及付费到期不免费发 Token、续费 Intent 复用和成功 Webhook 只续期一次 | 真实渠道 Deferred |
| 付费月订阅到期续费 | Proven | 付费版本到期由 worker 进入 `past_due` 且不发新 Allowance；renewal Intent 绑定 Subscription version/period end；已验证 Webhook 才执行 renew、推进周期并发放一次 Token，重复点击/事件幂等 | 生产支付渠道仍 Deferred |
| Dream 订阅页只渲染 Admin 真值 | Proven | Dream strict BFF DTO、无静态套餐数组；页面读取 plans/context/usage/models/payment Intent；Playwright 4/4 覆盖桌面、移动、首次付费和 `past_due` 续费等待 Webhook | 无本地实现缺口 |
| Claude Agent 新推理通过 Gateway | Proven when cutover flag enabled | `apply_gateway_sdk_env_to_options` 在所有 overlay 后强制覆盖 Claude SDK endpoint/auth，配置错误 fail closed；focused tests通过 | 生产 flag/service identity 与 canary仍是 gate |
| Dream/Chat/Workflow 其他真实推理入口全部通过 Gateway | Proven in code/contracts | `GatewayPolyAgent` 与 `GatewayInferenceClient` 统一 canonical-subject `chat:create` 请求；writing/chat/analyze/echo/traits/patterns 和图片描述/生成已移除 direct Provider endpoint/key/request，Gateway disabled/config/upstream failure均 fail closed；61 项聚焦测试通过 | 外部 Provider/user canary 仍是生产发布 gate |
| Gateway 资格链与结算闭环 | Proven for current Gateway paths | canonical user→subscription→entitlement/model→rate limit→Token allowance→request→usage→Token Ledger；synthetic 40 reserve/12 capture/28 release、replay409 | 为新增入口补 runtime receipt |
| Secret 不明文落库、回显或入日志 | Proven for new Product/Payment/Gateway contracts；legacy rotation gate remains | DTO allowlist、encrypted Provider credential、one-time Gateway key、Payment payload hash/summary、测试无 Secret response | 历史 credential owner 轮换仍需外部回执 |
| 真实支付渠道不连接 | Proven | registry 只有 guarded Fake；生产保护；没有 Stripe/支付宝/微信 SDK/网络调用 | 保持 Deferred |

## 2. 当前结论

Round 46 列出的三个代码/隔离验证缺口均已补齐：角色最小权限 clone、付费月续费、全部现存文本/图片推理入口 Gateway 收口。Reader/浏览器验证还发现并修复了 `past_due` 被错误降级为 `legacyUnavailable` 的跨项目合同矛盾；Admin Product API、Dream Python DTO、TypeScript DTO 与 UI 现在统一保留 `past_due` 和 `renew`。

本地事实为 Dream 48 表/4,921 行、Alembic `20260809_06`、Admin migrations=25、canonical 用户缺失计费投影=0、真实支付 intent/webhook=0。Admin 66 files/313 tests、tsc/lint/build通过；Dream backend 1,679 passed/14 skipped/652 subtests，推理聚焦 61 passed，前端 lint/build、Product API 9/9 和订阅 Playwright 4/4 通过。

仍未执行的是环境级发布动作，而非代码缺口：真实库 role/ACL 切换、外部 Provider/user canary、真实支付渠道与生产 Secret 注入。它们必须在目标环境独立审批；本轮没有把 clone PASS 冒充生产权限已切换，也没有连接真实支付或 Provider 网络。
