// [Input] Encrypted product bundles, fake PostgreSQL CAS results, and a controlled Provider registry.
// [Output] Regression proof for Provider-owned inference/catalog resolution, generation fencing, refresh rotation, and lease-loser rereads.
// [Pos] Unit contract for the shared managed credential broker used by Gateway inference and Admin catalog discovery.
// [Sync] 2026-09-04: allow disabled Providers only for secret-safe Admin catalogs while preserving active-only Gateway access.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const revocationMocks = vi.hoisted(() => ({
  enqueue: vi.fn().mockResolvedValue({ id: "revocationjob-gateway" }),
  process: vi.fn().mockResolvedValue({ status: "succeeded" }),
}));

vi.mock("../provider-auth/revocation-jobs", () => ({
  enqueueProviderRevocationJobOnClient: revocationMocks.enqueue,
  processProviderRevocationJob: revocationMocks.process,
}));

import {
  providerTokenBundleSchema,
  createProviderRevocationHandoff,
  type ProviderProductRegistry,
  type ProviderTokenBundle,
  type XaiTokenBundle,
} from "../providers";
import { encryptCredentialEnvelope } from "../security/credential-envelope";
import {
  managedBundleNeedsRenewal,
  resolveManagedProviderCatalogAccess,
  resolveManagedProviderAccess,
} from "./managed-provider-credentials";

const providerId = "provider-1";
const credentialId = "credential-1";
const bundle: XaiTokenBundle = {
  product: "xai",
  accessToken: "access-old",
  refreshToken: "refresh-old",
  expiresAtMs: 1_000,
  grantedScopes: ["openid"],
  identity: { subject: "subject-1" },
};

function encrypted(value: ProviderTokenBundle, revision: number) {
  const result = encryptCredentialEnvelope(
    value,
    {
      providerId: credentialId,
      adapterKind: "xai",
      recordKind: "credential",
      recordId: credentialId,
      revision,
    },
    providerTokenBundleSchema,
  );
  return {
    bundle_format_version: result.formatVersion,
    bundle_key_id: result.keyId,
    bundle_ciphertext: result.ciphertext,
    bundle_nonce: result.nonce,
    bundle_tag: result.tag,
  };
}

function row(
  value: ProviderTokenBundle = bundle,
  revision = 1,
  overrides: Record<string, unknown> = {},
) {
  return {
    credential_id: credentialId,
    provider_id: providerId,
    provider_status: "active",
    provider_adapter_kind: "xai",
    active_credential_kind: "managed_oauth",
    auth_epoch: 3,
    credential_status: "connected",
    account_auth_epoch: 1,
    credential_revision: revision,
    envelope_context_id: credentialId,
    registration_fingerprint: "registration-1",
    refresh_lease_id: null,
    refresh_lease_expires_at: null,
    ...encrypted(value, revision),
    ...overrides,
  };
}

function registry(
  refreshOrRenew = vi.fn(),
  fetchModelCatalog = vi.fn().mockResolvedValue({
    status: "ready",
    product: "xai",
    endpoint: "https://api.x.ai/v1/models",
    models: [{
      id: "grok-4",
      displayName: "Grok 4",
      vendor: "xAI",
      upstreamDialect: "openai_responses",
      gatewayCompatible: true,
      capabilities: ["chat"],
    }],
  }),
) {
  return {
    readiness: () => ({
      status: "ready",
      product: "xai",
      registrationFingerprint: "registration-1",
      oauthAppConfigured: true,
      integrationProfileConfigured: null,
      copilotAccessVerified: null,
      capabilities: {
        deviceAuthorization: true,
        refreshOrRenew: true,
        remoteRevoke: true,
        modelResource: true,
      },
    }),
    get: () => ({
      product: "xai",
      readiness: vi.fn(),
      startDevice: vi.fn(),
      pollDevice: vi.fn(),
      refreshOrRenew,
      revoke: vi.fn(),
      fetchModelCatalog,
      getResourceContract: () => ({
        status: "ready",
        product: "xai",
        contract: {
          product: "xai",
          dialect: "openai_responses",
          url: "https://api.x.ai/v1/responses",
          managedHeaderNames: ["authorization"],
          buildHeaders: (current: ProviderTokenBundle) => ({
            status: "ready",
            headers: new Headers({
              authorization: `Bearer ${current.product === "xai" ? current.accessToken : "invalid"}`,
            }),
          }),
        },
      }),
    }),
    allReadiness: vi.fn(),
  } as unknown as ProviderProductRegistry;
}

