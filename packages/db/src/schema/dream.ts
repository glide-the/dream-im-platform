// [Input] Admin Drizzle PostgreSQL schema history and published Dream capabilities.
// [Output] Typed Drizzle declarations for the shared Dream physical catalog.
// [Pos] @ink-memory/db schema source consumed by migrations, control-plane services, and contract tests.
// [Sync] 2026-08-16: add Admin-owned Deck aggregate draft revisions and
// immutable content-version snapshots for Dream capability consumption.
// [Sync] 2026-08-19: add the Admin-owned global ClaudePlugin remote
// Marketplace catalog, immutable revisions, full-plugin digests, policies, and install lineage.
// [Sync] 2026-08-21: move the shared Dream catalog into the database workspace package.
// [Sync] 2026-08-25: add Admin-owned Dream MCP servers, encrypted credentials,
// discovery snapshots, durable import receipts, and their exact capability contract.
// [Sync] 2026-08-27: add the PostgreSQL-only Claude Agent latest-instance
// resource snapshot consumed by the Admin observer console.
import { pgTable, uniqueIndex, index, check, bigint, text, timestamp, foreignKey, jsonb, unique, integer, boolean, primaryKey } from "drizzle-orm/pg-core"
import { sql } from "drizzle-orm"

import {
  storyWorkspaceStories as story_workspace_stories,
  storyWorkspaceWorkspaces as story_workspace_workspaces,
  users,
} from "./index.js";

export const auth_sessions = pgTable("auth_sessions", {
	token: text().primaryKey().notNull(),
	// You can use { mode: "bigint" } if numbers are exceeding js number limitations
	user_id: bigint({ mode: "number" }).notNull(),
	expires_at: timestamp({ withTimezone: true, mode: 'string' }).notNull(),
	created_at: timestamp({ withTimezone: true, mode: 'string' }).defaultNow(),
}, (table) => [
	index("idx_auth_user").using("btree", table.user_id.asc().nullsLast().op("int8_ops")),
	foreignKey({
			columns: [table.user_id],
			foreignColumns: [users.id],
			name: "fk_auth_sessions_user_id_users"
		}).onDelete("cascade"),
]);

export const oauth_accounts = pgTable("oauth_accounts", {
	// You can use { mode: "bigint" } if numbers are exceeding js number limitations
	id: bigint({ mode: "number" }).primaryKey().generatedByDefaultAsIdentity(),
	// You can use { mode: "bigint" } if numbers are exceeding js number limitations
	user_id: bigint({ mode: "number" }).notNull(),
	provider: text().notNull(),
	provider_sub: text().notNull(),
	email: text().notNull(),
	access_token_encrypted: text(),
	refresh_token_encrypted: text(),
	id_token_encrypted: text(),
	expires_at: timestamp({ withTimezone: true, mode: 'string' }),
	created_at: timestamp({ withTimezone: true, mode: 'string' }).defaultNow(),
	updated_at: timestamp({ withTimezone: true, mode: 'string' }).defaultNow(),
}, (table) => [
	index("idx_oauth_accounts_email").using("btree", table.email.asc().nullsLast().op("text_ops")),
	index("idx_oauth_accounts_user").using("btree", table.user_id.asc().nullsLast().op("int8_ops")),
	foreignKey({
			columns: [table.user_id],
			foreignColumns: [users.id],
			name: "fk_oauth_accounts_user_id_users"
		}).onDelete("cascade"),
	unique("uq_oauth_accounts_provider_provider_sub").on(table.provider, table.provider_sub),
]);

export const refresh_tokens = pgTable("refresh_tokens", {
	// You can use { mode: "bigint" } if numbers are exceeding js number limitations
	id: bigint({ mode: "number" }).primaryKey().generatedByDefaultAsIdentity(),
	// You can use { mode: "bigint" } if numbers are exceeding js number limitations
	user_id: bigint({ mode: "number" }).notNull(),
	token_hash: text().notNull(),
	expires_at: timestamp({ withTimezone: true, mode: 'string' }).notNull(),
	revoked_at: timestamp({ withTimezone: true, mode: 'string' }),
	created_at: timestamp({ withTimezone: true, mode: 'string' }).defaultNow(),
}, (table) => [
	index("idx_refresh_tokens_expires").using("btree", table.expires_at.asc().nullsLast().op("timestamptz_ops")),
	index("idx_refresh_tokens_user").using("btree", table.user_id.asc().nullsLast().op("int8_ops")),
	foreignKey({
			columns: [table.user_id],
			foreignColumns: [users.id],
			name: "fk_refresh_tokens_user_id_users"
		}).onDelete("cascade"),
	unique("uq_refresh_tokens_token_hash").on(table.token_hash),
]);

export const device_authorizations = pgTable("device_authorizations", {
	// You can use { mode: "bigint" } if numbers are exceeding js number limitations
	id: bigint({ mode: "number" }).primaryKey().generatedByDefaultAsIdentity(),
	client_id: text().notNull(),
	device_code_hash: text().notNull(),
	user_code_hash: text().notNull(),
	// You can use { mode: "bigint" } if numbers are exceeding js number limitations
	user_id: bigint({ mode: "number" }),
	scope: text(),
	status: text().notNull(),
	interval_seconds: integer().notNull(),
	last_poll_at: timestamp({ withTimezone: true, mode: 'string' }),
	expires_at: timestamp({ withTimezone: true, mode: 'string' }).notNull(),
	approved_at: timestamp({ withTimezone: true, mode: 'string' }),
	consumed_at: timestamp({ withTimezone: true, mode: 'string' }),
	created_at: timestamp({ withTimezone: true, mode: 'string' }).defaultNow(),
	updated_at: timestamp({ withTimezone: true, mode: 'string' }).defaultNow(),
}, (table) => [
	index("idx_device_authorizations_device_code_hash").using("btree", table.device_code_hash.asc().nullsLast().op("text_ops")),
	index("idx_device_authorizations_status_expires").using("btree", table.status.asc().nullsLast().op("timestamptz_ops"), table.expires_at.asc().nullsLast().op("text_ops")),
	index("idx_device_authorizations_user_code_hash").using("btree", table.user_code_hash.asc().nullsLast().op("text_ops")),
	foreignKey({
			columns: [table.user_id],
			foreignColumns: [users.id],
			name: "fk_device_authorizations_user_id_users"
		}).onDelete("cascade"),
	unique("uq_device_authorizations_device_code_hash").on(table.device_code_hash),
	unique("uq_device_authorizations_user_code_hash").on(table.user_code_hash),
]);

