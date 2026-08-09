# Ink Memory 模型目录与默认 Free Subscription 根因审计

> 审计日期：2026-08-09  
> 阶段：Round 51 / 阶段一（只读证据）  
> 数据边界：本机专用 PostgreSQL `ink-memory`；所有数据库探针均在 `BEGIN READ ONLY` / `ROLLBACK` 中完成。本文不记录完整 DSN、邮箱、JWT、Gateway Key、Provider Secret、密码散列或创作正文。

## 1. 结论

当前 `GATEWAY_MODEL_NOT_AVAILABLE` 的直接触发点在 Dream `backend/routers/claude_agent.py:84-125`：`_resolve_platform_model_alias` 从 Admin catalog 取得 `messages:create` alias 集合，发现用户保存 alias 和环境默认 alias 都不在该集合后返回 403。

该集合为空的真实主因不是 Admin 不可达、服务 Key 缺失、alias 已停用或数据库没有 enabled model，而是 Admin `app/lib/gateway/models.ts:16-85` 把 Subscription、published Plan Version、Entitlement、Allowance、user permission、Provider credential 和 Pricing 全部作为 `GET /v1/models` 的目录行过滤条件。正常“未订阅”因此被表达为空目录；Dream 又把空目录当成“无 Claude Agent 模型”。

当前本机数据进一步证明这是历史默认订阅缺口：29 个 canonical 用户均已有 platform projection 和 Billing Account，但只有 2 个用户有当前可调用订阅，27 个没有。当前只有 2 个用户可取得 1 个 catalog alias，另 27 个用户为 0 个。唯一保存过 model alias 的 canonical 用户保存的是仍 enabled、priced、entitled 的 `deepseek-v4-flash`，不属于 stale selection。

因此根因组合是：

1. **目录可见性与调用资格错误耦合**：所有资格条件被放进 catalog SQL 的 `JOIN/WHERE`。
2. **历史 canonical 用户没有默认 Free Subscription**：现有 `0015_platform_users_are_billable.sql` 只自动建立 platform projection 与 Billing Account，没有建立 Plan/Subscription/Allowance/Event。
3. **Dream DTO 只表示可用模型**：没有 `callable`、`availability`、`requiredPlanCode` 或升级提示，无法展示“可见但不可调用”。
4. **Claude Agent fallback 顺序不符合新合同**：保存 alias 失效后读取环境 `INK_GATEWAY_TEXT_MODEL_ALIAS`，而不是 Free Plan 明确配置的默认模型。

## 2. 当前数据库事实

| 检查项 | 只读结果 | 判断 |
|---|---:|---|
| canonical `users` | 29 | 用户真值存在 |
| `platform_users(source='ink-dream')` | 29 | projection 完整，不是第二套计费用户缺失 |
| 缺 Billing Account | 0 | Billing Account 自动投影已工作 |
| 有当前可调用 Subscription 的用户 | 2 | 只有少数命名/测试配置用户可调用 |
| 无当前可调用 Subscription 的用户 | 27 | 默认 Free Subscription 未实现/未 backfill |
| enabled models | 2 | catalog 不应为空 |
| 当前 catalog 可取得 1 个 alias 的用户 | 2 | 与有订阅用户一致 |
| 当前 catalog 为 0 个 alias 的用户 | 27 | Subscription 被错误用作目录可见性门槛 |
| active canonical-subject service key | 1 | `service_client_id=ink-dream-memory`，scope 含 `models:list/messages:create` |
| Admin/Dream/Vite listener | 3000 / 8765 / 5173 就绪 | 当前不是服务未启动导致的 503 |

### 2.1 enabled model 状态

| alias | protocol | Admin enabled | Provider/credential | active pricing | published entitlement | 当前正确展示 |
|---|---|---:|---:|---:|---:|---|
| `deepseek-v4-flash` | anthropic | 是 | 就绪 | 是 | 是 | 所有人可见；当前 2 个用户可调用，完成 Free backfill 后 Free 用户可调用 |
| `hy-preview` | openai | 是 | 就绪 | 否 | 否 | 所有人可见；`callable=false`，`availability=maintenance`，不得静态隐藏或伪造套餐 |

