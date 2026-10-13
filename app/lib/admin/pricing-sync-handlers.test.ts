// [Input] Authenticated request DTOs, fake catalog HTTP and controlled PostgreSQL boundary responses.
// [Output] Current discovery/apply handler proof without calling a model or a normal database.
// [Pos] Provider-free unit boundary; isolated E2E separately proves SQL and persistence.
// [Sync] 2026-10-10: cover scoped Image discovery, upstream errors, safe writes and missing platform prices.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ query: vi.fn(), identity: vi.fn(), origin: vi.fn(), audit: vi.fn(), capability: vi.fn() }));
vi.mock("../platform-db", () => ({
  PlatformSchemaNotReadyError: class extends Error {},
  withPlatformClient: async (fn: (client: { query: typeof mocks.query }) => unknown) => await fn({ query: mocks.query }),
  withPlatformTransaction: async (fn: (client: { query: typeof mocks.query }) => unknown) => await fn({ query: mocks.query }),
}));
vi.mock("./guard", () => ({ adminRequestId: () => "pricing-sync-unit", assertAdminMutationOrigin: mocks.origin, requireAdminRequest: mocks.identity }));
vi.mock("./audit", () => ({ recordAdminAuditOnClient: mocks.audit }));
vi.mock("../db/image-api-capability", () => ({ imageApiCapabilityAvailable: mocks.capability }));

import { AdminError } from "./errors";
import { flattenModelsDevCatalog, handlePricingSyncApply, handlePricingSyncCreate, matchModelsDevPricing } from "./pricing-sync";

