// [Input] Strict legacy Google adoption DTO, exact source rows and current Better Auth target snapshot.
// [Output] Redacted inspect/dry-run/apply receipt with deterministic subject IDs and idempotent state handling.
// [Pos] Release-time identity domain service; exact provider-sub evidence replaces forbidden email-only merging.
import { createHash } from "node:crypto";
import {
  legacyGoogleAdoptionEntryDto,
  legacyGoogleInspectionEntryDto,
  type LegacyGoogleAdoptionEntry,
  type LegacyGoogleInspectionEntry,
} from "./legacyGoogleAdoptionDto";
import type {
  LegacyCanonicalSource,
  LegacyGoogleAdoptionStore,
  LegacyGoogleSource,
  LegacyGoogleTargetSnapshot,
} from "./legacyGoogleAdoptionRepository";

const digest = (value: string) => createHash("sha256").update(value).digest("hex");
const normalizedEmail = (value: string) => value.trim().toLowerCase();
function canonicalFingerprint(source: LegacyCanonicalSource) {
  return digest(JSON.stringify({
    id: source.id,
    email: source.email,
    display_name: source.displayName,
    avatar_url: source.avatarUrl,
    password_hash: source.passwordHash,
    status: source.status,
    created_at: source.createdAt,
    updated_at: source.updatedAt,
  }));
}

function googleFingerprint(source: LegacyGoogleSource) {
  return digest(JSON.stringify({
    id: source.id,
    user_id: source.canonicalUserId,
    provider: source.provider,
    provider_sub: source.providerSubject,
    email: source.email,
    created_at: source.createdAt,
    updated_at: source.updatedAt,
  }));
}

export function legacyGoogleIdentityIds(providerSubject: string) {
  const providerDigest = digest(`google\u0000${providerSubject}`);
  return {
    authUserId: `usr_google_${providerDigest.slice(0, 40)}`,
    accountRowId: `acct_google_${providerDigest.slice(0, 40)}`,
  };
}

function validateSources(
  entry: { canonical_user_id: string; legacy_google_account_id: string },
  canonical: LegacyCanonicalSource | null,
  google: LegacyGoogleSource | null,
) {
  if (!canonical || canonical.id !== entry.canonical_user_id) throw new Error("LEGACY_GOOGLE_CANONICAL_SOURCE_MISSING");
  if (!google || google.id !== entry.legacy_google_account_id) throw new Error("LEGACY_GOOGLE_ACCOUNT_SOURCE_MISSING");
  if (canonical.status !== "active") throw new Error("LEGACY_GOOGLE_CANONICAL_INACTIVE");
  if (google.provider !== "google" || !google.providerSubject.trim() || google.canonicalUserId !== canonical.id) {
    throw new Error("LEGACY_GOOGLE_BINDING_MISMATCH");
  }
  if (normalizedEmail(canonical.email) !== normalizedEmail(google.email)) throw new Error("LEGACY_GOOGLE_EMAIL_MISMATCH");
  return {
    canonical,
    google,
    canonicalSha256: canonicalFingerprint(canonical),
    googleSha256: googleFingerprint(google),
  };
}

function targetState(
  snapshot: LegacyGoogleTargetSnapshot,
  expected: { authUserId: string; canonicalUserId: string; email: string; providerSubject: string },
) {
  if (snapshot.adminLinks.length) throw new Error("LEGACY_GOOGLE_ADMIN_LINK_CONFLICT");
  const empty = snapshot.users.length === 0 && snapshot.subjects.length === 0 && snapshot.googleAccounts.length === 0;
  if (empty) return "absent" as const;
  const complete = snapshot.users.length === 1
    && snapshot.users[0].id === expected.authUserId
    && normalizedEmail(snapshot.users[0].email) === expected.email
    && snapshot.subjects.length === 1
    && snapshot.subjects[0].authUserId === expected.authUserId
    && snapshot.subjects[0].canonicalUserId === expected.canonicalUserId
    && snapshot.googleAccounts.length === 1
    && snapshot.googleAccounts[0].userId === expected.authUserId
    && snapshot.googleAccounts[0].accountId === expected.providerSubject;
  if (!complete) throw new Error("LEGACY_GOOGLE_TARGET_CONFLICT");
  return "complete" as const;
}

