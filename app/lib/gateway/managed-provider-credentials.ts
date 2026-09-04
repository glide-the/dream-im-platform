// [Input] A resolved product Provider identity plus its PostgreSQL-encrypted managed credential.
// [Output] Fenced inference or Admin catalog access plus durable cleanup handoff for discarded refresh/renewal grants.
// [Pos] Managed credential broker following a Provider's owned credential pointer, AES-GCM envelopes, and cross-instance refresh leases.
// [Sync] 2026-09-04: allow disabled Providers only through the explicit Admin model-catalog path while keeping Gateway access active-only.

import { randomUUID } from "node:crypto";
import type { PoolClient } from "pg";

import {
  getProviderProductRegistry,
  providerTokenBundleSchema,
  type ProviderProductKind,
  type ProviderProductRegistry,
  type ProviderTokenBundle,
} from "../providers";
import {
  enqueueProviderRevocationJobOnClient,
  processProviderRevocationJob,
} from "../provider-auth/revocation-jobs";
import { withPlatformClient, withPlatformTransaction } from "../platform-db";
import {
  decryptCredentialEnvelope,
  encryptCredentialEnvelope,
} from "../security/credential-envelope";
import { GatewayError } from "./errors";

type ManagedCredentialRow = {
  credential_id: string;
  provider_id: string;
  provider_status: "active" | "disabled" | "deleted";
  provider_adapter_kind: ProviderProductKind;
  active_credential_kind: "managed_oauth" | "none";
  auth_epoch: number;
  credential_status: "connected" | "reauth_required" | "disconnected";
  account_auth_epoch: number;
  credential_revision: number;
  envelope_context_id: string;
  bundle_format_version: number | null;
  bundle_key_id: string | null;
  bundle_ciphertext: string | null;
  bundle_nonce: string | null;
  bundle_tag: string | null;
  registration_fingerprint: string;
  refresh_lease_id: string | null;
  refresh_lease_expires_at: Date | string | null;
};

export type ManagedProviderAccess = {
  adapterKind: ProviderProductKind;
  dialect: "openai_responses" | "openai_chat";
  url: string;
  headers: Headers;
  credentialRevision: number;
  accountId: string;
  accountAuthEpoch: number;
  defaultRevision: number | null;
  renewed: boolean;
};

type ReadyProviderModelCatalog = Extract<
  Awaited<ReturnType<ReturnType<ProviderProductRegistry["get"]>["fetchModelCatalog"]>>,
  { status: "ready" }
>;

export type ManagedProviderCatalogAccess = {
  adapterKind: ProviderProductKind;
  endpoint: string;
  models: ReadyProviderModelCatalog["models"];
  authEpoch: number;
  credentialRevision: number;
  accountId: string;
  accountAuthEpoch: number;
  registrationFingerprint: string;
  renewed: boolean;
};

type ManagedProviderCredentialDependencies = {
  registry?: ProviderProductRegistry;
  now?: () => Date;
  createLeaseId?: () => string;
  sleep?: (milliseconds: number) => Promise<void>;
  withClient?: typeof withPlatformClient;
  withTransaction?: typeof withPlatformTransaction;
};

// A product renewal makes at most three sequential, individually 15-second-bounded requests.
const REFRESH_LEASE_MILLISECONDS = 90_000;
const LEASE_LOSER_RETRIES = 8;

function leaseLoserWaitMilliseconds(attempt: number) {
  return Math.min(100 * (2 ** attempt), 1_000);
}

function gatewayConfigurationError(code: string, message: string, retryable = false) {
  return new GatewayError(code, message, 503, "configuration_error", retryable);
}

