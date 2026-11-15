// [Input] Injected production capability ledger/connection and an explicitly authenticated service.
// [Output] Special Runtime routes advertised only with all exact schema requirements; hashes stay strict.
// [Pos] Provider-free readiness tests; no source-presence or generic-route substitutes.
// [Sync] 2026-11-16: exercise production batch selection, ordered legacy parity, separate ledgers and request-local freshness.
import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ missing: "", physical: [] as unknown[], rows: [] as { capability: string; version: number; contractSha256: string }[], query: vi.fn() }));
vi.mock("./database", () => ({ withAuthTransaction: async (action: (tx: unknown) => unknown) => action({ select: () => ({ from: async () => mocks.physical }) }) }));
vi.mock("../dream/database", async original => ({ ...await original<typeof import("../dream/database")>(), dreamDataDatabase: () => ({ select: () => ({ from: () => ({ where: mocks.query }) }) }) }));
vi.mock("./internalHandler", () => ({ handleInternalAuthRequest: async (_request: Request, action: (service: unknown) => unknown) => Response.json({ data: await action({ oauthClientId: "browser", backgroundScopes: ["capabilities:read"] }) }) }));
vi.mock("./config", async original => ({ ...await original<typeof import("./config")>(), authConfiguration: () => ({ issuer: "https://admin.example/api/auth", resource: "https://dream.example/api" }), requiredAuthValue: () => "device" }));
import { PgDialect } from "drizzle-orm/pg-core";
import { dreamOperations } from "../dream/operationRegistry";
import { handleCapabilities } from "./capabilitiesHandler";
import { delegationContracts, delegationDiscoverySchemaRequirements } from "./delegationContracts";
const request = new Request("https://admin.example/api/internal/dream/v1/capabilities");
const requirements = [...dreamOperations.flatMap(operation => operation.requirements), ...delegationDiscoverySchemaRequirements];
beforeEach(() => {
  mocks.rows = [...new Map(requirements.map(required => [required.capability, { ...required }])).values()];
  mocks.query.mockReset().mockImplementation(async () => mocks.rows.filter(row => row.capability !== mocks.missing));
  mocks.missing = ""; mocks.physical = delegationDiscoverySchemaRequirements.map(item => ({ capability: item.capability, version: item.version, contract_sha256: item.contractSha256 })); });
describe("special Runtime capability discovery", () => {
  it("gates Workflow start on exact local placement while retaining independent reads and reducing commands", async () => {
    mocks.missing = "dream.runtime.local-placement.v1";
    const names = (await (await handleCapabilities(request)).json()).data.operations.map(item => item.name);
    expect(names).not.toContain("workflow-run.start");
    for (const name of ["workflow-run.read", "workflow-run.history", "workflow-run.fail", "workflow-run.cancel"]) expect(names).toContain(name);
  });
  it("publishes exact four special routes and preserves the physical receipts", async () => {
    const result = (await (await handleCapabilities(request)).json()).data;
    expect(result.auth.delegations).toEqual(delegationContracts.map(item => item.capability));
    expect(result.schema_capabilities).toEqual(mocks.physical);
    expect(result.operations.some(item => item.name.startsWith("runtime-delegation."))).toBe(false);
  });
  it.each(delegationDiscoverySchemaRequirements.map(item => item.capability))("hides special routes when %s is absent or mismatched", async missing => {
    mocks.missing = missing;
    expect((await (await handleCapabilities(request)).json()).data.auth.delegations).toEqual([]);
  });
});

describe("request-local batched data discovery", () => {
  it("keeps the complete legacy catalog and order while reading the data ledger once", async () => {
    const result = (await (await handleCapabilities(request)).json()).data;
    expect(result.operations).toEqual(dreamOperations.map(operation => operation.capability));
    expect(result.operations).toHaveLength(301);
    expect(mocks.query).toHaveBeenCalledTimes(1);
    const names = new PgDialect().sqlToQuery(mocks.query.mock.calls[0][0]).params;
    expect(names).toEqual([...new Set(requirements.map(required => required.capability))]);
    expect(names).toHaveLength(34);
  });
  it.each(["missing", "version", "hash"])("matches legacy exact comparisons for every %s requirement", async mode => {
    for (const required of new Map(requirements.map(item => [item.capability, item])).values()) {
      const original = mocks.rows;
      mocks.rows = original.flatMap(row => row.capability !== required.capability ? [row] : mode === "missing" ? [] : [{ ...row, ...(mode === "version" ? { version: row.version + 1 } : { contractSha256: "0".repeat(64) }) }]);
      const matches = (item: typeof required) => mocks.rows.some(row => row.capability === item.capability && row.version === item.version && row.contractSha256 === item.contractSha256);
      const result = (await (await handleCapabilities(request)).json()).data;
      expect(result.operations).toEqual(dreamOperations.filter(operation => operation.requirements.every(matches)).map(operation => operation.capability));
      expect(result.auth.delegations).toEqual(delegationDiscoverySchemaRequirements.every(matches) ? delegationContracts.map(item => item.capability) : []);
      expect(result.schema_capabilities).toEqual(mocks.physical);
      mocks.rows = original;
    }
  });
  it("uses actual data facts even when the auth ledger is fully populated, and reloads next request", async () => {
    mocks.physical = requirements.map(item => ({ capability: item.capability, version: item.version, contract_sha256: item.contractSha256 }));
    const rows = mocks.rows;
    mocks.rows = [];
    const empty = (await (await handleCapabilities(request)).json()).data;
    expect(empty.operations).toEqual([]);
    expect(empty.auth.delegations).toEqual([]);
    expect(empty.schema_capabilities).toEqual(mocks.physical);
    mocks.rows = rows;
    expect((await (await handleCapabilities(request)).json()).data.operations).toHaveLength(dreamOperations.length);
    expect(mocks.query).toHaveBeenCalledTimes(2);
  });
  it("rejects data query failure instead of publishing auth-ledger availability", async () => {
    const failure = new Error("data ledger unavailable");
    mocks.query.mockRejectedValueOnce(failure);
    await expect(handleCapabilities(request)).rejects.toBe(failure);
  });
});