export type LegacyGoogleAdoptionReceipt = {
  mode: "inspect" | "dry-run" | "applied";
  action: "inspect" | "create" | "already-complete";
  subject_sha256: string;
  canonical_source_sha256: string;
  google_source_sha256: string;
  dream_subject_created: boolean;
  admin_membership_created: false;
  legacy_rows_modified: 0;
  redacted: true;
};

export class LegacyGoogleAdoptionService {
  constructor(private readonly store: LegacyGoogleAdoptionStore) {}

  private async sources(entry: LegacyGoogleInspectionEntry) {
    await this.store.lock();
    const [canonical, google] = await Promise.all([
      this.store.readCanonical(entry.canonical_user_id),
      this.store.readLegacyGoogle(entry.legacy_google_account_id),
    ]);
    return { entry, ...validateSources(entry, canonical, google) };
  }

  async inspect(raw: unknown): Promise<LegacyGoogleAdoptionReceipt> {
    const source = await this.sources(legacyGoogleInspectionEntryDto.parse(raw));
    const { authUserId } = legacyGoogleIdentityIds(source.google.providerSubject);
    return {
      mode: "inspect",
      action: "inspect",
      subject_sha256: digest(authUserId),
      canonical_source_sha256: source.canonicalSha256,
      google_source_sha256: source.googleSha256,
      dream_subject_created: false,
      admin_membership_created: false,
      legacy_rows_modified: 0,
      redacted: true,
    };
  }

  async adopt(raw: unknown, options: { apply: boolean; manifestSha256: string }): Promise<LegacyGoogleAdoptionReceipt> {
    const entry: LegacyGoogleAdoptionEntry = legacyGoogleAdoptionEntryDto.parse(raw);
    if (!/^[0-9a-f]{64}$/.test(options.manifestSha256)) throw new Error("LEGACY_GOOGLE_MANIFEST_INVALID");
    const source = await this.sources(entry);
    if (source.canonicalSha256 !== entry.expected_canonical_sha256 || source.googleSha256 !== entry.expected_google_sha256) {
      throw new Error("LEGACY_GOOGLE_SOURCE_FINGERPRINT_MISMATCH");
    }
    const ids = legacyGoogleIdentityIds(source.google.providerSubject);
    const email = normalizedEmail(source.canonical.email);
    const snapshot = await this.store.readTarget(ids.authUserId, source.canonical.id, email, source.google.providerSubject);
    const state = targetState(snapshot, {
      authUserId: ids.authUserId,
      canonicalUserId: source.canonical.id,
      email,
      providerSubject: source.google.providerSubject,
    });
    const action = state === "complete" ? "already-complete" : "create";
    if (options.apply && action === "create") {
      await this.store.create({
        ...ids,
        canonicalUserId: source.canonical.id,
        email,
        name: source.canonical.displayName?.trim() || email,
        image: source.canonical.avatarUrl,
        providerSubject: source.google.providerSubject,
        evidence: entry.evidence,
        requestId: `legacy_google_adoption_${options.manifestSha256}`,
        manifestSha256: options.manifestSha256,
        canonicalSha256: source.canonicalSha256,
        googleSha256: source.googleSha256,
      });
    }
    return {
      mode: options.apply ? "applied" : "dry-run",
      action,
      subject_sha256: digest(ids.authUserId),
      canonical_source_sha256: source.canonicalSha256,
      google_source_sha256: source.googleSha256,
      dream_subject_created: options.apply && action === "create",
      admin_membership_created: false,
      legacy_rows_modified: 0,
      redacted: true,
    };
  }
}
