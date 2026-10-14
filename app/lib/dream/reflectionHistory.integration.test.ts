// [Input] Primary-created named disposable PostgreSQL fixture, existing schema capabilities and production POST route.
// [Output] Actual SQL ordering, keyset pagination, owner isolation and unchanged persisted history evidence.
// [Pos] Provider-free read-only integration; primary alone creates/removes its isolated fixture.
// [Sync] 2026-10-14: cross the real Handler/Service/Repository and capability UOW without normal data.
import { afterAll, beforeAll, expect, it, vi } from "vitest";
import pg from "pg";
import { readFile } from "node:fs/promises";
const identity = vi.hoisted(() => ({ owner: "7001" }));
vi.mock("../auth/serviceIdentity", async original => ({ ...await original<typeof import("../auth/serviceIdentity")>(), requireDreamService: async () => ({ id: "history-fixture", backgroundScopes: [] }) }));
vi.mock("../auth/serviceAccessToken", () => ({ principalForServiceToken: async () => ({ subject: "fixture", canonical_user_id: identity.owner, client_id: "fixture-browser", scopes: ["dream:read"], status: "active" }) }));
import { POST } from "../../api/internal/dream/v1/operations/[operation]/route";
const manifestPath = process.env.REFLECTION_HISTORY_FIXTURE;
let check: pg.Client;
let baseline: string;
let request = 0;
const bodyDigest = async () => (await check.query("SELECT md5(string_agg(id::text || report_data_json, ',' ORDER BY id)) AS digest FROM analysis_reports")).rows[0].digest;
beforeAll(async () => {
  if (!manifestPath) return;
  expect(manifestPath.startsWith('/private/tmp/ink-reflections-history-20261014-')).toBe(true);
  const fixture = JSON.parse(await readFile(manifestPath, 'utf8'));
  check = new pg.Client({ connectionString: fixture.database_url }); await check.connect();
  expect((await check.query("SELECT current_database() AS database, current_setting('port') AS port, current_setting('data_directory') AS directory, host(inet_server_addr()) AS host")).rows[0])
    .toEqual({ database: 'ink_codex_reflection_history_20261014', port: String(fixture.port), directory: fixture.data_directory, host: '127.0.0.1' });
  vi.stubEnv('DREAM_DATA_DATABASE_URL', fixture.database_url);
  vi.stubEnv('DREAM_DATA_MAX_BODY_BYTES', '1048576');
  vi.stubEnv('DREAM_REFLECTION_REPORT_LIST_MAX_ROWS', '10');
  baseline = await bodyDigest();
});
afterAll(async () => {
  if (check) { expect(await bodyDigest()).toBe(baseline); await check.end(); }
  await (globalThis as typeof globalThis & { __ink_dream_data_pool?: pg.Pool }).__ink_dream_data_pool?.end();
  delete (globalThis as typeof globalThis & { __ink_dream_data_pool?: pg.Pool }).__ink_dream_data_pool;
  vi.unstubAllEnvs();
});
async function invoke(input: unknown) {
  const response = await POST(new Request('http://localhost/api/internal/dream/v1/operations/analysis-report.history-page', {
    method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Bearer fixture-user', 'x-ink-dream-service-authorization': 'Bearer fixture-service' },
    body: JSON.stringify({ request_id: `history-fixture-${++request}`, input }),
  }), { params: Promise.resolve({ operation: 'analysis-report.history-page' }) });
  return { status: response.status, ...(await response.json()) };
}
it.skipIf(!manifestPath)("reads every persisted report beyond page capacity, task creation and same-time bigint ids without gaps", async () => {
  const expected = (await check.query(`SELECT r.id::text AS id, to_char((CASE WHEN r.reflection_task_id IS NULL THEN r.created_at ELSE t.created_at END) AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS created
    FROM analysis_reports r LEFT JOIN reflection_task t ON t.id=r.reflection_task_id AND t.user_id=r.user_id WHERE r.user_id=7001 ORDER BY created DESC, r.id DESC`)).rows;
  const all: Array<{ id: string; analysis_created_at: string }> = [];
  let before: { id: string; created_at: string } | null = null;
  do {
    const result = await invoke({ limit: 10, before });
    expect(result.status).toBe(200);
    all.push(...result.data.reports); before = result.data.next_cursor;
  } while (before);
  expect(all.length).toBe(132);
  expect(all.map(item => [item.id, item.analysis_created_at])).toEqual(expected.map(item => [item.id, item.created]));
  expect(new Set(all.map(item => item.id)).size).toBe(132);
  expect(all[0].analysis_created_at.startsWith('2026-10-01')).toBe(true);
});
it.skipIf(!manifestPath)("returns only the authenticated owner and fails closed on a foreign-linked or missing task time", async () => {
  identity.owner = '7002';
  const own = await invoke({ limit: 3 }); expect(own.status).toBe(200); expect(own.data.reports).toHaveLength(1);
  identity.owner = '7004';
  expect((await invoke({ limit: 3 })).data).toEqual({ reports: [], next_cursor: null });
  identity.owner = '7003';
  const invalid = await invoke({ limit: 3 }); expect(invalid.status).toBe(503);
  identity.owner = '7001';
});

it.skipIf(!manifestPath)("keeps equal creation times stable across a one-report page boundary", async () => {
  identity.owner = '7001';
  const first = await invoke({ limit: 1 });
  const second = await invoke({ limit: 1, before: first.data.next_cursor });
  expect(first.status).toBe(200); expect(second.status).toBe(200);
  expect(first.data.reports[0].analysis_created_at).toBe(second.data.reports[0].analysis_created_at);
  expect(BigInt(first.data.reports[0].id) > BigInt(second.data.reports[0].id)).toBe(true);
});
