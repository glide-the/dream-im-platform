# Ink-Dream Playwright project workflow

## Contents

1. [Repository facts](#repository-facts)
2. [Isolated runtime](#isolated-runtime)
3. [Authentication and navigation](#authentication-and-navigation)
4. [Selectors and readiness](#selectors-and-readiness)
5. [Visual matrix](#visual-matrix)
6. [SubAgent fixtures](#subagent-fixtures)
7. [Console and network audit](#console-and-network-audit)
8. [Cleanup](#cleanup)
9. [Command reference](#command-reference)

## Repository facts

- Frontend root: `frontend/`
- Backend root: `backend/`
- Web origin: `http://127.0.0.1:5173`
- API origin: `http://127.0.0.1:8765`
- Backend entry: `backend/server.py`
- Backend Python: `backend/.venv/bin/python`
- Browser package: `frontend/node_modules/@playwright/test`
- Vite proxies `/api`, `/auth`, `/oauth`, and `/polycli` to port 8765.
- The repo has no root Playwright config; run commands from `frontend/` and specify focused files explicitly.
- Existing browser specs live in `frontend/e2e/`. Many source-level contract tests also use the Playwright test runner under `frontend/src/**/__tests__/`.
- Browser specs use the full Chromium channel with `test.use({ channel: 'chromium' })`.
- Screenshots under `output/` are gitignored.

Use `npx playwright test`, not `playwright-cli`. A Codex Playwright/MCP wrapper may be unavailable even while the repository-local package works correctly.

## Isolated runtime

Use a temp database because `/api/register`, thread creation, Deck binding, and preferences mutate SQLite. Use a temp Agent root because workspace lookup depends on the backend process environment.

```bash
qa_runtime="$(mktemp -d)"
mkdir -p "$qa_runtime/workspaces"

INK_DATABASE_PATH="$qa_runtime/ink.db" \
AGENT_CWD="$qa_runtime/workspaces" \
backend/.venv/bin/python backend/server.py
```

The environment must be present when Python imports `database.py` and workspace modules. Setting it after server startup is too late.

Start Vite from `frontend/`:

```bash
npm run dev -- --host 127.0.0.1
```

Before starting either service:

```bash
lsof -nP -iTCP:8765 -sTCP:LISTEN
lsof -nP -iTCP:5173 -sTCP:LISTEN
```

If a port is occupied, inspect the PID, command, and working directory. Reuse it only when its database/workspace configuration matches the test. Otherwise stop it only with clear ownership.

For tests intended to exercise the user's normal development database, obtain explicit authorization; isolation is the default.

## Authentication and navigation

Prefer API registration and localStorage seeding:

```ts
const registration = await request.post(`${API_BASE}/api/register`, {
  data: {
    email: `qa-${Date.now()}@example.test`,
    password: 'ink-dream-e2e',
    display_name: 'Ink-Dream E2E',
  },
});
expect(registration.ok()).toBeTruthy();
const { token } = await registration.json() as { token: string };

await page.addInitScript((authToken) => {
  localStorage.setItem('auth_token', authToken);
  localStorage.setItem('migration_completed', 'true');
}, token);
```

Register before `page.goto()`. Do not fill the login UI unless login itself is under test.

The Writing surface contains an expanded state chooser when no daily state exists. It can intercept pointer events over the top navigation. For a test that only needs another view:

```ts
const chat = page.getByTitle('Chat');
await chat.focus();
await chat.press('Enter');
```

For a state chooser test, click `Happy`, `OK`, or `Unhappy`, wait at least for the expanded prompt `How are you feeling today?` to become hidden, and then assert the editor. Do not wait for `OK` itself to become hidden; the collapsed chooser retains the selected state's label.

For route-backed surfaces, prefer direct navigation such as `/story-workspace/dream`.

## Selectors and readiness

Selector priority:

1. `getByRole()` with accessible name
2. `getByLabel()`
3. `getByTitle()`
4. stable `data-*` contract
5. exact visible text
6. CSS only for structural measurement

Avoid `force: true`. It hides overlays, stale state, and layout defects. Keyboard activation is acceptable when it is the intended accessibility path or the known Writing overlay is irrelevant to the feature.

Use web-first assertions:

```ts
await expect(page.getByTitle('Subagents')).toBeVisible();
await page.getByTitle('Subagents').click();
await expect(page.locator('[data-subagent-view="list"]')).toBeVisible();
await expect(page.getByTitle('Subagents')).toHaveAttribute('aria-expanded', 'true');
```

For a 250ms sidebar width transition, wait on the semantic state first, then poll until two consecutive bounding-box widths are equal. A bounded delay of about 350ms is an acceptable fallback after the semantic assertion; long sleeps are not a readiness strategy.

For resize QA, verify all paths:

```ts
const separator = page.getByRole('separator');
const initial = Number(await separator.getAttribute('aria-valuenow'));
await separator.focus();
await separator.press('ArrowLeft');
expect(Number(await separator.getAttribute('aria-valuenow'))).toBeGreaterThan(initial);
// Perform a pointer drag using boundingBox() and page.mouse.
await separator.dblclick();
await expect(separator).toHaveAttribute('aria-valuenow', String(initial));
```

## Visual matrix

Cover only dimensions relevant to the change, but for shared Chat or navigation UI include:

- light and dark;
- English and Chinese;
- wide and narrow viewport;
- short and long content;
- Markdown heading, list, link, inline code, and code block;
- loading, running, completed, failed, cancelled, and empty states when applicable;
- keyboard focus and resize interaction;
- no extra vertical scroll container.

Switch theme and language live when reloading would reopen unrelated boot UI:

```ts
await page.evaluate(async () => {
  const [{ default: i18n }, theme] = await Promise.all([
    import('/src/i18n.ts'),
    import('/src/utils/theme.ts'),
  ]);
  await i18n.changeLanguage('zh');
  theme.setThemeMode('dark');
});
```

This is appropriate for visual QA. Use actual UI controls when testing preference controls or persistence.

Take screenshots only after assertions. Use descriptive paths such as:

```ts
await page.screenshot({
  path: 'output/playwright/subagent-detail-dark-zh-narrow.png',
  fullPage: true,
});
```

## SubAgent fixtures

The SubAgent projection scans:

```text
{AGENT_CWD}/{threadId}/.claude-home/projects/**/subagents/*.meta.json
{AGENT_CWD}/{threadId}/.claude-home/projects/**/subagents/*.jsonl
```

Create the authenticated thread through the real API first. Then stage deterministic records:

```bash
python3 .agents/skills/ink-dream-playwright-qa/scripts/stage_subagent_fixture.py \
  --workspace-root "$qa_runtime/workspaces" \
  --thread-id "$thread_id"
```

The helper creates completed, running, failed, and cancelled tasks with Markdown, a paired tool call/result, and a redacted credential field. It refuses to overwrite existing fixture files.

Its expected API counts are fixed:

```json
{"running": 1, "completed": 1, "ended": 2, "total": 4}
```

Verify the backend process sees the same root before opening the UI:

```bash
curl -sS \
  -H "Authorization: Bearer $token" \
  "http://127.0.0.1:8765/api/claude-agent/threads/$thread_id/subagents"
```

Require `exists: true` and the expected task count. If the standalone projection sees files but the API returns `exists: false`, the running backend has a different `AGENT_CWD` or is a stale listener.

In the UI assert:

- compact rows for all terminal states;
- task dispatch precedes assistant/tool/final records;
- tool call and result are paired;
- `[redacted]` appears and the original secret does not;
- final content appears once;
- detail contains no `textarea` or chat composer;
- list/detail share a single sidebar scroll area.

Treat rows as compact when an ordinary row is about 60–72px, a row with a summary is at most 80px, and every row remains within the sidebar bounds. For scroll ownership, count descendants where `scrollHeight > clientHeight + 1` and computed `overflowY` is `auto` or `scroll`; the sidebar body should be the only vertical scroller.

## Console and network audit

Install listeners before navigation:

```ts
const diagnostics: string[] = [];
page.on('console', (message) => {
  if (message.type() === 'error') diagnostics.push(message.text());
});
page.on('pageerror', (error) => diagnostics.push(error.message));
page.on('requestfailed', (request) => {
  diagnostics.push(`${request.failure()?.errorText ?? 'failed'} ${request.url()}`);
});
```

Do not discard all startup errors. If the test intentionally uses the login UI, separate pre-auth bootstrap diagnostics from feature diagnostics only after authenticated readiness is asserted.

Classify failures:

- Ink-Dream JS exceptions, failed `/api` requests, React errors: fail the test.
- requests to `react-grab.com`, `fonts.googleapis.com`, or `fonts.gstatic.com`: record as external diagnostics; do not misreport them as feature regressions.
- unexpected external errors: investigate before filtering.

On the final verification run, require zero application diagnostics.

## Cleanup

Use `try/finally`, test hooks, or managed terminal session cleanup.

1. Close browser/context.
2. Stop owned Vite and FastAPI sessions.
3. Check ports and terminate only verified orphan children.
4. Remove the exact temp runtime created with `mktemp -d`.
5. Remove temporary exploratory `.mjs`/`.spec.ts` files.
6. Preserve intentional screenshots and durable specs.
7. Run `git status --short` and report unrelated existing edits separately.

Never recursively delete a broad workspace, `$HOME`, `~`, `/tmp`, or an unresolved variable.

## Command reference

```bash
# Repository preflight
python3 .agents/skills/ink-dream-playwright-qa/scripts/preflight.py

# Focused source tests
cd frontend
npx playwright test src/hooks/__tests__/useThreadSubagents.test.ts

# Focused browser spec
npx playwright test e2e/subagent-detail.spec.ts --reporter=line --workers=1

# Existing project E2E scripts
npm run e2e:deck
npm run e2e:claude-plugins

# Targeted lint and production type/build verification
npx eslint path/to/source.ts path/to/spec.ts
npm run build

# Backend regression tests
cd ../backend
.venv/bin/python -m pytest -q tests/test_claude_agent_subagents.py
```
