// [Input] Explicit reviewed Dream canonical identity IDs and pinned source/Google fingerprints.
// [Output] Exact Dream subject adoption plan preserving old PKs/hashes; Admin-domain input fails closed.
// [Pos] Pure Dream identity migration planning; Admin operators remain a separate business domain.
// [Sync] 2026-09-17: prohibit Admin-member adoption into Dream Better Auth subjects.
import { createHash } from "node:crypto";
import { z } from "zod";
const decimal = z.string().regex(/^[1-9][0-9]*$/).refine(value => BigInt(value) <= 9223372036854775807n);
const digest = z.string().regex(/^[0-9a-f]{64}$/);
export const adoptionEntryDto = z.strictObject({
  auth_user_id: z.string().min(1).max(160), canonical_user_id: decimal.nullable(), admin_user_id: z.string().min(1).max(160).nullable(),
  credential_source: z.enum(["canonical", "admin"]).nullable(), google_account_id: decimal.nullable(),
  expected_canonical_sha256: digest.nullable(), expected_admin_sha256: digest.nullable(), expected_google_sha256: digest.nullable(),
  common_password_proof: z.string().min(1).max(256).nullable(), evidence: z.string().min(1).max(500),
}).refine(entry => entry.canonical_user_id !== null || entry.admin_user_id !== null);
export const adoptionManifestDto = z.strictObject({ version: z.literal(1), entries: z.array(adoptionEntryDto).min(1) });
export const legacySourceFingerprint = (row: unknown) => row === null ? null : createHash("sha256").update(JSON.stringify(row)).digest("hex");
export type LegacySource = { id: string; email: string; display_name: string | null; avatar_url?: string | null; password_hash: string; status: string; created_at: string | null; updated_at: string | null };
export type LegacyGoogleSource = { id: string; user_id: string; provider: string; provider_sub: string; email: string; created_at: string | null; updated_at: string | null };
export async function planSubjectAdoption(raw: unknown, canonical: LegacySource | null, admin: LegacySource | null, google: LegacyGoogleSource | null) {
  const entry = adoptionEntryDto.parse(raw);
  if (entry.admin_user_id !== null || entry.expected_admin_sha256 !== null || entry.credential_source === "admin" || entry.common_password_proof !== null || admin !== null) {
    throw new Error("ADOPTION_ADMIN_DOMAIN_SEPARATE");
  }
  if (entry.canonical_user_id === null || canonical === null) throw new Error("ADOPTION_CANONICAL_SOURCE_REQUIRED");
  if ((canonical?.id ?? null) !== entry.canonical_user_id || (admin?.id ?? null) !== entry.admin_user_id || (google?.id ?? null) !== entry.google_account_id) throw new Error("ADOPTION_SOURCE_ID_MISMATCH");
  for (const [row, expected] of [[canonical, entry.expected_canonical_sha256], [admin, entry.expected_admin_sha256], [google, entry.expected_google_sha256]] as const) if (legacySourceFingerprint(row) !== expected || row !== null && expected === null) throw new Error("ADOPTION_SOURCE_FINGERPRINT_MISMATCH");
  const primary = canonical;
  const email = primary.email.trim().toLowerCase();
  if (google && (!canonical || google.user_id !== canonical.id || google.provider !== "google" || !google.provider_sub)) throw new Error("ADOPTION_GOOGLE_BINDING_MISMATCH");
  const passwordHash = entry.credential_source === "canonical" ? canonical.password_hash : null;
  if (entry.credential_source && (!passwordHash || !/^\$2[aby]\$|^scrypt\$/.test(passwordHash))) throw new Error("ADOPTION_PASSWORD_FORMAT_UNSUPPORTED");
  if (!passwordHash && !google) throw new Error("ADOPTION_SIGN_IN_METHOD_REQUIRED");
  return { authUserId: entry.auth_user_id, canonicalUserId: canonical.id, email, name: primary.display_name || email, image: canonical.avatar_url ?? null, passwordHash: passwordHash ?? null, googleAccountId: google?.provider_sub ?? null, evidence: entry.evidence };
}
