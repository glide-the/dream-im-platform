INSERT INTO "admin_permissions" ("id", "code", "name", "description")
VALUES
  ('permission_storage_read', 'storage.read', 'Read Storage resources', 'List, inspect, preview and download Storage objects'),
  ('permission_storage_write', 'storage.write', 'Upload Storage resources', 'Upload files through the protected Admin Storage facade'),
  ('permission_storage_delete', 'storage.delete', 'Delete Storage resources', 'Delete an exact Storage object with confirmation and audit')
ON CONFLICT ("code") DO NOTHING;
--> statement-breakpoint
INSERT INTO "admin_role_permissions" ("role_id", "permission_id")
SELECT r.id, p.id
FROM "admin_roles" r
JOIN "admin_permissions" p ON p.code IN ('storage.read', 'storage.write', 'storage.delete')
WHERE r.code IN ('super_admin', 'operator')
ON CONFLICT DO NOTHING;
--> statement-breakpoint
INSERT INTO "admin_role_permissions" ("role_id", "permission_id")
SELECT r.id, p.id
FROM "admin_roles" r
JOIN "admin_permissions" p ON p.code = 'storage.read'
WHERE r.code = 'auditor'
ON CONFLICT DO NOTHING;
