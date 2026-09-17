// [Input] JSON-compatible DTO, contract or operation receipt value.
// [Output] Stable key-sorted compact JSON text used by hashes and idempotency keys.
// [Pos] Dependency-free canonical codec shared below the operation registry and receipt boundary.
// [Sync] 2026-09-15: break the Registry108 receipt/service cycle without changing canonical bytes.
export function canonicalContractJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalContractJson).join(",")}]`;
  if (value !== null && typeof value === "object") return `{${Object.entries(value)
    .sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0)
    .map(([key, item]) => `${JSON.stringify(key)}:${canonicalContractJson(item)}`).join(",")}}`;
  return JSON.stringify(value);
}
