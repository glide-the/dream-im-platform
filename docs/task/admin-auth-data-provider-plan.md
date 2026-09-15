<!-- [Input] Authorized Admin provider scope, original Dream sources and coordination stage evidence. -->
<!-- [Output] Before-code optimized prompts, ownership boundaries and actual validation receipts. -->
<!-- [Pos] Admin execution plan; candidate/source/static stages never close public or real-business acceptance. -->
<!-- [Sync] 2026-09-15: register configured default Deck plugin resolution as Registry104. -->
# Admin 统一认证与 Dream 数据访问执行计划

## Round 1 — 现状、边界与首版契约

Optimized Prompt:

你是 Admin 实现负责人。在干净的 `017f3acccc57991f0b3771c1c9bb9dd765255b07` 基线上，复用 `codex/admin-auth-data-provider`，仅修改本 Admin worktree；相邻 Dream 仓库只读。协调任务为 `01a0a039-5eff-7ac1-90bd-2198f14766e7`，Dream 消费任务为 `01a0a03e-02f7-7221-9118-8bf3f6a91cb3`。

先读取实际 AGENTS、README、folder contracts、Cursor rules、架构、schema、认证、领域入口和验证脚本，记录缺失维护文件。扫描 Dream Python/Next.js 全部生产数据库调用、事务、启动/健康/后台 provider；输出可复核文件级清单。比较同实例分库和同库 schema，以现有 users PK、跨域 FK 与原子事务为证据，定义真实角色权限和前向迁移边界。查 Better Auth Google、OAuth Provider、JWT 和 Device 官方资料，核验配对发布包及安装源码。

产出 `docs/architecture/admin-dream-auth-data-contract.md`、迁移清单与能力归属；逐项定义认证主体、浏览器拓扑、服务身份、用户权限、资源策略、领域原子操作、幂等/未知提交恢复/超时、schema 与 API capabilities。保持 Runtime、SSE/EventBus、admission/leases、共享 FS、0700/no-symlink 与精确 `.claude-tmp` 路径合同。禁止通用 SQL、任意表列 CRUD、外部 user_id、环境名旁路、新 Dream 控制通道或真实数据库迁移。将首轮身份/版本/清单和契约路径发给协调与 Dream 任务；契约未实现处明确标注状态，不宣称可用。

正常路径为 OAuth access token 验证→显式 canonical mapping→所有权过滤→领域事务→稳定 DTO；失败区分配置/capability 不可用、身份、权限、冲突、超时与未知提交。同 revision 同值只刷新 diagnostics，更高合法 revision 才应用，非法/回滚/后台异常保留 LKG 且不传播 turn。

验收为文件级扫描覆盖、契约与 schema/FK 一致、双方确认同一拓扑、Markdown 引用有效和 `git diff --check`。后续每个较大实施阶段另执行一次此模板并立即实施；确定性验证按 luna-test-stage 委派，迁移只由协调在具名隔离 PostgreSQL 执行。真实 Google/模型验收缺用户指定账户、实体与凭据时记录未执行，不用 fixture 冒充。

## 已有事实

- Admin package version `0.1.0`；Next `16.1.6`、React `19.0.0`、Drizzle `^0.45.1`、jose `5.10.0`；基线未安装 Better Auth。
- Admin `Agent.md`、`CLAUDE.md`、`docs/rules/README.md` 在基线缺失，实际操作依据 AGENTS 与现有 folder/Cursor contracts。
- `.cursor/rules/06-database.mdc` 指向旧兼容 facade；本次按 AGENTS 的 `packages/db/src/schema/**` 唯一来源执行。
- `.cursor/rules/00-overview.mdc` 的 Admin 唯一 UI 与统一认证/设备授权页冲突；需更新为 Admin 管理 UI 与认证 UI 的明确路径。
- `database-schema-authority.md` 中 Dream 继续拥有 PG repository/事务与本次目标冲突；保留历史原文并更新现行所有权。
- 本 worktree 无既有修改；分支切换需关联 Git metadata 写权限，已按用户指定分支执行。

## 阶段与完成条件

| 阶段 | 产出 | 完成条件 |
| --- | --- | --- |
| 1 | 清单、统一契约、拓扑决策 | 双方消费相同接口与版本 |
| 2 | schema/capability、认证服务与页面 | 官方源码合同、主体映射、设备与刷新正常/失败闭环 |
| 3 | 全部 Dream 领域数据服务 | 无通用 SQL/CRUD，原事务原子、权限与恢复覆盖 |
| 4 | 交互/架构/发布与回滚文档 | 六张 Mermaid 与实现一致，索引/header/folder 同步 |
| 5 | 验证与提交回执 | typecheck/lint/unit/integration/focused browser/build；仅提交自己修改 |

Goal 保持 active，只有所有必需实现、文档与验证完成才 complete。

## Round 5 — Editor 会话领域与三种独立委托

Optimized Prompt:

你是 Admin 数据和授权实现负责人。先读取 Dream 实际 EditorEngine、Editor stdio 的加载/保存和 Session router/database 事务；保留原最后写入生效、显式所有权、缺失返回 null 与存储损坏/不可用错误的区别，不发明 CAS 产品规则。将完整 EditorState 投影为严格封闭 DTO，Widget data 仅为该业务状态内的 JSON，不提供任意数据库 JSON/表列入口。实现 editor-state.load/replace、Session 的具名业务操作和同事务回执/审计；Decimal bigint 和 PostgreSQL 微秒时间不可丢失。旧 Session upsert 必须拒绝覆盖其他账户 ID。

统一 Admin 委托机制，但创建时要求 purpose 并按三个互斥权限集合校验：server-persistence 仅 dream:read/write，gateway-cli 仅 messages:create/count_tokens/models:list，editor-stdio 仅 editor:read/write。Editor grant 必须绑定真实 owned user_sessions.id，不能把 Claude Thread ID 当 Session ID；换 Session 由持有 OAuth 的 Dream 服务重新授权并申请新 grant，renew 不扩张实体/权限。每次解析继续核验用户、Thread/Run/Editor Session 所有权、Gateway key 和到期/撤销状态，终态 Run 仍可完成结果持久化。只生成下一条前向 Drizzle 和独立 capability，不改已冻结 0054–0056。先冻结实际 schema/DTO/hash并交 Dream；协调执行同一具名隔离 PG 迁移/ACL和公开 Route 合同，Luna 负责确定性 type/lint/unit，主任务修复。文件头、folder、架构和验证状态同步，不广告尚未实现 operation，不宣称全领域完成。

## Round 6 — 权威 Workflow Thread 上下文与确认持久化保护

Optimized Prompt:

你是 Admin Workflow 数据负责人。先逐行读取实际 `dream_thread_binding.py` 的完整线性retry graph、frozen source fields、source-message provenance、当前binding/workspace owner、launch fingerprint/input hash/原fallback slug、parent/leaf status规则，以及 `dream_confirmation_service.py` 的reserved message namespace、derived ID/command hash、claim lease和原持久化保护。不能以三列Run查找代替完整mapper。实现只接thread_id与服务验证OAuth主体的严格workflow-context.resolve；普通线程/完全终态retry链仅在所有facts校验后返回null，损坏/分叉/越权409/404且不泄露内部图。容量从明确server policy取得，保留既有256默认语义但不包装成产品上限；查询使用原index与所需exact capability。

创建delegation时比对该权威context的Run，外部可见请求不能选择Run权限；已创建grant在Run终态仍可完成final persist，resolve只重新验证原所有权与到期/撤销，不获得新的activation权力。确认用户消息必须在同一Admin事务内锁定现存消息、检查canonical envelope/claim/run/workspace并保留更高有效DBlease；普通Chat只有明确非control才持久化/自动title，不能generic persist覆盖reserved控制记录。原source/command哈希使用共享固定pure Python canonicalBusinessJson并传raw存储JSONtext，不经JS数字重编码。TS只做DTO/领域规则/ORM/UOW，Runtime/共享FS/确认dispatch及EventBus暂留Dream按后续具名API关闭；不用第二状态机或测试旁路。协调持有Chat文件，guard接入需发具体helper签名后由该owner集成；Luna覆盖成功/失败/retry/provenance/lease/terminal与受限隔离公开Route，主任务修复并同步folder/header/artifact/验证状态。全Workflow其余preflight/activation/state/result/retry/Story/Plugin仍继续逐callable关闭，不以本轮context/guard声称全域完成。

## Round 7 — Deck 版本 canonical 字节的持久化兼容

Optimized Prompt:

