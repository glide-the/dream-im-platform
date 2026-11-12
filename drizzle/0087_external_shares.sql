-- [Input] Canonical users and existing shared Dream schema.
-- [Output] Owner-scoped immutable snapshots, exact DATA permissions and share capability.
-- [Pos] Drizzle-generated forward expand with reviewed ACL/capability SQL; no source deletion cascade.
CREATE TABLE "external_shares" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" bigint NOT NULL,
	"kind" text NOT NULL,
	"source_id" text NOT NULL,
	"token" text NOT NULL,
	"title" text NOT NULL,
	"snapshot" jsonb NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"revoked_at" timestamp with time zone,
	CONSTRAINT "external_shares_kind_check" CHECK ("external_shares"."kind" IN ('chat','note')),
	CONSTRAINT "external_shares_state_check" CHECK (("external_shares"."status" = 'active' AND "external_shares"."revoked_at" IS NULL) OR ("external_shares"."status" = 'revoked' AND "external_shares"."revoked_at" IS NOT NULL)),
	CONSTRAINT "external_shares_token_check" CHECK ("external_shares"."token" ~ '^[A-Za-z0-9_-]{43}$')
);
--> statement-breakpoint
ALTER TABLE "external_shares" ADD CONSTRAINT "external_shares_owner_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "external_shares_token_unique" ON "external_shares" USING btree ("token");--> statement-breakpoint
CREATE INDEX "external_shares_owner_kind_state_created" ON "external_shares" USING btree ("user_id","kind","status","created_at","id");

--> statement-breakpoint
DO $external_share_data_acl$
DECLARE
  data_role name;
  matching_roles integer;
BEGIN
  SELECT count(*)::integer, min(r.rolname)
    INTO matching_roles, data_role
    FROM pg_roles r
   WHERE r.rolcanlogin AND NOT r.rolsuper AND NOT r.rolcreatedb AND NOT r.rolcreaterole
     AND NOT r.rolreplication AND NOT r.rolbypassrls AND NOT r.rolinherit
     AND NOT EXISTS (SELECT 1 FROM pg_auth_members m WHERE m.member=r.oid)
     AND has_table_privilege(r.oid, 'public.chat_thread', 'SELECT')
     AND has_table_privilege(r.oid, 'public.chat_thread', 'INSERT')
     AND has_table_privilege(r.oid, 'public.chat_thread', 'UPDATE')
     AND has_table_privilege(r.oid, 'public.chat_thread', 'DELETE')
     AND has_table_privilege(r.oid, 'public.reflection_task_section', 'SELECT')
     AND has_table_privilege(r.oid, 'public.reflection_task_section', 'INSERT')
     AND has_table_privilege(r.oid, 'drizzle.schema_capabilities', 'SELECT');
  IF matching_roles > 1 THEN
    RAISE EXCEPTION 'EXTERNAL_SHARE_DATA_ROLE_AMBIGUOUS' USING ERRCODE = '55000';
  END IF;
  IF matching_roles = 1 THEN
    EXECUTE format('GRANT SELECT, INSERT, UPDATE ON TABLE public.external_shares TO %I', data_role);
  END IF;
END
$external_share_data_acl$;
--> statement-breakpoint
INSERT INTO drizzle.schema_capabilities (capability,version,contract_sha256,adopted_from,metadata) VALUES ('dream.external-share.v1',1,'14414d3204886c46eb0f38b1afa49acc6870822dcb93a6f4924b910a7857f8ba','0087_external_shares','{"phase":"expand","content":"immutable-snapshot","revoke":"terminal"}'::jsonb);
