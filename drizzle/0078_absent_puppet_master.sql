-- [Input] Existing Admin/Gateway PostgreSQL schema and runtime delegation scope contract.
-- [Output] Additive Image model/pricing/request fields, validated constraints, and exact capability receipt.
-- [Pos] Forward-only expand/compatibility/validate contract for gateway.images.v1.
-- [Sync] 2026-10-09: add Image API persistence and images:create delegation without runtime DDL.

-- Expand with nullable columns so the previous application remains compatible.
ALTER TABLE "ai_models" ADD COLUMN "image_input_token_reserve_per_image" integer;--> statement-breakpoint
ALTER TABLE "ai_models" ADD COLUMN "image_output_token_reserve_per_image" integer;--> statement-breakpoint
ALTER TABLE "ai_pricing_rules" ADD COLUMN "image_input_price_microusd_per_million" bigint;--> statement-breakpoint
ALTER TABLE "ai_pricing_rules" ADD COLUMN "image_output_price_microusd_per_million" bigint;--> statement-breakpoint
ALTER TABLE "gateway_requests" ADD COLUMN "operation" text;--> statement-breakpoint
ALTER TABLE "gateway_requests" ADD COLUMN "input_text_tokens" bigint;--> statement-breakpoint
ALTER TABLE "gateway_requests" ADD COLUMN "input_image_tokens" bigint;--> statement-breakpoint
ALTER TABLE "gateway_requests" ADD COLUMN "output_text_tokens" bigint;--> statement-breakpoint
ALTER TABLE "gateway_requests" ADD COLUMN "output_image_tokens" bigint;--> statement-breakpoint
ALTER TABLE "gateway_requests" ADD COLUMN "image_input_price_snapshot" bigint;--> statement-breakpoint
ALTER TABLE "gateway_requests" ADD COLUMN "image_output_price_snapshot" bigint;--> statement-breakpoint

-- Compatibility backfill and contract for all historical text requests.
UPDATE "gateway_requests" SET "operation" = 'text' WHERE "operation" IS NULL;--> statement-breakpoint
ALTER TABLE "gateway_requests" ALTER COLUMN "operation" SET DEFAULT 'text';--> statement-breakpoint
ALTER TABLE "gateway_requests" ADD CONSTRAINT "gateway_requests_operation_not_null_v0078" CHECK ("operation" IS NOT NULL) NOT VALID;--> statement-breakpoint
ALTER TABLE "gateway_requests" VALIDATE CONSTRAINT "gateway_requests_operation_not_null_v0078";--> statement-breakpoint
ALTER TABLE "gateway_requests" ALTER COLUMN "operation" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "gateway_requests" DROP CONSTRAINT "gateway_requests_operation_not_null_v0078";--> statement-breakpoint

