// [Input] First-admin setup status or strict bootstrap request.
// [Output] Existing one-time setup behavior with sole Better Auth Session.
// [Pos] Thin route; control UOW, minimum-password policy and audit are domain-owned.
import { handleAdminBootstrap, handleAdminBootstrapStatus } from "../../../../lib/auth/adminAuthHandler";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const GET = handleAdminBootstrapStatus;
export const POST = handleAdminBootstrap;
