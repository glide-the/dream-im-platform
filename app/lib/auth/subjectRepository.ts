// [Input] Verified Google Account/User identity and explicit canonical subject links.
// [Output] Typed identity linkage and active canonical user lookup, never implicit email merge.
// [Pos] Admin auth ORM repository; hooks execute inside the same protocol transaction.
// [Sync] 2026-09-14: preserve users primary keys and reject legacy email collisions pending explicit migration.
import { APIError } from "better-auth/api";
import { and, eq, sql } from "drizzle-orm";
import { adminUsers, platformUsers, users } from "@ink-memory/db/schema";
import { adminSubjectLinks, subjectLinks } from "@ink-memory/db/schema/auth";
import type { AuthRepositoryDatabase } from "./database";
import { AuthBoundaryError } from "./config";
import { schemaCapabilities } from "@ink-memory/db/schema/capabilities";
import registrationContract from "../../../drizzle/contracts/identity-registration-integrity-v1.json";

export class SubjectRepository {
  constructor(private readonly database: AuthRepositoryDatabase) {}

  async assertNewEmail(email: string) {
    const existing = await this.database.select({ id: users.id }).from(users).where(eq(users.email, email)).limit(1);
    if (existing.length) throw new APIError("CONFLICT", { code: "LEGACY_SUBJECT_LINK_REQUIRED", message: "This account requires an explicit existing identity link." });
  }

  async linkNewAccount(authUserId: string, providerId: "google" | "credential", passwordHash?: string) {
    const linked = await this.database.select().from(subjectLinks).where(eq(subjectLinks.authUserId, authUserId)).limit(1);
    if (linked.length) return;
    // This forward-Drizzle security-definer function is the only canonical
    // insert granted to the auth role. It preserves trigger provisioning and
    // validates Free/default-model readiness inside the same transaction.
    try {
      const capabilities = await this.database.select({ hash: schemaCapabilities.contractSha256 }).from(schemaCapabilities).where(and(eq(schemaCapabilities.capability, "identity.registration-integrity.v1"), eq(schemaCapabilities.version, 1))).limit(1);
      if (capabilities[0]?.hash !== registrationContract.contract_sha256) throw new AuthBoundaryError("REGISTRATION_NOT_READY");
      await this.database.execute(sql`SELECT identity.register_canonical_user(${authUserId}, ${providerId}, ${passwordHash ?? null})`);
    } catch { throw new AuthBoundaryError("REGISTRATION_NOT_READY"); }
  }

  async hasActiveAdmin(authUserId: string) {
    const rows = await this.database.select({ id: adminUsers.id }).from(adminSubjectLinks)
      .innerJoin(adminUsers, eq(adminSubjectLinks.adminUserId, adminUsers.id))
      .where(and(eq(adminSubjectLinks.authUserId, authUserId), eq(adminUsers.status, "active"))).limit(1);
    return rows.length > 0;
  }

  async findActive(authUserId: string) {
    const rows = await this.database.select({
      canonicalUserId: subjectLinks.canonicalUserId, authUserId: subjectLinks.authUserId,
      platformUserId: platformUsers.id, tier: platformUsers.tier,
    }).from(subjectLinks).innerJoin(users, eq(subjectLinks.canonicalUserId, users.id))
      .innerJoin(platformUsers, and(eq(platformUsers.source, "ink-dream"), eq(platformUsers.external_user_id, sql`${subjectLinks.canonicalUserId}::text`)))
      .where(and(eq(subjectLinks.authUserId, authUserId), eq(users.admin_deprecated_status, "active"), eq(platformUsers.status, "active"))).limit(1);
    return rows[0] ?? null;
  }
}