function managedEnvelope(row: ManagedCredentialRow) {
  if (
    row.bundle_format_version !== 1
    || !row.bundle_key_id
    || !row.bundle_ciphertext
    || !row.bundle_nonce
    || !row.bundle_tag
  ) {
    throw gatewayConfigurationError(
      "PROVIDER_MANAGED_CREDENTIAL_UNAVAILABLE",
      "The selected product provider has no usable managed credential",
    );
  }
  return {
    formatVersion: 1 as const,
    keyId: row.bundle_key_id,
    ciphertext: row.bundle_ciphertext,
    nonce: row.bundle_nonce,
    tag: row.bundle_tag,
  };
}

function decryptBundle(row: ManagedCredentialRow) {
  try {
    return decryptCredentialEnvelope(
      managedEnvelope(row),
      {
        providerId: row.envelope_context_id,
        adapterKind: row.provider_adapter_kind,
        recordKind: "credential",
        recordId: row.credential_id,
        revision: row.credential_revision,
      },
      providerTokenBundleSchema,
    );
  } catch {
    throw gatewayConfigurationError(
      "PROVIDER_MANAGED_CREDENTIAL_UNAVAILABLE",
      "The selected product provider credential could not be decrypted",
    );
  }
}

export function managedBundleExpiresAt(bundle: ProviderTokenBundle) {
  return bundle.product === "github_copilot"
    ? bundle.copilotExpiresAtMs
    : bundle.expiresAtMs;
}

export function managedBundleNeedsRenewal(bundle: ProviderTokenBundle, now: Date) {
  return managedBundleExpiresAt(bundle) <= now.getTime();
}

function bundleExpiryColumns(bundle: ProviderTokenBundle) {
  if (bundle.product === "github_copilot") {
    return {
      accessExpiresAt: new Date(bundle.copilotExpiresAtMs),
      refreshExpiresAt: bundle.sourceExpiresAtMs ? new Date(bundle.sourceExpiresAtMs) : null,
      sessionExpiresAt: null,
    };
  }
  return {
    accessExpiresAt: new Date(bundle.expiresAtMs),
    refreshExpiresAt: null,
    sessionExpiresAt: null,
  };
}

async function loadCredential(
  client: PoolClient,
  input: { providerId: string; adapterKind: ProviderProductKind },
) {
  const { rows } = await client.query<ManagedCredentialRow>(
    `SELECT managed.id AS credential_id,
            provider.id AS provider_id, provider.status AS provider_status,
            provider.adapter_kind AS provider_adapter_kind,
            provider.active_credential_kind, provider.auth_epoch,
            managed.status AS credential_status,
            managed.auth_epoch AS account_auth_epoch,
            managed.revision AS credential_revision,
            managed.envelope_context_id,
            managed.bundle_format_version, managed.bundle_key_id,
            managed.bundle_ciphertext, managed.bundle_nonce, managed.bundle_tag,
            managed.registration_fingerprint,
            managed.refresh_lease_id, managed.refresh_lease_expires_at
       FROM ai_providers AS provider
       JOIN ai_provider_managed_credentials AS managed
         ON managed.provider_id = provider.id
        AND managed.adapter_kind = provider.adapter_kind
        AND managed.id = provider.managed_credential_id
      WHERE provider.id = $1 AND provider.adapter_kind = $2
      LIMIT 1`,
    [input.providerId, input.adapterKind],
  );
  return rows[0];
}

type ManagedCredentialFence = {
  authEpoch: number;
  managedAccountId: string;
  managedAccountAuthEpoch: number;
  credentialRevision?: number;
};

type ManagedCredentialPurpose = "gateway" | "admin_catalog";

function assertCurrentCredential(
  row: ManagedCredentialRow | undefined,
  input: ManagedCredentialFence,
  purpose: ManagedCredentialPurpose,
) {
  if (
    !row
    || (purpose === "gateway"
      ? row.provider_status !== "active"
      : !["active", "disabled"].includes(row.provider_status))
    || row.active_credential_kind !== "managed_oauth"
    || row.credential_status !== "connected"
    || row.auth_epoch !== input.authEpoch
    || row.credential_id !== input.managedAccountId
    || row.account_auth_epoch !== input.managedAccountAuthEpoch
    || (input.credentialRevision !== undefined
      && row.credential_revision < input.credentialRevision)
  ) {
    throw gatewayConfigurationError(
      "PROVIDER_MANAGED_CREDENTIAL_STALE",
      "The selected product provider credential is not currently effective",
      true,
    );
  }
  return row;
}

