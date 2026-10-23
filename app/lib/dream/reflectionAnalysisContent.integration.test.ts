// [Input] Primary-prepared private manifest for an identity-verified disposable PostgreSQL cluster.
// [Output] Public production POST/receipt routes persist, recover, execute and reload a task-linked partial report.
// [Pos] Provider-free integration; only OAuth/service identity boundaries are injected, domain/UOW/repositories are real.
// [Sync] 2026-10-23: execute metadata-only v2 tasks, live page authority, first-read evidence and report reload through public routes.
// [Sync] 2026-10-13: verify immutable Notion/Agent input and idempotent report persistence without normal-account data.
import { afterAll, beforeAll, expect, it, vi } from "vitest";
import { createHash, randomBytes } from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import pg from "pg";
const identity = vi.hoisted(() => ({ owner: "7001", service: "fixture-analysis-service" }));
vi.mock("../auth/serviceIdentity", async original => ({ ...await original<typeof import("../auth/serviceIdentity")>(), requireDreamService: async () => ({ id: identity.service, backgroundScopes: ["reflections:execute"] }) }));
vi.mock("../auth/serviceAccessToken", () => ({ principalForServiceToken: async (_tx: unknown, _bearer: unknown, _service: unknown, scope: string) => ({ subject: "fixture-analysis-subject", canonical_user_id: identity.owner, client_id: "fixture-browser", scopes: [scope], status: "active" }) }));
import { POST } from "../../api/internal/dream/v1/operations/[operation]/route";
import { GET as receiptGet } from "../../api/internal/dream/v1/receipts/[requestId]/route";

const manifestPath = process.env.REFLECTION_CONTENT_PRIVATE_FIXTURE;
let check: pg.Client;
let serial = 0;
const invocationPrefix = `fixture-analysis-${randomBytes(6).toString("hex")}`;
beforeAll(async () => {
  if (!manifestPath) return;
  expect(manifestPath.startsWith("/private/tmp/ink-reflection-content-db-")).toBe(true);
  expect((await stat(manifestPath)).mode & 0o777).toBe(0o600);
  const fixture = JSON.parse(await readFile(manifestPath, "utf8"));
  check = new pg.Client({ connectionString: fixture.database_url }); await check.connect();
  const row = (await check.query("SELECT current_database() AS database, current_setting('port') AS port, current_setting('data_directory') AS directory, host(inet_server_addr()) AS host")).rows[0];
  expect(row).toEqual({ database: fixture.database, port: String(fixture.port), directory: fixture.data_directory, host: "127.0.0.1" });
  expect(row.database).toMatch(/^ink_codex_reflection_content_/);
  vi.stubEnv("DREAM_DATA_DATABASE_URL", fixture.database_url);
  vi.stubEnv("DREAM_DATA_MAX_BODY_BYTES", "1048576");
  vi.stubEnv("DREAM_REFLECTIONS_LAUNCH_SNAPSHOT_MAX_BYTES", "1048576");
  vi.stubEnv("DREAM_REFLECTIONS_WORKSPACE_ROOT", fixture.workspace_root);
  vi.stubEnv("AUTH_REFLECTIONS_AUTHORITY_TTL_SECONDS", "300");
  vi.stubEnv("AUTH_REFLECTIONS_AUTHORITY_MAX_TTL_SECONDS", "600");
  vi.stubEnv("AUTH_TOKEN_ENCRYPTION_KEY", randomBytes(32).toString("hex"));
});

