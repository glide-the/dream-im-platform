// [Input] Secret-safe managed-auth view models and Provider form payloads.
// [Output] UI contract coverage for one-account Provider actions, preset codes, and Device guidance.
// [Pos] Pure Admin presentation tests; server lifecycle authorization remains independently tested.
// [Sync] 2026-09-04: distinguish failed reauthorization history from the effective current account.

import { describe, expect, it } from "vitest";

import {
  createManagedProviderCode,
  isManagedProviderAdapter,
  normalizeProviderFormPayload,
} from "./AdminResourceFormPage";
import { providerCredentialValidation } from "./AIProviderRegistry";
import {
  managedAccountId,
  managedAccountStatus,
  managedAuthAccountStatus,
  managedAuthCountdown,
  managedAuthAutomaticPollDelay,
  managedAuthAttemptHistoryDescription,
  managedAuthCanRetryRevocation,
  managedAuthDisconnectBody,
  managedAuthDeploymentRequirements,
  managedAuthPrimaryAction,
  managedAuthStartBody,
  managedProviderAccount,
  type ManagedProductAccountView,
  type ProviderManagedAuthView,
} from "./ProviderManagedAuthPanel";

const accountA: ManagedProductAccountView = {
  accountId: "account_a",
  status: "connected",
  authEpoch: 3,
  revision: 8,
  displayName: "工作账号 A",
  accountLabel: "a@example.test",
  accessExpiresAt: "2026-09-05T10:00:00.000Z",
  updatedAt: "2026-09-04T10:00:00.000Z",
};

const accountB: ManagedProductAccountView = {
  accountId: "account_b",
  status: "connected",
  authEpoch: 1,
  revision: 2,
  displayName: "工作账号 B",
  accountLabel: "b@example.test",
  accessExpiresAt: null,
  updatedAt: "2026-09-04T10:00:00.000Z",
};

const baseView: ProviderManagedAuthView = {
  provider: {
    id: "provider_1",
    adapterKind: "codex",
    status: "disabled",
    activeCredentialKind: "none",
    authEpoch: 1,
  },
  readiness: {
    codeSupported: true,
    clientRegistrationConfigured: true,
    integrationProfileConfigured: true,
    encryptionKeyReady: true,
    identityPepperReady: true,
    endpointPolicyValid: true,
    authorizationReady: true,
    credentialConnected: false,
    credentialRegistrationCurrent: false,
    credentialUsable: false,
    effective: false,
  },
  credential: null,
  resolvedAccount: null,
  attempt: null,
  revocation: null,
};

