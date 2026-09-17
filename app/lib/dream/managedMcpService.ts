// [Input] Strict Registry134-147 command, current OAuth/server-persistence actor and caller-owned Admin transaction.
// [Output] Managed-MCP DTO results with authorization, CAS and persistence delegated to typed Drizzle methods.
// [Pos] Domain service; Dream retains MCP protocol, OAuth state machine, encryption and Runtime behavior.
// [Sync] 2026-09-16: expose the complete managed-MCP persistence surface through named operations.
import { AuthBoundaryError } from "../auth/config";
import { principalDto, type PrincipalDto } from "../auth/dto";
import type { DataTransaction } from "./database";
import * as dto from "./managedMcpDto";
import { ManagedMcpRepository } from "./managedMcpRepository";

export const managedMcpSchemaRequirements = [
  {
    capability: "dream.managed-mcp-resources.v1",
    version: 1,
    contractSha256: "746dfcb1343c485bee9fb7cc3fa363424db4a66ad31cd6824ed2024be049614a",
  },
  {
    capability: "dream.mcp-app-connection-settings.v1",
    version: 1,
    contractSha256: "c8a1daebd20db54890ca31bf154faad4bd6f2714c609dba413acca88e2139202",
  },
] as const;

export type ManagedMcpActor = {
  principal: PrincipalDto;
  threadScope: string | null;
  runScope: string | null;
  delegationPurpose: "server-persistence" | null;
};

function requireActor(
  rawActor: ManagedMcpActor,
  authority: dto.ManagedMcpAuthority,
  scope: string,
) {
  const principal = principalDto.safeParse(rawActor.principal);
  if (!principal.success || !principal.data.scopes.includes(scope)) {
    throw new AuthBoundaryError("DREAM_SCOPE_REQUIRED", 403);
  }
  if (rawActor.threadScope === null) {
    if (rawActor.runScope !== null || rawActor.delegationPurpose !== null || authority !== null) {
      throw new AuthBoundaryError("DREAM_DELEGATION_ENTITY_DENIED", 403);
    }
  } else if (
    rawActor.delegationPurpose !== "server-persistence"
    || authority === null
    || authority.thread_id !== rawActor.threadScope
    || authority.workflow_run_id !== rawActor.runScope
  ) {
    throw new AuthBoundaryError("DREAM_DELEGATION_ENTITY_DENIED", 403);
  }
  return principal.data;
}

export async function runManagedMcpOperation(
  name: dto.ManagedMcpOperation,
  rawInput: unknown,
  actor: ManagedMcpActor,
  tx: DataTransaction,
) {
  const operation = dto.managedMcpOperationContracts[name];
  if (!operation) throw new AuthBoundaryError("OPERATION_UNAVAILABLE", 404);
  const parsed = operation.input.safeParse(rawInput);
  if (!parsed.success) throw new AuthBoundaryError("INPUT_INVALID", 400);
  const input = parsed.data;
  const principal = requireActor(actor, input.authority, operation.userScope);
  const store = new ManagedMcpRepository(tx, principal.canonical_user_id, input.authority);
  let result: unknown;
  switch (name) {
    case "managed-mcp.servers.list": {
      const value = dto.managedMcpServerListInputDto.parse(input);
      result = { servers: await store.listServers(value.workspace_id) };
      break;
    }
    case "managed-mcp.server.get": {
      const value = dto.managedMcpServerGetInputDto.parse(input);
      result = { server: await store.server(value.identifier, value.workspace_id) };
      break;
    }
    case "managed-mcp.server.create": {
      const value = dto.managedMcpServerCreateDto.parse(input);
      result = { server: await store.createServer(value) };
      break;
    }
    case "managed-mcp.server.update": {
      const value = dto.managedMcpServerPatchDto.parse(input);
      result = { server: await store.updateServer(value) };
      break;
    }
    case "managed-mcp.server.delete": {
      const value = dto.managedMcpServerDeleteInputDto.parse(input);
      result = { server: await store.deleteServer(value.server_id, value.expected_revision) };
      break;
    }
    case "managed-mcp.app-settings.get": {
      const value = dto.managedMcpAppSettingsGetInputDto.parse(input);
      result = { settings: await store.appSettings(value.server_id, value.workspace_id) };
      break;
    }
    case "managed-mcp.app-settings.update": {
      const value = dto.managedMcpAppSettingsUpdateInputDto.parse(input);
      result = { settings: await store.updateAppSettings(value) };
      break;
    }
    case "managed-mcp.credential.get": {
      const value = dto.managedMcpCredentialGetInputDto.parse(input);
      result = { credential: await store.credential(value.server_id) };
      break;
    }
    case "managed-mcp.credential.upsert": {
      const value = dto.managedMcpCredentialUpsertInputDto.parse(input);
      result = { credential: await store.upsertCredential(value) };
      break;
    }
    case "managed-mcp.credential.delete": {
      const value = dto.managedMcpCredentialGetInputDto.parse(input);
      result = { server: await store.deleteCredential(value.server_id) };
      break;
    }
    case "managed-mcp.discovery.get": {
      const value = dto.managedMcpDiscoveryGetInputDto.parse(input);
      result = { snapshot: await store.discovery(
        value.server_id, value.config_revision, value.credential_revision,
      ) };
      break;
    }
    case "managed-mcp.discovery.save": {
      const value = dto.managedMcpDiscoverySaveInputDto.parse(input);
      await store.saveDiscovery(value);
      result = { saved: true };
      break;
    }
    case "managed-mcp.import-receipt.get": {
      const value = dto.managedMcpImportReceiptGetInputDto.parse(input);
      result = { receipt: await store.importReceipt(value.source_hash) };
      break;
    }
    case "managed-mcp.import": {
      const value = dto.managedMcpImportInputDto.parse(input);
      result = { receipt: await store.importServer(value) };
      break;
    }
    default:
      throw new AuthBoundaryError("OPERATION_UNAVAILABLE", 404);
  }
  return operation.output.parse(result);
}
