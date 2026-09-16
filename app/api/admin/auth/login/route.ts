// [Input] Admin-host authentication request.
// [Output] Independent Admin Session response with strict management-domain authorization.
// [Pos] Thin Admin auth route; validation, ORM and audit remain in app/lib/auth.
// [Sync] 2026-09-17: authenticate only Admin credentials and never a Dream user or OAuth subject.
import { handleAdminSignIn } from "../../../../lib/auth/adminAuthHandler";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const POST = handleAdminSignIn;
