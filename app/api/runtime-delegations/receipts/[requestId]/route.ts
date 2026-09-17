// [Input] Original renewal/revocation request ID and that opaque bearer only.
// [Output] Bounded committed/absent action receipt; an expired result grants no new authority.
// [Pos] Thin public Runtime unknown-response recovery ingress.
import { handleDelegationReceipt } from "../../../../lib/auth/delegationHandler";
export const runtime = "nodejs";
export async function GET(request: Request, context: { params: Promise<{ requestId: string }> }) { return handleDelegationReceipt(request, (await context.params).requestId); }