你是唯一 Admin Drizzle owner。依据协调全19公开受限领域合同发现的JSONB负零normalization事实，保留既有deck_versions.snapshot_json/PK/content_hash/历史SQL，新增nullable snapshot_canonical_json:text和投影一致CHECK；只新增前向history，禁止猜测旧NULL记录的numeric类别、改预期或旧hash/backfill。先在明确临时生成目录以真实Drizzle schema/dist和前一snapshot生成下一条候选，完整DDL/精确单表capability descriptor与receipt INSERT编写完成后一次导入root SQL/snapshot再append journal；既有已入journal字节永久不改。该scratch候选不是第二schema authority，正式唯一history仍drizzle/**。新writes必须同时保存原Python canonical text与JSONB，读取优先text、旧NULL保留原jsonb::text兼容行为，DTO snapshot_json string与APIhash不变；新增physicalcap exactgate由协调ownedDeckRepo/Service消费。主任务只做唯一schema/迁移/descriptor/文档，协调只改owned领域Repo并在既有具名可删除隔离PG执行normal runner升级/重复/并发/空库/drift rollback/catalog/text负零投影检查，Luna做deterministic/source/public非破坏合同。真实业务库不迁移，错误回执保留，未通过不称ready。同步header/folders/matrix/artifact并继续全领域目标。

## Round 8 — Workflow Run、Preflight 与启动状态领域

Optimized Prompt:

你是 Admin Workflow 领域负责人。先逐行核查实际 run_service/preflight_service、WorkflowRun/Transition lifecycle validators、原 create/retry/transition/token consumption/receipt/session/readiness、Deck activation与Story启动组合事务；所有server actor/workspace来源改为已验证主体和owned业务实体，不接受request actor或可执行SQL。先复用完整context/provenance/strictPython codec，覆盖Run read/history与全部原lifecycle字段/NULL/microseconds/owner，再迁入状态与preflight原子commands；尚未实现write不可广告。原allowed transitions/CAS/failed details/joint session+receipt/start/terminal timestamps/source tuple/frozen retry/idempotency均须保留，不以任意状态patch或表CRUD替代。Token签发/消费权在Admin，Runtime/FS/materialization执行仍Dream消费具名元数据API，不能维持Dream持有DB/签名密钥。保留旧exit默认rollback与跨领域事务，不新增环境名旁路、硬coded业务ID或真实数据clone。

当前Round6 restricted公开context/guard等待协调freshworkflow60 fixture，Round7 Deck19/246与0059真实隔离已通过，仅为technical证据。新Phase按原callable与事务逐项定义closed DTO/name/version/hash/exactphysicalcaps，成功/权限/非法状态/原ID replay/unknown commit/并发与microsecond至少覆盖；Luna跑deterministic与primary准备的非破坏public合同，主任务修复，协调负责migration/fault具名隔离与后续正常业务验收。每轮完成同步header/folders/机器artifact/map/matrix并向Dream发真实可消费合同；不把read-only首批或context当完整Workflow完成，所有领域与真实验收未关闭goal保持active。

## Round 9 — Preflight 所有权、原 token 字节与读取兼容

Optimized Prompt:

你是 Admin Workflow 实现负责人。先读取实际 WorkflowPreflight lifecycle、read/token expiry/consume、PreflightServiceBuilder 八项依赖与真实连接上下文提交规则，不笼统把所有with-db算defaultrollback。复用已验证完整Run lifecycle/µs helpers，将原pft签发/验证与workflow-run-token HMAC digest收回Admin；只从明确Admin INK_WORKFLOW_TOKEN_SECRET取得原32byte配置，不接受JWT_SECRET或Dream密钥fallback。Token原固定六字段、UTC六位microseconds、Python canonical JSON与HMAC/base64url字节必须保持，NULL token与已passed但expired/consumed的原只读状态不能被错误改写。先实现closed preflight.read、当前Deck owner/原created_by与OAuth服务绑定、严格原Preflight字段/错误和微秒时间；entity persistence bearer不能获取新Run创建token。只广告实际named代码，未迁入execute/create/retry不可称全preflight完成。

后续八步execute与snapshot/materialization/compatibility/capability读写在Admin依真实业务metadata规则实施；Runtime/FS仍Dream执行，不建立Admin→Dream控制通道，也不接受request-authorized状态/actor/任意manifest或readiness patch。原不同事务边界逐callable保存，failure persisted/preflight无pseudoRun；samefingerprint串行reuse/token consumed/过期处理必须保留。Luna负责known-vector/lifecycle/owner/expiry/config等provider-free与type/lint，协调准备具名隔离public新Run5/Preflight事务/source oracle；正常Google/模型/全域关闭仍pending。同步headers/folders/artifacts/map/matrix并通知消费方真实接口与未完成范围。

## Round 10 — Runtime lock、兼容性与 Preflight 数据依赖

Optimized Prompt:

你是 Admin Workflow 和 Plugin 数据负责人。复用 coordinator 已完成的完整 Manifest DTO、纯 Python canonical codec 和统一0033 capability，逐行迁入 runtime_context、CompatibilityService 的固定八项检查与 Story PreflightBuilder 的真实 installation/release/lock/materialization 选择规则。不同安装选择规则必须按原 callable 保留：runtime context 优先任何状态的 workspace row、否则 instance 最新 created/id；compatibility 优先 ready workspace、否则 ready instance 最新 updated。批准能力 JSON 的两种原解析规则不可混用。RuntimeLock 原 strict Pydantic shape、SemVer/空 artifact/model defaults/Unicode strip/legacy datetime 接受规则须用实际 source oracle 核查；legacy production_ready 仅元数据，不得用环境名称控制业务。

所有事实来自 Admin owner-scoped ORM 和明确 server capability 配置，不接受 request readiness/actor/grants/manifest patch；固定八项 compatibility 失败顺序、safe error/recovery action、五重 capability intersection、完整 declared-vs-lock 集合与 materialized/loadable ANY 规则保持。Stage Snapshot/materialization 全部元数据查询在 Admin，Runtime/FS/CLI 留 Dream。原 Preflight checking/binding/snapshot/final 的已提交阶段、失败记录和新 token TTL 必须保留，任何新组合事务先明确边界；不得用单一回滚事务抹掉原可见 checking/failure。先实现和验证这些原业务依赖，实际广告只增加已通过验证的 named operation。新 readonly Preflight 接入等 coordinator public6 窗口结束；公开 Run5 harness 始终冻结，fixture/DDL/fault由 coordinator 主任务执行。Luna做确定性/source oracle/type/lint，主任务负责修复、folder/header/contract artifacts/map/matrix。全域、真实Google/模型验收与正式提交仍未完成，goal保持active。

## Round 11 — Preflight 分阶段执行、原请求绑定与秘密回执

Optimized Prompt:

Source correction addendum（before code）: 实际原Service._token_from_row先从raw PostgreSQL字段签名，后由Pydantic对output字符串归一。新source fixture证实opaque lock/snapshot字段外围空白时，按归一DTO签名改变原pft。保持公开DTO与所有70hash不变，token签名调用改为原stored六字段，仅expires按原UTCµs规范，不以展示DTO重新构造opaque绑定。针对read、reuse与final签名源路径最小新增source检查；协调public24fixture保持不变并短暂停启动，过后恢复冻结，不改Drizzle/业务ID规则或source预期。

Stage audit correction addendum（before code）: primary实际只读catalog证明既有admin_audit_logs_request_action_uidx由request_id/action/resource_type/resource_id唯一，当前四阶段仅metadata.stage不同而唯一键相同，binding audit触发23505使该阶段回滚。只修改ExecutionRepository.audit，以固定服务端expire/checking/binding/snapshot/snapshot_binding枚举进入operationRequestKeyDigest的operation域；原request_id关联及dream.workflow-preflight.stage action不变，不放宽索引或修改已应用DDL。新增真实Repository固定事务捕获测试，检查各stage不同键、同stage稳定键、operation主体隔离及非法stage写前拒绝。Luna执行最小gate；primary保留首failed完整历史/receipt，以新original request继续尚未执行的原公开case，不改原成功预期，不reset事实。70合同/0060字节保持。

Remaining-read harness addendum（before code）: primary实际读取已证明准备slot过期而public输出与原Service一致。复用同一个公开harness增加明确private validation_scope（complete为原默认，remaining_reads仅剩余read验收）；complete全部原case要求/执行/断言保持。remaining_reads必须只read，包含passed active非NULL PFT和passed expired NULL PFT两类完整独立source expected，actual SELECT确认两类consumed NULL且expiry对应当前数据库clock；每项仍严格full DTO/原Service full projection/raw hash/fingerprint/PFT/immutable snapshot与无状态写入。只不执行已通过execute-specific replay/receipt否定块，不重复执行流程；primary即时准备新owned合法read facts、独立source期待及短时JWT，并直接运行原harness。保留全部旧fixture/回执，不更改旧expiry、业务clock或断言，production70合同/0060继续冻结。

Remaining-read classification correction（before code）: 首只读scope已有新active/expired两事实通过，额外原consumed read因scope对所有passed行笼统要求unconsumed而失败。新增明确private read-case expiry_fact（active_unconsumed/expired_unconsumed/null原默认），remaining_reads必须各有且仅有一个明确必需marker，marker必须positive passed且prepared PFT与kind一致；只marker两事实检查actual consumed NULL和clock expiry关系。额外consumed、expired状态及权限read保持完整DTO/source/hash/fingerprint/snapshot/state断言，不删除、变更预期或强套必需类型。原complete behavior保持且不能使用marker，Luna仅新harness type/lint/diff最小gate，primary重新即时准备新marker事实串行完成尚未验收范围，旧失败/事实/expiry保持。

本轮协调primary独占Social9 DTO/Repository/Service/tests/public fixture，Admin本任务只复用shared严格serviceOAuth、typed UOW/receipt完成薄socialFriendshipHandler/Registry/Receipt/route与真实机器合同。原邀请码policy由primary明确配置；read不依赖generationpolicy、write/result/audit同UOW；不触primary Social实现或fixture。原成功/安全failure结果与decimals/NULL/time按实际DTO输出，idg不能获得邀请码/朋友/图片管理权限；首轮25det与type/lint通过后才接入，公开9由primary具名隔离验。原其余60operations及special4 hash保持，新增集合从真实Zod生成逐项对primary safehash核验。

你是 Admin 唯一 Preflight/Drizzle owner。依据原PreflightService checking→binding→snapshot→passed/failed各自提交事实，以及Phase10已验证的完整typed lock/eight-chain compatibility/三种原capability parser/immutable snapshot/latest materialization依赖，实现完整 named workflow-preflight.execute；输入仅owned workspace/Deck/revision和原raw input object JSON，actor从OAuth推导，签发仅Admin明确原Workflow secret。保留同fingerprint checking/passed-unconsumed reuse、过期passed先转expired、失败记录不产生Run/Session、snapshot失败前已提交阶段可查询。不把全部八步改成单一rollback事务，也不把checking orphan自动重试为新执行。

为防部分阶段已提交后相同request_id换input产生副作用，新增明确、append-only的Preflight request→原PF/owner/workspace/input-SHA绑定；只提供具名execute/原receipt，不提供CRUD/阶段patch或通用job框架。每个阶段在Admin独立transaction重复scope/owner与exact capabilities，stage audit同提交；最终status/原response/安全audit同事务。Checking reuse可以返回checking原结果，原request durable map保留未知提交证据；完成的原request恢复相同bounded response且不重新签发新的权限。最终pft不得明文落入generic receipt JSON，使用明确Admin AEAD key加密完整原secret response并绑定service/actor/operation/request/input digest/PF/workspace，恢复时严格核验，失效token可作为原结果返回但不获得新authority。

只新增下一条完整Drizzle SQL/snapshot/独立capability descriptor，已journal/applied0054–59与早期history字节永远不改。先生成scratch候选，以真实built canonical schema与前一snapshot，无真实DSN；DDL/immutable trigger/capability完整后一次导入root再append journal。协调primary负责具名隔离migration upgrade/repeat/concurrent/fresh/drift rollback/真实catalog与ACL SELECT+INSERT最小grant，Luna仅确定性/source/public非破坏合同。当前Preferences public2窗口冻结Registry60/共享入口/codec既有actions，不在窗口重建package/dist或迁移；execute在实际代码/DDL验证后才注册。输出原Preflight completeDTO，原token/fingerprint/raw numeric/Unicode/6µs/NULL与first-failure code均保持；全域、normal activation、真实Google/业务/模型、提交回执仍pending，goal保持active。

## Round 12 — Run 创建、一次性 token 消费与 frozen source 重试

Optimized Prompt:

你是 Admin Workflow owner。复用原WorkflowRunService._create_run/retry_run的确切事务与完整Run/Transition DTO、原token authority/raw lock canonical helper和typed ownership查询，不建立第二状态机或通用目标状态patch。Create输入仅owned workspace、原PF/token、业务idempotency key和可空完整Voice source tuple；source Thread/message/time须对应canonical owner真实Chat记录，任何actor、frozen release/profile/inputHash/target状态都从Admin存储推导。Retry仅原owned失败/rejected/cancelled Run与fresh PF/token/新key，读取原source后结束只读事务，再于clean write boundary重复原owner/状态/来源，不能替换source。保留完整带时区source tuple，Pydantic output归一和raw字段签名/semantic hash分开。Python key长度按Unicode codepoints，原255限制进入共享明确policy/JSONschema，运行时校正以实际source边界证据和旧hash完整对照为准。

单个创建事务保存Run preflight1、一次性token HMAC消费映射/PF consumed CAS、initial Transition1、queued2/Transition2；不创建Session或启动Runtime。先检查原token签名、context原creator/workspace/release-lock hash/当前workspace owner，再计算原semantic fingerprint（含raw canonical lock digest/frozen source/retry parent，故意无PFid/token）。Consumed原token只在原workspace/actor/key/fingerprint/Run全部相同recover；绕过expiry仅恢复旧结果，不获得新权限。Fresh PF在相同semantic/key只consume并映射旧Run，不重复Run/history。并发用稳定scope advisory lock/PF CAS串行并保留原唯一约束，不把SQL exception当成功。原request receipt/audit/business同事务，OAuth-only bounded replay重复当前owner，entity grants不能创建/重试或获取此原receipt。

先完成独立未注册closed DTO/Repository/Service/source oracle和保留/失败/并发/原ID/µs unit，同步headers/folders。PF70公开/阶段故障窗口继续冻结Registry/route/schema/package；协调结束后才生成真实新wire contract、对照所有旧descriptor并接入。复用published Drizzle0033/现Run表/唯一约束；只有证实缺physical结构才新增前向history，不改0060/旧SQL/journal。协调独占新具名fixtures/token/SQL faults，Luna负责确定性与SELECT-only公开；真实Google/模型/全22矩阵仍需正常本机生产入口。正式提交/发布/全域关闭未达成，goal保持active。

Thin ingress addendum（before code）: source/atomic/service25通过后，仅新增未接入Route/Registry的CreationHandler，复用严格服务OAuth与exact identity/unified0033 requirements，在初始鉴权及retry readonly/write每个UOW重验相同sub/canonical/client和dream:write，不接受entity persistence grant。closed envelope和operation名在领域边界验证，未知/actor/frozen/status/source replacement请求不能执行creation。新增定向ingress成功/live identity drift/capability/actorpatch失败验证；不重复已通过25或改PF合同。Shared output255修正与wire接入须等协调冻结窗结束。

Display-key preview addendum（before code）: 冻结窗内只在临时read-only候选clone中以原Display model的Unicode codepoint255规则替换UTF16 max255，保留Pydantic White_Space与model可接受control/BOM；不把request service的显式Python blank拒绝附加到stored display model。调用actual原WorkflowRun.model做独立model-key源对照，完整对比candidate与当前所有Run output JSONSchema及descriptor hash；只有全旧字节契约一致且协调结束后才修改shared output。新增sourceOracle action仅actual model调用，不改既有request-key/semantic/create路径，不连DB或重跑原25。

Registration addendum（before code）: primary已明确解除PF70冻结并实际回执补验74/11/96/44/54。实施preview已证明的stored display key码点255修正，保留原model strip/control/BOM接受语义及JSONschema maxLength255；完整旧70 contract/requirements/capability逐项deepEqual且独立PF receipt/special4 byte hashes不变后才注册create/retry2，生成真实72artifact/map。创建原receipt通过OAuth-only且exact identity/unified capabilities，GET不接受额外actor/workspace/Run selector；从原bounded result推导workspace/Run/Thread并重复current owner/source/frozen facts，失去owner或scope fail closed。复用创建路径已验证bounded-result helper，避免GET扩大token/creation权限；有界旧创建结果可在当前Run后续状态保持完整来源下恢复。增加源display8例、旧Run DTO生命周期、明确新receipt正常/absent/权限/binding/冻结事实失败与薄Route入口门禁，不重复无改动的原25+9或PF已通过范围。primary独占新public source/PF/token/故障事实；producer仅编写原public production入口的SELECT-only验收harness与recipe并交协调执行，不连接真实或隔离PG。正式全领域/Google/模型/提交仍pending。

Public harness addendum（before code）: 复用现Run source adapter的actual _create_run，追加仅显式clock sequence DI（原每次_now调用使用实际存储created/consumed/updated instants）与actual retry-frozen helper，不改变既有source actions/default clock。验收harness调用公开POST/GET，仅SELECT primary明确具名target及其prepared source/PF/retry facts；成功case独立prepared完整静态Run字段，未知server UUID/created time仅从actual DB取值，actual原_create_run构造的20INSERT/7consume/2transition参数与完整结果逐项核对。Fresh/semantic/consumed、完整source、Unicode key、retry和current-owner/receipt/replay/concurrency/失败no-effects必须具名覆盖；不能让fixture改生产clock或复制原创建状态机。JSON state snapshots取::text保持bigint/µs，所有DSN/keys/正文不输出，fixtures0600与每个credential catalog目标一致、verification只读；primary即时签短JWT后运行，producer只做static gate。

Least-privilege target proof correction（before code）: 复用已通过PF公开合同的target proof边界，data_directory仅由明确owner verification credential证明。App credentials均私下先验证相同loopback host/port/database DSN，再实际current_database/port/current_user与低权限role flags核对；不额外要求AUTH/DATA读取受保护实例设置或为harness扩大ACL。保留exact named target、owner directory和app role/db/port断言，不触生产或降低业务authorization。

Source child environment（before code）: 新public harness的reference子进程只继承PATH与显式INK_DREAM_SOURCE，不把primary wrapper的PG DSN、JWK、service credential或OAuth环境传给原源码。实际Run token secret与fixed事实仍只经private stdin传递，stderr/body不打印；这是新验证脚本的least-scope保护，不修改现source adapter/default actions或生产runtime。

Run72 remaining harness addendum（before code）: primary首次public执行在read-only错误码预期处失败，actual共享认证边界ACCESS_SCOPE_REQUIRED，fixture误填领域DREAM_SCOPE_REQUIRED。原六accepted完整source/效果断言已越过，不再次POST。只新harness private validation_scope（full原默认/remaining_denied_receipts）与独立accepted_originals完整bounded结果；remaining保留全部原case/静态expected/原ID/time/input并读取已提交receipt核完整prepared原结果/inputSHA/scopes，供原GET回执全结果对照。仅执行原剩余拒绝与GET，失败no-effects/全部权限/原receipt断言保持；报告实际executed/skipped/断言数。Full所有原required coverage、成功source/replay/concurrent与失败断言不变，禁止使用accepted_originals。Primary仅校正实际认证错误码和scope/完整原accepted事实，保留首失败/expiry/所有预期与状态，producer只做该harness静态gate，无PG/生产72变更。

## Round 15 — Source/claim/finish 注册及当前事实原回执

Public75 harness addendum（before code）: 新独立 `adminDreamLaunch.contract.ts` 只调用实际生产 POST/GET；primary 准备严格0600私有fixture和明确可删除同一具名target，producer不接PG。验证credential逐一证明loopback数据库/端口/实际role，只有owner verifier读取data_directory；AUTH/DATA均低权限且不扩大ACL。每个source/claim/finish成功和失败均保留原完整结果、精确源metadata/parts/Context10、current scope、所有非目标rows与Run/PF/token/session等protected snapshots。source身份取actual application-source捕获，完整ensure参数取actual ensure_source；claim完整Runtime metadata/parts及COMMIT-before-turn取actual dispatcher，finish只取actual _finish_claim固定pending/dispatched参数与独立COMMIT。原source子进程仅PATH与只读source root，不继承credential。Finish私有fixture可从先前成功claim结果取服务签发ID，不允许生产request提供context/metadata补丁。GET按case后的具名checkpoint验证活动claim恢复、finish后stale拒绝及source原bounded结果。全prepare/failure/Runtime/正常业务不在此组件harness内；static gate通过并交付具体fixture recipe后才申请primary准备新隔离数据，不宣称75 public acceptance。

Public75 first-write concurrency correction（before code）: primary在未执行fixture review发现concurrent分支先等待首POST提交再发两replay，只覆盖并发回执读取。primary明确给harness-only冻结例外：concurrent case首次三个同original request/input POST共同启动，首个完成之前不await单独POST；仍逐响应full bounded equality、独立expected/actual source及protected17单次业务/receipt/audit断言。正常及显式replay路径不改，production75/DTO/registry/schema/codec继续冻结；只static type/lint/diff补验后重新冻结harness，保留先前unexecuted static gate，不重复或重置任何业务case。

Public75 explicit continuation addendum（before code）: primary首public退出1，唯一已提交source-new-null完整源/效果门禁越过，第四原GET身份/权限检查后actor_id查询由共享身份边界先400 USER_OVERRIDE_FORBIDDEN。禁止改生产边界或重POST已accepted source。只给harness/recipe冻结例外：原actor_id请求保留400并新增无主体覆盖含义的unknown selector404；新私有validation_scope full默认/remaining_after_source_new_null，唯一accepted_original严格namedsource-new-null/full bounded source/postaccepted protected17 SHA。Full禁止accepted_original，remaining只允许这一个原case并验证canonical/inputSHA/nullscope/original完整result、actual application/ensure源/精确µs/ownedsource/Thread/receipt/audit和当前17表hash，全程只读；其他37case及全部GET原模块/成功/失败/并发/回执断言保持。Primary保留完整原fixture/expiry/history，只新continuation fixture/freshOAuth，不重置任何business；producer新增纯harness scope guards正常/多跳/错误case/full绕过/缺proof失败gate及static type/lint/diff后重新冻结75与harness。Run/session/metadata真实原写入保留，不虚构单次38PASS。

Actual application fingerprint correction（before code）: Readonly真实launch调用点只在agent非NULL时给fingerprint payload增加agent_id；先前sourceOracle identity直接给实际_sha256传了手造含NULL对象，覆盖helper而非真实application调用。注册75暂停，只改未注册source identity省略NULL key，并增加actual DreamLaunchApplicationService.launch DI capture-source action，在真实prepare之后source回调捕获真实fingerprint/IDs/arguments后抛固定测试sentinel，后续PF/Run/Runtime均不执行。新gate先在旧bytes下证明noAgent真实callsite不等，保留该source错预期证据，修正后只rerun新增实际application向量和受影响noAgent GET/source facts。既有nonnullAgent全source/dispatch32证据不改，旧72/DDL/registeredcodec无变。不能把以前helper-only identity claim当全部application parity。

Optimized Prompt:

primary明确解除Run72验收冻结，并授权继续独立source/claim/finish注册。先保存完整72artifact/PFreceipt/delegation bytes为0600只读snapshot。复用已通过source23+ingress5、dispatch32的domain authority，提取dispatch current workspace/binding/Run/source/context/lease helper与bounded claim verifier，使POST及GET用同一事实校验。Source GET从原bounded source推导message，按存储metadata推导当前workspace/Deck/goal/agent/key，重复enabled owned scope、original inputSHA、deterministic source/fingerprint/time及receipt Thread/null Run绑定；不接受request selectors。Dispatch GET从原result Run与current owner推导workspace，重复完整frozen/source事实；旧claimed=true只有matching active stored lease/parts/context/Runtime metadata可恢复，finish历史结果只恢复bounded完成事实，不发布Runtime权限。

所有GET只original request/name与OAuth write/exactidentity/unified，没有entitygrant或token/actor/meta selectors。先新GET完整正常/absent/scopes/currentowner/receiptbinding/expiredclaim/actualsource失败测试及提取helper最小actual full source等价gate，通过后薄Route/Receipt/Registry接入3项、真实生成75artifact，旧72 FULL descriptor/requirement/capability逐项deepEqual且PFreceipt/delegation bytes不变。主任务只生产owner实现/静态/source验证，primary独占新public具名fixtures/fault/clock/DB。只广告实际75component API，不把source.ensure/claim/finish当完整prepare/failure/启动；正常Google/model/全领域/提交仍pending。

Continuation guard correction addendum（before code）: 首门禁保留 Vitest 未收录 tests/integration 的 EXIT1 与 strict=false 下 Zod status 推导可选的 tsc EXIT2。只将新6个纯守卫测试移动到既有 app/**/*.test.ts 范围，helper 接受推导的可选 status，运行时仍严格断言200。Full-scope checkpoint 拒绝前移到读取私有文件前；全局配置、生产75、原公开断言与固定 checkpoint 不变。修正后仅重新执行6守卫、whole typecheck、owned lint/diff，并审核真实回执后重新冻结。

