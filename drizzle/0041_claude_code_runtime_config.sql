-- [Input] AIModelRegistry-owned optional Claude Code Runtime context values and the revisioned global effort policy contract.
-- [Output] Additive nullable positive model columns plus the exact cross-service Runtime capability receipt.
-- [Pos] Sole forward PostgreSQL DDL owner for dream.claude-code-runtime-config.v1; Dream only consumes it.
-- [Sync] 2026-08-28: publish model context columns and omit-when-unset/global-effort Runtime semantics.

ALTER TABLE "ai_models" ADD COLUMN "claude_code_auto_compact_window" integer;--> statement-breakpoint
ALTER TABLE "ai_models" ADD COLUMN "claude_code_max_context_tokens" integer;--> statement-breakpoint
ALTER TABLE "ai_models" ADD CONSTRAINT "ai_models_claude_code_auto_compact_window_check" CHECK ("ai_models"."claude_code_auto_compact_window" IS NULL OR "ai_models"."claude_code_auto_compact_window" > 0);--> statement-breakpoint
ALTER TABLE "ai_models" ADD CONSTRAINT "ai_models_claude_code_max_context_tokens_check" CHECK ("ai_models"."claude_code_max_context_tokens" IS NULL OR "ai_models"."claude_code_max_context_tokens" > 0);--> statement-breakpoint
INSERT INTO drizzle.schema_capabilities (
  capability,
  version,
  contract_sha256,
  adopted_from,
  metadata
) VALUES (
  'dream.claude-code-runtime-config.v1',
  1,
  '7b4d46bad9cfb340336a05aa9c9a2b70f5518622e5e2e94d47aac2ca76d63c1d',
  'admin-drizzle-0041',
  '{"effortLevels":["low","medium","high","xhigh","max"],"modelColumns":["claude_code_auto_compact_window","claude_code_max_context_tokens"],"nullable":true,"omitWhenUnset":true,"positiveInteger":true,"resourcePolicyField":"claudeCodeEffortLevel"}'::jsonb
);
