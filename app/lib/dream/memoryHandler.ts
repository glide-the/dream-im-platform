// [Input] Confidential service and delegated owner, named memory operation.
// [Output] Strict capability-gated result; service-only workers cannot choose owners.
// [Pos] Additive Admin memory ingress.
// [Sync] 2026-10-15: separate background Reflections and owner setting/file operations.
import { z } from "zod";
import { AuthBoundaryError,requiredAuthValue } from "../auth/config";
import { requestIdDto } from "../auth/dto";
import { handleInternalAuthRequest,parseAuthDto } from "../auth/internalHandler";
import { principalForServiceToken } from "../auth/serviceAccessToken";
import { hasDelegatedUserBearer } from "../auth/serviceIdentity";
import { withDataTransaction } from "./database";
import { identitySchemaRequirement,reflectionTaskSchemaRequirements } from "./schemaRequirements";
import { memoryOperations,type MemoryOperation } from "./memoryDto";
import { memorySchemaRequirement,runMemoryBackground,runMemoryUser } from "./memoryService";
export function isMemoryOperation(name:string):name is MemoryOperation { return Object.hasOwn(memoryOperations,name); }
export async function handleMemoryOperation(request:Request,name:MemoryOperation) {
  return handleInternalAuthRequest(request,async(service,setRequestId)=>{
    const contract=memoryOperations[name];
    const envelope=await parseAuthDto(request,z.strictObject({ request_id:requestIdDto,input:contract.input }),Number(requiredAuthValue("DREAM_DATA_MAX_BODY_BYTES")));
    setRequestId(envelope.request_id);
    return withDataTransaction([identitySchemaRequirement,...reflectionTaskSchemaRequirements,memorySchemaRequirement],async tx=>{
      if (contract.audience==="background") {
        if (hasDelegatedUserBearer(request)) throw new AuthBoundaryError("MEMORY_BROWSER_CREDENTIAL_FORBIDDEN",400);
        return contract.output.parse(await runMemoryBackground(name,envelope.input,tx,service));
      }
      const principal=await principalForServiceToken(tx,request.headers.get("authorization")?.replace(/^Bearer /,"")??"",service,contract.userScope!);
      return contract.output.parse(await runMemoryUser(name,envelope.input,tx,principal.canonical_user_id,service.id,envelope.request_id));
    });
  });
}
