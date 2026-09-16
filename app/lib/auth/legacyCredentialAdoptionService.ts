// [Input] Strict legacy credential adoption DTO, exact canonical source and current identity target snapshot.
// [Output] Redacted inspect/dry-run/apply receipt with deterministic IDs and idempotent state handling.
// [Pos] Release-time Dream identity domain service; Admin members never enter this path.
import { createHash } from "node:crypto";
import {
  legacyCredentialAdoptionEntryDto,
  legacyCredentialInspectionEntryDto,
  type LegacyCredentialAdoptionEntry,
  type LegacyCredentialInspectionEntry,
} from "./legacyCredentialAdoptionDto";
import type { LegacyCanonicalSource } from "./legacyGoogleAdoptionRepository";
import type {
  LegacyCredentialAdoptionStore,
  LegacyCredentialTargetSnapshot,
} from "./legacyCredentialAdoptionRepository";

const digest = (value: string) => createHash("sha256").update(value).digest("hex");
const normalizedEmail = (value: string) => value.trim().toLowerCase();
const supportedDreamCredential = /^\$2[aby]\$(?:0[4-9]|[12][0-9]|3[01])\$[./A-Za-z0-9]{53}$/;

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

export function legacyCredentialIdentityIds(canonicalUserId: string, email: string) {
  const sourceDigest = digest(`credential\u0000${canonicalUserId}\u0000${normalizedEmail(email)}`);
  return {
    authUserId: `usr_credential_${sourceDigest.slice(0, 40)}`,
    accountRowId: `acct_credential_${sourceDigest.slice(0, 40)}`,
  };
}

function validateSource(entry: { canonical_user_id: string }, canonical: LegacyCanonicalSource | null) {
  if (!canonical || canonical.id !== entry.canonical_user_id) throw new Error("LEGACY_CREDENTIAL_CANONICAL_SOURCE_MISSING");
  if (canonical.status !== "active") throw new Error("LEGACY_CREDENTIAL_CANONICAL_INACTIVE");
  if (!supportedDreamCredential.test(canonical.passwordHash)) throw new Error("LEGACY_CREDENTIAL_HASH_UNSUPPORTED");
  return { canonical, canonicalSha256: canonicalFingerprint(canonical) };
}

function targetState(
  snapshot: LegacyCredentialTargetSnapshot,
  expected: { authUserId: string; canonicalUserId: string; email: string; passwordHash: string },
) {
  if (snapshot.adminLinks.length) throw new Error("LEGACY_CREDENTIAL_ADMIN_LINK_CONFLICT");
  const empty = snapshot.users.length === 0 && snapshot.subjects.length === 0 && snapshot.credentialAccounts.length === 0;
  if (empty) return "absent" as const;
  const complete = snapshot.users.length === 1
    && snapshot.users[0].id === expected.authUserId
    && normalizedEmail(snapshot.users[0].email) === expected.email
    && snapshot.subjects.length === 1
    && snapshot.subjects[0].authUserId === expected.authUserId
    && snapshot.subjects[0].canonicalUserId === expected.canonicalUserId
    && snapshot.credentialAccounts.length === 1
    && snapshot.credentialAccounts[0].userId === expected.authUserId
    && snapshot.credentialAccounts[0].accountId === expected.authUserId
    && snapshot.credentialAccounts[0].password === expected.passwordHash;
  if (!complete) throw new Error("LEGACY_CREDENTIAL_TARGET_CONFLICT");
  return "complete" as const;
}

export type LegacyCredentialAdoptionReceipt = {
  mode: "inspect" | "dry-run" | "applied";
  action: "inspect" | "create" | "already-complete";
  subject_sha256: string;
  canonical_source_sha256: string;
  dream_subject_created: boolean;
  credential_account_created: boolean;
  admin_membership_created: false;
  legacy_rows_modified: 0;
  redacted: true;
};

export class LegacyCredentialAdoptionService {
  constructor(private readonly store: LegacyCredentialAdoptionStore) {}

  private async source(entry: LegacyCredentialInspectionEntry) {
    await this.store.lock();
    return { entry, ...validateSource(entry, await this.store.readCanonical(entry.canonical_user_id)) };
  }

  async inspect(raw: unknown): Promise<LegacyCredentialAdoptionReceipt> {
    const source = await this.source(legacyCredentialInspectionEntryDto.parse(raw));
    const { authUserId } = legacyCredentialIdentityIds(source.canonical.id, source.canonical.email);
    return {
      mode: "inspect",
      action: "inspect",
      subject_sha256: digest(authUserId),
      canonical_source_sha256: source.canonicalSha256,
      dream_subject_created: false,
      credential_account_created: false,
      admin_membership_created: false,
      legacy_rows_modified: 0,
      redacted: true,
    };
  }

  async adopt(raw: unknown, options: { apply: boolean; manifestSha256: string }): Promise<LegacyCredentialAdoptionReceipt> {
    const entry: LegacyCredentialAdoptionEntry = legacyCredentialAdoptionEntryDto.parse(raw);
    if (!/^[0-9a-f]{64}$/.test(options.manifestSha256)) throw new Error("LEGACY_CREDENTIAL_MANIFEST_INVALID");
    const source = await this.source(entry);
    if (source.canonicalSha256 !== entry.expected_canonical_sha256) throw new Error("LEGACY_CREDENTIAL_SOURCE_FINGERPRINT_MISMATCH");
    const ids = legacyCredentialIdentityIds(source.canonical.id, source.canonical.email);
    const email = normalizedEmail(source.canonical.email);
    const snapshot = await this.store.readTarget(ids.authUserId, source.canonical.id, email);
    const state = targetState(snapshot, {
      authUserId: ids.authUserId,
      canonicalUserId: source.canonical.id,
      email,
      passwordHash: source.canonical.passwordHash,
    });
    const action = state === "complete" ? "already-complete" : "create";
    if (options.apply && action === "create") {
      await this.store.create({
        ...ids,
        canonicalUserId: source.canonical.id,
        email,
        name: source.canonical.displayName?.trim() || email,
        image: source.canonical.avatarUrl,
        passwordHash: source.canonical.passwordHash,
        evidence: entry.evidence,
        requestId: `legacy_credential_adoption_${options.manifestSha256}`,
        manifestSha256: options.manifestSha256,
        canonicalSha256: source.canonicalSha256,
      });
    }
    const created = options.apply && action === "create";
    return {
      mode: options.apply ? "applied" : "dry-run",
      action,
      subject_sha256: digest(ids.authUserId),
      canonical_source_sha256: source.canonicalSha256,
      dream_subject_created: created,
      credential_account_created: created,
      admin_membership_created: false,
      legacy_rows_modified: 0,
      redacted: true,
    };
  }
}
