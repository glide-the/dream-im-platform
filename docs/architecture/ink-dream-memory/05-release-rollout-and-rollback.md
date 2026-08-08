# Dream PostgreSQL 发布、验证与回滚清单

> 状态：后续发布门禁  
> 返回：[总索引](README.md)  
> 依赖：[PostgreSQL 迁移方案](04-postgresql-migration-plan.md) · [页面清单](03-page-refactor-checklist.md)  
> 主要读者：QA、运维、Dream 后端、发布负责人

## 1. 发布原则

- 每个迁移波次都在隔离 PostgreSQL 完整演练，再申请生产窗口。
- 不复用未知 `DATABASE_URL`，不因为数据库名同为 `ink-memory` 就推断可写。
- Dream、Admin、scheduler、worker 对同一 canonical 表的写入方必须在切换表中唯一。
- 先建立恢复能力，再开放 PG 业务写；已有 PG 写入后不能未经 delta 处理切回 SQLite。
- 本发布不启用 Billing、Subscription、Payment、Gateway 或新推理服务。

## 2. 环境与阶段

| 阶段 | 数据库 | 允许动作 | 退出门禁 |
|---|---|---|---|
| R0 Schema CI | 每次全新一次性 `ink-memory` | Alembic upgrade、Repository/contract tests | 空库到 head、结构/权限检查通过 |
| R1 全量演练 | 隔离 PG + 源库只读快照副本 | 43 + 5 表抽取、转换、导入、验证 | count/PK/FK/JSON/enum/digest、API 回归通过 |
| R2 只读影子 | 生产等价 PG，Dream 仍读写 SQLite | 对安全只读查询做结果摘要对比 | 观察窗口内无未解释差异，PG 无写入 |
| R3 停写切换 | 明确生产 `ink-memory` | 维护、最终快照、导入、验证、部署、smoke | 所有硬门禁通过后才开放写 |
| R4 观察 | PG 为唯一运行库 | 监控、前向修复、保留 SQLite 只读归档 | 观察期签字后关闭迁移态告警 |

不使用“部分用户写 SQLite、部分用户写 PG”的业务灰度。可灰度的是只读查询、应用实例和观测，不是同一逻辑表的双写。

## 3. R0/R1 必过验证

### Schema 与迁移

- 全新 PG 可升级到 Dream Alembic head；重复执行无额外 DDL。
- 已存在 Admin canonical 三表时可精确 adopt，结构不兼容则 fail-closed。
- Dream migration 不修改 Admin 控制面表；Admin migration compatibility check 通过。
- 应用角色无 staging/Secret 表越权，Admin 角色只有批准的 canonical 权限。

### 数据

- 主库 43 表、Notion 5 表都有 source/target count、PK/unique、FK orphan 和 digest。
- JSON、boolean、时间、enum、空值、identity sequence 和复合 PK 均有显式检查。
- password hash、Token、Secret、Story/Chat 正文没有进入迁移日志或测试截图。
- append-only/immutable 表拒绝 UPDATE/DELETE；合法 transition 和幂等写通过。

### 应用

- Auth：register/login/refresh/logout/OAuth/device flow。
- Story：Workspace、Story、Character、Scene、关系、review/archive、409。
- Session/Chat：保存、检索、排序、分页和历史消息。
- Deck/Voice/Plugin：安装、绑定、锁、快照、回滚。
- Workflow/Agent：preflight、start、transition、retry/cancel、receipt/session binding。
- Reflection/Event/Notion：原有业务合同和不可变规则。
- Storage：文件/对象存储路径不因 DB 迁移变化。

## 4. 项目现有门禁与新增门禁

后续 Dream 分支至少运行现有体系：

```bash
# Backend 当前 CI 基线
docker buildx build --platform linux/amd64 -t ink-backend:pg-migration --load backend
backend/tests/ci-smoke.sh ink-backend:pg-migration

# Frontend 当前 CI 基线
cd frontend
npm ci
npm run lint
npm run build
```

还需新增 PostgreSQL 专项命令（名称由 Dream 实施时确定）：

- Alembic current/upgrade/head 检查。
- Repository contract tests：SQLite reference 与 PG adapter 使用同一领域案例，最终移除 SQLite runtime 后保留 PG contract。
- `TEST_DATABASE_URL` 隔离集成测试。
- full snapshot migration rehearsal 与 manifest verification。
- focused Playwright：1440×1000、390×844、维护/503/409、旧订阅 URL 清理。

命令只作为后续发布合同；本轮文档更新没有运行 Dream 构建或数据库迁移。

## 5. 生产切换前检查

