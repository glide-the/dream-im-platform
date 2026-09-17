// [Input] RFC8414 discovery for the configured /api/auth issuer.
// [Output] Provider metadata from the unified auth handler.
// [Pos] OAuth metadata routing, no independently maintained protocol claims.
// [Sync] 2026-09-14: forward issuer discovery outside the auth catch-all.
export { handleAuthRequest as GET } from "@/lib/auth/server";
export const runtime = "nodejs";
