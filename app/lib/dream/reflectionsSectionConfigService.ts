// [Input] Live OAuth owner with null entity scopes, closed section command and existing Admin UOW.
// [Output] Raw custom object/null, or atomic save/delete completion with original receipt/audit.
// [Pos] Registered section persistence service; defaults/merge/display/FS/Agent remain in Dream.
// [Sync] 2026-09-15: publish the existing raw/fallback and atomic receipt behavior unchanged.
import { AuthBoundaryError } from "../auth/config";
import { principalDto } from "../auth/dto";
import type { ChatThreadActor } from "./chatThreadService";
import type { DataTransaction } from "./database";
import { inspectMemoryConfig } from "./deckContentCanonical";
import { ReceiptRepository } from "./receipts";
import { identitySchemaRequirement } from "./schemaRequirements";
import { dreamUnifiedSchemaRequirement } from "./chatThreadService";
import { ReflectionsSectionConfigRepository } from "./reflectionsSectionConfigRepository";
import { reflectionsSectionConfigOperationContracts as contracts, reflectionsSectionConfigSaveDto, type ReflectionsSectionConfigOperation } from "./reflectionsSectionConfigDto";
export const reflectionsSectionConfigSchemaRequirements = [identitySchemaRequirement, dreamUnifiedSchemaRequirement] as const;
type Actor = ChatThreadActor & { runScope?: string | null; editorSessionScope?: string | null };
export async function runReflectionsSectionConfigOperation(name: ReflectionsSectionConfigOperation, rawInput: unknown, actor: Actor, tx: DataTransaction, serviceId: string, requestId: string) {
  const contract = contracts[name];
  if (!contract) throw new AuthBoundaryError("OPERATION_UNAVAILABLE", 404);
  const parsed = contract.input.safeParse(rawInput);
  if (!parsed.success) throw new AuthBoundaryError("INPUT_INVALID", 400);
  const principal = principalDto.parse(actor.principal);
  if (!principal.scopes.includes(contract.userScope)) throw new AuthBoundaryError("DREAM_SCOPE_REQUIRED", 403);
  if (actor.threadScope !== null || (actor.runScope ?? null) !== null || (actor.editorSessionScope ?? null) !== null) throw new AuthBoundaryError("DELEGATION_ENTITY_DENIED", 403);
  const store = new ReflectionsSectionConfigRepository(tx, principal.canonical_user_id), section = parsed.data.section;
  if (name === "reflections-section-config.get") {
    const row = await store.get(section);
    if (!row) return { prompt_files_json: null };
    const raw = row.prompt_files || "{}";
    return { prompt_files_json: (await inspectMemoryConfig(raw)).is_object ? raw : null };
  }
  const receipt = new ReceiptRepository(tx, serviceId, principal.subject);
  if (name === "reflections-section-config.save") {
    const input = reflectionsSectionConfigSaveDto.parse(parsed.data);
    return receipt.execute(name, requestId, input, contracts[name].output, async () => {
      await store.save(section, input.prompt_files_json); return { saved: true as const };
    });
  }
  return receipt.execute(name, requestId, parsed.data, contracts[name].output, async () => ({ deleted: await store.delete(section) }));
}
