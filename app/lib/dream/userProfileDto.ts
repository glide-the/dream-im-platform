// [Input] Current canonical profile business fields, separate from ORM entities.
// [Output] Strict decimal ID/ISO time/provider label DTO.
// [Pos] Current-user wire contract; no credentials or arbitrary caller identity.
import { z } from "zod";
import { decimalIdDto, isoTimeDto } from "../auth/dto";
export const userProfileInputDto = z.strictObject({});
export const userProfileOutputDto = z.strictObject({ user: z.strictObject({ id: decimalIdDto, email: z.email(), display_name: z.string().nullable(), avatar_url: z.string().nullable(), role: z.string(), created_at: isoTimeDto.nullable(), updated_at: isoTimeDto.nullable(), auth_providers: z.array(z.enum(["google", "credential"])) }) });
