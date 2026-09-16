// [Input] Provider-free exact legacy canonical/Google fixtures and conflicting target snapshots.
// [Output] DTO closure, deterministic IDs, redacted receipts, idempotence and fail-closed adoption evidence.
// [Pos] Domain tests for the release-only DTO → Service → Drizzle adoption boundary.
import { describe, expect, it, vi } from "vitest";
import type {
  LegacyCanonicalSource,
  LegacyGoogleAdoptionStore,
  LegacyGoogleSource,
  LegacyGoogleTargetSnapshot,
} from "./legacyGoogleAdoptionRepository";
import { legacyGoogleAdoptionEntryDto } from "./legacyGoogleAdoptionDto";
import { legacyGoogleIdentityIds, LegacyGoogleAdoptionService } from "./legacyGoogleAdoptionService";

const canonical: LegacyCanonicalSource = {
  id: "7",
  email: "person@example.test",
  displayName: "Person",
  avatarUrl: null,
  passwordHash: "$2b$12$preserved",
  status: "active",
  createdAt: "2026-01-01T00:00:00.123456Z",
  updatedAt: "2026-01-02T00:00:00.456789Z",
};
const google: LegacyGoogleSource = {
  id: "1",
  canonicalUserId: "7",
  provider: "google",
  providerSubject: "provider-subject-secret-fixture",
  email: "PERSON@example.test",
  createdAt: "2026-01-03T00:00:00.000Z",
  updatedAt: null,
};
const empty: LegacyGoogleTargetSnapshot = { users: [], subjects: [], googleAccounts: [], adminLinks: [] };

function store(snapshot = empty) {
  return {
    lock: vi.fn().mockResolvedValue(undefined),
    readCanonical: vi.fn().mockResolvedValue(canonical),
    readLegacyGoogle: vi.fn().mockResolvedValue(google),
    readTarget: vi.fn().mockResolvedValue(snapshot),
    create: vi.fn().mockResolvedValue(undefined),
  } satisfies LegacyGoogleAdoptionStore;
}

async function reviewedEntry(currentStore: LegacyGoogleAdoptionStore) {
  const inspection = await new LegacyGoogleAdoptionService(currentStore).inspect({
    canonical_user_id: "7",
    legacy_google_account_id: "1",
    evidence: "real-google-callback",
  });
  return {
    canonical_user_id: "7",
    legacy_google_account_id: "1",
    evidence: "real-google-callback",
    expected_canonical_sha256: inspection.canonical_source_sha256,
    expected_google_sha256: inspection.google_source_sha256,
  };
}

describe("legacy Google subject adoption", () => {
  it("rejects caller-selected auth/Admin identity fields", () => {
    expect(legacyGoogleAdoptionEntryDto.safeParse({
      canonical_user_id: "7",
      legacy_google_account_id: "1",
      evidence: "reviewed evidence",
      expected_canonical_sha256: "a".repeat(64),
      expected_google_sha256: "b".repeat(64),
      auth_user_id: "caller",
    }).success).toBe(false);
  });

  it("derives stable opaque IDs without embedding provider subject", () => {
    const first = legacyGoogleIdentityIds(google.providerSubject);
    expect(first).toEqual(legacyGoogleIdentityIds(google.providerSubject));
    expect(JSON.stringify(first)).not.toContain(google.providerSubject);
  });

  it("dry-runs and applies one atomic Dream-only plan with redacted output", async () => {
    const currentStore = store();
    const entry = await reviewedEntry(currentStore);
    const service = new LegacyGoogleAdoptionService(currentStore);
    const dry = await service.adopt(entry, { apply: false, manifestSha256: "c".repeat(64) });
    expect(dry).toMatchObject({ mode: "dry-run", action: "create", dream_subject_created: false, admin_membership_created: false, legacy_rows_modified: 0, redacted: true });
    expect(currentStore.create).not.toHaveBeenCalled();
    const applied = await service.adopt(entry, { apply: true, manifestSha256: "c".repeat(64) });
    expect(applied).toMatchObject({ mode: "applied", action: "create", dream_subject_created: true, admin_membership_created: false });
    expect(currentStore.create).toHaveBeenCalledOnce();
    const persisted = vi.mocked(currentStore.create).mock.calls[0][0];
    expect(persisted).toMatchObject({ canonicalUserId: "7", email: "person@example.test", providerSubject: google.providerSubject });
    expect(JSON.stringify(applied)).not.toContain(google.providerSubject);
    expect(JSON.stringify(applied)).not.toContain(canonical.email);
  });

  it("treats the exact complete mapping as an idempotent no-op", async () => {
    const ids = legacyGoogleIdentityIds(google.providerSubject);
    const currentStore = store({
      users: [{ id: ids.authUserId, email: canonical.email }],
      subjects: [{ authUserId: ids.authUserId, canonicalUserId: canonical.id }],
      googleAccounts: [{ userId: ids.authUserId, accountId: google.providerSubject }],
      adminLinks: [],
    });
    const entry = await reviewedEntry(currentStore);
    const receipt = await new LegacyGoogleAdoptionService(currentStore).adopt(entry, { apply: true, manifestSha256: "d".repeat(64) });
    expect(receipt).toMatchObject({ action: "already-complete", dream_subject_created: false });
    expect(currentStore.create).not.toHaveBeenCalled();
  });

  it.each([
    ["fingerprint drift", async () => ({ ...(await reviewedEntry(store())), expected_google_sha256: "f".repeat(64) }), store(), "LEGACY_GOOGLE_SOURCE_FINGERPRINT_MISMATCH"],
    ["email mismatch", () => reviewedEntry(store()), { ...store(), readLegacyGoogle: vi.fn().mockResolvedValue({ ...google, email: "different@example.test" }) }, "LEGACY_GOOGLE_EMAIL_MISMATCH"],
    ["partial target", () => reviewedEntry(store()), store({ users: [{ id: "unexpected", email: canonical.email }], subjects: [], googleAccounts: [], adminLinks: [] }), "LEGACY_GOOGLE_TARGET_CONFLICT"],
    ["Admin link", () => reviewedEntry(store()), store({ ...empty, adminLinks: [{ authUserId: "any", adminUserId: "admin" }] }), "LEGACY_GOOGLE_ADMIN_LINK_CONFLICT"],
  ])("fails closed on %s", async (_label, entryFactory, currentStore, code) => {
    const entry = await entryFactory();
    await expect(new LegacyGoogleAdoptionService(currentStore).adopt(entry, { apply: true, manifestSha256: "e".repeat(64) })).rejects.toThrow(code);
    expect(currentStore.create).not.toHaveBeenCalled();
  });
});
