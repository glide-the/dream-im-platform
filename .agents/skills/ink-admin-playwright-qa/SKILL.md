---
name: ink-admin-playwright-qa
description: Run reliable Playwright E2E, production-route smoke, and visual QA for the ink-admin-memory Next.js App Router repository. Use when Codex needs to create, debug, or execute browser tests for the existing PWA or Refine `/admin` console; validate route isolation, feature gates, responsive/theme behavior, API error states, uploads, chat, customers, todos, or PostgreSQL-backed flows; or diagnose flaky local Playwright runs on port 3000.
---

# Ink Admin Playwright QA

Use the repository-root `@playwright/test` installation and the checked-in
`playwright.config.ts`. Prefer deterministic API mocks; isolate PostgreSQL state whenever a test
must persist data. Produce assertions and diagnostics before screenshots.

Read [references/project-workflow.md](references/project-workflow.md) before a browser run. Load
only the sections relevant to the requested lane.

## Guardrails

- Run commands from the repository root with `pnpm exec playwright`; do not use a global CLI.
- Inspect `git status --short --branch` before and after the run. Preserve unrelated changes.
- Resolve the PID and working directory before reusing or stopping a listener on port 3000 or 5433.
- Let Playwright's configured `webServer` own `pnpm dev` for normal E2E runs.
- Mock `/api/claude-agent`, provider, storage, and other external boundaries unless that integration
  is explicitly under test. Never consume a real model key during ordinary UI QA.
- Use a dedicated `TEST_DATABASE_URL` or disposable database for persistent API tests. Never run
  migrations or destructive fixtures against an unresolved `DATABASE_URL`.
- Register console, page-error, request-failure, and unexpected-response diagnostics before
  navigation.
- Prefer roles, labels, titles, and stable test ids. Avoid `force: true` and arbitrary long sleeps.
- Assert behavior before capturing screenshots. Clean up only exact artifacts and processes created
  by the current run.

## Workflow

### 1. Select the smallest proving lane

| Lane | Use for | Preferred execution |
| --- | --- | --- |
| Unit/contract | serializers, parsers, providers, policy | `pnpm test:run -- path/to/test.ts` |
| Mocked browser | UI, routing, loading/error states | `page.route()` + focused Playwright spec |
| Isolated DB E2E | admin/API persistence and concurrency | dedicated Postgres URL + focused spec |
| Production smoke | build, SSR, feature-gate behavior | `pnpm build` + owned `next start` session |
| Visual QA | theme, responsive, overflow, focus | Chromium desktop and narrow viewports |

Do not escalate from mocked browser to real provider or shared database without evidence that the
smaller lane cannot prove the requirement.

### 2. Preflight

Run:

```bash
python3 .agents/skills/ink-admin-playwright-qa/scripts/preflight.py
```

Resolve missing dependencies and occupied ports first. Install Chromium only when the repository
browser is actually absent:

```bash
pnpm exec playwright install chromium
```

### 3. Build deterministic state

- Mock list/detail responses with `page.route()` when testing rendering or navigation.
- Match HTTP method and pathname before fulfilling a route; fall back for unrelated requests.
- Use unique IDs per test and assert the captured request body for mutation flows.
- For API persistence, point both the app process and fixtures at the same dedicated database.
- Keep test fixtures free of production secrets and realistic PII.
- Do not rely on data already present in a developer database.

### 4. Handle Admin and PWA boundaries

- Development enables the current Admin compatibility shell unless
  `ADMIN_CONSOLE_ENABLED=false`; production requires `ADMIN_CONSOLE_ENABLED=true`.
- For Admin positive-path browser tests, use the configured development server or explicitly set the
  flag on the owned server process.
- For fail-closed production smoke, omit the flag and require `/admin` and `/admin/login` to return
  404 while `/` remains available.
- Verify Refine client navigation, dynamic `[id]`, login/workspace layout isolation, and that `/`,
  `/customers`, and other PWA routes are not captured by Admin routing.
- Do not treat visible/hidden Refine controls as authorization proof; direct API 401/403 coverage is
  required after protected Admin APIs exist.

### 5. Author stable assertions

- Assert URL and semantic readiness before interaction.
- Prefer web-first assertions over timeouts.
- Assert loading, empty, success, validation, permission, conflict, rate-limit, and server-error
  states proportional to the change.
- For streaming tests, assert ordered protocol events and terminal state; mock the stream unless the
  real integration is the subject.
- For uploads, mock storage capability and upload endpoints separately, then assert the final proxy
  URL or workspace path.
- Assert zero unexpected application diagnostics on the final run.

### 6. Run proportional verification

Start with the focused spec, then expand:

```bash
pnpm exec playwright test tests/e2e/example.spec.ts --reporter=line --workers=1
pnpm exec eslint path/to/changed.ts tests/e2e/example.spec.ts
pnpm test:run
pnpm build
```

Use `pnpm test:e2e` only when the full suite's real-provider/database prerequisites are available.
Distinguish baseline or environment failures from regressions introduced by the change.

### 7. Visual QA

- Check at least 1440×1000 and 390×844 for shared Admin/PWA layout changes.
- Check light and dark tokens when the change uses global colors.
- Verify keyboard focus, no horizontal overflow, readable table/card fallback, and a single intended
  vertical scroll owner.
- Treat the Next.js development indicator as tooling chrome, not application UI.
- Keep screenshots only when requested or when they are intentional evidence under a gitignored
  output path.

### 8. Clean up and report

- Close browser contexts and stop only owned server sessions.
- Remove the exact temporary database/runtime and exploratory files created by the run.
- Recheck listeners and Git status.
- Report commands, pass/fail counts, browser/viewport coverage, diagnostics, skipped scenarios, and
  any external-only failure separately.

## Failure discipline

- If Playwright reuses a stale server, resolve the port owner and rerun with an owned server; do not
  assume the displayed code matches the worktree.
- If `/admin` returns 404 in development, inspect `ADMIN_CONSOLE_ENABLED` before changing routing.
- If `/admin` returns 200 in production without the flag, treat it as a fail-closed regression.
- If customer/todo pages fail because PostgreSQL is unavailable, mock the API for UI tests or start a
  dedicated database for persistence tests; do not weaken assertions.
- If full lint scans generated `html/` or `playwright-report/`, record that baseline configuration
  issue and still require targeted lint on changed source and specs.
- Never hide application exceptions, failed same-origin API calls, React errors, or authorization
  failures behind a broad diagnostics allowlist.
