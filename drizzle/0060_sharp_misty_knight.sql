CREATE TABLE "dream"."workflow_preflight_requests" (
	"service_client_id" text NOT NULL,
	"actor" text NOT NULL,
	"request_id" text NOT NULL,
	"input_sha256" text NOT NULL,
	"workflow_preflight_id" text NOT NULL,
	"canonical_user_id" bigint NOT NULL,
	"workspace_id" text NOT NULL,
	"execution_owner" boolean NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "workflow_preflight_requests_service_client_id_actor_request_id_pk" PRIMARY KEY("service_client_id","actor","request_id"),
	CONSTRAINT "workflow_preflight_requests_hash_check" CHECK ("dream"."workflow_preflight_requests"."input_sha256" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "workflow_preflight_requests_owner_check" CHECK ("dream"."workflow_preflight_requests"."canonical_user_id" > 0)
);
--> statement-breakpoint
ALTER TABLE "dream"."workflow_preflight_requests" ADD CONSTRAINT "workflow_preflight_requests_workflow_preflight_id_workflow_preflights_workflow_preflight_id_fk" FOREIGN KEY ("workflow_preflight_id") REFERENCES "public"."workflow_preflights"("workflow_preflight_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "workflow_preflight_requests_preflight_idx" ON "dream"."workflow_preflight_requests" USING btree ("workflow_preflight_id");
--> statement-breakpoint
CREATE FUNCTION dream.guard_workflow_preflight_request_immutable()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog
AS $function$
BEGIN
  RAISE EXCEPTION USING ERRCODE = '55000', MESSAGE = 'workflow preflight requests are immutable';
END;
$function$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION dream.guard_workflow_preflight_request_immutable() FROM PUBLIC;
--> statement-breakpoint
CREATE TRIGGER workflow_preflight_requests_immutable
BEFORE UPDATE OR DELETE OR TRUNCATE ON dream.workflow_preflight_requests
FOR EACH STATEMENT EXECUTE FUNCTION dream.guard_workflow_preflight_request_immutable();
--> statement-breakpoint
INSERT INTO drizzle.schema_capabilities (capability, version, contract_sha256, adopted_from, metadata) VALUES ('dream.workflow-preflight-request.v1', 1, '7123babb03535e0a0c7a818e902c331cefbe73c660b46395136dcc9a5b19f3da', 'admin-drizzle-0060', '{"phase":"expand","request_binding":"immutable-original-preflight","response_storage":"aead-receipt"}'::jsonb);
