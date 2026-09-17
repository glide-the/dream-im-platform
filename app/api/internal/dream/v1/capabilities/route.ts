// [Input] Dream service capability-read credential.
// [Output] Actual schema capability/config DTO and validated API operation inventory.
// [Pos] Thin internal readiness ingress, no DDL/global-head logic.
// [Sync] 2026-09-14: explicit published capabilities.
export { handleCapabilities as GET } from "@/lib/auth/capabilitiesHandler";
export const runtime = "nodejs";
