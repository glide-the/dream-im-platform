CREATE TABLE "ai_model_route_policies" (
	"model_id" text PRIMARY KEY NOT NULL,
	"status" text NOT NULL,
	"revision" integer NOT NULL,
	"desired" jsonb NOT NULL,
	"effective" jsonb,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ai_model_route_policies_status_check" CHECK ("ai_model_route_policies"."status" IN ('draft', 'active', 'disabled')),
	CONSTRAINT "ai_model_route_policies_revision_check" CHECK ("ai_model_route_policies"."revision" > 0),
	CONSTRAINT "ai_model_route_policies_effective_check" CHECK (("ai_model_route_policies"."status" = 'active' AND "ai_model_route_policies"."effective" IS NOT NULL) OR ("ai_model_route_policies"."status" <> 'active' AND "ai_model_route_policies"."effective" IS NULL))
);
--> statement-breakpoint
CREATE TABLE "ai_model_route_targets" (
	"model_id" text NOT NULL,
	"provider_id" text NOT NULL,
	"upstream_model" text NOT NULL,
	"weight" integer NOT NULL,
	"position" integer NOT NULL,
	CONSTRAINT "ai_model_route_targets_model_id_provider_id_pk" PRIMARY KEY("model_id","provider_id"),
	CONSTRAINT "ai_model_route_targets_weight_check" CHECK ("ai_model_route_targets"."weight" > 0),
	CONSTRAINT "ai_model_route_targets_position_check" CHECK ("ai_model_route_targets"."position" >= 0)
);
--> statement-breakpoint
ALTER TABLE "gateway_requests" ADD COLUMN "routing_snapshot" jsonb;--> statement-breakpoint
ALTER TABLE "gateway_requests" ADD COLUMN "routing_attempts" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "ai_model_route_policies" ADD CONSTRAINT "ai_model_route_policies_model_id_ai_models_id_fk" FOREIGN KEY ("model_id") REFERENCES "public"."ai_models"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_model_route_targets" ADD CONSTRAINT "ai_model_route_targets_model_id_ai_model_route_policies_model_id_fk" FOREIGN KEY ("model_id") REFERENCES "public"."ai_model_route_policies"("model_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_model_route_targets" ADD CONSTRAINT "ai_model_route_targets_provider_id_ai_providers_id_fk" FOREIGN KEY ("provider_id") REFERENCES "public"."ai_providers"("id") ON DELETE restrict ON UPDATE no action;