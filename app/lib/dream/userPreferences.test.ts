// [Input] Actual strict preferences DTO/service, typed repository seams and pure raw JSON inspection.
// [Output] Focused precision/NULL/closed-field/scope/projection assertions without a database/provider.
// [Pos] Domain validation; public Drizzle merge/concurrency and receipt require isolated contract evidence.
// [Sync] 2026-09-15: cover source config behavior without mirroring the SQL implementation.
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { UserPreferencesRepository } from "./userPreferencesRepository";
import { runUserPreferencesOperation } from "./userPreferencesService";
import { userPreferencesOperationContracts, userPreferencesSaveInputDto } from "./userPreferencesDto";
import type { DataTransaction } from "./database";
import type { ChatThreadActor } from "./chatThreadService";
const actor: ChatThreadActor = { principal: {subject:"preferences-subject",canonical_user_id:"9007199254740993",client_id:"dream-browser",scopes:["dream:read","dream:write"],status:"active"},threadScope:null };
const tx={} as DataTransaction, empty={voice_configs_json:null,meta_prompt:null,state_config_json:null,selected_state:null,timezone:null};
beforeEach(()=>vi.stubEnv("DREAM_DOMAIN_CANONICAL_TIMEOUT_MS","5000"));
afterEach(()=>{vi.restoreAllMocks();vi.unstubAllEnvs();});
describe("strict owner preference DTO",()=>{
 it.each(["user_id","actor","first_login_completed","system_config_json","table","sql"])("rejects caller-authored %s",key=>{expect(userPreferencesSaveInputDto.safeParse({...empty,[key]:"caller"}).success).toBe(false);});
 it("retains exact config text and NULL/blank strings",()=>{const input={...empty,voice_configs_json:'{"counter":9007199254740993,"float":1.0}',meta_prompt:"",timezone:""};expect(userPreferencesSaveInputDto.parse(input)).toEqual(input);});
 it("requires the closed explicit merge shape",()=>{expect(userPreferencesSaveInputDto.safeParse({timezone:"Asia/Shanghai"}).success).toBe(false);expect(userPreferencesOperationContracts["user-preferences.get"].input.safeParse({user_id:"1"}).success).toBe(false);});
});
describe("preference business service",()=>{
 it("returns explicit absent preference",async()=>{vi.spyOn(UserPreferencesRepository.prototype,"get").mockResolvedValue(null);expect(await runUserPreferencesOperation("user-preferences.get",{},actor,tx)).toEqual({preferences:null});});
 it("preserves raw bigint/float JSON and exact NULL/offset microseconds",async()=>{const row={...empty,voice_configs_json:'{"counter":9007199254740993,"float":1.0}',state_config_json:'{"enabled":false}',first_login_completed:null,updated_at:"2026-09-14 08:00:00.123456+08"};vi.spyOn(UserPreferencesRepository.prototype,"get").mockResolvedValue(row);expect(await runUserPreferencesOperation("user-preferences.get",{},actor,tx)).toEqual({preferences:{...row,updated_at:"2026-09-14T08:00:00.123456+08:00"}});});
 it("maps original empty stored JSON text to null without a repair",async()=>{const save=vi.spyOn(UserPreferencesRepository.prototype,"save").mockResolvedValue(undefined);vi.spyOn(UserPreferencesRepository.prototype,"get").mockResolvedValue({...empty,voice_configs_json:"",state_config_json:"",first_login_completed:0,updated_at:null});expect(await runUserPreferencesOperation("user-preferences.get",{},actor,tx)).toEqual({preferences:{...empty,first_login_completed:0,updated_at:null}});expect(save).not.toHaveBeenCalled();});
 it("passes one exact partial merge to the existing UOW",async()=>{const save=vi.spyOn(UserPreferencesRepository.prototype,"save").mockResolvedValue(undefined),input={...empty,voice_configs_json:'{"float":1.0,"counter":9007199254740993}',meta_prompt:"",timezone:"Asia/Shanghai"};expect(await runUserPreferencesOperation("user-preferences.save",input,actor,tx)).toEqual({success:true});expect(save).toHaveBeenCalledExactlyOnceWith(input);});
 it.each(["[]","null","broken","1"])("rejects invalid config object %s before write",async raw=>{const save=vi.spyOn(UserPreferencesRepository.prototype,"save").mockResolvedValue(undefined);await expect(runUserPreferencesOperation("user-preferences.save",{...empty,state_config_json:raw},actor,tx)).rejects.toMatchObject({code:"INPUT_INVALID",status:400});expect(save).not.toHaveBeenCalled();});
 it("fails closed for invalid stored config",async()=>{vi.spyOn(UserPreferencesRepository.prototype,"get").mockResolvedValue({...empty,state_config_json:"broken",first_login_completed:1,updated_at:null});await expect(runUserPreferencesOperation("user-preferences.get",{},actor,tx)).rejects.toMatchObject({code:"USER_PREFERENCES_DATA_INVALID",status:503});});
 it("rejects insufficient scope before repository calls",async()=>{const save=vi.spyOn(UserPreferencesRepository.prototype,"save").mockResolvedValue(undefined);await expect(runUserPreferencesOperation("user-preferences.save",empty,{...actor,principal:{...actor.principal,scopes:["dream:read"]}},tx)).rejects.toMatchObject({status:403});expect(save).not.toHaveBeenCalled();});
 it("rejects entity delegation before repository calls",async()=>{const get=vi.spyOn(UserPreferencesRepository.prototype,"get").mockResolvedValue(null);await expect(runUserPreferencesOperation("user-preferences.get",{},{...actor,threadScope:"other-thread"},tx)).rejects.toMatchObject({status:403});expect(get).not.toHaveBeenCalled();});
});
