ALTER TABLE "deck_versions" ADD COLUMN "snapshot_canonical_json" text;--> statement-breakpoint
ALTER TABLE "deck_versions" ADD CONSTRAINT "ck_deck_versions_canonical_projection" CHECK ("snapshot_canonical_json" IS NULL OR "snapshot_canonical_json"::jsonb = "snapshot_json");
--> statement-breakpoint
INSERT INTO drizzle.schema_capabilities (capability, version, contract_sha256, adopted_from, metadata) VALUES ('dream.deck-content-canonical-storage.v1', 1, '97a95f92efecf3435890fcb3f9c1ce46e33fbed8a3de4dca3a632484de4f1c76', 'admin-drizzle-0059', '{"phase":"expand","storage":"canonical-text-and-jsonb","legacy_null":"jsonb-projection-compatibility"}'::jsonb);
