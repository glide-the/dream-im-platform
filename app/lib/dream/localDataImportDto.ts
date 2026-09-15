// [Input] Dream-normalized local Session, Picture, Preferences, Report collections or first-login completion.
// [Output] Two strict OAuth write contracts with raw JSON text and accepted business counts.
// [Pos] Registry101 local-data boundary; identity, SQL and physical selectors never cross the wire.
// [Sync] 2026-09-15: preserve the legacy aggregate transaction and first-login result without JSON number coercion.
import { z } from "zod";
import { isoTimeDto } from "../auth/dto";

function isJsonObjectText(value: string) {
  try {
    const parsed: unknown = JSON.parse(value);
    return parsed !== null && typeof parsed === "object" && !Array.isArray(parsed);
  } catch {
    return false;
  }
}

export const localDataJsonObjectTextDto = z.string().refine(isJsonObjectText);
const identifier = z.string().min(1);
export const localDataSessionDto = z.strictObject({
  id: identifier,
  name: z.string().nullable(),
  editor_state: localDataJsonObjectTextDto,
});
export const localDataPictureDto = z.strictObject({
  date: z.iso.date(),
  image_base64: z.string().min(1),
  prompt: z.string().nullable(),
});
export const localDataPreferencesDto = z.strictObject({
  voice_configs: localDataJsonObjectTextDto.nullable(),
  meta_prompt: z.string().nullable(),
  state_config: localDataJsonObjectTextDto.nullable(),
  selected_state: z.string().nullable(),
});
export const localDataReportDto = z.strictObject({
  type: identifier,
  data: localDataJsonObjectTextDto,
  all_notes: z.string(),
  timestamp: isoTimeDto,
});

export const localDataImportInputDto = z.strictObject({
  sessions: z.array(localDataSessionDto).refine(items => new Set(items.map(item => item.id)).size === items.length),
  pictures: z.array(localDataPictureDto),
  preferences: localDataPreferencesDto.nullable(),
  reports: z.array(localDataReportDto),
});
export const localDataImportOutputDto = z.strictObject({
  success: z.literal(true),
  imported: z.strictObject({
    sessions: z.number().int().nonnegative(),
    pictures: z.number().int().nonnegative(),
    preferences: z.number().int().min(0).max(4),
    reports: z.number().int().nonnegative(),
  }),
});
export const firstLoginCompleteOutputDto = z.strictObject({
  success: z.literal(true),
  first_login_completed: z.literal(1),
});

export const localDataImportOperationContracts = {
  "local-data.import": { kind: "write" as const, userScope: "dream:write", input: localDataImportInputDto, output: localDataImportOutputDto },
  "first-login.complete": { kind: "write" as const, userScope: "dream:write", input: z.strictObject({}), output: firstLoginCompleteOutputDto },
};
export type LocalDataImportInput = z.infer<typeof localDataImportInputDto>;
export type LocalDataImportOperation = keyof typeof localDataImportOperationContracts;
