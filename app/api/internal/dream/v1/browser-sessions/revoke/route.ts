// [Input] BFF handle DTO and separate service identity.
// [Output] Idempotent domain revocation envelope.
// [Pos] Thin internal ingress, no SQL or token state here.
// [Sync] 2026-09-14: unified BFF logout.
export { handleBrowserRevoke as POST } from "@/lib/auth/browserSessionHandler";
export const runtime = "nodejs";
