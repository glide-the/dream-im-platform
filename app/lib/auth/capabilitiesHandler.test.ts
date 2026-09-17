// [Input] Injected production capability ledger/connection and an explicitly authenticated service.
// [Output] Special Runtime routes advertised only with all exact schema requirements; hashes stay strict.
// [Pos] Provider-free readiness tests; no source-presence or generic-route substitutes.
import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ missing: "", physical: [] as unknown[] }));
vi.mock("./database", () => ({ withAuthTransaction: async (action: (tx: unknown) => unknown) => action({ select: () => ({ from: async () => mocks.physical }) }) }));
vi.mock("../dream/database", () => ({ dreamDataDatabase: () => ({}), hasSchemaCapability: async (_db: unknown, required: { capability: string }) => required.capability !== mocks.missing }));
vi.mock("./internalHandler", () => ({ handleInternalAuthRequest: async (_request: Request, action: (service: unknown) => unknown) => Response.json({ data: await action({ oauthClientId: "browser", backgroundScopes: ["capabilities:read"] }) }) }));
vi.mock("./config", async original => ({ ...await original<typeof import("./config")>(), authConfiguration: () => ({ issuer: "https://admin.example/api/auth", resource: "https://dream.example/api" }), requiredAuthValue: () => "device" }));
import { handleCapabilities } from "./capabilitiesHandler";
import { delegationContracts, delegationDiscoverySchemaRequirements } from "./delegationContracts";
const request = new Request("https://admin.example/api/internal/dream/v1/capabilities");
beforeEach(() => { mocks.missing = ""; mocks.physical = delegationDiscoverySchemaRequirements.map(item => ({ capability: item.capability, version: item.version, contract_sha256: item.contractSha256 })); });
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
