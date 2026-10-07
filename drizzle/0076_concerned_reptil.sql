ALTER TABLE "identity"."runtime_delegations" DROP CONSTRAINT "runtime_delegations_authority_source_check";--> statement-breakpoint
ALTER TABLE "identity"."runtime_delegations" ADD CONSTRAINT "runtime_delegations_authority_source_check" CHECK ((
    "identity"."runtime_delegations"."authority_source" IS NULL
    AND "identity"."runtime_delegations"."source_message_id" IS NULL
    AND "identity"."runtime_delegations"."source_claim_id" IS NULL
    AND "identity"."runtime_delegations"."source_reflection_authority_hash" IS NULL
    AND "identity"."runtime_delegations"."source_task_result_id" IS NULL
    AND "identity"."runtime_delegations"."source_task_result_claim_id" IS NULL
  ) OR (
    "identity"."runtime_delegations"."authority_source" = 'story-confirmation-claim'
    AND "identity"."runtime_delegations"."source_message_id" IS NOT NULL
    AND "identity"."runtime_delegations"."source_claim_id" IS NOT NULL
    AND "identity"."runtime_delegations"."source_reflection_authority_hash" IS NULL
    AND "identity"."runtime_delegations"."source_task_result_id" IS NULL
    AND "identity"."runtime_delegations"."source_task_result_claim_id" IS NULL
    AND "identity"."runtime_delegations"."purpose" = 'server-persistence'
    AND "identity"."runtime_delegations"."run_id" IS NOT NULL
    AND "identity"."runtime_delegations"."editor_session_id" IS NULL
    AND "identity"."runtime_delegations"."gateway_api_key_id" IS NULL
  ) OR (
    "identity"."runtime_delegations"."authority_source" = 'reflection-task-authority'
    AND "identity"."runtime_delegations"."source_message_id" IS NULL
    AND "identity"."runtime_delegations"."source_claim_id" IS NULL
    AND "identity"."runtime_delegations"."source_reflection_authority_hash" IS NOT NULL
    AND "identity"."runtime_delegations"."source_task_result_id" IS NULL
    AND "identity"."runtime_delegations"."source_task_result_claim_id" IS NULL
    AND "identity"."runtime_delegations"."purpose" = 'gateway-cli'
    AND "identity"."runtime_delegations"."run_id" IS NULL
    AND "identity"."runtime_delegations"."editor_session_id" IS NULL
    AND "identity"."runtime_delegations"."gateway_api_key_id" IS NOT NULL
  ) OR (
    "identity"."runtime_delegations"."authority_source" = 'task-result-claim'
    AND "identity"."runtime_delegations"."source_message_id" IS NULL
    AND "identity"."runtime_delegations"."source_claim_id" IS NULL
    AND "identity"."runtime_delegations"."source_reflection_authority_hash" IS NULL
    AND "identity"."runtime_delegations"."source_task_result_id" IS NOT NULL
    AND "identity"."runtime_delegations"."source_task_result_claim_id" IS NOT NULL
    AND (
      ("identity"."runtime_delegations"."purpose" = 'server-persistence' AND "identity"."runtime_delegations"."gateway_api_key_id" IS NULL) OR
      ("identity"."runtime_delegations"."purpose" = 'gateway-cli' AND "identity"."runtime_delegations"."gateway_api_key_id" IS NOT NULL)
    )
    AND "identity"."runtime_delegations"."run_id" IS NULL
    AND "identity"."runtime_delegations"."editor_session_id" IS NULL
  ) OR (
    "identity"."runtime_delegations"."authority_source" = 'scheduled-chat-authority'
    AND "identity"."runtime_delegations"."source_message_id" IS NULL
    AND "identity"."runtime_delegations"."source_claim_id" IS NULL
    AND "identity"."runtime_delegations"."source_reflection_authority_hash" IS NULL
    AND "identity"."runtime_delegations"."source_task_result_id" IS NULL
    AND "identity"."runtime_delegations"."source_task_result_claim_id" IS NULL
    AND "identity"."runtime_delegations"."purpose" IN ('server-persistence','gateway-cli','editor-stdio')
    AND "identity"."runtime_delegations"."run_id" IS NULL
    AND (("identity"."runtime_delegations"."purpose" = 'server-persistence' AND "identity"."runtime_delegations"."editor_session_id" IS NULL AND "identity"."runtime_delegations"."gateway_api_key_id" IS NULL)
      OR ("identity"."runtime_delegations"."purpose" = 'gateway-cli' AND "identity"."runtime_delegations"."editor_session_id" IS NULL AND "identity"."runtime_delegations"."gateway_api_key_id" IS NOT NULL)
      OR ("identity"."runtime_delegations"."purpose" = 'editor-stdio' AND "identity"."runtime_delegations"."editor_session_id" IS NOT NULL AND "identity"."runtime_delegations"."gateway_api_key_id" IS NULL))
  ));--> statement-breakpoint
INSERT INTO "drizzle"."schema_capabilities" (
	"capability", "version", "contract_sha256", "adopted_from", "metadata"
) VALUES (
	'dream.chat-scheduled-task.v2',
	2,
	'41de2c831e60a0365a8d9fb99b64e224a677f730de9f4d1a783b15cb6478d2e5',
	'admin-drizzle-0076',
	'{"definition":"public.chat_scheduled_task","trigger":"public.chat_scheduled_trigger","execution_target":"public.chat_task_session","rules":["once","daily","interval"],"editor_target_snapshot":true,"unknown_recheck_cursor":true,"scheduled_editor_grant":true}'::jsonb
);
