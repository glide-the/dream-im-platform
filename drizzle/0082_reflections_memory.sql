-- [Input] Admin forward schema and exact frozen memory contract.
-- [Output] Durable artifact/config storage plus dream.memory.v1 capability.
-- [Pos] Drizzle-owned shared PostgreSQL migration; no runtime DDL.
-- [Sync] 2026-10-15: additive Reflections L2/L3 storage.
CREATE TABLE "memory_artifact" (
	"id" text NOT NULL,
	"revision" integer NOT NULL,
	"user_id" bigint NOT NULL,
	"report_id" bigint NOT NULL,
	"service_client_id" text NOT NULL,
	"source_json" text NOT NULL,
	"source_sha256" text NOT NULL,
	"conversion_revision" text NOT NULL,
	"state" text DEFAULT 'pending' NOT NULL,
	"claim_token" text,
	"claim_expires_at" timestamp with time zone,
	"document" text,
	"document_sha256" text,
	"body_sha256" text,
	"byte_length" integer,
	"theme_state" text DEFAULT 'pending' NOT NULL,
	"theme_document" text,
	"theme_sha256" text,
	"metadata_json" text DEFAULT '{}' NOT NULL,
	"error_code" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "memory_artifact_id_revision_pk" PRIMARY KEY("id","revision"),
	CONSTRAINT "uq_memory_artifact_source" UNIQUE("report_id","source_sha256","conversion_revision"),
	CONSTRAINT "memory_artifact_revision_check" CHECK ("memory_artifact"."revision" >= 1),
	CONSTRAINT "memory_artifact_state_check" CHECK ("memory_artifact"."state" IN ('pending','running','publishing','ready','empty','failed')),
	CONSTRAINT "memory_theme_state_check" CHECK ("memory_artifact"."theme_state" IN ('pending','ready','empty','failed'))
);
--> statement-breakpoint
CREATE TABLE "memory_behavior_settings" (
	"user_id" bigint PRIMARY KEY NOT NULL,
	"revision" integer NOT NULL,
	"desired_json" text NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "memory_behavior_revision_check" CHECK ("memory_behavior_settings"."revision" >= 1)
);
--> statement-breakpoint
ALTER TABLE "memory_artifact" ADD CONSTRAINT "fk_memory_artifact_owner" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "memory_artifact" ADD CONSTRAINT "fk_memory_artifact_report" FOREIGN KEY ("report_id") REFERENCES "public"."analysis_reports"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "memory_behavior_settings" ADD CONSTRAINT "fk_memory_behavior_owner" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_memory_artifact_owner" ON "memory_artifact" USING btree ("user_id","created_at","id");--> statement-breakpoint
CREATE INDEX "idx_memory_artifact_claim" ON "memory_artifact" USING btree ("service_client_id","state","claim_expires_at");
--> statement-breakpoint
INSERT INTO drizzle.schema_capabilities (capability,version,contract_sha256,adopted_from,metadata)
VALUES ('dream.memory.v1',1,'d08fae4c65a4ee448d64e80ebfcb371c2fbfb0a9fe1091825971c35756aacbc6','0082_reflections_memory','{"owner":"Admin Drizzle","conversion":"memory-rules-v1"}'::jsonb);
