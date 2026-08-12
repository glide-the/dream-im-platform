-- Replace the historical deployment-environment classification with the single
-- topology fact the runtime actually implements: local persistent placement.
-- The two columns remain for receipt/session compatibility, but they no longer
-- select different business behavior.

DO $dream_local_placement_preflight$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM agent_sessions AS session
    JOIN runtime_load_receipts AS receipt
      ON receipt.receipt_id = session.runtime_load_receipt_id
    WHERE session.deployment_tier IS DISTINCT FROM receipt.deployment_tier
  ) THEN
    RAISE EXCEPTION USING
      ERRCODE = '55000',
      MESSAGE = 'DREAM_RUNTIME_PLACEMENT_BINDING_MISMATCH';
  END IF;
END
$dream_local_placement_preflight$;
--> statement-breakpoint
ALTER TABLE "agent_sessions" DROP CONSTRAINT "ck_agent_sessions_2";
--> statement-breakpoint
ALTER TABLE "runtime_load_receipts" DROP CONSTRAINT "ck_runtime_load_receipts_2";
--> statement-breakpoint
ALTER TABLE "agent_sessions" DISABLE TRIGGER USER;
--> statement-breakpoint
ALTER TABLE "runtime_load_receipts" DISABLE TRIGGER USER;
--> statement-breakpoint
UPDATE "runtime_load_receipts"
SET "deployment_tier" = 'local'
WHERE "deployment_tier" <> 'local';
--> statement-breakpoint
UPDATE "agent_sessions"
SET "deployment_tier" = 'local'
WHERE "deployment_tier" <> 'local';
--> statement-breakpoint
ALTER TABLE "runtime_load_receipts" ENABLE TRIGGER USER;
--> statement-breakpoint
ALTER TABLE "agent_sessions" ENABLE TRIGGER USER;
--> statement-breakpoint
ALTER TABLE "agent_sessions"
ADD CONSTRAINT "ck_agent_sessions_2"
CHECK (deployment_tier = 'local'::text);
--> statement-breakpoint
ALTER TABLE "runtime_load_receipts"
ADD CONSTRAINT "ck_runtime_load_receipts_2"
CHECK (deployment_tier = 'local'::text);
--> statement-breakpoint
DO $dream_local_placement_postflight$
BEGIN
  IF EXISTS (
    SELECT 1 FROM runtime_load_receipts WHERE deployment_tier <> 'local'
  ) OR EXISTS (
    SELECT 1 FROM agent_sessions WHERE deployment_tier <> 'local'
  ) THEN
    RAISE EXCEPTION USING
      ERRCODE = '55000',
      MESSAGE = 'DREAM_RUNTIME_PLACEMENT_NORMALIZATION_FAILED';
  END IF;

  INSERT INTO drizzle.schema_capabilities (
    capability,
    version,
    contract_sha256,
    adopted_from,
    metadata
  ) VALUES (
    'dream.runtime.local-placement.v1',
    1,
    '87fbd3c28bc077992bfa0e12674e71b59182ea08934314c02560c8b577c50983',
    'admin-drizzle-0034',
    '{"distributionMode":"local_persistent","deploymentTier":"local","environmentBranching":false}'::jsonb
  );
END
$dream_local_placement_postflight$;