export const story_workspace_characters = pgTable("story_workspace_characters", {
	id: text().primaryKey().notNull(),
	identifier: text().notNull(),
	name: text().notNull(),
	avatar_url: text(),
	identity: text(),
	personality: text(),
	background: text(),
	catchphrase: text(),
	tags: text().default('[]'),
	notes: text(),
	// You can use { mode: "bigint" } if numbers are exceeding js number limitations
	author_id: bigint({ mode: "number" }).notNull(),
	workspace_id: text().notNull(),
	story_count: integer().default(0).notNull(),
	review_status: text().default('pending').notNull(),
	agent_generated: integer().default(1).notNull(),
	created_at: timestamp({ withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	updated_at: timestamp({ withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	status: text().default('active').notNull(),
	review_notes: text(),
	confirmed_at: timestamp({ withTimezone: true, mode: 'string' }),
	archived_at: timestamp({ withTimezone: true, mode: 'string' }),
}, (table) => [
	index("idx_sw_characters_author").using("btree", table.author_id.asc().nullsLast().op("timestamptz_ops"), table.updated_at.desc().nullsLast().op("int8_ops")),
	index("idx_sw_characters_name").using("btree", table.name.asc().nullsLast().op("text_ops")),
	index("idx_sw_characters_review").using("btree", table.review_status.asc().nullsLast().op("text_ops"), table.updated_at.desc().nullsLast().op("timestamptz_ops")),
	foreignKey({
			columns: [table.workspace_id],
			foreignColumns: [story_workspace_workspaces.id],
			name: "fk_story_workspace_characters_workspace_id_story_wor_1f0a2c1d1f"
		}),
	foreignKey({
			columns: [table.author_id],
			foreignColumns: [users.id],
			name: "fk_story_workspace_characters_author_id_users"
		}),
	check("ck_story_workspace_characters_1", sql`review_status = ANY (ARRAY['pending'::text, 'confirmed'::text, 'rejected'::text])`),
	check("ck_story_workspace_characters_2", sql`agent_generated = ANY (ARRAY[0, 1])`),
	check("ck_story_workspace_characters_3", sql`status = ANY (ARRAY['active'::text, 'archived'::text])`),
	check("ck_story_workspace_characters_4", sql`(review_notes IS NULL) OR (length(review_notes) <= 2000)`),
]);

export const story_workspace_scenes = pgTable("story_workspace_scenes", {
	id: text().primaryKey().notNull(),
	identifier: text().notNull(),
	name: text().notNull(),
	description: text(),
	story_id: text(),
	// You can use { mode: "bigint" } if numbers are exceeding js number limitations
	author_id: bigint({ mode: "number" }).notNull(),
	workspace_id: text().notNull(),
	character_count: integer().default(0).notNull(),
	order_index: integer().default(0).notNull(),
	review_status: text().default('pending').notNull(),
	agent_generated: integer().default(1).notNull(),
	created_at: timestamp({ withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	updated_at: timestamp({ withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	status: text().default('active').notNull(),
	review_notes: text(),
	confirmed_at: timestamp({ withTimezone: true, mode: 'string' }),
	archived_at: timestamp({ withTimezone: true, mode: 'string' }),
}, (table) => [
	index("idx_sw_scenes_author").using("btree", table.author_id.asc().nullsLast().op("int8_ops"), table.updated_at.desc().nullsLast().op("timestamptz_ops")),
	index("idx_sw_scenes_review").using("btree", table.review_status.asc().nullsLast().op("text_ops"), table.updated_at.desc().nullsLast().op("text_ops")),
	index("idx_sw_scenes_story").using("btree", table.story_id.asc().nullsLast().op("int4_ops"), table.order_index.asc().nullsLast().op("text_ops")),
	foreignKey({
			columns: [table.workspace_id],
			foreignColumns: [story_workspace_workspaces.id],
			name: "fk_story_workspace_scenes_workspace_id_story_workspa_a3ba763515"
		}),
	foreignKey({
			columns: [table.author_id],
			foreignColumns: [users.id],
			name: "fk_story_workspace_scenes_author_id_users"
		}),
	foreignKey({
			columns: [table.story_id],
			foreignColumns: [story_workspace_stories.id],
			name: "fk_story_workspace_scenes_story_id_story_workspace_stories"
		}),
	check("ck_story_workspace_scenes_1", sql`review_status = ANY (ARRAY['pending'::text, 'confirmed'::text, 'rejected'::text])`),
	check("ck_story_workspace_scenes_2", sql`agent_generated = ANY (ARRAY[0, 1])`),
	check("ck_story_workspace_scenes_3", sql`status = ANY (ARRAY['active'::text, 'archived'::text])`),
	check("ck_story_workspace_scenes_4", sql`(review_notes IS NULL) OR (length(review_notes) <= 2000)`),
]);

export const user_preferences = pgTable("user_preferences", {
	// You can use { mode: "bigint" } if numbers are exceeding js number limitations
	user_id: bigint({ mode: "number" }).primaryKey().notNull(),
	voice_configs_json: text(),
	meta_prompt: text(),
	state_config_json: text(),
	selected_state: text(),
	timezone: text(),
	first_login_completed: integer().default(0),
	system_config_json: text(),
	updated_at: timestamp({ withTimezone: true, mode: 'string' }).defaultNow(),
}, (table) => [
	foreignKey({
			columns: [table.user_id],
			foreignColumns: [users.id],
			name: "fk_user_preferences_user_id_users"
		}).onDelete("cascade"),
]);

export const user_sessions = pgTable("user_sessions", {
	id: text().primaryKey().notNull(),
	// You can use { mode: "bigint" } if numbers are exceeding js number limitations
	user_id: bigint({ mode: "number" }).notNull(),
	name: text(),
	editor_state_json: text().notNull(),
	labels: text(),
	created_at: timestamp({ withTimezone: true, mode: 'string' }).defaultNow(),
	updated_at: timestamp({ withTimezone: true, mode: 'string' }).defaultNow(),
}, (table) => [
	index("idx_sessions_user").using("btree", table.user_id.asc().nullsLast().op("int8_ops")),
	foreignKey({
			columns: [table.user_id],
			foreignColumns: [users.id],
			name: "fk_user_sessions_user_id_users"
		}).onDelete("cascade"),
]);

export const analysis_reports = pgTable("analysis_reports", {
	// You can use { mode: "bigint" } if numbers are exceeding js number limitations
	id: bigint({ mode: "number" }).primaryKey().generatedByDefaultAsIdentity(),
	// You can use { mode: "bigint" } if numbers are exceeding js number limitations
	user_id: bigint({ mode: "number" }).notNull(),
	report_type: text().notNull(),
	report_data_json: text().notNull(),
	all_notes_text: text(),
	created_at: timestamp({ withTimezone: true, mode: 'string' }).defaultNow(),
}, (table) => [
	index("idx_reports_user").using("btree", table.user_id.asc().nullsLast().op("int8_ops"), table.created_at.asc().nullsLast().op("int8_ops")),
	foreignKey({
			columns: [table.user_id],
			foreignColumns: [users.id],
			name: "fk_analysis_reports_user_id_users"
		}).onDelete("cascade"),
]);

export const daily_pictures = pgTable("daily_pictures", {
	// You can use { mode: "bigint" } if numbers are exceeding js number limitations
	id: bigint({ mode: "number" }).primaryKey().generatedByDefaultAsIdentity(),
	// You can use { mode: "bigint" } if numbers are exceeding js number limitations
	user_id: bigint({ mode: "number" }).notNull(),
	date: text().notNull(),
	image_base64: text().notNull(),
	prompt: text(),
	thumbnail_base64: text(),
	created_at: timestamp({ withTimezone: true, mode: 'string' }).defaultNow(),
}, (table) => [
	index("idx_pictures_user_date").using("btree", table.user_id.asc().nullsLast().op("int8_ops"), table.date.asc().nullsLast().op("int8_ops")),
	foreignKey({
			columns: [table.user_id],
			foreignColumns: [users.id],
			name: "fk_daily_pictures_user_id_users"
		}).onDelete("cascade"),
]);

export const friend_invites = pgTable("friend_invites", {
	code: text().primaryKey().notNull(),
	// You can use { mode: "bigint" } if numbers are exceeding js number limitations
	user_id: bigint({ mode: "number" }).notNull(),
	expires_at: timestamp({ withTimezone: true, mode: 'string' }).notNull(),
	// You can use { mode: "bigint" } if numbers are exceeding js number limitations
	used_by: bigint({ mode: "number" }),
	used_at: timestamp({ withTimezone: true, mode: 'string' }),
	created_at: timestamp({ withTimezone: true, mode: 'string' }).defaultNow(),
}, (table) => [
	index("idx_invites_expires").using("btree", table.expires_at.asc().nullsLast().op("timestamptz_ops")),
	index("idx_invites_user").using("btree", table.user_id.asc().nullsLast().op("int8_ops")),
	foreignKey({
			columns: [table.used_by],
			foreignColumns: [users.id],
			name: "fk_friend_invites_used_by_users"
		}).onDelete("set null"),
	foreignKey({
			columns: [table.user_id],
			foreignColumns: [users.id],
			name: "fk_friend_invites_user_id_users"
		}).onDelete("cascade"),
]);

export const friendships = pgTable("friendships", {
	// You can use { mode: "bigint" } if numbers are exceeding js number limitations
	id: bigint({ mode: "number" }).primaryKey().generatedByDefaultAsIdentity(),
	// You can use { mode: "bigint" } if numbers are exceeding js number limitations
	user_id: bigint({ mode: "number" }).notNull(),
	// You can use { mode: "bigint" } if numbers are exceeding js number limitations
	friend_id: bigint({ mode: "number" }).notNull(),
	status: text().notNull(),
	created_at: timestamp({ withTimezone: true, mode: 'string' }).defaultNow(),
	updated_at: timestamp({ withTimezone: true, mode: 'string' }).defaultNow(),
}, (table) => [
	index("idx_friendships_friend").using("btree", table.friend_id.asc().nullsLast().op("int8_ops"), table.status.asc().nullsLast().op("text_ops")),
	index("idx_friendships_user").using("btree", table.user_id.asc().nullsLast().op("text_ops"), table.status.asc().nullsLast().op("text_ops")),
	foreignKey({
			columns: [table.friend_id],
			foreignColumns: [users.id],
			name: "fk_friendships_friend_id_users"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.user_id],
			foreignColumns: [users.id],
			name: "fk_friendships_user_id_users"
		}).onDelete("cascade"),
	unique("uq_friendships_user_id_friend_id").on(table.user_id, table.friend_id),
	check("ck_friendships_1", sql`status = ANY (ARRAY['pending'::text, 'accepted'::text, 'rejected'::text])`),
]);

export const reflections_section_configs = pgTable("reflections_section_configs", {
	// You can use { mode: "bigint" } if numbers are exceeding js number limitations
	id: bigint({ mode: "number" }).primaryKey().generatedByDefaultAsIdentity(),
	// You can use { mode: "bigint" } if numbers are exceeding js number limitations
	user_id: bigint({ mode: "number" }).notNull(),
	section: text().notNull(),
	prompt_files: text().default('{}').notNull(),
	updated_at: timestamp({ withTimezone: true, mode: 'string' }).defaultNow(),
}, (table) => [
	index("idx_reflections_cfg_user").using("btree", table.user_id.asc().nullsLast().op("int8_ops"), table.section.asc().nullsLast().op("text_ops")),
	foreignKey({
			columns: [table.user_id],
			foreignColumns: [users.id],
			name: "fk_reflections_section_configs_user_id_users"
		}).onDelete("cascade"),
	unique("uq_reflections_section_configs_user_id_section").on(table.user_id, table.section),
	check("ck_reflections_section_configs_1", sql`section = ANY (ARRAY['echoes'::text, 'traits'::text, 'patterns'::text])`),
]);

export const reflection_task = pgTable("reflection_task", {
	id: text().primaryKey().notNull(),
	// You can use { mode: "bigint" } if numbers are exceeding js number limitations
	user_id: bigint({ mode: "number" }).notNull(),
	status: text().notNull(),
	sections: text().default('[]').notNull(),
	input_snapshot: text().default('{}').notNull(),
	workspace_path: text(),
	agent_contract_version: text(),
	error_summary: text(),
	created_at: timestamp({ withTimezone: true, mode: 'string' }).defaultNow(),
	started_at: timestamp({ withTimezone: true, mode: 'string' }),
	completed_at: timestamp({ withTimezone: true, mode: 'string' }),
	updated_at: timestamp({ withTimezone: true, mode: 'string' }).defaultNow(),
}, (table) => [
	index("idx_reflection_task_status").using("btree", table.status.asc().nullsLast().op("text_ops")),
	index("idx_reflection_task_user").using("btree", table.user_id.asc().nullsLast().op("int8_ops"), table.updated_at.asc().nullsLast().op("int8_ops")),
	foreignKey({
			columns: [table.user_id],
			foreignColumns: [users.id],
			name: "fk_reflection_task_user_id_users"
		}).onDelete("cascade"),
]);

export const reflection_result = pgTable("reflection_result", {
	id: text().primaryKey().notNull(),
	task_id: text().notNull(),
	// You can use { mode: "bigint" } if numbers are exceeding js number limitations
	user_id: bigint({ mode: "number" }).notNull(),
	section: text().notNull(),
	title: text().notNull(),
	description: text().notNull(),
	related_session_ids: text().default('[]').notNull(),
	evidence: text(),
	confidence: text().notNull(),
	created_at: timestamp({ withTimezone: true, mode: 'string' }).defaultNow(),
}, (table) => [
	index("idx_reflection_result_task").using("btree", table.task_id.asc().nullsLast().op("text_ops"), table.section.asc().nullsLast().op("text_ops")),
	index("idx_reflection_result_user").using("btree", table.user_id.asc().nullsLast().op("int8_ops"), table.created_at.asc().nullsLast().op("int8_ops")),
	foreignKey({
			columns: [table.user_id],
			foreignColumns: [users.id],
			name: "fk_reflection_result_user_id_users"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.task_id],
			foreignColumns: [reflection_task.id],
			name: "fk_reflection_result_task_id_reflection_task"
		}).onDelete("cascade"),
	check("ck_reflection_result_1", sql`section = ANY (ARRAY['echoes'::text, 'traits'::text, 'patterns'::text])`),
	check("ck_reflection_result_2", sql`confidence = ANY (ARRAY['high'::text, 'medium'::text, 'low'::text])`),
]);

export const reflection_task_event = pgTable("reflection_task_event", {
	id: text().primaryKey().notNull(),
	task_id: text().notNull(),
	sequence: integer(),
	event_type: text().notNull(),
	payload: text().default('{}').notNull(),
	created_at: timestamp({ withTimezone: true, mode: 'string' }).defaultNow(),
}, (table) => [
	index("idx_reflection_task_event_task").using("btree", table.task_id.asc().nullsLast().op("timestamptz_ops"), table.sequence.asc().nullsLast().op("int4_ops"), table.created_at.asc().nullsLast().op("timestamptz_ops")),
	foreignKey({
			columns: [table.task_id],
			foreignColumns: [reflection_task.id],
			name: "fk_reflection_task_event_task_id_reflection_task"
		}).onDelete("cascade"),
]);

export const events = pgTable("events", {
	event_id: text().primaryKey().notNull(),
	event_type: text().notNull(),
	event_version: integer().notNull(),
	occurred_at: timestamp({ withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	workspace_id: text().notNull(),
	aggregate_id: text().notNull(),
	aggregate_version: integer().notNull(),
	correlation_id: text().notNull(),
	causation_id: text(),
	payload_json: text().notNull(),
}, (table) => [
	index("idx_events_aggregate").using("btree", table.aggregate_id.asc().nullsLast().op("int4_ops"), table.aggregate_version.asc().nullsLast().op("text_ops")),
	index("idx_events_correlation").using("btree", table.correlation_id.asc().nullsLast().op("text_ops")),
	index("idx_events_type").using("btree", table.event_type.asc().nullsLast().op("text_ops"), table.occurred_at.asc().nullsLast().op("timestamptz_ops")),
	unique("uq_events_aggregate_id_aggregate_version").on(table.aggregate_id, table.aggregate_version),
	check("ck_events_1", sql`event_version >= 1`),
	check("ck_events_2", sql`aggregate_version >= 1`),
]);

export const decks = pgTable("decks", {
	id: text().primaryKey().notNull(),
	name: text().notNull(),
	name_zh: text(),
	name_en: text(),
	description: text(),
	description_zh: text(),
	description_en: text(),
	icon: text(),
	color: text(),
	is_system: boolean().default(false),
	parent_id: text(),
	// You can use { mode: "bigint" } if numbers are exceeding js number limitations
	owner_id: bigint({ mode: "number" }),
	enabled: boolean().default(true),
	has_local_changes: boolean().default(false),
	order_index: integer(),
	published: boolean().default(false),
	author_name: text(),
	install_count: integer().default(0),
	draft_revision: integer().default(1).notNull(),
	latest_version: integer().default(0).notNull(),
	published_draft_revision: integer().default(0).notNull(),
	created_at: timestamp({ withTimezone: true, mode: 'string' }).defaultNow(),
	updated_at: timestamp({ withTimezone: true, mode: 'string' }).defaultNow(),
}, (table) => [
	index("idx_decks_owner").using("btree", table.owner_id.asc().nullsLast().op("int8_ops")),
	foreignKey({
			columns: [table.owner_id],
			foreignColumns: [users.id],
			name: "fk_decks_owner_id_users"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.parent_id],
			foreignColumns: [table.id],
		name: "fk_decks_parent_id_decks"
		}),
	check("ck_decks_draft_revision", sql`draft_revision >= 1`),
	check("ck_decks_latest_version", sql`latest_version >= 0`),
	check("ck_decks_published_draft_revision", sql`published_draft_revision >= 0 AND published_draft_revision <= draft_revision`),
]);

export const voices = pgTable("voices", {
	id: text().primaryKey().notNull(),
	deck_id: text().notNull(),
	name: text().notNull(),
	name_zh: text(),
	name_en: text(),
	system_prompt: text().notNull(),
	icon: text(),
	color: text(),
	is_system: boolean().default(false),
	parent_id: text(),
	// You can use { mode: "bigint" } if numbers are exceeding js number limitations
	owner_id: bigint({ mode: "number" }),
	enabled: boolean().default(true),
	has_local_changes: boolean().default(false),
	order_index: integer(),
	created_at: timestamp({ withTimezone: true, mode: 'string' }).defaultNow(),
	updated_at: timestamp({ withTimezone: true, mode: 'string' }).defaultNow(),
	thread_id: text(),
	memory_workspace_config: text(),
}, (table) => [
	index("idx_voices_deck").using("btree", table.deck_id.asc().nullsLast().op("text_ops")),
	index("idx_voices_owner").using("btree", table.owner_id.asc().nullsLast().op("int8_ops")),
	foreignKey({
			columns: [table.owner_id],
			foreignColumns: [users.id],
			name: "fk_voices_owner_id_users"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.parent_id],
			foreignColumns: [table.id],
			name: "fk_voices_parent_id_voices"
		}),
	foreignKey({
			columns: [table.deck_id],
			foreignColumns: [decks.id],
			name: "fk_voices_deck_id_decks"
		}).onDelete("cascade"),
]);

export const deck_versions = pgTable("deck_versions", {
	id: text().primaryKey().notNull(),
	deck_id: text().notNull(),
	version: integer().notNull(),
	base_version: integer(),
	source_draft_revision: integer().notNull(),
	description: text(),
	snapshot_json: jsonb("snapshot_json").notNull(),
	content_hash: text().notNull(),
	created_by: bigint({ mode: "number" }).notNull(),
	created_at: timestamp({ withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	index("idx_deck_versions_deck_created").using("btree", table.deck_id.asc().nullsLast().op("text_ops"), table.created_at.desc().nullsLast().op("timestamptz_ops")),
	foreignKey({
		columns: [table.deck_id],
		foreignColumns: [decks.id],
		name: "fk_deck_versions_deck_id_decks"
	}).onDelete("restrict"),
	foreignKey({
		columns: [table.created_by],
		foreignColumns: [users.id],
		name: "fk_deck_versions_created_by_users"
	}).onDelete("restrict"),
	unique("uq_deck_versions_deck_id_version").on(table.deck_id, table.version),
	check("ck_deck_versions_version", sql`version >= 1`),
	check("ck_deck_versions_base_version", sql`base_version IS NULL OR base_version >= 1`),
	check("ck_deck_versions_source_draft_revision", sql`source_draft_revision >= 1`),
]);

export const chat_thread = pgTable("chat_thread", {
	id: text().primaryKey().notNull(),
	// You can use { mode: "bigint" } if numbers are exceeding js number limitations
	user_id: bigint({ mode: "number" }).notNull(),
	title: text(),
	deck_id: text(),
	voice_id: text(),
	claude_session_id: text(),
	agent_contract_version: text(),
	created_at: timestamp({ withTimezone: true, mode: 'string' }).defaultNow(),
	updated_at: timestamp({ withTimezone: true, mode: 'string' }).defaultNow(),
}, (table) => [
	index("idx_chat_thread_user").using("btree", table.user_id.asc().nullsLast().op("int8_ops"), table.updated_at.asc().nullsLast().op("int8_ops")),
	foreignKey({
			columns: [table.voice_id],
			foreignColumns: [voices.id],
			name: "fk_chat_thread_voice_id_voices"
		}).onDelete("set null"),
	foreignKey({
			columns: [table.deck_id],
			foreignColumns: [decks.id],
			name: "fk_chat_thread_deck_id_decks"
		}).onDelete("set null"),
	foreignKey({
			columns: [table.user_id],
			foreignColumns: [users.id],
			name: "fk_chat_thread_user_id_users"
		}).onDelete("cascade"),
]);

export const chat_message = pgTable("chat_message", {
	id: text().primaryKey().notNull(),
	thread_id: text().notNull(),
	role: text().notNull(),
	parts: text().default('[]').notNull(),
	metadata: text(),
	created_at: timestamp({ withTimezone: true, mode: 'string' }).defaultNow(),
}, (table) => [
	index("idx_chat_message_thread").using("btree", table.thread_id.asc().nullsLast().op("text_ops"), table.created_at.asc().nullsLast().op("text_ops")),
	foreignKey({
			columns: [table.thread_id],
			foreignColumns: [chat_thread.id],
			name: "fk_chat_message_thread_id_chat_thread"
		}).onDelete("cascade"),
	check("ck_chat_message_1", sql`role = ANY (ARRAY['user'::text, 'assistant'::text])`),
]);

export const deck_plugin_releases = pgTable("deck_plugin_releases", {
	id: text().primaryKey().notNull(),
	deck_plugin_id: text().notNull(),
	deck_plugin_version: text().notNull(),
	display_name: text().notNull(),
	description: text(),
	author: text(),
	status: text().default('draft').notNull(),
	manifest_json: text().notNull(),
	manifest_hash: text().notNull(),
	workflow_definition_ref: text().notNull(),
	input_schema_ref: text(),
	output_schema_ref: text(),
	capabilities_json: text(),
	compatibility_json: text(),
	deck_runtime_contract_json: text(),
	runtime_spec_json: text(),
	dependencies_json: text(),
	created_at: timestamp({ withTimezone: true, mode: 'string' }).defaultNow(),
	updated_at: timestamp({ withTimezone: true, mode: 'string' }).defaultNow(),
	published_at: timestamp({ withTimezone: true, mode: 'string' }),
}, (table) => [
	index("idx_deck_plugin_releases_id_version").using("btree", table.deck_plugin_id.asc().nullsLast().op("text_ops"), table.deck_plugin_version.asc().nullsLast().op("text_ops")),
	index("idx_deck_plugin_releases_status").using("btree", table.status.asc().nullsLast().op("text_ops")),
	unique("uq_deck_plugin_releases_deck_plugin_id_deck_plugin_version").on(table.deck_plugin_id, table.deck_plugin_version),
	check("ck_deck_plugin_releases_1", sql`status = ANY (ARRAY['draft'::text, 'validating'::text, 'published'::text, 'deprecated'::text, 'revoked'::text])`),
]);

export const deck_runtime_plugin_locks = pgTable("deck_runtime_plugin_locks", {
	id: text().primaryKey().notNull(),
	deck_plugin_id: text().notNull(),
	deck_plugin_version: text().notNull(),
	deck_plugin_manifest_hash: text().notNull(),
	lock_json: text().notNull(),
	created_at: timestamp({ withTimezone: true, mode: 'string' }).defaultNow(),
}, (table) => [
	index("idx_runtime_locks_deck_plugin").using("btree", table.deck_plugin_id.asc().nullsLast().op("text_ops"), table.deck_plugin_version.asc().nullsLast().op("text_ops")),
	foreignKey({
			columns: [table.deck_plugin_id, table.deck_plugin_version],
			foreignColumns: [deck_plugin_releases.deck_plugin_id, deck_plugin_releases.deck_plugin_version],
			name: "fk_deck_runtime_plugin_locks_deck_plugin_id_deck_plu_21d73d18c4"
		}).onDelete("restrict"),
	unique("uq_deck_runtime_plugin_locks_deck_plugin_id_deck_plugin_version").on(table.deck_plugin_id, table.deck_plugin_version),
]);

export const deck_plugin_installations = pgTable("deck_plugin_installations", {
	id: text().primaryKey().notNull(),
	scope_type: text().notNull(),
	scope_id: text().notNull(),
	deck_plugin_id: text().notNull(),
	installed_versions_json: text().default('[]').notNull(),
	default_version: text(),
	status: text().default('installing').notNull(),
	approved_capabilities_json: text().default('[]').notNull(),
	source_policy_id: text().notNull(),
	last_error_code: text(),
	last_error_summary: text(),
	pending_version: text(),
	pending_capabilities_json: text(),
	revision: integer().default(0).notNull(),
	created_at: timestamp({ withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	updated_at: timestamp({ withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	index("idx_installations_deck_plugin").using("btree", table.deck_plugin_id.asc().nullsLast().op("text_ops")),
	index("idx_installations_scope").using("btree", table.scope_type.asc().nullsLast().op("text_ops"), table.scope_id.asc().nullsLast().op("text_ops")),
	index("idx_installations_status").using("btree", table.status.asc().nullsLast().op("text_ops")),
	unique("uq_deck_plugin_installations_scope_type_scope_id_deck_plugin_id").on(table.scope_type, table.scope_id, table.deck_plugin_id),
	check("ck_deck_plugin_installations_1", sql`scope_type = ANY (ARRAY['instance'::text, 'workspace'::text])`),
	check("ck_deck_plugin_installations_2", sql`status = ANY (ARRAY['installing'::text, 'ready'::text, 'disabled'::text, 'error'::text, 'upgrade_pending'::text, 'uninstalled'::text])`),
]);

export const deck_plugin_bindings = pgTable("deck_plugin_bindings", {
	deck_plugin_binding_id: text().primaryKey().notNull(),
	deck_id: text().notNull(),
	workspace_id: text().notNull(),
	creator_id: text().notNull(),
	deck_plugin_id: text().notNull(),
	deck_plugin_version: text().notNull(),
	binding_revision: integer().notNull(),
	status: text().default('active').notNull(),
	applied_to: text().default('next_run').notNull(),
	created_at: timestamp({ withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	updated_at: timestamp({ withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	uniqueIndex("idx_deck_plugin_bindings_active_deck").using("btree", table.deck_id.asc().nullsLast().op("text_ops")).where(sql`(status = 'active'::text)`),
	index("idx_deck_plugin_bindings_deck_revision").using("btree", table.deck_id.asc().nullsLast().op("text_ops"), table.binding_revision.desc().nullsLast().op("text_ops")),
	index("idx_deck_plugin_bindings_release").using("btree", table.deck_plugin_id.asc().nullsLast().op("text_ops"), table.deck_plugin_version.asc().nullsLast().op("text_ops")),
	index("idx_deck_plugin_bindings_workspace").using("btree", table.workspace_id.asc().nullsLast().op("text_ops"), table.updated_at.desc().nullsLast().op("timestamptz_ops")),
	foreignKey({
			columns: [table.deck_plugin_id, table.deck_plugin_version],
			foreignColumns: [deck_plugin_releases.deck_plugin_id, deck_plugin_releases.deck_plugin_version],
			name: "fk_deck_plugin_bindings_deck_plugin_id_deck_plugin_v_a1157cb86d"
		}).onDelete("restrict"),
	foreignKey({
			columns: [table.deck_id],
			foreignColumns: [decks.id],
			name: "fk_deck_plugin_bindings_deck_id_decks"
		}).onDelete("restrict"),
	unique("uq_deck_plugin_bindings_deck_id_binding_revision").on(table.deck_id, table.binding_revision),
	check("ck_deck_plugin_bindings_1", sql`binding_revision >= 1`),
	check("ck_deck_plugin_bindings_2", sql`status = ANY (ARRAY['active'::text, 'stale'::text])`),
	check("ck_deck_plugin_bindings_3", sql`applied_to = 'next_run'::text`),
]);

export const deck_runtime_snapshots = pgTable("deck_runtime_snapshots", {
	deck_runtime_snapshot_id: text().primaryKey().notNull(),
	deck_id: text().notNull(),
	deck_plugin_binding_id: text().notNull(),
	binding_revision: integer().notNull(),
	deck_runtime_profile_id: text().notNull(),
	snapshot_contract: text().notNull(),
	config_hash: text().notNull(),
	config_json: text().notNull(),
	sanitized_summary_hash: text().notNull(),
	created_at: timestamp({ withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	index("idx_deck_runtime_snapshots_deck").using("btree", table.deck_id.asc().nullsLast().op("int4_ops"), table.binding_revision.asc().nullsLast().op("timestamptz_ops"), table.created_at.desc().nullsLast().op("timestamptz_ops")),
	foreignKey({
			columns: [table.deck_plugin_binding_id],
			foreignColumns: [deck_plugin_bindings.deck_plugin_binding_id],
			name: "fk_deck_runtime_snapshots_deck_plugin_binding_id_dec_d1ea8e3a21"
		}).onDelete("restrict"),
	foreignKey({
			columns: [table.deck_id],
			foreignColumns: [decks.id],
			name: "fk_deck_runtime_snapshots_deck_id_decks"
		}).onDelete("restrict"),
	unique("uq_deck_runtime_snapshots_deck_id_binding_revision_d_e296063f78").on(table.deck_id, table.binding_revision, table.deck_runtime_profile_id, table.config_hash),
	check("ck_deck_runtime_snapshots_1", sql`binding_revision >= 1`),
]);

export const workflow_preflights = pgTable("workflow_preflights", {
	workflow_preflight_id: text().primaryKey().notNull(),
	request_fingerprint: text().notNull(),
	deck_id: text().notNull(),
	binding_revision: integer().notNull(),
	deck_plugin_id: text().notNull(),
	deck_plugin_version: text().notNull(),
	runtime_plugin_lock_id: text().notNull(),
	deck_runtime_profile_id: text().notNull(),
	deck_runtime_snapshot_id: text(),
	deck_runtime_snapshot_summary_hash: text(),
	input_hash: text().notNull(),
	status: text().default('checking').notNull(),
	error_code: text(),
	failed_check: text(),
	expires_at: timestamp({ withTimezone: true, mode: 'string' }).notNull(),
	preflight_token_hash: text(),
	consumed_at: timestamp({ withTimezone: true, mode: 'string' }),
	created_by: text().notNull(),
	created_at: timestamp({ withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	updated_at: timestamp({ withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	uniqueIndex("idx_workflow_preflights_active_request").using("btree", table.request_fingerprint.asc().nullsLast().op("text_ops")).where(sql`((status = ANY (ARRAY['checking'::text, 'passed'::text])) AND (consumed_at IS NULL))`),
	index("idx_workflow_preflights_deck_revision").using("btree", table.deck_id.asc().nullsLast().op("int4_ops"), table.binding_revision.asc().nullsLast().op("int4_ops")),
	index("idx_workflow_preflights_status_expiry").using("btree", table.status.asc().nullsLast().op("text_ops"), table.expires_at.asc().nullsLast().op("timestamptz_ops")),
	unique("uq_workflow_preflights_preflight_token_hash").on(table.preflight_token_hash),
	check("ck_workflow_preflights_1", sql`binding_revision >= 0`),
	check("ck_workflow_preflights_2", sql`status = ANY (ARRAY['checking'::text, 'passed'::text, 'failed'::text, 'expired'::text])`),
	check("ck_workflow_preflights_3", sql`((status = 'failed'::text) AND (error_code IS NOT NULL) AND (failed_check IS NOT NULL)) OR ((status <> 'failed'::text) AND (error_code IS NULL) AND (failed_check IS NULL))`),
]);

export const workflow_runs = pgTable("workflow_runs", {
	id: text().primaryKey().notNull(),
	workspace_id: text().notNull(),
	deck_plugin_id: text().notNull(),
	deck_plugin_version: text().notNull(),
	workflow_definition_ref: text().notNull(),
	deck_runtime_snapshot_id: text().notNull(),
	status: text().default('preflight').notNull(),
	failed_step: text(),
	error_code: text(),
	retry_of_run_id: text(),
	deck_plugin_manifest_hash: text().notNull(),
	deck_plugin_binding_id: text().notNull(),
	binding_revision: integer().notNull(),
	runtime_plugin_lock_id: text().notNull(),
	runtime_load_receipt_id: text(),
	workflow_preflight_id: text().notNull(),
	agent_session_id: text(),
	source_voice_thread_id: text(),
	source_message_id: text(),
	source_message_time: timestamp({ withTimezone: true, mode: 'string' }),
	idempotency_key: text().notNull(),
	input_hash: text().notNull(),
	semantic_fingerprint: text().notNull(),
	status_version: integer().default(1).notNull(),
	created_by: text().notNull(),
	created_at: timestamp({ withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	started_at: timestamp({ withTimezone: true, mode: 'string' }),
	completed_at: timestamp({ withTimezone: true, mode: 'string' }),
}, (table) => [
	index("idx_workflow_runs_deck_plugin").using("btree", table.deck_plugin_id.asc().nullsLast().op("text_ops"), table.deck_plugin_version.asc().nullsLast().op("text_ops")),
	index("idx_workflow_runs_idempotency").using("btree", table.workspace_id.asc().nullsLast().op("text_ops"), table.created_by.asc().nullsLast().op("text_ops"), table.idempotency_key.asc().nullsLast().op("text_ops")),
	index("idx_workflow_runs_retry").using("btree", table.retry_of_run_id.asc().nullsLast().op("text_ops")),
	index("idx_workflow_runs_source_voice_thread").using("btree", table.source_voice_thread_id.asc().nullsLast().op("text_ops")),
	index("idx_workflow_runs_status").using("btree", table.status.asc().nullsLast().op("text_ops")),
	foreignKey({
			columns: [table.workflow_preflight_id],
			foreignColumns: [workflow_preflights.workflow_preflight_id],
			name: "fk_workflow_runs_workflow_preflight_id_workflow_preflights"
		}).onDelete("restrict"),
	foreignKey({
			columns: [table.runtime_plugin_lock_id],
			foreignColumns: [deck_runtime_plugin_locks.id],
			name: "fk_workflow_runs_runtime_plugin_lock_id_deck_runtime_44c881eef2"
		}).onDelete("restrict"),
	foreignKey({
			columns: [table.deck_plugin_binding_id],
			foreignColumns: [deck_plugin_bindings.deck_plugin_binding_id],
			name: "fk_workflow_runs_deck_plugin_binding_id_deck_plugin_bindings"
		}).onDelete("restrict"),
	foreignKey({
			columns: [table.retry_of_run_id],
			foreignColumns: [table.id],
			name: "fk_workflow_runs_retry_of_run_id_workflow_runs"
		}).onDelete("restrict"),
	unique("uq_workflow_runs_workspace_id_created_by_idempotency_key").on(table.workspace_id, table.idempotency_key, table.created_by),
	check("ck_workflow_runs_3", sql`status_version >= 1`),
	check("ck_workflow_runs_1", sql`status = ANY (ARRAY['preflight'::text, 'queued'::text, 'running'::text, 'output_validating'::text, 'pending_review'::text, 'confirmed'::text, 'rejected'::text, 'completed'::text, 'failed'::text, 'cancelled'::text])`),
	check("ck_workflow_runs_2", sql`binding_revision >= 1`),
]);

export const workflow_run_token_consumptions = pgTable("workflow_run_token_consumptions", {
	token_digest: text().primaryKey().notNull(),
	workflow_run_id: text().notNull(),
	workflow_preflight_id: text().notNull(),
	workspace_id: text().notNull(),
	actor_id: text().notNull(),
	idempotency_key: text().notNull(),
	semantic_fingerprint: text().notNull(),
	consumed_at: timestamp({ withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	index("idx_workflow_run_token_consumptions_run").using("btree", table.workflow_run_id.asc().nullsLast().op("text_ops")),
	foreignKey({
			columns: [table.workflow_preflight_id],
			foreignColumns: [workflow_preflights.workflow_preflight_id],
			name: "fk_workflow_run_token_consumptions_workflow_prefligh_73fad436a7"
		}).onDelete("restrict"),
	foreignKey({
			columns: [table.workflow_run_id],
			foreignColumns: [workflow_runs.id],
			name: "fk_workflow_run_token_consumptions_workflow_run_id_w_09114ec819"
		}).onDelete("restrict"),
]);

export const workflow_run_transitions = pgTable("workflow_run_transitions", {
	id: text().primaryKey().notNull(),
	workflow_run_id: text().notNull(),
	transition_seq: integer().notNull(),
	from_status: text(),
	to_status: text().notNull(),
	actor_id: text().notNull(),
	reason_code: text(),
	failed_step: text(),
	error_code: text(),
	occurred_at: timestamp({ withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	index("idx_workflow_run_transitions_run").using("btree", table.workflow_run_id.asc().nullsLast().op("int4_ops"), table.transition_seq.asc().nullsLast().op("text_ops")),
	foreignKey({
			columns: [table.workflow_run_id],
			foreignColumns: [workflow_runs.id],
			name: "fk_workflow_run_transitions_workflow_run_id_workflow_runs"
		}).onDelete("restrict"),
	unique("uq_workflow_run_transitions_workflow_run_id_transition_seq").on(table.workflow_run_id, table.transition_seq),
	check("ck_workflow_run_transitions_1", sql`transition_seq >= 1`),
]);

export const runtime_plugin_reconcile_attempts = pgTable("runtime_plugin_reconcile_attempts", {
	attempt_id: text().primaryKey().notNull(),
	workflow_run_id: text(),
	reconcile_path: text().notNull(),
	claude_code_plugin_id: text(),
	resolved_version: text(),
	runtime_node_id: text(),
	policy_revision: text().notNull(),
	argv_json: text(),
	timeout_seconds: integer(),
	exit_code: integer(),
	stdout_summary: text(),
	stderr_summary: text(),
	result_status: text().notNull(),
	error_code: text(),
	created_at: timestamp({ withTimezone: true, mode: 'string' }).notNull(),
}, (table) => [
	index("idx_runtime_reconcile_attempts_run").using("btree", table.workflow_run_id.asc().nullsLast().op("text_ops"), table.created_at.asc().nullsLast().op("text_ops")),
	foreignKey({
			columns: [table.workflow_run_id],
			foreignColumns: [workflow_runs.id],
			name: "fk_runtime_plugin_reconcile_attempts_workflow_run_id_968d500b4b"
		}).onDelete("restrict"),
	check("ck_runtime_plugin_reconcile_attempts_1", sql`reconcile_path = ANY (ARRAY['headless'::text, 'cli'::text])`),
	check("ck_runtime_plugin_reconcile_attempts_2", sql`result_status = ANY (ARRAY['succeeded'::text, 'failed'::text])`),
]);

export const runtime_load_receipts = pgTable("runtime_load_receipts", {
	receipt_id: text().primaryKey().notNull(),
	workflow_run_id: text().notNull(),
	runtime_plugin_lock_id: text().notNull(),
	runtime_plugin_lock_digest: text().notNull(),
	runtime_environment_id: text().notNull(),
	runtime_pool_id: text().notNull(),
	distribution_mode: text().notNull(),
	runtime_node_id: text().notNull(),
	artifact_set_hash: text().notNull(),
	policy_revision: text().notNull(),
	deployment_tier: text().notNull(),
	scope: text().notNull(),
	readiness_state: text().notNull(),
	required_entries_ready: integer().notNull(),
	created_at: timestamp({ withTimezone: true, mode: 'string' }).notNull(),
}, (table) => [
	index("idx_runtime_load_receipts_placement").using("btree", table.runtime_environment_id.asc().nullsLast().op("text_ops"), table.runtime_node_id.asc().nullsLast().op("text_ops")),
	index("idx_runtime_load_receipts_run").using("btree", table.workflow_run_id.asc().nullsLast().op("text_ops"), table.created_at.asc().nullsLast().op("text_ops")),
	foreignKey({
			columns: [table.runtime_plugin_lock_id],
			foreignColumns: [deck_runtime_plugin_locks.id],
			name: "fk_runtime_load_receipts_runtime_plugin_lock_id_deck_a3ffee574a"
		}).onDelete("restrict"),
	foreignKey({
			columns: [table.workflow_run_id],
			foreignColumns: [workflow_runs.id],
			name: "fk_runtime_load_receipts_workflow_run_id_workflow_runs"
		}).onDelete("restrict"),
	check("ck_runtime_load_receipts_1", sql`distribution_mode = 'local_persistent'::text`),
	check("ck_runtime_load_receipts_2", sql`deployment_tier = 'local'::text`),
	check("ck_runtime_load_receipts_3", sql`scope = 'session'::text`),
	check("ck_runtime_load_receipts_4", sql`readiness_state = 'session_loaded'::text`),
	check("ck_runtime_load_receipts_5", sql`required_entries_ready = ANY (ARRAY[0, 1])`),
	check("ck_runtime_load_receipts_6", sql`runtime_pool_id = runtime_environment_id`),
]);

export const agent_sessions = pgTable("agent_sessions", {
	agent_session_id: text().primaryKey().notNull(),
	workflow_run_id: text().notNull(),
	runtime_load_receipt_id: text().notNull(),
	runtime_environment_id: text().notNull(),
	runtime_pool_id: text().notNull(),
	distribution_mode: text().notNull(),
	runtime_node_id: text().notNull(),
	artifact_set_hash: text().notNull(),
	policy_revision: text().notNull(),
	deployment_tier: text().notNull(),
	runtime_plugin_lock_id: text().notNull(),
	runtime_plugin_lock_digest: text().notNull(),
	settings_json: text().notNull(),
	settings_hash: text().notNull(),
	plugin_set_hash: text().notNull(),
	session_request_key: text().notNull(),
	attempt_number: integer().notNull(),
	status: text().notNull(),
	error_code: text(),
	termination_reason_code: text(),
	created_at: timestamp({ withTimezone: true, mode: 'string' }).notNull(),
	started_at: timestamp({ withTimezone: true, mode: 'string' }),
	terminated_at: timestamp({ withTimezone: true, mode: 'string' }),
	lease_expires_at: timestamp({ withTimezone: true, mode: 'string' }),
	owner_token: text(),
	remote_session_ref: text(),
}, (table) => [
	uniqueIndex("idx_agent_sessions_one_live_run").using("btree", table.workflow_run_id.asc().nullsLast().op("text_ops")).where(sql`(status = ANY (ARRAY['creating'::text, 'active'::text]))`),
	index("idx_agent_sessions_run").using("btree", table.workflow_run_id.asc().nullsLast().op("text_ops"), table.attempt_number.asc().nullsLast().op("text_ops")),
	foreignKey({
			columns: [table.runtime_load_receipt_id],
			foreignColumns: [runtime_load_receipts.receipt_id],
			name: "fk_agent_sessions_runtime_load_receipt_id_runtime_load_receipts"
		}).onDelete("restrict"),
	foreignKey({
			columns: [table.runtime_plugin_lock_id],
			foreignColumns: [deck_runtime_plugin_locks.id],
			name: "fk_agent_sessions_runtime_plugin_lock_id_deck_runtim_d1f3baf217"
		}).onDelete("restrict"),
	foreignKey({
			columns: [table.workflow_run_id],
			foreignColumns: [workflow_runs.id],
			name: "fk_agent_sessions_workflow_run_id_workflow_runs"
		}).onDelete("restrict"),
	unique("uq_agent_sessions_workflow_run_id_attempt_number").on(table.workflow_run_id, table.attempt_number),
	unique("uq_agent_sessions_session_request_key").on(table.session_request_key),
	check("ck_agent_sessions_1", sql`distribution_mode = 'local_persistent'::text`),
	check("ck_agent_sessions_2", sql`deployment_tier = 'local'::text`),
	check("ck_agent_sessions_3", sql`attempt_number >= 1`),
	check("ck_agent_sessions_4", sql`status = ANY (ARRAY['creating'::text, 'active'::text, 'terminated'::text, 'failed'::text])`),
	check("ck_agent_sessions_5", sql`runtime_pool_id = runtime_environment_id`),
]);

export const claude_plugin_marketplaces = pgTable("claude_plugin_marketplaces", {
	id: text().primaryKey().notNull(),
	slug: text().notNull(),
	display_name: text().notNull(),
	remote_url: text().notNull(),
	default_ref: text(),
	marketplace_name: text(),
	status: text().default('pending').notNull(),
	last_sync_error_code: text(),
	last_sync_error_summary: text(),
	created_by: text().notNull(),
	updated_by: text().notNull(),
	created_at: timestamp({ withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	updated_at: timestamp({ withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	uniqueIndex("uq_claude_plugin_marketplaces_slug").using("btree", table.slug.asc().nullsLast().op("text_ops")),
	uniqueIndex("uq_claude_plugin_marketplaces_remote_url").using("btree", table.remote_url.asc().nullsLast().op("text_ops")),
	index("idx_claude_plugin_marketplaces_status").using("btree", table.status.asc().nullsLast().op("text_ops")),
	check("ck_claude_plugin_marketplaces_status", sql`status = ANY (ARRAY['pending'::text, 'active'::text, 'disabled'::text, 'error'::text])`),
]);

export const claude_plugin_marketplace_sync_runs = pgTable("claude_plugin_marketplace_sync_runs", {
	id: text().primaryKey().notNull(),
	marketplace_id: text().notNull(),
	status: text().default('running').notNull(),
	requested_ref: text(),
	resolved_commit_sha: text(),
	requested_by: text().notNull(),
	error_code: text(),
	error_summary: text(),
	created_at: timestamp({ withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	started_at: timestamp({ withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	finished_at: timestamp({ withTimezone: true, mode: 'string' }),
}, (table) => [
	uniqueIndex("uq_claude_plugin_marketplace_sync_runs_running").using("btree", table.marketplace_id.asc().nullsLast().op("text_ops")).where(sql`(status = 'running'::text)`),
	index("idx_claude_plugin_marketplace_sync_runs_marketplace").using("btree", table.marketplace_id.asc().nullsLast().op("text_ops"), table.created_at.desc().nullsLast().op("timestamptz_ops")),
	index("idx_claude_plugin_marketplace_sync_runs_status").using("btree", table.status.asc().nullsLast().op("text_ops"), table.created_at.asc().nullsLast().op("timestamptz_ops")),
	foreignKey({
		columns: [table.marketplace_id],
		foreignColumns: [claude_plugin_marketplaces.id],
		name: "fk_claude_plugin_marketplace_sync_runs_marketplace"
	}).onDelete("restrict"),
	check("ck_claude_plugin_marketplace_sync_runs_status", sql`status = ANY (ARRAY['running'::text, 'succeeded'::text, 'failed'::text])`),
]);

export const claude_plugin_marketplace_revisions = pgTable("claude_plugin_marketplace_revisions", {
	id: text().primaryKey().notNull(),
	marketplace_id: text().notNull(),
	sync_run_id: text().notNull(),
	remote_url: text().notNull(),
	requested_ref: text(),
	resolved_commit_sha: text().notNull(),
	marketplace_name: text().notNull(),
	manifest_sha256: text().notNull(),
	manifest_json: jsonb().notNull(),
	entry_count: integer().notNull(),
	validation_status: text().notNull(),
	validation_errors: jsonb().default([]).notNull(),
	created_by: text().notNull(),
	created_at: timestamp({ withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	unique("uq_claude_plugin_marketplace_revisions_marketplace_commit").on(table.marketplace_id, table.resolved_commit_sha),
	unique("uq_claude_plugin_marketplace_revisions_sync_run").on(table.sync_run_id),
	index("idx_claude_plugin_marketplace_revisions_marketplace").using("btree", table.marketplace_id.asc().nullsLast().op("text_ops"), table.created_at.desc().nullsLast().op("timestamptz_ops")),
	foreignKey({
		columns: [table.marketplace_id],
		foreignColumns: [claude_plugin_marketplaces.id],
		name: "fk_claude_plugin_marketplace_revisions_marketplace"
	}).onDelete("restrict"),
	foreignKey({
		columns: [table.sync_run_id],
		foreignColumns: [claude_plugin_marketplace_sync_runs.id],
		name: "fk_claude_plugin_marketplace_revisions_sync_run"
	}).onDelete("restrict"),
	check("ck_claude_plugin_marketplace_revisions_commit_sha", sql`resolved_commit_sha ~ '^[0-9a-f]{40}$'::text`),
	check("ck_claude_plugin_marketplace_revisions_manifest_sha", sql`manifest_sha256 ~ '^[0-9a-f]{64}$'::text`),
	check("ck_claude_plugin_marketplace_revisions_entry_count", sql`entry_count >= 0`),
	check("ck_claude_plugin_marketplace_revisions_status", sql`validation_status = ANY (ARRAY['valid'::text, 'invalid'::text])`),
]);

export const claude_plugin_marketplace_entries = pgTable("claude_plugin_marketplace_entries", {
	id: text().primaryKey().notNull(),
	marketplace_id: text().notNull(),
	revision_id: text().notNull(),
	package_name: text().notNull(),
	marketplace_name: text().notNull(),
	package_spec: text().notNull(),
	display_name: text().notNull(),
	description: text(),
	version: text(),
	homepage: text(),
	source_path: text().notNull(),
	source_json: jsonb().notNull(),
	plugin_manifest_json: jsonb(),
	plugin_manifest_sha256: text(),
	plugin_digest: text(),
	component_inventory_json: jsonb().default({}).notNull(),
	compatibility_json: jsonb().default({}).notNull(),
	validation_status: text().notNull(),
	validation_errors: jsonb().default([]).notNull(),
	created_at: timestamp({ withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	unique("uq_claude_plugin_marketplace_entries_revision_package").on(table.revision_id, table.package_name),
	unique("uq_claude_plugin_marketplace_entries_identity").on(table.id, table.marketplace_id, table.package_name),
	index("idx_claude_plugin_marketplace_entries_marketplace_package").using("btree", table.marketplace_id.asc().nullsLast().op("text_ops"), table.package_name.asc().nullsLast().op("text_ops")),
	index("idx_claude_plugin_marketplace_entries_revision").using("btree", table.revision_id.asc().nullsLast().op("text_ops")),
	foreignKey({
		columns: [table.marketplace_id],
		foreignColumns: [claude_plugin_marketplaces.id],
		name: "fk_claude_plugin_marketplace_entries_marketplace"
	}).onDelete("restrict"),
	foreignKey({
		columns: [table.revision_id],
		foreignColumns: [claude_plugin_marketplace_revisions.id],
		name: "fk_claude_plugin_marketplace_entries_revision"
	}).onDelete("restrict"),
	check("ck_claude_plugin_marketplace_entries_plugin_manifest_sha", sql`plugin_manifest_sha256 IS NULL OR plugin_manifest_sha256 ~ '^[0-9a-f]{64}$'::text`),
	check("ck_claude_plugin_marketplace_entries_plugin_digest", sql`plugin_digest IS NULL OR plugin_digest ~ '^sha256:[0-9a-f]{64}$'::text`),
	check("ck_claude_plugin_marketplace_entries_valid_digest", sql`validation_status <> 'valid'::text OR plugin_digest IS NOT NULL`),
	check("ck_claude_plugin_marketplace_entries_status", sql`validation_status = ANY (ARRAY['valid'::text, 'invalid'::text])`),
]);

export const claude_plugin_marketplace_entry_policies = pgTable("claude_plugin_marketplace_entry_policies", {
	id: text().primaryKey().notNull(),
	marketplace_id: text().notNull(),
	package_name: text().notNull(),
	decision: text().default('blocked').notNull(),
	approved_entry_id: text(),
	reason: text(),
	updated_by: text().notNull(),
	created_at: timestamp({ withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	updated_at: timestamp({ withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	unique("uq_claude_plugin_marketplace_entry_policies_package").on(table.marketplace_id, table.package_name),
	index("idx_claude_plugin_marketplace_entry_policies_decision").using("btree", table.decision.asc().nullsLast().op("text_ops")),
	foreignKey({
		columns: [table.marketplace_id],
		foreignColumns: [claude_plugin_marketplaces.id],
		name: "fk_claude_plugin_marketplace_entry_policies_marketplace"
	}).onDelete("restrict"),
	foreignKey({
		columns: [table.approved_entry_id, table.marketplace_id, table.package_name],
		foreignColumns: [claude_plugin_marketplace_entries.id, claude_plugin_marketplace_entries.marketplace_id, claude_plugin_marketplace_entries.package_name],
		name: "fk_claude_plugin_marketplace_entry_policies_approved_entry"
	}).onDelete("restrict"),
	check("ck_claude_plugin_marketplace_entry_policies_decision", sql`decision = ANY (ARRAY['approved'::text, 'blocked'::text])`),
	check("ck_claude_plugin_marketplace_entry_policies_approval", sql`(decision = 'approved'::text AND approved_entry_id IS NOT NULL) OR (decision = 'blocked'::text AND approved_entry_id IS NULL)`),
]);

export const claude_plugin_operations = pgTable("claude_plugin_operations", {
	id: text().primaryKey().notNull(),
	operation_kind: text().notNull(),
	requested_package_spec: text().notNull(),
	marketplace_entry_id: text(),
	status: text().default('queued').notNull(),
	phase: text().default('queued').notNull(),
	progress: integer().default(0).notNull(),
	message: text(),
	executable: text(),
	argv_json: text(),
	cwd: text(),
	cli_version: text(),
	exit_code: integer(),
	evidence_path: text(),
	installation_id: text(),
	error_code: text(),
	error_summary: text(),
	created_at: timestamp({ withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	updated_at: timestamp({ withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	finished_at: timestamp({ withTimezone: true, mode: 'string' }),
}, (table) => [
	index("idx_claude_plugin_operations_status").using("btree", table.status.asc().nullsLast().op("text_ops"), table.created_at.asc().nullsLast().op("text_ops")),
	index("idx_claude_plugin_operations_marketplace_entry").using("btree", table.marketplace_entry_id.asc().nullsLast().op("text_ops")),
	foreignKey({
		columns: [table.marketplace_entry_id],
		foreignColumns: [claude_plugin_marketplace_entries.id],
		name: "fk_claude_plugin_operations_marketplace_entry"
	}).onDelete("restrict"),
	check("ck_claude_plugin_operations_1", sql`operation_kind = ANY (ARRAY['install'::text, 'uninstall'::text, 'validate'::text, 'revalidate'::text])`),
	check("ck_claude_plugin_operations_2", sql`status = ANY (ARRAY['queued'::text, 'running'::text, 'ready'::text, 'error'::text])`),
]);

export const claude_plugin_installations = pgTable("claude_plugin_installations", {
	id: text().primaryKey().notNull(),
	requested_package_spec: text().notNull(),
	marketplace_entry_id: text(),
	package_name: text().notNull(),
	marketplace: text().notNull(),
	requested_version: text(),
	resolved_version: text().notNull(),
	source_type: text().notNull(),
	artifact_digest: text().notNull(),
	artifact_path: text().notNull(),
	claude_cli_version: text().notNull(),
	cli_git_commit_sha: text(),
	manifest_json: text(),
	component_inventory_json: text().default('{}').notNull(),
	compatibility_json: text().default('{}').notNull(),
	status: text().default('installing').notNull(),
	operation_id: text().notNull(),
	error_code: text(),
	error_summary: text(),
	file_count: integer().default(0).notNull(),
	created_at: timestamp({ withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	updated_at: timestamp({ withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	installed_at: timestamp({ withTimezone: true, mode: 'string' }),
}, (table) => [
	index("idx_claude_plugin_installations_pkg").using("btree", table.package_name.asc().nullsLast().op("text_ops"), table.marketplace.asc().nullsLast().op("text_ops")),
	index("idx_claude_plugin_installations_status").using("btree", table.status.asc().nullsLast().op("text_ops")),
	index("idx_claude_plugin_installations_marketplace_entry").using("btree", table.marketplace_entry_id.asc().nullsLast().op("text_ops")),
	foreignKey({
		columns: [table.marketplace_entry_id],
		foreignColumns: [claude_plugin_marketplace_entries.id],
		name: "fk_claude_plugin_installations_marketplace_entry"
	}).onDelete("restrict"),
	unique("uq_claude_plugin_installations_package_name_marketpl_ea25e21de3").on(table.package_name, table.marketplace, table.resolved_version, table.artifact_digest),
	check("ck_claude_plugin_installations_1", sql`source_type = ANY (ARRAY['claude-official'::text, 'marketplace'::text, 'github'::text, 'platform-builtin'::text])`),
	check("ck_claude_plugin_installations_2", sql`status = ANY (ARRAY['installing'::text, 'ready'::text, 'error'::text, 'uninstalled'::text])`),
]);

export const runtime_plugin_materializations = pgTable("runtime_plugin_materializations", {
	runtime_materialization_id: text().primaryKey().notNull(),
	runtime_environment_id: text().notNull(),
	runtime_pool_id: text().notNull(),
	runtime_node_id: text().notNull(),
	claude_code_plugin_id: text().notNull(),
	resolved_version: text().notNull(),
	artifact_digest: text().notNull(),
	materialized_digest: text(),
	artifact_set_hash: text().notNull(),
	policy_revision: text().notNull(),
	declaration_status: text().notNull(),
	materialization_status: text().notNull(),
	activation_status: text().notNull(),
	materialization_key: text().notNull(),
	attempt_id: text().notNull(),
	attempt_count: integer().notNull(),
	verification_status: text(),
	signature_bundle_ref: text(),
	retention_state: text(),
	restore_source_ref: text(),
	cache_ref: text(),
	last_error: text(),
	created_at: timestamp({ withTimezone: true, mode: 'string' }).notNull(),
	updated_at: timestamp({ withTimezone: true, mode: 'string' }).notNull(),
}, (table) => [
	index("idx_runtime_materializations_lookup").using("btree", table.runtime_environment_id.asc().nullsLast().op("text_ops"), table.runtime_node_id.asc().nullsLast().op("text_ops"), table.claude_code_plugin_id.asc().nullsLast().op("text_ops")),
	index("idx_runtime_materializations_status").using("btree", table.materialization_status.asc().nullsLast().op("text_ops"), table.activation_status.asc().nullsLast().op("text_ops")),
	unique("uq_runtime_plugin_materializations_materialization_key").on(table.materialization_key),
	check("ck_runtime_plugin_materializations_1", sql`declaration_status = ANY (ARRAY['undeclared'::text, 'declared'::text, 'disabled'::text])`),
	check("ck_runtime_plugin_materializations_2", sql`materialization_status = ANY (ARRAY['missing'::text, 'materializing'::text, 'materialized'::text, 'failed'::text])`),
	check("ck_runtime_plugin_materializations_3", sql`activation_status = ANY (ARRAY['inactive'::text, 'loadable'::text, 'loaded'::text, 'load_failed'::text])`),
	check("ck_runtime_plugin_materializations_4", sql`attempt_count >= 1`),
	check("ck_runtime_plugin_materializations_5", sql`(verification_status IS NULL) OR (verification_status = ANY (ARRAY['verified'::text, 'legacy_unverified'::text]))`),
	check("ck_runtime_plugin_materializations_6", sql`runtime_pool_id = runtime_environment_id`),
]);

export const resource_connectors = pgTable("resource_connectors", {
	id: text().primaryKey().notNull(),
	// You can use { mode: "bigint" } if numbers are exceeding js number limitations
	user_id: bigint({ mode: "number" }).notNull(),
	name: text().notNull(),
	platform: text().notNull(),
	auth_status: text().default('pending').notNull(),
	config_json: text().default('{}').notNull(),
	current_snapshot_version: text(),
	current_source_revision: text(),
	current_sync_cursor: text(),
	last_synced_at: timestamp({ withTimezone: true, mode: 'string' }),
	created_at: timestamp({ withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	updated_at: timestamp({ withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	index("idx_resource_connectors_user_updated").using("btree", table.user_id.asc().nullsLast().op("int8_ops"), table.updated_at.desc().nullsLast().op("int8_ops")),
	foreignKey({
			columns: [table.user_id],
			foreignColumns: [users.id],
			name: "fk_resource_connectors_user_id_users"
		}).onDelete("restrict"),
]);

export const connector_resources = pgTable("connector_resources", {
	id: text().primaryKey().notNull(),
	connector_id: text().notNull(),
	resource_type: text().notNull(),
	external_id: text(),
	title: text().notNull(),
	metadata_json: text().default('{}').notNull(),
	sync_status: text().default('synced').notNull(),
	created_at: timestamp({ withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	updated_at: timestamp({ withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	index("idx_connector_resources_connector").using("btree", table.connector_id.asc().nullsLast().op("text_ops"), table.resource_type.asc().nullsLast().op("timestamptz_ops"), table.updated_at.desc().nullsLast().op("timestamptz_ops")),
	foreignKey({
			columns: [table.connector_id],
			foreignColumns: [resource_connectors.id],
			name: "fk_connector_resources_connector_id_resource_connectors"
		}).onDelete("cascade"),
	unique("uq_connector_resources_connector_id_resource_type_external_id").on(table.connector_id, table.resource_type, table.external_id),
]);

export const connector_resource_pages = pgTable("connector_resource_pages", {
	id: text().primaryKey().notNull(),
	resource_id: text().notNull(),
	page_id: text().notNull(),
	title: text().notNull(),
	last_edited: timestamp({ withTimezone: true, mode: 'string' }),
	properties_json: text(),
	page_json: text(),
	created_at: timestamp({ withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	updated_at: timestamp({ withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	index("idx_connector_resource_pages_resource").using("btree", table.resource_id.asc().nullsLast().op("text_ops"), table.last_edited.desc().nullsLast().op("text_ops")),
	foreignKey({
			columns: [table.resource_id],
			foreignColumns: [connector_resources.id],
			name: "fk_connector_resource_pages_resource_id_connector_resources"
		}).onDelete("cascade"),
	unique("uq_connector_resource_pages_resource_id_page_id").on(table.resource_id, table.page_id),
]);

export const connector_snapshots = pgTable("connector_snapshots", {
	id: text().primaryKey().notNull(),
	connector_id: text().notNull(),
	snapshot_version: text().notNull(),
	source_revision: text().notNull(),
	sync_cursor: text().notNull(),
	fetched_at: timestamp({ withTimezone: true, mode: 'string' }).notNull(),
	state: text().default('snapshot_ready').notNull(),
	snapshot_json: text().notNull(),
	created_at: timestamp({ withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	updated_at: timestamp({ withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	index("idx_connector_snapshots_connector").using("btree", table.connector_id.asc().nullsLast().op("text_ops"), table.created_at.desc().nullsLast().op("text_ops")),
	foreignKey({
			columns: [table.connector_id],
			foreignColumns: [resource_connectors.id],
			name: "fk_connector_snapshots_connector_id_resource_connectors"
		}).onDelete("cascade"),
	unique("uq_connector_snapshots_connector_id_snapshot_version").on(table.connector_id, table.snapshot_version),
]);

export const connector_chat_threads = pgTable("connector_chat_threads", {
	id: text().primaryKey().notNull(),
	connector_id: text().notNull(),
	thread_id: text().notNull(),
	created_at: timestamp({ withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	updated_at: timestamp({ withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	index("idx_connector_chat_threads_connector").using("btree", table.connector_id.asc().nullsLast().op("text_ops"), table.updated_at.desc().nullsLast().op("text_ops")),
	foreignKey({
			columns: [table.connector_id],
			foreignColumns: [resource_connectors.id],
			name: "fk_connector_chat_threads_connector_id_resource_connectors"
		}).onDelete("cascade"),
	unique("uq_connector_chat_threads_connector_id_thread_id").on(table.connector_id, table.thread_id),
]);

export const story_workspace_scene_characters = pgTable("story_workspace_scene_characters", {
	scene_id: text().notNull(),
	character_id: text().notNull(),
	created_at: timestamp({ withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	foreignKey({
			columns: [table.character_id],
			foreignColumns: [story_workspace_characters.id],
			name: "fk_story_workspace_scene_characters_character_id_sto_819f0fd871"
		}),
	foreignKey({
			columns: [table.scene_id],
			foreignColumns: [story_workspace_scenes.id],
			name: "fk_story_workspace_scene_characters_scene_id_story_w_fe7e4c551d"
		}),
	primaryKey({ columns: [table.scene_id, table.character_id], name: "pk_story_workspace_scene_characters"}),
]);

export const story_workspace_story_characters = pgTable("story_workspace_story_characters", {
	story_id: text().notNull(),
	character_id: text().notNull(),
	role_type: text(),
	created_at: timestamp({ withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	foreignKey({
			columns: [table.character_id],
			foreignColumns: [story_workspace_characters.id],
			name: "fk_story_workspace_story_characters_character_id_sto_ae8cd95f92"
		}),
	foreignKey({
			columns: [table.story_id],
			foreignColumns: [story_workspace_stories.id],
			name: "fk_story_workspace_story_characters_story_id_story_w_a3972b6cb6"
		}),
	primaryKey({ columns: [table.story_id, table.character_id], name: "pk_story_workspace_story_characters"}),
]);

export const deck_claude_plugin_refs = pgTable("deck_claude_plugin_refs", {
	deck_id: text().notNull(),
	plugin_installation_id: text().notNull(),
	package_spec: text().notNull(),
	resolved_version: text().notNull(),
	artifact_digest: text().notNull(),
	enabled: integer().default(1).notNull(),
	order_index: integer().default(0).notNull(),
	created_at: timestamp({ withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	updated_at: timestamp({ withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	index("idx_deck_claude_plugin_refs_deck").using("btree", table.deck_id.asc().nullsLast().op("text_ops"), table.enabled.asc().nullsLast().op("text_ops"), table.order_index.asc().nullsLast().op("text_ops")),
	foreignKey({
			columns: [table.plugin_installation_id],
			foreignColumns: [claude_plugin_installations.id],
			name: "fk_deck_claude_plugin_refs_plugin_installation_id_cl_d75be593ed"
		}).onDelete("restrict"),
	foreignKey({
			columns: [table.deck_id],
			foreignColumns: [decks.id],
			name: "fk_deck_claude_plugin_refs_deck_id_decks"
		}).onDelete("restrict"),
	primaryKey({ columns: [table.deck_id, table.plugin_installation_id], name: "pk_deck_claude_plugin_refs"}),
]);

export const runtime_load_receipt_entries = pgTable("runtime_load_receipt_entries", {
	receipt_id: text().notNull(),
	claude_code_plugin_id: text().notNull(),
	resolved_version: text().notNull(),
	artifact_digest: text().notNull(),
	materialized_digest: text().notNull(),
	verification_status: text().notNull(),
	signature_bundle_ref: text(),
	retention_state: text().notNull(),
	restore_source_ref: text(),
	required: integer().notNull(),
	loaded_capabilities_json: text().notNull(),
	load_status: text().notNull(),
	loaded_at: timestamp({ withTimezone: true, mode: 'string' }).notNull(),
}, (table) => [
	foreignKey({
			columns: [table.receipt_id],
			foreignColumns: [runtime_load_receipts.receipt_id],
			name: "fk_runtime_load_receipt_entries_receipt_id_runtime_l_f7f5afca38"
		}).onDelete("restrict"),
	primaryKey({ columns: [table.receipt_id, table.claude_code_plugin_id], name: "pk_runtime_load_receipt_entries"}),
	check("ck_runtime_load_receipt_entries_1", sql`verification_status = ANY (ARRAY['verified'::text, 'legacy_unverified'::text])`),
	check("ck_runtime_load_receipt_entries_2", sql`required = ANY (ARRAY[0, 1])`),
	check("ck_runtime_load_receipt_entries_3", sql`load_status = ANY (ARRAY['loaded'::text, 'load_failed'::text, 'skipped'::text])`),
]);

export const dream_mcp_servers = pgTable("dream_mcp_servers", {
	id: text().primaryKey().notNull(),
	user_id: bigint({ mode: "number" }).notNull(),
	server_key: text().notNull(),
	display_name: text().notNull(),
	scope_type: text().notNull(),
	scope_id: text(),
	transport: text().notNull(),
	remote_url: text(),
	stdio_profile_key: text(),
	auth_kind: text().default('none').notNull(),
	enabled: boolean().default(true).notNull(),
	config_revision: integer().default(1).notNull(),
	created_at: timestamp({ withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	updated_at: timestamp({ withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	index("idx_dream_mcp_servers_list").using("btree", table.user_id.asc().nullsLast().op("int8_ops"), table.scope_type.asc().nullsLast().op("text_ops"), table.scope_id.asc().nullsLast().op("text_ops"), table.enabled.asc().nullsLast().op("bool_ops"), table.updated_at.desc().nullsLast().op("timestamptz_ops")),
	foreignKey({
		columns: [table.user_id],
		foreignColumns: [users.id],
		name: "fk_dream_mcp_servers_user_id_users",
	}).onDelete("cascade"),
	unique("uq_dream_mcp_servers_scope_key").on(table.user_id, table.scope_type, table.scope_id, table.server_key).nullsNotDistinct(),
	check("ck_dream_mcp_servers_scope", sql`(scope_type = 'user'::text AND scope_id IS NULL) OR (scope_type = 'workspace'::text AND scope_id IS NOT NULL)`),
	check("ck_dream_mcp_servers_transport", sql`transport = ANY (ARRAY['streamable_http'::text, 'sse'::text, 'stdio'::text])`),
	check("ck_dream_mcp_servers_endpoint", sql`((transport = ANY (ARRAY['streamable_http'::text, 'sse'::text])) AND remote_url IS NOT NULL AND stdio_profile_key IS NULL) OR (transport = 'stdio'::text AND remote_url IS NULL AND stdio_profile_key IS NOT NULL)`),
	check("ck_dream_mcp_servers_auth_kind", sql`auth_kind = ANY (ARRAY['none'::text, 'oauth'::text])`),
	check("ck_dream_mcp_servers_config_revision", sql`config_revision >= 1`),
]);

export const dream_mcp_credentials = pgTable("dream_mcp_credentials", {
	id: text().primaryKey().notNull(),
	server_id: text().notNull(),
	kind: text().notNull(),
	ciphertext: text().notNull(),
	iv: text().notNull(),
	tag: text().notNull(),
	fingerprint: text().notNull(),
	key_version: integer().notNull(),
	credential_revision: integer().default(1).notNull(),
	expires_at: timestamp({ withTimezone: true, mode: 'string' }),
	created_at: timestamp({ withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	updated_at: timestamp({ withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	foreignKey({
		columns: [table.server_id],
		foreignColumns: [dream_mcp_servers.id],
		name: "fk_dream_mcp_credentials_server_id_servers",
	}).onDelete("cascade"),
	unique("uq_dream_mcp_credentials_server_id").on(table.server_id),
	check("ck_dream_mcp_credentials_kind", sql`kind = ANY (ARRAY['oauth'::text, 'headers'::text, 'stdio_env'::text])`),
	check("ck_dream_mcp_credentials_key_version", sql`key_version >= 1`),
	check("ck_dream_mcp_credentials_revision", sql`credential_revision >= 1`),
]);

export const dream_mcp_discovery_snapshots = pgTable("dream_mcp_discovery_snapshots", {
	id: text().primaryKey().notNull(),
	server_id: text().notNull(),
	config_revision: integer().notNull(),
	credential_revision: integer(),
	status: text().notNull(),
	inventory: jsonb().default({}).notNull(),
	inventory_sha256: text().notNull(),
	safe_error_code: text(),
	discovered_at: timestamp({ withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	expires_at: timestamp({ withTimezone: true, mode: 'string' }).notNull(),
}, (table) => [
	index("idx_dream_mcp_discovery_snapshots_query").using("btree", table.server_id.asc().nullsLast().op("text_ops"), table.status.asc().nullsLast().op("text_ops"), table.expires_at.desc().nullsLast().op("timestamptz_ops"), table.discovered_at.desc().nullsLast().op("timestamptz_ops")),
	foreignKey({
		columns: [table.server_id],
		foreignColumns: [dream_mcp_servers.id],
		name: "fk_dream_mcp_discovery_snapshots_server_id_servers",
	}).onDelete("cascade"),
	unique("uq_dream_mcp_discovery_snapshots_revision").on(table.server_id, table.config_revision, table.credential_revision).nullsNotDistinct(),
	check("ck_dream_mcp_discovery_snapshots_config_revision", sql`config_revision >= 1`),
	check("ck_dream_mcp_discovery_snapshots_credential_revision", sql`credential_revision IS NULL OR credential_revision >= 1`),
	check("ck_dream_mcp_discovery_snapshots_status", sql`status = ANY (ARRAY['complete'::text, 'failed'::text, 'cancelled'::text])`),
	check("ck_dream_mcp_discovery_snapshots_inventory", sql`jsonb_typeof(inventory) = 'object'::text`),
	check("ck_dream_mcp_discovery_snapshots_inventory_sha", sql`inventory_sha256 ~ '^[0-9a-f]{64}$'::text`),
	check("ck_dream_mcp_discovery_snapshots_expiry", sql`expires_at > discovered_at`),
]);

export const dream_mcp_import_receipts = pgTable("dream_mcp_import_receipts", {
	id: text().primaryKey().notNull(),
	user_id: bigint({ mode: "number" }).notNull(),
	source_item_sha256: text().notNull(),
	canonical_config_sha256: text().notNull(),
	target_server_id: text(),
	state: text().notNull(),
	run_id: text().notNull(),
	created_at: timestamp({ withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	updated_at: timestamp({ withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	uniqueIndex("uq_dream_mcp_import_receipts_success_source").using("btree", table.user_id.asc().nullsLast().op("int8_ops"), table.source_item_sha256.asc().nullsLast().op("text_ops")).where(sql`(state = ANY (ARRAY['imported'::text, 'noop'::text]))`),
	index("idx_dream_mcp_import_receipts_run").using("btree", table.user_id.asc().nullsLast().op("int8_ops"), table.run_id.asc().nullsLast().op("text_ops"), table.created_at.desc().nullsLast().op("timestamptz_ops")),
	foreignKey({
		columns: [table.user_id],
		foreignColumns: [users.id],
		name: "fk_dream_mcp_import_receipts_user_id_users",
	}).onDelete("cascade"),
	foreignKey({
		columns: [table.target_server_id],
		foreignColumns: [dream_mcp_servers.id],
		name: "fk_dream_mcp_import_receipts_target_server_id_servers",
	}).onDelete("set null"),
	check("ck_dream_mcp_import_receipts_source_sha", sql`source_item_sha256 ~ '^[0-9a-f]{64}$'::text`),
	check("ck_dream_mcp_import_receipts_config_sha", sql`canonical_config_sha256 ~ '^[0-9a-f]{64}$'::text`),
	check("ck_dream_mcp_import_receipts_state", sql`state = ANY (ARRAY['imported'::text, 'noop'::text, 'conflict'::text, 'credential_reauth_required'::text])`),
]);

export const claude_agent_resource_snapshots = pgTable("claude_agent_resource_snapshots", {
	instance_id: text().primaryKey().notNull(),
	process_started_at: timestamp({ withTimezone: true, mode: 'string' }).notNull(),
	heartbeat_at: timestamp({ withTimezone: true, mode: 'string' }).notNull(),
	sampled_at: timestamp({ withTimezone: true, mode: 'string' }),
	snapshot: jsonb().notNull(),
	created_at: timestamp({ withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	updated_at: timestamp({ withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	index("idx_claude_agent_resource_snapshots_heartbeat").using("btree", table.heartbeat_at.desc().nullsLast().op("timestamptz_ops")),
	check("ck_claude_agent_resource_snapshots_instance_id", sql`length(instance_id) BETWEEN 1 AND 128`),
	check("ck_claude_agent_resource_snapshots_snapshot", sql`jsonb_typeof(snapshot) = 'object'::text`),
	check("ck_claude_agent_resource_snapshots_heartbeat", sql`heartbeat_at >= process_started_at`),
	check("ck_claude_agent_resource_snapshots_sampled", sql`sampled_at IS NULL OR (sampled_at >= process_started_at AND sampled_at <= heartbeat_at)`),
	check("ck_claude_agent_resource_snapshots_updated", sql`updated_at >= created_at`),
]);
