// [Input] One canonical user turn with raw business parts/metadata and the existing pure title candidate.
// [Output] Strict atomic persistence result; reserved control records are retained without rewriting claims.
// [Pos] Named user-turn command, preserving Python JSON numeric bytes across the API boundary.
// [Sync] 2026-09-15: no role, actor, table, Run selector or arbitrary column update is accepted.
import { z } from "zod";

const partsJson = z.string().refine(value => { try { return Array.isArray(JSON.parse(value)); } catch { return false; } }).meta({ contentMediaType: "application/json" });
const metadataJson = z.string().refine(value => { try { const parsed: unknown = JSON.parse(value); return parsed !== null && typeof parsed === "object" && !Array.isArray(parsed); } catch { return false; } }).meta({ contentMediaType: "application/json" });
export const userMessageInputDto = z.strictObject({ thread_id: z.string().min(1), message_id: z.string().min(1), parts_json: partsJson, metadata_json: metadataJson.nullable(), title_candidate: z.string() });
export const userMessageOutputDto = z.strictObject({ message_id: z.string().min(1), confirmation_preserved: z.boolean() });
export const userMessageOperationContracts = {
  "chat-user-message.persist": { kind: "write" as const, input: userMessageInputDto, output: userMessageOutputDto, userScope: "dream:write" },
};
export type UserMessageInput = { thread_id: string; message_id: string; parts_json: string; metadata_json: string | null; title_candidate: string };