- [ ] 变更单包含目标 host/port/database 的非敏感 fingerprint、负责人和窗口。
- [ ] `SELECT current_database(), current_user` 与预期一致；只读盘点完成。
- [ ] PG 备份/PITR 恢复演练在目标环境通过。
- [ ] 最终 SQLite snapshot 路径、hash、权限和恢复步骤已验证。
- [ ] Dream/API/scheduler/worker/Admin canonical 写入口能统一进入维护。
- [ ] migration manifest 与源 43 + 5 表实际 inventory 一致。
- [ ] 所有 source/target conflict 已有业务决策，脚本不会自动覆盖。
- [ ] PG 应用版本、旧 SQLite 应用版本和配置回滚包均已准备。
- [ ] 没有 Billing/Subscription/Payment/Gateway/inference 变更混入发布。

## 6. 切换步骤与 Go/No-Go

| 顺序 | 动作 | No-Go 条件 |
|---:|---|---|
| 1 | 开启维护，停止所有相关写入和后台任务 | 任一写入方无法确认停止 |
| 2 | 等待事务结束，生成最终 SQLite snapshot/manifest | quick/FK check 失败或源变化 |
| 3 | 验证目标 DB、schema version、权限、备份 | 连接归属不清或结构 drift |
| 4 | staging 导入、转换和冲突检查 | invalid/skip/conflict 非零 |
| 5 | 按波次提交 target import | 任一事务失败或验证不一致 |
| 6 | 部署 PG 应用，运行只读和 rollback-only smoke | SQL/权限/类型/时区错误 |
| 7 | 运行关键 API、前端和 Admin canonical 回归 | 401/409/503、数据或审计合同异常 |
| 8 | 开放 PG 写入并记录高水位 | 监控、告警或回滚负责人未就绪 |

任一 No-Go 都保持维护态并按 [回滚矩阵](#8-回滚矩阵) 处理，不能用“先上线再补数据”绕过。

## 7. 观察与告警

### 数据库

- pool wait/exhaustion、连接失败、statement/lock timeout、deadlock、rollback rate。
- 慢查询与缺索引，按 route/repository 标识，不记录 SQL 参数敏感值。
- backup/PITR、磁盘、connection count、transaction age。

### 业务

- Auth 401/refresh failure、Story 409/503、Chat/Session 保存失败。
- Workflow transition/version conflict、append-only trigger rejection、Plugin/runtime receipt mismatch。
- SQLite 文件打开计数必须为 0；任何 runtime `sqlite3.connect` 告警为迁移未完成。
- 不增加计费、订阅、支付、Gateway 或推理服务指标。

## 8. 回滚矩阵

| 时点 | 回滚方法 | 数据处理 |
|---|---|---|
| 导入前/导入失败 | 终止迁移，恢复写入旧应用 | 保留失败回执/staging 供审计；不清共享 PG |
| PG 应用 smoke 失败且无 PG 写 | 切回旧版本 + 最终 SQLite snapshot | 证明 PG committed business writes=0 |
| PG 已开放但无业务写 | 关闭流量、审计后切回 | 保存 PG 快照，不删除导入结果 |
| PG 已有业务写 | 默认前向修复；只有已演练 delta exporter 才可回 SQLite | 必须迁回增量、解决冲突并重新全量验证 |
| 仅前端问题 | 回滚前端；PG 后端继续 | 不切数据库，不恢复静态订阅页 |

禁止把数据库回滚等同于执行 DROP/TRUNCATE/DELETE。物理导入结果和 migration receipt 保留到变更复盘完成。

## 9. 迁移回执

每次运行保存：

- `migration_run_id`、源/目标非敏感标识、Git commit、schema versions。
- source snapshot hash/size/mtime、table inventory。
- 每表 source/stage/target count、PK digest、异常计数、耗时。
- FK/unique/enum/JSON/时间/boolean/append-only 验证结果。
- conflict/quarantine 总数和受限工件位置，不含行值。
- 操作者、审批号、开始/结束时间、最终状态、是否开放 PG 写。
- 运行过的测试命令、通过数量、视口和未执行场景。

## 10. 发布验收

- Dream 与 Admin 对 canonical 用户/Story 的读取一致；Admin 受控写仍有 Audit。
- 所有既有核心页面和 API 回归通过，静态订阅入口已隐藏/重定向。
- PG 是 Dream 唯一运行时业务数据库；主库和 Notion store 均无 SQLite fallback。
- 共享/生产数据库的所有动作都有显式审批和回执；测试没有写共享数据。
- 本次发布不包含计费、订阅、支付、Gateway 或新推理服务。

