// [Input] Strict named domain operation, verified actor and the existing Admin receipt/UOW transaction.
// [Output] Validated Deck/Voice result; every aggregate write remains atomic with its receipt.
// [Pos] Admin domain dispatch, never runs Runtime, filesystem operations or independent transactions.
// [Sync] 2026-09-19: merge code-owned system Deck templates into the validated deployment policy.
// [Sync] 2026-09-14: exact schema requirements; long-turn delegation never grants Deck management.
import { z } from "zod";
import { AuthBoundaryError,requiredAuthValue } from "../auth/config";
import { principalDto,type PrincipalDto } from "../auth/dto";
import type {DataTransaction,SchemaRequirement} from "./database";
import * as dto from "./deckVoiceDto";
import {DeckVoiceRepository} from "./deckVoiceRepository";
import {dreamUnifiedSchemaRequirement} from "./chatThreadService";
import {deckContentCanonicalSchemaRequirement} from "./schemaRequirements";
import {codeSystemDeckTemplates} from "./systemDeckTemplates";
export type DeckVoiceActor={principal:PrincipalDto;threadScope:string|null};
export function configuredDeckVoicePolicy(){let raw:unknown;try{raw=JSON.parse(requiredAuthValue("DREAM_DECK_POLICY_JSON"));}catch{throw new AuthBoundaryError("DECK_POLICY_NOT_CONFIGURED");}const parsed=dto.deckVoicePolicyDto.safeParse(raw);if(!parsed.success)throw new AuthBoundaryError("DECK_POLICY_NOT_CONFIGURED");const configured=new Map(parsed.data.additional_system_decks.map(template=>[template.id,template]));for(const template of codeSystemDeckTemplates){const existing=configured.get(template.id);if(existing&&JSON.stringify(existing)!==JSON.stringify(template))throw new AuthBoundaryError("DECK_POLICY_NOT_CONFIGURED");configured.set(template.id,template);}const merged=dto.deckVoicePolicyDto.safeParse({...parsed.data,additional_system_decks:[...configured.values()]});if(!merged.success)throw new AuthBoundaryError("DECK_POLICY_NOT_CONFIGURED");return merged.data;}
export const deckVoiceSchemaRequirements:readonly SchemaRequirement[]=[deckContentCanonicalSchemaRequirement,dreamUnifiedSchemaRequirement,{capability:"dream.deck-content-versions.v1",version:1,contractSha256:"ca7ad5914895d6aa9e8c7d576b9af3ed65b44f34318e068d2fc10c90e351e4c3"}];
export async function runDeckVoiceOperation(operation:dto.DeckVoiceOperation,input:unknown,actor:DeckVoiceActor,tx:DataTransaction,policy=configuredDeckVoicePolicy()){
 const contract=dto.deckVoiceOperationContracts[operation];if(!contract)throw new AuthBoundaryError("DREAM_OPERATION_NOT_FOUND",404);const parsed=contract.input.safeParse(input);if(!parsed.success)throw new AuthBoundaryError("INPUT_INVALID",400);const principal=principalDto.parse(actor.principal);if(actor.threadScope!==null)throw new AuthBoundaryError("DREAM_DELEGATION_SCOPE_REQUIRED",403);if(!principal.scopes.includes(contract.kind==="read"?"dream:read":"dream:write"))throw new AuthBoundaryError("DREAM_SCOPE_REQUIRED",403);
 const store=new DeckVoiceRepository(tx,principal.canonical_user_id,policy);let output:unknown;
 switch(operation){
 case"deck.list":output={decks:await store.list(dto.deckListInputDto.parse(parsed.data).community)};break;
 case"deck.detail":output={deck:await store.detail(dto.deckIdInputDto.parse(parsed.data).deck_id)};break;
 case"deck.create":{const result=await store.create(dto.deckCreateInputDto.parse(parsed.data));output={deck_id:result.id};break;}
 case"deck.update":output={changed:await store.update(dto.deckUpdateInputDto.parse(parsed.data))};break;
 case"deck.delete":output={changed:await store.delete(dto.deckIdInputDto.parse(parsed.data).deck_id)};break;
 case"deck.toggle-publication":output={published:await store.togglePublication(dto.deckIdInputDto.parse(parsed.data).deck_id)};break;
 case"deck.collect":output={deck_id:await store.collect(dto.deckIdInputDto.parse(parsed.data).deck_id)};break;
 case"deck.sync-parent":output=await store.syncParent(dto.deckIdInputDto.parse(parsed.data).deck_id);break;
 case"deck.reconcile-default":output=await store.reconcileDefault((parsed.data as z.infer<typeof dto.deckVoiceOperationContracts["deck.reconcile-default"]["input"]>).default_plugin_evidence);break;
 case"deck.provision-default":output={deck_id:await store.provisionDefault((parsed.data as z.infer<typeof dto.deckVoiceOperationContracts["deck.provision-default"]["input"]>).default_plugin_evidence)};break;
 case"voice.create":output={voice_id:await store.createVoice(dto.voiceCreateInputDto.parse(parsed.data))};break;
 case"voice.update":output={changed:await store.updateVoice(dto.voiceUpdateInputDto.parse(parsed.data))};break;
 case"voice.delete":output={changed:await store.deleteVoice(dto.voiceIdInputDto.parse(parsed.data).voice_id)};break;
 case"voice.collect":{const v=dto.voiceForkInputDto.parse(parsed.data);output={voice_id:await store.collectVoice(v.voice_id,v.target_deck_id)};break;}
 case"deck-content.state":output=await store.state(dto.deckIdInputDto.parse(parsed.data).deck_id);break;
 case"deck-content.preview":output=await store.preview(dto.deckVersionMutationInputDto.parse(parsed.data));break;
 case"deck-content.commit":output=await store.commit(dto.deckVersionCommitInputDto.parse(parsed.data));break;
 case"deck-content.history":output=await store.history(dto.deckVersionHistoryInputDto.parse(parsed.data));break;
 case"deck-content.detail":output=await store.version(dto.deckVersionDetailInputDto.parse(parsed.data));break;
 }
 return contract.output.parse(output);
}
