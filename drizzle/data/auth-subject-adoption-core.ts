// [Input] Explicit reviewed legacy identity IDs, pinned source fingerprints and optional private common-password proof.
// [Output] Exact canonical/Admin/Google adoption plan preserving old PKs/hashes; conflicts fail closed.
// [Pos] Pure migration domain planning; no email-based implicit merge or credential output.
import { createHash } from "node:crypto";
import { z } from "zod";
import { verifyUnifiedPassword } from "../../app/lib/auth/password";
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
  if ((canonical?.id ?? null) !== entry.canonical_user_id || (admin?.id ?? null) !== entry.admin_user_id || (google?.id ?? null) !== entry.google_account_id) throw new Error("ADOPTION_SOURCE_ID_MISMATCH");
  for (const [row, expected] of [[canonical, entry.expected_canonical_sha256], [admin, entry.expected_admin_sha256], [google, entry.expected_google_sha256]] as const) if (legacySourceFingerprint(row) !== expected || row !== null && expected === null) throw new Error("ADOPTION_SOURCE_FINGERPRINT_MISMATCH");
  const primary = entry.credential_source === "admin" ? admin : canonical ?? admin;
  if (!primary) throw new Error("ADOPTION_CREDENTIAL_SOURCE_MISSING");
  const email = primary.email.trim().toLowerCase();
  if (canonical && admin) {
    if (canonical.email.trim().toLowerCase() !== admin.email.trim().toLowerCase()) throw new Error("ADOPTION_SEPARATE_IDENTITIES_REQUIRED");
    if (canonical.password_hash !== admin.password_hash) {
      const password = entry.common_password_proof;
      if (!password || !await verifyUnifiedPassword({ password, hash: canonical.password_hash }) || !await verifyUnifiedPassword({ password, hash: admin.password_hash })) throw new Error("ADOPTION_CREDENTIAL_CONFLICT");
    }
  }
  if (google && (!canonical || google.user_id !== canonical.id || google.provider !== "google" || !google.provider_sub)) throw new Error("ADOPTION_GOOGLE_BINDING_MISMATCH");
  const passwordHash = entry.credential_source ? (entry.credential_source === "admin" ? admin : canonical)?.password_hash : null;
  if (entry.credential_source && (!passwordHash || !/^\$2[aby]\$|^scrypt\$/.test(passwordHash))) throw new Error("ADOPTION_PASSWORD_FORMAT_UNSUPPORTED");
  if (!passwordHash && !google) throw new Error("ADOPTION_SIGN_IN_METHOD_REQUIRED");
  return { authUserId: entry.auth_user_id, canonicalUserId: canonical?.id ?? null, adminUserId: admin?.id ?? null, email, name: primary.display_name || email, image: canonical?.avatar_url ?? null, passwordHash: passwordHash ?? null, googleAccountId: google?.provider_sub ?? null, evidence: entry.evidence };
}