const local = { id: "m1", code: "image-alias", upstream_model: "image-model", provider_code: "openai", provider_name: "OpenAI", requires_image_input: true, image_input_price: "4000000" };
const catalog = { openai: { models: { "image-model": { cost: { input: 2.5, output: 15 }, modalities: { output: ["image"] } } } } };
const matches = matchModelsDevPricing([local], flattenModelsDevCatalog(catalog, true), true);
const current = { id: "price-old", effective_from: "2020-01-01T00:00:00Z", input_price_microusd_per_million: "1000000", output_price_microusd_per_million: "7000000", cache_read_price_microusd_per_million: "0", cache_write_price_microusd_per_million: "0", image_input_price_microusd_per_million: "4000000", image_output_price_microusd_per_million: "12000000" };
function request(body: unknown) {
  return new Request("https://admin.test/api/admin/pricing-sync", { method: "POST", headers: { origin: "https://admin.test", "content-type": "application/json" }, body: JSON.stringify(body) });
}
function database(existing: Record<string, unknown> | undefined = current) {
  mocks.query.mockImplementation(async (sql: string) => {
    if (sql.includes("SELECT m.id")) return { rows: [local] };
    if (sql.includes("FROM ai_pricing_sync_snapshots")) return { rows: [{ id: "snapshot", status: "ready", expires_at: new Date(Date.now() + 60_000), matches, catalog_version: "v1", catalog_hash: "hash" }] };
    if (sql.includes("SELECT * FROM ai_pricing_rules")) return { rows: existing ? [existing] : [] };
    if (sql.includes("SELECT capabilities")) return { rows: [{ capabilities: { image_edit: true } }] };
    if (sql.includes("SELECT 1 FROM ai_pricing_rules")) return { rows: [] };
    return { rows: [{ expires_at: new Date(Date.now() + 60_000), created_at: new Date() }] };
  });
}
describe("Image models.dev handler boundaries", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.identity.mockResolvedValue({ id: "admin-unit" });
    mocks.capability.mockResolvedValue(true);
    database();
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json(catalog)));
  });
  afterEach(() => vi.unstubAllGlobals());

  it("discovers scoped Image candidates with server permission, origin and immutable snapshot", async () => {
    const response = await handlePricingSyncCreate(request({ imageOnly: true, force: true }));
    expect(response.status).toBe(200);
    expect(mocks.identity).toHaveBeenCalledWith(expect.any(Request), "pricing.write");
    expect(mocks.origin).toHaveBeenCalledOnce();
    expect((await response.json()).data.matches).toMatchObject([{ kind: "image", imageOutputMicrousd: "15000000", imageInputMicrousd: "4000000" }]);
    const insert = mocks.query.mock.calls.find(([sql]) => sql.includes("INSERT INTO ai_pricing_sync_snapshots"));
    expect(JSON.parse(insert?.[1][5])).toMatchObject([{ kind: "image" }]);
    expect(mocks.audit).toHaveBeenCalledOnce();
  });
  it("fails safely on unavailable catalog and does not persist a success", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("upstream private content", { status: 503 })));
    const response = await handlePricingSyncCreate(request({ imageOnly: true, force: true }));
    expect(response.status).toBe(502);
    const body = await response.json();
    expect(body.error.code).toBe("MODELS_DEV_FETCH_FAILED");
    expect(JSON.stringify(body)).not.toContain("upstream private content");
    expect(mocks.query.mock.calls.some(([sql]) => sql.includes("INSERT INTO"))).toBe(false);
  });
  it("rejects invalid scope DTO and denied permission before catalog fetch", async () => {
    expect((await handlePricingSyncCreate(request({ imageOnly: "true" }))).status).toBe(400);
    expect(fetch).not.toHaveBeenCalled();
    mocks.identity.mockRejectedValueOnce(new AdminError("ADMIN_PERMISSION_DENIED", "denied", 403));
    expect((await handlePricingSyncCreate(request({ imageOnly: true }))).status).toBe(403);
    expect(fetch).not.toHaveBeenCalled();
  });
  it("applies Image references without rewriting text dimensions or mutating snapshot", async () => {
    const before = JSON.stringify(matches);
    const response = await handlePricingSyncApply(request({ modelIds: ["m1"], imageInputPrices: [{ localModelId: "m1", microusd: 0 }] }), "snapshot");
    expect(response.status).toBe(200);
    const insert = mocks.query.mock.calls.find(([sql]) => sql.includes("INSERT INTO ai_pricing_rules"));
    expect(insert?.[1].slice(2, 6)).toEqual(["2500000", "7000000", "0", "0"]);
    expect(insert?.[1].slice(12, 14)).toEqual(["0", "15000000"]);
    expect(JSON.parse(insert?.[1][10])).toMatchObject({ kind: "image", referenceOnly: true, imageInputSource: "platform_configured" });
    expect(JSON.stringify(matches)).toBe(before);
  });
  it("does not end the old version or insert an active edit price with missing image-input price", async () => {
    mocks.query.mockImplementation(async (sql: string) => {
      if (sql.includes("SELECT m.id")) return { rows: [local] };
      if (sql.includes("FROM ai_pricing_sync_snapshots")) return { rows: [{ status: "ready", expires_at: new Date(Date.now() + 60_000), matches }] };
      if (sql.includes("SELECT capabilities")) return { rows: [{ capabilities: { image_edit: true } }] };
      return { rows: [] };
    });
    const response = await handlePricingSyncApply(request({ modelIds: ["m1"] }), "snapshot");
    expect(response.status).toBe(400);
    expect((await response.json()).error.code).toBe("IMAGE_INPUT_PRICING_REQUIRED");
    expect(mocks.query.mock.calls.some(([sql]) => sql.includes("UPDATE ai_pricing_rules") || sql.includes("INSERT INTO ai_pricing_rules"))).toBe(false);
  });
  it("rejects cross-model and duplicated platform prices before writes", async () => {
    for (const imageInputPrices of [[{ localModelId: "outside", microusd: 0 }], [{ localModelId: "m1", microusd: 0 }, { localModelId: "m1", microusd: 1 }]]) {
      expect((await handlePricingSyncApply(request({ modelIds: ["m1"], imageInputPrices }), "snapshot")).status).toBe(409);
    }
    expect(mocks.query.mock.calls.some(([sql]) => sql.includes("INSERT INTO ai_pricing_rules"))).toBe(false);
  });
  it("keeps text Apply available before the Image schema capability is installed", async () => {
    mocks.capability.mockResolvedValue(false);
    const textMatches = matchModelsDevPricing([{ ...local, upstream_model: "text-model" }], flattenModelsDevCatalog({ openai: { models: { "text-model": { cost: { input: 2, output: 8 }, modalities: { output: ["text"] } } } } }));
    mocks.query.mockImplementation(async (sql: string) => {
      if (sql.includes("FROM ai_pricing_sync_snapshots")) return { rows: [{ status: "ready", expires_at: new Date(Date.now() + 60_000), matches: textMatches }] };
      return { rows: [] };
    });
    expect((await handlePricingSyncApply(request({ modelIds: ["m1"] }), "snapshot")).status).toBe(200);
    const insert = mocks.query.mock.calls.find(([sql]) => sql.includes("INSERT INTO ai_pricing_rules"));
    expect(insert?.[0]).not.toContain("image_input_price_microusd_per_million");
    expect(insert?.[1]).toHaveLength(12);
  });
  it("rejects overlapping or duplicate open windows before inserting a version", async () => {
    for (const duplicate of [false, true]) {
      database();
      const base = mocks.query.getMockImplementation()!;
      mocks.query.mockImplementation(async (sql: string, values: unknown[]) => {
        if (duplicate && sql.includes("SELECT * FROM ai_pricing_rules")) return { rows: [current, { ...current, id: "duplicate-open" }] };
        if (!duplicate && sql.includes("SELECT 1 FROM ai_pricing_rules")) return { rows: [{ exists: 1 }] };
        return await base(sql, values);
      });
      const response = await handlePricingSyncApply(request({ modelIds: ["m1"] }), "snapshot");
      expect(response.status).toBe(409);
      expect((await response.json()).error.code).toBe(duplicate ? "PRICING_CURRENT_VERSION_AMBIGUOUS" : "PRICING_WINDOW_CONFLICT");
    }
    expect(mocks.query.mock.calls.some(([sql]) => sql.includes("INSERT INTO ai_pricing_rules"))).toBe(false);
  });
  it("locks batch model scopes in server order regardless of submitted order", async () => {
    const second = { ...local, id: "m2", code: "second-image" };
    const batch = matchModelsDevPricing([local, second], flattenModelsDevCatalog(catalog, true), true);
    database();
    const base = mocks.query.getMockImplementation()!;
    mocks.query.mockImplementation(async (sql: string, values: unknown[]) => {
      if (sql.includes("FROM ai_pricing_sync_snapshots")) return { rows: [{ status: "ready", expires_at: new Date(Date.now() + 60_000), matches: batch }] };
      if (sql.includes("SELECT m.id")) return { rows: [values[1] === "m2" ? second : local] };
      return await base(sql, values);
    });
    expect((await handlePricingSyncApply(request({ modelIds: ["m2", "m1"] }), "snapshot")).status).toBe(200);
    expect(mocks.query.mock.calls.filter(([sql]) => sql.includes("pg_advisory_xact_lock")).map(([, values]) => values[0])).toEqual(["m1:default", "m2:default"]);
  });
});