function assertRegistration(
  row: ManagedCredentialRow,
  registry: ProviderProductRegistry,
) {
  const readiness = registry.readiness(row.provider_adapter_kind);
  if (readiness.status !== "ready" || !readiness.registrationFingerprint) {
    throw gatewayConfigurationError(
      "PROVIDER_PRODUCT_REGISTRATION_UNAVAILABLE",
      "The selected product provider deployment registration is unavailable",
    );
  }
  if (readiness.registrationFingerprint !== row.registration_fingerprint) {
    throw gatewayConfigurationError(
      "PROVIDER_PRODUCT_REGISTRATION_CHANGED",
      "The selected product provider must be authorized again after its deployment registration changed",
    );
  }
}

function buildAccess(
  row: ManagedCredentialRow,
  bundle: ProviderTokenBundle,
  registry: ProviderProductRegistry,
  renewed: boolean,
): ManagedProviderAccess {
  const result = registry.get(row.provider_adapter_kind).getResourceContract();
  if (result.status !== "ready") {
    throw gatewayConfigurationError(result.error.code, result.error.message, result.error.retryable);
  }
  const headerResult = result.contract.buildHeaders(bundle);
  if (headerResult.status !== "ready") {
    throw gatewayConfigurationError(
      headerResult.error.code,
      headerResult.error.message,
      headerResult.error.retryable,
    );
  }
  return {
    adapterKind: row.provider_adapter_kind,
    dialect: result.contract.dialect,
    url: result.contract.url,
    headers: headerResult.headers,
    credentialRevision: row.credential_revision,
    accountId: row.credential_id,
    accountAuthEpoch: row.account_auth_epoch,
    defaultRevision: null,
    renewed,
  };
}

async function releaseRefreshLease(
  withTransaction: typeof withPlatformTransaction,
  row: ManagedCredentialRow,
  leaseId: string,
) {
  await withTransaction(async (client) => {
    await client.query(
      `UPDATE ai_provider_managed_credentials
          SET refresh_lease_id = NULL, refresh_lease_expires_at = NULL,
              updated_at = NOW()
        WHERE id = $1 AND revision = $2 AND refresh_lease_id = $3
          AND provider_id = $4`,
      [row.credential_id, row.credential_revision, leaseId, row.provider_id],
    );
  });
}

async function markReauthorizationRequired(
  withTransaction: typeof withPlatformTransaction,
  row: ManagedCredentialRow,
  leaseId: string,
) {
  await withTransaction(async (client) => {
    await client.query(
      `UPDATE ai_provider_managed_credentials
          SET status = 'reauth_required',
              auth_epoch = auth_epoch + 1,
              refresh_lease_id = NULL, refresh_lease_expires_at = NULL,
              updated_at = NOW()
        WHERE id = $1 AND revision = $2 AND auth_epoch = $3
          AND refresh_lease_id = $4 AND provider_id = $5`,
      [row.credential_id, row.credential_revision, row.account_auth_epoch, leaseId, row.provider_id],
    );
  });
}