Continuation typing supplement（before code）: 修正门禁实际6/6守卫通过，whole tsc另报 z.json input 推导可选/required EXIT2，lint/diff0。只将 helper 的 input 类型声明改可选，运行时仍以原严格 Source DTO safeParse 拒绝缺失；不重复已通过6测试，只补 fresh whole typecheck/owned lint/diff。

## Round 18 — 默认 Workspace 服务薄入口与注册76

Optimized Prompt:

Root已释放75窗口，producer逐字审核continuation37/21GET/974、11fault+3实际finalCOMMIT-loss/308、22自有fault对象cleanup与SELECT-only preservation19。只新增默认Workspace薄Handler、原GET领域与新定向入口/恢复测试；Root既有Workspace DTO/Repository/Service/policy/source adapter归Root，不修改。POST empty strict input、configured service、OAuth dream:write、identity+unified exactcaps，在同UOW调用Root helper（actor初始化锁在receipt锁前），拒idg；GET only name/request、same liveOAuthwrite/exactcaps、原inputSHA(empty)/所有nullscope/currentowner，返回原text ID，absent不查业务。同步producer Route/ReceiptHandler/Registry与真实Zod生成76 artifact；先O_EXCL0600保存完整旧75/PFreceipt/delegation快照，旧75全部FULL descriptor deepEqual、PFreceipt与delegation字节恒等，machine map只implemented list75→76。不得添加DDL/default policy新规则或把Root21候选unit当公开验收。Luna只新增入口/原GET/domain定向测试、whole type/owned lint/diff；通过后给Root严格public recipe，由Root准备新隔离fixture/concurrency/rollback/originalowner/commitloss与cleanup。Failure候选继续未注册，注册76及新harness交付后冻结，完整Google/正常业务/模型/all-domain/commit仍未完成。

