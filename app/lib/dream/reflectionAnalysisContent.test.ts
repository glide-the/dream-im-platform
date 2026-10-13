// [Input] Additive content DTOs, existing owner repositories and frozen Registry99 contracts.
// [Output] Exact source/Agent validation, private/public separation and compatibility assertions.
// [Pos] Provider-free technical unit gate; no PostgreSQL, model or credential access.
// [Sync] 2026-10-13: reject drift, missing ownership, forged prompts and mismatched diary selections.
import { createHash } from "node:crypto";
import { beforeEach, expect, it, vi } from "vitest";
import { reflectionAnalysisCreateDto, reflectionAnalysisSummary, reflectionAnalysisSnapshotDto } from "./reflectionAnalysisContentDto";
import { validateReflectionAnalysisSelection } from "./reflectionAnalysisContentService";
import type { DataTransaction } from "./database";
import { dreamOperations } from "./operationRegistry";
import candidate from "../../../docs/architecture/admin-dream-reflection-task-operation-candidate.json";

const mocks = vi.hoisted(() => ({ deck: vi.fn(), connector: vi.fn(), snapshot: vi.fn() }));
vi.mock("./deckChatContextRepository", () => ({ DeckChatContextRepository: class { resolve = mocks.deck; } }));
vi.mock("./notionConnectorRepository", () => ({ NotionConnectorRepository: class { requireConnector = mocks.connector; snapshot = mocks.snapshot; } }));
const text = "Repeated worries on Monday and Friday.";
const page = { page_id: "page-fixture", title: "Weekly notes", url: "https://www.notion.so/fixture", markdown: text,
  content_sha256: createHash("sha256").update(text).digest("hex"), read_at: "2026-10-13T03:00:00Z" };
const input = () => ({ diary_session_ids: null, agent: { deck_id: "deck-fixture", agent_id: "agent-fixture" },
  notion: { connector_id: "connector-fixture", snapshot_version: "snapshot-fixture", pages: [page], empty_page_ids: [] } });
const tx = {} as DataTransaction;
beforeEach(() => {
  vi.resetAllMocks();
  mocks.deck.mockResolvedValue({ deck: { enabled: true, name: "Review" }, voices: [{ id: "agent-fixture", name: "Analyst", enabled: true, system_prompt: "Server-owned analysis instructions" }] });
  mocks.connector.mockResolvedValue({ id: "connector-fixture", auth_status: "authenticated", current_snapshot_version: "snapshot-fixture",
    sources: [{ resource_type: "notion_page", external_id: "page-fixture" }] });
  mocks.snapshot.mockResolvedValue({ index: [{ page_id: page.page_id, title: page.title, url: page.url }],
    connector: { selected_pages: [page.page_id], selected_databases: [] } });
});

it("resolves actual enabled Agent instructions and publishes only source metadata", async () => {
  const snapshot = await validateReflectionAnalysisSelection(input(), "7", tx);
  expect(snapshot.agent?.system_prompt).toBe("Server-owned analysis instructions");
  expect(snapshot.notion?.pages[0].markdown).toBe(text);
  const summary = reflectionAnalysisSummary(snapshot);
  expect(JSON.stringify(summary)).not.toContain(text);
  expect(JSON.stringify(summary)).not.toContain("system_prompt");
  expect(summary.agent?.agent_id).toBe("agent-fixture");
  expect(summary.notion?.pages[0].content_sha256).toBe(page.content_sha256);
});

it("excludes indexed archived pages from the required Notion analysis scope", async () => {
  mocks.snapshot.mockResolvedValue({ index: [{ page_id: page.page_id, title: page.title, url: page.url },
    { page_id: "archived-page", title: "Old journal", url: "", archived: true }],
    connector: { selected_pages: [page.page_id], selected_databases: [] } });
  expect((await validateReflectionAnalysisSelection(input(), "7", tx)).notion?.pages).toHaveLength(1);
});

it("rejects disabled, missing, wrong-Deck and inaccessible Agent choices", async () => {
  for (const state of [
    { deck: { enabled: false }, voices: [{ id: "agent-fixture", enabled: true }] },
    { deck: { enabled: true }, voices: [] },
    { deck: { enabled: true }, voices: [{ id: "other-agent", enabled: true }] },
    { deck: { enabled: true }, voices: [{ id: "agent-fixture", enabled: false }] },
  ]) {
    mocks.deck.mockResolvedValue(state);
    await expect(validateReflectionAnalysisSelection(input(), "7", tx)).rejects.toMatchObject({ code: "REFLECTION_AGENT_UNAVAILABLE" });
  }
  mocks.deck.mockRejectedValue(new Error("owned Deck required"));
  await expect(validateReflectionAnalysisSelection(input(), "7", tx)).rejects.toThrow("owned Deck required");
});

