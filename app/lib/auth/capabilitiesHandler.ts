// [Input] Service capability-read scope and actual Drizzle physical-capability ledger.
// [Output] Strict configuration/capability DTO containing only available registered operations.
// [Pos] Dream readiness/contract discovery boundary, no global-head coupling.
// [Sync] 2026-09-14: separate schema capability receipts from API availability.
// [Sync] 2026-10-11: publish image-turn API descriptors only when all exact operation requirements are installed.
// [Sync] 2026-11-16: check all operations and delegations against one request-local data-ledger read, independently of auth receipts.
import { schemaCapabilities } from "@ink-memory/db/schema/capabilities";
import { authConfiguration, authScopes, requiredAuthValue } from "./config";
import { capabilitiesDto } from "./dto";
import { withAuthTransaction } from "./database";
import { requireBackgroundScope } from "./serviceIdentity";
import { handleInternalAuthRequest } from "./internalHandler";
import { dreamDataDatabase, readSchemaCapabilities, schemaCapabilityMatches } from "../dream/database";
import { dreamOperations } from "../dream/operationRegistry";
import { delegationContracts, delegationDiscoverySchemaRequirements } from "./delegationContracts";
export async function handleCapabilities(request: Request) {
  return handleInternalAuthRequest(request, async service => {
    requireBackgroundScope(service, "capabilities:read");
    const configuration = authConfiguration();
    const physical = await withAuthTransaction(tx => tx.select({ capability: schemaCapabilities.capability, version: schemaCapabilities.version, contract_sha256: schemaCapabilities.contractSha256 }).from(schemaCapabilities));
    const dataDatabase = dreamDataDatabase();
    const ledger = await readSchemaCapabilities(dataDatabase, [...dreamOperations.flatMap(operation => operation.requirements), ...delegationDiscoverySchemaRequirements]);
    const operations = dreamOperations.filter(operation => operation.requirements.every(required => schemaCapabilityMatches(ledger, required))).map(operation => operation.capability);
    const delegationReady = delegationDiscoverySchemaRequirements.every(required => schemaCapabilityMatches(ledger, required));
    return capabilitiesDto.parse({
      version: "1", auth: { issuer: configuration.issuer, jwks_uri: `${configuration.issuer}/jwks`, algorithm: "ES256", resource: configuration.resource, clients: { browser: service.oauthClientId, device: requiredAuthValue("AUTH_DEVICE_CLIENT_ID") }, scopes: [...authScopes], delegations: delegationReady ? delegationContracts.map(({ capability }) => capability) : [] },
      schema_capabilities: physical, operations,
    });
  });
}