describe("managed Provider auth presentation", () => {
  it("recognizes only the three managed product adapters", () => {
    expect(isManagedProviderAdapter("codex")).toBe(true);
    expect(isManagedProviderAdapter("xai")).toBe(true);
    expect(isManagedProviderAdapter("github_copilot")).toBe(true);
    expect(isManagedProviderAdapter("generic")).toBe(false);
  });

  it("generates a visible collision-resistant code each time a managed preset is applied", () => {
    expect(createManagedProviderCode(
      "codex",
      () => "123e4567-e89b-12d3-a456-426614174000",
    )).toBe("codex-123e4567-e89b-12d3-a456-426614174000");
    expect(createManagedProviderCode(
      "github_copilot",
      () => "123e4567-e89b-12d3-a456-426614174001",
    )).toBe("github-copilot-123e4567-e89b-12d3-a456-426614174001");
    expect(createManagedProviderCode("generic")).toBeNull();
  });

  it("removes endpoint and static credential inputs from managed create payloads", () => {
    const normalized = normalizeProviderFormPayload({
      adapterKind: "codex",
      protocol: "anthropic",
      baseUrl: "https://must-not-be-sent.example",
      apiKey: "must-not-be-sent",
      status: "active",
      config: { authMode: "bearer", modelCatalogMode: "auto" },
    }, { adapterKind: "codex" }, "create");

    expect(normalized).toEqual({
      adapterKind: "codex",
      protocol: "openai",
      status: "disabled",
      config: { modelCatalogMode: "auto" },
    });
  });

  it("keeps generic Provider payloads unchanged", () => {
    const payload = {
      adapterKind: "generic",
      protocol: "anthropic",
      baseUrl: "https://api.example.test",
      apiKey: "static-secret",
      config: { authMode: "x-api-key" },
    };
    expect(normalizeProviderFormPayload(payload, { adapterKind: "generic" }, "create"))
      .toBe(payload);
  });

  it("presents managed account states independently of static key metadata", () => {
    expect(providerCredentialValidation({
      adapter_kind: "github_copilot",
      managed_credential_status: "connected",
      managed_account_label: "octocat",
      credential_configured: false,
    })).toMatchObject({ label: "账号已连接", valid: true });
    expect(providerCredentialValidation({
      adapter_kind: "xai",
      managed_credential_status: "reauth_required",
      credential_configured: true,
    })).toMatchObject({ label: "账号需要重新授权", valid: false });
  });

  it("formats countdowns and uses reauthorization once this Provider has an account", () => {
    expect(managedAuthCountdown("2026-09-04T10:01:05.000Z", Date.parse("2026-09-04T10:00:00.000Z")))
      .toBe("01:05");
    expect(managedAuthPrimaryAction(baseView)).toEqual({ label: "使用 ChatGPT 登录", enabled: true });
    expect(managedAuthPrimaryAction({
      ...baseView,
      provider: { ...baseView.provider, adapterKind: "xai" },
    })).toEqual({ label: "使用 xAI 登录", enabled: true });
    expect(managedAuthPrimaryAction({
      ...baseView,
      provider: { ...baseView.provider, adapterKind: "github_copilot" },
    })).toEqual({ label: "使用 GitHub 登录", enabled: true });
    expect(managedAuthPrimaryAction({
      ...baseView,
      credential: accountA,
      resolvedAccount: accountA,
    })).toEqual({ label: "重新授权", enabled: true });
  });

  it("uses strict bodies for targeted reauthorization and single-account disconnect", () => {
    expect(managedAuthStartBody(baseView, accountA, "idem_1")).toEqual({
      expectedAuthEpoch: 1,
      idempotencyKey: "idem_1",
      targetAccountId: "account_a",
      expectedAccountEpoch: 3,
    });
    expect(managedAuthDisconnectBody(accountA)).toEqual({
      expectedAccountEpoch: 3,
      expectedRevision: 8,
    });
  });

  it("reads temporary credential aliases and selects only this Provider account", () => {
    const aliased = { ...accountA, accountId: undefined, credentialId: "credential_a" };
    const view = {
      ...baseView,
      credential: accountB,
      resolvedAccount: aliased,
    };
    expect(managedAccountId(aliased)).toBe("credential_a");
    expect(managedProviderAccount(view)).toBe(aliased);
    expect(managedAuthAccountStatus(view)).toBe("已认证");
  });

  it("does not present a disconnected credential as this Provider account", () => {
    const disconnectedView: ProviderManagedAuthView = {
      ...baseView,
      credential: { ...accountA, status: "disconnected" },
      resolvedAccount: { ...accountA, status: "disconnected" },
    };
    expect(managedProviderAccount(disconnectedView)).toBeNull();
    expect(managedAccountStatus({ ...accountB, status: "reauth_required" })).toBe("需重新认证");
  });

  it("keeps the Provider account action visible while deployment readiness disables execution", () => {
    const unavailable = {
      ...baseView,
      readiness: {
        ...baseView.readiness,
        clientRegistrationConfigured: false,
        integrationProfileConfigured: false,
        encryptionKeyReady: false,
        identityPepperReady: false,
        authorizationReady: false,
        reasons: ["scopes", "userAgent"],
      },
    };
    expect(managedAuthPrimaryAction(unavailable)).toEqual({
      label: "使用 ChatGPT 登录",
      enabled: false,
    });
    expect(managedAuthDeploymentRequirements(unavailable)).toEqual([
      "OAuth 应用注册",
      "产品集成身份",
      "凭据加密密钥",
      "账号身份保护密钥",
      "获批 scopes",
      "客户端标识",
    ]);
    expect(managedAuthPrimaryAction({
      ...unavailable,
      credential: accountA,
      resolvedAccount: { ...accountA, usable: false },
    })).toEqual({ label: "重新授权", enabled: false });
    expect(managedAuthAccountStatus({
      ...unavailable,
      credential: accountA,
      resolvedAccount: { ...accountA, usable: false },
    })).toBe("认证不可用");
  });

  it("allows an expired starting operation to be superseded", () => {
    expect(managedAuthPrimaryAction({
      ...baseView,
      attempt: {
        id: "attempt_1",
        status: "starting",
        revision: 1,
        expectedAuthEpoch: 1,
        userCode: null,
        verificationUri: null,
        verificationUriComplete: null,
        expiresAt: null,
        nextPollAt: null,
        pollIntervalSeconds: null,
        operationLeaseExpiresAt: "2026-09-04T10:00:00.000Z",
        failureCode: null,
      },
    }, Date.parse("2026-09-04T10:00:01.000Z"))).toEqual({
      label: "重新发起授权",
      enabled: true,
    });
  });

  it("backs off automatic polling after contention or rate limits", () => {
    expect(managedAuthAutomaticPollDelay("PROVIDER_AUTH_POLL_IN_PROGRESS", 409)).toBe(5_000);
    expect(managedAuthAutomaticPollDelay("PROVIDER_AUTH_POLL_TOO_EARLY", 429)).toBe(1_500);
    expect(managedAuthAutomaticPollDelay(undefined, 502)).toBe(5_000);
  });

  it("does not present a failed reauthorization as loss of the current account", () => {
    const failedAttempt = {
      id: "attempt_failed",
      status: "failed" as const,
      revision: 2,
      expectedAuthEpoch: 1,
      userCode: null,
      verificationUri: null,
      verificationUriComplete: null,
      expiresAt: null,
      nextPollAt: null,
      pollIntervalSeconds: null,
      operationLeaseExpiresAt: null,
      failureCode: "PROVIDER_MANAGED_ACCOUNT_ALREADY_EXISTS",
    };

    expect(managedAuthAttemptHistoryDescription(failedAttempt, true))
      .toBe("本次重新授权未改变当前账号；当前凭据继续有效。");
    expect(managedAuthAttemptHistoryDescription(failedAttempt, false))
      .toBe("PROVIDER_MANAGED_ACCOUNT_ALREADY_EXISTS");
  });

  it("allows recovery only after a processing revocation lease expires", () => {
    const revocation = {
      id: "revocationjob_1",
      status: "processing" as const,
      revision: 2,
      reason: "disconnect" as const,
      attemptCount: 1,
      nextAttemptAt: null,
      operationLeaseExpiresAt: "2026-09-04T10:01:30.000Z",
      failureCode: null,
      completedAt: null,
      updatedAt: "2026-09-04T10:00:00.000Z",
    };
    expect(managedAuthCanRetryRevocation(
      revocation,
      Date.parse("2026-09-04T10:01:29.000Z"),
    )).toBe(false);
    expect(managedAuthCanRetryRevocation(
      revocation,
      Date.parse("2026-09-04T10:01:31.000Z"),
    )).toBe(true);
  });
});
