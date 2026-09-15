// [Input] Reviewed manifest entries with exact legacy sources and supported password evidence.
// [Output] PK/hash preservation, Google FK binding and source/identity conflict refusal.
// [Pos] Provider-free migration planning tests; never touches PostgreSQL.
import { describe, expect, it } from "vitest";
import { hash as bcryptHash } from "bcryptjs";
import { hashAdminPassword } from "../admin/password";
import { legacySourceFingerprint, planSubjectAdoption, type LegacySource } from "../../../drizzle/data/auth-subject-adoption-core";
const canonical: LegacySource = { id: "9007199254740993", email: "user@example.test", display_name: null, avatar_url: null, password_hash: "$2b$12$existing-preserved-hash", status: "active", created_at: "2026-09-14 00:00:00.123456+00", updated_at: null };
const entry = { auth_user_id: "explicit-auth-sub", canonical_user_id: canonical.id, admin_user_id: null, credential_source: "canonical" as const, google_account_id: null, expected_canonical_sha256: legacySourceFingerprint(canonical), expected_admin_sha256: null, expected_google_sha256: null, common_password_proof: null, evidence: "reviewed-source-pk-manifest" };
describe("explicit subject adoption planning", () => {
  it("preserves exact canonical PK and original supported credential hash", async () => {
    expect(await planSubjectAdoption(entry, canonical, null, null)).toMatchObject({ authUserId: "explicit-auth-sub", canonicalUserId: "9007199254740993", passwordHash: canonical.password_hash });
  });
  it("rejects changed microseconds/source fingerprint", async () => {
    await expect(planSubjectAdoption(entry, { ...canonical, created_at: "2026-09-14 00:00:00.123457+00" }, null, null)).rejects.toThrow("ADOPTION_SOURCE_FINGERPRINT_MISMATCH");
  });
  it("rejects combining same-email Admin with a different unproven password", async () => {
    const admin = { ...canonical, id: "admin-id", password_hash: "scrypt$other-password" };
    await expect(planSubjectAdoption({ ...entry, admin_user_id: admin.id, expected_admin_sha256: legacySourceFingerprint(admin) }, canonical, admin, null)).rejects.toThrow("ADOPTION_CREDENTIAL_CONFLICT");
  });
  it("requires exact Google source canonical binding", async () => {
    const google = { id: "10", user_id: "7", provider: "google", provider_sub: "google-sub", email: canonical.email, created_at: null, updated_at: null };
    await expect(planSubjectAdoption({ ...entry, google_account_id: "10", expected_google_sha256: legacySourceFingerprint(google) }, canonical, null, google)).rejects.toThrow("ADOPTION_GOOGLE_BINDING_MISMATCH");
  });
  it("adopts explicitly paired identities only after their common password verifies both original algorithms", async () => {
    const password = "fixture-common-password";
    const source = { ...canonical, password_hash: await bcryptHash(password, 4) };
    const admin = { ...source, id: "admin-id", password_hash: await hashAdminPassword(password) };
    const paired = { ...entry, admin_user_id: admin.id, credential_source: "admin", expected_canonical_sha256: legacySourceFingerprint(source), expected_admin_sha256: legacySourceFingerprint(admin), common_password_proof: password };
    expect(await planSubjectAdoption(paired, source, admin, null)).toMatchObject({ passwordHash: admin.password_hash, canonicalUserId: canonical.id, adminUserId: admin.id });
    await expect(planSubjectAdoption({ ...paired, common_password_proof: "wrong-password" }, source, admin, null)).rejects.toThrow("ADOPTION_CREDENTIAL_CONFLICT");
  });
});
