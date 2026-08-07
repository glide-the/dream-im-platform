# Exec Report: TASK-REFINE-ADM-001 - Refine route shell rerun

## 1. 执行上下文

- Task ID：`TASK-REFINE-ADM-001`
- Stage：`STAGE-REFINE-ADMIN-001` / S0
- 关联设计：`DESIGN-REFINE-ADMIN-001`、`DESIGN-REFINE-ADMIN-UX-001`
- 执行日期：2026-08-08
- 最终状态：`completed`
- 发布姿态：`internal-only`；生产默认关闭 Admin 壳

本次重试消费了历史 blocked 报告中的恢复条件：先验证无 Refine 基线可以 build，再恢复精确
版本的依赖与显式路由壳。历史失败证据保留，不改写为成功。

## 2. 问题裁决

2026-08-08 的无 Refine 基线 `pnpm build` 已成功，`/_not-found` 完成预渲染；历史
Next.js/Tailwind blocker 已解除。Refine 官方 Next.js 指南和包导出均确认 App Router 使用
`@refinedev/nextjs-router`。本次继续 001，没有使用 React Router、Ant Design/MUI、catch-all
或第二个 QueryClient。

## 3. 实现记录

| 范围 | 结果 |
| --- | --- |
| 依赖 | 精确锁定 `@refinedev/core@5.0.12`、`@refinedev/nextjs-router@7.0.5`；声明 Node `>=20` |
| Provider seam | `AdminProviders` 从根 Context 获取 QueryClient，并把同一实例传给 Refine |
| 路由 | 新增显式 `/admin`、`/admin/login`、`/admin/compatibility/[id]` |
| 客户端导航 | 首页探针通过 Refine `useGo` 进入动态路由 |
| 隔离 | `/admin/login` 不渲染 workspace 导航；旧 `/`、`/customers` 未被接管 |
| 发布 gate | `ADMIN_CONSOLE_ENABLED=true` 可显式启用；未设置时仅 development 开放，production 404 |
| 交互 | 新增 Control Ledger / Release Rail 壳层，不伪造运营指标或已解锁资源 |

没有实现 session、RBAC、Data/Auth/Access providers、Admin API、schema、migration、audit 或
资源 CRUD。

## 4. 验证证据

| 检查 | 结果 |
| --- | --- |
| `node --version` | `v24.13.0`，满足 Node `>=20` |
| `pnpm why ...` | Core 5.0.12、Router 7.0.5、Query 5.90.20；Refine 无 peer 冲突 |
| 定向 ESLint | Admin 源码和 `admin-shell.spec.ts` 通过，无诊断 |
| `pnpm test:run` | 23 files / 232 tests 全部通过 |
| `pnpm build` | 成功；三个 Admin 路由均为显式动态路由 |
| Admin Playwright | Chromium 3/3 通过：壳渲染、Refine 导航、动态 id、登录隔离、PWA 回归 |
| production 默认关闭 | 未设置 flag 时 `/admin`=404、`/admin/login`=404、`/`=200 |
| production 显式启用 | flag=true 时 `/admin`、login、dynamic probe 均为 200 |
| 视觉 QA | Chromium 桌面 1440×1000、窄屏 390×844 均无溢出或结构错位 |
| 禁止依赖检索 | 未发现 React Router、Ant Design 或 MUI |
| `git diff --check` | 通过 |

安装依赖时仍报告仓库既有的 `@ai-sdk/react` 与 React 19.0.0 peer warning；该 warning 不来自
Refine，本任务未升级 AI SDK 或 React。

全仓 `pnpm lint` 仍失败：ESLint flat config 未全局排除已有 `html/`、`playwright-report/`
生成文件，且既有 `app/components/dashboard/Sidebar.tsx:68` 命中
`react-hooks/set-state-in-effect`。本次 Admin 定向 lint 已通过；001 的文件边界不授权修改上述
历史问题。

## 5. 下游交接

- `TASK-REFINE-ADM-003` 的 mock contracts/provider 工作已获得 001 前置，但真实 protected API
  验收仍等待 002。
- `TASK-REFINE-ADM-002` 只能按 000 的决定实现 production fail-closed 基础；真实 IdP、稳定
  subject 与 callback allowlist 仍未配置。
- 004–008 继续等待原 DAG，不得因路由壳通过而越级实施。
- production 在真实身份与 server authorization 完成前应保持 Admin flag 关闭。