async function persistRenewalRejected(
  input: {
    row: ManagedCredentialRow;
    material: import("../providers").ProviderRevocationMaterial;
    registry: ProviderProductRegistry;
    createLeaseId: () => string;
    withTransaction: typeof withPlatformTransaction;
  },
) {
  let jobId: string;
  try {
    jobId = await input.withTransaction(async (client) => {
      const job = await enqueueProviderRevocationJobOnClient(client, {
        providerId: input.row.provider_id,
        adapterKind: input.row.provider_adapter_kind,
        sourceKind: "credential",
        sourceRecordId: input.row.credential_id,
        sourceRecordRevision: input.row.credential_revision,
        sourceAuthEpoch: input.row.account_auth_epoch,
        accountScopeId: input.row.credential_id,
        managedCredentialId: input.row.credential_id,
        credentialAuthEpoch: input.row.account_auth_epoch,
        envelopeContextId: input.row.envelope_context_id,
        reason: "renewal_rejected",
        registrationFingerprint: input.row.registration_fingerprint,
        material: input.material,
      });
      return job.id;
    });
  } catch (error) {
    try {
      await input.registry.get(input.row.provider_adapter_kind).revoke(input.material);
    } catch {
      // The caller still fails closed; no secret or upstream body is surfaced.
    }
    throw error;
  }
  return jobId;
}

async function processRenewalRejected(
  jobId: string | null,
  input: Pick<Parameters<typeof persistRenewalRejected>[0],
    "registry" | "withTransaction" | "createLeaseId">,
) {
  if (!jobId) return;
  await processProviderRevocationJob(jobId, {
    registry: input.registry,
    withTransaction: input.withTransaction,
    createLeaseId: input.createLeaseId,
    force: true,
  }).catch(() => undefined);
}