Workspace76 public harness addendum（before code）: 新strict0600 fixture保留fresh/existing/denied/原GET全部独立expectations，actor/token映射由primary认证proof准备，producer verifier固定SELECT17表。Fresh首case在当前actor零Workspace事实下共同启动三个same-original POST及至少一个different-original同actor POST，全部同ID、Workspace delta1、distinct receipt/audit各1；不能先创建后并发replay。Existing按PG created_at ASC/id ASC独立查oldest，包括legacytext/archived，原row全部不变。Full fresh row/name/owner/settings/status/精确timestamp interval以及整个source helper参数/result/commit对比，sourcechild只PATH+readonlyroot/private stdin、不继承凭据。回执只原operation/request，currentowner/nullscopes/emptydigest/read_only/idg/ordinaryunknown/actoroverride边界/absent，所有GET前后17表不变。不同body在strict empty DTO边界400，不把无效input包装成有效digest冲突；有效empty原digest冲突由primary预置独立负例验证409。Actual insert/receipt/audit faults/COMMITloss由Root主任务另外脚本，producer不seed/DDL。Static gate与recipe交付后refreeze76/publicharness/sourceadapter，Root才签technicalOAuth与具名新fixture，真实业务与全域仍未完成。

## Round 19 — 未注册失败元数据薄入口（注册76冻结期）

Optimized Prompt:

当前76注册/publicharness/Root Workspace候选/codec-map/schema全部冻结；只新增未注册failure Handler及其新定向测试。复用现有configured service/internal envelope parser/requireDataActor/exact data UOW。Operation只dream-launch-failure.envelope、严格Run/workspace/error DTO；OAuth或原server-persistence grant live dream:write，delegated时附immutable runtime delegation/purpose caps并resolve原requested Run，domain继续要求原Thread+Run/source当前owner/µs和已failed status，不赋activation。Mandatory纯overlay为server-only collaborator，没有默认map/fallback/路径或request selector；接线必须等Root释放76，由producer下一阶段添加固定codec名/Trace/Registry/原GET，不能现在广告可用。验证新入口正常OAuth/terminal bound grant/extra selector/错误permission/capability/name及exact arguments，source/domain35不重复，whole type/owned lint/diff及affectedfolder/header同步；主任务修复和review实际回执，Root真实公开fault/fixtures仍主任务owner。

## Round 22 — 已释放76后的独立 failure envelope 注册

Optimized Prompt:

Root明确释放76隔离窗口，producer已读actual public347/atomic90/cleanup6/preservation159与首setup exit1/continuation16setup17exact；旧76全部FULL descriptors/PFreceipt/delegation raw保存O_EXCL0600快照。只注册已通过Source7/POST17+originalGET18/Handler7的dream-launch-failure.envelope为77：Route薄委派默认server固定pure codec，固定codec map仅新增具体failure脚本名，禁止外部path/action；同一失败metadata独立UOW不重演先前Run.fail COMMIT。Next output tracing显式包括该pure stdlib脚本，并补已有dispatch launchEnvelope同生产包装依赖，既有deckContentCanonical保留。POST live OAuth或原Run/Thread persistence grant，capability动态purpose要求与现owned failedRun/source/µs/receipt/audit不变；original GET仍only operation/request及OAuthwrite、原output error重建不可变inputSHA/currentowner/fullsource/nullEditor/RunThreadscope，历史completion不授权Runtime。新public ingress/GET tests只验证新route/default实际fixed codec及strictquery/livepermission/caps委派，不重复旧Source7/domain35/Handler7/已通过Reflections26。实际generator完整deepEqual旧76及PFreceipt/delegation bytes，机器映射只implemented_operations增77，新hash来自真实closedDTO；无DDL/normaldata/provider/Runtime/FS执行。Privatefixture recipe/public SELECT-only verifier完成后primary独占新隔离fixtures/故障/actualCOMMITloss与清理，不用mock UOW或sourcecapture声明公开/真实模型通过。所有受影响headers/folders/matrix/契约更新和Markdown路径inventory，Root SystemConfig及Reflections3仍未注册/独立不改。

Failure77 public harness addendum（before code）: 新独立 `adminDreamLaunchFailure.contract.ts` 严格0600primary具名fixture/同target/actual低权限role/catalog，固定17表SELECT-only verifier，不开放任何skip/reset/SQL/actor选择器。只实际生产metadata POST与OAuth original GET，成功input/完整output由primary独立事实准备；每成功原Run已FAILED且全部Run/history/PF/source parts/time/Thread ordering保持，metadata完整字节取实际wholeFailureRecorder alreadyFAILED分支（当前SQL full Run/source fixedrows，read rollback/独立metadata COMMIT），不把此组件声称为本轮新FAILED transition或完整failure应用验收。NULL/nonNULL Agent、rawnumeric/invalidobject/缺message no-op、同original首次三个共同启动、replay恢复不重复receipt/audit、later metadata lease recovery不覆盖、strictselector/ownercorrupt/grantpermission/read-only/none拒绝与全17no-effects。匹配原Run persistence bearer可POST；GET仍OAuthonly，原boundedcompletion不授予Runtime。Primary独占metadata UPDATE/receipt INSERT/audit INSERT故障和真实finalCOMMITloss，检查已有Run FAILED及priorCOMMIT保留/owncleanup。Source secret显式仅harness oracle constructor DI、不发行token，子进程只PATH/read-only-source根与private stdin，不传PG/Auth配置或打印stderr。静态gate和具体recipe交付后primary准备新隔离技术fixture，不重跑75/76或正常账户。

Historical completion GET（before code）: later-lease不由SELECT-only verifier写入或使用新metadata patch模拟。Primary可独立seed一个明确older original receipt/audit与当前owned failedRun/source laterlease，receipt fixture始终给完整独立expected_result，并标明historical_later_lease且无executed source_label。Verifier核原stored full result/schema/scopes及由currentowned workspace/原error重建inputSHA，当前source tuple/owner/µs/lease存在，实际GET与全17 before-after字节相等。通常executed原GET必须source_label对应实际POST/expected完整一致；此历史GET是预先存在事实的只读验收，不跳过任何本轮POST、不恢复DB或授予Runtime authority。

Round22 static readiness receipt: producer已读actual `failure77-public-harness-document-first-gate.md`；cachedpnpm whole `tsc --noEmit --incremental false`、owned public verifier ESLint、Markdown inventory、`git diff --check`各exit0，221 Markdown/MDX、356 decoded filesystem links、247 historical routes、0 missing。新registration11与Nextconfig4先前PASS保留不重复，Nextconfig不是packaging build。已向primary与consumer交付明确FAILURE77 PUBLIC READY/refreeze，77 shared production/artifact/public harness/source adapter冻结；primary独占新隔离target/credential/fixture/公开执行及fault/实际COMMIT-loss/清理。此receipt只静态检查，不声明公开PG、正常模型/Google、完整failure应用或启动验收。

Round22 actual safe preparation receipts: primary新failure77具名target创建/ACL apply各exit0，源Workspace76为自有disposable technical目标、125表fingerprint unchanged、ledger61/no migration replay，正常库未触。Fixture初准备exit1/new-technical-identity-graph/5setup与修正准备exit1/public-technical-grant-matching_run/96setup保留；ERR_ASSERTION非PG SQLSTATE，private cause不读、不声明生产缺陷或公开合同通过。Producer readonly源码条件诊断：fresh Run-bound授权在DelegationService.create依赖active authoritativeWorkflowContext；failed leaf返回null，原grant.resolve仍支持terminal persist。因此若新matching fixture已FAILED，primary需对同一新Run先在active阶段走公开grant发行，再提交FAILED；不得放宽终态activation或修改已accepted旧记录，实际修正/公开验收仍由primary证明。此处只记录actual safe receipts/条件诊断，77 shared bytes持续冻结。

## Round 25 — Failure77 独立负例与原 GET 续接

Optimized Prompt:

Root明确授权独立 `adminDreamLaunchFailureContinuation.contract.ts`，不修改首次exit1原harness或任何77生产/DTO/Registry/codec/artifact。已读actual partial诊断exit0/287与Editor探针exit0/6：六originals各receipt/audit1完整source/UPDATE raw/17保留，Editor actual403 DELEGATION_ENTITY_DENIED、原fixture误填ACCESS_SCOPE_REQUIRED。新private变量 `INK_AUTH_DREAM_LAUNCH_FAILURE_CONTINUATION_FIXTURE`，strict fixture mandatory validation_scope=remaining_denied_receipts，保留全部原22case/27GET独立事实；checkpoint mandatory原22case/27GET、prepublic17、accepted17、seed后current17完整raw数组与明确new_seed_rows。只允许Editor expected_code纠正，其他所有case/body/IDs/result/status/scenario/concurrency/replay和GET事实deepEqual原checkpoint；任何skip/checkpoint替代成功POST入口或其它code纠正拒绝。六正例只SELECT完整现存receipt/currentowned FAILED Run/source/rawµs/fullscope/同一audit和whole actual original recorder恢复，prepublic→accepted仅六metadata/receipt/audit变化，所有其他完整rows保持；accepted→current仅Root显式新增负例seed rows，全原rows逐字保留。Root另建queued Run/source给new wrongRun grant及ordinaryEditor freshgrant，oldexpiry/Run不重置；消费safe seed proof/partial287/probe6及current17anchor，producer不读privatefixture/seed/PG。新POST函数只接受16deniedcase，zeroPositivePOST；所有27GET执行并完整对照独立expected/historicallease/absent/strictscope，前后17字节相同，报告recovered6/negative16/GET27/positivePOST0真实计数。不用续接结果将首publicexit1改PASS或称单次22完整通过。失败仅safe label/status/code，不输出正文/DSN/token/rawdiff。Source子进程保持既有fixed oracle/PATH+readonlysource/-B/constructor-onlysecret，不执行新FAILEDtransition/model/FS/Runtime。纯guard单独module与Vitest include内新guardtest覆盖篡改/缺proof/丢case/错误code/新增行替代旧行等；Luna仅新guard/type/ownedlint/docs/diff静态检查，source与15/26/11/4不重复。Root在静态READY之后签最后freshOAuth运行独立公开脚本，fault/actualCOMMIT-loss/最终125保留另pending。Round24只有规划尚未编码，当前优先处理该实际失败。

