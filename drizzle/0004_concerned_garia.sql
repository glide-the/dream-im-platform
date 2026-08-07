ALTER TABLE "gateway_requests" ADD COLUMN "outcome" text DEFAULT 'pending' NOT NULL;--> statement-breakpoint
ALTER TABLE "ai_pricing_rules" ADD CONSTRAINT "ai_pricing_rules_input_price_check" CHECK ("ai_pricing_rules"."input_price_microusd_per_million" >= 0);--> statement-breakpoint
ALTER TABLE "ai_pricing_rules" ADD CONSTRAINT "ai_pricing_rules_output_price_check" CHECK ("ai_pricing_rules"."output_price_microusd_per_million" >= 0);--> statement-breakpoint
ALTER TABLE "ai_pricing_rules" ADD CONSTRAINT "ai_pricing_rules_cache_read_price_check" CHECK ("ai_pricing_rules"."cache_read_price_microusd_per_million" >= 0);--> statement-breakpoint
ALTER TABLE "ai_pricing_rules" ADD CONSTRAINT "ai_pricing_rules_cache_write_price_check" CHECK ("ai_pricing_rules"."cache_write_price_microusd_per_million" >= 0);--> statement-breakpoint
ALTER TABLE "ai_pricing_rules" ADD CONSTRAINT "ai_pricing_rules_markup_check" CHECK ("ai_pricing_rules"."markup_bps" BETWEEN 0 AND 100000);--> statement-breakpoint
ALTER TABLE "ai_pricing_rules" ADD CONSTRAINT "ai_pricing_rules_discount_check" CHECK ("ai_pricing_rules"."discount_bps" BETWEEN 0 AND 10000);--> statement-breakpoint
ALTER TABLE "ai_pricing_rules" ADD CONSTRAINT "ai_pricing_rules_effective_window_check" CHECK ("ai_pricing_rules"."effective_to" IS NULL OR "ai_pricing_rules"."effective_to" > "ai_pricing_rules"."effective_from");--> statement-breakpoint
ALTER TABLE "ai_providers" ADD CONSTRAINT "ai_providers_protocol_check" CHECK ("ai_providers"."protocol" IN ('anthropic', 'openai'));--> statement-breakpoint
ALTER TABLE "ai_providers" ADD CONSTRAINT "ai_providers_timeout_check" CHECK ("ai_providers"."timeout_ms" > 0);--> statement-breakpoint
ALTER TABLE "ai_providers" ADD CONSTRAINT "ai_providers_retries_check" CHECK ("ai_providers"."max_retries" BETWEEN 0 AND 5);--> statement-breakpoint
ALTER TABLE "billing_accounts" ADD CONSTRAINT "billing_accounts_reserved_check" CHECK ("billing_accounts"."reserved_microusd" >= 0);--> statement-breakpoint
ALTER TABLE "billing_accounts" ADD CONSTRAINT "billing_accounts_lifetime_debited_check" CHECK ("billing_accounts"."lifetime_debited_microusd" >= 0);--> statement-breakpoint
ALTER TABLE "billing_ledger_entries" ADD CONSTRAINT "billing_ledger_entries_amount_check" CHECK ("billing_ledger_entries"."amount_microusd" > 0);--> statement-breakpoint
ALTER TABLE "billing_ledger_entries" ADD CONSTRAINT "billing_ledger_entries_reserved_after_check" CHECK ("billing_ledger_entries"."reserved_after_microusd" >= 0);--> statement-breakpoint
ALTER TABLE "gateway_rate_limits" ADD CONSTRAINT "gateway_rate_limits_request_count_check" CHECK ("gateway_rate_limits"."request_count" >= 0);--> statement-breakpoint
ALTER TABLE "gateway_rate_limits" ADD CONSTRAINT "gateway_rate_limits_token_count_check" CHECK ("gateway_rate_limits"."token_count" >= 0);--> statement-breakpoint
ALTER TABLE "gateway_requests" ADD CONSTRAINT "gateway_requests_input_tokens_check" CHECK ("gateway_requests"."input_tokens" >= 0);--> statement-breakpoint
ALTER TABLE "gateway_requests" ADD CONSTRAINT "gateway_requests_output_tokens_check" CHECK ("gateway_requests"."output_tokens" >= 0);--> statement-breakpoint
ALTER TABLE "gateway_requests" ADD CONSTRAINT "gateway_requests_cache_read_tokens_check" CHECK ("gateway_requests"."cache_read_tokens" >= 0);--> statement-breakpoint
ALTER TABLE "gateway_requests" ADD CONSTRAINT "gateway_requests_cache_write_tokens_check" CHECK ("gateway_requests"."cache_write_tokens" >= 0);--> statement-breakpoint
ALTER TABLE "gateway_requests" ADD CONSTRAINT "gateway_requests_money_check" CHECK ("gateway_requests"."reserved_microusd" >= 0 AND "gateway_requests"."provider_cost_microusd" >= 0 AND "gateway_requests"."charged_microusd" >= 0);--> statement-breakpoint
ALTER TABLE "platform_users" ADD CONSTRAINT "platform_users_daily_token_limit_check" CHECK ("platform_users"."daily_token_limit" IS NULL OR "platform_users"."daily_token_limit" >= 0);--> statement-breakpoint
ALTER TABLE "platform_users" ADD CONSTRAINT "platform_users_monthly_token_limit_check" CHECK ("platform_users"."monthly_token_limit" IS NULL OR "platform_users"."monthly_token_limit" >= 0);
--> statement-breakpoint
CREATE OR REPLACE FUNCTION reject_ai_control_append_only_mutation()
RETURNS trigger AS $$
BEGIN
	RAISE EXCEPTION '% is append-only', TG_TABLE_NAME;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER billing_ledger_entries_no_update
BEFORE UPDATE ON "billing_ledger_entries"
FOR EACH ROW EXECUTE FUNCTION reject_ai_control_append_only_mutation();
--> statement-breakpoint
CREATE TRIGGER billing_ledger_entries_no_delete
BEFORE DELETE ON "billing_ledger_entries"
FOR EACH ROW EXECUTE FUNCTION reject_ai_control_append_only_mutation();
--> statement-breakpoint
CREATE TRIGGER admin_audit_logs_no_update
BEFORE UPDATE ON "admin_audit_logs"
FOR EACH ROW EXECUTE FUNCTION reject_ai_control_append_only_mutation();
--> statement-breakpoint
CREATE TRIGGER admin_audit_logs_no_delete
BEFORE DELETE ON "admin_audit_logs"
FOR EACH ROW EXECUTE FUNCTION reject_ai_control_append_only_mutation();