async function renewCredential(input: {
  row: ManagedCredentialRow;
  bundle: ProviderTokenBundle;
  purpose: ManagedCredentialPurpose;
  registry: ProviderProductRegistry;
  createLeaseId: () => string;
  withTransaction: typeof withPlatformTransaction;
}) {
  const leaseId = input.createLeaseId();
  const expectedSnapshot = {
    authEpoch: input.row.auth_epoch,
    managedAccountId: input.row.credential_id,
    managedAccountAuthEpoch: input.row.account_auth_epoch,
    credentialRevision: input.row.credential_revision,
  };
  const leased = await input.withTransaction(async (client) => {
    const claim = await client.query(
      `UPDATE ai_provider_managed_credentials
          SET refresh_lease_id = $4,
              refresh_lease_expires_at = NOW() + ($5 * interval '1 millisecond'),
              updated_at = NOW()
        WHERE id = $1 AND revision = $2 AND auth_epoch = $3
          AND status = 'connected'
          AND (refresh_lease_id IS NULL OR refresh_lease_expires_at <= NOW())
          AND provider_id = $6`,
      [
        input.row.credential_id,
        input.row.credential_revision,
        input.row.account_auth_epoch,
        leaseId,
        REFRESH_LEASE_MILLISECONDS,
        input.row.provider_id,
      ],
    );
    if (claim.rowCount !== 1) return null;
    return await loadCredential(client, {
      providerId: input.row.provider_id,
      adapterKind: input.row.provider_adapter_kind,
    });
  });
  if (!leased) return { kind: "lost" as const };
  try {
    assertCurrentCredential(leased, expectedSnapshot, input.purpose);
  } catch (error) {
    await releaseRefreshLease(input.withTransaction, input.row, leaseId);
    throw error;
  }

  const lifecycle = await input.registry
    .get(input.row.provider_adapter_kind)
    .refreshOrRenew(input.bundle);
  if (lifecycle.status === "reauthorization_required") {
    let revocationJobId: string | null = null;
    if (lifecycle.revocationHandoff) {
      revocationJobId = await persistRenewalRejected({
        ...input,
        material: lifecycle.revocationHandoff.unwrap(),
      });
    }
    await markReauthorizationRequired(input.withTransaction, input.row, leaseId);
    await processRenewalRejected(revocationJobId, input);
    throw gatewayConfigurationError(
      "PROVIDER_REAUTHORIZATION_REQUIRED",
      "The selected product provider must be authorized again",
    );
  }
  if (lifecycle.status === "failed") {
    if (lifecycle.revocationHandoff) {
      const revocationJobId = await persistRenewalRejected({
        ...input,
        material: lifecycle.revocationHandoff.unwrap(),
      });
      await markReauthorizationRequired(input.withTransaction, input.row, leaseId);
      await processRenewalRejected(revocationJobId, input);
      throw gatewayConfigurationError(
        "PROVIDER_REAUTHORIZATION_REQUIRED",
        "The selected product provider issued a grant that failed post-refresh validation",
      );
    }
    await releaseRefreshLease(input.withTransaction, input.row, leaseId);
    throw gatewayConfigurationError(
      lifecycle.error.code,
      lifecycle.error.message,
      lifecycle.error.retryable,
    );
  }

  const nextRevision = input.row.credential_revision + 1;
  const encrypted = encryptCredentialEnvelope(
    lifecycle.bundle,
    {
      providerId: input.row.envelope_context_id,
      adapterKind: input.row.provider_adapter_kind,
      recordKind: "credential",
      recordId: input.row.credential_id,
      revision: nextRevision,
    },
    providerTokenBundleSchema,
  );
  const expiry = bundleExpiryColumns(lifecycle.bundle);
  const updated = await input.withTransaction(async (client) => {
    const persisted = await client.query(
    `UPDATE ai_provider_managed_credentials
        SET revision = $4,
            bundle_format_version = $5, bundle_key_id = $6,
            bundle_ciphertext = $7, bundle_nonce = $8, bundle_tag = $9,
            access_expires_at = $10, refresh_expires_at = $11,
            session_expires_at = $12,
            granted_scopes = $13::text[],
            refresh_lease_id = NULL, refresh_lease_expires_at = NULL,
            updated_at = NOW()
      WHERE id = $1 AND revision = $2 AND auth_epoch = $3
        AND refresh_lease_id = $14 AND status = 'connected'
        AND provider_id = $15`,
    [
      input.row.credential_id,
      input.row.credential_revision,
      input.row.account_auth_epoch,
      nextRevision,
      encrypted.formatVersion,
      encrypted.keyId,
      encrypted.ciphertext,
      encrypted.nonce,
      encrypted.tag,
      expiry.accessExpiresAt,
      expiry.refreshExpiresAt,
      expiry.sessionExpiresAt,
      [...lifecycle.bundle.grantedScopes],
      leaseId,
      input.row.provider_id,
    ],
    );
    if (persisted.rowCount !== 1) return null;
    return await loadCredential(client, {
      providerId: input.row.provider_id,
      adapterKind: input.row.provider_adapter_kind,
    });
  });
  const current = updated;
  if (!current && lifecycle.revocationHandoff) {
    const revocationJobId = await persistRenewalRejected({
      ...input,
      material: lifecycle.revocationHandoff.unwrap(),
    });
    await processRenewalRejected(revocationJobId, input);
  }
  if (!current) return { kind: "lost" as const };
  assertCurrentCredential(current, {
    ...expectedSnapshot,
    credentialRevision: nextRevision,
  }, input.purpose);
  return { kind: "renewed" as const, row: current, bundle: lifecycle.bundle };
}

type ResolveManagedCredentialInput = ManagedCredentialFence & {
  providerId: string;
  adapterKind: ProviderProductKind;
  forceRenew?: boolean;
  dependencies?: ManagedProviderCredentialDependencies;
};

