// [Input] Configured Dream service, OAuth/server-persistence bearer or connector-sync service, and strict Notion envelope.
// [Output] Capability-gated Notion result from one Admin-owned DTO/Drizzle transaction.
// [Pos] Thin internal ingress; no Notion SDK, filesystem path, generic CRUD or caller-selected actor.
// [Sync] 2026-09-16: register OAuth, delegated Runtime and scheduled Notion persistence operations.
import { z } from "zod";
import { AuthBoundaryError, requiredAuthValue } from "../auth/config";
import { DelegationService } from "../auth/delegationService";
import { requestIdDto } from "../auth/dto";
import { handleInternalAuthRequest, parseAuthDto } from "../auth/internalHandler";
import { principalForServiceToken } from "../auth/serviceAccessToken";
import { withDataTransaction } from "./database";
import {
  notionConnectorOperationContracts,
  notionSyncConnectorInputDto,
  type NotionConnectorBackgroundOperation,
  type NotionConnectorOperation,
  type NotionConnectorUserOperation,
} from "./notionConnectorDto";
import {
  notionBackgroundReceiptActor,
  notionConnectorSchemaRequirements,
  runNotionConnectorBackgroundOperation,
  runNotionConnectorUserOperation,
  type NotionConnectorActor,
} from "./notionConnectorService";
import { ReceiptRepository } from "./receipts";
import { identitySchemaRequirement, runtimeDelegationSchemaRequirement, runtimePurposeSchemaRequirement } from "./schemaRequirements";

export function isNotionConnectorOperation(name: string): name is NotionConnectorOperation {
  return Object.hasOwn(notionConnectorOperationContracts, name);
}

export async function handleNotionConnector(request: Request, name: string) {
  return handleInternalAuthRequest(request, async (service, setRequestId) => {
    if (!isNotionConnectorOperation(name)) throw new AuthBoundaryError("OPERATION_UNAVAILABLE", 404);
    const operation = notionConnectorOperationContracts[name];
    const envelope = await parseAuthDto(
      request,
      z.strictObject({ request_id: requestIdDto, input: operation.input }),
      Number(requiredAuthValue("DREAM_DATA_MAX_BODY_BYTES")),
    );
    setRequestId(envelope.request_id);
    if (operation.audience === "background") {
      if (request.headers.has("authorization")) throw new AuthBoundaryError("NOTION_BROWSER_CREDENTIAL_FORBIDDEN", 400);
      return withDataTransaction([identitySchemaRequirement, ...notionConnectorSchemaRequirements], async tx => {
        const action = () => runNotionConnectorBackgroundOperation(
          name as NotionConnectorBackgroundOperation, envelope.input, service, tx,
        );
        if (operation.kind === "read") return action();
        const connectorId = notionSyncConnectorInputDto.shape.connector_id.parse(
          (envelope.input as { connector_id?: unknown }).connector_id,
        );
        return new ReceiptRepository(tx, service.id, notionBackgroundReceiptActor(connectorId)).execute(
          name, envelope.request_id, envelope.input, operation.output as z.ZodType, action,
        );
      });
    }
    const token = request.headers.get("authorization")?.replace(/^Bearer /, "") ?? "";
    const delegated = token.startsWith("idg_");
    return withDataTransaction([
      identitySchemaRequirement,
      ...notionConnectorSchemaRequirements,
      ...(delegated ? [runtimeDelegationSchemaRequirement, runtimePurposeSchemaRequirement] : []),
    ], async tx => {
      let actor: NotionConnectorActor;
      const input = envelope.input as { authority: { thread_id: string; workflow_run_id: string | null } | null };
      if (delegated) {
        if (input.authority === null) throw new AuthBoundaryError("DREAM_DELEGATION_ENTITY_DENIED", 403);
        const resolved = await new DelegationService(tx).resolve(
          token, operation.userScope, service.id,
          input.authority.thread_id, input.authority.workflow_run_id, null,
        );
        if (resolved.purpose !== "server-persistence" || resolved.editorSessionId !== null) {
          throw new AuthBoundaryError("DREAM_DELEGATION_ENTITY_DENIED", 403);
        }
        actor = {
          principal: resolved.principal,
          threadScope: resolved.threadId,
          runScope: resolved.runId,
          delegationPurpose: "server-persistence",
        };
      } else {
        if (input.authority !== null) throw new AuthBoundaryError("DREAM_DELEGATION_ENTITY_DENIED", 403);
        actor = {
          principal: await principalForServiceToken(tx, token, service, operation.userScope),
          threadScope: null, runScope: null, delegationPurpose: null,
        };
      }
      const action = () => runNotionConnectorUserOperation(
        name as NotionConnectorUserOperation, envelope.input, actor, tx,
      );
      if (operation.kind === "read") return action();
      return new ReceiptRepository(tx, service.id, actor.principal.subject).execute(
        name, envelope.request_id, envelope.input, operation.output as z.ZodType, action,
        actor.threadScope, null, actor.runScope,
      );
    });
  });
}