Round25 coordinator contract correction（before code）: Root最终明确继续沿用 `INK_AUTH_DREAM_LAUNCH_FAILURE_FIXTURE` 指向新private continuation fixture，保持原strict22cases/27receipts schema，只改Editor expected code及OAuth/新负例grant。另 mandatory `INK_AUTH_DREAM_LAUNCH_FAILURE_CONTINUATION_EVIDENCE` owned regular0600 JSON，exact字段 `{schema_version:1,database,partial_assertions:287,editor_probe:{status:403,code:DELEGATION_ENTITY_DENIED,assertions:6},accepted_positive_labels:6,prepublic_rows:17 literal relation→rawstring[],current_rows:同17}`。取代前段建议的新Fixture env/extra paths/checkpoint结构；不修改原失败harness。首失败无可接受负例/GET进度，禁止推断已完成indices；本次全部16负例/27GET真实执行，六正例只现存完整回执/source恢复。Current在newwrongRun queued source/PF/history/newDeck/binding/snapshot与freshordinaryEditor授权后捕获；原accepted业务完整行保留，由Root独立seed proof及verifier current17/prepublic完整逐行比较证明。SOURCE prepublic→current允许Root新增rows，但原非目标rows必须逐字保留，六原message仅原失败metadata差异、全部Run/PF/parts/time/Thread保留；失败输出仅label/status/code。Root ThreadSystemConfig新候选/own SystemCfghelper独立owner禁止修改，Luna只本轮newharness静态门禁，Root最后freshOAuth与公开执行必须等Producer READY。

## Round 24 — Plugin 绑定历史只读领域候选

Optimized Prompt:

77 shared生产/Registry/Route/ReceiptHandler/codec/artifact/public harness/source adapter冻结，primary独占隔离fixture/授权诊断。Producer新增未注册 `deck-plugin-binding.history` 严格DTO、typed Repository/Service/薄OAuth Handler、原整段 BindingService.list_history source oracle与新定向tests、`config/deck-binding-policy.ts`；不修改Root-owned SystemConfig/Workspace/DeckVoice modules或既有Reflections26/recovery15。原source先Deckowner再requested ownedWorkspace或按created_at/id oldest，不要求Deck.enabled且不创建默认Workspace；reuse WorkspaceDefaultRepository.owned/oldestOwned。现DeckVoiceRepository owner helper强依赖无关default-Deck policy，新增最小typed ownedDeck查询，不虚构default policy或环境fallback。History包含active/stale全部版本、binding_revision DESC、原route default50/max100放明示pagination policy、完整dpb/release/status/applied_to/timestamps，不返回creator/workspace/lock/Run正文。Output遵循原Pydantic White_Space/codepoint长度与精确UTC微秒；SQL actor以decimaltext::bigint保真。Live OAuthread/canonical active/all-null entityscope及exactidentity/unified由薄入口/服务重复边界验证，read不写receipt/audit/metadata、不执行selection validation/FS/Runtime或更改Run。整段source oracle仅fixed positional rows/params/exception/commit/rollback捕获与拒pool，case事实符合真实ORDER/schema，SQL不解释。仅新history成功/owner/default/NULLlimit/model损坏/strictselector/permission/UOW失败tests及实际source向量，Luna新files/type/ownedlint/AST/docs/diff，15/26/77registration11/Nextconfig4不重复。Binding state/options/save/clear、draft capability/可逆deactivation独立pending，不能把history当完整prepare/provisioning；不注册、不分配新count/hash或写DDL/实际PG/正常模型。

## Round 23 — 未注册 Reflections 配置原回执恢复候选

Optimized Prompt:

77 shared production/Route/Registry/ReceiptHandler/codec/artifact/public harness/source adapter保持冻结；primary独占隔离target/fixtures/公开验证。Producer只新增 `reflectionsSectionConfigOriginalReceiptService.ts` 与其定向测试，复用既有strictDTO/ReceiptRepository.find和live principal合同，不更改先前26PASS候选模块、Root-owned SystemConfig或任何共享77文件。原GET候选仅save/delete的original operation/request，OAuthwrite/current active canonical主体由future薄入口重复验证；服务重复principal/request/name校验，以service+subject+operation+originalID固定查找，absent不查配置。已有回执必须schema1/full closed writeoutput、全部Thread/Editor/Run scope NULL与合法stored inputSHA；损坏结果failclosed503、错误entity/hash格式409。保存/删除布尔结果不含原正文或section，不能从后来配置重建原摘要，也不得为GET增正文/actor/section/配置selector；原有效inputSHA冲突由same-original POST的现有Receipt.execute检查。GET只恢复历史bounded completion，始终不读写当前prompt/default/effective/FS、不获取Runtime权限；后来save/delete或no-op的配置不被恢复覆盖。仅新recovery test覆盖两正常结果/absent/后续配置保持、wrongscope/name/request/permission/status/fulloutput损坏与底层失败，Luna新test/whole type/ownedlint/diff及Markdown引用检查，先前26/11/4不重复。候选不注册、不分配未来operation总数或hash、不声称公开PG/正常模型/完整领域关闭。

Round23 actual gate receipt: producer已逐字读 `reflections-section-original-recovery-first-gate.md`；cachedpnpm指定新recovery单file15/15 PASS、no skips，whole tsc、owned2file ESLint、Markdown inventory、diff各exit0，221MD/MDX/356 decoded filesystem links/247 historical routes/0missing。只有新unregistered Service/tests与owned docs变更；原26/77registration11/Nextconfig4不重复，77 public window与Root SystemConfig保持独立，registered原GET/公开PG仍pending。

## Round 21 — Reflections section 自定义 prompt 的具名持久化候选

Optimized Prompt:

生产76及其public harness/caps/Registry/Route/ReceiptHandler/codec map/机器映射保持冻结，Root独立SystemConfig和五字段preferences不重叠。Producer只新增 reflections-section-config.get/save/delete 的未注册严格DTO、typed Repository、Service、薄OAuth Handler、真实source oracle/tests与非Secret section/filename policy。先读原database.py三functions、实际router过滤及schema：三section来自既有PG CHECK与static defaults；五prompt文件名来自原route whitelist，不能增加任意path或环境编辑器。Dream保留static默认/显示label、有效配置合并、未知key过滤/Python strip与FS/workspace/Agent执行；Admin仅保存其postfiltered非空string record，input prompt_files_json为原json.dumps完整raw text，不重编码business字节。Get保留原NULL/缺失/invalid或非object→null、blank text→{}及legacy未知key/numeric/负零raw objecttext，以免改变原usedCustomConfig/default过滤。SQL仅canonical actor/section，save同一INSERT ON CONFLICT/时间语义，delete保留原bool/no-op。服务重复validate scope/allnullentity，写操作同UOW原receipt/audit，live OAuth由Handler每次验证；不新增产品确认、schema/DDL、通用JSON patch或用户selector。真实get/save/delete原functions在fixed positional results/mockpooldeny/commit/close capture中执行，SQL不解释/不连库；原get只读close不COMMIT，write独立COMMIT，Admin事务封装只承担数据边界结束不跨FS。Luna只新受影响test/source/whole type/ownedlint/AST/diff，保留当前已通过20/35/7/prepare23/公开347不重复；注册/hash/原GET/公开权限/fault/正常业务后续关闭，候选不算当前76可用。

## Round 20 — 实际 prepare/replay/Agent scope 的整段 source 证明

Optimized Prompt:

76生产/fixture harness/sourceadapter/codec-map冻结，SystemConfig由Root独立owner实施，producer仅新增pure source oracle和新test/folder文档。Oracle调用整个实际 DreamLaunchWorkflowOperationsAdapter.prepare、实际_existing_replay_run及实际require_agent_scope；构造实际class的test-only collaborator DI，不复制SQL/验证状态机。固定positional DB rows/参数与in_transaction/rollback事件；catalog只捕获actor/None并可抛原GatewayInferenceError，binding/current-scope/frozen-runtime作为明确capture collaborators（不执行Gateway/FS/真实provisioning）。验证new NULL/nonNULL Agent、model失败先read rollback、missingAgent早拒、existing完整source fingerprint/tuple/metadata/current-scope/frozen-lock replay与catalog outage skip。原NULL Agent不执行voice query、fingerprint payload省略key；不将被capture的binding/model检查冒称真实eligibility/provisioning通过。23源向量由一条batch source test逐项完整结果/参数/顺序验证，子进程使用已存在project interpreter、-B、PATH/read-only-source-only环境，pool opener拒调用，stderr不泄露。Luna仅该new test/Python AST/type/owned lint/diff，旧20/35/7不重复；下一producer named prepare metadata API仍待完整原事务分界设计与76 release，不广告未实施操作。

Prepare23 first-gate correction（before code）: 首实际source比较exit1，command在prepare调用前被真实wire DTO拒绝；原模型明确validate_by_name=false，只接受deckId/agentId/idempotencyKey。复用既有source oracle的显式wire字段映射调用原model_validate，不修改原DTO或生产路径。另将成功replay positional Run fixture的idempotency_key明确设为原command key，使其满足真实SQL WHERE，不用不可能被查询返回的成功row当证据。首失败及type/lint/AST/diff exit0保留；Luna仅fresh该source1 test/23向量、owned lint、Python AST/diff，不重复已通过whole type或旧20/35/7，当前76及SystemConfig保持冻结/独立所有权。

Prepare23 captured-scope fidelity（before code）: 首修正1test/23向量及lint/AST/diff exit0已读。Owner进一步对照真实_require_scope发现其拒绝是PermissionError，capture collaborator却人为转成ApplicationError/404。只改source capture异常和对应expected安全class/code/status，保留先前PASS为历史，不将captured SQL宣称实际current-scope验证；再仅该source/lint/AST/diff定向补验，生产76与whole type不重复或修改。

## Round 17 — 未注册失败 envelope 的原回执恢复

Optimized Prompt:

在生产75与公开harness冻结期间只修改新未注册failure候选文件。原source7/domain17已通过，复用现有owner-scoped Run/workspace/source查询与ReceiptRepository，不新增SQL/DDL或第二codec transport。原completion输出保留truthy error_code，用于以后original GET重建原严格input并比对不可变inputSHA；不能以后来source metadata中变动的error/lease猜原input，也不开放request error/source/actor selectors。抽取当前失败Run、source原tuple/owner/µs与既有grant校验供POST及新独立GET共享；GET只 original request/name 与验证OAuth write主体，从原bounded Run推导当前owned workspace，拒绝坏scope/digest/结果/owner及deleted updated=true source，updated=false缺message可恢复。后来的metadata lease不被GET改写，恢复只证明历史completion，不授予Runtime authority。新GET不接入冻结ReceiptHandler/Route/Registry，fixed codec map未变。Luna仅执行受影响17 POST、new GET测试和whole type/owned lint/diff，保留旧通过回执，review后明确候选/未注册状态并同步folder/header/matrix。

## Round 16 — 失败记录源边界与独立 pure overlay（注册75冻结期）

Optimized Prompt:

