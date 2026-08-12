-- Remove the historical Dream-only `continuing` implementation state.
--
-- This is a forward data correction, not a new workflow transition. Existing
-- transition identities, sequence numbers, actors, reasons, errors and times
-- remain unchanged; only the obsolete state label is normalized to the
-- existing `confirmed` business state. The migration runner executes this
-- file and its receipt in one transaction under the global advisory lock.

DO $dream_no_continuing_preflight$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM workflow_runs
    WHERE status NOT IN (
      'preflight', 'queued', 'running', 'output_validating',
      'pending_review', 'confirmed', 'rejected', 'continuing',
      'completed', 'failed', 'cancelled'
    )
  ) THEN
    RAISE EXCEPTION USING
      ERRCODE = '55000',
      MESSAGE = 'DREAM_WORKFLOW_STATUS_UNKNOWN';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM workflow_run_transitions
    WHERE (from_status IS NOT NULL AND from_status NOT IN (
      'preflight', 'queued', 'running', 'output_validating',
      'pending_review', 'confirmed', 'rejected', 'continuing',
      'completed', 'failed', 'cancelled'
    )) OR to_status NOT IN (
      'preflight', 'queued', 'running', 'output_validating',
      'pending_review', 'confirmed', 'rejected', 'continuing',
      'completed', 'failed', 'cancelled'
    )
  ) THEN
    RAISE EXCEPTION USING
      ERRCODE = '55000',
      MESSAGE = 'DREAM_WORKFLOW_TRANSITION_STATUS_UNKNOWN';
  END IF;

  IF to_regprocedure(
    'public.dream_guard_workflow_runs_joint_session_binding_guard()'
  ) IS NULL THEN
    RAISE EXCEPTION USING
      ERRCODE = '55000',
      MESSAGE = 'DREAM_WORKFLOW_GUARD_MISSING';
  END IF;
END
$dream_no_continuing_preflight$;
--> statement-breakpoint
ALTER TABLE "workflow_runs" DISABLE TRIGGER USER;
--> statement-breakpoint
ALTER TABLE "workflow_run_transitions" DISABLE TRIGGER USER;
--> statement-breakpoint
UPDATE "workflow_runs"
SET "status" = 'confirmed'
WHERE "status" = 'continuing';
--> statement-breakpoint
UPDATE "workflow_run_transitions"
SET
  "from_status" = CASE
    WHEN "from_status" = 'continuing' THEN 'confirmed'
    ELSE "from_status"
  END,
  "to_status" = CASE
    WHEN "to_status" = 'continuing' THEN 'confirmed'
    ELSE "to_status"
  END
WHERE "from_status" = 'continuing' OR "to_status" = 'continuing';
--> statement-breakpoint
ALTER TABLE "workflow_run_transitions" ENABLE TRIGGER USER;
--> statement-breakpoint
ALTER TABLE "workflow_runs" ENABLE TRIGGER USER;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.dream_guard_workflow_runs_joint_session_binding_guard()
RETURNS trigger
LANGUAGE plpgsql
AS $function$
BEGIN
  IF (NEW.runtime_load_receipt_id IS NULL) != (NEW.agent_session_id IS NULL)
    OR (
      OLD.runtime_load_receipt_id IS NULL
      AND OLD.agent_session_id IS NULL
      AND NEW.runtime_load_receipt_id IS NOT NULL
      AND NOT (OLD.status = 'queued' AND NEW.status = 'running')
    )
    OR (
      OLD.runtime_load_receipt_id IS NOT NULL
      AND (
        OLD.runtime_load_receipt_id IS DISTINCT FROM NEW.runtime_load_receipt_id
        OR OLD.agent_session_id IS DISTINCT FROM NEW.agent_session_id
      )
    )
    OR (
      NEW.status IN (
        'running', 'output_validating', 'pending_review', 'confirmed',
        'rejected', 'completed'
      )
      AND NEW.runtime_load_receipt_id IS NULL
    )
    OR (
      NEW.status IN ('preflight', 'queued')
      AND NEW.runtime_load_receipt_id IS NOT NULL
    )
    OR (
      NEW.agent_session_id IS NOT NULL
      AND (
        NEW.agent_session_id = NEW.source_voice_thread_id
        OR NEW.agent_session_id = NEW.source_message_id
      )
    )
    OR (
      NEW.agent_session_id IS NOT NULL
      AND OLD.agent_session_id IS NULL
      AND NOT EXISTS (
        SELECT 1
        FROM agent_sessions AS session
        WHERE session.agent_session_id = NEW.agent_session_id
          AND session.workflow_run_id = NEW.id
          AND session.runtime_load_receipt_id = NEW.runtime_load_receipt_id
          AND session.runtime_plugin_lock_id = NEW.runtime_plugin_lock_id
          AND session.status = 'active'
      )
    ) THEN
    RAISE EXCEPTION USING
      ERRCODE = '55000',
      MESSAGE = 'workflow run receipt and session binding is invalid';
  END IF;
  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$function$;
