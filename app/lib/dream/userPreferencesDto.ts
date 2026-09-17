// [Input] Five closed user preference fields with raw config JSON and no caller identity selectors.
// [Output] Strict named input/result DTOs preserving NULL, first-login integers and exact nullable time.
// [Pos] Current OAuth owner preference contract; server Runtime config is outside this write surface.
// [Sync] 2026-09-15: preserve original partial merge and numeric JSON bytes without browser policy.
import { z } from "zod";
import { isoTimeDto } from "../auth/dto";
export const userPreferencesSaveInputDto = z.strictObject({
  voice_configs_json: z.string().nullable(), meta_prompt: z.string().nullable(),
  state_config_json: z.string().nullable(), selected_state: z.string().nullable(), timezone: z.string().nullable(),
});
export const userPreferencesDto = userPreferencesSaveInputDto.extend({
  first_login_completed: z.number().int().nullable(), updated_at: isoTimeDto.nullable(),
});
export const userPreferencesOperationContracts = {
  "user-preferences.get": { kind: "read" as const, input: z.strictObject({}), output: z.strictObject({ preferences: userPreferencesDto.nullable() }), userScope: "dream:read" },
  "user-preferences.save": { kind: "write" as const, input: userPreferencesSaveInputDto, output: z.strictObject({ success: z.literal(true) }), userScope: "dream:write" },
};
export type UserPreferencesSaveInput = z.infer<typeof userPreferencesSaveInputDto>;
export type UserPreferencesOperation = keyof typeof userPreferencesOperationContracts;
