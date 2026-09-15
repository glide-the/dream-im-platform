// [Input] Canonical users/admin membership and installed Better Auth identity catalog.
// [Output] Explicit subject links, encrypted BFF sessions, claim-bound Runtime delegations, receipts and immutable Preflight requests.
// [Pos] Admin-owned identity and persistence control schema; all DDL uses forward Drizzle migration.
// [Sync] 2026-09-16: add optional Story confirmation claim bindings to existing Runtime delegations.
import { sql } from "drizzle-orm";
import { bigint, boolean, check, foreignKey, index, jsonb, pgSchema, primaryKey, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";
import { adminUsers, gatewayApiKeys, users } from "./index.js";
import { identity, user } from "./auth-generated.js";
import { chat_message, chat_thread, reflection_task_section, user_sessions, workflow_preflights } from "./dream.js";

export const dream = pgSchema("dream");

export const subjectLinks = identity.table("subject_links", {
  authUserId: text("auth_user_id").primaryKey().references(() => user.id, { onDelete: "restrict" }),
  canonicalUserId: bigint("canonical_user_id", { mode: "bigint" }).notNull().references(() => users.id, { onDelete: "restrict" }),
  evidence: text("evidence").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, table => [uniqueIndex("subject_links_canonical_uidx").on(table.canonicalUserId)]);

export const adminSubjectLinks = identity.table("admin_subject_links", {
  authUserId: text("auth_user_id").primaryKey().references(() => user.id, { onDelete: "restrict" }),
  adminUserId: text("admin_user_id").notNull().references(() => adminUsers.id, { onDelete: "restrict" }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, table => [uniqueIndex("admin_subject_links_admin_uidx").on(table.adminUserId)]);

export const browserSessions = identity.table("browser_sessions", {
  handleHash: text("handle_hash").primaryKey(),
  serviceClientId: text("service_client_id").notNull(),
  origin: text("origin").notNull(),
  authUserId: text("auth_user_id").notNull().references(() => user.id, { onDelete: "restrict" }),
  transactionId: text("transaction_id").notNull(),
  inputSha256: text("input_sha256").notNull(),
  tokenCiphertext: text("token_ciphertext").notNull(),
  status: text("status").notNull().default("active"),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  revokedAt: timestamp("revoked_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, table => [
  uniqueIndex("browser_sessions_transaction_uidx").on(table.serviceClientId, table.transactionId),
  index("browser_sessions_subject_expiry_idx").on(table.authUserId, table.expiresAt),
  check("browser_sessions_status_check", sql`${table.status} IN ('active','refreshing','login_required','revoked')`),
]);

export const runtimeDelegations = identity.table("runtime_delegations", {
  tokenHash: text("token_hash").primaryKey(),
  serviceClientId: text("service_client_id").notNull(),
  authUserId: text("auth_user_id").notNull().references(() => user.id, { onDelete: "restrict" }),
  oauthClientId: text("oauth_client_id"),
  requestId: text("request_id"),
  inputSha256: text("input_sha256"),
  tokenCiphertext: text("token_ciphertext"),
  gatewayApiKeyId: text("gateway_api_key_id").references(() => gatewayApiKeys.id, { onDelete: "restrict" }),
  purpose: text("purpose"),
  editorSessionId: text("editor_session_id").references(() => user_sessions.id, { onDelete: "cascade" }),
  authoritySource: text("authority_source"),
  sourceMessageId: text("source_message_id").references(() => chat_message.id, { onDelete: "cascade" }),
  sourceClaimId: text("source_claim_id"),
  canonicalUserId: bigint("canonical_user_id", { mode: "bigint" }).notNull().references(() => users.id, { onDelete: "restrict" }),
  threadId: text("thread_id").notNull(),
  runId: text("run_id"),
  scopes: text("scopes").array().notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  maximumExpiresAt: timestamp("maximum_expires_at", { withTimezone: true }),
  revokedAt: timestamp("revoked_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, table => [
  index("runtime_delegations_thread_idx").on(table.threadId, table.expiresAt),
  uniqueIndex("runtime_delegations_request_uidx").on(table.serviceClientId, table.authUserId, table.requestId),
  uniqueIndex("runtime_delegations_confirmation_claim_uidx")
    .on(table.serviceClientId, table.sourceMessageId, table.sourceClaimId)
    .where(sql`${table.authoritySource} = 'story-confirmation-claim'`),
  check("runtime_delegations_maximum_expiry_check", sql`${table.maximumExpiresAt} IS NULL OR ${table.maximumExpiresAt} >= ${table.expiresAt}`),
  check("runtime_delegations_creation_check", sql`${table.requestId} IS NULL OR (${table.oauthClientId} IS NOT NULL AND ${table.inputSha256} IS NOT NULL AND ${table.inputSha256} ~ '^[0-9a-f]{64}$' AND ${table.tokenCiphertext} IS NOT NULL AND ${table.maximumExpiresAt} IS NOT NULL)`),
  check("runtime_delegations_authority_source_check", sql`(
    ${table.authoritySource} IS NULL AND ${table.sourceMessageId} IS NULL AND ${table.sourceClaimId} IS NULL
  ) OR (
    ${table.authoritySource} = 'story-confirmation-claim'
    AND ${table.sourceMessageId} IS NOT NULL
    AND ${table.sourceClaimId} IS NOT NULL
    AND ${table.purpose} = 'server-persistence'
    AND ${table.runId} IS NOT NULL
    AND ${table.editorSessionId} IS NULL
    AND ${table.gatewayApiKeyId} IS NULL
  )`),
  check("runtime_delegations_purpose_check", sql`(${table.purpose} IS NULL AND ${table.editorSessionId} IS NULL) OR (${table.purpose} IS NOT NULL AND cardinality(${table.scopes}) > 0 AND array_position(${table.scopes}, NULL) IS NULL AND (
    (${table.purpose} = 'server-persistence' AND ${table.editorSessionId} IS NULL AND ${table.gatewayApiKeyId} IS NULL AND ${table.scopes} <@ ARRAY['dream:read','dream:write']::text[]) OR
    (${table.purpose} = 'gateway-cli' AND ${table.editorSessionId} IS NULL AND ${table.gatewayApiKeyId} IS NOT NULL AND ${table.scopes} <@ ARRAY['messages:create','messages:count_tokens','models:list']::text[]) OR
    (${table.purpose} = 'editor-stdio' AND ${table.editorSessionId} IS NOT NULL AND ${table.gatewayApiKeyId} IS NULL AND ${table.scopes} <@ ARRAY['editor:read','editor:write']::text[])
  ))`),
]);

export const operationReceipts = dream.table("operation_receipts", {
  serviceClientId: text("service_client_id").notNull(),
  actor: text("actor").notNull(),
  operation: text("operation").notNull(),
  requestId: text("request_id").notNull(),
  inputSha256: text("input_sha256").notNull(),
  result: jsonb("result").notNull(),
  committedAt: timestamp("committed_at", { withTimezone: true }).notNull().defaultNow(),
}, table => [
  primaryKey({ columns: [table.serviceClientId, table.actor, table.operation, table.requestId] }),
  check("operation_receipts_hash_check", sql`${table.inputSha256} ~ '^[0-9a-f]{64}$'`),
]);

export const reflectionTaskAuthorities = dream.table("reflection_task_authorities", {
  tokenHash: text("token_hash").primaryKey(),
  serviceClientId: text("service_client_id").notNull(),
  taskId: text("task_id").notNull(),
  section: text("section").notNull(),
  threadId: text("thread_id").notNull(),
  authUserId: text("auth_user_id").notNull().references(() => user.id, { onDelete: "restrict" }),
  canonicalUserId: bigint("canonical_user_id", { mode: "bigint" }).notNull().references(() => users.id, { onDelete: "restrict" }),
  purpose: text("purpose").notNull().default("reflections-worker"),
  scopes: text("scopes").array().notNull(),
  requestId: text("request_id").notNull(),
  inputSha256: text("input_sha256").notNull(),
  tokenCiphertext: text("token_ciphertext").notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  maximumExpiresAt: timestamp("maximum_expires_at", { withTimezone: true }).notNull(),
  revokedAt: timestamp("revoked_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, table => [
  foreignKey({ columns: [table.taskId, table.section], foreignColumns: [reflection_task_section.task_id, reflection_task_section.section], name: "reflection_task_authorities_task_section_fk" }).onDelete("cascade"),
  foreignKey({ columns: [table.threadId], foreignColumns: [chat_thread.id], name: "reflection_task_authorities_thread_fk" }).onDelete("cascade"),
  uniqueIndex("reflection_task_authorities_live_uidx").on(table.taskId, table.section).where(sql`${table.revokedAt} IS NULL`),
  uniqueIndex("reflection_task_authorities_request_uidx").on(table.serviceClientId, table.taskId, table.section, table.requestId),
  check("reflection_task_authorities_hash_check", sql`${table.inputSha256} ~ '^[0-9a-f]{64}$'`),
  check("reflection_task_authorities_purpose_scope_check", sql`${table.purpose} = 'reflections-worker' AND cardinality(${table.scopes}) = 2 AND ${table.scopes} @> ARRAY['dream:read','dream:write']::text[] AND array_position(${table.scopes}, NULL) IS NULL`),
  check("reflection_task_authorities_expiry_check", sql`${table.maximumExpiresAt} >= ${table.expiresAt} AND ${table.updatedAt} >= ${table.createdAt}`),
]);

export const workflowPreflightRequests = dream.table("workflow_preflight_requests", {
  serviceClientId: text("service_client_id").notNull(),
  actor: text("actor").notNull(),
  requestId: text("request_id").notNull(),
  inputSha256: text("input_sha256").notNull(),
  workflowPreflightId: text("workflow_preflight_id").notNull().references(() => workflow_preflights.workflow_preflight_id, { onDelete: "restrict" }),
  canonicalUserId: bigint("canonical_user_id", { mode: "bigint" }).notNull(),
  workspaceId: text("workspace_id").notNull(),
  executionOwner: boolean("execution_owner").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
}, table => [
  primaryKey({ columns: [table.serviceClientId, table.actor, table.requestId] }),
  index("workflow_preflight_requests_preflight_idx").on(table.workflowPreflightId),
  check("workflow_preflight_requests_hash_check", sql`${table.inputSha256} ~ '^[0-9a-f]{64}$'`),
  check("workflow_preflight_requests_owner_check", sql`${table.canonicalUserId} > 0`),
]);
