// [Input] Resource policy domain request.
// [Output] Strict state projection through Admin-owned domain service.
// [Pos] Internal v1 thin ingress.
// [Sync] 2026-11-19: record the resource-policy handler and shared Dream operation stages.
import { handleResourcePolicyRead } from "../../../../../../lib/dream/resourceHandler";
import { getDreamOperationTrace } from "../../../../../../lib/dream/operationRegistry";
import { traceDreamOperationHandler } from "../../../../../../lib/observability/dreamOperationTrace";

export const runtime = "nodejs";
export function POST(request: Request) {
  return traceDreamOperationHandler(getDreamOperationTrace("resource-policy.read"),
    "handleResourcePolicyRead", "app/lib/dream/resourceHandler.ts", () => handleResourcePolicyRead(request));
}
