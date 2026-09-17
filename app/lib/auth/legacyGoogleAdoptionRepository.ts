// [Input] One migration-owner Drizzle transaction and a validated legacy Google adoption plan.
// [Output] Locked source/target snapshots and one atomic Better Auth subject/account/link/audit insert.
// [Pos] Typed ORM persistence adapter for explicit release-time adoption; never exposed as arbitrary CRUD.
import { randomUUID } from "node:crypto";
import { and, eq, or, sql } from "drizzle-orm";
import { account as identityAccount, user as identityUser } from "@ink-memory/db/schema/auth-generated";
import { adminSubjectLinks, subjectLinks } from "@ink-memory/db/schema/auth";
import { adminAuditLogs, users } from "@ink-memory/db/schema";
import { oauth_accounts as legacyOAuthAccounts } from "@ink-memory/db/schema/dream";
import type { AuthRepositoryDatabase } from "./database";

export type LegacyCanonicalSource = {
  id: string;
  email: string;
  displayName: string | null;
  avatarUrl: string | null;
  passwordHash: string;
  status: string;
  createdAt: string;
  updatedAt: string;
};

export type LegacyGoogleSource = {
  id: string;
  canonicalUserId: string;
  provider: string;
  providerSubject: string;
  email: string;
  createdAt: string | null;
  updatedAt: string | null;
};

export type LegacyGoogleTargetSnapshot = {
  users: Array<{ id: string; email: string }>;
  subjects: Array<{ authUserId: string; canonicalUserId: string }>;
  googleAccounts: Array<{ userId: string; accountId: string }>;
  adminLinks: Array<{ authUserId: string; adminUserId: string }>;
};

export type LegacyGoogleCreatePlan = {
  authUserId: string;
  accountRowId: string;
  canonicalUserId: string;
  email: string;
  name: string;
  image: string | null;
  providerSubject: string;
  evidence: string;
  requestId: string;
  manifestSha256: string;
  canonicalSha256: string;
  googleSha256: string;
};

export interface LegacyGoogleAdoptionStore {
  lock(): Promise<void>;
  readCanonical(id: string): Promise<LegacyCanonicalSource | null>;
  readLegacyGoogle(id: string): Promise<LegacyGoogleSource | null>;
  readTarget(authUserId: string, canonicalUserId: string, email: string, providerSubject: string): Promise<LegacyGoogleTargetSnapshot>;
  create(plan: LegacyGoogleCreatePlan): Promise<void>;
}

export class DrizzleLegacyGoogleAdoptionRepository implements LegacyGoogleAdoptionStore {
  constructor(private readonly database: AuthRepositoryDatabase) {}

  async lock() {
    await this.database.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended('identity-legacy-google-adoption-v1', 0))`);
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

  async readLegacyGoogle(id: string) {
    const rows = await this.database.select({
      id: sql<string>`${legacyOAuthAccounts.id}::text`,
      canonicalUserId: sql<string>`${legacyOAuthAccounts.user_id}::text`,
      provider: legacyOAuthAccounts.provider,
      providerSubject: legacyOAuthAccounts.provider_sub,
      email: legacyOAuthAccounts.email,
      createdAt: sql<string | null>`CASE WHEN ${legacyOAuthAccounts.created_at} IS NULL THEN NULL ELSE to_char(${legacyOAuthAccounts.created_at} AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') END`,
      updatedAt: sql<string | null>`CASE WHEN ${legacyOAuthAccounts.updated_at} IS NULL THEN NULL ELSE to_char(${legacyOAuthAccounts.updated_at} AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') END`,
    }).from(legacyOAuthAccounts).where(sql`${legacyOAuthAccounts.id} = ${id}::bigint`).limit(1).for("update");
    return rows[0] ?? null;
  }

  async readTarget(authUserId: string, canonicalUserId: string, email: string, providerSubject: string) {
    const [identityUsers, subjects, googleAccounts, adminLinks] = await Promise.all([
      this.database.select({ id: identityUser.id, email: identityUser.email }).from(identityUser)
        .where(or(eq(identityUser.id, authUserId), eq(identityUser.email, email))).for("update"),
      this.database.select({
        authUserId: subjectLinks.authUserId,
        canonicalUserId: sql<string>`${subjectLinks.canonicalUserId}::text`,
      }).from(subjectLinks)
        .where(or(eq(subjectLinks.authUserId, authUserId), sql`${subjectLinks.canonicalUserId} = ${canonicalUserId}::bigint`)).for("update"),
      this.database.select({ userId: identityAccount.userId, accountId: identityAccount.accountId }).from(identityAccount)
        .where(and(eq(identityAccount.providerId, "google"), or(eq(identityAccount.userId, authUserId), eq(identityAccount.accountId, providerSubject)))).for("update"),
      this.database.select({ authUserId: adminSubjectLinks.authUserId, adminUserId: adminSubjectLinks.adminUserId })
        .from(adminSubjectLinks).where(eq(adminSubjectLinks.authUserId, authUserId)).for("update"),
    ]);
    return { users: identityUsers, subjects, googleAccounts, adminLinks };
  }

  async create(plan: LegacyGoogleCreatePlan) {
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
      accountId: plan.providerSubject,
      providerId: "google",
      userId: plan.authUserId,
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
      action: "auth.legacy-google-subject-adopted",
      resource_type: "auth_subject",
      resource_id: plan.authUserId,
      request_id: plan.requestId,
      metadata: {
        manifest_sha256: plan.manifestSha256,
        canonical_source_sha256: plan.canonicalSha256,
        google_source_sha256: plan.googleSha256,
        dream_subject_created: true,
        admin_membership_created: false,
        legacy_rows_modified: 0,
        redacted: true,
      },
    });
  }
}