只读核查真实DreamLaunchFailureRecorder.record及它调用的真实WorkflowRunService.transition_run，先完成独立source adapter与pure JSON failure overlay，暂不修改冻结75/codec map/Route/Registry/schema。原失败记录先owned Run/message lookup read rollback，再实际FAILED transition（自身read rollback/clean write/COMMIT），随后独立hidden message metadata failed/errorCode及移除claim两字段COMMIT；第二阶段故障不能回滚已提交FAILED Run。Missing/wrongsource/illegalterminal静默no-op，已经FAILED原Run只读rollback后仍执行metadata阶段，不发明新状态机、拒绝NULL Agent规则或重置历史错误。新source adapter调用整个实际record和实际transition_run，仅固定positional结果/clock/UUID/connection factory，SQL不执行或解释，禁止数据库/Runtime/provider调用。纯overlay只固定metadata text+truthy error string→原canonical metadata，保持未知bigint/float/-0.0及invalid object decode行为；没有actor/Run/context/文件选择或通用metadata editor。当前只在新独立文件实施、受影响folder/header同步，Luna验证正常/旧FAILED/不存在/错误source/非法terminal/第二阶段失败、参数与commit/rollback顺序和canonical字节。后续producer在primary释放75后复用现有workflow-run.fail authority以及固定codec transport，设计明确所有权/幂等/两次UOW原回执；本轮不广告failure API可用。

Failure composition addendum（before code）: 独立source7/whole type/lint/AST通过后，只新增未注册closed DTO/typed repository/service及domain tests。原两stage保留：首stage复用现有workflow-run.fail，不重复增加Run状态命令；唯一prospective新command dream-launch-failure.envelope在caller现有UOW中same receipt/audit。原fixed step/reason保留消费合同，error string原truthiness保留。Envelope从当前owned failedRun的source tuple/Thread owner/精确时间推导消息，只固定failure overlay，无caller actor/message/status/context/meta selector；保持Run先提交而第二stage可失败。Verified OAuth或原server-persistence grant均需live canonical/write、original Run+Thread实体绑定，终态persist不获得activation。新service的pure overlay collaborator是server必填DI（未接入默认/fallback），固定transport map等primary释放75后由producer接入；测试DI只在tests，不添加生产环境名旁路或alternate codec transport。新files可静态/unit验证，75production/harness保持冻结，future API不广告ready。

## Round 14 — 启动派发 claim 与 finish 的独立元数据事务

Optimized Prompt:

你是 Admin 启动派发数据 owner。迁入实际 DreamLaunchEnvelopeDispatcher 的 source message claim 与 _finish_claim，保留 claim COMMIT → Dream-owned Voice read/Runtime call → separate finish COMMIT。输入只有 owned workspace/Run 的具名身份，以及 Dream 纯算法已生成的 instruction_text；不得接收 actor、context、metadata、parts/status patch 或执行 Runtime。Context、goal、fallback slug、source/fingerprint 和 dlc claim 均从当前 owned Run/Thread/message/binding 事实和服务 clock 推导。Finish 只接受服务签发 claim ID 与 accepted 布尔，固定映射 pending/dispatched；旧 claim 不匹配时 no-op，不覆盖后续 lease。原5分钟TTL属于既有协议，精确微秒和legacy naive/offset time 与原 _claim_is_fresh 对照。

重复 current workspace owner、Run creator、完整 source tuple/created time、Thread owner/Deck/Agent 与 frozen binding scope；按 workspace→Run→message/Thread锁序和原original请求有界receipt保留事务、审计和 unknown COMMIT 恢复。已 dispatched 或 fresh dispatching 返回 explicit no-claim；失效 claim 才生成新 claim 并更新 envelope。存储 metadata 的未知bigint、1.0与negative zero不能经JS Number重写；复用固定纯codec运输，Python仅做JSON解码/canonical字段overlay/微秒比较，无源码执行、SQL、网络或请求文件选择。

当前注册72与公开创建验收脚本/fixture窗口字节稳定；新claim/finish/context DTO、Repo/Service/Handler和source adapter保持未注册。原Pydantic White_Space/codepoint context采用本领域closed DTO，不在冻结窗修改旧共享context。源验证调用实际原dispatcher/_finish_claim，固定 positional结果及clock/UUID/turn callback capture，无SQL解释或PG。Luna做独立成功/owner/非法selector/TTL/replay/currentclaim/失败rollback与actual full metadata/parameters/commit检查；primary独占公开fixture/故障/PG。Prepare Agent/model/binding、failure recorder、全启动与正常业务未完成，claim组件不能声明完整launch关闭。

## Round 13 — Dream 启动来源的独立原子持久化

Optimized Prompt:

你是 Admin Dream launch 数据 owner。依据实际 DreamLaunchApplicationService 的 command validation、fingerprint、UUIDv5 source IDs 和 DreamLaunchSourceRepository.ensure_source，先实现未注册 named dream-launch-source.ensure。输入只含 owned workspace 与原 Deck/可空 Agent/goal/ASCII idempotency key；actor、source IDs、fingerprint、隐藏 metadata、clock 均由服务推导。复用已有严格 Unicode/Python strip、canonical JSON、microsecond projection、typed DataTransaction 和 same-UOW result/audit receipt；原255/12000/80与UUID namespace/prefix是明确原协议/标题策略，不能以任意环境名变化。不能复用 generic user message persist 让请求编写控制 metadata，也不能在创建前要求尚未存在的 workflowRunId。

保留原单次 source transaction：当前 owned workspace/Deck enabled scope → existing deterministic message replay 校验 → missing deterministic Thread insert → user message 与 hidden launch metadata insert → Thread updated time → commit；相同 key 内容冲突/错误 owner/role/Deck/Agent 失败且全事务 rollback。原 replay 即使 metadata 已由 dispatch 更新仍返回同一 source/time/fingerprint，且不覆盖 parts/claim 或 Thread ordering；同 original request 回执有界恢复结果前仍检查当前 scope 与存储 source authority。通过 scoped advisory locks 序列化同 deterministic source，现有唯一约束保留。Runtime/Agent 执行、envelope claim 和 finish/failure 等后续独立事务仍留 Dream 编排等待具名数据 API，不将其合成一次数据库事务。

源验证只调用实际 Python command/application methods 和 ensure_source（固定 positional results、明确 clock DI、SQL params/commit/rollback capture），禁止复制核心算法或连库。先完成独立未注册 DTO/semantics/repository/service/thin handler、成功/权限/conflict/replay/rollback与实际 full source/INSERT 参数源对照；Luna 执行 bounded deterministic/type/lint。PF70/0060/shared Route/Receipt/Registry/artifact 持续冻结直到 primary 明确结束窗口，本轮不得广告新 operation 可用或执行 public PG；所有 fixtures/faults/normal验收由 primary 独占。同步 headers/folders/map/matrix 并告知 Dream prospective contract 与 pending，不以启动来源覆盖替代其余全领域闭环。

## Round 3 — 首批资源领域操作与认证兼容闭环

Optimized Prompt:

你是 Admin 数据和认证实现负责人。依据 Dream 实际 108 入口清单，优先冻结 resource-policy.read/resource-observer.publish、Thread/turn persistence、长 turn 委托与 Gateway 身份替换的严格输入和输出 DTO，逐项记录版本与 contract hash。先读取现有 resource governance validators、Dream provider/sink、UOW/消息持久化和所有权算法；复用配置和 Drizzle schema，不复制状态机。资源策略返回 configured/not_configured/invalid 三种状态；连接或 capability 失败为 unavailable。Dream 保留原 LKG、单 worker、queue capacity 1、admission/leases 和 Runtime effort 投影。所有 API routes 仅做委派，ORM repository/UOW 执行于 Admin 的显式 credential；不接受任意用户 ID 或 SQL。保留密码/注册、Google 无额外 emailVerified 门槛，修复 metadata 路径并完成 Admin session/RBAC 统一入口。旧 canonical/admin 账户只通过显式审计映射和可审查回填建立，旧主键和历史关系不变。修改 app/lib/dream、auth、薄路由、受影响共享 validator/header/folder/docs。先产出严格成功/失败路径测试，交 Luna 跑 focused unit/typecheck/lint；主任务处理修复，协调负责具名隔离 migration/ACL。逐批向 Dream 交付真实代码及确切 DTO，不宣称未实现 operation 可用；goal 保持 active。

## Round 2 — Better Auth schema、主体映射与 OAuth 骨架

Optimized Prompt:

你是 Admin 认证实现负责人。依据已与 Dream 对齐的 v0.1 契约，使用确切 Better Auth/oauth-provider 1.7.4、内置 Google、JWT ES256 和 OAuth Device Authorization。读取安装源码的 option/schema/transaction、Google account linking、grant/refresh/device 并发行为，不以最新网页替代实际代码。同步必需peer Drizzle0.45.2/jose6.2.12（统一实际plugins/core类型身份），复用现Pool/事务/产品权限；新增 identity schema 与 subject/admin mapping、encrypted browser sessions、幂等receipts 的 Drizzle来源和前向migration，历史不可改。auth route只调用lib服务，缺secret/Google/capability fail closed；禁用Session JWT/device token、公共动态client注册，不同邮箱/同邮箱都不隐式合并旧users。BA sub保持独立，通过唯一FK映射canonical PK；Google provider_sub的旧关系需显式审计迁移。先实现配置/handler/schema/映射与protocol verifier，再browser handle/交互，查出包原子性缺口由领域事务补齐后才广告可用能力。读取Gateway subjectJWT并规划Admin唯一delegation authority，保持计费与scope。

允许修改package/lock、packages/db schema/config、app/lib/auth、app/api/auth、认证页和对应docs/folder/headers；不改Dream源码、不触真实数据库、不重发baseline。正常Google→Account→Session→code/resource access token；失败配置/capability/账户映射冲突/scope/typ/expired拒绝。Refresh单次轮换且旧token重放撤销，device并发只一个成功。先补测试权限/流程矩阵，完成后Luna跑focused unit/typecheck/lint、再integration/browser/build；迁移仅协调执行具名隔离PG。记录未实现与真实Google缺口，goal保持active。

## Round 4 — Admin 登录切换、注册最小权限与显式旧主体采用

Optimized Prompt:

你是 Admin 认证和数据库访问负责人。先复用现有 bootstrap 的一次性 token、十四字符最小密码、角色权限和审计，不新增产品门槛。将 Admin 登录、登出、受保护布局和 API guard 改为同一 Better Auth Session；每次从显式 admin_subject_links 和 active admin_users 重新查询 RBAC，禁止邮箱、普通 Google/Session 自动提升。旧 HMAC cookie 不再发行或接受，保留历史表由显式回填/撤销 runner 处理。Route 只委派严格 DTO/服务；校验、ORM、Session 与审计在同一事务。首次 Admin 使用明确 Admin control credential；身份库只读必要 RBAC、通过受限注册函数插入新 canonical 用户并验证原 Free/default-model 投影，不获得历史正文、订阅、账本或 Provider 密文写权限。迁移仅新增前向 Drizzle，不改已冻结 0054/0055；角色名、DSN 和目标由私有配置显式指定。旧账户采用必须有 manifest/source fingerprint/provider-sub 或密码证据，保留 PK/哈希，冲突 fail closed，不按邮箱隐式合并。先完成可审查代码、契约和干跑产物，再由协调在同一具名可删除隔离 PG 验证真实 ACL/采用与失败回滚。Luna 跑 provider-free 成功/失败测试、type/lint；主任务修复。同步目录合同、架构/历史/验证索引；未迁移领域与真实验收继续明确 pending。

Round25 static typing correction（before code）: Producer逐字读取 failure77-continuation-first-static-gate.md：新guard12/12 PASS/no skips、owned3lint/Markdown221/356/247/0missing/diff exit0；whole tsc exit2，唯一新test第21行token数组被推断string。只给该数组 as const 类型注解，输入与运行语义不变，保留首次exit2；Luna只whole type/ownedtestlint/diff，不重复12个已通过tests/source/public或旧15/26/11/4。实际公开仍等最终READY。

<!-- [Sync] 2026-09-15: Failure77 continuation static correction accepted; documentation final gate pending. -->

