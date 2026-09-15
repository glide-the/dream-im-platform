// [Input] Registry134-147 managed-MCP DTOs, actor authority and mocked typed Repository.
// [Output] Closed command surface, endpoint constraints, scope binding and dispatch evidence.
// [Pos] Provider-free domain contract test; SQL, actor selection and plaintext secrets stay unavailable.
// [Sync] 2026-09-16: verify the complete Admin-owned managed-MCP persistence boundary.
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  listServers: vi.fn(),
  server: vi.fn(),
  createServer: vi.fn(),
  updateServer: vi.fn(),
  deleteServer: vi.fn(),
  appSettings: vi.fn(),
  updateAppSettings: vi.fn(),
  credential: vi.fn(),
  upsertCredential: vi.fn(),
  deleteCredential: vi.fn(),
  discovery: vi.fn(),
  saveDiscovery: vi.fn(),
  importReceipt: vi.fn(),
  importServer: vi.fn(),
  construct: vi.fn(),
}));
vi.mock("./managedMcpRepository", () => ({
  ManagedMcpRepository: class {
    constructor(...args: unknown[]) { mocks.construct(...args); }
    listServers = mocks.listServers;
    server = mocks.server;
    createServer = mocks.createServer;
    updateServer = mocks.updateServer;
    deleteServer = mocks.deleteServer;
    appSettings = mocks.appSettings;
    updateAppSettings = mocks.updateAppSettings;
    credential = mocks.credential;
    upsertCredential = mocks.upsertCredential;
    deleteCredential = mocks.deleteCredential;
    discovery = mocks.discovery;
    saveDiscovery = mocks.saveDiscovery;
    importReceipt = mocks.importReceipt;
    importServer = mocks.importServer;
  },
}));

import {
  managedMcpImportInputDto,
  managedMcpOperationContracts,
  managedMcpServerCreateDto,
} from "./managedMcpDto";
import { runManagedMcpOperation } from "./managedMcpService";
import type { DataTransaction } from "./database";

const tx = { marker: "tx" } as unknown as DataTransaction;
const principal = {
  subject: "subject",
  canonical_user_id: "9007199254740993",
  client_id: "dream",
  scopes: ["dream:read", "dream:write"],
  status: "active" as const,
};
const oauthActor = { principal, threadScope: null, runScope: null, delegationPurpose: null } as const;
const authority = { thread_id: "thread-1", workflow_run_id: `run_${"a".repeat(32)}` };
const delegatedActor = {
  principal,
  threadScope: authority.thread_id,
  runScope: authority.workflow_run_id,
  delegationPurpose: "server-persistence" as const,
};
const serverId = "00000000-0000-4000-8000-000000000001";
const server = {
  id: serverId,
  user_id: principal.canonical_user_id,
  workspace_id: null,
  scope: "user" as const,
  server_key: "example",
  display_name: "Example",
  transport: "streamable_http" as const,
  remote_url: "https://mcp.example.test/connect",
  stdio_profile_key: null,
  auth_kind: "oauth" as const,
  enabled: true,
  config_revision: 1,
  credential_revision: 0,
  credential_id: null,
  credential_configured: false,
  created_at: "2026-09-16T00:00:00.000Z",
  updated_at: "2026-09-16T00:00:00.000Z",
};
const createInput = {
  authority: null,
  workspace_id: null,
  server_key: "example",
  display_name: "Example",
  transport: "streamable_http" as const,
  auth_kind: "oauth" as const,
  scope: "user" as const,
  remote_url: "https://mcp.example.test/connect",
  stdio_profile_key: null,
  enabled: true,
};

beforeEach(() => {
  vi.resetAllMocks();
  mocks.listServers.mockResolvedValue([server]);
  mocks.server.mockResolvedValue(server);
  mocks.createServer.mockResolvedValue(server);
});

