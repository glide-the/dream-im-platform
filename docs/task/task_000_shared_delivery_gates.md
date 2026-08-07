# 收敛身份提供方与暴露模型交付门槛

## 1. 关联 Issue 与任务元数据

- Task ID：`TASK-REFINE-ADM-000`
- 关联 Issue：`REFINE-ADM-000`
- 当前增量同步：[SUO-346](/SUO/issues/SUO-346)
- 权威增量：[`SUO-341 plan revision 1`](/SUO/issues/SUO-341#document-plan)；Issue 合同：
  [SUO-345](/SUO/issues/SUO-345)
- 稳定 task 基线：[SUO-343](/SUO/issues/SUO-343)
- domain：`shared`
- 上游类型：`pipeline`
- 优先级：P0
- 标签：`refine`、`security`、`decision`、`internal-only`
- 唯一规划主责：`TaskDesignAgent`
- 后续执行 owner：由 StagePlanner 唯一绑定；本 task 不直接派发。
- 决策 owner：`CEOOrchestrator` / 产品部署与安全责任人
- Requirement：[TASK-REQUIREMENT-task_000_shared_delivery_gates.md](./TASK-REQUIREMENT-task_000_shared_delivery_gates.md)

## 2. 任务目标

在任何 production 身份接入或最终发布断言开始前，形成一份可审计、可被下游直接引用的决定：指定成熟 IdP/server-session 方案、稳定 `identity_subject` 来源、callback 域名 allowlist，并明确交付模式为 `internal-only` 或 `public`。默认只允许 internal-only 继续；public 只能触发 MVP 之外的一等安全 blocker，且不得由 Admin feature flag 绕过。用户中心、Story、Provider/Model Registry、计费/额度/限流和 Proxy Gateway 继续延期，不得预留 schema、route 或 provider 转发。

## 3. 输入与输出

输入：

- `docs/design/refine-admin-validated-architecture.md` §5.4、§5.9、§7.1、§7.2。
- `docs/issue/ISSUES_refine_admin_mvp.md` 的 `REFINE-ADM-000`。
- 部署方已有 IdP、session 与允许回调域名的真实配置证据。

输出：

- Paperclip 决策记录，至少含 `idp/session`、`identity subject`、`callback allowlist`、`exposure mode`、`fail-closed behavior` 五组字段。
- 可由 `TASK-REFINE-ADM-002` 和 `TASK-REFINE-ADM-008` 引用的稳定评论/文档链接。
- 若选择 public：独立安全 Issue 及其一等 blocker 关系；不得将安全工作并入本 MVP。

## 4. 实现步骤

1. 由决策 owner 核对现有部署是否已有成熟 IdP 与 server-session；只接受有实际配置或已选成熟库的结论。
2. 记录 session 权威位置、稳定 subject claim、cookie/server 校验边界、登录与退出入口，以及 callback 域名 allowlist。
3. 明确未配置/配置错误时的 production 行为为 fail-closed；禁止临时前端开关或开发旁路成为发布路径。
4. 明确 `internal-only` 或 `public`。未显式选择时按 `DEC-009` 记录为 internal-only。
5. 若选择 public，创建“全服务认证 + 数据 ownership/行级授权 + 旧 API 加固”的独立设计/Issue，并把它设为发布前 blocker。
6. 在 Issue 评论中链接决定，分别标注它对 002 身份实现和 008 发布验收的影响。

## 5. 涉及文件路径与修改边界

- 只读证据：`docs/design/refine-admin-validated-architecture.md`、`docs/issue/ISSUES_refine_admin_mvp.md`。
- 允许修改范围：Paperclip Issue 评论/交互；后续 task/stage 只能引用决定，不得改写决定。
- 禁止修改范围：`app/**`、`drizzle/**`、`docs/design/**`、`docs/issue/**`、
  `docs/stage/**`、`docs/exec/**`、`ink-admin-memory-output.xml`、外部仓库。

## 6. 依赖项与 DAG

- 前置依赖：无。
- 可并行：`TASK-REFINE-ADM-001`。
- 直接解锁：`TASK-REFINE-ADM-002` 的身份接入。
- 传递约束：`TASK-REFINE-ADM-008` 必须消费 exposure 结论；public 模式还必须等待独立安全 blocker。

## 7. 前端 / 后端 / 联调边界

- 前端：只确认登录、退出、callback 入口需求；不实现页面或客户端认证。
- 后端：确认 session 校验方式、subject 来源与 fail-closed 配置；不自建密码学/OAuth。
- 联调：以同一决策记录连接部署配置、002 的服务端身份适配和 008 的发布结论。

## 8. 测试策略

- Happy path：五组决策字段均有明确值，002/008 能通过链接直接引用。
- Failure path：IdP/callback 未确认时，002 身份接入保持阻塞；production admin route 的预期行为明确为 fail-closed。
- 条件 failure：public 且没有独立安全 blocker 时，008 不得进入 public-ready 验收。
- 最小验证方式：逐项检查 Paperclip 决策记录的字段、owner、证据与可点击引用；对照设计
  §7.1/§7.2/§12.3，确认没有新增 schema、resource、自建认证或 feature-flag 绕过。
- 文档验证命令：
  `rg -n "IdP|identity_subject|callback|internal-only|public|fail-closed|feature flag" docs/task/task_000_shared_delivery_gates.md`
  和 `git diff --check -- docs/task/`。

## 9. 完成标志

- IdP/session、subject、callback、exposure、fail-closed 五项均已记录并有 owner。
- internal-only/public 结论唯一且无歧义。
- 002 与 008 的消费链接已声明。
- public 分支如被选择，已存在独立 blocker；否则明确维持 internal-only。

## 10. 非目标

- 不实现 session、登录 UI、RBAC 或任何资源 CRUD。
- 不设计密码算法、OAuth 协议或公网全服务安全方案。
- 不更改设计、Issue 合同或延期范围。

## 11. 风险、阻塞与回退

- 当前 IdP/callback 是 `[CLARIFICATION_NEEDED]`：unblock owner 为 `CEOOrchestrator` / 产品部署责任人，action 是给出成熟方案与 callback allowlist。
- public 是条件性 blocker：owner 为 `CEOOrchestrator` / 产品安全责任人，action 是创建并完成独立全服务安全前置。
- 新证据若改变 `DEC-007` 或 `DEC-009`，回退 DesignArchitect；不得在本任务静默改合同。
