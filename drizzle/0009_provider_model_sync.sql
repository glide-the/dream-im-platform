CREATE TABLE "ai_pricing_sync_snapshots" (
	"id" text PRIMARY KEY NOT NULL,
	"provider_id" text,
	"catalog_ref" text NOT NULL,
	"catalog_version" text NOT NULL,
	"catalog_hash" text NOT NULL,
	"status" text DEFAULT 'ready' NOT NULL,
	"matches" jsonb NOT NULL,
	"created_by" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"applied_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ai_pricing_sync_status_check" CHECK ("ai_pricing_sync_snapshots"."status" IN ('ready', 'applied', 'expired'))
);
--> statement-breakpoint
CREATE TABLE "ai_provider_discovery_snapshots" (
	"id" text PRIMARY KEY NOT NULL,
	"provider_id" text NOT NULL,
	"provider_updated_at" timestamp with time zone NOT NULL,
	"status" text DEFAULT 'ready' NOT NULL,
	"endpoint" text NOT NULL,
	"catalog_hash" text NOT NULL,
	"models" jsonb NOT NULL,
	"diff" jsonb NOT NULL,
	"created_by" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"applied_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ai_provider_discovery_status_check" CHECK ("ai_provider_discovery_snapshots"."status" IN ('ready', 'applied', 'expired'))
);
--> statement-breakpoint
ALTER TABLE "ai_pricing_rules" ADD COLUMN "source" text DEFAULT 'manual' NOT NULL;--> statement-breakpoint
ALTER TABLE "ai_pricing_rules" ADD COLUMN "source_ref" text;--> statement-breakpoint
ALTER TABLE "ai_pricing_rules" ADD COLUMN "source_version" text;--> statement-breakpoint
ALTER TABLE "ai_pricing_rules" ADD COLUMN "source_metadata" jsonb DEFAULT '{}'::jsonb;--> statement-breakpoint
ALTER TABLE "ai_pricing_sync_snapshots" ADD CONSTRAINT "ai_pricing_sync_snapshots_provider_id_ai_providers_id_fk" FOREIGN KEY ("provider_id") REFERENCES "public"."ai_providers"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_provider_discovery_snapshots" ADD CONSTRAINT "ai_provider_discovery_snapshots_provider_id_ai_providers_id_fk" FOREIGN KEY ("provider_id") REFERENCES "public"."ai_providers"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ai_pricing_sync_provider_idx" ON "ai_pricing_sync_snapshots" USING btree ("provider_id","created_at");--> statement-breakpoint
CREATE INDEX "ai_pricing_sync_expiry_idx" ON "ai_pricing_sync_snapshots" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "ai_provider_discovery_provider_idx" ON "ai_provider_discovery_snapshots" USING btree ("provider_id","created_at");--> statement-breakpoint
CREATE INDEX "ai_provider_discovery_expiry_idx" ON "ai_provider_discovery_snapshots" USING btree ("expires_at");
