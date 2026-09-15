ALTER TABLE "identity"."runtime_delegations" ADD COLUMN "oauth_client_id" text;--> statement-breakpoint
ALTER TABLE "identity"."runtime_delegations" ADD COLUMN "request_id" text;--> statement-breakpoint
ALTER TABLE "identity"."runtime_delegations" ADD COLUMN "input_sha256" text;--> statement-breakpoint
ALTER TABLE "identity"."runtime_delegations" ADD COLUMN "token_ciphertext" text;--> statement-breakpoint
ALTER TABLE "identity"."runtime_delegations" ADD COLUMN "gateway_api_key_id" text;--> statement-breakpoint
ALTER TABLE "identity"."runtime_delegations" ADD COLUMN "maximum_expires_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "identity"."runtime_delegations" ADD CONSTRAINT "runtime_delegations_gateway_api_key_id_gateway_api_keys_id_fk" FOREIGN KEY ("gateway_api_key_id") REFERENCES "public"."gateway_api_keys"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "runtime_delegations_request_uidx" ON "identity"."runtime_delegations" USING btree ("service_client_id","auth_user_id","request_id");--> statement-breakpoint
ALTER TABLE "identity"."runtime_delegations" ADD CONSTRAINT "runtime_delegations_maximum_expiry_check" CHECK ("identity"."runtime_delegations"."maximum_expires_at" IS NULL OR "identity"."runtime_delegations"."maximum_expires_at" >= "identity"."runtime_delegations"."expires_at");--> statement-breakpoint
ALTER TABLE "identity"."runtime_delegations" ADD CONSTRAINT "runtime_delegations_creation_check" CHECK ("identity"."runtime_delegations"."request_id" IS NULL OR ("identity"."runtime_delegations"."oauth_client_id" IS NOT NULL AND "identity"."runtime_delegations"."input_sha256" ~ '^[0-9a-f]{64}$' AND "identity"."runtime_delegations"."token_ciphertext" IS NOT NULL AND "identity"."runtime_delegations"."maximum_expires_at" IS NOT NULL));
--> statement-breakpoint
INSERT INTO drizzle.schema_capabilities (capability, version, contract_sha256, adopted_from, metadata) VALUES ('identity.runtime-delegation.v1', 1, '1a682e29c2fcfa6d870a64c131773f0fa2ce49866fc56b30f334e07040e79a83', 'admin-drizzle-0055', '{"schema":"identity","phase":"expand","token_storage":"sha256+encrypted-recovery"}'::jsonb);
