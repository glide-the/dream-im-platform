-- Deck content versioning expand. Existing Deck/Voice/ref/binding rows remain
-- the mutable durable draft; this table stores only explicit immutable commits.
CREATE TABLE "deck_versions" (
	"id" text PRIMARY KEY NOT NULL,
	"deck_id" text NOT NULL,
	"version" integer NOT NULL,
	"base_version" integer,
	"source_draft_revision" integer NOT NULL,
	"description" text,
	"snapshot_json" jsonb NOT NULL,
	"content_hash" text NOT NULL,
	"created_by" bigint NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "uq_deck_versions_deck_id_version" UNIQUE("deck_id","version"),
	CONSTRAINT "ck_deck_versions_version" CHECK (version >= 1),
	CONSTRAINT "ck_deck_versions_base_version" CHECK (base_version IS NULL OR base_version >= 1),
	CONSTRAINT "ck_deck_versions_source_draft_revision" CHECK (source_draft_revision >= 1)
);
--> statement-breakpoint
ALTER TABLE "decks" ADD COLUMN "draft_revision" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "decks" ADD COLUMN "latest_version" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "decks" ADD COLUMN "published_draft_revision" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "deck_versions" ADD CONSTRAINT "fk_deck_versions_deck_id_decks" FOREIGN KEY ("deck_id") REFERENCES "public"."decks"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deck_versions" ADD CONSTRAINT "fk_deck_versions_created_by_users" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_deck_versions_deck_created" ON "deck_versions" USING btree ("deck_id" text_ops,"created_at" timestamptz_ops);--> statement-breakpoint
ALTER TABLE "decks" ADD CONSTRAINT "ck_decks_draft_revision" CHECK (draft_revision >= 1);--> statement-breakpoint
ALTER TABLE "decks" ADD CONSTRAINT "ck_decks_latest_version" CHECK (latest_version >= 0);--> statement-breakpoint
ALTER TABLE "decks" ADD CONSTRAINT "ck_decks_published_draft_revision" CHECK (published_draft_revision >= 0 AND published_draft_revision <= draft_revision);--> statement-breakpoint
CREATE OR REPLACE FUNCTION dream_guard_deck_versions_append_only()
RETURNS trigger
LANGUAGE plpgsql
AS $deck_versions_append_only$
BEGIN
  RAISE EXCEPTION USING
    ERRCODE = '55000',
    MESSAGE = 'DECK_CONTENT_VERSION_IMMUTABLE';
END
$deck_versions_append_only$;--> statement-breakpoint
CREATE TRIGGER deck_versions_no_update
BEFORE UPDATE ON deck_versions
FOR EACH ROW EXECUTE FUNCTION dream_guard_deck_versions_append_only();--> statement-breakpoint
CREATE TRIGGER deck_versions_no_delete
BEFORE DELETE ON deck_versions
FOR EACH ROW EXECUTE FUNCTION dream_guard_deck_versions_append_only();--> statement-breakpoint
INSERT INTO drizzle.schema_capabilities (
  capability,
  version,
  contract_sha256,
  adopted_from,
  metadata
) VALUES (
  'dream.deck-content-versions.v1',
  1,
  'ca7ad5914895d6aa9e8c7d576b9af3ed65b44f34318e068d2fc10c90e351e4c3',
  'admin-drizzle-0036',
  '{"draftRoot":"decks","draftRevision":"CAS","commitTable":"deck_versions","snapshot":"jsonb","appendOnly":true,"version":"vN"}'::jsonb
);
