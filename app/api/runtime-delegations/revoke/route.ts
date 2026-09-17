// [Input] Existing entity-limited bearer and request ID.
// [Output] Revocation of the same grant.
// [Pos] Thin runtime bearer ingress.
import { handleDelegationRevoke } from "../../../lib/auth/delegationHandler";
export const runtime = "nodejs";
export const POST = handleDelegationRevoke;
