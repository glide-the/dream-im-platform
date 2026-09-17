// [Input] Closed Deck/Voice wire fields and exact legacy numeric-text codec.
// [Output] No arbitrary identity/column selectors, lexical preservation and strict snapshot tests.
// [Pos] Meaningful provider-free contract boundaries; no business persistence.
// [Sync] 2026-09-14: protect complete v1 snapshot and Unicode description semantics.
import {describe,it,expect} from "vitest";
import * as dto from "./deckVoiceDto";
describe("Deck wire boundary",()=>{
 it("retains float/integer/Unicode memory JSON bytes without JS numeric reencoding",()=>{const raw='{"float":1.0,"integer":9007199254740993,"negative_zero":-0.0,"中文":"😀"}';const v=dto.voiceUpdateInputDto.parse({voice_id:"voice",updates:{memory_workspace_config_json:raw}});expect(v.updates.memory_workspace_config_json).toBe(raw);});
 it.each(['bad','[]','1','null','"string"'])("rejects non-object memory input %s",raw=>expect(dto.voiceUpdateInputDto.safeParse({voice_id:"voice",updates:{memory_workspace_config_json:raw}}).success).toBe(false));
 it("rejects arbitrary user ID and physical updates",()=>{expect(dto.deckUpdateInputDto.safeParse({deck_id:"deck",user_id:"1",updates:{name:"next"}}).success).toBe(false);for(const field of ["owner_id","is_system","published","latest_version","sql"]){expect(dto.deckUpdateInputDto.safeParse({deck_id:"deck",updates:{[field]:"1"}}).success).toBe(false);}});
 it("requires explicit CAS state, preserves Unicode codepoint200 description",()=>{expect(dto.deckVersionMutationInputDto.safeParse({deck_id:"deck",expected_draft_revision:1}).success).toBe(false);expect(dto.deckVersionCommitInputDto.parse({deck_id:"deck",expected_draft_revision:1,expected_base_version:null,description:"😀".repeat(200)}).description).toHaveLength(400);expect(dto.deckVersionCommitInputDto.safeParse({deck_id:"deck",expected_draft_revision:1,expected_base_version:null,description:"😀".repeat(201)}).success).toBe(false);});
 it("has19 closed actual input/output pairs and no generic snapshot record",()=>{expect(Object.keys(dto.deckVoiceOperationContracts)).toHaveLength(19);expect(dto.deckContentSnapshotDto.safeParse({schema_version:"deck-content/v1",extra:true}).success).toBe(false);expect(dto.deckContentSnapshotDto.safeParse({schema_version:"deck-content/v1",deck:{},agents:[],claude_plugins:[],runtime_binding:null,agent_type:"dream"}).success).toBe(false);});
});
