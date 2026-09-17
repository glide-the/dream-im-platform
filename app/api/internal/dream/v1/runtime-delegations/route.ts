// [Input] Service/user-authorized delegation creation.
// [Output] Entity-bound opaque credential.
// [Pos] Thin internal creation ingress.
import { handleDelegationCreate } from "../../../../../lib/auth/delegationHandler";
export const runtime = "nodejs";
export const POST = handleDelegationCreate;
