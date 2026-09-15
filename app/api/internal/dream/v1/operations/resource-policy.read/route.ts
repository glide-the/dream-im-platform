// [Input] Resource policy domain request.
// [Output] Strict state projection through Admin-owned domain service.
// [Pos] Internal v1 thin ingress.
import { handleResourcePolicyRead } from "../../../../../../lib/dream/resourceHandler";
export const runtime = "nodejs";
export const POST = handleResourcePolicyRead;
