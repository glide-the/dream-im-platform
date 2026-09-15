// [Input] BFF code exchange DTO and separate service identity.
// [Output] Opaque handle envelope from the authentication domain.
// [Pos] Thin internal ingress, no SQL or token state here.
// [Sync] 2026-09-14: unified BFF exchange.
export { handleBrowserExchange as POST } from "@/lib/auth/browserSessionHandler";
export const runtime = "nodejs";