--> statement-breakpoint
ALTER TABLE "workflow_runs" DROP CONSTRAINT "ck_workflow_runs_1";
--> statement-breakpoint
ALTER TABLE "workflow_runs" ADD CONSTRAINT "ck_workflow_runs_1" CHECK (
  status = ANY (ARRAY[
    'preflight'::text,
    'queued'::text,
    'running'::text,
    'output_validating'::text,
    'pending_review'::text,
    'confirmed'::text,
    'rejected'::text,
    'completed'::text,
    'failed'::text,
    'cancelled'::text
  ])
);
--> statement-breakpoint
DO $dream_no_continuing_postflight$
DECLARE
  contract_hash constant text :=
    '8b71cf5687f61dee884c3e6f2fb109c7a951b0789066a0f13583a7b67757fa71';
BEGIN
  IF EXISTS (
    SELECT 1 FROM workflow_runs WHERE status = 'continuing'
  ) OR EXISTS (
    SELECT 1
    FROM workflow_run_transitions
    WHERE from_status = 'continuing' OR to_status = 'continuing'
  ) OR position(
    'continuing' IN pg_get_functiondef(
      'public.dream_guard_workflow_runs_joint_session_binding_guard()'::regprocedure
    )
  ) > 0 OR position(
    'continuing' IN pg_get_constraintdef(
      (
        SELECT oid
        FROM pg_constraint
        WHERE conrelid = 'public.workflow_runs'::regclass
          AND conname = 'ck_workflow_runs_1'
      ),
      true
    )
  ) > 0 THEN
    RAISE EXCEPTION USING
      ERRCODE = '55000',
      MESSAGE = 'DREAM_CONTINUING_STATUS_REMAINS';
  END IF;

  UPDATE drizzle.schema_capabilities
  SET
    contract_sha256 = contract_hash,
    metadata = metadata || '{"workflowLifecycle":"no-continuing/v1"}'::jsonb
  WHERE capability IN (
    'dream.schema.unified.v1',
    'dream.workflow.thread-lookup.v1',
    'dream.story-artifact-contract.v2'
  );
  IF NOT FOUND OR (
    SELECT count(*)
    FROM drizzle.schema_capabilities
    WHERE capability IN (
      'dream.schema.unified.v1',
      'dream.workflow.thread-lookup.v1',
      'dream.story-artifact-contract.v2'
    )
      AND contract_sha256 = contract_hash
  ) != 3 THEN
    RAISE EXCEPTION USING
      ERRCODE = '55000',
      MESSAGE = 'DREAM_CAPABILITY_BASELINE_MISMATCH';
  END IF;

  INSERT INTO drizzle.schema_capabilities (
    capability,
    version,
    contract_sha256,
    adopted_from,
    metadata
  ) VALUES (
    'dream.workflow.no-continuing.v1',
    1,
    contract_hash,
    'admin-drizzle-0033',
    '{"legacyStatus":"continuing","normalizedStatus":"confirmed"}'::jsonb
  );
END
$dream_no_continuing_postflight$;
