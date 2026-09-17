// [Input] One migration-owner Drizzle transaction and a validated legacy credential adoption plan.
// [Output] Locked source/target snapshots and one atomic Dream identity/credential/link/audit insert.
// [Pos] Typed ORM persistence adapter for explicit release-time adoption; never exposes generic CRUD.
import { randomUUID } from "node:crypto";
import { and, eq, or, sql } from "drizzle-orm";
import { account as identityAccount, user as identityUser } from "@ink-memory/db/schema/auth-generated";
import { adminSubjectLinks, subjectLinks } from "@ink-memory/db/schema/auth";
import { adminAuditLogs, users } from "@ink-memory/db/schema";
import type { AuthRepositoryDatabase } from "./database";
import type { LegacyCanonicalSource } from "./legacyGoogleAdoptionRepository";

export type LegacyCredentialTargetSnapshot = {
  users: Array<{ id: string; email: string }>;
  subjects: Array<{ authUserId: string; canonicalUserId: string }>;
  credentialAccounts: Array<{ userId: string; accountId: string; password: string | null }>;
  adminLinks: Array<{ authUserId: string; adminUserId: string }>;
};

export type LegacyCredentialCreatePlan = {
  authUserId: string;
  accountRowId: string;
  canonicalUserId: string;
  email: string;
  name: string;
  image: string | null;
  passwordHash: string;
  evidence: string;
  requestId: string;
  manifestSha256: string;
  canonicalSha256: string;
};

export interface LegacyCredentialAdoptionStore {
  lock(): Promise<void>;
  readCanonical(id: string): Promise<LegacyCanonicalSource | null>;
  readTarget(authUserId: string, canonicalUserId: string, email: string): Promise<LegacyCredentialTargetSnapshot>;
  create(plan: LegacyCredentialCreatePlan): Promise<void>;
}

export class DrizzleLegacyCredentialAdoptionRepository implements LegacyCredentialAdoptionStore {
  constructor(private readonly database: AuthRepositoryDatabase) {}

  async lock() {
    await this.database.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended('identity-legacy-credential-adoption-v1', 0))`);
  }

  async readCanonical(id: string) {
    const rows = await this.database.select({
      id: sql<string>`${users.id}::text`,
      email: users.email,
      displayName: users.display_name,
      avatarUrl: users.avatar_url,
      passwordHash: users.password_hash,
      status: users.admin_deprecated_status,
      createdAt: sql<string>`to_char(${users.created_at} AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`,
      updatedAt: sql<string>`to_char(${users.updated_at} AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`,
    }).from(users).where(sql`${users.id} = ${id}::bigint`).limit(1).for("update");
    return rows[0] ?? null;
  }

  async readTarget(authUserId: string, canonicalUserId: string, email: string) {
    const [identityUsers, subjects, credentialAccounts, adminLinks] = await Promise.all([
      this.database.select({ id: identityUser.id, email: identityUser.email }).from(identityUser)
        .where(or(eq(identityUser.id, authUserId), eq(identityUser.email, email))).for("update"),
      this.database.select({
        authUserId: subjectLinks.authUserId,
        canonicalUserId: sql<string>`${subjectLinks.canonicalUserId}::text`,
      }).from(subjectLinks)
        .where(or(eq(subjectLinks.authUserId, authUserId), sql`${subjectLinks.canonicalUserId} = ${canonicalUserId}::bigint`)).for("update"),
      this.database.select({
        userId: identityAccount.userId,
        accountId: identityAccount.accountId,
        password: identityAccount.password,
      }).from(identityAccount)
        .where(and(eq(identityAccount.providerId, "credential"), or(eq(identityAccount.userId, authUserId), eq(identityAccount.accountId, authUserId)))).for("update"),
      this.database.select({ authUserId: adminSubjectLinks.authUserId, adminUserId: adminSubjectLinks.adminUserId })
        .from(adminSubjectLinks).where(eq(adminSubjectLinks.authUserId, authUserId)).for("update"),
    ]);
    return { users: identityUsers, subjects, credentialAccounts, adminLinks };
  }

  async create(plan: LegacyCredentialCreatePlan) {
    const now = new Date();
    await this.database.insert(identityUser).values({
      id: plan.authUserId,
      name: plan.name,
      email: plan.email,
      emailVerified: false,
      image: plan.image,
      createdAt: now,
      updatedAt: now,
    });
    await this.database.insert(identityAccount).values({
      id: plan.accountRowId,
      accountId: plan.authUserId,
      providerId: "credential",
      userId: plan.authUserId,
      password: plan.passwordHash,
      createdAt: now,
      updatedAt: now,
    });
    await this.database.insert(subjectLinks).values({
      authUserId: plan.authUserId,
      canonicalUserId: BigInt(plan.canonicalUserId),
      evidence: `${plan.evidence};manifest-sha256:${plan.manifestSha256}`,
    });
    await this.database.insert(adminAuditLogs).values({
      id: randomUUID(),
      actor_type: "system",
      action: "auth.legacy-credential-subject-adopted",
      resource_type: "auth_subject",
      resource_id: plan.authUserId,
      request_id: plan.requestId,
      metadata: {
        manifest_sha256: plan.manifestSha256,
        canonical_source_sha256: plan.canonicalSha256,
        dream_subject_created: true,
        credential_account_created: true,
        admin_membership_created: false,
        legacy_rows_modified: 0,
        redacted: true,
      },
    });
  }
}