it.skipIf(!manifestPath)("executes v2 scope creation, authorized lazy evidence, retry and report recovery through production routes", async () => {
  const input = { sections: ["echoes", "traits", "patterns"],
    input_snapshot: { session_ids: [], start_date: null, end_date: null, language: "en", language_label: "English" },
    analysis_content: { diary_session_ids: [], agent: { deck_id: "fixture-analysis-deck", agent_id: "fixture-analysis-agent" },
      notion: { connector_id: "11111111-1111-4111-8111-111111111111", snapshot_version: "fixture-v1" } } };
  const key = `${invocationPrefix}-scope-create`;
  const created = await invoke("reflection-task.v2.create-with-content", input, true, key);
  expect(created.status, created.error?.code).toBe(200);
  const task_id = created.data.task.task_id;
  expect(created.data.task.agent_contract_version).toBe("reflections-analysis-content-v2");
  expect((await invoke("reflection-task.v2.create-with-content", input, true, key)).data).toEqual(created.data);
  expect((await invoke("reflection-task.v2.create-with-content", { ...input, sections: ["echoes"] }, true, key)).status).toBe(409);
  const receipt = await receiptGet(new Request(`http://fixture.test/api/internal/dream/v1/receipts/${key}?operation=reflection-task.v2.create-with-content`, {
    headers: { authorization: "Bearer fixture-user", "x-ink-dream-service-authorization": "Bearer fixture-service" } }), { params: Promise.resolve({ requestId: key }) });
  expect(receipt.status).toBe(200);
  expect((await receipt.json()).data.result.task.task_id).toBe(task_id);
  const load = await invoke("reflection-task.v2.analysis-content-load", { task_id });
  expect(load.status, load.error?.code).toBe(200);
  expect(load.data.analysis_content.notion.pages).toEqual([]);
  expect(load.data.analysis_content.notion.snapshot.index.length).toBeGreaterThan(0);
  expect(load.data.analysis_content.agent.system_prompt).toBe("Use the selected observer perspective.");
  const initial = await invoke("reflection-task.v2.analysis-content", { task_id }, true);
  expect(initial.data.analysis_content.notion.pages).toEqual([]);
  expect(JSON.stringify(initial.data)).not.toContain("system_prompt");
  identity.owner = "7002";
  expect((await invoke("reflection-task.v2.analysis-content", { task_id }, true)).status).toBe(404);
  identity.owner = "7001"; identity.service = "other-service";
  expect((await invoke("reflection-task.v2.analysis-content-load", { task_id })).status).toBe(404);
  identity.service = "fixture-analysis-service";
  expect((await invoke("reflection-task.v2.analysis-content-load", { task_id }, true)).status).toBe(400);
  expect((await invoke("reflection-task.start", { task_id }, true)).status).toBe(200);
  const worker = await invoke("reflection-task.worker-load", { task_id });
  expect(worker.status).toBe(200);
  expect(worker.data.launch_snapshot.sessions).toEqual([]);
  let revision = worker.data.task.revision;
  for (const action of ["context-ready", "run-started"]) {
    const advanced = await invoke("reflection-task.advance", { task_id, action, expected_revision: revision });
    expect(advanced.status).toBe(200); revision = advanced.data.revision;
  }
  const markdown = "The same concern appeared twice in my learning diary.";
  const page = { page_id: "fixture-analysis-page", title: "Linked journal", url: "https://www.notion.so/fixture-analysis-page",
    markdown, content_sha256: createHash("sha256").update(markdown).digest("hex"), read_at: new Date().toISOString() };
  for (const section of input.sections) {
    const begun = await invoke("reflection-section.begin", { task_id, section, expected_revision: 1 });
    expect(begun.status, begun.error?.code).toBe(200);
    const binding = { task_id, section, thread_id: begun.data.thread_id, section_revision: begun.data.revision, page_id: page.page_id };
    expect((await invoke("reflection-task.v2.notion-context", { ...binding, thread_id: "foreign-thread" })).status).toBe(409);
    expect((await invoke("reflection-task.v2.notion-context", { ...binding, section_revision: begun.data.revision + 1 })).status).toBe(409);
    expect((await invoke("reflection-task.v2.notion-context", { ...binding, page_id: "outside-page" })).status).toBe(403);
    if (section === "echoes") {
      expect((await invoke("reflection-task.v2.notion-context", binding)).data.page).toBeNull();
      const invalid = await invoke("reflection-task.v2.notion-evidence", { ...binding, page: { ...page, content_sha256: "0".repeat(64) } });
      expect(invalid.status).toBe(400);
      expect((await invoke("reflection-task.v2.notion-context", binding)).data.page).toBeNull();
      const recorded = await invoke("reflection-task.v2.notion-evidence", { ...binding, page });
      expect(recorded.status, recorded.error?.code).toBe(200);
      expect(recorded.data.page).toEqual(page);
      const otherBody = "Later changed live content.";
      expect((await invoke("reflection-task.v2.notion-evidence", { ...binding, page: { ...page, markdown: otherBody,
        content_sha256: createHash("sha256").update(otherBody).digest("hex") } })).data.page).toEqual(page);
      await check.query("UPDATE resource_connectors SET auth_status='disconnected' WHERE id=$1", [input.analysis_content.notion.connector_id]);
      expect((await invoke("reflection-task.v2.notion-context", binding)).status).toBe(409);
      await check.query("UPDATE resource_connectors SET auth_status='authenticated' WHERE id=$1", [input.analysis_content.notion.connector_id]);
    }
    expect((await invoke("reflection-task.v2.notion-context", binding)).data.page).toEqual(page);
    const finished = await invoke("reflection-section.finish", section === "traits"
      ? { task_id, section, expected_revision: begun.data.revision, outcome: "failed", error_summary: "Injected provider-free section failure." }
      : { task_id, section, expected_revision: begun.data.revision, outcome: "completed", results: [{ title: "Learning pattern", description: "A repeated concern.",
          related_session_ids: [], evidence: `Linked journal; page_id=${page.page_id}; sha256=${page.content_sha256}`, confidence: "high" }] });
    expect(finished.status, finished.error?.code).toBe(200);
    expect((await invoke("reflection-task.v2.notion-context", binding)).status).toBe(409);
  }
  const terminal = await invoke("reflection-task.advance", { task_id, action: "finalize", expected_revision: revision, error_summary: null });
  expect(terminal.status).toBe(200); expect(terminal.data.status).toBe("PARTIAL_FAILED");
  const summary = await invoke("reflection-task.v2.analysis-content", { task_id }, true);
  expect(summary.data.analysis_content.notion.pages).toHaveLength(1);
  expect(summary.data.analysis_content.notion.pages[0].content_sha256).toBe(page.content_sha256);
  expect(JSON.stringify(summary.data)).not.toContain(markdown);
  const ensured = await invoke("reflection-report.ensure", { task_id });
  expect(ensured.status, ensured.error?.code).toBe(200); expect(ensured.data.created).toBe(true);
  expect((await invoke("reflection-report.ensure", { task_id })).data).toEqual({ ...ensured.data, created: false });
  const reports = await invoke("analysis-report.list", { limit: 10 }, true);
  const report = reports.data.reports.map((row: { report_data_json: string }) => JSON.parse(row.report_data_json)).find((row: { task_id: string }) => row.task_id === task_id);
  expect(report.analysis_content).toEqual(summary.data.analysis_content);
  expect(report.failed_sections).toEqual(["traits"]);
  expect((await invoke("reflection-task.get", { task_id }, true)).data.task.status).toBe("PARTIAL_FAILED");
  const reloaded = await invoke("reflection-task.v2.analysis-content-load", { task_id });
  expect(reloaded.data.analysis_content.notion.pages).toEqual([page]);
  expect((await check.query("SELECT count(*)::int AS count FROM analysis_reports WHERE reflection_task_id=$1", [task_id])).rows[0].count).toBe(1);
});
afterAll(async () => {
  await check?.end();
  const globals = globalThis as typeof globalThis & { __ink_dream_data_pool?: pg.Pool };
  await globals.__ink_dream_data_pool?.end(); delete globals.__ink_dream_data_pool;
  vi.unstubAllEnvs();
});
async function invoke(operation: string, input: unknown, user = false, requestId = `${invocationPrefix}-${++serial}`) {
  const request = new Request(`http://fixture.test/api/internal/dream/v1/operations/${operation}`, { method: "POST",
    headers: { "content-type": "application/json", authorization: user ? "Bearer fixture-user" : "Bearer fixture-service", ...(user ? { "x-ink-dream-service-authorization": "Bearer fixture-service" } : {}) },
    body: JSON.stringify({ request_id: requestId, input }) });
  const response = await POST(request, { params: Promise.resolve({ operation }) });
  const body = await response.json();
  if (response.status >= 400) console.log(JSON.stringify({ operation, status: response.status, error_code: body.error?.code }));
  return { status: response.status, ...body };
}

