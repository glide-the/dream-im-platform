// [Input] Closed diagnostics publish request.
// [Output] DB-clock receipt through Admin-owned domain service.
// [Pos] Internal v1 thin ingress.
// [Sync] 2026-11-19: record the resource-observer handler and shared Dream operation stages.
import { handleResourceObserverPublish } from "../../../../../../lib/dream/resourceHandler";
import { getDreamOperationTrace } from "../../../../../../lib/dream/operationRegistry";
import { traceDreamOperationHandler } from "../../../../../../lib/observability/dreamOperationTrace";

export const runtime = "nodejs";
export function POST(request: Request) {
  return traceDreamOperationHandler(getDreamOperationTrace("resource-observer.publish"),
    "handleResourceObserverPublish", "app/lib/dream/resourceHandler.ts", () => handleResourceObserverPublish(request));
}