describe("Registry134-147 DTO", () => {
  it("registers only the fourteen named business operations", () => {
    expect(Object.keys(managedMcpOperationContracts)).toEqual([
      "managed-mcp.servers.list", "managed-mcp.server.get", "managed-mcp.server.create",
      "managed-mcp.server.update", "managed-mcp.server.delete", "managed-mcp.app-settings.get",
      "managed-mcp.app-settings.update", "managed-mcp.credential.get", "managed-mcp.credential.upsert",
      "managed-mcp.credential.delete", "managed-mcp.discovery.get", "managed-mcp.discovery.save",
      "managed-mcp.import-receipt.get", "managed-mcp.import",
    ]);
  });

  it.each(["actor", "actor_id", "user_id", "sql", "table", "column", "transaction"])(
    "rejects caller-authored %s",
    key => expect(managedMcpServerCreateDto.safeParse({ ...createInput, [key]: "caller" }).success).toBe(false),
  );

  it.each([
    "ftp://mcp.example.test/connect",
    "https://user:pass@mcp.example.test/connect",
    "https://mcp.example.test/connect?secret=value",
    "https://mcp.example.test/connect#fragment",
  ])("rejects unsafe remote URL %s", remote_url => {
    expect(managedMcpServerCreateDto.safeParse({ ...createInput, remote_url }).success).toBe(false);
  });

  it("applies Server scope and endpoint invariants to import commands too", () => {
    const base = { ...createInput, source_hash: "a".repeat(64), config_hash: "b".repeat(64), run_id: null };
    expect(managedMcpImportInputDto.safeParse(base).success).toBe(true);
    expect(managedMcpImportInputDto.safeParse({ ...base, scope: "workspace" }).success).toBe(false);
    expect(managedMcpImportInputDto.safeParse({ ...base, transport: "stdio" }).success).toBe(false);
  });
});

describe("managed-MCP service", () => {
  it("derives the actor from OAuth and dispatches through the typed Repository", async () => {
    expect(await runManagedMcpOperation(
      "managed-mcp.servers.list", { authority: null, workspace_id: null }, oauthActor, tx,
    )).toEqual({ servers: [server] });
    expect(mocks.construct).toHaveBeenCalledExactlyOnceWith(tx, principal.canonical_user_id, null);
    expect(mocks.listServers).toHaveBeenCalledExactlyOnceWith(null);

    expect(await runManagedMcpOperation(
      "managed-mcp.server.create", createInput, oauthActor, tx,
    )).toEqual({ server });
    expect(mocks.createServer).toHaveBeenCalledExactlyOnceWith(createInput);
  });

  it("requires exact server-persistence Thread and Run authority", async () => {
    await expect(runManagedMcpOperation(
      "managed-mcp.server.get",
      { authority, workspace_id: null, identifier: serverId },
      delegatedActor,
      tx,
    )).resolves.toEqual({ server });
    expect(mocks.construct).toHaveBeenLastCalledWith(tx, principal.canonical_user_id, authority);

    await expect(runManagedMcpOperation(
      "managed-mcp.server.get",
      { authority: { ...authority, thread_id: "thread-other" }, workspace_id: null, identifier: serverId },
      delegatedActor,
      tx,
    )).rejects.toMatchObject({ code: "DREAM_DELEGATION_ENTITY_DENIED", status: 403 });
  });

  it("rejects missing scope and malformed DTO before Repository I/O", async () => {
    await expect(runManagedMcpOperation(
      "managed-mcp.server.create",
      createInput,
      { ...oauthActor, principal: { ...principal, scopes: ["dream:read"] } },
      tx,
    )).rejects.toMatchObject({ code: "DREAM_SCOPE_REQUIRED", status: 403 });
    await expect(runManagedMcpOperation(
      "managed-mcp.server.create",
      { ...createInput, actor_id: principal.canonical_user_id },
      oauthActor,
      tx,
    )).rejects.toMatchObject({ code: "INPUT_INVALID", status: 400 });
    expect(mocks.createServer).not.toHaveBeenCalled();
  });
});
