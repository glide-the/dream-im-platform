// [Input] Authenticated Admin requests, one Provider-owned credential, PostgreSQL attempt state, and the product registry.
// [Output] Secret-safe account lifecycle operations for non-deleted managed Providers.
// [Pos] Admin orchestration boundary; product OAuth endpoints and protocol details remain owned by app/lib/providers.
// [Sync] 2026-09-04: resolve and mutate only the credential directly owned by the requested Provider.
// [Sync] 2026-09-04: recover deleted/unbound credential orphans without weakening active-account exclusivity.
// [Sync] 2026-09-04: start a non-transactional, failure-isolated model catalog snapshot after account connection.

import { createHash, createHmac, randomUUID } from "node:crypto";
import type { PoolClient } from "pg";
import { z } from "zod";

import { withPlatformClient, withPlatformTransaction } from "../platform-db";
import { createPlatformId } from "../platform-ids";
import {
  enqueueProviderRevocationJobOnClient,
  loadLatestProviderRevocationJobOnClient,
  processProviderRevocationJob,
  revocationJobProjection,
} from "../provider-auth/revocation-jobs";
import { getCredentialEncryptionKey } from "../security/credential-encryption";
import {
  CredentialEnvelopeError,
  decryptCredentialEnvelope,
  encryptCredentialEnvelope,
  type EncryptedCredentialEnvelope,
} from "../security/credential-envelope";
import {
  deviceFlowStateSchema,
  providerTokenBundleSchema,
} from "../providers/schemas";
import { getProviderProductRegistry } from "../providers";
import {
  revocationMaterialFromBundle,
  sameRevocationMaterial,
} from "../providers/shared";
import type {
  DeviceFlowState,
  DevicePollResult,
  ProviderProductAdapter,
  ProviderProductRegistry,
  ProviderTokenBundle,
} from "../providers/types";
import { recordAdminAuditOnClient } from "./audit";
import { AdminError, adminErrorResponse } from "./errors";
import {
  adminRequestId,
  assertAdminMutationOrigin,
  requireAdminRequest,
} from "./guard";
import type { AdminIdentity } from "./session";
import { discoverProviderModels } from "./provider-discovery";

export const MANAGED_ADAPTER_KINDS = [
  "codex",
  "xai",
  "github_copilot",
] as const;
export type ManagedAdapterKind = (typeof MANAGED_ADAPTER_KINDS)[number];

type ManagedCredentialStatus = "connected" | "reauth_required" | "disconnected";
type ManagedAttemptStatus =
  | "starting"
  | "pending"
  | "succeeded"
  | "denied"
  | "expired"
  | "cancelled"
  | "failed";

export type ManagedAuthReadiness = {
  codeSupported: boolean;
  clientRegistrationConfigured: boolean;
  integrationProfileConfigured?: boolean;
  copilotAccessVerified?: boolean;
  endpointPolicyValid: boolean;
  effective: boolean;
  registrationFingerprint: string | null;
  reasons?: string[];
};

type ManagedAuthDependencies = {
  registry?: ProviderProductRegistry;
  now?: () => Date;
  createId?: (prefix: string) => string;
  createLeaseId?: () => string;
  withClient?: typeof withPlatformClient;
  withTransaction?: typeof withPlatformTransaction;
  discoverModels?: typeof discoverProviderModels;
};

type ProviderRow = {
  id: string;
  code: string;
  name: string;
  status: "active" | "disabled";
  adapter_kind: "generic" | ManagedAdapterKind;
  active_credential_kind: "static_api_key" | "managed_oauth" | "none";
  auth_epoch: number;
  managed_credential_id: string | null;
};

type CredentialOwnerRow = Omit<ProviderRow, "status"> & {
  status: ProviderRow["status"] | "deleted";
};

type CredentialRow = {
  id: string;
  provider_id: string | null;
  adapter_kind: ManagedAdapterKind;
  status: ManagedCredentialStatus;
  auth_epoch: number;
  revision: number;
  display_name: string | null;
  envelope_context_id: string;
  bundle_format_version: number | null;
  bundle_key_id: string | null;
  bundle_ciphertext: string | null;
  bundle_nonce: string | null;
  bundle_tag: string | null;
  registration_fingerprint: string | null;
  account_identity_hash: string | null;
  account_label: string | null;
  granted_scopes: string[] | null;
  access_expires_at: Date | string | null;
  refresh_expires_at: Date | string | null;
  session_expires_at: Date | string | null;
  revocation_status: string | null;
  disconnected_at: Date | string | null;
  created_at: Date | string;
  updated_at: Date | string;
};

type AttemptRow = {
  id: string;
  provider_id: string;
  adapter_kind: ManagedAdapterKind;
  flow_kind: string;
  status: ManagedAttemptStatus;
  expected_auth_epoch: number;
  target_credential_id: string | null;
  expected_credential_auth_epoch: number | null;
  expected_credential_revision: number | null;
  envelope_context_id: string;
  revision: number;
  idempotency_key_hash: string;
  request_canonical_hash: string;
  registration_fingerprint: string;
  state_hash: string | null;
  bundle_format_version: number | null;
  bundle_key_id: string | null;
  bundle_ciphertext: string | null;
  bundle_nonce: string | null;
  bundle_tag: string | null;
  redirect_uri: string | null;
  verification_uri: string | null;
  expires_at: Date | string | null;
  poll_interval_seconds: number | null;
  next_poll_at: Date | string | null;
  operation_lease_id: string | null;
  operation_lease_expires_at: Date | string | null;
  failure_code: string | null;
  consumed_at: Date | string | null;
  created_by_admin_id: string;
  created_at: Date | string;
  updated_at: Date | string;
  poll_deadline_expired?: boolean;
  poll_too_early?: boolean;
  poll_lease_active?: boolean;
};

type EnvelopeRecord = Pick<
  CredentialRow | AttemptRow,
  | "bundle_format_version"
  | "bundle_key_id"
  | "bundle_ciphertext"
  | "bundle_nonce"
  | "bundle_tag"
>;

type EnvelopeContext = {
  providerId: string;
  adapterKind: ManagedAdapterKind;
  recordId: string;
  revision: number;
};

const startBodySchema = z.strictObject({
  expectedAuthEpoch: z.number().int().min(1),
  targetAccountId: z.string().trim().min(1).max(200).optional(),
  expectedAccountEpoch: z.number().int().min(1).optional(),
  idempotencyKey: z.string().trim().min(8).max(200),
}).superRefine((value, context) => {
  if (Boolean(value.targetAccountId) !== Boolean(value.expectedAccountEpoch)) {
    context.addIssue({
      code: "custom",
      path: [value.targetAccountId ? "expectedAccountEpoch" : "targetAccountId"],
      message: "targetAccountId and expectedAccountEpoch must be supplied together",
    });
  }
});
const attemptActionSchema = z.strictObject({
  expectedRevision: z.number().int().min(1),
});
const disconnectBodySchema = z.strictObject({
  expectedAuthEpoch: z.number().int().min(1),
});
const accountDisconnectBodySchema = z.strictObject({
  expectedAccountEpoch: z.number().int().min(1),
  expectedRevision: z.number().int().min(1),
  reason: z.string().trim().min(1).max(500).optional(),
});
const retryRevocationBodySchema = z.strictObject({
  jobId: z.string().trim().min(8).max(200),
  accountId: z.string().trim().min(1).max(200),
  expectedRevision: z.number().int().min(1),
});

const ACTIVE_ATTEMPT_STATUSES = new Set<ManagedAttemptStatus>([
  "starting",
  "pending",
]);
const TERMINAL_ATTEMPT_STATUSES = new Set<ManagedAttemptStatus>([
  "succeeded",
  "denied",
  "expired",
  "cancelled",
  "failed",
]);
// A product poll makes at most three sequential, individually 15-second-bounded requests.
const POLL_LEASE_MILLISECONDS = 90_000;
const START_LEASE_MILLISECONDS = 90_000;

function sha256(value: string | Buffer) {
  return createHash("sha256").update(value).digest("hex");
}

function accountIdentityPepper() {
  const value = process.env.AI_PROVIDER_ACCOUNT_IDENTITY_PEPPER?.trim();
  if (!value || Buffer.byteLength(value, "utf8") < 32) {
    throw new Error(
      "AI_PROVIDER_ACCOUNT_IDENTITY_PEPPER must contain at least 32 bytes",
    );
  }
  return value;
}

