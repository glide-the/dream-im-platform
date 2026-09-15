// [Input] Frozen Registry133 prefix, live Registry134-147 DTOs, capabilities and production POST route.
// [Output] Append hash, requirements, generated inventory and dispatch assertions.
// [Pos] Registration gate for the complete managed-MCP persistence domain.
// [Sync] 2026-09-16: append fourteen operations without changing Registry133 bytes.
import { beforeEach, expect, it, vi } from "vitest";
import { createHash } from "node:crypto";

const names = new Set([
  "managed-mcp.servers.list", "managed-mcp.server.get", "managed-mcp.server.create",
  "managed-mcp.server.update", "managed-mcp.server.delete", "managed-mcp.app-settings.get",
  "managed-mcp.app-settings.update", "managed-mcp.credential.get", "managed-mcp.credential.upsert",
  "managed-mcp.credential.delete", "managed-mcp.discovery.get", "managed-mcp.discovery.save",
  "managed-mcp.import-receipt.get", "managed-mcp.import",
]);
const mocks = vi.hoisted(() => ({ handler: vi.fn() }));
vi.mock("./managedMcpHandler", () => ({
  isManagedMcpOperation: (value: string) => names.has(value),
  handleManagedMcp: mocks.handler,
}));

import generated147 from "../../../docs/architecture/admin-dream-operation-contracts.json";
import { POST } from "../../api/internal/dream/v1/operations/[operation]/route";
import { canonicalContractJson, dreamOperations } from "./operationRegistry";
import { managedMcpOperationContracts } from "./managedMcpDto";
import { managedMcpSchemaRequirements } from "./managedMcpService";
import { identitySchemaRequirement } from "./schemaRequirements";

beforeEach(() => vi.resetAllMocks());

it("preserves Registry133 and appends exactly fourteen Registry134-147 operations", () => {
  expect(dreamOperations).toHaveLength(147);
  expect(generated147).toEqual(dreamOperations);
  expect(createHash("sha256").update(canonicalContractJson(dreamOperations.slice(0, 133))).digest("hex"))
    .toBe("951a3ee9d26354d0094dafec6233a13638a430672ddacd730cefc95f654b5ec3");
  expect(createHash("sha256").update(canonicalContractJson(dreamOperations)).digest("hex"))
    .toBe("73a50db695af5170765f8473179b8a8dacd817c5c457161d75bec5b97c1e32f1");
  expect(dreamOperations.slice(133).map(operation => operation.contract.name)).toEqual([...names]);
  for (const operation of dreamOperations.slice(133)) {
    expect(operation.requirements).toEqual([identitySchemaRequirement, ...managedMcpSchemaRequirements]);
  }
});

it("production POST dispatches each managed-MCP operation through one handler", async () => {
  for (const name of names) {
    const request = new Request(`http://localhost/api/internal/dream/v1/operations/${name}`, { method: "POST" });
    const response = new Response(name);
    mocks.handler.mockResolvedValueOnce(response);
    expect(await POST(request, { params: Promise.resolve({ operation: name }) })).toBe(response);
    expect(mocks.handler).toHaveBeenLastCalledWith(request, name);
  }
  expect(mocks.handler).toHaveBeenCalledTimes(names.size);
});

it("publishes only strict read/write DTO contracts with user scopes", () => {
  expect(Object.keys(managedMcpOperationContracts)).toEqual([...names]);
  for (const operation of Object.values(managedMcpOperationContracts)) {
    expect(operation.userScope).toBe(operation.kind === "read" ? "dream:read" : "dream:write");
  }
});
