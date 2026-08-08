-- PostgreSQL test fixture mirroring the audited ink-dream-memory Story tables.
-- This file is only applied to an owned disposable PostgreSQL instance whose
-- database is named `ink-memory`; it is never an application migration.

CREATE TABLE story_workspace_characters (
  id text PRIMARY KEY,
  identifier text NOT NULL,
  name text NOT NULL,
  avatar_url text,
  identity text,
  personality text,
  background text,
  catchphrase text,
  tags text DEFAULT '[]',
  notes text,
  author_id bigint NOT NULL REFERENCES users(id),
  workspace_id text NOT NULL REFERENCES story_workspace_workspaces(id),
  story_count integer NOT NULL DEFAULT 0,
  review_status text NOT NULL DEFAULT 'pending' CHECK (review_status IN ('pending', 'confirmed', 'rejected')),
  agent_generated integer NOT NULL DEFAULT 1 CHECK (agent_generated IN (0, 1)),
  created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'archived')),
  review_notes text CHECK (review_notes IS NULL OR length(review_notes) <= 2000),
  confirmed_at timestamptz,
  archived_at timestamptz
);

CREATE TABLE story_workspace_scenes (
  id text PRIMARY KEY,
  identifier text NOT NULL,
  name text NOT NULL,
  description text,
  story_id text REFERENCES story_workspace_stories(id),
  author_id bigint NOT NULL REFERENCES users(id),
  workspace_id text NOT NULL REFERENCES story_workspace_workspaces(id),
  character_count integer NOT NULL DEFAULT 0,
  order_index integer NOT NULL DEFAULT 0,
  review_status text NOT NULL DEFAULT 'pending' CHECK (review_status IN ('pending', 'confirmed', 'rejected')),
  agent_generated integer NOT NULL DEFAULT 1 CHECK (agent_generated IN (0, 1)),
  created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'archived')),
  review_notes text CHECK (review_notes IS NULL OR length(review_notes) <= 2000),
  confirmed_at timestamptz,
  archived_at timestamptz
);

CREATE TABLE story_workspace_story_characters (
  story_id text NOT NULL REFERENCES story_workspace_stories(id),
  character_id text NOT NULL REFERENCES story_workspace_characters(id),
  role_type text,
  created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (story_id, character_id)
);

CREATE TABLE story_workspace_scene_characters (
  scene_id text NOT NULL REFERENCES story_workspace_scenes(id),
  character_id text NOT NULL REFERENCES story_workspace_characters(id),
  created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (scene_id, character_id)
);

CREATE TABLE workflow_runs (
  id text PRIMARY KEY,
  workspace_id text NOT NULL,
  deck_plugin_id text NOT NULL,
  deck_plugin_version text NOT NULL,
  workflow_definition_ref text NOT NULL,
  deck_runtime_snapshot_id text NOT NULL,
  status text NOT NULL DEFAULT 'preflight' CHECK (status IN ('preflight', 'queued', 'running', 'output_validating', 'pending_review', 'confirmed', 'rejected', 'continuing', 'completed', 'failed', 'cancelled')),
  failed_step text,
  error_code text,
  retry_of_run_id text REFERENCES workflow_runs(id) ON DELETE RESTRICT,
  deck_plugin_manifest_hash text NOT NULL,
  deck_plugin_binding_id text NOT NULL,
  binding_revision integer NOT NULL CHECK (binding_revision >= 1),
  runtime_plugin_lock_id text NOT NULL,
  runtime_load_receipt_id text,
  workflow_preflight_id text NOT NULL,
  agent_session_id text,
  source_voice_thread_id text,
  source_message_id text,
  source_message_time timestamptz,
  idempotency_key text NOT NULL,
  input_hash text NOT NULL,
  semantic_fingerprint text NOT NULL,
  status_version integer NOT NULL DEFAULT 1 CHECK (status_version >= 1),
  created_by text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  started_at timestamptz,
  completed_at timestamptz,
  UNIQUE (workspace_id, created_by, idempotency_key)
);

CREATE TABLE workflow_run_token_consumptions (
  token_digest text PRIMARY KEY,
  workflow_run_id text NOT NULL REFERENCES workflow_runs(id) ON DELETE RESTRICT,
  workflow_preflight_id text NOT NULL,
  workspace_id text NOT NULL,
  actor_id text NOT NULL,
  idempotency_key text NOT NULL,
  semantic_fingerprint text NOT NULL,
  consumed_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE workflow_run_transitions (
  id text PRIMARY KEY,
  workflow_run_id text NOT NULL REFERENCES workflow_runs(id) ON DELETE RESTRICT,
  transition_seq integer NOT NULL CHECK (transition_seq >= 1),
  from_status text,
  to_status text NOT NULL,
  actor_id text NOT NULL,
  reason_code text,
  failed_step text,
  error_code text,
  occurred_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (workflow_run_id, transition_seq)
);

INSERT INTO users (id, email, password_hash, display_name, role)
VALUES
  (101, 'creator@example.test', 'fixture-password-hash-not-a-credential', '测试创作者', 'user'),
  (102, 'other@example.test', 'fixture-password-hash-not-a-credential', '其他创作者', 'user');

INSERT INTO story_workspace_workspaces (id, name, owner_id, settings)
VALUES
  ('workspace-e2e', 'E2E 创作空间', 101, '{"language":"zh-CN"}'),
  ('workspace-other', '其他创作空间', 102, '{}');

INSERT INTO story_workspace_stories (
  id, identifier, title, description, author_id, workspace_id,
  character_count, scene_count, agent_generated
) VALUES
  ('story-e2e', 'story-e2e', '真实源剧本', '用于隔离 PostgreSQL 验收', 101, 'workspace-e2e', 1, 1, 1),
  ('story-other', 'story-other', '其他作者剧本', NULL, 102, 'workspace-other', 0, 0, 1);

INSERT INTO story_workspace_characters (
  id, identifier, name, identity, tags, author_id, workspace_id,
  story_count, agent_generated
) VALUES
  ('character-e2e', 'character-e2e', '林墨', '主角', '["writer"]', 101, 'workspace-e2e', 1, 1);

INSERT INTO story_workspace_scenes (
  id, identifier, name, description, story_id, author_id, workspace_id,
  character_count, order_index, agent_generated
) VALUES
  ('scene-e2e', 'scene-e2e', '第一场', '开场', 'story-e2e', 101, 'workspace-e2e', 1, 0, 1);

INSERT INTO story_workspace_story_characters (story_id, character_id, role_type)
VALUES ('story-e2e', 'character-e2e', 'protagonist');

INSERT INTO story_workspace_scene_characters (scene_id, character_id)
VALUES ('scene-e2e', 'character-e2e');

INSERT INTO workflow_runs (
  id, workspace_id, deck_plugin_id, deck_plugin_version,
  workflow_definition_ref, deck_runtime_snapshot_id, status,
  deck_plugin_manifest_hash, deck_plugin_binding_id, binding_revision,
  runtime_plugin_lock_id, workflow_preflight_id, idempotency_key,
  input_hash, semantic_fingerprint, created_by
) VALUES (
  'run-e2e', 'workspace-e2e', 'story-deck', '1.0.0',
  'workflow://story/generate', 'snapshot-e2e', 'completed',
  'manifest-hash-e2e', 'binding-e2e', 1,
  'runtime-lock-e2e', 'preflight-e2e', 'run-e2e-idempotency',
  'input-hash-e2e', 'semantic-e2e', '101'
);

SELECT setval(pg_get_serial_sequence('users', 'id'), 102, true);
