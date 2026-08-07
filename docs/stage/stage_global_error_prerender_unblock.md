# /_global-error prerender unblock 阶段计划

> Stage Plan ID: STAGE-N16-UNBLOCK-001
> 阶段规划 Issue: [SUO-366](/SUO/issues/SUO-366)
> 唯一映射执行 Issue: [SUO-364](/SUO/issues/SUO-364)
> 被阻塞恢复链: [SUO-361](/SUO/issues/SUO-361)
> 上游任务合同: TASK-N16-UNBLOCK-001
> 状态: PLANNED — execution-readiness locked

## 关联输入

- 设计恢复边界（只读）：docs/design/design_002_next16_tailwind_postcss_baseline_recovery.md
- 原子任务合同：docs/task/task_013_shared_global_error_prerender_unblock.md
- 已填充 requirement：docs/task/TASK-REQUIREMENT-task_013_shared_global_error_prerender_unblock.md
- 既有恢复阶段（只读）：docs/stage/stage_next16_tailwind_postcss_baseline_recovery.md

本计划只将 TASK-N16-UNBLOCK-001 编排为一个原子、严格串行的执行 gate。它不创建执行 Issue、不指定执行人、不运行命令，且不改变既有 R0–R3 recovery stage。执行 readiness 由 [@CEOOrchestrator](agent://1e68c2e7-57cc-4e9e-88c8-3b4432fd6249) 在本计划完成后核验。

## 可机读执行合同

~~~~yaml
stage_contract:
  schema_version: 1
  plan_id: STAGE-N16-UNBLOCK-001
  stage_issue:
    identifier: SUO-366
    path: /SUO/issues/SUO-366
  task:
    id: TASK-N16-UNBLOCK-001
    document: docs/task/task_013_shared_global_error_prerender_unblock.md
    requirement: docs/task/TASK-REQUIREMENT-task_013_shared_global_error_prerender_unblock.md
    mapped_issue:
      identifier: SUO-364
      path: /SUO/issues/SUO-364
  execution:
    stage_count: 1
    stage_id: STG-N16-UNBLOCK-001
    topology: serial_only
    parallel_task_count: 0
    execution_issue_count: exactly_one
    assignee_count: exactly_one
    checkout_required: true
    checkout_lock: retained_by_same_assignee
    workspace: retained_checkout_only
    readiness_authority: CEOOrchestrator
    dispatch_by_stageplanner: false
  allowed_application_source_net_change:
    - app/global-error.tsx
  formal_execution_report:
    required: true
    owner: task_contract_designated_execution_report_writer
    owner_binding_source: docs/task/TASK-REQUIREMENT-task_013_shared_global_error_prerender_unblock.md#formal_execution_report_unique_allowlist
    assignment_by_stageplanner: false
    path: docs/exec/exec_TASK-N16-UNBLOCK-001_global_error_prerender_unblock.md
    allowed_operation: create_or_idempotent_update
    counts_as_application_source_change: false
    all_other_docs_exec_paths: forbidden
  allowed_transient_paths:
    - $PAPERCLIP_RUN_SCRATCH_DIR/**
    - .next/**
  next_env_d_ts:
    modification_target: false
    restoration: byte_for_byte_from_preflight_if_auto_modified
    final_hash: equals_preflight_hash
  forbidden_repository_paths:
    - app/** except app/global-error.tsx
    - package.json
    - pnpm-lock.yaml
    - package-lock.json
    - pnpm-workspace.yaml
    - next.config.js
    - postcss.config.js
    - playwright.config.ts
    - tsconfig.json
    - docs/design/**
    - docs/issue/**
    - docs/task/**
    - docs/stage/**
    - node_modules/**
    - drizzle/**
  forbidden_scope:
    - dependency_or_version_changes
    - installation_or_patch_operations
    - Refine_or_Admin_or_React_Router
    - providers_context_layout_pages_css_api_lib_schema_or_database
    - parent_directory_sibling_checkout_or_external_project
    - git_reset_git_checkout_git_stash_git_clean_or_bulk_formatting
  required_tests:
    - pnpm exec eslint app/global-error.tsx
    - pnpm build
    - test -s .next/BUILD_ID
    - git status --short
    - git diff --name-status
    - git diff -- app/global-error.tsx
    - test -f docs/exec/exec_TASK-N16-UNBLOCK-001_global_error_prerender_unblock.md
  acceptance_all_of:
    - UNBLOCK-AC-001
    - UNBLOCK-AC-002
    - UNBLOCK-AC-003
    - UNBLOCK-AC-004
    - UNBLOCK-AC-005
    - UNBLOCK-AC-006
    - UNBLOCK-AC-007
  component_contract:
    first_effective_directive: use_client
    default_export: root_global_error_component
    props: error_with_optional_digest_and_reset_void
    document_shell: complete_html_lang_zh_CN_and_body
    provider_or_context_or_hook_dependency: forbidden
    sensitive_error_details_in_ui: forbidden
  acceptance:
    UNBLOCK-AC-001: only_app_global_error_tsx_is_new_run_net_application_source_change
    UNBLOCK-AC-002: independent_client_fallback_with_generic_retry
    UNBLOCK-AC-003: focused_eslint_exit_code_is_zero
    UNBLOCK-AC-004: build_exit_zero_and_fresh_nonempty_build_id
    UNBLOCK-AC-005: no_global_error_useContext_prerender_failure_or_failed_diagnostics
    UNBLOCK-AC-006: transient_cleanup_hash_restoration_dirty_state_preservation_and_cold_handback
    UNBLOCK-AC-007: exact_task_contract_execution_report_exists_and_all_other_docs_exec_paths_are_unchanged
  stop_conditions:
    - target_exists_or_ownership_or_checkout_or_workspace_continuity_is_unclear
    - unknown_dot_next_or_dirty_state_cannot_be_attributed
    - focused_lint_nonzero
    - build_nonzero_or_timeout_or_build_id_missing_empty_or_stale
    - original_prerender_error_or_failed_diagnostics_remains
    - second_application_source_file_or_any_forbidden_scope_is_required
    - next_env_d_ts_final_hash_differs_from_preflight
    - mandatory_task_contract_report_is_missing_mismatched_or_another_docs_exec_path_changes
    - child_build_is_claimed_as_suo_361_recovery_evidence
  child_build:
    classification: diagnostic_verification_only
    may_satisfy_suo_361_r2: false
    may_unlock_suo_361_r3: false
  handback:
    on: UNBLOCK_PASS
    first: SUO-364_records_application_unblock
    then:
      issue: SUO-361
      workspace: retained_workspace_and_checkout
      restart_at: R0
      required_chain: [R0, R1, R2, R3]
      reuse_child_build_evidence: false
~~~~

docs/stage/stage_global_error_prerender_unblock.md 本身是本次 StagePlanner 的唯一规划产物；上面 forbidden_repository_paths 约束的是之后的执行 gate，不能被解释为允许执行人修改任何阶段文档。

## 阶段任务表

| 阶段 | 任务 | 产出 | 依赖 | 风险 |
| --- | --- | --- | --- | --- |
| STG-N16-UNBLOCK-001（严格串行） | TASK-N16-UNBLOCK-001 — 新增独立 /_global-error fallback 并验证 prerender unblock | 单一执行 Issue 内的 preflight、lint、build、BUILD_ID、源码 changed-file、清理与 handback 证据；任务合同指定的执行报告责任方必须保留唯一正式报告 `docs/exec/exec_TASK-N16-UNBLOCK-001_global_error_prerender_unblock.md`；唯一结论 UNBLOCK PASS 或 [BLOCKED] | [SUO-365](/SUO/issues/SUO-365) 任务合同已完成；本计划完成后通过 [SUO-364](/SUO/issues/SUO-364) 的 execute-readiness | Provider/context 被重新引入、未知 dirty/.next 状态、build 伪成功、报告路径/ownership 不符、child build 被误用为 R2/R3 证据 |

## 当前进度

| 阶段 | 任务 | 状态 |
| --- | --- | --- |
| STG-N16-UNBLOCK-001 | TASK-N16-UNBLOCK-001 | PLANNED — Stage artifact complete; execution locked until CEOOrchestrator confirms exactly one assignee and checkout |

## Gate 准入条件

STG-N16-UNBLOCK-001 只能在下列条件全部为真时启动；内部步骤必须按列出顺序执行，禁止并行、预热 build、跳关或交接 workspace。

1. [SUO-364](/SUO/issues/SUO-364) 已消费本计划；TASK-N16-UNBLOCK-001 与两个输入文件均存在且映射一致。
2. execute-readiness 已为唯一执行 Issue 指定恰好一名 assignee；该 assignee 已 checkout 并持续持有唯一 checkout lock。
3. assignee 在 [SUO-364](/SUO/issues/SUO-364) 的 retained workspace/checkout 中执行；不能新建/切换 checkout，不能在中途更换 assignee。
4. 尚未执行本 gate 的 lint、build 或 .next 清理；执行者先记录 Issue/run、时间、pwd -P、Git toplevel、完整 dirty snapshot、`app/global-error.tsx` 不存在证明、唯一正式报告路径 `docs/exec/exec_TASK-N16-UNBLOCK-001_global_error_prerender_unblock.md` 的存在/ownership 状态，以及 next-env.d.ts 字节/hash 快照。报告已存在但不属于同一 Task ID/执行链时立即 [BLOCKED]，不得覆盖。
5. PROJECT_ROOT、shell cwd、Git toplevel 和 workspace cwd 同源；若 dirty state 或 .next 无法归属，不启动 gate。

## Gate 内部串行清单与产出

### A. Preflight 与唯一文件创建

- 确认 app/global-error.tsx 在 preflight 时不存在；若已存在或 owner 不明，立即 [BLOCKED]。
- 只创建 app/global-error.tsx。该文件第一条有效指令是 "use client"，默认导出独立 root global-error 组件，显式接收 error（含可选 digest）及 reset(): void，并自行输出完整 html lang=zh-CN 与 body。
- 组件只提供通用错误说明和 reset() 重试；不得渲染/导入 RootLayout、Provider、Context、页面、业务组件、全局 CSS 或 app/lib/**，不得调用 hook/context，且不得显示 message、stack、digest、环境变量或其他内部信息。

### B. 最小测试与 build 证据

按下列顺序运行，逐项保存 command、cwd、开始/结束时间、完整输出与 exit code；任一失败即停止，不执行后项。

~~~~bash
pnpm exec eslint app/global-error.tsx
pnpm build
test -s .next/BUILD_ID
git status --short
git diff --name-status
git diff -- app/global-error.tsx
~~~~

- build 前 .next 必须不存在；未知生成态不得覆盖或清理。
- pnpm build 必须 exit 0，日志显示 Next 16.1.6，且不存在 /_global-error、null useContext prerender、Tailwind/PostCSS 或 module-resolution error。
- .next/BUILD_ID 必须是本 run 新生成的非空普通文件；证据必须包含 mtime、size 与 hash/值摘要，以及 diagnostics 非失败状态。

### C. 范围复核、清理与结论

- **源码 changed-file 判定**必须证明本 run 唯一净应用/源码差异为新增 app/global-error.tsx；必须记录 untracked 新文件的完整新增内容，不能依赖普通 git diff 忽略 untracked 文件。此判定不计入下一条强制的非源码执行报告。
- 任务合同指定的执行报告责任方必须在唯一获准路径 `docs/exec/exec_TASK-N16-UNBLOCK-001_global_error_prerender_unblock.md` 创建或幂等更新正式报告；该报告是成功与 [BLOCKED] 路径都必须保留的非源码证据，记录 preflight、lint/build、fresh BUILD_ID、错误反证、源码 changed-file 判定、清理/回退与 handback。报告创建/更新后必须运行 `test -f docs/exec/exec_TASK-N16-UNBLOCK-001_global_error_prerender_unblock.md`。除这一精确路径外，所有 docs/exec/** 的新增、修改、移动、删除或清理仍禁止。
- 最终任务拥有的仓库输出恰为 `app/global-error.tsx` 与上述正式报告：前者是唯一应用/源码净差异，后者不属于该源码范围；两项规则不得互相否定。
- next-env.d.ts 的最终 hash 必须等于 preflight hash；若 Next 自动改写，只能从本 run 的字节级快照恢复。
- 仅隔离或删除可证明由本 run 生成的 .next/**；保留所有 pre-existing dirty state，不提交生成态。
- 成功只写 UNBLOCK PASS。这个 child build 是**诊断验证**，不能写成 [SUO-361](/SUO/issues/SUO-361) 的 R2 PASS、R3 PASS 或 BASELINE RECOVERED。

## 验收映射

| ID | 必须满足的判定 | 必须留存的反证/证据 |
| --- | --- | --- |
| UNBLOCK-AC-001 | 唯一净应用/源码差异是新增 app/global-error.tsx；不将正式报告计为源码差异 | pre/post status、changed-name 对照、完整新增 diff；任一第二个应用/源码文件即停止 |
| UNBLOCK-AC-002 | Client fallback 独立、完整 html/body、generic retry、无 Provider/context/hook/敏感输出 | 文件内容审查；任一依赖/泄露即停止 |
| UNBLOCK-AC-003 | pnpm exec eslint app/global-error.tsx exit 0 | command、cwd、完整输出、exit code；非零即停止 |
| UNBLOCK-AC-004 | pnpm build exit 0 且本 run BUILD_ID 新鲜、非空 | build log、时间、file type、mtime、size、hash/值摘要；缺一即停止 |
| UNBLOCK-AC-005 | build 不再有 /_global-error / null useContext prerender failure，diagnostics 未失败 | 日志和 diagnostics 摘要；原错误或新 resolver error 即停止 |
| UNBLOCK-AC-006 | .next 已归因后隔离/删除、next-env.d.ts hash 不变、其他 dirty state 保留、冷 handback 完成 | cleanup、hash、scoped diff 与 handback 记录；child build 绝不可复用为 recovery gate |
| UNBLOCK-AC-007 | 任务合同指定的执行报告责任方已在精确路径保留正式报告，且没有其他 docs/exec/** 的本 run 变化 | 报告路径、Task ID/执行链 ownership、PASS/BLOCKED 内容、`test -f` 与 docs/exec changed-name 对照；报告缺失/错路径/被删除，或任何其他 docs/exec/** 变化即停止 |

## 停止、回退与阻塞规则

以下任一条件为 machine-decidable STOP_AND_BLOCK，且关闭本 gate 的所有后续步骤：

- preflight 时目标文件已存在、checkout/workspace/assignee 连续性缺失、未知 .next 无法安全归因，或 pre/post dirty state 无法区分；
- lint 非零；build 非零或超时；BUILD_ID 缺失、为空或不新鲜；diagnostics 失败；日志仍含原 useContext 错误；
- 修复需要第二个应用/源码文件、layout/Provider/Context/CSS、配置、版本、依赖、安装、Refine/Admin/React Router 或任何 hard-deny 范围；
- next-env.d.ts 不能恢复为 preflight hash，源码 changed-file 判定出现第二个本 run 应用/源码净变化，正式报告缺失/路径或 ownership 不符，或任何其他 docs/exec/** 出现本 run 变化；
- 执行人试图运行 dev、页面 smoke、R3、全量 unit/E2E，或将 child build 声明为 [SUO-361](/SUO/issues/SUO-361) recovery gate。

回退仅可移除本 run 新建且失败的 app/global-error.tsx、隔离本 run .next/**、并按快照恢复 next-env.d.ts。不得对任何 pre-existing dirty file 执行 reset、checkout、stash、clean、覆盖或格式化。任务合同指定的执行报告责任方必须在唯一获准报告路径 `docs/exec/exec_TASK-N16-UNBLOCK-001_global_error_prerender_unblock.md` 保留 [BLOCKED] 证据；回退不得删除该报告，且不得触碰其他 docs/exec/**。阻塞摘要必须写入唯一执行 Issue，并包含最后成功步骤、首失败步骤、command、cwd、exit code、完整 error chain、evidence location、应用/源码 changed-file、正式报告路径、回退结果及拥有下一动作的 owner。

## 关键路径与拓扑

唯一关键路径是一个执行节点：execute-readiness → STG-N16-UNBLOCK-001 → UNBLOCK PASS → SUO-361 从 R0 重启。不存在可并行的子任务；lint、冷 build、验证、清理和结论是该节点内的严格串行步骤。

~~~~mermaid
flowchart TD
  Plan["SUO-366 stage plan<br/>TASK-N16-UNBLOCK-001"]
  Ready{"CEOOrchestrator readiness<br/>1 execution Issue · 1 assignee · checkout lock<br/>retained workspace"}
  Gate["STG-N16-UNBLOCK-001<br/>serial: preflight → create one file → lint → cold build → verify → clean"]
  Pass{"All UNBLOCK-AC-001…007 pass?"}
  Block["STOP_AND_BLOCK<br/>scoped rollback + evidence<br/>return to SUO-364"]
  Diagnostic["UNBLOCK PASS<br/>child build = diagnostic verification only"]
  Parent["SUO-364 records application unblock"]
  Restart["SUO-361 retained workspace/checkout<br/>restart R0 → R1 → R2 → R3"]

  Plan --> Ready
  Ready -- "exactly one assignee + checkout" --> Gate
  Ready -- "missing continuity" --> Block
  Gate --> Pass
  Pass -- "no / failed / scope breach" --> Block
  Pass -- "yes" --> Diagnostic --> Parent --> Restart
~~~~

## 风险与缓冲策略

| 风险 | 预防证据 | 停止点与缓冲 |
| --- | --- | --- |
| 内建 global error 仍消费 Provider/Context | 独立 Client fallback 的 import/content 审查 | 发现 hook/context 或 RootLayout 依赖即停；只允许在同一文件收敛 |
| build 伪成功 | exit 0 + 新鲜非空 BUILD_ID + diagnostics + 原错误消失四类证据 | 缺少任一证据即 [BLOCKED]；不启动 dev |
| 并发 dirty state 或缓存被覆盖 | preflight snapshot、单一 checkout、.next 来源证明 | 不可归因即停；只回退本 run 自身变化 |
| 自动改写 next-env.d.ts | preflight byte/hash 与最终 hash 比对 | 无法恢复即停，不产生 handback |
| child build 弱化恢复链 | 明确 diagnostic-only 标记与 handback proof | 禁止直接进入 R3；[SUO-361](/SUO/issues/SUO-361) 必须从 R0 重跑 |

## 完成信号与交接

本计划完成的信号是：此文档存在，且其 stage_contract、固定阶段表/进度表、单一 gate、allow/deny、测试、验收、checkout/assignee、停止条件和 handback 均完整可审阅。它只让 [@CEOOrchestrator](agent://1e68c2e7-57cc-4e9e-88c8-3b4432fd6249) 对 [SUO-364](/SUO/issues/SUO-364) 进行 execute-readiness；不等同于执行开始或 build 通过。

执行完成的唯一成功信号是 UNBLOCK PASS：七项 UNBLOCK-AC-* 全部通过，随后先由 [SUO-364](/SUO/issues/SUO-364) 记录 application blocker 已解除，再交回 [SUO-361](/SUO/issues/SUO-361)。后者必须在其 retained workspace/checkout 从 R0 重新开始完整 R0 → R1 → R2 → R3；本 gate 的 build 永远只是诊断验证，不能复用为其 R2/R3 或 baseline 恢复证据。
