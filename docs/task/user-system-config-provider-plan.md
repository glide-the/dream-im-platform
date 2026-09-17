<!-- [Input] Coordinator source review, existing canonical preference column and mandatory codec boundary. -->
<!-- [Output] Registered80 user/Thread SystemConfig contract, fixed codec and bounded Original PATCH recovery. -->
<!-- [Pos] Root-owned domain joined to shared ingress; five-field Preferences and Dream Runtime remain separate. -->
<!-- [Sync] 2026-09-15: static registration complete; public/fault/preservation and Dream consumer gates pending. -->

# 用户 SystemConfig Provider 候选

当前状态：Root DTO/Repository/Service/source和Thread reader已接入固定codec、薄Route、Original PATCH GET与Registry80。User get/patch只接受service-bound OAuth，Thread get只接受OAuth或同Thread `server-persistence`且Editor为空、nonnull Run等于authoritative current Run。Static focused45/45、whole type/lint、Next config5/5与生成器parity通过；artifact SHA `661823a292301a67b70ccff8068492a035cc6a3b90fe7abe4eb623f4bc161879`。公开PG/并发/fault/final-COMMIT/preservation、Dream consumer和正常账户/model仍pending，因此本文件仍是阶段计划而非完成回执。

## 背景与问题
原Dream get/save直接读取system_config_json并Python json.loads/update/dumps，现有五字段Preferences未覆盖。原workspace及ClaudeAgentService数据库异常后默认配置与本次fail-closed目标冲突，必须在消费者替换中明确失败；无行/NULL/空串正常返回{}。

## 目标与边界
Root独立拥有 userSystemConfigDto/Repository/Service/Codec.py 与纯/source检查和非secret policy。Admin producer负责未来fixed codec DI map、薄OAuth Handler/OriginalGET与capability广告；本76窗口不改shared任何wire/schema/migration或5Preferences。Dream保留Settings归一化、Gateway模型可调用校验、public env净化及Runtime/FS行为；实际Thread/Run读取待调用上下文证明后单独设计，不开放Editor或任意user_id。

## 概念与规则
固定user-system-config.get空input→config_json string；patch10 normalized fields→success:true。OAuthread/write分别验证、所有Thread/Run/Editor scopes拒绝。canonical actor参数::bigint不转Number。原存储对象未知keys保留，原json.dumps integer/float/-0/Unicode与顺序由纯Python维护；非对象/非有限/invalid JSON明确503，不修补或用{}掩盖。

首次patch INSERT user_id ON CONFLICT DO NOTHING、当前行FOR UPDATE、纯merge、仅更新system_config_json/updated_at；与5Prefs UPSERT按同row串行而不改其它字段。未来Handler必须write/result/audit同receipt UOW，unknown先OriginalGET，不盲重试。patch返回success与随后独立get保持原Settings提交/读取边界。

原Settingsenv禁止secret/provider-routing；本次另落实既定Runtime/server-owned键保护：effort/compact/context/model-output/official-output/TMP/绑定主体键不能写入新patch，旧raw keys保留但Dream当前managed Runtime仍擦除不允许覆盖。不存在新模型配额、邮箱限制、控制通道或环境名分支。pure codec强制server-only DI，未配置失败，未来只固定源码路径/PATH-only/-I-S，不接收外部路径。

## 影响、验收与状态
候选首次unit/source/type/lint/AST待实际执行；source检查必须调用真实原get/save捕获全参数/close/commit和新pure输出，不能复制SQL解释器。注册后再验并发合并、其它5Prefs/first-login原列不变、receipt/digest/scope/currentowner、真实COMMITloss/fullrollback、消费者调用关闭。候选不等于完整SQL关闭，也不等于正常账户/Google/模型验收。

跨项目权威计划由协调Dream仓库 docs/stage/stage_admin-user-system-config-domain.md 维护；本文件只handoff提供能力，不维护另一套已注册契约。


<!-- [Sync] 2026-09-15: independent SystemConfig unit24/source1batch14 all25/type/lint/AST2/diff exit0; unregistered UI candidate only. -->

Root实际读Luna user-system-config-first-gate.md：new2test files/25passed、wholetsc0、ownedlint0、AST2/diff0；actual whole get/save14params/rawJSON/commit/close和明确nonobject/nonfinite failclosed冲突已验。未接fixedcodec map/Handler/OriginalGET/Registry，Thread/Run Runtime reader、public/concurrency/receipt/consumer与正常真实验收仍pending；不重复旧域门禁。


<!-- [Sync] 2026-09-15: Root unregistered Thread SystemConfig read candidate, no frozen77/shared Repository/wire change. -->

Root-only threadSystemConfigDto/Service/test reuses threadIdInputDto, strict raw output, existing ChatThreadRepository.requireOwned(current-owner read) and UserSystemConfigRepository.get plus mandatory shared read helper/old pure codec. OAuth current Thread or matching persistence Thread/upstream current Run required; Editor/inconsistent scopes denied before data access. Read writes no defaults/Thread/Prefs/receipt/audit；Runtime consumes a future immutable snapshot. New domain/affected25/type/lint/public/consumer gates pending; no registered count/SHA/schema change. Before-code authority: [Dream 仓库](https://github.com/glide-the/im-dream) 的 `docs/stage/stage_admin-thread-system-config-domain.md`。


<!-- [Sync] 2026-09-15: Root Thread configuration read review avoids upgrading upstream grant SHARE locks. -->

Unregistered Thread read uses existing owner SELECT before mandatory raw UserConfig helper; current bound grant keeps its upstream Thread/Run permission locks, with no extra UPDATE-lock upgrade on a pure read. Actual first18/User24 and focused18+source1batch14=19/type/lint0 retained; post-review Thread/type/lint gate still pending. No shared77 Repository/wire/catalog/schema change.


<!-- [Sync] 2026-09-15: Root accepted final ThreadSystemConfig18/cache-free type/lint/diff0, unregistered public/consumer pending. -->

Root已实际读取 thread-system-config-read-lock-review-gate.md：最终Thread18/18 passed、whole cache-free tsc0、owned2file ESLint0、diff0。先前User24 unchanged通过、source1batch14在显式env下通过；首轮env/type/cache失败与修正19均保留。Current-owner SELECT复用既有Repository，避免纯read升级已有grant SHARE锁；所有当前Thread/Run权限仍需future shared Handler/public验证。三新candidate/复用raw helper未注册或接fixedmap/广告schema，Dream Runtime/user config直连消费者未因此关闭。