-- Add checks without blocking the expand step, then validate existing rows.
ALTER TABLE "ai_models" ADD CONSTRAINT "ai_models_image_input_token_reserve_check" CHECK ("image_input_token_reserve_per_image" IS NULL OR "image_input_token_reserve_per_image" > 0) NOT VALID;--> statement-breakpoint
ALTER TABLE "ai_models" ADD CONSTRAINT "ai_models_image_output_token_reserve_check" CHECK ("image_output_token_reserve_per_image" IS NULL OR "image_output_token_reserve_per_image" > 0) NOT VALID;--> statement-breakpoint
ALTER TABLE "ai_pricing_rules" ADD CONSTRAINT "ai_pricing_rules_image_input_price_check" CHECK ("image_input_price_microusd_per_million" IS NULL OR "image_input_price_microusd_per_million" >= 0) NOT VALID;--> statement-breakpoint
ALTER TABLE "ai_pricing_rules" ADD CONSTRAINT "ai_pricing_rules_image_output_price_check" CHECK ("image_output_price_microusd_per_million" IS NULL OR "image_output_price_microusd_per_million" >= 0) NOT VALID;--> statement-breakpoint
ALTER TABLE "gateway_requests" ADD CONSTRAINT "gateway_requests_operation_check" CHECK ("operation" IN ('text', 'images.generations', 'images.edits')) NOT VALID;--> statement-breakpoint
ALTER TABLE "gateway_requests" ADD CONSTRAINT "gateway_requests_image_token_details_check" CHECK (("input_text_tokens" IS NULL OR "input_text_tokens" >= 0) AND ("input_image_tokens" IS NULL OR "input_image_tokens" >= 0) AND ("output_text_tokens" IS NULL OR "output_text_tokens" >= 0) AND ("output_image_tokens" IS NULL OR "output_image_tokens" >= 0)) NOT VALID;--> statement-breakpoint
ALTER TABLE "gateway_requests" ADD CONSTRAINT "gateway_requests_image_price_snapshot_check" CHECK (("image_input_price_snapshot" IS NULL OR "image_input_price_snapshot" >= 0) AND ("image_output_price_snapshot" IS NULL OR "image_output_price_snapshot" >= 0)) NOT VALID;--> statement-breakpoint
ALTER TABLE "ai_models" VALIDATE CONSTRAINT "ai_models_image_input_token_reserve_check";--> statement-breakpoint
ALTER TABLE "ai_models" VALIDATE CONSTRAINT "ai_models_image_output_token_reserve_check";--> statement-breakpoint
ALTER TABLE "ai_pricing_rules" VALIDATE CONSTRAINT "ai_pricing_rules_image_input_price_check";--> statement-breakpoint
ALTER TABLE "ai_pricing_rules" VALIDATE CONSTRAINT "ai_pricing_rules_image_output_price_check";--> statement-breakpoint
ALTER TABLE "gateway_requests" VALIDATE CONSTRAINT "gateway_requests_operation_check";--> statement-breakpoint
ALTER TABLE "gateway_requests" VALIDATE CONSTRAINT "gateway_requests_image_token_details_check";--> statement-breakpoint
ALTER TABLE "gateway_requests" VALIDATE CONSTRAINT "gateway_requests_image_price_snapshot_check";--> statement-breakpoint

-- Replace the runtime purpose constraint only after the broader constraint validates.
ALTER TABLE "identity"."runtime_delegations" ADD CONSTRAINT "runtime_delegations_purpose_check_v0078" CHECK (("purpose" IS NULL AND "editor_session_id" IS NULL) OR ("purpose" IS NOT NULL AND cardinality("scopes") > 0 AND array_position("scopes", NULL) IS NULL AND (("purpose" = 'server-persistence' AND "editor_session_id" IS NULL AND "gateway_api_key_id" IS NULL AND "scopes" <@ ARRAY['dream:read','dream:write']::text[]) OR ("purpose" = 'gateway-cli' AND "editor_session_id" IS NULL AND "gateway_api_key_id" IS NOT NULL AND "scopes" <@ ARRAY['messages:create','messages:count_tokens','models:list','images:create']::text[]) OR ("purpose" = 'editor-stdio' AND "editor_session_id" IS NOT NULL AND "gateway_api_key_id" IS NULL AND "scopes" <@ ARRAY['editor:read','editor:write']::text[])))) NOT VALID;--> statement-breakpoint
ALTER TABLE "identity"."runtime_delegations" VALIDATE CONSTRAINT "runtime_delegations_purpose_check_v0078";--> statement-breakpoint
ALTER TABLE "identity"."runtime_delegations" DROP CONSTRAINT "runtime_delegations_purpose_check";--> statement-breakpoint
ALTER TABLE "identity"."runtime_delegations" RENAME CONSTRAINT "runtime_delegations_purpose_check_v0078" TO "runtime_delegations_purpose_check";--> statement-breakpoint

-- Publish only after every physical field and constraint is valid.
INSERT INTO "drizzle"."schema_capabilities" (
  "capability", "version", "contract_sha256", "adopted_from", "metadata"
) VALUES (
  'gateway.images.v1',
  1,
  '073808fc6d828d46266d35ee4d7649477dddddb0e8f0e40351f34d52137b4eed',
  'admin-drizzle-0078',
  '{"phase":"validated","providers":["codex","openai"],"operations":["images.generations","images.edits"],"usage_unit":"provider-image-tokens","payload_capture":"disabled"}'::jsonb
);
