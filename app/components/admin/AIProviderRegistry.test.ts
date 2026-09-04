// [Input] Safe Provider credential projections with managed account labels and validation states.
// [Output] Focused regression proof for one-account identity and exact usable credential states.
// [Pos] Provider registry presentation contract test; it does not validate server authorization.
// [Sync] 2026-09-04: foreground the account owned by each managed Provider card.
// [Sync] 2026-09-04: keep Provider deletion guidance and unlabeled connected accounts unambiguous.

import { describe, expect, it } from "vitest";

import {
  providerCredentialValidation,
  providerManagedAccountLabel,
} from "./AIProviderRegistry";
import { providerDeleteConflictMessage } from "./ProviderDeleteAction";

describe("Provider credential validation presentation", () => {
  it("does not present a stored unverified credential as usable", () => {
    expect(providerCredentialValidation({
      credential_configured: true,
      credential_validation_status: "unverified",
    })).toMatchObject({
      label: "静态凭据待验证",
      valid: false,
    });
  });

  it("only treats the exact valid state as verified", () => {
    expect(providerCredentialValidation({
      credential_configured: true,
      credential_validation_status: "valid",
    })).toMatchObject({
      label: "静态凭据已验证",
      valid: true,
    });
    expect(providerCredentialValidation({
      credential_configured: true,
      credential_validation_status: "verified",
    }).valid).toBe(false);
  });

  it("distinguishes a missing credential from an unverified one", () => {
    expect(providerCredentialValidation({
      credential_configured: false,
      credential_validation_status: "unverified",
    })).toMatchObject({
      label: "凭据未配置",
      valid: false,
    });
  });

  it("shows one managed account identity independently from its connection state", () => {
    const connected = {
      adapter_kind: "github_copilot",
      managed_account_label: "octocat",
      managed_credential_status: "connected",
    };
    expect(providerManagedAccountLabel(connected)).toBe("账号：octocat");
    expect(providerCredentialValidation(connected)).toMatchObject({
      label: "账号已连接",
      valid: true,
    });
    expect(providerManagedAccountLabel({
      adapter_kind: "codex",
      managed_credential_status: "connected",
    })).toBe("账号：已连接");
    expect(providerManagedAccountLabel({ adapter_kind: "codex" })).toBe("账号：未连接");
    expect(providerManagedAccountLabel({ adapter_kind: "generic" })).toBeNull();
  });

  it("explains the exact model and Pricing blockers before Provider deletion", () => {
    expect(providerDeleteConflictMessage({ modelCount: 2, pricingRuleCount: 3 }))
      .toBe("Provider 仍有关联模型或定价（模型 2，Pricing 3）。请先删除 Pricing 和模型。");
  });
});
