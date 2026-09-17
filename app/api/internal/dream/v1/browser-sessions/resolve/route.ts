// [Input] BFF handle DTO and separate service identity.
// [Output] Server-only access token and principal envelope.
// [Pos] Thin internal ingress, no SQL or refresh state here.
// [Sync] 2026-09-14: unified BFF handle resolution.
export { handleBrowserResolve as POST } from "@/lib/auth/browserSessionHandler";
export const runtime = "nodejs";
