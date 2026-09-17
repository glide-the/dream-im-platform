CREATE TABLE "reflection_task_section" (
	"task_id" text NOT NULL,
	"section" text NOT NULL,
	"status" text DEFAULT 'PENDING' NOT NULL,
	"thread_id" text,
	"result_count" integer DEFAULT 0 NOT NULL,
	"error_summary" text,
	"revision" integer DEFAULT 1 NOT NULL,
	"started_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pk_reflection_task_section" PRIMARY KEY("task_id","section"),
	CONSTRAINT "ck_reflection_task_section_section" CHECK (section = ANY (ARRAY['echoes'::text, 'traits'::text, 'patterns'::text])),
	CONSTRAINT "ck_reflection_task_section_status" CHECK (status = ANY (ARRAY['PENDING'::text, 'RUNNING'::text, 'COMPLETED'::text, 'FAILED'::text])),
	CONSTRAINT "ck_reflection_task_section_result_count" CHECK (result_count >= 0),
	CONSTRAINT "ck_reflection_task_section_revision" CHECK (revision >= 1),
	CONSTRAINT "ck_reflection_task_section_lifecycle" CHECK ((status = 'PENDING' AND started_at IS NULL AND completed_at IS NULL AND result_count = 0) OR (status = 'RUNNING' AND started_at IS NOT NULL AND completed_at IS NULL AND result_count = 0) OR (status = 'COMPLETED' AND started_at IS NOT NULL AND completed_at IS NOT NULL AND error_summary IS NULL) OR (status = 'FAILED' AND completed_at IS NOT NULL AND result_count = 0))
);
--> statement-breakpoint
CREATE TABLE "dream"."reflection_task_authorities" (
	"token_hash" text PRIMARY KEY NOT NULL,
	"service_client_id" text NOT NULL,
	"task_id" text NOT NULL,
	"section" text NOT NULL,
	"thread_id" text NOT NULL,
	"auth_user_id" text NOT NULL,
	"canonical_user_id" bigint NOT NULL,
	"purpose" text DEFAULT 'reflections-worker' NOT NULL,
	"scopes" text[] NOT NULL,
	"request_id" text NOT NULL,
	"input_sha256" text NOT NULL,
	"token_ciphertext" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"maximum_expires_at" timestamp with time zone NOT NULL,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "reflection_task_authorities_hash_check" CHECK ("dream"."reflection_task_authorities"."input_sha256" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "reflection_task_authorities_purpose_scope_check" CHECK ("dream"."reflection_task_authorities"."purpose" = 'reflections-worker' AND cardinality("dream"."reflection_task_authorities"."scopes") = 2 AND "dream"."reflection_task_authorities"."scopes" @> ARRAY['dream:read','dream:write']::text[] AND array_position("dream"."reflection_task_authorities"."scopes", NULL) IS NULL),
	CONSTRAINT "reflection_task_authorities_expiry_check" CHECK ("dream"."reflection_task_authorities"."maximum_expires_at" >= "dream"."reflection_task_authorities"."expires_at" AND "dream"."reflection_task_authorities"."updated_at" >= "dream"."reflection_task_authorities"."created_at")
);
--> statement-breakpoint
LOCK TABLE "reflection_task_event" IN SHARE ROW EXCLUSIVE MODE;
--> statement-breakpoint
WITH ranked AS (
	SELECT event."id",
		row_number() OVER (
			PARTITION BY event."task_id"
			ORDER BY event."created_at" ASC NULLS LAST, event."id" ASC
		)::integer AS "new_sequence"
	FROM "reflection_task_event" AS event
)
UPDATE "reflection_task_event" AS event
SET "sequence" = ranked."new_sequence"
FROM ranked
WHERE event."id" = ranked."id";
--> statement-breakpoint
ALTER TABLE "reflection_task_event" ALTER COLUMN "sequence" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "analysis_reports" ADD COLUMN "reflection_task_id" text;--> statement-breakpoint
ALTER TABLE "reflection_task" ADD COLUMN "service_client_id" text;--> statement-breakpoint
ALTER TABLE "reflection_task" ADD COLUMN "auth_user_id" text;--> statement-breakpoint
ALTER TABLE "reflection_task" ADD COLUMN "launch_snapshot_json" text;--> statement-breakpoint
ALTER TABLE "reflection_task" ADD COLUMN "revision" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "reflection_task_section" ADD CONSTRAINT "fk_reflection_task_section_task_id_reflection_task" FOREIGN KEY ("task_id") REFERENCES "public"."reflection_task"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reflection_task_section" ADD CONSTRAINT "fk_reflection_task_section_thread_id_chat_thread" FOREIGN KEY ("thread_id") REFERENCES "public"."chat_thread"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dream"."reflection_task_authorities" ADD CONSTRAINT "reflection_task_authorities_auth_user_id_user_id_fk" FOREIGN KEY ("auth_user_id") REFERENCES "identity"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dream"."reflection_task_authorities" ADD CONSTRAINT "reflection_task_authorities_canonical_user_id_users_id_fk" FOREIGN KEY ("canonical_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dream"."reflection_task_authorities" ADD CONSTRAINT "reflection_task_authorities_task_section_fk" FOREIGN KEY ("task_id","section") REFERENCES "public"."reflection_task_section"("task_id","section") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dream"."reflection_task_authorities" ADD CONSTRAINT "reflection_task_authorities_thread_fk" FOREIGN KEY ("thread_id") REFERENCES "public"."chat_thread"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "uq_reflection_task_section_thread" ON "reflection_task_section" USING btree ("thread_id" text_ops) WHERE "reflection_task_section"."thread_id" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "reflection_task_authorities_live_uidx" ON "dream"."reflection_task_authorities" USING btree ("task_id","section") WHERE "dream"."reflection_task_authorities"."revoked_at" IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "reflection_task_authorities_request_uidx" ON "dream"."reflection_task_authorities" USING btree ("service_client_id","task_id","section","request_id");--> statement-breakpoint
ALTER TABLE "analysis_reports" ADD CONSTRAINT "fk_analysis_reports_reflection_task_id_reflection_task" FOREIGN KEY ("reflection_task_id") REFERENCES "public"."reflection_task"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "uq_analysis_reports_reflection_task" ON "analysis_reports" USING btree ("reflection_task_id" text_ops) WHERE "analysis_reports"."reflection_task_id" IS NOT NULL;--> statement-breakpoint
ALTER TABLE "reflection_task_event" ADD CONSTRAINT "uq_reflection_task_event_task_sequence" UNIQUE("task_id","sequence");--> statement-breakpoint
ALTER TABLE "reflection_task" ADD CONSTRAINT "ck_reflection_task_status" CHECK (status = ANY (ARRAY['CREATED'::text, 'ASSEMBLING'::text, 'QUEUED'::text, 'RUNNING'::text, 'COMPLETED'::text, 'PARTIAL_FAILED'::text, 'FAILED'::text]));--> statement-breakpoint
ALTER TABLE "reflection_task" ADD CONSTRAINT "ck_reflection_task_revision" CHECK (revision >= 1);--> statement-breakpoint
ALTER TABLE "reflection_task_event" ADD CONSTRAINT "ck_reflection_task_event_sequence" CHECK (sequence >= 1);--> statement-breakpoint
INSERT INTO drizzle.schema_capabilities (capability, version, contract_sha256, adopted_from, metadata) VALUES ('dream.reflection-task-persistence.v1', 1, '52340d24e76db9ee91dfbe8748ebaf3b0f3c2d20f15367c1c096d2e869d4753f', 'admin-drizzle-0061', '{"phase":"expand","task_binding":"service-subject-owner","launch_snapshot":"server-private-bounded","authority":"task-section-thread-max-expiry","event_sequence":"positive-unique","event_lock":"share-row-exclusive","report":"task-once"}'::jsonb);
