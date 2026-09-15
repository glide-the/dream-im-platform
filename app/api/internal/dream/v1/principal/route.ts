// [Input] Dream user OAuth access token and separate service identity.
// [Output] Active principal DTO.
// [Pos] Thin internal ingress, no SQL/identity mapping here.
// [Sync] 2026-09-14: explicit canonical linkage.
export { handlePrincipal as GET } from "@/lib/auth/principalHandler";
export const runtime = "nodejs";
