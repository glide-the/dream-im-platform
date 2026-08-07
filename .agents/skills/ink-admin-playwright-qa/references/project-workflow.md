# ink-admin-memory Playwright project workflow

## Contents

1. [Repository facts](#repository-facts)
2. [Runtime and ownership](#runtime-and-ownership)
3. [API mocking](#api-mocking)
4. [Admin feature gate](#admin-feature-gate)
5. [PostgreSQL isolation](#postgresql-isolation)
6. [Selectors and diagnostics](#selectors-and-diagnostics)
7. [Visual matrix](#visual-matrix)
8. [Command reference](#command-reference)

## Repository facts

- Repository root is the Next.js application root; there is no `frontend/` subproject.
- Framework: Next.js 16 App Router, React 19, Tailwind 4.
- Package manager: pnpm 9; Node must be 20 or newer.
- Browser specs: `tests/e2e/*.spec.ts`.
- Playwright config: `playwright.config.ts`.
- Default web origin: `http://localhost:3000`.
- Playwright `webServer` runs `pnpm dev` and may reuse an existing server outside CI.
- Unit tests use Vitest in Node and live under `app/**/*.test.ts`.
- Database: PostgreSQL; local Docker maps container 5432 to host 5433.
- Admin UI: explicit `/admin` App Router routes with Refine Core and Next.js router bindings.
- Current PWA routes and Admin routes share the root QueryClient provider.

Run Playwright from the root:

```bash
pnpm exec playwright test tests/e2e/admin-shell.spec.ts --reporter=line --workers=1
```

## Runtime and ownership

Before starting a server:

```bash
lsof -nP -iTCP:3000 -sTCP:LISTEN
lsof -nP -iTCP:5433 -sTCP:LISTEN
```

When port 3000 is free, let Playwright start and stop the development server. When it is occupied,
inspect the listener command and working directory. Reuse it only when it points to this checkout and
has the required environment; otherwise stop it only after establishing ownership.

For manual development smoke:

```bash
pnpm dev
```

For production smoke, run `pnpm build`, then start Next on a non-default verified-free port using a
managed terminal session:

```bash
pnpm exec next start -H 127.0.0.1 -p 3010
```

Do not background servers with `&`. Stop the exact managed session after assertions.

## API mocking

Mock browser-independent boundaries before navigation:

```ts
await page.route("**/api/customers**", async (route) => {
  const request = route.request();
  const url = new URL(request.url());

  if (request.method() === "GET" && url.pathname === "/api/customers") {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        data: [],
        meta: {
          page: 1,
          pageSize: 6,
          total: 0,
          totalPages: 1,
          tagOptions: [],
          totalCustomers: 0,
        },
      }),
    });
    return;
  }

  await route.fallback();
});
```

Apply the same method/path discipline to todos, storage, workspace files, and Claude Agent. Capture
mutation bodies before fulfilling them and assert the contract after the UI action.

For streaming, fulfill a deterministic stream with the real content type and protocol framing used
by the endpoint. Include an explicit terminal frame and assert the UI exits its running state.

## Admin feature gate

`app/(admin)/admin/layout.tsx` currently applies these rules:

- explicit `ADMIN_CONSOLE_ENABLED=true`: enabled;
- explicit false or any other value: disabled;
- unset in development: enabled for compatibility QA;
- unset in production: disabled and resolved through `notFound()`.

Normal `playwright.config.ts` development runs can open `/admin`. Production fail-closed smoke must
use a production build with no flag and assert:

```text
GET /admin       -> 404
GET /admin/login -> 404
GET /             -> 200
```

Then start a separate owned process with `ADMIN_CONSOLE_ENABLED=true` only when a positive
production route smoke is required. Do not infer authentication from this feature flag.

Admin browser coverage should include:

- overview renders without a second PWA shell;
- Refine `useGo` reaches `/admin/compatibility/[id]` client-side;
- dynamic id is rendered;
- login page is outside workspace navigation;
- `/` and `/customers` remain PWA routes;
- future protected API tests exercise unauthenticated and forbidden direct calls.

## PostgreSQL isolation

Prefer mocks for rendering and navigation. When persistence is the behavior under test:

1. Resolve the database target without printing credentials.
2. Require a dedicated `TEST_DATABASE_URL` or disposable test database.
3. Point the application server and fixture setup at the same URL before either imports DB code.
4. Apply only reviewed migrations needed by the test.
5. Use unique record IDs and clean up those exact records, or drop only the disposable database.
6. Never truncate, drop, or migrate a shared/unresolved database.

The checked-in Docker service is suitable for local development but its database is persistent. Do
not assume it is disposable merely because it uses port 5433.

## Selectors and diagnostics

Selector priority:

1. `getByRole()` with accessible name;
2. `getByLabel()`;
3. `getByTitle()`;
4. stable `data-testid` or domain-specific `data-*` contract;
5. exact visible text;
6. CSS for structural measurement only.

Install diagnostics before `page.goto()`:

```ts
const diagnostics: string[] = [];

page.on("console", (message) => {
  if (message.type() === "error") diagnostics.push(`console: ${message.text()}`);
});
page.on("pageerror", (error) => diagnostics.push(`pageerror: ${error.message}`));
page.on("requestfailed", (request) => {
  diagnostics.push(`${request.failure()?.errorText ?? "failed"}: ${request.url()}`);
});
page.on("response", (response) => {
  if (response.url().startsWith(page.url().split("/").slice(0, 3).join("/")) && response.status() >= 500) {
    diagnostics.push(`http ${response.status()}: ${response.url()}`);
  }
});
```

Adapt same-origin classification if listeners are registered before the first URL exists. Require no
unexpected application diagnostics on the final run. Keep intentional failure responses scoped to
the test and assert their UI treatment.

## Visual matrix

For shared shell, Admin layout, navigation, modal, or global token changes, cover:

- 1440×1000 desktop;
- 390×844 narrow viewport;
- light and dark themes;
- keyboard focus for primary navigation and actions;
- short and long Chinese/English-like content where overflow is relevant;
- loading, empty, error, forbidden, and locked states affected by the change.

The root theme bootstrap reads `dashboard-theme` from localStorage. Seed it before navigation when
testing a fixed theme:

```ts
await page.addInitScript((mode) => {
  localStorage.setItem("dashboard-theme", mode);
}, "dark");
```

Take screenshots only after semantic assertions. Use `output/playwright/` for intentionally retained
evidence and remove temporary screenshots after inspection.

## Command reference

```bash
# Skill preflight
python3 .agents/skills/ink-admin-playwright-qa/scripts/preflight.py

# Focused Admin routing test
pnpm exec playwright test tests/e2e/admin-shell.spec.ts --reporter=line --workers=1

# Focused PWA specs
pnpm exec playwright test tests/e2e/customers-flow.spec.ts --reporter=line --workers=1
pnpm exec playwright test tests/e2e/file-proxy-chat.spec.ts --reporter=line --workers=1

# Unit, lint, and build verification
pnpm test:run
pnpm exec eslint path/to/source.ts tests/e2e/example.spec.ts
pnpm build

# Full browser suite only with required services/credentials available
pnpm test:e2e
```
