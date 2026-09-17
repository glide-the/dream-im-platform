// [Input] Closed diagnostics publish request.
// [Output] DB-clock receipt through Admin-owned domain service.
// [Pos] Internal v1 thin ingress.
import { handleResourceObserverPublish } from "../../../../../../lib/dream/resourceHandler";
export const runtime = "nodejs";
export const POST = handleResourceObserverPublish;
