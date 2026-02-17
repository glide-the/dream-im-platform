CREATE TABLE "system_configs" (
	"id" text PRIMARY KEY DEFAULT 'default' NOT NULL,
	"system_prompt" text,
	"model" text,
	"provider" text,
	"theme" text,
	"workspace_enabled" boolean DEFAULT true,
	"extras" jsonb,
	"created_at" timestamp with time zone,
	"updated_at" timestamp with time zone
);
