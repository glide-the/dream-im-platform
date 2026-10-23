-- [Input] Existing memory storage and immutable v1 capability.
-- [Output] Exact v2 classification/protocol capability; no new tables or data backfill.
-- [Pos] Admin forward release; legacy sources/files and settings revisions remain unchanged.
-- [Sync] 2026-10-15: publish versioned Notion-aligned compound classification.
DO $$ BEGIN
 IF NOT EXISTS (SELECT 1 FROM drizzle.schema_capabilities WHERE capability='dream.memory.v1' AND version=1 AND contract_sha256='d08fae4c65a4ee448d64e80ebfcb371c2fbfb0a9fe1091825971c35756aacbc6') THEN
  RAISE EXCEPTION 'MEMORY_V1_CAPABILITY_REQUIRED';
 END IF;
END $$;
--> statement-breakpoint
INSERT INTO drizzle.schema_capabilities (capability,version,contract_sha256,adopted_from,metadata)
VALUES ('dream.memory.classification.v2',1,'524f90e1af9526db91ee2d1f9ae6cfb3d210e56e3e5217aacead82dae57efb79','0085_memory_classification_v2_capability','{"owner":"Admin Drizzle","conversion":"memory-rules-v2","history":"append-only"}'::jsonb);
