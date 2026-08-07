# 收口管理台集成、安全与回归验证

## 1. 关联 Issue 与任务元数据

- Task ID：`TASK-REFINE-ADM-008`
- 关联 Issue：`REFINE-ADM-008`
- 当前增量同步：[SUO-346](/SUO/issues/SUO-346)
- 权威增量：[`SUO-341 plan revision 1`](/SUO/issues/SUO-341#document-plan)；Issue 合同：
  [SUO-345](/SUO/issues/SUO-345)
- 设计来源：`DESIGN-REFINE-ADMIN-001` §5.9、§6、§7、§11–§12
- domain：`shared`
- 上游类型：`shared`
- 优先级：P0
- 标签：`testing`、`e2e`、`security`、`release-gate`
- 唯一规划主责：`TaskDesignAgent`
- 后续执行 owner：由 StagePlanner 唯一绑定；本 task 不直接派发。
- Requirement：[TASK-REQUIREMENT-task_008_shared_admin_integration_verification.md](./TASK-REQUIREMENT-task_008_shared_admin_integration_verification.md)

## 2. 任务目标

在全部 MVP resource 稳定后，以可追踪证据验证路由隔离、三角色 RBAC、服务端直调
拒绝、provider/API 合同、审计一致性、secret 边界与既有 PWA 回归，并给出明确的
`internal-only` 交付结论。本 task 不借测试之名补做产品功能。

## 3. 输入与输出

### 输入与硬前置

- `TASK-REFINE-ADM-001` 至 `TASK-REFINE-ADM-007` 全部完成。
- `TASK-REFINE-ADM-000` 的 IdP 与暴露模型完成评论。
- 设计 `AC-001`–`AC-016`、`RISK-001`–`RISK-008`、`DEC-001`、`DEC-005`、
  `DEC-006`、`DEC-007`、`DEC-009`–`DEC-015`。

### 输出

- RBAC/Data Provider unit、admin API integration、admin E2E、customers/todos PWA
  回归与 secret/audit failure 的结果清单。
- 至少一条完整 happy path：admin 登录→浏览→修改 customer/todo 或
  system-config→查看对应 audit。
- 至少一条 failure path：operator delete 或未登录 admin API 的 401/403；并覆盖
  客户端隐藏之外的直接 API 调用。
- 明确 `internal-only` 的 PR/Issue/发布说明；若目标为 public，则给出独立 blocker
  的未完成/已完成证据，未完成时不得通过 public-ready gate。
- build/SSR/client navigation、Provider/API/error/requestId、additive migration、
  staging apply/恢复、flag-off、只读 canary、逐资源 mutation 与非破坏回滚的证据矩阵。

## 4. 实现步骤

### 后端验证

1. 建立 `AC-001`–`AC-016` 到测试/证据的可追踪矩阵，缺项先标注归属，不修改设计。
2. 运行/补充 policy、guard、contract、Data Provider、audit writer unit tests。
3. 运行/补充 admin API integration：401、403、404、409、422/非法白名单、429（若
   合同可触发）、5xx；断言 requestId 与统一错误，不泄露 stack/secret。
4. 验证 schema/migration 只新增两张 admin 表、没有 runtime DDL、旧表无破坏性变化。
5. 核对 staging 备份后 apply、schema snapshot、feature flag 关闭 + 新表存在时旧应用可运行，
   以及迁移失败停止并从已验证备份恢复；不得自动 `DROP TABLE`/`DROP COLUMN`。
6. 模拟 audit failure，证明 customers/todos/system-config 敏感 mutation 不静默提交。

### 前端验证

7. 验证 auditor/operator/admin 的菜单、页面和动作与服务端矩阵一致；UI 隐藏不是唯一
   断言。
8. 验证 `/admin`、登录跳转、动态路由、403/404/409/5xx 体验与 PWA 路由隔离。
9. 运行 admin E2E happy path 和 direct-call failure path，保留 trace/截图或测试报告。
10. 回归既有 customers/todos E2E，确认 Refine 没有接管 `/`、`/customers` 或旧 API。

### 联调与发布门槛

11. 扫描浏览器响应、日志捕获、审计记录与 system-config payload，断言无 API key、
    DB credential、session secret、`extras`、敏感值原文。
12. 验证 feature gate 顺序：入口默认关闭→allowlist 只读 canary→customers/todos
    mutation→最后 system-config mutation；运行时回滚先关 mutation/入口并保留审计。
13. 汇总路径存在性、必填字段、依赖、lint/test/E2E 与 `git diff --check` 结果。
14. 消费 `000` 暴露模型：internal-only 时明确旧 API 尚未全服务加固；public 时必须
    验证独立安全 blocker 已完成，否则输出 `[BLOCKED] public-ready`。
15. 若发现资源功能缺口，记录归属并创建回流 Issue；本 task 只修复测试/fixture 的
    明确缺口，不直接扩展 resource 实现或上游合同。

## 5. 涉及文件路径与修改边界

### 允许修改

- 受影响的 `*.test.ts(x)`、`*.integration.test.ts`（现有或预期新增）。
- `tests/e2e/**`、必要 fixtures、`playwright.config.ts`（范围内最小改动）。
- internal-only 交付说明：优先写入 PR/Paperclip 完成评论或仓库既有发布说明位置；
  不创建 `docs/stage/`、`docs/exec/`。

### 只读参考或兼容性保护

- `app/api/admin/**`、`app/lib/admin/**`、`app/(admin)/admin/**`：被测实现。
- `app/lib/db/schema.ts`、`drizzle/**`：验证单一 owner 与 additive 变更。
- `tests/e2e/customers-flow.spec.ts`、`tests/e2e/todos-flow.spec.ts`：既有回归锚点。
- `docs/design/refine-admin-validated-architecture.md`、
  `docs/issue/ISSUES_refine_admin_mvp.md`：只读合同。

### 禁止修改

- 未经回流的 resource 功能、RBAC/协议裁决、公开发布配置或旧 API 全面重构。
- 用户/Story/计费/模型/网关 schema/route、外部仓库、Repomix XML。
- `docs/design/**`、`docs/issue/**`、`docs/stage/**`、`docs/exec/**`。

## 6. 依赖项与 DAG

- 前置：`TASK-REFINE-ADM-001`、`002`、`003`、`004`、`005`、`006`、`007`。
- 决策输入：`TASK-REFINE-ADM-000`。
- 本 task 是唯一收口 gate，不与未完成 resource 并行关闭。
- 完成信号供 StagePlanner/后续执行治理判断“internal-only 可交付”；不等于 public-ready。

| Task | 硬前置 | 可并行条件 | hard blocker / 解锁动作 |
|---|---|---|---|
| `000` | 无 | 与 `001` 并行 | IdP/callback 未决时阻塞 `002` 真实身份接入；决策 owner 提供成熟方案 |
| `001` | 无 | 与 `000` 并行 | Node `<20` 或 runtime spike 失败时停止 Admin 发布并回退设计 |
| `002` | `000`、`001` | 可与 `003` 的合同主体并行 | 必须消费 IdP gate 与通过的 route/runtime 基线 |
| `003` | `001` | 可与 `002` 并行定义 | protected API 验收硬等 `002` guard |
| `004` | `002`、`003` | 无 | guard、contract/provider 未冻结不得开始 |
| `005` | `002`、`003`、`004` | 与 `006/007` 资源实现并行 | 不得修改共享 provider/policy/audit/schema |
| `006` | `002`、`003`、`004` | 与 `005/007` 资源实现并行 | 不得修改共享 provider/policy/audit/schema |
| `007` | `002`、`003`、`004` | 与 `005/006` 资源实现并行 | mutation 开放硬等只读 canary 与 customers/todos mutation 稳定 |
| `008` | `001`–`007` + `000` 决策 | 不与未完成资源并行关闭 | public 目标硬等独立全服务安全 blocker；internal-only 可独立收口 |

## 7. 前端 / 后端 / 联调边界

- 后端：API/guard/RBAC/contracts/audit/schema/migration 测试与 direct-call deny。
- 前端：路由、错误、三角色 UX、admin E2E 与 PWA 回归。
- 联调：admin session→resource mutation→audit，requestId 串联与 secret 反证。
- 验收：TaskDesignAgent 保持统一 task 规划；后续执行 owner 汇总一份结果，不拆成无
  owner 的测试孤岛。

## 8. 测试策略

### Happy path

- admin 登录，浏览 customers/todos/settings，更新至少一个资源，刷新后读取成功，并
  在 `/admin/audit` 看到对应脱敏记录。

### Failure path

- 未登录 admin API 返回 401/页面跳转；operator/auditor 直调受限 mutation 返回 403。
- 非白名单 filter/body 拒绝；audit failure 时业务变更不提交；响应/日志/audit 无
  secret 或 `extras`。

### 最小验证命令/方式

- `pnpm lint`。
- `pnpm test:run`，并单独运行被脚本排除的 admin API integration tests。
- `pnpm test:e2e`（admin + customers/todos 回归；环境不足时保留明确未执行原因，
  不能误报通过）。
- migration SQL/schema snapshot review、secret-pattern assertions。
- staging backup/apply、flag-off、只读 canary、逐资源 mutation 与非破坏回滚证据检查。
- 引用路径存在性/预期新增分类检查、必填字段检查、`git diff --check`。

## 9. 完成标志

- [ ] `AC-001`–`AC-016` 每项都有通过证据或带 owner/action 的阻塞记录。
- [ ] 三角色 UI 与服务端矩阵一致，且 direct-call 401/403 有反证。
- [ ] admin happy path 和至少一个 failure path 完整通过并可追踪到 audit requestId。
- [ ] provider 分页/filters/error、audit failure、secret/`extras` 边界有测试。
- [ ] admin 与既有 customers/todos E2E、受影响 lint/unit/integration 均有结果。
- [ ] 交付明确标示 `internal-only`；public 时独立安全 blocker 完成前不关闭
  public-ready。
- [ ] 路径、必填字段、依赖边、schema owner 与 `git diff --check` 通过。

## 10. 非目标

- 补写 resource 功能、修改上游设计、实现 public 全服务安全或延期模块。
- 将 admin API 验收描述为整个 PWA 已生产安全。
- 产出 stage/exec 排期或工期承诺。

## 11. 风险、阻塞与回退

- 条件 blocker：`000` 选择 public 且独立安全前置未完成。Owner：
  `CEOOrchestrator / 产品安全责任人`；action：完成全服务认证、ownership/行级授权、
  旧 API 加固与独立验收。此时可保留 internal-only 结果，但不得 public-ready。
- 风险：E2E 环境/IdP 配置缺失。Owner：后续执行 owner与部署责任人；action：提供受控
  测试身份与环境；未执行项保持明确未完成，不用 mock 结果替代发布证据。
- 回退：若发现实现与 `DEC-001/005/006/009` 冲突，停止收口，创建归属明确的回流
  Issue，必要时回到 DesignArchitect；不得在验证 task 内静默改合同。
