import { withPlatformTransaction } from "../platform-db";
import { createPlatformId } from "../platform-ids";
import { recordAdminAuditOnClient } from "./audit";
import { AdminError } from "./errors";
import { hashAdminPassword } from "./password";

const PERMISSIONS = [
  "dashboard.read",
  "story.read",
  "story.write",
  "users.read",
  "users.write",
  "providers.read",
  "providers.write",
  "models.read",
  "models.write",
  "pricing.read",
  "pricing.write",
  "billing.read",
  "billing.adjust",
  "gateway.read",
  "gateway.keys.write",
  "access.read",
  "access.write",
  "system.read",
  "system.write",
  "audit.read",
] as const;

const ROLE_PERMISSIONS: Record<string, readonly string[]> = {
  super_admin: PERMISSIONS,
  operator: PERMISSIONS.filter(
    (permission) =>
      !["billing.adjust", "access.write"].includes(permission),
  ),
  auditor: PERMISSIONS.filter(
    (permission) => permission.endsWith(".read"),
  ),
};

export async function bootstrapFirstAdmin(input: {
  email: string;
  displayName?: string;
  password: string;
  request: Request;
  requestId: string;
}) {
  const passwordHash = await hashAdminPassword(input.password);
  return await withPlatformTransaction(async (client) => {
    await client.query("LOCK TABLE admin_users IN EXCLUSIVE MODE");
    const count = await client.query<{ count: string }>(
      "SELECT COUNT(*)::text AS count FROM admin_users",
    );
    if (count.rows[0]?.count !== "0") {
      throw new AdminError(
        "ADMIN_ALREADY_BOOTSTRAPPED",
        "The first admin has already been created",
        409,
      );
    }

    const permissionIds = new Map<string, string>();
    for (const code of PERMISSIONS) {
      const id = createPlatformId("perm");
      const result = await client.query<{ id: string }>(
        `INSERT INTO admin_permissions (id, code, name)
         VALUES ($1, $2, $2)
         ON CONFLICT (code) DO UPDATE SET name = EXCLUDED.name
         RETURNING id`,
        [id, code],
      );
      permissionIds.set(code, result.rows[0].id);
    }

    const roleIds = new Map<string, string>();
    for (const [code, permissions] of Object.entries(ROLE_PERMISSIONS)) {
      const id = createPlatformId("role");
      const result = await client.query<{ id: string }>(
        `INSERT INTO admin_roles (id, code, name)
         VALUES ($1, $2, $2)
         ON CONFLICT (code) DO UPDATE SET name = EXCLUDED.name
         RETURNING id`,
        [id, code],
      );
      const roleId = result.rows[0].id;
      roleIds.set(code, roleId);
      for (const permission of permissions) {
        await client.query(
          `INSERT INTO admin_role_permissions (role_id, permission_id)
           VALUES ($1, $2)
           ON CONFLICT DO NOTHING`,
          [roleId, permissionIds.get(permission)],
        );
      }
    }

    const adminUserId = createPlatformId("admin");
    await client.query(
      `INSERT INTO admin_users (
         id, email, display_name, password_hash, status
       ) VALUES ($1, $2, $3, $4, 'active')`,
      [
        adminUserId,
        input.email.trim().toLowerCase(),
        input.displayName?.trim() || null,
        passwordHash,
      ],
    );
    await client.query(
      `INSERT INTO admin_user_roles (admin_user_id, role_id)
       VALUES ($1, $2)`,
      [adminUserId, roleIds.get("super_admin")],
    );
    await recordAdminAuditOnClient(client, {
      action: "bootstrap",
      resourceType: "admin_user",
      resourceId: adminUserId,
      requestId: input.requestId,
      request: input.request,
      after: { email: input.email.trim().toLowerCase(), role: "super_admin" },
    });
    return { adminUserId };
  });
}