`hy-preview` 是“enabled 但未绑定 published Plan Version”的确定实例；它同时缺有效价格，因此不能进入 inference route。Admin enabled 与 Gateway 可见性当前不一致：Registry 显示两项 enabled，当前 Gateway catalog 对 27 个用户显示零项、对 2 个用户只显示 `deepseek-v4-flash`。

### 2.2 当前 Plan 状态

当前只有：

- `local-gateway-e2e`：命名明确为本机 E2E，published v1，零价格，5,000,000 Token；不得冒充正式 Free Plan。
- `tet` / `dd`：非目标稳定 code/name，存在两个 published 版本，当前零价格版本为 10,000 Token；应保留并审计，不直接重命名、覆盖或删除。

数据库不存在 `free`、`dream`、`is-dreaming`。现有两项不属于可靠同义套餐，因此目标三套餐应使用新稳定 code 幂等创建，同时保留现有历史。

## 3. 问题矩阵

| 问题 | 当前行为 | 根因 | 正确产品行为 | 修改位置 | 数据修复 | 风险 | 验证方式 |
|---|---|---|---|---|---|---|---|
| 未订阅用户 catalog 为空 | Admin 200 + `data=[]`，Dream 只显示空列表 | `app/lib/gateway/models.ts:26-70` 从 Subscription 起表并内联全部资格过滤 | 从 enabled model 起表；对每项附用户级 callability/availability | Admin gateway catalog service/DTO/tests；Dream strict client/BFF | 无需为“可见”造订阅；另做 Free backfill保证基础可调用 | DTO 泄露内部路由；资格判断与 inference 漂移 | 未订阅用户 `GET /api/gateway/models`=200，包含全部 enabled alias 且无 Secret |
| Claude Agent 返回 `GATEWAY_MODEL_NOT_AVAILABLE` | callable alias 集为空后统一 403 | Dream 把 catalog 行等同 callable 行；无 Free 默认 | 保存且 callable → Free Plan 默认 → 结构化 403/409 | `backend/routers/claude_agent.py:84-125` | Free subscription/entitlement/allowance | 暗中切换模型；跳过实时资格 | 保存 alias、停用/失权、Free 默认三条 focused tests + SSE |
| 保存不可调用模型 | 当前 catalog 已先隐藏，保存失败统一 403 | DTO 没有可见/可调状态 | visible+uncallable 不能保存，返回 403 或 stale 409并带升级信息 | `backend/routers/system_config.py:245-280` | 无 | UI 保存本地值与服务端不一致 | 403 upgrade、409 stale alias 合同测试 |
| Dream 模型 DTO 信息不足 | 仅 alias/name/protocol/capability/scopes/limits | Admin旧 `/v1/models` 仅返回可资格模型 | 安全 DTO增加 enabled/callable/availability/requiredPlanCode/upgradeHint | Admin `models.ts`；Dream `services/admin_gateway/models.py`；frontend Zod | 无 | 把 Provider Secret/upstream/pricing 带到浏览器 | strict DTO negative tests，禁止字段检查 |
| 27 个历史用户无 Free Subscription | 首次 Claude Agent 无 callable model | `0015` 只建 projection/account；无默认 Plan/Subscription | 对无任何有效订阅者幂等创建 Free；不覆盖 paid/history | 新 Drizzle migration + provisioning service/startup gate | 预计 backfill 27；最终以事务返回数为准 | partial unique、月周期、事件/Allowance provenance | backfill 2 次，第二次零增量；paid 行 fingerprint 不变 |
| 新用户无 Free Subscription | `database.create_user` 后只有 DB trigger 建 projection/account | trigger 未延伸默认 subscription | canonical user 插入后在同事务建立 Free Subscription/Allowance/Event | Admin-owned PostgreSQL trigger/function；Dream auth无需写计费表 | 新用户自动生成 1 套 | trigger 权限、安全 definer、Plan 未就绪 | 注册真实用户后 1:1 projection/account/subscription/allowance/event |
| enabled model 无套餐 | `hy-preview` 对所有用户消失 | catalog SQL要求 entitlement+pricing | 仍可见但 maintenance；发布前检查 Free 至少一个合格模型 | catalog status evaluator；seed/startup assertion | 不给 `hy-preview` 伪造价格/套餐 | 用户误以为可升级；Provider配置泄露 | enabled count=visible count；callable=false 原因准确 |
| 三目标套餐缺失 | Dream API只能看到现有 published非目标套餐 | 数据库未 seed；展示字段不足 | 稳定 code 幂等；Free published；Dream两项 draft时仍可展示“暂不可开通” | schema/migration/seed；Product API/DTO/UI | 新增三 Plan身份与版本/权益 | 重复计划；覆盖 published version；虚构商业参数 | migration/seed重复执行；plan code unique；published fingerprint不变 |
| Admin RBAC 边界 | Admin页面需 admin session；API重复校验 permission | 当前边界正确 | 公共目录仍只经 Dream BFF + Gateway service identity；不开放 Admin页面/API | 保持 workspace layout、`requireAdminRequest`、models permission | 无 | 误将 public catalog 暴露成 admin list | 普通 Dream token访问 `/admin/models/models` 不得成功；Admin API 401/403 |

