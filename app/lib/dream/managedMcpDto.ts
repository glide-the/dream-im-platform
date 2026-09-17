// [Input] Actor-free managed-MCP resource commands plus optional exact Runtime authority scope.
// [Output] Strict Registry134-147 DTOs for Server, App settings, encrypted credentials, discovery and import receipts.
// [Pos] Cross-project DTO boundary; actor, SQL, tables, plaintext credentials and transactions remain server-owned.
// [Sync] 2026-09-16: define the complete managed-MCP data API before removing Dream PostgreSQL access.
import { z } from "zod";
import { isoTimeDto } from "../auth/dto";
import { workflowRunIdDto } from "./workflowRunDto";

const identifier = z.string().min(1).max(255);
const serverId = z.uuid();
const serverKey = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/);
const stdioProfileKey = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/);
const remoteUrl = z.url().refine((value) => {
  const parsed = new URL(value);
  return (parsed.protocol === "http:" || parsed.protocol === "https:")
    && parsed.username === ""
    && parsed.password === ""
    && parsed.search === ""
    && parsed.hash === "";
}, "Managed MCP remote URL must be HTTP(S) without credentials, query or fragment");
const sha256 = z.string().regex(/^[0-9a-f]{64}$/);
const positiveRevision = z.number().int().positive().safe();
const transport = z.enum(["streamable_http", "sse", "stdio"]);
const authKind = z.enum(["none", "oauth"]);
const scope = z.enum(["user", "workspace"]);
const credentialKind = z.enum(["oauth", "headers", "stdio_env"]);
const inventoryStatus = z.enum(["complete", "failed", "cancelled"]);
const jsonObject = z.record(z.string(), z.json());

export const managedMcpAuthorityDto = z.strictObject({
  thread_id: identifier,
  workflow_run_id: workflowRunIdDto.nullable(),
}).nullable();

const scopedInput = {
  authority: managedMcpAuthorityDto,
  workspace_id: identifier.nullable(),
};

export const managedMcpServerDto = z.strictObject({
  id: serverId,
  user_id: z.string().regex(/^[1-9][0-9]*$/),
  workspace_id: identifier.nullable(),
  scope,
  server_key: serverKey,
  display_name: z.string().trim().min(1).max(200),
  transport,
  remote_url: remoteUrl.nullable(),
  stdio_profile_key: stdioProfileKey.nullable(),
  auth_kind: authKind,
  enabled: z.boolean(),
  config_revision: positiveRevision,
  credential_revision: z.number().int().nonnegative().safe(),
  credential_id: serverId.nullable(),
  credential_configured: z.boolean(),
  created_at: isoTimeDto,
  updated_at: isoTimeDto,
}).superRefine((value, context) => {
  const workspaceValid = value.scope === "user"
    ? value.workspace_id === null
    : value.workspace_id !== null;
  const endpointValid = value.transport === "stdio"
    ? value.remote_url === null && value.stdio_profile_key !== null
    : value.remote_url !== null && value.stdio_profile_key === null;
  const credentialValid = value.credential_configured
    ? value.credential_id !== null && value.credential_revision >= 1
    : value.credential_id === null && value.credential_revision >= 0;
  if (!workspaceValid || !endpointValid || !credentialValid) {
    context.addIssue({ code: "custom", message: "Stored managed MCP Server is inconsistent" });
  }
});

export const managedMcpServerCreateDto = z.strictObject({
  ...scopedInput,
  server_key: serverKey,
  display_name: z.string().trim().min(1).max(200),
  transport,
  auth_kind: authKind,
  scope,
  remote_url: remoteUrl.nullable(),
  stdio_profile_key: stdioProfileKey.nullable(),
  enabled: z.boolean(),
}).superRefine((value, context) => {
  if ((value.scope === "user") !== (value.workspace_id === null)) {
    context.addIssue({ code: "custom", message: "Managed MCP scope is inconsistent" });
  }
  if ((value.transport === "stdio") !== (value.stdio_profile_key !== null)
    || (value.transport === "stdio") === (value.remote_url !== null)) {
    context.addIssue({ code: "custom", message: "Managed MCP endpoint is inconsistent" });
  }
});

