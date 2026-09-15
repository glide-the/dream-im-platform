// [Input] Admin-owned aggregate facts with raw memory/base JSON and a configured canonical-operation deadline.
// [Output] Python-compatible v1 hash/diff; never parses legacy numeric payload through JS Number.
// [Pos] Fixed local pure helper, no shell, DB, network, user executable or Runtime configuration.
// [Sync] 2026-09-15: preserve raw provenance/memory/capability decoding with bounded safe transport.
import { spawn } from "node:child_process";
import { resolve } from "node:path";
import { z } from "zod";
import { AuthBoundaryError, requiredAuthValue } from "../auth/config";
import { deckVersionChangeDto } from "./deckVoiceDto";
const snapshotResult = z.strictObject({ canonical_json: z.string(), content_hash: z.string().regex(/^sha256:[0-9a-f]{64}$/), changes: z.array(deckVersionChangeDto), no_changes: z.boolean() });
const memoryResult = z.strictObject({ canonical_json: z.string(), equal: z.boolean() });
async function invoke(input: unknown) {
  const timeout = Number(requiredAuthValue("DREAM_DOMAIN_CANONICAL_TIMEOUT_MS"));
  if (!Number.isSafeInteger(timeout) || timeout <= 0) throw new AuthBoundaryError("DECK_CANONICAL_NOT_CONFIGURED");
  return new Promise<unknown>((done, reject) => {
    const child = spawn("python3", ["-I", "-S", resolve(process.cwd(), "app/lib/dream/deckContentCanonical.py")], { shell: false, env: { PATH: process.env.PATH } as unknown as NodeJS.ProcessEnv, stdio: "pipe" });
    const chunks: Buffer[] = []; let failed = false;
    const failure = () => { if (!failed) { failed = true; clearTimeout(timer); reject(new AuthBoundaryError("DECK_CANONICAL_UNAVAILABLE")); } };
    const timer = setTimeout(() => { child.kill(); failure(); }, timeout);
    child.stdout.on("data", chunk => chunks.push(chunk)); child.stderr.resume();
    child.on("error", failure); child.stdin.on("error", failure);
    child.on("close", code => { clearTimeout(timer); if (failed) return; if (code !== 0) return failure(); try { done(JSON.parse(Buffer.concat(chunks).toString("utf8"))); } catch { failure(); } });
    child.stdin.end(JSON.stringify(input));
  });
}
export async function analyzeDeckSnapshot(facts: unknown, baseJson: string | null) { return snapshotResult.parse(await invoke({ action: "snapshot", facts, base_json: baseJson })); }
export async function canonicalMemory(left: string | null, right: string | null) { return memoryResult.parse(await invoke({ action: "memory", left, right })); }

// Internal business provenance codec; no HTTP operation or SQL selector is exposed.
export async function canonicalBusinessJson(rawBusinessJson: string) { return z.strictObject({canonical_json:z.string(),content_hash:z.string().regex(/^sha256:[0-9a-f]{64}$/)}).parse(await invoke({action:"canonical",json_text:rawBusinessJson})); }

const confirmationEnvelopeResult = z.discriminatedUnion("status", [
 z.strictObject({status:z.literal("invalid")}),
 z.strictObject({status:z.literal("valid"),story_workspace_run_id:z.string().min(1),thread_id:z.string().min(1),idempotency_key:z.string().min(1),command_json:z.string(),command_fingerprint:z.string().regex(/^sha256:[a-f0-9]{64}$/),message_id:z.string().regex(/^dream_confirm_[a-f0-9]{64}$/),parts_canonical_json:z.string()}),
]);
export async function analyzeConfirmationEnvelope(rawPartsJson:string,actorId:string){return confirmationEnvelopeResult.parse(await invoke({action:"confirmation-envelope",raw_parts_json:rawPartsJson,actor_id:actorId}));}
export async function compareConfirmationClaims(storedMetadataJson:string,incomingMetadataJson:string){return z.strictObject({equal:z.boolean()}).parse(await invoke({action:"confirmation-claims",stored_metadata_json:storedMetadataJson,incoming_metadata_json:incomingMetadataJson}));}

// Preserve original Python dictionary detection without decoding stored numeric JSON through JS Number.
export async function inspectMemoryConfig(rawMemoryJson:string|null){return z.strictObject({is_object:z.boolean()}).parse(await invoke({action:"memory-inspect",json_text:rawMemoryJson}));}

// Three original callers intentionally decode approved JSON differently; use
// Python for legacy nonfinite values and hashable set/string/dictionary rules.
export async function inspectPluginCapabilitySets(rawJson: string | null) {
  return z.strictObject({ context_names: z.array(z.string()), approved_names: z.array(z.string()), preflight_names: z.array(z.string()) })
    .parse(await invoke({ action: "plugin-capability-sets", json_text: rawJson }));
}