## 4. 当前合同与目标合同

### 4.1 当前 Admin catalog

`app/lib/gateway/models.ts:16-85` 同时要求：

- 当前有效 Subscription；
- published、monthly、Token-only Plan Version；
- enabled Entitlement；
- enabled Model；
- active Provider 和完整加密 credential；
- 当期 Allowance；
- user model permission 未禁用；
- 当前 tier/default 的 active Pricing。

这组条件适合推理前资格判定，不适合目录可见性。

### 4.2 当前 inference eligibility

`app/lib/models/resolver.ts` 解析 canonical platform user、enabled model、active provider、credential、user permission 和有效 Pricing；`app/lib/subscriptions/gateway.ts:67-174` 再校验 Subscription 状态/周期、Entitlement scope、Allowance 与 Token 剩余量。该严格链应保留，并补足 catalog 与 inference 共用的 availability evaluator 或合同测试，避免两套判断漂移。

### 4.3 目标公共 DTO

浏览器安全投影只允许：

- `modelAlias`
- `displayName`
- `protocol`
- `capabilities`
- `contextWindow`
- `maxOutputTokens`
- `enabled`
- `callable`
- `availability`
- `requiredPlanCode`
- 可选安全 `upgradeHint`

禁止 Provider Secret、Gateway Key、upstream model、Provider code/base URL/内部路由、价格规则、密钥前缀。`gatewayScopes` 是资格内部事实，不再需要直接暴露给浏览器；如保留也只能是安全能力标签而非路由信息。

### 4.4 HTTP 语义

| 场景 | 目标状态 |
|---|---|
| 已认证、无订阅 | 200 + 全部 enabled models + `callable=false` metadata |
| Free模型且资格完整 | 200 + `callable=true`, `availability=included` |
| 更高套餐模型 | 200 + `callable=false`, `availability=upgrade_required`, `requiredPlanCode` |
| Subscription暂停/过期 | 200 catalog metadata；实际调用 403 |
| Model Permission禁用 | 200 catalog metadata；保存/调用 403 |
| Token allowance不足 | 200 catalog `allowance_exhausted`；实际调用 402 |
| 保存 alias 已停用/失权 | 409 + 重新选择/查看套餐动作 |
| Admin不可达或service identity错误 | 503 |
| Provider上游失败 | 502 |

## 5. 七项产品问题的明确回答