export const managedMcpServerPatchDto = z.strictObject({
  authority: managedMcpAuthorityDto,
  server_id: serverId,
  expected_revision: positiveRevision,
  display_name: z.string().trim().min(1).max(200).nullable(),
  transport: transport.nullable(),
  auth_kind: authKind.nullable(),
  remote_url: remoteUrl.nullable(),
  stdio_profile_key: stdioProfileKey.nullable(),
  enabled: z.boolean().nullable(),
});

export const managedMcpServerListInputDto = z.strictObject(scopedInput);
export const managedMcpServerListOutputDto = z.strictObject({ servers: z.array(managedMcpServerDto) });
export const managedMcpServerGetInputDto = z.strictObject({
  ...scopedInput,
  identifier,
});
export const managedMcpServerGetOutputDto = z.strictObject({ server: managedMcpServerDto.nullable() });
export const managedMcpServerOutputDto = z.strictObject({ server: managedMcpServerDto });
export const managedMcpServerDeleteInputDto = z.strictObject({
  authority: managedMcpAuthorityDto,
  server_id: serverId,
  expected_revision: positiveRevision.nullable(),
});

export const managedMcpAppPreferenceDto = z.strictObject({
  enabled: z.boolean(),
  low_risk_tool_calls: z.boolean(),
  ui_messages: z.boolean(),
});
export const managedMcpAppSettingsDto = z.strictObject({
  desired: managedMcpAppPreferenceDto,
  revision: positiveRevision,
});
export const managedMcpAppSettingsGetInputDto = z.strictObject({
  ...scopedInput,
  server_id: serverId,
});
export const managedMcpAppSettingsGetOutputDto = z.strictObject({ settings: managedMcpAppSettingsDto.nullable() });
export const managedMcpAppSettingsUpdateInputDto = z.strictObject({
  ...scopedInput,
  server_id: serverId,
  expected_revision: positiveRevision,
  desired: managedMcpAppPreferenceDto,
});
export const managedMcpAppSettingsOutputDto = z.strictObject({ settings: managedMcpAppSettingsDto });

export const managedMcpCredentialDto = z.strictObject({
  id: serverId,
  server_id: serverId,
  user_id: z.string().regex(/^[1-9][0-9]*$/),
  kind: credentialKind,
  ciphertext: z.string().min(1),
  iv: z.string().min(1),
  tag: z.string().min(1),
  fingerprint: z.string().regex(/^[0-9a-f]{16}$/),
  key_version: positiveRevision,
  credential_revision: positiveRevision,
  expires_at: isoTimeDto.nullable(),
});
export const managedMcpCredentialGetInputDto = z.strictObject({
  authority: managedMcpAuthorityDto,
  server_id: serverId,
});
export const managedMcpCredentialGetOutputDto = z.strictObject({ credential: managedMcpCredentialDto.nullable() });
export const managedMcpCredentialUpsertInputDto = z.strictObject({
  authority: managedMcpAuthorityDto,
  server_id: serverId,
  kind: credentialKind,
  envelope: z.strictObject({
    ciphertext: z.string().min(1),
    iv: z.string().min(1),
    tag: z.string().min(1),
    fingerprint: z.string().regex(/^[0-9a-f]{16}$/),
    key_version: positiveRevision,
  }),
  expires_at: isoTimeDto.nullable(),
});
export const managedMcpCredentialOutputDto = z.strictObject({ credential: managedMcpCredentialDto });

export const managedMcpDiscoveryGetInputDto = z.strictObject({
  authority: managedMcpAuthorityDto,
  server_id: serverId,
  config_revision: positiveRevision,
  credential_revision: z.number().int().nonnegative().safe(),
});
export const managedMcpDiscoverySnapshotDto = z.strictObject({
  status: inventoryStatus,
  inventory: jsonObject,
  safe_error_code: z.string().min(1).max(255).nullable(),
  discovered_at: isoTimeDto,
});
export const managedMcpDiscoveryGetOutputDto = z.strictObject({ snapshot: managedMcpDiscoverySnapshotDto.nullable() });
export const managedMcpDiscoverySaveInputDto = z.strictObject({
  authority: managedMcpAuthorityDto,
  server_id: serverId,
  config_revision: positiveRevision,
  credential_revision: z.number().int().nonnegative().safe(),
  status: inventoryStatus,
  inventory: jsonObject,
  safe_error_code: z.string().min(1).max(255).nullable(),
  ttl_seconds: z.number().positive().finite(),
});
export const managedMcpDiscoverySaveOutputDto = z.strictObject({ saved: z.literal(true) });

