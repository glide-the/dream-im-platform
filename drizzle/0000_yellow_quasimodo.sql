CREATE TABLE IF NOT EXISTS "conversations" (
	"id" text PRIMARY KEY NOT NULL,
	"title" text,
	"status" text,
	"created_at" timestamp with time zone,
	"updated_at" timestamp with time zone,
	"messages" jsonb,
	"attachments" jsonb,
	"context_customer_ids" text[],
	"ai_outputs" jsonb,
	"linked_customer_id" text
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "customers" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text,
	"company" text,
	"title" text,
	"phones" text[],
	"emails" text[],
	"wechat" text,
	"address" text,
	"tags" text[],
	"decision_chain" jsonb,
	"profile_markdown" text,
	"created_at" timestamp with time zone,
	"updated_at" timestamp with time zone,
	"source" text,
	"last_verified_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "todos" (
	"id" text PRIMARY KEY NOT NULL,
	"title" text,
	"description" text,
	"priority" text,
	"status" text,
	"created_at" timestamp with time zone,
	"updated_at" timestamp with time zone
);