function withRows(rows: unknown[]) {
  return (async (handler: (client: { query: () => Promise<unknown> }) => Promise<unknown>) =>
    await handler({ query: async () => ({ rows, rowCount: rows.length }) })) as never;
}

beforeEach(() => {
  vi.clearAllMocks();
  process.env.AI_CREDENTIAL_ENCRYPTION_KEY = "11".repeat(32);
});

afterEach(() => {
  delete process.env.AI_CREDENTIAL_ENCRYPTION_KEY;
});

describe("managed credential broker", () => {
  it("uses an unexpired current bundle without entering a refresh transaction", async () => {
    const withTransaction = vi.fn();
    const access = await resolveManagedProviderAccess({
      providerId,
      adapterKind: "xai",
      authEpoch: 3,
      managedAccountId: credentialId,
      managedAccountAuthEpoch: 1,
      credentialRevision: 1,
      dependencies: {
        registry: registry(),
        now: () => new Date(500),
        withClient: withRows([row()]),
        withTransaction: withTransaction as never,
      },
    });
    expect(access).toMatchObject({
      dialect: "openai_responses",
      credentialRevision: 1,
      renewed: false,
    });
    expect(access.headers.get("authorization")).toBe("Bearer access-old");
    expect(withTransaction).not.toHaveBeenCalled();
  });

  it("resolves only the credential directly owned and selected by the Provider", async () => {
    const queries: string[] = [];
    const withClient = (async (
      handler: (client: { query: (sql: string) => Promise<unknown> }) => Promise<unknown>,
    ) => await handler({
      query: async (sql: string) => {
        queries.push(sql);
        return { rows: [row()], rowCount: 1 };
      },
    })) as never;

    const access = await resolveManagedProviderAccess({
      providerId,
      adapterKind: "xai",
      authEpoch: 3,
      managedAccountId: credentialId,
      managedAccountAuthEpoch: 1,
      credentialRevision: 1,
      dependencies: {
        registry: registry(),
        now: () => new Date(500),
        withClient,
      },
    });

    expect(access).toMatchObject({
      accountId: credentialId,
      accountAuthEpoch: 1,
      defaultRevision: null,
    });
    expect(queries[0]).toContain("managed.provider_id = provider.id");
    expect(queries[0]).toContain("managed.id = provider.managed_credential_id");
    expect(queries[0]).not.toContain("ai_provider_managed_account_defaults");
  });

  it("allows a disabled Provider only through the explicit secret-safe Admin catalog path", async () => {
    const fetchModelCatalog = vi.fn().mockResolvedValue({
      status: "ready",
      product: "xai",
      endpoint: "https://api.x.ai/v1/models",
      models: [{
        id: "grok-4",
        displayName: "Grok 4",
        vendor: "xAI",
        upstreamDialect: "openai_responses",
        gatewayCompatible: true,
        capabilities: ["chat", "tools"],
        internalToken: "catalog-model-secret",
      }],
    });
    const productRegistry = registry(vi.fn(), fetchModelCatalog);
    const disabledRow = row(bundle, 1, { provider_status: "disabled" });
    const withTransaction = vi.fn();

    const catalog = await resolveManagedProviderCatalogAccess({
      providerId,
      adapterKind: "xai",
      authEpoch: 3,
      managedAccountId: credentialId,
      managedAccountAuthEpoch: 1,
      credentialRevision: 1,
      dependencies: {
        registry: productRegistry,
        now: () => new Date(500),
        withClient: withRows([disabledRow]),
        withTransaction: withTransaction as never,
      },
    });

    expect(fetchModelCatalog).toHaveBeenCalledWith(bundle);
    expect(catalog).toMatchObject({
      adapterKind: "xai",
      endpoint: "https://api.x.ai/v1/models",
      authEpoch: 3,
      credentialRevision: 1,
      accountId: credentialId,
      accountAuthEpoch: 1,
      registrationFingerprint: "registration-1",
      renewed: false,
      models: [expect.objectContaining({ id: "grok-4", gatewayCompatible: true })],
    });
    expect(JSON.stringify(catalog)).not.toContain(bundle.accessToken);
    expect(JSON.stringify(catalog)).not.toContain(bundle.refreshToken);
    expect(JSON.stringify(catalog)).not.toContain("catalog-model-secret");
    expect(withTransaction).not.toHaveBeenCalled();

    await expect(resolveManagedProviderAccess({
      providerId,
      adapterKind: "xai",
      authEpoch: 3,
      managedAccountId: credentialId,
      managedAccountAuthEpoch: 1,
      credentialRevision: 1,
      dependencies: {
        registry: productRegistry,
        now: () => new Date(500),
        withClient: withRows([disabledRow]),
      },
    })).rejects.toMatchObject({ code: "PROVIDER_MANAGED_CREDENTIAL_STALE" });
  });

  it.each<[string, Record<string, unknown>, number]>([
    ["deleted Provider", { provider_status: "deleted" }, 1],
    ["inactive credential pointer", { active_credential_kind: "none" }, 1],
    ["disconnected credential", { credential_status: "disconnected" }, 1],
    ["stale Provider generation", { auth_epoch: 4 }, 1],
    ["stale account generation", { account_auth_epoch: 2 }, 1],
    ["stale credential generation", {}, 2],
  ])("rejects Admin catalog access for a %s", async (_label, overrides, credentialRevision) => {
    const fetchModelCatalog = vi.fn();
    await expect(resolveManagedProviderCatalogAccess({
      providerId,
      adapterKind: "xai",
      authEpoch: 3,
      managedAccountId: credentialId,
      managedAccountAuthEpoch: 1,
      credentialRevision,
      dependencies: {
        registry: registry(vi.fn(), fetchModelCatalog),
        withClient: withRows([row(bundle, 1, overrides)]),
      },
    })).rejects.toMatchObject({ code: "PROVIDER_MANAGED_CREDENTIAL_STALE" });
    expect(fetchModelCatalog).not.toHaveBeenCalled();
  });

  it("rejects Admin catalog access before decryption when registration changed", async () => {
    const fetchModelCatalog = vi.fn();
    const changed = registry(vi.fn(), fetchModelCatalog);
    vi.spyOn(changed, "readiness").mockReturnValue({
      ...changed.readiness("xai"),
      registrationFingerprint: "registration-2",
    } as ReturnType<ProviderProductRegistry["readiness"]>);

    await expect(resolveManagedProviderCatalogAccess({
      providerId,
      adapterKind: "xai",
      authEpoch: 3,
      managedAccountId: credentialId,
      managedAccountAuthEpoch: 1,
      dependencies: {
        registry: changed,
        withClient: withRows([row(bundle, 1, { bundle_tag: "unreadable" })]),
      },
    })).rejects.toMatchObject({ code: "PROVIDER_PRODUCT_REGISTRATION_CHANGED" });
    expect(fetchModelCatalog).not.toHaveBeenCalled();
  });

  it("rejects an unreadable Admin catalog envelope without invoking the adapter", async () => {
    const fetchModelCatalog = vi.fn();
    await expect(resolveManagedProviderCatalogAccess({
      providerId,
      adapterKind: "xai",
      authEpoch: 3,
      managedAccountId: credentialId,
      managedAccountAuthEpoch: 1,
      dependencies: {
        registry: registry(vi.fn(), fetchModelCatalog),
        withClient: withRows([row(bundle, 1, { bundle_tag: "unreadable" })]),
      },
    })).rejects.toMatchObject({ code: "PROVIDER_MANAGED_CREDENTIAL_UNAVAILABLE" });
    expect(fetchModelCatalog).not.toHaveBeenCalled();
  });

  it("rejects a stale managed account auth epoch before renewal or decryption", async () => {
    const withTransaction = vi.fn();
    await expect(resolveManagedProviderAccess({
      providerId,
      adapterKind: "xai",
      authEpoch: 3,
      managedAccountId: credentialId,
      managedAccountAuthEpoch: 2,
      credentialRevision: 1,
      dependencies: {
        registry: registry(),
        withClient: withRows([row()]),
        withTransaction: withTransaction as never,
      },
    })).rejects.toMatchObject({
      code: "PROVIDER_MANAGED_CREDENTIAL_STALE",
      retryable: true,
    });
    expect(withTransaction).not.toHaveBeenCalled();
  });

  it("fails closed before decryption when the deployment registration changed", async () => {
    const changed = registry();
    vi.spyOn(changed, "readiness").mockReturnValue({
      ...changed.readiness("xai"),
      registrationFingerprint: "registration-2",
    } as ReturnType<ProviderProductRegistry["readiness"]>);
    await expect(resolveManagedProviderAccess({
      providerId,
      adapterKind: "xai",
      authEpoch: 3,
      managedAccountId: credentialId,
      managedAccountAuthEpoch: 1,
      dependencies: {
        registry: changed,
        withClient: withRows([row()]),
      },
    })).rejects.toMatchObject({ code: "PROVIDER_PRODUCT_REGISTRATION_CHANGED" });
  });

  it("rotates the complete encrypted bundle under a refresh lease and revision CAS", async () => {
    const next: ProviderTokenBundle = {
      ...bundle,
      accessToken: "access-new",
      refreshToken: "refresh-new",
      expiresAtMs: 20_000,
    };
    const refreshOrRenew = vi.fn().mockResolvedValue({
      status: "ready",
      product: "xai",
      bundle: next,
      rotated: true,
    });
    const queries: Array<{ sql: string; values?: unknown[] }> = [];
    let current = row();
    const withTransaction = (async (handler: (client: { query: (sql: string, values?: unknown[]) => Promise<unknown> }) => Promise<unknown>) =>
      await handler({
        query: async (sql: string, values?: unknown[]) => {
          queries.push({ sql, values });
          if (sql.includes("SET refresh_lease_id = $4")) return { rows: [], rowCount: 1 };
          if (sql.includes("SET revision = $4")) {
            current = row(next, 2);
            return { rows: [], rowCount: 1 };
          }
          if (sql.includes("SELECT managed.id AS credential_id")) {
            return { rows: [current], rowCount: 1 };
          }
          return { rows: [], rowCount: 0 };
        },
      })) as never;

    const access = await resolveManagedProviderAccess({
      providerId,
      adapterKind: "xai",
      authEpoch: 3,
      managedAccountId: credentialId,
      managedAccountAuthEpoch: 1,
      credentialRevision: 1,
      dependencies: {
        registry: registry(refreshOrRenew),
        now: () => new Date(2_000),
        createLeaseId: () => "lease-1",
        withClient: withRows([row()]),
        withTransaction,
      },
    });
    expect(refreshOrRenew).toHaveBeenCalledOnce();
    const lease = queries.find(({ sql }) => sql.includes("SET refresh_lease_id = $4"));
    expect(lease?.sql).toContain("NOW() + ($5 * interval '1 millisecond')");
    expect(lease?.values?.[4]).toBe(90_000);
    const rotation = queries.find(({ sql }) => sql.includes("refresh_lease_id = $14"));
    expect(rotation?.values?.[12]).toEqual(["openid"]);
    expect(rotation?.values?.[13]).toBe("lease-1");
    expect(access).toMatchObject({ credentialRevision: 2, renewed: true });
    expect(access.headers.get("authorization")).toBe("Bearer access-new");
  });

  it("reuses the refresh lease and rotated bundle before fetching an Admin catalog", async () => {
    const next: ProviderTokenBundle = {
      ...bundle,
      accessToken: "catalog-access-new",
      refreshToken: "catalog-refresh-new",
      expiresAtMs: 20_000,
    };
    const refreshOrRenew = vi.fn().mockResolvedValue({
      status: "ready",
      product: "xai",
      bundle: next,
      rotated: true,
    });
    const fetchModelCatalog = vi.fn().mockResolvedValue({
      status: "ready",
      product: "xai",
      endpoint: "https://api.x.ai/v1/models",
      models: [],
    });
    let current = row(bundle, 1, { provider_status: "disabled" });
    const withTransaction = (async (
      handler: (client: { query: (sql: string) => Promise<unknown> }) => Promise<unknown>,
    ) => await handler({
      query: async (sql: string) => {
        if (sql.includes("SET refresh_lease_id = $4")) return { rows: [], rowCount: 1 };
        if (sql.includes("SET revision = $4")) {
          current = row(next, 2, { provider_status: "disabled" });
          return { rows: [], rowCount: 1 };
        }
        if (sql.includes("SELECT managed.id AS credential_id")) {
          return { rows: [current], rowCount: 1 };
        }
        return { rows: [], rowCount: 0 };
      },
    })) as never;

    const catalog = await resolveManagedProviderCatalogAccess({
      providerId,
      adapterKind: "xai",
      authEpoch: 3,
      managedAccountId: credentialId,
      managedAccountAuthEpoch: 1,
      credentialRevision: 1,
      dependencies: {
        registry: registry(refreshOrRenew, fetchModelCatalog),
        now: () => new Date(2_000),
        createLeaseId: () => "catalog-lease",
        withClient: withRows([current]),
        withTransaction,
      },
    });

    expect(refreshOrRenew).toHaveBeenCalledWith(bundle);
    expect(fetchModelCatalog).toHaveBeenCalledWith(next);
    expect(catalog).toMatchObject({ credentialRevision: 2, renewed: true });
    expect(JSON.stringify(catalog)).not.toContain("catalog-access-new");
    expect(JSON.stringify(catalog)).not.toContain("catalog-refresh-new");
  });

  it("waits and rereads a winner's revision instead of issuing a second refresh", async () => {
    const next: ProviderTokenBundle = {
      ...bundle,
      accessToken: "winner-access",
      expiresAtMs: 20_000,
    };
    let reads = 0;
    const withClient = (async (handler: (client: { query: () => Promise<unknown> }) => Promise<unknown>) =>
      await handler({
        query: async () => {
          reads += 1;
          return { rows: [reads === 1 ? row() : row(next, 2)], rowCount: 1 };
        },
      })) as never;
    const refreshOrRenew = vi.fn();
    const access = await resolveManagedProviderAccess({
      providerId,
      adapterKind: "xai",
      authEpoch: 3,
      managedAccountId: credentialId,
      managedAccountAuthEpoch: 1,
      credentialRevision: 1,
      dependencies: {
        registry: registry(refreshOrRenew),
        now: () => new Date(2_000),
        withClient,
        withTransaction: withRows([]),
        sleep: async () => undefined,
      },
    });
    expect(refreshOrRenew).not.toHaveBeenCalled();
    expect(access).toMatchObject({ credentialRevision: 2, renewed: true });
    expect(access.headers.get("authorization")).toBe("Bearer winner-access");
  });

  it("uses bounded backoff instead of failing concurrent lease losers after 150ms", async () => {
    const waits: number[] = [];
    await expect(resolveManagedProviderAccess({
      providerId,
      adapterKind: "xai",
      authEpoch: 3,
      managedAccountId: credentialId,
      managedAccountAuthEpoch: 1,
      credentialRevision: 1,
      dependencies: {
        registry: registry(vi.fn()),
        now: () => new Date(2_000),
        withClient: withRows([row()]),
        withTransaction: withRows([]),
        sleep: async (milliseconds) => { waits.push(milliseconds); },
      },
    })).rejects.toMatchObject({
      code: "PROVIDER_CREDENTIAL_RENEWAL_IN_PROGRESS",
      retryable: true,
    });
    expect(waits).toEqual([100, 200, 400, 800, 1_000, 1_000, 1_000, 1_000]);
  });

  it("reuses a winner's newer revision for a forced 401 renewal", async () => {
    const next: ProviderTokenBundle = {
      ...bundle,
      accessToken: "winner-access",
      expiresAtMs: 20_000,
    };
    const refreshOrRenew = vi.fn();
    const withTransaction = vi.fn();
    const access = await resolveManagedProviderAccess({
      providerId,
      adapterKind: "xai",
      authEpoch: 3,
      managedAccountId: credentialId,
      managedAccountAuthEpoch: 1,
      credentialRevision: 1,
      forceRenew: true,
      dependencies: {
        registry: registry(refreshOrRenew),
        now: () => new Date(2_000),
        withClient: withRows([row(next, 2)]),
        withTransaction: withTransaction as never,
      },
    });
    expect(refreshOrRenew).not.toHaveBeenCalled();
    expect(withTransaction).not.toHaveBeenCalled();
    expect(access).toMatchObject({ credentialRevision: 2, renewed: true });
    expect(access.headers.get("authorization")).toBe("Bearer winner-access");
  });

  it("fences the Provider when refresh requires a new authorization", async () => {
    const refreshOrRenew = vi.fn().mockResolvedValue({
      status: "reauthorization_required",
      product: "xai",
      reason: "invalid_grant",
    });
    const queries: string[] = [];
    const withTransaction = (async (handler: (client: { query: (sql: string) => Promise<unknown> }) => Promise<unknown>) =>
      await handler({
        query: async (sql: string) => {
          queries.push(sql);
          if (sql.includes("SET refresh_lease_id = $4")) {
            return { rows: [], rowCount: 1 };
          }
          if (sql.includes("SELECT managed.id AS credential_id")) {
            return { rows: [row()], rowCount: 1 };
          }
          if (sql.includes("SET status = 'reauth_required'")) {
            return { rows: [{ provider_id: providerId }], rowCount: 1 };
          }
          return { rows: [], rowCount: 1 };
        },
      })) as never;

    await expect(resolveManagedProviderAccess({
      providerId,
      adapterKind: "xai",
      authEpoch: 3,
      managedAccountId: credentialId,
      managedAccountAuthEpoch: 1,
      credentialRevision: 1,
      dependencies: {
        registry: registry(refreshOrRenew),
        now: () => new Date(2_000),
        createLeaseId: () => "lease-reauth",
        withClient: withRows([row()]),
        withTransaction,
      },
    })).rejects.toMatchObject({ code: "PROVIDER_REAUTHORIZATION_REQUIRED" });
    expect(queries.some((sql) => sql.includes("SET status = 'reauth_required'"))).toBe(true);
    expect(queries.some((sql) => sql.includes("auth_epoch = auth_epoch + 1"))).toBe(true);
  });

  it("durably hands a rotated grant to revocation before fencing reauthorization", async () => {
    const refreshOrRenew = vi.fn().mockResolvedValue({
      status: "reauthorization_required",
      product: "xai",
      reason: "identity_changed",
      revocationHandoff: createProviderRevocationHandoff({
        product: "xai",
        refreshToken: "rotated-refresh-never-log",
      }),
    });
    const withTransaction = (async (
      handler: (client: { query: (sql: string) => Promise<unknown> }) => Promise<unknown>,
    ) => await handler({
      query: async (sql: string) => {
        if (sql.includes("SET refresh_lease_id = $4")) return { rows: [], rowCount: 1 };
        if (sql.includes("SELECT managed.id AS credential_id")) {
          return { rows: [row()], rowCount: 1 };
        }
        if (sql.includes("SET status = 'reauth_required'")) {
          return { rows: [{ provider_id: providerId }], rowCount: 1 };
        }
        return { rows: [{ id: providerId }], rowCount: 1 };
      },
    })) as never;

    await expect(resolveManagedProviderAccess({
      providerId,
      adapterKind: "xai",
      authEpoch: 3,
      managedAccountId: credentialId,
      managedAccountAuthEpoch: 1,
      dependencies: {
        registry: registry(refreshOrRenew),
        now: () => new Date(2_000),
        createLeaseId: () => "lease-handoff",
        withClient: withRows([row()]),
        withTransaction,
      },
    })).rejects.toMatchObject({ code: "PROVIDER_REAUTHORIZATION_REQUIRED" });

    expect(revocationMocks.enqueue).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      providerId,
      sourceRecordRevision: 1,
      sourceAuthEpoch: 1,
      accountScopeId: credentialId,
      managedCredentialId: credentialId,
      credentialAuthEpoch: 1,
      reason: "renewal_rejected",
      material: { product: "xai", refreshToken: "rotated-refresh-never-log" },
    }));
    expect(revocationMocks.process).toHaveBeenCalledWith(
      "revocationjob-gateway",
      expect.objectContaining({ force: true }),
    );
  });

  it("queues a rotated CAS-loser grant before using the winner revision", async () => {
    const next: XaiTokenBundle = {
      ...bundle,
      accessToken: "loser-access",
      refreshToken: "loser-refresh",
      expiresAtMs: 20_000,
    };
    const winner: XaiTokenBundle = {
      ...bundle,
      accessToken: "winner-access",
      refreshToken: "winner-refresh",
      expiresAtMs: 20_000,
    };
    const refreshOrRenew = vi.fn().mockResolvedValue({
      status: "ready",
      product: "xai",
      bundle: next,
      rotated: true,
      revocationHandoff: createProviderRevocationHandoff({
        product: "xai",
        refreshToken: "loser-refresh",
      }),
    });
    let reads = 0;
    const withClient = (async (
      handler: (client: { query: () => Promise<unknown> }) => Promise<unknown>,
    ) => await handler({
      query: async () => {
        reads += 1;
        return { rows: [reads === 1 ? row() : row(winner, 2)], rowCount: 1 };
      },
    })) as never;
    const withTransaction = (async (
      handler: (client: { query: (sql: string) => Promise<unknown> }) => Promise<unknown>,
    ) => await handler({
      query: async (sql: string) => {
        if (sql.includes("SET refresh_lease_id = $4")) return { rows: [], rowCount: 1 };
        if (sql.includes("SELECT managed.id AS credential_id")) {
          return { rows: [row()], rowCount: 1 };
        }
        if (sql.includes("SET revision = $4")) return { rows: [], rowCount: 0 };
        return { rows: [{ id: providerId }], rowCount: 1 };
      },
    })) as never;

    const access = await resolveManagedProviderAccess({
      providerId,
      adapterKind: "xai",
      authEpoch: 3,
      managedAccountId: credentialId,
      managedAccountAuthEpoch: 1,
      dependencies: {
        registry: registry(refreshOrRenew),
        now: () => new Date(2_000),
        createLeaseId: () => "lease-loser",
        withClient,
        withTransaction,
        sleep: async () => undefined,
      },
    });

    expect(access.headers.get("authorization")).toBe("Bearer winner-access");
    expect(revocationMocks.enqueue).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      reason: "renewal_rejected",
      material: { product: "xai", refreshToken: "loser-refresh" },
    }));
  });

  it("derives expiry from each product bundle rather than a shared token shape", () => {
    expect(managedBundleNeedsRenewal(bundle, new Date(1_001))).toBe(true);
    expect(managedBundleNeedsRenewal({
      product: "github_copilot",
      sourceAccessToken: "source",
      copilotAccessToken: "short",
      copilotExpiresAtMs: 5_000,
      grantedScopes: ["read:user"],
      identity: { numericId: 1, login: "octo" },
    }, new Date(4_999))).toBe(false);
  });
});
