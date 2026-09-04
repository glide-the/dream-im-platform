// [Input] Deployment-owned provider registrations, device grants, token bundles, and injected HTTP dependencies.
// [Output] Shared protocol results, safe account model catalogs, and product-minimal revocation handoffs.
// [Pos] Secret-aware product boundary; persistence and database ownership remain outside this directory.
// [Sync] 2026-09-04: add account-scoped model catalog results without exposing raw upstream payloads.

export type ProviderProductKind = "codex" | "xai" | "github_copilot";

export type ProviderErrorCategory =
  | "configuration"
  | "network"
  | "protocol"
  | "authorization"
  | "entitlement";

export type SafeProviderError = Readonly<{
  code: string;
  category: ProviderErrorCategory;
  message: string;
  retryable: boolean;
  httpStatus?: number;
}>;

export type ProviderReadiness =
  | Readonly<{
      status: "ready";
      product: ProviderProductKind;
      registrationFingerprint: string;
      oauthAppConfigured: true;
      integrationProfileConfigured: boolean | null;
      copilotAccessVerified: null;
      capabilities: Readonly<{
        deviceAuthorization: true;
        refreshOrRenew: true;
        remoteRevoke: boolean;
        modelResource: true;
      }>;
    }>
  | Readonly<{
      status: "not_configured" | "invalid_configuration";
      product: ProviderProductKind;
      registrationFingerprint: null;
      oauthAppConfigured: boolean;
      integrationProfileConfigured: boolean | null;
      copilotAccessVerified: null;
      missingFields: readonly string[];
      error: SafeProviderError;
    }>;

export type DeviceFlowState = Readonly<{
  product: ProviderProductKind;
  deviceCode: string;
  userCode: string;
  verificationUri: string;
  verificationUriComplete?: string;
  expiresInSeconds: number;
  intervalSeconds: number;
}>;

export type DeviceStartResult =
  | Readonly<{
      status: "verification_required";
      product: ProviderProductKind;
      flow: DeviceFlowState;
    }>
  | ProviderOperationFailure;

export type CodexIdentity = Readonly<{
  subject: string;
  chatgptAccountId: string;
}>;

export type XaiIdentity = Readonly<{
  subject: string;
}>;

export type GitHubCopilotIdentity = Readonly<{
  numericId: number;
  login: string;
}>;

export type CodexTokenBundle = Readonly<{
  product: "codex";
  accessToken: string;
  refreshToken: string;
  idToken?: string;
  expiresAtMs: number;
  grantedScopes: readonly string[];
  identity: CodexIdentity;
}>;

export type XaiTokenBundle = Readonly<{
  product: "xai";
  accessToken: string;
  refreshToken: string;
  idToken?: string;
  expiresAtMs: number;
  grantedScopes: readonly string[];
  identity: XaiIdentity;
}>;

export type GitHubCopilotTokenBundle = Readonly<{
  product: "github_copilot";
  sourceAccessToken: string;
  sourceRefreshToken?: string;
  sourceExpiresAtMs?: number;
  copilotAccessToken: string;
  copilotExpiresAtMs: number;
  grantedScopes: readonly string[];
  identity: GitHubCopilotIdentity;
}>;

export type ProviderTokenBundle =
  | CodexTokenBundle
  | XaiTokenBundle
  | GitHubCopilotTokenBundle;

export type ProviderRevocationMaterial =
  | Readonly<{ product: "codex"; refreshToken: string }>
  | Readonly<{ product: "xai"; refreshToken: string }>
  | Readonly<{ product: "github_copilot"; sourceAccessToken: string }>;

export class ProviderRevocationHandoff {
  constructor(private readonly material: ProviderRevocationMaterial) {}

  unwrap(): ProviderRevocationMaterial {
    return this.material;
  }

  toJSON(): undefined {
    return undefined;
  }
}

export function createProviderRevocationHandoff(material: ProviderRevocationMaterial) {
  return new ProviderRevocationHandoff(material);
}

export type ProviderOperationFailure = Readonly<{
  status: "failed";
  product: ProviderProductKind;
  error: SafeProviderError;
  revocationHandoff?: ProviderRevocationHandoff;
}>;

export type DevicePollResult =
  | Readonly<{
      status: "pending";
      product: ProviderProductKind;
      retryAfterSeconds: number;
    }>
  | Readonly<{
      status: "slow_down";
      product: ProviderProductKind;
      retryAfterSeconds: number;
    }>
  | Readonly<{
      status: "denied";
      product: ProviderProductKind;
    }>
  | Readonly<{
      status: "expired";
      product: ProviderProductKind;
    }>
  | Readonly<{
      status: "connected";
      product: ProviderProductKind;
      bundle: ProviderTokenBundle;
    }>
  | ProviderOperationFailure;

export type TokenLifecycleResult =
  | Readonly<{
      status: "ready";
      product: ProviderProductKind;
      bundle: ProviderTokenBundle;
      rotated: boolean;
      revocationHandoff?: ProviderRevocationHandoff;
    }>
  | Readonly<{
      status: "reauthorization_required";
      product: ProviderProductKind;
      reason: "invalid_grant" | "identity_changed" | "source_token_expired";
      revocationHandoff?: ProviderRevocationHandoff;
    }>
  | ProviderOperationFailure;

export type RevokeResult =
  | Readonly<{
      status: "revoked";
      product: ProviderProductKind;
      remote: true;
    }>
  | Readonly<{
      status: "unsupported";
      product: ProviderProductKind;
      reason: "remote_revoke_not_configured";
    }>
  | ProviderOperationFailure;

export type ResourceHeadersResult =
  | Readonly<{ status: "ready"; headers: Headers }>
  | ProviderOperationFailure;

export type ProviderResourceContract = Readonly<{
  product: ProviderProductKind;
  dialect: "openai_responses" | "openai_chat";
  url: string;
  managedHeaderNames: readonly string[];
  buildHeaders(bundle: ProviderTokenBundle): ResourceHeadersResult;
}>;

export type ResourceContractResult =
  | Readonly<{
      status: "ready";
      product: ProviderProductKind;
      contract: ProviderResourceContract;
    }>
  | ProviderOperationFailure;

export type ProviderUpstreamDialect = "openai_responses" | "openai_chat";

export type ProviderCatalogModel = Readonly<{
  id: string;
  displayName: string;
  vendor: string;
  upstreamDialect: ProviderUpstreamDialect;
  gatewayCompatible: boolean;
  capabilities: readonly string[];
}>;

export type ProviderModelCatalogResult =
  | Readonly<{
      status: "ready";
      product: ProviderProductKind;
      endpoint: string;
      models: readonly ProviderCatalogModel[];
    }>
  | ProviderOperationFailure;

export interface ProviderProductAdapter {
  readonly product: ProviderProductKind;
  readiness(): ProviderReadiness;
  startDevice(): Promise<DeviceStartResult>;
  pollDevice(flow: DeviceFlowState): Promise<DevicePollResult>;
  refreshOrRenew(bundle: ProviderTokenBundle): Promise<TokenLifecycleResult>;
  revoke(material: ProviderRevocationMaterial): Promise<RevokeResult>;
  fetchModelCatalog(bundle: ProviderTokenBundle): Promise<ProviderModelCatalogResult>;
  getResourceContract(): ResourceContractResult;
}

export interface ProviderProductRegistry {
  readiness(product: ProviderProductKind): ProviderReadiness;
  get(product: ProviderProductKind): ProviderProductAdapter;
  allReadiness(): readonly ProviderReadiness[];
}

export type ProviderFetch = typeof fetch;
export type ProviderClock = () => number;