export const managedMcpImportReceiptDto = z.strictObject({
  state: z.enum(["imported", "noop", "conflict", "credential_reauth_required"]),
  target_server_id: serverId.nullable(),
  canonical_config_sha256: sha256,
});
export const managedMcpImportReceiptGetInputDto = z.strictObject({
  authority: managedMcpAuthorityDto,
  source_hash: sha256,
});
export const managedMcpImportReceiptGetOutputDto = z.strictObject({ receipt: managedMcpImportReceiptDto.nullable() });
export const managedMcpImportInputDto = z.strictObject({
  ...managedMcpServerCreateDto.shape,
  source_hash: sha256,
  config_hash: sha256,
  run_id: identifier.nullable(),
}).superRefine((value, context) => {
  if ((value.scope === "user") !== (value.workspace_id === null)) {
    context.addIssue({ code: "custom", message: "Managed MCP scope is inconsistent" });
  }
  if ((value.transport === "stdio") !== (value.stdio_profile_key !== null)
    || (value.transport === "stdio") === (value.remote_url !== null)) {
    context.addIssue({ code: "custom", message: "Managed MCP endpoint is inconsistent" });
  }
});
export const managedMcpImportOutputDto = z.strictObject({ receipt: managedMcpImportReceiptDto });

export const managedMcpOperationContracts = {
  "managed-mcp.servers.list": { kind: "read", userScope: "dream:read", input: managedMcpServerListInputDto, output: managedMcpServerListOutputDto },
  "managed-mcp.server.get": { kind: "read", userScope: "dream:read", input: managedMcpServerGetInputDto, output: managedMcpServerGetOutputDto },
  "managed-mcp.server.create": { kind: "write", userScope: "dream:write", input: managedMcpServerCreateDto, output: managedMcpServerOutputDto },
  "managed-mcp.server.update": { kind: "write", userScope: "dream:write", input: managedMcpServerPatchDto, output: managedMcpServerOutputDto },
  "managed-mcp.server.delete": { kind: "write", userScope: "dream:write", input: managedMcpServerDeleteInputDto, output: managedMcpServerOutputDto },
  "managed-mcp.app-settings.get": { kind: "read", userScope: "dream:read", input: managedMcpAppSettingsGetInputDto, output: managedMcpAppSettingsGetOutputDto },
  "managed-mcp.app-settings.update": { kind: "write", userScope: "dream:write", input: managedMcpAppSettingsUpdateInputDto, output: managedMcpAppSettingsOutputDto },
  "managed-mcp.credential.get": { kind: "read", userScope: "dream:read", input: managedMcpCredentialGetInputDto, output: managedMcpCredentialGetOutputDto },
  "managed-mcp.credential.upsert": { kind: "write", userScope: "dream:write", input: managedMcpCredentialUpsertInputDto, output: managedMcpCredentialOutputDto },
  "managed-mcp.credential.delete": { kind: "write", userScope: "dream:write", input: managedMcpCredentialGetInputDto, output: managedMcpServerOutputDto },
  "managed-mcp.discovery.get": { kind: "read", userScope: "dream:read", input: managedMcpDiscoveryGetInputDto, output: managedMcpDiscoveryGetOutputDto },
  "managed-mcp.discovery.save": { kind: "write", userScope: "dream:write", input: managedMcpDiscoverySaveInputDto, output: managedMcpDiscoverySaveOutputDto },
  "managed-mcp.import-receipt.get": { kind: "read", userScope: "dream:read", input: managedMcpImportReceiptGetInputDto, output: managedMcpImportReceiptGetOutputDto },
  "managed-mcp.import": { kind: "write", userScope: "dream:write", input: managedMcpImportInputDto, output: managedMcpImportOutputDto },
} as const;

export type ManagedMcpOperation = keyof typeof managedMcpOperationContracts;
export type ManagedMcpInput = z.infer<(typeof managedMcpOperationContracts)[ManagedMcpOperation]["input"]>;
export type ManagedMcpServer = z.infer<typeof managedMcpServerDto>;
export type ManagedMcpAuthority = z.infer<typeof managedMcpAuthorityDto>;
