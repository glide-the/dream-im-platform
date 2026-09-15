// [Input] Existing entity-limited bearer and request ID.
// [Output] Bounded renewal, never a broader grant.
// [Pos] Thin runtime bearer ingress.
import { handleDelegationRenew } from "../../../lib/auth/delegationHandler";
export const runtime = "nodejs";
export const POST = handleDelegationRenew;
