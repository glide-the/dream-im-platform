// [Input] Verified canonical actor, closed launch content and server clock.
// [Output] Original UUIDv5 source identity, content fingerprint, title and hidden metadata.
// [Pos] Pure launch source projection; existing canonical JSON codec owns hash bytes.
// [Sync] 2026-09-15: preserve actual launch callsite omission of null Agent in content fingerprint.
import { createHash } from "node:crypto";
import { dreamLaunchProtocolPolicy as policy } from "../../../config/dream-launch-policy";
import { decimalIdDto } from "../auth/dto";
import { canonicalMessageJson } from "./chatThreadDto";
import { canonicalBusinessJson } from "./deckContentCanonical";
import type { DreamLaunchSourceEnsureInput } from "./dreamLaunchSourceDto";

function uuidV5(name: string) {
  const digest = createHash("sha1").update(Buffer.from(policy.uuidNamespaceUrl.replaceAll("-", ""), "hex")).update(name, "utf8").digest();
  digest[6] = (digest[6] & 0x0f) | 0x50;
  digest[8] = (digest[8] & 0x3f) | 0x80;
  const hex = digest.subarray(0, 16).toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
export async function dreamLaunchSourceIdentity(actor: string, input: DreamLaunchSourceEnsureInput) {
  const canonicalActor = decimalIdDto.parse(actor);
  const scope = await canonicalBusinessJson(JSON.stringify({ actor_id: canonicalActor, workspace_id: input.workspace_id, idempotency_key: input.idempotency_key }));
  const fingerprintPayload: Record<string, string> = { deck_id: input.deck_id, goal: input.goal };
  if (input.agent_id !== null) fingerprintPayload.agent_id = input.agent_id;
  const fingerprint = await canonicalBusinessJson(JSON.stringify(fingerprintPayload));
  return { threadId: uuidV5(policy.threadIdentityPrefix + scope.canonical_json), messageId: uuidV5(policy.messageIdentityPrefix + scope.canonical_json),
    requestFingerprint: fingerprint.content_hash };
}
export function dreamLaunchSourceEnvelope(actor: string, input: DreamLaunchSourceEnsureInput, requestFingerprint: string) {
  const metadata = { kind: policy.metadataKind, schemaVersion: policy.metadataVersion, visibility: "system-hidden",
    actorId: decimalIdDto.parse(actor), workspaceId: input.workspace_id, deckId: input.deck_id, agentId: input.agent_id,
    goal: input.goal, idempotencyKey: input.idempotency_key, requestFingerprint, dispatchStatus: "pending" };
  return { title: policy.titlePrefix + Array.from(input.goal).slice(0, policy.titleGoalMaxCharacters).join(""),
    parts: canonicalMessageJson([{ type: "text", text: input.goal }]), metadata: canonicalMessageJson(metadata) };
}
