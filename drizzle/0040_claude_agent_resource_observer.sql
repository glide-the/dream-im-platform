-- [Input] Dream's content-free Claude Agent process resource snapshots.
-- [Output] Additive latest-instance snapshot relation and exact cross-service capability metadata.
-- [Pos] Sole forward PostgreSQL DDL owner for dream.claude-agent-resource-observer.v1.
-- [Sync] 2026-08-27: align the descending heartbeat index and publish the canonical DB-clock contract hash last.

CREATE TABLE "claude_agent_resource_snapshots" (
	"instance_id" text PRIMARY KEY NOT NULL,
	"process_started_at" timestamp with time zone NOT NULL,
	"heartbeat_at" timestamp with time zone NOT NULL,
	"sampled_at" timestamp with time zone,
	"snapshot" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ck_claude_agent_resource_snapshots_instance_id" CHECK (length(instance_id) BETWEEN 1 AND 128),
	CONSTRAINT "ck_claude_agent_resource_snapshots_snapshot" CHECK (jsonb_typeof(snapshot) = 'object'::text),
	CONSTRAINT "ck_claude_agent_resource_snapshots_heartbeat" CHECK (heartbeat_at >= process_started_at),
	CONSTRAINT "ck_claude_agent_resource_snapshots_sampled" CHECK (sampled_at IS NULL OR (sampled_at >= process_started_at AND sampled_at <= heartbeat_at)),
	CONSTRAINT "ck_claude_agent_resource_snapshots_updated" CHECK (updated_at >= created_at)
);
--> statement-breakpoint
CREATE INDEX "idx_claude_agent_resource_snapshots_heartbeat" ON "claude_agent_resource_snapshots" USING btree ("heartbeat_at" DESC NULLS LAST);
--> statement-breakpoint
INSERT INTO drizzle.schema_capabilities (
  capability,
  version,
  contract_sha256,
  adopted_from,
  metadata
) VALUES (
  'dream.claude-agent-resource-observer.v1',
  1,
  'db2ba80eb61a9515ba23000f8a615fb41f6ed5824bd306e8d0ca5fb8f1cc044e',
  'admin-drizzle-0040',
  '{"contentFree":true,"latestInstance":true,"tables":["claude_agent_resource_snapshots"]}'::jsonb
);
