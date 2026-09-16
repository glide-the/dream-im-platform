// [Input] Admin-host authentication request.
// [Output] Independent Admin Session revocation response.
// [Pos] Thin Admin auth route; validation, ORM and audit remain in app/lib/auth.
// [Sync] 2026-09-17: revoke only the independent Admin management session.
import { handleAdminSignOut } from "../../../../lib/auth/adminAuthHandler";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const POST = handleAdminSignOut;
