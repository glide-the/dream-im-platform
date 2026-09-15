// [Input] Service capability-read scope and actual Drizzle physical-capability ledger.
// [Output] Strict configuration/capability DTO containing only available registered operations.
// [Pos] Dream readiness/contract discovery boundary, no global-head coupling.
// [Sync] 2026-09-14: separate schema capability receipts from API availability.
import { schemaCapabilities } from "@ink-memory/db/schema/capabilities";
import { authConfiguration, authScopes, requiredAuthValue } from "./config";
import { capabilitiesDto } from "./dto";
import { withAuthTransaction } from "./database";
import { requireBackgroundScope } from "./serviceIdentity";
import { handleInternalAuthRequest } from "./internalHandler";
import { dreamDataDatabase, hasSchemaCapability } from "../dream/database";
import { dreamOperations } from "../dream/operationRegistry";
import { delegationContracts, delegationDiscoverySchemaRequirements } from "./delegationContracts";
export async function handleCapabilities(request: Request) {
  return handleInternalAuthRequest(request, async service => {
    requireBackgroundScope(service, "capabilities:read");
    const configuration = authConfiguration();
    const physical = await withAuthTransaction(tx => tx.select({ capability: schemaCapabilities.capability, version: schemaCapabilities.version, contract_sha256: schemaCapabilities.contractSha256 }).from(schemaCapabilities));
    const dataDatabase = dreamDataDatabase();
    const operations = [];
    for (const operation of dreamOperations) {
      const available = await Promise.all(operation.requirements.map(required => hasSchemaCapability(dataDatabase, required)));
      if (available.every(Boolean)) operations.push(operation.capability);
    }
    const delegationReady = (await Promise.all(delegationDiscoverySchemaRequirements.map(required => hasSchemaCapability(dataDatabase, required)))).every(Boolean);
    return capabilitiesDto.parse({
      version: "1", auth: { issuer: configuration.issuer, jwks_uri: `${configuration.issuer}/jwks`, algorithm: "ES256", resource: configuration.resource, clients: { browser: service.oauthClientId, device: requiredAuthValue("AUTH_DEVICE_CLIENT_ID") }, scopes: [...authScopes], delegations: delegationReady ? delegationContracts.map(({ capability }) => capability) : [] },
      schema_capabilities: physical, operations,
    });
  });
}
