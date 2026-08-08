CREATE TABLE "gateway_request_payloads" (
	"gateway_request_id" text PRIMARY KEY NOT NULL,
	"method" text NOT NULL,
	"path" text NOT NULL,
	"query" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"protocol" text NOT NULL,
	"requested_model" text NOT NULL,
	"provider_protocol" text NOT NULL,
	"headers" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"body_json" jsonb,
	"body_text" text NOT NULL,
	"content_type" text,
	"byte_length" bigint NOT NULL,
	"sha256" text NOT NULL,
	"compression" text DEFAULT 'none' NOT NULL,
	"completion_status" text DEFAULT 'complete' NOT NULL,
	"capture_error" text,
	"captured_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "gateway_request_payloads_bytes_check" CHECK ("gateway_request_payloads"."byte_length" >= 0)
);
--> statement-breakpoint
ALTER TABLE "gateway_requests" ADD COLUMN "payload_capture_status" text DEFAULT 'pending' NOT NULL;--> statement-breakpoint
ALTER TABLE "gateway_requests" ADD COLUMN "payload_capture_error" text;--> statement-breakpoint
CREATE TABLE "gateway_response_events" (
	"id" text PRIMARY KEY NOT NULL,
	"gateway_request_id" text NOT NULL,
	"sequence" integer NOT NULL,
	"event_type" text NOT NULL,
	"raw_data" text NOT NULL,
	"raw_event" text NOT NULL,
	"byte_length" bigint NOT NULL,
	"elapsed_ms" integer NOT NULL,
	"emitted_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "gateway_response_events_sequence_check" CHECK ("gateway_response_events"."sequence" >= 0),
	CONSTRAINT "gateway_response_events_bytes_check" CHECK ("gateway_response_events"."byte_length" >= 0),
	CONSTRAINT "gateway_response_events_elapsed_check" CHECK ("gateway_response_events"."elapsed_ms" >= 0)
);
--> statement-breakpoint
CREATE TABLE "gateway_response_payloads" (
	"gateway_request_id" text PRIMARY KEY NOT NULL,
	"http_status" integer,
	"content_type" text,
	"headers" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"body_json" jsonb,
	"body_text" text,
	"byte_length" bigint DEFAULT 0 NOT NULL,
	"sha256" text,
	"compression" text DEFAULT 'none' NOT NULL,
	"completion_status" text DEFAULT 'pending' NOT NULL,
	"provider_request_id" text,
	"error_body" jsonb,
	"capture_error" text,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"first_event_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	CONSTRAINT "gateway_response_payloads_bytes_check" CHECK ("gateway_response_payloads"."byte_length" >= 0)
);
--> statement-breakpoint
ALTER TABLE "gateway_request_payloads" ADD CONSTRAINT "gateway_request_payloads_gateway_request_id_gateway_requests_id_fk" FOREIGN KEY ("gateway_request_id") REFERENCES "public"."gateway_requests"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gateway_response_events" ADD CONSTRAINT "gateway_response_events_gateway_request_id_gateway_requests_id_fk" FOREIGN KEY ("gateway_request_id") REFERENCES "public"."gateway_requests"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gateway_response_payloads" ADD CONSTRAINT "gateway_response_payloads_gateway_request_id_gateway_requests_id_fk" FOREIGN KEY ("gateway_request_id") REFERENCES "public"."gateway_requests"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "gateway_request_payloads_captured_idx" ON "gateway_request_payloads" USING btree ("captured_at");--> statement-breakpoint
CREATE UNIQUE INDEX "gateway_response_events_request_sequence_uidx" ON "gateway_response_events" USING btree ("gateway_request_id","sequence");--> statement-breakpoint
CREATE INDEX "gateway_response_events_request_idx" ON "gateway_response_events" USING btree ("gateway_request_id");--> statement-breakpoint
CREATE INDEX "gateway_response_payloads_completed_idx" ON "gateway_response_payloads" USING btree ("completed_at");--> statement-breakpoint
INSERT INTO "admin_permissions" ("id", "code", "name", "description")
VALUES (
  'perm_gateway_payloads_read',
  'gateway.payloads.read',
  'gateway.payloads.read',
  'View full redacted gateway request and response payloads'
)
ON CONFLICT ("code") DO UPDATE SET
  "name" = EXCLUDED."name",
  "description" = EXCLUDED."description";--> statement-breakpoint
INSERT INTO "admin_role_permissions" ("role_id", "permission_id")
SELECT r."id", p."id"
FROM "admin_roles" r
CROSS JOIN "admin_permissions" p
WHERE r."code" IN ('super_admin', 'auditor')
  AND p."code" = 'gateway.payloads.read'
ON CONFLICT DO NOTHING;