async function resolveManagedCredential(
  input: ResolveManagedCredentialInput,
  purpose: ManagedCredentialPurpose,
) {
  const registry = input.dependencies?.registry ?? getProviderProductRegistry();
  const now = input.dependencies?.now ?? (() => new Date());
  const createLeaseId = input.dependencies?.createLeaseId ?? randomUUID;
  const sleep = input.dependencies?.sleep
    ?? ((milliseconds: number) => new Promise((resolve) => setTimeout(resolve, milliseconds)));
  const withClient = input.dependencies?.withClient ?? withPlatformClient;
  const withTransaction = input.dependencies?.withTransaction ?? withPlatformTransaction;

  let row = assertCurrentCredential(
    await withClient(async (client) => await loadCredential(client, input)),
    input,
    purpose,
  );
  assertRegistration(row, registry);
  let bundle = decryptBundle(row);
  if (
    input.forceRenew
    && input.credentialRevision !== undefined
    && row.credential_revision > input.credentialRevision
  ) {
    return { row, bundle, registry, renewed: true };
  }
  if (!input.forceRenew && !managedBundleNeedsRenewal(bundle, now())) {
    return { row, bundle, registry, renewed: false };
  }

  for (let attempt = 0; attempt <= LEASE_LOSER_RETRIES; attempt += 1) {
    const observedRevision = row.credential_revision;
    const renewal = await renewCredential({
      row,
      bundle,
      purpose,
      registry,
      createLeaseId,
      withTransaction,
    });
    if (renewal.kind === "renewed") {
      return { row: renewal.row, bundle: renewal.bundle, registry, renewed: true };
    }
    if (attempt === LEASE_LOSER_RETRIES) break;
    await sleep(leaseLoserWaitMilliseconds(attempt));
    row = assertCurrentCredential(
      await withClient(async (client) => await loadCredential(client, input)),
      input,
      purpose,
    );
    assertRegistration(row, registry);
    bundle = decryptBundle(row);
    if (row.credential_revision > observedRevision) {
      return { row, bundle, registry, renewed: true };
    }
  }
  throw gatewayConfigurationError(
    "PROVIDER_CREDENTIAL_RENEWAL_IN_PROGRESS",
    "The selected product provider credential is being renewed",
    true,
  );
}

export async function resolveManagedProviderAccess(input: {
  providerId: string;
  adapterKind: ProviderProductKind;
  authEpoch: number;
  managedAccountId: string;
  managedAccountAuthEpoch: number;
  /** @deprecated Product-wide defaults are retired; accepted and ignored for caller compatibility. */
  managedDefaultRevision?: number;
  credentialRevision?: number;
  forceRenew?: boolean;
  dependencies?: ManagedProviderCredentialDependencies;
}): Promise<ManagedProviderAccess> {
  const resolved = await resolveManagedCredential(input, "gateway");
  return buildAccess(resolved.row, resolved.bundle, resolved.registry, resolved.renewed);
}

export async function resolveManagedProviderCatalogAccess(input: {
  providerId: string;
  adapterKind: ProviderProductKind;
  authEpoch: number;
  managedAccountId: string;
  managedAccountAuthEpoch: number;
  credentialRevision?: number;
  dependencies?: ManagedProviderCredentialDependencies;
}): Promise<ManagedProviderCatalogAccess> {
  const resolved = await resolveManagedCredential(input, "admin_catalog");
  const result = await resolved.registry
    .get(resolved.row.provider_adapter_kind)
    .fetchModelCatalog(resolved.bundle);
  if (result.status !== "ready") {
    throw gatewayConfigurationError(
      result.error.code,
      result.error.message,
      result.error.retryable,
    );
  }
  if (result.product !== resolved.row.provider_adapter_kind) {
    throw gatewayConfigurationError(
      "PROVIDER_MODEL_CATALOG_PRODUCT_MISMATCH",
      "The managed Provider returned a model catalog for a different product",
    );
  }
  return {
    adapterKind: resolved.row.provider_adapter_kind,
    endpoint: result.endpoint,
    models: result.models.map((model) => ({
      id: model.id,
      displayName: model.displayName,
      vendor: model.vendor,
      upstreamDialect: model.upstreamDialect,
      gatewayCompatible: model.gatewayCompatible,
      capabilities: [...model.capabilities],
    })),
    authEpoch: resolved.row.auth_epoch,
    credentialRevision: resolved.row.credential_revision,
    accountId: resolved.row.credential_id,
    accountAuthEpoch: resolved.row.account_auth_epoch,
    registrationFingerprint: resolved.row.registration_fingerprint,
    renewed: resolved.renewed,
  };
}