it.skipIf(!manifestPath)("persists an empty v2 page read and reloads the completed task without creating a report", async () => {
  const input = { sections: ["echoes"], input_snapshot: { session_ids: [], start_date: null, end_date: null, language: "en", language_label: "English" },
    analysis_content: { diary_session_ids: [], agent: null, notion: { connector_id: "11111111-1111-4111-8111-111111111111", snapshot_version: "fixture-v1" } } };
  const created = await invoke("reflection-task.v2.create-with-content", input, true);
  expect(created.status, created.error?.code).toBe(200);
  const task_id = created.data.task.task_id;
  expect((await invoke("reflection-task.start", { task_id }, true)).status).toBe(200);
  let revision = (await invoke("reflection-task.worker-load", { task_id })).data.task.revision;
  for (const action of ["context-ready", "run-started"]) {
    const advanced = await invoke("reflection-task.advance", { task_id, action, expected_revision: revision });
    expect(advanced.status).toBe(200); revision = advanced.data.revision;
  }
  const begun = await invoke("reflection-section.begin", { task_id, section: "echoes", expected_revision: 1 });
  expect(begun.status).toBe(200);
  const binding = { task_id, section: "echoes", thread_id: begun.data.thread_id, section_revision: begun.data.revision, page_id: "fixture-analysis-page" };
  const page = { page_id: binding.page_id, title: "Linked journal", url: "https://www.notion.so/fixture-analysis-page", markdown: "",
    content_sha256: createHash("sha256").update("").digest("hex"), read_at: new Date().toISOString() };
  expect((await invoke("reflection-task.v2.notion-evidence", { ...binding, page })).status).toBe(200);
  expect((await invoke("reflection-section.finish", { task_id, section: "echoes", expected_revision: begun.data.revision, outcome: "completed", results: [] })).status).toBe(200);
  const terminal = await invoke("reflection-task.advance", { task_id, action: "finalize", expected_revision: revision, error_summary: null });
  expect(terminal.data.status).toBe("COMPLETED");
  const ensured = await invoke("reflection-report.ensure", { task_id });
  expect(ensured.status).toBe(200);
  expect(ensured.data).toEqual({ report_id: null, report_type: null, created: false });
  const summary = await invoke("reflection-task.v2.analysis-content", { task_id }, true);
  expect(summary.data.analysis_content.notion.pages).toEqual([]);
  expect(summary.data.analysis_content.notion.empty_page_count).toBe(1);
  expect((await invoke("reflection-task.v2.analysis-content-load", { task_id })).data.analysis_content.notion.pages).toEqual([page]);
  const reports = await invoke("analysis-report.list", { limit: 10 }, true);
  const report = reports.data.reports.map((row: { report_data_json: string }) => JSON.parse(row.report_data_json)).find((row: { task_id: string }) => row.task_id === task_id);
  expect(report).toBeUndefined();
  expect((await invoke("reflection-task.get", { task_id }, true)).data.task.status).toBe("COMPLETED");
  expect((await check.query("SELECT count(*)::int AS count FROM analysis_reports WHERE reflection_task_id=$1", [task_id])).rows[0].count).toBe(0);
});

