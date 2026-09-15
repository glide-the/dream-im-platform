// [Input] Data ORM UOW and server-verified canonical/auth user identity.
// [Output] Explicit profile column projection and linked provider IDs.
// [Pos] Current profile PostgreSQL repository; password/token columns are never selected.
import { eq, sql } from "drizzle-orm";
import { users } from "@ink-memory/db/schema";
import { account } from "@ink-memory/db/schema/auth-generated";
import type { DataTransaction } from "./database";
export class UserProfileRepository {
  constructor(private readonly tx: DataTransaction) {}
  async current(canonicalUserId: string, authUserId: string) {
    const rows = await this.tx.select({ id: sql<string>`${users.id}::text`, email: users.email, display_name: users.display_name, avatar_url: users.avatar_url, role: users.role, created_at: sql<string>`${users.created_at}::text`, updated_at: sql<string>`${users.updated_at}::text` }).from(users).where(eq(users.id, sql`${canonicalUserId}::bigint`)).limit(1);
    if (!rows[0]) return null;
    const providers = await this.tx.select({ provider: account.providerId }).from(account).where(eq(account.userId, authUserId));
    return { profile: rows[0], providers: providers.map(value => value.provider) };
  }
}
