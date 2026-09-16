// [Input] First-admin setup status or strict bootstrap request.
// [Output] Existing one-time setup behavior with an independent Admin Session.
// [Pos] Thin route; control UOW, minimum-password policy and audit are domain-owned.
// [Sync] 2026-09-17: return the independent Admin session created by the bootstrap domain service.
import { handleAdminBootstrap, handleAdminBootstrapStatus } from "../../../../lib/auth/adminAuthHandler";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const GET = handleAdminBootstrapStatus;
export const POST = handleAdminBootstrap;
