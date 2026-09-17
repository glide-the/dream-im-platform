ALTER TABLE "identity"."runtime_delegations" ADD COLUMN "authority_source" text;--> statement-breakpoint
ALTER TABLE "identity"."runtime_delegations" ADD COLUMN "source_message_id" text;--> statement-breakpoint
ALTER TABLE "identity"."runtime_delegations" ADD COLUMN "source_claim_id" text;--> statement-breakpoint
ALTER TABLE "identity"."runtime_delegations" ADD CONSTRAINT "runtime_delegations_source_message_id_chat_message_id_fk" FOREIGN KEY ("source_message_id") REFERENCES "public"."chat_message"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "runtime_delegations_confirmation_claim_uidx" ON "identity"."runtime_delegations" USING btree ("service_client_id","source_message_id","source_claim_id") WHERE "identity"."runtime_delegations"."authority_source" = 'story-confirmation-claim';--> statement-breakpoint
ALTER TABLE "identity"."runtime_delegations" ADD CONSTRAINT "runtime_delegations_authority_source_check" CHECK ((
    "identity"."runtime_delegations"."authority_source" IS NULL AND "identity"."runtime_delegations"."source_message_id" IS NULL AND "identity"."runtime_delegations"."source_claim_id" IS NULL
  ) OR (
    "identity"."runtime_delegations"."authority_source" = 'story-confirmation-claim'
    AND "identity"."runtime_delegations"."source_message_id" IS NOT NULL
    AND "identity"."runtime_delegations"."source_claim_id" IS NOT NULL
    AND "identity"."runtime_delegations"."purpose" = 'server-persistence'
    AND "identity"."runtime_delegations"."run_id" IS NOT NULL
    AND "identity"."runtime_delegations"."editor_session_id" IS NULL
    AND "identity"."runtime_delegations"."gateway_api_key_id" IS NULL
  ));--> statement-breakpoint
INSERT INTO drizzle.schema_capabilities (capability, version, contract_sha256, adopted_from, metadata) VALUES (
  'identity.runtime-confirmation-claim.v1',
  1,
  'd9de67655e6d8d5ae9654d6502a2cf5d9ab1bb6d829975b243eb25e239b08919',
  'admin-drizzle-0062',
  '{"schema":"identity","phase":"expand","authority_source":"story-confirmation-claim","claim_fencing":"message-lock-and-database-clock"}'::jsonb
);
