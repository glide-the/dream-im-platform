ALTER TABLE "identity"."runtime_delegations" DROP CONSTRAINT "runtime_delegations_authority_source_check";--> statement-breakpoint
ALTER TABLE "identity"."runtime_delegations" ADD COLUMN "source_reflection_authority_hash" text;--> statement-breakpoint
ALTER TABLE "identity"."runtime_delegations" ADD CONSTRAINT "runtime_delegations_reflection_authority_fk" FOREIGN KEY ("source_reflection_authority_hash") REFERENCES "dream"."reflection_task_authorities"("token_hash") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "identity"."runtime_delegations" ADD CONSTRAINT "runtime_delegations_authority_source_check" CHECK ((
    "identity"."runtime_delegations"."authority_source" IS NULL
    AND "identity"."runtime_delegations"."source_message_id" IS NULL
    AND "identity"."runtime_delegations"."source_claim_id" IS NULL
    AND "identity"."runtime_delegations"."source_reflection_authority_hash" IS NULL
  ) OR (
    "identity"."runtime_delegations"."authority_source" = 'story-confirmation-claim'
    AND "identity"."runtime_delegations"."source_message_id" IS NOT NULL
    AND "identity"."runtime_delegations"."source_claim_id" IS NOT NULL
    AND "identity"."runtime_delegations"."source_reflection_authority_hash" IS NULL
    AND "identity"."runtime_delegations"."purpose" = 'server-persistence'
    AND "identity"."runtime_delegations"."run_id" IS NOT NULL
    AND "identity"."runtime_delegations"."editor_session_id" IS NULL
    AND "identity"."runtime_delegations"."gateway_api_key_id" IS NULL
  ) OR (
    "identity"."runtime_delegations"."authority_source" = 'reflection-task-authority'
    AND "identity"."runtime_delegations"."source_message_id" IS NULL
    AND "identity"."runtime_delegations"."source_claim_id" IS NULL
    AND "identity"."runtime_delegations"."source_reflection_authority_hash" IS NOT NULL
    AND "identity"."runtime_delegations"."purpose" = 'gateway-cli'
    AND "identity"."runtime_delegations"."run_id" IS NULL
    AND "identity"."runtime_delegations"."editor_session_id" IS NULL
    AND "identity"."runtime_delegations"."gateway_api_key_id" IS NOT NULL
  ));--> statement-breakpoint
INSERT INTO drizzle.schema_capabilities (capability, version, contract_sha256, adopted_from, metadata) VALUES (
  'identity.runtime-reflection-authority.v1',
  1,
  'edaab1b52c9a8791270c729ce5f87b01df6a858cfcd25295b7ab3bdff539402d',
  'admin-drizzle-0063',
  '{"schema":"identity","phase":"expand","authority_source":"reflection-task-authority","source_fencing":"live-task-section-authority"}'::jsonb
);