1. **为什么收到错误？** 该用户的 Admin catalog 没有任何 `messages:create` 行；`_resolve_platform_model_alias` 因而既不能接受保存 alias，也不能采用环境默认 alias，最终返回 `GATEWAY_MODEL_NOT_AVAILABLE`。
2. **属于哪类问题？** 当前现场是“缺有效 Subscription/默认 Free”导致目录为空，并由目录/资格错误耦合放大。不是 Admin listener、service key、issuer/audience问题；也没有证据表明保存 alias 已停用。数据库另有一个 enabled但无 pricing/entitlement的模型配置缺口。
3. **普通用户应该看到什么？** 所有已登录 canonical 用户应看到 Admin Registry 中全部 enabled alias：当前为 `deepseek-v4-flash` 和 `hy-preview`。
4. **每个都能调用吗？** 不能。当前 `deepseek-v4-flash` 仅对资格链完整用户可调用；完成默认 Free后它作为基础模型对 Free用户可调用。`hy-preview` 当前缺定价和 published entitlement，只能显示 maintenance/不可调用。
5. **如何不削弱 Admin RBAC？** Admin Registry页面继续由 admin session layout保护；Admin CRUD API继续 `requireAdminRequest(permission)`。Dream只用 server-only canonical-subject service key/JWT访问独立公共 catalog，浏览器只访问 Dream BFF。
6. **如何建立 Free Subscription？** 扩展 Admin-owned PostgreSQL provisioning：用户触发器在建立 projection/account后，仅当不存在 callable Subscription时创建 Free Subscription、当期 Allowance和 append-only activation Event；同一函数对历史用户做幂等 backfill。不得删除、覆盖或转换 paid/Allowance/Usage/Ledger/Event。
7. **三个套餐如何安全进入现有模型？** 先按稳定 code审计同义项；当前无可靠同义项，故新增 `free`、`dream`、`is-dreaming` Plan身份。显示文案落正式字段或严格 metadata。Free v1从现有合格模型集合动态选基础 model并发布；若无合格模型则 migration/startup gate失败。Dream与is Dreaming在无商业参数时只建正式 Plan + draft v1并由Product API显示“暂不可开通”，不伪造价格/支付。

## 6. 三套餐安全落点建议

本阶段不写数据。实现阶段应遵守：

- `subscription_plans.code` 现有 unique index可保证 Plan identity幂等。
- 新增正式展示字段（优先 `display_eyebrow text`、`display_note text`、`display_details jsonb` 并约束为 string array），避免前端常量。
- published Plan Version及其 Entitlement继续视作不可变快照；seed只补缺失，不更新已有 published行。
- Free v1必须 `monthly`、Token-only、zero price、`overage_policy=deny`、`allowance_tokens>0`，且至少一个 enabled、priced、支持 `messages:create` 的 model。
- Token数量不从 `local-gateway-e2e` 测试套餐迁移。若采用现有正式零价格配置的 10,000 Token，应集中为单一 seed常量并记录来源；更稳妥的实现是由 Admin seed配置/env明确提供，缺失时阻断 Free发布而不是猜值。
- Dream/is Dreaming在商业参数未确定时 draft；Product API必须返回 Plan identity和展示文案，但 `available=false`/“暂不可开通”，不能沿用当前仅 published plan的查询。
- backfill对象是“没有当前有效 Subscription”的 canonical用户，但必须先排除存在付费、pending、paused、past_due或未来周期等需要保留的非终态/商业状态；只有确实没有任何有效/保留资格的用户才创建 Free。

## 7. 阶段一验收状态

| 验收项 | 状态 | 证据 |
|---|---|---|
| 真实错误根因 | proven | 源码链 + 29/2/27只读矩阵 |
| 目录/资格耦合 | proven | Admin两处 catalog SQL均从 Subscription起表 |
| saved alias失效 | not the current cause | 唯一保存 alias仍 enabled/entitled |
| service配置/监听 | ready | 3000/8765/5173 listener、active canonical-subject key与双方配置 presence |
| Free历史缺口 | proven | 27个用户无当前 callable Subscription |
| 三目标Plan缺失 | proven | 当前只有 `local-gateway-e2e`、`tet` |
| enabled未绑定published | proven | `hy-preview` |
| 数据写入 | none | 只读 transaction + rollback |

阶段二可以开始，但必须先追加新的 Prompt Architect Round记录；在该记录完成前不得进入交互设计。