Producer read failure77-continuation-typing-correction-gate.md: cachedpnpm whole tsc --noEmit --incremental false, focused test ESLint and diff each exit0. As-const only correction retained12/12 guard PASS without rerun; first tsc2 remains separate. Independent verifier/helper/test now statically accepted, final document inventory/frozen8 equality still pending before PUBLIC READY; public/atomic/COMMIT-loss/preservation and normal acceptance remain unexecuted by producer.

<!-- [Sync] 2026-09-15: independent continuation PUBLIC READY after actual raw gate review. -->

Actual document/freeze gate read: Markdown221/356/247/0missing, frozen8 changed[] and diff each exit0. Newguard12/12/no skips and focused type correction/ownedlint all passed; first tsc2 retained. Producer sent exact mandatory evidence schema/command and PUBLIC READY to primary, then refroze new verifier/helper and production77/original failed harness. Primary may now prepare independent negatives/current17 anchor and last freshOAuth; actual public16/27/6/0 counts, fault/COMMIT-loss/preservation remain pending. No private fixture/credentials/PG or normal-model execution by producer.

## Round 26 — SystemConfig 用户入口与 Thread reader 的接入规划（等待77窗口释放）

Optimized Prompt:

你是 Admin 具名配置数据接口 owner。已有Root-owned UserSystemConfig24/whole get-save source1batch14及ThreadSystemConfig18/type/lint真实门禁，Producer已读最终Thread owner SELECT/no UPDATE-upgrade回执；Failure77 continuation PUBLIC READY/refrozen，primary独占当前public/atomic/finalCOMMIT-loss/preservation，只有明确RELEASE后开始本轮代码。先读取Root候选DTO/Repository/Service/纯Python codec和现有identity/unified/purpose、principalForServiceToken、DelegationService.resolve、authoritativeWorkflowContext、ReceiptRepository、薄handlers与Registry生成器。新增独立userSystemConfigHandler/TS fixed-codec wrapper/threadSystemConfigHandler/userSystemConfigOriginalReceiptService及其定向tests；Root3files/UserSystem helper/DTO/Repository/codec保持Root所有权，不改旧77冻结代码直到primary释放与新的具体注册批次确认。用户get/patch只OAuth，strict empty or原ten-field normalized patch、live active canonical/每次scope/all-null实体，在同一identity+unified UOW调用Root mandatory codec；get不ensure默认，patch复用sameReceipt/audit UOW，仅更新preferences.config_json与原time。Thread read严格{thread_id}->{config_json}，OAuth或server-persistence matchingThread且upstream当前Run验证，显式拒Editor/不一致scope，复用Root owner SELECT而不升级grant既有SHARE锁；若Run当前关系尚未验证，薄边界从server当前Thread事实调用已有authoritativeWorkflowContext并校验，不接受caller Run/authority字段。只读取immutable raw config snapshot，无Runtime/provider、model catalog、资源policy、默认初始化或Thread写入。全局effort/compact/context/server-secret/env所有权沿Root closed DTO与原rules，不增加通用env编辑器。

原GET只有user-system-config.patch的operation/request、OAuthwrite和bounded success:true历史结果，固定service+subject+request查找、schema1/closedoutput/合法storedSHA/all-null实体；不存在即absent，当前配置不重放/不读写，不从后来config重建原input，same-original POST的existing Receipt.execute承担合法inputSHA冲突。固定Python transport map只增加确切userSystemConfigCodec.py内部名称，action只由Root service选择read/merge，不允许外部path/executable；Next trace包括确切包装依赖，实际build/nft证据另待最终验收，不将Node config test当packaging证明。注册阶段才O_EXCL保存旧77全descriptor及原PFreceipt/delegation字节、生成新实际Zod artifact并证明旧77全部deepEqual，不先分配总数/hash。Luna仅新的handlers/originalGET/fixed真实codec受影响tests、whole type/ownedlint/AST/docs/diff，原Root18/24/source14与旧12/15/26/11/4不重复。Primary拥有新隔离seed/公开完整get-patch-Thread/拒绝/并发/原GET/事务fault/实际COMMIT未知结果恢复/保护行；候选门禁不是公开验收或正常用户模型完成。Reflections3和BindingHistory及其他全域独立pending，本阶段不能宣称ALL Dream SQL/pools已清除。

Round26 actual static result: released77后新增fixed codec wrapper、OAuth user handler、persistence-bound Thread handler和bounded Original PATCH service，并接Route/Receipt/Registry/Next trace。首focused run40/44，四个失败均为test未使用既有`{data,request_id}`响应包络；修正后44/44，最终registry exact3 assertion补验45/45；whole cache-free tsc、focused lint、Next config5/5、diff均exit0。O_EXCL generator从旧77 artifact SHA `80aa4e6c475725a06edd0c9ca0cf6467b040ec1bda7ab601d7c7b9c09c5e16c1`生成80，旧77 full descriptors、独立PF receipt/delegation bytes及两Failure77 harness相等；新artifact SHA `661823a292301a67b70ccff8068492a035cc6a3b90fe7abe4eb623f4bc161879`。Public/concurrency/fault/final-COMMIT/preservation、Dream consumer及正常账户/model仍pending，不能将static80当全域关闭。

Round27 actual static result: released80后只复用并注册既有Reflections section-config get/save/delete、typed Repository/UOW、thin Handler及save/delete original receipt，接shared Route/ReceiptHandler/Registry83/artifact/map，无schema/codec/Runtime/FS变化。首combined6files57tests exit1为50passed/7failed：Registry导入receipt-bearing Service触发cycle使6项落入actual ReceiptRepository，source命令另误用不存在的ef6e venv。首失败保留；Registry直接使用同一identity/unified requirements并解除cycle，source root保持ef6e而解释器改project venv，correction57/57 exit0。Whole cache-free tsc、首ownedlint、correction Registry lint、AST/JSON/Markdown/diff均0；O_EXCL0600 parity证明旧80 full descriptors、独立PFreceipt/delegation raw bytes不变。Artifact SHA `2ce9712bf6d5d16867ae4cc2d68c167b834cacee45d25b647d1ea18f7367d566`，map SHA `f8ff8feda1a57663a027074b09207eb2ee36e0e888199d65db86de0bf165b871`，三新SHA见canonical contract。Static READY后freeze；public/fault/actual final-COMMIT由primary独占，Dream consumer/normal Google/model/full domain均pending。

Round27 actual isolated public/atomic result: Root/Luna具名目标`ink_auth_data_codex_test_792494523a17_reflections83`完成组合48逻辑请求、125表保持258项和事务/恢复2568项。主段前43项及第44实际响应完成；harness预期错误单独保留后只读尾段22项通过，actual错误为损坏回执503 `REFLECTIONS_SECTION_CONFIG_RECEIPT_INVALID`、外部user_id selector400 `USER_OVERRIDE_FORBIDDEN`。最终仅三关系变化、5receipt/5audit/净1config。config insert/update/delete、receipt、audit五故障均503且125关系逐行回滚；save/delete各一次真实final-COMMIT响应丢失后Original GET和同input replay均200、effect/receipt/audit各一且无重复，product console.error0。一次性JWK已清理；普通库/Provider/model/Runtime/FS未触碰。这是隔离技术证据，Dream consumer/正常真实业务/全域关闭仍pending，Registry83继续冻结。

## Round 27 — 独立 continuation 前置失败的安全诊断（代码冻结）

Optimized Prompt:

Producer逐字读取actual failure77-public-continuation-command-receipt.json与public-continuation-luna-receipt.md：node与wrapper均exit1，only safe FAIL label preflight/status null/code null，六恢复/16POST/27GET未完成，不claim publicPASS、不推断accepted indices。Fresh-negative prepare actual node exit0/23setup，保留6positive/full17/oldRun状态/oldexpiry，新增1queued operand/2public negative grants；此前fixture-continuation actual node exit0/55setup/恢复12完整Runoperands、两retained technicalactors、old125 retained也已读，首prep1与correction1保留。所有77生产/首次failed script/新continuation保持冻结；不根据preflight泛标签猜schema或放宽guards。Root独占private fixture/evidence/credentials/SQL边界做SELECT-only诊断：owned regular0600 UID/nosymlink、fixture与evidence.safeParse只报issue path/code不报values、pureassert仅静态消息、exact77 capability/target、actual三role/catalog/dataDir/fivefalse、actual17与currentanchor逐relation boolean/count/SHA，以及oldfullrowretention静态guard。Context preflight覆盖上述所有阶段，不能仅据它归类schema失败。Root提供actual command/exit/safe failingguard后，修真正harness或fixture问题；不改生产鉴权、不重POST六成功/不重置expiry/history、不跳断言。若source修改，先新的before-code修正说明与受影响静态门禁后再明确READY/refreeze；如果仅Root-owned fixture correction，不改Source。Full public/atomic/finalCOMMIT-loss/preservation/Root release和后续SystemConfig Round26代码仍pending，继续其它只读规划，不提前注册/count/hash。

Round27 actual diagnosis: producer逐字读取safe sandbox/network command receipts。默认sandbox preflight exit1，stage verification.target_role/classification loopback_permission_denied/assertions0/public_cases0/business_mutation false/normal untouched；同一Root-owned SELECT-only诊断在明确隔离loopback network permission下exit0/23，strict fixture/evidence/coverage/retention与target/三role/fivefalse/dataDir/current17均通过，public_cases0/business_mutation false。归类harness权限前置，不是production/fixture/guard defect；不修改77或new continuation。Root只因300s凭据实际过期准备exclusive新signer/fixture/evidence和2个新的public negative grants，复用已存在queued operand/ordinaryEditor事实，不重演source/claim/positivePOST，不重置oldgrant expiry/Run/graph；随后只在相同scoped-network边界重试冻结continuation。原两次exit1均保留，retry结果未通过前不claim6/16/27。

Round27 scoped-network retry actual acceptance: producer逐字读取actual node command receipt与Luna wrapper receipt。`node --import tsx tests/integration/adminDreamLaunchFailureContinuation.contract.ts` exit0；6个原结果只读恢复、16 denied POST、27原GET、0 positive POST、556 assertions、17 protected tables。First public exit1、first continuation preflight exit1、partial287与Editor6均独立保留；不能表述为单次22全PASS。Whole original recorder already-FAILED source path被恢复验证，prior FAILED Run保持；new FAILED transition、Runtime、provider、FS、normal account/model均未执行。Root retryprep exit0/8仅复用1 queued operand/new graph0/2fresh negative grants/full17 oldrows保留/新300s OAuth last-signed。Producer未读取privatefixture/evidence/credentials或PG正文。Production77、首次harness、新continuation源继续冻结；Primary metadata/receipt/audit fault、actual final-COMMIT-loss/preservation/own cleanup及RELEASE仍pending。

Failure77 final isolated evidence actual raw receipts read: atomic command exit0/126. Faults source_update, receipt_insert and audit_insert each returned503 AUTH_SERVICE_UNAVAILABLE with all17 relations byte-exact rollback and prior FAILED Run preserved; each owned trigger/function pair cleanup passed. Actual final-COMMIT loss injected once: initial503, original GET200 and replay200, exactly one source metadata effect/receipt/audit; whole original recorder and prior Run full row retained. Cleanup removed six owned objects, active fault objects none, history retained. SELECT-only preservation exit0/293 retained original125/prepublic125/postpublic17 full rows, all six positive owner/digest/scopes and complete already-FAILED Run transitions/PF/bindings/history; active fault functions0. Normal database/services, provider/model/Runtime/FS untouched. Together with independent public6/16/27/0/556, registered77 already-FAILED envelope component is isolated-closed; no claim of a newly executed FAILED transition, whole failure application, normal/real model or ALL-domain closure. Production/harness remains frozen until primary explicit RELEASE before Round26 wiring.