function accountIdentityFingerprint(
  adapterKind: ManagedAdapterKind,
  canonicalIdentity: string,
) {
  return `hmac-sha256:${createHmac("sha256", accountIdentityPepper())
    .update(`${adapterKind}\0${canonicalIdentity}`, "utf8")
    .digest("hex")}`;
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map((item) => canonicalJson(item)).join(",")}]`;
  }
  if (value && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function envelopeFromRow(record: EnvelopeRecord): EncryptedCredentialEnvelope {
  if (
    record.bundle_format_version !== 1 ||
    !record.bundle_key_id ||
    !record.bundle_ciphertext ||
    !record.bundle_nonce ||
    !record.bundle_tag
  ) {
    throw new AdminError(
      "PROVIDER_MANAGED_AUTH_BUNDLE_UNAVAILABLE",
      "The managed authentication state cannot be opened",
      503,
    );
  }
  return {
    formatVersion: 1,
    keyId: record.bundle_key_id,
    ciphertext: record.bundle_ciphertext,
    nonce: record.bundle_nonce,
    tag: record.bundle_tag,
  };
}

function encryptAttemptFlow(flow: DeviceFlowState, context: EnvelopeContext) {
  return encryptCredentialEnvelope(
    flow,
    { ...context, recordKind: "attempt" },
    deviceFlowStateSchema,
  );
}

function decryptAttemptFlow(record: EnvelopeRecord, context: EnvelopeContext) {
  try {
    return decryptCredentialEnvelope(
      envelopeFromRow(record),
      { ...context, recordKind: "attempt" },
      deviceFlowStateSchema,
    );
  } catch (error) {
    if (error instanceof AdminError) throw error;
    if (error instanceof CredentialEnvelopeError) {
      throw new AdminError(error.code, "The managed authentication state is unavailable", 503);
    }
    throw error;
  }
}

function encryptTokenBundle(bundle: ProviderTokenBundle, context: EnvelopeContext) {
  return encryptCredentialEnvelope(
    bundle,
    { ...context, recordKind: "credential" },
    providerTokenBundleSchema,
  );
}

function decryptTokenBundle(record: EnvelopeRecord, context: EnvelopeContext) {
  try {
    return decryptCredentialEnvelope(
      envelopeFromRow(record),
      { ...context, recordKind: "credential" },
      providerTokenBundleSchema,
    );
  } catch (error) {
    if (error instanceof AdminError) throw error;
    if (error instanceof CredentialEnvelopeError) {
      throw new AdminError(error.code, "The managed Provider credential is unavailable", 503);
    }
    throw error;
  }
}

function credentialEnvelopeUsable(credential: CredentialRow | null) {
  if (!credential || credential.status !== "connected") return false;
  try {
    const bundle = decryptTokenBundle(credential, {
      providerId: credential.envelope_context_id,
      adapterKind: credential.adapter_kind,
      recordId: credential.id,
      revision: credential.revision,
    });
    return bundle.product === credential.adapter_kind;
  } catch {
    return false;
  }
}

async function defaultRegistry(): Promise<ProviderProductRegistry> {
  return getProviderProductRegistry();
}

async function dependencies(input: ManagedAuthDependencies = {}) {
  return {
    registry: input.registry ?? await defaultRegistry(),
    now: input.now ?? (() => new Date()),
    createId: input.createId ?? createPlatformId,
    createLeaseId: input.createLeaseId ?? randomUUID,
    withClient: input.withClient ?? withPlatformClient,
    withTransaction: input.withTransaction ?? withPlatformTransaction,
    discoverModels: input.discoverModels ?? discoverProviderModels,
  };
}

function asDate(value: Date | string | null | undefined) {
  if (!value) return null;
  const parsed = value instanceof Date ? value : new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function iso(value: Date | string | null | undefined) {
  return asDate(value)?.toISOString() ?? null;
}

function isManagedAdapter(value: string): value is ManagedAdapterKind {
  return MANAGED_ADAPTER_KINDS.includes(value as ManagedAdapterKind);
}

function requireManagedProvider(provider: ProviderRow) {
  if (!isManagedAdapter(provider.adapter_kind)) {
    throw new AdminError(
      "PROVIDER_MANAGED_AUTH_NOT_SUPPORTED",
      "This Provider uses a static API credential",
      409,
    );
  }
  return provider.adapter_kind;
}

async function loadProvider(client: PoolClient, providerId: string, forUpdate = false) {
  const result = await client.query<ProviderRow>(
    `SELECT id, code, name, status, adapter_kind, active_credential_kind, auth_epoch,
            managed_credential_id
       FROM ai_providers
      WHERE id = $1 AND status <> 'deleted'${forUpdate ? " FOR UPDATE" : ""}`,
    [providerId],
  );
  if (!result.rows[0]) {
    throw new AdminError(
      "ADMIN_RESOURCE_ITEM_NOT_FOUND",
      "The requested Provider does not exist",
      404,
    );
  }
  return result.rows[0];
}

async function loadCredentialOwner(
  client: PoolClient,
  providerId: string | null,
) {
  if (!providerId) return null;
  const result = await client.query<CredentialOwnerRow>(
    `SELECT id, code, name, status, adapter_kind, active_credential_kind, auth_epoch,
            managed_credential_id
       FROM ai_providers
      WHERE id = $1
      FOR UPDATE`,
    [providerId],
  );
  return result.rows[0] ?? null;
}

async function lockManagedProvider(
  client: PoolClient,
  providerId: string,
) {
  await client.query(
    "SELECT pg_advisory_xact_lock(hashtextextended($1, 0))",
    [`provider-managed-auth:${providerId}`],
  );
}

async function loadAccount(
  client: PoolClient,
  providerId: string,
  adapterKind: ManagedAdapterKind,
  accountId: string,
  forUpdate = false,
) {
  const result = await client.query<CredentialRow>(
    `SELECT * FROM ai_provider_managed_credentials
      WHERE provider_id = $1 AND adapter_kind = $2 AND id = $3${forUpdate ? " FOR UPDATE" : ""}`,
    [providerId, adapterKind, accountId],
  );
  return result.rows[0] ?? null;
}

async function loadResolvedAccount(
  client: PoolClient,
  provider: ProviderRow,
  forUpdate = false,
) {
  const adapterKind = requireManagedProvider(provider);
  return provider.managed_credential_id
    ? await loadAccount(
        client,
        provider.id,
        adapterKind,
        provider.managed_credential_id,
        forUpdate,
      )
    : null;
}

async function loadLatestAttempt(client: PoolClient, providerId: string) {
  const result = await client.query<AttemptRow>(
    `SELECT * FROM ai_provider_auth_attempts
      WHERE provider_id = $1
      ORDER BY created_at DESC, id DESC LIMIT 1`,
    [providerId],
  );
  return result.rows[0] ?? null;
}

async function loadAttempt(client: PoolClient, attemptId: string, forUpdate = false) {
  const result = await client.query<AttemptRow>(
    `SELECT * FROM ai_provider_auth_attempts
      WHERE id = $1${forUpdate ? " FOR UPDATE" : ""}`,
    [attemptId],
  );
  if (!result.rows[0]) {
    throw new AdminError(
      "PROVIDER_AUTH_ATTEMPT_NOT_FOUND",
      "The managed authentication attempt does not exist",
      404,
    );
  }
  return result.rows[0];
}

async function loadAttemptForPollUpdate(client: PoolClient, attemptId: string) {
  const result = await client.query<AttemptRow>(
    `SELECT *,
            (expires_at IS NULL OR expires_at <= NOW()) AS poll_deadline_expired,
            (next_poll_at IS NOT NULL AND next_poll_at > NOW()) AS poll_too_early,
            (operation_lease_id IS NOT NULL
              AND operation_lease_expires_at IS NOT NULL
              AND operation_lease_expires_at > NOW()) AS poll_lease_active
       FROM ai_provider_auth_attempts
      WHERE id = $1
      FOR UPDATE`,
    [attemptId],
  );
  if (!result.rows[0]) {
    throw new AdminError(
      "PROVIDER_AUTH_ATTEMPT_NOT_FOUND",
      "The managed authentication attempt does not exist",
      404,
    );
  }
  return result.rows[0];
}

function credentialProjection(credential: CredentialRow | null) {
  if (!credential) return null;
  return {
    id: credential.id,
    accountId: credential.id,
    credentialId: credential.id,
    adapterKind: credential.adapter_kind,
    status: credential.status,
    authEpoch: credential.auth_epoch,
    revision: credential.revision,
    displayName: credential.display_name,
    accountLabel: credential.account_label,
    grantedScopes: credential.granted_scopes ?? [],
    accessExpiresAt: iso(credential.access_expires_at),
    refreshExpiresAt: iso(credential.refresh_expires_at),
    sessionExpiresAt: iso(credential.session_expires_at),
    registrationFingerprint: credential.registration_fingerprint,
    revocationStatus: credential.revocation_status,
    registrationCurrent: undefined,
    usable: undefined,
    disconnectedAt: iso(credential.disconnected_at),
    updatedAt: iso(credential.updated_at),
  };
}

function attemptProjection(
  attempt: AttemptRow | null,
  flow?: DeviceFlowState | null,
  currentAdminId?: string,
) {
  if (!attempt) return null;
  const ownsAttempt = currentAdminId === undefined
    || attempt.created_by_admin_id === currentAdminId;
  return {
    id: attempt.id,
    status: attempt.status,
    revision: attempt.revision,
    expectedAuthEpoch: attempt.expected_auth_epoch,
    targetAccountId: attempt.target_credential_id,
    userCode: attempt.status === "pending" && ownsAttempt ? flow?.userCode ?? null : null,
    verificationUri: attempt.status === "pending" && ownsAttempt
      ? attempt.verification_uri
      : null,
    verificationUriComplete:
      attempt.status === "pending" && ownsAttempt
        ? flow?.verificationUriComplete ?? null
        : null,
    expiresAt: iso(attempt.expires_at),
    nextPollAt: iso(attempt.next_poll_at),
    pollIntervalSeconds: attempt.poll_interval_seconds,
    operationLeaseExpiresAt: iso(attempt.operation_lease_expires_at),
    failureCode: attempt.failure_code,
    ownedByCurrentAdmin:
      currentAdminId === undefined
        ? undefined
        : ownsAttempt,
    createdAt: iso(attempt.created_at),
    updatedAt: iso(attempt.updated_at),
  };
}

function openAttemptFlow(attempt: AttemptRow | null) {
  if (!attempt || attempt.status !== "pending" || !attempt.bundle_ciphertext) return null;
  return decryptAttemptFlow(attempt, {
    providerId: attempt.envelope_context_id,
    adapterKind: attempt.adapter_kind,
    recordId: attempt.id,
    revision: attempt.revision,
  });
}

function encryptionReady() {
  try {
    getCredentialEncryptionKey();
    return true;
  } catch {
    return false;
  }
}

function identityPepperReady() {
  try {
    accountIdentityPepper();
    return true;
  } catch {
    return false;
  }
}

async function effectiveReadiness(
  registry: ProviderProductRegistry,
  adapterKind: ManagedAdapterKind,
) {
  const upstream = registry.readiness(adapterKind);
  const keyReady = encryptionReady();
  const pepperReady = identityPepperReady();
  const ready = upstream.status === "ready";
  return {
    codeSupported: true,
    clientRegistrationConfigured: upstream.oauthAppConfigured,
    integrationProfileConfigured:
      upstream.integrationProfileConfigured ?? true,
    endpointPolicyValid: ready || upstream.status === "not_configured",
    encryptionKeyReady: keyReady,
    identityPepperReady: pepperReady,
    effective: ready && keyReady && pepperReady,
    registrationFingerprint: upstream.registrationFingerprint,
    reasons: [
      ...(ready ? [] : [upstream.error.code, ...upstream.missingFields]),
      ...(!keyReady ? ["CREDENTIAL_ENCRYPTION_KEY_UNAVAILABLE"] : []),
      ...(!pepperReady ? ["ACCOUNT_IDENTITY_PEPPER_UNAVAILABLE"] : []),
    ],
  };
}

function requireEffectiveReadiness(
  readiness: Awaited<ReturnType<typeof effectiveReadiness>>,
) {
  if (!readiness.effective || !readiness.registrationFingerprint) {
    throw new AdminError(
      "PROVIDER_MANAGED_AUTH_DEPLOYMENT_UNAVAILABLE",
      "Managed authentication code is available, but this deployment is not ready for the selected product",
      503,
      {
        codeSupported: readiness.codeSupported,
        clientRegistrationConfigured: readiness.clientRegistrationConfigured,
        integrationProfileConfigured: readiness.integrationProfileConfigured,
        encryptionKeyReady: readiness.encryptionKeyReady,
        identityPepperReady: readiness.identityPepperReady,
        endpointPolicyValid: readiness.endpointPolicyValid,
      },
    );
  }
}

async function parseJson<T>(request: Request, schema: z.ZodType<T>) {
  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    throw new AdminError("ADMIN_INVALID_JSON", "The request body must be valid JSON", 400);
  }
  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    throw new AdminError(
      "ADMIN_VALIDATION_FAILED",
      "The managed authentication request is invalid",
      400,
      parsed.error.issues.map((issue) => ({ path: issue.path, message: issue.message })),
    );
  }
  return parsed.data;
}

function safeFailureCode(value: unknown, fallback: string) {
  if (
    typeof value === "string" &&
    /^[A-Z][A-Z0-9_]{2,80}$/.test(value)
  ) return value;
  return fallback;
}

function identityCanonical(adapterKind: ManagedAdapterKind, bundle: ProviderTokenBundle) {
  if (bundle.product !== adapterKind) {
    throw new AdminError(
      "PROVIDER_MANAGED_AUTH_PRODUCT_MISMATCH",
      "The managed credential belongs to a different product adapter",
      502,
    );
  }
  if (adapterKind === "codex") {
    if (bundle.product !== "codex") throw new Error("unreachable");
    const subject = bundle.identity.subject.trim();
    const account = bundle.identity.chatgptAccountId.trim();
    if (!subject || !account) {
      throw new AdminError(
        "PROVIDER_MANAGED_AUTH_IDENTITY_INVALID",
        "Codex authorization did not return a stable user and ChatGPT account identity",
        502,
      );
    }
    return canonicalJson({ subject, chatgptAccountId: account });
  }
  if (adapterKind === "xai") {
    if (bundle.product !== "xai") throw new Error("unreachable");
    const subject = bundle.identity.subject.trim();
    if (!subject) {
      throw new AdminError(
        "PROVIDER_MANAGED_AUTH_IDENTITY_INVALID",
        "xAI authorization did not return a stable subject",
        502,
      );
    }
    return canonicalJson({ subject });
  }
  if (bundle.product !== "github_copilot") throw new Error("unreachable");
  const numericId = String(bundle.identity.numericId);
  if (!numericId || !/^\d+$/.test(numericId)) {
    throw new AdminError(
      "PROVIDER_MANAGED_AUTH_IDENTITY_INVALID",
      "GitHub authorization did not return a stable numeric account identity",
      502,
    );
  }
  return canonicalJson({ host: "github.com", numericId });
}

function assertIdentityContinuity(
  adapterKind: ManagedAdapterKind,
  current: CredentialRow | null,
  nextBundle: ProviderTokenBundle,
) {
  const nextCanonical = identityCanonical(adapterKind, nextBundle);
  if (!current || !["connected", "reauth_required"].includes(current.status)) {
    return nextCanonical;
  }
  const currentBundle = decryptTokenBundle(current, {
    providerId: current.envelope_context_id,
    adapterKind: current.adapter_kind,
    recordId: current.id,
    revision: current.revision,
  });
  if (identityCanonical(adapterKind, currentBundle) !== nextCanonical) {
    throw new AdminError(
      "PROVIDER_MANAGED_AUTH_ACCOUNT_MISMATCH",
      "Reauthorization must use the account already bound to this Provider; disconnect first to change accounts",
      409,
    );
  }
  return nextCanonical;
}

function accountLabel(bundle: ProviderTokenBundle) {
  return bundle.product === "github_copilot"
    ? bundle.identity.login.trim().slice(0, 240)
    : null;
}

function grantedScopesProjection(bundle: ProviderTokenBundle) {
  return [...bundle.grantedScopes];
}

async function auditTransition(
  client: PoolClient,
  input: {
    identity: AdminIdentity;
    action: string;
    providerId: string;
    attemptId?: string;
    adapterKind: ManagedAdapterKind;
    requestId: string;
    request: Request;
    beforeStatus?: string | null;
    afterStatus?: string | null;
    metadata?: Record<string, unknown>;
  },
) {
  await recordAdminAuditOnClient(client, {
    identity: input.identity,
    action: input.action,
    resourceType: "provider_managed_auth",
    resourceId: input.providerId,
    requestId: input.requestId,
    request: input.request,
    before: input.beforeStatus ? { status: input.beforeStatus } : undefined,
    after: input.afterStatus ? { status: input.afterStatus } : undefined,
    metadata: {
      adapterKind: input.adapterKind,
      ...(input.attemptId ? { attemptId: input.attemptId } : {}),
      ...(input.metadata ?? {}),
    },
  });
}

async function bestEffortRevoke(
  registry: ProviderProductRegistry,
  adapterKind: ManagedAdapterKind,
  material: ReturnType<typeof revocationMaterialFromBundle>,
) {
  try {
    await registry.get(adapterKind).revoke(material);
  } catch {
    // The durable outbox is preferred; this only limits exposure if persistence is unavailable.
  }
}

async function recordRejectedGrant(
  deps: Awaited<ReturnType<typeof dependencies>>,
  input: {
    claimed: ClaimedPoll;
    material: ReturnType<typeof revocationMaterialFromBundle>;
    failureCode: string;
    action: string;
    identity: AdminIdentity;
    requestId: string;
    request: Request;
  },
) {
  let jobId: string;
  try {
    jobId = await deps.withTransaction(async (client) => {
      const job = await enqueueProviderRevocationJobOnClient(client, {
        providerId: input.claimed.provider.id,
        adapterKind: input.claimed.attempt.adapter_kind,
        sourceKind: "attempt",
        sourceRecordId: input.claimed.attempt.id,
        sourceRecordRevision: input.claimed.attempt.revision,
        sourceAuthEpoch: input.claimed.attempt.expected_auth_epoch,
        reason: "activation_rejected",
        registrationFingerprint: input.claimed.attempt.registration_fingerprint,
        material: input.material,
      });
      return job.id;
    });
  } catch (error) {
    await bestEffortRevoke(
      deps.registry,
      input.claimed.attempt.adapter_kind,
      input.material,
    );
    throw error;
  }
  try {
    await deps.withTransaction(async (client) => {
      await markAttemptFailure(client, {
        attemptId: input.claimed.attempt.id,
        expectedStatus: "pending",
        expectedRevision: input.claimed.attempt.revision,
        failureCode: input.failureCode,
        leaseId: input.claimed.leaseId,
      });
      await auditTransition(client, {
        identity: input.identity,
        action: input.action,
        providerId: input.claimed.provider.id,
        attemptId: input.claimed.attempt.id,
        adapterKind: input.claimed.attempt.adapter_kind,
        requestId: input.requestId,
        request: input.request,
        beforeStatus: "pending",
        afterStatus: "failed",
        metadata: { failureCode: input.failureCode, revocationJobId: jobId },
      });
    });
  } catch {
    await deps.withTransaction(async (client) => {
      await auditTransition(client, {
        identity: input.identity,
        action: "managed_auth_grant_rejected_after_stale_attempt",
        providerId: input.claimed.provider.id,
        attemptId: input.claimed.attempt.id,
        adapterKind: input.claimed.attempt.adapter_kind,
        requestId: input.requestId,
        request: input.request,
        beforeStatus: "pending",
        afterStatus: "failed",
        metadata: { failureCode: input.failureCode, revocationJobId: jobId },
      });
    }).catch(() => undefined);
  }
  await processProviderRevocationJob(jobId, {
    registry: deps.registry,
    withTransaction: deps.withTransaction,
    createLeaseId: deps.createLeaseId,
    force: true,
  }).catch(() => undefined);
  return jobId;
}

async function markAttemptFailure(
  client: PoolClient,
  input: {
    attemptId: string;
    expectedStatus: "starting" | "pending";
    expectedRevision: number;
    failureCode: string;
    leaseId?: string;
  },
) {
  const values: unknown[] = [
    input.attemptId,
    input.expectedStatus,
    input.expectedRevision,
    input.failureCode,
  ];
  const lease = input.leaseId
    ? ` AND operation_lease_id = $${values.push(input.leaseId)}`
    : "";
  const result = await client.query(
    `UPDATE ai_provider_auth_attempts
        SET status = 'failed', revision = revision + 1,
            failure_code = $4, consumed_at = NOW(),
            bundle_format_version = NULL, bundle_key_id = NULL,
            bundle_ciphertext = NULL, bundle_nonce = NULL, bundle_tag = NULL,
            operation_lease_id = NULL, operation_lease_expires_at = NULL,
            updated_at = NOW()
      WHERE id = $1 AND status = $2 AND revision = $3${lease}`,
    values,
  );
  if (result.rowCount !== 1) {
    throw new AdminError(
      "PROVIDER_AUTH_ATTEMPT_STALE",
      "The authorization attempt changed before the failure transition committed",
      409,
    );
  }
}

export async function handleProviderManagedAuthStatus(
  request: Request,
  providerId: string,
  inputDependencies: ManagedAuthDependencies = {},
) {
  const requestId = adminRequestId(request);
  try {
    const identity = await requireAdminRequest(request, "providers.read");
    const deps = await dependencies(inputDependencies);
    const state = await deps.withClient(async (client) => {
      const provider = await loadProvider(client, providerId);
      const adapterKind = requireManagedProvider(provider);
      const [credential, attempt, revocationJob] = await Promise.all([
        loadResolvedAccount(client, provider),
        loadLatestAttempt(client, providerId),
        loadLatestProviderRevocationJobOnClient(client, providerId),
      ]);
      return {
        provider,
        adapterKind,
        credential,
        attempt,
        revocationJob,
      };
    });
    const readiness = await effectiveReadiness(deps.registry, state.adapterKind);
    const flow = readiness.encryptionKeyReady
      && state.attempt?.created_by_admin_id === identity.id
      ? openAttemptFlow(state.attempt)
      : null;
    const credentialStoredConnected = state.credential?.status === "connected";
    const credentialRegistrationCurrent = credentialStoredConnected
      && Boolean(readiness.registrationFingerprint)
      && state.credential?.registration_fingerprint === readiness.registrationFingerprint;
    const credentialUsable = readiness.encryptionKeyReady
      && credentialRegistrationCurrent
      && credentialEnvelopeUsable(state.credential);
    const credentialConnected = credentialStoredConnected
      && credentialRegistrationCurrent
      && credentialUsable;
    const gatewayEffective = readiness.effective
      && credentialConnected
      && state.provider.status === "active"
      && state.provider.active_credential_kind === "managed_oauth";
    return Response.json(
      {
        data: {
          provider: {
            id: state.provider.id,
            adapterKind: state.adapterKind,
            status: state.provider.status,
            activeCredentialKind: state.provider.active_credential_kind,
            authEpoch: state.provider.auth_epoch,
          },
          readiness: {
            ...readiness,
            authorizationReady: readiness.effective,
            credentialConnected,
            credentialRegistrationCurrent,
            credentialUsable,
            copilotAccessVerified: state.adapterKind === "github_copilot"
              ? credentialConnected
              : undefined,
            effective: gatewayEffective,
            reasons: [
              ...(readiness.reasons ?? []),
              ...(credentialStoredConnected && !credentialRegistrationCurrent
                ? ["REGISTRATION_CHANGED"]
                : []),
              ...(credentialStoredConnected && credentialRegistrationCurrent && !credentialUsable
                ? ["CREDENTIAL_ENVELOPE_UNAVAILABLE"]
                : []),
            ],
          },
          accounts: state.credential
            ? [{
                ...credentialProjection(state.credential)!,
                registrationCurrent: credentialRegistrationCurrent,
                usable: credentialUsable,
              }]
            : [],
          defaultAccount: null,
          binding: {
            mode: "pinned",
            accountId: state.credential?.id ?? null,
            managedCredentialId: state.credential?.id ?? null,
            providerAuthEpoch: state.provider.auth_epoch,
          },
          resolvedAccount: credentialProjection(state.credential),
          credential: credentialProjection(state.credential),
          attempt: attemptProjection(state.attempt, flow, identity.id),
          revocation: revocationJobProjection(state.revocationJob),
        },
      },
      { headers: { "cache-control": "no-store", "x-request-id": requestId } },
    );
  } catch (error) {
    return adminErrorResponse(error, requestId);
  }
}

export async function handleProviderManagedAuthStart(
  request: Request,
  providerId: string,
  inputDependencies: ManagedAuthDependencies = {},
) {
  const requestId = adminRequestId(request);
  try {
    assertAdminMutationOrigin(request);
    const identity = await requireAdminRequest(request, "providers.write");
    const body = await parseJson(request, startBodySchema);
    const deps = await dependencies(inputDependencies);

    const initial = await deps.withClient(async (client) => {
      const provider = await loadProvider(client, providerId);
      return { provider, adapterKind: requireManagedProvider(provider) };
    });
    const readiness = await effectiveReadiness(deps.registry, initial.adapterKind);
    requireEffectiveReadiness(readiness);
    const registrationFingerprint = readiness.registrationFingerprint!;
    const idempotencyHash = sha256(body.idempotencyKey);
    const canonicalHash = sha256(canonicalJson({
      action: "start",
      providerId,
      adapterKind: initial.adapterKind,
      expectedAuthEpoch: body.expectedAuthEpoch,
      targetAccountId: body.targetAccountId ?? null,
      expectedAccountEpoch: body.expectedAccountEpoch ?? null,
      registrationFingerprint,
    }));

    const staged = await deps.withTransaction(async (client) => {
      const provider = await loadProvider(client, providerId, true);
      const adapterKind = requireManagedProvider(provider);
      if (adapterKind !== initial.adapterKind) {
        throw new AdminError("PROVIDER_ADAPTER_CHANGED", "The Provider adapter changed", 409);
      }
      if (provider.auth_epoch !== body.expectedAuthEpoch) {
        throw new AdminError(
          "PROVIDER_AUTH_EPOCH_STALE",
          "The Provider authentication state changed; reload before starting authorization",
          409,
          { currentAuthEpoch: provider.auth_epoch },
        );
      }
      let targetAccount: CredentialRow | null = null;
      if (!provider.managed_credential_id && body.targetAccountId) {
        throw new AdminError(
          "PROVIDER_MANAGED_ACCOUNT_NOT_OWNED",
          "The requested credential is not owned by this Provider",
          409,
        );
      }
      if (provider.managed_credential_id && !body.targetAccountId) {
        throw new AdminError(
          "PROVIDER_MANAGED_ACCOUNT_ALREADY_CONNECTED",
          "This Provider already has a managed account; reauthorize that account explicitly",
          409,
          { accountId: provider.managed_credential_id },
        );
      }
      if (provider.managed_credential_id && body.targetAccountId) {
        if (provider.managed_credential_id !== body.targetAccountId) {
          throw new AdminError(
            "PROVIDER_MANAGED_ACCOUNT_NOT_OWNED",
            "The requested credential is not owned by this Provider",
            409,
          );
        }
        targetAccount = await loadAccount(
          client,
          provider.id,
          adapterKind,
          body.targetAccountId,
          true,
        );
        if (!targetAccount || targetAccount.status === "disconnected") {
          throw new AdminError(
            "PROVIDER_MANAGED_ACCOUNT_OWNERSHIP_INVALID",
            "The Provider credential pointer does not reference a live owned credential",
            409,
          );
        }
        if (targetAccount.auth_epoch !== body.expectedAccountEpoch) {
          throw new AdminError(
            "PROVIDER_MANAGED_ACCOUNT_EPOCH_STALE",
            "The Provider account changed; reload before reauthorizing",
            409,
            { currentAccountEpoch: targetAccount.auth_epoch },
          );
        }
      }
      const existing = await client.query<AttemptRow>(
        `SELECT * FROM ai_provider_auth_attempts
          WHERE provider_id = $1 AND adapter_kind = $2
            AND expected_auth_epoch = $3 AND idempotency_key_hash = $4
          LIMIT 1`,
        [providerId, adapterKind, provider.auth_epoch, idempotencyHash],
      );
      if (existing.rows[0]) {
        if (existing.rows[0].created_by_admin_id !== identity.id) {
          throw new AdminError(
            "PROVIDER_AUTH_IDEMPOTENCY_ACTOR_MISMATCH",
            "The Idempotency-Key belongs to another administrator",
            409,
          );
        }
        if (existing.rows[0].request_canonical_hash !== canonicalHash) {
          throw new AdminError(
            "PROVIDER_AUTH_IDEMPOTENCY_CONFLICT",
            "The Idempotency-Key was already used for a different authorization request",
            409,
          );
        }
        return { provider, adapterKind, attempt: existing.rows[0], reused: true as const };
      }

      await client.query(
        `UPDATE ai_provider_auth_attempts
            SET status = 'cancelled', revision = revision + 1,
                failure_code = 'SUPERSEDED', consumed_at = NOW(),
                bundle_format_version = NULL, bundle_key_id = NULL,
                bundle_ciphertext = NULL, bundle_nonce = NULL, bundle_tag = NULL,
                operation_lease_id = NULL, operation_lease_expires_at = NULL,
                updated_at = NOW()
          WHERE provider_id = $1 AND expected_auth_epoch = $2
            AND status IN ('starting', 'pending')`,
        [providerId, provider.auth_epoch],
      );
      const attemptId = deps.createId("authattempt");
      const startLeaseId = deps.createLeaseId();
      let inserted: Awaited<ReturnType<PoolClient["query"]>>;
      try {
        inserted = await client.query<AttemptRow>(
          `INSERT INTO ai_provider_auth_attempts (
           id, provider_id, adapter_kind, flow_kind, status,
           expected_auth_epoch, target_credential_id,
           expected_credential_auth_epoch, expected_credential_revision,
           envelope_context_id, revision, idempotency_key_hash,
           request_canonical_hash, state_hash, registration_fingerprint,
           created_by_admin_id, operation_lease_id, operation_lease_expires_at
         ) VALUES ($1, $2, $3, 'device_code', 'starting', $4, $5, $6, $7,
                   $1, 1, $8, $9, NULL, $10, $11,
                   $12, NOW() + ($13 * interval '1 millisecond'))
         RETURNING *`,
          [
            attemptId,
            providerId,
            adapterKind,
            provider.auth_epoch,
            targetAccount?.id ?? null,
            targetAccount?.auth_epoch ?? null,
            targetAccount?.revision ?? null,
            idempotencyHash,
            canonicalHash,
            registrationFingerprint,
            identity.id,
            startLeaseId,
            START_LEASE_MILLISECONDS,
          ],
        );
      } catch (error) {
        if (
          error && typeof error === "object"
          && "code" in error && error.code === "23505"
          && "constraint" in error
          && error.constraint === "ai_provider_auth_attempts_target_active_uidx"
        ) {
          throw new AdminError(
            "PROVIDER_MANAGED_ACCOUNT_AUTH_IN_PROGRESS",
            "Another authorization attempt is already updating this product account",
            409,
          );
        }
        throw error;
      }
      await auditTransition(client, {
        identity,
        action: "managed_auth_start",
        providerId,
        attemptId,
        adapterKind,
        requestId,
        request,
        afterStatus: "starting",
        metadata: { expectedAuthEpoch: provider.auth_epoch },
      });
      return { provider, adapterKind, attempt: inserted.rows[0], reused: false as const };
    });

    if (staged.reused) {
      const flow = openAttemptFlow(staged.attempt);
      return Response.json(
        { data: { ...attemptProjection(staged.attempt, flow), reused: true } },
        { headers: { "cache-control": "no-store", "x-request-id": requestId } },
      );
    }

    let started: Awaited<ReturnType<ProviderProductAdapter["startDevice"]>>;
    try {
      started = await deps.registry.get(staged.adapterKind).startDevice();
    } catch (error) {
      const failureCode = safeFailureCode(
        error && typeof error === "object" && "code" in error ? error.code : null,
        "UPSTREAM_START_FAILED",
      );
      await deps.withTransaction(async (client) => {
        await markAttemptFailure(client, {
          attemptId: staged.attempt.id,
          expectedStatus: "starting",
          expectedRevision: staged.attempt.revision,
          failureCode,
        });
        await auditTransition(client, {
          identity,
          action: "managed_auth_start_failed",
          providerId,
          attemptId: staged.attempt.id,
          adapterKind: staged.adapterKind,
          requestId,
          request,
          beforeStatus: "starting",
          afterStatus: "failed",
          metadata: { failureCode },
        });
      });
      throw new AdminError(
        failureCode,
        "The upstream Device authorization flow could not be started",
        502,
      );
    }

    if (started.status === "failed") {
      const failureCode = safeFailureCode(started.error.code, "UPSTREAM_START_FAILED");
      await deps.withTransaction(async (client) => {
        await markAttemptFailure(client, {
          attemptId: staged.attempt.id,
          expectedStatus: "starting",
          expectedRevision: staged.attempt.revision,
          failureCode,
        });
        await auditTransition(client, {
          identity,
          action: "managed_auth_start_failed",
          providerId,
          attemptId: staged.attempt.id,
          adapterKind: staged.adapterKind,
          requestId,
          request,
          beforeStatus: "starting",
          afterStatus: "failed",
          metadata: { failureCode },
        });
      });
      throw new AdminError(
        failureCode,
        "The upstream Device authorization flow could not be started",
        started.error.httpStatus ?? 502,
      );
    }
    const nextRevision = staged.attempt.revision + 1;
    const envelope = encryptAttemptFlow(started.flow, {
      providerId: staged.attempt.envelope_context_id,
      adapterKind: staged.adapterKind,
      recordId: staged.attempt.id,
      revision: nextRevision,
    });
    const completed = await deps.withTransaction(async (client) => {
      const result = await client.query<AttemptRow>(
        `UPDATE ai_provider_auth_attempts AS attempt
            SET status = 'pending', revision = $4, state_hash = NULL,
                bundle_format_version = $5, bundle_key_id = $6,
                bundle_ciphertext = $7, bundle_nonce = $8, bundle_tag = $9,
                verification_uri = $10,
                expires_at = NOW() + ($11 * interval '1 second'),
                poll_interval_seconds = $12::integer,
                next_poll_at = NOW() + ($12::integer * interval '1 second'),
                operation_lease_id = NULL, operation_lease_expires_at = NULL,
                updated_at = NOW()
           FROM ai_providers AS provider
          WHERE attempt.id = $1 AND attempt.provider_id = provider.id
            AND attempt.status = 'starting' AND attempt.revision = $2
            AND attempt.expected_auth_epoch = $3
            AND provider.auth_epoch = attempt.expected_auth_epoch
            AND attempt.registration_fingerprint = $13
          RETURNING attempt.*`,
        [
          staged.attempt.id,
          staged.attempt.revision,
          staged.attempt.expected_auth_epoch,
          nextRevision,
          envelope.formatVersion,
          envelope.keyId,
          envelope.ciphertext,
          envelope.nonce,
          envelope.tag,
          started.flow.verificationUri,
          started.flow.expiresInSeconds,
          started.flow.intervalSeconds,
          registrationFingerprint,
        ],
      );
      if (!result.rows[0]) {
        throw new AdminError(
          "PROVIDER_AUTH_ATTEMPT_STALE",
          "The Device authorization attempt was cancelled before it became active",
          409,
        );
      }
      await auditTransition(client, {
        identity,
        action: "managed_auth_pending",
        providerId,
        attemptId: staged.attempt.id,
        adapterKind: staged.adapterKind,
        requestId,
        request,
        beforeStatus: "starting",
        afterStatus: "pending",
      });
      return result.rows[0];
    });
    return Response.json(
      { data: { ...attemptProjection(completed, started.flow), reused: false } },
      {
        status: 201,
        headers: { "cache-control": "no-store", "x-request-id": requestId },
      },
    );
  } catch (error) {
    return adminErrorResponse(error, requestId);
  }
}

type ClaimedPoll = {
  claim: "acquired";
  attempt: AttemptRow;
  provider: ProviderRow;
  flow: DeviceFlowState;
  leaseId: string;
};

type ExpiredPoll = {
  claim: "expired";
  attempt: AttemptRow;
  provider: ProviderRow;
};

async function claimPoll(
  client: PoolClient,
  input: {
    attemptId: string;
    expectedRevision: number;
    identity: AdminIdentity;
    leaseId: string;
    requestId: string;
    request: Request;
  },
): Promise<ClaimedPoll | ExpiredPoll> {
  const discoveredAttempt = await loadAttempt(client, input.attemptId);
  const provider = await loadProvider(client, discoveredAttempt.provider_id, true);
  const attempt = await loadAttemptForPollUpdate(client, input.attemptId);
  if (attempt.provider_id !== provider.id) {
    throw new AdminError(
      "PROVIDER_AUTH_ATTEMPT_STALE",
      "The authorization attempt changed while acquiring its Provider lock",
      409,
    );
  }
  requireManagedProvider(provider);
  if (attempt.created_by_admin_id !== input.identity.id) {
    throw new AdminError(
      "PROVIDER_AUTH_ATTEMPT_ACTOR_MISMATCH",
      "Only the administrator who started this authorization attempt may poll it",
      403,
    );
  }
  if (attempt.status !== "pending") {
    throw new AdminError(
      "PROVIDER_AUTH_ATTEMPT_TERMINAL",
      "The authorization attempt is no longer pending",
      409,
      { status: attempt.status },
    );
  }
  if (attempt.revision !== input.expectedRevision) {
    throw new AdminError(
      "PROVIDER_AUTH_ATTEMPT_REVISION_STALE",
      "The authorization attempt changed; reload its current status",
      409,
      { currentRevision: attempt.revision },
    );
  }
  if (attempt.expected_auth_epoch !== provider.auth_epoch) {
    throw new AdminError(
      "PROVIDER_AUTH_EPOCH_STALE",
      "The Provider authentication state changed",
      409,
    );
  }
  if (attempt.target_credential_id) {
    const target = await loadAccount(
      client,
      provider.id,
      attempt.adapter_kind,
      attempt.target_credential_id,
      true,
    );
    if (
      !target
      || target.status === "disconnected"
      || target.auth_epoch !== attempt.expected_credential_auth_epoch
      || target.revision !== attempt.expected_credential_revision
    ) {
      throw new AdminError(
        "PROVIDER_MANAGED_ACCOUNT_STALE",
        "The target account changed before authorization completed",
        409,
      );
    }
  }
  if (attempt.poll_deadline_expired) {
    const expired = await client.query<AttemptRow>(
      `UPDATE ai_provider_auth_attempts
          SET status = 'expired', revision = revision + 1,
              failure_code = 'DEVICE_FLOW_EXPIRED', consumed_at = NOW(),
              bundle_format_version = NULL, bundle_key_id = NULL,
              bundle_ciphertext = NULL, bundle_nonce = NULL, bundle_tag = NULL,
              operation_lease_id = NULL, operation_lease_expires_at = NULL,
              updated_at = NOW()
        WHERE id = $1 AND status = 'pending' AND revision = $2
          AND (expires_at IS NULL OR expires_at <= NOW())
        RETURNING *`,
      [attempt.id, attempt.revision],
    );
    if (!expired.rows[0]) {
      throw new AdminError(
        "PROVIDER_AUTH_ATTEMPT_STALE",
        "The authorization attempt changed before expiry committed",
        409,
      );
    }
    await auditTransition(client, {
      identity: input.identity,
      action: "managed_auth_expired",
      providerId: provider.id,
      attemptId: attempt.id,
      adapterKind: attempt.adapter_kind,
      requestId: input.requestId,
      request: input.request,
      beforeStatus: "pending",
      afterStatus: "expired",
      metadata: { failureCode: "DEVICE_FLOW_EXPIRED" },
    });
    return { claim: "expired", attempt: expired.rows[0], provider };
  }
  if (attempt.poll_too_early) {
    throw new AdminError(
      "PROVIDER_AUTH_POLL_TOO_EARLY",
      "Wait until the next allowed poll time",
      429,
      { nextPollAt: iso(attempt.next_poll_at) },
    );
  }
  if (attempt.poll_lease_active) {
    throw new AdminError(
      "PROVIDER_AUTH_POLL_IN_PROGRESS",
      "Another poll is already in progress",
      409,
    );
  }
  const flow = openAttemptFlow(attempt);
  if (!flow) {
    throw new AdminError(
      "PROVIDER_MANAGED_AUTH_BUNDLE_UNAVAILABLE",
      "The pending Device authorization state is unavailable",
      503,
    );
  }
  const claimed = await client.query<AttemptRow>(
    `UPDATE ai_provider_auth_attempts
        SET operation_lease_id = $3,
            operation_lease_expires_at = NOW() + ($4 * interval '1 millisecond'),
            updated_at = NOW()
      WHERE id = $1 AND status = 'pending' AND revision = $2
        AND expires_at > NOW() AND next_poll_at <= NOW()
        AND (operation_lease_expires_at IS NULL OR operation_lease_expires_at <= NOW())
      RETURNING *`,
    [
      attempt.id,
      attempt.revision,
      input.leaseId,
      POLL_LEASE_MILLISECONDS,
    ],
  );
  if (!claimed.rows[0]) {
    throw new AdminError(
      "PROVIDER_AUTH_POLL_IN_PROGRESS",
      "Another poll acquired this authorization attempt",
      409,
    );
  }
  return {
    claim: "acquired",
    attempt: claimed.rows[0],
    provider,
    flow,
    leaseId: input.leaseId,
  };
}

async function updatePendingPoll(
  client: PoolClient,
  input: {
    claimed: ClaimedPoll;
    intervalSeconds: number;
  },
) {
  const nextRevision = input.claimed.attempt.revision + 1;
  const envelope = encryptAttemptFlow(input.claimed.flow, {
    providerId: input.claimed.attempt.envelope_context_id,
    adapterKind: input.claimed.attempt.adapter_kind,
    recordId: input.claimed.attempt.id,
    revision: nextRevision,
  });
  const result = await client.query<AttemptRow>(
    `UPDATE ai_provider_auth_attempts AS attempt
        SET revision = $5, poll_interval_seconds = $6::integer,
            next_poll_at = LEAST(
              NOW() + ($6::integer * interval '1 second'),
              attempt.expires_at
            ),
            state_hash = NULL,
            bundle_format_version = $7, bundle_key_id = $8,
            bundle_ciphertext = $9, bundle_nonce = $10, bundle_tag = $11,
            operation_lease_id = NULL, operation_lease_expires_at = NULL,
            updated_at = NOW()
       FROM ai_providers AS provider
      WHERE attempt.id = $1 AND attempt.provider_id = provider.id
        AND attempt.status = 'pending' AND attempt.revision = $2
        AND attempt.expected_auth_epoch = $3 AND provider.auth_epoch = $3
        AND attempt.operation_lease_id = $4
        AND attempt.expires_at > NOW()
      RETURNING attempt.*`,
    [
      input.claimed.attempt.id,
      input.claimed.attempt.revision,
      input.claimed.attempt.expected_auth_epoch,
      input.claimed.leaseId,
      nextRevision,
      input.intervalSeconds,
      envelope.formatVersion,
      envelope.keyId,
      envelope.ciphertext,
      envelope.nonce,
      envelope.tag,
    ],
  );
  if (result.rows[0]) return { attempt: result.rows[0], expired: false as const };
  const expired = await client.query<AttemptRow>(
    `UPDATE ai_provider_auth_attempts AS attempt
        SET status = 'expired', revision = revision + 1,
            failure_code = 'DEVICE_FLOW_EXPIRED', consumed_at = NOW(),
            bundle_format_version = NULL, bundle_key_id = NULL,
            bundle_ciphertext = NULL, bundle_nonce = NULL, bundle_tag = NULL,
            operation_lease_id = NULL, operation_lease_expires_at = NULL,
            updated_at = NOW()
       FROM ai_providers AS provider
      WHERE attempt.id = $1 AND attempt.provider_id = provider.id
        AND attempt.status = 'pending' AND attempt.revision = $2
        AND attempt.expected_auth_epoch = $3 AND provider.auth_epoch = $3
        AND attempt.operation_lease_id = $4
        AND attempt.expires_at <= NOW()
      RETURNING attempt.*`,
    [
      input.claimed.attempt.id,
      input.claimed.attempt.revision,
      input.claimed.attempt.expected_auth_epoch,
      input.claimed.leaseId,
    ],
  );
  if (expired.rows[0]) return { attempt: expired.rows[0], expired: true as const };
  throw new AdminError(
    "PROVIDER_AUTH_ATTEMPT_STALE",
    "The authorization result arrived after the attempt changed",
    409,
  );
}

async function completeTerminalPoll(
  client: PoolClient,
  input: {
    claimed: ClaimedPoll;
    status: "denied" | "expired";
    failureCode: string;
  },
) {
  const result = await client.query<AttemptRow>(
    `UPDATE ai_provider_auth_attempts AS attempt
        SET status = $5, revision = revision + 1,
            failure_code = $6, consumed_at = NOW(),
            bundle_format_version = NULL, bundle_key_id = NULL,
            bundle_ciphertext = NULL, bundle_nonce = NULL, bundle_tag = NULL,
            operation_lease_id = NULL, operation_lease_expires_at = NULL,
            updated_at = NOW()
       FROM ai_providers AS provider
      WHERE attempt.id = $1 AND attempt.provider_id = provider.id
        AND attempt.status = 'pending' AND attempt.revision = $2
        AND attempt.expected_auth_epoch = $3 AND provider.auth_epoch = $3
        AND attempt.operation_lease_id = $4
      RETURNING attempt.*`,
    [
      input.claimed.attempt.id,
      input.claimed.attempt.revision,
      input.claimed.attempt.expected_auth_epoch,
      input.claimed.leaseId,
      input.status,
      input.failureCode,
    ],
  );
  if (!result.rows[0]) {
    throw new AdminError(
      "PROVIDER_AUTH_ATTEMPT_STALE",
      "The terminal authorization result arrived after the attempt changed",
      409,
    );
  }
  return result.rows[0];
}

async function connectCredential(
  client: PoolClient,
  input: {
    claimed: ClaimedPoll;
    connected: Extract<DevicePollResult, { status: "connected" }>;
    registrationFingerprint: string;
  },
) {
  await lockManagedProvider(client, input.claimed.provider.id);
  const provider = await loadProvider(client, input.claimed.provider.id, true);
  if (
    provider.auth_epoch !== input.claimed.attempt.expected_auth_epoch ||
    provider.adapter_kind !== input.claimed.attempt.adapter_kind
  ) {
    throw new AdminError(
      "PROVIDER_AUTH_EPOCH_STALE",
      "The Provider authentication state changed before authorization completed",
      409,
    );
  }
  const attempt = await loadAttempt(client, input.claimed.attempt.id, true);
  if (
    attempt.status !== "pending" ||
    attempt.revision !== input.claimed.attempt.revision ||
    attempt.operation_lease_id !== input.claimed.leaseId ||
    attempt.registration_fingerprint !== input.registrationFingerprint
  ) {
    throw new AdminError(
      "PROVIDER_AUTH_ATTEMPT_STALE",
      "The authorization result arrived after the attempt changed",
      409,
    );
  }
  const current = attempt.target_credential_id
    ? await loadAccount(
        client,
        provider.id,
        attempt.adapter_kind,
        attempt.target_credential_id,
        true,
      )
    : null;
  if (
    provider.managed_credential_id !== attempt.target_credential_id
    || (attempt.target_credential_id && (
      !current
      || current.status === "disconnected"
      || current.auth_epoch !== attempt.expected_credential_auth_epoch
      || current.revision !== attempt.expected_credential_revision
    ))
  ) {
    throw new AdminError(
      "PROVIDER_MANAGED_ACCOUNT_STALE",
      "The target account changed before authorization completed",
      409,
    );
  }
  const identityValue = assertIdentityContinuity(
    attempt.adapter_kind,
    current,
    input.connected.bundle,
  );
  const identityFingerprint = accountIdentityFingerprint(
    attempt.adapter_kind,
    identityValue,
  );
  let replacementRevocationJobId: string | null = null;
  let recoveredOrphanCredentialId: string | null = null;
  let orphanRecoveryRemoteRevocation: "pending" | "not_attempted" | null = null;
  if (!current) {
    const duplicate = await client.query<CredentialRow>(
      `SELECT * FROM ai_provider_managed_credentials
        WHERE adapter_kind = $1 AND account_identity_hash = $2
          AND status IN ('connected', 'reauth_required')
        LIMIT 1 FOR UPDATE`,
      [attempt.adapter_kind, identityFingerprint],
    );
    const duplicateCredential = duplicate.rows[0];
    if (duplicateCredential) {
      const owner = await loadCredentialOwner(client, duplicateCredential.provider_id);
      const liveOwner = owner
        && owner.status !== "deleted"
        && owner.adapter_kind === duplicateCredential.adapter_kind
        && owner.managed_credential_id === duplicateCredential.id;
      if (liveOwner) {
        throw new AdminError(
          "PROVIDER_MANAGED_ACCOUNT_ALREADY_EXISTS",
          `该产品账号已连接到 Provider「${owner.name}」，请先在原 Provider 断开账号，或改用其他产品账号`,
          409,
          {
            accountId: duplicateCredential.id,
            providerId: owner.id,
            providerCode: owner.code,
            providerName: owner.name,
          },
        );
      }

      if (
        owner
        && duplicateCredential.bundle_ciphertext
        && duplicateCredential.registration_fingerprint
      ) {
        try {
          const oldBundle = decryptTokenBundle(duplicateCredential, {
            providerId: duplicateCredential.envelope_context_id,
            adapterKind: duplicateCredential.adapter_kind,
            recordId: duplicateCredential.id,
            revision: duplicateCredential.revision,
          });
          const job = await enqueueProviderRevocationJobOnClient(client, {
            providerId: owner.id,
            adapterKind: duplicateCredential.adapter_kind,
            sourceKind: "credential",
            sourceRecordId: duplicateCredential.id,
            sourceRecordRevision: duplicateCredential.revision,
            sourceAuthEpoch: duplicateCredential.auth_epoch,
            accountScopeId: duplicateCredential.id,
            managedCredentialId: duplicateCredential.id,
            credentialAuthEpoch: duplicateCredential.auth_epoch,
            envelopeContextId: duplicateCredential.envelope_context_id,
            reason: "replacement",
            registrationFingerprint: duplicateCredential.registration_fingerprint,
            material: revocationMaterialFromBundle(oldBundle),
          });
          replacementRevocationJobId = job.id;
          orphanRecoveryRemoteRevocation = "pending";
        } catch {
          orphanRecoveryRemoteRevocation = "not_attempted";
        }
      } else {
        orphanRecoveryRemoteRevocation = "not_attempted";
      }

      if (owner?.managed_credential_id === duplicateCredential.id) {
        await client.query(
          `UPDATE ai_providers
              SET managed_credential_id = NULL,
                  active_credential_kind = 'none',
                  auth_epoch = auth_epoch + 1,
                  updated_at = NOW()
            WHERE id = $1 AND managed_credential_id = $2`,
          [owner.id, duplicateCredential.id],
        );
      }
      const released = await client.query<CredentialRow>(
        `UPDATE ai_provider_managed_credentials
            SET provider_id = NULL,
                status = 'disconnected',
                auth_epoch = auth_epoch + 1,
                revision = revision + 1,
                bundle_format_version = NULL,
                bundle_key_id = NULL,
                bundle_ciphertext = NULL,
                bundle_nonce = NULL,
                bundle_tag = NULL,
                granted_scopes = ARRAY[]::text[],
                access_expires_at = NULL,
                refresh_expires_at = NULL,
                session_expires_at = NULL,
                refresh_lease_id = NULL,
                refresh_lease_expires_at = NULL,
                revocation_status = 'not_attempted',
                revocation_attempted_at = NULL,
                revocation_completed_at = NULL,
                revocation_failure_code = NULL,
                disconnected_at = NOW(),
                updated_at = NOW()
          WHERE id = $1 AND adapter_kind = $2
            AND auth_epoch = $3 AND revision = $4
            AND provider_id IS NOT DISTINCT FROM $5
            AND status IN ('connected', 'reauth_required')
          RETURNING *`,
        [
          duplicateCredential.id,
          duplicateCredential.adapter_kind,
          duplicateCredential.auth_epoch,
          duplicateCredential.revision,
          duplicateCredential.provider_id,
        ],
      );
      if (!released.rows[0]) {
        throw new AdminError(
          "PROVIDER_MANAGED_ACCOUNT_STALE",
          "遗留产品账号状态已发生变化，请重新检查授权结果",
          409,
        );
      }
      recoveredOrphanCredentialId = duplicateCredential.id;
    }
  }
  if (current?.bundle_ciphertext && current.registration_fingerprint) {
    const currentBundle = decryptTokenBundle(current, {
      providerId: current.envelope_context_id,
      adapterKind: current.adapter_kind,
      recordId: current.id,
      revision: current.revision,
    });
    const currentMaterial = revocationMaterialFromBundle(currentBundle);
    const nextMaterial = revocationMaterialFromBundle(input.connected.bundle);
    if (!sameRevocationMaterial(currentMaterial, nextMaterial)) {
      const job = await enqueueProviderRevocationJobOnClient(client, {
        providerId: provider.id,
        adapterKind: attempt.adapter_kind,
        sourceKind: "credential",
        sourceRecordId: current.id,
        sourceRecordRevision: current.revision,
        sourceAuthEpoch: current.auth_epoch,
        accountScopeId: current.id,
        managedCredentialId: current.id,
        credentialAuthEpoch: current.auth_epoch,
        envelopeContextId: current.envelope_context_id,
        reason: "replacement",
        registrationFingerprint: current.registration_fingerprint,
        material: currentMaterial,
      });
      replacementRevocationJobId = job.id;
    }
  }
  const credentialId = current?.id ?? createPlatformId("managedacct");
  const credentialRevision = (current?.revision ?? 0) + 1;
  const accountAuthEpoch = (current?.auth_epoch ?? 0) + 1;
  const envelope = encryptTokenBundle(input.connected.bundle, {
    providerId: credentialId,
    adapterKind: attempt.adapter_kind,
    recordId: credentialId,
    revision: credentialRevision,
  });
  if (current) {
    const updated = await client.query(
      `UPDATE ai_provider_managed_credentials
          SET status = 'connected', auth_epoch = $4, revision = $5,
              display_name = $6, envelope_context_id = id,
              bundle_format_version = $7, bundle_key_id = $8,
              bundle_ciphertext = $9, bundle_nonce = $10, bundle_tag = $11,
              registration_fingerprint = $12,
              account_identity_hash = $13, account_label = $14,
              granted_scopes = $15::text[], access_expires_at = $16,
              refresh_expires_at = $17, session_expires_at = NULL,
              refresh_lease_id = NULL, refresh_lease_expires_at = NULL,
              revocation_status = NULL, revocation_attempted_at = NULL,
              revocation_completed_at = NULL, revocation_failure_code = NULL,
              disconnected_at = NULL, updated_at = NOW()
        WHERE id = $1 AND adapter_kind = $2 AND auth_epoch = $3
          AND revision = $18 AND provider_id = $19
          AND status IN ('connected', 'reauth_required')`,
      [
        credentialId,
        attempt.adapter_kind,
        current.auth_epoch,
        accountAuthEpoch,
        credentialRevision,
        accountLabel(input.connected.bundle),
        envelope.formatVersion,
        envelope.keyId,
        envelope.ciphertext,
        envelope.nonce,
        envelope.tag,
        input.registrationFingerprint,
        identityFingerprint,
        accountLabel(input.connected.bundle),
        grantedScopesProjection(input.connected.bundle),
        input.connected.bundle.product === "github_copilot"
          ? new Date(input.connected.bundle.copilotExpiresAtMs)
          : new Date(input.connected.bundle.expiresAtMs),
        input.connected.bundle.product === "github_copilot" && input.connected.bundle.sourceExpiresAtMs
          ? new Date(input.connected.bundle.sourceExpiresAtMs)
          : null,
        current.revision,
        provider.id,
      ],
    );
    if (updated.rowCount !== 1) {
      throw new AdminError(
        "PROVIDER_MANAGED_ACCOUNT_STALE",
        "The target account changed before authorization completed",
        409,
      );
    }
  } else {
    try {
      await client.query(
        `INSERT INTO ai_provider_managed_credentials (
       id, provider_id, adapter_kind, status, auth_epoch, revision,
       display_name, envelope_context_id,
       bundle_format_version, bundle_key_id, bundle_ciphertext,
       bundle_nonce, bundle_tag, registration_fingerprint,
       account_identity_hash, account_label, granted_scopes,
       access_expires_at, refresh_expires_at, session_expires_at,
       refresh_lease_id, refresh_lease_expires_at,
       revocation_status, revocation_attempted_at, revocation_completed_at,
       revocation_failure_code, disconnected_at
     ) VALUES (
       $1, $2, $3, 'connected', 1, 1, $4, $1,
       $5, $6, $7, $8, $9, $10,
       $11, $12, $13::text[], $14, $15, $16,
       NULL, NULL, NULL, NULL, NULL, NULL, NULL
     )`,
    [
      credentialId,
      provider.id,
      attempt.adapter_kind,
      accountLabel(input.connected.bundle),
      envelope.formatVersion,
      envelope.keyId,
      envelope.ciphertext,
      envelope.nonce,
      envelope.tag,
      input.registrationFingerprint,
      identityFingerprint,
      accountLabel(input.connected.bundle),
      grantedScopesProjection(input.connected.bundle),
      input.connected.bundle.product === "github_copilot"
        ? new Date(input.connected.bundle.copilotExpiresAtMs)
        : new Date(input.connected.bundle.expiresAtMs),
      input.connected.bundle.product === "github_copilot" && input.connected.bundle.sourceExpiresAtMs
        ? new Date(input.connected.bundle.sourceExpiresAtMs)
        : null,
      null,
    ],
      );
    } catch (error) {
      if (
        error && typeof error === "object" && "code" in error
        && error.code === "23505"
        && "constraint" in error
        && [
          "ai_provider_managed_credentials_active_identity_uidx",
          "ai_provider_managed_credentials_provider_active_uidx",
        ].includes(String(error.constraint))
      ) {
        throw new AdminError(
          "PROVIDER_MANAGED_ACCOUNT_ALREADY_EXISTS",
          "该产品账号已连接到其他 Provider，请先在原 Provider 断开账号，或改用其他产品账号",
          409,
        );
      }
      throw error;
    }
  }
  const providerUpdate = await client.query<{ auth_epoch: number }>(
    `UPDATE ai_providers
        SET managed_credential_id = $3,
            active_credential_kind = 'managed_oauth',
            auth_epoch = auth_epoch + 1,
            updated_at = NOW()
      WHERE id = $1 AND auth_epoch = $2
        AND managed_credential_id IS NOT DISTINCT FROM $4
      RETURNING auth_epoch`,
    [provider.id, provider.auth_epoch, credentialId, current?.id ?? null],
  );
  if (!providerUpdate.rows[0]) {
    throw new AdminError(
      "PROVIDER_AUTH_EPOCH_STALE",
      "The Provider authentication state changed before authorization completed",
      409,
    );
  }
  const attemptUpdate = await client.query(
    `UPDATE ai_provider_auth_attempts
        SET status = 'succeeded', revision = revision + 1,
            consumed_at = NOW(), failure_code = NULL,
            bundle_format_version = NULL, bundle_key_id = NULL,
            bundle_ciphertext = NULL, bundle_nonce = NULL, bundle_tag = NULL,
            operation_lease_id = NULL, operation_lease_expires_at = NULL,
            updated_at = NOW()
      WHERE id = $1 AND status = 'pending' AND revision = $2
        AND expected_auth_epoch = $3 AND operation_lease_id = $4`,
    [attempt.id, attempt.revision, attempt.expected_auth_epoch, input.claimed.leaseId],
  );
  if (attemptUpdate.rowCount !== 1) {
    throw new AdminError(
      "PROVIDER_AUTH_ATTEMPT_STALE",
      "The authorization attempt changed before completion committed",
      409,
    );
  }
  return {
    accountId: credentialId,
    accountAuthEpoch,
    credentialRevision,
    nextAuthEpoch: providerUpdate.rows[0].auth_epoch,
    defaultRevision: null,
    replacementRevocationJobId,
    recoveredOrphanCredentialId,
    orphanRecoveryRemoteRevocation,
  };
}

export async function handleProviderManagedAuthPoll(
  request: Request,
  attemptId: string,
  inputDependencies: ManagedAuthDependencies = {},
) {
  const requestId = adminRequestId(request);
  try {
    assertAdminMutationOrigin(request);
    const identity = await requireAdminRequest(request, "providers.write");
    const body = await parseJson(request, attemptActionSchema);
    const deps = await dependencies(inputDependencies);
    const leaseId = deps.createLeaseId();
    const pollClaim = await deps.withTransaction((client) => claimPoll(client, {
      attemptId,
      expectedRevision: body.expectedRevision,
      identity,
      leaseId,
      requestId,
      request,
    }));
    if (pollClaim.claim === "expired") {
      return Response.json(
        { data: attemptProjection(pollClaim.attempt) },
        {
          headers: { "cache-control": "no-store", "x-request-id": requestId },
        },
      );
    }
    const claimed = pollClaim;
    let readiness: Awaited<ReturnType<typeof effectiveReadiness>>;
    try {
      readiness = await effectiveReadiness(deps.registry, claimed.attempt.adapter_kind);
      requireEffectiveReadiness(readiness);
    } catch (error) {
      await deps.withTransaction(async (client) => {
        await markAttemptFailure(client, {
          attemptId,
          expectedStatus: "pending",
          expectedRevision: claimed.attempt.revision,
          failureCode: "DEPLOYMENT_NOT_READY",
          leaseId,
        });
        await auditTransition(client, {
          identity,
          action: "managed_auth_poll_failed",
          providerId: claimed.provider.id,
          attemptId,
          adapterKind: claimed.attempt.adapter_kind,
          requestId,
          request,
          beforeStatus: "pending",
          afterStatus: "failed",
          metadata: { failureCode: "DEPLOYMENT_NOT_READY" },
        });
      });
      throw error;
    }
    if (readiness.registrationFingerprint !== claimed.attempt.registration_fingerprint) {
      await deps.withTransaction(async (client) => {
        await markAttemptFailure(client, {
          attemptId,
          expectedStatus: "pending",
          expectedRevision: claimed.attempt.revision,
          failureCode: "REGISTRATION_CHANGED",
          leaseId,
        });
        await auditTransition(client, {
          identity,
          action: "managed_auth_poll_failed",
          providerId: claimed.provider.id,
          attemptId,
          adapterKind: claimed.attempt.adapter_kind,
          requestId,
          request,
          beforeStatus: "pending",
          afterStatus: "failed",
          metadata: { failureCode: "REGISTRATION_CHANGED" },
        });
      });
      throw new AdminError(
        "PROVIDER_AUTH_REGISTRATION_CHANGED",
        "The deployment registration changed; start a new authorization attempt",
        409,
      );
    }

    const scheduleRetryablePoll = async (failureCode: string) => {
      const intervalSeconds = Math.max(
        1,
        claimed.attempt.poll_interval_seconds ?? claimed.flow.intervalSeconds,
      );
      const updated = await deps.withTransaction(async (client) => {
        const receipt = await updatePendingPoll(client, {
          claimed,
          intervalSeconds,
        });
        await auditTransition(client, {
          identity,
          action: receipt.expired ? "managed_auth_expired" : "managed_auth_poll_retry_scheduled",
          providerId: claimed.provider.id,
          attemptId,
          adapterKind: claimed.attempt.adapter_kind,
          requestId,
          request,
          beforeStatus: "pending",
          afterStatus: receipt.expired ? "expired" : "pending",
          metadata: receipt.expired
            ? { lastRetryableFailureCode: failureCode }
            : { failureCode, intervalSeconds },
        });
        return receipt;
      });
      return Response.json(
        updated.expired
          ? { data: attemptProjection(updated.attempt) }
          : {
              data: attemptProjection(updated.attempt, claimed.flow),
              warning: { code: failureCode, retryable: true },
            },
        { headers: { "cache-control": "no-store", "x-request-id": requestId } },
      );
    };

    let result: DevicePollResult;
    try {
      result = await deps.registry.get(claimed.attempt.adapter_kind).pollDevice(claimed.flow);
    } catch (error) {
      const errorRecord = error && typeof error === "object"
        ? error as { code?: unknown; retryable?: unknown; httpStatus?: unknown }
        : null;
      const failureCode = safeFailureCode(
        errorRecord?.code,
        "UPSTREAM_POLL_FAILED",
      );
      const retryable = errorRecord?.retryable !== false
        && (typeof errorRecord?.httpStatus !== "number" || errorRecord.httpStatus >= 500);
      if (retryable) return await scheduleRetryablePoll(failureCode);
      await deps.withTransaction(async (client) => {
        await markAttemptFailure(client, {
          attemptId,
          expectedStatus: "pending",
          expectedRevision: claimed.attempt.revision,
          failureCode,
          leaseId,
        });
        await auditTransition(client, {
          identity,
          action: "managed_auth_poll_failed",
          providerId: claimed.provider.id,
          attemptId,
          adapterKind: claimed.attempt.adapter_kind,
          requestId,
          request,
          beforeStatus: "pending",
          afterStatus: "failed",
          metadata: { failureCode },
        });
      });
      throw new AdminError(
        failureCode,
        "The upstream authorization status could not be checked",
        502,
      );
    }

    if (result.status === "failed") {
      const failureCode = safeFailureCode(result.error.code, "UPSTREAM_POLL_FAILED");
      if (result.revocationHandoff) {
        await recordRejectedGrant(deps, {
          claimed,
          material: result.revocationHandoff.unwrap(),
          failureCode,
          action: "managed_auth_grant_rejected",
          identity,
          requestId,
          request,
        });
        throw new AdminError(
          failureCode,
          "The issued Provider grant failed post-authorization validation and was queued for revocation",
          result.error.httpStatus ?? 502,
        );
      }
      if (result.error.retryable) return await scheduleRetryablePoll(failureCode);
      await deps.withTransaction(async (client) => {
        await markAttemptFailure(client, {
          attemptId,
          expectedStatus: "pending",
          expectedRevision: claimed.attempt.revision,
          failureCode,
          leaseId,
        });
        await auditTransition(client, {
          identity,
          action: "managed_auth_poll_failed",
          providerId: claimed.provider.id,
          attemptId,
          adapterKind: claimed.attempt.adapter_kind,
          requestId,
          request,
          beforeStatus: "pending",
          afterStatus: "failed",
          metadata: { failureCode },
        });
      });
      throw new AdminError(
        failureCode,
        "The upstream authorization status could not be checked",
        result.error.httpStatus ?? 502,
      );
    }

    if (result.status === "pending" || result.status === "slow_down") {
      const baseInterval = Math.max(1, claimed.attempt.poll_interval_seconds ?? 5);
      const intervalSeconds = result.status === "slow_down"
        ? Math.max(baseInterval + 5, result.retryAfterSeconds ?? 0)
        : Math.max(baseInterval, result.retryAfterSeconds ?? 0);
      const updated = await deps.withTransaction(async (client) => {
        const receipt = await updatePendingPoll(client, {
          claimed,
          intervalSeconds,
        });
        await auditTransition(client, {
          identity,
          action: receipt.expired
            ? "managed_auth_expired"
            : result.status === "slow_down"
              ? "managed_auth_slow_down"
              : "managed_auth_pending",
          providerId: claimed.provider.id,
          attemptId,
          adapterKind: claimed.attempt.adapter_kind,
          requestId,
          request,
          beforeStatus: "pending",
          afterStatus: receipt.expired ? "expired" : "pending",
        });
        return receipt;
      });
      return Response.json(
        { data: attemptProjection(updated.attempt, updated.expired ? null : claimed.flow) },
        { headers: { "cache-control": "no-store", "x-request-id": requestId } },
      );
    }

    if (result.status === "denied" || result.status === "expired") {
      const failureCode = result.status === "denied" ? "ACCESS_DENIED" : "DEVICE_FLOW_EXPIRED";
      const completed = await deps.withTransaction(async (client) => {
        const attempt = await completeTerminalPoll(client, {
          claimed,
          status: result.status,
          failureCode,
        });
        await auditTransition(client, {
          identity,
          action: `managed_auth_${result.status}`,
          providerId: claimed.provider.id,
          attemptId,
          adapterKind: claimed.attempt.adapter_kind,
          requestId,
          request,
          beforeStatus: "pending",
          afterStatus: result.status,
          metadata: { failureCode },
        });
        return attempt;
      });
      return Response.json(
        { data: attemptProjection(completed) },
        { headers: { "cache-control": "no-store", "x-request-id": requestId } },
      );
    }

    if (result.status !== "connected") {
      throw new AdminError(
        "PROVIDER_AUTH_POLL_RESULT_INVALID",
        "The provider returned an unsupported Device authorization state",
        502,
      );
    }

    let readinessAfterPoll: Awaited<ReturnType<typeof effectiveReadiness>>;
    try {
      readinessAfterPoll = await effectiveReadiness(deps.registry, claimed.attempt.adapter_kind);
      requireEffectiveReadiness(readinessAfterPoll);
    } catch (error) {
      await recordRejectedGrant(deps, {
        claimed,
        material: revocationMaterialFromBundle(result.bundle),
        failureCode: "DEPLOYMENT_NOT_READY",
        action: "managed_auth_grant_rejected",
        identity,
        requestId,
        request,
      });
      throw error;
    }
    if (readinessAfterPoll.registrationFingerprint !== claimed.attempt.registration_fingerprint) {
      await recordRejectedGrant(deps, {
        claimed,
        material: revocationMaterialFromBundle(result.bundle),
        failureCode: "REGISTRATION_CHANGED",
        action: "managed_auth_grant_rejected",
        identity,
        requestId,
        request,
      });
      throw new AdminError(
        "PROVIDER_AUTH_REGISTRATION_CHANGED",
        "The deployment registration changed before authorization completed",
        409,
      );
    }
    let connected: Awaited<ReturnType<typeof connectCredential>>;
    try {
      connected = await deps.withTransaction(async (client) => {
        const receipt = await connectCredential(client, {
          claimed,
          connected: result,
          registrationFingerprint: readinessAfterPoll.registrationFingerprint!,
        });
        await auditTransition(client, {
          identity,
          action: "managed_auth_connected",
          providerId: claimed.provider.id,
          attemptId,
          adapterKind: claimed.attempt.adapter_kind,
          requestId,
          request,
          beforeStatus: "pending",
          afterStatus: "connected",
          metadata: receipt,
        });
        return receipt;
      });
    } catch (error) {
      const failureCode = error instanceof AdminError
        ? error.code
        : "ACTIVATION_COMMIT_FAILED";
      await recordRejectedGrant(deps, {
        claimed,
        material: revocationMaterialFromBundle(result.bundle),
        failureCode,
        action: error instanceof AdminError && [
          "PROVIDER_MANAGED_AUTH_ACCOUNT_MISMATCH",
          "PROVIDER_MANAGED_AUTH_IDENTITY_INVALID",
          "PROVIDER_MANAGED_AUTH_PRODUCT_MISMATCH",
        ].includes(error.code)
          ? "managed_auth_identity_rejected"
          : "managed_auth_grant_rejected",
        identity,
        requestId,
        request,
      });
      throw error;
    }
    if (connected.replacementRevocationJobId) {
      await processProviderRevocationJob(connected.replacementRevocationJobId, {
        registry: deps.registry,
        withTransaction: deps.withTransaction,
        createLeaseId: deps.createLeaseId,
        force: true,
      }).catch(() => undefined);
    }
    let catalogSync:
      | {
          status: "succeeded";
          snapshotId: string;
          discoveredCount: number;
          newCount: number;
          conflictCount: number;
          unsupportedCount: number;
          reused: boolean;
        }
      | { status: "failed"; code: string };
    try {
      const snapshot = await deps.discoverModels({
        providerId: claimed.provider.id,
        identity,
        requestId,
        request,
      });
      catalogSync = {
        status: "succeeded",
        snapshotId: snapshot.id,
        discoveredCount: snapshot.discoveredCount,
        newCount: snapshot.newCount,
        conflictCount: snapshot.conflictCount,
        unsupportedCount: snapshot.unsupportedCount,
        reused: snapshot.reused,
      };
    } catch (error) {
      const code = error instanceof AdminError
        ? error.code
        : "PROVIDER_MODEL_DISCOVERY_FAILED";
      catalogSync = { status: "failed", code };
      await deps.withTransaction(async (client) => {
        await recordAdminAuditOnClient(client, {
          identity,
          action: "provider_model_discovery_failed",
          resourceType: "providers",
          resourceId: claimed.provider.id,
          requestId,
          request,
          metadata: {
            adapterKind: claimed.attempt.adapter_kind,
            accountId: connected.accountId,
            accountAuthEpoch: connected.accountAuthEpoch,
            credentialRevision: connected.credentialRevision,
            code,
          },
        });
      }).catch(() => undefined);
    }
    return Response.json(
      {
        data: {
          id: attemptId,
          status: "succeeded",
          accountId: connected.accountId,
          accountAuthEpoch: connected.accountAuthEpoch,
          credentialStatus: "connected",
          credentialRevision: connected.credentialRevision,
          authEpoch: connected.nextAuthEpoch,
          catalogSync,
        },
      },
      { headers: { "cache-control": "no-store", "x-request-id": requestId } },
    );
  } catch (error) {
    return adminErrorResponse(error, requestId);
  }
}

export async function handleProviderManagedAuthCancel(
  request: Request,
  attemptId: string,
  inputDependencies: ManagedAuthDependencies = {},
) {
  const requestId = adminRequestId(request);
  try {
    assertAdminMutationOrigin(request);
    const identity = await requireAdminRequest(request, "providers.write");
    const body = await parseJson(request, attemptActionSchema);
    const deps = await dependencies(inputDependencies);
    const cancelled = await deps.withTransaction(async (client) => {
      const discoveredAttempt = await loadAttempt(client, attemptId);
      const provider = await loadProvider(client, discoveredAttempt.provider_id, true);
      const attempt = await loadAttempt(client, attemptId, true);
      if (attempt.provider_id !== provider.id) {
        throw new AdminError(
          "PROVIDER_AUTH_ATTEMPT_STALE",
          "The authorization attempt changed while acquiring its Provider lock",
          409,
        );
      }
      requireManagedProvider(provider);
      if (attempt.created_by_admin_id !== identity.id) {
        throw new AdminError(
          "PROVIDER_AUTH_ATTEMPT_ACTOR_MISMATCH",
          "Only the administrator who started this authorization attempt may cancel it",
          403,
        );
      }
      if (attempt.revision !== body.expectedRevision) {
        throw new AdminError(
          "PROVIDER_AUTH_ATTEMPT_REVISION_STALE",
          "The authorization attempt changed; reload before cancelling",
          409,
          { currentRevision: attempt.revision },
        );
      }
      if (TERMINAL_ATTEMPT_STATUSES.has(attempt.status)) return attempt;
      const result = await client.query<AttemptRow>(
        `UPDATE ai_provider_auth_attempts
            SET status = 'cancelled', revision = revision + 1,
                failure_code = 'CANCELLED_BY_ADMIN', consumed_at = NOW(),
                bundle_format_version = NULL, bundle_key_id = NULL,
                bundle_ciphertext = NULL, bundle_nonce = NULL, bundle_tag = NULL,
                operation_lease_id = NULL, operation_lease_expires_at = NULL,
                updated_at = NOW()
          WHERE id = $1 AND revision = $2 AND status IN ('starting', 'pending')
          RETURNING *`,
        [attempt.id, attempt.revision],
      );
      if (!result.rows[0]) {
        throw new AdminError(
          "PROVIDER_AUTH_ATTEMPT_STALE",
          "The authorization attempt changed before cancellation committed",
          409,
        );
      }
      await auditTransition(client, {
        identity,
        action: "managed_auth_cancelled",
        providerId: provider.id,
        attemptId,
        adapterKind: attempt.adapter_kind,
        requestId,
        request,
        beforeStatus: attempt.status,
        afterStatus: "cancelled",
      });
      return result.rows[0];
    });
    return Response.json(
      { data: attemptProjection(cancelled) },
      { headers: { "cache-control": "no-store", "x-request-id": requestId } },
    );
  } catch (error) {
    return adminErrorResponse(error, requestId);
  }
}

export async function handleProviderManagedAuthDisconnect(
  request: Request,
  providerId: string,
  inputDependencies: ManagedAuthDependencies = {},
) {
  const requestId = adminRequestId(request);
  try {
    assertAdminMutationOrigin(request);
    await requireAdminRequest(request, "providers.write");
    const body = await parseJson(request, disconnectBodySchema);
    const deps = await dependencies(inputDependencies);
    await deps.withTransaction(async (client) => {
      const provider = await loadProvider(client, providerId, true);
      requireManagedProvider(provider);
      if (provider.auth_epoch !== body.expectedAuthEpoch) {
        throw new AdminError(
          "PROVIDER_AUTH_EPOCH_STALE",
          "The Provider authentication state changed; reload before disconnecting",
          409,
          { currentAuthEpoch: provider.auth_epoch },
        );
      }
    });
    throw new AdminError(
      "PROVIDER_MANAGED_ACCOUNT_ROUTE_REQUIRED",
      "Disconnect a specific product account from the account collection",
      409,
    );
  } catch (error) {
    return adminErrorResponse(error, requestId);
  }
}

export async function handleProviderManagedAuthSetDefault(
  request: Request,
  providerId: string,
  accountId: string,
  inputDependencies: ManagedAuthDependencies = {},
) {
  const requestId = adminRequestId(request);
  try {
    assertAdminMutationOrigin(request);
    await requireAdminRequest(request, "providers.write");
    void providerId;
    void accountId;
    void inputDependencies;
    throw new AdminError(
      "PROVIDER_MANAGED_ACCOUNT_POOL_UNSUPPORTED",
      "Managed account defaults are no longer supported; each Provider owns one credential",
      410,
    );
  } catch (error) {
    return adminErrorResponse(error, requestId);
  }
}

export async function handleProviderManagedAuthSetBinding(
  request: Request,
  providerId: string,
  inputDependencies: ManagedAuthDependencies = {},
) {
  const requestId = adminRequestId(request);
  try {
    assertAdminMutationOrigin(request);
    await requireAdminRequest(request, "providers.write");
    void providerId;
    void inputDependencies;
    throw new AdminError(
      "PROVIDER_MANAGED_ACCOUNT_POOL_UNSUPPORTED",
      "Managed account bindings are no longer supported; each Provider owns one credential",
      410,
    );
  } catch (error) {
    return adminErrorResponse(error, requestId);
  }
}

export async function handleProviderManagedAuthDisconnectAccount(
  request: Request,
  providerId: string,
  accountId: string,
  inputDependencies: ManagedAuthDependencies = {},
) {
  const requestId = adminRequestId(request);
  try {
    assertAdminMutationOrigin(request);
    const identity = await requireAdminRequest(request, "providers.write");
    const body = await parseJson(request, accountDisconnectBodySchema);
    const deps = await dependencies(inputDependencies);
    const local = await deps.withTransaction(async (client) => {
      await lockManagedProvider(client, providerId);
      const provider = await loadProvider(client, providerId, true);
      const adapterKind = requireManagedProvider(provider);
      if (provider.managed_credential_id !== accountId) {
        throw new AdminError(
          "PROVIDER_MANAGED_ACCOUNT_NOT_OWNED",
          "The requested credential is not the current credential owned by this Provider",
          409,
        );
      }
      const account = await loadAccount(client, provider.id, adapterKind, accountId, true);
      if (!account || account.status === "disconnected") {
        throw new AdminError(
          "PROVIDER_MANAGED_ACCOUNT_OWNERSHIP_INVALID",
          "The Provider credential pointer does not reference a live owned credential",
          409,
        );
      }
      if (
        account.auth_epoch !== body.expectedAccountEpoch
        || account.revision !== body.expectedRevision
      ) {
        throw new AdminError(
          "PROVIDER_MANAGED_ACCOUNT_STALE",
          "The Provider account changed; reload before disconnecting it",
          409,
          { currentAccountEpoch: account.auth_epoch, currentRevision: account.revision },
        );
      }

      let revocationJobId: string | null = null;
      let bundleUnavailable = false;
      if (account.bundle_ciphertext && account.registration_fingerprint) {
        try {
          const bundle = decryptTokenBundle(account, {
            providerId: account.envelope_context_id,
            adapterKind,
            recordId: account.id,
            revision: account.revision,
          });
          const job = await enqueueProviderRevocationJobOnClient(client, {
            providerId,
            adapterKind,
            sourceKind: "credential",
            sourceRecordId: account.id,
            sourceRecordRevision: account.revision,
            sourceAuthEpoch: account.auth_epoch,
            accountScopeId: account.id,
            managedCredentialId: account.id,
            credentialAuthEpoch: account.auth_epoch,
            envelopeContextId: account.envelope_context_id,
            reason: "disconnect",
            registrationFingerprint: account.registration_fingerprint,
            material: revocationMaterialFromBundle(bundle),
          });
          revocationJobId = job.id;
        } catch {
          bundleUnavailable = true;
        }
      }

      await client.query(
        `UPDATE ai_provider_auth_attempts
            SET status = 'cancelled', revision = revision + 1,
                failure_code = 'ACCOUNT_DISCONNECTED', consumed_at = NOW(),
                bundle_format_version = NULL, bundle_key_id = NULL,
                bundle_ciphertext = NULL, bundle_nonce = NULL, bundle_tag = NULL,
                operation_lease_id = NULL, operation_lease_expires_at = NULL,
                updated_at = NOW()
          WHERE target_credential_id = $1 AND provider_id = $2
            AND status IN ('starting', 'pending')`,
        [account.id, provider.id],
      );
      const disconnected = await client.query<CredentialRow>(
        `UPDATE ai_provider_managed_credentials
            SET status = 'disconnected', auth_epoch = auth_epoch + 1,
                revision = revision + 1,
                bundle_format_version = NULL, bundle_key_id = NULL,
                bundle_ciphertext = NULL, bundle_nonce = NULL, bundle_tag = NULL,
                granted_scopes = ARRAY[]::text[], access_expires_at = NULL,
                refresh_expires_at = NULL, session_expires_at = NULL,
                refresh_lease_id = NULL, refresh_lease_expires_at = NULL,
                revocation_status = 'not_attempted',
                revocation_attempted_at = NULL, revocation_completed_at = NULL,
                revocation_failure_code = NULL, disconnected_at = NOW(), updated_at = NOW()
          WHERE id = $1 AND adapter_kind = $2 AND auth_epoch = $3 AND revision = $4
            AND provider_id = $5
          RETURNING *`,
        [account.id, adapterKind, account.auth_epoch, account.revision, provider.id],
      );
      if (!disconnected.rows[0]) {
        throw new AdminError(
          "PROVIDER_MANAGED_ACCOUNT_STALE",
          "The product account changed before removal committed",
          409,
        );
      }
      const providerUpdate = await client.query<{ auth_epoch: number }>(
        `UPDATE ai_providers
            SET managed_credential_id = NULL,
                active_credential_kind = 'none',
                auth_epoch = auth_epoch + 1,
                updated_at = NOW()
          WHERE id = $1 AND auth_epoch = $2 AND managed_credential_id = $3
          RETURNING auth_epoch`,
        [provider.id, provider.auth_epoch, account.id],
      );
      if (!providerUpdate.rows[0]) {
        throw new AdminError(
          "PROVIDER_AUTH_EPOCH_STALE",
          "The Provider authentication state changed before disconnect committed",
          409,
        );
      }
      await auditTransition(client, {
        identity,
        action: "managed_auth_account_disconnected",
        providerId,
        adapterKind,
        requestId,
        request,
        beforeStatus: account.status,
        afterStatus: "disconnected",
        metadata: {
          accountId: account.id,
          previousAccountEpoch: account.auth_epoch,
          nextAccountEpoch: disconnected.rows[0].auth_epoch,
          previousProviderAuthEpoch: provider.auth_epoch,
          nextProviderAuthEpoch: providerUpdate.rows[0].auth_epoch,
          remoteRevocation: revocationJobId ? "pending" : "not_attempted",
          ...(revocationJobId ? { revocationJobId } : {}),
          ...(bundleUnavailable ? { remoteRevocationReason: "LOCAL_BUNDLE_UNAVAILABLE" } : {}),
        },
      });
      return {
        adapterKind,
        account: disconnected.rows[0],
        providerAuthEpoch: providerUpdate.rows[0].auth_epoch,
        revocationJobId,
        bundleUnavailable,
      };
    });

    let remoteRevocation: "succeeded" | "failed" | "unsupported" | "pending" | "not_attempted" =
      local.revocationJobId ? "pending" : "not_attempted";
    let failureCode = local.bundleUnavailable ? "LOCAL_BUNDLE_UNAVAILABLE" : null;
    if (local.revocationJobId) {
      const completed = await processProviderRevocationJob(local.revocationJobId, {
        registry: deps.registry,
        withTransaction: deps.withTransaction,
        createLeaseId: deps.createLeaseId,
        force: true,
      }).catch(() => null);
      if (completed) {
        remoteRevocation = completed.status === "succeeded"
          ? "succeeded"
          : completed.status === "unsupported"
            ? "unsupported"
            : completed.status === "failed"
              ? "failed"
              : "pending";
        failureCode = completed.failure_code;
      }
    }
    return Response.json(
      {
        data: {
          accountId: local.account.id,
          credentialId: local.account.id,
          status: local.account.status,
          authEpoch: local.account.auth_epoch,
          providerAuthEpoch: local.providerAuthEpoch,
          revision: local.account.revision,
          remoteRevocation,
          ...(failureCode ? { remoteRevocationFailureCode: failureCode } : {}),
        },
      },
      { headers: { "cache-control": "no-store", "x-request-id": requestId } },
    );
  } catch (error) {
    return adminErrorResponse(error, requestId);
  }
}

export async function handleProviderManagedAuthRevocationRetry(
  request: Request,
  providerId: string,
  inputDependencies: ManagedAuthDependencies = {},
) {
  const requestId = adminRequestId(request);
  try {
    assertAdminMutationOrigin(request);
    const identity = await requireAdminRequest(request, "providers.write");
    const body = await parseJson(request, retryRevocationBodySchema);
    const deps = await dependencies(inputDependencies);
    const before = await deps.withClient(async (client) => {
      const provider = await loadProvider(client, providerId);
      requireManagedProvider(provider);
      const result = await client.query<import("../provider-auth/revocation-jobs").ProviderRevocationJobRow>(
        `SELECT * FROM ai_provider_revocation_jobs
          WHERE id = $1 AND provider_id = $2 AND managed_credential_id = $3`,
        [body.jobId, providerId, body.accountId],
      );
      if (!result.rows[0]) {
        throw new AdminError(
          "PROVIDER_REVOCATION_JOB_NOT_FOUND",
          "The Provider revocation job does not exist",
          404,
        );
      }
      if (result.rows[0].revision !== body.expectedRevision) {
        throw new AdminError(
          "PROVIDER_REVOCATION_JOB_REVISION_STALE",
          "The revocation job changed; reload before retrying",
          409,
          { currentRevision: result.rows[0].revision },
        );
      }
      return result.rows[0];
    });
    if (["succeeded", "unsupported"].includes(before.status)) {
      return Response.json(
        { data: revocationJobProjection(before) },
        { headers: { "cache-control": "no-store", "x-request-id": requestId } },
      );
    }
    const processed = await processProviderRevocationJob(body.jobId, {
      registry: deps.registry,
      withTransaction: deps.withTransaction,
      createLeaseId: deps.createLeaseId,
      force: true,
      expectedRevision: body.expectedRevision,
    });
    if (!processed) {
      throw new AdminError(
        "PROVIDER_REVOCATION_JOB_REVISION_STALE",
        "The revocation job was claimed or changed by another request",
        409,
      );
    }
    await deps.withTransaction(async (client) => {
      await auditTransition(client, {
        identity,
        action: "managed_auth_remote_revocation_retry",
        providerId,
        adapterKind: processed.adapter_kind,
        requestId,
        request,
        beforeStatus: before.status,
        afterStatus: processed.status,
        metadata: {
          revocationJobId: processed.id,
          failureCode: processed.failure_code,
          attemptCount: processed.attempt_count,
        },
      });
    });
    return Response.json(
      { data: revocationJobProjection(processed) },
      { headers: { "cache-control": "no-store", "x-request-id": requestId } },
    );
  } catch (error) {
    return adminErrorResponse(error, requestId);
  }
}

export const providerManagedAuthTestExports = {
  canonicalJson,
  identityCanonical,
  assertIdentityContinuity,
  attemptProjection,
  credentialProjection,
  grantedScopesProjection,
  ACTIVE_ATTEMPT_STATUSES,
};
