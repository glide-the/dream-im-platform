-- [Input] Previously published identity/unified/Images physical capabilities and existing image-turn receipt storage.
-- [Output] Exact image-turn capability after structure validation; no new table, automatic role grant or business backfill.
-- [Pos] Admin-owned forward contract; Gateway verifies its actual role permissions separately before use.
-- [Sync] 2026-10-10: publish append-only turn/source/selection/execution facts on the existing JSONB receipt table.
DO $image_turn_contract$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM drizzle.schema_capabilities WHERE capability = 'identity.better-auth.v1' AND version = 1 AND contract_sha256 = '1dc05e229d3f4147923fcdfe117c4c4930a43bf9f31439d7b4bc83d2a0d04cd3')
    OR NOT EXISTS (SELECT 1 FROM drizzle.schema_capabilities WHERE capability = 'dream.schema.unified.v1' AND version = 1 AND contract_sha256 = '8b71cf5687f61dee884c3e6f2fb109c7a951b0789066a0f13583a7b67757fa71')
    OR NOT EXISTS (SELECT 1 FROM drizzle.schema_capabilities WHERE capability = 'gateway.images.v1' AND version = 1 AND contract_sha256 = '073808fc6d828d46266d35ee4d7649477dddddb0e8f0e40351f34d52137b4eed') THEN
    RAISE EXCEPTION 'IMAGE_TURN_BASE_CAPABILITY_UNAVAILABLE';
  END IF;
  IF (SELECT count(*) FROM information_schema.columns WHERE table_schema = 'dream' AND table_name = 'operation_receipts' AND is_nullable = 'NO'
        AND ((column_name IN ('service_client_id','actor','operation','request_id','input_sha256') AND data_type = 'text') OR (column_name = 'result' AND data_type = 'jsonb'))) <> 6
    OR NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'gateway_requests' AND column_name = 'response_summary' AND data_type = 'jsonb')
    OR (SELECT count(*) FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'chat_message' AND column_name IN ('id','thread_id','role')) <> 3 THEN
    RAISE EXCEPTION 'IMAGE_TURN_STORAGE_INVALID';
  END IF;
END
$image_turn_contract$;
--> statement-breakpoint
INSERT INTO drizzle.schema_capabilities (capability, version, contract_sha256, adopted_from, metadata)
VALUES ('dream.image-turn.v1', 1, '2f7e1eedb84d974b6bf203611acaf22b00d1cb82e377276a73822e73253f96e2', 'admin-drizzle-0080',
  '{"phase":"validated","storage":"existing-jsonb-receipts","gateway_role_permissions":"separate-explicit-activation-and-runtime-check","payload":"safe-identifiers-and-hashes-only"}'::jsonb);
