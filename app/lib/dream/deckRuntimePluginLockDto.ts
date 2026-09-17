// [Input] Original persisted RuntimePluginLock JSON and existing Manifest string/SemVer/bool rules.
// [Output] Strict typed lock with original defaults and legacy datetime acceptance; raw hash bytes stay separate.
// [Pos] Shared Plugin/Workflow metadata validator, without deployment-name behavior or Runtime execution.
// [Sync] 2026-09-15: reuse Manifest encodings and validate datetime without re-encoding canonical lock JSON.
import { z } from "zod";
import { deckPluginManifestDto, stripPydanticString } from "./deckPluginManifestDto";
const text = z.string().overwrite(stripPydanticString);
const manifestPlugin = deckPluginManifestDto.shape.runtime.shape.claude_code_plugins.element;

// Pydantic's persisted datetime accepts date-only, local ISO and Unix seconds/
// milliseconds as well as offset ISO. These are serialization rules, not
// business policy. The timestamp is never used to hash or decide readiness.
function validLegacyDatetime(value: string | number) {
  if (typeof value === "number" || /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)$/.test(value)) {
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) return false;
    const date = new Date(Math.abs(numeric) > 20_000_000_000 ? numeric : numeric * 1_000);
    return Number.isFinite(date.getTime()) && date.getUTCFullYear() >= 1 && date.getUTCFullYear() <= 9999;
  }
  const match = /^(\d{4})-(\d{2})-(\d{2})(?:[Tt _](\d{2}):(\d{2})(?::(\d{2})(?:[.,](\d+))?)?(?:[Zz]|([+-])(\d{2}):?(\d{2}))?)?$/.exec(value);
  if (!match) return false;
  const [, yearText, monthText, dayText, hourText, minuteText, secondText, , , offsetHour, offsetMinute] = match;
  const year = Number(yearText), month = Number(monthText), day = Number(dayText);
  const date = new Date(0); date.setUTCFullYear(year, month - 1, day); date.setUTCHours(0, 0, 0, 0);
  return year >= 1 && date.getUTCFullYear() === year && date.getUTCMonth() + 1 === month && date.getUTCDate() === day
    && Number(hourText ?? 0) <= 23 && Number(minuteText ?? 0) <= 59 && Number(secondText ?? 0) <= 59
    && Number(offsetHour ?? 0) <= 23 && Number(offsetMinute ?? 0) <= 59;
}
export const deckRuntimePluginLockDto = z.strictObject({
  runtime_plugin_lock_id: text.regex(/^rpl_[0-9a-f]{32}$/), deck_plugin_id: text, deck_plugin_version: text,
  deck_plugin_manifest_hash: text.regex(/^sha256:[0-9a-f]{64}$/),
  claude_code_plugins: z.array(z.strictObject({ claude_code_plugin_id: text.min(1), resolved_version: deckPluginManifestDto.shape.deck_plugin_version,
    source_ref: text.min(1), artifact_digest: text.refine(value => value === "" || /^sha256:[0-9a-f]{64}$/.test(value)),
    required: manifestPlugin.shape.required, capability_bindings: z.array(text).default([]) })),
  created_at: z.union([z.string(), z.number()]).refine(validLegacyDatetime),
  production_ready: manifestPlugin.shape.required.default(false), production_readiness_reasons: z.array(text).default([]),
});
export type DeckRuntimePluginLock = z.infer<typeof deckRuntimePluginLockDto>;
export function parseDeckRuntimePluginLock(raw: unknown) {
  try { return deckRuntimePluginLockDto.safeParse(typeof raw === "string" ? JSON.parse(raw) : raw); }
  catch { return deckRuntimePluginLockDto.safeParse(null); }
}