it("rejects authorization, version and current mount changes without reducing scope", async () => {
  mocks.connector.mockResolvedValue({ auth_status: "expired" });
  await expect(validateReflectionAnalysisSelection(input(), "7", tx)).rejects.toMatchObject({ code: "NOTION_AUTH_REQUIRED" });
  mocks.connector.mockResolvedValue({ auth_status: "authenticated", current_snapshot_version: "other" });
  await expect(validateReflectionAnalysisSelection(input(), "7", tx)).rejects.toMatchObject({ code: "NOTION_SNAPSHOT_CHANGED" });
  mocks.connector.mockResolvedValue({ id: "connector-fixture", auth_status: "authenticated", current_snapshot_version: "snapshot-fixture", sources: [] });
  await expect(validateReflectionAnalysisSelection(input(), "7", tx)).rejects.toMatchObject({ code: "NOTION_ANALYSIS_SCOPE_CHANGED" });
});

it("rejects missing snapshots, unknown pages, incomplete scope and changed body digests", async () => {
  mocks.snapshot.mockResolvedValue(null);
  await expect(validateReflectionAnalysisSelection(input(), "7", tx)).rejects.toMatchObject({ code: "NOTION_SNAPSHOT_UNAVAILABLE" });
  mocks.snapshot.mockResolvedValue({ index: [{ page_id: page.page_id, title: page.title, url: page.url }], connector: { selected_pages: [page.page_id], selected_databases: [] } });
  await expect(validateReflectionAnalysisSelection({ ...input(), notion: { ...input().notion, pages: [] } }, "7", tx)).rejects.toMatchObject({ code: "NOTION_ANALYSIS_SCOPE_CHANGED" });
  await expect(validateReflectionAnalysisSelection({ ...input(), notion: { ...input().notion, pages: [{ ...page, page_id: "other" }] } }, "7", tx)).rejects.toMatchObject({ code: "NOTION_ANALYSIS_SCOPE_CHANGED" });
  await expect(validateReflectionAnalysisSelection({ ...input(), notion: { ...input().notion, pages: [{ ...page, markdown: "changed" }] } }, "7", tx)).rejects.toMatchObject({ code: "NOTION_ANALYSIS_INPUT_INVALID" });
});

it("preserves explicit empty diary selection and rejects raw prompt, owner, path and duplicate pages", () => {
  const raw = { sections: ["echoes"], input_snapshot: { session_ids: [], start_date: null, end_date: null, language: "en", language_label: "English" },
    analysis_content: { ...input(), diary_session_ids: [] } };
  expect(reflectionAnalysisCreateDto.parse(raw).analysis_content.diary_session_ids).toEqual([]);
  expect(reflectionAnalysisCreateDto.safeParse({ ...raw, analysis_content: { ...raw.analysis_content, diary_session_ids: ["session-other"] } }).success).toBe(false);
  expect(reflectionAnalysisCreateDto.safeParse({ ...raw, analysis_content: { ...raw.analysis_content, agent: { ...raw.analysis_content.agent, system_prompt: "browser override" } } }).success).toBe(false);
  for (const key of ["user_id", "thread_id", "workspace_path", "model", "runtime_env"]) expect(reflectionAnalysisCreateDto.safeParse({ ...raw, [key]: "forbidden" }).success).toBe(false);
  expect(reflectionAnalysisSnapshotDto.safeParse({ ...input(), agent: null, notion: { ...input().notion, pages: [page, page] } }).success).toBe(false);
});

it("appends only three operations and preserves all sixteen original descriptors", () => {
  for (const original of candidate.operations) {
    const registered = dreamOperations.find(operation => operation.capability.name === original.name);
    expect(registered?.capability.contract_sha256).toBe(original.contract_sha256);
  }
  const added = dreamOperations.filter(operation => operation.capability.name === "reflection-task.create-with-content" || operation.capability.name.startsWith("reflection-task.analysis-content"));
  expect(added.map(operation => operation.capability.name)).toEqual(["reflection-task.create-with-content", "reflection-task.analysis-content", "reflection-task.analysis-content-load"]);
  expect(added[2].capability.user_scope).toBeNull();
  expect(added[2].capability.background_scope).toBe("reflections:execute");
  expect(added.every(operation => operation.requirements.some(required => required.capability === "dream.reflection-analysis-content.v1"))).toBe(true);
});