## Round 28 — Dream first-turn Session context 的最小读取授权

复用现有 `session.list` v1 DTO、`EditorSessionRepository.list`、operation hash与Registry83 descriptor，不新增operation/schema/receipt。内部handler仅在此操作把opaque `idg_` bearer交给完整 `DelegationService.resolve(token, "dream:read", currentServiceId)`；解析继续验证有效期/撤销、purpose结构、service、scope、active canonical主体与Thread/Run/Editor ownership。解析后只接受purpose=`server-persistence`、Thread非NULL、Editor Session为NULL；Cookie拒绝。Domain重复要求精确actor形态，仅此read可执行，session.save/get/batch/text-list/delete均拒绝该purpose；OAuth Session行为与editor-stdio精确Editor load/replace不变。首本地focused2files29项、whole cache-free TypeScript、focused lint、Markdown和diff均exit0；独立Luna复核同样29/29、type/lint/docs/diff exit0，Markdown221/356/247/0missing，四份冻结artifact SHA精确相等。没有PG、Registry generation、正常账户、Provider/model、Runtime或FS执行，Dream consumer及隔离public仍pending；本组Session provider文件冻结。

## Round 29 — Reflections task/result/event/report aggregate candidate

完整 Dream helper/Agent/router 调用链映射为十六个闭合操作。Admin candidate 已有严格 DTO、OAuth/background Service、typed Drizzle Repository、0061 forward schema、task-scoped receipt、private launch snapshot、section CAS、event conflict detection、exactly-once report 和独立 encrypted `rta_` authority。Authority 精确绑定 service/subject/owner/task/section/Thread，短 TTL 可在 original maximum 内由后台恢复续期，revoked/max-expired/terminal 拒绝；其六操作 allowlist 不扩展普通 Chat。当前仅 candidate artifact，Registry83/shared Route/receipt reader/auth config 未改。报告 JSON 原始文本保留 bigint/`1.0`；保存请求只受既有 `DREAM_DATA_MAX_BODY_BYTES` 约束，列表保留原默认10并由必填 `DREAM_REFLECTION_REPORT_LIST_MAX_ROWS` 限制单次服务容量。DTO/service/authority/handler/artifact/static-migration 30 tests、actual Dream source1 batch、whole tsc与Luna delta通过。具名自建隔离PG已验证旧writer阻塞、提交后五行确定重排、七类约束拒绝、capability v1及完整清理；service fault/ACL、public/consumer/normal acceptance仍pending。

## Round 30 — Reflections Registry99 注册与调用面闭合

Optimized Prompt:

你是 Admin Reflections 注册负责人。只消费已经独立评审通过的 Round29 十六项候选和既有 Registry83，不重新设计 DTO、schema、migration 或产品状态机，也不再次执行 0061。先保存 Registry83 四份冻结 artifact 的原始哈希和旧83个完整 descriptor；然后把候选按既定顺序追加为 Registry99，精确分成 OAuth 7 项与 `reflections:execute` background 9 项，要求每项 Zod input/output、kind、scope、identity 与 `dream.reflection-task-persistence.v1` physical capability 和候选 canonical hash 完全一致。共享 POST Route 只按注册名分派到现有薄 Handler；OAuth 入口继续走 verified canonical subject 与 `dream:read`/`dream:write`，background 入口只接受显式 service client scope，不能用环境名、Cookie 或请求 user_id 旁路。

把 `rta_` authority 接入现有 operation auth 时只允许原六项 exact allowlist：`chat-user-message.persist`、`chat-message.persist`、`chat-thread.get`、`chat-thread.update-session`、`thread-system-config.get`、`session.list`。每次解析必须重复验证 service、subject、task、section、Thread、状态、到期/撤销及 operation；涉及 Thread 的 handler 和领域服务再核对精确 Thread scope，`session.list` 强制 `include_text=false`。缺少显式 operation 的公共 principal helper、OAuth-only service token 边界、其它 Chat/Session/SystemConfig 操作都拒绝 `rta_`；不得扩大普通 service bypass、editor-stdio 或 server-persistence 权限。

原始回执按受众分开：三个 OAuth write 只允许 `operation` 查询并按 canonical主体读取标准 Receipt；八个 background write 只允许 `operation+task_id`，以当前 service与持久化task绑定读取 task-scoped receipt；RTA 子写操作仍走既有 operation receipt 路径并先通过同一 exact allowlist，read操作不生成回执。同步 auth service-client enum、环境示例与 README 必填策略值，所有容量/TTL/路径来自明确 env/config，不把实现常量包装成产品规则。

新增注册、公开 OAuth、内部 background、receipt 与 RTA 成功/拒绝测试，证明 DTO→Service→typed Drizzle Repository 调用链和 Route 只编排。生成 Registry99 artifact及实现map，校验旧83 descriptors逐字等价、四份旧冻结 artifact原始哈希保留、候选16 canonical hashes一致；运行 focused tests、cache-free TypeScript、focused ESLint、Markdown引用、JSON/AST检查和 `git diff --check`。本阶段不运行任何真实或隔离数据库migration，不执行正常账户、Google、Provider/model、Runtime/FS或Dream consumer验收；这些缺口保持明确 pending。只提交本阶段自有文件，不混入共享 worktree 其他修改。

Round30 actual registration result: Registry99 已把评审的 Reflections 十六项按原顺序追加到 canonical-hash 稳定的 Registry83 前缀，OAuth7/background9、POST16、OAuth write receipt3、background write receipt8、RTA六入口及 same-subject/Thread recovery 已闭合。Worker load 返回持久化 event high-water，append 在 task-row lock 下只允许 exact replay 或当前 max+1；DTO/runtime/descriptor 同步限制 PostgreSQL int4 `1..2147483647`。指定17个 focused files 共156 tests 通过，cache-free TypeScript、35-file focused ESLint、JSON6 parse、Registry99/unique/map/parity/canonical/raw-hash检查、Python source oracle语法、Markdown221/356/247/0missing及 `git diff --check` 均 exit0。旧83 canonical SHA `a5f73bf39a8c5f639e636f255b1948349da938be2d354bd3e175261f9af85d6e`；Registry/map raw SHA 为 `2f5af5acb5c52864a3ff00ce19e05540e5191b6f33450f5d2bc4911b5ac7f96e`/`dbb9604d2168af1a7cf8a14c7b04c7895c79899828d1423b780d151f2248c08a`；registered-source canonical/raw SHA 为 `2af7477c424a92c39a1d323b301ef698da147dfa4f1aeb4e8a2166f146981365`/`74513bb643d6a7210d437beb14a46766a9e7ce6285c85fa7fe1004ad558c279f`；current capability SHA 为 `52340d24e76db9ee91dfbe8748ebaf3b0f3c2d20f15367c1c096d2e869d4753f`。Registration 未执行0061；先前隔离PG证据早于最终 capability/event-wire 修正，协调者仍需重放候选并完成ACL/fault验证。Dream consumer与正常业务/model验收继续 pending。

## Round 31 — 本地数据导入与首次登录 Registry101

读取Dream三个旧路由、`database.import_user_data`、`set_first_login_completed`和阶段合同后，只在Admin新增两个OAuth写操作。`local-data.import`使用严格raw JSON DTO、一个Service、一个typed Repository和现有receipt/audit UOW；先锁定所有Session owner，再执行same-owner upsert、Picture/Report insert、四字段Preferences全量import。Report旧毫秒由Dream规范化为RFC3339并持久化created_at；可见Preferences计数保持0–4。`first-login.complete`用单条upsert保存1并保留其它字段。当前schema满足，不生成migration。

静态测试覆盖空导入、每类、selector拒绝、JSON/time、0–4计数、owner冲突、first-login insert/update/repeat、401/403/503、Route/Registry/Original GET和receipt replay/conflict/concurrency。Focused 8 files/88 tests、默认221 files中1730 passed/32 skipped、actual Dream source oracle 1/1、cache-free TypeScript、focused ESLint、Python syntax、JSON101 unique/map parity和diff均exit0；首次source-test TypeScript因ProcessEnv直接断言exit2，改为既有unknown过渡后最终exit0。Luna运行runner-owned loopback PG：默认sandbox因loopback EPERM exit1，限定loopback重试exit0；random limited DATA role、same-owner、foreign全回滚、UOW故障回滚、并发单效果、unknown-COMMIT只读恢复、raw JSON/RFC3339、receipt-wrapped first-login replay及owned cleanup均PASS。Dream consumer和正常首次登录验收仍pending。

## Round 32 — 当前用户图片历史 Registry103

读取Dream `pictures.py` 三个公开路由、`get_daily_pictures`、`get_daily_pictures_range`、`get_daily_picture_full`及前端调用后，只在Admin新增两个OAuth只读操作。`picture-history.list`用严格nullable ISO日期和非负安全limit统一普通/范围列表，typed Repository只读current actor并保留inclusive范围、日期倒序、thumbnail fallback及nullable prompt/time。`picture-history.full`按严格日期返回current actor同日最新原图或null。两者要求`dream:read`及identity/unified capability，拒绝entity/user/friend/SQL/物理selector，不执行friendship检查、receipt、migration或写操作。

Admin静态门禁覆盖日期/limit/selector、owner/scope/delegation、NULL/微秒投影、损坏数据、Handler UOW与Registry101前缀；新领域4 files/33 tests及actual Dream source oracle通过，完整默认226 files中211 passed/15 skipped、1762 passed/34 skipped，cache-free TypeScript与全仓lint均exit0。Runner-owned restricted-role PostgreSQL合同已通过无/start/end/both/zero limit、owner隔离、fallback、duplicate/full newest、缺capability/scope/delegation和cleanup。默认sandbox loopback EPERM与首次时区期望差异均作为harness前置/fixture修正保留，最终限定loopback命令exit0。JSON103 unique/map parity、Python syntax、Markdown10 files/22 links/0 missing和diff均exit0。Dream三个公开路由consumer、旧helper运行时封锁和正常账户验收属于后续Dream提交。

## Round 33 — 默认 Deck 插件候选 Registry104

读取Dream `backend/services/deck/defaults.py`、`PluginInstallService.list_installations`和Deck默认创建阶段合同后，只在Admin新增一个OAuth只读操作。`deck.default-plugin.resolve`使用strict `{}`，从Admin `DREAM_DECK_POLICY_JSON`取得package/version，在typed Drizzle Repository中只匹配ready行，并按原 `created_at DESC, id DESC` 选择最新候选。输出nullable installation，非空只含安装ID、package、marketplace、resolved version、digest和raw compatibility JSON；禁止caller actor、policy、candidate/evidence、SQL/table/column selector。

Handler要求 `dream:read`、null entity scope和identity/既有Deck capability，不生成receipt/audit。Admin不读取artifact、不调用CLI；现有 `deck.create` 与 `deck.reconcile-default` 的事务内安装ID、policy、digest、ready二次匹配保持不变。领域/Handler/registration及实际Dream source oracle focused门禁通过；runner-owned具名loopback PostgreSQL用SELECT-only DATA role验证exact/absent/unready/mismatch、同时间ID次序、raw compatibility、scope/entity/capability拒绝、row count不变和owned cleanup。无migration、configured database、provider、正常账户或Dream consumer执行；Dream本机verifier与两条公开路由替换属于后续独立提交。
