# Repository Guidelines (ink-memory-admin)

本仓库是 Ink Memory 的 Next.js + Refine 管理控制台，使用单一 PostgreSQL 数据库。不存在 `app/(app)` 业务前台，也不存在 SQLite 回退。

## 目录职责

- `app/(admin)/admin/**`：Refine 管理页面与受保护布局
- `app/components/admin/**`：管理后台组件与 Refine providers
- `app/api/admin/**`：管理 API Route Handlers，只做请求编排
- `app/v1/**`：Anthropic/OpenAI 兼容网关入口
- `app/lib/admin/**`：认证、RBAC、资源查询、写操作、审计
- `app/lib/gateway/**`：协议适配、鉴权、请求生命周期
- `app/lib/billing/**`：定价、预授权、结算与账本
- `app/lib/db/schema.ts`：唯一 Drizzle schema 来源
- `drizzle/**`：必须提交的 PostgreSQL 迁移

## 强约束

1. 只支持 PostgreSQL；禁止新增 SQLite、better-sqlite3、本地 JSON DB 或隐式内存回退。
2. Route Handler 不承载复杂业务逻辑；校验、SQL 和事务留在 `app/lib/**`。
3. 所有管理 API 在服务端重复验证 Session 与 permission；Refine 按钮隐藏不是授权边界。
4. 管理写操作必须使用严格 Zod schema、事务和审计。
5. 金额统一为整数 micro-USD；历史计费必须保存价格快照，账本只追加。
6. Provider 密钥和 Gateway Key 不得明文落库或回显。
7. Story 表属于本项目 PostgreSQL 控制面，修改 schema 必须生成 Drizzle 迁移。

## 常用命令

```bash
pnpm dev
pnpm build
pnpm lint
pnpm test:run
pnpm test:e2e
pnpm db:generate
pnpm db:migrate
```

## 测试要求

- API/领域变更至少覆盖成功路径与一个失败路径。
- 关键管理交互使用 `tests/e2e/*.spec.ts`。
- 持久化 E2E 必须使用明确的隔离 PostgreSQL，禁止迁移或清理未知数据库。
- 提交前至少通过 typecheck、lint、unit 与 focused Playwright；高风险改动再跑 build。

## 命名与提交

- TypeScript；避免 `any` 扩散，输入优先 Zod 推导。
- 组件 `PascalCase.tsx`，工具函数 `camelCase.ts`。
- Conventional Commits：`feat:`、`fix:`、`docs:`、`chore:`、`refactor:`、`test:`。
