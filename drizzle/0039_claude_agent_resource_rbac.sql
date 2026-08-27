-- [Input] Existing Admin roles plus the canonical system.read/system.write permission codes.
-- [Output] Idempotent Claude Agent resource-console RBAC grants.
-- [Pos] Additive Admin control-plane migration; no Dream runtime schema or business data.

INSERT INTO "admin_permissions" ("id", "code", "name", "description") VALUES
  ('perm_system_read', 'system.read', 'system.read', 'Read protected system diagnostics and desired configuration'),
  ('perm_system_write', 'system.write', 'system.write', 'Update audited desired system configuration')
ON CONFLICT ("code") DO UPDATE SET
  "name" = EXCLUDED."name",
  "description" = EXCLUDED."description";
--> statement-breakpoint
INSERT INTO "admin_role_permissions" ("role_id", "permission_id")
SELECT role."id", permission."id"
FROM "admin_roles" AS role
CROSS JOIN "admin_permissions" AS permission
WHERE
  (role."code" IN ('super_admin', 'operator') AND permission."code" IN ('system.read', 'system.write'))
  OR (role."code" = 'auditor' AND permission."code" = 'system.read')
ON CONFLICT DO NOTHING;
