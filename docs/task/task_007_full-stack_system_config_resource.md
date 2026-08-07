# 交付 system-config 白名单管理资源

## 1. 关联 Issue 与任务元数据

- Task ID：`TASK-REFINE-ADM-007`
- 关联 Issue：`REFINE-ADM-007`
- 当前增量同步：[SUO-346](/SUO/issues/SUO-346)
- 权威增量：[`SUO-341 plan revision 1`](/SUO/issues/SUO-341#document-plan)；Issue 合同：
  [SUO-345](/SUO/issues/SUO-345)
- 设计来源：`DESIGN-REFINE-ADMIN-001` §5.1–§5.3、§5.5–§5.7
- domain：`full-stack`
- 上游类型：`full-stack`
- 优先级：P0
- 标签：`system-config`、`security`、`rbac`、`audit`
- 唯一规划主责：`TaskDesignAgent`
- 后续执行 owner：由 StagePlanner 唯一绑定；本 task 不直接派发。
- Requirement：[TASK-REQUIREMENT-task_007_full-stack_system_config_resource.md](./TASK-REQUIREMENT-task_007_full-stack_system_config_resource.md)

## 2. 任务目标

为既有单例运行设置交付受保护的 GET/PUT 与 `/admin/settings` show/edit。三个角色
可查看，只有 admin 可在明确确认后更新四个白名单字段；任何响应、表单、日志和审计
均不得暴露 `theme`、`extras` 或 secret。

## 3. 输入与输出

### 输入

- `TASK-REFINE-ADM-002` 的 identity/policy/guard。
- `TASK-REFINE-ADM-003` 的单例 provider/contract/error mapping。
- `TASK-REFINE-ADM-004` 的 audit/transaction 窄接口。
- 现有 `getSystemConfig`、`upsertSystemConfig` 与 `system_configs` 单例表。

### 输入/输出合同

- `GET /api/admin/system-config`：返回 `{ data }`，`data.id` 固定为 `default`，只包含
  `system_prompt`、`model`、`provider`、`workspace_enabled` 及必要非敏感元数据。
- `PUT /api/admin/system-config`：只接受上述四个可更新字段，拒绝未知字段；仅 admin。
- UI：`/admin/settings` show、`/admin/settings/edit` edit；不创建 list/create/delete。
- 成功、拒绝、validation failed/领域失败均写 sanitized audit；变更前有明确确认交互。

## 4. 实现步骤

### 后端

1. 建立 strict zod contract，仅允许四个字段；`theme`、`extras`、id/timestamps 和任何
   secret 字段均不进入更新 body。
2. 建立 response projection，确保 GET/PUT 输出不会因既有 `SystemConfig` 类型扩展而
   意外带出 `theme`、`extras` 或环境 secret。
3. 实现受保护 GET/PUT：解析→zod→session→permission→领域窄接口→audit→统一响应。
4. 三角色均可 GET；只有 admin 可 PUT，operator/auditor 直调必须 403。
5. 通过 `004` 的事务接口执行 update + success audit；denied/failed 只写字段名与原因
   码，不写 prompt/provider/model 的原始值。
6. 保持现有 `/api/system-config` 合同不变，不修改 schema/migration。

### 前端

7. 用单例 Refine mapping 实现 show/edit，不伪装为普通列表资源。
8. 只向 admin 显示编辑入口；提交前展示明确确认，确认内容只列字段名和影响，不显示
   secret 或 `extras`。
9. 处理 401/403/404/409/422/5xx，提交成功后刷新单例缓存并提供 audit requestId。

### 联调与验收

10. 完成 admin 确认→PUT→刷新 show→查看 audit 的 happy path。
11. 完成 operator PUT 403、未知字段拒绝及 secret/`extras` 缺失断言。
12. 发布时先完成只读 canary；customers/todos mutation 稳定后，才以独立 feature gate
    最后开放 system-config mutation。回退先关闭该 mutation/入口，保留审计和新增表。

## 5. 涉及文件路径与修改边界

### 允许修改

- `app/api/admin/system-config/route.ts`（预期新增）。
- `app/(admin)/admin/(protected)/settings/**`（预期新增）。
- `app/components/admin/settings/**`（预期新增）。
- 仅为 system-config 事务/审计必要的 `app/lib` 窄接口。
- system-config admin unit/integration/E2E tests（预期新增）。

### 只读参考或兼容性保护

- `app/lib/db.ts` 的 `getSystemConfig/upsertSystemConfig`、`app/lib/types.ts`。
- `app/api/system-config/route.ts`：旧 API，不得改。

### 禁止修改

- `app/lib/db/schema.ts`、`drizzle/**`、旧 system-config API/PWA 行为。
- `theme`、`extras`、provider API key、环境 secret 的 admin contract/UI/audit。
- Model Registry、价格、密钥轮换、计费、网关或 create/delete resource。
- 共享 provider/policy/audit 基础、其他 resources、外部仓库与 XML。

## 6. 依赖项与 DAG

- 前置：`TASK-REFINE-ADM-002`、`003`、`004`。
- 可与 `TASK-REFINE-ADM-005`、`006` 并行；不得修改共享基础文件。
- 完成后为 `TASK-REFINE-ADM-008` 提供 settings 资源和高风险 mutation 证据。

## 7. 前端 / 后端 / 联调边界

- 后端：strict projection、GET/PUT、admin-only policy、transactional audit。
- 前端：单例 show/edit、admin-only action、确认与错误体验。
- 联调：singleton provider、cache refresh、requestId→audit、secret/`extras` 反证。
- 验收：后端证明白名单/RBAC/audit，前端证明确认，联调证明闭环与不泄密。

## 8. 测试策略

### Happy path

- admin GET 后确认并 PUT 四个字段的合法子集；返回 id `default`，刷新后值生效且 audit
  只记录 changed field names。

### Failure path

- operator/auditor PUT 返回 403；提交 `theme`、`extras` 或未知字段返回 400/422；
  响应、表单与 audit 均不含这些字段或 secret；audit failure 时配置不更新。

### 最小验证命令/方式

- `pnpm test:run -- app/lib/admin/system-config.test.ts app/components/admin/settings/settings.test.tsx`。
- 单独运行 `app/api/admin/system-config/route.integration.test.ts`：GET、PUT、401/403、
  未知字段、audit failure。
- `pnpm exec playwright test tests/e2e/admin-system-config.spec.ts`：确认→更新→audit、
  operator deny、只读 canary/feature-gate 行为。
- secret/`extras`/`theme` response-form-audit assertions；`pnpm lint`；
  `git diff --check -- app tests/e2e`。

## 9. 完成标志

- [ ] 单例 GET/PUT 与 show/edit 按统一合同工作，id 固定 `default`。
- [ ] 更新只接受四个白名单字段且仅 admin；确认交互存在。
- [ ] `theme`、`extras`、secret 不在 contract、UI、响应、日志、audit。
- [ ] mutation audit 脱敏且失败不静默提交。
- [ ] 旧 system-config API、schema/migration 与其他 resources 未修改。
- [ ] 只读 canary 先行且 system-config mutation 最后开放；feature-gated rollback 证据齐全。
- [ ] 完成信号包含测试结果与 `008` 可引用的高风险变更证据。

## 10. 非目标

- 通用资源列表、create/delete、Model Registry、定价或密钥轮换。
- 管理 `theme`、`extras` 或任何 secret。
- 修改旧 API、schema/migration 或共享基础。

## 11. 风险、阻塞与回退

- 风险：现有 `extras` 开放 JSON 导致敏感字段泄漏。Owner：后续执行 owner；action：
  strict response projection 与反证测试，不序列化完整对象。
- 风险：配置错误影响 AI 行为。Action：admin-only、确认、逐资源 mutation 开关、审计。
- 澄清：若要求 secret rotation 或 Model Registry，owner 为
  `CEOOrchestrator / DesignArchitect`；action：新建设计与 Issue，本 task 不扩展。
- 回退：canary 失败时先关闭 system-config mutation/入口，保留审计；不删除表、不改
  旧 PWA 设置行为。
