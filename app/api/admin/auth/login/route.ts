// [Input] Admin-host authentication request.
// [Output] Better Auth Session compatibility response with strict domain authorization.
// [Pos] Thin Admin auth route; validation, ORM and audit remain in app/lib/auth.
import { handleAdminSignIn } from "../../../../lib/auth/adminAuthHandler";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const POST = handleAdminSignIn;
