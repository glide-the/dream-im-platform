// [Input] Raw stored envelope and server-derived clock/context/claim overlays.
// [Output] Typed inspection and canonical stored/Runtime envelope strings preserving unknown numeric facts.
// [Pos] Fixed launch codec facade; pure transport is shared and paths are never request-selected.
// [Sync] 2026-09-15: separate dispatch decisions in the service from canonical JSON/time encoding.
import { z } from "zod";
import { dreamLaunchProtocolPolicy as policy } from "../../../config/dream-launch-policy";
import { invokeFixedDomainCodec } from "./fixedDomainCodec";
import { dreamLaunchDispatchContextDto } from "./dreamLaunchDispatchDto";

const nullableText = z.string().nullable();
const inspectDto = z.strictObject({ kind: nullableText, actor_id: nullableText, workspace_id: nullableText, deck_id: nullableText,
  agent_id: nullableText, agent_valid: z.boolean(), goal: nullableText, idempotency_key: nullableText, request_fingerprint: nullableText,
  workflow_run_id: nullableText, run_valid: z.boolean(), dispatch_status: nullableText, claim_id: nullableText, claim_fresh: z.boolean() });
export async function inspectDreamLaunchEnvelope(metadataJson: string | null, now: string) {
  return inspectDto.parse(await invokeFixedDomainCodec("launchEnvelope", { action: "inspect", metadata_json: metadataJson, now, ttl_seconds: policy.dispatchClaimTtlSeconds }));
}
export async function overlayDreamLaunchClaim(metadataJson: string | null, facts: { context: z.output<typeof dreamLaunchDispatchContextDto>; claim_id: string; now: string; project_slug: string; instruction_text: string }) {
  return z.strictObject({ metadata_json: z.string(), runtime_metadata_json: z.string(), parts_json: z.string() })
    .parse(await invokeFixedDomainCodec("launchEnvelope", { action: "claim-overlay", metadata_json: metadataJson, ...facts }));
}
export async function overlayDreamLaunchFinish(metadataJson: string | null, accepted: boolean) {
  return z.strictObject({ metadata_json: z.string() }).parse(await invokeFixedDomainCodec("launchEnvelope", { action: "finish-overlay", metadata_json: metadataJson, accepted }));
}