it.skipIf(!manifestPath)("creates once, freezes Notion-only/Agent input, executes sections and reloads exactly one partial report through public routes", async () => {
  const markdown = "I recorded the same worry on Monday and Friday.";
  const analysis_content = { diary_session_ids: [], agent: { deck_id: "fixture-analysis-deck", agent_id: "fixture-analysis-agent" },
    notion: { connector_id: "11111111-1111-4111-8111-111111111111", snapshot_version: "fixture-v1", empty_page_ids: [], pages: [{ page_id: "fixture-analysis-page", title: "Linked journal", url: "https://www.notion.so/fixture-analysis-page", markdown, content_sha256: createHash("sha256").update(markdown).digest("hex"), read_at: new Date().toISOString() }] } };
  const input = { sections: ["echoes", "traits", "patterns"], input_snapshot: { session_ids: [], start_date: null, end_date: null, language: "en", language_label: "English" }, analysis_content };
  const createKey = `fixture-create-${randomBytes(6).toString("hex")}`;
  const created = await invoke("reflection-task.create-with-content", input, true, createKey);
  expect(created.status, created.error?.code).toBe(200);
  const task_id = created.data.task.task_id;
  expect((await invoke("reflection-task.create-with-content", input, true, createKey)).data).toEqual(created.data);
  expect((await invoke("reflection-task.create-with-content", { ...input, sections: ["echoes"] }, true, createKey)).status).toBe(409);
  const original = await receiptGet(new Request(`http://fixture.test/api/internal/dream/v1/receipts/${createKey}?operation=reflection-task.create-with-content`, { headers: { authorization: "Bearer fixture-user", "x-ink-dream-service-authorization": "Bearer fixture-service" } }), { params: Promise.resolve({ requestId: createKey }) });
  expect(original.status).toBe(200); expect((await original.json()).data.result.task.task_id).toBe(task_id);
  const summary = await invoke("reflection-task.analysis-content", { task_id }, true);
  expect(summary.status).toBe(200); expect(summary.data.analysis_content.notion.pages[0].markdown).toBeUndefined();
  expect(summary.data.analysis_content.agent.system_prompt).toBeUndefined();
  const frozen = await invoke("reflection-task.analysis-content-load", { task_id });
  expect(frozen.status).toBe(200); expect(frozen.data.analysis_content.notion.pages[0].markdown).toBe(markdown);
  expect(frozen.data.analysis_content.agent.system_prompt).toBe("Use the selected observer perspective.");
  identity.owner = "7002"; expect((await invoke("reflection-task.analysis-content", { task_id }, true)).status).toBe(404); identity.owner = "7001";
  identity.service = "other-service"; expect((await invoke("reflection-task.analysis-content-load", { task_id })).status).toBe(404); identity.service = "fixture-analysis-service";
  expect((await invoke("reflection-task.start", { task_id }, true)).status).toBe(200);
  const load = await invoke("reflection-task.worker-load", { task_id }); expect(load.status).toBe(200);
  expect(load.data.launch_snapshot.sessions).toEqual([]); // Explicit [] never expands to all diary sessions.
  let revision = load.data.task.revision;
  for (const action of ["context-ready", "run-started"]) {
    const advanced = await invoke("reflection-task.advance", { task_id, action, expected_revision: revision }); expect(advanced.status).toBe(200); revision = advanced.data.revision;
  }
  for (const section of input.sections) {
    const begun = await invoke("reflection-section.begin", { task_id, section, expected_revision: 1 }); expect(begun.status).toBe(200);
    const finished = await invoke("reflection-section.finish", section === "traits"
      ? { task_id, section, expected_revision: begun.data.revision, outcome: "failed", error_summary: "Provider-free injected section failure." }
      : { task_id, section, expected_revision: begun.data.revision, outcome: "completed", results: [{ title: "Repeated worry", description: "The selected perspective connected two moments.", related_session_ids: [], evidence: "Linked journal (https://www.notion.so/fixture-analysis-page)", confidence: "high" }] });
    expect(finished.status).toBe(200);
  }
  const terminal = await invoke("reflection-task.advance", { task_id, action: "finalize", expected_revision: revision, error_summary: null });
  expect(terminal.status).toBe(200); expect(terminal.data.status).toBe("PARTIAL_FAILED");
  const ensured = await invoke("reflection-report.ensure", { task_id }); expect(ensured.status).toBe(200); expect(ensured.data.created).toBe(true);
  expect((await invoke("reflection-report.ensure", { task_id })).data).toEqual({ ...ensured.data, created: false });
  const reports = await invoke("analysis-report.list", { limit: 10 }, true); expect(reports.status).toBe(200);
  const report = reports.data.reports.map((row: { report_data_json: string }) => JSON.parse(row.report_data_json)).find((item: { task_id: string }) => item.task_id === task_id);
  expect(report.task_id).toBe(task_id); expect(report.failed_sections).toEqual(["traits"]);
  expect(report.echoes[0].related_session_ids).toEqual([]); expect(report.analysis_content).toEqual(summary.data.analysis_content);
  expect(JSON.stringify(report)).not.toContain(markdown); expect(JSON.stringify(report)).not.toContain("Use the selected observer perspective.");
  expect((await invoke("reflection-task.get", { task_id }, true)).data.task.status).toBe("PARTIAL_FAILED");
  expect((await check.query("SELECT count(*)::int AS count FROM reflection_task WHERE id=$1", [task_id])).rows[0].count).toBe(1);
  expect((await check.query("SELECT count(*)::int AS count FROM analysis_reports WHERE reflection_task_id=$1", [task_id])).rows[0].count).toBe(1);
});
