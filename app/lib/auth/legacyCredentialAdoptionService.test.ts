// [Input] Provider-free exact canonical Dream fixtures and conflicting identity target snapshots.
// [Output] DTO closure, hash preservation, redacted receipts, idempotence and Admin-domain refusal evidence.
// [Pos] Domain tests for the release-only Zod DTO → service → typed Drizzle credential adoption boundary.
import { describe, expect, it, vi } from "vitest";
import { legacyCredentialAdoptionEntryDto } from "./legacyCredentialAdoptionDto";
import type { LegacyCredentialAdoptionStore, LegacyCredentialTargetSnapshot } from "./legacyCredentialAdoptionRepository";
import { legacyCredentialIdentityIds, LegacyCredentialAdoptionService } from "./legacyCredentialAdoptionService";
import type { LegacyCanonicalSource } from "./legacyGoogleAdoptionRepository";

const passwordHash = `$2b$12$${"a".repeat(53)}`;
const canonical: LegacyCanonicalSource = {
  id: "7", email: "Person@example.test", displayName: "Person", avatarUrl: null, passwordHash,
  status: "active", createdAt: "2026-01-01T00:00:00.123456Z", updatedAt: "2026-01-02T00:00:00.456789Z",
};
const empty: LegacyCredentialTargetSnapshot = { users: [], subjects: [], credentialAccounts: [], adminLinks: [] };

function store(snapshot = empty) {
  return {
    lock: vi.fn().mockResolvedValue(undefined), readCanonical: vi.fn().mockResolvedValue(canonical),
    readTarget: vi.fn().mockResolvedValue(snapshot), create: vi.fn().mockResolvedValue(undefined),
  } satisfies LegacyCredentialAdoptionStore;
}

async function reviewedEntry(currentStore: LegacyCredentialAdoptionStore) {
  const inspection = await new LegacyCredentialAdoptionService(currentStore).inspect({ canonical_user_id: "7", evidence: "reviewed-dream-credential" });
  return { canonical_user_id: "7", evidence: "reviewed-dream-credential", expected_canonical_sha256: inspection.canonical_source_sha256 };
}

describe("legacy Dream credential adoption", () => {
  it("rejects caller-selected identity, Admin and database fields", () => {
    for (const extra of ["auth_user_id", "account_id", "admin_user_id", "email", "sql", "table", "transaction"]) {
      expect(legacyCredentialAdoptionEntryDto.safeParse({
        canonical_user_id: "7", evidence: "reviewed evidence", expected_canonical_sha256: "a".repeat(64), [extra]: "caller-selected",
      }).success).toBe(false);
    }
  });

  it("derives stable opaque IDs without embedding email or canonical ID", () => {
    const ids = legacyCredentialIdentityIds(canonical.id, canonical.email);
    expect(ids).toEqual(legacyCredentialIdentityIds(canonical.id, canonical.email.toLowerCase()));
    expect(JSON.stringify(ids)).not.toContain(canonical.email);
    expect(JSON.stringify(ids)).not.toContain(`_${canonical.id}_`);
  });

  it("dry-runs then applies one Dream-only plan preserving the exact hash", async () => {
    const currentStore = store();
    const entry = await reviewedEntry(currentStore);
    const service = new LegacyCredentialAdoptionService(currentStore);
    expect(await service.adopt(entry, { apply: false, manifestSha256: "b".repeat(64) })).toMatchObject({
      mode: "dry-run", action: "create", dream_subject_created: false, credential_account_created: false,
      admin_membership_created: false, legacy_rows_modified: 0, redacted: true,
    });
    expect(currentStore.create).not.toHaveBeenCalled();
    const receipt = await service.adopt(entry, { apply: true, manifestSha256: "b".repeat(64) });
    expect(receipt).toMatchObject({ mode: "applied", action: "create", dream_subject_created: true, credential_account_created: true, admin_membership_created: false });
    const plan = vi.mocked(currentStore.create).mock.calls[0][0];
    expect(plan).toMatchObject({ canonicalUserId: "7", email: "person@example.test", passwordHash });
    expect(JSON.stringify(receipt)).not.toContain(passwordHash);
    expect(JSON.stringify(receipt)).not.toContain(canonical.email);
  });

  it("treats an exact complete mapping as an idempotent no-op", async () => {
    const ids = legacyCredentialIdentityIds(canonical.id, canonical.email);
    const currentStore = store({
      users: [{ id: ids.authUserId, email: canonical.email }],
      subjects: [{ authUserId: ids.authUserId, canonicalUserId: canonical.id }],
      credentialAccounts: [{ userId: ids.authUserId, accountId: ids.authUserId, password: passwordHash }], adminLinks: [],
    });
    const receipt = await new LegacyCredentialAdoptionService(currentStore).adopt(await reviewedEntry(currentStore), { apply: true, manifestSha256: "c".repeat(64) });
    expect(receipt).toMatchObject({ action: "already-complete", dream_subject_created: false, credential_account_created: false });
    expect(currentStore.create).not.toHaveBeenCalled();
  });

  it.each([
    ["source fingerprint drift", store(), async (currentStore: LegacyCredentialAdoptionStore) => ({ ...(await reviewedEntry(currentStore)), expected_canonical_sha256: "f".repeat(64) }), "LEGACY_CREDENTIAL_SOURCE_FINGERPRINT_MISMATCH"],
    ["unsupported source hash", { ...store(), readCanonical: vi.fn().mockResolvedValue({ ...canonical, passwordHash: "scrypt$admin-domain-hash" }) }, () => reviewedEntry(store()), "LEGACY_CREDENTIAL_HASH_UNSUPPORTED"],
    ["partial target", store({ users: [{ id: "unexpected", email: canonical.email }], subjects: [], credentialAccounts: [], adminLinks: [] }), reviewedEntry, "LEGACY_CREDENTIAL_TARGET_CONFLICT"],
    ["credential hash drift", (() => { const ids = legacyCredentialIdentityIds(canonical.id, canonical.email); return store({ users: [{ id: ids.authUserId, email: canonical.email }], subjects: [{ authUserId: ids.authUserId, canonicalUserId: canonical.id }], credentialAccounts: [{ userId: ids.authUserId, accountId: ids.authUserId, password: `$2b$12$${"b".repeat(53)}` }], adminLinks: [] }); })(), reviewedEntry, "LEGACY_CREDENTIAL_TARGET_CONFLICT"],
    ["Admin subject link", store({ ...empty, adminLinks: [{ authUserId: "subject", adminUserId: "admin" }] }), reviewedEntry, "LEGACY_CREDENTIAL_ADMIN_LINK_CONFLICT"],
  ])("fails closed on %s", async (_label, currentStore, entryFactory, code) => {
    const entry = await entryFactory(currentStore);
    await expect(new LegacyCredentialAdoptionService(currentStore).adopt(entry, { apply: true, manifestSha256: "d".repeat(64) })).rejects.toThrow(code);
    expect(currentStore.create).not.toHaveBeenCalled();
  });
});
