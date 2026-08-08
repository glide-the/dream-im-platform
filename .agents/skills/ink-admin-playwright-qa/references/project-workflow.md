# ink-memory-admin Playwright project workflow

## Repository facts

- Next.js 16 App Router, React 19, Refine Core 5, Tailwind 4.
- Root is the application root; no `frontend/` project and no `app/(app)` route group.
- Browser specs: `tests/e2e/*.spec.ts`; default origin `http://localhost:3000`.
- PostgreSQL 16 is the only data store. Local Docker maps `ink-memory` to host port 5433.
- Admin routes: `/admin/**`; protected resources use real server sessions and `/api/admin/**`.
- Gateway routes: `/v1/messages`, `/v1/chat/completions`, `/v1/models`.
- Root `/` redirects to `/admin`; historical PWA routes are intentionally absent.

## Runtime ownership

Before a run:

```bash
lsof -nP -iTCP:3000 -sTCP:LISTEN
lsof -nP -iTCP:5433 -sTCP:LISTEN
```

Reuse a listener only after verifying its working directory and environment. Otherwise let Playwright
own the dev server. For production smoke use a managed session, for example:

```bash
ADMIN_CONSOLE_ENABLED=true pnpm exec next start -H 127.0.0.1 -p 3010
```

Do not background servers with `&`; stop the exact managed session.

## Feature gate and authentication

`app/(admin)/admin/layout.tsx` enables Admin when `ADMIN_CONSOLE_ENABLED=true`, disables it for any
explicit other value, enables it by default only in development, and fails closed by default in
production.

Unauthenticated `/admin` redirects to `/admin/login`. Browser interception cannot fake the server
layout cookie. For an authenticated lane:

1. create or identify a disposable PostgreSQL target;
2. run `pnpm db:migrate` against that exact URL;
3. start the app with the same URL and generated Admin secrets;
4. call bootstrap once with its bearer token;
5. submit the real login form and retain the HttpOnly cookie in that context.

## PostgreSQL isolation

The checked-in local Docker volume is persistent and is not automatically disposable. For destructive
fixtures, create a named temporary database on an owned instance or use an explicitly provided
`TEST_DATABASE_URL`. Never infer safety from port number alone.

Migration verification must assert that Story/System tables exist and legacy
`customers/todos/conversations/system_configs` do not.

## API mocking

Use `page.route()` for browser-independent failures and rendering states. Match method and pathname:

```ts
await page.route("**/api/admin/story-projects**", async (route) => {
  const request = route.request();
  const url = new URL(request.url());
  if (request.method() === "GET" && url.pathname === "/api/admin/story-projects") {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ data: [], meta: { total: 0, page: 1, pageSize: 12 } }),
    });
    return;
  }
  await route.fallback();
});
```

Provider/network calls must be mocked for ordinary gateway tests. Include real streaming framing and
terminal events when testing streams.

## Diagnostics

Register before navigation:

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
  if (response.status() >= 500) diagnostics.push(`http ${response.status()}: ${response.url()}`);
});
```

Require no unexpected application diagnostics on the final run.

## Visual matrix

- 1440×1000 desktop and 390×844 narrow viewport.
- Navigation, tables, JSON workbench, dialogs/status messages.
- Loading, empty, validation error, forbidden, conflict and success states.
- Keyboard focus and no document-level horizontal overflow.
- Light/dark only when changed global tokens affect both.

## Commands

```bash
python3 .agents/skills/ink-admin-playwright-qa/scripts/preflight.py
pnpm exec playwright test tests/e2e/admin-shell.spec.ts --reporter=line --workers=1
pnpm exec tsc --noEmit
pnpm lint
pnpm test:run
pnpm build
```
