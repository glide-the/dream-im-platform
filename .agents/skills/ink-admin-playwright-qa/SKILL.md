---
name: ink-admin-playwright-qa
description: Run focused Playwright E2E, isolated PostgreSQL integration, production-route smoke, and visual QA for the ink-memory-admin Next.js + Refine control plane. Use for /admin authentication and RBAC, Story CRUD, model/provider/pricing management, billing and gateway operations, system settings, audit, responsive layouts, or flaky local runs on ports 3000/5433. This repository has no PWA or SQLite test lane.
---

# Ink Memory Admin Playwright QA

Use the repository `@playwright/test` installation and checked-in config. The application is a
Refine-only Admin control plane backed exclusively by PostgreSQL. Prefer the smallest deterministic
lane that proves the change and retain diagnostics before screenshots.

Read [references/project-workflow.md](references/project-workflow.md) before any browser run.

## Test execution agent

Delegate bounded provider-free, isolated PostgreSQL, mocked Gateway/browser,
source/unit, and visual-regression execution to the `luna_test_runner` custom
agent. It is configured for `gpt-5.6-luna`, high reasoning, and Fast mode. Give
it the exact spec/command, worktree, expected evidence, owned ports/database,
and cleanup scope; wait for its command receipts before accepting results.

Keep real-user, real-data, or real-provider business acceptance, production
mutation, migration/destructive work, approvals, diagnosis, and implementation
in the primary agent. If the runner cannot access the required browser,
PostgreSQL, or runtime, report a harness blocker; do not silently replace the
requested lane. Apply the full routing contract from `$luna-test-stage` when
available.

## Guardrails

- Run from repository root with `pnpm exec playwright`; never use a global CLI.
- Inspect Git status before and after QA and preserve unrelated worktree changes.
- Resolve process ownership before reusing or stopping listeners on 3000 or 5433.
- Let Playwright `webServer` own `pnpm dev` for ordinary authentication/routing tests.
- Never consume a real model credential in UI QA; mock provider boundaries unless explicitly tested.
- Persistent tests require a named disposable PostgreSQL or explicit `TEST_DATABASE_URL`. Never
  migrate, truncate, drop, or seed an unresolved/shared `DATABASE_URL`.
- Do not add SQLite fixtures, Story database mounts, PWA routes, or authentication bypasses.
- Register console, page-error, request-failure, and unexpected 5xx diagnostics before navigation.
- Prefer role/label/title selectors and web-first assertions; avoid `force: true` and sleeps.
- Validate behavior and server-side authorization before visual evidence.

## Workflow

### 1. Choose a proving lane

| Lane | Use for | Command/pattern |
| --- | --- | --- |
| Unit | parsing, pricing, encryption, policies | `pnpm test:run -- path` |
| Login/routing browser | redirect, form error, 404, responsive shell | focused Playwright with mocks |
| Isolated DB E2E | bootstrap, session, CRUD, RBAC, audit | disposable PostgreSQL + owned server |
| Gateway contract | compatible request/response/settlement | mock provider + isolated PostgreSQL |
| Production smoke | build, feature gate, standalone behavior | `pnpm build` + owned `next start` |
| Visual QA | responsive table/workbench/navigation | desktop + 390×844 |

Do not escalate to a real upstream provider or shared database when mocks/isolated fixtures prove the
requirement.

### 2. Preflight

```bash
python3 .agents/skills/ink-admin-playwright-qa/scripts/preflight.py
```

If Chromium is absent:

```bash
pnpm exec playwright install chromium
```

### 3. Establish deterministic state

- Mock login failures and read-only render states with method/path-specific `page.route()` handlers.
- A protected Server Component layout cannot be authenticated by mocking browser `authProvider`.
- Positive Admin resource tests must bootstrap/login against an isolated migrated PostgreSQL and use
  the real HttpOnly cookie.
- Use unique IDs and delete only records created by the test, or drop only the proven disposable DB.
- Assert request body contracts for create/update/delete and check the matching audit entry.

### 4. Required boundaries

- Without a session, `/`, `/admin`, and resource pages end at `/admin/login`.
- `/customers`, `/todos`, `/api/customers`, `/api/claude-agent` return 404.
- Unauthenticated Admin API calls return 401; insufficient permissions return 403.
- Refine control visibility is UX only; direct API assertions prove authorization.
- Secret Provider/system setting values are never returned in list/detail payloads.
- Ledger, usage and audit resources expose no destructive UI/API mutation.

### 5. Resource behavior

- Story: workspaces → projects → characters/scenes → workflow-runs create/update/delete, FK conflict,
  unique conflict and validation failure.
- Models: Provider credential masking, native/Bearer Anthropic auth mode, model enable/disable, pricing window overlap conflict.
- Users: status/tier/limits, per-model permission CRUD, balance credit idempotency, one-time Gateway Key plaintext and revoke.
- Access: Admin status/role change, custom role CRUD, built-in role protection.
- System: category/key uniqueness and secret value masking.
- Gateway: success/failure/stream interruption, minute/day/month limit windows and explicit `settlement_failed` reconciliation.

### 6. Run proportional checks

```bash
pnpm exec playwright test tests/e2e/admin-shell.spec.ts --reporter=line --workers=1
pnpm exec tsc --noEmit
pnpm lint
pnpm test:run
pnpm build
```

### 7. Visual QA

For shared Admin changes, cover 1440×1000 and 390×844. Verify keyboard focus, no page-level
horizontal overflow, readable table horizontal scrolling, workbench error/success states, long
Chinese/English values, and both theme token modes when global colors change.

### 8. Cleanup and report

Stop only owned processes, remove exact disposable fixtures, recheck listeners/Git status, and report
commands, pass counts, viewport coverage, diagnostics, skipped external scenarios and any environment
failure separately.

## Failure discipline

- Stale `.next/dev` route types after deleting routes are build artifacts, not source truth; regenerate
  route types or use a clean build before diagnosing source imports.
- If `/admin` is 404, inspect `ADMIN_CONSOLE_ENABLED`; production intentionally fails closed unless true.
- If schema readiness fails, apply reviewed migrations to the isolated target; never reintroduce a DB fallback.
- Treat unexpected same-origin 5xx, React exceptions, authorization bypasses and secret leakage as failures.
