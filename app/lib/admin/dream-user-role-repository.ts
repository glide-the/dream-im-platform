// [Input] A caller-owned PostgreSQL transaction and validated canonical Dream user identifiers/roles.
// [Output] Narrow row-locked reads and typed Drizzle updates for the canonical users.role field.
// [Pos] ORM persistence adapter for Dream product role administration; no generic table or column selection.
// [Sync] 2026-09-17: add the explicit Dream user-role repository while preserving Admin identity separation.
import type { PoolClient } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { sql } from "drizzle-orm";
import { users } from "@ink-memory/db/schema";
import type {
  DreamProductRole,
  DreamUserRoleRecord,
} from "./dream-user-role-dto";

const roleFields = {
  id: sql<string>`${users.id}::text`,
  email: users.email,
  display_name: users.display_name,
  role: users.role,
  updated_at: sql<string>`${users.updated_at}::text`,
};

export type StoredDreamUserRoleRecord = Omit<DreamUserRoleRecord, "role"> & {
  role: string;
};

export interface DreamUserRoleStore {
  lockById(id: string): Promise<StoredDreamUserRoleRecord | null>;
  updateRole(id: string, role: DreamProductRole): Promise<StoredDreamUserRoleRecord | null>;
}

export class DrizzleDreamUserRoleRepository implements DreamUserRoleStore {
  private readonly database;

  constructor(client: PoolClient) {
    this.database = drizzle(client);
  }

  async lockById(id: string) {
    const rows = await this.database
      .select(roleFields)
      .from(users)
      .where(sql`${users.id} = ${id}::bigint`)
      .limit(1)
      .for("update");
    return rows[0] ?? null;
  }

  async updateRole(id: string, role: DreamProductRole) {
    const rows = await this.database
      .update(users)
      .set({ role, updated_at: sql`CURRENT_TIMESTAMP` })
      .where(sql`${users.id} = ${id}::bigint`)
      .returning(roleFields);
    return rows[0] ?? null;
  }
}
